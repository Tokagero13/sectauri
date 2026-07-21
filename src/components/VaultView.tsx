import { api } from "../lib/api";
import { findGroup, useVault } from "../store";
import { GroupTree } from "./GroupTree";
import { EntryList } from "./EntryList";
import { EntryForm } from "./EntryForm";

const BLANK_ENTRY = {
  title: "New entry",
  username: "",
  password: "",
  url: "",
  notes: "",
  custom: [],
};

export function VaultView() {
  const {
    tree,
    dirty,
    selectedGroupId,
    selectedEntryId,
    selectGroup,
    selectEntry,
    refreshTree,
    markDirty,
    save,
    lock,
    error,
    setError,
  } = useVault();

  if (!tree) return null;
  const rootId = tree.id;
  const group = findGroup(tree, selectedGroupId) ?? tree;

  async function addEntry() {
    try {
      const id = await api.createEntry(group.id, BLANK_ENTRY);
      markDirty();
      await refreshTree();
      selectEntry(id);
    } catch (e) {
      setError(String(e));
    }
  }

  async function addGroup() {
    const name = window.prompt("New group name:");
    if (!name) return;
    try {
      await api.createGroup(group.id, name);
      markDirty();
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  async function removeGroup() {
    if (group.id === rootId) return;
    if (!window.confirm(`Delete group “${group.name}” and everything in it?`)) return;
    try {
      await api.deleteGroup(group.id);
      selectGroup(rootId);
      markDirty();
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onLock() {
    if (dirty && !window.confirm("You have unsaved changes. Lock and discard them?")) return;
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
        <span className="app-name">sectauri</span>
        <div className="spacer" />
        <button className="secondary" onClick={addEntry}>
          + Entry
        </button>
        <button className="secondary" onClick={addGroup}>
          + Group
        </button>
        <button
          className="secondary"
          onClick={removeGroup}
          disabled={group.id === tree.id}
        >
          Delete group
        </button>
        <button className={dirty ? "primary" : "secondary"} onClick={onSave} disabled={!dirty}>
          {dirty ? "● Save vault" : "Saved"}
        </button>
        <button className="ghost" onClick={onLock}>
          🔒 Lock
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
            <div className="empty">Select an entry to view or edit it.</div>
          )}
        </section>
      </div>
    </div>
  );
}
