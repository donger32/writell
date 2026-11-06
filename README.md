# Writell

A local-first novel-writing app. Runs as a **desktop app on your PC** (main version) and as an **offline web app on a Chromebook**, from one codebase.

- `ARCHITECTURE.md` explains how it's built, where data is stored, and the privacy model.
- `ROADMAP.md` tracks what's done, what's next and known issues.

## Run it on your PC (development)

1. Install **Node.js 22 LTS** (nodejs.org).
2. In this folder, run `npm install`.
3. Run `npm run dev`, then open http://localhost:5173 in Chrome or Edge. This is the fastest way to try changes.

## Build the Windows desktop app

**Option A (easiest, no Rust needed):** push this folder to a GitHub repository. Then open **Actions → Build desktop app → Run workflow**. When it finishes, download `inkwell-windows-latest`. It contains `Writell_0.1.0_x64-setup.exe`.

**Option B (on your own PC):**
1. Install Rust from rustup.rs, and the "Desktop development with C++" workload from the Visual Studio Build Tools (Tauri's prerequisites: https://v2.tauri.app/start/prerequisites/).
2. Run `npm run desktop:dev` to open the app in a desktop window with live reload.
3. Run `npm run desktop:build` to get the installer in `src-tauri/target/release/bundle/nsis/`.

## Put the web version online (for the Chromebook)

Push to GitHub, then go to **Settings → Pages → Source: GitHub Actions**. The `Deploy web app` workflow then publishes it at `https://<you>.github.io/<repo>/` on every push.

Open that address in Chrome on the Chromebook. To install it as an app, use the install icon in the address bar or ⋮ → *Cast, save and share → Install page as app*. After the first visit it works offline.

Alternatives: Cloudflare Pages or Netlify. Upload the `dist/` folder after running `npm run build`. School filters block some hosts and not others, so if one is blocked, ask IT to allow it.

## Moving work between PC and Chromebook (until cloud sync, Stage 4)

On one device: Project overview → **Full backup file**. Save it to Google Drive or a USB stick.
On the other device: Home → **Restore backup**.
