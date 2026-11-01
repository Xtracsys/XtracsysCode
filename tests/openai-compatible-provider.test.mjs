import assert from "node:assert/strict";
import { AgentRunner } from "../dist-electron/electron/runner.js";
import {
  OPENAI_COMPATIBLE_PRESETS,
  createGmlxCompatibleProvider,
  createLmStudioProvider,
  createMlxLmServerProvider,
  createOpenAICompatibleProvider,
  getOpenAICompatiblePresetInfo,
} from "../dist-electron/electron/agent/providers/openaiCompatible.js";

const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();

function streamResponse(chunks, status = 200) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

function chunked(text, sizes) {
  const bytes = encoder.encode(text);
  const chunks = [];
  let offset = 0;
  let sizeIndex = 0;
  while (offset < bytes.length) {
    const size = sizes[sizeIndex++ % sizes.length];
    chunks.push(bytes.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

function callbacks() {
  const calls = { text: [], thought: [], tools: [], usage: [] };
  return {
    calls,
    cb: {
      onText: (value) => calls.text.push(value),
      onThought: (value) => calls.thought.push(value),
      onToolCall: (value) => calls.tools.push(value),
      onUsage: (value) => calls.usage.push(value),
    },
  };
}

try {
  // Protocol presets are explicit, while engine/tool support remains unverified.
  assert.deepEqual(Object.keys(OPENAI_COMPATIBLE_PRESETS), ["llamacpp", "lmStudio", "gmlx", "mlxLmServer"]);
  assert.equal(OPENAI_COMPATIBLE_PRESETS.gmlx.engine, "asher/gmlx");
  assert.equal(OPENAI_COMPATIBLE_PRESETS.mlxLmServer.engine, "MLX LM server (not bare MLX)");
  for (const id of Object.keys(OPENAI_COMPATIBLE_PRESETS)) {
    const preset = OPENAI_COMPATIBLE_PRESETS[id];
    assert.equal(preset.engineVerified, false);
    assert.equal(getOpenAICompatiblePresetInfo(id).capabilities.toolCalls, "sent-if-requested; engine/model support unverified");
  }

  // A base URL that already ends in /v1 must not produce /v1/v1.
  {
    const requests = [];
    const sse = [
      { choices: [{ delta: { content: "hello ", reasoning_content: "checking" }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-a", type: "function", function: { name: "lookup", arguments: '{"q":' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"item"}' } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 9, completion_tokens: 3 } },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (init.method === "POST") return streamResponse(chunked(sse, [1, 2, 7, 3, 11]));
      return Response.json({ data: [{ id: "lmstudio-model" }] });
    };
    const provider = createLmStudioProvider("http://127.0.0.1:1234/v1/");
    assert.deepEqual(await provider.listModels(), ["lmstudio-model"]);
    const result = callbacks();
    const finish = await provider.streamChat(
      {
        model: "manual-model-id",
        messages: [{ role: "user", content: "hello" }],
        tools: [{ name: "lookup", description: "lookup", parameters: { type: "object" } }],
        signal: new AbortController().signal,
      },
      result.cb,
    );
    assert.equal(finish.finishReason, "tool_calls");
    assert.deepEqual(result.calls.text, ["hello "]);
    assert.deepEqual(result.calls.thought, ["checking"]);
    assert.deepEqual(result.calls.tools, [{ id: "call-a", name: "lookup", args: { q: "item" } }]);
    assert.deepEqual(result.calls.usage, [{ inputTokens: 9, outputTokens: 3 }]);
    assert.equal(requests[0].url, "http://127.0.0.1:1234/v1/models");
    assert.equal(requests[1].url, "http://127.0.0.1:1234/v1/chat/completions");
    const sent = JSON.parse(requests[1].init.body);
    assert.equal(sent.model, "manual-model-id");
    assert.equal(sent.stream, true);
    assert.equal(sent.stream_options, undefined);
    assert.equal(sent.tools[0].function.name, "lookup");
    assert.equal(requests[1].init.redirect, "error");
  }

  // Prefix paths gain exactly one /v1, and unavailable model discovery leaves manual IDs usable.
  {
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (init.method === "POST") return streamResponse(["data: [DONE]\n\n"]);
      return new Response("unavailable", { status: 404 });
    };
    const provider = createGmlxCompatibleProvider("http://localhost:9000/proxy");
    assert.deepEqual(await provider.listModels(), []);
    const finish = await provider.streamChat(
      { model: "typed-model", messages: [], tools: [], signal: new AbortController().signal },
      callbacks().cb,
    );
    assert.equal(finish.finishReason, "stop");
    assert.equal(requests[0].url, "http://localhost:9000/proxy/v1/models");
    assert.equal(requests[1].url, "http://localhost:9000/proxy/v1/chat/completions");
    assert.equal(JSON.parse(requests[1].init.body).model, "typed-model");
  }

  // Missing usage is not reported as a fabricated zero-token count.
  {
    globalThis.fetch = async () => streamResponse(["data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\n", "data: [DONE]\n\n"]);
    const result = callbacks();
    const provider = createMlxLmServerProvider("http://127.0.0.1:8081/v1");
    const finish = await provider.streamChat(
      { model: "mlx-model", messages: [], tools: [], signal: new AbortController().signal },
      result.cb,
    );
    assert.equal(finish.finishReason, "stop");
    assert.deepEqual(result.calls.usage, []);
  }

  // Invalid model IDs and remote URLs fail closed; HTTP request errors are returned as provider errors.
  {
    assert.throws(() => createOpenAICompatibleProvider("https://example.com", "gmlx"), /loopback|this machine/i);
    const provider = createOpenAICompatibleProvider("http://127.0.0.1:9999", "llamacpp");
    const result = await provider.streamChat(
      { model: "", messages: [], tools: [], signal: new AbortController().signal },
      callbacks().cb,
    );
    assert.equal(result.finishReason, "error");
    assert.match(result.error, /model/i);

    globalThis.fetch = async () => new Response("bad request body", { status: 400 });
    const failed = await provider.streamChat(
      { model: "gguf-model", messages: [], tools: [], signal: new AbortController().signal },
      callbacks().cb,
    );
    assert.equal(failed.finishReason, "error");
    assert.match(failed.error, /HTTP 400/);
    assert.match(failed.error, /bad request body/);
  }

  // Caller cancellation and transport timeout both resolve as explicit errors, not uncaught rejections.
  {
    const provider = createOpenAICompatibleProvider("http://127.0.0.1:9998", "gmlx", { timeoutMs: 15 });
    globalThis.fetch = (_url, init) => new Promise((_, reject) => {
      const abort = () => reject(new Error("aborted by signal"));
      if (init.signal.aborted) abort();
      else init.signal.addEventListener("abort", abort, { once: true });
    });
    const timeoutPending = provider.streamChat(
      { model: "m", messages: [], tools: [], signal: new AbortController().signal },
      callbacks().cb,
    );
    // AbortSignal.timeout uses an unref'ed timer in Node; hold the test process open.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const timeout = await timeoutPending;
    assert.equal(timeout.finishReason, "error");
    assert.match(timeout.error, /timed out/i);

    const controller = new AbortController();
    const pending = provider.streamChat(
      { model: "m", messages: [], tools: [], signal: controller.signal },
      callbacks().cb,
    );
    controller.abort();
    const aborted = await pending;
    assert.equal(aborted.finishReason, "error");
    assert.equal(aborted.error, "aborted");
  }

  // The real app runner must route the selected engine to the generic compatible provider.
  {
    const runner = new AgentRunner({}, {}, { request: async () => false }, () => {});
    for (const providerId of ["gmlx", "mlxLmServer"]) {
      const provider = runner.makeProvider({
        provider: providerId,
        ollamaUrl: "http://127.0.0.1:11434",
        llamaCppUrl: "http://127.0.0.1:8080",
        openAICompatibleUrl: "http://127.0.0.1:9100",
      });
      assert.equal(provider.label, OPENAI_COMPATIBLE_PRESETS[providerId].label);
    }
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname === "/api/tags") return Response.json({ models: [] });
      return Response.json({ data: [{ id: "compatible-model" }] });
    };
    try {
      const models = await runner.listBackendModels({
        provider: "gmlx",
        ollamaUrl: "http://127.0.0.1:11434",
        llamaCppUrl: "http://127.0.0.1:8080",
        openAICompatibleUrl: "http://127.0.0.1:9100",
      });
      assert.deepEqual(models.openAICompatible, ["compatible-model"]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  }

  console.log("openai-compatible-provider.test: passed");
} finally {
  globalThis.fetch = originalFetch;
}
