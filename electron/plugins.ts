/**
 * Local plugins (v5 Phase D) — a narrow v1 on top of the existing stdio MCP machinery.
 *
 * A plugin is an app-managed manifest/configuration for a LOCAL tool process, not code
 * injected into Electron. There is no marketplace, no renderer-code loading, no eval,
 * no remote URLs, no automatic package installation.
 *
 * Layout:
 *   <root>/plugins.json                    — registry (one record per imported plugin)
 *   <root>/plugins/<id>/plugin.json        — the app-managed copy of the manifest
 *
 * Import copies ONLY the manifest; the entry process keeps running from its original
 * folder (recorded as sourcePath). Plugins are DISABLED on import and only spawn after
 * an explicit enable, which the UI gates behind a capability/command review.
 * Consent also binds the bounded original source tree (see pluginSource.ts).
 * Source updates require fresh review; external dependencies and check-to-spawn
 * races are not covered. Running plugin processes are not revoked by a later edit.
 *
 * Trust boundary (stated plainly, not hidden): an enabled plugin is an ordinary local
 * process. It is NOT sandboxed — it can generally do anything its user account can do.
 * A plugin's declared "tools"/"capabilities" are metadata for review, not a security
 * guarantee; its tools are approval-gated per call in ask-mode chats only — in
 * auto-approval chats they run without per-call approval. Plugins receive
 * no network permission from the app: if their process uses the network, that is the
 * process's own doing and outside the app's control.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pluginSourceIdentity } from "./pluginSource";
import type { Storage } from "./storage";
import type { McpServerConfig } from "./agent/mcp";

export const PLUGIN_LIMITS = {
  maxPlugins: 25,
  maxManifestBytes: 64 * 1024,
  maxLogChars: 20_000,
};

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Entry command + args, run with cwd = the plugin's source folder. */
  entry: { command: string; args: string[] };
  /** Declared tools (metadata for review; the live set comes from tools/list). */
  tools?: string[];
  /** Declared capabilities (metadata only — NOT enforcement). */
  capabilities?: string[];
}

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  entry: { command: string; args: string[] };
  tools: string[];
  capabilities: string[];
  enabled: boolean;
  /** Projects this plugin is available to; null = every project. */
  projectId: string | null;
  /** Whether the user has seen the command review before first activation. */
  reviewed: boolean;
  /** Hash binding consent to launch metadata AND the bounded original source tree. */
  reviewedLaunchHash?: string;
  sourcePath: string;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export class PluginError extends Error {}

const ID_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;

export function pluginsDir(storage: Storage): string {
  return path.join(storage.root, "plugins");
}

function validateManifest(raw: unknown, sourcePath: string): PluginManifest {
  if (typeof raw !== "object" || raw == null) throw new PluginError("plugin.json must be a JSON object.");
  const m = raw as Record<string, unknown>;
  const id = String(m.id ?? "").trim();
  if (!ID_RE.test(id)) throw new PluginError(`plugin.json needs an "id" of 3–64 chars (lowercase letters, digits, - and _).`);
  const name = String(m.name ?? "").trim();
  if (!name) throw new PluginError(`plugin.json needs a "name".`);
  const version = String(m.version ?? "0.0.0").trim().slice(0, 40);
  const description = String(m.description ?? "").trim();
  if (!description) throw new PluginError(`plugin.json needs a "description" so the review dialog can explain what this process is.`);
  const entry = m.entry as { command?: unknown; args?: unknown } | undefined;
  const command = typeof entry?.command === "string" ? entry.command.trim() : "";
  if (!command) throw new PluginError(`plugin.json needs entry.command (the local process to spawn).`);
  if (command.includes("..") || /^https?:/i.test(command)) {
    throw new PluginError("entry.command must be a local executable, not a URL or relative climb.");
  }
  const args = Array.isArray(entry?.args) ? entry.args.map((a) => String(a)).slice(0, 32) : [];
  const tools = Array.isArray(m.tools) ? m.tools.map((t) => String(t)).slice(0, 64) : [];
  const capabilities = Array.isArray(m.capabilities) ? m.capabilities.map((c) => String(c)).slice(0, 16) : [];
  return { id, name, description, version, entry: { command, args }, tools, capabilities };
}

export class PluginStore {
  constructor(private storage: Storage) {}

  private get registry(): PluginRecord[] {
    if (!this._cache) this._cache = this.storage.loadDoc<PluginRecord[]>("plugins.json", []);
    return this._cache;
  }
  private _cache: PluginRecord[] | null = null;
  private invalidate() {
    this._cache = null;
  }

  list(): PluginRecord[] {
    return [...this.registry]
      .map((record) => {
        const reviewed = this.hasReviewedLaunch(record.id);
        // Effective state for UI/runtime: stale consent must never look enabled.
        return { ...record, reviewed, enabled: record.enabled && reviewed };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): PluginRecord | null {
    return this.registry.find((p) => p.id === id) ?? null;
  }

  private async save(records: PluginRecord[]): Promise<void> {
    this._cache = records;
    await this.storage.saveDoc("plugins.json", records);
  }

  /**
   * Import a plugin folder (must contain plugin.json). Copies only the manifest into
   * the app-managed store. Never executes anything. Newly imported plugins are disabled.
   */
  async importFrom(sourcePath: string): Promise<PluginRecord> {
    const src = await fsp.realpath(path.resolve(sourcePath));
    const manifestPath = path.join(src, "plugin.json");
    if (!fs.existsSync(manifestPath)) throw new PluginError("That folder has no plugin.json manifest.");
    const st = fs.lstatSync(manifestPath);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw new PluginError("plugin.json must be a regular file, not a link.");
    if (st.size > PLUGIN_LIMITS.maxManifestBytes) throw new PluginError("plugin.json exceeds the 64 KB limit.");
    let raw: unknown;
    try {
      raw = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    } catch (e) {
      throw new PluginError("plugin.json is not valid JSON: " + (e as Error).message);
    }
    const manifest = validateManifest(raw, src);
    const records = this.registry;
    if (records.length >= PLUGIN_LIMITS.maxPlugins) throw new PluginError(`Plugin list is full (max ${PLUGIN_LIMITS.maxPlugins}).`);
    if (records.some((p) => p.id === manifest.id)) throw new PluginError(`A plugin with id "${manifest.id}" already exists.`);
    const srcReal = await fsp.realpath(src);
    // Resolve the entry script (if relative) against the source folder so review can show the truth.
    const record: PluginRecord = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      entry: manifest.entry,
      tools: manifest.tools ?? [],
      capabilities: manifest.capabilities ?? [],
      enabled: false,
      projectId: null,
      reviewed: false,
      sourcePath: srcReal,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const dest = path.join(pluginsDir(this.storage), manifest.id);
    await fsp.mkdir(dest, { recursive: true });
    await fsp.writeFile(path.join(dest, "plugin.json"), JSON.stringify(manifest, null, 2), "utf8");
    records.push(record);
    await this.save(records);
    this.storage.log(`plugin imported (disabled): ${record.id} from ${srcReal}`);
    return record;
  }

  /** Enable/disable. Enabling requires a current, main-process-reviewed launch descriptor. */
  async setEnabled(id: string, enabled: boolean): Promise<PluginRecord> {
    const records = this.registry;
    const rec = records.find((p) => p.id === id);
    if (!rec) throw new PluginError("Unknown plugin: " + id);
    if (enabled && !this.hasReviewedLaunch(id)) throw new PluginError("Review and consent to this command, working directory and current source contents before enabling this plugin.");
    rec.enabled = enabled;
    rec.lastError = undefined;
    rec.updatedAt = Date.now();
    await this.save(records);
    this.storage.log(`plugin ${rec.id} ${enabled ? "enabled" : "disabled"}`);
    return rec;
  }

  async setScope(id: string, projectId: string | null): Promise<PluginRecord> {
    const records = this.registry;
    const rec = records.find((p) => p.id === id);
    if (!rec) throw new PluginError("Unknown plugin: " + id);
    rec.projectId = projectId;
    rec.updatedAt = Date.now();
    await this.save(records);
    return rec;
  }

  /** Remove the app-managed manifest/record only — the original source folder is untouched. */
  async remove(id: string): Promise<void> {
    const records = this.registry.filter((p) => p.id !== id);
    if (records.length === this.registry.length) throw new PluginError("Unknown plugin: " + id);
    await this.save(records);
    await fsp.rm(path.join(pluginsDir(this.storage), id), { recursive: true, force: true });
  }

  /** Mark the exact current manifest reviewed after the main process obtains explicit consent. */
  async markReviewed(id: string, consent: boolean, expectedHash: string): Promise<PluginRecord> {
    if (consent !== true) throw new PluginError("Explicit main-process consent is required to review this plugin.");
    const records = this.registry;
    const rec = records.find((p) => p.id === id);
    if (!rec) throw new PluginError("Unknown plugin: " + id);
    const launch = this.resolveLaunchConfig(rec);
    const hash = this.reviewedHash(rec, launch);
    if (!expectedHash || hash !== expectedHash) throw new PluginError("Plugin source or launch details changed during review; review it again before running.");
    rec.reviewed = true;
    rec.reviewedLaunchHash = hash;
    rec.updatedAt = Date.now();
    await this.save(records);
    return rec;
  }

  private reviewedHash(rec: PluginRecord, launch: McpServerConfig): string {
    const reviewed = {
      id: rec.id,
      name: rec.name,
      description: rec.description,
      tools: rec.tools,
      capabilities: rec.capabilities,
      version: rec.version,
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      source: this.sourceIdentity(launch.cwd!),
    };
    return createHash("sha256").update(JSON.stringify(reviewed)).digest("hex");
  }

  private sourceIdentity(source: string): string {
    try { return pluginSourceIdentity(source); }
    catch (error) { throw new PluginError(`Plugin source cannot be reviewed: ${(error as Error).message}`); }
  }

  launchReview(id: string): { launch: McpServerConfig; token: string } {
    const rec = this.get(id);
    if (!rec) throw new PluginError("Unknown plugin: " + id);
    const launch = this.resolveLaunchConfig(rec);
    return { launch, token: this.reviewedHash(rec, launch) };
  }

  hasReviewedLaunch(id: string): boolean {
    const rec = this.get(id);
    if (!rec?.reviewed || !rec.reviewedLaunchHash) return false;
    try {
      return this.reviewedHash(rec, this.resolveLaunchConfig(rec)) === rec.reviewedLaunchHash;
    } catch {
      return false;
    }
  }

  /** Resolve the reviewed command and its source cwd identically for test and runtime. */
  launchConfig(id: string, requireEnabled = false): McpServerConfig {
    const rec = this.get(id);
    if (!rec) throw new PluginError("Unknown plugin: " + id);
    if (requireEnabled && !rec.enabled) throw new PluginError("Plugin is disabled.");
    const launch = this.resolveLaunchConfig(rec);
    if (!rec.reviewed || !rec.reviewedLaunchHash || this.reviewedHash(rec, launch) !== rec.reviewedLaunchHash) throw new PluginError("Review and consent to this command, working directory and current source contents before running this plugin.");
    return launch;
  }

  private resolveLaunchConfig(rec: PluginRecord): McpServerConfig {
    let cwd: string;
    try {
      cwd = fs.realpathSync(rec.sourcePath);
      if (!fs.statSync(cwd).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new PluginError(`Plugin source folder is unavailable: ${rec.sourcePath}`);
    }
    let command = rec.entry.command;
    if (!path.isAbsolute(command) && (command.startsWith(".") || /[\\/]/.test(command))) {
      const target = path.resolve(cwd, command);
      try {
        command = fs.realpathSync(target);
        if (!fs.statSync(command).isFile()) throw new Error("not a file");
      } catch {
        throw new PluginError(`Plugin executable is unavailable: ${target}`);
      }
    }
    const args = [...rec.entry.args];
    const runnerName = path.basename(command).toLowerCase();
    const scriptRunner = /^(node|node\.exe|bun|deno|python(?:[0-9]+(?:\.[0-9]+)*)?(?:\.exe)?|ruby|php)$/.test(runnerName);
    if (args[0] && !args[0].startsWith("-") && (scriptRunner || path.isAbsolute(args[0]) || args[0].startsWith(".") || /[\\/]/.test(args[0]))) {
      const target = path.isAbsolute(args[0]) ? args[0] : path.resolve(cwd, args[0]);
      try {
        args[0] = fs.realpathSync(target);
        if (!fs.statSync(args[0]).isFile()) throw new Error("not a file");
        const relative = path.relative(cwd, args[0]);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("outside source review boundary");
      } catch {
        throw new PluginError(`Plugin entry target is unavailable: ${target}`);
      }
    }
    return { name: rec.id, command, args, cwd };
  }

  /** MCP configs for reviewed, enabled plugins available to a project. */
  mcpConfigsFor(projectId: string): McpServerConfig[] {
    return this.list()
      .filter((p) => p.enabled && p.reviewed && (p.projectId === null || p.projectId === projectId))
      .map((p) => this.launchConfig(p.id, true));
  }

  /** Spawn cwd for a plugin; a missing source is always an error, never a project-cwd fallback. */
  cwdFor(rec: PluginRecord): string {
    return this.launchConfig(rec.id).cwd!;
  }
}
