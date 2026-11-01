/**
 * Project / chat / task store on top of Storage. All state lives in user-visible
 * JSON files (BUILD_REQUIREMENTS.md §4.6) and is rewritten atomically.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isValidChatId, type Storage } from "./storage";
import type { ChatMessage } from "./agent/types";
import type { PlanEntry, TimelineItem } from "../shared/timelineModel";

export function isTrustedRendererUrl(candidate: string, expectedEntryUrl: string): boolean {
  try {
    const actual = new URL(candidate);
    const expected = new URL(expectedEntryUrl);
    if (expected.search || expected.hash || actual.protocol !== expected.protocol || actual.origin !== expected.origin || actual.host !== expected.host || actual.pathname !== expected.pathname) return false;
    if (actual.username || actual.password || actual.hash) return false;
    const params = [...actual.searchParams.entries()];
    return params.length === 0 || (params.length === 1 && params[0][0] === "chat" && isValidChatId(params[0][1]));
  } catch {
    return false;
  }
}

export interface ProjectRules {
  /** Shell command glob patterns, e.g. ["git *", "npm run *"]. `*` = any suffix. */
  commands: string[];
  /** Write scopes, e.g. ["src/**", "README.md"] — paths (relative to project root) the agent may write without asking. */
  writeScopes: string[];
}

export interface ProjectSettings {
  model?: string;
  numCtx?: number;
  temperature?: number;
  approvalMode?: "ask" | "auto";
  maxSteps?: number;
  systemPromptExtra?: string;
}

export interface Project {
  id: string;
  name: string;
  cwd: string;
  createdAt: number;
  rules?: ProjectRules;
  /** N12: local stdio MCP servers for this project. */
  mcps?: { name: string; command: string; args: string[] }[];
  /** M4: per-project overrides of global agent settings. */
  settings?: ProjectSettings;
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

export interface ChatRecord extends ChatSummary {
  messages: ChatMessage[];
  timeline: TimelineItem[];
  plan?: PlanEntry[];
  /** Chars of project instructions (.xtracsys.md / AGENTS.md) loaded into the system prompt. */
  instructionsChars?: number;
  /** v5: skills explicitly selected for this chat (full instructions injected per turn). */
  selectedSkills?: string[];
  /** P5: set after the context-pressure warning fires; reset by /compact and /clear. */
  pressureNoticed?: boolean;
  stats: { turns: number; inputTokens: number; outputTokens: number; lastInputTokens?: number };
}

export interface TaskRun {
  at: number;
  ok: boolean;
  detail?: string;
}

export interface Task {
  id: string;
  name: string;
  prompt: string;
  projectId: string | null;
  /** When set, the task auto-runs every N minutes while the app is open. */
  intervalMinutes: number | null;
  lastRunAt: number | null;
  lastStatus: "ok" | "error" | null;
  lastError?: string;
  /** M7: most recent runs, newest first (cap 20). */
  history?: TaskRun[];
}

export class Store {
  private projectsCache: Project[] | null = null;
  private tasksCache: Task[] | null = null;
  private chatsCache = new Map<string, ChatRecord>();

  constructor(private storage: Storage) {}

  // ---------- projects ----------
  listProjects(): Project[] {
    if (!this.projectsCache) {
      this.projectsCache = this.storage.loadDoc<Project[]>("projects.json", []);
    }
    return this.projectsCache;
  }

  async createProject(name: string, cwd: string): Promise<Project> {
    const project: Project = { id: randomUUID(), name, cwd, createdAt: Date.now() };
    const projects = this.listProjects().filter(
      (p) => p.cwd !== cwd, // dedupe by path
    );
    projects.push(project);
    this.projectsCache = projects;
    await this.storage.saveDoc("projects.json", projects);
    return project;
  }

  async deleteProject(id: string): Promise<void> {
    this.projectsCache = this.listProjects().filter((p) => p.id !== id);
    await this.storage.saveDoc("projects.json", this.projectsCache);
  }

  async setProjectRules(id: string, rules: ProjectRules): Promise<Project | null> {
    const projects = this.listProjects();
    const project = projects.find((p) => p.id === id);
    if (!project) return null;
    project.rules = {
      commands: rules.commands.map((s) => String(s).trim()).filter(Boolean),
      writeScopes: rules.writeScopes.map((s) => String(s).trim()).filter(Boolean),
    };
    await this.storage.saveDoc("projects.json", projects);
    return project;
  }

  async setProjectMcps(id: string, mcps: { name: string; command: string; args: string[] }[]): Promise<Project | null> {
    const projects = this.listProjects();
    const project = projects.find((p) => p.id === id);
    if (!project) return null;
    project.mcps = mcps
      .map((m) => ({
        name: String(m.name || "server").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40),
        command: String(m.command || "").trim(),
        args: Array.isArray(m.args) ? m.args.map(String).slice(0, 16) : [],
      }))
      .filter((m) => m.command);
    await this.storage.saveDoc("projects.json", projects);
    return project;
  }

  async saveProjectSettings(id: string, settings: ProjectSettings): Promise<Project | null> {
    const projects = this.listProjects();
    const project = projects.find((p) => p.id === id);
    if (!project) return null;
    const clean: ProjectSettings = {};
    if (settings.model) clean.model = String(settings.model).slice(0, 200);
    if (typeof settings.numCtx === "number" && settings.numCtx > 0) clean.numCtx = settings.numCtx;
    if (typeof settings.temperature === "number") clean.temperature = settings.temperature;
    if (settings.approvalMode === "ask" || settings.approvalMode === "auto") clean.approvalMode = settings.approvalMode;
    if (typeof settings.maxSteps === "number" && settings.maxSteps > 0) clean.maxSteps = Math.round(settings.maxSteps);
    if (settings.systemPromptExtra) clean.systemPromptExtra = String(settings.systemPromptExtra).slice(0, 8000);
    project.settings = Object.keys(clean).length > 0 ? clean : undefined;
    await this.storage.saveDoc("projects.json", projects);
    return project;
  }

  /** M4: scaffold default config MD files into the project folder. Never overwrites. Returns created file names. */
  async scaffoldConfigFiles(id: string): Promise<string[]> {
    const project = this.listProjects().find((p) => p.id === id);
    if (!project) return [];
    const templates: Record<string, string> = {
      "AGENTS.md":
        "# Project conventions\n\nInstructions in this file are given to the agent at the start of every task.\n\n- Describe the stack and how to run/build/test the project.\n- List conventions the agent must follow (naming, style, structure).\n- Note files or folders that must never be modified.\n",
      ".xtracsys.md":
        "# XtracsysCode project notes\n\nThis file is loaded into the agent's system prompt on every turn.\nKeep project-specific agent notes here.\n",
    };
    const created: string[] = [];
    for (const [name, content] of Object.entries(templates)) {
      const target = path.join(project.cwd, name);
      if (fs.existsSync(target)) continue;
      try {
        await fs.promises.writeFile(target, content, "utf8");
        created.push(name);
      } catch {
        /* skip unwritable */
      }
    }
    return created;
  }

  // ---------- chats ----------
  listChatSummaries(): ChatSummary[] {
    const out: ChatSummary[] = [];
    for (const id of this.storage.listChatIds()) {
      const rec = this.chatsCache.get(id) ?? this.storage.readJson<ChatRecord>(this.storage.chatJson(id));
      if (!rec || rec.id !== id || !isValidChatId(rec.id)) continue;
      this.chatsCache.set(id, rec);
      out.push(toSummary(rec));
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }

  getChat(id: string): ChatRecord | null {
    if (!isValidChatId(id)) return null;
    const cached = this.chatsCache.get(id);
    if (cached) return cached.id === id && isValidChatId(cached.id) ? cached : null;
    const rec = this.storage.readJson<ChatRecord>(this.storage.chatJson(id));
    if (!rec || rec.id !== id || !isValidChatId(rec.id)) return null;
    this.chatsCache.set(id, rec);
    return rec;
  }

  async createChat(opts: {
    projectId: string;
    cwd: string;
    title: string;
    approvalMode: "ask" | "auto";
    model: string;
  }): Promise<ChatRecord> {
    const now = Date.now();
    const rec: ChatRecord = {
      id: randomUUID(),
      projectId: opts.projectId,
      cwd: opts.cwd,
      title: opts.title,
      createdAt: now,
      updatedAt: now,
      status: "idle",
      approvalMode: opts.approvalMode,
      model: opts.model,
      messageCount: 0,
      messages: [],
      timeline: [],
      stats: { turns: 0, inputTokens: 0, outputTokens: 0 },
    };
    this.chatsCache.set(rec.id, rec);
    await this.persistChat(rec);
    return rec;
  }

  async persistChat(rec: ChatRecord): Promise<void> {
    return this.storage.restoreBarrier.run("chat persistence", () => this.persistChatNow(rec));
  }

  private async persistChatNow(rec: ChatRecord): Promise<void> {
    if (!isValidChatId(rec.id)) throw new Error("Invalid chat identifier.");
    rec.updatedAt = Date.now();
    rec.messageCount = rec.messages.length;
    this.chatsCache.set(rec.id, rec);
    try {
      await this.storage.writeJsonAtomic(this.storage.chatJson(rec.id), rec);
    } catch (e) {
      this.storage.log(`ERROR persistChat ${rec.id}: ${(e as Error).message}`);
    }
  }

  /** Rebuild the human-readable .md transcript next to the JSON. */
  async writeTranscript(rec: ChatRecord, toMarkdown: (title: string, items: TimelineItem[]) => string): Promise<void> {
    return this.storage.restoreBarrier.run("transcript persistence", async () => {
    try {
      await fs.promises.writeFile(this.storage.chatMd(rec.id), toMarkdown(rec.title, rec.timeline), "utf8");
    } catch {
      /* non-fatal */
    }
    });
  }

  async deleteChat(id: string): Promise<void> {
    if (!isValidChatId(id)) throw new Error("Invalid chat identifier.");
    this.chatsCache.delete(id);
    await this.storage.deleteChat(id);
  }

  async renameChat(id: string, title: string): Promise<ChatRecord | null> {
    const rec = this.getChat(id);
    if (!rec) return null;
    rec.title = title;
    await this.persistChat(rec);
    return rec;
  }

  // ---------- tasks ----------
  listTasks(): Task[] {
    if (!this.tasksCache) {
      this.tasksCache = this.storage.loadDoc<Task[]>("tasks.json", []);
    }
    return this.tasksCache;
  }

  async saveTask(task: Task): Promise<void> {
    const tasks = this.listTasks();
    const i = tasks.findIndex((t) => t.id === task.id);
    if (i >= 0) tasks[i] = task;
    else tasks.push(task);
    this.tasksCache = tasks;
    await this.storage.saveDoc("tasks.json", tasks);
  }

  async deleteTask(id: string): Promise<void> {
    this.tasksCache = this.listTasks().filter((t) => t.id !== id);
    await this.storage.saveDoc("tasks.json", this.tasksCache);
  }

  invalidateChat(id: string): void {
    this.chatsCache.delete(id);
  }
}

export function toSummary(rec: ChatRecord): ChatSummary {
  return {
    id: rec.id,
    projectId: rec.projectId,
    cwd: rec.cwd,
    title: rec.title,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    status: rec.status,
    approvalMode: rec.approvalMode,
    model: rec.model,
    messageCount: rec.messageCount,
  };
}

export function defaultTitle(cwd: string): string {
  return `${path.basename(cwd) || "session"} · ${new Date().toLocaleString()}`;
}

/** Validate that a cwd exists and is a readable directory. */
export function validCwd(cwd: string): boolean {
  try {
    return fs.statSync(cwd).isDirectory();
  } catch {
    return false;
  }
}

/** Glob-ish command match: "git *" matches "git anything"; plain string = exact. */
export function commandMatchesPattern(pattern: string, command: string): boolean {
  const p = pattern.trim().replace(/\s+/g, " ");
  const c = command.trim().replace(/\s+/g, " ");
  if (!p) return false;
  if (p === "*" || p === "* *") return true;
  if (p.endsWith("*")) {
    const prefix = p.slice(0, -1).trim();
    return c === prefix || c.startsWith(prefix + " ");
  }
  return c === p;
}

/**
 * v5 R8: true when the command uses shell control syntax — chaining, piping,
 * substitution, redirection, or line continuation. Such commands are NEVER
 * auto-allowed by a first-token glob match ("git *" must not approve
 * "git status && rm -rf /"): the suffix runs under the same approval even though
 * the user only ever saw the prefix. We don't try to parse shell grammar — when
 * classification is uncertain, prefer asking. An EXACT pattern (the full command
 * string, no wildcard) the user explicitly allowed still matches.
 */
export function commandHasShellControl(command: string): boolean {
  const c = command.replace(/\\\n/g, " ");
  // Any `>` counts as redirection: unspaced forms (`cmd>file`, `cmd 2>file`,
  // `cmd>>file`) previously slipped past a whitespace-anchored check and let an
  // allowlisted prefix silently write outside the project. Bare `$VAR` interpolation
  // is flagged too, so an allowlisted prefix never auto-expands the environment.
  // False positives only ever cost an approval prompt — never the reverse.
  if (/&&|\|\||[;|&`><]|\$\(|\$\{|\$[A-Za-z_]/.test(c) || /\n/.test(c)) return true;
  // Approved-tool escapes: the approved first token itself spawning a shell.
  // `find -exec … +`, `xargs sh -c …`, `awk 'system(…)'`, and `git -c alias.…='!…'`
  // carry no classic control characters but execute arbitrary commands.
  return /\s-exec\b|\s-execdir\b|system\s*\(|\bxargs\b|(^|\s)-c\s+[^\s]*alias/.test(c);
}

/** Shared normalization for BOTH rules:set and rules:allow-always — entry/length caps
 *  and the blanket-pattern rejection must not be evadable through the Always-allow
 *  path (which derives patterns from a model-supplied command). */
export function sanitizeRulesPatterns(value: unknown): string[] {
  const list = (Array.isArray(value) ? value : []).map((v) => String(v).trim()).filter(Boolean);
  if (list.length > 100) throw new Error("Too many rules (max 100 per list).");
  for (const pattern of list) {
    if (pattern.length > 500) throw new Error("Rule is too long (max 500 chars).");
    if (/^\*+(\s+\*+)*$/.test(pattern)) {
      throw new Error(`Pattern "${pattern.slice(0, 32)}" would allow every command — name the command instead.`);
    }
  }
  return list;
}

/** Approval-rule verdict for a run_command against a project's allowlist patterns. */
export function commandApprovalDecision(patterns: string[], command: string): "allow" | "ask" {
  const norm = command.trim().replace(/\s+/g, " ");
  const matched = patterns.some((pat) => commandMatchesPattern(pat, norm));
  if (!matched) return "ask";
  if (!commandHasShellControl(norm)) return "allow";
  // Compound/substituting command: only an exact, explicitly-allowed match may pass.
  return patterns.includes(norm) ? "allow" : "ask";
}

/** True when absPath is inside one of the write scopes (relative globs like "src/**"). */
export function pathInWriteScopes(root: string, scopes: string[], absPath: string): boolean {
  for (const scope of scopes) {
    const s = scope.trim();
    if (!s) continue;
    const abs = path.isAbsolute(s) ? s : path.resolve(root, s);
    const base = abs.replace(/(\/\*\*)?(\/\*)?$/, "") || path.sep;
    if (absPath === base || absPath.startsWith(base + path.sep)) return true;
  }
  return false;
}
