import type {
  AgentEvent,
  AgentRunOptions,
  AgentRunResult,
  ApprovalRequest,
  ChatMessage,
  ToolDefinition,
} from "./types";
import { resolveWithin } from "./tools";

const DEFAULT_MAX_STEPS = 24;
const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 16_000;
const DEFAULT_MAX_HISTORY_CHARS = 80_000;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toolSummary(name: string, args: Record<string, unknown>): string {
  const a = args ?? {};
  if (name === "run_command") return String(a.command ?? "(empty command)");
  if (name === "write_file") return String(a.path ?? "(no path)");
  if (name === "read_file") return String(a.path ?? "(no path)");
  if (name === "list_dir") return String(a.path ?? ".");
  if (name === "grep") return String(a.pattern ?? "(no pattern)");
  try {
    return JSON.stringify(a).slice(0, 200);
  } catch {
    return "(arguments)";
  }
}

/**
 * Trim history to a character budget by dropping whole turns (a turn = one user message
 * plus everything after it, including tool-call/result pairs). Never drops the first
 * user turn. Keeps pairing between assistant tool_calls and their tool results intact.
 */
export function trimHistory(history: ChatMessage[], budget = DEFAULT_MAX_HISTORY_CHARS): ChatMessage[] {
  let total = 0;
  for (const m of history) total += m.content.length;
  if (total <= budget) return history;

  // Split into turns. Leading messages before the first user message are their own group.
  const turns: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  for (const m of history) {
    if (m.role === "user" && current.length > 0) {
      turns.push(current);
      current = [m];
    } else {
      current.push(m);
    }
  }
  if (current.length > 0) turns.push(current);
  if (turns.length <= 1) return history;

  const firstTurnHasUser = turns[0].some((m) => m.role === "user");
  let remaining = budget;
  const keepFrom: number[] = [];
  for (let i = turns.length - 1; i >= (firstTurnHasUser ? 1 : 0); i--) {
    const size = turns[i].reduce((n, m) => n + m.content.length, 0);
    if (size <= remaining) {
      keepFrom.push(i);
      remaining -= size;
    }
  }
  const keepSet = new Set(keepFrom);
  if (firstTurnHasUser) keepSet.add(0);
  const out: ChatMessage[] = [];
  for (let i = 0; i < turns.length; i++) {
    if (keepSet.has(i)) out.push(...turns[i]);
  }
  return out.length > 0 ? out : history;
}

/**
 * Run one agent turn: user text → streamed completion → tool calls → results → repeat
 * until the model stops or limits are hit. Returns the updated message list.
 */
export async function runAgentTurn(opts: AgentRunOptions): Promise<AgentRunResult> {
  // Clamped here (not just in settings validation): a hand-edited settings.json with
  // maxSteps=1e9 must not produce an effectively unbounded autonomous loop.
  const maxSteps = Math.min(Math.max(Math.floor(opts.maxSteps ?? DEFAULT_MAX_STEPS), 1), 200);
  const maxToolOut = opts.maxToolOutputChars ?? DEFAULT_MAX_TOOL_OUTPUT_CHARS;
  const toolsByName = new Map<string, ToolDefinition>(opts.tools.map((t) => [t.spec.name, t]));
  const turnId = uid("turn");
  const { chatId, emit, signal } = opts;

  const messages: ChatMessage[] = [...opts.history];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const lastInput = { tokens: 0 };
  let steps = 0;
  let stopReason: AgentRunResult["stopReason"] = "end_turn";
  let error: string | undefined;

  try {
    for (steps = 1; steps <= maxSteps; steps++) {
      if (signal.aborted) {
        stopReason = "aborted";
        break;
      }
      emit({ type: "step-start", chatId, turnId, step: steps });

      const trimmed = trimHistory(messages, opts.maxHistoryChars);
      const streamedText = { value: "" };
      const streamedThought = { value: "" };
      const pendingCalls = { list: [] as { id: string; name: string; args: Record<string, unknown> }[] };

      const result = await opts.provider.streamChat(
        {
          model: opts.model,
          messages: [{ role: "system", content: opts.systemPrompt }, ...trimmed],
          tools: opts.tools.map((t) => t.spec),
          signal,
          params: opts.params,
        },
        {
          onText: (delta) => {
            streamedText.value += delta;
            emit({ type: "text-delta", chatId, turnId, delta });
          },
          onThought: (delta) => {
            streamedThought.value += delta;
            emit({ type: "thought-delta", chatId, turnId, delta });
          },
          onToolCall: (call) => {
            pendingCalls.list.push(call);
          },
          onUsage: (u) => {
            usage.inputTokens += u.inputTokens ?? 0;
            usage.outputTokens += u.outputTokens ?? 0;
            if (typeof u.inputTokens === "number" && u.inputTokens > 0) lastInput.tokens = u.inputTokens;
          },
        },
      );

      if (result.finishReason === "error") {
        if (signal.aborted) {
          stopReason = "aborted";
          break;
        }
        stopReason = "error";
        error = result.error ?? "provider error";
        if (streamedText.value.trim().length > 0) {
          messages.push({ role: "assistant", content: streamedText.value, ts: Date.now() });
        }
        break;
      }

      const text = streamedText.value;
      const calls = pendingCalls.list;

      if (calls.length === 0) {
        messages.push({ role: "assistant", content: text, ts: Date.now() });
        if (streamedThought.value.trim()) {
          // Reasoning content is kept out of the persisted LLM history.
        }
        if (result.finishReason === "length") {
          stopReason = "max_steps"; // context window filled; surface as stopped
          error = "Model output hit the context length limit.";
        }
        break;
      }

      messages.push({
        role: "assistant",
        content: text,
        toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
        ts: Date.now(),
      });

      for (const call of calls) {
        if (signal.aborted) {
          stopReason = "aborted";
          break;
        }
        const tool = toolsByName.get(call.name);
        emit({
          type: "tool-start",
          chatId,
          turnId,
          toolCallId: call.id,
          name: call.name,
          args: call.args,
        });
        let ok = false;
        let output: string | undefined;
        let toolDiff: import("./types").ToolDiff | undefined;
        if (!tool) {
          output = `Unknown tool: ${call.name}`;
        } else {
          let denied = false;
          if (!tool.readOnly && opts.requestApproval) {
            const approved = await opts.requestApproval({
              requestId: uid("req"),
              toolName: call.name,
              args: call.args,
              summary: toolSummary(call.name, call.args),
            });
            if (!approved) {
              denied = true;
              output = "User denied this tool call. Stop and ask the user how to proceed.";
            }
          }
          if (!denied) {
            const ctx = {
              cwd: opts.cwd,
              scratchDir: opts.scratchDir,
              resolvePath: (p: string) => resolveWithin(opts.cwd, p),
              updatePlan: opts.onPlanUpdate,
              onOutput: (chunk: string) => {
                if (chunk) emit({ type: "tool-output", chatId, turnId, toolCallId: call.id, chunk });
              },
            };
            try {
              const res = await tool.execute(call.args, ctx);
              ok = res.ok;
              output = res.output;
              toolDiff = res.diff;
            } catch (e) {
              ok = false;
              output = `Tool crashed: ${(e as Error).message}`;
            }
            if (output.length > maxToolOut) {
              output = output.slice(0, maxToolOut) + `\n… [truncated at ${maxToolOut} chars]`;
            }
          }
        }
        const toolOutput = output ?? "(no output)";
        emit({
          type: "tool-end",
          chatId,
          turnId,
          toolCallId: call.id,
          ok,
          output: toolOutput,
          diff: toolDiff,
        });
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: toolOutput,
          ts: Date.now(),
        });
      }
      if (stopReason === "aborted") break;
    }

    if (steps > maxSteps && stopReason === "end_turn") {
      stopReason = "max_steps";
    }
  } catch (e) {
    stopReason = signal.aborted ? "aborted" : "error";
    error = (e as Error).message;
  }

  if (signal.aborted) {
    stopReason = "aborted";
    error = error ?? "aborted";
  }

  emit({ type: "turn-end", chatId, turnId, stopReason });
  return { messages, stopReason, error, usage, lastInputTokens: lastInput.tokens, steps };
}
