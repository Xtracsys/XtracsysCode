/**
 * Minimal MCP (Model Context Protocol) client for LOCAL stdio servers only.
 * The client speaks newline-delimited JSON-RPC 2.0 over a spawned child process:
 *   initialize → initialized → tools/list → tools/call
 * The transport is stdio; the child process is not sandboxed and may use the
 * network privileges of the account. Servers are spawned per turn and stopped afterwards.
 */
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { childEnv } from "../platform";

export const MCP_LIMITS = { maxServers: 8, maxPending: 32, maxLineChars: 1_048_576, maxOutputChars: 65_536, maxTotalOutputChars: 16_777_216, maxTools: 128 } as const;

export function boundMcpOutput(text: string, max: number = MCP_LIMITS.maxOutputChars): string {
  const limit = Math.max(0, Math.floor(max));
  if (text.length <= limit) return text;
  if (limit === 0) return "";
  const marker = `\n… [MCP output truncated at ${limit} chars]`;
  const suffix = marker.length <= limit ? marker : "…".slice(0, limit);
  return text.slice(0, limit - suffix.length) + suffix;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  /** Plugin launch descriptors bind each child to the reviewed source directory. */
  cwd?: string;
}

export interface McpTool {
  server: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface Conn {
  name: string;
  child: ChildProcessWithoutNullStreams;
  pending: Map<number, Pending>;
  buffer: string;
  nextId: number;
  tools: McpTool[];
  started: boolean;
  outputChars: number;
  signal?: AbortSignal;
  abortHandler?: () => void;
  stopping?: Promise<void>;
  cleanup?: () => void;
}

const PROTOCOL_VERSION = "2024-11-05";
const REQUEST_TIMEOUT_MS = 30_000;
const START_TIMEOUT_MS = 15_000;

function alive(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!alive(child)) return resolve(true);
    const finish = () => {
      clearTimeout(timer);
      child.removeListener("exit", finish);
      resolve(!alive(child));
    };
    const timer = setTimeout(finish, ms);
    child.once("exit", finish);
  });
}

/** taskkill is a subprocess, not a synchronous tree-termination guarantee. */
async function windowsTerminate(child: ChildProcess): Promise<string | undefined> {
  if (!child.pid) return undefined;
  if (!alive(child)) return "Windows direct child already exited; descendant termination is unconfirmed";
  let killer: ChildProcess;
  try { killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
  catch (e) { return `Windows taskkill failed: ${(e as Error).message}`; }
  let failure: string | undefined;
  const onError = (e: Error) => { failure = `Windows taskkill failed: ${e.message}`; };
  killer.on("error", onError);
  try {
    const completed = await new Promise<boolean>((resolve) => {
      const done = () => { cleanup(); resolve(true); };
      const timer = setTimeout(() => { cleanup(); resolve(false); }, 1_000);
      const cleanup = () => {
        clearTimeout(timer);
        killer.removeListener("exit", done);
        killer.removeListener("error", done);
      };
      killer.once("exit", done);
      killer.once("error", done);
    });
    if (!completed) {
      failure = "Windows taskkill timed out; descendant termination is unconfirmed";
      try { killer.kill("SIGKILL"); } catch { /* reported below */ }
      if (!await waitForExit(killer, 500)) {
        failure += "; taskkill helper is still running";
        killer.unref();
      }
    }
    if (failure) return failure;
    if (killer.exitCode !== 0) return `Windows taskkill exited (${killer.exitCode}); descendant termination is unconfirmed`;
    return undefined;
  } finally {
    if (!alive(killer)) killer.removeListener("error", onError);
    else killer.once("close", () => killer.removeListener("error", onError));
  }
}

export class McpManager {
  private conns = new Map<string, Conn>();
  private stopEpoch = 0;
  private stoppingAll?: Promise<string[]>;
  private shutdownIssues: string[] = [];

  /** Spawn + initialize configured servers. Startup work is abortable and config count is bounded. */
  async start(configs: McpServerConfig[], cwd = process.cwd(), signal?: AbortSignal): Promise<string[]> {
    if (this.stoppingAll) return ["MCP shutdown is in progress."];
    const epoch = this.stopEpoch;
    const errors: string[] = [];
    if (configs.length > MCP_LIMITS.maxServers) errors.push(`MCP server limit is ${MCP_LIMITS.maxServers}.`);
    for (const cfg of configs.slice(0, MCP_LIMITS.maxServers)) {
      if (signal?.aborted || epoch !== this.stopEpoch) break;
      const name = String(cfg.name || "server").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
      if (!cfg.command || this.conns.has(name)) continue;
      try {
        const conn = await this.startOne(name, cfg, cwd, signal);
        if (signal?.aborted || conn.stopping || epoch !== this.stopEpoch || conn.child.exitCode !== null || conn.child.signalCode !== null) {
          await this.stopConnection(conn);
          if (signal?.aborted) break;
          errors.push(`${name}: process exited during startup`);
          continue;
        }
        this.conns.set(name, conn);
      } catch (e) {
        errors.push(`${name}: ${boundMcpOutput((e as Error).message, 500)}`);
        if (signal?.aborted || epoch !== this.stopEpoch) break;
      }
    }
    return errors;
  }

  private startOne(name: string, cfg: McpServerConfig, cwd: string, signal?: AbortSignal): Promise<Conn> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("MCP startup cancelled"));
        return;
      }
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(cfg.command, cfg.args ?? [], {
          cwd: cfg.cwd ?? cwd,
          env: childEnv(), // least privilege: no inherited cloud/CI tokens
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
      } catch (e) {
        reject(new Error(`spawn failed: ${(e as Error).message}`));
        return;
      }
      const conn: Conn = {
        name,
        child,
        pending: new Map(),
        buffer: "",
        nextId: 1,
        tools: [],
        started: false,
        outputChars: 0,
        signal,
      };
      // Track from spawn, not only after tools/list: stopAll must own startup too.
      this.conns.set(name, conn);
      let settled = false;
      const failStart = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        void this.stopConnection(conn).then(() => reject(error), () => reject(error));
      };
      const failConnection = (error: Error) => {
        if (conn.started) void this.stopConnection(conn);
        else failStart(error);
      };
      const failTimer = setTimeout(() => {
        failStart(new Error(`server "${name}" did not initialize within ${START_TIMEOUT_MS / 1000}s`));
      }, START_TIMEOUT_MS);
      conn.abortHandler = () => {
        failConnection(new Error("MCP startup cancelled"));
      };
      signal?.addEventListener("abort", conn.abortHandler, { once: true });
      const onError = (e: Error) => failConnection(new Error(`MCP process error: ${e.message}`));
      child.on("error", onError);
      const onStdinError = (e: Error) => failConnection(new Error(`MCP stdin error: ${e.message}`));
      child.stdin.on("error", onStdinError);
      child.stdout.setEncoding("utf8");
      const onStdout = (chunk: string) => {
        if (conn.stopping) return;
        conn.outputChars += chunk.length;
        if (conn.outputChars > MCP_LIMITS.maxTotalOutputChars) {
          failConnection(new Error("MCP server exceeded the total output limit."));
          return;
        }
        let pending = conn.buffer + chunk;
        let idx: number;
        while ((idx = pending.indexOf("\n")) >= 0) {
          const rawLine = pending.slice(0, idx);
          pending = pending.slice(idx + 1);
          if (rawLine.length > MCP_LIMITS.maxLineChars) {
            failConnection(new Error("MCP server response exceeded the line limit."));
            return;
          }
          const line = rawLine.trim();
          if (!line) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
          const msg = parsed as { id?: number; result?: unknown; error?: unknown; method?: string };
          if (typeof msg.id === "number" && conn.pending.has(msg.id)) {
            const rpcError = typeof msg.error === "object" && msg.error !== null ? (msg.error as { message?: unknown }) : null;
            const errorMessage = typeof rpcError?.message === "string" ? rpcError.message : "MCP error";
            this.settle(conn, msg.id, msg.result, msg.error ? new Error(boundMcpOutput(errorMessage, 500)) : undefined);
          }
        }
        if (pending.length > MCP_LIMITS.maxLineChars) {
          failConnection(new Error("MCP server response exceeded the line limit."));
          return;
        }
        conn.buffer = pending;
      };
      child.stdout.on("data", onStdout);
      child.stderr.setEncoding("utf8");
      const onStderr = (chunk: string) => {
        if (conn.stopping) return;
        conn.outputChars += chunk.length;
        if (conn.outputChars > MCP_LIMITS.maxTotalOutputChars) failConnection(new Error("MCP server exceeded the total output limit."));
      };
      child.stderr.on("data", onStderr);
      const onExit = (code: number | null) => {
        clearTimeout(failTimer);
        signal?.removeEventListener("abort", conn.abortHandler!);
        this.rejectPending(conn, new Error(`MCP server "${name}" exited (code ${code})`));
        if (conn.started) void this.stopConnection(conn);
        else failStart(new Error(`MCP server "${name}" exited before initialization (code ${code})`));
      };
      child.on("exit", onExit);
      conn.cleanup = () => {
        clearTimeout(failTimer);
        signal?.removeEventListener("abort", conn.abortHandler!);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        child.stdout.removeListener("data", onStdout);
        child.stderr.removeListener("data", onStderr);
        // Keep the stdin error handler until destroy's pending error delivery.
        if (child.stdin.closed) child.stdin.removeListener("error", onStdinError);
        else child.stdin.once("close", () => child.stdin.removeListener("error", onStdinError));
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        conn.buffer = "";
        conn.tools = [];
      };

      this.request(conn, "initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "XtracsysCode", version: "0.2.0" },
      }, signal)
        .then(() => {
          this.notify(conn, "notifications/initialized", {});
          return this.request(conn, "tools/list", {}, signal);
        })
        .then((result) => {
          if (settled || conn.stopping) throw new Error("MCP startup stopped");
          if (signal?.aborted) throw new Error("MCP startup cancelled");
          const rawTools = (result as { tools?: unknown })?.tools;
          const listed = Array.isArray(rawTools) ? rawTools.slice(0, MCP_LIMITS.maxTools) : [];
          conn.tools = listed
            .filter((t): t is { name: string; description?: string; inputSchema?: Record<string, unknown> } => typeof t === "object" && t !== null && typeof (t as { name?: unknown }).name === "string")
            .map((t) => ({
              server: name,
              name: t.name,
              description: boundMcpOutput(typeof t.description === "string" ? t.description : `MCP tool ${t.name}`, 2_000),
              inputSchema: t.inputSchema && typeof t.inputSchema === "object" && !Array.isArray(t.inputSchema) ? t.inputSchema : { type: "object", properties: {} },
            }));
          conn.started = true;
          settled = true;
          clearTimeout(failTimer);
          resolve(conn);
        })
        .catch((e) => failStart(e instanceof Error ? e : new Error(String(e))));
    });
  }

  private settle(conn: Conn, id: number, value?: unknown, error?: Error): void {
    const pending = conn.pending.get(id);
    if (!pending) return;
    conn.pending.delete(id);
    clearTimeout(pending.timer);
    if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
    if (error) pending.reject(error);
    else pending.resolve(value);
  }

  private rejectPending(conn: Conn, error: Error): void {
    for (const id of conn.pending.keys()) this.settle(conn, id, undefined, error);
  }

  private request(conn: Conn, method: string, params: unknown, signal = conn.signal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (conn.stopping || conn.child.exitCode !== null || conn.child.signalCode !== null || conn.child.stdin.destroyed) {
        reject(new Error(`MCP server "${conn.name}" is stopped`));
        return;
      }
      if (signal?.aborted) {
        reject(new Error("MCP request cancelled"));
        return;
      }
      if (conn.pending.size >= MCP_LIMITS.maxPending) {
        reject(new Error("MCP pending-request limit reached."));
        return;
      }
      const id = conn.nextId++;
      const timer = setTimeout(() => this.settle(conn, id, undefined, new Error(`MCP ${method} timed out`)), REQUEST_TIMEOUT_MS);
      const pending: Pending = { resolve, reject, timer, signal };
      if (signal) {
        pending.onAbort = () => this.settle(conn, id, undefined, new Error("MCP request cancelled"));
        signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      conn.pending.set(id, pending);
      try {
        const wire = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
        if (wire.length > MCP_LIMITS.maxLineChars) {
          this.settle(conn, id, undefined, new Error("MCP request exceeded the line limit."));
          return;
        }
        conn.child.stdin.write(wire, (error) => {
          if (error) this.settle(conn, id, undefined, new Error(`MCP write failed: ${error.message}`));
        });
      } catch (error) {
        this.settle(conn, id, undefined, new Error(`MCP write failed: ${(error as Error).message}`));
      }
    });
  }

  private notify(conn: Conn, method: string, params: unknown): void {
    try {
      conn.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    } catch {
      void this.stopConnection(conn);
    }
  }

  private stopConnection(conn: Conn): Promise<void> {
    if (conn.stopping) return conn.stopping;
    conn.stopping = (async () => {
      this.rejectPending(conn, new Error(`MCP server "${conn.name}" stopped`));
      if (conn.signal && conn.abortHandler) conn.signal.removeEventListener("abort", conn.abortHandler);
      const child = conn.child;
      conn.started = false;
      const report = (message: string) => {
        this.shutdownIssues.push(`${conn.name}: ${boundMcpOutput(message, 500)}`);
        this.shutdownIssues = this.shutdownIssues.slice(-MCP_LIMITS.maxServers * 4);
      };
      try {
        if (process.platform === "win32") {
          const issue = await windowsTerminate(child);
          if (issue) report(issue);
          // Fallback stops only the direct child, not a confirmed Windows tree.
          if (alive(child)) {
            try { child.kill("SIGKILL"); } catch { /* checked below */ }
            await waitForExit(child, 500);
          }
        } else {
          if (alive(child)) {
            try { child.kill("SIGTERM"); } catch { /* escalation below */ }
            await waitForExit(child, 500);
          }
          // The direct child may exit before descendants. Always signal the
          // detached group we created, not only when the root is still alive.
          if (child.pid) {
            try { process.kill(-child.pid, "SIGKILL"); }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") report(`process-group termination failed: ${(error as Error).message}`);
              if (alive(child)) { try { child.kill("SIGKILL"); } catch { /* checked below */ } }
            }
            await waitForExit(child, 500);
          }
        }
        if (alive(child)) report("termination timed out; direct child is still running (descendant termination unconfirmed)");
      } finally {
        conn.cleanup?.();
        if (!alive(child) && this.conns.get(conn.name) === conn) this.conns.delete(conn.name);
      }
    })();
    const stopping = conn.stopping;
    void stopping.then(() => {
      // A failed OS termination is not a dead connection: retain it for retry.
      if (alive(conn.child)) conn.stopping = undefined;
    });
    return stopping;
  }

  listTools(): McpTool[] {
    const out: McpTool[] = [];
    for (const [, conn] of this.conns) if (conn.started && !conn.stopping) out.push(...conn.tools);
    return out;
  }

  async callTool(server: string, tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
    const conn = this.conns.get(server);
    if (!conn) return { ok: false, output: `MCP server "${server}" is not running.` };
    try {
      const result = (await this.request(conn, "tools/call", { name: tool, arguments: args })) as {
        content?: { type?: string; text?: string }[];
        isError?: boolean;
      };
      const text = (Array.isArray(result?.content) ? result.content : [])
        .filter((c) => typeof c === "object" && c !== null && (c.type === "text" || typeof c.text === "string"))
        .map((c) => typeof c.text === "string" ? c.text : "")
        .join("\n");
      return { ok: result?.isError !== true, output: boundMcpOutput(text || "(empty response)") };
    } catch (e) {
      return { ok: false, output: `MCP tool failed: ${boundMcpOutput((e as Error).message, 500)}` };
    }
  }

  /** Bounded best-effort shutdown. Callers must surface returned diagnostics. */
  async stopAll(): Promise<string[]> {
    if (this.stoppingAll) return this.stoppingAll;
    this.stopEpoch++;
    const conns = [...this.conns.values()];
    this.stoppingAll = Promise.all(conns.map((conn) => this.stopConnection(conn))).then(() => {
      const issues = [...new Set(this.shutdownIssues)];
      this.shutdownIssues = [];
      return issues;
    });
    try { return await this.stoppingAll; }
    finally { this.stoppingAll = undefined; }
  }
}
