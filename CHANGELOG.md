# Change Log

All notable changes to the "notethink" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
