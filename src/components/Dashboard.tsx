// Main menu after the app login: known vaults, unlock / create / open, access log, settings.
import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, type AuditEvent } from "../lib/api";
import { addRecent, getRecent, removeRecent, type RecentVault } from "../lib/recent";
import { formatTime } from "../lib/text";
import { useVault } from "../store";
import { AuditLog } from "./AuditLog";
import { LayoutWarning } from "./common";
import { SettingsPanel } from "./SettingsPanel";

const KDBX_FILTER = [{ name: "KeePass Vault", extensions: ["kdbx"] }];

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Last successful unlock and the failures after it, for a vault card. */
function summary(events: AuditEvent[], path: string) {
  const mine = events.filter((e) => e.vault_path === path); // newest first
  const lastOk = mine.find((e) => e.success);
  const failedSince = mine.findIndex((e) => e.success);
  return { lastOk: lastOk?.at ?? null, failed: failedSince === -1 ? mine.length : failedSince };
}

export function Dashboard() {
  const { setUnlocked, lockApp, notice, setNotice } = useVault();
  const [vaults, setVaults] = useState<RecentVault[]>(getRecent());
  const [selected, setSelected] = useState<string | null>(vaults[0]?.path ?? null);
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    api.auditLog().then(setEvents).catch(() => setEvents([]));
  }, []);

  // A file picked from disk shows as a card until it is unlocked (then it joins the list).
  const cards: RecentVault[] =
    selected && !vaults.some((v) => v.path === selected)
      ? [{ path: selected, name: fileName(selected), openedAt: 0 }, ...vaults]
      : vaults;

  function choose(path: string) {
    setSelected(path);
    setCreating(false);
    setPassword("");
    setError(null);
  }

  async function pickFile() {
    const file = await open({ multiple: false, filters: KDBX_FILTER });
    if (typeof file === "string") choose(file);
  }

  function forget(path: string) {
    setVaults(removeRecent(path));
    if (selected === path) setSelected(null);
  }

  async function unlock() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const tree = await api.openVault(selected, password);
      if (!useVault.getState().appUnlocked) return; // Sectauri was locked while it opened
      addRecent(selected);
      setUnlocked(tree, selected);
    } catch (e) {
      setError(String(e));
      api.auditLog().then(setEvents).catch(() => {});
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  async function createVault() {
    if (busy) return;
    if (!password) return setError("Set a password for the new vault.");
    if (password !== confirm) return setError("The passwords do not match.");
    const target = await save({ filters: KDBX_FILTER, defaultPath: "vault.kdbx" });
    if (typeof target !== "string") return;
    setBusy(true);
    setError(null);
    try {
      const tree = await api.createVault(target, password);
      if (!useVault.getState().appUnlocked) return;
      addRecent(target);
      setUnlocked(tree, target);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setPassword("");
      setConfirm("");
    }
  }

  return (
    <div className="dashboard">
      <header className="toolbar">
        <span className="app-name">Sectauri</span>
        <div className="spacer" />
        <button className="secondary" onClick={() => setSettingsOpen(true)}>
          ⚙ Settings
        </button>
        <button className="ghost" onClick={lockApp}>
          🔒 Lock Sectauri
        </button>
      </header>

      {notice && (
        <div className="notice banner" onClick={() => setNotice(null)}>
          {notice} <span className="dismiss">✕</span>
        </div>
      )}

      <main className="dash-main">
        <section>
          <div className="dash-head">
            <h2>Vaults</h2>
            <div className="spacer" />
            <button
              className="secondary"
              onClick={() => {
                setCreating(true);
                setSelected(null);
                setPassword("");
                setConfirm("");
                setError(null);
              }}
            >
              + New vault
            </button>
            <button className="secondary" onClick={pickFile}>
              Open from disk…
            </button>
          </div>

          {creating && (
            <div className="vault-card active create-card">
              <div className="vault-name">New vault</div>
              <input
                className="full"
                type="password"
                placeholder="Vault password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <LayoutWarning value={password} />
              <input
                className="full"
                type="password"
                placeholder="Confirm vault password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createVault()}
              />
              <LayoutWarning value={confirm} />
              <div className="modal-actions">
                <button className="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </button>
                <button className="primary" onClick={createVault} disabled={busy}>
                  {busy ? "Creating…" : "Choose location & create"}
                </button>
              </div>
            </div>
          )}

          {cards.length === 0 && !creating ? (
            <div className="empty">No vaults yet — create one or open a .kdbx file from disk.</div>
          ) : (
            <div className="vault-grid">
              {cards.map((v) => {
                const s = summary(events, v.path);
                const active = v.path === selected;
                return (
                  <div
                    key={v.path}
                    className={`vault-card${active ? " active" : ""}`}
                    onClick={() => !active && choose(v.path)}
                  >
                    <div className="vault-card-head">
                      <span className="vault-name">🗝 {v.name}</span>
                      <button
                        className="icon"
                        title="Remove from list (the file stays on disk)"
                        onClick={(e) => {
                          e.stopPropagation();
                          forget(v.path);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="vault-path" title={v.path}>
                      {v.path}
                    </div>
                    <div className="vault-meta">
                      Last unlocked: {formatTime(s.lastOk)}
                      {s.failed > 0 && <span className="failed"> · {s.failed} failed since</span>}
                    </div>
                    {active && (
                      <div className="vault-unlock" onClick={(e) => e.stopPropagation()}>
                        <input
                          className="full"
                          type="password"
                          placeholder="Vault password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && unlock()}
                          autoFocus
                        />
                        <LayoutWarning value={password} />
                        <button className="primary full" onClick={unlock} disabled={busy}>
                          {busy ? "Unlocking…" : "Unlock"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {error && <div className="error">{error}</div>}
        </section>

        <AuditLog events={events} />
      </main>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
