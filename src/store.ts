// Minimal UI state. Secrets are not held here beyond what is on screen; the
// decrypted database lives in the Rust backend.
import { create } from "zustand";
import { api, type GroupDto } from "./lib/api";

export type SortKey = "title" | "username";
export type SortDir = "asc" | "desc";

interface VaultState {
  unlocked: boolean;
  dirty: boolean;
  tree: GroupDto | null;
  selectedGroupId: string | null;
  selectedEntryId: string | null;
  error: string | null;
  sortKey: SortKey;
  sortDir: SortDir;

  setSort: (key: SortKey) => void;
  setUnlocked: (tree: GroupDto) => void;
  lock: () => Promise<void>;
  refreshTree: () => Promise<void>;
  selectGroup: (id: string | null) => void;
  selectEntry: (id: string | null) => void;
  markDirty: () => void;
  save: () => Promise<void>;
  setError: (message: string | null) => void;
}

export const useVault = create<VaultState>((set) => ({
  unlocked: false,
  dirty: false,
  tree: null,
  selectedGroupId: null,
  selectedEntryId: null,
  error: null,
  sortKey: "title",
  sortDir: "asc",

  // Clicking the active key flips direction; a new key resets to ascending.
  setSort: (key) =>
    set((s) =>
      s.sortKey === key
        ? { sortDir: s.sortDir === "asc" ? "desc" : "asc" }
        : { sortKey: key, sortDir: "asc" }
    ),

  setUnlocked: (tree) =>
    set({
      unlocked: true,
      dirty: false,
      tree,
      selectedGroupId: tree.id,
      selectedEntryId: null,
      error: null,
    }),

  lock: async () => {
    await api.lockVault();
    set({
      unlocked: false,
      dirty: false,
      tree: null,
      selectedGroupId: null,
      selectedEntryId: null,
      error: null,
    });
  },

  refreshTree: async () => {
    const tree = await api.getTree();
    set({ tree });
  },

  selectGroup: (id) => set({ selectedGroupId: id, selectedEntryId: null }),
  selectEntry: (id) => set({ selectedEntryId: id }),
  markDirty: () => set({ dirty: true }),

  save: async () => {
    await api.saveVault();
    set({ dirty: false });
  },

  setError: (message) => set({ error: message }),
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
