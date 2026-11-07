# Writell

A local-first novel-writing app. Runs as a **desktop app on your PC** and as an **installable web app** (iPhone, any browser), from one codebase, with optional accounts, encrypted sync, friends, shared projects and live co-writing.

- `ARCHITECTURE.md` explains how it's built, where data is stored, and the privacy model.
- `ROADMAP.md` tracks what's done, what's next and known issues.

## Run it on your PC (development)

1. Install **Node.js 22 LTS** (nodejs.org).
2. In this folder, run `npm install`.
3. Run `npm run dev`, then open http://localhost:5173 in Chrome or Edge. This is the fastest way to try changes.

## Build the Windows desktop app

**Option A (easiest, no Rust needed):** push to `main` on GitHub and download the installer from the Releases page (it's built automatically when the version changes).

**Option B (on your own PC):**
1. Install Rust from rustup.rs, and the "Desktop development with C++" workload from the Visual Studio Build Tools (Tauri's prerequisites: https://v2.tauri.app/start/prerequisites/).
2. Run `npm run desktop:dev` to open the app in a desktop window with live reload.
3. Run `npm run desktop:build` to get the installer in `src-tauri/target/release/bundle/nsis/`.

## Where Writell lives

- **Website / phone:** https://donger32.github.io/writell/. The `Publish website` workflow republishes it on every push to `main`. On iPhone: open it in Safari → Share → Add to Home Screen.
- **PC installer:** the `Build Windows app` workflow builds it on GitHub whenever the version in `package.json` changes, and publishes it on the Releases page with a signed `latest.json`.
- **PC updates:** from 0.11.0 on, the app checks GitHub Releases and offers **Update now**. Updates are signed with the key stored in the repo secret `TAURI_SIGNING_PRIVATE_KEY`; the matching public key is in `src-tauri/tauri.conf.json`. Keep that secret: without it, new versions can't be signed.

## Releasing a new version

Bump `version` in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and the version line in `src/components/SettingsModal.tsx`, add a note to `ROADMAP.md`, and push to `main`. GitHub builds and publishes the rest.

## Accounts & sync

Settings → Account & sync. Uses the Supabase project in `src/sync/config.ts`; the database setup is `supabase/writell-sync.sql`. Everything is encrypted on the device before upload.


## Supabase setup scripts (run once each, in order)

1. `supabase/writell-sync.sql`: accounts & sync
2. `supabase/writell-stage-a.sql`, then `writell-stage-a-fix.sql`: profiles & friends
3. `supabase/writell-stage-b.sql`: shared projects
4. `supabase/writell-stage-d.sql`: project chat & admin tools (last line: your username)
5. `supabase/writell-special-names.sql`: special usernames admins can hand out
6. `supabase/writell-stage-e.sql`: roles & permissions, custom badges, name filter & flags, chat mutes
