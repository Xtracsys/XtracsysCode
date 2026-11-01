import { useMemo, useState } from "react";
import type { TimelineItem } from "../../../../shared/timelineModel";

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;

const ICONS: Record<string, string> = {
  list_dir: "📂",
  read_file: "📖",
  write_file: "✎",
  edit_file: "✎",
  run_command: "▶",
  grep: "⌕",
};

/** Lightweight unified diff preview for write/edit tools. */
function renderSimpleDiff(oldText: string, newText: string): { line: string; type: "add" | "del" | "ctx" }[] {
  const oldLines = oldText === "" ? [] : oldText.split("\n");
  const newLines = newText === "" ? [] : newText.split("\n");
  // If identical length and short, show line-by-line; else show both blocks.
  if (oldLines.length === newLines.length && oldLines.length <= 40) {
    const out: { line: string; type: "add" | "del" | "ctx" }[] = [];
    for (let i = 0; i < oldLines.length; i++) {
      if (oldLines[i] === newLines[i]) out.push({ line: `  ${oldLines[i]}`, type: "ctx" });
      else {
        out.push({ line: `- ${oldLines[i]}`, type: "del" });
        out.push({ line: `+ ${newLines[i]}`, type: "add" });
      }
    }
    return out;
  }
  return [
    ...oldLines.map((l): { line: string; type: "add" | "del" | "ctx" } => ({ line: `- ${l}`, type: "del" })),
    ...newLines.map((l): { line: string; type: "add" | "del" | "ctx" } => ({ line: `+ ${l}`, type: "add" })),
  ];
}

export function ToolCard({ item }: { item: ToolItem }) {
  const tone = item.status === "running" ? "running" : item.status === "ok" ? "ok" : "fail";
  const hasDetails = !!item.output || !!item.diff;
  const [open, setOpen] = useState(item.status === "fail" || (item.status === "running" && item.name === "run_command"));

  const output = useMemo(() => item.output ?? "", [item.output]);
  const diffLines = useMemo(
    () => (item.diff ? renderSimpleDiff(item.diff.oldText, item.diff.newText) : []),
    [item.diff],
  );

  return (
    <div className={`tl-tool tone-${tone} ${open ? "open" : ""}`}>
      <button
        type="button"
        className="tl-tool-header"
        onClick={() => hasDetails && setOpen((v) => !v)}
        disabled={!hasDetails}
        aria-expanded={open}
      >
        <span className="tl-tool-kind" title={item.name}>
          {ICONS[item.name] ?? "⚙"}
        </span>
        <div className="tl-tool-meta">
          <div className="tl-tool-title">{item.title}</div>
          <div className="tl-tool-sub">
            <span className={`tl-status tone-${tone}`}>{item.status === "running" ? "running" : item.status}</span>
            {item.diff && <code className="tl-tool-kind-label">{item.diff.path}</code>}
            {!item.diff && item.argsSummary && <code className="tl-tool-kind-label">{item.argsSummary.slice(0, 120)}</code>}
          </div>
        </div>
        {hasDetails && <span className="tl-chevron">{open ? "▾" : "▸"}</span>}
      </button>

      {open && hasDetails && (
        <div className="tl-tool-body">
          {diffLines.length > 0 && (
            <div className="tl-tool-section">
              <div className="tl-section-label">Diff · {item.diff?.path}</div>
              <pre className="tl-code diff">
                {diffLines.map((d, i) => (
                  <span key={i} className={`patch-${d.type}`}>
                    {d.line}
                    {"\n"}
                  </span>
                ))}
              </pre>
            </div>
          )}
          {output && (
            <div className="tl-tool-section">
              <div className="tl-section-label">Output</div>
              <pre className="tl-code">{output.slice(0, 12000)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
