//! Vault access audit log: every unlock attempt per vault (time, result, device),
//! kept in `<app data>/audit.json`, newest last, capped at `MAX_EVENTS`.

use std::fs;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::auth::{data_dir, require_unlocked, write_atomic};
use crate::state::AuthState;

const MAX_EVENTS: usize = 1000;

// Serializes read-modify-write of the log file across concurrent commands.
static FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone)]
pub struct AuditEvent {
    pub vault_path: String,
    /// Unix seconds (UTC).
    pub at: i64,
    pub success: bool,
    /// Computer name and OS.
    pub device: String,
    /// Why it failed, empty on success.
    pub detail: String,
}

fn device() -> String {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown computer".to_string());
    format!("{host} ({})", std::env::consts::OS)
}

fn read_all(app: &AppHandle) -> Vec<AuditEvent> {
    data_dir(app)
        .ok()
        .and_then(|d| fs::read_to_string(d.join("audit.json")).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Best effort: a log write problem never blocks opening a vault.
pub fn record(app: &AppHandle, vault_path: &str, success: bool, detail: &str) {
    let _guard = FILE_LOCK.lock();
    let mut events = read_all(app);
    events.push(AuditEvent {
        vault_path: vault_path.to_string(),
        at: chrono::Utc::now().timestamp(),
        success,
        device: device(),
        detail: detail.to_string(),
    });
    let excess = events.len().saturating_sub(MAX_EVENTS);
    events.drain(..excess);
    if let (Ok(dir), Ok(json)) = (data_dir(app), serde_json::to_vec(&events)) {
        let _ = write_atomic(&dir.join("audit.json"), &json);
    }
}

/// Unlock attempts, newest first; only those of `vault_path` when given.
#[tauri::command(async)]
pub fn audit_log(
    app: AppHandle,
    auth: State<'_, AuthState>,
    vault_path: Option<String>,
) -> Result<Vec<AuditEvent>, String> {
    require_unlocked(&auth)?;
    let _guard = FILE_LOCK.lock();
    let mut events: Vec<AuditEvent> = read_all(&app)
        .into_iter()
        .filter(|e| vault_path.as_deref().is_none_or(|p| e.vault_path == p))
        .collect();
    events.reverse();
    Ok(events)
}
