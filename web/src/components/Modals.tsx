import { useEffect, useState } from "react";
import { api } from "../api";
import type { BrowseResult } from "../types";
import { basename } from "../lib/format";

/** Modal for creating a project: pick a folder (browse or native dialog) + optional name. */
export function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, cwd: string) => Promise<void>;
}) {
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [cwd, setCwd] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);

  const createFolder = async () => {
    const folderName = newFolderName.trim();
    if (!folderName || !cwd) return;
    setFolderBusy(true);
    setError(null);
    try {
      const created = await api.mkdir(cwd, folderName);
      const r = await api.browse(created);
      setBrowse(r);
      setCwd(r.path);
      setNewFolderName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFolderBusy(false);
    }
  };

  useEffect(() => {
    void api.browse().then((r) => {
      setBrowse(r);
      setCwd(r.path);
    });
  }, []);

  const go = async (p?: string) => {
    const r = await api.browse(p);
    setBrowse(r);
    setCwd(r.path);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim() || basename(cwd), cwd);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>New project</h3>
        <div className="modal-form">
          <label className="field">
            <span>Folder</span>
            <div className="path-row">
              <input readOnly value={cwd} />
              <button type="button" className="btn ghost small" onClick={() => go(browse?.parent)}>
                ↑ Up
              </button>
              <button
                type="button"
                className="btn ghost small"
                onClick={async () => {
                  const picked = await api.pickDir();
                  if (picked) setCwd(picked);
                }}
              >
                Choose…
              </button>
            </div>
          </label>

          {browse && (
            <div className="browse-list">
              {browse.entries.map((e) => (
                <button key={e.path} type="button" className="browse-item" onClick={() => go(e.path)}>
                  📁 {e.name}
                </button>
              ))}
              {browse.entries.length === 0 && <span className="hint">No subfolders</span>}
            </div>
          )}

          <label className="field">
            <span>Create a new folder here (optional)</span>
            <div className="path-row">
              <input
                value={newFolderName}
                placeholder="New folder name…"
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void createFolder();
                  }
                }}
              />
              <button
                type="button"
                className="btn ghost small"
                disabled={folderBusy || !newFolderName.trim()}
                onClick={() => void createFolder()}
              >
                {folderBusy ? "Creating…" : "+ New folder"}
              </button>
            </div>
          </label>

          <label className="field">
            <span>Project name (optional — defaults to folder name)</span>
            <input value={name} placeholder={basename(cwd)} onChange={(e) => setName(e.target.value)} />
          </label>

          {error && <p className="modal-error">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy || !cwd} onClick={create}>
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Non-blocking approval card shown above the composer. */
export function PermissionCard({
  toolName,
  summary,
  onAnswer,
}: {
  toolName: string;
  summary: string;
  onAnswer: (allow: boolean, always?: boolean) => void;
}) {
  const canAlwaysAllow = toolName === "run_command" || toolName === "write_file" || toolName === "edit_file";
  return (
    <div className="permission-card">
      <div className="permission-title">
        <b>Approval needed</b> — <code>{toolName}</code>
      </div>
      <pre className="tl-code">{summary}</pre>
      <div className="permission-actions">
        <button type="button" className="btn ghost small" onClick={() => onAnswer(false)}>
          Deny
        </button>
        <button type="button" className="btn ghost small" onClick={() => onAnswer(true)}>
          Allow
        </button>
        {canAlwaysAllow && (
          <button
            type="button"
            className="btn primary small"
            title="Allow this and add a matching rule to the project"
            onClick={() => onAnswer(true, true)}
          >
            Always allow
          </button>
        )}
      </div>
    </div>
  );
}
