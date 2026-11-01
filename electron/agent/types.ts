/** Core agent types shared by providers, loop, storage, and smoke tests. No Electron imports here. */

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON object of arguments. */
  args: Record<string, unknown>;
}

/** One message in the LLM conversation. */
export interface ChatMessage {
  role: Role;
  content: string;
  /** Assistant tool calls (assistant role). */
  toolCalls?: ToolCall[];
  /** Tool result correlation (tool role). */
  toolCallId?: string;
  /** Tool name (tool role). */
  name?: string;
  /** Base64-encoded images (user role, vision models). */
  images?: string[];
  ts?: number;
}

export interface ToolDiff {
  path: string;
  oldText: string;
  newText: string;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  /** Before/after preview for write-style tools (rendered as a diff in the UI). */
  diff?: ToolDiff;
}

/** Normalized tool call request issued by the model. */
export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ProviderStreamCallbacks {
  onText: (delta: string) => void;
  onThought: (delta: string) => void;
  /** Fired once per tool call, with the complete parsed arguments. */
  onToolCall: (call: ToolCallRequest) => void;
  onUsage?: (usage: { inputTokens?: number; outputTokens?: number }) => void;
}

export interface Provider {
  /** Human-readable backend name. */
  readonly label: string;
  listModels(): Promise<string[]>;
  /** Stream one chat completion. Returns the finish reason. */
  streamChat(
    opts: {
      model: string;
      messages: ChatMessage[];
      tools: ToolSpec[];
      signal: AbortSignal;
      /** Optional sampling/context params. */
      params?: { numCtx?: number; temperature?: number };
    },
    cb: ProviderStreamCallbacks,
  ): Promise<{ finishReason: "stop" | "tool_calls" | "length" | "error"; error?: string }>;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolDefinition {
  spec: ToolSpec;
  /** true = read-only, never requires approval. */
  readOnly: boolean;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  /** Before/after preview for write-style tools (rendered as a diff in the UI). */
  diff?: ToolDiff;
}

export interface PlanEntry {
  content: string;
  status: "pending" | "in_progress" | "done";
}

export interface ToolContext {
  cwd: string;
  /** Root directory the agent is allowed to operate in (project cwd). */
  resolvePath(p: string): string;
  scratchDir: string;
  /** Update the chat's plan/todo list (set_plan tool). */
  updatePlan?(entries: PlanEntry[]): void;
  /** Stream incremental command output to the UI (run_command). */
  onOutput?(chunk: string): void;
}

export interface ApprovalRequest {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
}

/** Events emitted by the loop, rendered as a timeline by the UI. */
export type AgentEvent =
  | { type: "turn-start"; chatId: string; turnId: string; text: string; imageCount?: number }
  | { type: "text-delta"; chatId: string; turnId: string; delta: string }
  | { type: "thought-delta"; chatId: string; turnId: string; delta: string }
  | { type: "thought-end"; chatId: string; turnId: string }
  | {
      type: "tool-start";
      chatId: string;
      turnId: string;
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool-end";
      chatId: string;
      turnId: string;
      toolCallId: string;
      ok: boolean;
      output: string;
      diff?: ToolDiff;
    }
  | { type: "plan"; chatId: string; turnId: string; entries: PlanEntry[] }
  | {
      type: "tool-output";
      chatId: string;
      turnId: string;
      toolCallId: string;
      chunk: string;
    }
  | { type: "turn-end"; chatId: string; turnId: string; stopReason: string }
  | { type: "turn-error"; chatId: string; turnId: string; message: string }
  | { type: "step-start"; chatId: string; turnId: string; step: number };

export interface AgentRunOptions {
  chatId: string;
  cwd: string;
  scratchDir: string;
  model: string;
  provider: Provider;
  /** History including the new user message. Mutated copy is returned, not persisted here. */
  history: ChatMessage[];
  systemPrompt: string;
  tools: ToolDefinition[];
  maxSteps?: number;
  maxToolOutputChars?: number;
  maxHistoryChars?: number;
  /** Optional sampling/context params passed to the provider. */
  params?: { numCtx?: number; temperature?: number };
  /** Receives plan updates from the set_plan tool. */
  onPlanUpdate?: (entries: PlanEntry[]) => void;
  signal: AbortSignal;
  /** Returns true when approved. Implementations may ask the user. */
  requestApproval?: (req: ApprovalRequest) => Promise<boolean>;
  emit: (ev: AgentEvent) => void;
}

export interface AgentRunResult {
  messages: ChatMessage[];
  stopReason: "end_turn" | "aborted" | "max_steps" | "error";
  error?: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Input tokens of the FINAL provider call — the true context size of the turn. */
  lastInputTokens: number;
  steps: number;
}
