//! Tauri commands — the only surface the frontend can drive.
//!
//! Every command checks the app login, locks [`AppState`], operates on the in-memory
//! `Database`, and returns sanitized DTOs. Mutations do NOT auto-save; the frontend
//! calls `save_vault`, which is when the `.kdbx` file is rewritten.
//!
//! All commands are `async` (run off the UI thread): key derivation on open/save takes
//! a noticeable moment, and a command waiting on the vault lock must not freeze the window.

use std::collections::HashSet;
use std::ffi::OsString;
use std::fs::File;
use std::sync::MutexGuard;
use std::time::Duration;

use keepass::config::{DatabaseVersion, KdfConfig};
use keepass::db::{fields, CustomDataItem, CustomDataValue, EntryMut, Times, Value};
use keepass::error::DatabaseOpenError;
use keepass::{Database, DatabaseKey};
use tauri::{AppHandle, State};
use zeroize::Zeroizing;

use crate::audit;
use crate::auth::{require_unlocked, still_current};
use crate::state::{AppState, AuthState, VaultSession};
use crate::vault::{
    build_tree, entry_detail, is_reserved, parse_entry_id, parse_group_id, EntryDetailDto,
    EntryInput, GroupDto, COLOR_KEY, PALETTE,
};

type CmdResult<T> = Result<T, String>;

/// Key derivation for new vaults: Argon2id, 64 MiB, 10 passes, 4 lanes (about KeePassXC's
/// default cost). `memory` is in BYTES, as in the KDBX header (keepass divides by 1024 for
/// Argon2's KiB), whatever its doc comment says.
fn default_kdf() -> KdfConfig {
    KdfConfig::Argon2id {
        iterations: 10,
        memory: 64 * 1024 * 1024,
        parallelism: 4,
        version: argon2::Version::Version13,
    }
}

/// Vaults created by earlier sectauri builds carry the crate default (Argon2d, 1 MiB x 50
/// passes: little memory hardness); strengthen them to `default_kdf` on save.
fn is_old_sectauri_kdf(kdf: &KdfConfig) -> bool {
    matches!(kdf, KdfConfig::Argon2 { iterations: 50, memory, parallelism: 4, .. } if *memory == 1024 * 1024)
}

/// Puts `value` on the clipboard and clears it after `clear_after_secs` (0 = never) if it is
/// still there, so something the user copied meanwhile is left alone.
fn copy_with_clear(value: Zeroizing<String>, clear_after_secs: u64) -> CmdResult<()> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("clipboard unavailable: {e}"))?;
    clipboard
        .set_text(value.as_str())
        .map_err(|e| format!("cannot copy: {e}"))?;
    if clear_after_secs > 0 {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(clear_after_secs));
            if let Ok(mut cb) = arboard::Clipboard::new() {
                if cb.get_text().is_ok_and(|now| now == *value) {
                    let _ = cb.clear();
                }
            }
        });
    }
    Ok(())
}

fn lock<'r>(state: &State<'r, AppState>) -> CmdResult<MutexGuard<'r, Option<VaultSession>>> {
    // `inner()` yields `&'r AppState` (tied to the managed-state lifetime), so the
    // guard can outlive the borrow of `state` itself.
    state
        .inner()
        .0
        .lock()
        .map_err(|_| "vault state is poisoned".to_string())
}

/// Apply the standard fields plus reconcile user-defined custom fields.
/// Password is stored protected; reserved fields (incl. OTP) are left untouched.
fn set_entry_fields(e: &mut EntryMut<'_>, input: &EntryInput) {
    e.set_unprotected(fields::TITLE, input.title.as_str());
    e.set_unprotected(fields::USERNAME, input.username.as_str());
    e.set_protected(fields::PASSWORD, input.password.as_str());
    e.set_unprotected(fields::URL, input.url.as_str());
    e.set_unprotected(fields::NOTES, input.notes.as_str());

    // Custom fields the frontend still has (non-empty keys).
    let keep: HashSet<&str> = input
        .custom
        .iter()
        .map(|f| f.key.trim())
        .filter(|k| !k.is_empty())
        .collect();

    // Drop custom fields the user removed; never delete reserved fields.
    let stale: Vec<String> = e
        .fields
        .keys()
        .filter(|k| !is_reserved(k) && !keep.contains(k.as_str()))
        .cloned()
        .collect();
    for key in stale {
        e.fields.remove(&key);
    }

    // Upsert the kept/added custom fields.
    for f in &input.custom {
        let key = f.key.trim();
        if key.is_empty() || is_reserved(key) {
            continue;
        }
        let value = if f.protected {
            Value::protected(f.value.as_str())
        } else {
            Value::unprotected(f.value.as_str())
        };
        e.set(key.to_string(), value);
    }
    e.times.last_modification = Some(Times::now());
}

/// Turn keepass's low-level errors into messages a user can act on.
fn friendly_open_error(e: DatabaseOpenError) -> String {
    let msg = e.to_string();
    if msg.contains("Incorrect key") {
        "Incorrect master password.".to_string()
    } else if msg.contains("Unexpected end of file") || msg.contains("version") {
        "This vault file looks incomplete or corrupted. If it is still downloading, \
         wait for it to finish and try again; otherwise restore from a .kdbx.bak backup."
            .to_string()
    } else {
        format!("Failed to unlock vault: {msg}")
    }
}

#[tauri::command(async)]
pub fn open_vault(
    app: AppHandle,
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> CmdResult<GroupDto> {
    let generation = require_unlocked(&auth)?;
    let password = Zeroizing::new(password);
    let mut file = File::open(&path).map_err(|e| format!("cannot open file: {e}"))?;

    // A valid KDBX starts with an 8-byte signature + 4-byte version. Anything
    // shorter is empty/truncated (e.g. a download still in progress) and would
    // otherwise surface as a cryptic "end of file" parse error.
    if let Ok(meta) = file.metadata() {
        if meta.len() < 12 {
            return Err("This file is empty or incomplete — if it is still \
                        downloading, wait for it to finish and try again."
                .to_string());
        }
    }

    let key = DatabaseKey::new().with_password(password.as_str());
    let db = match Database::open(&mut file, key) {
        Ok(db) => db,
        Err(e) => {
            let msg = friendly_open_error(e);
            audit::record(&app, &path, false, &msg);
            return Err(msg);
        }
    };
    audit::record(&app, &path, true, "");

    // Decryption takes a moment; if the app was locked meanwhile, drop the result.
    let _auth = still_current(&auth, generation)?;
    let tree = build_tree(db.root());
    *lock(&state)? = Some(VaultSession::new(db, password, path.into()));
    Ok(tree)
}

#[tauri::command(async)]
pub fn create_vault(
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> CmdResult<GroupDto> {
    let generation = require_unlocked(&auth)?;
    let password = Zeroizing::new(password);
    let mut db = Database::new();
    db.meta.database_name = Some("sectauri vault".to_string());
    db.root_mut().name = "Root".to_string();
    db.config.kdf_config = default_kdf();

    let key = DatabaseKey::new().with_password(password.as_str());
    let mut file = File::create(&path).map_err(|e| format!("cannot create file: {e}"))?;
    db.save(&mut file, key).map_err(|e| format!("failed to write vault: {e}"))?;

    let _auth = still_current(&auth, generation)?;
    let tree = build_tree(db.root());
    *lock(&state)? = Some(VaultSession::new(db, password, path.into()));
    Ok(tree)
}

#[tauri::command(async)]
pub fn lock_vault(state: State<'_, AppState>) -> CmdResult<()> {
    // Dropping the session zeroizes the password and frees the decrypted db.
    *lock(&state)? = None;
    Ok(())
}

/// Idle auto-close: closes the vault only if nothing changed since the last save, checked
/// under the vault lock, so an edit racing the auto-save is never thrown away.
#[tauri::command(async)]
pub fn close_vault_if_saved(state: State<'_, AppState>) -> CmdResult<bool> {
    let mut guard = lock(&state)?;
    match guard.as_ref() {
        Some(s) if s.edits != s.saved_edits => Ok(false),
        _ => {
            *guard = None;
            Ok(true)
        }
    }
}

#[tauri::command(async)]
pub fn is_unlocked(state: State<'_, AppState>) -> CmdResult<bool> {
    Ok(lock(&state)?.is_some())
}

#[tauri::command(async)]
pub fn get_tree(auth: State<'_, AuthState>, state: State<'_, AppState>) -> CmdResult<GroupDto> {
    require_unlocked(&auth)?;
    let guard = lock(&state)?;
    let session = guard.as_ref().ok_or("no vault is open")?;
    Ok(build_tree(session.db.root()))
}

#[tauri::command(async)]
pub fn get_entry(
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<EntryDetailDto> {
    require_unlocked(&auth)?;
    let entry_id = parse_entry_id(&id)?;
    let guard = lock(&state)?;
    let session = guard.as_ref().ok_or("no vault is open")?;
    let entry = session.db.entry(entry_id).ok_or("entry not found")?;
    Ok(entry_detail(entry))
}

#[tauri::command(async)]
pub fn create_entry(
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    group_id: String,
    input: EntryInput,
) -> CmdResult<String> {
    require_unlocked(&auth)?;
    let group_id = parse_group_id(&group_id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    session.edits += 1; // may also count a failed edit: that only delays auto-close
    // `Database::group_mut` finds a group at any depth (`GroupMut::group_mut` only
    // looks at direct children, which broke nested groups).
    let mut group = session.db.group_mut(group_id).ok_or("target group not found")?;
    let mut e = group.add_entry();
    set_entry_fields(&mut e, &input);
    Ok(e.id().uuid().to_string())
}

#[tauri::command(async)]
pub fn update_entry(
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    id: String,
    input: EntryInput,
) -> CmdResult<()> {
    require_unlocked(&auth)?;
    let entry_id = parse_entry_id(&id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    session.edits += 1; // may also count a failed edit: that only delays auto-close
    let mut entry = session.db.entry_mut(entry_id).ok_or("entry not found")?;
    set_entry_fields(&mut entry, &input);
    Ok(())
}

#[tauri::command(async)]
pub fn delete_entry(
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<()> {
    require_unlocked(&auth)?;
    let entry_id = parse_entry_id(&id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    session.edits += 1; // may also count a failed edit: that only delays auto-close
    session.db.entry_mut(entry_id).ok_or("entry not found")?.remove();
    Ok(())
}

#[tauri::command(async)]
pub fn move_entry(
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    id: String,
    target_group_id: String,
) -> CmdResult<()> {
    require_unlocked(&auth)?;
    let entry_id = parse_entry_id(&id)?;
    let group_id = parse_group_id(&target_group_id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    session.edits += 1; // may also count a failed edit: that only delays auto-close
    session
        .db
        .entry_mut(entry_id)
        .ok_or("entry not found")?
        .move_to(group_id)
        .map_err(|e| format!("cannot move entry: {e}"))?;
    Ok(())
}

#[tauri::command(async)]
pub fn create_group(
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    parent_id: String,
    name: String,
) -> CmdResult<String> {
    require_unlocked(&auth)?;
    let parent_id = parse_group_id(&parent_id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    session.edits += 1; // may also count a failed edit: that only delays auto-close
    let mut parent = session.db.group_mut(parent_id).ok_or("parent group not found")?;
    let mut g = parent.add_group();
    g.name = name;
    Ok(g.id().uuid().to_string())
}

#[tauri::command(async)]
pub fn rename_group(
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    require_unlocked(&auth)?;
    let group_id = parse_group_id(&id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    session.edits += 1; // may also count a failed edit: that only delays auto-close
    session.db.group_mut(group_id).ok_or("group not found")?.name = name;
    Ok(())
}

/// Deletes the group with all its subgroups and entries.
#[tauri::command(async)]
pub fn delete_group(
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<()> {
    require_unlocked(&auth)?;
    let group_id = parse_group_id(&id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    session.edits += 1; // may also count a failed edit: that only delays auto-close
    if group_id == session.db.root().id() {
        return Err("cannot delete the root group".to_string());
    }
    session.db.group_mut(group_id).ok_or("group not found")?.remove();
    Ok(())
}

/// Re-parents a group (drag and drop in the tree); refuses moves into its own subtree.
#[tauri::command(async)]
pub fn move_group(
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    id: String,
    target_parent_id: String,
) -> CmdResult<()> {
    require_unlocked(&auth)?;
    let group_id = parse_group_id(&id)?;
    let parent_id = parse_group_id(&target_parent_id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    session.edits += 1; // may also count a failed edit: that only delays auto-close
    session
        .db
        .group_mut(group_id)
        .ok_or("group not found")?
        .move_to(parent_id)
        .map_err(|e| format!("cannot move group: {e}"))?;
    Ok(())
}

/// Sets one of the preset `PALETTE` colours on a group, or clears it with `None`.
#[tauri::command(async)]
pub fn set_group_color(
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    id: String,
    color: Option<String>,
) -> CmdResult<()> {
    require_unlocked(&auth)?;
    if let Some(c) = &color {
        if !PALETTE.contains(&c.as_str()) {
            return Err("unknown group colour".to_string());
        }
    }
    let group_id = parse_group_id(&id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    session.edits += 1; // may also count a failed edit: that only delays auto-close
    let mut group = session.db.group_mut(group_id).ok_or("group not found")?;
    match color {
        Some(c) => {
            group.custom_data.insert(
                COLOR_KEY.to_string(),
                CustomDataItem {
                    value: Some(CustomDataValue::String(c)),
                    last_modification_time: Some(Times::now()),
                },
            );
        }
        None => {
            group.custom_data.remove(COLOR_KEY);
        }
    }
    Ok(())
}

/// Copies one field of an entry to the clipboard from the backend (the password never
/// passes through the UI), then clears it after `clear_after_secs` if it is still there.
#[tauri::command(async)]
pub fn copy_field(
    auth: State<'_, AuthState>,
    state: State<'_, AppState>,
    id: String,
    field: String,
    clear_after_secs: u64,
) -> CmdResult<()> {
    require_unlocked(&auth)?;
    let key = match field.as_str() {
        "username" => fields::USERNAME,
        "password" => fields::PASSWORD,
        "url" => fields::URL,
        _ => return Err("unknown field".to_string()),
    };
    let entry_id = parse_entry_id(&id)?;
    let value = {
        let guard = lock(&state)?;
        let session = guard.as_ref().ok_or("no vault is open")?;
        let entry = session.db.entry(entry_id).ok_or("entry not found")?;
        Zeroizing::new(entry.get(key).unwrap_or("").to_string())
    };
    copy_with_clear(value, clear_after_secs)
}

/// Copies text the user sees in the entry form (possibly not applied yet), with the same
/// auto-clear as `copy_field`.
#[tauri::command(async)]
pub fn copy_text(auth: State<'_, AuthState>, text: String, clear_after_secs: u64) -> CmdResult<()> {
    require_unlocked(&auth)?;
    copy_with_clear(Zeroizing::new(text), clear_after_secs)
}

#[tauri::command(async)]
pub fn save_vault(auth: State<'_, AuthState>, state: State<'_, AppState>) -> CmdResult<()> {
    require_unlocked(&auth)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;

    // The KDBX4 writer only supports minor version 1 (KDBX 4.1). A vault opened
    // as 4.0 must be upgraded in memory, or save() returns "Unsupported version".
    session.db.config.version = DatabaseVersion::KDB4(1);
    if is_old_sectauri_kdf(&session.db.config.kdf_config) {
        session.db.config.kdf_config = default_kdf();
    }

    // Write to a sibling temp file first, so a failed or corrupt write can never
    // damage the original vault.
    let mut tmp: OsString = session.path.clone().into_os_string();
    tmp.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp);

    {
        let key = DatabaseKey::new().with_password(session.password.as_str());
        let mut file = File::create(&tmp)
            .map_err(|e| format!("cannot open vault for writing: {e}"))?;
        if let Err(e) = session.db.save(&mut file, key) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("failed to save vault: {e}"));
        }
    }

    // Verify the freshly written file re-opens with the same password before it
    // is allowed to replace the original.
    {
        let key = DatabaseKey::new().with_password(session.password.as_str());
        let mut vf =
            File::open(&tmp).map_err(|e| format!("cannot verify saved vault: {e}"))?;
        if let Err(e) = Database::open(&mut vf, key) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!(
                "save verification failed, original left untouched: {e}"
            ));
        }
    }

    // Back up the current file, then replace it with the verified temp file.
    if session.path.exists() {
        let mut backup: OsString = session.path.clone().into_os_string();
        backup.push(".bak");
        std::fs::copy(&session.path, backup)
            .map_err(|e| format!("failed to write backup: {e}"))?;
    }
    std::fs::copy(&tmp, &session.path)
        .map_err(|e| format!("failed to replace vault file: {e}"))?;
    let _ = std::fs::remove_file(&tmp);
    session.saved_edits = session.edits;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_crate_default_kdf_is_migrated_and_new_one_is_not() {
        assert!(is_old_sectauri_kdf(&Database::new().config.kdf_config));
        assert!(!is_old_sectauri_kdf(&default_kdf()));
    }

    #[test]
    fn new_vault_kdf_is_64_mib_after_a_save_round_trip() {
        let mut db = Database::new();
        db.config.kdf_config = default_kdf();
        let mut bytes = Vec::new();
        db.save(&mut bytes, DatabaseKey::new().with_password("pw")).unwrap();
        let reopened = Database::open(&mut bytes.as_slice(), DatabaseKey::new().with_password("pw")).unwrap();
        match reopened.config.kdf_config {
            KdfConfig::Argon2id { memory, iterations, .. } => {
                assert_eq!(memory, 64 * 1024 * 1024, "KDBX stores Argon2 memory in bytes");
                assert_eq!(iterations, 10);
            }
            other => panic!("unexpected KDF {other:?}"),
        }
    }

    #[test]
    fn nested_groups_are_found_for_create_rename_and_delete() {
        let mut db = Database::new();
        let child = db.root_mut().add_group().id();
        let grandchild = db.group_mut(child).unwrap().add_group().id();

        db.group_mut(grandchild).unwrap().name = "renamed".into();
        db.group_mut(grandchild).unwrap().add_entry();
        assert_eq!(db.group(grandchild).unwrap().name, "renamed");

        db.group_mut(grandchild).unwrap().remove();
        assert!(db.group(grandchild).is_none());
        assert!(db.group(child).is_some());
    }
}
