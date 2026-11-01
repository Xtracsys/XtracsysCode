/** Opt-in packaged startup acceptance. This does not change normal app behavior. */
import fs from "node:fs";
import path from "node:path";
import type { App } from "electron";

export interface PackageSmokeConfig { root: string; home: string; data: string; }

export function validatePackageSmoke(env: NodeJS.ProcessEnv, argv: string[]): PackageSmokeConfig | null {
  if (env.XTRAC_PACKAGE_SMOKE !== "1") return null;
  if (env.XTRAC_E2E || env.XTRAC_DEV) throw new Error("Package smoke cannot enable dev or inference E2E modes.");
  const root = env.XTRAC_PACKAGE_SMOKE_ROOT;
  if (!root || !path.isAbsolute(root) || path.resolve(root) !== root || fs.realpathSync(root) !== root || !fs.statSync(root).isDirectory()) throw new Error("Invalid package smoke root.");
  const parent = path.dirname(root);
  if (path.basename(parent) !== "xtracsyscode-sprint" || !/^mac-verify-[A-Za-z0-9]+$/.test(path.basename(root))) throw new Error("Package smoke requires a fresh sprint verification directory.");
  if (!parent.endsWith(path.join(".cache", "xtracsyscode-sprint"))) throw new Error("Package smoke root must be home scratch.");
  const home = path.join(root, "home");
  const tmp = path.join(root, "tmp");
  for (const dir of [home, tmp]) if (fs.realpathSync(dir) !== dir || !fs.statSync(dir).isDirectory()) throw new Error("Redirected smoke persistence directory.");
  if (env.HOME !== home || env.CFFIXED_USER_HOME !== home || !env.TMPDIR || path.resolve(env.TMPDIR) !== tmp) throw new Error("Smoke HOME/TMPDIR must be isolated.");
  const expected = `--user-data-dir=${path.join(root, "user-data")}`;
  if (argv.filter(arg => arg.startsWith("--user-data-dir")).length !== 1 || !argv.includes(expected)) throw new Error("Smoke user-data directory must be explicit and isolated.");
  // The verifier creates this root; reuse could accidentally restore executable state.
  for (const name of ["data", "session-data"]) if (fs.existsSync(path.join(root, name))) throw new Error("Package smoke root is not fresh.");
  // Electron may create the explicit --user-data-dir before evaluating main.
  const userData = path.join(root, "user-data");
  if (fs.existsSync(userData) && (fs.realpathSync(userData) !== userData || !fs.statSync(userData).isDirectory())) throw new Error("Redirected smoke user-data directory.");
  return { root, home, data: path.join(root, "data") };
}

export function configurePackageSmoke(app: App): PackageSmokeConfig | null {
  const config = validatePackageSmoke(process.env, process.argv);
  if (!config) return null;
  const dirs: Array<[Parameters<App["setPath"]>[0], string]> = [
    ["home", config.home], ["temp", path.join(config.root, "tmp")],
    ["appData", path.join(config.home, "app-data")], ["userData", path.join(config.root, "user-data")],
    // Chromium's cache is inside sessionData; "cache" is not a setPath name.
    ["sessionData", path.join(config.root, "session-data")],
    ["crashDumps", path.join(config.root, "crash-dumps")],
  ];
  for (const [key, dir] of dirs) {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.realpathSync(dir) !== dir) throw new Error("Redirected smoke directory.");
    app.setPath(key, dir);
  }
  app.setAppLogsPath(path.join(config.root, "logs"));
  return config;
}

/** No arbitrary filesystem, command, inference, plugin or mutation IPC in smoke mode. */
export function packageSmokeIpc(channel: string, config: PackageSmokeConfig | null): { value: unknown } | null {
  if (!config || channel === "state:get") return null;
  if (channel === "backends:models") return { value: { ollama: [], llamacpp: [], openAICompatible: [], errors: {} } };
  if (channel === "fs:browse") return { value: { path: config.home, parent: null, entries: [] } };
  if (channel === "session:set-active") return { value: true };
  throw new Error(`IPC ${channel} is disabled during isolated package smoke.`);
}
