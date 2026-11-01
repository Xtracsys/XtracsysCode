/**
 * Shared timeline model — used by the Electron main process (for persisted chat
 * transcripts) and by the React renderer (for live streaming updates).
 * Pure data + pure functions; safe to import from either side.
 */

export type ToolDiff = { path: string; oldText: string; newText: string };

export type PlanStatus = "pending" | "in_progress" | "done";

export interface PlanEntry {
  content: string;
  status: PlanStatus;
}

export type TimelineItem =
  | { kind: "user"; id: string; text: string; ts?: number; imageCount?: number }
  | { kind: "assistant"; id: string; text: string; streaming?: boolean; ts?: number }
  | { kind: "thought"; id: string; text: string; open?: boolean }
  | {
      kind: "tool";
      id: string;
      toolCallId: string;
      name: string;
      title: string;
      status: "running" | "ok" | "fail";
      argsSummary: string;
      output?: string;
      diff?: ToolDiff;
    }
  | { kind: "error"; id: string; text: string }
  | { kind: "system"; id: string; text: string };

/** AgentEvent shape mirrors electron/agent/types.ts AgentEvent (duplicated as a structal copy to stay dependency-free). */
export type SharedAgentEvent =
  | { type: "turn-start"; chatId: string; turnId: string; text: string; imageCount?: number }
  | { type: "text-delta"; chatId: string; turnId: string; delta: string }
  | { type: "thought-delta"; chatId: string; turnId: string; delta: string }
  | { type: "thought-end"; chatId: string; turnId: string }
  | { type: "tool-start"; chatId: string; turnId: string; toolCallId: string; name: string; args: Record<string, unknown> }
  | { type: "tool-end"; chatId: string; turnId: string; toolCallId: string; ok: boolean; output: string; diff?: { path: string; oldText: string; newText: string } }
  | { type: "plan"; chatId: string; turnId: string; entries: PlanEntry[] }
  | { type: "tool-output"; chatId: string; turnId: string; toolCallId: string; chunk: string }
  | { type: "notice"; chatId: string; text: string }
  | { type: "chat-rewound"; chatId: string; timeline: TimelineItem[] }
  | { type: "turn-end"; chatId: string; turnId: string; stopReason: string }
  | { type: "turn-error"; chatId: string; turnId: string; message: string }
  | { type: "step-start"; chatId: string; turnId: string; step: number };

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function argsSummary(name: string, args: Record<string, unknown>): string {
  const a = args ?? {};
  if (name === "run_command") return String(a.command ?? "");
  if (name === "write_file") return String(a.path ?? "");
  if (name === "edit_file") return `${String(a.path ?? "")} (replace ${String(a.oldText ?? "").length} chars)`;
  if (name === "read_file") return String(a.path ?? "");
  if (name === "list_dir") return String(a.path ?? ".");
  if (name === "grep") return String(a.pattern ?? "");
  try {
    return JSON.stringify(a).slice(0, 160);
  } catch {
    return "";
  }
}

export function toolTitle(name: string): string {
  switch (name) {
    case "list_dir":
      return "List directory";
    case "read_file":
      return "Read file";
    case "write_file":
      return "Write file";
    case "edit_file":
      return "Edit file";
    case "run_command":
      return "Run command";
    case "grep":
      return "Search";
    default:
      return name;
  }
}

/**
 * Apply one streaming event to the timeline, mutating the array in place.
 * Used live by the renderer; main persists the resulting items on turn end.
 */
export function applyEventToTimeline(items: TimelineItem[], ev: SharedAgentEvent): void {
  const last = items.length > 0 ? items[items.length - 1] : undefined;
  switch (ev.type) {
    case "turn-start": {
      items.push({ kind: "user", id: uid("u"), text: ev.text, imageCount: ev.imageCount });
      break;
    }
    case "text-delta": {
      if (last && last.kind === "assistant" && last.streaming) {
        last.text += ev.delta;
      } else {
        items.push({ kind: "assistant", id: uid("a"), text: ev.delta, streaming: true });
      }
      break;
    }
    case "thought-delta": {
      if (last && last.kind === "thought" && last.open) {
        last.text += ev.delta;
      } else {
        items.push({ kind: "thought", id: uid("t"), text: ev.delta, open: true });
      }
      break;
    }
    case "thought-end": {
      if (last && last.kind === "thought") {
        last.open = false;
        if (!last.text.trim()) items.pop();
      }
      break;
    }
    case "tool-start": {
      items.push({
        kind: "tool",
        id: uid("tl"),
        toolCallId: ev.toolCallId,
        name: ev.name,
        title: toolTitle(ev.name),
        status: "running",
        argsSummary: argsSummary(ev.name, ev.args),
      });
      break;
    }
    case "tool-end": {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === "tool" && it.toolCallId === ev.toolCallId) {
          it.status = ev.ok ? "ok" : "fail";
          it.output = ev.output;
          if (ev.diff) it.diff = ev.diff;
          break;
        }
      }
      break;
    }
    case "tool-output": {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === "tool" && it.toolCallId === ev.toolCallId) {
          // Live tail while running; capped so long builds don't balloon the transcript.
          const tail = ((it.output ?? "") + ev.chunk).slice(-24_000);
          it.output = tail;
          break;
        }
      }
      break;
    }
    case "notice": {
      items.push({ kind: "system", id: uid("s"), text: ev.text });
      break;
    }
    case "plan":
      // The plan lives on the chat record (chat.plan); the renderer updates it from the event.
      break;
    case "turn-error": {
      items.push({ kind: "error", id: uid("e"), text: ev.message });
      break;
    }
    case "turn-end": {
      // Close any still-streaming assistant / thought blocks.
      for (const it of items) {
        if (it.kind === "assistant") it.streaming = false;
        if (it.kind === "thought") it.open = false;
      }
      if (ev.stopReason === "error") {
        items.push({ kind: "error", id: uid("e"), text: "The turn failed — see the Logs tab for details." });
      }
      break;
    }
    default:
      break;
  }
}

/** Render a persisted timeline as readable Markdown for the .md transcript file.
 *  The transcript is opened in external markdown viewers that may render raw HTML,
 *  so text and fenced content are HTML-escaped and fence breakout is prevented. */
function escapeForTranscript(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function transcriptFence(content: string): string {
  return content.includes("```") ? "~~~~" : "```";
}

export function timelineToMarkdown(title: string, items: TimelineItem[]): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const it of items) {
    switch (it.kind) {
      case "user":
        lines.push(`## 🧑 You`, "", escapeForTranscript(it.text.trim()), "");
        break;
      case "assistant":
        lines.push(`## 🤖 XtracsysCode`, "", escapeForTranscript(it.text.trim()), "");
        break;
      case "thought":
        if (it.text.trim()) lines.push(`<details><summary>Model thinking</summary>`, "", escapeForTranscript(it.text.trim()), "", `</details>`, "");
        break;
      case "tool": {
        if (it.diff) {
          const fence = transcriptFence(`${it.diff.oldText}${it.diff.newText}`);
          const removed = it.diff.oldText.split("\n").map((l) => `- ${escapeForTranscript(l)}`);
          const added = it.diff.newText.split("\n").map((l) => `+ ${escapeForTranscript(l)}`);
          lines.push(
            `**Tool — ${it.title}** (${it.status}) · \`${it.diff.path}\``,
            "",
            `${fence}diff`,
            ...removed,
            ...added,
            fence,
            "",
          );
        } else {
          const body = `${it.argsSummary}${it.output ? `\n---\n${it.output}` : ""}`;
          const fence = transcriptFence(body);
          lines.push(
            `**Tool — ${it.title}** (${it.status})`,
            "",
            fence,
            escapeForTranscript(body),
            fence,
            "",
          );
        }
        break;
      }
      case "error":
        lines.push(`> ⚠️ ${escapeForTranscript(it.text)}`, "");
        break;
      case "system":
        lines.push(`> ℹ️ ${escapeForTranscript(it.text)}`, "");
        break;
    }
  }
  return lines.join("\n");
}
