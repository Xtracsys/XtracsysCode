import { useEffect, useState } from "react";
import { api } from "../api";
import type { ModelsInfo } from "../types";
import { basename } from "../lib/format";

/** P8: first-run wizard — backend probe, first project, shortcuts hint. Skippable. */
export function WelcomeWizard({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (opts: { provider: "ollama" | "llamacpp"; model: string; cwd: string; created: boolean }) => void;
}) {
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<"ollama" | "llamacpp">("ollama");
  const [models, setModels] = useState<ModelsInfo | null>(null);
  const [model, setModel] = useState("");
  const [cwd, setCwd] = useState("");
  const [browse, setBrowse] = useState<{ path: string; entries: { path: string; name: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.browse().then((r) => {
      setBrowse(r);
      setCwd(r.path);
    });
  }, []);

  const probe = async () => {
    setBusy(true);
    setError(null);
    try {
      const info = await api.listModels();
      setModels(info);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void probe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pool = provider === "ollama" ? (models?.ollama ?? []) : (models?.llamacpp ?? []);
  const probeError = models ? (provider === "ollama" ? models.errors?.ollama : models.errors?.llamacpp) : undefined;

  const go = async (p?: string) => {
    const r = await api.browse(p);
    setBrowse(r);
    setCwd(r.path);
  };

  const finish = async (createProject: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.setSettings({ provider, model });
      let chatCwd = cwd;
      let created = false;
      if (createProject && cwd) {
        await api.createProject(basename(cwd), cwd);
        const chat = await api.createChat({ cwd });
        chatCwd = cwd;
        created = true;
        onDone({ provider, model, cwd: chatCwd, created });
        onClose();
        window.location.search = `?chat=${chat.id}`;
        return;
      }
      onDone({ provider, model, cwd: chatCwd, created });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card welcome">
        <h3>Welcome to XtracsysCode</h3>
        <p className="hint">
          A local coding agent. Everything runs on this machine — models via Ollama/llama.cpp, no cloud, no telemetry.
        </p>

        {step === 1 && (
          <>
            <label className="field">
              <span>Step 1 — model backend</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value as "ollama" | "llamacpp")}>
                <option value="ollama">Ollama</option>
                <option value="llamacpp">llama.cpp (llama-server)</option>
              </select>
            </label>
            <div className="btn-row" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="btn ghost small" onClick={() => void probe()} disabled={busy}>
                {busy ? "Probing…" : "Probe models"}
              </button>
              <span className="hint">
                {pool.length > 0 ? `${pool.length} models found` : probeError ? probeError : "not probed yet"}
              </span>
            </div>
            {pool.length > 0 && (
              <label className="field">
                <span>Default model (can change later)</span>
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">(auto — first available)</option>
                  {pool.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setStep(2)}>
                Skip for now
              </button>
              <button type="button" className="btn primary" onClick={() => setStep(2)}>
                Next
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <label className="field">
              <span>Step 2 — pick a project folder</span>
              <div className="path-row">
                <input readOnly value={cwd} />
                <button type="button" className="btn ghost small" onClick={() => go(browse?.path)}>
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
                {browse.entries.slice(0, 30).map((e) => (
                  <button key={e.path} type="button" className="browse-item" onClick={() => go(e.path)}>
                    📁 {e.name}
                  </button>
                ))}
              </div>
            )}
            <p className="hint">
              Step 3 is nothing — the scaffolded <code>AGENTS.md</code> in your project tells the agent its conventions.
              Shortcuts: ⌘K palette · ⌘T new chat · ? cheatsheet.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => onClose()}>
                Skip
              </button>
              <button type="button" className="btn primary" disabled={busy || !cwd} onClick={() => void finish(true)}>
                {busy ? "Setting up…" : "Create project & start"}
              </button>
            </div>
          </>
        )}

        {error && <p className="modal-error">{error}</p>}
      </div>
    </div>
  );
}
