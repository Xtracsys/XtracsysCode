import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { ChatSummary, Project } from "../types";
import { timeAgo } from "../lib/format";

interface Props {
  style?: React.CSSProperties;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  projects: Project[];
  chats: ChatSummary[];
  activeChatId: string | null;
  busyChats: Set<string>;
  onSelect: (id: string) => void;
  onNewChatInProject: (project: Project) => void;
  onNewProject: () => void;
  onOpenFolder: () => void;
  onDeleteChats: (ids: string[]) => void;
  onArchiveChats: (ids: string[]) => void;
  onMoveChat: (id: string, projectId: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string, alsoDeleteChats: boolean) => void;
  onOpenInFinder: (cwd: string) => void;
}

export function Sidebar({
  style,
  collapsed,
  onToggleCollapsed,
  projects,
  chats,
  activeChatId,
  busyChats,
  onSelect,
  onNewChatInProject,
  onNewProject,
  onOpenFolder,
  onDeleteChats,
  onArchiveChats,
  onMoveChat,
  onRenameProject,
  onDeleteProject,
  onOpenInFinder,
}: Props) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  const [deleteProjectStep, setDeleteProjectStep] = useState<string | null>(null);
  const [renameStep, setRenameStep] = useState<{ id: string; name: string } | null>(null);
  const [moveTargets, setMoveTargets] = useState<string[] | null>(null); // M1: pending bulk move

  const byProject = useMemo(() => {
    const map = new Map<string, ChatSummary[]>();
    for (const c of chats) {
      const list = map.get(c.projectId) ?? [];
      list.push(c);
      map.set(c.projectId, list);
    }
    return map;
  }, [chats]);

  const chatById = useMemo(() => new Map(chats.map((c) => [c.id, c])), [chats]);

  // P10: Esc closes the project popover; click-outside and resize close it too.
  // The menu is position:fixed so .project-sessions' overflow-y:auto can't clip it.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => {
      setMenuFor(null);
      setMenuAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menuFor]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
    setMoveTargets(null);
  };

  if (collapsed) {
    return (
      <aside className="sidebar collapsed" style={style}>
        <div className="sidebar-header">
          <button
            type="button"
            className="icon-btn"
            title="Show sidebar"
            onClick={() => onToggleCollapsed?.()}
          >
            ▶
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar" style={style}>
      <div className="sidebar-header">
        <div className="brand">
          <img src="logo.png" alt="" className="brand-logo" />
          <div>
            <div className="brand-name">XtracsysCode</div>
            <div className="brand-sub">local · offline · yours</div>
          </div>
        </div>
        <button
          type="button"
          className="icon-btn"
          title="Collapse sidebar"
          onClick={() => onToggleCollapsed?.()}
        >
          ◀
        </button>
        <button
          type="button"
          className={`btn ghost tiny ${selectMode ? "active" : ""}`}
          title="Select multiple chats for bulk actions"
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
        >
          {selectMode ? "Cancel" : "Select"}
        </button>
      </div>

      {!selectMode && (
        <div className="project-actions">
          <button type="button" className="btn primary small" onClick={onNewProject}>
            + New project
          </button>
          <button type="button" className="btn ghost small" onClick={onOpenFolder}>
            Open folder…
          </button>
        </div>
      )}

      <SearchBox onSelect={onSelect} />

      <div className="project-sessions">
        {projects.length === 0 && (
          <div className="side-empty">
            <p className="side-empty-title">No projects yet</p>
            <p className="hint">A project is a local folder the agent works in.</p>
          </div>
        )}
        {selectMode && moveTargets !== null && (
          <div className="bulk-move-projects">
            <div className="hint" style={{ padding: "4px 8px" }}>
              Move {moveTargets.length} chat(s) to:
            </div>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn ghost small"
                onClick={() => {
                  for (const id of moveTargets) onMoveChat(id, p.id);
                  exitSelectMode();
                }}
              >
                → {p.name}
              </button>
            ))}
            <button type="button" className="btn ghost small" onClick={() => setMoveTargets(null)}>
              Cancel move
            </button>
          </div>
        )}
        {projects.map((project) => {
          const list = byProject.get(project.id) ?? [];
          return (
            <div className="project-group" key={project.id}>
              <div className="project-header">
                <div className="project-name">
                  <span className="project-name-text">{project.name}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Project menu — new chat, rename, delete"
                    onClick={(e) => {
                      // Keep the opening click from reaching the window-level
                      // click-outside closer before it is attached.
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      if (menuFor === project.id) {
                        setMenuFor(null);
                        setMenuAt(null);
                        return;
                      }
                      setMenuFor(project.id);
                      setMenuAt({
                        top: Math.min(r.bottom + 4, window.innerHeight - 240),
                        left: Math.max(8, Math.min(r.left, window.innerWidth - 240)),
                      });
                      setDeleteProjectStep(null);
                      setRenameStep(null);
                    }}
                  >
                    ⋯
                  </button>
                </div>
                <div className="project-path" title={project.cwd}>{project.cwd}</div>
                {!selectMode && (
                  <button type="button" className="btn ghost tiny" onClick={() => onNewChatInProject(project)}>
                    + chat
                  </button>
                )}
                {menuFor === project.id && menuAt && (
                  <div
                    className="project-menu open-at-cursor"
                    role="menu"
                    style={{ position: "fixed", top: menuAt.top, left: menuAt.left }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {renameStep?.id === project.id ? (
                      <div className="project-menu-row">
                        <input
                          autoFocus
                          value={renameStep.name}
                          onChange={(e) => setRenameStep({ id: project.id, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && renameStep.name.trim()) {
                              onRenameProject(project.id, renameStep.name.trim());
                              setRenameStep(null);
                              setMenuFor(null);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn primary tiny"
                          disabled={!renameStep.name.trim()}
                          onClick={() => {
                            onRenameProject(project.id, renameStep.name.trim());
                            setRenameStep(null);
                            setMenuFor(null);
                          }}
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="project-menu-item"
                        onClick={() => {
                          onNewChatInProject(project);
                          setMenuFor(null);
                        }}
                      >
                        New chat
                      </button>
                    )}
                    <button
                      type="button"
                      className="project-menu-item"
                      onClick={() => {
                        onOpenInFinder(project.cwd);
                        setMenuFor(null);
                      }}
                    >
                      Open in Finder
                    </button>
                    {renameStep?.id !== project.id && (
                      <button
                        type="button"
                        className="project-menu-item"
                        onClick={() => setRenameStep({ id: project.id, name: project.name })}
                      >
                        Rename project
                      </button>
                    )}
                    {deleteProjectStep === project.id ? (
                      <div className="project-menu-row col">
                        <label className="project-menu-check">
                          <input type="checkbox" defaultChecked id={`del-${project.id}`} />
                          also delete its {list.length} chat{list.length === 1 ? "" : "s"}
                        </label>
                        <div className="btn-row">
                          <button type="button" className="btn ghost tiny" onClick={() => setDeleteProjectStep(null)}>
                            Keep
                          </button>
                          <button
                            type="button"
                            className="btn danger tiny"
                            onClick={(e) => {
                              const also =
                                (document.getElementById(`del-${project.id}`) as HTMLInputElement | null)?.checked ?? false;
                              onDeleteProject(project.id, also);
                              setDeleteProjectStep(null);
                              setMenuFor(null);
                            }}
                          >
                            Delete project
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="project-menu-item danger"
                        onClick={() => setDeleteProjectStep(project.id)}
                      >
                        Delete project…
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="session-list">
                {list.length === 0 && <div className="side-empty-title muted">no chats</div>}
                {list.map((chat) => (
                  <div
                    key={chat.id}
                    className={`session-item ${chat.id === activeChatId ? "active" : ""} ${
                      selectMode && selected.has(chat.id) ? "selected" : ""
                    }`}
                    onClick={() => {
                      if (selectMode) toggleSelected(chat.id);
                      else onSelect(chat.id);
                    }}
                  >
                    {selectMode && (
                      <input
                        type="checkbox"
                        checked={selected.has(chat.id)}
                        onChange={() => toggleSelected(chat.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <div className="session-main">
                      <div className="session-title-row">
                        <span className="session-title">{chat.title}</span>
                        {busyChats.has(chat.id) && (
                          <span className="live-pill tiny">
                            <span className="pulse-dot sm" />
                          </span>
                        )}
                      </div>
                      <div className="session-meta">
                        {chat.approvalMode === "ask" && (
                          <span title="approvals: ask">🔒</span>
                        )}{" "}
                        {chat.model || "auto"} · {timeAgo(chat.updatedAt)}
                      </div>
                    </div>
                    {!selectMode && (
                      <>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Archive chat (hide it, keep the files)"
                          onClick={(e) => {
                            e.stopPropagation();
                            onArchiveChats([chat.id]);
                          }}
                        >
                          🗄
                        </button>
                        <button
                          type="button"
                          className="chat-del-btn"
                          title="Delete chat"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete chat "${chat.title}"? The transcript will be removed from disk.`)) {
                              onDeleteChats([chat.id]);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selectMode && selected.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{selected.size} selected</span>
          <button
            type="button"
            className="btn danger small"
            onClick={() => {
              const names = [...selected].map((id) => chatById.get(id)?.title ?? id);
              const preview = names.slice(0, 4).join(" · ") + (names.length > 4 ? ` … (+${names.length - 4})` : "");
              if (confirm(`Delete ${names.length} chats?\n${preview}\n\nTranscripts will be removed from disk.`)) {
                onDeleteChats([...selected]);
                exitSelectMode();
              }
            }}
          >
            Delete ({selected.size})
          </button>
          <button
            type="button"
            className="btn ghost small"
            title="Archive selected chats (kept in ~/XtracsysCode/archive)"
            onClick={() => {
              onArchiveChats([...selected]);
              exitSelectMode();
            }}
          >
            Archive ({selected.size})
          </button>
          {moveTargets === null && (
            <button
              type="button"
              className="btn ghost small"
              title="Move selected chats to another project"
              onClick={() => setMoveTargets([...selected])}
            >
              Move to project…
            </button>
          )}
          <button type="button" className="btn ghost small" onClick={exitSelectMode}>
            Cancel
          </button>
        </div>
      )}
    </aside>
  );
}

function SearchBox({ onSelect }: { onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; title: string; snippet: string }[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChange = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    const q = value.trim();
    if (!q) {
      setResults(null);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        setResults(await api.searchChats(q));
      } catch {
        setResults([]);
      }
    }, 250);
  };

  return (
    <div className="chat-search">
      <input
        className="chat-search-input"
        placeholder="Search all chats…"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Search all chats"
      />
      {results && (
        <div className="chat-search-results">
          {results.length === 0 && <div className="hint">No matches.</div>}
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              className="chat-search-hit"
              onClick={() => {
                onSelect(r.id);
                setQuery("");
                setResults(null);
              }}
            >
              <div className="session-title">{r.title}</div>
              <div className="session-meta">{r.snippet}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
