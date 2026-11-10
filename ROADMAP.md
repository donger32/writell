# Writell — Roadmap & status

Legend: ✅ done and tested · 🟡 partly done · ⬜ not started

## Changes in v0.17.6 — top buttons stay in your project

No database changes.

- **Statistics, Friends, Trash and Admin open over the page you're on** when you're in a project, instead of replacing it. Back, Esc or the same button again closes them and you're exactly where you were (same scene, same spot). Home and All projects still go to the menu. The command palette's Friends and Trash work the same way inside a project.
- **Friends has its own icon** (a contact card) so it no longer matches Character; the palette's Tree, Relation and Trash entries got their proper icons too.

## Changes in v0.17.5 — maps on phones

No database changes.

- **Map page on phones:** the map uses the whole width, the tools sit in one row you can swipe sideways, and pins, timeline, look and the building palette are in a "Map details" sheet (sliders button) that slides up from the bottom. It opens by itself when you place or select things. The 3D view looks down more steeply on tall screens so the land fills them, and the mouse hints are hidden.

## Changes in v0.17.4 — remove tool for maps

No database changes.

- **Remove tool (X)** on maps: click or drag over buildings, walls, bridges, trees, rocks and anything else you placed to take them away, in 3D or 2D. The brush size sets how much it catches; one Ctrl+Z brings back everything from that drag.

## Changes in v0.17.3 — much bigger map sizes

No database changes.

- **Bigger sizes.** Small stays the same; Medium is now 2× as wide as Small, Large 3.2×, Huge 5× and Giant 8× (it was 4.8×). Older maps keep their land and show the nearest size name; "Make bigger" can grow them to the new sizes.

## Changes in v0.17.2 — travel across big worlds

No database changes.

- **Big maps can't be seen all at once in 3D.** Anything bigger than Small starts at a Small map's view and can't be zoomed out much further; far-off land fades into the distance. The 2D view still shows the whole world.
- **Overview map** in the top corner of 3D on big maps: shows where you are and what you can see. Click or drag on it to go somewhere.
- **Arrow keys travel** across the land (hold Shift to go faster).

## Changes in v0.17.1 — bigger maps are bigger worlds

No database changes.

- **Bigger maps cover more ground.** Hills, coasts and mountains are the same real size on every map, so a Giant map is a world with many more of them instead of one island stretched out. Houses and everything else you place stay the same size.
- **Big maps open up close.** The 3D view starts showing as much land as a Small map does; scroll out to see the whole world. Right-drag slides along the ground, and the haze follows how far out you are.
- **2D view:** big maps start zoomed in too ("Whole map" shows all of it), the picture is sharper when zoomed in, and outlines stay thin.
- New maps start at a mountain height that suits their size; making a map bigger keeps its height.

## Changes in v0.17.0 — bigger maps, your own types, timeline 30000 BC – 30000
No database changes.
- **Maps:** five sizes up to Giant (a whole world), and any map can be made bigger later from Land & water. New maps start low-poly. The height slider goes much higher. Place houses, cottages, towers, castles, tents, wells, walls, bridges, trees, pines, rocks and flags (B), then select (E) to move, turn (, and .), resize, recolor, copy or remove them; they show in 2D too. Big maps only redraw the part you're painting.
- **Worldbuilding and notes:** pick a type from a list you can search, add your own, and remove the ones you don't use (with an X and a confirmation). Notes, worldbuilding and character pages use the whole width on big screens.
- **Tasks** can point at a single scene. **Chapters** can be pinned to the sidebar and get any color (20 ready-made plus a color picker).
- **Relation map:** the relationship types moved into a Types button, like the timeline's Filter.
- **Timeline:** always spans 30000 BC to 30000, the ruler labels no longer run into each other, and zooming in still shows months and days.
- **Search** is grouped (scenes, chapters, characters, places, notes, maps & more), says where each match is, and no longer shows stored map or picture data.
- Friends, Trash and Admin keep your project open in the sidebar; Home and All projects go back to the menu.
- Smaller cursors, a hidden email in the account panel, a clearer About & privacy, and the interface scale no longer throws off dragging on the timeline, the 2D map, or the relation map and trees.

## Changes in v0.16.2
- New mouse cursors: a clean rounded dart (Black, White, or the new see-through Outline) with a slim text cursor; the buttons in Settings show what each looks like.
- Long windows (like editing a person or a role in Admin) now scroll inside instead of running off the screen.

## Changes in v0.16.1
- **One database file:** all the Supabase setup is now in `supabase/writell-setup.sql` (the old stage files are gone). Run it whenever an update says so; running it again is always safe and never brings back words or roles you deleted.

## Changes in v0.16.0 — roles, custom badges, name filter (stage E)
**Needs `supabase/writell-stage-e.sql` run once.**
- **Roles & permissions:** the owner makes roles (name, color, order) and ticks what each can do: rename people, lock names, titles & colors, give badges, make badges, ban, manage chats, clear profiles, flagged names, word filter, reserve names, announcements, fun effects, see the log. Admin and Moderator are ready-made roles you can change or delete. Staff only see the tabs and buttons their role allows, and the database checks every action.
- **Custom badges** (Badges tab): your own emoji, name, color and description. The built-in badges are gone.
- **Manage chats:** mute someone in every chat for a while, or remove everything they wrote in chats (without reading it: it stays encrypted).
- **Name filter:** usernames and display names with blocked words (slurs, swearing, dictators…) can't be picked, also with tricks like f.u.c.k, h1tl3r or fuuuck. Innocent words that contain one (Scunthorpe, cocktail, assassin) are on an allow list.
- **Flags tab** (staff only): names that contain a "flag" word or are one letter off a blocked word, with Looks fine / Rename / Ban, and a button to check everyone's names again. The word lists and a name tester are under Names & words.

## Changes in v0.15.2
**Needs `supabase/writell-special-names.sql` run once.**
- Special usernames: admins can give anyone a username of 1–24 characters with capitals, symbols or emoji (Z, ★Cleo★, 🐐ben). People can't pick these themselves, but keep them when they edit their profile. Typing a special name exactly in Find people finds it. Reserved names can be special too.

## Changes in v0.15.1
- Admin badge, colours and the Admin page now show up without restarting Writell if the stage D script was run while it was open.

## Changes in v0.15.0 — project chat & admin tools (stage D)
**Needs `supabase/writell-stage-d.sql` run once** (then the last line with your username).
- **Project chat** in every shared project (sidebar → Chat, or the chat button in the editor): messages, replies to anything, comments and "who changed what" in one Discord-style feed, with filters (All / Messages / Comments / Changes). Encrypted with the project key like everything else.
- **Comments for co-writers:** commenters can finally comment (select text → Comment). Comments are underlined in the writer's colour for everyone, clicking one opens it in the chat, and "Comment on …" in the chat jumps to the text. Editors and owners can resolve or remove anyone's comment; everyone can edit or delete their own messages.
- **Changes in the chat:** "Mara wrote in “Scene 3” +240 −12 words" and "Ben added scene “The Storm”", grouped so the chat doesn't fill up.
- **Mute** (folds away someone's messages, no pop-ups; private) and **block** from any name in the chat.
- **Follow** a co-writer: click their avatar at the top of the editor → Follow. You go to whichever scene they open and their cursor stays on screen; typing yourself stops following.
- New-message pop-ups with an Open button, and unread counts on Chat.
- **Admin tools** (sidebar → shield icon, staff only): overview numbers; people search; rename (or 🎲 surprise rename) and lock names; titles; name colours (incl. rainbow); 20 badges; staff ranks (moderator / admin, owner only); bans with reason and length; clear bios/pictures; reserved usernames; announcements (info / party / warning / love); fun effects for one person or everyone (confetti, snow, hearts, earthquake, shout, spotlight); a log of every admin action. The database checks every admin action; admins can't read anyone's writing or chats.
- Roadmap and README brought up to date.

## Changes in v0.14.1
- Co-writers' cursors are easier to see: a bold, full-height line in their colour with their name.
- Settings → Appearance → Mouse cursor: System, Black or White. Writell's own smooth arrow, text cursor and pointing hand, only inside Writell.

## Changes in v0.14.0 — live co-writing (stage C)
- In shared projects, scenes are written together live: everyone's typing merges letter by letter (Yjs), nobody overwrites anybody.
- See each other's cursors and selections with names in their colour; the scene header shows a live dot and who's in the scene.
- Edits are encrypted with the project key before they're sent; the server only relays scrambled bytes.
- If the live connection drops, edits still merge through the regular sync. Undo only undoes your own typing; your word counts only count your own typing; track changes ignores co-writers' edits.

## Changes in v0.13.0 — sharing projects (stage B)
- Share button (project Overview, or a project's ⋯ menu): add friends as Editor, Commenter or Viewer; change roles, remove people, make someone else the owner, stop sharing.
- Invite links (pick the role; expire after 14 days; can be turned off). The secret half of the link never reaches the server.
- Shared projects stay end-to-end encrypted: each has its own key, locked separately for every member with their personal key.
- Home: "Shared with me" section, shared badges, "Join with a link". Viewers and commenters get a read-only editor and a notice.
- Changes in shared projects arrive within seconds (instant ping when realtime is available, otherwise every 8 s).
- Leaving or being removed takes the project off your devices; the owner deleting a shared project asks first.
- Fixed: after signing in (when Writell started signed out), automatic syncing didn't start until a restart.
- Supabase: supabase/writell-stage-b.sql.

## Changes in v0.12.0 — friends (stage A)
- Profiles: unique username, display name, picture, short bio. Picked the first time you open Friends.
- Friends page (sidebar → Friends): find people by username or name, send / accept / decline / cancel requests, remove friends, block / unblock (blocked people can't find you or send requests; they aren't told).
- Online status: friends see a green dot and "seen 5 min ago"; you can hide it (Edit profile). Only friends can see it.
- Each account gets a key pair for sharing projects privately (stage B).
- Phone: tapping the page you're already on in the menu now closes the menu.
- Supabase: supabase/writell-stage-a.sql (+ writell-stage-a-fix.sql for the blocked list).

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
- ~~Accounts, friends, sharing, permission levels, real-time co-writing, chat, activity (Stage 4)~~: done in 0.10 – 0.15.
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

## Stage 4 — Collaboration (Supabase)
| Feature | Status | Notes |
|---|---|---|
| Accounts, encrypted cloud sync between your own devices | ✅ | v0.10.0. Database: `supabase/writell-setup.sql`. Encrypted on the device before upload |
| Profiles, usernames, friends, requests, blocking, online status | ✅ | v0.12.0. `supabase/writell-stage-a.sql` (+ `-fix`) |
| Sharing projects: roles (owner / editor / commenter / viewer), invite links | ✅ | v0.13.0. `supabase/writell-stage-b.sql`. Each project has its own key |
| Live co-writing (Yjs), named cursors | ✅ | v0.14.0 – 0.14.1 |
| Project chat, comment feed, follow a co-writer, mute | ✅ | v0.15.0. `supabase/writell-stage-d.sql` |
| Admin tools | ✅ | v0.15.0. Same script |

The old `supabase/schema.sql` is an early draft and is not used.

## Stage 5 — Advanced (v0.3.0)
| Feature | Status | Notes |
|---|---|---|
| Daily / weekly / monthly words, totals, goals, streaks, 30-day chart, year calendar, milestones | ✅ | Optional (Settings → Editor) |
| Writing sprint timer with words-per-minute | ✅ | Editor status bar |
| Project word target + deadline → words per day needed | ✅ | |
| Revision history, restore, **compare any two versions** (word diff) | ✅ | |
| Separate writing / editing modes (Ctrl+E) | ✅ | Revision marks are invisible in writing mode |
| Paragraph comments with replies & resolve; flag "needs revision" / "unfinished" | ✅ | Shared with co-writers in shared projects (0.15.0) |
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
- Family-tree auto-arrange is a simple generational layout; with remarriages across generations you may need to drag a few cards.
- PDF export uses the print dialog; pick “Microsoft Print to PDF”.
- Restoring a backup always creates a **copy** (“… (restored)”), never overwrites. That's deliberate for safety.
- Raw-Markdown mode: underline has no standard Markdown form, so it is written as `<u>text</u>` (which imports back correctly).
- Full-text search in Ctrl+K scans scenes on the fly. That's fine for normal novels.
- The interface scale uses CSS `zoom`, which is supported in Chrome/Edge/WebView2 (all targets).
- The Windows installer is built on Linux (cross-compiled) and is not code-signed, so Windows SmartScreen warns on first install (More info → Run anyway).
- Portraits and note images are stored inside the project (downscaled), so they are included in backups.
