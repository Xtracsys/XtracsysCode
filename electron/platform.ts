/**
 * Platform abstraction (v5 cross-platform prep). Everything OS-specific funnels
 * through here so Windows/Linux builds differ from macOS in exactly one file
 * (plus electron-builder.yml).
 */
import { spawn, type ChildProcess } from "node:child_process";

export const IS_WINDOWS = process.platform === "win32";
export const IS_MAC = process.platform === "darwin";

export interface ShellInvocation {
  file: string;
  args: string[];
  /** Windows cmd needs extra quoting care; tools surface this in copy. */
  shellLabel: string;
}

/** How run_command executes a command string on this platform. */
export function shellInvocation(): ShellInvocation {
  if (IS_WINDOWS) {
    return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c"], shellLabel: "cmd" };
  }
  if (IS_MAC) {
    return { file: "/bin/zsh", args: ["-c"], shellLabel: "zsh" };
  }
  return { file: "/bin/bash", args: ["-c"], shellLabel: "bash" };
}

/** Kill a spawned child AND its descendants. POSIX: process-group kill (the child is
 *  spawned detached). Windows: taskkill /T walks the tree — there are no process groups. */
export function killTree(child: ChildProcess): void {
  if (IS_WINDOWS) {
    if (child.pid) {
      try {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        return;
      } catch {
        /* fall through */
      }
    }
    child.kill();
    return;
  }
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/** Open a folder in the platform terminal emulator (best effort, detached). */
export function openInTerminal(dir: string): void {
  if (IS_MAC) {
    spawn("open", ["-a", "Terminal", dir], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (IS_WINDOWS) {
    spawn("cmd.exe", ["/c", "start", "", "cmd.exe"], { cwd: dir, detached: true, stdio: "ignore" }).unref();
    return;
  }
  // Linux: try common terminal emulators in order.
  for (const term of ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "alacritty"]) {
    try {
      const child = spawn(term, term === "gnome-terminal" ? ["--working-directory", dir] : [dir === "/" ? "/" : dir], {
        cwd: dir,
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => {
        /* try next */
      });
      child.unref();
      return;
    } catch {
      /* try next */
    }
  }
}

/** git/tar live in PATH everywhere except macOS's /usr/bin defaults. */
export function gitBin(): string {
  return IS_MAC ? "/usr/bin/git" : "git";
}
export function tarBin(): string {
  return IS_MAC ? "/usr/bin/tar" : "tar";
}

/**
 * Minimal environment for subprocesses the agent starts (run_command, MCP/plugin
 * servers). The full parent environment often carries cloud/CI credentials
 * (GH_TOKEN, AWS_*, …) that must not be handed to every model-generated command or
 * third-party server; these are the variables ordinary CLI work needs. Commands that
 * legitimately require more can set it inside the command (which is approval-gated).
 */
const CHILD_ENV_ALLOWLIST = [
  // Unix
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TZ",
  "TMPDIR", "SSH_AUTH_SOCK", "SSL_CERT_FILE", "SSL_CERT_DIR",
  // Windows
  "SystemRoot", "windir", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "ProgramData", "USERPROFILE", "USERNAME",
  "USERDOMAIN", "SystemDrive", "HOMEDRIVE", "HOMEPATH", "MSYSTEM",
];

export function childEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  if (!IS_WINDOWS && out.PATH === undefined) {
    out.PATH = IS_MAC ? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" : "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }
  return out;
}

/** Per-platform location for the small file that remembers a custom data root. */
export function bootstrapFile(appName: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (IS_WINDOWS) {
    return process.env.APPDATA
      ? `${process.env.APPDATA}\\${appName}\\data-root.txt`
      : `${home}\\AppData\\Roaming\\${appName}\\data-root.txt`;
  }
  if (IS_MAC) return `${home}/Library/Application Support/${appName}/data-root.txt`;
  return `${process.env.XDG_CONFIG_HOME ?? `${home}/.config`}/${appName}/data-root.txt`;
}
