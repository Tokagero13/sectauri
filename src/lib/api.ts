// Typed wrappers around the Rust commands. This is the whole backend surface
// the UI is allowed to touch. Tauri converts camelCase args here to the
// snake_case parameter names on the Rust side automatically.
import { invoke } from "@tauri-apps/api/core";

export interface EntrySummary {
  id: string;
  title: string;
  username: string;
  url: string;
  tags: string[];
  /** Last modification, Unix seconds. */
  modified: number | null;
}

export interface GroupDto {
  id: string;
  name: string;
  color: string | null;
  groups: GroupDto[];
  entries: EntrySummary[];
}

export interface AuthStatus {
  configured: boolean;
  unlocked: boolean;
  awaiting_totp: boolean;
  totp_enabled: boolean;
  /** Unix seconds until which this device skips the login. */
  trusted_until: number | null;
}

export interface TotpSetup {
  secret: string;
  otpauth_url: string;
  qr_png_base64: string;
}

export interface AuditEvent {
  vault_path: string;
  at: number;
  success: boolean;
  device: string;
  detail: string;
}

export type CopyField = "username" | "password" | "url";

/** The preset group colours (must match `PALETTE` in vault.rs). */
export const GROUP_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#64748b",
];

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
  authStatus: () => invoke<AuthStatus>("auth_status"),
  authSetup: (password: string, remember: boolean) =>
    invoke<void>("auth_setup", { password, remember }),
  /** Resolves true when a TOTP code is still needed. */
  authLogin: (password: string, remember: boolean) =>
    invoke<boolean>("auth_login", { password, remember }),
  authVerifyTotp: (code: string, remember: boolean) =>
    invoke<void>("auth_verify_totp", { code, remember }),
  authLock: () => invoke<void>("auth_lock"),
  authChangePassword: (current: string, newPassword: string) =>
    invoke<void>("auth_change_password", { current, newPassword }),
  totpBeginSetup: () => invoke<TotpSetup>("totp_begin_setup"),
  totpConfirmSetup: (code: string) => invoke<void>("totp_confirm_setup", { code }),
  totpDisable: (password: string) => invoke<void>("totp_disable", { password }),
  forgetDevice: () => invoke<void>("forget_device"),
  auditLog: (vaultPath?: string) =>
    invoke<AuditEvent[]>("audit_log", { vaultPath: vaultPath ?? null }),
  moveGroup: (id: string, targetParentId: string) =>
    invoke<void>("move_group", { id, targetParentId }),
  setGroupColor: (id: string, color: string | null) =>
    invoke<void>("set_group_color", { id, color }),
  copyField: (id: string, field: CopyField, clearAfterSecs: number) =>
    invoke<void>("copy_field", { id, field, clearAfterSecs }),
  openVault: (path: string, password: string) =>
    invoke<GroupDto>("open_vault", { path, password }),
  createVault: (path: string, password: string) =>
    invoke<GroupDto>("create_vault", { path, password }),
  lockVault: () => invoke<void>("lock_vault"),
  /** Closes the vault only if nothing changed since the last save; resolves false otherwise. */
  closeVaultIfSaved: () => invoke<boolean>("close_vault_if_saved"),
  copyText: (text: string, clearAfterSecs: number) =>
    invoke<void>("copy_text", { text, clearAfterSecs }),
  isUnlocked: () => invoke<boolean>("is_unlocked"),
  getTree: () => invoke<GroupDto>("get_tree"),
  getEntry: (id: string) => invoke<EntryDetail>("get_entry", { id }),
  createEntry: (groupId: string, input: EntryInput) =>
    invoke<string>("create_entry", { groupId, input }),
  updateEntry: (id: string, input: EntryInput) =>
    invoke<void>("update_entry", { id, input }),
  deleteEntry: (id: string) => invoke<void>("delete_entry", { id }),
  moveEntry: (id: string, targetGroupId: string) =>
    invoke<void>("move_entry", { id, targetGroupId }),
  createGroup: (parentId: string, name: string) =>
    invoke<string>("create_group", { parentId, name }),
  renameGroup: (id: string, name: string) =>
    invoke<void>("rename_group", { id, name }),
  deleteGroup: (id: string) => invoke<void>("delete_group", { id }),
  saveVault: () => invoke<void>("save_vault"),
};
