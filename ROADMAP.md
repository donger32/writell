# Writell — Roadmap & status

Legend: ✅ done and tested · 🟡 partly done · ⬜ not started

## Changes in v0.11.0 — GitHub
- Code lives at github.com/donger32/writell. The website is published to GitHub Pages (donger32.github.io/writell) on every push, and the Windows installer is built on GitHub and published on the Releases page.
- PC app: one-click updates ("Writell X is available → Update now"), signed and checked against the app's built-in key.
- The PC app can clean up old .writell.json backup files (it only allowed .inkwell.json before).

## Changes in v0.10.0 — accounts & sync
- Settings → Account & sync: create an account / sign in (email + password) through your Supabase project.
- Everything is encrypted on the device (AES-256-GCM) before upload. The data key is stored on the server only locked with your password and, separately, with a one-time recovery key.
- Syncs projects, chapters, scenes, characters & all entries, links, word-count history and pictures. Revision history, in-app backups and the trash stay per device.
- Works offline; catches up on start, every 30 s while open, when the app comes back to the foreground and when the internet returns.
- Conflicts: the newer edit wins; for scenes the other version is kept in History ("Before sync").
- An open scene updates live when another device changes it.
- Password reset by email → recovery key unlocks once. Change password, pause sync on a device, sign out (projects stay on the device).
- Sidebar shows sync status. Database setup: supabase/writell-sync.sql.

## Changes in v0.9.2
- Phones: swipe the open menu to the left to close it (it follows your finger; a quick flick works too). Swiping up and down still scrolls it.

## Changes in v0.9.1
- Phones always show the full slide-in menu, even if the sidebar was set to icons-only; the compact-sidebar button is hidden on phones.

## Changes in v0.9.0 — phone layout
- On phone-sized screens (narrower than 700px, or a phone turned sideways) Writell switches to a phone layout; the PC window (at least 760px wide) never does.
- A slim top bar with ☰ opens the sidebar, which slides in over the page and closes when you pick something.
- List pages (Character, Worldbuilding, Notes) show the list, then the open item full-screen with a ‹ Back button.
- Pop-up windows (Settings, New project, etc.) fill the screen; Settings sections become a scrolling row of tabs.
- Side panels (event details, scene details, history, review) slide up from the bottom as sheets.
- Editor: toolbar and buttons scroll sideways in one row; finger-sized buttons; text boxes don't make iPhone zoom in; nothing hides under the notch or home bar.

## Changes in v0.8.1
- Renamed to **Writell**. Projects carry over (the app keeps its internal storage name and ID). New backup files end in .writell.json; old .inkwell.json backups still open.
- iPhone/iPad home-screen icon and full-screen launch for the web version.

## Changes in v0.8.0
- Character names (and nicknames) are never underlined as spelling mistakes, even with character cards off.
- Track changes: Backspace/Delete hop over text that's already crossed out and cross out the next letter; deleted letters join one crossed-out run; deleting your own suggestion removes it.
- Sidebar names: Character, Relation, Tree, Timeline, Map (Worldbuilding unchanged). The command palette still finds the old names.
- Home: a Favorites row above your projects; a star on every project card to favorite it in one click. The Projects page lists the last opened project first.
- Word counts only count words you type: deleting never subtracts — in the "this session" counter, sprints and daily stats. Undo doesn't count as writing.
- Timeline: your timelines are tabs with a + to add one (double-click a tab to rename, ⋯ for options); double-click empty space to add an event at that date; Eras (shaded, named stretches of time); characters' ages next to their names on events; zoom bar simplified (scale moved to View); "World / Story" renamed "Timelines / Reading order".

## Changes in v0.7.2
- Dragging a timeline bar by its picture moves the bar; the browser no longer tries to drag the picture itself.

## Changes in v0.7.1
- The timeline no longer changes a character's dates silently: dragging a life bar or editing the Birthday on the character timeline asks "Are you sure you want to change X's timeline from … to …?" first. (Pressing Enter no longer answers that question by accident.)
- 3D maps are a solid block now: earth walls and a floor around the land, and the sea is a see-through block of water, so it looks right from the side.

## Changes in v0.7.0
- **Trash**: deleting a project, chapter, scene, character, place, note, map, tree or timeline moves it to the Trash, with an Undo button for a few seconds. Restoring brings back its links, family-tree spots and timeline entries.
- **Character cards**: hover a character's name (or nickname, or a first name only one character has) in your text to see their picture and key details. Click the card to open the profile. Can be turned off in Settings → Editor.
- **Character colors**: each character has a color (automatic, or chosen on their page). It is used for avatars, their name in your text, timelines and maps.
- **Birthday drives timelines**: the separate "birth year" field is gone. The year is read from the Birthday ("23/12/1324", "Spring 1324", "300 BC"). Existing birth years were merged into Birthday automatically.
- **Character layouts**: Full profile, Essentials, Just the basics, or Blank. Remove any field with ×, add fields one by one, or set a default layout for the whole project. Filled-in fields always stay visible.
- **Simpler sidebar**: inside a project the workspace becomes one row of icons. Favorites and Archived are tabs on the Projects page. Search sits in the project header. Recently opened scenes and characters can be switched back on in Settings → Sidebar.
- **Simpler timeline toolbar**: one row with zoom −/+, a scale picker, Fit, a View panel (layout and rows) and a Filter panel with a count of active filters.
- **Relationship map**: whole-window mode; picture sizes Small/Medium/Large; mini-map for big casts; labels hide when zoomed far out. **Boxes** (named, colored, resizable; moving one moves the people inside) and **text notes** on the map. **Arrange** offers Group by connections (connected people cluster together), Circle, or A–Z grid, with Undo.
- **Tasks**: a to-do list per project, with due dates (overdue ones show in red), links to chapters, characters or world entries, and a count in the sidebar.
- **Import notes** from .txt/.md files into the Notes inbox.
- **Side margins** setting for the writing column.
- American spelling throughout the interface.

## Spec check (v0.7.0)
Everything in the original specification is in place except what needs a server:
- Accounts, friends, sharing, permission levels, real-time co-writing, chat, notifications and other people's activity (Stage 4). The database schema is ready in `supabase/schema.sql`; it needs a Supabase project.
- Hosting the Chromebook (web) version needs somewhere to host it, such as GitHub Pages.

Interpretations worth knowing:
- "Default project location": projects live in the app's own database on this computer. The *backup* folder can be chosen in Settings → Backups, and every project can be saved to a file at any time.
- Comments and version history are kept per scene. A chapter's history is the history of its scenes.

## Changes in v0.6.0
- Timelines zoom out to centuries and millennia, and a new **Show all** layout squeezes rows so every character, place, note, map and event fits on one screen (names drop to hover-only when they no longer fit side by side). **Compact** and **Cards** layouts remain.
- Fixed: compact timeline bars inherited toolbar padding (dark boxes at far zoom); labels overlapped neighbouring entries.
- Deleting a chapter, scene, character, place, note or relationship now also removes its timeline entry; leftovers from older versions are cleaned up at start.
- Characters whose timeline was deleted fall back to the main timeline instead of vanishing.
- Lists sort naturally ("Char 2" before "Char 10"); numbered names get clearer initials ("C10").
- Long names wrap in profile headers; headers stack on narrow windows; long dropdowns no longer stretch toolbars.
- Restoring a damaged backup shows a message instead of failing silently. Editor breadcrumb spacing fixed.

## Changes in v0.5.3
- Fixed: on the relationship map (and family trees), lines and then characters could vanish after adding or changing relationships until you left the screen and came back. The diagram now keeps each character's measured size when it redraws, and if anything is left undrawn it rebuilds itself automatically.

## Changes in v0.5.2
- **Relationship map:** two characters can share several relationships (e.g. former partners *and* enemies). Each gets its own curved line and label instead of being drawn on top of each other, and lines now run straight between characters. Add more by dragging a character's **+** onto another, or with "Add another relationship between them" in the panel. A badge on each character shows how many connections they have. A new **Show places & groups** option puts connected places, factions and organisations on the map as well.

## Changes in v0.5.1
- **"On the timeline" box on every page**: characters, worldbuilding entries, notes, maps, relationships (in their panel) and chapters (scene details drawer, or ⋯ → Place on a timeline on the overview). Pick a timeline and a date or period, add a label like "Founded", place it on several timelines, or jump straight to it on the timeline.
- **Characters appear automatically** from their birth and death years, as a life bar on the timeline you choose on their page. Dragging the bar shifts both years, and clicking it opens the profile. You can hide a character from the timeline if you want.
- The timeline's "Add to timeline" menu now also offers chapters and maps.

## Changes in v0.5.0
- **Places inside places:** any worldbuilding entry can be part of a bigger one (country › region › city › building). The list shows them as a tree you can fold, and you can drag an entry onto another to put it inside. Each entry shows a breadcrumb plus "Part of" and "Contains" boxes. Deleting a place moves what was inside it up one level.
- **Calmer project overview:** title, one progress line, three buttons (Continue writing, Export, Project settings) and a compact chapter list with scenes folded away. Word target, deadline, cover, backups and story-bible exports moved to **Project settings**.
- **Universal timelines:** "Add to timeline" puts characters (their lifespan, from the birth and death years on their profile), places, notes and relationships on the world timeline next to events. Rows are grouped by type (this can be switched off), each type can be shown or hidden, and each entry links back to what it's about. "All characters with a birth year" adds the whole cast at once.

## Changes in v0.4.0
- **Maps:** sculptable 3D terrain (raise, lower, smooth, flatten, paint 12 terrain types, sea level, height, low-poly look, undo), generated islands, continents, archipelagos and mountains, or **your own picture**. **Switch any map between 3D and 2D**; both views share the same land and pins. A picture can be raised into 3D, with lighter areas becoming higher ground. Pins link to places or characters, and you can save a picture of either view.
- **Custom relationship types:** make your own (name + colour) from the relationship map. They work in filters, development history and character timelines.
- **Track changes:** suggestion mode in editing mode (Ctrl+Shift+E). Additions are underlined in green and deletions struck through in red. Accept or reject one at a time or all at once. Exports, search and word counts ignore suggested deletions.
- **Settings:** customisable keyboard shortcuts, the mode the editor opens in, and the default template for new projects.
- **Note attachments:** any file up to 50 MB (drag and drop works), included in full backup files.
- **Sidebar:** drag project tools to reorder them; pin scenes, characters, places and notes (right-click → Pin to sidebar); recently opened characters.
- **Accessibility:**
  - Visible keyboard focus everywhere.
  - The manuscript tree works with the keyboard: Enter opens, and the Menu key or Shift+F10 opens the context menu, which the arrow keys move through.
  - Dialogs keep keyboard focus inside and return it when closed.
  - Screen-reader names on icon buttons, plus a skip-to-content link.

## Changes in v0.3.1 (self-review fixes)
- Closing the desktop window now finishes saving everything (editor text and profile fields) before it closes.
- Restoring or duplicating a project now keeps its family trees, timeline events, comments and relationship history connected. Before, the copy lost those connections.
- Deleting a character, place or note now really removes its links, and takes the person off family trees. Leftover links from older versions are cleaned up on start.
- Deleting a scene or chapter also deletes its comments.
- Opening a scene no longer re-saves it or bumps the project's "last edited" time.
- A backup folder on another drive (e.g. D:\) is remembered after restarting.
- Opening Statistics from a project no longer hides the project in the sidebar.
- Dropdown pickers open towards the side with room (one was hidden behind the sidebar in family trees).
- Switching to a light app theme no longer leaves a dark writing page (and the reverse).
- Raw Markdown mode warns before it removes comments and revision flags.
- Desktop app: F5 / Ctrl+R can't accidentally reload; the browser's right-click menu only appears where you type (so you still get spelling suggestions).
- Search is faster on long novels; tested with 180 scenes / 260,000 words.
- Project overview cover no longer stretches.

## Changes in v0.3.0
- **Stage 3:** family trees, relationship map with development over time, and world, story and character timelines with fictional calendars.
- **Stage 5:** statistics, goals, streaks, writing calendar and sprints. Editing mode with comments, revision/unfinished flags, analysis (repeated words and phrases, echoes, adverbs, name typos), chapter checklists and plot threads. Version comparison. Word import; PDF and Word export with formatting options; project templates, covers and deadlines.
- **Optional AI tools** using your own API key, off by default.
- Sidebar tools can be hidden and reordered (Settings → Sidebar).
- If one screen fails, it now shows an error message instead of taking down the whole app.

## Changes in v0.2.0
- Fixed: bold / italic / underline / strikethrough / highlight with nothing selected now change the whole word under the cursor. At a word edge, the on/off choice is remembered if you click away and come back.
- Added: tabs for open scenes (Ctrl+Tab, Ctrl+W, middle-click to close, drag to reorder).
- Added: Stage 2 — characters, worldbuilding, notes and idea inbox, linking, project search.
- Added: Word (.docx) export; Markdown export of characters, worldbuilding and notes.

## Stage 1 — Core application

| Feature | Status | Notes |
|---|---|---|
| Main layout, left sidebar | ✅ | Collapsible sections, compact icon-only mode (Ctrl+\\), drag-to-resize (double-click resets), context-sensitive project section, project switcher |
| Home screen | ✅ | Greeting, total + today's words, "Continue writing", project cards |
| Projects: create / rename / delete / duplicate / archive / favorite | ✅ | Right-click a card or use ⋯ |
| Project description, word target + progress, cover colour | ✅ | Project overview page |
| Chapters: create / rename / delete / duplicate / reorder (drag or menu) / colour / status / summary / notes / word count / numbering | ✅ | |
| Scenes: create / rename / delete / reorder / move between chapters (drag) / status / summary / notes / word count | ✅ | |
| Editor: autosave, undo/redo, spell check, find & replace, words / characters / sentences / reading time, live session count | ✅ | |
| Formatting: bold, italic, underline, strike, H1–H3, lists, quotes, highlight, links | ✅ | |
| Markdown: live shortcuts, raw mode toggle (Ctrl+Shift+M), MD import & export | ✅ | |
| Editor colours independent of app, presets, save own themes | ✅ | |
| Editor width presets + slider, font, size, line height, paragraph spacing | ✅ | |
| Focus, typewriter, full-screen, reading modes | ✅ | |
| Customisable toolbar | ✅ | Settings → Editor |
| Split-screen (two scenes side by side) | ✅ | Right-click a scene → Open in split view |
| Themes: 4 dark + 1 light, custom colours, save own themes, UI scale, UI font | ✅ | |
| Command palette (Ctrl+K) incl. full-text search | ✅ | |
| Revision history per scene + restore | ✅ | Pulled forward from Stage 5 for safety |
| Automatic in-app backups + restore as copy | ✅ | |
| Backup file export / import (moves work between devices) | ✅ | |
| Desktop backup folder (.inkwell.json files) | 🟡 | Compiles; not yet tested on real Windows |
| Desktop installer (.exe / .msi) | 🟡 | Tauri config compiles on Linux; build the Windows installer via the GitHub Action or `npm run desktop:build` on your PC |
| Offline web app / PWA for Chromebook | ✅ | Works offline after first load |
| Tabs (many documents open at once) | ✅ | v0.2.0 |

## Stage 2 — Story organisation (v0.2.0)
| Feature | Status | Notes |
|---|---|---|
| Character profiles: every field from the spec, portrait, role, status (alive/dead/missing/unknown), tags, favourite | ✅ | |
| Custom profile fields | ✅ | Per character |
| Character ↔ scene links ("Appears in"), ↔ characters (labelled from each side), ↔ world entries | ✅ | Tag characters from a scene's details panel or from the profile |
| Worldbuilding: 24 built-in categories (places, groups, religions, magic systems, species, languages…) + your own categories | ✅ | Places get geography/population/landmarks fields |
| Scene settings ("Scenes set here") | ✅ | |
| Notes: idea inbox, quick capture (Ctrl+Shift+N), types, folders, tags, pinning, image references, link to anything | ✅ | |
| Project search with category filters (Ctrl+Shift+F) | ✅ | Scenes, chapters, characters, world, notes, relationship labels |
| Favourites for characters/places, shown in the sidebar | ✅ | |
| Command palette finds characters, places and notes | ✅ | |
| Exporting character profiles / world / notes | ✅ | Markdown |
| Customisable sidebar section order / pinning | ✅ | v0.4.0 |
| Likely misspelled character names | ✅ | Editing tools → Analysis |

## Stage 3 — Visual story tools (v0.3.0)
| Feature | Status | Notes |
|---|---|---|
| Family tree builder: cards with portrait/age/description, lines, generations, drag, zoom/pan, minimap | ✅ | React Flow |
| Auto-arrange by generation | ✅ | Simple layered layout; complex trees may need manual nudging |
| Parent, adoptive, step-parent, guardian, spouse, partner, former spouse, sibling, half/step-sibling, custom | ✅ | Notes on every connection |
| Unknown parents, multiple trees, create people from the tree, click card → profile | ✅ | |
| Relationship map (separate from family) with 11 types, filters by type and character focus | ✅ | |
| Relationship development (Enemies → Allies → Friends), each change with when / why / linked event | ✅ | |
| World timeline: events with start/end, categories & colours, characters, places, scenes, images, unresolved flag | ✅ | |
| Zoom decades → days, drag events in time, list view, filters, multiple timelines | ✅ | |
| Custom fictional calendars (month names/lengths, era) | ✅ | Per timeline |
| Story timeline: reading order, flashback / flash-forward / time-skip markers, world-time chart | ✅ | |
| Character timeline: life events with age, relationship changes | ✅ | Age uses "Birth year" on the profile |

## Stage 4 — Collaboration (needs a server)
| Feature | Status | Notes |
|---|---|---|
| Database design with row-level security (accounts, friends, invites, roles, comments, activity) | 🟡 | `supabase/schema.sql`, written but not yet connected to anything |
| Accounts, friends, sharing, real-time co-writing (Yjs), cursors, chat | ⬜ | **Blocked on infrastructure:** needs a Supabase project (free tier). See below. |
| Cloud sync between your own PC and Chromebook | ⬜ | Same requirement |

**What's needed to start Stage 4:** create a free Supabase project at supabase.com and run `supabase/schema.sql` in its SQL editor. Then give Claude the project URL and the *anon* (public) key. The service key is never needed in the app. Shared projects only sync if you explicitly share them; everything else stays local.

## Stage 5 — Advanced (v0.3.0)
| Feature | Status | Notes |
|---|---|---|
| Daily / weekly / monthly words, totals, goals, streaks, 30-day chart, year calendar, milestones | ✅ | Optional (Settings → Editor) |
| Writing sprint timer with words-per-minute | ✅ | Editor status bar |
| Project word target + deadline → words per day needed | ✅ | |
| Revision history, restore, **compare any two versions** (word diff) | ✅ | |
| Separate writing / editing modes (Ctrl+E) | ✅ | Revision marks are invisible in writing mode |
| Paragraph comments with replies & resolve; flag "needs revision" / "unfinished" | ✅ | Single user until Stage 4 |
| Repeated words, repeated phrases, echoes, -ly adverbs, likely misspelled character names | ✅ | Scene / chapter / project |
| Editing checklists per chapter (+ your own default) | ✅ | |
| Unresolved plot threads | ✅ | Notes of type "Plot thread" |
| Track changes (Word-style suggestions) | ✅ | v0.4.0. Text within paragraphs is tracked; splitting/joining paragraphs is applied directly |
| Export Word / PDF / Markdown / text with font, spacing, headings, separators, title page, chapter selection | ✅ | PDF goes through the system print dialog |
| Import Word (.docx), Markdown, text | ✅ | |
| Project templates (three-act, hero's journey, mystery, short story), covers, deadlines | ✅ | |
| Optional AI tools (feedback, dialogue, consistency, plot holes, grammar, summaries, prompts, brainstorm) | ✅ | Your own Anthropic API key; off by default |

## Stage 6 — Polish & testing
✅ Customisable sidebar tools (drag to reorder / hide / pin) · ✅ crash protection for each screen · ✅ keyboard & screen-reader pass (v0.4.0) · ✅ performance tested at 260k words
⬜ Real-Windows testing (your install is the first run on Windows)

## Known issues / limitations
- Track changes doesn't record paragraph splits/joins or list changes; those apply immediately.
- Picture maps are stretched to a grid of 160×160 points for 3D; very fine detail in a picture becomes smoother in 3D (the picture itself stays sharp when shown on the land).
- In-app automatic backups leave out note attachments to stay small; full backup files include them.
- **Two devices don't sync automatically yet.** The PC and Chromebook each hold their own copy. Use *Full backup file* → *Restore backup* to move work until Stage 4.
- Family-tree auto-arrange is a simple generational layout; with remarriages across generations you may need to drag a few cards.
- PDF export uses the print dialog; pick “Microsoft Print to PDF”.
- Restoring a backup always creates a **copy** (“… (restored)”), never overwrites. That's deliberate for safety.
- Raw-Markdown mode: underline has no standard Markdown form, so it is written as `<u>text</u>` (which imports back correctly).
- Full-text search in Ctrl+K scans scenes on the fly. That's fine for normal novels; Stage 2 adds an index.
- The interface scale uses CSS `zoom`, which is supported in Chrome/Edge/WebView2 (all targets).
- The Windows installer is built on Linux (cross-compiled) and is not code-signed, so Windows SmartScreen warns on first install (More info → Run anyway).
- Portraits and note images are stored inside the project (downscaled), so they are included in backups.
