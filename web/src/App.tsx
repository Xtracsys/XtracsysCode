import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chat } from "./components/Chat";
import { Settings } from "./components/Settings";
import { NewProjectModal, PermissionCard } from "./components/Modals";
import { WelcomeWizard } from "./components/WelcomeWizard";
import { Sidebar } from "./components/Sidebar";
import { useXtrac } from "./hooks/useXtrac";
import { useTheme } from "./hooks/useTheme";
import { useAppearance } from "./hooks/useAppearance";
import { api } from "./api";
import { basename, formatBytes } from "./lib/format";
import type { Project } from "./types";

interface Layout {
  sidebarWidth: number;
  inspectorWidth: number;
  composerHeight: number;
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
}

const DEFAULT_LAYOUT: Layout = {
  sidebarWidth: 260,
  inspectorWidth: 340,
  composerHeight: 160,
  sidebarCollapsed: false,
  inspectorCollapsed: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function App() {
  const x = useXtrac();
  const { theme, toggleTheme } = useTheme();
  const appearance = useAppearance();
  // Settings is a modal (no longer a docked panel); the component stays mounted
  // so the last-visited section is remembered between opens.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Closing a tab only hides it from the tab strip; chat records remain in the project list.
  const [closedTabIds, setClosedTabIds] = useState<Set<string>>(() => new Set());
  const [modal, setModal] = useState<"new-project" | null>(null);
  // P8: first-run wizard when there are no projects yet.
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const welcomeChecked = useRef(false);
  useEffect(() => {
    if (welcomeChecked.current || !x.ready) return;
    welcomeChecked.current = true;
    if (x.projects.length === 0) setWelcomeOpen(true);
  }, [x.ready, x.projects]);

  // M2: resizable, persistent layout.
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const layoutInit = useRef(false);
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!layoutInit.current && x.settings) {
      layoutInit.current = true;
      setLayout({ ...DEFAULT_LAYOUT, ...(x.settings.layout ?? {}) });
    }
      appearance.initFrom(x.settings?.appearance);
  }, [x.settings]);
  const applyLayout = useCallback((patch: Partial<Layout>) => {
    setLayout((prev) => {
      const next = { ...prev, ...patch };
      if (layoutSaveTimer.current) clearTimeout(layoutSaveTimer.current);
      layoutSaveTimer.current = setTimeout(() => {
        void api.setSettings({ layout: next });
      }, 400);
      return next;
    });
  }, []);
  const startDrag = (
    e: React.PointerEvent,
    onMove: (ev: PointerEvent) => Partial<Layout>,
  ) => {
    e.preventDefault();
    let last: Partial<Layout> = {};
    const move = (ev: PointerEvent) => {
      last = onMove(ev);
      applyLayout(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (layoutSaveTimer.current) clearTimeout(layoutSaveTimer.current);
      setLayout((final) => {
        void api.setSettings({ layout: final });
        return final;
      });
      void last;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const newChatInProject = async (project: Project) => {
    try {
      const chat = await api.createChat({ projectId: project.id });
      await x.refresh();
      x.setActiveChatId(chat.id);
    } catch (e) {
      x.setError((e as Error).message);
    }
  };

  const openFolder = async () => {
    const picked = await api.pickDir();
    if (!picked) return;
    try {
      const chat = await api.createChat({ cwd: picked });
      await x.refresh();
      x.setActiveChatId(chat.id);
    } catch (e) {
      x.setError((e as Error).message);
    }
  };

  const activeChatRunning = x.activeChat?.status === "running";

  // N14: ⌘T new chat, ⌘K command palette.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        setPaletteQuery("");
      } else if (k === "t") {
        e.preventDefault();
        const project = x.projects[0];
        if (project) void newChatInProject(project);
        else setModal("new-project");
      } else if (k === ",") {
        // Standard macOS settings shortcut.
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // M3: tab-strip right-click context menu.
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; chatId: string } | null>(null);
  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTabMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [tabMenu]);

  // M10: "?" or ⌘/ opens the shortcut cheatsheet.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !typing) {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key === "/" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteItems = useMemo(() => {    const q = paletteQuery.trim().toLowerCase();
    const items: { label: string; hint: string; run: () => void }[] = [
      { label: "New project", hint: "create", run: () => setModal("new-project") },
      { label: "Open folder…", hint: "open", run: () => void openFolder() },
      { label: "Settings", hint: "⌘,", run: () => setSettingsOpen(true) },
      { label: "New chat in first project", hint: "chat", run: () => x.projects[0] && void newChatInProject(x.projects[0]) },
      { label: "Keyboard shortcuts", hint: "?", run: () => setShortcutsOpen(true) },
      ...x.chats.map((c) => ({ label: c.title, hint: "switch chat", run: () => x.setActiveChatId(c.id) })),
    ];
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteQuery, x.chats, x.projects]);

  return (
    <div
      className="app"
      style={{
        gridTemplateColumns: `${layout.sidebarCollapsed ? 44 : layout.sidebarWidth}px minmax(0, 1fr)`,
      }}
    >
      {(
          <Sidebar
            collapsed={layout.sidebarCollapsed}
            onToggleCollapsed={() => applyLayout({ sidebarCollapsed: !layout.sidebarCollapsed })}
            style={{ width: layout.sidebarCollapsed ? 44 : layout.sidebarWidth }}
            projects={x.projects}
            chats={x.chats}
            activeChatId={x.activeChatId}
            busyChats={x.busyChats}
            onSelect={(id) => {
              setClosedTabIds((prev) => {
                if (!prev.has(id)) return prev;
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
              x.setActiveChatId(id);
            }}
            onNewChatInProject={(p) => void newChatInProject(p)}
            onNewProject={() => setModal("new-project")}
            onOpenFolder={() => void openFolder()}
            onDeleteChats={(ids) => void x.deleteChats(ids)}
            onArchiveChats={(ids) => void x.archiveChats(ids)}
            onMoveChat={(id, projectId) => void x.moveChat(id, projectId)}
            onRenameProject={(id, name) => void x.renameProject(id, name)}
            onDeleteProject={(id, also) => void x.deleteProject(id, also)}
            onOpenInFinder={(cwd) => void api.openInFinder(cwd)}
          />
      )}
      {!layout.sidebarCollapsed && (
        <div
          className="resize-handle-v"
          style={{ left: layout.sidebarWidth - 4 }}
          title="Drag to resize sidebar"
          onPointerDown={(e) =>
            startDrag(e, (ev) => ({ sidebarWidth: clamp(ev.clientX, 180, 480) }))
          }
          onDoubleClick={() => applyLayout({ sidebarWidth: 260 })}
        />
      )}

      <main className="main">
        <header className="main-header">
          <div className="header-text">
            <div className="title-row">
              <h1>{x.activeChat ? x.activeChat.title : "XtracsysCode"}</h1>
              {activeChatRunning && (
                <span className="live-pill">
                  <span className="pulse-dot" />
                  Running
                </span>
              )}
              {x.busyChats.size > 1 && (
                <span className="busy-pill" title="Other chats still working">
                  {x.busyChats.size} busy
                </span>
              )}
            </div>
            <div className="header-sub">
              <p className="muted">
                {x.activeChat
                  ? `${basename(x.activeChat.cwd)} · ${x.activeChat.cwd}`
                  : "Local agent · Ollama / llama.cpp · no cloud"}
                {x.settings && ` · ${x.settings.model || "model: auto"}`}
              </p>
              {x.activeChat && (
                <div className="project-quick-actions">
                  <button
                    type="button"
                    className="btn ghost tiny"
                    title="Open this chat in its own window"
                    onClick={() => void api.openChatWindow(x.activeChat!.id)}
                  >
                    ⧉ Window
                  </button>
                  <button
                    type="button"
                    className="btn ghost tiny"
                    title="Reveal the Markdown transcript in Finder"
                    onClick={() => void api.revealTranscript(x.activeChat!.id)}
                  >
                    Transcript
                  </button>
                  <button type="button" className="btn ghost tiny" onClick={() => void api.openInFinder(x.activeChat!.cwd)}>
                    Finder
                  </button>
                  <button type="button" className="btn ghost tiny" onClick={() => void api.openInTerminal(x.activeChat!.cwd)}>
                    Terminal
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="header-actions">
            {x.error && (
              <div className="error-banner" onClick={() => x.setError(null)} role="alert">
                {x.error}
                <span className="dismiss">dismiss</span>
              </div>
            )}
            <button type="button" className="btn ghost tiny" onClick={toggleTheme}>
              {theme === "dark" ? "☀ Light" : "☾ Dark"}
            </button>
            {x.usage && (
              <span className="usage-pill" title={`Storage used under ${x.usage.root}`}>
                ⛁ {formatBytes(x.usage.total)}
              </span>
            )}
            <button
              type="button"
              className={`btn ghost tiny ${settingsOpen ? "active" : ""}`}
              title="Settings (⌘,)"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙ Settings
            </button>
          </div>
        </header>

        {x.chats.some((c) => !closedTabIds.has(c.id)) && (
          <div className="tab-strip" role="tablist" aria-label="Open chats">
            {x.chats.filter((c) => !closedTabIds.has(c.id)).slice(0, 10).map((c) => (
              <div
                key={c.id}
                role="tab"
                aria-selected={c.id === x.activeChatId}
                className={`tab-item ${c.id === x.activeChatId ? "active" : ""}`}
                onClick={() => x.setActiveChatId(c.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    setClosedTabIds((prev) => new Set(prev).add(c.id));
                    if (x.activeChatId === c.id) {
                      const next = x.chats.find((chat) => chat.id !== c.id && !closedTabIds.has(chat.id));
                      x.setActiveChatId(next?.id ?? null);
                    }
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTabMenu({ x: e.clientX, y: e.clientY, chatId: c.id });
                }}
                title={c.cwd}
              >
                <span className={`pulse-dot sm ${x.busyChats.has(c.id) ? "" : "idle"}`} />
                <span className="tab-label">{c.title}</span>
                <button
                  type="button"
                  className="icon-btn"
                  title="Close tab"
                  onClick={(e) => {
                    setClosedTabIds((prev) => new Set(prev).add(c.id));
                    if (x.activeChatId === c.id) {
                      const next = x.chats.find((chat) => chat.id !== c.id && !closedTabIds.has(chat.id));
                      x.setActiveChatId(next?.id ?? null);
                    }
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {x.permission && (
          <PermissionCard
            toolName={x.permission.toolName}
            summary={x.permission.summary}
            onAnswer={(allow, always) => void x.answerPermission(allow, always)}
          />
        )}

        <Chat
          items={x.activeTimeline}
          chat={x.activeChat}
          ready={x.ready}
          models={x.models}
          ctx={{
            numCtx: x.settings?.numCtx ?? 0,
            budgetChars: x.settings?.historyCharBudget ?? 80000,
          }}
          composerHeight={layout.composerHeight}
          onComposerResize={(h) => applyLayout({ composerHeight: clamp(h, 80, 300) })}
          onSend={(t) => void x.sendPrompt(t)}
          onCancel={() => void x.cancel()}
          onRetry={() => void x.retryLast()}
          onNewChat={() => setModal("new-project")}
          onToggleApproval={(m) => void x.setChatApproval(m)}
          onSwitchModel={(m) => void x.setChatModel(m)}
        />
      </main>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={x.settings}
        usage={x.usage}
        tasks={x.tasks}
        projects={x.projects}
        activeChat={x.activeChat}
        activeChatPlan={x.activeChat?.plan ?? null}
        appearanceSet={appearance.set}
        onRefreshUsage={x.refreshUsage}
        onSettingsChanged={x.refresh}
        onDeleteProject={(id, also) => x.deleteProject(id, also)}
        onOpenChat={(id) => {
          x.setActiveChatId(id);
          setSettingsOpen(false);
        }}
      />

      {tabMenu && (
        <div className="project-menu open-at-cursor" style={{ left: tabMenu.x, top: tabMenu.y, position: "fixed" }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="project-menu-item"
            onClick={() => {
              void api.openChatWindow(tabMenu.chatId);
              setTabMenu(null);
            }}
          >
            Open in new window
          </button>
          <button
            type="button"
            className="project-menu-item"
            onClick={() => {
              x.setActiveChatId(tabMenu.chatId);
              setTabMenu(null);
            }}
          >
            Switch to chat
          </button>
        </div>
      )}

      {modal === "new-project" && (
        <NewProjectModal
          onClose={() => setModal(null)}
          onCreate={async (name, cwd) => {
            await api.createProject(name, cwd);
            const chat = await api.createChat({ cwd });
            await x.refresh();
            x.setActiveChatId(chat.id);
          }}
        />
      )}

      {paletteOpen && (
        <div className="modal-backdrop" onClick={() => setPaletteOpen(false)}>
          <div className="modal-card palette" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              className="field-input"
              placeholder="Type a command or chat name…"
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setPaletteOpen(false);
                if (e.key === "Enter" && paletteItems[0]) {
                  paletteItems[0].run();
                  setPaletteOpen(false);
                }
              }}
            />
            <div className="palette-list">
              {paletteItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="chat-search-hit"
                  onClick={() => {
                    item.run();
                    setPaletteOpen(false);
                  }}
                >
                  <div className="session-title">{item.label}</div>
                  <div className="session-meta">{item.hint}</div>
                </button>
              ))}
              {paletteItems.length === 0 && <p className="hint">No matches.</p>}
            </div>
          </div>
        </div>
      )}
      {welcomeOpen && (
        <WelcomeWizard
          onClose={() => setWelcomeOpen(false)}
          onDone={async () => {
            await x.refresh();
          }}
        />
      )}

      {shortcutsOpen && (
        <div className="modal-backdrop" onClick={() => setShortcutsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Keyboard shortcuts</h3>
            <table className="shortcuts-table">
              <tbody>
                {[
                  ["⌘K", "Command palette (switch chats, actions)"],
                  ["⌘T", "New chat in the first project"],
                  ["⌘,", "Settings"],
                  ["⌘/", "This cheatsheet (also: ? outside a text field)"],
                  ["Enter", "Send message"],
                  ["⇧Enter", "New line in the composer"],
                  ["Esc", "Close dialogs"],
                ].map(([keys, desc]) => (
                  <tr key={keys}>
                    <td>
                      <kbd>{keys}</kbd>
                    </td>
                    <td>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-actions">
              <button type="button" className="btn primary" onClick={() => setShortcutsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
