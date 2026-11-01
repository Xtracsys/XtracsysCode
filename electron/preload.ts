import { contextBridge, ipcRenderer } from "electron";

/**
 * Minimal, auditable bridge between the renderer and the local agent host.
 * Everything goes through explicit invoke channels; the renderer has no
 * direct Node access. There is deliberately no network-facing API here.
 */
const api = {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => {
    const allowed = new Set([
      "state:get",
      "settings:set",
      "backends:models",
      "project:create",
      "project:delete",
      "project:rename",
      "project:save-settings",
      "config:read",
      "config:write",
      "config:scaffold",
      "rules:set",
      "rules:allow-always",
      "mcp:set",
      "chat:create",
      "chat:get",
      "chat:delete",
      "chats:delete",
      "chat:move",
      "chat:rename",
      "chat:approval",
      "chat:model",
      "chat:send",
      "chat:cancel",
      "chat:retry",
      "chat:approve",
      "windows:new-chat",
      "session:set-active",
      "session:reopen-windows",      "storage:usage",
      "storage:cleanup",
      "fs:browse",
      "fs:pick-dir",
      "fs:pick-file",
      "fs:mkdir",
      "open:finder",
      "open:terminal",
      "logs:read",
      "logs:export",
      "search:chats",
      "git:status",
      "git:diff",
      "git:run",
      "usage:project",
      "chat:reveal-transcript",
      "archive:chats",
      "archive:list",
      "archive:restore",
      "archive:delete",
      "data:export",
      "data:import",
      "tasks:save",
      "tasks:delete",
      "tasks:run",
      "skills:list",
      "skills:import",
      "skills:create",
      "skills:set-enabled",
      "skills:set-scope",
      "skills:remove",
      "skills:export",
      "skills:read-file",
      "skills:write-file",
      "skills:reveal",
      "chat:skills",
      "plugins:list",
      "plugins:import",
      "plugins:set-enabled",
      "plugins:set-scope",
      "plugins:remove",
      "plugins:test",
      "plugins:reveal",
    ]);
    if (!allowed.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  onEvent: (cb: (payload: unknown) => void): (() => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("xtrac:event", listener as never);
    return () => ipcRenderer.removeListener("xtrac:event", listener as never);
  },
};

contextBridge.exposeInMainWorld("xtrac", api);

export type XtracApi = typeof api;
