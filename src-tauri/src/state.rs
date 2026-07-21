//! Backend-only session state.
//!
//! The decrypted `Database` and the master password live ONLY here, inside the
//! Rust process. The frontend never receives the raw key or password — it only
//! sees the sanitized DTOs returned by commands.

use std::path::PathBuf;
use std::sync::Mutex;

use keepass::Database;
use zeroize::Zeroizing;

/// A single unlocked vault held in memory.
pub struct VaultSession {
    pub db: Database,
    /// Kept so we can re-save without re-prompting. `Zeroizing` scrubs it on drop.
    pub password: Zeroizing<String>,
    pub path: PathBuf,
}

/// Managed Tauri state: `Some` when a vault is unlocked, `None` when locked.
#[derive(Default)]
pub struct AppState(pub Mutex<Option<VaultSession>>);
