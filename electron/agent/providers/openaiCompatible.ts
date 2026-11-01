import type { ChatMessage, Provider, ProviderStreamCallbacks, ToolSpec } from "../types";
import { loopbackBase, NO_REDIRECT } from "./localUrl";
import { abortReader, boundedResponseText, OPENAI_RESPONSE_LIMITS as LIMITS, requestLifetime, ResponseLimitError } from "./responseBounds";

/**
 * Protocol-level presets only. They describe the request dialect this provider
 * sends, not verified behavior of any model, server build, or tool implementation.
 */
export const OPENAI_COMPATIBLE_PRESETS = {
  llamacpp: {
    id: "llamacpp",
    engine: "llama.cpp",
    label: "llama.cpp (OpenAI-compatible)",
    endpointEvidence: "Chat Completions is already implemented in this project; no live engine verification",
    engineVerified: false,
    requestUsage: true,
  },
  lmStudio: {
    id: "lmStudio",
    engine: "LM Studio",
    label: "LM Studio (custom OpenAI-compatible)",
    endpointEvidence: "generic OpenAI-compatible preset; endpoint/model/tool specifics not verified here",
    engineVerified: false,
    requestUsage: false,
  },
  gmlx: {
    id: "gmlx",
    engine: "asher/gmlx",
    label: "GMLX (asher/gmlx; custom OpenAI-compatible)",
    endpointEvidence: "custom-compatible preset only; GMLX endpoint/model/tool specifics unresolved",
    engineVerified: false,
    requestUsage: false,
  },
  mlxLmServer: {
    id: "mlxLmServer",
    engine: "MLX LM server (not bare MLX)",
    label: "MLX LM server (custom OpenAI-compatible; not bare MLX)",
    endpointEvidence: "custom-compatible preset only; MLX LM server endpoint/model/tool specifics unresolved",
    engineVerified: false,
    requestUsage: false,
  },
} as const;

export type OpenAICompatiblePresetId = keyof typeof OPENAI_COMPATIBLE_PRESETS;
export type OpenAICompatiblePreset = (typeof OPENAI_COMPATIBLE_PRESETS)[OpenAICompatiblePresetId];

const CAPABILITIES = {
  chatCompletions: "OpenAI-compatible protocol request; engine not verified",
  streaming: "SSE parser",
  toolCalls: "sent-if-requested; engine/model support unverified",
  vision: "sent-if-images-present; engine/model support unverified",
  reasoning: "recognized-if-server-sends; not requested",
  usage: "server-reported-only; absent usage is omitted",
} as const;

export interface OpenAICompatibleProviderOptions {
  /** Maximum time for model discovery and one complete chat stream. Defaults to 120 seconds. */
  timeoutMs?: number;
}

export interface OpenAICompatiblePresetInfo {
  readonly id: OpenAICompatiblePresetId;
  readonly engine: string;
  readonly label: string;
  readonly endpointEvidence: string;
  readonly engineVerified: false;
  readonly requestUsage: boolean;
  readonly capabilities: typeof CAPABILITIES;
}

/**
 * Generic local OpenAI Chat Completions provider. baseUrl may be an origin,
 * a reverse-proxy prefix, or a URL already ending in /v1; paths are normalized
 * so /v1 is never appended twice. Every URL is validated as loopback-only.
 */
export function createOpenAICompatibleProvider(
  baseUrl: string,
  presetId: OpenAICompatiblePresetId,
  options: OpenAICompatibleProviderOptions = {},
): Provider {
  const preset = OPENAI_COMPATIBLE_PRESETS[presetId];
  const base = loopbackBase(baseUrl, preset.engine);
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${preset.engine} timeoutMs must be a positive finite number`);
  }
  const modelsUrl = apiUrl(base, "/models");
  const chatUrl = apiUrl(base, "/chat/completions");

  return {
    label: preset.label,
    async listModels() {
      // Discovery is optional: an unavailable /v1/models endpoint yields no
      // suggestions, while streamChat still accepts a user-entered model id.
      const lifetime = requestLifetime(Math.min(timeoutMs, 4_000));
      try {
        const response = await fetch(modelsUrl, { signal: lifetime.signal, ...NO_REDIRECT });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          return [];
        }
        const payload = JSON.parse(await boundedResponseText(response, LIMITS.modelBytes, "Model discovery response", lifetime.signal)) as { data?: { id?: unknown }[] };
        if (!Array.isArray(payload?.data)) return [];
        return payload.data
          .map((model) => (typeof model?.id === "string" ? model.id : ""))
          .filter(Boolean);
      } catch (error) {
        if (error instanceof ResponseLimitError) throw error;
        return [];
      } finally {
        lifetime.dispose();
      }
    },
    async streamChat(opts, cb) {
      const { model, messages, tools, signal, params } = opts;
      if (typeof model !== "string" || model.trim().length === 0) {
        return { finishReason: "error", error: `${preset.engine} requires a model id; enter one manually if discovery is unavailable.` };
      }
      if (signal.aborted) return { finishReason: "error", error: "aborted" };

      const body: Record<string, unknown> = {
        model,
        messages: toOpenAIMessages(messages),
        stream: true,
      };
      if (preset.requestUsage) body.stream_options = { include_usage: true };
      if (typeof params?.temperature === "number") body.temperature = params.temperature;
      if (tools.length > 0) {
        body.tools = toOpenAITools(tools);
        body.tool_choice = "auto";
      }

      const lifetime = requestLifetime(timeoutMs, signal);
      let response: Response | undefined;
      try {
        response = await fetch(chatUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: lifetime.signal,
          ...NO_REDIRECT,
        });
        if (!response.ok || !response.body) {
          const detail = await boundedResponseText(response, LIMITS.errorBytes, "HTTP error response", lifetime.signal);
          return {
            finishReason: "error",
            error: `${preset.engine} HTTP ${response.status}${detail ? `: ${detail.slice(0, 400)}` : ""}`,
          };
        }
        return await consumeSse(response.body, signal, lifetime.signal, cb);
      } catch (error) {
        if (signal.aborted) return { finishReason: "error", error: "aborted" };
        if (lifetime.timedOut) return { finishReason: "error", error: "request timed out" };
        if (response) return { finishReason: "error", error: `${preset.engine} HTTP ${response.status}: ${String(error instanceof Error ? error.message : error).slice(0, 500)}` };
        return requestError(preset.engine, base, error, signal, lifetime.signal);
      } finally {
        lifetime.dispose();
      }
    },
  };
}

/** Exposed separately so a coordinator can render protocol claims without treating them as verified. */
export function getOpenAICompatiblePresetInfo(id: OpenAICompatiblePresetId): OpenAICompatiblePresetInfo {
  return { ...OPENAI_COMPATIBLE_PRESETS[id], capabilities: CAPABILITIES };
}

export const createLlamaCppOpenAIProvider = (baseUrl: string, options?: OpenAICompatibleProviderOptions) =>
  createOpenAICompatibleProvider(baseUrl, "llamacpp", options);
export const createLmStudioProvider = (baseUrl: string, options?: OpenAICompatibleProviderOptions) =>
  createOpenAICompatibleProvider(baseUrl, "lmStudio", options);
export const createGmlxCompatibleProvider = (baseUrl: string, options?: OpenAICompatibleProviderOptions) =>
  createOpenAICompatibleProvider(baseUrl, "gmlx", options);
export const createMlxLmServerProvider = (baseUrl: string, options?: OpenAICompatibleProviderOptions) =>
  createOpenAICompatibleProvider(baseUrl, "mlxLmServer", options);

function apiUrl(base: string, resource: "/models" | "/chat/completions"): string {
  const clean = base.replace(/\/+$/, "");
  const parsed = new URL(clean);
  const path = parsed.pathname.replace(/\/+$/, "");
  const versionPrefix = /(?:^|\/)v1$/i.test(path) ? "" : "/v1";
  return `${clean}${versionPrefix}${resource}`;
}

function toOpenAIMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      };
    }
    if (message.role === "user" && message.images?.length) {
      return {
        role: "user",
        content: [
          { type: "text", text: message.content },
          ...message.images.map((image) => ({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${image}` },
          })),
        ],
      };
    }
    return { role: message.role, content: message.content };
  });
}

function toOpenAITools(tools: ToolSpec[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

interface OpenAIStreamEvent {
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
  error?: string | { message?: string; type?: string };
}

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  callerSignal: AbortSignal,
  timeoutSignal: AbortSignal,
  cb: ProviderStreamCallbacks,
): Promise<{ finishReason: "stop" | "tool_calls" | "length" | "error"; error?: string }> {
  const reader = body.getReader();
  const detachAbort = abortReader(reader, timeoutSignal);
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let lineBytes = 0;
  let streamBytes = 0;
  let eventBytes = 0;
  let eventLines = 0;
  let toolBytes = 0;
  let dataLines: string[] = [];
  let finishReason: string | null = null;
  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  let sawToolCall = false;
  let sawDone = false;
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();

  const processPayload = (payload: string) => {
    timeoutSignal.throwIfAborted();
    if (!payload.trim()) return;
    if (payload.trim() === "[DONE]") { sawDone = true; return; }
    let event: OpenAIStreamEvent;
    try {
      event = JSON.parse(payload) as OpenAIStreamEvent;
    } catch {
      throw new Error(`Invalid JSON in OpenAI-compatible SSE event: ${payload.slice(0, 200)}`);
    }
    if (event.error) {
      const detail = typeof event.error === "string" ? event.error : event.error.message ?? JSON.stringify(event.error);
      throw new Error(`Server stream error: ${detail.slice(0, 400)}`);
    }
    if (event.usage) {
      const inputTokens = event.usage.prompt_tokens;
      const outputTokens = event.usage.completion_tokens;
      if (typeof inputTokens === "number" || typeof outputTokens === "number") {
        usage = {
          ...(typeof inputTokens === "number" ? { inputTokens } : {}),
          ...(typeof outputTokens === "number" ? { outputTokens } : {}),
        };
      }
    }
    const choice = event.choices?.[0];
    if (!choice) return;
    const delta = choice.delta;
    if (typeof delta?.content === "string" && delta.content) cb.onText(delta.content);
    timeoutSignal.throwIfAborted();
    const thought = delta?.reasoning_content ?? delta?.reasoning;
    if (typeof thought === "string" && thought) cb.onThought(thought);
    timeoutSignal.throwIfAborted();
    for (const part of delta?.tool_calls ?? []) {
      const index = Number.isInteger(part.index) ? part.index! : 0;
      if (index < 0 || index >= LIMITS.toolCalls || (!toolCalls.has(index) && toolCalls.size >= LIMITS.toolCalls)) {
        throw new ResponseLimitError(`SSE tool call count limit is ${LIMITS.toolCalls}`);
      }
      for (const fragment of [part.id, part.function?.name, part.function?.arguments]) {
        if (typeof fragment === "string") toolBytes += Buffer.byteLength(fragment, "utf8");
      }
      if (toolBytes > LIMITS.toolBytes) throw new ResponseLimitError(`SSE tool fragments exceeded the ${LIMITS.toolBytes} byte limit`);
      const accumulated = toolCalls.get(index) ?? { id: "", name: "", args: "" };
      if (typeof part.id === "string" && part.id) accumulated.id = part.id;
      if (typeof part.function?.name === "string") accumulated.name += part.function.name;
      if (typeof part.function?.arguments === "string") accumulated.args += part.function.arguments;
      toolCalls.set(index, accumulated);
      sawToolCall = true;
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  const dispatch = () => {
    if (dataLines.length > 0) processPayload(dataLines.join("\n"));
    dataLines = [];
    eventBytes = 0;
    eventLines = 0;
  };
  const processLine = (line: string) => {
    if (line === "") {
      dispatch();
      return;
    }
    eventBytes += Buffer.byteLength(line, "utf8") + 1;
    if (eventBytes > LIMITS.eventBytes) throw new ResponseLimitError(`SSE event exceeded the ${LIMITS.eventBytes} byte limit`);
    if (++eventLines > LIMITS.eventLines) throw new ResponseLimitError(`SSE event exceeded the ${LIMITS.eventLines} line limit`);
    if (line.startsWith(":")) return;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
  };
  const flushTools = () => {
    for (const [, call] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
      timeoutSignal.throwIfAborted();
      if (!call.name) continue;
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = call.args ? JSON.parse(call.args) : {};
        args = parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : { value: parsed };
      } catch {
        args = { _raw: call.args };
      }
      cb.onToolCall({
        id: call.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name: call.name,
        args,
      });
    }
  };

  try {
    for (;;) {
      timeoutSignal.throwIfAborted();
      const { done, value } = await reader.read();
      timeoutSignal.throwIfAborted();
      if (done) break;
      streamBytes += value.byteLength;
      if (streamBytes > LIMITS.streamBytes) throw new ResponseLimitError(`SSE stream exceeded the ${LIMITS.streamBytes} byte limit`);
      // Count wire bytes before decoding/appending: UTF-8 and no-newline input
      // must not evade the line bound through JS character counts.
      for (const byte of value) {
        if (byte === 10) lineBytes = 0;
        else if (++lineBytes > LIMITS.lineBytes) throw new ResponseLimitError(`SSE line exceeded the ${LIMITS.lineBytes} byte limit`);
      }
      lineBuffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, newline).replace(/\r$/, "");
        lineBuffer = lineBuffer.slice(newline + 1);
        processLine(line);
        if (sawDone) break;
      }
      if (sawDone) break;
    }
    if (!sawDone) {
      lineBuffer += decoder.decode();
      if (lineBuffer) processLine(lineBuffer.replace(/\r$/, ""));
      dispatch();
    }
  } catch (error) {
    if (callerSignal.aborted) return { finishReason: "error", error: "aborted" };
    if (timeoutSignal.aborted) return { finishReason: "error", error: "request timed out" };
    return { finishReason: "error", error: error instanceof Error ? error.message : String(error) };
  } finally {
    detachAbort();
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  if (usage) cb.onUsage?.(usage);
  flushTools();
  if (finishReason === "length") return { finishReason: "length" };
  if (finishReason === "tool_calls" || sawToolCall) return { finishReason: "tool_calls" };
  return { finishReason: "stop" };
}

function requestError(
  engine: string,
  base: string,
  error: unknown,
  callerSignal: AbortSignal,
  timeoutSignal: AbortSignal,
): { finishReason: "error"; error: string } {
  if (callerSignal.aborted) return { finishReason: "error", error: "aborted" };
  if (timeoutSignal.aborted) return { finishReason: "error", error: "request timed out" };
  const detail = error instanceof Error ? error.message : String(error);
  return { finishReason: "error", error: `Cannot reach ${engine} at ${base}: ${detail}` };
}
