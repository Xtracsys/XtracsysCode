/** Typed wrapper over the preload bridge (window.xtrac). */
import type {
  AppState,
  BrowseResult,
  ChatRecord,
  ModelsInfo,
  PluginRecord,
  Project,
  Settings,
  SkillRecord,
  StorageUsage,
  Task,
} from "./types";

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  onEvent(cb: (payload: unknown) => void): () => void;
}

const bridge: Bridge = (window as unknown as { xtrac: Bridge }).xtrac;

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return (await bridge.invoke(channel, payload)) as T;
}

export const api = {
  onEvent: bridge.onEvent,
  getState: () => invoke<AppState>("state:get"),
  setSettings: (patch: Partial<Settings>) => invoke<Settings>("settings:set", patch),
  listModels: () => invoke<ModelsInfo>("backends:models"),
  createProject: (name: string, cwd: string) => invoke<Project>("project:create", { name, cwd }),
  deleteProject: (id: string, alsoDeleteChats?: boolean) =>
    invoke<void>("project:delete", { id, alsoDeleteChats: alsoDeleteChats === true }),
  renameProject: (id: string, name: string) => invoke<Project>("project:rename", { id, name }),
  saveProjectSettings: (
    projectId: string,
    settings: {
      model?: string;
      numCtx?: number;
      temperature?: number;
      approvalMode?: "ask" | "auto";
      maxSteps?: number;
      systemPromptExtra?: string;
    },
  ) => invoke<Project>("project:save-settings", { projectId, settings }),
  readConfig: (projectId: string, name: "AGENTS.md" | ".xtracsys.md") =>
    invoke<string | null>("config:read", { projectId, name }),
  writeConfig: (projectId: string, name: "AGENTS.md" | ".xtracsys.md", content: string) =>
    invoke<boolean>("config:write", { projectId, name, content }),
  scaffoldConfig: (projectId: string) => invoke<string[]>("config:scaffold", { projectId }),
  deleteChats: (ids: string[]) => invoke<number>("chats:delete", { ids }),
  moveChat: (id: string, projectId: string) => invoke<ChatRecord>("chat:move", { id, projectId }),
  setProjectRules: (projectId: string, commands: string[], writeScopes: string[]) =>
    invoke<Project>("rules:set", { projectId, commands, writeScopes }),
  allowAlways: (chatId: string, toolName: string, args: Record<string, unknown>) =>
    invoke<Project>("rules:allow-always", { chatId, toolName, args }),
  setProjectMcps: (projectId: string, mcps: { name: string; command: string; args: string[] }[]) =>
    invoke<Project>("mcp:set", { projectId, mcps }),
  createChat: (opts: { projectId?: string; cwd?: string; title?: string; approvalMode?: "ask" | "auto"; skills?: string[] }) =>
    invoke<ChatRecord>("chat:create", opts),
  getChat: (id: string) => invoke<ChatRecord | null>("chat:get", { id }),
  deleteChat: (id: string) => invoke<void>("chat:delete", { id }),
  renameChat: (id: string, title: string) => invoke<ChatRecord>("chat:rename", { id, title }),
  setChatApproval: (id: string, mode: "ask" | "auto") => invoke<ChatRecord>("chat:approval", { id, mode }),
  setChatModel: (id: string, model: string) => invoke<ChatRecord>("chat:model", { id, model }),
  sendPrompt: (id: string, text: string, images?: string[]) =>
    invoke<{ accepted: boolean; queued?: boolean; reason?: string }>("chat:send", { id, text, images }),
  cancel: (id: string) => invoke<boolean>("chat:cancel", { id }),
  openChatWindow: (chatId: string) => invoke<boolean>("windows:new-chat", { chatId }),
  setSessionActive: (chatId: string) => invoke<boolean>("session:set-active", { chatId }),
  reopenChatWindows: () => invoke<boolean>("session:reopen-windows"),
  retryChat: (id: string) => invoke<"started" | "nothing" | "busy">("chat:retry", { id }),
  approve: (requestId: string, allow: boolean) => invoke<boolean>("chat:approve", { requestId, allow }),
  storageUsage: () => invoke<StorageUsage>("storage:usage"),
  storageCleanup: () => invoke<{ tmpDeleted: number; agedDeleted: number; prunedDeleted: number; bytesFreed: number }>("storage:cleanup"),
  browse: (path?: string) => invoke<BrowseResult>("fs:browse", { path }),
  pickDir: () => invoke<string | null>("fs:pick-dir"),
  mkdir: (parent: string, name: string) => invoke<string>("fs:mkdir", { parent, name }),
  openInFinder: (path: string) => invoke<boolean>("open:finder", { path }),
  openInTerminal: (path: string) => invoke<boolean>("open:terminal", { path }),
  readLogs: () => invoke<string>("logs:read"),
  exportLog: () => invoke<string | null>("logs:export"),
  gitStatus: (cwd: string) =>
    invoke<{ available: boolean; reason?: string; branch?: string; files?: { status: string; path: string; staged: boolean; unstaged: boolean }[] }>("git:status", { cwd }),
  gitDiff: (cwd: string, path: string) => invoke<{ diff: string }>("git:diff", { cwd, path }),
  gitRun: (cwd: string, args: string[]) => invoke<{ out: string; err: string; code: number }>("git:run", { cwd, args }),
  projectUsage: (projectId: string) =>
    invoke<{ turns: number; inputTokens: number; outputTokens: number; chatCount: number; perChat: { id: string; title: string; turns: number; tokens: number }[] }>("usage:project", { projectId }),
  revealTranscript: (chatId: string) => invoke<boolean>("chat:reveal-transcript", { chatId }),
  archiveChats: (ids: string[]) => invoke<number>("archive:chats", { ids }),
  archiveList: () => invoke<{ id: string; title: string; updatedAt: number; bytes: number }[]>("archive:list"),
  archiveRestore: (ids: string[]) => invoke<number>("archive:restore", { ids }),
  archiveDelete: (ids: string[]) => invoke<number>("archive:delete", { ids }),
  searchChats: (query: string) =>
    invoke<{ id: string; title: string; snippet: string; updatedAt: number }[]>("search:chats", { query }),
  exportData: () => invoke<string | null>("data:export"),
  importData: (archivePath: string) => invoke<string>("data:import", { archivePath }),
  pickFile: () => invoke<string | null>("fs:pick-file"),
  saveTask: (task: Partial<Task>) => invoke<Task>("tasks:save", task),
  deleteTask: (id: string) => invoke<void>("tasks:delete", { id }),
  runTask: (id: string) => invoke<{ ok: boolean; chatId?: string; error?: string }>("tasks:run", { id }),
  // v5 skills
  listSkills: () => invoke<SkillRecord[]>("skills:list"),
  importSkill: (sourcePath: string) => invoke<SkillRecord>("skills:import", { sourcePath }),
  createSkill: (opts: { name: string; description: string; version?: string; scope?: "global" | "project"; body?: string }) =>
    invoke<SkillRecord>("skills:create", opts),
  setSkillEnabled: (id: string, enabled: boolean) => invoke<SkillRecord>("skills:set-enabled", { id, enabled }),
  setSkillScope: (id: string, scope: "global" | "project", projectId: string | null) =>
    invoke<SkillRecord>("skills:set-scope", { id, scope, projectId }),
  removeSkill: (id: string) => invoke<void>("skills:remove", { id }),
  exportSkill: (id: string, destDir: string) => invoke<string>("skills:export", { id, destDir }),
  readSkillFile: (id: string, path: string) => invoke<string>("skills:read-file", { id, path }),
  writeSkillFile: (id: string, path: string, content: string) => invoke<boolean>("skills:write-file", { id, path, content }),
  revealSkill: (id: string) => invoke<boolean>("skills:reveal", { id }),
  setChatSkills: (id: string, skills: string[]) => invoke<ChatRecord>("chat:skills", { id, skills }),
  // v5 plugins
  listPlugins: () => invoke<PluginRecord[]>("plugins:list"),
  importPlugin: (sourcePath: string) => invoke<PluginRecord>("plugins:import", { sourcePath }),
  setPluginEnabled: (id: string, enabled: boolean, reviewed?: boolean) =>
    invoke<PluginRecord>("plugins:set-enabled", { id, enabled, reviewed }),
  setPluginScope: (id: string, projectId: string | null) => invoke<PluginRecord>("plugins:set-scope", { id, projectId }),
  removePlugin: (id: string) => invoke<void>("plugins:remove", { id }),
  testPlugin: (id: string) =>
    invoke<{ ok: boolean; error?: string; tools: { name: string; description: string }[]; ms: number }>("plugins:test", { id }),
  revealPlugin: (id: string) => invoke<boolean>("plugins:reveal", { id }),
};
