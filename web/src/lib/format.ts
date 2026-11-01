/** Small formatting + markdown helpers (local only, no external deps beyond marked). */
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function trustedLink(href: string): string | null {
  try {
    const url = new URL(href);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Escape raw HTML and emit links only for explicitly supported HTTP(S) destinations. */
export function renderMarkdown(text: string): string {
  if (!text) return "";
  const renderer = new marked.Renderer();
  renderer.html = ({ text: htmlText }) => escapeHtml(htmlText);
  // The link label must never be interpolated raw: marked's token `text` is the
  // unescaped source, so route it through parseInline (which honors the escaping
  // html/image/link overrides above) and fall back to escaping when unavailable.
  renderer.link = function ({ href, title, tokens, text: linkText }) {
    const label = tokens && this.parser ? this.parser.parseInline(tokens) : escapeHtml(linkText);
    const safeHref = trustedLink(href);
    if (!safeHref) return label;
    const titleAttr = title ? ` title=\"${escapeHtml(title)}\"` : "";
    return `<a href=\"${escapeHtml(safeHref)}\"${titleAttr} rel=\"noopener noreferrer\">${label}</a>`;
  };
  renderer.image = ({ text: alt }) => escapeHtml(alt);
  return marked.parse(text, { renderer }) as string;
}

export function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
