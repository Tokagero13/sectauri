import { useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { addRecent, getRecent, removeRecent, type RecentVault } from "../lib/recent";
import { useVault } from "../store";

const KDBX_FILTER = [{ name: "KeePass Vault", extensions: ["kdbx"] }];

export function UnlockScreen() {
  const setUnlocked = useVault((s) => s.setUnlocked);
  const [path, setPath] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentVault[]>(getRecent());
  const passwordRef = useRef<HTMLInputElement>(null);

  async function pickExisting() {
    const selected = await open({ multiple: false, filters: KDBX_FILTER });
    if (typeof selected === "string") {
      setPath(selected);
      setError(null);
      passwordRef.current?.focus();
    }
  }

  function chooseRecent(vault: RecentVault) {
    setPath(vault.path);
    setError(null);
    passwordRef.current?.focus();
  }

  function forgetRecent(vault: RecentVault) {
    setRecent(removeRecent(vault.path));
    if (path === vault.path) setPath(null);
  }

  async function unlock() {
    if (!path || busy) return;
    setBusy(true);
    setError(null);
    try {
      const tree = await api.openVault(path, password);
      addRecent(path);
      setUnlocked(tree);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  async function createNew() {
    if (busy) return;
    const target = await save({ filters: KDBX_FILTER, defaultPath: "vault.kdbx" });
    if (typeof target !== "string") return;
    if (!password) {
      setError("Set a master password before creating a vault.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tree = await api.createVault(target, password);
      addRecent(target);
      setUnlocked(tree);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  const fileName = path?.split(/[\\/]/).pop() ?? null;

  return (
    <div className="unlock">
      <div className="unlock-card">
        <h1 className="brand">sectauri</h1>
        <p className="subtitle">Open a KeePass KDBX vault</p>

        <button className="secondary full" onClick={pickExisting} disabled={busy}>
          {fileName ? `📄 ${fileName}` : "Choose .kdbx file…"}
        </button>

        {recent.length > 0 && (
          <div className="recent">
            <div className="recent-label">Recent vaults</div>
            {recent.map((vault) => (
              <div
                key={vault.path}
                className={`recent-item${path === vault.path ? " active" : ""}`}
              >
                <button className="recent-open" onClick={() => chooseRecent(vault)} title={vault.path}>
                  <span className="recent-name">🗝 {vault.name}</span>
                  <span className="recent-path">{vault.path}</span>
                </button>
                <button
                  className="icon recent-forget"
                  title="Remove from list"
                  onClick={() => forgetRecent(vault)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={passwordRef}
          className="full"
          type="password"
          placeholder="Master password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && unlock()}
          autoFocus
        />

        <button className="primary full" onClick={unlock} disabled={!path || busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>

        <div className="divider">or</div>
        <button className="ghost full" onClick={createNew} disabled={busy}>
          Create a new vault…
        </button>

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
