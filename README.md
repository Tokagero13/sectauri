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

## Install dependencies

```bash
npm install
```

This pulls the frontend packages. Rust crates are fetched automatically by Cargo on the first `tauri` command.

## Develop

Runs Vite (frontend) and the Tauri shell together with hot-reload:

```bash
npm run tauri dev
```

The dev server listens on <http://localhost:1420>; the desktop window opens once the backend compiles (the first build takes a few minutes while Cargo compiles the Rust dependencies).

## Build a release bundle

```bash
npm run tauri build
```

This runs `npm run build` (`tsc` type-check + `vite build` into `dist/`), compiles the Rust backend in release mode, then packages the installers. Artifacts land in `src-tauri/target/release/`:

- `sectauri.exe` — the standalone executable
- `bundle/msi/*.msi` — Windows Installer package
- `bundle/nsis/*-setup.exe` — NSIS setup installer

To restrict the installer format (e.g. only NSIS), pass a target through:

```bash
npm run tauri build -- --bundles nsis
```

### Frontend only

To type-check and build just the React bundle without the Tauri shell:

```bash
npm run build      # tsc && vite build → dist/
npm run preview    # serve the built dist/ locally
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
