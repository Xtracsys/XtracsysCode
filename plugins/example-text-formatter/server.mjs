#!/usr/bin/env node
/**
 * Example XtracsysCode plugin — a minimal MCP (Model Context Protocol) stdio server.
 * Speaks newline-delimited JSON-RPC 2.0: initialize → notifications/initialized →
 * tools/list → tools/call. Pure Node, no dependencies, no network, no filesystem
 * access. It exists to demonstrate the plugin roundtrip end to end.
 */
const PROTOCOL_VERSION = "2024-11-05";

const tools = [
  {
    name: "slugify",
    description: "Convert text to a URL-safe slug (lowercase, hyphens). Harmless example tool.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to slugify" } },
      required: ["text"],
    },
  },
  {
    name: "upper",
    description: "Uppercase the given text. Harmless example tool.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to uppercase" } },
      required: ["text"],
    },
  },
];

function slugify(text) {
  return String(text).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});
process.stdin.on("end", () => process.exit(0));

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function handle(msg) {
  if (typeof msg.id !== "number") return; // notifications: nothing pending
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "example-text-formatter", version: "1.0.0" },
      },
    });
    return;
  }
  if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools } });
    return;
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    let text;
    if (name === "slugify") text = slugify(args.text ?? "");
    else if (name === "upper") text = String(args.text ?? "").toUpperCase();
    else {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true },
      });
      return;
    }
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }] } });
    return;
  }
  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not supported: ${msg.method}` } });
}

// Keep the process alive on an idle stdin; exit if the parent goes away.
setInterval(() => {
  if (!process.connected && process.ppid === 1) process.exit(0);
}, 5000).unref();
