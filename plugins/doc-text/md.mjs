/**
 * Minimal Markdown → HTML converter shared by the Document Kit plugins.
 * Supports: h1–h4, paragraphs, bullet/numbered lists, bold/italic/inline code,
 * links, fenced code blocks, blockquotes, tables, horizontal rules.
 * Escapes HTML first — content is untrusted.
 */

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(md) {
  let s = esc(md);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, rawUrl) => {
    const url = String(rawUrl).replace(/&amp;/g, "&");
    if (/^(?:https?:|mailto:)/i.test(url) || /^(?:#[^\s]*|\/[^/][^\s]*|\.\.?\/[^\s]*)$/.test(url)) {
      return `<a href="${esc(url)}">${label}</a>`;
    }
    return label;
  });
  return s;
}

export function htmlFromMarkdown(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null; // "ul" | "ol"
  let code = null;
  let quote = false;
  let table = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const closeQuote = () => {
    if (quote) out.push("</blockquote>");
    quote = false;
  };
  const closeTable = () => {
    if (table) {
      const [head, ...rows] = table;
      out.push("<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
      for (const r of rows) out.push("<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      out.push("</tbody></table>");
      table = null;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (code !== null) {
      if (/^```/.test(line)) {
        out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
        code = null;
      } else code.push(raw);
      continue;
    }
    if (/^```/.test(line)) {
      flushPara();
      closeList();
      closeQuote();
      closeTable();
      code = [];
      continue;
    }
    if (/^\s*\|(.+)\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
      flushPara();
      closeList();
      closeQuote();
      if (!table) table = [cells];
      else table.push(cells);
      continue;
    }
    closeTable();
    if (!line.trim()) {
      flushPara();
      closeList();
      closeQuote();
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      closeQuote();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushPara();
      closeList();
      closeQuote();
      out.push("<hr>");
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      closeQuote();
      const want = ul ? "ul" : "ol";
      if (list !== want) {
        closeList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inline((ul ?? ol)[1])}</li>`);
      continue;
    }
    closeList();
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushPara();
      if (!quote) {
        out.push("<blockquote>");
        quote = true;
      }
      out.push(`<p>${inline(bq[1])}</p>`);
      continue;
    }
    closeQuote();
    para.push(line.trim());
  }
  flushPara();
  closeList();
  closeQuote();
  closeTable();
  if (code !== null) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  return out.join("\n");
}
