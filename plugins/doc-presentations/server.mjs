#!/usr/bin/env node
/**
 * Document Kit: Presentations — XtracsysCode stdio MCP plugin.
 * Tool: create_pptx — builds a real PowerPoint .pptx (Office Open XML) with
 * title+bullet slides. The ZIP container is hand-rolled (store method + CRC-32);
 * the OOXML part set is the minimal one PowerPoint/Keynote/LibreOffice accept:
 * presentation.xml, slide master + layout + theme, one slide per entry.
 * Pure Node, no dependencies, no network. Writes only inside the project folder.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const PROTOCOL_VERSION = "2024-11-05";
const MAX_SLIDES = 100;
const MAX_BULLETS = 12;

const tools = [
  {
    name: "create_pptx",
    description:
      "Create a PowerPoint deck (.pptx) in the project folder: one slide per entry with a title and up to 12 bullets. Use for briefings, talks, status decks.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Output path relative to the project root, e.g. decks/kickoff.pptx (ends in .pptx)" },
        slides: {
          type: "array",
          description: "Slides in order",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Slide title" },
              bullets: { type: "array", items: { type: "string" }, description: "Up to 12 short bullets" },
            },
            required: ["title"],
          },
        },
      },
      required: ["path", "slides"],
    },
  },
];

// ---------- minimal ZIP (store method) — same format as the spreadsheets kit ----------
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
function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => Buffer.from([v & 255, (v >> 8) & 255]);
  const u32 = (v) => Buffer.from([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(content, { level: 9 });
    const useDeflate = deflated.length < content.length;
    const data = useDeflate ? deflated : content;
    const crc = crc32(content);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(useDeflate ? 8 : 0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(content.length), u16(nameBuf.length), u16(0), nameBuf,
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

// ---------- OOXML ----------
const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function slideXml(slide) {
  const bullets = (slide.bullets ?? []).slice(0, MAX_BULLETS);
  const paras = bullets
    .map((b) => `<a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US" sz="1800" dirty="0"/><a:t>${x(String(b))}</a:t></a:r></a:p>`)
    .join("");
  const emptyBody = `<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="7315200" cy="1325563"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${x(String(slide.title ?? "Untitled"))}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="7315200" cy="4123513"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paras || emptyBody}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function masterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="7315200" cy="1325563"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="7315200" cy="4123513"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMap><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
}

function layoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="obj" preserve="1"><p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="7315200" cy="1325563"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="7315200" cy="4123513"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function themeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Xtracsys"><a:themeElements><a:clrScheme name="Xtracsys"><a:dk1><a:srgbClr val="1A1A1A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="222226"/></a:dk2><a:lt2><a:srgbClr val="EFEDE6"/></a:lt2><a:accent1><a:srgbClr val="E0784F"/></a:accent1><a:accent2><a:srgbClr val="6BBF74"/></a:accent2><a:accent3><a:srgbClr val="5B8DD9"/></a:accent3><a:accent4><a:srgbClr val="D9A441"/></a:accent4><a:accent5><a:srgbClr val="9A6BD9"/></a:accent5><a:accent6><a:srgbClr val="4FB8B0"/></a:accent6><a:hlink><a:srgbClr val="C2571F"/></a:hlink><a:folHlink><a:srgbClr val="8A93A5"/></a:folHlink></a:clrScheme><a:fontScheme name="Xtracsys"><a:majorFont><a:latin typeface="Helvetica"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Helvetica"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Xtracsys"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function buildPptx(slides) {
  const files = {};
  const sldIds = slides
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`)
    .join("");
  const presRels =
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${slides.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`;
  files["[Content_Types].xml"] = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`,
  );
  files["_rels/.rels"] = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  files["ppt/presentation.xml"] = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  files["ppt/_rels/presentation.xml.rels"] = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels}</Relationships>`,
  );
  files["ppt/slideMasters/slideMaster1.xml"] = Buffer.from(masterXml());
  files["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  files["ppt/slideLayouts/slideLayout1.xml"] = Buffer.from(layoutXml());
  files["ppt/slideLayouts/_rels/slideLayout1.xml.rels"] = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  files["ppt/theme/theme1.xml"] = Buffer.from(themeXml());
  slides.forEach((s, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = Buffer.from(slideXml(s));
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    );
  });
  return makeZip(files);
}

function callTool(name, a) {
  if (name !== "create_pptx") throw new Error(`Unknown tool: ${name}`);
  const slides = (Array.isArray(a.slides) ? a.slides : []).map((s) => ({
    title: String(s?.title ?? "Untitled").slice(0, 200),
    bullets: Array.isArray(s?.bullets) ? s.bullets.map((b) => String(b).slice(0, 500)) : [],
  }));
  if (slides.length === 0) throw new Error("At least one slide is required.");
  if (slides.length > MAX_SLIDES) throw new Error(`Too many slides (max ${MAX_SLIDES}).`);
  const buf = buildPptx(slides);
  const cwd = fs.realpathSync(process.cwd());
  const full = path.resolve(cwd, String(a.path ?? ""));
  if (full === cwd || !full.startsWith(cwd + path.sep)) throw new Error("Refused: output path is outside the project folder.");
  if (path.extname(full).toLowerCase() !== ".pptx") throw new Error("Output must end in .pptx.");
  assertContainedParent(cwd, full);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  assertContainedParent(cwd, full);
  fs.writeFileSync(full, buf);
  return `Wrote ${path.relative(cwd, full)} (${(buf.length / 1024).toFixed(1)} KB, ${slides.length} slide(s))`;
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
        result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "doc-presentations", version: "1.0.0" } },
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
