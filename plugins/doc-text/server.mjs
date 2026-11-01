#!/usr/bin/env node
/**
 * Document Kit: Text — XtracsysCode stdio MCP plugin.
 * Tools: write_markdown, write_text, write_html.
 * Writes ONLY inside the current working directory (= the chat's project folder).
 * Pure Node, no dependencies, no network. The agent composes content; this tool
 * formats and saves it verbatim.
 */
import fs from "node:fs";
import path from "node:path";
import { htmlFromMarkdown } from "./md.mjs";

const MAX_CHARS = 2_000_000;
const PROTOCOL_VERSION = "2024-11-05";

const tools = [
  {
    name: "write_markdown",
    description:
      "Save a Markdown document into the project folder. Path must be relative and end in .md. Use for READMEs, notes, reports, specs.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Output path relative to the project root, e.g. docs/report.md" },
        title: { type: "string", description: "Optional document title — becomes an H1 heading at the top" },
        content: { type: "string", description: "Markdown body (headings, lists, tables, code fences…)" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "write_text",
    description: "Save a plain-text document (.txt) into the project folder. Path must be relative and end in .txt.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Output path relative to the project root, e.g. notes/summary.txt" },
        content: { type: "string", description: "Plain text content, saved verbatim" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "write_html",
    description:
      "Save a standalone styled HTML document (.html). Content is Markdown, converted to HTML and wrapped in a clean self-contained template (no external assets). Path must end in .html.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Output path relative to the project root, e.g. reports/summary.html" },
        title: { type: "string", description: "Document title (page <title> and visible H1)" },
        content: { type: "string", description: "Markdown content to convert into the HTML body" },
      },
      required: ["path", "title", "content"],
    },
  },
];

function outPath(p, exts) {
  if (typeof p !== "string" || !p.trim()) throw new Error("Missing output 'path'.");
  const cwd = fs.realpathSync(process.cwd());
  const full = path.resolve(cwd, p);
  if (full !== cwd && !full.startsWith(cwd + path.sep)) {
    throw new Error(`Refused: "${p}" is outside the project folder.`);
  }
  const ext = path.extname(full).toLowerCase();
  if (!exts.includes(ext)) throw new Error(`Output must end in ${exts.join(" or ")}.`);
  assertContainedParent(cwd, full);
  return full;
}

function assertContainedParent(root, full) {
  let parent = path.dirname(full);
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) throw new Error("Could not find an existing output parent.");
    parent = next;
  }
  const realParent = fs.realpathSync(parent);
  if (realParent !== root && !realParent.startsWith(root + path.sep)) {
    throw new Error("Refused: output parent resolves outside the project folder.");
  }
  if (fs.existsSync(full) && fs.realpathSync(full) !== full) {
    const realTarget = fs.realpathSync(full);
    if (realTarget !== root && !realTarget.startsWith(root + path.sep)) {
      throw new Error("Refused: output target resolves outside the project folder.");
    }
  }
}

function save(p, exts, content) {
  if (typeof content !== "string") throw new Error("'content' must be a string.");
  if (content.length > MAX_CHARS) throw new Error(`Content too large (${content.length} chars; max ${MAX_CHARS}).`);
  const full = outPath(p, exts);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  assertContainedParent(fs.realpathSync(process.cwd()), full);
  fs.writeFileSync(full, content, "utf8");
  const kb = (Buffer.byteLength(content) / 1024).toFixed(1);
  return `Wrote ${path.relative(process.cwd(), full)} (${kb} KB)`;
}

function htmlDoc(title, bodyHtml) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;max-width:760px;margin:3rem auto;padding:0 1.25rem;line-height:1.65;color:#1a1a1a}
h1,h2,h3{line-height:1.25;color:#111}h1{border-bottom:2px solid #e0784f;padding-bottom:.3rem}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}
pre{background:#f5f5f4;border:1px solid #e2e2e0;border-radius:6px;padding:.8rem 1rem;overflow-x:auto}
code{background:#f5f5f4;padding:.1em .35em;border-radius:3px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:.4rem .6rem;text-align:left}
blockquote{border-left:4px solid #e0784f;margin:0;padding:.2rem 1rem;color:#555}
a{color:#c2571f}
</style></head><body>
${bodyHtml}
</body></html>`;
}

function callTool(name, a) {
  if (name === "write_markdown") {
    const body = (a.title ? `# ${String(a.title).slice(0, 200)}\n\n` : "") + String(a.content);
    return save(a.path, [".md", ".markdown"], body);
  }
  if (name === "write_text") {
    return save(a.path, [".txt"], String(a.content));
  }
  if (name === "write_html") {
    const title = String(a.title ?? "Document").slice(0, 200);
    return save(a.path, [".html", ".htm"], htmlDoc(title, htmlFromMarkdown(String(a.content ?? ""))));
  }
  throw new Error(`Unknown tool: ${name}`);
}

// ---- MCP stdio plumbing (NDJSON JSON-RPC 2.0) ----
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
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
    if (typeof msg.id !== "number") continue;
    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "doc-text", version: "1.0.0" },
        },
      });
    } else if (msg.method === "tools/list") {
      send({ jsonrpc: "2.0", id: msg.id, result: { tools } });
    } else if (msg.method === "tools/call") {
      try {
        const text = callTool(String(msg.params?.name ?? ""), msg.params?.arguments ?? {});
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }] } });
      } catch (e) {
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true } });
      }
    } else {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not supported: ${msg.method}` } });
    }
  }
});
process.stdin.on("end", () => process.exit(0));
setInterval(() => {
  if (process.ppid === 1) process.exit(0);
}, 5000).unref();
