import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type UIEvent } from "react";
import type { ChatRecord, TimelineItem } from "../types";
import { TimelineRow } from "./timeline/TimelineRow";

interface Props {
  items: TimelineItem[];
  chat: ChatRecord | null;
  ready: boolean;
  models: string[];
  ctx: { numCtx: number; budgetChars: number };
  composerHeight?: number;
  onComposerResize?: (h: number) => void;
  onSend: (text: string, images?: string[]) => void;
  onCancel: () => void;
  onRetry?: () => void;
  onNewChat: () => void;
  onToggleApproval?: (mode: "ask" | "auto") => void;
  onSwitchModel?: (model: string) => void;
}

export function Chat({ items, chat, ready, models, ctx, composerHeight, onComposerResize, onSend, onCancel, onRetry, onNewChat, onToggleApproval, onSwitchModel }: Props) {
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const [attachments, setAttachments] = useState<{ name: string; data: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streaming = chat?.status === "running";
  const disabled = !ready || !chat;

  useEffect(() => {
    if (!stickToBottom.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, streaming, chat?.id]);

  useEffect(() => {
    stickToBottom.current = true;
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }));
  }, [chat?.id]);

  useEffect(() => {
    if (chat && ready && !streaming) textareaRef.current?.focus();
  }, [chat?.id, ready, streaming, chat]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    // While streaming, submit queues the message (N6); otherwise it starts a turn.
    if (!t || disabled) return;
    stickToBottom.current = true;
    onSend(t, attachments.length > 0 ? attachments.map((a) => a.data) : undefined);
    setText("");
    setAttachments([]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const addImageFiles = (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(f.type)) continue;
      if (f.size > 5 * 1024 * 1024) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = String(reader.result ?? "").replace(/^data:[^;]+;base64,/, "");
        if (b64) setAttachments((prev) => (prev.length >= 4 ? prev : [...prev, { name: f.name || "pasted-image", data: b64 }]));
      };
      reader.readAsDataURL(f);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const liveThoughtId = (() => {
    if (!streaming) return null;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === "thought") return it.id;
      if (it.kind === "assistant" || it.kind === "tool" || it.kind === "user") break;
    }
    return null;
  })();

  return (
    <div className="chat">
      <div className="timeline" onScroll={onScroll} key={chat?.id ?? "none"}>
        {!chat && (
          <div className="empty">
            <p className="empty-title">No chat selected</p>
            <p className="hint">
              Create a chat under a project from the sidebar. Everything runs locally on Ollama / llama.cpp.
            </p>
            {onNewChat && (
              <button type="button" className="btn primary" onClick={onNewChat}>
                New chat
              </button>
            )}
          </div>
        )}

        {chat && items.length === 0 && !streaming && (
          <div className="empty">
            <p className="empty-title">Ready</p>
            <p className="hint">
              Working dir: <code>{chat.cwd}</code>
              <br />
              Model: <code>{chat.model || "auto"}</code> · Approval: <b>{chat.approvalMode}</b>
              <br />
              <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline
            </p>
          </div>
        )}

        {chat &&
          items.map((item) => (
            <TimelineRow key={item.id} item={item} isLiveThought={item.kind === "thought" && item.id === liveThoughtId} />
          ))}

        {streaming && (
          <div className="streaming-indicator" aria-live="polite">
            <span className="pulse-dot" />
            Working…
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="composer-stack">
        {onComposerResize && (
          <div
            className="resize-handle-h"
            title="Drag to resize composer"
            onPointerDown={(e) => {
              e.preventDefault();
              const bottom = e.currentTarget.parentElement!.getBoundingClientRect().bottom;
              const move = (ev: PointerEvent) => onComposerResize(Math.round(bottom - ev.clientY));
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            onDoubleClick={() => onComposerResize(160)}
          />
        )}
        {attachments.length > 0 && (
          <div className="attachment-row">
            {attachments.map((a, i) => (
              <span className="attachment-chip" key={`${a.name}-${i}`}>
                🖼 {a.name.slice(0, 24)}
                <button type="button" className="icon-btn danger" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {chat && onToggleApproval && (
          <div className="usage-strip">
            <span className="usage-pill" title="Ask before file writes and shell commands">
              {chat.approvalMode === "ask" ? "🛡 Approvals: ask" : "⚡ Approvals: auto"}
            </span>
            <button type="button" className="btn ghost tiny" onClick={() => onToggleApproval(chat.approvalMode === "ask" ? "auto" : "ask")}>
              Switch to {chat.approvalMode === "ask" ? "auto" : "ask"}
            </button>
            <span className="usage-sep">·</span>
            <span className="usage-pill" title="Model for this chat — switch any time">
              {onSwitchModel ? (
                <select
                  className="model-select"
                  value={chat.model ?? ""}
                  disabled={streaming}
                  onChange={(e) => onSwitchModel(e.target.value)}
                  aria-label="Model for this chat"
                >
                  {!(chat.model ?? "") && <option value="">model: auto</option>}
                  {!models.includes(chat.model ?? "") && (chat.model ?? "") !== "" && (
                    <option value={chat.model}>{chat.model}</option>
                  )}
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                (chat.model || "model: auto")
              )}
            </span>
            <span className="usage-sep">·</span>
            {!!chat.instructionsChars && (
              <span className="usage-pill" title="Project instructions (.xtracsys.md / AGENTS.md) are loaded into the agent's system prompt">
                📋 instructions ({chat.instructionsChars} chars)
              </span>
            )}
            <span className="usage-sep">·</span>
            {chat.plan && chat.plan.length > 0 && (
              <span className="usage-pill" title="Plan progress (agent's todo list — see Settings → Plan)">
                ☑ plan {chat.plan.filter((e) => e.status === "done").length}/{chat.plan.length}
              </span>
            )}
            {!!chat.selectedSkills?.length && (
              <span
                className="usage-pill"
                title={`Skills attached this chat (full instructions load each turn): ${chat.selectedSkills.join(", ")}. Toggle with /skill <id>.`}
              >
                📚 {chat.selectedSkills.length} skill{chat.selectedSkills.length === 1 ? "" : "s"}
              </span>
            )}
            <span className="usage-sep">·</span>
            <ContextMeter chat={chat} ctx={ctx} />
            <span className="usage-sep">·</span>
            <span className="usage-pill" title="Turns / tokens used in this chat">
              {chat.stats?.turns ?? 0} turns
            </span>
          </div>
        )}
        <form className="composer" onSubmit={submit}>
          <div className="composer-row">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addImageFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn ghost attach-btn"
              title="Attach images (vision models)"
              disabled={disabled || attachments.length >= 4}
              onClick={() => fileInputRef.current?.click()}
            >
              🖼
            </button>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files ?? []).filter((f) => f.type.startsWith("image/"));
                if (files.length > 0) {
                  e.preventDefault();
                  addImageFiles(files);
                }
              }}
              placeholder={
                !chat
                  ? "Create or select a chat…"
                  : streaming
                    ? "Streaming… (Cancel to stop, Queue to add a follow-up)"
                    : "Describe a task — the agent can read, write, search, and run commands."
              }
              rows={3}
              style={composerHeight ? { height: composerHeight, minHeight: 60 } : undefined}
              disabled={disabled && !streaming}
              aria-label="Message composer"
            />
          </div>
          <div className="composer-actions">
            <button
              type="button"
              className="btn ghost small"
              title="Expand composer (Esc to close)"
              disabled={disabled && !streaming}
              onClick={() => setFocus(true)}
            >
              ⤢ Focus
            </button>
            <span className="composer-hint">
              {streaming ? (
                <>Queues after the current turn</>
              ) : (
                <>
                  <kbd>Enter</kbd> send · <kbd>⇧Enter</kbd> newline
                </>
              )}
            </span>
            {!streaming && onRetry && items.length > 0 && items[items.length - 1].kind === "error" && (
              <button type="button" className="btn ghost" onClick={onRetry} title="Re-run the last prompt from scratch">
                ↻ Retry
              </button>
            )}
            {streaming ? (
              <>
                <button type="button" className="btn danger" onClick={onCancel}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={disabled || !text.trim()}>
                  Queue
                </button>
              </>
            ) : (
              <button type="submit" className="btn primary" disabled={disabled || !text.trim()}>
                Send
              </button>
            )}
          </div>
        </form>

        {focus && (
          <div className="modal-backdrop" onClick={() => setFocus(false)}>
            <div className="modal-card focus-modal" onClick={(e) => e.stopPropagation()}>
              <h3>
                Focus {chat ? <span className="muted">· {chat.title}</span> : null}
                <span className="composer-hint" style={{ marginLeft: 12 }}>
                  {text.length} chars · {attachments.length} image(s) · Esc to close
                </span>
              </h3>
              <textarea
                autoFocus
                className="focus-textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setFocus(false);
                  } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={streaming ? "Streaming… (Queue to add a follow-up)" : "Describe a task…"}
                aria-label="Focus composer"
              />
              <div className="composer-actions">
                <span className="composer-hint">
                  <kbd>Enter</kbd> send · <kbd>⇧Enter</kbd> newline
                </span>
                {streaming ? (
                  <>
                    <button type="button" className="btn danger" onClick={onCancel}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!text.trim()}
                      onClick={() => {
                        onSend(text, attachments.length > 0 ? attachments.map((a) => a.data) : undefined);
                        setText("");
                        setAttachments([]);
                        setFocus(false);
                      }}
                    >
                      Queue
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!text.trim()}
                    onClick={() => {
                      onSend(text, attachments.length > 0 ? attachments.map((a) => a.data) : undefined);
                      setText("");
                      setAttachments([]);
                      setFocus(false);
                    }}
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ContextMeter({ chat, ctx }: { chat: ChatRecord; ctx: { numCtx: number; budgetChars: number } }) {
  const used = chat.stats?.lastInputTokens ?? 0;
  const denom = ctx.numCtx > 0 ? ctx.numCtx : Math.max(1, Math.round(ctx.budgetChars / 4));
  const pct = Math.min(100, Math.round((used / denom) * 100));
  const tone = pct >= 90 ? "crit" : pct >= 70 ? "warn" : "ok";
  const label = ctx.numCtx > 0 ? `ctx ${pct}% of ${ctx.numCtx}` : `ctx ~${pct}% (est)`;
  return (
    <span className={`usage-pill ctx-meter tone-${tone}`} title={`Context window usage — last turn used ~${used} tokens of ~${denom}. Amber ≥70%, red ≥90%.`}>
      <span className="ctx-meter-bar">
        <span className="ctx-meter-fill" style={{ width: `${pct}%` }} />
      </span>
      {label}
    </span>
  );
}
