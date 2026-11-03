import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once, getEventListeners } from "node:events";
import test from "node:test";
import childProcess from "node:child_process";
import { createOpenAICompatibleProvider } from "../dist-electron/electron/agent/providers/openaiCompatible.js";
import { McpManager } from "../dist-electron/electron/agent/mcp.js";

const MiB = 1024 * 1024;
async function withHttp(handler, run) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
const cb = () => {
  const seen = { text: [], tools: [], thought: [], usage: [] };
  return { seen, onText: (x) => seen.text.push(x), onToolCall: (x) => seen.tools.push(x), onThought: (x) => seen.thought.push(x), onUsage: (x) => seen.usage.push(x) };
};
const chat = (provider, signal = new AbortController().signal, callbacks = cb()) =>
  provider.streamChat({ model: "fixture", messages: [], tools: [], signal }, callbacks);

const event = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
for (const [name, body, expected] of [
  ["event byte aggregate", ("data: " + " ".repeat(200_000) + "\n").repeat(6) + "data: {}\n\n", /SSE event.*byte limit/i],
  ["event line count", "data: \n".repeat(257) + "data: {}\n\n", /SSE event.*line limit/i],
  ["tool argument aggregate", event({ tool_calls: [{ index: 0, function: { name: "f", arguments: "x".repeat(128 * 1024) } }] }).repeat(9), /tool.*byte limit/i],
  ["tool call count", Array.from({ length: 129 }, (_, index) => event({ tool_calls: [{ index, function: { name: "f", arguments: "{}" } }] })).join(""), /tool.*count limit/i],
  ["stream aggregate", (":" + "x".repeat(1000) + "\n\n").repeat(17_000), /SSE stream.*byte limit/i],
]) {
  test(`SSE bounds ${name}`, { timeout: 6000 }, async () => {
    await withHttp((_req, res) => { res.writeHead(200); res.end(body); }, async (url) => {
      const callbacks = cb();
      const result = await chat(createOpenAICompatibleProvider(url, "gmlx"), undefined, callbacks);
      assert.equal(result.finishReason, "error");
      assert.match(result.error, expected);
      assert.deepEqual(callbacks.seen.tools, []);
    });
  });
}

test("SSE DONE finishes without waiting for EOF and cancels its reader", { timeout: 6000 }, async () => {
  let closed;
  const closure = new Promise((resolve) => { closed = resolve; });
  await withHttp((_req, res) => {
    res.on("close", closed);
    res.writeHead(200); res.write(event({ content: "ok" }) + "data: [DONE]\n\n");
  }, async (url) => {
    const callbacks = cb();
    const result = await chat(createOpenAICompatibleProvider(url, "gmlx", { timeoutMs: 200 }), undefined, callbacks);
    assert.equal(result.finishReason, "stop");
    assert.deepEqual(callbacks.seen.text, ["ok"]);
    await closure;
  });
});

test("SSE cancellation in a callback prevents further buffered callbacks", { timeout: 6000 }, async () => {
  await withHttp((_req, res) => { res.end(event({ content: "one" }) + event({ content: "two" })); }, async (url) => {
    const caller = new AbortController();
    const callbacks = cb();
    const onText = callbacks.onText;
    callbacks.onText = (x) => { onText(x); caller.abort(); };
    assert.equal((await chat(createOpenAICompatibleProvider(url, "gmlx"), caller.signal, callbacks)).error, "aborted");
    assert.deepEqual(callbacks.seen.text, ["one"]);
    assert.equal(getEventListeners(caller.signal, "abort").length, 0);
  });
});

test("SSE rejects an oversized unterminated UTF-8 line and closes transport", { timeout: 6000 }, async () => {
  let closed;
  const closure = new Promise((resolve) => { closed = resolve; });
  await withHttp((_req, res) => {
    res.on("close", closed);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: " + "é".repeat(150 * 1024));
  }, async (url) => {
    const result = await chat(createOpenAICompatibleProvider(url, "gmlx", { timeoutMs: 250 }));
    assert.match(result.error, /SSE line.*byte limit/i);
    await closure;
  });
});

test("HTTP error body is byte-bounded, including no-newline bodies", { timeout: 6000 }, async () => {
  await withHttp((_req, res) => { res.writeHead(500); res.end("é".repeat(32 * 1024)); }, async (url) => {
    const result = await chat(createOpenAICompatibleProvider(url, "gmlx"));
    assert.equal(result.finishReason, "error");
    assert.match(result.error, /HTTP 500.*byte limit/i);
    assert.ok(result.error.length < 600);
  });
});

test("error-body timeout and caller cancellation are returned, not thrown", { timeout: 6000 }, async () => {
  await withHttp((_req, res) => { res.writeHead(503); res.write("partial"); }, async (url) => {
    const provider = createOpenAICompatibleProvider(url, "gmlx", { timeoutMs: 150 });
    assert.match((await chat(provider)).error, /timed out/i);
    const caller = new AbortController();
    const timer = setTimeout(() => caller.abort(), 30);
    try { assert.equal((await chat(provider, caller.signal)).error, "aborted"); }
    finally { clearTimeout(timer); }
  });
});

// Fixtures use the installed Node runtime; their code makes no shell/network/file calls.
const mcpFixture = String.raw`
  const readline = require('node:readline');
  process.on('SIGTERM', () => {});
  const watchdog = setTimeout(() => process.exit(91), 8000);
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') send({ protocolVersion: '2024-11-05' });
    if (msg.method === 'tools/list') send({ tools: [{ name: 'hang' }] });
    if (msg.method === 'tools/call' && msg.params.name === 'exit') process.exit(7);
    function send(result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n'); }
  });
`;
const mcpConfig = (source = mcpFixture) => [{ name: "fixture", command: process.execPath, args: ["-e", source] }];
const isAlive = (child) => child.exitCode === null && child.signalCode === null;

test("MCP stopAll waits for an abort-triggered shutdown and clears pending calls/listeners", { timeout: 6000 }, async () => {
  const manager = new McpManager();
  const caller = new AbortController();
  let conn;
  try {
    assert.deepEqual(await manager.start(mcpConfig(), process.cwd(), caller.signal), []);
    conn = manager.conns.get("fixture");
    const pending = manager.callTool("fixture", "hang", {});
    caller.abort();
    await manager.stopAll();
    assert.equal(isAlive(conn.child), false, "stopAll returned before abort-triggered termination completed");
    assert.equal((await pending).ok, false);
    assert.equal(conn.pending.size, 0);
    assert.equal(getEventListeners(caller.signal, "abort").length, 0);
    assert.equal(conn.child.stdout.listenerCount("data"), 0);
    assert.equal(conn.child.stderr.listenerCount("data"), 0);
    assert.equal(conn.child.listenerCount("exit"), 0);
  } finally { await manager.stopAll(); if (conn && isAlive(conn.child)) conn.child.kill("SIGKILL"); }
});

test("MCP stopAll includes in-progress startup and cannot resurrect it", { timeout: 6000 }, async () => {
  const manager = new McpManager();
  const caller = new AbortController();
  let conn;
  const request = manager.request.bind(manager);
  manager.request = (connection, ...args) => { conn = connection; return request(connection, ...args); };
  const starting = manager.start(mcpConfig("setTimeout(() => process.exit(91), 8000); process.stdin.resume();"), process.cwd(), caller.signal);
  try {
    await manager.stopAll();
    assert.equal(isAlive(conn.child), false, "startup child was omitted from shutdown");
    assert.match((await starting).join(" "), /stopp|cancel|exit/i);
    assert.deepEqual(manager.listTools(), []);
    assert.equal(conn.pending.size, 0);
    assert.equal(getEventListeners(caller.signal, "abort").length, 0);
  } finally { caller.abort(); await starting; await manager.stopAll(); if (conn && isAlive(conn.child)) conn.child.kill("SIGKILL"); }
});

test("MCP reports bounded POSIX termination failure rather than claiming success", { timeout: 6000, skip: process.platform === "win32" }, async () => {
  const manager = new McpManager();
  let conn;
  const originalKill = process.kill;
  let originalChildKill;
  try {
    assert.deepEqual(await manager.start(mcpConfig()), []);
    conn = manager.conns.get("fixture");
    originalChildKill = conn.child.kill.bind(conn.child);
    conn.child.kill = () => false;
    process.kill = () => { throw Object.assign(new Error("fixture denied"), { code: "EPERM" }); };
    const errors = await manager.stopAll();
    assert.ok(Array.isArray(errors), "stopAll must return shutdown diagnostics");
    assert.match(errors.join(" "), /terminat|still running/i);
    assert.equal(conn.pending.size, 0);
    process.kill = originalKill;
    conn.child.kill = originalChildKill;
    assert.deepEqual(await manager.stopAll(), []);
    assert.equal(isAlive(conn.child), false, "failed termination must remain tracked for retry");
  } finally {
    process.kill = originalKill;
    if (conn) { conn.child.kill = originalChildKill; if (isAlive(conn.child)) { const exited = once(conn.child, "exit"); conn.child.kill("SIGKILL"); await exited; } }
    await manager.stopAll();
  }
});

test("MCP cleans the POSIX process group even when the direct child exits promptly", { timeout: 6000, skip: process.platform === "win32" }, async () => {
  const root = mcpFixture.replace("process.on('SIGTERM', () => {});", "")
    .replace("{ name: 'hang' }", "{ name: 'hang', description: String(kid.pid) }");
  const fixture = `const kid = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify("process.on('SIGTERM', () => {}); process.stdout.write('ready'); setTimeout(() => process.exit(91), 8000);")}], { stdio: ['ignore', 'pipe', 'ignore'] }); kid.stdout.once('data', () => { ${root} });`;
  const manager = new McpManager();
  let pid;
  try {
    assert.deepEqual(await manager.start(mcpConfig(fixture)), []);
    pid = Number(manager.listTools()[0].description);
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    assert.deepEqual(await manager.stopAll(), []);
    let gone = false;
    for (let i = 0; i < 25; i++) {
      try { process.kill(pid, 0); } catch (e) { if (e.code === "ESRCH") { gone = true; break; } throw e; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(gone, true, "same-group descendant survived direct-child exit");
  } finally { await manager.stopAll(); if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} } }
});

test("normal SSE preserves split UTF-8, CRLF, multiline data, tools, usage and EOF", { timeout: 6000 }, async () => {
  const body = 'data: {"choices":\r\ndata: [{"delta":{"content":"雪é","reasoning":"think"}}]}\r\n\r\n' +
    event({ tool_calls: [{ index: 0, id: "a", function: { name: "look", arguments: '{"q":' } }] }) +
    event({ tool_calls: [{ index: 0, function: { name: "up", arguments: '"雪"}' } }] }) +
    'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3}}';
  await withHttp((_req, res) => {
    res.writeHead(200);
    for (const byte of Buffer.from(body)) res.write(Buffer.from([byte]));
    res.end();
  }, async (url) => {
    const caller = new AbortController();
    const callbacks = cb();
    const result = await chat(createOpenAICompatibleProvider(url, "gmlx"), caller.signal, callbacks);
    assert.equal(result.finishReason, "tool_calls");
    assert.deepEqual(callbacks.seen, { text: ["雪é"], thought: ["think"], tools: [{ id: "a", name: "lookup", args: { q: "雪" } }], usage: [{ inputTokens: 2, outputTokens: 3 }] });
    assert.equal(getEventListeners(caller.signal, "abort").length, 0);
  });
});

test("SSE read timeout, caller cancel and optional discovery timeout clean up", { timeout: 6000 }, async () => {
  await withHttp((_req, res) => { res.writeHead(200); res.write(": heartbeat\n\n"); }, async (url) => {
    const provider = createOpenAICompatibleProvider(url, "gmlx", { timeoutMs: 120 });
    assert.match((await chat(provider)).error, /timed out/i);
    const caller = new AbortController();
    const timer = setTimeout(() => caller.abort(), 30);
    try { assert.equal((await chat(provider, caller.signal)).error, "aborted"); }
    finally { clearTimeout(timer); }
    assert.equal(getEventListeners(caller.signal, "abort").length, 0);
    assert.deepEqual(await provider.listModels(), []);
  });
});

test("MCP process exit settles pending calls and removes owned listeners", { timeout: 6000 }, async () => {
  const manager = new McpManager();
  const caller = new AbortController();
  try {
    assert.deepEqual(await manager.start(mcpConfig(), process.cwd(), caller.signal), []);
    const conn = manager.conns.get("fixture");
    const pending = manager.callTool("fixture", "hang", {});
    const timers = [...conn.pending.values()].map((p) => p.timer);
    assert.equal((await manager.callTool("fixture", "exit", {})).ok, false);
    assert.equal((await pending).ok, false);
    const shutdownIssues = await manager.stopAll();
    assert.deepEqual(shutdownIssues, process.platform === "win32"
      ? ["fixture: Windows direct child already exited; descendant termination is unconfirmed"]
      : []);
    assert.equal(conn.pending.size, 0);
    assert.ok(timers.every((t) => t._destroyed));
    assert.equal(getEventListeners(caller.signal, "abort").length, 0);
    assert.equal(conn.child.listenerCount("exit"), 0);
    assert.equal(conn.child.stdout.listenerCount("data"), 0);
    assert.deepEqual(manager.listTools(), []);
  } finally { await manager.stopAll(); }
});

test("MCP request cancellation and timeout clear their own timers/listeners", { timeout: 35000 }, async () => {
  const manager = new McpManager();
  try {
    assert.deepEqual(await manager.start(mcpConfig(mcpFixture.replace("8000", "34000"))), []);
    const conn = manager.conns.get("fixture");
    const caller = new AbortController();
    const cancelled = manager.request(conn, "tools/call", { name: "hang" }, caller.signal);
    const cancelledTimer = [...conn.pending.values()][0].timer;
    caller.abort();
    await assert.rejects(cancelled, /cancelled/i);
    assert.equal(cancelledTimer._destroyed, true);
    assert.equal(getEventListeners(caller.signal, "abort").length, 0);
    const timed = manager.request(conn, "tools/call", { name: "hang" }, new AbortController().signal);
    const timedEntry = [...conn.pending.values()][0];
    await assert.rejects(timed, /timed out/i);
    assert.equal(timedEntry.timer._destroyed, true);
    assert.equal(getEventListeners(timedEntry.signal, "abort").length, 0);
    assert.equal(conn.pending.size, 0);
  } finally { await manager.stopAll(); }
});

for (const [name, source, expected] of [
  ["nonzero exit", "setTimeout(() => process.exit(3), 60)", /taskkill exited \(3\)/i],
  ["timeout", "setTimeout(() => process.exit(0), 4000)", /taskkill timed out/i],
  ["spawn error", null, /taskkill failed/i],
]) {
  test(`Windows taskkill lifecycle simulation: ${name} is awaited and reported`, { timeout: 6000, skip: process.platform === "win32" }, async () => {
    const manager = new McpManager();
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const spawn = childProcess.spawn;
    let helper;
    try {
      assert.deepEqual(await manager.start(mcpConfig()), []);
      const conn = manager.conns.get("fixture");
      childProcess.spawn = (command, args, options) => {
        assert.equal(command, "taskkill");
        assert.deepEqual(args, ["/pid", String(conn.child.pid), "/T", "/F"]);
        if (source === null) return spawn(`${process.execPath}-missing-fixture`, [], options);
        helper = spawn(process.execPath, ["-e", source], options);
        return helper;
      };
      Object.defineProperty(process, "platform", { ...platform, value: "win32" });
      assert.match((await manager.stopAll()).join(" "), expected);
      assert.equal(isAlive(conn.child), false);
      if (helper) { assert.equal(isAlive(helper), false); assert.equal(helper.listenerCount("exit"), 0); }
    } finally {
      Object.defineProperty(process, "platform", platform);
      childProcess.spawn = spawn;
      await manager.stopAll();
      if (helper && isAlive(helper)) helper.kill("SIGKILL");
    }
  });
}

test("Windows natural exit reports unconfirmed descendant cleanup", { timeout: 6000, skip: process.platform === "win32" }, async () => {
  const manager = new McpManager();
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    assert.deepEqual(await manager.start(mcpConfig()), []);
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    assert.equal((await manager.callTool("fixture", "exit", {})).ok, false);
    assert.match((await manager.stopAll()).join(" "), /already exited.*descendant.*unconfirmed/i);
  } finally { Object.defineProperty(process, "platform", platform); await manager.stopAll(); }
});

test("MCP rejects oversized no-newline startup output and cleans failed spawn", { timeout: 6000 }, async () => {
  const caller = new AbortController();
  const manager = new McpManager();
  try {
    const errors = await manager.start(mcpConfig("process.stdout.write('x'.repeat(1100000)); setTimeout(() => process.exit(91), 8000);"), process.cwd(), caller.signal);
    assert.match(errors.join(" "), /line limit/i);
    assert.deepEqual(await manager.stopAll(), []);
    assert.equal(manager.conns.size, 0);
    assert.equal(getEventListeners(caller.signal, "abort").length, 0);
    const failed = await manager.start([{ name: "missing", command: `${process.execPath}-missing-fixture`, args: [] }], process.cwd(), caller.signal);
    assert.match(failed.join(" "), /process error|spawn failed/i);
    assert.deepEqual(await manager.stopAll(), []);
    assert.equal(manager.conns.size, 0);
    assert.equal(getEventListeners(caller.signal, "abort").length, 0);
  } finally { await manager.stopAll(); }
});

test("discovery rejects oversized JSON without a newline", { timeout: 6000 }, async () => {
  await withHttp((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "x".repeat(2 * MiB) }] }));
  }, async (url) => {
    await assert.rejects(createOpenAICompatibleProvider(url, "gmlx").listModels(), /model.*byte limit/i);
  });
});
