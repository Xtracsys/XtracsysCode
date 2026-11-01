#!/usr/bin/env node
/**
 * Document Kit: Email — XtracsysCode stdio MCP plugin.
 * Tools: create_email_template, create_eml.
 * Templates are Markdown files with a small metadata header and {{variables}}.
 * create_eml renders a template (or inline body) into a standards-compliant .eml
 * (multipart/alternative: text/plain + text/html). NOTHING IS SENT — no network.
 * The user opens the .eml in their own mail client. Writes only inside the
 * project folder. Pure Node, no dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { htmlFromMarkdown } from "./md.mjs";

const MAX_CHARS = 500_000;
const PROTOCOL_VERSION = "2024-11-05";

const tools = [
  {
    name: "create_email_template",
    description:
      "Save a reusable email template as a .md file with a metadata header (subject/to/cc) and a {{variable}}-parameterized body. Tell the user which variables the template expects.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Template path relative to the project root, e.g. emails/followup.md (ends in .md)" },
        subject: { type: "string", description: "Subject line; may contain {{variables}}" },
        to: { type: "string", description: "Default To address(es); optional, may be blank or contain {{variables}}" },
        cc: { type: "string", description: "Optional default Cc" },
        body: { type: "string", description: "Markdown body with {{variable}} placeholders" },
      },
      required: ["path", "subject", "body"],
    },
  },
  {
    name: "create_eml",
    description:
      "Render an email into a ready-to-open .eml file in the project folder (multipart plain-text + HTML). Nothing is sent — the user opens it in their mail client. Either pass template+variables, or a raw subject/body.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Output path relative to the project root, e.g. out/followup.eml (ends in .eml)" },
        template: { type: "string", description: "Optional path (relative to project root) of a template .md created by create_email_template" },
        variables: { type: "object", description: "Variable values to substitute, e.g. {\"name\": \"Ada\"}", additionalProperties: { type: "string" } },
        subject: { type: "string", description: "Subject when not using a template (overrides template subject)" },
        to: { type: "string", description: "To address(es)" },
        cc: { type: "string", description: "Cc address(es)" },
        body: { type: "string", description: "Markdown body when not using a template (overrides template body)" },
      },
      required: ["path"],
    },
  },
];

function outPath(p, exts) {
  if (typeof p !== "string" || !p.trim()) throw new Error("Missing output 'path'.");
  const cwd = fs.realpathSync(process.cwd());
  const full = path.resolve(cwd, p);
  if (full !== cwd && !full.startsWith(cwd + path.sep)) throw new Error(`Refused: "${p}" is outside the project folder.`);
  const ext = path.extname(full).toLowerCase();
  if (!exts.includes(ext)) throw new Error(`Output must end in ${exts.join(" or ")}.`);
  assertContainedParent(cwd, full);
  return full;
}

function assertContainedParent(root, full) {
  let parent = path.dirname(full);
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) throw new Error("Could not find an existing path parent.");
    parent = next;
  }
  const real = fs.realpathSync(parent);
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error("Refused: path parent resolves outside the project folder.");
  if (fs.existsSync(full)) {
    const target = fs.realpathSync(full);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Refused: path target resolves outside the project folder.");
  }
}

function save(p, exts, content) {
  if (typeof content !== "string" || content.length > MAX_CHARS) throw new Error("Content must be a string under 500 KB.");
  const full = outPath(p, exts);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  assertContainedParent(fs.realpathSync(process.cwd()), full);
  fs.writeFileSync(full, content, "utf8");
  return `Wrote ${path.relative(process.cwd(), full)} (${(Buffer.byteLength(content) / 1024).toFixed(1)} KB)`;
}

// ---- template handling ----
function readTemplate(rel) {
  const cwd = fs.realpathSync(process.cwd());
  const full = path.resolve(cwd, rel);
  if (full !== cwd && !full.startsWith(cwd + path.sep)) throw new Error("Template path escapes the project folder.");
  assertContainedParent(cwd, full);
  if (!fs.existsSync(full)) throw new Error(`Template not found: ${rel}`);
  const raw = fs.readFileSync(full, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  let body = raw;
  if (m) {
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
    }
    body = m[2];
  }
  return { meta, body };
}

function substitute(text, vars) {
  let out = String(text ?? "");
  for (const [k, v] of Object.entries(vars ?? {})) {
    out = out.split(`{{${k}}}`).join(String(v).replace(/[\r\n]+/g, " "));
  }
  const leftover = [...new Set((out.match(/{{\s*[\w.-]+\s*}}/g) ?? []))];
  if (leftover.length > 0) throw new Error(`Unfilled variables remain: ${leftover.join(", ")}. Provide values in 'variables'.`);
  return out;
}

// ---- MIME ----
function encodeHeader(value) {
  const v = String(value);
  // RFC 2047 for non-ASCII subjects/names.
  if (/^[\x20-\x7e]*$/.test(v)) return v.replace(/[\r\n]+/g, " ");
  return `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

function eml({ to, cc, subject, textBody, htmlBody }) {
  const boundary = "----xtracsys-" + Date.now().toString(36);
  const headers = [
    "MIME-Version: 1.0",
    `Date: ${new Date().toUTCString().replace(/GMT$/, "+0000")}`,
    to ? `To: ${encodeHeader(to)}` : null,
    cc ? `Cc: ${encodeHeader(cc)}` : null,
    `Subject: ${encodeHeader(subject)}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);
  return `${headers.join("\r\n")}\r\n\r\nThis is a multi-part message in MIME format.\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${textBody.replace(/\r?\n/g, "\r\n")}\r\n` +
    `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${htmlBody.replace(/\r?\n/g, "\r\n")}\r\n` +
    `--${boundary}--\r\n`;
}

function callTool(name, a) {
  if (name === "create_email_template") {
    const safeMeta = (value) => String(value ?? "").replace(/[\r\n]+/g, " ");
    const header = [
      "---",
      `subject: ${safeMeta(a.subject)}`,
      `to: ${safeMeta(a.to)}`,
      a.cc ? `cc: ${safeMeta(a.cc)}` : null,
      "---",
      "",
    ].filter((x) => x !== null).join("\n");
    return save(a.path, [".md"], header + String(a.body) + "\n");
  }
  if (name === "create_eml") {
    let subject = a.subject ? String(a.subject) : "";
    let to = a.to ? String(a.to) : "";
    let cc = a.cc ? String(a.cc) : "";
    let body = a.body ? String(a.body) : null;
    if (a.template) {
      const t = readTemplate(String(a.template));
      const vars = a.variables ?? {};
      subject = subject || substitute(t.meta.subject ?? "", vars);
      to = to || substitute(t.meta.to ?? "", vars);
      cc = cc || substitute(t.meta.cc ?? "", vars);
      if (body === null) body = substitute(t.body, vars);
    }
    if (body === null) throw new Error("Provide 'template' or 'body'.");
    if (!subject) throw new Error("No subject (neither in the message nor the template).");
    const filled = a.template ? { subject, to, cc } : { subject: substitute(subject, a.variables), to: substitute(to, a.variables), cc: substitute(cc, a.variables) };
    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;line-height:1.6;color:#1a1a1a">${htmlFromMarkdown(body)}</body></html>`;
    return save(a.path, [".eml"], eml({ ...filled, textBody: body, htmlBody: html }));
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
        result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "doc-email", version: "1.0.0" } },
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
