// Typed wrappers around the Rust commands. This is the whole backend surface
// the UI is allowed to touch. Tauri converts camelCase args here to the
// snake_case parameter names on the Rust side automatically.
import { invoke } from "@tauri-apps/api/core";

export interface EntrySummary {
  id: string;
  title: string;
  username: string;
}

export interface GroupDto {
  id: string;
  name: string;
  groups: GroupDto[];
  entries: EntrySummary[];
}

export interface ExtraField {
  key: string;
  value: string;
  protected: boolean;
}

export interface EntryDetail {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  extra: ExtraField[];
}

export interface CustomField {
  key: string;
  value: string;
  protected: boolean;
}

export interface EntryInput {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  custom: CustomField[];
}

export const api = {
  openVault: (path: string, password: string) =>
    invoke<GroupDto>("open_vault", { path, password }),
  createVault: (path: string, password: string) =>
    invoke<GroupDto>("create_vault", { path, password }),
  lockVault: () => invoke<void>("lock_vault"),
  isUnlocked: () => invoke<boolean>("is_unlocked"),
  getTree: () => invoke<GroupDto>("get_tree"),
  getEntry: (id: string) => invoke<EntryDetail>("get_entry", { id }),
  createEntry: (groupId: string, input: EntryInput) =>
    invoke<string>("create_entry", { groupId, input }),
  updateEntry: (id: string, input: EntryInput) =>
    invoke<void>("update_entry", { id, input }),
  deleteEntry: (id: string) => invoke<void>("delete_entry", { id }),
  createGroup: (parentId: string, name: string) =>
    invoke<string>("create_group", { parentId, name }),
  renameGroup: (id: string, name: string) =>
    invoke<void>("rename_group", { id, name }),
  deleteGroup: (id: string) => invoke<void>("delete_group", { id }),
  saveVault: () => invoke<void>("save_vault"),
};
