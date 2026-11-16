// Minimal UI state. Secrets are not held here beyond what is on screen; the
// decrypted database lives in the Rust backend.
import { create } from "zustand";
import { api, type GroupDto } from "./lib/api";
import { getSettings, saveSettings, type Settings } from "./lib/settings";

export type SortKey = "title" | "username" | "modified";
export type SortDir = "asc" | "desc";

interface VaultState {
  /** Sectauri app login passed (master password / TOTP / trusted device). */
  appUnlocked: boolean;
  unlocked: boolean;
  vaultPath: string | null;
  dirty: boolean;
  /** Bumped by every in-memory change, so a save knows whether edits arrived meanwhile. */
  revision: number;
  tree: GroupDto | null;
  selectedGroupId: string | null;
  selectedEntryId: string | null;
  error: string | null;
  /** Shown on the dashboard, e.g. why a vault was closed. */
  notice: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
  search: string;
  settings: Settings;
  /** Applies the entry form's unapplied edits; set while the form has a draft. */
  pendingApply: (() => Promise<void>) | null;

  setAppUnlocked: (value: boolean) => void;
  lockApp: () => Promise<void>;
  setSort: (key: SortKey) => void;
  setSearch: (query: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setUnlocked: (tree: GroupDto, path: string) => void;
  lock: (notice?: string) => Promise<void>;
  /** The backend already closed the vault (idle auto-close); reset the UI. */
  markClosed: (notice: string) => void;
  setPendingApply: (apply: (() => Promise<void>) | null) => void;
  refreshTree: () => Promise<void>;
  selectGroup: (id: string | null) => void;
  selectEntry: (id: string | null) => void;
  moveEntry: (entryId: string, targetGroupId: string) => Promise<void>;
  moveGroup: (groupId: string, targetParentId: string) => Promise<void>;
  /** Adds a blank entry to the group and opens it in the form. */
  createEntry: (groupId: string) => Promise<void>;
  deleteEntry: (entryId: string) => Promise<void>;
  markDirty: () => void;
  save: () => Promise<void>;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
}

const CLOSED = {
  unlocked: false,
  vaultPath: null,
  dirty: false,
  tree: null,
  selectedGroupId: null,
  selectedEntryId: null,
  error: null,
  search: "",
  pendingApply: null,
};

export const useVault = create<VaultState>((set, get) => ({
  appUnlocked: false,
  ...CLOSED,
  revision: 0,
  notice: null,
  sortKey: "title",
  sortDir: "asc",
  settings: getSettings(),

  setAppUnlocked: (value) => set({ appUnlocked: value }),

  lockApp: async () => {
    await api.authLock();
    set({ ...CLOSED, appUnlocked: false });
  },

  // Clicking the active key flips direction; a new key starts ascending, except
  // "modified", which starts with the newest.
  setSort: (key) =>
    set((s) =>
      s.sortKey === key
        ? { sortDir: s.sortDir === "asc" ? "desc" : "asc" }
        : { sortKey: key, sortDir: key === "modified" ? "desc" : "asc" }
    ),

  setSearch: (query) => set({ search: query }),

  updateSettings: (patch) => set({ settings: saveSettings(patch) }),

  setUnlocked: (tree, path) =>
    set({
      unlocked: true,
      vaultPath: path,
      dirty: false,
      tree,
      selectedGroupId: tree.id,
      selectedEntryId: null,
      error: null,
      notice: null,
      search: "",
    }),

  lock: async (notice) => {
    await api.lockVault();
    set({ ...CLOSED, notice: notice ?? null });
  },

  markClosed: (notice) => set({ ...CLOSED, notice }),

  setPendingApply: (apply) => set({ pendingApply: apply }),

  refreshTree: async () => {
    const tree = await api.getTree();
    set({ tree });
  },

  selectGroup: (id) => set({ selectedGroupId: id, selectedEntryId: null }),
  selectEntry: (id) => set({ selectedEntryId: id }),

  // Relocate an entry into another group, then refresh the cached tree so both
  // the source and target group counts/lists reflect the move.
  moveEntry: async (entryId, targetGroupId) => {
    await api.moveEntry(entryId, targetGroupId);
    get().markDirty();
    set({ tree: await api.getTree() });
  },

  moveGroup: async (groupId, targetParentId) => {
    await api.moveGroup(groupId, targetParentId);
    get().markDirty();
    set({ tree: await api.getTree() });
  },

  createEntry: async (groupId) => {
    const id = await api.createEntry(groupId, {
      title: "New entry",
      username: "",
      password: "",
      url: "",
      notes: "",
      custom: [],
    });
    get().markDirty();
    set({ tree: await api.getTree(), selectedGroupId: groupId, selectedEntryId: id, search: "" });
  },

  deleteEntry: async (entryId) => {
    await api.deleteEntry(entryId);
    get().markDirty();
    set((s) => ({ selectedEntryId: s.selectedEntryId === entryId ? null : s.selectedEntryId }));
    set({ tree: await api.getTree() });
  },

  markDirty: () => set((s) => ({ dirty: true, revision: s.revision + 1 })),

  save: async () => {
    const started = get().revision;
    await api.saveVault();
    // An edit applied while the save ran keeps the vault marked unsaved.
    if (get().unlocked && get().revision === started) set({ dirty: false });
  },

  setError: (message) => set({ error: message }),
  setNotice: (message) => set({ notice: message }),
}));

// Depth-first search for a group node in the cached tree.
export function findGroup(tree: GroupDto | null, id: string | null): GroupDto | null {
  if (!tree || !id) return null;
  if (tree.id === id) return tree;
  for (const child of tree.groups) {
    const found = findGroup(child, id);
    if (found) return found;
  }
  return null;
}

export { api, type GroupDto };
