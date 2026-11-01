import { memo, useState } from "react";
import type { TimelineItem } from "../../../../shared/timelineModel";
import { ThoughtBlock } from "./ThoughtBlock";
import { ToolCard } from "./ToolCard";
import { renderMarkdown } from "../../lib/format";

// Streaming re-renders the whole timeline per text-delta; a pathological model
// response would otherwise re-run markdown parsing over unbounded text every frame.
const MAX_RENDERED_ASSISTANT_CHARS = 50_000;

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="tl-copy"
      title="Copy message text"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "✓" : "⧉"}
    </button>
  );
}

function AssistantBody({ text }: { text: string }) {
  const html =
    text.length > MAX_RENDERED_ASSISTANT_CHARS
      ? renderMarkdown(text.slice(0, MAX_RENDERED_ASSISTANT_CHARS)) +
        `<p class="muted">… [message truncated for display at ${MAX_RENDERED_ASSISTANT_CHARS} characters — full text is kept in the transcript]</p>`
      : renderMarkdown(text);
  return <div className="tl-body md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function TimelineRowImpl({ item, isLiveThought }: { item: TimelineItem; isLiveThought?: boolean }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="tl-row user">
          <div className="tl-bubble user">
            <div className="tl-label">
              You <CopyBtn text={item.text} />
            </div>
            <div className="tl-body">
              {item.imageCount ? <div className="muted">📎 {item.imageCount} image{item.imageCount > 1 ? "s" : ""} attached</div> : null}
              {item.text}
            </div>
          </div>
        </div>
      );

    case "assistant":
      return (
        <div className="tl-row assistant">
          <div className="tl-bubble assistant">
            <div className="tl-label">
              XtracsysCode <CopyBtn text={item.text} />
            </div>
            <AssistantBody text={item.text} />
          </div>
        </div>
      );

    case "thought":
      return (
        <div className="tl-row thought">
          <ThoughtBlock text={item.text} live={isLiveThought} />
        </div>
      );

    case "tool":
      return (
        <div className="tl-row tool">
          <ToolCard item={item} />
        </div>
      );

    case "error":
      return (
        <div className="tl-row system">
          <div className="tl-bubble system">
            <div className="tl-body">⚠️ {item.text}</div>
          </div>
        </div>
      );

    case "system":
      return (
        <div className="tl-row system">
          <div className="tl-bubble system">
            <div className="tl-body">ℹ️ {item.text}</div>
          </div>
        </div>
      );
  }
}

// Memoized: timeline item objects are reused between streaming updates, so only the
// row that actually changed re-renders (and re-parses its markdown).
export const TimelineRow = memo(TimelineRowImpl);
