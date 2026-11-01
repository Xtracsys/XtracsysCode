/** Renderer-side types mirroring the Electron main process models. */
import type { PlanEntry as SharedPlanEntry, TimelineItem as SharedTimelineItem } from "../../shared/timelineModel";

type TimelineItem = SharedTimelineItem;
type PlanEntry = SharedPlanEntry;

export interface Project {
  id: string;
  name: string;
  cwd: string;
  createdAt: number;
  rules?: { commands: string[]; writeScopes: string[] };
  mcps?: { name: string; command: string; args: string[] }[];
  settings?: {
    model?: string;
    numCtx?: number;
    temperature?: number;
    approvalMode?: "ask" | "auto";
    maxSteps?: number;
    systemPromptExtra?: string;
  };
}

export interface ChatSummary {
  id: string;
  projectId: string;
  cwd: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "running";
  approvalMode: "ask" | "auto";
  model: string;
  messageCount: number;
}

/** v5: a local skill (instructions + inert assets; app-managed copy under the data root). */
export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  version: string;
  scope: "global" | "project";
  projectId: string | null;
  enabled: boolean;
  source: "bundled" | "imported" | "created";
  sourcePath?: string;
  createdAt: number;
  updatedAt: number;
  sizeBytes: number;
}

/** v5: a local plugin — manifest for a stdio tool process (MCP transport). */
export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  entry: { command: string; args: string[] };
  tools: string[];
  capabilities: string[];
  enabled: boolean;
  projectId: string | null;
  reviewed: boolean;
  sourcePath: string;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface ChatRecord extends ChatSummary {
  messages: unknown[];
  timeline: TimelineItem[];
  plan?: PlanEntry[];
  instructionsChars?: number;
  /** v5: skills attached to this chat (full instructions load on the next turn). */
  selectedSkills?: string[];
  stats: { turns: number; inputTokens: number; outputTokens: number; lastInputTokens?: number };
}

export interface Task {
  id: string;
  name: string;
  prompt: string;
  projectId: string | null;
  intervalMinutes: number | null;
  lastRunAt: number | null;
  lastStatus: "ok" | "error" | null;
  lastError?: string;
  history?: { at: number; ok: boolean; detail?: string }[];
}

export interface Settings {
  version: 1;
  dataRoot: string;
  provider: "ollama" | "llamacpp" | "gmlx" | "mlxLmServer";
  ollamaUrl: string;
  llamaCppUrl: string;
  openAICompatibleUrl: string;
  model: string;
  approvalMode: "ask" | "auto";
  maxSteps: number;
  historyCharBudget: number;
  systemPromptExtra: string;
  numCtx?: number;
  temperature?: number;
  notifyOnCompletion?: boolean;
  appearance?: { accent: string; reduceMotion: boolean };
  backups?: { daily: boolean; keep: number; lastRun?: number };
  session?: { openChats: string[] };
  layout?: {
    sidebarWidth: number;
    inspectorWidth: number;
    composerHeight: number;
    sidebarCollapsed: boolean;
    inspectorCollapsed: boolean;
  };
  caps: {
    logMaxBytes: number;
    chatsMaxBytes: number;
    keepChatDays: number;
    tmpMaxBytes: number;
  };
}

export interface StorageUsage {
  total: number;
  breakdown: Record<string, number>;
  chatCount: number;
  root: string;
  caps: Settings["caps"];
}

export interface PermissionRequest {
  requestId: string;
  chatId: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface ModelsInfo {
  ollama: string[];
  llamacpp: string[];
  openAICompatible: string[];
  errors: Record<string, string>;
}

export interface AppState {
  settings: Settings;
  projects: Project[];
  chats: ChatSummary[];
  tasks: Task[];
  usage: StorageUsage;
  running: string[];
}

export interface BrowseResult {
  path: string;
  parent: string;
  entries: { path: string; name: string }[];
  error?: string;
}

export type { PlanEntry, TimelineItem, SharedAgentEvent } from "../../shared/timelineModel";
