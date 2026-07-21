//! Tauri commands — the only surface the frontend can drive.
//!
//! Every command locks [`AppState`], operates on the in-memory `Database`, and
//! returns sanitized DTOs. Mutations do NOT auto-save; the frontend calls
//! `save_vault` explicitly, which is when the `.kdbx` file is rewritten.

use std::ffi::OsString;
use std::fs::File;
use std::sync::MutexGuard;

use std::collections::HashSet;

use keepass::config::DatabaseVersion;
use keepass::db::{fields, EntryMut, Value};
use keepass::error::DatabaseOpenError;
use keepass::{Database, DatabaseKey};
use tauri::State;
use zeroize::Zeroizing;

use crate::state::{AppState, VaultSession};
use crate::vault::{
    build_tree, entry_detail, is_reserved, parse_entry_id, parse_group_id, EntryDetailDto,
    EntryInput, GroupDto,
};

type CmdResult<T> = Result<T, String>;

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

#[tauri::command]
pub fn open_vault(
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> CmdResult<GroupDto> {
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
    let db = Database::open(&mut file, key).map_err(friendly_open_error)?;

    let tree = build_tree(db.root());
    *lock(&state)? = Some(VaultSession {
        db,
        password: Zeroizing::new(password),
        path: path.into(),
    });
    Ok(tree)
}

#[tauri::command]
pub fn create_vault(
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> CmdResult<GroupDto> {
    let mut db = Database::new();
    db.meta.database_name = Some("sectauri vault".to_string());

    let key = DatabaseKey::new().with_password(password.as_str());
    let mut file = File::create(&path).map_err(|e| format!("cannot create file: {e}"))?;
    db.save(&mut file, key).map_err(|e| format!("failed to write vault: {e}"))?;

    let tree = build_tree(db.root());
    *lock(&state)? = Some(VaultSession {
        db,
        password: Zeroizing::new(password),
        path: path.into(),
    });
    Ok(tree)
}

#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) -> CmdResult<()> {
    // Dropping the session zeroizes the password and frees the decrypted db.
    *lock(&state)? = None;
    Ok(())
}

#[tauri::command]
pub fn is_unlocked(state: State<'_, AppState>) -> CmdResult<bool> {
    Ok(lock(&state)?.is_some())
}

#[tauri::command]
pub fn get_tree(state: State<'_, AppState>) -> CmdResult<GroupDto> {
    let guard = lock(&state)?;
    let session = guard.as_ref().ok_or("no vault is open")?;
    Ok(build_tree(session.db.root()))
}

#[tauri::command]
pub fn get_entry(state: State<'_, AppState>, id: String) -> CmdResult<EntryDetailDto> {
    let entry_id = parse_entry_id(&id)?;
    let guard = lock(&state)?;
    let session = guard.as_ref().ok_or("no vault is open")?;
    let entry = session.db.entry(entry_id).ok_or("entry not found")?;
    Ok(entry_detail(entry))
}

#[tauri::command]
pub fn create_entry(
    state: State<'_, AppState>,
    group_id: String,
    input: EntryInput,
) -> CmdResult<String> {
    let group_id = parse_group_id(&group_id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    let db = &mut session.db;

    let mut root = db.root_mut();
    let root_id = root.id();
    // `group_mut` searches by globally-unique id; root is handled directly
    // because it isn't a child of itself.
    let new_id = if group_id == root_id {
        let mut e = root.add_entry();
        set_entry_fields(&mut e, &input);
        e.id()
    } else {
        let mut group = root.group_mut(group_id).ok_or("target group not found")?;
        let mut e = group.add_entry();
        set_entry_fields(&mut e, &input);
        e.id()
    };
    Ok(new_id.uuid().to_string())
}

#[tauri::command]
pub fn update_entry(
    state: State<'_, AppState>,
    id: String,
    input: EntryInput,
) -> CmdResult<()> {
    let entry_id = parse_entry_id(&id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    let mut entry = session.db.entry_mut(entry_id).ok_or("entry not found")?;
    set_entry_fields(&mut entry, &input);
    Ok(())
}

#[tauri::command]
pub fn delete_entry(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let entry_id = parse_entry_id(&id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    session
        .db
        .entry_mut(entry_id)
        .ok_or("entry not found")?
        .remove();
    Ok(())
}

#[tauri::command]
pub fn create_group(
    state: State<'_, AppState>,
    parent_id: String,
    name: String,
) -> CmdResult<String> {
    let parent_id = parse_group_id(&parent_id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    let db = &mut session.db;

    let mut root = db.root_mut();
    let root_id = root.id();
    let new_id = if parent_id == root_id {
        let mut g = root.add_group();
        g.name = name;
        g.id()
    } else {
        let mut parent = root.group_mut(parent_id).ok_or("parent group not found")?;
        let mut g = parent.add_group();
        g.name = name;
        g.id()
    };
    Ok(new_id.uuid().to_string())
}

#[tauri::command]
pub fn rename_group(state: State<'_, AppState>, id: String, name: String) -> CmdResult<()> {
    let group_id = parse_group_id(&id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    let db = &mut session.db;

    let mut root = db.root_mut();
    if group_id == root.id() {
        root.name = name;
    } else {
        let mut g = root.group_mut(group_id).ok_or("group not found")?;
        g.name = name;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_group(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let group_id = parse_group_id(&id)?;
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;
    let db = &mut session.db;

    if group_id == db.root().id() {
        return Err("cannot delete the root group".to_string());
    }
    db.root_mut()
        .group_mut(group_id)
        .ok_or("group not found")?
        .remove();
    Ok(())
}

#[tauri::command]
pub fn save_vault(state: State<'_, AppState>) -> CmdResult<()> {
    let mut guard = lock(&state)?;
    let session = guard.as_mut().ok_or("no vault is open")?;

    // The KDBX4 writer only supports minor version 1 (KDBX 4.1). A vault opened
    // as 4.0 must be upgraded in memory, or save() returns "Unsupported version".
    session.db.config.version = DatabaseVersion::KDB4(1);

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
    Ok(())
}
