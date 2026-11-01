import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ChatSummary, ModelsInfo, PlanEntry, PluginRecord, Project, Settings, SkillRecord, StorageUsage, Task } from "../types";
import { formatBytes, timeAgo } from "../lib/format";
import { ACCENTS } from "../hooks/useAppearance";

type Section = "general" | "backends" | "skills" | "plugins" | "project" | "tasks" | "storage" | "git" | "usage" | "plan" | "logs";

const NAV_GROUPS: { label: string; items: [Section, string, string][] }[] = [
  {
    label: "Application",
    items: [
      ["general", "General", "⚙"],
      ["backends", "Backends", "⇄"],
      ["skills", "Skills", "◈"],
      ["plugins", "Plugins", "⬡"],
      ["tasks", "Tasks", "⏱"],
      ["storage", "Storage", "⛁"],
      ["logs", "Logs", "≣"],
    ],
  },
  {
    label: "Project",
    items: [
      ["project", "Project", "◫"],
      ["git", "Git", "⎇"],
      ["usage", "Usage", "∑"],
      ["plan", "Plan", "◎"],
    ],
  },
];

const SECTION_META: Record<Section, { title: string; blurb: string }> = {
  general: { title: "General", blurb: "Appearance and notifications." },
  backends: { title: "Backends", blurb: "Local model backend, agent limits and default approvals." },
  skills: { title: "Skills", blurb: "Reusable instructions the agent can follow — import, create, enable, attach with /skill." },
  plugins: { title: "Plugins", blurb: "Local tool processes on the stdio MCP transport. Imported disabled; review before enabling." },
  project: { title: "Project", blurb: "Per-project settings, config files, approval rules, MCP servers." },
  tasks: { title: "Tasks", blurb: "Saved automations that run prompts on demand or on an interval." },
  storage: { title: "Storage", blurb: "Bounded local storage, cleanup, backups and archived chats." },
  git: { title: "Git", blurb: "Branch, changes and commits for the active chat's project." },
  usage: { title: "Usage", blurb: "Turns and token totals per project." },
  plan: { title: "Plan", blurb: "The active chat's agent plan (set_plan tool)." },
  logs: { title: "Logs", blurb: "The bounded local log with filters." },
};
interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings | null;
  usage: StorageUsage | null;
  tasks: Task[];
  projects: Project[];
  activeChat: ChatSummary | null;
  activeChatPlan?: PlanEntry[] | null;
  appearanceSet?: (patch: { accent?: string; reduceMotion?: boolean }) => void;
  onRefreshUsage: () => Promise<void>;
  onSettingsChanged: () => Promise<void>;
  onDeleteProject: (id: string, alsoDeleteChats: boolean) => Promise<void>;
  /** v5: switch the main window to a chat (used by "Create with Skill Builder"). */
  onOpenChat?: (id: string) => void;
}

export function Settings({
  open,
  onClose,
  settings,
  usage,
  tasks,
  projects,
  activeChat,
  activeChatPlan,
  appearanceSet,
  onRefreshUsage,
  onSettingsChanged,
  onDeleteProject,
  onOpenChat,
}: Props) {
  const [section, setSection] = useState<Section>("general");
  const [logs, setLogs] = useState("");
  const [models, setModels] = useState<ModelsInfo | null>(null);
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<string | null>(null);

  useEffect(() => setDraft(settings), [settings]);

  useEffect(() => {
    if (!open) return;
    if (section === "logs") void api.readLogs().then(setLogs);
    if ((section === "backends" || section === "project") && !models) void api.listModels().then(setModels);
  }, [open, section, models]);

  // Esc closes the modal (the component stays mounted so the last section is remembered).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const saveSettings = async () => {
    if (!draft) return;
    await api.setSettings({
      provider: draft.provider,
      ollamaUrl: draft.ollamaUrl,
      llamaCppUrl: draft.llamaCppUrl,
      openAICompatibleUrl: draft.openAICompatibleUrl,
      model: draft.model,
      approvalMode: draft.approvalMode,
      maxSteps: Number(draft.maxSteps) || 24,
      historyCharBudget: Number(draft.historyCharBudget) || 80000,
      systemPromptExtra: draft.systemPromptExtra,
      numCtx: Number(draft.numCtx) > 0 ? Number(draft.numCtx) : undefined,
      temperature: draft.temperature == null || (draft.temperature as unknown) === "" ? -1 : Number(draft.temperature),
      notifyOnCompletion: draft.notifyOnCompletion !== false,
    });
    await onSettingsChanged();
    setModels(null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <aside className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="settings-nav-group">
              <div className="settings-nav-group-label">{group.label}</div>
              {group.items.map(([id, label, icon]) => (
                <button
                  key={id}
                  type="button"
                  className={`settings-nav-item ${section === id ? "active" : ""}`}
                  onClick={() => setSection(id)}
                >
                  <span className="settings-nav-icon">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          ))}
        </aside>
        <section className="settings-main">
          <header className="settings-main-header">
            <div>
              <h3>{SECTION_META[section].title}</h3>
              <p className="hint">{SECTION_META[section].blurb}</p>
            </div>
            <button type="button" className="icon-btn settings-close" title="Close settings" onClick={onClose}>
              ✕
            </button>
          </header>
          <div className="settings-body">
            {section === "general" && draft && (
              <div className="side-section">
                <h4>Appearance</h4>
                <label className="field">
                  <span>Accent color</span>
                  <div className="accent-row">
                    {ACCENTS.map((a) => (
                      <button
                        key={a.value}
                        type="button"
                        title={a.name}
                        className={`accent-swatch ${draft.appearance?.accent === a.value || (!draft.appearance?.accent && a.value === "#e0784f") ? "selected" : ""}`}
                        style={{ background: a.value }}
                        onClick={() => {
                          const next = { accent: a.value, reduceMotion: draft.appearance?.reduceMotion === true };
                          setDraft({ ...draft, appearance: next });
                          appearanceSet?.(next);
                        }}
                      />
                    ))}
                  </div>
                </label>
                <label className="field">
                  <span>Reduce motion</span>
                  <select
                    value={draft.appearance?.reduceMotion ? "on" : "off"}
                    onChange={(e) => {
                      const next = {
                        accent: draft.appearance?.accent ?? "#e0784f",
                        reduceMotion: e.target.value === "on",
                      };
                      setDraft({ ...draft, appearance: next });
                      appearanceSet?.(next);
                    }}
                  >
                    <option value="off">Full animations</option>
                    <option value="on">Reduce motion</option>
                  </select>
                </label>
                <h4>Notifications</h4>
                <label className="field">
                  <span>Notify when turns or tasks finish</span>
                  <select
                    value={draft.notifyOnCompletion === false ? "off" : "on"}
                    onChange={async (e) => {
                      const v = e.target.value === "on";
                      setDraft({ ...draft, notifyOnCompletion: v });
                      await api.setSettings({ notifyOnCompletion: v });
                      await onSettingsChanged();
                    }}
                  >
                    <option value="on">Notify</option>
                    <option value="off">Never notify</option>
                  </select>
                </label>
                <p className="hint">The light/dark theme toggle lives in the main window header.</p>
              </div>
            )}

            {section === "general" && !draft && <div className="side-empty">Loading…</div>}

            {section === "backends" && draft && (
              <div className="side-section">
                <h4>Local model backend</h4>
                <p className="hint">Ollama, llama.cpp, GMLX, or MLX LM server — local loopback connections only; no cloud.</p>

                <label className="field">
                  <span>Provider</span>
                  <select
                    value={draft.provider}
                    onChange={(e) => setDraft({ ...draft, provider: e.target.value as Settings["provider"] })}
                  >
                    <option value="ollama">Ollama</option>
                    <option value="llamacpp">llama.cpp (llama-server)</option>
                    <option value="gmlx">GMLX</option>
                    <option value="mlxLmServer">MLX LM server (not bare MLX)</option>
                  </select>
                </label>

                {draft.provider === "ollama" ? (
                  <label className="field">
                    <span>Ollama URL</span>
                    <input value={draft.ollamaUrl} onChange={(e) => setDraft({ ...draft, ollamaUrl: e.target.value })} />
                  </label>
                ) : draft.provider === "llamacpp" ? (
                  <label className="field">
                    <span>llama.cpp URL</span>
                    <input value={draft.llamaCppUrl} onChange={(e) => setDraft({ ...draft, llamaCppUrl: e.target.value })} />
                  </label>
                ) : (
                  <label className="field">
                    <span>{draft.provider === "gmlx" ? "GMLX server URL" : "MLX LM server URL"}</span>
                    <input value={draft.openAICompatibleUrl} onChange={(e) => setDraft({ ...draft, openAICompatibleUrl: e.target.value })} />
                    <small className="hint">Default port 8080. Use the server's loopback URL; the app rejects non-local hosts.</small>
                  </label>
                )}

                <label className="field">
                  <span>Model</span>
                  <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
                    <option value="">(auto — first available)</option>
                    {(draft.provider === "ollama" ? models?.ollama : draft.provider === "llamacpp" ? models?.llamacpp : models?.openAICompatible)?.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>

                {models && (
                  <p className="hint">
                    {draft.provider === "ollama"
                      ? models.ollama.length > 0
                        ? `${models.ollama.length} Ollama models found.`
                        : `Ollama unreachable: ${models.errors.ollama ?? "no models"}`
                      : draft.provider === "llamacpp"
                        ? models.llamacpp.length > 0
                          ? `${models.llamacpp.length} llama.cpp models found.`
                          : `llama.cpp unreachable: ${models.errors.llamacpp ?? "no models"}`
                        : models.openAICompatible.length > 0
                          ? `${models.openAICompatible.length} compatible server models found.`
                          : `Local server unreachable: ${models.errors.openAICompatible ?? "no models"}`}
                  </p>
                )}

                <label className="field">
                  <span>Default approvals</span>
                  <select
                    value={draft.approvalMode}
                    onChange={(e) => setDraft({ ...draft, approvalMode: e.target.value as "ask" | "auto" })}
                  >
                    <option value="ask">Ask before writes &amp; commands</option>
                    <option value="auto">Auto-approve (careful)</option>
                  </select>
                </label>

                <label className="field">
                  <span>Context window — num_ctx (0 = backend default)</span>
                  <input
                    type="number"
                    min={0}
                    step={1024}
                    value={draft.numCtx ?? 0}
                    onChange={(e) => setDraft({ ...draft, numCtx: Number(e.target.value) })}
                  />
                </label>

                <label className="field">
                  <span>Temperature (blank = backend default)</span>
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={draft.temperature ?? ""}
                    placeholder="backend default"
                    onChange={(e) =>
                      setDraft({ ...draft, temperature: e.target.value === "" ? undefined : Number(e.target.value) })
                    }
                  />
                </label>

                {draft.provider !== "ollama" && (
                  <p className="hint">Context size is configured by the selected server; this setting only applies to Ollama.</p>
                )}

                <label className="field">
                  <span>Max agent steps per turn</span>
                  <input
                    type="number"
                    value={draft.maxSteps}
                    min={4}
                    max={64}
                    onChange={(e) => setDraft({ ...draft, maxSteps: Number(e.target.value) })}
                  />
                </label>

                <label className="field">
                  <span>Extra system instructions</span>
                  <textarea
                    rows={4}
                    value={draft.systemPromptExtra}
                    placeholder="Optional: house style, project conventions…"
                    onChange={(e) => setDraft({ ...draft, systemPromptExtra: e.target.value })}
                  />
                </label>

                <div className="btn-row" style={{ justifyContent: "flex-start" }}>
                  <button type="button" className="btn primary small" onClick={saveSettings}>
                    Save settings
                  </button>
                  <button type="button" className="btn ghost small" onClick={() => void api.listModels().then(setModels)}>
                    ↻ Probe backends
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={async () => {
                      const t0 = performance.now();
                      const m = await api.listModels();
                      const ms = Math.round(performance.now() - t0);
                      const n = draft.provider === "ollama" ? m.ollama.length : draft.provider === "llamacpp" ? m.llamacpp.length : m.openAICompatible.length;
                      setProbeResult(`${n} models · ${ms} ms round-trip`);
                    }}
                  >
                    Test connection
                  </button>
                </div>
                {probeResult && <p className="hint">{probeResult}</p>}
              </div>
            )}

            {section === "backends" && !draft && <div className="side-empty">Loading…</div>}

            {section === "skills" && (
              <SkillsPanel projects={projects} activeChat={activeChat} onChanged={onSettingsChanged} onOpenChat={onOpenChat} />
            )}

            {section === "plugins" && <PluginsPanel projects={projects} onChanged={onSettingsChanged} />}

            {section === "plan" && <PlanPanel plan={activeChatPlan ?? null} />}

            {section === "git" && <GitPanel cwd={activeChat?.cwd ?? null} />}

            {section === "usage" && <UsagePanel projects={projects} />}

            {section === "project" && (
              <>
                <ProjectSettingsPanel projects={projects} models={models?.ollama ?? []} onChanged={onSettingsChanged} />
                <ConfigFilesPanel projects={projects} />
                <RulesPanel projects={projects} onChanged={onSettingsChanged} />
                <McpPanel projects={projects} onChanged={onSettingsChanged} />
                <DeleteProjectPanel projects={projects} onDeleteProject={onDeleteProject} />
              </>
            )}

            {section === "tasks" && (
              <div className="side-section">
                <h4>Saved tasks (automations)</h4>
                <p className="hint">A task is a saved prompt that runs in a project chat — on demand or on a repeat interval while the app is open.</p>
                <TaskEditor projects={projects} onSaved={onSettingsChanged} />
                {tasks.length === 0 ? (
                  <p className="side-empty-title muted">No tasks saved yet.</p>
                ) : (
                  tasks.map((t) => (
                    <div className="task-row" key={t.id}>
                      <div className="task-main">
                        <b>{t.name}</b>
                        <div className="session-meta">
                          {t.intervalMinutes ? `every ${t.intervalMinutes}m` : "manual"} ·{" "}
                          {t.lastRunAt ? `${t.lastStatus} ${timeAgo(t.lastRunAt)}` : "never run"}
                        </div>
                        {t.lastError && <div className="session-meta">⚠ {t.lastError}</div>}
                        {(t.history?.length ?? 0) > 0 && (
                          <details className="task-history">
                            <summary className="session-meta">history ({t.history!.length})</summary>
                            {[...t.history!].reverse().map((h, i) => (
                              <div key={i} className="session-meta">
                                {h.ok ? "✓" : "✗"} {timeAgo(h.at)}
                                {h.detail ? ` · ${h.detail}` : ""}
                              </div>
                            ))}
                          </details>
                        )}
                      </div>
                      <div className="task-actions">
                        <button
                          type="button"
                          className="btn ghost tiny"
                          onClick={async () => {
                            const r = await api.runTask(t.id);
                            if (r.chatId) void 0;
                            await onSettingsChanged();
                          }}
                        >
                          Run
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={async () => {
                            await api.deleteTask(t.id);
                            await onSettingsChanged();
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {section === "storage" && usage && (
              <div className="side-section">
                <h4>Local storage</h4>
                <p className="hint">
                  Everything lives in <code>{usage.root}</code> — visible, portable, inspectable.
                </p>
                <div className="storage-meter">
                  <div
                    className="storage-meter-fill"
                    style={{ width: `${Math.min(100, (usage.total / usage.caps.chatsMaxBytes) * 100).toFixed(1)}%` }}
                  />
                </div>
                <ul className="storage-breakdown">
                  <li>
                    <span>Total</span>
                    <b>{formatBytes(usage.total)}</b>
                  </li>
                  <li>
                    <span>Chats ({usage.chatCount})</span>
                    <b>{formatBytes(usage.breakdown.chats ?? 0)}</b>
                  </li>
                  <li>
                    <span>Logs (bounded)</span>
                    <b>{formatBytes(usage.breakdown.logs ?? 0)}</b>
                  </li>
                  <li>
                    <span>Scratch (auto-wiped)</span>
                    <b>{formatBytes(usage.breakdown.tmp ?? 0)}</b>
                  </li>
                </ul>
                <p className="hint">
                  Caps: {formatBytes(usage.caps.chatsMaxBytes)} chats · {usage.caps.keepChatDays} days retention ·{" "}
                  {formatBytes(usage.caps.logMaxBytes)} log rotation · scratch wiped automatically. Oldest transcripts are
                  pruned first when the cap is hit.
                </p>
                <div className="storage-actions">
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={async () => {
                      const r = await api.storageCleanup();
                      setCleanupMsg(`Cleaned: ${r.tmpDeleted} scratch, ${r.agedDeleted} aged, ${r.prunedDeleted} pruned — ${formatBytes(r.bytesFreed)} freed`);
                      await onRefreshUsage();
                    }}
                  >
                    Run cleanup now
                  </button>
                  <button type="button" className="btn ghost small" onClick={() => void onRefreshUsage()}>
                    ↻ Refresh
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={async () => {
                      const p = await api.exportData();
                      if (p) setCleanupMsg(`Backup saved to ${p}`);
                    }}
                  >
                    Export backup…
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={async () => {
                      const archive = await api.pickFile();
                      if (!archive) return;
                      if (!confirm("Restore replaces ALL current chats, projects and settings with this backup. For safety, imported scheduled tasks will be paused, project MCP command configurations removed, approval modes reset to Ask, and plugins disabled. Inspect task prompts and reconfigure execution tools after restore. The current data is kept as a .backup folder and the app restarts. Continue?")) return;
                      await api.importData(archive);
                    }}
                  >
                    Import backup…
                  </button>
                </div>
                {cleanupMsg && <p className="hint">{cleanupMsg}</p>}
                <ArchivedList onChanged={onRefreshUsage} />
                <div className="side-section" style={{ marginTop: 12 }}>
                  <h4>Scheduled backups</h4>
                  {settings && (
                    <>
                      <label className="project-menu-check">
                        <input
                          type="checkbox"
                          checked={settings.backups?.daily === true}
                          onChange={(e) => {
                            const b = { daily: e.target.checked, keep: settings.backups?.keep ?? 7, lastRun: settings.backups?.lastRun };
                            void api.setSettings({ backups: b });
                            void onRefreshUsage();
                          }}
                        />
                        daily backup to <code>backups/</code> (keep {settings.backups?.keep ?? 7})
                      </label>
                      <div className="path-row" style={{ marginTop: 6 }}>
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={settings.backups?.keep ?? 7}
                          onChange={(e) => {
                            const keep = Number(e.target.value) || 7;
                            void api.setSettings({ backups: { daily: settings.backups?.daily === true, keep, lastRun: settings.backups?.lastRun } });
                          }}
                        />
                        <span className="hint">
                          {settings.backups?.lastRun ? `last: ${timeAgo(settings.backups.lastRun)}` : "never run"}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {section === "storage" && !usage && <div className="side-empty">Loading…</div>}

            {section === "logs" && (
              <div className="side-section">
                <h4>Local log</h4>
                <LogViewer raw={logs} />
                <div className="btn-row" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                  <button type="button" className="btn ghost small" onClick={() => void api.readLogs().then(setLogs)}>
                    ↻ Refresh
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={async () => {
                      const target = await api.exportLog();
                      if (target) setCleanupMsg(`Log exported to ${target}`);
                    }}
                  >
                    Export log…
                  </button>
                </div>
                {cleanupMsg && <p className="hint">{cleanupMsg}</p>}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SkillsPanel({
  projects,
  activeChat,
  onChanged,
  onOpenChat,
}: {
  projects: Project[];
  activeChat: ChatSummary | null;
  onChanged: () => Promise<void>;
  onOpenChat?: (id: string) => void;
}) {
  const [skills, setSkills] = useState<SkillRecord[] | null>(null);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);

  const refresh = () => {
    api.listSkills().then(setSkills).catch((e) => setMsg((e as Error).message));
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      setMsg(okMsg ?? null);
      refresh();
      await onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const availableIds = new Set(
    (skills ?? []).filter((s) => s.enabled && (s.scope === "global" || s.projectId === activeChat?.projectId)).map((s) => s.id),
  );

  const filtered = (skills ?? []).filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return s.id.includes(q) || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
  });

  return (
    <div className="side-section">
      <h4>Skills</h4>
      <p className="hint">
        A skill is reusable instructions (plus optional reference/template files) — not executable code, and it grants no
        permissions. Attach enabled skills to a chat with <code>/skill &lt;id&gt;</code>; the full instructions load only
        for chats that attach them. App-managed copies live under <code>skills/</code> in the data root; removing an
        imported skill never touches its source folder.
      </p>

      <div className="task-editor-row">
        <input placeholder="Filter skills…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button
          type="button"
          className="btn ghost small"
          onClick={async () => {
            const dir = await api.pickDir();
            if (dir) await run(() => api.importSkill(dir), "Imported ✓");
          }}
        >
          Import folder…
        </button>
        <button type="button" className="btn ghost small" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "Create new"}
        </button>
      </div>

      {creating && (
        <div className="task-editor">
          <input placeholder="Skill name (e.g. Release Checklist)" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="One-sentence description (shown in the catalog)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <button
            type="button"
            className="btn primary small"
            disabled={!name.trim() || !description.trim()}
            onClick={async () => {
              await run(async () => {
                await api.createSkill({ name: name.trim(), description: description.trim() });
                setName("");
                setDescription("");
                setCreating(false);
              }, "Created as a draft — enable it when ready ✓");
            }}
          >
            Create skill (draft)
          </button>
        </div>
      )}

      <div className="task-editor-row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn ghost small"
          disabled={!activeChat || !availableIds.has("skill-builder")}
          title={
            !activeChat
              ? "Open a chat first"
              : availableIds.has("skill-builder")
                ? "Start a chat with the bundled Skill Builder skill attached"
                : "The skill-builder skill is not enabled — enable it below first"
          }
          onClick={async () => {
            if (!activeChat) return;
            try {
              const chat = await api.createChat({ projectId: activeChat.projectId, skills: ["skill-builder"] });
              await onChanged();
              onOpenChat?.(chat.id);
              setMsg("Skill Builder chat created and opened.");
            } catch (e) {
              setMsg((e as Error).message);
            }
          }}
        >
          ✨ Create with Skill Builder
        </button>
      </div>

      {msg && <p className="hint">{msg}</p>}
      {!skills && <p className="hint">Loading…</p>}
      {skills && filtered.length === 0 && <p className="hint">No skills match. Import a folder with a SKILL.md, or create one.</p>}
      {filtered.map((s) => (
        <div className="rule-row skill-row" key={s.id} style={{ alignItems: "flex-start" }}>
          <div className="skill-main" style={{ flex: 1, minWidth: 0 }}>
            <label className="project-menu-check" style={{ marginBottom: 2 }}>
              <input type="checkbox" checked={s.enabled} onChange={(e) => run(() => api.setSkillEnabled(s.id, e.target.checked))} />
              <b>{s.name}</b>
              <span className="badge" style={{ marginLeft: 6 }}>
                {s.source}
              </span>
              <span className="badge">{s.scope === "project" ? "project" : "global"}</span>
              <span className="session-meta">
                {" "}
                v{s.version} · {formatBytes(s.sizeBytes)}
              </span>
            </label>
            <div className="session-meta" style={{ paddingLeft: 22 }}>
              <code>{s.id}</code> — {s.description}
            </div>
            {s.scope === "project" && (
              <div className="task-editor-row" style={{ paddingLeft: 22, marginTop: 4 }}>
                <select value={s.projectId ?? ""} onChange={(e) => run(() => api.setSkillScope(s.id, "project", e.target.value || null))}>
                  <option value="">(pick project…)</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="btn-row" style={{ justifyContent: "flex-start", paddingLeft: 22, marginTop: 4 }}>
              <button
                type="button"
                className="btn ghost tiny"
                onClick={async () => {
                  try {
                    const content = await api.readSkillFile(s.id, "SKILL.md");
                    setEditing({ id: s.id, content });
                  } catch (e) {
                    setMsg((e as Error).message);
                  }
                }}
              >
                Edit
              </button>
              <button type="button" className="btn ghost tiny" onClick={() => void api.revealSkill(s.id)}>
                Reveal
              </button>
              <button
                type="button"
                className="btn ghost tiny"
                onClick={async () => {
                  const dir = await api.pickDir();
                  if (dir) await run(() => api.exportSkill(s.id, dir), `Exported to ${dir}/${s.id}`);
                }}
              >
                Export…
              </button>
              <button
                type="button"
                className="btn danger tiny"
                onClick={() => {
                  if (confirm(`Remove skill "${s.id}" from XtracsysCode? The app-managed copy is deleted;${s.source === "imported" ? " the original imported folder stays where it is." : ""}`)) {
                    void run(() => api.removeSkill(s.id), "Removed ✓");
                  }
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ))}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal-card" style={{ width: "min(760px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <h3>
              Edit <code>{editing.id}/SKILL.md</code>
            </h3>
            <textarea
              className="config-editor"
              rows={18}
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
            />
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  await run(() => api.writeSkillFile(editing.id, "SKILL.md", editing.content), "Saved ✓");
                  setEditing(null);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TRUST_NOTICE =
  "A plugin is an ordinary local process started from this machine — it is NOT sandboxed and can generally do what your user account can do. Declared tools/capabilities are review metadata, not enforcement: every tool a plugin exposes stays approval-gated at runtime, and the app grants plugins no network permission. Only enable plugins whose source you have read and trust.";

function PluginsPanel({ projects, onChanged }: { projects: Project[]; onChanged: () => Promise<void> }) {
  const [plugins, setPlugins] = useState<PluginRecord[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const refresh = () => {
    api.listPlugins().then(setPlugins).catch((e) => setMsg((e as Error).message));
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      setMsg(okMsg ?? null);
      refresh();
      await onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="side-section">
      <h4>Local plugins (v1 — stdio MCP transport)</h4>
      <p className="hint">{TRUST_NOTICE}</p>
      <p className="hint">Enabling or testing opens a main-process consent dialog showing the exact resolved command and working directory. Consent is bound to those launch details; changes require a new review.</p>
      <div className="task-editor-row">
        <button
          type="button"
          className="btn ghost small"
          onClick={async () => {
            const dir = await api.pickDir();
            if (dir) await run(() => api.importPlugin(dir), "Imported — disabled by default. Review, test, then enable.");
          }}
        >
          Import plugin folder…
        </button>
      </div>
      {msg && <p className="hint">{msg}</p>}
      {!plugins && <p className="hint">Loading…</p>}
      {plugins && plugins.length === 0 && (
        <p className="hint">
          No plugins imported. A plugin folder contains a <code>plugin.json</code> manifest (id, name, version, description,
          entry command, declared tools). Try the bundled example at <code>plugins/example-text-formatter</code> in the app
          repository.
        </p>
      )}
      {(plugins ?? []).map((p) => (
        <div className="rule-row" key={p.id} style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label className="project-menu-check" style={{ marginBottom: 2 }}>
              <input
                type="checkbox"
                checked={p.enabled}
                onChange={(e) => {
                  const on = e.target.checked;
                  void run(() => api.setPluginEnabled(p.id, on), on ? "Enabled ✓" : "Disabled ✓");
                }}
              />
              <b>{p.name}</b>
              <span className="badge" style={{ marginLeft: 6 }}>
                v{p.version}
              </span>
              <span className="badge">{p.enabled ? "enabled" : "disabled"}</span>
              {!p.reviewed && <span className="badge">needs review</span>}
            </label>
            <div className="session-meta" style={{ paddingLeft: 22 }}>
              <code>{p.id}</code> — {p.description}
            </div>
            <div className="session-meta" style={{ paddingLeft: 22 }}>
              runs: <code>{p.entry.command} {p.entry.args.join(" ")}</code> from <code>{p.sourcePath}</code>
              <div>Review binds this source tree (2,048 entries / 32 MiB; no links). Changes require review again. External runtimes and post-check mutations remain outside this boundary.</div>
            </div>
            <div className="task-editor-row" style={{ paddingLeft: 22, marginTop: 4 }}>
              <select value={p.projectId ?? ""} onChange={(e) => run(() => api.setPluginScope(p.id, e.target.value || null))}>
                <option value="">All projects</option>
                {projects.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn ghost tiny"
                onClick={async () => {
                  setTestResult((t) => ({ ...t, [p.id]: "testing…" }));
                  try {
                    const r = await api.testPlugin(p.id);
                    setTestResult((t) => ({
                      ...t,
                      [p.id]: r.ok
                        ? `✓ ${r.tools.length} tool(s) in ${r.ms} ms: ${r.tools.map((x) => x.name).join(", ") || "(none)"}`
                        : `✗ ${r.error ?? "failed"}`,
                    }));
                  } catch (e) {
                    setTestResult((t) => ({ ...t, [p.id]: `✗ ${(e as Error).message}` }));
                  }
                  try {
                    setPlugins(await api.listPlugins());
                  } catch {
                    /* keep the last listing; test outcome remains visible */
                  }
                }}
              >
                Run plugin and test connection
              </button>
              <button type="button" className="btn ghost tiny" onClick={() => void api.revealPlugin(p.id)}>
                Manifest
              </button>
              <button
                type="button"
                className="btn danger tiny"
                onClick={() => {
                  if (confirm(`Remove plugin "${p.id}" from XtracsysCode? Only the app-managed manifest is removed — the original folder (${p.sourcePath}) is untouched.`)) {
                    void run(() => api.removePlugin(p.id), "Removed ✓");
                  }
                }}
              >
                Remove
              </button>
            </div>
            {testResult[p.id] && (
              <div className="session-meta" style={{ paddingLeft: 22 }}>
                {testResult[p.id]}
              </div>
            )}
            {p.lastError && (
              <div className="session-meta" style={{ paddingLeft: 22 }}>
                ⚠ {p.lastError}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskEditor({ projects, onSaved }: { projects: Project[]; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [intervalMinutes, setIntervalMinutes] = useState("");

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);

  return (
    <div className="task-editor">
      <input placeholder="Task name" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea placeholder="Prompt to run…" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <div className="task-editor-row">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={0}
          placeholder="every Nm (0 = off)"
          value={intervalMinutes}
          onChange={(e) => setIntervalMinutes(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="btn ghost small"
        disabled={!name.trim() || !prompt.trim() || !projectId}
        onClick={async () => {
          await api.saveTask({
            name: name.trim(),
            prompt: prompt.trim(),
            projectId,
            intervalMinutes: Number(intervalMinutes) > 0 ? Number(intervalMinutes) : null,
          });
          setName("");
          setPrompt("");
          setIntervalMinutes("");
          await onSaved();
        }}
      >
        Save task
      </button>
    </div>
  );
}

function RulesPanel({ projects, onChanged }: { projects: Project[]; onChanged: () => Promise<void> }) {
  const [cmd, setCmd] = useState("");
  const [scope, setScope] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const project = projects.find((p) => p.id === projectId);
  const rules = project?.rules ?? { commands: [], writeScopes: [] };

  const mutate = async (kind: "commands" | "writeScopes", list: string[]) => {
    try {
      await api.setProjectRules(projectId, kind === "commands" ? list : rules.commands, kind === "writeScopes" ? list : rules.writeScopes);
      await onChanged();
    } catch (e) {
      window.alert((e as Error).message || "Could not save rules.");
    }
  };

  if (projects.length === 0) {
    return (
      <div className="side-section">
        <h4>Approval rules</h4>
        <p className="hint">Create a project first — rules are per project.</p>
      </div>
    );
  }

  return (
    <div className="side-section">
      <h4>Approval rules</h4>
      <p className="hint">
        Commands matching these patterns and writes inside these scopes run without asking. The agent's "Always allow"
        button adds rules here automatically.
      </p>

      <label className="field">
        <span>Project</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="rules-group">
        <b className="tl-section-label">Always-allowed commands</b>
        <div className="path-row">
          <input placeholder='e.g. git *' value={cmd} onChange={(e) => setCmd(e.target.value)} />
          <button
            type="button"
            className="btn ghost small"
            disabled={!cmd.trim()}
            onClick={async () => {
              await mutate("commands", [...rules.commands, cmd.trim()]);
              setCmd("");
            }}
          >
            Add
          </button>
        </div>
        {rules.commands.length === 0 && <p className="hint">none</p>}
        {rules.commands.map((c) => (
          <div className="rule-row" key={c}>
            <code>{c}</code>
            <button type="button" className="icon-btn danger" onClick={() => mutate("commands", rules.commands.filter((x) => x !== c))}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="rules-group">
        <b className="tl-section-label">Writable scopes</b>
        <div className="path-row">
          <input placeholder='e.g. src/**' value={scope} onChange={(e) => setScope(e.target.value)} />
          <button
            type="button"
            className="btn ghost small"
            disabled={!scope.trim()}
            onClick={async () => {
              await mutate("writeScopes", [...rules.writeScopes, scope.trim()]);
              setScope("");
            }}
          >
            Add
          </button>
        </div>
        {rules.writeScopes.length === 0 && <p className="hint">none</p>}
        {rules.writeScopes.map((s) => (
          <div className="rule-row" key={s}>
            <code>{s}</code>
            <button type="button" className="icon-btn danger" onClick={() => mutate("writeScopes", rules.writeScopes.filter((x) => x !== s))}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanPanel({ plan }: { plan: PlanEntry[] | null }) {
  if (!plan || plan.length === 0) {
    return (
      <div className="side-section">
        <h4>Plan</h4>
        <p className="hint">
          No plan for this chat yet. The agent creates one with its set_plan tool for multi-step tasks.
        </p>
      </div>
    );
  }
  const done = plan.filter((e) => e.status === "done").length;
  const dot = (s: PlanEntry["status"]) => (s === "done" ? "●" : s === "in_progress" ? "◐" : "○");
  return (
    <div className="side-section">
      <h4>
        Plan <span className="muted">({done}/{plan.length} done)</span>
      </h4>
      <ul className="plan-list">
        {plan.map((e, i) => (
          <li key={i} className={`plan-entry status-${e.status}`}>
            <span className="plan-status-dot">{dot(e.status)}</span>
            <span className="plan-entry-text">{e.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function McpPanel({ projects, onChanged }: { projects: Project[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const project = projects.find((p) => p.id === projectId);
  const mcps = project?.mcps ?? [];

  if (projects.length === 0) {
    return (
      <div className="side-section">
        <h4>MCP servers</h4>
        <p className="hint">Create a project first — MCP servers are configured per project.</p>
      </div>
    );
  }

  return (
    <div className="side-section">
      <h4>MCP servers (local stdio)</h4>
      <p className="hint">
        Local Model Context Protocol servers expose extra tools to the agent. Command runs on this machine only — no
        network. Tools appear as <code>mcp__name__tool</code> and are approval-gated.
      </p>

      <label className="field">
        <span>Project</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="task-editor">
        <input placeholder="Server name (e.g. files)" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder='Command + args (e.g. node /path/server.js)' value={command} onChange={(e) => setCommand(e.target.value)} />
        <button
          type="button"
          className="btn ghost small"
          disabled={!name.trim() || !command.trim()}
          onClick={async () => {
            const parts = command.trim().split(/\s+/);
            await api.setProjectMcps(projectId, [...mcps, { name: name.trim(), command: parts[0], args: parts.slice(1) }]);
            setName("");
            setCommand("");
            await onChanged();
          }}
        >
          Add server
        </button>
      </div>

      {mcps.length === 0 && <p className="hint">No MCP servers configured.</p>}
      {mcps.map((m) => (
        <div className="rule-row" key={m.name}>
          <code>
            {m.name}: {m.command} {m.args.join(" ")}
          </code>
          <button
            type="button"
            className="icon-btn danger"
            onClick={async () => {
              await api.setProjectMcps(projectId, mcps.filter((x) => x.name !== m.name));
              await onChanged();
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function ProjectSettingsPanel({
  projects,
  models,
  onChanged,
}: {
  projects: Project[];
  models: string[];
  onChanged: () => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [model, setModel] = useState("");
  const [numCtx, setNumCtx] = useState("");
  const [temperature, setTemperature] = useState("");
  const [approval, setApproval] = useState<"ask" | "auto" | "inherit">("inherit");
  const [maxSteps, setMaxSteps] = useState("");
  const [extra, setExtra] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);

  useEffect(() => {
    const s = projects.find((p) => p.id === projectId)?.settings;
    setModel(s?.model ?? "");
    setNumCtx(s?.numCtx ? String(s.numCtx) : "");
    setTemperature(s?.temperature !== undefined ? String(s.temperature) : "");
    setApproval(s?.approvalMode ?? "inherit");
    setMaxSteps(s?.maxSteps ? String(s.maxSteps) : "");
    setExtra(s?.systemPromptExtra ?? "");
    setSaved(false);
  }, [projectId, projects]);

  if (projects.length === 0) {
    return (
      <div className="side-section">
        <h4>Project settings</h4>
        <p className="hint">Create a project first.</p>
      </div>
    );
  }

  return (
    <div className="side-section">
      <h4>Project settings</h4>
      <p className="hint">Overrides the global Backends settings for chats in this project. Blank = inherit.</p>
      <label className="field">
        <span>Project</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Model (blank = inherit global)</span>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">(inherit global)</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          {model && !models.includes(model) && <option value={model}>{model}</option>}
        </select>
      </label>
      <div className="task-editor-row">
        <label className="field">
          <span>num_ctx</span>
          <input type="number" min={0} step={1024} value={numCtx} placeholder="inherit" onChange={(e) => setNumCtx(e.target.value)} />
        </label>
        <label className="field">
          <span>Temperature</span>
          <input type="number" min={0} max={2} step={0.1} value={temperature} placeholder="inherit" onChange={(e) => setTemperature(e.target.value)} />
        </label>
      </div>
      <div className="task-editor-row">
        <label className="field">
          <span>Approvals</span>
          <select value={approval} onChange={(e) => setApproval(e.target.value as "ask" | "auto" | "inherit")}>
            <option value="inherit">(inherit global)</option>
            <option value="ask">Ask</option>
            <option value="auto">Auto</option>
          </select>
        </label>
        <label className="field">
          <span>Max steps</span>
          <input type="number" min={0} max={64} value={maxSteps} placeholder="inherit" onChange={(e) => setMaxSteps(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Extra system instructions (project)</span>
        <textarea rows={3} value={extra} placeholder="inherit" onChange={(e) => setExtra(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn primary small"
        onClick={async () => {
          await api.saveProjectSettings(projectId, {
            model: model || undefined,
            numCtx: Number(numCtx) > 0 ? Number(numCtx) : undefined,
            temperature: temperature === "" ? undefined : Number(temperature),
            approvalMode: approval === "inherit" ? undefined : approval,
            maxSteps: Number(maxSteps) > 0 ? Number(maxSteps) : undefined,
            systemPromptExtra: extra || undefined,
          });
          setSaved(true);
          await onChanged();
        }}
      >
        Save project settings
      </button>
      {saved && <p className="hint">Saved ✓</p>}
    </div>
  );
}

function DeleteProjectPanel({
  projects,
  onDeleteProject,
}: {
  projects: Project[];
  onDeleteProject: (id: string, alsoDeleteChats: boolean) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [alsoChats, setAlsoChats] = useState(false);

  // Keep the selection valid when projects are added or removed.
  useEffect(() => {
    if (!projects.some((p) => p.id === projectId)) setProjectId(projects[0]?.id ?? "");
  }, [projects, projectId]);

  if (projects.length === 0) return null;

  const project = projects.find((p) => p.id === projectId);

  return (
    <div className="side-section danger-zone">
      <h4>Danger zone</h4>
      <p className="hint">
        Removes the project from XtracsysCode. The project folder and its files on disk are never touched.
      </p>
      <label className="field">
        <span>Project</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="project-menu-check" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={alsoChats} onChange={(e) => setAlsoChats(e.target.checked)} />
        also delete this project's chats (transcripts removed from disk)
      </label>
      <div>
        <button
          type="button"
          className="btn danger small"
          disabled={!project}
          onClick={() => {
            if (!project) return;
            const what = alsoChats
              ? `Delete project "${project.name}" and all of its chats? Transcripts will be removed from disk.`
              : `Delete project "${project.name}"? Its chats will be kept and become standalone.`;
            if (confirm(what)) void onDeleteProject(project.id, alsoChats);
          }}
        >
          Delete project…
        </button>
      </div>
    </div>
  );
}

function ConfigFilesPanel({ projects }: { projects: Project[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [editing, setEditing] = useState<{ name: "AGENTS.md" | ".xtracsys.md"; content: string } | null>(null);
  const [files, setFiles] = useState<{ name: string; exists: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const refresh = async () => {
    for (const name of ["AGENTS.md", ".xtracsys.md"] as const) {
      const content = await api.readConfig(projectId, name).catch(() => null);
      setFiles((prev) => [...prev.filter((f) => f.name !== name), { name, exists: content !== null }]);
    }
  };

  useEffect(() => {
    if (projectId) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (projects.length === 0) {
    return (
      <div className="side-section">
        <h4>Config files</h4>
        <p className="hint">Create a project first.</p>
      </div>
    );
  }

  return (
    <div className="side-section">
      <h4>Config files</h4>
      <p className="hint">These files are loaded into the agent's system prompt each turn. New projects get them scaffolded automatically.</p>
      <label className="field">
        <span>Project</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {(["AGENTS.md", ".xtracsys.md"] as const).map((name) => {
        const exists = files.find((f) => f.name === name)?.exists ?? false;
        return (
          <div className="rule-row" key={name}>
            <code>
              {name} {exists ? "✓" : "(missing)"}
            </code>
            <div className="btn-row">
              {!exists && (
                <button
                  type="button"
                  className="btn ghost tiny"
                  onClick={async () => {
                    await api.scaffoldConfig(projectId);
                    await refresh();
                  }}
                >
                  Scaffold
                </button>
              )}
              <button
                type="button"
                className="btn ghost tiny"
                onClick={async () => {
                  setError(null);
                  const content = await api.readConfig(projectId, name);
                  setEditing({ name, content: content ?? "" });
                }}
              >
                Edit
              </button>
            </div>
          </div>
        );
      })}
      {error && <p className="hint">{error}</p>}
      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>
              Edit {editing.name} <span className="muted">(project: {projects.find((p) => p.id === projectId)?.name})</span>
            </h3>
            <textarea
              className="config-editor"
              rows={16}
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
            />
            {error && <p className="modal-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  try {
                    await api.writeConfig(projectId, editing.name, editing.content);
                    setEditing(null);
                    await refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GitPanel({ cwd }: { cwd: string | null }) {
  const [data, setData] = useState<{ available: boolean; reason?: string; branch?: string; files?: { status: string; path: string; staged: boolean; unstaged: boolean }[] } | null>(null);
  const [diff, setDiff] = useState<{ path: string; diff: string } | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [includeAll, setIncludeAll] = useState(true);

  const refresh = async () => {
    if (!cwd) return;
    setData(await api.gitStatus(cwd));
  };

  useEffect(() => {
    setData(null);
    setDiff(null);
    setOut(null);
    if (cwd) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  const run = async (args: string[], note: string) => {
    if (!cwd) return;
    try {
      const r = await api.gitRun(cwd, args);
      setOut(`${note}$ git ${args.join(" ")}\n${r.out || r.err || "(ok)"} (exit ${r.code})`);
      await refresh();
    } catch (e) {
      setOut(`${note}: ${(e as Error).message}`);
    }
  };

  if (!cwd) {
    return (
      <div className="side-section">
        <h4>Git</h4>
        <p className="hint">Open a chat to inspect its project.</p>
      </div>
    );
  }

  const staged = (data?.files ?? []).filter((f) => f.staged);
  const unstaged = (data?.files ?? []).filter((f) => !f.staged);

  return (
    <div className="side-section">
      <h4>Git {data?.branch ? <span className="muted">· {data.branch}</span> : null}</h4>
      <div className="btn-row" style={{ justifyContent: "flex-start", marginBottom: 8 }}>
        <button type="button" className="btn ghost small" onClick={() => void refresh()}>
          ↻ Refresh
        </button>
      </div>
      {!data && <p className="hint">Loading…</p>}
      {data && !data.available && <p className="hint">{data.reason ?? "Git unavailable here."}</p>}
      {data?.available && (
        <>
          {out && <pre className="tl-code">{out.slice(0, 2000)}</pre>}

          {staged.length > 0 && (
            <>
              <div className="tl-section-label">Staged</div>
              {staged.map((f) => (
                <div className="rule-row" key={"s" + f.path}>
                  <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {f.status} {f.path}
                  </code>
                  <button
                    type="button"
                    className="btn ghost tiny"
                    title="git reset HEAD -- <path>"
                    onClick={() => void run(["reset", "HEAD", "--", f.path], "unstage")}
                  >
                    Unstage
                  </button>
                </div>
              ))}
            </>
          )}

          <div className="tl-section-label">{unstaged.length > 0 ? "Changes (unstaged)" : "Working tree clean ✓"}</div>
          {unstaged.map((f) => (
            <div className="rule-row" key={f.path}>
              <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {f.status} {f.path}
              </code>
              <div className="btn-row">
                {f.status !== "?" && (
                  <button
                    type="button"
                    className="btn ghost tiny"
                    title="git checkout -- <path> (restores the file)"
                    onClick={() => {
                      if (confirm(`Discard all unstaged changes to ${f.path}? This cannot be undone.`)) {
                        void run(["checkout", "--", f.path], "discard");
                      }
                    }}
                  >
                    Discard
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost tiny"
                  title="git add <path>"
                  onClick={() => void run(["add", f.path], "stage")}
                >
                  Stage
                </button>
              </div>
            </div>
          ))}

          {diff && (
            <div className="tl-tool-section">
              <div className="tl-section-label">Diff · {diff.path}</div>
              <pre className="tl-code diff">{diff.diff || "(no unstaged diff)"}</pre>
            </div>
          )}

          <div className="tl-section-label">Commit</div>
          <label className="project-menu-check" style={{ marginBottom: 6 }}>
            <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
            stage all changes (incl. untracked) first
          </label>
          <textarea
            className="field-input"
            rows={2}
            placeholder="Commit message…"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
          />
          <button
            type="button"
            className="btn primary small"
            disabled={!commitMsg.trim() || commitMsg.trim().startsWith("-")}
            onClick={async () => {
              if (includeAll) await run(["add", "-A"], "stage all");
              await run(["commit", "-m", commitMsg.trim()], "commit");
              setCommitMsg("");
            }}
          >
            Commit…
          </button>
        </>
      )}
    </div>
  );
}

function UsagePanel({ projects }: { projects: Project[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [usage, setUsage] = useState<{ turns: number; inputTokens: number; outputTokens: number; chatCount: number; perChat: { id: string; title: string; turns: number; tokens: number }[] } | null>(null);

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);

  useEffect(() => {
    if (projectId) void api.projectUsage(projectId).then(setUsage);
  }, [projectId]);

  if (projects.length === 0) {
    return (
      <div className="side-section">
        <h4>Usage</h4>
        <p className="hint">Create a project first.</p>
      </div>
    );
  }

  const maxTokens = Math.max(1, ...(usage?.perChat ?? []).map((c) => c.tokens));

  return (
    <div className="side-section">
      <h4>Usage</h4>
      <label className="field">
        <span>Project</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {!usage && <p className="hint">Loading…</p>}
      {usage && (
        <>
          <ul className="storage-breakdown">
            <li>
              <span>Chats</span>
              <b>{usage.chatCount}</b>
            </li>
            <li>
              <span>Agent turns</span>
              <b>{usage.turns}</b>
            </li>
            <li>
              <span>Input tokens</span>
              <b>{usage.inputTokens.toLocaleString()}</b>
            </li>
            <li>
              <span>Output tokens</span>
              <b>{usage.outputTokens.toLocaleString()}</b>
            </li>
          </ul>
          {usage.perChat.length > 0 && (
            <>
              <div className="tl-section-label">Tokens per chat (top {usage.perChat.length})</div>
              {usage.perChat.map((c) => (
                <div key={c.id} className="usage-bar-row" title={`${c.turns} turns`}>
                  <span className="usage-bar-label">{c.title.slice(0, 26)}</span>
                  <span className="storage-meter">
                    <span className="storage-meter-fill" style={{ width: `${Math.max(2, (c.tokens / maxTokens) * 100)}%` }} />
                  </span>
                  <span className="usage-bar-num">{c.tokens.toLocaleString()}</span>
                </div>
              ))}
            </>
          )}
          <button type="button" className="btn ghost small" onClick={() => void api.projectUsage(projectId).then(setUsage)}>
            ↻ Refresh
          </button>
        </>
      )}
    </div>
  );
}

function ArchivedList({ onChanged }: { onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<{ id: string; title: string; updatedAt: number }[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = async () => {
    try {
      setItems(await api.archiveList());
    } catch {
      setItems([]);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  return (
    <div className="side-section" style={{ marginTop: 12 }}>
      <button type="button" className="btn ghost small" onClick={() => setOpen((v) => !v)}>
        {open ? "▾" : "▸"} Archived chats {items.length > 0 ? `(${items.length})` : ""}
      </button>
      {open && (
        <>
          {items.length === 0 && <p className="hint">No archived chats.</p>}
          {items.map((a) => (
            <div className="rule-row" key={a.id}>
              <code style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</code>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn ghost tiny"
                  title="Move back into the sidebar"
                  onClick={async () => {
                    await api.archiveRestore([a.id]);
                    await refresh();
                    await onChanged();
                  }}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="btn danger tiny"
                  onClick={async () => {
                    if (confirm(`Delete archived chat "${a.title}" forever?`)) {
                      await api.archiveDelete([a.id]);
                      await refresh();
                    }
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function LogViewer({ raw }: { raw: string }) {
  const [level, setLevel] = useState<"all" | "info" | "warn" | "error">("all");
  const [text, setText] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const boxRef = useRef<HTMLPreElement | null>(null);

  const lines = raw.split("\n").filter(Boolean);
  const levelOf = (line: string): "info" | "warn" | "error" => {
    const m = line.match(/renderer\[(\w+)\]/);
    if (m) return (m[1] as "info" | "warn" | "error") ?? "info";
    if (/error|failed|✗/i.test(line)) return "error";
    if (/warn/i.test(line)) return "warn";
    return "info";
  };

  const filtered = lines.filter((l) => {
    if (level !== "all" && levelOf(l) !== level) return false;
    if (text.trim() && !l.toLowerCase().includes(text.trim().toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    if (autoScroll && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [filtered.length, autoScroll]);

  return (
    <>
      <div className="task-editor-row">
        <select value={level} onChange={(e) => setLevel(e.target.value as "all" | "info" | "warn" | "error")}>
          <option value="all">All levels</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
        <input placeholder="Filter text…" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <label className="project-menu-check" style={{ marginBottom: 6 }}>
        <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
        auto-scroll
      </label>
      <pre className="log-stream" ref={boxRef}>
        {filtered.length === 0 ? "(no matching lines)" : filtered.slice(-400).join("\n")}
      </pre>
    </>
  );
}
