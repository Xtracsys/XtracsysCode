#!/usr/bin/env node
/**
 * Document Kit: Spreadsheets — XtracsysCode stdio MCP plugin.
 * Tools: create_xlsx (real Office Open XML workbook: multiple named sheets, inline
 * strings + numbers), create_csv (RFC 4180). The ZIP container is hand-rolled
 * (store method + CRC-32) — no dependencies, no network. Writes only inside the
 * project folder (cwd = the chat's project root).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const PROTOCOL_VERSION = "2024-11-05";
const MAX_ROWS = 10_000;
const MAX_SHEETS = 20;
const MAX_COLS = 256;

const tools = [
  {
    name: "create_xlsx",
    description:
      "Create an Excel workbook (.xlsx) in the project folder. Multiple named sheets; cells may be strings or numbers. Use for tables, budgets, trackers, data exports.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Output path relative to the project root, e.g. reports/budget.xlsx (ends in .xlsx)" },
        sheets: {
          type: "array",
          description: "Sheets in order",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Sheet name (1–31 chars, no []:*?/\\)" },
              rows: {
                type: "array",
                description: "Rows of cells; each cell is a string or number. First row is conventionally the header.",
                items: { type: "array", items: {} },
              },
            },
            required: ["name", "rows"],
          },
        },
      },
      required: ["path", "sheets"],
    },
  },
  {
    name: "create_csv",
    description: "Create a CSV file in the project folder (RFC 4180 quoting). Use for simple tabular exports.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Output path relative to the project root, e.g. data/export.csv (ends in .csv)" },
        rows: { type: "array", description: "Rows of cells (strings or numbers)", items: { type: "array", items: {} } },
      },
      required: ["path", "rows"],
    },
  },
];

// ---------- minimal ZIP (store method) ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: { name: Buffer } → store-method zip Buffer (deflate via zlib for size). */
function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => Buffer.from([v & 255, (v >> 8) & 255]);
  const u32 = (v) => Buffer.from([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    // deflate with raw deflate; fall back to stored when it doesn't help
    const deflated = zlib.deflateRawSync(content, { level: 9 });
    const useDeflate = deflated.length < content.length;
    const data = useDeflate ? deflated : content;
    const crc = crc32(content);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(useDeflate ? 8 : 0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(content.length), u16(nameBuf.length), u16(0),
      nameBuf,
    ]);
    parts.push(local, data);
    central.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(useDeflate ? 8 : 0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(content.length), u16(nameBuf.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf,
      ]),
    );
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(Object.keys(files).length), u16(Object.keys(files).length),
    u32(centralBuf.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...parts, centralBuf, end]);
}

// ---------- XLSX ----------
function xmlEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function colName(n) {
  // 0-based → A, B, …
  let s = "";
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(rows) {
  const body = rows
    .map((cells, r) => {
      const cs = cells
        .slice(0, MAX_COLS)
        .map((cell, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (typeof cell === "number" && Number.isFinite(cell)) {
            return `<c r="${ref}"><v>${cell}</v></c>`;
          }
          if (cell === null || cell === undefined || cell === "") return "";
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function buildXlsx(sheets) {
  if (sheets.length === 0) throw new Error("At least one sheet is required.");
  const files = {};
  const overrides = [];
  const sheetRels = sheets
    .map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("");
  const sheetTags = sheets
    .map((s, i) => `<sheet name="${xmlEsc(String(s.name).slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  files["[Content_Types].xml"] = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  files["_rels/.rels"] = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  files["xl/workbook.xml"] = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}</Relationships>`,
  );
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = Buffer.from(sheetXml(s.rows));
  });
  return makeZip(files);
}

// ---------- CSV ----------
function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function outPath(p, exts) {
  if (typeof p !== "string" || !p.trim()) throw new Error("Missing output 'path'.");
  const cwd = fs.realpathSync(process.cwd());
  const full = path.resolve(cwd, p);
  if (full === cwd || !full.startsWith(cwd + path.sep)) throw new Error(`Refused: "${p}" is outside the project folder.`);
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
  const real = fs.realpathSync(parent);
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error("Refused: output parent resolves outside the project folder.");
  if (fs.existsSync(full)) {
    const target = fs.realpathSync(full);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Refused: output target resolves outside the project folder.");
  }
}

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new Error(`Rows must be an array of at most ${MAX_ROWS}.`);
  let cells = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length > MAX_COLS) throw new Error(`Each row must contain at most ${MAX_COLS} cells.`);
    cells += row.length;
    if (cells > 200_000) throw new Error("Workbook exceeds the 200,000-cell limit.");
    for (const cell of row) {
      if (typeof cell === "string" && cell.length > 32_000) throw new Error("A cell exceeds the 32,000-character limit.");
      if (cell !== null && cell !== undefined && typeof cell !== "string" && typeof cell !== "number" && typeof cell !== "boolean") throw new Error("Cells must be strings, numbers, booleans, or empty.");
    }
  }
  return rows;
}

function callTool(name, a) {
  if (name === "create_xlsx") {
    const sheets = (a.sheets ?? []).map((s) => {
      const sheetName = String(s.name ?? "Sheet").replace(/[[\]:*?/\\]/g, "-").trim() || "Sheet";
      const rows = validateRows(Array.isArray(s.rows) ? s.rows : []);
      return { name: sheetName, rows };
    });
    if (sheets.length > MAX_SHEETS) throw new Error(`Too many sheets (max ${MAX_SHEETS}).`);
    const buf = buildXlsx(sheets);
    const cwd = fs.realpathSync(process.cwd());
    const full = path.resolve(cwd, String(a.path ?? ""));
    if (full === cwd || !full.startsWith(cwd + path.sep)) throw new Error("Refused: output path is outside the project folder.");
    if (path.extname(full).toLowerCase() !== ".xlsx") throw new Error("Output must end in .xlsx.");
    assertContainedParent(cwd, full);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    assertContainedParent(cwd, full);
    fs.writeFileSync(full, buf);
    return `Wrote ${path.relative(cwd, full)} (${(buf.length / 1024).toFixed(1)} KB, ${sheets.length} sheet(s), ${sheets.reduce((n, s) => n + s.rows.length, 0)} rows)`;
  }
  if (name === "create_csv") {
    const rows = Array.isArray(a.rows) ? a.rows : [];
    validateRows(rows);
    const csv = rows.map((r) => r.map((cell) => {
      let value = cell === null || cell === undefined ? "" : String(cell);
      if (/^[\s]*[=+@-]/.test(value)) value = "'" + value;
      return csvCell(value);
    }).join(",")).join("\r\n") + "\r\n";
    const full = outPath(a.path, [".csv"]);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, csv, "utf8");
    return `Wrote ${path.relative(process.cwd(), full)} (${rows.length} rows)`;
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
        result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "doc-spreadsheets", version: "1.0.0" } },
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
