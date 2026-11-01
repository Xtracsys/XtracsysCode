/**
 * Document Kit plugin tests (v5 R13): spawns each first-party document plugin's
 * stdio MCP server directly (cwd = a disposable temp "project"), lists tools, calls
 * them, and validates the produced files — PDF structure, ZIP/OOXML parts (via a
 * minimal central-directory reader), XML well-formedness, MIME shape, path refusal.
 * Plain Node, no network. Run: node tests/doc-plugins.test.mjs
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) passed++;
  else {
    failures.push(label);
    console.error("FAIL:", label);
  }
}

function mkProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-doctools-"));
}

/** Minimal MCP client for one server (enough for list + call). */
function client(serverDir, projectDir) {
  const child = spawn("node", [path.join(repoRoot, "plugins", serverDir, "server.mjs")], { cwd: projectDir, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  const pending = new Map();
  let nextId = 1;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch {
        /* ignore */
      }
    }
  });
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  return {
    init: () => request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test" } }),
    list: () => request("tools/list", {}),
    call: (name, args) => request("tools/call", { name, arguments: args }),
    stop: () => child.kill("SIGKILL"),
  };
}

const text = (result) => result?.result?.content?.[0]?.text ?? "";
const isErr = (result) => result?.result?.isError === true;

/** Minimal ZIP central-directory reader: returns { name → size } for store/deflate zips. */
function zipEntries(buf) {
  const eofSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  let eof = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === eofSig[0] && buf[i + 1] === eofSig[1] && buf[i + 2] === eofSig[2] && buf[i + 3] === eofSig[3]) {
      eof = i;
      break;
    }
  }
  if (eof < 0) throw new Error("Not a ZIP (no end-of-central-directory)");
  const count = buf.readUInt16LE(eof + 10);
  let ptr = buf.readUInt32LE(eof + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error("Bad central directory");
    const method = buf.readUInt16LE(ptr + 10);
    const csize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const dataStart = localOff + 30 + localNameLen;
    let data = buf.slice(dataStart, dataStart + csize);
    if (method === 8) data = zlib.inflateRawSync(data);
    entries[name] = data;
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Naive XML well-formedness: every <tag> has a matching </tag> or is self-closed. */
function xmlOk(xml) {
  const s = String(xml).replace(/<\?[\s\S]*?\?>/g, "");
  const stack = [];
  const re = /<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(s))) {
    const closing = m[1] === "/";
    const self = m[4] === "/";
    const tag = m[2];
    if (self) continue;
    if (closing) {
      const top = stack.pop();
      if (top !== tag) return false;
    } else stack.push(tag);
  }
  return stack.length === 0;
}

// ================= doc-text =================
{
  const dir = mkProject();
  const c = client("doc-text", dir);
  await c.init();
  const list = await c.list();
  ok(list.result.tools.length === 3, "doc-text: 3 tools listed");

  const md = await c.call("write_markdown", { path: "docs/report.md", title: "Q3 Report", content: "# dup\n\nSome **bold** text." });
  ok(!isErr(md), "doc-text: write_markdown ok");
  const mdFile = path.join(dir, "docs", "report.md");
  ok(fs.existsSync(mdFile), "doc-text: .md written");
  ok(fs.readFileSync(mdFile, "utf8").startsWith("# Q3 Report"), "doc-text: title heading added");

  const html = await c.call("write_html", { path: "out/page.html", title: "Page", content: "## Head\n\nPara with *em*." });
  ok(!isErr(html), "doc-text: write_html ok");
  const htmlContent = fs.readFileSync(path.join(dir, "out", "page.html"), "utf8");
  ok(htmlContent.startsWith("<!DOCTYPE html>") && htmlContent.includes("<h2>Head</h2>") && htmlContent.includes("<em>em</em>"), "doc-text: markdown converted inside HTML template");
  const unsafeLink = await c.call("write_html", { path: "out/unsafe.html", title: "Safe", content: "[click](javascript:alert(1))" });
  const unsafeHtml = fs.readFileSync(path.join(dir, "out", "unsafe.html"), "utf8");
  ok(!isErr(unsafeLink) && !/href=[\"']javascript:/i.test(unsafeHtml), "doc-text: unsafe javascript URL omitted");

  const evil = await c.call("write_text", { path: "../escape.txt", content: "nope" });
  ok(isErr(evil) && text(evil).includes("outside"), "doc-text: traversal path refused");
  const badExt = await c.call("write_text", { path: "file.exe", content: "nope" });
  ok(isErr(badExt), "doc-text: extension whitelist enforced");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-doc-outside-"));
  fs.symlinkSync(outside, path.join(dir, "escape"), "dir");
  const symlinkWrite = await c.call("write_text", { path: "escape/escaped.txt", content: "nope" });
  ok(isErr(symlinkWrite) && !fs.existsSync(path.join(outside, "escaped.txt")), "doc-text: symlink escape rejected");
  await fsp.rm(outside, { recursive: true, force: true });
  c.stop();
}

// ================= doc-email =================
{
  const dir = mkProject();
  const c = client("doc-email", dir);
  await c.init();
  const list = await c.list();
  ok(list.result.tools.length === 2, "doc-email: 2 tools listed");

  const tpl = await c.call("create_email_template", {
    path: "emails/followup.md",
    subject: "Follow-up for {{project}}",
    to: "{{client}}@example.com",
    body: "Hi {{name}},\n\nThanks for the **{{project}}** kickoff. Next steps:\n\n- review the plan\n- confirm the budget\n\n— The team",
  });
  ok(!isErr(tpl), "doc-email: template created");
  ok(fs.existsSync(path.join(dir, "emails", "followup.md")), "doc-email: template file written");

  const eml = await c.call("create_eml", {
    path: "out/followup.eml",
    template: "emails/followup.md",
    variables: { project: "Apollo", client: "ada", name: "Ada" },
  });
  ok(!isErr(eml), "doc-email: eml rendered from template");
  const emlContent = fs.readFileSync(path.join(dir, "out", "followup.eml"), "utf8");
  ok(emlContent.includes("Subject: Follow-up for Apollo"), "doc-email: subject substituted");
  ok(emlContent.includes("To: ada@example.com"), "doc-email: to substituted");
  ok(emlContent.includes('Content-Type: multipart/alternative') && emlContent.includes("text/html"), "doc-email: MIME alternative parts present");
  ok(emlContent.includes("<strong>Apollo</strong>"), "doc-email: markdown rendered in HTML part");
  const injected = await c.call("create_eml", { path: "out/injected.eml", template: "emails/followup.md", variables: { project: "Apollo", client: "ada", name: "Ada\r\nBcc: victim@example.com" } });
  const injectedContent = fs.readFileSync(path.join(dir, "out", "injected.eml"), "utf8");
  ok(!isErr(injected) && !/^Bcc: victim@example\.com$/m.test(injectedContent), "doc-email: variable newlines cannot inject MIME headers");

  const missing = await c.call("create_eml", { path: "out/bad.eml", template: "emails/followup.md", variables: { name: "x" } });
  ok(isErr(missing) && text(missing).includes("Unfilled variables"), "doc-email: unfilled variables rejected clearly");

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-email-outside-"));
  fs.writeFileSync(path.join(outside, "secret.md"), "---\nsubject: Outside\n---\nPRIVATE-OUTSIDE\n");
  fs.symlinkSync(outside, path.join(dir, "escape"), "dir");
  const leak = await c.call("create_eml", { path: "out/leak.eml", template: "escape/secret.md" });
  ok(isErr(leak) && !fs.existsSync(path.join(dir, "out", "leak.eml")), "doc-email: template symlink escape rejected");
  await fsp.rm(outside, { recursive: true, force: true });

  const subj = await c.call("create_eml", { path: "out/uni.eml", subject: "Ünïcode 差", body: "hi" });
  ok(!isErr(subj) && fs.readFileSync(path.join(dir, "out", "uni.eml"), "utf8").includes("=?UTF-8?B?"), "doc-email: RFC 2047 subject encoding");
  c.stop();
}

// ================= doc-pdf =================
{
  const dir = mkProject();
  const c = client("doc-pdf", dir);
  await c.init();
  const list = await c.list();
  ok(list.result.tools.length === 1, "doc-pdf: tool listed");

  const blocks = [];
  for (let i = 1; i <= 60; i++) blocks.push({ type: "p", text: `Paragraph ${i}: The quick brown fox jumps over the lazy dog repeatedly to force wrapping across several lines. `.repeat(2) });
  const r = await c.call("create_pdf", { path: "out/report.pdf", title: "Annual Report", blocks });
  ok(!isErr(r), "doc-pdf: generation ok");
  const pdf = fs.readFileSync(path.join(dir, "out", "report.pdf"));
  const s = pdf.toString("latin1");
  ok(s.startsWith("%PDF-1.4"), "doc-pdf: header");
  ok(s.includes("/Type /Catalog") && s.includes("/Type /Pages"), "doc-pdf: catalog + pages tree");
  const pageObjs = (s.match(/\/Type \/Page[^s]/g) ?? []).length;
  ok(pageObjs >= 2, `doc-pdf: paginated (${pageObjs} pages)`);
  ok(s.includes("/BaseFont /Helvetica-Bold"), "doc-pdf: heading font");
  ok(s.trimEnd().endsWith("%%EOF"), "doc-pdf: EOF marker");
  ok(/\bstartxref\s+\d+/.test(s), "doc-pdf: xref offset present");
  // xref offsets actually point at "N 0 obj"
  const xrefPos = s.indexOf("startxref");
  const off = parseInt(s.slice(xrefPos + 9).trim(), 10);
  ok(s.slice(off, off + 4) === "xref", "doc-pdf: startxref points at the xref table");

  const evil = await c.call("create_pdf", { path: "../evil.pdf", blocks: [{ type: "p", text: "x" }] });
  ok(isErr(evil), "doc-pdf: traversal path refused");
  const bad = await c.call("create_pdf", { path: "out/x.txt", blocks: [{ type: "p", text: "x" }] });
  ok(isErr(bad), "doc-pdf: extension enforced");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-pdf-outside-"));
  fs.symlinkSync(outside, path.join(dir, "escape"), "dir");
  const symlinkWrite = await c.call("create_pdf", { path: "escape/escaped.pdf", blocks: [{ type: "p", text: "nope" }] });
  ok(isErr(symlinkWrite) && !fs.existsSync(path.join(outside, "escaped.pdf")), "doc-pdf: symlink escape rejected");
  await fsp.rm(outside, { recursive: true, force: true });
  c.stop();
}

// ================= doc-spreadsheets =================
{
  const dir = mkProject();
  const c = client("doc-spreadsheets", dir);
  await c.init();
  const list = await c.list();
  ok(list.result.tools.length === 2, "doc-spreadsheets: 2 tools listed");

  const r = await c.call("create_xlsx", {
    path: "out/budget.xlsx",
    sheets: [
      { name: "Budget", rows: [["Item", "Qty", "Cost"], ["Widgets", 12, 3.5], ["Gadgets", 4, 19.99]] },
      { name: "Notes", rows: [["Prepared by XtracsysCode"]] },
    ],
  });
  ok(!isErr(r), "doc-spreadsheets: xlsx generated");
  const zip = zipEntries(fs.readFileSync(path.join(dir, "out", "budget.xlsx")));
  ok(!!zip["[Content_Types].xml"] && !!zip["xl/workbook.xml"], "doc-spreadsheets: OOXML parts present");
  ok(!!zip["xl/worksheets/sheet1.xml"] && !!zip["xl/worksheets/sheet2.xml"], "doc-spreadsheets: both sheets present");
  ok(xmlOk(zip["xl/workbook.xml"].toString()) && xmlOk(zip["xl/worksheets/sheet1.xml"].toString()), "doc-spreadsheets: sheet XML well-formed");
  ok(zip["xl/worksheets/sheet1.xml"].toString().includes('t="inlineStr"') && zip["xl/worksheets/sheet1.xml"].toString().includes("<v>3.5</v>"), "doc-spreadsheets: strings + numbers encoded");

  const csv = await c.call("create_csv", { path: "out/data.csv", rows: [["a", 'b,"c"', "d"], ["1", 2, "x\ny"]] });
  ok(!isErr(csv), "doc-spreadsheets: csv generated");
  const csvText = fs.readFileSync(path.join(dir, "out", "data.csv"), "utf8");
  ok(csvText.includes('"b,""c"""') && csvText.includes('"x\ny"'), "doc-spreadsheets: RFC 4180 quoting");
  const formula = await c.call("create_csv", { path: "out/formula.csv", rows: [["=1+1"], [" +SUM(1,2)"], ["safe"]] });
  const formulaText = fs.readFileSync(path.join(dir, "out", "formula.csv"), "utf8");
  ok(!isErr(formula) && formulaText.includes("'=1+1") && formulaText.includes("' +SUM") && formulaText.includes("safe"), "doc-spreadsheets: CSV formula-leading cells escaped");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-xlsx-outside-"));
  fs.symlinkSync(outside, path.join(dir, "escape"), "dir");
  const symlinkWrite = await c.call("create_xlsx", { path: "escape/escaped.xlsx", sheets: [{ name: "Data", rows: [["x"]] }] });
  ok(isErr(symlinkWrite) && !fs.existsSync(path.join(outside, "escaped.xlsx")), "doc-spreadsheets: xlsx symlink escape rejected");
  await fsp.rm(outside, { recursive: true, force: true });
  c.stop();
}

// ================= doc-presentations =================
{
  const dir = mkProject();
  const c = client("doc-presentations", dir);
  await c.init();
  const list = await c.list();
  ok(list.result.tools.length === 1, "doc-presentations: tool listed");

  const r = await c.call("create_pptx", {
    path: "out/deck.pptx",
    slides: [
      { title: "Kickoff", bullets: ["Welcome", "Agenda", "Goals"] },
      { title: "Status", bullets: ["On track", "Risks low"] },
      { title: "Q&A" },
    ],
  });
  ok(!isErr(r), "doc-presentations: deck generated");
  const zip = zipEntries(fs.readFileSync(path.join(dir, "out", "deck.pptx")));
  for (const part of ["ppt/presentation.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml", "ppt/theme/theme1.xml", "ppt/slides/slide1.xml", "ppt/slides/slide3.xml"]) {
    ok(!!zip[part], `doc-presentations: ${part} present`);
  }
  ok(xmlOk(zip["ppt/presentation.xml"].toString()) && xmlOk(zip["ppt/slides/slide1.xml"].toString()) && xmlOk(zip["ppt/slideMasters/slideMaster1.xml"].toString()), "doc-presentations: XML well-formed");
  ok(zip["ppt/presentation.xml"].toString().includes('r:id="rId4"'), "doc-presentations: 3 slides registered");
  ok(zip["ppt/slides/slide1.xml"].toString().includes("Kickoff") && zip["ppt/slides/slide1.xml"].toString().includes("Agenda"), "doc-presentations: slide content present");

  const empty = await c.call("create_pptx", { path: "out/empty.pptx", slides: [] });
  ok(isErr(empty), "doc-presentations: empty deck rejected");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-pptx-outside-"));
  fs.symlinkSync(outside, path.join(dir, "escape"), "dir");
  const symlinkWrite = await c.call("create_pptx", { path: "escape/escaped.pptx", slides: [{ title: "Nope" }] });
  ok(isErr(symlinkWrite) && !fs.existsSync(path.join(outside, "escaped.pptx")), "doc-presentations: symlink escape rejected");
  await fsp.rm(outside, { recursive: true, force: true });
  c.stop();
}

// cleanup temp projects
for (const d of await fsp.readdir(os.tmpdir())) {
  if (d.startsWith("xtrac-doctools-")) await fsp.rm(path.join(os.tmpdir(), d), { recursive: true, force: true });
}

console.log(`\ndoc-plugins.test: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
