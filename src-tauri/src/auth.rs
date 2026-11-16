//! Sectauri app login, separate from vault (.kdbx) passwords, which are never stored.
//!
//! Everything lives in the OS credential store (Windows Credential Manager, macOS Keychain),
//! under the service `com.tokagero.sectauri`, protected by the user's OS account:
//! - `login`: the master password as an Argon2id hash, plus the TOTP on/off state;
//! - `totp-secret`: the optional TOTP second factor;
//! - `trusted-device-until`: "remember this device for 7 days", skips the login at app start.
//!
//! Deleting these three entries resets the Sectauri login; vaults are not affected.

use std::fs;
use std::path::PathBuf;
use std::sync::MutexGuard;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use totp_rs::{Builder, Secret, Totp};
use zeroize::Zeroizing;

use crate::state::{AppState, AuthSession, AuthState};

type CmdResult<T> = Result<T, String>;

const KEYRING_SERVICE: &str = "com.tokagero.sectauri";
const LOGIN_KEY: &str = "login";
const TOTP_SECRET_KEY: &str = "totp-secret";
const TRUST_KEY: &str = "trusted-device-until";
pub const TRUST_DAYS: i64 = 7;
const MIN_PASSWORD_LEN: usize = 8;

#[derive(Serialize, Deserialize)]
struct AuthFile {
    password_hash: String,
    totp_enabled: bool,
    /// Last accepted TOTP time step, so a code cannot be used twice.
    #[serde(default)]
    last_totp_step: u64,
}

#[derive(Serialize)]
pub struct AuthStatus {
    configured: bool,
    unlocked: bool,
    awaiting_totp: bool,
    totp_enabled: bool,
    /// Unix seconds until which this device is trusted, if it is.
    trusted_until: Option<i64>,
}

#[derive(Serialize)]
pub struct TotpSetup {
    secret: String,
    otpauth_url: String,
    qr_png_base64: String,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn session<'r>(auth: &State<'r, AuthState>) -> CmdResult<MutexGuard<'r, AuthSession>> {
    auth.inner().0.lock().map_err(|_| "auth state is poisoned".to_string())
}

fn unlocked_session<'r>(auth: &State<'r, AuthState>) -> CmdResult<MutexGuard<'r, AuthSession>> {
    let s = session(auth)?;
    if s.unlocked {
        Ok(s)
    } else {
        Err("Sectauri is locked. Log in first.".to_string())
    }
}

/// Every vault command calls this: the vault surface stays closed until the app login.
/// Returns the login generation, for work that must not outlive a lock (see `still_current`).
pub fn require_unlocked(auth: &State<'_, AuthState>) -> CmdResult<u64> {
    Ok(unlocked_session(auth)?.generation)
}

/// Holds the auth lock while the caller installs results of slow work started at
/// `generation`; fails if the app was locked meanwhile (`auth_lock` takes this lock too).
pub fn still_current<'r>(auth: &State<'r, AuthState>, generation: u64) -> CmdResult<MutexGuard<'r, AuthSession>> {
    let s = unlocked_session(auth)?;
    if s.generation != generation {
        return Err("Sectauri was locked meanwhile.".to_string());
    }
    Ok(s)
}

pub fn data_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|e| format!("no app data folder: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Write via a temp file and rename, so a crash never leaves half a file.
pub fn write_atomic(path: &PathBuf, bytes: &[u8]) -> CmdResult<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("cannot replace {}: {e}", path.display()))
}

fn read_auth() -> CmdResult<Option<AuthFile>> {
    let Some(json) = keyring_get(LOGIN_KEY)? else {
        return Ok(None);
    };
    serde_json::from_str(&json)
        .map(Some)
        .map_err(|e| format!("Sectauri login data in the credential store is damaged: {e}"))
}

fn write_auth(auth: &AuthFile) -> CmdResult<()> {
    keyring_set(LOGIN_KEY, &serde_json::to_string(auth).map_err(|e| e.to_string())?)
}

fn keyring(key: &str) -> CmdResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| format!("credential store unavailable: {e}"))
}

fn keyring_get(key: &str) -> CmdResult<Option<String>> {
    match keyring(key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("credential store error: {e}")),
    }
}

fn keyring_set(key: &str, value: &str) -> CmdResult<()> {
    keyring(key)?
        .set_password(value)
        .map_err(|e| format!("cannot save to the credential store: {e}"))
}

fn keyring_delete(key: &str) -> CmdResult<()> {
    match keyring(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("credential store error: {e}")),
    }
}

// shortcut: the expiry is not signed, so whoever can write this user's credential store can
// extend it; they already control the account then. Upgrade to an HMAC if that ever matters.
fn trusted_until() -> Option<i64> {
    let until: i64 = keyring_get(TRUST_KEY).ok()??.parse().ok()?;
    (until > now()).then_some(until)
}

fn trust_device() -> CmdResult<()> {
    keyring_set(TRUST_KEY, &(now() + TRUST_DAYS * 24 * 3600).to_string())
}

fn hash_password(password: &str) -> CmdResult<String> {
    let mut salt = [0u8; 16];
    getrandom::getrandom(&mut salt).map_err(|e| format!("no secure random source: {e}"))?;
    argon2::hash_encoded(password.as_bytes(), &salt, &argon2::Config::owasp1())
        .map_err(|e| format!("cannot hash password: {e}"))
}

fn verify_password(file: &AuthFile, password: &str) -> CmdResult<()> {
    match argon2::verify_encoded(&file.password_hash, password.as_bytes()) {
        Ok(true) => Ok(()),
        Ok(false) => Err("Incorrect master password.".to_string()),
        Err(e) => Err(format!("cannot check password: {e}")),
    }
}

fn totp_for(secret_b32: &str) -> CmdResult<Totp> {
    let secret = Secret::try_from_base32(secret_b32).map_err(|e| format!("bad TOTP secret: {e}"))?;
    Builder::new()
        .with_secret(secret)
        .with_account_name("Sectauri")
        .with_issuer(Some("Sectauri"))
        .build()
        .map_err(|e| format!("bad TOTP setup: {e}"))
}

/// The time step a code matches, refusing a step already used (replayed code).
fn check_code(secret_b32: &str, code: &str, last_step: u64) -> CmdResult<u64> {
    let code: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    let step = totp_for(secret_b32)?
        .check_current(&code)
        .ok_or("Wrong code. Check your authenticator app and the clock of this computer.")?;
    if step <= last_step {
        return Err("This code was already used. Wait for the next one.".to_string());
    }
    Ok(step)
}

/// Wrong codes allowed per password entry before the password is asked again.
const MAX_TOTP_FAILURES: u32 = 5;
/// How long a correct password waits for its TOTP code.
const TOTP_CHALLENGE_SECS: i64 = 300;

/// Whether a TOTP challenge started at `since` may still be answered.
fn challenge_open(since: Option<i64>, failures: u32, now: i64) -> CmdResult<()> {
    let since = since.ok_or("Enter the master password first.")?;
    if failures >= MAX_TOTP_FAILURES || now - since > TOTP_CHALLENGE_SECS {
        return Err("Too many wrong codes or too slow. Enter the master password again.".to_string());
    }
    Ok(())
}

// Every auth command holds the session lock for its whole check-and-update, so two
// requests cannot interleave (e.g. replay the same TOTP code) and a lock waits for them.

/// Current login state. On a trusted device the first call after app start logs in.
#[tauri::command(async)]
pub fn auth_status(auth: State<'_, AuthState>) -> CmdResult<AuthStatus> {
    let mut s = session(&auth)?;
    let file = read_auth()?;
    let trusted = trusted_until();
    if file.is_some() && !s.unlocked && !s.trust_used && trusted.is_some() {
        s.unlocked = true;
    }
    s.trust_used = true;
    Ok(AuthStatus {
        configured: file.is_some(),
        unlocked: s.unlocked,
        awaiting_totp: s.awaiting_totp_since.is_some(),
        totp_enabled: file.as_ref().is_some_and(|f| f.totp_enabled),
        trusted_until: trusted,
    })
}

/// First launch: create the master password.
#[tauri::command(async)]
pub fn auth_setup(auth: State<'_, AuthState>, password: String, remember: bool) -> CmdResult<()> {
    let password = Zeroizing::new(password);
    let mut s = session(&auth)?;
    if read_auth()?.is_some() {
        return Err("A master password is already set.".to_string());
    }
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(format!("Use at least {MIN_PASSWORD_LEN} characters."));
    }
    write_auth(&AuthFile { password_hash: hash_password(&password)?, totp_enabled: false, last_totp_step: 0 })?;
    if remember {
        trust_device()?;
    }
    s.unlocked = true;
    Ok(())
}

/// Check the master password. Returns true when a TOTP code is still needed.
#[tauri::command(async)]
pub fn auth_login(auth: State<'_, AuthState>, password: String, remember: bool) -> CmdResult<bool> {
    let password = Zeroizing::new(password);
    let mut s = session(&auth)?;
    let file = read_auth()?.ok_or("No master password is set yet.")?;
    verify_password(&file, &password)?;
    if file.totp_enabled {
        s.awaiting_totp_since = Some(now());
        s.totp_failures = 0;
        return Ok(true);
    }
    if remember {
        trust_device()?;
    }
    s.unlocked = true;
    Ok(false)
}

/// Second step of the login when TOTP is on.
#[tauri::command(async)]
pub fn auth_verify_totp(auth: State<'_, AuthState>, code: String, remember: bool) -> CmdResult<()> {
    let mut s = session(&auth)?;
    if let Err(e) = challenge_open(s.awaiting_totp_since, s.totp_failures, now()) {
        s.awaiting_totp_since = None; // the challenge is used up: password again
        return Err(e);
    }
    let mut file = read_auth()?.ok_or("No master password is set yet.")?;
    let secret = Zeroizing::new(keyring_get(TOTP_SECRET_KEY)?.ok_or(
        "The TOTP secret is missing from the credential store. Restore it or reset Sectauri's login.",
    )?);
    match check_code(&secret, &code, file.last_totp_step) {
        Ok(step) => file.last_totp_step = step,
        Err(e) => {
            s.totp_failures += 1;
            return Err(e);
        }
    }
    write_auth(&file)?;
    if remember {
        trust_device()?;
    }
    s.awaiting_totp_since = None;
    s.unlocked = true;
    Ok(())
}

/// Lock the app (and close any open vault without saving).
#[tauri::command(async)]
pub fn auth_lock(auth: State<'_, AuthState>, state: State<'_, AppState>) -> CmdResult<()> {
    let mut s = session(&auth)?;
    s.unlocked = false;
    s.generation += 1;
    s.awaiting_totp_since = None;
    s.pending_totp_secret = None;
    *state.inner().0.lock().map_err(|_| "vault state is poisoned".to_string())? = None;
    Ok(())
}

/// Start TOTP setup: a new secret, shown as a QR code until the first code confirms it.
#[tauri::command(async)]
pub fn totp_begin_setup(auth: State<'_, AuthState>) -> CmdResult<TotpSetup> {
    let mut s = unlocked_session(&auth)?;
    let secret = Zeroizing::new(Secret::generate().to_base32());
    let totp = totp_for(&secret)?;
    let setup = TotpSetup {
        secret: secret.to_string(),
        otpauth_url: totp.to_url().map_err(|e| e.to_string())?,
        qr_png_base64: totp.to_qr_base64().map_err(|e| e.to_string())?,
    };
    s.pending_totp_secret = Some(secret);
    Ok(setup)
}

/// Finish TOTP setup with a code from the authenticator app.
#[tauri::command(async)]
pub fn totp_confirm_setup(auth: State<'_, AuthState>, code: String) -> CmdResult<()> {
    let mut s = unlocked_session(&auth)?;
    let secret = s.pending_totp_secret.clone().ok_or("Start the TOTP setup again.")?;
    let mut file = read_auth()?.ok_or("No master password is set yet.")?;
    let step = check_code(&secret, &code, 0)?;
    keyring_set(TOTP_SECRET_KEY, &secret)?;
    file.totp_enabled = true;
    file.last_totp_step = step;
    write_auth(&file)?;
    s.pending_totp_secret = None;
    Ok(())
}

/// Turn TOTP off; needs the master password.
#[tauri::command(async)]
pub fn totp_disable(auth: State<'_, AuthState>, password: String) -> CmdResult<()> {
    let password = Zeroizing::new(password);
    let _s = unlocked_session(&auth)?;
    let mut file = read_auth()?.ok_or("No master password is set yet.")?;
    verify_password(&file, &password)?;
    keyring_delete(TOTP_SECRET_KEY)?;
    file.totp_enabled = false;
    write_auth(&file)
}

/// Change the master password. Ends this device's 7-day trust, since a password is
/// usually changed because someone else might know it. TOTP stays as it is.
#[tauri::command(async)]
pub fn auth_change_password(auth: State<'_, AuthState>, current: String, new_password: String) -> CmdResult<()> {
    let (current, new_password) = (Zeroizing::new(current), Zeroizing::new(new_password));
    let _s = unlocked_session(&auth)?;
    let mut file = read_auth()?.ok_or("No master password is set yet.")?;
    verify_password(&file, &current).map_err(|_| "The current master password is wrong.".to_string())?;
    if new_password.chars().count() < MIN_PASSWORD_LEN {
        return Err(format!("Use at least {MIN_PASSWORD_LEN} characters."));
    }
    if *new_password == *current {
        return Err("The new password is the same as the current one.".to_string());
    }
    file.password_hash = hash_password(&new_password)?;
    write_auth(&file)?;
    keyring_delete(TRUST_KEY)
}

/// Stop trusting this device: the next app start asks for the login again.
#[tauri::command(async)]
pub fn forget_device(auth: State<'_, AuthState>) -> CmdResult<()> {
    let _s = unlocked_session(&auth)?;
    keyring_delete(TRUST_KEY)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hash_round_trip() {
        let file = AuthFile { password_hash: hash_password("correct horse").unwrap(), totp_enabled: false, last_totp_step: 0 };
        assert!(verify_password(&file, "correct horse").is_ok());
        assert!(verify_password(&file, "wrong horse").is_err());
    }

    #[test]
    fn totp_code_accepted_once() {
        let secret = Secret::generate().to_base32();
        let code = totp_for(&secret).unwrap().generate_current().to_string();
        let step = check_code(&secret, &code, 0).expect("current code is valid");
        assert!(check_code(&secret, &code, step).is_err(), "a replayed code is refused");
        assert!(check_code(&secret, "000000x", 0).is_err());
    }

    #[test]
    fn totp_challenge_expires_and_limits_attempts() {
        assert!(challenge_open(None, 0, 1000).is_err(), "no password yet");
        assert!(challenge_open(Some(1000), 0, 1000 + TOTP_CHALLENGE_SECS).is_ok());
        assert!(challenge_open(Some(1000), 0, 1001 + TOTP_CHALLENGE_SECS).is_err(), "expired");
        assert!(challenge_open(Some(1000), MAX_TOTP_FAILURES - 1, 1000).is_ok());
        assert!(challenge_open(Some(1000), MAX_TOTP_FAILURES, 1000).is_err(), "too many failures");
    }
}
