# Change Log

All notable changes to the "notethink" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
