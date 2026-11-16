//! Backend-only session state.
//!
//! The decrypted `Database` and the master password live ONLY here, inside the
//! Rust process. The frontend never receives the raw key or password — it only
//! sees the sanitized DTOs returned by commands.
//!
//! Lock order when both are needed: `AuthState` first, then `AppState`.

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
    /// Bumped by every in-memory change.
    pub edits: u64,
    /// `edits` as of the last successful save.
    pub saved_edits: u64,
}

impl VaultSession {
    pub fn new(db: Database, password: Zeroizing<String>, path: PathBuf) -> Self {
        Self { db, password, path, edits: 0, saved_edits: 0 }
    }
}

/// Managed Tauri state: `Some` when a vault is unlocked, `None` when locked.
#[derive(Default)]
pub struct AppState(pub Mutex<Option<VaultSession>>);

/// The Sectauri app login (its own master password, separate from vault passwords).
#[derive(Default)]
pub struct AuthSession {
    /// Logged in: password (and TOTP when enabled) accepted, or a trusted device.
    pub unlocked: bool,
    /// Bumped on every lock, so work started before a lock cannot finish after it.
    pub generation: u64,
    /// Password accepted at this time (Unix seconds); a TOTP code is still due.
    pub awaiting_totp_since: Option<i64>,
    /// Wrong TOTP codes for the current challenge.
    pub totp_failures: u32,
    /// A trusted device skips the login once per app start; locking by hand ends that.
    pub trust_used: bool,
    /// Base32 secret shown during TOTP setup, until the first code confirms it.
    pub pending_totp_secret: Option<Zeroizing<String>>,
}

#[derive(Default)]
pub struct AuthState(pub Mutex<AuthSession>);
