import type {
  ChatMessage,
  Provider,
  ProviderStreamCallbacks,
  ToolSpec,
} from "../types";
import { loopbackBase, NO_REDIRECT } from "./localUrl";
import { abortReader, OPENAI_RESPONSE_LIMITS as LIMITS, requestLifetime, ResponseLimitError, STREAM_DEADLINE_MS } from "./responseBounds";

/**
 * llama.cpp provider — OpenAI-compatible /v1/chat/completions over the llama-server
 * HTTP API (start with: llama-server -m model.gguf --host 127.0.0.1 --port 8080).
 * Streams SSE deltas; accumulates streamed tool_call argument fragments.
 */
export function createLlamaCppProvider(baseUrl: string): Provider {
  const base = loopbackBase(baseUrl, "llama.cpp"); // R9: local-only, validated once
  return {
    label: "llama.cpp",
    async listModels() {
      const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(4000), ...NO_REDIRECT });
      if (!res.ok) throw new Error(`llama.cpp /v1/models ${res.status}`);
      const data = (await res.json()) as { data?: { id?: string }[] };
      return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    },
    async streamChat(opts, cb) {
      const { model, messages, tools, signal, params } = opts;
      const body: Record<string, unknown> = {
        model: model || "local",
        messages: toOpenAiMessages(messages),
        stream: true,
        stream_options: { include_usage: true },
      };
      if (typeof params?.temperature === "number") body.temperature = params.temperature;
      // Note: context size for llama.cpp is fixed by llama-server's --ctx-size flag;
      // request-level overrides are not honored, so numCtx is not sent here.
      if (tools.length > 0) {
        body.tools = tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
        body.tool_choice = "auto";
      }

      let res: Response;
      try {
        res = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
          ...NO_REDIRECT,
        });
      } catch (e) {
        return { finishReason: "error", error: `Cannot reach llama.cpp at ${base}: ${(e as Error).message}` };
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        return { finishReason: "error", error: `llama.cpp HTTP ${res.status}: ${text.slice(0, 400)}` };
      }
      return consumeSse(res.body, signal, cb);
    },
  };
}

function toOpenAiMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      };
    }
    // N11: vision — multimodal content parts with data URLs (llava-style servers).
    if (m.role === "user" && m.images && m.images.length > 0) {
      return {
        role: "user",
        content: [
          { type: "text", text: m.content },
          ...m.images.map((b64) => ({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${b64}` },
          })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

interface OpenAiDelta {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    } | null;
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  cb: ProviderStreamCallbacks,
): Promise<{ finishReason: "stop" | "tool_calls" | "length" | "error"; error?: string }> {
  const lifetime = requestLifetime(STREAM_DEADLINE_MS, signal);
  const reader = body.getReader();
  const detachAbort = abortReader(reader, lifetime.signal);
  const decoder = new TextDecoder();
  let buf = "";
  let finish: string | null = null;
  let streamBytes = 0;
  let lineBytes = 0;
  let toolBytes = 0;

  const toolAcc = new Map<
    number,
    { id: string; name: string; args: string }
  >();
  let usage = { inputTokens: 0, outputTokens: 0 };

  const flushToolCalls = () => {
    const sorted = [...toolAcc.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, tc] of sorted) {
      let args: Record<string, unknown> = {};
      try {
        args = tc.args ? (JSON.parse(tc.args) as Record<string, unknown>) : {};
      } catch {
        args = { _raw: tc.args };
      }
      cb.onToolCall({ id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: tc.name, args });
    }
    toolAcc.clear();
  };

  try {
    for (;;) {
      lifetime.signal.throwIfAborted();
      const { done, value } = await reader.read();
      lifetime.signal.throwIfAborted();
      if (done) break;
      // Count wire bytes before decoding so UTF-8 and no-newline input cannot
      // evade the bounds through JS character counts.
      streamBytes += value.byteLength;
      if (streamBytes > LIMITS.streamBytes) throw new ResponseLimitError(`llama.cpp stream exceeded the ${LIMITS.streamBytes} byte limit`);
      for (const byte of value) {
        if (byte === 10) lineBytes = 0;
        else if (++lineBytes > LIMITS.lineBytes) throw new ResponseLimitError(`llama.cpp line exceeded the ${LIMITS.lineBytes} byte limit`);
      }
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let msg: OpenAiDelta;
        try {
          msg = JSON.parse(payload);
        } catch {
          continue;
        }
        if (msg.usage) {
          usage.inputTokens = msg.usage.prompt_tokens ?? 0;
          usage.outputTokens = msg.usage.completion_tokens ?? 0;
        }
        const choice = msg.choices?.[0];
        if (!choice) continue;
        const d = choice.delta;
        if (d?.content) cb.onText(d.content);
        const reasoning = d?.reasoning_content ?? d?.reasoning;
        if (reasoning) cb.onThought(reasoning);
        if (Array.isArray(d?.tool_calls)) {
          for (const tc of d.tool_calls) {
            const i = tc.index ?? 0;
            if (i < 0 || i >= LIMITS.toolCalls) throw new ResponseLimitError(`llama.cpp tool call index limit is ${LIMITS.toolCalls}`);
            let acc = toolAcc.get(i);
            if (!acc) {
              if (toolAcc.size >= LIMITS.toolCalls) throw new ResponseLimitError(`llama.cpp tool call count limit is ${LIMITS.toolCalls}`);
              acc = { id: "", name: "", args: "" };
              toolAcc.set(i, acc);
            }
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) {
              toolBytes += Buffer.byteLength(tc.function.arguments, "utf8");
              if (toolBytes > LIMITS.toolBytes) throw new ResponseLimitError(`llama.cpp tool fragments exceeded the ${LIMITS.toolBytes} byte limit`);
              acc.args += tc.function.arguments;
            }
          }
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    }
  } catch (e) {
    if (signal.aborted) return { finishReason: "error", error: "aborted" };
    if (lifetime.timedOut) return { finishReason: "error", error: "request timed out" };
    return { finishReason: "error", error: (e as Error).message };
  } finally {
    detachAbort();
    lifetime.dispose();
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  cb.onUsage?.(usage);
  flushToolCalls();
  if (finish === "length") return { finishReason: "length" };
  if (finish === "tool_calls") return { finishReason: "tool_calls" };
  return { finishReason: "stop" };
}
