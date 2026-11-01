/**
 * Bounded, user-visible local storage for XtracsysCode.
 *
 * Layout (default root: ~/XtracsysCode):
 *   settings.json    — app settings (provider URLs, caps)
 *   projects.json    — projects/workspaces
 *   tasks.json       — saved automation prompts
 *   chats/<id>.json  — full chat record (messages + timeline + stats)
 *   chats/<id>.md    — human-readable transcript
 *   logs/xtrac.log   — rotated, size-capped log
 *   tmp/             — scratch, wiped on launch and periodically
 *
 * Hard rules from BUILD_REQUIREMENTS.md §4.5: bounded logs, bounded sessions,
 * controlled temp path, cleanup rules, visible storage use.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bootstrapFile } from "./platform";
import { RestoreBarrier, RestoreRecoveryError } from "./restoreBarrier";

const BACKSLASH = String.fromCharCode(92);
const NUL = String.fromCharCode(0);
const CHAT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ARCHIVE_ID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:-([0-9]{10,16}))?$/;
export const BACKUP_LIMITS = { maxEntries: 20_000, maxDepth: 64, maxFileBytes: 256 * 1024 * 1024, maxJsonBytes: 32 * 1024 * 1024, maxExpandedBytes: 1024 * 1024 * 1024 } as const;

export function isValidChatId(id: unknown): id is string {
  return typeof id === "string" && CHAT_UUID_RE.test(id);
}

/** Archived filename collision suffixes are timestamps; the underlying chat id stays a UUID. */
export function isValidArchiveId(id: unknown): id is string {
  return typeof id === "string" && ARCHIVE_ID_RE.test(id);
}

export function archiveBaseChatId(id: string): string | null {
  return isValidArchiveId(id) ? ARCHIVE_ID_RE.exec(id)![1] : null;
}

export interface BackupMember {
  type: string;
  path: string;
  size: number;
}

/** Parse the typed BSD/GNU verbose tar listing; malformed or ambiguous output fails closed. */
export function parseTarVerboseListing(listing: string): BackupMember[] {
  const lines = listing.split("\n").filter((line) => line.length > 0);
  if (lines.length > BACKUP_LIMITS.maxEntries) throw new Error(`Archive has too many entries (max ${BACKUP_LIMITS.maxEntries}).`);
  return lines.map((line) => {
    const match = line.match(/^([-dlcbpsh])\S{9}\+?\s+(?:\d+\s+\S+\s+\S+|\S+\/\S+)\s+(\d+)\s+(?:\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}|[A-Za-z]{3}\s+\d{1,2}(?:\s+\d{2}:\d{2}(?:\s+\d{4})?|\s+\d{4}))\s+(.+)$/);
    if (!match) throw new Error("Archive listing contains an unsupported or ambiguous entry.");
    return { type: match[1], size: Number(match[2]), path: match[3] };
  });
}

export function validateBackupMembers(members: BackupMember[], expectedRoot: string): BackupMember[] {
  if (!expectedRoot || expectedRoot.includes("/") || expectedRoot.includes(BACKSLASH) || expectedRoot.includes(":") || expectedRoot.includes(NUL) || expectedRoot === "." || expectedRoot === "..") throw new Error("Invalid backup root name.");
  if (members.length === 0 || members.length > BACKUP_LIMITS.maxEntries) throw new Error("Archive is empty or has too many entries.");
  const seen = new Set<string>();
  let expanded = 0;
  let hasRootDirectory = false;
  for (const member of members) {
    if ((member.type !== "-" && member.type !== "d") || !Number.isSafeInteger(member.size) || member.size < 0) throw new Error("Archive contains a link, special file, or invalid size.");
    if (member.size > BACKUP_LIMITS.maxFileBytes) throw new Error("Archive contains a file larger than the restore limit.");
    expanded += member.size;
    if (expanded > BACKUP_LIMITS.maxExpandedBytes) throw new Error("Archive expands beyond the restore size limit.");
    const raw = member.path;
    if (!raw || raw !== raw.trim() || raw.includes(BACKSLASH) || raw.includes(NUL) || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) throw new Error("Archive contains an unsafe member path.");
    const normalized = raw.endsWith("/") && member.type === "d" ? raw.slice(0, -1) : raw;
    const parts = normalized.split("/");
    if (parts.length > BACKUP_LIMITS.maxDepth || parts.some((part) => !part || part === "." || part === "..") || parts[0] !== expectedRoot || path.posix.normalize(normalized) !== normalized) throw new Error("Archive contains an unsafe member path.");
    if (member.type === "-" && raw.endsWith("/")) throw new Error("Archive file path has a directory suffix.");
    if (seen.has(normalized)) throw new Error("Archive contains duplicate member paths.");
    seen.add(normalized);
    if (normalized === expectedRoot && member.type === "d") hasRootDirectory = true;
  }
  if (!hasRootDirectory) throw new Error("Archive does not contain its expected data-root directory.");
  return members;
}

function pathIsWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validSettingsDocument(value: unknown): boolean {
  if (!isRecord(value) || value.version !== 1) return false;
  if (value.provider !== "ollama" && value.provider !== "llamacpp" && value.provider !== "gmlx" && value.provider !== "mlxLmServer") return false;
  if (value.openAICompatibleUrl !== undefined && typeof value.openAICompatibleUrl !== "string") return false;
  if ((value.provider === "gmlx" || value.provider === "mlxLmServer") && typeof value.openAICompatibleUrl !== "string") return false;
  if (value.approvalMode !== "ask" && value.approvalMode !== "auto") return false;
  for (const key of ["dataRoot", "ollamaUrl", "llamaCppUrl", "model", "systemPromptExtra"]) {
    if (typeof value[key] !== "string") return false;
  }
  for (const key of ["maxSteps", "historyCharBudget"]) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) return false;
  }
  for (const key of ["numCtx", "temperature"]) {
    if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) return false;
  }
  if (!isRecord(value.caps)) return false;
  for (const key of ["logMaxBytes", "chatsMaxBytes", "tmpMaxBytes"]) {
    const cap = value.caps[key];
    // Floor at 1 KiB: a cap of 0 passes arithmetic sanity but makes cleanup delete
    // every chat/tmp entry on the next cycle (including via a crafted backup import).
    if (typeof cap !== "number" || !Number.isFinite(cap) || cap < 1024) return false;
  }
  if (typeof value.caps.keepChatDays !== "number" || !Number.isFinite(value.caps.keepChatDays) || value.caps.keepChatDays < 1) return false;
  for (const key of ["notifyOnCompletion", "scaffoldOnCreate"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return false;
  }
  if (value.session !== undefined) {
    if (!isRecord(value.session) || (value.session.openChats !== undefined && (!Array.isArray(value.session.openChats) || value.session.openChats.some((id) => typeof id !== "string")))) return false;
  }
  return true;
}

function validProjectsDocument(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((project) => {
    if (!isRecord(project) || typeof project.id !== "string" || !project.id || typeof project.name !== "string" || typeof project.cwd !== "string" || !project.cwd) return false;
    if (project.createdAt !== undefined && (typeof project.createdAt !== "number" || !Number.isFinite(project.createdAt))) return false;
    if (project.mcps !== undefined && (!Array.isArray(project.mcps) || project.mcps.some((mcp) => !isRecord(mcp) || typeof mcp.name !== "string" || typeof mcp.command !== "string" || !mcp.command || !Array.isArray(mcp.args) || mcp.args.some((arg) => typeof arg !== "string")))) return false;
    if (project.rules !== undefined && (!isRecord(project.rules) || !Array.isArray(project.rules.commands) || project.rules.commands.some((rule) => typeof rule !== "string") || !Array.isArray(project.rules.writeScopes) || project.rules.writeScopes.some((scope) => typeof scope !== "string"))) return false;
    if (project.settings !== undefined) {
      // Per-project settings steer the agent (approval mode, prompt injection surface),
      // so a restored or hand-edited projects.json must carry sane values.
      if (!isRecord(project.settings)) return false;
      const s = project.settings;
      if (s.approvalMode !== undefined && s.approvalMode !== "ask" && s.approvalMode !== "auto") return false;
      for (const key of ["numCtx", "temperature"] as const) {
        if (s[key] !== undefined && (typeof s[key] !== "number" || !Number.isFinite(s[key]))) return false;
      }
      if (s.maxSteps !== undefined && (typeof s.maxSteps !== "number" || !Number.isFinite(s.maxSteps) || s.maxSteps < 1 || s.maxSteps > 200)) return false;
      if (s.model !== undefined && typeof s.model !== "string") return false;
      if (s.systemPromptExtra !== undefined && (typeof s.systemPromptExtra !== "string" || s.systemPromptExtra.length > 8000)) return false;
    }
    return true;
  });
}

function validTasksDocument(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((task) => {
    if (!isRecord(task) || typeof task.id !== "string" || !task.id || typeof task.name !== "string" || typeof task.prompt !== "string") return false;
    if (task.projectId !== null && typeof task.projectId !== "string") return false;
    if (task.intervalMinutes !== null && (typeof task.intervalMinutes !== "number" || !Number.isFinite(task.intervalMinutes))) return false;
    if (task.lastRunAt !== null && (typeof task.lastRunAt !== "number" || !Number.isFinite(task.lastRunAt))) return false;
    if (task.lastStatus !== null && task.lastStatus !== "ok" && task.lastStatus !== "error") return false;
    if (task.lastError !== undefined && typeof task.lastError !== "string") return false;
    if (task.history !== undefined && (!Array.isArray(task.history) || task.history.length > 20 || task.history.some((run) => !isRecord(run) || typeof run.at !== "number" || !Number.isFinite(run.at) || typeof run.ok !== "boolean" || (run.detail !== undefined && typeof run.detail !== "string")))) return false;
    return true;
  });
}

function validPluginsDocument(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 25) return false;
  const ids = new Set<string>();
  return value.every((plugin) => {
    if (!isRecord(plugin) || typeof plugin.id !== "string" || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(plugin.id) || ids.has(plugin.id)) return false;
    ids.add(plugin.id);
    for (const key of ["name", "version", "description", "sourcePath"]) if (typeof plugin[key] !== "string") return false;
    if (!isRecord(plugin.entry) || typeof plugin.entry.command !== "string" || !plugin.entry.command || !Array.isArray(plugin.entry.args) || plugin.entry.args.length > 32 || plugin.entry.args.some((arg) => typeof arg !== "string")) return false;
    for (const key of ["tools", "capabilities"]) if (!Array.isArray(plugin[key]) || (plugin[key] as unknown[]).some((item) => typeof item !== "string")) return false;
    if (typeof plugin.enabled !== "boolean" || typeof plugin.reviewed !== "boolean" || (plugin.projectId !== null && typeof plugin.projectId !== "string")) return false;
    for (const key of ["createdAt", "updatedAt"]) if (typeof plugin[key] !== "number" || !Number.isFinite(plugin[key])) return false;
    return true;
  });
}

/**
 * Remove executable/auto-approval behavior from a validated, untrusted backup
 * before it replaces the active data root. Users can inspect and configure
 * these items again after import.
 */
export async function sanitizeBackupForRestore(staging: string): Promise<void> {
  // Recheck the boundary before reading, even if a caller omitted validation.
  await validateBackupTree(staging);
  const root = await fsp.realpath(staging);
  const writeJson = async (relative: string, value: unknown): Promise<void> => {
    const target = path.resolve(root, relative);
    if (!pathIsWithin(root, target)) throw new Error("Restore sanitization path escaped staging.");
    const st = await fsp.lstat(target);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error("Restore sanitization target is not a regular file.");
    await fsp.writeFile(target, JSON.stringify(value, null, 2) + "\n", "utf8");
  };

  const settings = JSON.parse(await fsp.readFile(path.join(root, "settings.json"), "utf8")) as Record<string, unknown>;
  if (!validSettingsDocument(settings)) throw new Error("Restore settings failed validation during sanitization.");
  settings.approvalMode = "ask";
  // The IPC boundary floors storage caps at 1 KiB (a cap of 0 deletes everything on
  // the next cleanup cycle); a schema-valid backup can still carry 0, so clamp here.
  const restoredCaps = settings.caps as Record<string, unknown>;
  for (const key of ["logMaxBytes", "chatsMaxBytes", "tmpMaxBytes"] as const) {
    if ((restoredCaps[key] as number) < 1024) restoredCaps[key] = DEFAULT_CAPS[key];
  }
  if ((restoredCaps.keepChatDays as number) < 1) restoredCaps.keepChatDays = DEFAULT_CAPS.keepChatDays;
  await writeJson("settings.json", settings);

  const projects = JSON.parse(await fsp.readFile(path.join(root, "projects.json"), "utf8")) as Record<string, unknown>[];
  if (!validProjectsDocument(projects)) throw new Error("Restore projects failed validation during sanitization.");
  const projectCwdById = new Map<string, string>();
  for (const project of projects) {
    if (project.mcps !== undefined) project.mcps = [];
    if (project.rules !== undefined) project.rules = { commands: [], writeScopes: [] };
    if (isRecord(project.settings)) {
      project.settings.approvalMode = "ask";
      // A restored project must not ship a persistent system-prompt payload the user
      // never saw (the import dialog only promises execution-config neutralization).
      delete project.settings.systemPromptExtra;
      project.settings.maxSteps = undefined;
    }
    if (typeof project.id === "string" && typeof project.cwd === "string" && project.cwd) {
      projectCwdById.set(project.id, project.cwd);
    }
  }
  await writeJson("projects.json", projects);

  // Keep the executable-config invariant here, not solely in an IPC caller.
  try {
    const plugins = JSON.parse(await fsp.readFile(path.join(root, "plugins.json"), "utf8")) as unknown;
    if (!validPluginsDocument(plugins)) throw new Error("Restore plugin registry has an invalid schema.");
    for (const plugin of plugins) {
      plugin.enabled = false;
      plugin.reviewed = false;
      delete plugin.reviewedLaunchHash;
    }
    await writeJson("plugins.json", plugins);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const tasksPath = path.join(root, "tasks.json");
  try {
    const tasks = JSON.parse(await fsp.readFile(tasksPath, "utf8")) as Record<string, unknown>[];
    if (!validTasksDocument(tasks)) throw new Error("Restore tasks failed validation during sanitization.");
    for (const task of tasks) task.intervalMinutes = null;
    await writeJson("tasks.json", tasks);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  for (const directory of ["chats", "archive"]) {
    const dir = path.join(root, directory);
    let entries: import("node:fs").Dirent[];
    try {
      const st = await fsp.lstat(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("Restore chat directory is not a plain directory.");
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.name.endsWith(".json")) continue;
      if (!entry.isFile()) throw new Error("Restore chat record is not a regular file.");
      const relative = path.join(directory, entry.name);
      const recordPath = path.join(root, relative);
      const recordStat = await fsp.lstat(recordPath);
      if (!recordStat.isFile() || recordStat.isSymbolicLink()) throw new Error("Restore chat record is not a regular file.");
      const record = JSON.parse(await fsp.readFile(recordPath, "utf8")) as unknown;
      if (!isRecord(record)) throw new Error("Restore chat record failed validation during sanitization.");
      record.approvalMode = "ask";
      // The restore path validates little about chat CONTENT (messages/timeline shapes)
      // because the renderer trusts its own data — a crafted archive could plant
      // non-string fields that crash-loop the renderer on launch. Validate the shapes
      // the renderer and the agent loop dereference, and re-pin the workspace.
      validateChatRecordShape(record);
      if (typeof record.projectId === "string" && projectCwdById.get(record.projectId)) {
        record.cwd = projectCwdById.get(record.projectId);
      } else if (typeof record.cwd !== "string" || !record.cwd || !path.isAbsolute(record.cwd)) {
        record.cwd = DEFAULT_DATA_ROOT;
      } else {
        const cwdStat = await fsp.stat(record.cwd).catch(() => null);
        if (!cwdStat || !cwdStat.isDirectory()) record.cwd = DEFAULT_DATA_ROOT;
      }
      await writeJson(relative, record);
    }
  }
}

/** Timeline item kinds the renderer knows how to render (shared/timelineModel.ts). */
const TIMELINE_KINDS = new Set(["user", "assistant", "thought", "tool", "error", "system"]);

/** Validate the parts of a chat record that downstream code DEREFERENCES without
 *  checking: the renderer renders `timeline` items directly (non-string text crashes
 *  the React tree, and the app auto-opens the last active chat on every launch, so a
 *  crafted record can crash-loop the app) and the agent loop reads message content. */
export function validateChatRecordShape(record: Record<string, unknown>): void {
  if (!Array.isArray(record.messages) || !Array.isArray(record.timeline)) {
    throw new Error("Restore chat record failed validation during sanitization.");
  }
  for (const m of record.messages) {
    if (!isRecord(m) || typeof m.role !== "string" || typeof m.content !== "string") {
      throw new Error("Restore chat message failed validation during sanitization.");
    }
    if (m.toolCalls !== undefined && (!Array.isArray(m.toolCalls) || (m.toolCalls as unknown[]).some((tc) => !isRecord(tc) || typeof tc.id !== "string" || typeof tc.name !== "string"))) {
      throw new Error("Restore chat message failed validation during sanitization.");
    }
    if (m.images !== undefined && (!Array.isArray(m.images) || (m.images as unknown[]).some((i) => typeof i !== "string"))) {
      throw new Error("Restore chat message failed validation during sanitization.");
    }
  }
  for (const item of record.timeline) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.kind !== "string" || !TIMELINE_KINDS.has(item.kind)) {
      throw new Error("Restore chat timeline item failed validation during sanitization.");
    }
    if (item.kind === "tool") {
      for (const key of ["toolCallId", "name", "title", "status", "argsSummary"] as const) {
        if (typeof item[key] !== "string") throw new Error("Restore chat timeline item failed validation during sanitization.");
      }
      if (item.output !== undefined && typeof item.output !== "string") {
        throw new Error("Restore chat timeline item failed validation during sanitization.");
      }
      if (item.diff !== undefined && (!isRecord(item.diff) || typeof item.diff.path !== "string" || typeof item.diff.oldText !== "string" || typeof item.diff.newText !== "string")) {
        throw new Error("Restore chat timeline item failed validation during sanitization.");
      }
    } else if (typeof item.text !== "string") {
      throw new Error("Restore chat timeline item failed validation during sanitization.");
    }
  }
}

/** Check the extracted tree without following links and validate essential app documents. */
export async function validateBackupTree(staging: string): Promise<{ files: number; bytes: number }> {
  const rootStat = await fsp.lstat(staging);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Restore staging path is not a plain directory.");
  const root = await fsp.realpath(staging);
  await fsp.chmod(root, 0o700);
  let entries = 0;
  let bytes = 0;
  const jsonPaths = new Set<string>();
  const walk = async (dir: string, depth = 0): Promise<void> => {
    if (depth > BACKUP_LIMITS.maxDepth) throw new Error("Extracted backup exceeds the directory-depth limit.");
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      entries++;
      if (entries > BACKUP_LIMITS.maxEntries) throw new Error("Extracted backup has too many entries.");
      if (!entry.name || entry.name === "." || entry.name === ".." || entry.name.includes("/") || entry.name.includes(BACKSLASH) || entry.name.includes(NUL) || /[\x01-\x1f\x7f]/.test(entry.name)) throw new Error("Extracted backup contains an unsafe name.");
      const target = path.resolve(dir, entry.name);
      if (!pathIsWithin(root, target)) throw new Error("Extracted backup path escaped staging.");
      const st = await fsp.lstat(target);
      if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) throw new Error("Extracted backup contains a link or special file.");
      const real = await fsp.realpath(target);
      if (!pathIsWithin(root, real)) throw new Error("Extracted backup contains an escaping path.");
      if (st.isDirectory()) {
        await fsp.chmod(target, 0o700);
        await walk(target, depth + 1);
      } else {
        if (st.nlink > 1) throw new Error("Extracted backup contains a hard-linked file.");
        await fsp.chmod(target, 0o600);
        if (st.size > BACKUP_LIMITS.maxFileBytes) throw new Error("Extracted backup contains an oversized file.");
        if (entry.name.toLowerCase().endsWith(".json") && st.size > BACKUP_LIMITS.maxJsonBytes) throw new Error("Extracted backup contains an oversized JSON document.");
        bytes += st.size;
        if (bytes > BACKUP_LIMITS.maxExpandedBytes) throw new Error("Extracted backup exceeds the expanded-size limit.");
        jsonPaths.add(path.relative(root, target).split(path.sep).join("/"));
      }
    }
  };
  await walk(root);
  for (const required of ["settings.json", "projects.json"]) if (!jsonPaths.has(required)) throw new Error(`Backup is missing ${required}.`);
  const settings = JSON.parse(await fsp.readFile(path.join(root, "settings.json"), "utf8")) as unknown;
  const projects = JSON.parse(await fsp.readFile(path.join(root, "projects.json"), "utf8")) as unknown;
  if (!validSettingsDocument(settings) || !validProjectsDocument(projects)) throw new Error("Backup settings/projects documents have invalid schemas.");
  for (const relative of jsonPaths) {
    const parts = relative.split("/");
    const leaf = parts.at(-1)!;
    const isChatPath = parts[0] === "chats" || parts[0] === "archive";
    if (isChatPath && (parts.length !== 2 || (!leaf.endsWith(".json") && !leaf.endsWith(".md")))) throw new Error("Backup contains an invalid chat storage path.");
    const isChatRecord = isChatPath && leaf.endsWith(".json");
    const isChatTranscript = isChatPath && leaf.endsWith(".md");
    if (isChatRecord || isChatTranscript) {
      const fileId = leaf.slice(0, isChatRecord ? -5 : -3);
      const baseId = parts[0] === "archive" ? archiveBaseChatId(fileId) : isValidChatId(fileId) ? fileId : null;
      if (!baseId) throw new Error("Backup contains an invalid chat/archive identifier.");
    }
    if (isChatRecord) {
      const fileId = leaf.slice(0, -5);
      const baseId = parts[0] === "archive" ? archiveBaseChatId(fileId) : isValidChatId(fileId) ? fileId : null;
      if (!baseId) throw new Error("Backup contains an invalid chat/archive identifier.");
      const record = JSON.parse(await fsp.readFile(path.join(root, ...parts), "utf8")) as Record<string, unknown>;
      if (!record || typeof record !== "object" || !isValidChatId(record.id) || record.id !== baseId || !Array.isArray(record.messages) || !Array.isArray(record.timeline)) throw new Error("Backup contains an invalid chat record.");
    }
    if (relative === "tasks.json") {
      const tasks = JSON.parse(await fsp.readFile(path.join(root, ...parts), "utf8")) as unknown;
      if (!validTasksDocument(tasks)) throw new Error("Backup tasks document has an invalid schema.");
    }
    if (relative === "plugins.json") {
      const plugins = JSON.parse(await fsp.readFile(path.join(root, ...parts), "utf8")) as unknown;
      if (!validPluginsDocument(plugins)) throw new Error("Backup plugin registry has an invalid schema.");
    }
  }
  return { files: entries, bytes };
}

/** Replace a data root only after staging validation; restore the prior root if the second rename fails. */
export async function swapDataRoot(
  root: string,
  staging: string,
  backup: string,
  rename: (from: string, to: string) => Promise<void> = (from, to) => fsp.rename(from, to),
): Promise<string> {
  const parent = path.resolve(path.dirname(root));
  if (path.resolve(path.dirname(staging)) !== parent || path.resolve(path.dirname(backup)) !== parent || new Set([root, staging, backup].map((p) => path.resolve(p))).size !== 3) throw new Error("Restore paths must be distinct siblings.");
  const stageStat = await fsp.lstat(staging);
  const rootStat = await fsp.lstat(root);
  if (!stageStat.isDirectory() || stageStat.isSymbolicLink() || !rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Restore paths must be plain directories.");
  try {
    await fsp.lstat(backup);
    throw new Error("Restore backup destination already exists (including links).");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let movedOriginal = false;
  try {
    await rename(root, backup);
    movedOriginal = true;
    await rename(staging, root);
    return backup;
  } catch (error) {
    if (movedOriginal) {
      try {
        await rename(backup, root);
      } catch (rollbackError) {
        throw new RestoreRecoveryError(`Restore failed and rollback failed: ${(rollbackError as Error).message}. Restart only after recovering the previous data root.`);
      }
    }
    throw error;
  }
}

const APP_NAME = "XtracsysCode";
const DEFAULT_DATA_ROOT = path.join(os.homedir(), APP_NAME);
const BOOTSTRAP_FILE = bootstrapFile(APP_NAME);

export interface StorageCaps {
  /** Max size of a single log file before rotation. */
  logMaxBytes: number;
  /** Total cap across chats/<id>.json + .md; oldest transcripts pruned first. */
  chatsMaxBytes: number;
  /** Transcripts older than this are deleted. */
  keepChatDays: number;
  /** Wipe tmp when it exceeds this. */
  tmpMaxBytes: number;
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
  /** Requested context window for the model. 0/undefined = backend default. */
  numCtx?: number;
  /** Sampling temperature. Undefined = backend default (0 is a valid explicit value). */
  temperature?: number;
  /** Desktop notification on turn/task completion. Default on. */
  notifyOnCompletion?: boolean;
  /** M4: scaffold AGENTS.md/.xtracsys.md into newly created projects. Default on. */
  scaffoldOnCreate?: boolean;
  /** P4: appearance — accent preset + reduce motion. */
  appearance?: { accent: string; reduceMotion: boolean };
  /** P6: automatic daily backups into ~/XtracsysCode/backups. */
  backups?: { daily: boolean; keep: number; lastRun?: number };
  /** P7: last session — index 0 is the main window's active chat, the rest are open chat windows. */
  session?: { openChats: string[] };
  /** M2: persisted layout prefs (applies to every window). */
  layout?: {
    sidebarWidth: number;
    inspectorWidth: number;
    composerHeight: number;
    sidebarCollapsed: boolean;
    inspectorCollapsed: boolean;
  };
  caps: StorageCaps;
}

export const DEFAULT_CAPS: StorageCaps = {
  logMaxBytes: 5 * 1024 * 1024,
  chatsMaxBytes: 200 * 1024 * 1024,
  keepChatDays: 90,
  tmpMaxBytes: 100 * 1024 * 1024,
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  dataRoot: DEFAULT_DATA_ROOT,
  provider: "ollama",
  ollamaUrl: "http://127.0.0.1:11434",
  llamaCppUrl: "http://127.0.0.1:8080",
  openAICompatibleUrl: "http://127.0.0.1:8080",
  model: "",
  approvalMode: "ask",
  maxSteps: 24,
  historyCharBudget: 80_000,
  systemPromptExtra: "",
  caps: { ...DEFAULT_CAPS },
};

function readBootstrap(): string | null {
  try {
    const v = fs.readFileSync(BOOTSTRAP_FILE, "utf8").trim();
    return v && fs.existsSync(v) ? v : null;
  } catch {
    return null;
  }
}

function writeBootstrap(root: string): void {
  try {
    fs.mkdirSync(path.dirname(BOOTSTRAP_FILE), { recursive: true });
    fs.writeFileSync(BOOTSTRAP_FILE, root, "utf8");
  } catch {
    /* non-fatal */
  }
}

export class Storage {
  readonly restoreBarrier = new RestoreBarrier();
  readonly root: string;
  settings: Settings;

  constructor(root?: string) {
    this.root = root ?? readBootstrap() ?? DEFAULT_DATA_ROOT;
    if (!root) writeBootstrap(this.root);
    // The data root holds full chat transcripts, tool output and settings — it must
    // not be readable by other local accounts (matches the restore path's hardening).
    try { fs.mkdirSync(this.root, { recursive: true, mode: 0o700 }); } catch { /* exists */ }
    try { fs.chmodSync(this.root, 0o700); } catch { /* external volumes may not support it */ }
    for (const sub of ["chats", "logs", "tmp", "archive", "skills", "plugins"]) {
      fs.mkdirSync(this.dir(sub as "chats"), { recursive: true, mode: 0o700 });
    }
    this.settings = this.loadSettings();
  }

  dir(sub: "chats" | "logs" | "tmp" | "archive" | "skills" | "plugins" | ""): string {
    return sub ? path.join(this.root, sub) : this.root;
  }

  private loadSettings(): Settings {
    const file = path.join(this.root, "settings.json");
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Settings>;
      return {
        ...DEFAULT_SETTINGS,
        ...raw,
        caps: { ...DEFAULT_CAPS, ...(raw.caps ?? {}) },
        dataRoot: this.root,
      };
    } catch {
      return { ...DEFAULT_SETTINGS, dataRoot: this.root };
    }
  }

  async saveSettings(patch?: Partial<Settings>): Promise<Settings> {
    return this.restoreBarrier.run("settings persistence", async () => {
    if (patch) this.settings = { ...this.settings, ...patch, caps: { ...this.settings.caps, ...(patch.caps ?? {}) } };
    await this.writeJsonAtomic(path.join(this.root, "settings.json"), this.settings);
    return this.settings;
    });
  }

  /** Atomic JSON write: temp file in the same dir + rename. Records are private to
   *  the user — write the temp file 0600 so a crash between write and rename cannot
   *  leave a world-readable copy behind. */
  async writeJsonAtomic(file: string, value: unknown): Promise<void> {
    return this.restoreBarrier.run("JSON persistence", async () => {
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    await fsp.rename(tmp, file);
    });
  }

  readJson<T>(file: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    } catch {
      return null;
    }
  }

  // ---------- logs ----------
  logFile(): string {
    return path.join(this.dir("logs"), "xtrac.log");
  }

  log(line: string): void {
    // Native window/console events can arrive during relaunch. Never write the new root.
    if (this.restoreBarrier.blocked) return;
    try {
      const file = this.logFile();
      const entry = `[${new Date().toISOString()}] ${line}\n`;
      if (fs.existsSync(file) && fs.statSync(file).size > this.settings.caps.logMaxBytes) {
        fs.renameSync(file, file + ".1");
      }
      fs.appendFileSync(file, entry, "utf8");
    } catch {
      /* never crash on logging */
    }
  }

  readLogs(): string {
    try {
      return fs.readFileSync(this.logFile(), "utf8").split("\n").slice(-400).join("\n");
    } catch {
      return "";
    }
  }

  // ---------- generic json docs (projects, tasks) ----------
  loadDoc<T>(name: string, fallback: T): T {
    return this.readJson<T>(path.join(this.root, name)) ?? fallback;
  }

  saveDoc(name: string, value: unknown): Promise<void> {
    return this.writeJsonAtomic(path.join(this.root, name), value);
  }

  private recordPath(folder: "chats" | "archive", id: string, ext: ".json" | ".md"): string {
    const valid = folder === "chats" ? isValidChatId(id) : isValidArchiveId(id);
    if (!valid) throw new Error(`Invalid ${folder === "chats" ? "chat" : "archive"} identifier.`);
    const rootReal = fs.realpathSync(this.root);
    const expectedDir = path.join(rootReal, folder);
    const actualDir = fs.realpathSync(path.join(this.root, folder));
    if (actualDir !== expectedDir) throw new Error(`The ${folder} directory must not be a symlink.`);
    const target = path.resolve(actualDir, `${id}${ext}`);
    if (path.dirname(target) !== actualDir) throw new Error(`Invalid ${folder} path.`);
    try {
      const st = fs.lstatSync(target);
      if (st.isSymbolicLink() || !st.isFile() || st.nlink > 1) throw new Error(`Unsafe ${folder} record path.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return target;
  }

  // ---------- chat files ----------
  chatJson(id: string): string {
    return this.recordPath("chats", id, ".json");
  }

  chatMd(id: string): string {
    return this.recordPath("chats", id, ".md");
  }

  archivePath(id: string, ext: ".json" | ".md"): string {
    return this.recordPath("archive", id, ext);
  }

  archiveJson(id: string): string {
    return this.archivePath(id, ".json");
  }

  archiveMd(id: string): string {
    return this.archivePath(id, ".md");
  }

  listChatIds(): string[] {
    try {
      return fs
        .readdirSync(this.dir("chats"))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
        .filter((id) => isValidChatId(id))
        .filter((id) => {
          try {
            this.chatJson(id);
            return true;
          } catch {
            return false;
          }
        });
    } catch {
      return [];
    }
  }

  async deleteChat(id: string): Promise<void> {
    return this.restoreBarrier.run("chat deletion", async () => {
    const json = this.chatJson(id);
    const md = this.chatMd(id);
    await Promise.allSettled([fsp.rm(json, { force: true }), fsp.rm(md, { force: true })]);
    });
  }

  // ---------- cleanup (enforced, not optional) ----------
  async cleanup(): Promise<CleanupReport> {
    // Timer/launch callers intentionally skip NEW maintenance during a restore;
    // IPC callers are rejected at admission. Previously accepted cleanup is tracked.
    if (this.restoreBarrier.blocked) return { tmpDeleted: 0, agedDeleted: 0, prunedDeleted: 0, bytesFreed: 0 };
    return this.restoreBarrier.run("storage cleanup", () => this.performCleanup());
  }

  private async performCleanup(): Promise<CleanupReport> {
    const report: CleanupReport = { tmpDeleted: 0, agedDeleted: 0, prunedDeleted: 0, bytesFreed: 0 };
    const caps = this.settings.caps;

    // 1. tmp: wipe everything older than 24h; wipe all if over cap.
    try {
      const entries = await fsp.readdir(this.dir("tmp"), { withFileTypes: true });
      const now = Date.now();
      let tmpBytes = 0;
      const stats: { path: string; mtime: number; size: number }[] = [];
      for (const e of entries) {
        const p = path.join(this.dir("tmp"), e.name);
        try {
          const st = await fsp.stat(p);
          tmpBytes += st.size;
          stats.push({ path: p, mtime: st.mtimeMs, size: st.size });
        } catch {
          /* ignore */
        }
      }
      if (tmpBytes > caps.tmpMaxBytes) {
        for (const s of stats) {
          await fsp.rm(s.path, { recursive: true, force: true });
          report.tmpDeleted++;
          report.bytesFreed += s.size;
        }
      } else {
        for (const s of stats) {
          if (now - s.mtime > 24 * 3600 * 1000) {
            await fsp.rm(s.path, { recursive: true, force: true });
            report.tmpDeleted++;
            report.bytesFreed += s.size;
          }
        }
      }
    } catch {
      /* ignore */
    }

    // 1b. Crash-orphaned atomic-write temp files in the ROOT (".name.pid.ts.rand.tmp")
    // retain full record contents forever unless swept; they are written 0600 now, but
    // older copies may exist. Only age-based removal, so in-flight writes are untouched.
    try {
      const rootEntries = await fsp.readdir(this.root, { withFileTypes: true });
      const nowMs = Date.now();
      for (const e of rootEntries) {
        if (!e.isFile() || !e.name.startsWith(".") || !e.name.endsWith(".tmp")) continue;
        const p = path.join(this.root, e.name);
        try {
          const st = await fsp.stat(p);
          if (nowMs - st.mtimeMs > 24 * 3600 * 1000) {
            await fsp.rm(p, { force: true });
            report.tmpDeleted++;
            report.bytesFreed += st.size;
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }

    // 2. chat age cap.
    const now = Date.now();
    const maxAgeMs = caps.keepChatDays * 24 * 3600 * 1000;
    const chatFiles: { id: string; file: string; size: number; mtime: number }[] = [];
    for (const id of this.listChatIds()) {
      const file = this.chatJson(id);
      try {
        const st = await fsp.stat(file);
        chatFiles.push({ id, file, size: st.size, mtime: st.mtimeMs });
        if (now - st.mtimeMs > maxAgeMs) {
          const md = await fsp.stat(this.chatMd(id)).catch(() => null);
          report.bytesFreed += st.size + (md?.size ?? 0);
          await this.deleteChat(id);
          report.agedDeleted++;
        }
      } catch {
        /* ignore */
      }
    }

    // 3. total size cap: prune oldest until under budget.
    let total = 0;
    const survivors: { id: string; jsonBytes: number; mdBytes: number; mtime: number }[] = [];
    for (const cf of chatFiles) {
      if (!fs.existsSync(cf.file)) continue;
      const mdStat = await fsp.stat(this.chatMd(cf.id)).catch(() => null);
      const bytes = cf.size + (mdStat?.size ?? 0);
      total += bytes;
      survivors.push({ id: cf.id, jsonBytes: cf.size, mdBytes: mdStat?.size ?? 0, mtime: cf.mtime });
    }
    survivors.sort((a, b) => a.mtime - b.mtime);
    while (total > caps.chatsMaxBytes && survivors.length > 0) {
      const oldest = survivors.shift()!;
      await this.deleteChat(oldest.id);
      total -= oldest.jsonBytes + oldest.mdBytes;
      report.bytesFreed += oldest.jsonBytes + oldest.mdBytes;
      report.prunedDeleted++;
    }

    this.log(
      `cleanup: tmp=${report.tmpDeleted} aged=${report.agedDeleted} pruned=${report.prunedDeleted} freed=${report.bytesFreed}`,
    );
    return report;
  }

  // ---------- storage usage ----------
  async usage(): Promise<StorageUsage> {
    const breakdown: Record<string, number> = { chats: 0, logs: 0, tmp: 0, other: 0 };
    const walk = async (dir: string, key: string, depth: number): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (depth < 6) await walk(p, key, depth + 1);
        } else {
          try {
            breakdown[key] += (await fsp.stat(p)).size;
          } catch {
            /* ignore */
          }
        }
      }
    };
    await walk(this.dir("chats"), "chats", 0);
    await walk(this.dir("logs"), "logs", 0);
    await walk(this.dir("tmp"), "tmp", 0);
    await walk(this.root, "other", 0);
    const total = breakdown.chats + breakdown.logs + breakdown.tmp + breakdown.other;
    const chatCount = this.listChatIds().length;
    return { total, breakdown, chatCount, root: this.root, caps: this.settings.caps };
  }
}

export interface CleanupReport {
  tmpDeleted: number;
  agedDeleted: number;
  prunedDeleted: number;
  bytesFreed: number;
}

export interface StorageUsage {
  total: number;
  breakdown: Record<string, number>;
  chatCount: number;
  root: string;
  caps: StorageCaps;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
