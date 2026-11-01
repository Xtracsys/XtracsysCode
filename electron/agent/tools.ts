import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ToolContext, ToolDefinition, ToolResult } from "./types";
import { shellInvocation, killTree, childEnv, IS_WINDOWS } from "../platform";

const MAX_LIST_ENTRIES = 500;
const MAX_READ_BYTES = 48 * 1024;
const MAX_WRITE_BYTES = 512 * 1024;
const MAX_DIFF_CHARS = 20 * 1024;
const MAX_GREP_RESULTS = 80;
// ReDoS bounds: the regex comes from the model and is tested against repo-controlled
// lines IN the main process, so both sides are capped (a catastrophic backtracking
// pattern against a ~1 MB line would otherwise freeze every chat and IPC handler).
const MAX_GREP_PATTERN_CHARS = 512;
const MAX_GREP_LINE_CHARS = 4096;
const DEFAULT_CMD_TIMEOUT_MS = 30_000;
const MAX_CMD_TIMEOUT_MS = 120_000;

/** Build a diff for the UI when both sides are small enough to be useful. */
function makeDiff(file: string, oldText: string, newText: string): ToolResult["diff"] | undefined {
  if (oldText.length > MAX_DIFF_CHARS || newText.length > MAX_DIFF_CHARS) return undefined;
  return { path: file, oldText, newText };
}

function fail(message: string): ToolResult {
  return { ok: false, output: message };
}

function truncate(text: string, max: number, label = "output"): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n… [${label} truncated at ${max} chars]`;
}

function listTool(): ToolDefinition {
  return {
    spec: {
      name: "list_dir",
      description:
        "List the entries of a directory. Returns names with file/dir markers and sizes. Use relative paths from the project root, or absolute paths.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory to list. Defaults to the project root.",
          },
        },
      },
    },
    readOnly: true,
    async execute(args, ctx) {
      const raw = typeof args.path === "string" && args.path.trim() ? args.path : ".";
      const dir = ctx.resolvePath(raw);
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (e) {
        return fail(`Cannot list ${dir}: ${(e as Error).message}`);
      }
      const out: string[] = [];
      const shown = entries.slice(0, MAX_LIST_ENTRIES);
      for (const ent of shown) {
        if (ent.name.startsWith(".DS_Store")) continue;
        out.push(`${ent.isDirectory() ? "d" : "-"} ${ent.name}`);
      }
      let note = "";
      if (entries.length > shown.length) note = `\n… [${entries.length - shown.length} more entries]`;
      if (out.length === 0 && !note) return { ok: true, output: "(empty directory)" };
      return { ok: true, output: `${dir}\n${out.join("\n")}${note}` };
    },
  };
}

function readFileTool(): ToolDefinition {
  return {
    spec: {
      name: "read_file",
      description:
        "Read a text file. Returns the file content (truncated if very large). Only use for text files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (relative to project root or absolute)." },
        },
        required: ["path"],
      },
    },
    readOnly: true,
    async execute(args, ctx) {
      const p = typeof args.path === "string" ? args.path : "";
      if (!p) return fail("Missing 'path'.");
      const file = ctx.resolvePath(p);
      let stat: fs.Stats;
      try {
        stat = await fsp.stat(file);
      } catch (e) {
        return fail(`Cannot stat ${file}: ${(e as Error).message}`);
      }
      if (stat.isDirectory()) return fail(`${file} is a directory; use list_dir.`);
      if (stat.size > 4 * 1024 * 1024)
        return fail(`${file} is ${(stat.size / 1048576).toFixed(1)}MB — too large to read.`);
      try {
        const buf = await fsp.readFile(file);
        // Cheap binary sniff: NUL byte in the first 8KB.
        if (buf.subarray(0, 8192).includes(0)) return fail(`${file} looks binary; refusing to read.`);
        return { ok: true, output: truncate(buf.toString("utf8"), MAX_READ_BYTES, "file") };
      } catch (e) {
        return fail(`Cannot read ${file}: ${(e as Error).message}`);
      }
    },
  };
}

function writeFileTool(): ToolDefinition {
  return {
    spec: {
      name: "write_file",
      description:
        "Create or overwrite a text file with the given content. Parent directories are created automatically. Always pass the COMPLETE file content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (relative to project root or absolute)." },
          content: { type: "string", description: "Full text content to write." },
        },
        required: ["path", "content"],
      },
    },
    readOnly: false,
    async execute(args, ctx) {
      const p = typeof args.path === "string" ? args.path : "";
      const content = typeof args.content === "string" ? args.content : "";
      if (!p) return fail("Missing 'path'.");
      if (content.length > MAX_WRITE_BYTES)
        return fail(`Content too large (${content.length} chars; max ${MAX_WRITE_BYTES}).`);
      const file = ctx.resolvePath(p);
      try {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        let oldText = "";
        try {
          oldText = (await fsp.readFile(file, "utf8")).toString();
        } catch {
          /* new file */
        }
        await fsp.writeFile(file, content, "utf8");
        return {
          ok: true,
          output: `Wrote ${content.length} chars to ${file}${oldText ? " (replaced existing content)" : " (new file)"}`,
          diff: makeDiff(file, oldText, content),
        };
      } catch (e) {
        return fail(`Cannot write ${file}: ${(e as Error).message}`);
      }
    },
  };
}

function editFileTool(): ToolDefinition {
  return {
    spec: {
      name: "edit_file",
      description:
        "Make a surgical edit to an existing text file: replace the exact string oldText with newText. oldText must appear EXACTLY ONCE in the file (include enough surrounding lines to be unique). Prefer this over write_file for small changes.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (relative to project root or absolute)." },
          oldText: { type: "string", description: "Exact existing text to replace (must be unique in the file)." },
          newText: { type: "string", description: "Replacement text." },
        },
        required: ["path", "oldText", "newText"],
      },
    },
    readOnly: false,
    async execute(args, ctx) {
      const p = typeof args.path === "string" ? args.path : "";
      const oldText = typeof args.oldText === "string" ? args.oldText : "";
      const newText = typeof args.newText === "string" ? args.newText : "";
      if (!p) return fail("Missing 'path'.");
      if (!oldText) return fail("Missing 'oldText'.");
      if (oldText === newText) return fail("oldText and newText are identical — nothing to do.");
      const file = ctx.resolvePath(p);
      let content: string;
      try {
        content = await fsp.readFile(file, "utf8");
      } catch (e) {
        return fail(`Cannot read ${file}: ${(e as Error).message}`);
      }
      const occurrences = content.split(oldText).length - 1;
      if (occurrences === 0) {
        return fail(
          `oldText not found in ${file}. Read the file again and copy the exact text (whitespace matters).`,
        );
      }
      if (occurrences > 1) {
        return fail(
          `oldText appears ${occurrences} times in ${file} — it must be unique. Include more surrounding lines to disambiguate.`,
        );
      }
      try {
        await fsp.writeFile(file, content.replace(oldText, newText), "utf8");
        return {
          ok: true,
          output: `Edited ${file}: replaced ${oldText.length} chars with ${newText.length} chars.`,
          diff: makeDiff(file, oldText, newText),
        };
      } catch (e) {
        return fail(`Cannot write ${file}: ${(e as Error).message}`);
      }
    },
  };
}

function runCommandTool(): ToolDefinition {
  const sh = shellInvocation();
  return {
    spec: {
      name: "run_command",
      description:
        `Run a shell command inside the project directory (${sh.shellLabel}). Use for builds, git, tests, listing, and other CLI work. Output is truncated. Mutating commands require user approval unless auto-approve is on.`,
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run." },
          timeout_ms: {
            type: "number",
            description: `Optional timeout in ms (${DEFAULT_CMD_TIMEOUT_MS}–${MAX_CMD_TIMEOUT_MS}). Default ${DEFAULT_CMD_TIMEOUT_MS}.`,
          },
        },
        required: ["command"],
      },
    },
    readOnly: false,
    async execute(args, ctx) {
      const command = typeof args.command === "string" ? args.command : "";
      if (!command.trim()) return fail("Missing 'command'.");
      if (command.length > 32_000) return fail("Command too long (max 32000 chars). Put long input in a file and read it from the command.");
      let timeout = Number(args.timeout_ms);
      if (!Number.isFinite(timeout)) timeout = DEFAULT_CMD_TIMEOUT_MS;
      timeout = Math.min(Math.max(timeout, 1000), MAX_CMD_TIMEOUT_MS);
      try {
        const { spawn } = await import("node:child_process");
        const CAP_TOTAL = 256 * 1024; // memory bound on accumulated output (R7/E)
        const CAP_STREAM = 64 * 1024; // live tool-card tail bound
        const result = await new Promise<{ stdout: string; stderr: string; code: number | null; capped: boolean }>(
          (resolve) => {
            // Own process group so the timeout/cancel kill takes descendants with it
            // (Windows: taskkill /T via killTree — no process groups there).
            const sh = shellInvocation();
            const child = spawn(sh.file, [...sh.args, command], {
              cwd: ctx.cwd,
              env: { ...childEnv(), NO_COLOR: "1", TERM: "dumb" },
              detached: !IS_WINDOWS,
            });
            let stdout = "";
            let stderr = "";
            let captured = 0;
            let capped = false;
            let finished = false;
            // Throttled live streaming to the tool card (N10), bounded (v5 R7/E).
            let pending = "";
            let streamed = 0;
            let flushTimer: ReturnType<typeof setTimeout> | null = null;
            const flush = () => {
              flushTimer = null;
              if (pending) {
                ctx.onOutput?.(pending);
                pending = "";
              }
            };
            const stop = () => killTree(child);
            const onChunk = (s: string) => {
              if (streamed >= CAP_STREAM) return;
              const slice = s.slice(0, CAP_STREAM - streamed);
              streamed += slice.length;
              pending += slice;
              if (!flushTimer) flushTimer = setTimeout(flush, 150);
            };
            const keep = (s: string) => {
              if (captured >= CAP_TOTAL) {
                capped = true;
                return;
              }
              const part = s.slice(0, CAP_TOTAL - captured);
              if (part.length < s.length) capped = true;
              captured += part.length;
              return part;
            };
            const childStdout = child.stdout.setEncoding("utf8");
            const childStderr = child.stderr.setEncoding("utf8");
            childStdout.on("data", (s: string) => {
              const part = keep(s);
              if (part) stdout += part;
              onChunk(s);
            });
            childStderr.on("data", (s: string) => {
              const part = keep(s);
              if (part) stderr += part;
              onChunk(s);
            });
            const timer = setTimeout(() => {
              if (!finished) {
                finished = true;
                stop();
                flush();
                resolve({ stdout, stderr, code: 124, capped });
              }
            }, timeout);
            child.on("close", (code) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              if (flushTimer) clearTimeout(flushTimer);
              flush();
              resolve({ stdout, stderr, code, capped });
            });
            child.on("error", (err) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              resolve({ stdout, stderr, code: 1, capped });
              void err;
            });
          },
        );
        let output = "";
        if (result.stdout) output += result.stdout;
        if (result.stderr) output += (output ? "\n--- stderr ---\n" : "") + result.stderr;
        output = output.trim();
        if (result.capped) output += "\n… [output capped — command kept running only until its output/timeout limit]";
        const status = result.code === 0 ? "" : `\n[exit code: ${result.code}]`;
        return {
          ok: result.code === 0,
          output: truncate(output || "(no output)", 16 * 1024, "command output") + status,
        };
      } catch (e) {
        return fail(`Command failed: ${(e as Error).message}`);
      }
    },
  };
}

const GREP_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "target", "venv", "__pycache__"]);
const MAX_GREP_GLOB_CHARS = 64;
const MAX_GREP_REGEX_MS = 250;
const MAX_GREP_TOTAL_MS = 5_000;

/** Linear wildcard match for filename globs (* = any run, ? = one char, case-insensitive).
 *  A hand-rolled greedy matcher replaces regex conversion: model-supplied globs with
 *  many stars used to compile into catastrophically backtracking regexes that froze
 *  the main process (verified: 8 stars ≈ 90 s per file entry). O(n·m) worst case. */
export function matchGlobName(glob: string, name: string): boolean {
  const gl = glob.toLowerCase();
  const nl = name.toLowerCase();
  let g = 0, n = 0, starG = -1, starN = 0;
  while (n < nl.length) {
    if (g < gl.length && (gl[g] === "?" || gl[g] === nl[n])) { g++; n++; }
    else if (g < gl.length && gl[g] === "*") { starG = g++; starN = n; }
    else if (starG >= 0) { g = starG + 1; n = ++starN; }
    else return false;
  }
  while (g < gl.length && gl[g] === "*") g++;
  return g === gl.length;
}

interface GrepRegexTester {
  test(pattern: string, line: string): Promise<boolean>;
}
let grepRegexTester: GrepRegexTester | null = null;

/** Model-supplied regexes are tested against repo-controlled lines IN the main
 *  process; length caps do not bound backtracking (verified: `(a+)+b` vs a 4 KB
 *  line runs > 20 s). Each line test therefore runs in a worker thread with a hard
 *  per-line timeout — on timeout the worker is killed and the whole grep fails
 *  closed with an actionable error. */
async function getGrepRegexTester(): Promise<GrepRegexTester> {
  if (grepRegexTester) return grepRegexTester;
  const { Worker } = await import("node:worker_threads");
  const WORKER_SOURCE = `
    const { parentPort } = require("node:worker_threads");
    let compiled = null, compiledSrc = null;
    parentPort.on("message", (msg) => {
      try {
        if (msg.pattern !== compiledSrc) { compiled = new RegExp(msg.pattern, "i"); compiledSrc = msg.pattern; }
        parentPort.postMessage({ id: msg.id, ok: compiled.test(msg.line) });
      } catch (e) {
        parentPort.postMessage({ id: msg.id, error: String((e && e.message) || e) });
      }
    });`;
  let worker = new Worker(WORKER_SOURCE, { eval: true });
  worker.unref();
  let seq = 0;
  const pending = new Map<number, { resolve: (ok: boolean) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  const spawnWorker = () => {
    worker = new Worker(WORKER_SOURCE, { eval: true });
    worker.unref();
    worker.on("message", (msg: { id: number; ok?: boolean; error?: string }) => {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(msg.error));
      else entry.resolve(!!msg.ok);
    });
    worker.on("error", () => { /* per-request timeout handles wedged workers */ });
  };
  spawnWorker();
  grepRegexTester = {
    test(pattern: string, line: string): Promise<boolean> {
      return new Promise<boolean>((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          void worker.terminate();
          spawnWorker();
          reject(new Error(`grep regex exceeded ${MAX_GREP_REGEX_MS}ms on a line — the pattern is too backtracking-heavy. Refine it or run without regex:true.`));
        }, MAX_GREP_REGEX_MS);
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ id, pattern, line });
      });
    },
  };
  return grepRegexTester;
}

function grepTool(): ToolDefinition {
  return {
    spec: {
      name: "grep",
      description:
        "Search file contents recursively with a case-insensitive fixed string (or regex if regex=true). Skips node_modules/.git and similar. Returns file:line matches.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text (or regex) to search for." },
          path: { type: "string", description: "Directory to search. Defaults to project root." },
          glob: { type: "string", description: "Optional filename filter, e.g. '*.ts'." },
          regex: { type: "boolean", description: "Treat pattern as a regular expression. Default false." },
        },
        required: ["pattern"],
      },
    },
    readOnly: true,
    async execute(args, ctx) {
      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      if (!pattern) return fail("Missing 'pattern'.");
      if (pattern.length > MAX_GREP_PATTERN_CHARS) {
        return fail(`Pattern too long (max ${MAX_GREP_PATTERN_CHARS} chars). Use a shorter pattern or add a path/glob filter.`);
      }
      const base = ctx.resolvePath(typeof args.path === "string" && args.path ? args.path : ".");
      const glob = typeof args.glob === "string" && args.glob ? args.glob : null;
      if (glob && glob.length > MAX_GREP_GLOB_CHARS) {
        return fail(`Glob filter too long (max ${MAX_GREP_GLOB_CHARS} chars).`);
      }
      const useRegex = args.regex === true;
      let re: RegExp | null = null;
      let regexTester: GrepRegexTester | null = null;
      if (useRegex) {
        // Fixed-string mode escapes to a literal-only pattern (linear); regex mode
        // cannot be bounded in-process, so every line test runs in a worker with a
        // hard timeout (see getGrepRegexTester).
        regexTester = await getGrepRegexTester();
      } else {
        try {
          re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        } catch (e) {
          return fail(`Bad pattern: ${(e as Error).message}`);
        }
      }

      const hits: string[] = [];
      let scanned = 0;
      let budgetNote = "";
      let errorResult: ToolResult | null = null;
      const startedAt = Date.now();
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (hits.length >= MAX_GREP_RESULTS || depth > 12) return;
        if (budgetNote) return;
        if ((scanned & 7) === 0 && Date.now() - startedAt > MAX_GREP_TOTAL_MS) {
          budgetNote = `\n… [grep time budget (${MAX_GREP_TOTAL_MS / 1000}s) exhausted — results are partial. Narrow with a path or glob filter.]`;
          return;
        }
        let entries: fs.Dirent[];
        try {
          entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const ent of entries) {
          if (hits.length >= MAX_GREP_RESULTS || budgetNote) return;
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            if (!GREP_SKIP_DIRS.has(ent.name) && !ent.name.startsWith(".")) await walk(full, depth + 1);
            continue;
          }
          if (!ent.isFile()) continue;
          if (glob && !matchGlobName(glob, ent.name)) continue;
          let size = 0;
          try {
            size = (await fsp.stat(full)).size;
          } catch {
            continue;
          }
          if (size > 1024 * 1024) continue;
          scanned++;
          let text: string;
          try {
            const buf = await fsp.readFile(full);
            if (buf.subarray(0, 4096).includes(0)) continue;
            text = buf.toString("utf8");
          } catch {
            continue;
          }
          const lines = text.split("\n");
          for (let i = 0; i < lines.length && hits.length < MAX_GREP_RESULTS; i++) {
            const line = lines[i].slice(0, MAX_GREP_LINE_CHARS);
            let matched: boolean;
            try {
              matched = re ? re.test(line) : await regexTester!.test(pattern, line);
            } catch (e) {
              errorResult = fail((e as Error).message);
              return;
            }
            if (matched) {
              hits.push(`${path.relative(base, full) || full}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
            }
            if (budgetNote) break;
          }
        }
      };
      await walk(base, 0);
      if (errorResult) return errorResult;
      if (budgetNote && hits.length === 0) {
        return fail(`grep time budget exhausted before any match — the pattern is too broad or too slow. Narrow with a path or glob filter.`);
      }
      if (hits.length === 0) return { ok: true, output: `No matches for "${pattern}" (scanned ${scanned} files).` };
      return { ok: true, output: hits.join("\n") + budgetNote + (hits.length >= MAX_GREP_RESULTS ? `\n… [stopped at ${MAX_GREP_RESULTS} matches]` : "") };
    },
  };
}

function planTool(): ToolDefinition {
  return {
    spec: {
      name: "set_plan",
      description:
        "Create or update your task plan (todo list). Call this FIRST for multi-step tasks, then keep statuses current as you work: status is pending | in_progress | done. Replaces the whole plan each call.",
      parameters: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            description: "The full plan (all steps, current statuses).",
            items: {
              type: "object",
              properties: {
                content: { type: "string", description: "What to do." },
                status: { type: "string", enum: ["pending", "in_progress", "done"] },
              },
              required: ["content", "status"],
            },
          },
        },
        required: ["entries"],
      },
    },
    readOnly: true,
    async execute(args, ctx) {
      const raw = Array.isArray(args.entries) ? args.entries : [];
      const entries = raw.slice(0, 50).map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        const status: "pending" | "in_progress" | "done" =
          o.status === "in_progress" || o.status === "done" ? o.status : "pending";
        return { content: String(o.content ?? "").slice(0, 300), status };
      }).filter((e) => e.content);      if (entries.length === 0) return { ok: false, output: "Plan needs at least one entry with content." };
      ctx.updatePlan?.(entries);
      const done = entries.filter((e) => e.status === "done").length;
      return { ok: true, output: `Plan updated: ${entries.length} steps, ${done} done.` };
    },
  };
}

export function defaultTools(): ToolDefinition[] {
  return [listTool(), readFileTool(), writeFileTool(), editFileTool(), runCommandTool(), grepTool(), planTool()];
}

/**
 * Resolve a tool path against the project root with real containment checks (v5 R7):
 * - existing paths are resolved through realpath, so symlinks cannot smuggle a target
 *   outside the project;
 * - new files resolve through their nearest existing parent (realpath'd), which catches
 *   directory symlinks on the way;
 * - outside targets are REJECTED with an explicit error — never silently redirected.
 * Known residual race: a symlink swapped in between this check and the actual write is
 * not caught here (single-threaded per turn, but the filesystem is shared). Shell cwd is
 * NOT a filesystem sandbox — run_command is gated by approvals, not by this function.
 */
export function resolveWithin(root: string, target: string): string {
  const rootReal = realpathOrNull(root) ?? root;
  const abs = path.isAbsolute(target) ? path.normalize(target) : path.resolve(root, target);
  // Lexical containment against BOTH spellings of the root: the caller's path may be
  // reached via a symlink (e.g. /tmp → /private/tmp on macOS), and the model may spell
  // absolute targets either way. Realpath checks below still catch symlink escapes.
  let rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    rel = path.relative(rootReal, abs);
  }
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refused: "${target}" is outside the project root (${rootReal}). The agent can only touch project files.`);
  }
  return resolveRealInside(rootReal, path.join(rootReal, rel));
}

function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** target is lexically inside rootReal; verify the real path is too (symlink-safe). */
function resolveRealInside(rootReal: string, target: string): string {
  let cur = target;
  const suffix: string[] = [];
  for (;;) {
    const real = realpathOrNull(cur);
    if (real !== null) {
      if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
        throw new Error(`Refused: "${target}" points (via a symlink) outside the project root.`);
      }
      let out = real;
      for (const part of suffix.reverse()) out = path.join(out, part);
      return path.normalize(out);
    }
    const base = path.basename(cur);
    if (base === cur) break; // reached the filesystem root; fall through
    suffix.push(base);
    cur = path.dirname(cur);
  }
  return target;
}
