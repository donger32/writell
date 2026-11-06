# Inkwell — Architecture

This file explains how the app is built and why, so that future work (by you or by Claude) builds on it instead of rewriting it.

## 1. One codebase, two ways to run it

```
                ┌──────────────────────────────────────────┐
                │  Inkwell UI (React + TypeScript, Vite)   │
                │  editor · sidebar · projects · settings  │
                └───────────────┬──────────────────────────┘
                                │ same build output (dist/)
              ┌─────────────────┴──────────────────┐
              ▼                                    ▼
   ┌──────────────────────┐            ┌────────────────────────┐
   │  Desktop app (PRIMARY)│            │  Web app / PWA          │
   │  Tauri 2 → .exe/.msi │            │  GitHub/Cloudflare Pages│
   │  Windows WebView2     │            │  Chrome on Chromebook   │
   │  + native file access │            │  works offline after    │
   │  + backup folder      │            │  first visit            │
   └──────────────────────┘            └────────────────────────┘
```

**Why Tauri, not Electron.** Both let a web interface run as a real desktop app. Tauri uses the browser engine Windows already has (WebView2), so the installer is about 10 MB instead of about 150 MB. It also uses less memory and starts faster. Its native side is written in Rust, but Inkwell barely needs any: everything except file dialogs and writing backup files is shared TypeScript.

**Why the web version too.** The Chromebook can't run a Windows app, but it can run the exact same interface in Chrome. `src/platform.ts` → `isTauri()` is the only place the two differ (native "Save as" dialogs and the backup folder on desktop, downloads in the browser).

## 2. Storage strategy (local-first)

| What | Where | Why |
|---|---|---|
| All writing & story data | **IndexedDB** via Dexie (`src/db.ts`) | Built into every browser engine, works offline, transactional (a save either fully happens or not at all), handles hundreds of MB. In the desktop app it lives in your Windows user profile. |
| Appearance / editor preferences | `localStorage` (`src/settings.ts`) | Small per-device settings, never your writing. |
| Revision history | `snapshots` table | An automatic copy of the scene every 5 min while writing (last 50 kept), plus manual snapshots and safety copies before restores. |
| Rolling project backups | `backups` table | Full project copy every N minutes when it changed (last 20). |
| Off-app backups (desktop) | `.inkwell.json` files in a folder you choose | Pick a OneDrive / Google Drive / Dropbox folder and you get an off-computer copy for free. 10 newest per project are kept. |
| Portable backups (any device) | "Full backup file" export | The way to move work between PC and Chromebook until cloud sync exists. |

**Saving pipeline.** Each keystroke updates the editor. 0.6 s after typing pauses (adjustable), the scene is written in one transaction together with the project's "last edited" time and today's word count. Pending saves are also flushed when you switch scenes, hide or minimise the window, or close the app. The status bar shows *Editing… → Saving… → Saved*, or a red *Save failed*.

**Text format.** Scene text is stored as ProseMirror JSON, the editor's native lossless format. It keeps underline and highlight, which plain Markdown can't express. Markdown is generated for raw mode and export, and parsed on import. JSON is also what Yjs, the real-time collaboration engine, works with, so Stage 4 doesn't need a data migration.

**Durability.** On start the app asks the browser for *persistent storage*, so Chrome won't evict it under disk pressure. Installed apps and desktop builds get this automatically. Settings → Saving & backups shows the status.

## 3. Data model

Every record has a random UUID (`crypto.randomUUID()`), `projectId`, `createdAt` and `updatedAt`. UUIDs mean two devices can create records offline and later sync without id clashes.

```
Project ─┬─< Chapter ─< Scene (text lives here)
         ├─< Snapshot (scene versions)      ├─< Backup (whole-project copies)
         ├─< DayActivity (words per day)
         ├─< Entity   kind = character | location | organization | event |
         │            note | religion | magic-system | <custom> …
         │            fields = built-in + custom profile fields, tags[]
         └─< Link     (fromType, fromId) —relation→ (toType, toId) + data
```

The `entities` and `links` tables already exist in schema v1, even though their UI arrives in Stages 2–3. That's how "everything can reference everything" is designed in from the start:

- character **appears-in** scene → "which chapters is she in?" is one indexed query
- character **parent-of** character, with `data: { kind: 'adoptive' }` → family tree
- character **related** character, with `data: { type, label, reverseLabel, history: [{ when, type, note, eventId }] }` → relationship map and how it develops
- event entity (`kind: 'event'`, `fields.start/end` as `{y,m,d}` in the timeline's calendar) **involves** characters/places and is **shown-in** scenes → all three timelines
- character **family** character, with `data: { type: 'parent' | 'spouse' | 'half-sibling' …, note }` → family trees (a tree entity stores only its members and card positions)
- event **located-at** location, event **shown-in** scene, event **in-timeline** timeline → world, story and character timelines are all views over the same events and links
- note **about** anything

Indexes `[fromType+fromId]` and `[toType+toId]` make both directions fast.

**Schema changes** go through Dexie versioning (`this.version(2).stores(...).upgrade(...)`). Never edit version 1 in place. Backup files carry `format` + `version` so old backups always import.

## 4. Privacy & permissions

- **Today (Stages 1–3):** there is no server and no account. Data never leaves the device unless you export it. Nobody can see your work.
- **Stage 4 (collaboration):** the planned backend is **Supabase**, which provides Postgres, auth and realtime, with **Yjs** for simultaneous editing.
  - Projects are local by default. Only projects you explicitly *share* are uploaded.
  - **Row Level Security** enforces access inside the database itself, not in the app's UI. A `project_members(project_id, user_id, role)` table controls every row, and a user who isn't a member gets nothing back even if they call the API directly.
  - Roles are owner, editor, commenter and viewer, as in the spec. Only owners can invite, change roles, transfer or delete. Invite links are random, expiring and revocable.
  - **Optional end-to-end encryption:** a project can be encrypted with a key that never leaves members' devices. The server then stores only unreadable data. The trade-off is that server-side search and some recovery options aren't possible for those projects.
- **Device caveat:** on a school- or employer-managed computer, administrators may be able to access browser data. Clearing site data in Chrome also deletes the web version's projects, so keep backup files.

## 5. File structure

```
inkwell/
├─ ARCHITECTURE.md            ← this file
├─ ROADMAP.md                 ← stages, done / not done, known issues
├─ index.html, vite.config.ts, tsconfig.json, package.json
├─ public/icon.svg
├─ src/
│  ├─ main.tsx                boot: fonts, theme, persistent storage, backup loop, offline SW
│  ├─ App.tsx                 shell: sidebar + main view + modals, global shortcuts, help
│  ├─ db.ts                   ★ data model, all reads/writes, export/import format
│  ├─ settings.ts             themes, editor prefs, CSS variables
│  ├─ nav.ts                  navigation state (which view/scene is open), recents
│  ├─ backupService.ts        timed backups (+ desktop backup folder)
│  ├─ exporting.ts            Markdown / TXT / backup export, manuscript import
│  ├─ platform.ts             desktop vs browser detection, storage persistence
│  ├─ util.ts                 word/sentence counts, save/open file helpers
│  ├─ entities.ts             characters / world / notes: field templates, CRUD, links, images
│  ├─ editor/extensions.ts    TipTap setup, focus-mode plugin, Markdown ⇄ JSON converters
│  ├─ editor/smartMarks.ts    word-processor-style bold/italic/underline/strike/highlight toggles
│  ├─ editor/reviewMarks.ts   comment + revision-flag marks (hidden in writing mode, dropped on export)
│  ├─ story3.ts               calendars & dates, timeline events, family-tree types & auto-layout, relationship types
│  ├─ stats.ts, analysis.ts   statistics/streaks/sprints; repeated words, echoes, name-typo detection
│  ├─ manuscript.ts           export with formatting (Word, PDF, MD, TXT) + Word import
│  ├─ mapdata.ts              map grid (heights/terrain), generation, brushes, top-down rendering
│  ├─ editor/trackChanges.ts  suggestion mode (insertion/deletion marks), accept/reject
│  ├─ shortcuts.ts, saveRegistry.ts, templates.ts, ai.ts, sidebarTools.ts
│  ├─ components/
│  │  ├─ Sidebar.tsx          workspace nav, project section, manuscript tree (drag & drop)
│  │  ├─ EditorPane.tsx       one editor (toolbar, modes, autosave, raw MD, details drawer)
│  │  ├─ FindReplace.tsx, HistoryPanel.tsx
│  │  ├─ Home.tsx             home + project lists, project context menu
│  │  ├─ ProjectOverview.tsx  stats, chapters, export, backups
│  │  ├─ SettingsModal.tsx, CommandPalette.tsx
│  │  ├─ TabBar.tsx           open-scene tabs
│  │  ├─ visual/              FamilyTree, RelationshipMap, Timelines (world / story / character)
│  │  ├─ maps/                Maps (editor), Terrain3D (three.js), Map2D — one map, two views
│  │  ├─ StatsView, SprintButton, ReviewPanel (comments/analysis/checklist), AiPanel,
│  │  │  ExportDialog, NewProjectDialog, ErrorBoundary
│  │  ├─ story/               Characters, World, Notes (+ quick idea), SearchView,
│  │  │                       EntityShell (list+detail layout), links (pickers), common (fields, tags, images)
│  │  └─ ui.tsx               dialogs, toasts, context menu, modal
│  └─ styles.css              the whole design system (CSS variables)
├─ supabase/schema.sql       Stage 4 database + row-level security (not connected yet)
└─ src-tauri/                 desktop shell (Rust, ~20 lines) + icons + permissions
   ├─ tauri.conf.json         window, bundle targets (.exe/.msi/.dmg/.deb)
   └─ capabilities/default.json   exactly which files the app may touch
```

**Adding a Stage 2+ feature** follows the same pattern each time: add query helpers in `db.ts` (or a new `src/data/<feature>.ts`), add a view in `src/components/<Feature>/`, add a route in `nav.ts`, and add a sidebar entry. Nothing existing needs to be rewritten.

## 6. Key libraries

| Library | Role |
|---|---|
| React 19 + TypeScript | UI |
| Vite 6 | dev server & build |
| TipTap 3 (ProseMirror) + @tiptap/markdown | editor, live Markdown shortcuts, MD import/export |
| Dexie 4 | IndexedDB wrapper with live queries |
| vite-plugin-pwa | offline caching + installable web app |
| Tauri 2 (+ dialog & fs plugins) | desktop app |
| lucide-react | icons |
| @fontsource/* | bundled fonts (work offline) |
| React Flow | family tree & relationship diagrams |
| three.js | 3D maps |
| *Stage 4:* Supabase, Yjs, y-prosemirror | accounts, permissions, realtime |
| *Stage 5:* docx, pdf (print-to-PDF) | DOCX / PDF export & import |
