import { useEffect, useState } from "react";
import { truncate } from "../../lib/format";

export function ThoughtBlock({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(!!live);

  useEffect(() => {
    if (live) setOpen(true);
  }, [live]);

  const preview = truncate(text, 100) || "Thinking…";

  return (
    <div className={`tl-thought ${live ? "live" : ""} ${open ? "open" : "collapsed"}`}>
      <button type="button" className="tl-thought-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="tl-chevron">{open ? "▾" : "▸"}</span>
        <span className="tl-thought-label">
          {live ? "Thinking" : "Thought"}
          {live && <span className="pulse-dot sm" />}
        </span>
        {!open && <span className="tl-thought-preview">{preview}</span>}
      </button>
      {open && <div className="tl-thought-body">{text || "…"}</div>}
    </div>
  );
}
