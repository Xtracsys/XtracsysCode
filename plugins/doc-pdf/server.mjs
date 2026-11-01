#!/usr/bin/env node
/**
 * Document Kit: PDF — XtracsysCode stdio MCP plugin.
 * Tool: create_pdf — generates a real PDF (Letter, Helvetica, headings/paragraphs/
 * bullets, automatic pagination) from structured blocks. Hand-rolled PDF writer in
 * pure Node — no dependencies, no network. Writes only inside the project folder
 * (the process cwd is the chat's project root).
 *
 * Content model: blocks = [{ type: "h1"|"h2"|"p"|"bullet", text: string }, ...]
 * Text is sanitized to Latin-1 (PDF basic strings); approximate Helvetica metrics
 * are used for word wrap (width ≈ 0.5em/char regular, 0.55em bold — conservative).
 */
import fs from "node:fs";
import path from "node:path";

const PROTOCOL_VERSION = "2024-11-05";
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const BOTTOM = 72;
const MAX_CHARS = 1_000_000;

const tools = [
  {
    name: "create_pdf",
    description:
      "Generate a PDF document in the project folder from structured blocks (h1/h2 headings, paragraphs, bullets). Use for reports, one-pagers, letters. Pages are Letter-size with automatic pagination.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Output path relative to the project root, e.g. reports/summary.pdf (ends in .pdf)" },
        title: { type: "string", description: "Optional document title rendered as an H1" },
        blocks: {
          type: "array",
          description: "Document content in order",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["h1", "h2", "p", "bullet"], description: "Block kind" },
              text: { type: "string", description: "Block text" },
            },
            required: ["type", "text"],
          },
        },
      },
      required: ["path", "blocks"],
    },
  },
];

function sanitize(s) {
  // PDF basic strings are Latin-1 here; map common Unicode to safe stand-ins.
  return String(s)
    .replace(/\r\n?/g, "\n")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/[^\x09\x0a\x20-\x7e\xa0-\xff]/g, "?");
}

function escPdf(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function charW(ch, bold, size) {
  // Conservative Helvetica approximation table (1/1000 em) for common chars.
  const wide = "mwMW@";
  const narrow = "iljtfr.,;:'!|()[]";
  const caps = "ABCDEFGHJKLNOPQRSTUVXYZ";
  let em = 0.5;
  if (caps.includes(ch)) em = 0.68;
  else if (wide.includes(ch)) em = 0.82;
  else if (narrow.includes(ch)) em = 0.3;
  else if (ch === " ") em = 0.28;
  else if (ch >= "0" && ch <= "9") em = 0.556;
  return em * size * (bold ? 1.06 : 1);
}

function wrap(text, size, bold, maxWidth) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = cur ? cur + " " + word : word;
      let w = 0;
      for (const ch of candidate) w += charW(ch, bold, size);
      if (w <= maxWidth || !cur) {
        cur = candidate;
      } else {
        lines.push(cur);
        cur = word;
      }
    }
    lines.push(cur);
  }
  return lines;
}

function buildPdf(title, blocks) {
  const content = [];
  if (title) content.push({ type: "h1", text: title });
  content.push(...blocks);

  // Layout into pages of text operations.
  const pages = [];
  let ops = [];
  let y = PAGE_H - MARGIN;
  const line = (size, gap) => {
    y -= size * 1.25 + gap;
  };
  for (const b of content) {
    const type = b?.type === "h1" || b?.type === "h2" ? b.type : b?.type === "bullet" ? "bullet" : "p";
    const text = sanitize(b?.text ?? "").trim();
    if (!text) continue;
    const bold = type === "h1" || type === "h2";
    const size = type === "h1" ? 18 : type === "h2" ? 14 : 10.5;
    const indent = type === "bullet" ? 20 : 0;
    const maxWidth = PAGE_W - 2 * MARGIN - indent;
    const lines = wrap(text, size, bold, maxWidth);
    lines.forEach((ln, i) => {
      if (y - size * 1.3 < BOTTOM) {
        pages.push(ops);
        ops = [];
        y = PAGE_H - MARGIN;
      }
      line(size, i === lines.length - 1 && (type === "h1" || type === "h2") ? 4 : 0);
      const prefix = type === "bullet" && i === 0 ? "- " : "";
      const font = bold ? "/F2" : "/F1";
      ops.push(`BT ${font} ${size} Tf ${MARGIN + indent} ${y + size} Td (${escPdf(prefix + ln)}) Tj ET`);
    });
  }
  pages.push(ops);

  // Assemble objects: 1=catalog, 2=pages (filled after pages are laid out), 3=F1, 4=F2,
  // then page/content object pairs.
  const objs = [];
  const add = (s) => (objs.push(s), objs.length); // returns 1-based obj number
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(null); // placeholder for the Pages object, filled below
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"); // 3 = F1
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"); // 4 = F2
  const pageNums2 = [];
  for (const pageOps of pages) {
    const streams = pageOps.join("\n");
    const pageObj = objs.length + 1;
    const contentObj = pageObj + 1;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(streams, "latin1")} >>\nstream\n${streams}\nendstream`);
    pageNums2.push(pageObj);
  }
  objs[1] = `<< /Type /Pages /Kids [${pageNums2.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageNums2.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body ?? "<< >>"}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function callTool(name, a) {
  if (name !== "create_pdf") throw new Error(`Unknown tool: ${name}`);
  if (!Array.isArray(a.blocks)) throw new Error("'blocks' must be an array of {type, text}.");
  if (a.blocks.length > 5_000) throw new Error("Too many blocks (max 5,000).");
  const total = a.blocks.reduce((n, b) => n + String(b?.text ?? "").length, 0);
  if (total > MAX_CHARS) throw new Error(`Content too large (${total} chars; max ${MAX_CHARS}).`);
  const cwd = fs.realpathSync(process.cwd());
  const full = path.resolve(cwd, String(a.path ?? ""));
  if (full === cwd || !full.startsWith(cwd + path.sep)) throw new Error("Refused: output path is outside the project folder.");
  if (path.extname(full).toLowerCase() !== ".pdf") throw new Error("Output must end in .pdf.");
  assertContainedParent(cwd, full);
  const pdf = buildPdf(a.title ? String(a.title) : "", a.blocks);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  assertContainedParent(cwd, full);
  fs.writeFileSync(full, pdf);
  return `Wrote ${path.relative(cwd, full)} (${(pdf.length / 1024).toFixed(1)} KB, ${pdf.toString("latin1").split("/Type /Page ").length - 1} page(s))`;
}

function assertContainedParent(root, full) {
  let parent = path.dirname(full);
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) throw new Error("Could not find an existing output parent.");
    parent = next;
  }
  const real = fs.realpathSync(parent);
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error("Refused: output parent resolves outside the project folder.");
  if (fs.existsSync(full)) {
    const target = fs.realpathSync(full);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Refused: output target resolves outside the project folder.");
  }
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
        result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "doc-pdf", version: "1.0.0" } },
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
