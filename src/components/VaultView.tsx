import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { findGroup, useVault } from "../store";
import { confirmDanger } from "./common";
import { GroupTree } from "./GroupTree";
import { EntryList } from "./EntryList";
import { EntryForm } from "./EntryForm";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel"] as const;

/**
 * Closes the vault after `minutes` without input. Unapplied form edits are applied and the
 * vault saved first; if the user comes back or anything changes meanwhile, it stays open.
 */
function useIdleClose(minutes: number) {
  const lastActive = useRef(Date.now());

  useEffect(() => {
    if (minutes <= 0) return;
    const touch = () => (lastActive.current = Date.now());
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, touch));
    const timer = window.setInterval(async () => {
      if (Date.now() - lastActive.current < minutes * 60_000) return;
      const startedAt = Date.now();
      lastActive.current = startedAt; // one attempt per idle period
      const { pendingApply, setError, markClosed } = useVault.getState();
      try {
        if (pendingApply) await pendingApply();
        const hadChanges = useVault.getState().dirty;
        if (hadChanges) await useVault.getState().save();
        if (lastActive.current > startedAt) return; // the user came back during the save
        // The backend closes only if nothing changed since that save (checked under its lock).
        if (await api.closeVaultIfSaved()) {
          markClosed(`Vault closed after ${minutes} minutes of inactivity${hadChanges ? " (changes were saved)" : ""}.`);
        }
      } catch (e) {
        // Never close over changes that failed to apply or save.
        setError(`Auto-close skipped: saving failed — ${String(e)}`);
      }
    }, 15_000);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [minutes]);
}

export function VaultView() {
  const {
    tree,
    vaultPath,
    dirty,
    pendingApply,
    selectedGroupId,
    selectedEntryId,
    search,
    setSearch,
    createEntry,
    save,
    lock,
    error,
    setError,
    settings,
    updateSettings,
  } = useVault();
  useIdleClose(settings.autoLockMinutes);

  if (!tree) return null;
  const group = findGroup(tree, selectedGroupId) ?? tree;
  const vaultName = vaultPath?.split(/[\\/]/).pop() ?? "vault";

  async function onClose() {
    if ((dirty || pendingApply) && !(await confirmDanger("You have unsaved changes. Close the vault and discard them?"))) return;
    await lock();
  }

  async function onSave() {
    try {
      await save();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="vault">
      <header className="toolbar">
        <span className="app-name" title={vaultPath ?? ""}>
          Sectauri · {vaultName}
        </span>
        <input
          className="search"
          type="search"
          placeholder="Search all entries (title, username, URL, tags)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setSearch("")}
        />
        <div className="spacer" />
        <button
          className={`secondary${settings.layoutLocked ? " on" : ""}`}
          title={settings.layoutLocked ? "Layout locked: drag and drop is off" : "Layout unlocked: drag groups and entries to move them"}
          onClick={() => updateSettings({ layoutLocked: !settings.layoutLocked })}
        >
          {settings.layoutLocked ? "🔒 Layout locked" : "🔓 Layout unlocked"}
        </button>
        <button className={dirty ? "primary" : "secondary"} onClick={onSave} disabled={!dirty}>
          {dirty ? "● Save vault" : "Saved"}
        </button>
        <button className="ghost" onClick={onClose}>
          ⏏ Close vault
        </button>
      </header>

      {error && (
        <div className="error banner" onClick={() => setError(null)}>
          {error} <span className="dismiss">✕</span>
        </div>
      )}

      <div className="panes">
        <aside className="pane sidebar">
          <GroupTree root={tree} />
        </aside>
        <section className="pane list">
          <EntryList group={group} />
        </section>
        <section className="pane detail">
          {selectedEntryId ? (
            <EntryForm key={selectedEntryId} entryId={selectedEntryId} />
          ) : (
            <div className="empty cta">
              <p>Select an entry to view or edit it, or create a new entity.</p>
              <button className="primary" onClick={() => createEntry(group.id).catch((e) => setError(String(e)))}>
                + Entity
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
