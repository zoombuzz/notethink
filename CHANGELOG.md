# Change Log

All notable changes to the "notethink" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
