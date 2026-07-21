// Reproduces the create -> save -> open flow to verify a freshly created vault
// is a valid KDBX file that can be reopened.
use keepass::db::fields;
use keepass::{Database, DatabaseKey};
use std::io::Cursor;

#[test]
fn create_then_open_roundtrips() {
    // --- create_vault does this ---
    let mut db = Database::new();
    db.meta.database_name = Some("sectauri vault".to_string());

    let mut buf: Vec<u8> = Vec::new();
    db.save(&mut buf, DatabaseKey::new().with_password("demopass"))
        .expect("save should succeed");

    eprintln!("saved vault is {} bytes", buf.len());
    assert!(buf.len() > 100, "saved vault suspiciously small: {} bytes", buf.len());

    // --- open_vault does this ---
    let mut reader = Cursor::new(&buf);
    let reopened = Database::open(&mut reader, DatabaseKey::new().with_password("demopass"))
        .expect("reopen should succeed");
    assert_eq!(reopened.meta.database_name.as_deref(), Some("sectauri vault"));
}

#[test]
fn create_add_entry_save_open_roundtrips() {
    let mut db = Database::new();

    let mut root = db.root_mut();
    let mut e = root.add_entry();
    e.set_unprotected(fields::TITLE, "Demo");
    e.set_protected(fields::PASSWORD, "hunter2");
    drop(root);

    let mut buf: Vec<u8> = Vec::new();
    db.save(&mut buf, DatabaseKey::new().with_password("demopass"))
        .expect("save should succeed");

    let mut reader = Cursor::new(&buf);
    let reopened = Database::open(&mut reader, DatabaseKey::new().with_password("demopass"))
        .expect("reopen should succeed");

    let found = reopened
        .iter_all_entries()
        .any(|e| e.get(fields::TITLE) == Some("Demo"));
    assert!(found, "entry should survive the roundtrip");
}

#[test]
fn create_on_disk_then_open_from_disk() {
    use std::fs::File;
    let mut p = std::env::temp_dir();
    p.push("sectauri_test_vault.kdbx");

    // --- create_vault: File::create + save ---
    {
        let mut db = Database::new();
        db.meta.database_name = Some("disk vault".to_string());
        let mut file = File::create(&p).expect("create");
        db.save(&mut file, DatabaseKey::new().with_password("demopass")).expect("save");
    } // file dropped/flushed here

    let size = std::fs::metadata(&p).expect("stat").len();
    eprintln!("on-disk vault path={:?} size={}", p, size);
    assert!(size > 100, "on-disk vault is too small: {} bytes", size);

    // --- open_vault: File::open + Database::open ---
    let mut file = File::open(&p).expect("open");
    let db = Database::open(&mut file, DatabaseKey::new().with_password("demopass"))
        .expect("reopen from disk");
    assert_eq!(db.meta.database_name.as_deref(), Some("disk vault"));

    let _ = std::fs::remove_file(&p);
}

// Reproduces the "Unsupported database version" save failure and verifies the
// KDBX 4.0 -> 4.1 upgrade fix used by save_vault.
#[test]
fn kdbx40_save_fails_but_41_succeeds() {
    use keepass::config::DatabaseVersion;

    let mut db = Database::new();
    db.root_mut().add_entry().set_unprotected(fields::TITLE, "X");

    // Simulate a vault opened as KDBX 4.0.
    db.config.version = DatabaseVersion::KDB4(0);
    let mut buf: Vec<u8> = Vec::new();
    let err = db
        .save(&mut buf, DatabaseKey::new().with_password("p"))
        .unwrap_err();
    eprintln!("4.0 save error (expected): {err}");

    // The fix: upgrade to 4.1, which the writer supports.
    db.config.version = DatabaseVersion::KDB4(1);
    let mut buf2: Vec<u8> = Vec::new();
    db.save(&mut buf2, DatabaseKey::new().with_password("p"))
        .expect("4.1 save should succeed");

    let mut reader = Cursor::new(&buf2);
    Database::open(&mut reader, DatabaseKey::new().with_password("p"))
        .expect("4.1 file should reopen");
}
