# sectauri

A desktop app for opening and managing **KeePass KDBX** password vaults, built with **Tauri v2 + Rust** and a **React + TypeScript** frontend.

- Opens `.kdbx` vaults (KDBX 3.x / 4.x) with a master password
- Browse groups and entries, view/copy fields
- Create, edit and delete entries and groups
- Saves back to **KDBX 4** (a `.kdbx.bak` backup is written before every save)

KDBX 4 is the modern KeePass format (Argon2 KDF, AES-256/ChaCha20, HMAC-SHA256), so vaults stay interoperable with KeePass, KeePassXC, KeePassium, etc.

## Security design

- The decrypted database **never leaves the Rust backend**. The frontend only receives sanitized data via commands and never sees the raw key.
- The master password is entered once on unlock, held in a `Zeroizing` buffer to re-save without re-prompting, and scrubbed from memory on lock.
- Every save backs up the current file first, because KDBX4 writing in the underlying crate is still marked experimental.

## Prerequisites

- **Node.js** 18+ and npm (installed)
- **Rust toolchain** — install from <https://rustup.rs> (`rustup default stable-msvc`)
- **MSVC C++ Build Tools** — "Desktop development with C++" workload from the Visual Studio Build Tools
- **WebView2 runtime** — ships with Windows 11

## Develop

```bash
npm install
npm run tauri dev
```

## Build a release bundle

```bash
npm run tauri build
```

## Project layout

```
src/                  React + TypeScript frontend
  lib/api.ts          typed wrappers over the Rust commands
  store.ts            zustand UI state
  components/         UnlockScreen, VaultView, GroupTree, EntryList, EntryForm
src-tauri/            Rust backend
  src/state.rs        in-memory VaultSession (managed Tauri state)
  src/vault.rs        keepass integration + serde DTOs
  src/commands.rs     Tauri command handlers
  src/lib.rs          builder wiring
```

## Roadmap (not in v1)

Key-file / hardware-key unlock, auto-lock on idle, clipboard auto-clear, and TOTP field support.
