import { Readable } from "node:stream";
import type {
  ChatMessage,
  Provider,
  ProviderStreamCallbacks,
  ToolSpec,
} from "../types";
import { loopbackBase, NO_REDIRECT } from "./localUrl";
import { OPENAI_RESPONSE_LIMITS as LIMITS, requestLifetime, ResponseLimitError, STREAM_DEADLINE_MS } from "./responseBounds";

/**
 * Ollama provider — native /api/chat streaming (NDJSON).
 * Tool calls arrive as message.tool_calls with arguments already parsed as objects.
 * Reasoning models stream reasoning in message.thinking.
 */
export function createOllamaProvider(baseUrl: string): Provider {
  const base = loopbackBase(baseUrl, "Ollama"); // R9: local-only, validated once
  return {
    label: "Ollama",
    async listModels() {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000), ...NO_REDIRECT });
      if (!res.ok) throw new Error(`Ollama /api/tags ${res.status}`);
      const data = (await res.json()) as { models?: { name?: string }[] };
      return (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
    },
    async streamChat(opts, cb) {
      const { model, messages, tools, signal, params } = opts;
      const body: Record<string, unknown> = {
        model,
        messages: toOllamaMessages(messages),
        stream: true,
      };
      if (tools.length > 0) body.tools = toOllamaTools(tools);
      const options: Record<string, unknown> = {};
      if (typeof params?.numCtx === "number" && params.numCtx > 0) options.num_ctx = params.numCtx;
      if (typeof params?.temperature === "number") options.temperature = params.temperature;
      if (Object.keys(options).length > 0) body.options = options;

      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
        ...NO_REDIRECT,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        return { finishReason: "error", error: `Ollama HTTP ${res.status}: ${text.slice(0, 400)}` };
      }
      return consumeNdjson(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), signal, cb);
    },
  };
}

interface OllamaToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> };
}

function toOllamaMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content, tool_name: m.name };
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.args },
        })),
      };
    }
    // N11: vision — base64 images ride on the user message.
    if (m.role === "user" && m.images && m.images.length > 0) {
      return { role: "user", content: m.content, images: m.images };
    }
    return { role: m.role, content: m.content };
  });
}

function toOllamaTools(tools: ToolSpec[]): Record<string, unknown>[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

async function consumeNdjson(
  body: unknown,
  signal: AbortSignal,
  cb: ProviderStreamCallbacks,
): Promise<{ finishReason: "stop" | "tool_calls" | "length" | "error"; error?: string }> {
  const stream = body as import("node:stream").Readable;
  const lifetime = requestLifetime(STREAM_DEADLINE_MS, signal);
  return new Promise((resolve) => {
    let buf = "";
    let streamBytes = 0;
    let lineBytes = 0;
    let toolCallCount = 0;
    let settled = false;
    let sawToolCall = false;
    let usage = { inputTokens: 0, outputTokens: 0 };

    const finish = (result: { finishReason: "stop" | "tool_calls" | "length" | "error"; error?: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      lifetime.dispose();
      resolve(result);
    };
    const abortOutcome = (): { finishReason: "error"; error: string } => {
      if (signal.aborted) return { finishReason: "error", error: "aborted" };
      if (lifetime.timedOut) return { finishReason: "error", error: "request timed out" };
      return { finishReason: "error", error: "stream failed" };
    };

    const onData = (chunk: Buffer | string) => {
      try {
        lifetime.signal.throwIfAborted();
        // Count wire bytes before decoding so UTF-8 and no-newline input cannot
        // evade the bounds through JS character counts.
        const raw = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
        streamBytes += raw.byteLength;
        if (streamBytes > LIMITS.streamBytes) throw new ResponseLimitError(`Ollama stream exceeded the ${LIMITS.streamBytes} byte limit`);
        for (const byte of raw) {
          if (byte === 10) lineBytes = 0;
          else if (++lineBytes > LIMITS.lineBytes) throw new ResponseLimitError(`Ollama line exceeded the ${LIMITS.lineBytes} byte limit`);
        }
        buf += raw.toString("utf8");
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let msg: {
            message?: { content?: string; thinking?: string; tool_calls?: OllamaToolCall[] };
            done?: boolean;
            done_reason?: string;
            prompt_eval_count?: number;
            eval_count?: number;
            error?: string;
          };
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.error) {
            finish({ finishReason: "error", error: String(msg.error) });
            return;
          }
          const m = msg.message;
          if (m?.content) cb.onText(m.content);
          if (m?.thinking) cb.onThought(m.thinking);
          if (Array.isArray(m?.tool_calls)) {
            for (const tc of m.tool_calls) {
              if (++toolCallCount > LIMITS.toolCalls) throw new ResponseLimitError(`Ollama tool call count limit is ${LIMITS.toolCalls}`);
              const name = tc.function?.name;
              if (!name) continue;
              const args = tc.function?.arguments ?? {};
              sawToolCall = true;
              cb.onToolCall({
                id: `call_${Math.random().toString(36).slice(2, 10)}`,
                name,
                args: typeof args === "object" && args !== null ? args : { value: args },
              });
            }
          }
          if (typeof msg.prompt_eval_count === "number") usage.inputTokens = msg.prompt_eval_count;
          if (typeof msg.eval_count === "number") usage.outputTokens = msg.eval_count;
          if (msg.done) {
            cb.onUsage?.(usage);
            const reason =
              msg.done_reason === "length"
                ? "length"
                : sawToolCall
                  ? "tool_calls"
                  : "stop";
            finish({ finishReason: reason });
            return;
          }
        }
      } catch (e) {
        stream.destroy();
        if (signal.aborted || lifetime.timedOut) finish(abortOutcome());
        else finish({ finishReason: "error", error: (e as Error).message });
      }
    };
    const onError = (err: Error) => {
      if (signal.aborted || lifetime.timedOut) finish(abortOutcome());
      else finish({ finishReason: "error", error: err.message });
    };
    const cleanup = () => {
      stream.removeListener("data", onData);
      stream.removeListener("error", onError);
      stream.removeListener("end", onEnd);
    };
    const onEnd = () => {
      cb.onUsage?.(usage);
      finish({ finishReason: sawToolCall ? "tool_calls" : "stop" });
    };

    stream.on("data", onData);
    stream.on("error", onError);
    stream.on("end", onEnd);
  });
}
