# Change Log

All notable changes to the "notethink" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.4.21] - 2026-11-03

### Changed

- A story's progress pie fills in the colour of the card's project pill and sits on the pill's line at the pill's height, so the two read as a matched pair of dots at the top of each card. The unfilled part stays grey, and a card with no project pill keeps the green pie as before.

## [0.4.20] - 2026-11-03

### Changed

- The agent card's subagents read as a VS Code tree: each agent with subagents has a chevron to expand and collapse them, is expanded while it is working or waiting, and its state-coloured rail runs down the whole group. Every finished subagent sits behind one "Show N finished subagents" item. The rows carry the tree roles and answer Right and Left, and a collapse or expand you chose is kept as the card updates.
- An agent row's header is quieter: the session's name, then the clock, then the model, with the live line (the current command or prompt) on its own line under it. A working or waiting agent no longer repeats "Working" or "Waiting on you" (the rail colour and the story's headline say it, and screen readers still read it), every other state keeps its label, and on a narrow card the model drops out first, then the clock, while the name stays.
- A session transcript over 64 MB is now read from its newest end instead of being refused as too large: the last 64 MB, from a whole line, is analysed, and its row says "newest part only" beside the clock because its usage and time cover only that part. A long-finished oversized session reads as ended like any other, so it no longer keeps a card of its own.

## [0.4.19] - 2026-11-03

### Added

- A story at `doing`, `code-review` or `testing`, or with an agent working on it, shows a small pie beside its headline in the card, sticky and agent card types, labelled "n% complete". The figure is a coordinator's estimate where one is recorded, else the story's `progress` linetag, else its ticked task boxes; hovering names the source, and the pie sweeps to a new value unless reduced motion is on.

- A Claude Code session that launched subagents shows them as a tree in the agent card: each subagent is indented under its session on its own rail, with its model, state, run time, title and tokens, finished ones dim and the earlier ones fold behind a count. The session's row also shows its name.

- An agent registered in the thinkersync agent registry now shows on the board, whatever its vendor. A working coordinator appears on its story's card before it has written anything, an agent NoteThink has no reader for draws as a row with its name, vendor mark, state and story, and a `working` entry that nothing backs up reads Stale. NoteThink only reads the registry, and only for repositories in the open folder.

### Changed

- A coordinator's progress entry for a story counts as its latest activity when a board orders its groups newest first.
- The agent card lists a story's linetags, such as its status and time tags, under the headline, as the ordinary card does.
- An agent card for a session on no story is headed by the vendor's mark and the session's name, such as `CC my-session`, in the vendor's colour, instead of the vendor slug and project.

### Fixed

- A `progress` linetag with no `progress_max` or `progress_unit` beside it no longer breaks the card that shows it.
- An idle agent no longer moves its project's column on a board grouped by project, and an agent session that has ended no longer draws a card.

## [0.4.17] - 2026-10-31

### Fixed

- The published package no longer includes local `.env` files; the release stops if one would be packaged.

## [0.4.16] - 2026-10-30

### Added

- Opt-in audio capture: set **notethink.settings.audio.endpoint** (User settings only, so a workspace cannot redirect audio) and the viewer can record the microphone in 2 s chunks of 16 kHz mono PCM, which the extension sends to that endpoint. With the setting empty, the default, nothing is captured or sent. An optional bearer token is kept in secret storage through **NoteThink: Set Audio Endpoint Token**.
- A recording control in the viewer's header bar: a "Record audio" toggle, a red dot while recording (still under reduced motion), and "Microphone unavailable: {name}" when the microphone is refused. Capture runs only while a dot is showing.
- The control appears only where the viewer's frame can use the microphone. Desktop VS Code does not give webviews the microphone, so it shows no control there; the reason is written to the NoteThink output channel.
- Releases are also published to Open VSX, for VSCodium and other compatible editors.

## [0.2.2] - 2026-05-16

### Changed

- Renamed the custom-editor `viewType` (`notethink.notethink` → `notethink.viewer`) and the command id (`notethink.openview` → `notethink.openViewer`); the command's display label is now **NoteThink: Open Viewer** (all locales). Migration: a markdown file that was pinned open with the previous NoteThink custom editor reopens in the plain text editor once after updating - reopen it via "Open With… → NoteThink" or run **NoteThink: Open Viewer**. No user settings or files are affected.
- Refreshed the extension icon and wordmark (`media/icon.png`, `docstech/design/logos/`).

### Fixed

- README install instructions corrected for the published Marketplace listing: real "From Marketplace" steps (search / `code --install-extension NoteThink.notethink`) replacing the stale "Not yet published" note, version-agnostic `.vsix` filenames, and removal of the obsolete "single file view" / "placeholder icon" known-limitations bullets.

### Removed

- Deleted 20 stale in-place `tsc` artefacts (`client/extension/src/**/*.js` + `.js.map`) that were committed, no longer regenerated, and unused (webpack bundles from `.ts`); added a `.gitignore` rule so they don't return.

## [0.2.1] - 2026-05-15

### Security

- Hardened the webview→extension-host trust boundary: webview-supplied file paths are now validated against the workspace (containment + `.md` check) before any open/edit, `setIntegration` rejects out-of-workspace directories, `openExternal` is restricted to `http`/`https`/`mailto`, and Mermaid `securityLevel` is pinned to `strict`

### Fixed

- Build: added the missing `@types/debug` dev dependency so the extension type-checks in a clean install (CI lint no longer fails on `TS7016`)

### Changed

- `merge-main.sh` now auto-publishes to the VS Code Marketplace on merge to `main` (version-guarded)

## [0.1.60] - 2026-05-15

### Changed

- Marketplace publisher rebranded from `ZoomBuzz` to `NoteThink`; the extension ID is now `NoteThink.notethink`
- Custom editor viewType renamed `zoombuzz.notethink` → `notethink.notethink`
- Homepage now points to https://notethink.com

### Added

- Extension icon for the marketplace listing - final NoteThink logo (`media/icon.png`, 256×256; SVG source `docstech/design/logos/notethink-icon.svg`, drafts in `docstech/design/logos/variants/`)
- `publish:marketplace` npm script - non-interactive `vsce publish` via a puppet-provisioned PAT env var (no `vsce login`)

## [0.1.1] - 2026-02-24

### Fixed

- Second click on a focused note no longer blanks the webview - the view stays intact and the note becomes selected
- Dragging a kanban card no longer opens a duplicate text editor - edits are applied to the existing editor (or silently via WorkspaceEdit if no editor is visible)
- Dragging a kanban card to the "Untagged" column now removes the status tag entirely, instead of writing a literal `status=untagged` value (which caused a duplicated Untagged column)
- Notes starting at document offset 0 now correctly handle click selection (fixed falsy-zero bug with `||` operator)

### Added

- Error boundary component - if a view crashes due to malformed data, a fallback UI is shown with error details instead of a blank webview
- Kanban view: inline editing of linetag values via drag-and-drop now correctly removes tags when returning to default state

## [0.1.0] - 2026-02-18

### Added

- Custom markdown editor that renders `.md` files as structured, interactive note hierarchies
- MDAST-to-NoteProps transformer (`convertMdastToNoteHierarchy`) for converting parsed markdown into nested note structures
- Structured note rendering via `DocumentView` with `GenericNote`, `CodeNote`, and `MarkdownNote` components
- File watching with 250ms debounce for live updates when markdown files change
- GFM support (tables, strikethrough, task lists, footnotes) via `mdast-util-gfm`
- Frontmatter parsing via `mdast-util-frontmatter`
- "NoteThink: Open View" command and "Open With..." context menu integration
- Nonce-based CSP for webview security
- Debug logging via the `debug` library

### Known Limitations

- Read-only: no editing support yet
- No multi-document navigation (single file view only)
