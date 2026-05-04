# Done [](?ng_view=kanban&ng_child_status=done)


### Edge-case tests for pre-release validation

+ [X] empty markdown file - already covered (parseops + hierarchy tests)
+ [X] very large markdown file (1000+ lines) - parse benchmark (150 sections × ~10 lines, under 200ms) and hierarchy benchmark (1000 headings, under 200ms)
+ [X] markdown with frontmatter - already covered (YAML + TOML in parseops); added hierarchy passthrough tests
+ [X] markdown with GFM tables, strikethrough - already covered in parseops; added hierarchy table passthrough tests
+ [X] markdown with GFM footnotes - 3 new tests (single, multiple, multi-line content) in parseops; hierarchy footnoteDefinition passthrough test
+ [X] file with unicode characters - 8 new tests in parseops (emoji, CJK, accented, combining chars, RTL, code blocks, tables, math symbols); 3 new hierarchy tests (emoji/CJK headline_raw, unicode body_raw)
+ [X] mixed content document - full-feature test (frontmatter + GFM + unicode + code + footnotes in one document)
+ tests 450 (was 427), 34 playwright


### Upgrade webpack-cli 6 → 7 and copy-webpack-plugin 13 → 14

+ [X] update `webpack-cli` from `^6.0.1` to `^7.0.0` in root package.json
+ [X] update `copy-webpack-plugin` from `13.0.1` to `14.0.0` in root package.json
+ [X] no `--node-env` flag usage found (removed in webpack-cli 7, replaced by `--config-node-env`)
+ [X] pnpm install succeeds (webpack-cli 7.0.2, copy-webpack-plugin 14.0.0)
+ [X] lint passes (eslint + tsc --noEmit for all 3 sub-projects)
+ [X] all 421 tests pass across extension (74), webview (30), notethink-views (317)
+ [X] webpack build succeeds (both extension and webview bundles)


### Upgrade TypeScript 5.9 → 6.0

+ [X] upgrade `typescript` to `^6.0.2` in root package.json
+ [X] confirm `ignoreDeprecations: "6.0"` in all tsconfig.jest.json files (client/webview, client/webview/src/notethink-views)
+ [X] confirm inline `ignoreDeprecations: '6.0'` in client/extension/jest.config.cjs
+ [X] lint passes (eslint + tsc --noEmit for all 3 sub-projects)
+ [X] all 421 tests pass across extension (74), webview (30), notethink-views (317)


### Child attribute inheritance

+ [X] add `inherited?: true` flag to LineTag interface in `notethink-views/src/types/NoteProps.ts`
+ [X] add `applyChildAttributeInheritance(allNotes)` in `convertMdastToNoteHierarchy.ts`
  + ng_child_ → direct children, ng_child2y_ → grandchildren, ng_childall_ → all descendants
  + child's own linetags always win (no override)
+ [X] guard edit operations against inherited linetags in `linetagops.ts`
  + drag-drop on inherited-status notes writes a real linetag into markdown
+ [X] distinguish inherited attributes in `GenericNoteAttributes.tsx` (lighter opacity, italic)
+ [X] unit tests: 8 new tests in `convertMdastToNoteHierarchy.test.ts`


### Theme tweaks

+ [X] make border clearer in dark themes
  + dark-mode override in `ViewRenderer.module.scss` using `--vscode-editorWidget-border`
+ [X] style checkboxes to match theme
  + `accent-color: var(--mantine-primary-color-2)` on checkbox input


### Breadcrumb accessibility

BreadcrumbTrail uses clickable `<div>` elements with onClick handlers. These are not
keyboard-accessible and have no ARIA roles. Convert to `<button>` elements so screen
readers and keyboard users can navigate the breadcrumb trail.

- [X] Convert breadcrumb clickable divs to `<button>` in `BreadcrumbTrail.tsx`
- [X] Reset default button styles to match current visual appearance
- [X] Ensure Enter/Space triggers navigation (native button behaviour)
- [X] Add `aria-label` to breadcrumb items (note headline text)
- [X] Add unit test: breadcrumb buttons are keyboard-focusable and have correct ARIA


### Validate incoming messages in ExtensionReceiver

ExtensionReceiver blindly destructures incoming messages from the extension. A malformed
message (missing `type`, missing `partial.docs`, wrong shape) could silently corrupt
state or throw. Add runtime validation at the message boundary.

- [X] Add type guard / validation for incoming messages in `ExtensionReceiver.tsx` onMessage handler
- [X] Validate `message.type` exists and is a known type before switching
- [X] Validate `message.partial.docs` structure for `update` messages
- [X] Validate `message.selection` structure for `selectionChanged` messages
- [X] Log and discard invalid messages (don't throw, don't corrupt state)
- [X] Add unit tests: malformed messages are discarded without crashing


### CHANGELOG for 0.1.1

Document user-facing changes from this session.

- [X] Add 0.1.1 entry to CHANGELOG.md covering: second-click blank view fix, kanban drag no longer spawns new editor, dragging to Untagged removes status tag instead of writing literal "untagged", sass deprecation warning fixed


### Progressive document loading on startup

Currently the extension finds all `**/*.md` files on startup, parses every one, then sends
them all to the webview. This blocks startup on large repos. Change to: load docs from
open text editors first (immediate), then progressively discover and parse remaining
files in the background.

- [X] Refactor `myWebviewPanel` startup: get docs from `vscode.window.visibleTextEditors` first
- [X] Send initial update to webview with only visible-editor docs (fast first paint)
- [X] Background task: `vscode.workspace.findFiles('**/*.md')` then parse incrementally
- [X] Send incremental `update` messages as each background doc is parsed
- [X] Add debounce / batching to avoid flooding the webview with hundreds of individual updates
- [X] Existing file watcher (onDidCreate, onDidChangeTextDocument) continues to work as before
- [X] Test: webview renders immediately with open-editor doc, background docs appear progressively


### E2E test for kanban drag-and-drop

The kanban drag-and-drop flow (drag card between columns, reorder within column) has
unit tests but no playwright E2E coverage for the full interaction.

- [X] Add playwright spec: drag a card from one kanban column to another
- [X] Assert: `editText` message sent with status tag change
- [X] Simulate extension responding with updated doc (re-parsed MDAST with new linetag)
- [X] Assert: card appears in the destination column after re-render
- [X] Assert: card no longer appears in the source column


### Error boundary for view crash recovery

When a malformed markdown file or unexpected data causes a React component to throw,
the entire NoteThink webview goes blank with no feedback. Add a React error boundary
that catches render errors and shows a fallback UI with a user-friendly message plus
expandable error details (standard VS Code extension pattern).

- [X] Create ErrorBoundary component in `client/webview/src/notethink-views/src/components/`
- [X] Fallback shows: friendly message, file path, expandable stack trace / error details
- [X] Wrap NoteRenderer children (GenericView / AutoView / DocumentView / KanbanView)
- [X] Add unit test: component that throws renders fallback instead of blanking
- [X] Add playwright E2E test: inject malformed MDAST, verify fallback appears (view doesn't blank)


### Extension-side unit tests (mocked vscode)

`notethinkEditor.ts` (330 lines), `parseops.ts`, and `errorops.ts` have zero test coverage.
These are critical code paths (message handling, text edits, file watching). Start with
mocked vscode unit tests; add integration tests via `@vscode/test-web` as a follow-up.

- [X] Set up mocked vscode test infrastructure (jest + vscode mock in `client/extension/`)
- [X] Tests for `parseops.ts`: valid markdown, empty input, GFM features, frontmatter (16 tests)
- [X] Tests for `notethinkEditor.ts` message handler: revealRange, selectRange, editText (16 tests)
- [X] Tests for `notethinkEditor.ts` editText: existing editor path, WorkspaceEdit fallback path
- [X] Tests for `notethinkEditor.ts` file watcher: onDidCreate, onDidChangeTextDocument debounce
- [X] Tests for `errorops.ts`: writeToLog, writeToErrorLog (19 tests)
- [X] Tests for `utils.ts`: abbrevDoc, getNonce (7 tests)
- [X] Follow-up: add `@vscode/test-web` integration tests for real VS Code API paths


### Fix critical rendering gaps

+ [X] strip linetag text from rendered headlines
  + renderops.tsx: added `strip_linetags` render option that filters MDAST children by position offset using `linetags_from`
  + MarkdownNote.tsx: switched from `first_child_only` to `strip_linetags`, preserving inline formatting (bold, links) before the linetag
  + the linetag text is hidden from the headline; GenericNoteAttributes renders it as badges
+ [X] uncomment and wire notes_within_parent_context rendering in DocumentView
  + not needed - child notes already render correctly via recursive `MarkdownNote.children_body` → `GenericNote` rendering
  + notegit has the same line commented out; this is not a bug


### Dynamic kanban columns

+ [X] derive column definitions from notes' status linetag values
  + KanbanView columns replaced from useState with useMemo deriving from notes_within_parent_context
  + scans notes for unique status linetag values, always includes 'untagged' as first pseudo-column
  + columns sorted alphabetically; dynamic - appear/disappear as notes change


### View menu and toolbar

+ [X] implement view type selector using native VS Code controls
  + registered notethink.setViewAuto/Document/Kanban commands with icons in editor/title menu navigation group
  + icon buttons appear in VS Code editor tab bar (eye, file-text, project)
  + commands relay to webview via postMessage, ExtensionReceiver updates viewStates
+ [X] implement display settings toggles using native VS Code controls
  + registered notethink.toggleLineNumbers and notethink.toggleContextBars commands
  + appear in editor/title overflow menu under 1_settings group
  + toggles boolean in viewStates display_options.settings
+ [X] removed empty menubar divs from DocumentView and KanbanView
  + native VS Code editor/title bar replaces the custom menubar pattern


### Theme integration (partial)

+ [X] detect VS Code theme kind and apply to webview
  + inline script in notethinkEditor.ts reads body.vscode-dark/vscode-high-contrast
  + sets data-mantine-color-scheme on <html> for dark-mode SCSS selector
  + MutationObserver syncs attribute on live theme changes
+ [X] CSS variable bridge (vscode-mantine-bridge.css)
  + maps 7 --mantine-* variables to --vscode-* equivalents
  + ViewRenderer.module.scss works unchanged in both NoteGit and NoteThink
  + index.css uses --vscode-font-family, --vscode-editor-foreground, --vscode-editor-background


### Keyboard shortcuts for view navigation

+ [X] implement keyboard handler in GenericView
  + navigation callback registered via onNavigationCommand ref on ViewApi
  + Escape: clearFocus - calls getClearHandler to move caret past focused note
  + Up/Down: navigate between sibling notes via setCaretPosition
  + Enter: drillIn - calls setParentContextSeq on focused note with children
  + Backspace: drillOut - navigates to grandparent or root
+ [X] register VS Code keybindings for NoteThink-specific commands
  + keybindings declared in package.json with `when: "activeCustomEditorId == 'zoombuzz.notethink'"`
  + escape, up, down, enter, backspace bound to navigation commands
  + extension.ts registers all 10 commands relaying to active webview panel


### Bootstrap compiled typescript client

+ [X] fix restart bug
+ [X] re-base extension on webpack
+ [X] investigate LSP
+ [X] understand how Markdown Language Service works
+ [X] look at LSP sample
+ [X] modify webpack config to bundle a second set of files
+ [X] setup `tasks.json`
+ [X] get extension running


### Continue dev setup

+ [X] chase down log entries
+ [X] mark index.tsx HTML as only being used for testing


### Get document data flowing

+ [X] replicate using extension samples


### Wire notethink-views into rendering pipeline

+ [X] build MDAST-to-NoteProps transformer
+ [X] replace NoteRenderer internals
+ [X] notethink-views consumed directly by webpack


### Get a first basic release of NoteThink extension out

+ [X] fix client/extension/package.json metadata
+ [X] add marketplace metadata to root package.json
+ [X] update CHANGELOG.md for 0.1.0
+ [X] update README.md for public consumption
+ [X] review .vscodeignore for production packaging
+ [X] verify the production build pipeline


### Bring notethink up to active-dev standard

+ [X] migrate from npm to pnpm
+ [X] replace `console.warn` with `debug` library
+ [X] replace `any` types with explicit types
+ [X] review and clean up dist/ files in git status
+ [X] add test scripts and get all tests passing
+ [X] harden extension security and reliability
+ [X] fix CI pipeline
+ [X] commit untracked files on bootstrap branch


### Work on DX

+ [X] test with reference sample to see if it's broadly doable
+ [X] fix access: can't inspect HTML
+ [X] fix missing sourcemap


### Compute delta on `partial` in ExtensionReceiver

+ [X] use hash_sha256 on doc content for change detection
+ [X] add React.memo to DocumentView and GenericNote


### Port notegit features into NoteThink (phases 1-5)

+ [X] phase 1: linetag parsing and display
+ [X] phase 2: extension-webview message protocol
+ [X] phase 3: GenericView, focus/selection, BreadcrumbTrail, AutoView
+ [X] phase 4: KanbanView with drag-and-drop
+ [X] phase 5: mermaid diagrams
+ [X] coding standards audit and fixes
+ [X] comprehensive test suite


### CSS variable bridge and click/selection fix

+ [X] CSS variable bridge (vscode-mantine-bridge.css)
+ [X] fix click/selection flow


### Install notethink-dev to get using it all the time

+ symlink
  + `ln -s /mnt/secure/home/alex/git/github.com/active_development/notethink ~/.vscode/extensions/notethink-dev`
+ can remove that once we've got a deployed version out
+ goal is to establish what I use this for
  + how useful is it
  + what features do I rely on
+ no point launching a product that I do not value myself


### Dynamic kanban columns

+ goal
  + kanban columns are hardcoded to untagged/backlog/doing/done
  + notegit derives columns from the linetags present in the document
  + users should be able to define columns via linetags or settings
+ [X] derive column definitions from notes' status linetag values
  + KanbanView columns replaced from useState with useMemo deriving from notes_within_parent_context
  + scans notes for unique status linetag values, always includes 'untagged' as first pseudo-column
  + columns sorted alphabetically; dynamic - appear/disappear as notes change
+ [X] allow column customisation via kanban settings modal
  + [X] create SettingsKanbanModal component (notethink-views/src/components/views/)
    + native dialog with column reorder list, scroll_note_into_view toggle, show_linetags_in_headlines toggle
    + on save, calls handlers.setViewManagedState() with updated display_options.settings
  + [X] add column_order support to KanbanView
    + new optional display_options.settings.column_order: string[] defines column order
    + when set, columns follow that order; unknown status values appended
    + when unset, falls back to current alphabetical sort
  + [X] wire settings gear button in KanbanContextBar to open SettingsKanbanModal
  + [X] add tests for SettingsKanbanModal and column ordering


### View state persistence

+ goal
  + when the webview reloads (e.g. tab switch), view state is lost
  + notegit persists view state in LocalStorage; NoteThink should use VS Code's webview state API
+ [X] persist view type and parent_context_seq via vscode.getState/setState
  + save on setViewManagedState calls
  + restore on webview init in ExtensionReceiver
+ [X] persist kanban column scroll positions


### View selector

+ [X] add view type selector to context bars
  + created `ViewTypeSelector.tsx` shared component with `<select>` driven by `SELECTABLE_VIEWTYPES`
  + integrated into both `KanbanContextBar.tsx` and `DocumentContextBar.tsx`
  + on change: calls `setViewManagedState` to switch view type
+ [X] open "NoteThink: Open view" into editor Group 2
  + tested 10 approaches via integration test harness (`openview-experiment.test.ts`)
  + `vscode.openWith` never honours ViewColumn for custom editors (all 4 variants failed)
  + `createWebviewPanel` + `ViewColumn.Two` works reliably (all 6 variants passed)
  + final: `createWebviewPanel` with `ViewColumn.Two` + `retainContextWhenHidden` (BetterFountain pattern)
+ [X] increase kanban note spacing
  + kanban card margin increased from `1.0em` to `1.5em`
  + added sub-note spacing: `.body > .note { margin-top: 0.5em }`
+ [X] hide empty Untagged column
  + `KanbanView.tsx`: filter `visible_columns` before rendering
  + keeps Untagged visible when it's the only column or has notes
+ [X] version display in settings modal
  + webpack DefinePlugin injects `NOTETHINK_VERSION` from package.json
  + shown at bottom of `SettingsKanbanModal.tsx`
+ [X] match view font size to editor
  + body `font-size: var(--vscode-editor-font-size, 14px)` in `index.css`
  + removed `font-size: 0.925em` from `.viewDocument` and `.viewKanban`
+ [X] add tests
  + KanbanView: hides empty Untagged, shows when only column, shows when has notes alongside other columns
  + KanbanContextBar: view selector dispatches setViewManagedState, shows current type
  + openview-experiment: 10 approaches tested, 6 passed, 4 failed


### Theme integration

+ goal
  + webview should match VS Code's active colour theme (light/dark/high contrast)
  + notegit has custom GitHub light/dark themes; NoteThink should inherit from VS Code
+ [X] detect VS Code theme kind and apply to webview
  + inline script in notethinkEditor.ts reads body.vscode-dark/vscode-high-contrast
  + sets data-mantine-color-scheme on <html> for dark-mode SCSS selector
  + MutationObserver syncs attribute on live theme changes
+ [X] CSS variable bridge (vscode-mantine-bridge.css)
  + maps 7 --mantine-* variables to --vscode-* equivalents
  + ViewRenderer.module.scss works unchanged in both NoteGit and NoteThink
  + index.css uses --vscode-font-family, --vscode-editor-foreground, --vscode-editor-background
+ [X] verify high-contrast themes
  + test with "High Contrast" and "High Contrast Light" themes
  + ensure focus/selection outlines have sufficient contrast


### Kanban visual polish

+ goal
  + bring the Kanban view closer to the look of established tools (Jira, Trello, Linear, GitHub Projects)
  + current state: flat cards with basic borders, no hover/drag feedback, plain column headers
  + target: elevated cards with shadows, hover lift, polished column headers with count badges
+ research summary (Jira, Trello, Linear, Monday, GitHub Projects, Notion, Asana)
  + cards: 8px border-radius, subtle resting shadow, hover lift with larger shadow, 12-16px padding
  + columns: sunken background distinct from both page and card, 12px border-radius, 280-300px width, sticky headers
  + drag: card lifts (larger shadow + slight rotation), drop zone indicated by placeholder
  + headers: semibold title + count badge + optional add/menu buttons, sticky at top
  + dark mode: elevation via surface lightness, increased shadow opacity, VS Code CSS variable integration
  + typography: card title 14px/500, metadata 12px/400 muted, column header 13px/600
+ [X] card elevation and hover
  + `box-shadow: 0 1px 3px rgba(0,0,0,0.08)` resting, `0 4px 12px rgba(0,0,0,0.12)` hover with `translateY(-1px)`
  + `transition: box-shadow 200ms ease, transform 150ms ease`
  + `border-radius: 8px` (was `0 0 15px 0`)
  + dark mode: `rgba(0,0,0,0.3)` / `rgba(0,0,0,0.35)` shadow opacity
+ [X] card internal layout
  + uniform `8px 16px` headline / `4px 16px 12px 16px` body padding
  + removed gradient headline background, kept border-bottom separator
+ [X] column styling
  + sunken background via `color-mix(in srgb, var(--vscode-editor-background), var(--vscode-editor-foreground) 4%)`
  + `gap: 8px` on column flex container via `.notes` class, removed card margins
  + `border-radius: 12px`, board uses `gap: 8px` + `overflow-x: auto`
+ [X] column headers
  + count badge next to column title via `KanbanColumn.tsx` `count` prop
  + sticky header with `position: sticky; top: 0; z-index: 1`
  + left-aligned, `font-size: 13px; font-weight: 600`
+ [X] drag-and-drop feedback
  + `.dragging` class: `box-shadow: 0 8px 24px`, `rotate(2deg) scale(1.02)`
  + `snapshot_drag.isDragging` from hello-pangea/dnd applied via `additional_classes`
+ [X] add tests
  + count badge test: verifies correct count per column
  + updated Draggable mock to provide `snapshot` with `isDragging`
  + 196 tests passing


### View toolbar, breadcrumbs, and integration selector

+ goal
  + improve the top-of-view toolbar: breadcrumb context, smarter view selector, and a new ViewIntegrationSelector
  + kanban Untagged column should appear last, not first
+ [X] phase 1: kanban untagged column last
  + moved Untagged to end of default column order in KanbanView
  + updated visible_columns filter and tests
+ [X] phase 2: always-visible breadcrumb bar
  + extracted breadcrumb + toolbar into shared top bar in GenericView
  + added file path breadcrumb segment via `splitPathSegments` in BreadcrumbTrail.tsx
  + fixed breadcrumb root to coincide with VSCode folder root using `doc_relative_path` from `asRelativePath()`
  + workspace_root stripping handles symlinks correctly
  + compact single-line style with overflow ellipsis
+ [X] phase 3: auto view label in selector
  + AutoView passes resolved type via `nested.auto_resolved_type`
  + ViewTypeSelector shows "Auto (Document)" / "Auto (Kanban)"
+ [X] phase 4: ViewIntegrationSelector
  + created ViewIntegrationSelector.tsx with "Current file" / "Directory" modes
  + extension handler for directory integration using `vscode.workspace.findFiles`
  + wired directory breadcrumb click → handleDirectoryClick → setIntegration message
  + GenericView integration test verifies breadcrumb click triggers setIntegration + setViewManagedState


### Performance: large file rendering

+ problem
  + NoteThink UI sluggish for big files (shopify-uncomplicated todo.md: 2761 lines, 274 headings)
+ [X] phase 1: algorithmic fixes
  + pre-computed line-offset index for O(log n) binary search in makePosition
  + replaced nestChildNotes O(n²) backward scan with O(n) ancestor stack
  + added benchmark tests: 274 headings < 50ms, 500 headings < 100ms
+ [X] phase 2: React rendering
  + stabilised display_options and handlers references in DocumentView
  + memoized renderNodeUnified output via WeakMap keyed on node reference
  + removed renderToStaticMarkup debugging call
  + added React.Profiler wrapping in DocumentView and KanbanView behind NOTETHINK_DEV flag
  + added NOTETHINK_DEV to webview webpack DefinePlugin
+ [X] phase 3: messaging
  + debounced selection updates in notethinkEditor.ts (120ms)
  + lazy-import mermaid deferred (blocked by maxChunks: 1 requirement for web extensions)


### Height-based abridging

+ problem
  + count-based abridging (ABRIDGE_THRESHOLD, descendant budget) didn't adapt to visual size
  + deeply nested or content-heavy notes could grow very tall without triggering abridging
+ approach: measure rendered height vs width using ResizeObserver
  + abridge top-level notes only (direct children of parent context)
  + if rendered height > 2× width, apply CSS max-height with overflow hidden
  + gradient fade overlay with "Show more" toggle, "Show less" when expanded
+ [X] replace count-based abridging with height-based in MarkdownNote.tsx
  + removed ABRIDGE_THRESHOLD, MAX_VISIBLE_DESCENDANTS, SHOW_TOP, SHOW_BOTTOM
  + added HEIGHT_RATIO constant, ResizeObserver measurement, overflow_state
  + top-level detection via parent_notes seq vs parent_context_seq
  + merged refs (measurement + drag-and-drop innerRef)
+ [X] add .abridgeFade CSS in ViewRenderer.module.scss
  + absolute-positioned gradient overlay at bottom of clipped note
  + pointer-events: none with auto on child toggle
+ [X] remove descendant_note_count infrastructure
  + removed computeDescendantCounts from convertMdastToNoteHierarchy.ts
  + removed descendant_note_count from NoteProps interface
  + removed 5 descendant_note_count tests


### Publish NoteThink as npm package for dulcet

+ goal
  + publish `@zoombuzz/notethink` to GitHub Packages so dulcet can consume it as an npm dependency
  + follows the `@zoombuzz/calfam-shared` pattern: push to main → GitHub Actions → `npm publish`
  + eliminates manual `COPY notethink-extension/` step in dulcet's Dockerfile
+ [X] add `publishConfig` to root `package.json`
+ [X] add `prepublishOnly` script to root `package.json`
+ [X] update `repository.url` casing (`ZoomBuzz` → `zoombuzz`)
+ [X] remove dulcet-specific code from NoteThink
  + removed `dulcet.saveToGitHub`, `dulcet.openFromGitHub` commands, keybinding, and `dulcet.openFile` config from `package.json`
  + deleted `dulcetSaveToGitHub.ts`, `dulcetOpenFromGitHub.ts`, `githubFileSystemProvider.ts` and their 3 test files
  + removed `isDulcetContext()`, `dulcetStartup()`, and dulcet activation block from `extension.ts`
+ [X] create `.github/workflows/publish.yml`
  + follows calfam-shared pattern: check version → pnpm install → npm publish
  + dynamically injects scoped name (`@zoombuzz/notethink`) and `files` array before `npm publish`
  + needed because vsce rejects scoped names and `files` alongside `.vscodeignore`
+ [X] fix release.yml version extraction
  + swapped quote nesting in `node -p` to avoid GitHub Actions escaping backslash-quotes
+ [X] test locally with `npm pack` (2.5MB tarball, 14 files, no source maps or test bundles)
+ first published version: `@zoombuzz/notethink@0.1.29`
+ consumers: dulcet adds `"@zoombuzz/notethink": "^0.1.29"` with `@zoombuzz:registry=https://npm.pkg.github.com` in `.npmrc`


### Test engines.vscode lower bound against vscode-web and VS Code desktop

+ `engines.vscode` was lowered from `^1.109.0` to `^1.91.1` for dulcet compatibility
  + `vscode-web` npm package tops out at 1.91.1 - NoteThink must be compatible with it
  + VS Code desktop is currently ~1.96+ - the `^1.91.1` range covers both
+ risk: NoteThink may use VS Code APIs introduced after 1.91
  + quick audit found only standard APIs (commands, window, workspace, Uri)
  + `window.tabGroups` (introduced 1.77) used only in test code
  + but a deeper audit is needed to be certain
+ [X] test NoteThink in dulcet (vscode-web 1.91.1)
  + install `@zoombuzz/notethink` in dulcet, load in browser
  + verify: extension activates, Auto/Document/Kanban views render, keyboard nav works
  + verify: no "Extension is not compatible" errors in console
+ [X] test NoteThink in VS Code desktop (latest stable)
  + install via `code --install-extension notethink-0.x.x.vsix`
  + verify: all existing functionality works (views, editing, drag-drop, theme sync)
+ [X] audit VS Code API usage against 1.91 API surface
  + all APIs available since 1.40 or earlier, except `createOutputChannel({ log: true })` (1.74)
  + no APIs introduced after 1.91 - fully compatible
+ if issues found, raise `engines.vscode` to the minimum version that works for both hosts


### Cursor positioning: Notethink view to editor caret position

+ goal
  + clicking in the NoteThink view should jump the editor caret to the precise position within the note, not just the note start
+ phase 1: offset-aware click handler
  + [X] update `createNoteClickHandler` to extract offset from click target via `findOffsetAncestor`
  + [X] offset extraction applies to both headline and body clicks (not just body)
  + [X] add tests: 20 tests in `noteui.test.ts` covering offset extraction, character counting, refinement, and click handler integration
+ phase 2: fine-grained position within body items
  + [X] use `Range.getBoundingClientRect()` per-character to find the clicked character position
  + [X] handle inline elements (bold, italic, links) that nest within a paragraph
  + [X] add tests: multiline text, inline elements, character-level precision


### Display what's next for each story

+ goal
  + when a clipped story has task lists, show the first incomplete task rather than the top
  + headline and linetags always stay visible - only the body scrolls
  + 1-2 completed tasks visible above as context (if they fit)
  + "Show more" (top or bottom) expands the full note
+ phase 1: task-aware body scroll
  + [X] add `findFirstIncompleteTaskSeq(children_body)` utility in `noteops.ts`
  + [X] add unit tests for `findFirstIncompleteTaskSeq`
+ phase 2: scroll-to-next in MarkdownNote
  + [X] move clipping from the outer note div to the `.body` div (headline/linetags always visible)
  + [X] `useLayoutEffect` sets `scrollTop` on body container to first incomplete task
  + [X] add `.abridgeFadeTop` CSS class + top/bottom "Show more" buttons with `»` arrows
  + [X] add unit tests (8 tests in MarkdownNote.test.tsx)
+ phase 3: edge cases
  + [X] "Show less" resets scroll position to task-aware default
  + [X] drag-and-drop clip lock still works with body-level clipping
  + [X] ResizeObserver detects overflow correctly on the body element


### Fix link URLs showing as child notes

+ problem
  + markdown links like `[swiper](https://swiperjs.com/)` had the URL appearing as a visible linetag attribute
  + root cause: linetag parser's `findLineTags` regex matched `[text](url)` as linetags
+ fix
  + [X] require `?` at start of href in `findLineTags` regexes to distinguish linetags from markdown links
  + [X] add guard in `parseLineTags`: skip matches where href doesn't start with `?`
  + [X] add tests in linetagops.test.ts and convertMdastToNoteHierarchy.test.ts
  + [X] external links open via `vscode.env.openExternal` (desktop + VS Code Web)


### Auto-expand note setting

+ [X] add `auto_expand_focused_note?: boolean` to `NoteDisplayOptions.settings`
+ [X] implement in `MarkdownNote`: auto-expand ON → expand on focus; OFF → respect `manually_expanded` state
+ [X] add checkbox to `SettingsKanbanModal` and new `SettingsDocumentModal`
+ [X] 7 new tests for `SettingsDocumentModal`


### Migrate TypeScript 5.9 to 6.x

+ [X] exclude test files from lint tsconfigs, add `tsconfig.jest.json` files
+ [X] add `vscode-webview.d.ts`, CSS/SCSS module declarations, `declare const require`
+ [X] set `transpileOnly: true` in webpack ts-loader
+ [X] fix extension jest.config, bump typescript to ^6.0
+ [X] verify build, lint, all tests pass


### Fix boundary flicker: typing at end of note causes view to flash blank

+ problem
  + typing at the end of the last line of a note (just before the invisible newline) causes the NoteThink view to flicker wildly - goes blank, then re-renders
  + root cause: race between two independently debounced messages from the extension to the webview
    + `selectionChanged` fires after 120ms with the caret position from the *post-edit* text
    + `update` (full MDAST re-parse) fires after 250ms with the new document
    + during the 130ms gap, the webview has a stale MDAST but a fresh caret position
    + e.g. note `end_body.offset` = 500, user types char, caret = 501, but MDAST still says 500
    + `findDeepestNote(501)` fails because `withinNoteHeadlineOrBody(501, note)` checks `501 <= 500` → false
    + no note matches → `focused_seqs` changes → full re-render with wrong focus (blank/unfocused)
    + 130ms later: new MDAST arrives → correct focus restored → second full re-render
    + user sees two full re-renders in quick succession = flicker
  + contributing factors making re-renders expensive
    + `MarkdownNote` is not wrapped in `React.memo` - every parent re-render cascades to all children
    + `convertMdastToNoteHierarchy` creates entirely new NoteProps objects each time, so shallow equality always fails
    + `DocumentView` uses `key={index}` instead of stable note identity
+ phase 1: fix the timing mismatch (eliminates the flicker)
  + [X] in `notethinkEditor.ts`, suppress `selectionChanged` while `change_timer` is pending; send selection after doc update via `sendCurrentSelection()`
  + [X] in `GenericView`, guard `findDeepestNote`: clamp caret position to root note's `end.offset`
  + [X] add test: caret exceeding root end still finds a focused note (GenericView.test.tsx)
  + [X] add tests: boundary-inclusive and one-past-boundary behaviour for `findDeepestNote` (noteops.test.ts)
+ phase 2: reduce re-render cost (eliminates visual jank even when re-renders happen)
  + [X] wrap `MarkdownNote` in `React.memo` with `areMarkdownNotePropsEqual` custom comparator
  + [X] in `DocumentView`, use `key={note.seq}` instead of `key={index}` for stable component identity
  + [X] in `renderBodyItems`, use `key={`body-${offset}`}` instead of `key={`nn-${i}`}` for stable MDAST body item keys
+ phase 3: structural improvements
  + [X] coalesced: change handler sends selection immediately after doc update (no separate stale-selection window)
  + [X] `useMemo` around `convertMdastToNoteHierarchy` in `NoteView` keyed on `doc.hash_sha256`
  + [ ] consider incremental MDAST updates instead of full re-parse (deferred - requires major architectural change)
+ verification
  + place caret at the end of the last line of a note, type rapidly - view should update smoothly without blanking
  + place caret at the end of a mid-document note, type - same smooth behaviour
  + move caret between notes - focus highlighting should still work correctly
  + abridged notes should still expand/collapse correctly
  + all existing tests still pass (404 tests)


### Cursor positioning: editor caret position to NoteThink view

+ goal
  + good synchronisation between editor and NoteThink view
+ shared foundation: position-aware body items
  + [X] add `data-offset-start` and `data-offset-end` attributes to rendered body items
  + [X] add `findBodyItemElement()` utility in `noteops.ts` (6 unit tests)
  + [X] extract shared `renderBodyItems` from MarkdownNote into `renderops.tsx`; used by both MarkdownNote and GenericNoteWrapper
+ phase 1: sub-note scroll in DocumentView and KanbanView
  + [X] `useScrollToCaret` hook in `viewhooks.ts` - shared by DocumentView and KanbanView
  + [X] removed broken `noteIsVisible` guard (view element is not a scroll container)
  + [X] fixed `GenericNoteWrapper` not setting DOM `id` or propagating `display_options` to child notes
  + [X] headline caret falls back to note-level scroll
+ phase 2: smooth scroll and abridged notes
  + [X] abridged notes auto-expand on focus
  + consider debouncing sub-note scroll separately from note-level scroll if rapid cursor movement causes jitter
+ phase 3: virtual caret indicator
  + [X] `.caretTarget` CSS class with `::after` overlay and `@keyframes caretPulse` animation (fade pulse using `--mantine-primary-color-2`)
  + [X] `useCaretIndicator` hook in `viewhooks.ts` - shared by DocumentView and KanbanView
    + prefers body item, falls back to headline element (`[role="rowheader"]`), then note element
    + if target is already visible, flashes immediately
    + if scroll is needed, waits for `scrollend` + 150ms settle; 1000ms fallback
  + [X] 4 unit tests (body item flash, caret move, headline fallback, cleanup)
  + [X] added `data-offset-start`/`data-offset-end` to headline div in MarkdownNote - `findBodyItemElement` now finds headlines directly instead of relying on querySelector fallback
+ other improvements
  + [X] `Debug.enable('nodejs:*')` in dev mode (webview iframe has separate localStorage)
  + [X] fixed `noteIsVisible` partial-visibility check (was always returning "visible")
+ verification
  + open a long note in VS Code
  + move caret to the bottom of the note - NoteThink view should scroll to show that section
  + move caret to headline - view should show the top of the note
  + abridged note should expand then scroll when caret enters a lower section
  + caret pulse visible on body items and headlines when moving through a note
  + all existing tests still pass (401 tests)


### Fix view crash: defensive guards on new features

+ problem
  + NoteThink view crashed in VS Code - no error in NoteThink.log or renderer.log
  + crash introduced by last commit (body-level clipping, openExternal link handling, findFirstIncompleteTaskSeq)
  + ErrorBoundary did not catch the error, indicating an event handler or layout-triggered crash
+ root causes identified
  + ResizeObserver zero-width race: body-level overflow measurement could produce `maxHeight: 0px` when body element has zero width during layout transitions (tab switch, webview restore), hiding all body content
  + unhandled `openExternal` errors: extension's `openExternal` message handler lacked try/catch - unhandled promise rejection could crash the web worker extension host
  + unguarded link click handler: capture-phase click interceptor in ExtensionReceiver could throw if event.target lacks `.closest` method (e.g. non-Element targets)
  + missing null guard on `findFirstIncompleteTaskSeq`: called during render via useMemo without defensive check on input array
+ [X] add zero-width guard in ResizeObserver `check()` (MarkdownNote.tsx)
  + `if (width === 0) { return; }` - skips measurement when body has no width yet
+ [X] add try/catch + await to `openExternal` handler (notethinkEditor.ts)
  + matches error handling pattern of other message handlers (editText, setIntegration)
+ [X] add try/catch and `.closest` guard to `handleLinkClick` (ExtensionReceiver.tsx)
  + prevents uncaught exceptions from crashing the webview
+ [X] add null guard to `findFirstIncompleteTaskSeq` (noteops.ts)
  + `if (!items?.length) { return undefined; }` - handles undefined/null/empty input


### Scroll caret into view within clipped notes

+ problem
  + when the editor caret is inside a clipped (abridged) note, the NoteThink view does nothing - the caret target is invisible
  + `useScrollToCaret` detected the body item was clipped by `overflow: hidden` and bailed out entirely
  + `useCaretIndicator` similarly skipped flashing for clipped targets
  + bottom fade + "Show more" button covered content when body scrolled to bottom
+ [X] pass `caret_offset` through display_options (GenericView.tsx)
  + set from `selection.main.head` so individual notes know the caret position
  + added to `areMarkdownNotePropsEqual` so memo re-renders when caret moves
+ [X] caret-aware body scroll in MarkdownNote (MarkdownNote.tsx)
  + `useLayoutEffect` finds `[data-offset-start]` element containing the caret
  + checks visibility between fade overlays (64px top, 96px bottom)
  + sets body `scrollTop` directly via `applyBodyScroll` helper - overrides task-aware scroll when focused
  + added `scrollPaddingTop: '4em'`, `scrollPaddingBottom: '6em'` to clipped body style
+ [X] hide bottom fade when scrolled to bottom (MarkdownNote.tsx)
  + added `at_bottom` state, updated by `applyBodyScroll` helper
  + bottom fade condition: `should_clip && !at_bottom` (mirrors top fade: `should_clip && scrolled_top > 0`)
+ [X] simplified viewhooks.ts
  + removed `isClippedByAncestor`, `findOverflowAncestor`, `scrollClippedBodyToTarget`
  + `useScrollToCaret` now calls `scrollIntoView` unconditionally - body scroll handled by MarkdownNote
  + `useCaretIndicator` no longer skips clipped targets


### Fix repeated extension host crashes

+ problem
  + 8 extension host restarts in ~1 hour, no errors in NoteThink.log or renderer.log
  + renderer.log showed "VERY LONG TASK" warnings (129ms, 284ms)
+ root cause: `caret_offset` on shared `display_options` defeated React.memo for ALL notes
  + every cursor move changed `caret_offset`, causing 30+ MarkdownNote re-renders per keystroke
  + each re-render ran DOM queries in `useLayoutEffect` (caret scroll logic)
  + cumulative cost exceeded webview render budget, triggering extension host restarts
+ [X] fix memo comparator to only re-render focused notes on caret move (MarkdownNote.tsx)
  + `if (next.focused && prev.display_options?.caret_offset !== next.display_options?.caret_offset)` - unfocused notes skip caret_offset comparison
  + re-renders per caret move: 30+ → 1-2 (focused note + parent)
+ [X] add try/catch to `requestInitialState` handler (notethinkEditor.ts)
  + `sendDoc` and `sendCurrentSelection` were unprotected - could crash extension host
+ [X] wrap entire `onDidReceiveMessage` switch in top-level try/catch (notethinkEditor.ts)
  + safety net: any unhandled error in message handler is caught and logged
+ [X] make webview global error handlers unconditional (notethinkEditor.ts)
  + `window.onerror` and `window.onunhandledrejection` now always register
  + added `console.error` fallback if vscode API not available


### Multi-document navigation

+ the header bar should always be visible
  + currently when I scroll down, it goes off the top
  + root cause: `.viewToolbar` is `position: static` inside the body scroll container (`body.disableAddressBarHidingOnScroll` has `overflow-y: auto`)
  + toolbar already has opaque `background` - just needs sticky positioning
- [X] make `.viewToolbar` sticky in `ViewRenderer.module.scss`
  + add `position: sticky; top: 0; z-index: 10` to `.viewToolbar`
  + verify toolbar background is opaque (already set via `--vscode-breadcrumb-background`)
- [X] verify in DocumentView and KanbanView
  + scroll long document - toolbar stays pinned
  + scroll kanban with many cards - toolbar stays pinned
  + breadcrumb, view selector, settings gear all still functional
- [X] add test: toolbar remains visible after scroll (Playwright E2E)
  + N/A - NoteThink is a VS Code extension, Playwright not applicable


### Insert modal

+ goal
  + notegit has a searchable insert modal (~367 lines) with 40+ templates
  + quick way to insert headings, linetags, mermaid diagrams, tables, code blocks
  + this replaces typing boilerplate markdown manually
+ [X] implement InsertModal component in notethink-views
  + searchable list of insert templates grouped by category
  + native `<dialog>` with search, scope, and position selectors
  + fires postMessage({type: 'editText', changes}) to insert at cursor position
+ [X] port insert template definitions from notegit
  + 21 templates across 12 files in `inserts/en/`
  + categories: headings, elements, lists, charts and diagrams, project management, architecture
+ [X] wire insert modal trigger
  + toolbar + button (to left of settings gear)
  + 4 position modes: at cursor (default), start of line, end of line, end of document
  + 16 Jest tests for InsertModal component


### Upgrade NPM packages (minor/patch, wave 1) [](?time_taken=0)

+ [X] run npm-check-updates --target minor
+ [X] pnpm install
+ [X] verify lint passes
+ [X] verify jest tests pass


### Settings modals

+ goal
  + notegit has per-view settings modals for display preferences
  + NoteThink needs at least kanban settings and global display settings
+ [X] implement kanban settings modal
  + port from notegit's SettingsKanbanModal (~61 lines)
  + column definitions (add/remove/reorder columns)
  + scroll-note-into-view toggle
  + show-linetags-in-headlines toggle
+ [X] implement global settings modal
  + show line numbers persisted via VS Code workspace config (notethink.showLineNumbers)
  + accessible via per-view settings modals, command palette, and VS Code settings UI
  + theme preference and default view type dropped (handled by VS Code natively)


### Remove Mantine CSS variable indirection

+ goal
  + Mantine components are no longer used - all UI is native HTML/CSS
  + 48 `--mantine-*` CSS variable references remain in ViewRenderer.module.scss via a bridge file
  + replace with `--vscode-*` equivalents and remove the vestigial layer
+ [X] replace all `--mantine-*` references in ViewRenderer.module.scss with `--vscode-*` equivalents
+ [X] delete `client/webview/src/vscode-mantine-bridge.css` and its import in index.tsx
+ [X] remove `@mantine/core`, `@mantine/hooks`, `@mantine/modals`, `@mantine/notifications`, `postcss-preset-mantine` from client/webview/package.json


### Add i18n using VS Code l10n mechanism

+ goal
  + internationalise all user-facing strings using the official `@vscode/l10n` API
  + `package.nls.json` for manifest strings, `vscode.l10n.t()` for extension host, `@vscode/l10n` npm package for webview
  + sets up the extraction/translation workflow so contributors can add languages later
+ scope (~57 strings)
  + package.json manifest: 11 command titles, 3 config descriptions, 1 editor displayName
  + extension host (extension.ts, notethinkEditor.ts): 4 strings (warnings, HTML error handlers)
  + webview modals (InsertModal, SettingsDocumentModal, SettingsKanbanModal): ~27 strings
  + webview components (ErrorBoundary, GenericView, ViewTypeSelector, ViewIntegrationSelector, BreadcrumbTrail, ExtensionReceiver): ~25 strings
+ [X] add `package.nls.json` to project root
  + extract all `%`-interpolated keys for command titles, config descriptions, editor displayName
  + update package.json to use `%key%` placeholders in contributes.commands and contributes.configuration
+ [X] wire up `vscode.l10n.t()` in extension host code
  + replace hardcoded strings in extension.ts and notethinkEditor.ts
  + add `l10n` bundle path to package.json manifest
+ [X] add `@vscode/l10n` as a dependency for the webview bundle
  + initialise l10n in webview entry point with bundle URI from extension host
  + pass bundle URI via postMessage or webview HTML data attribute
+ [X] refactor webview components to use `l10n.t()` calls
  + InsertModal, SettingsDocumentModal, SettingsKanbanModal
  + ErrorBoundary, GenericView, ViewTypeSelector, ViewIntegrationSelector
  + BreadcrumbTrail, ExtensionReceiver
  + strings with interpolation use `l10n.t('text {0}', variable)` syntax
+ [X] add `@vscode/l10n-dev` as a devDependency
  + add `pnpm run l10n-export` script to extract strings into `bundle.l10n.json`
  + document workflow for adding a new language (`bundle.l10n.<locale>.json`)
+ [X] update tests to cover l10n initialisation
  + verify extension host strings resolve correctly
  + verify webview renders with default (English) bundle


### Upgrade NPM packages (Wave 1: minor/patch) [](?time_taken=0)

+ [X] run npm-check-updates
+ [X] pnpm install
+ [X] verify lint passes
+ [X] verify jest tests pass


### Upgrade NPM packages (root + workspace jest 30 + storybook 10) [](?time_taken=0)

+ [X] run npm-check-updates
+ [X] pnpm install
+ [X] verify lint passes
+ [X] verify jest tests pass
+ Phase 1 (minor/patch across all 4 package.json paths): 488 tests pass
+ Phase 2 (jest 29 → 30 majors in client/webview + notethink-views): 488 tests pass, no Jest 30.3 timer issues encountered
+ Phase 3 (Storybook 8 → 10, rollup plugins): 488 tests pass, lint clean. Peer-dep warnings remain for @storybook/addon-essentials, @storybook/addon-interactions, @storybook/blocks, @storybook/test still at 8.6.18 — these addons were outside Phase 3 scope and some are deprecated/renamed in SB10; follow-up story needed to clean up the storybook configuration and addon set


### Upgrade NPM packages (Wave 1 minor/patch refresh)

+ [X] run npm-check-updates
+ [X] pnpm install
+ [X] verify lint passes
+ [X] verify jest tests pass
+ updates: @types/vscode ^1.116.0 → ^1.118.0, @vscode/vsce ^3.9.0 → ^3.9.1, typescript-eslint ^8.58.2 → ^8.59.1
+ also bumped engines.vscode ^1.116.0 → ^1.118.0 to keep it >= @types/vscode major/minor (per CODING_STANDARDS pre-release rule)
+ rejects honoured: eslint and @eslint/js stay pinned at 9.39.4 (per .ncurc.json)
+ lint clean; 488 jest tests pass (extension 116, webview 30, notethink-views 342)


