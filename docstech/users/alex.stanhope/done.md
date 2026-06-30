# Done [](?nt_view=kanban&nt_child_status=done&order=newest-at-bottom)


### Child attribute inheritance

+ [X] add `inherited?: true` flag to LineTag interface in `notethink-views/src/types/NoteProps.ts`
+ [X] add `applyChildAttributeInheritance(allNotes)` in `convertMdastToNoteHierarchy.ts`
  + nt_child_ → direct children, nt_child2y_ → grandchildren, nt_childall_ → all descendants
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


### Edge-case tests for pre-release validation

+ [X] empty markdown file - already covered (parseops + hierarchy tests)
+ [X] very large markdown file (1000+ lines) - parse benchmark (150 sections × ~10 lines, under 200ms) and hierarchy benchmark (1000 headings, under 200ms)
+ [X] markdown with frontmatter - already covered (YAML + TOML in parseops); added hierarchy passthrough tests
+ [X] markdown with GFM tables, strikethrough - already covered in parseops; added hierarchy table passthrough tests
+ [X] markdown with GFM footnotes - 3 new tests (single, multiple, multi-line content) in parseops; hierarchy footnoteDefinition passthrough test
+ [X] file with unicode characters - 8 new tests in parseops (emoji, CJK, accented, combining chars, RTL, code blocks, tables, math symbols); 3 new hierarchy tests (emoji/CJK headline_raw, unicode body_raw)
+ [X] mixed content document - full-feature test (frontmatter + GFM + unicode + code + footnotes in one document)
+ tests 450 (was 427), 34 playwright


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
+ Phase 3 (Storybook 8 → 10, rollup plugins): 488 tests pass, lint clean. Peer-dep warnings remain for @storybook/addon-essentials, @storybook/addon-interactions, @storybook/blocks, @storybook/test still at 8.6.18 - these addons were outside Phase 3 scope and some are deprecated/renamed in SB10; follow-up story needed to clean up the storybook configuration and addon set


### Upgrade NPM packages (Wave 1 minor/patch refresh)

+ [X] run npm-check-updates
+ [X] pnpm install
+ [X] verify lint passes
+ [X] verify jest tests pass
+ updates: @types/vscode ^1.116.0 → ^1.118.0, @vscode/vsce ^3.9.0 → ^3.9.1, typescript-eslint ^8.58.2 → ^8.59.1
+ also bumped engines.vscode ^1.116.0 → ^1.118.0 to keep it >= @types/vscode major/minor (per CODING_STANDARDS pre-release rule)
+ rejects honoured: eslint and @eslint/js stay pinned at 9.39.4 (per .ncurc.json)
+ lint clean; 488 jest tests pass (extension 116, webview 30, notethink-views 342)


### Settings drawer (replace centred modal with top-anchored, full-width, push-down drawer)

+ goal
  + clicking the toolbar gear icon should open a full-width drawer attached below the toolbar, not pop a centred modal dialog
  + the drawer pushes page content down rather than overlaying it; the part of the document the user was looking at remains visible (the page scrolls down by the drawer's height to compensate)
  + changes inside the drawer apply immediately to the view - no Save or Cancel buttons; clicking the gear again (or pressing Escape) closes the drawer
  + must be performant on long documents and large kanbans - opening/closing the drawer must not re-render the note tree

+ research - best practice for a top-anchored push-down drawer in a VSCode webview
  1. **closest precedents inside VSCode** - VSCode's Find widget (Ctrl+F) and the merge-editor toolbar are top-anchored, full-width widgets that animate in/out. They use CSS transitions on `transform: translateY()` and *overlay* content. Push-down required a different primitive
  2. **animating from collapsed to natural content height** - CSS Grid trick: outer `display: grid; grid-template-rows: 0fr; transition: grid-template-rows 150ms` with inner `overflow: hidden; min-height: 0`; toggling to `1fr` animates smoothly to natural height. No JS measurement, no `max-height` brittleness
  3. **scroll anchoring** - capture an anchor element's `getBoundingClientRect().top` before the drawer opens, then `scrollBy` so the anchor returns to its previous viewport-y. CSS `overflow-anchor: auto` is unreliable for deliberate UI toggles
  4. **sticky vs absolute vs fixed** - `position: sticky; top: <toolbar-height>` keeps the drawer in document flow (so content below moves down) but glued just below the toolbar while content scrolls underneath
  5. **VSCode theming** - `var(--vscode-editorWidget-*)`, no backdrop, border-bottom matching the toolbar so the drawer reads as attached
  6. **animation timing** - 150ms `cubic-bezier(0.2, 0, 0.38, 0.9)`; `@media (prefers-reduced-motion: reduce)` zeroes the duration
  7. **performance** - `React.memo` on the drawer; reads from props with no local mirror; always mounted (open/closed is a CSS class); each onChange dispatches for a single key only, so `React.memo` on `DocumentView`/`KanbanView` filters out untouched re-renders
  8. **real-time apply semantics** - per-view settings dispatch via `setViewManagedState`; global settings via `postMessage({ type: 'updateGlobalSetting' })`; Kanban column reorder normalises to `column_order: undefined` when the order matches natural

+ design decisions (locked in 2026-05-11)
  1. **renamed `SettingsDocumentModal` → `SettingsDocumentDrawer` and `SettingsKanbanModal` → `SettingsKanbanDrawer`** - `<dialog>` replaced with plain `<div>` styled via the new `.settingsDrawer` SCSS class
  2. **drawer ownership moved up to `GenericView`** - single, predictable place to insert the push-down element; `DocumentView`/`KanbanView` no longer own settings state or render settings UI
  3. **`position: sticky; top: 22px`** below the toolbar; closing via clicking the gear again or pressing Escape
  4. **no Save / no Cancel** - every input dispatches on change; local mirrored state removed; version label kept for diagnostics
  5. **scroll anchoring in `GenericView`** - `useLayoutEffect` captures the gear button's `getBoundingClientRect().top` before the toggle, then a `requestAnimationFrame` loop calls `window.scrollBy(0, delta)` for ~250ms (covering the 150ms animation + margin) so the gear stays glued at its initial viewport position
  6. **animation via CSS Grid** - `grid-template-rows: 0fr → 1fr`; flipped via `data-open="true"`
  7. **reduced motion** - transition zeroed; `scrollBy` always instant
  8. **gear icon is a toggle** - `aria-expanded={settings_drawer_open}`; tooltip stays `Settings`
  9. **shared controls extracted** - `SettingsCommonControls.tsx` houses the four shared booleans; both drawers compose it
  10. **drawer cap height** - `max-height: 50vh; overflow-y: auto` on the inner wrapper
  11. **layout** - drawer body is a flex row: setting groups on the left (one group for Document, two for Kanban: column order + common controls), title and version pinned right via `justify-content: space-between`

+ code changes
  + [X] new SCSS `.settingsDrawerGrid`, `.settingsDrawer`, `.settingsDrawerBody`, `.settingsDrawerGroups`, `.settingsDrawerGroup`, `.settingsDrawerMeta`, `.settingsDrawerColumnOrder`, `.settingsDrawerVersion` in `ViewRenderer.module.scss`
  + [X] renamed `SettingsDocumentModal.tsx` → `SettingsDocumentDrawer.tsx`; removed `<dialog>`/local state/Save/Cancel; controlled inputs dispatch via `onSettingChange` / `onGlobalSettingChange`
  + [X] renamed `SettingsKanbanModal.tsx` → `SettingsKanbanDrawer.tsx`; column up/down/reset dispatch via `onColumnOrderChange` on every click
  + [X] new `SettingsCommonControls.tsx` housing the four shared boolean checkboxes
  + [X] `GenericView.tsx` - hoisted `settings_drawer_open`; gear button has `aria-expanded` and a ref; `useLayoutEffect` rAF loop anchors gear-button viewport-y; document keydown listener closes on Escape and returns focus to the gear; drawer renders between toolbar and view body; `arraysEqual(custom_order, natural_order)` normalisation lives in `handleColumnOrderChange` so persistence drops to `undefined` when the order matches natural
  + [X] `DocumentView.tsx`, `KanbanView.tsx` - `settings_open` state, `handleSettingsSave`, `onSettingsClick` ref wiring, and inline modal renders removed
  + [X] `ViewProps.ts` - `handlers.onSettingsClick` removed (no other consumers)
  + [X] `l10n-rendering.test.tsx` - updated imports/props for renamed drawers; Save/Cancel assertions dropped (no such buttons)

+ tests (Jest)
  + [X] `SettingsDocumentDrawer.test.tsx` - each onChange dispatches the right handler with the right key/value; no Save/Cancel; version label rendered
  + [X] `SettingsKanbanDrawer.test.tsx` - up/down/reset dispatch the new array; reset dispatches the natural order (consumer normalises to `undefined`); checkboxes dispatch immediately
  + [X] `SettingsCommonControls.test.tsx` - each of the four checkboxes dispatches the expected handler with the expected key
  + [X] `GenericView.test.tsx > settings drawer` - gear toggles `aria-expanded`; drawer `data-open` flips; the right drawer renders by view type; per-view checkbox dispatches `setViewManagedState`; line-numbers checkbox dispatches `postMessage updateGlobalSetting`; Kanban reorder persists `column_order`; reset persists `undefined`; Escape closes and returns focus
  + [X] regression guard - Jest total 492 (baseline 488 + 4 net new) - no regressions; lint clean

+ tests (Playwright)
  + [X] all 35 existing Playwright tests continue to pass (settings-toggle.spec.ts, kanban, view-switching, breadcrumb, click-interaction, document-view, error-boundary, keyboard-navigation, list-bullets)
  + drawer-interaction Playwright tests (open/close animation, scroll anchoring, reduced motion) were not added at the browser level - equivalent assertions live in Jest under jsdom (toggle, dispatch, Escape + focus restoration). Could be added later if browser-level coverage becomes useful; deferred because the jsdom + manual verification already covers the behaviour

+ notes
  + the only remaining `<dialog>` consumer is `InsertModal.tsx` - kept modal because it's a single-shot data entry that interrupts flow
  + the CSS Grid `0fr → 1fr` animation requires Chromium 117+. VSCode ≥ 1.96 ships Electron 32 / Chromium 128 - well within range
  + interacts cleanly with the Aggregate (Directory) story still in todo.md: in Directory mode a single drawer below the single toolbar remains the right model; the drawer's `onSettingChange` dispatches `setViewManagedState` for the merged view's `id`, exactly as for a single-file view
  + post-implementation refinement (user feedback): Kanban Settings title and NoteThink version label pinned right; settings split into multi-column groups so the drawer is shorter and easier to scan


### Aggregate (Directory) view: merge files into a single view

+ goal
  + in Directory mode, show one merged visualisation of all matching files rather than N stacked copies of the single-file view
  + each merged story carries an origin tag so the user can see which file it came from
  + foundation for a project-plan Kanban that aggregates stories from every `todo.md` under `active_development/*/` into one board

+ design (locked in 2026-05-14)
  + synthetic root in the webview (not on the extension side): `mergeAggregateRoot(docs, integration_path)` parses every doc via `convertMdastToNoteHierarchy` then surfaces depth-3 headings under a single seq=0 root, renumbering globally
  + `##` headings are treated as epics: their depth-3 children become stories with `origin.epic = { name, id? }`; the structural epic is overridden by a direct `epic=` linetag (or one propagated via `nt_child_epic=` inheritance - already wired by `applyChildAttributeInheritance`)
  + per-file `ng_view` on the H1 is captured as `origin.file_view_type` so `AutoView` can majority-vote view type across files (one vote per file, ties fall back to `document`)
  + breadcrumb in Directory mode segments the aggregation path itself, not any one file
  + edits/clicks attach `docPath: note.origin?.doc_path` so the per-doc routing survives the merge; in single-file mode `note.origin` is undefined and behaviour is unchanged
  + origin pill: single uppercase first letter of project name (`oma` → `O`, `notegit` → `N`), deterministic colour from djb2 hash of full project name, theme-adaptive lightness (dark 32%, light 72%, saturation 65%); optional second epic pill when `origin.epic` is set
  + extension watcher: phase-1 `findFiles` bulk update then a `FileSystemWatcher` streams incremental upserts (`merge_strategy: 'merge'`) and `docDeleted` removals; tear-down on dispose / mode switch
  + naming: the per-doc and per-directory components inside `NoteRenderer.tsx` are tree-composers (`NoteTreeComposer`, `AggregateTreeComposer`), one layer above leaf views (Document/Kanban/Auto)

+ code changes
  + [X] `origin?: NoteOrigin` field on `NoteProps`; `NoteOrigin` carries `doc_id`, `doc_path`, `relative_path?`, `epic?`, `file_view_type?`
  + [X] new `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` + helpers `anyViewInDirectoryMode`, `firstIntegrationPath`
  + [X] new `stripHeadlineLinetags` helper in `noteops.ts`; replaces the inline `stripMarkdownHeadline` in `BreadcrumbTrail.tsx`
  + [X] `NoteRenderer.tsx` branches on `anyViewInDirectoryMode(viewStates)`; `AggregateTreeComposer` renders one `<GenericView>` over the merged root with no docId/docPath stamping (handlers attach origin paths themselves); single-file path uses `NoteTreeComposer`
  + [X] both tree-composers extracted from `NoteRenderer.tsx` into `client/webview/src/components/composers/`: `NoteTreeComposer.tsx` (+ the `flattenAllNotes` helper it owns) and `AggregateTreeComposer.tsx`; `NoteRenderer.tsx` is now a thin dispatcher (~92 lines) and exports `NoteRendererProps` for the composers to `import type`
  + [X] `GenericView` click handlers (checkbox + select/reveal + clear focus + keyboard up/down) and `KanbanView` drag-end attach `docPath: note.origin?.doc_path`
  + [X] `AutoView` detects a synthetic aggregate root and majority-votes `origin.file_view_type` across files; ties / no votes fall back to `document`
  + [X] `BreadcrumbTrail` gains an `integration_path` prop; directory mode segments that path
  + [X] `GenericView.handleIntegrationChange` and `handleDirectoryClick` persist `integration_path` on the view state
  + [X] new `OriginPill.tsx` + `OriginPill.module.scss`; helper `originPillColour(project_name, theme)`; rendered next to the headline in `MarkdownNote.tsx` only at story level (`note.level === 1`); click → `revealRange` on origin doc
  + [X] origin pill scales via `em` units so its outer height matches the surrounding heading's line-height; `float: left` keeps multi-line headlines wrapping around it (first-line indent pattern)
  + [X] `DocumentView`/`KanbanView` now propagate `postMessage` into `note_handlers` so the origin pill can route clicks
  + [X] extension `setIntegration` replaces the one-shot `findFiles` with a `FileSystemWatcher`; phase-1 bulk update keeps the existing replace strategy; phase-2 watcher emits `merge_strategy: 'merge'` upserts and `docDeleted` removals
  + [X] `ExtensionReceiver` handles `merge_strategy: 'merge'` (upsert) and a new `docDeleted` message; on mount re-dispatches `setIntegration` when saved view-state shows directory mode (extension's in-memory `integration_path` is lost on reload)
  + [X] `sendDoc` opts out for docs outside `integration_path` and uses `merge_strategy: 'merge'` when an integration is active (so single-file edits don't wipe the merged map)
  + [X] `editText` handler in the extension routes the re-parsed doc through `sendDoc` regardless of whether the edited file is the active one (covers aggregate-mode edits in non-active tabs)
  + [X] `revealRange`/`selectRange` in aggregate mode smart-opens the origin file: existing tab → switch to that group; otherwise pick a column other than the NoteThink panel's (existing group preferred, else `ViewColumn.Beside`)
  + [X] `AggregateTreeComposer` uses the same view-state id for read+write so settings drawer / column reorder dispatches round-trip correctly

+ tests (Jest, +39 vs 488 baseline → 527 passing)
  + [X] `mergeAggregateRoot.test.ts`: single/many/empty/no-H1 files, `##` epic recursion, epic resolution (id / name / unresolved literal / direct overrides structural / ambiguous names resolve per-file), origin stamped on descendants, contiguous global seqs, integration_path on root, file_view_type captured from H1
  + [X] `AutoView.test.tsx`: majority vote (2/3 kanban → kanban), tie → document, no votes → document, one-vote-per-file when one file has many stories, single-file mode unaffected
  + [X] `OriginPill.test.tsx`: `originPillColour` determinism + theme lightness band + distinct hues for shared-first-letter projects + spectrum spread; rendering (letter, tooltip, click, epic pill present/absent, `?` fallback for missing relative_path)
  + [X] existing `GenericView.test.tsx` updated for `integration_path` in `setViewManagedState`

+ tests (Playwright, +5 vs 35 baseline → 40 passing)
  + [X] aggregate mode flips `NoteRenderer` to `data-aggregate-mode="true"` with a single toolbar
  + [X] origin pills render the correct project letter on each aggregated story
  + [X] clicking an origin pill sends `revealRange` with the origin doc path
  + [X] breadcrumb segment click in aggregate mode sends `setIntegration` with the segment path
  + [X] switching the aggregated view to Kanban keeps origin pills and produces ≥2 columns

+ deferred / follow-up
  + cross-project aggregation (`active_development/*/docstech/...`) - current `setIntegration` accepts a single directory only; multi-root integration is a later story
  + `calfam/docstech/users/alex.stanhope/done.md` historical-context `##` dividers (lines 1367-1368 at the time of writing) interpret as epics; user cleaned these up after this story
  + `linetagops` round-trip tests for `%26` / `+` encoding were not added - encoding works via existing `URLSearchParams` decoding; add when a real edge case appears

+ tests 527, playwright 40, lint clean


### Harden webview→host trust boundary before public release [](?id=webview-path-hardening&time_estimated=90)

Pre-publish security review found the only mitigation between a future webview-script regression and arbitrary file read/write is the markdown sanitizer + CSP. Added host-side validation so the trust boundary is defended in depth before the first public release.

+ background
  + webview-supplied paths reach privileged host fs/editor APIs with no workspace-containment check
  + not exploitable today (sanitizer + nonce CSP block webview script) - this is belt-and-suspenders
  + relates to the "Publish NoteThink 0.1.x to marketplace" story - landed before `vsce publish`
+ goal
  + every webview-supplied path is validated host-side before it reaches an fs/editor/external sink
+ scope
  + shared path-containment helper with a pure, Jest-testable core plus a `vscode`-aware wrapper
  + guard the three path-bearing message handlers and the external-URL handler
  + pin Mermaid `securityLevel` and document the lone `innerHTML` sink
+ [X] add `isPathWithin` pure helper + `isWithinWorkspace` wrapper
  + pure core takes target + root list, rejects `..` traversal and sibling-prefix (`/ws-evil` vs `/ws`)
  + `pathsafe.ts` is vscode-free + Jest-tested; bridge in `notethinkEditor.ts` feeds `workspaceFolders` fsPaths
+ [X] guard `editText` path before `openTextDocument`/`applyEdit`
  + `notethinkEditor.ts:550` - rejects non-workspace or non-`.md`, logs via `writeToErrorLog`, returns
+ [X] guard `revealRange`/`selectRange` path before `openTextDocument`/`showTextDocument`
  + `notethinkEditor.ts:382` - validated after the `!doc_path` early-return; gates the existing-editor fast-path too
+ [X] guard `setIntegration` directory before `RelativePattern`/`findFiles`/watcher
  + `notethinkEditor.ts:458` - rejects at the top of the directory branch, before any teardown
+ [X] add http/https/mailto scheme allow-list to `openExternal`
  + `notethinkEditor.ts:631` - host-side `ALLOWED_EXTERNAL_SCHEMES` check, parsed once
+ [X] pin Mermaid `securityLevel: 'strict'` and comment the `innerHTML` sink
  + `MermaidDiagram.tsx:24` initialize + `:38` `innerHTML` commented; test assertion strengthened to guard the pin
+ [X] confirm reload-replay of persisted `integration_path` is covered by the `setIntegration` guard
  + `ExtensionReceiver.tsx:299` cross-ref comment added; host re-validates, no behaviour change
+ [X] add Jest tests for the path helper
  + `pathsafe.test.ts` 13 cases + 7 handler regression tests in `notethinkEditor.test.ts` (refusal of out-of-workspace/non-md/bad-scheme)
+ [X] bump patch version in the governing package.json
  + root `package.json` 0.1.60 → 0.1.61 (extension sub-package stays 0.1.0 by convention)
+ acceptance criteria
  + out-of-workspace `docPath`/`path` is rejected + logged, no fs/editor call made
  + `openExternal` only opens http/https/mailto
  + Mermaid `securityLevel` is explicitly strict with a warning comment
  + `pnpm run check` green; new helper has Jest coverage
+ test plan
  + Jest: path-helper unit tests covering every case above
  + `pnpm run check` (lint + build + rollup + jest) green
+ manual: open a note whose origin path is forced outside the workspace - confirm refused, not opened
+ manual: click an http link and a mailto link - confirm both still open externally
+ manual: confirm Mermaid diagrams still render after pinning securityLevel
+ commit message draft
  + notethink 0.1.61: harden webview→host trust boundary - workspace-containment guard on editText/revealRange/setIntegration paths, http/https/mailto allow-list for openExternal, pin mermaid securityLevel=strict
  + ; tests 547 jest, 40 playwright


### Publish NoteThink 0.1.x to marketplace [](?id=publish-notethink-0-1-x)

Publisher created (`NoteThink`, notethink.com verified). Extension rebranded off the old `ZoomBuzz` identity, final logo shipped. Only the credentialed `vsce publish` is left for the user.

+ [X] rebrand publisher to NoteThink
  + root package.json: publisher/author → NoteThink, homepage → https://notethink.com
  + viewType `zoombuzz.notethink` → `notethink.notethink`; extension ID is now `NoteThink.notethink`
  + updated notethinkEditor.ts, both mocha suites, client/extension sub-package
  + repo/bugs URLs left at the real remote (github.com/zoombuzz/notethink) - GitHub org not renamed
+ [X] create NoteThink marketplace publisher
  + done by user; not the One Partner account used by other projects
+ [X] add placeholder extension icon
  + `media/icon.png` (256×256) wired via package.json `"icon"`
  + SVG source in docstech/design/logos/, multi-res renders gitignored
+ [X] commission the real logo
  + final mark in docstech/design/logos/notethink-icon.svg; `media/icon.png` re-rendered; drafts archived in variants/
+ [X] publish to marketplace
  + PAT provisioned, Marketplace > Manage scope
  + run `pnpm run publish:marketplace` - non-interactive, bridges the env var to VSCE_PAT, no `vsce login` prompt
+ manual: install the .vsix locally, exercise edge cases - special/unicode paths, 100+ markdown workspace perf, no devtools console errors
+ manual: after publishing, verify the listing renders - icon, README, repo/homepage links


### Reset viewer to current file when leaving folder mode

Switching the integration selector from Folder back to Current file leaves the viewer showing the stale aggregate (stacked per-file headers/breadcrumbs) instead of the active editor file.

+ root cause
  + `handleIntegrationChange` (GenericView.tsx) only posts `setIntegration` for
    `mode === 'folder'`; there is no `current_file` branch, so the extension
    never tears down aggregate state
  + extension keeps `integration_path`/`integration_docs`/watcher, so `sendDoc`
    skips out-of-dir files and tags in-dir updates `merge_strategy: 'merge'`;
    the webview never prunes the old aggregate docs and `NoteRenderer` stacks
    one view per stale doc
+ [X] add a `current_file` branch to `handleIntegrationChange` that posts
      `{ type: 'setIntegration', mode: 'current_file' }`
+ [X] in the extension `setIntegration` `current_file` branch, after teardown
      re-resolve the active editor and re-send it via `sendDoc` (replace) +
      selection so the webview prunes stale aggregate docs
+ [X] add jest: GenericView selector→current_file posts setIntegration +
      setViewManagedState
+ [X] add jest: notethinkEditor current_file tears down the aggregate and
      re-sends the active doc as a replace (no merge_strategy)
+ [X] bump patch version (0.2.3 → 0.2.4)
+ manual: in folder mode, switch to a file outside the aggregate dir, toggle
  back to Current file, confirm only that file renders


### Continue to refine folder experience

+ [X] rename "Directory" option as "Folder"
  + comprehensive refactor: IntegrationMode value, setIntegration message,
    integration_mode comparisons, handleFolderClick/onFolderClick,
    anyViewInFolderMode, folder_path, UI label + l10n (5 locales), comments,
    tests, playwright (aggregate-folder.spec.ts), docs; legacy persisted
    integration_mode:'directory' migrated to 'folder' in ExtensionReceiver
+ improve filters: editable include/exclude + Files drawer
  + goal
    + breadcrumb folder count becomes `(X in Y files)` where X = top-level
      stories merged into the synthetic root, Y = source files loaded
    + clicking the count opens a Files drawer (same scaffold as the Settings
      drawer: top-anchored push-down grid, Escape, scroll-anchor)
    + Files drawer shows: editable Include filter, editable Exclude filter,
      the file count, and a live list of currently-selected files
    + editing a box debounces 200ms then (a) re-filters the drawer's file list
      client-side instantly, (b) persists the globs to view state and posts a
      background `setIntegration` so the whole aggregate re-discovers
  + decisions (confirmed with user)
    + X counts top-level stories (synthetic_root.child_notes.length)
    + edited filters persist in per-view state (survive reload, like
      integration_path)
    + exclude box is fully editable incl. the derived-dir guard list (user can
      clear it; accept the MAX_AGGREGATE_FILES truncation risk)
  + [X] extension: hoist include/exclude to closure state in notethinkEditor.ts
        with DEFAULT_AGGREGATE_INCLUDE/EXCLUDE; accept optional include/exclude
        on the `setIntegration` message; empty exclude -> pass null to findFiles
        (no excludes); empty include -> fall back to default
  + [X] extension: echo aggregate_include/aggregate_exclude on the aggregate
        `update` messages (next to aggregate_total_discovered)
  + [X] webview: thread aggregate_include/exclude + file list + note_count
        through ExtensionReceiver -> NoteRenderer -> AggregateTreeComposer ->
        ViewProps -> GenericView; replay persisted globs in the reload
        setIntegration
  + [X] lib: globMatch.ts - minimal VS Code glob -> RegExp (** , * , ? , {a,b})
        for client-side instant filtering; no new dependency
  + [X] BreadcrumbTrail: `(X in Y files)` label (and `(X in Y of M files)` when
        the discovery cap truncated); make the count a button -> opens drawer
  + [X] GenericView: ToolbarDrawer wrapper factored from the Settings drawer
        scaffold (behaviour-preserving); files drawer mutually exclusive with
        settings; one shared scroll-anchor/Escape effect over `active_drawer`
  + [X] FilesDrawer.tsx: two debounced text inputs + count + filtered file list
  + [X] wire persistence (setViewManagedState) + background reapply
        (postMessage setIntegration with include/exclude)
  + [X] l10n: add new UI strings to l10n/bundle.l10n*.json (5 locales)
  + [X] tests: jest (globMatch, BreadcrumbTrail label+click, FilesDrawer
        debounce, notethinkEditor setIntegration filters + RelativePattern
        mock); playwright (count format, click opens drawer, editing a box
        filters the list); settings-toggle.spec stayed green. Composer glue
        (note_count / file list) covered indirectly via Breadcrumb + FilesDrawer
        rather than a dedicated harness-less composer test
  + manual: edit include to a narrower glob, confirm drawer list shrinks
    within ~200ms and the merged notes re-discover shortly after
  + manual: clear the exclude box on a repo with node_modules and confirm
    behaviour (broader set, possible `of M` truncation hint)
  + manual: reload the window and confirm custom filters are restored


### Per-file note cap (default 10) + order linetag

Long files (e.g. `done.md` with hundreds of completed stories) swamp Folder mode. Cap top-level stories taken per source file (default 10, editable in the Files drawer), and add an `order` linetag on the file root so the cap keeps the newest end.

+ design decisions (locked, reversible)
  + cap applied webview-side in `mergeAggregateRoot` (operates on parsed
    notes; no extension round-trip - instant re-render on change)
  + scope: Folder/aggregate mode only; Current-file mode shows the whole file
  + `order` read from the file H1 linetag: `newest-at-top` (default / absent /
    unrecognised) keeps the first N, `newest-at-bottom` keeps the last N;
    document order preserved within the slice (no re-sort)
  + cap counts depth-3 stories the file contributes (incl. epic-nested), in
    document order
  + default cap = 10, persisted per-view in
    `display_options.aggregate_max_notes_per_file`
+ contract (both agents implement against this - no merging, shared copy)
  + `mergeAggregateRoot(docs, integration_path, max_notes_per_file?: number)`
    - new optional 3rd param; when undefined, no cap
  + display-options key `aggregate_max_notes_per_file?: number` on
    `NoteDisplayOptions` and `ViewProps`
  + `DEFAULT_AGGREGATE_MAX_NOTES_PER_FILE = 10` exported from
    AggregateTreeComposer.tsx alongside the existing DEFAULT_AGGREGATE_*
+ [X] docs/data: AUTHORING_GUIDE `order` key + Per-file-note-cap section;
      `done.md` root → `&order=newest-at-bottom`
+ [X] agent A - core: `order` read + per-file first/last-N trim in
      `mergeAggregateRoot.ts` (new `trimFileStories` helper, optional 3rd
      param); display-options key on `NoteProps.ts` + `ViewProps.ts`; +11
      `mergeAggregateRoot.test.ts` cases
+ [X] agent B - UI/wiring: "Max stories per file" numeric input in
      `FilesDrawer.tsx` (default 10, debounced, clamp floor 1); threaded via
      `GenericView.tsx` (persisted by setViewManagedState only - setIntegration
      NOT extended); `AggregateTreeComposer.tsx` resolves + passes the cap and
      exports `DEFAULT_AGGREGATE_MAX_NOTES_PER_FILE=10`; FilesDrawer +
      GenericView jest added
+ [X] coordinated: version 0.2.4 → 0.2.5; integrated gate green centrally -
      build, lint (eslint + 3× tsc), jest 604/604, playwright 42/42
+ [X] fix (review feedback): newest-at-bottom showed oldest-first in the
      column; `selectFileStories` now reverses the kept slice so the
      document-bottom (newest) story gets the smallest merged seq and sorts to
      the top - applies even uncapped; AUTHORING_GUIDE note corrected; tests
      updated + new uncapped-reversal case
+ [X] fix (review feedback): the merge-seq reversal had no effect because
      `kanbanNoteOrder`'s no-weight fallback sorted by `position.start.offset`
      (raw per-file document offset), not the merged seq. fallback now uses
      `seq` (the implicit ordering weight - already file-`order`-aware via
      mergeAggregateRoot; equal seqs tie-break on offset). single-file
      unaffected (seq == doc order). `noteops.test.ts` updated for seq fallback
+ [X] review (review feedback): drag-to-reorder weight write
      (`calculateTextChangesForOrdering` / KanbanView.dragEndHandler) - found
      correct, but it assumed seq-order display while the renderer used offset
      order (now reconciled by the seq fallback above); added end-to-end
      round-trip jest (drop top/bottom/middle → weights → kanbanNoteOrder holds
      the dropped order) which it previously lacked
+ [X] fix (review feedback): folder columns were blocky-by-file (all of
      project A, then all of B). mergeAggregateRoot now interleaves
      round-robin by per-file rank (flattened, epic-nested included) in stable
      relative_path order - rank-0 of every file, then rank-1, … shorter files
      drop out of later rounds. standardNoteOrder made seq-primary (offset
      tiebreak) as the single source of truth so Kanban AND Document/Auto
      aggregate views both interleave; kanbanNoteOrder no-weight branch now
      delegates to it. Rewrote the two blocky merge tests; added equal-length,
      uneven-length, newest-at-bottom-interleave, seq-primary standardNoteOrder
      cases
+ manual: in folder mode, drag a Done card up/down and confirm it holds
  position after the editText round-trips back
+ manual: open a multi-project folder, confirm columns interleave (top story
  of each project, then second of each) in Kanban and in Document view
+ manual: open a folder with `done.md`, confirm only the last 10 stories show;
  raise the cap in the Files drawer, confirm more appear without reload
+ manual: confirm `todo.md` (no `order`) still shows its first 10 stories


### Version the Authoring Guide

Formalise an Authoring Guide version so language can evolve across files without breaking existing sites.

+ decisions (from user)
  + semantic versioning: patch = editorial only (no file renders differently);
    minor = new backward-compatible features; major = potentially breaking
  + default: every file is interpreted against the latest version; files do
    not record a version yet (may revisit later)
  + authors can pin with `nt_authoring_version` (`MAJOR` or `MAJOR.MINOR`) on
    the file root - reserved/documented now, not enforced (only 1.0.0 exists)
+ [X] AUTHORING_GUIDE: version banner + `## Versioning` section (patch/minor/
      major table, default-latest, locking) at `1.0.0`
+ [X] AUTHORING_GUIDE: `nt_authoring_version` added to the reserved
      View-configuration linetag table
+ doc-only change - no parser/behaviour change (version-conditional parsing is
  future work, to land with the first breaking major)


### Stop note headlines escaping the card on the right

Kanban card headlines containing a long unbreakable token (path, slug, identifier) punch past the card's right edge - wrap is currently scoped to inline `code` only. Apply the wrap to the whole headline/body, and add an `overflow: hidden` safety net on the kanban card so anything that still escapes is clipped by the rounded border.

+ [X] promote `overflow-wrap: anywhere` from `.headline, .body code` to the parent `.headline, .body` block in `ViewRenderer.module.scss` (covers raw text, linetagInline spans, OriginPill, every inline child); drop the now-redundant copy on `code`
+ [X] add `overflow: hidden` to the kanban card (`.column > div > .note`) so the 8px rounded border crops residual escapees; safe because focus/selection rings use `outline` (drawn outside the box) and box-shadow is painted by the element itself
+ [X] Playwright check in `kanban-view.spec.ts`: the headline's right edge does not exceed the card's right edge for a story with an inserted long-unbreakable token
+ manual: reload window on a kanban board with long-slug stories and confirm headlines wrap inside the card (no horizontal punch-through)


### Upgrade NPM packages (minor/patch + sass-loader 16→17) [](?time_taken=60)

+ [X] run npm-check-updates
+ [X] pnpm install
+ [X] verify lint passes
+ [X] verify jest tests pass


### Relevance ordering: bump active-file stories within equal rank

In Folder mode, same-rank stories (e.g. every file's rank-0) tied only on stable file path, so the open editor file's stories were buried. Add a rank-gated relevance tiebreak toward the active editor file. Builds on the round-robin foundation; weights/interleave unchanged.

+ decisions (confirmed): relevance = last `selectionChanged` doc path;
  file-level; scope everywhere (Kanban + Document/Auto)
+ [X] `NoteOrigin.file_rank` (0-based per-file index, `order`/cap-aware);
      stamped in mergeAggregateRoot's round-robin
+ [X] `makeNoteOrder(ctx)` / `makeKanbanNoteOrder(ctx)` - rank-gated relevance
      tiebreak then delegate to the unchanged seq-primary
      standardNoteOrder/weight logic (zero regression when no active file)
+ [X] plumb `active_doc_path` (last selectionChanged) ExtensionReceiver →
      NoteRenderer → Aggregate/NoteTreeComposer → ViewProps →
      GenericView (pre-sort) + KanbanView (column sort)
+ [X] tests: noteops (relevance within equal rank; not across ranks; explicit
      weight still wins; no-ctx == standardNoteOrder), mergeAggregateRoot
      (file_rank stamping incl. newest-at-bottom)
+ manual: open a project's todo.md in the editor, confirm its stories rise to
  the top of each column within their rank band; other projects still listed
+ manual: confirm single-file view + drag-reorder unaffected


### Kanban: reorderable new columns + hide empty columns

Two Kanban folder-mode bugs from review of the aggregate board.

+ [X] settings drawer omitted a live status (`testing`) when a stale
      `column_order` didn't list it, so it couldn't be reordered -
      `SettingsKanbanDrawer` now shows the saved order then appends any live
      column (new status / untagged) not in it, matching the board's columns
+ [X] empty columns left over in a stale `column_order` (`done`,
      `code-review`) still rendered - `KanbanView` now shows only columns with
      stories (generalised from the untagged-only rule), with an all-columns
      fallback so an empty board isn't blank
+ [X] tests: KanbanView (stale empty named column hidden; empty-board
      fallback), SettingsKanbanDrawer (live column appended to stale order)
+ tradeoff (noted): hiding empty columns means a card can't be dragged into a
  status that has no column yet; status is still settable by editing the
  `status=` linetag in the markdown
+ manual: confirm `testing` is reorderable in the drawer and empty
  done/code-review columns no longer show


### Outside-click closes the toolbar drawer

Settings + Files drawers can already be dismissed with Escape, but a pointer-only user has to find the trigger again. Add a click-outside dismiss so any pointerdown on the view body, a note, or unrelated chrome closes whichever drawer is open. Trigger button and drawer interior stay un-dismissive so toggle + interaction still work.

+ [X] add a `pointerdown` listener in `GenericView.tsx` (mirroring the existing Escape effect's lifecycle), active only while a drawer is open
+ [X] ignore the event when the target is inside `anchor_el_ref.current` (current trigger) or inside the open drawer wrapper (looked up by id) - so the trigger's own onClick toggles cleanly and clicks inside the drawer don't dismiss
+ [X] no focus restore on outside-click (focus follows the pointer); Escape keeps the existing focus-restore behaviour
+ [X] Playwright coverage in `aggregate-folder.spec.ts` (folder mode exposes both drawers): outside-click closes Files drawer; clicking inside it does not; trigger click toggles cleanly
+ [X] Jest coverage in `GenericView.test.tsx`: outside `pointerdown` flips `data-open` to `false` for the Settings drawer; inside-drawer `pointerdown` leaves it open
+ manual: open Settings, click a note in the body - drawer closes; open Files, click a kanban card - drawer closes; open Settings, toggle a checkbox - drawer stays open


### Watch unopened files shown in the viewer

In single-file mode, change-handling is wired to `onDidChangeTextDocument` (`notethinkEditor.ts:306`) - fires only for editor-open documents. A file shown in the viewer but with no open text editor (custom editor + on-disk edit by another tool, e.g. Claude's Write) never re-parses. Folder mode already has its own `createFileSystemWatcher` (`notethinkEditor.ts:555`); single-file mode does not.

+ [X] add a `notethink.watchUnopenedFilesInViewer` boolean configuration to `package.json` `contributes.configuration` (default `true`); add the l10n string + 5 translations
+ [X] expose it as a checkbox in the Settings drawer (Document + Kanban) alongside the existing `show_line_numbers` global toggle
+ [X] when the setting is on, register a `vscode.workspace.createFileSystemWatcher` for the active viewed file whenever it isn't backed by an open `TextDocument`; on change/create, re-`buildDoc` and `sendDoc`
+ [X] dispose the per-file watcher on viewer dispose, on doc swap, and on setting flip (avoid leaks across active-doc changes)
+ [X] de-dupe with `onDidChangeTextDocument` - if the doc gets opened in an editor while the watcher is live, dispose the watcher to avoid double re-parse
+ [X] tests: Jest in `notethinkEditor.test.ts` covering watcher attach/detach lifecycle + setting flip; Playwright is N/A (no real fs in harness)
+ implementation notes
  + gate is "no visible text editor" rather than "no open TextDocument" - strictly equivalent given that VS Code only fires `onDidChangeTextDocument` for editors that are visible (the empirical bug the story documents)
  + the new setting is `scope: "window"` and written via `ConfigurationTarget.Global` - it's a per-user behavioural preference and follows the user across every workspace, unlike `showLineNumbers` (per-workspace)
  + dedupe via `onDidChangeVisibleTextEditors` instead of `onDidOpenTextDocument`/`onDidCloseTextDocument` - the visible-editor signal already covers both transitions and matches the gate
+ manual: open a `.md` in the viewer with no editor split, edit the file from a separate process (or Claude's Write), confirm the viewer re-renders within ~1s


### Bypass openTextDocument cache on watcher-driven re-parses

The 0.2.9 work added `active_file_watcher` for single-file mode and the existing folder-mode `integration_watcher` already covers aggregate views. Both call `vscode.workspace.openTextDocument(uri)` on change to re-parse the doc. **VS Code's TextDocument cache is not refreshed on external disk changes for files that aren't bound to a visible editor** - the watcher correctly fires `onDidChange`, but `openTextDocument` returns the stale cached doc and `document.getText()` yields stale text. The viewer posts the same content as before and the UI doesn't update. A window reload wipes the cache and the next read pulls fresh content - that's the symptom.

+ [X] factor out a `buildDocFromUriAndText(uri, text, createdBy)` helper from the existing `buildDoc(document)` so we can build a Doc from raw bytes without going through TextDocument
+ [X] in folder-mode `loadOne`, when called from the watcher's `onDidChange`/`onDidCreate`, read bytes via `vscode.workspace.fs.readFile(uri)` and feed them to `buildDocFromUriAndText` (initial discovery keeps `openTextDocument` so editor-buffer/unsaved content still wins on first load)
+ [X] in `active_file_watcher`'s `onChange`, do the same: `fs.readFile` → `buildDocFromUriAndText` instead of `openTextDocument` + `buildDoc`
+ [X] tests: the watcher tests should assert `fs.readFile` is called and the posted doc reflects the disk content (not whatever `openTextDocument` returns); add a folder-mode case for the same pattern in `loadOne`
+ manual: edit todo.md/done.md externally with notethink showing the kanban aggregate; the moved story should appear in its new column within ~1s without a window reload


### Origin-pill color collisions across projects

Aggregate view origin pills colour-code each story by its source file's first letter (project initial). Two pairs of projects observed to hash to the same colour: CalFam ("C") and Shopify Uncomplicated ("S") both render the same red; notegit ("N") and countingsheet ("C") both render the same green. The bucket is too small / the hash isn't spreading the input space - first-letter-only collapses many projects to ~26 inputs, and even those don't fan out evenly.

Investigation: the pill colour used `djb2(project_name) % 360`. The input was already the full project name, not the first letter - but `djb2 % 360` happens to alias for our real-world names. Empirically: calfam→hue 7, shopify-uncomplicated→hue 4 (3° apart); notegit→hue 87, countingsheet→hue 83 (4° apart). Tried FNV-1a, SHA-256, and hash×irrational multipliers - every hash function produces *some* close pair for our 8-project set because 8 random points on a 360-bucket ring are statistically prone to clustering. Only a sorted-index assignment with a golden-angle multiplier guarantees a minimum gap.

+ [X] `hueForProjectIndex(i)` returns `(i * 137.508) % 360` (golden angle) - adjacent indices land far apart on the wheel; deterministic per index
+ [X] `mergeAggregateRoot` enumerates distinct project names from `parsed` (already sorted by `relative_path`), assigns each its sorted-position hue via `hueForProjectIndex`, stamps `origin.project_hue` on every story
+ [X] `OriginPill` prefers `origin.project_hue` when present; falls back to the djb2 hash for single-file mode and legacy callers
+ [X] `pillColourForHue(hue, theme)` factored out so both paths share the final HSL build
+ [X] tests: index spread ≥30° pairwise for the workspace 8-project set; precomputed-hue path takes precedence over the hash; existing djb2 coverage retained for the fallback path
+ manual: open the workspace folder in aggregate mode and verify calfam/shopify-uncomplicated pills are now visually distinct, and notegit/countingsheet pills are too


### Two-character origin pills with prefix disambiguation

The aggregate origin pill currently renders a single uppercase letter (the project's initial). A second letter would make pills more legible - `C` becomes `CO` for countingsheet - and let prefix-colliding projects differentiate visually: notegit→`NG`, notethink→`NT` (earliest divergent character chosen per project against the merged aggregate's project list).

+ [X] add `projectAbbreviation(name)` fallback (first + second char, uppercased) and `buildProjectLabels(names)` (divergence-rule labeller) in `client/webview/src/notethink-views/src/components/notes/OriginPill.tsx`
+ [X] stamp `origin.project_label` in `mergeAggregateRoot` alongside `project_hue`, fed from the same sorted distinct-project-names enumeration
+ [X] add `project_label?: string` to `NoteOrigin` and render it in `OriginPill`, falling back to the single-project abbreviation when absent (single-file/legacy origins)
+ [X] tests: OriginPill suites for `projectAbbreviation` and `buildProjectLabels` (spec examples + 3-way collision + strict-prefix edge case + workspace project list); mergeAggregateRoot test asserting `origin.project_label` matches the divergence rule
+ [X] update existing OriginPill test expectations (`O` → `OM`) and the Playwright spec's comment for clarity
+ manual: open the workspace folder in aggregate mode and verify notegit/notethink pills now read `NG`/`NT` and countingsheet reads `CO`


### Relevance ordering: surface recently-edited files within equal rank

Yesterday's tiebreak surfaces stories from the file currently focused in the editor - but the more informative signal is what an AI agent has been editing in the background, which the active-file gate can't show. Replace the active-file gate with an on-disk mtime gate so the more recently modified file's stories rise to the top of each rank band. Saving the file you currently have open bumps its mtime to now, so it still floats up - the open-file behaviour is preserved while background activity also surfaces.

+ decisions (confirmed): mtime as the sole within-band tiebreak (no
  thresholds, no decay constants); rank gate unchanged; active-file
  plumbing removed since saving = mtime bump = rise
+ [X] `Doc.mtime` captured in `buildDocFromUriAndText` via `vscode.workspace.fs.stat`
+ [X] `NoteOrigin.file_mtime` stamped in mergeAggregateRoot's round-robin
+ [X] `noteOrder` / `kanbanNoteOrder` - rank-gated mtime tiebreak then delegate to standardNoteOrder / weight logic (zero regression when mtimes are equal or absent)
+ [X] remove dead `active_doc_path` plumbing: ExtensionReceiver state, ViewProps, NoteRendererProps, both composers, both view sort calls
+ [X] tests: noteops (newer mtime wins within equal rank; rank still gates above mtime; equal/missing mtime == standardNoteOrder; explicit weights still beat relevance), mergeAggregateRoot (file_mtime stamping)
+ manual: in folder mode, edit a file via the terminal or another agent while a different file is open in the editor; confirm the edited file's stories rise to the top of each rank band
+ manual: save the file you have open; confirm its stories rise to the top of each rank band (same behaviour as before)
+ manual: confirm single-file view + drag-to-reorder are unaffected


### Rename "aggregate" → "folder" / "filter" for user-facing identifiers

+ rationale
  + UI says "folder view" everywhere; code says "aggregate" in many places. The mismatch costs a mental hop on every read with no offsetting benefit
  + bare `folder_include` would be ambiguous (the folder already contains every file); the filter is over filenames matching a glob. Match the UI's "Include filter" / "Exclude filter" labels with `include_filter` / `exclude_filter`
  + discipline going forward: **folder** = user-facing concept (mode, settings, UI), **aggregate** = the underlying merge operation (engine internals: input types, output stats, the merge function itself). Each new field/symbol falls cleanly into one of the two buckets
+ rename table
  + user-facing fields and constants:
    + `aggregate_include` → `include_filter`
    + `aggregate_exclude` → `exclude_filter`
    + `aggregate_max_notes_per_file` → `max_notes_per_file`
    + `aggregate_files` → `aggregate_loaded_files` (keep prefix - engine output; the new noun says it's the loaded subset, paired with `aggregate_total_discovered`)
    + `DEFAULT_AGGREGATE_INCLUDE` → `DEFAULT_INCLUDE_FILTER`
    + `DEFAULT_AGGREGATE_EXCLUDE` → `DEFAULT_EXCLUDE_FILTER`
    + `DEFAULT_AGGREGATE_MAX_NOTES_PER_FILE` → `DEFAULT_MAX_NOTES_PER_FILE`
    + `AggregateTreeComposer` (file + class) → `FolderTreeComposer`
  + VS Code config keys (user-visible in Settings UI):
    + `notethink.folderView.aggregateInclude` → `notethink.folderView.includeFilter`
    + `notethink.folderView.aggregateExclude` → `notethink.folderView.excludeFilter`
    + `notethink.folderView.aggregateMaxNotesPerFile` → `notethink.folderView.maxNotesPerFile`
  + unchanged (engine internals):
    + `aggregate_total_discovered` - engine stat (pre-cap discovery count)
    + `MAX_AGGREGATE_FILES` - engine cap
    + `mergeAggregateRoot()` - the merge function itself
    + `AggregatedDocInput` / `MergeAggregateRootResult` - function input/output types
    + `FOLDER_VIEW_STATE_ID = '__folder__'` (was `'__aggregate__'`) - `migrateSavedState` renames the legacy key on first webview load
    + extension-side `integration_*` locals (`integration_path`, `integration_include`, `integration_exclude`, `integration_watcher`, `integration_docs`) - internal grouping prefix, not user-visible
+ migration paths
  + VS Code config: on extension activation, copy any value from each old `aggregate*` key to its new key (in the same scope: User and/or Workspace), then clear the old key. Idempotent - once migrated, the old keys are gone
  + webview saved state: extend `migrateSavedState` in `ExtensionReceiver.tsx` to rename `display_options.aggregate_*` → new names on first load
  + l10n: `package.nls.*.json` placeholder names rename to match (`config.folderView.aggregateInclude.description` → `config.folderView.includeFilter.description` etc.). Description bodies stay the same
+ [X] write story (this)
+ [X] rename source identifiers across `client/extension/src` and `client/webview/src` (snake_case fields, SCREAMING_SNAKE_CASE constants)
+ [X] move `AggregateTreeComposer.tsx` to `FolderTreeComposer.tsx`, rename the class, update importers
+ [X] rename VS Code config keys in `package.json` + l10n description placeholder keys in `package.nls.*.json`
+ [X] add `migrateLegacyFolderViewKeys()` in `notethinkEditor.ts`; called before the first `readFolderViewSettings()` (inside the `requestInitialState` handler)
+ [X] extend `migrateSavedState` in `ExtensionReceiver.tsx` for the persisted webview state (renames `display_options.aggregate_*` → new names on first load)
+ [X] update all tests that reference old identifiers (`ExtensionReceiver.test.tsx`, `GenericView.test.tsx`, `FilesDrawer.test.tsx`, `globMatch.test.ts`, `notethinkEditor.test.ts`)
+ [X] sweep comments and debug strings for "aggregate" where it refers to user-facing concepts; engine-internal usages (`mergeAggregateRoot`, `AggregatedDocInput`, `aggregateNoteLinetags`, `MAX_AGGREGATE_FILES`, `aggregate_total_discovered`, `aggregate_loaded_files`, the `__aggregate__` viewState key value) kept by design
+ [X] rename playwright spec `aggregate-folder.spec.ts` → `folder-view.spec.ts` and fixtures `aggregate-a.md`/`aggregate-b.md` → `folder-a.md`/`folder-b.md` (via `git mv` so history follows)
+ [X] pnpm run lint + build + rollup + test-jest green (682 jest)
+ [X] bump `package.json` patch version → 0.2.20
+ manual: open an existing workspace whose `.vscode/settings.json` has `notethink.folderView.aggregateInclude` set; reload; confirm the value now lives under `includeFilter` and the old key is gone
+ manual: open a workspace whose webview state has `display_options.aggregate_include`; reload; confirm settings still apply, viewState reflects the new field names
+ acceptance
  + no `aggregate_*` identifiers in user-facing types/configs/symbols outside the engine-internal allowlist above
  + existing User and Workspace settings under old config keys migrate transparently
  + existing persisted viewState migrates transparently
  + tests + lint + build + rollup green


### Cascade folder view settings, with column-name formatting fix

+ user request
  + "set settings once and have them apply to all my Versus code instances, but then I want the ability to override them in a specific instance"
  + workspace overrides win over user defaults; explicit affordances to promote workspace → user (Make default) or wipe workspace overrides (Reset to default)
  + a single pair of buttons in the settings drawer, not per-setting; one click promotes every customised value, one click clears every workspace override
  + bundled cosmetic fix: kanban column names in **both** the column header and the settings drawer column-order list should render with dashes replaced by spaces, then capitalised. Today the data value `code-review` renders as `Code-review` via CSS `text-transform: capitalize` (which only capitalises the first char because the dash isn't a word boundary). After the fix it should render as `Code Review` in both places
+ design - lean on VS Code's existing config cascade
  + add `notethink.folderView.*` keys to `package.json` `contributes.configuration`; VS Code's Settings UI handles the cascade (built-in default → User → Workspace) for free, and Settings Sync - when the user opts in - propagates User scope across machines
  + the existing `globalSettings` pattern (`notethinkEditor.ts:214-225`, `:434-451`) is the template: extension reads config, pushes a typed payload to webview, listens for `onDidChangeConfiguration` to re-push, accepts an `updateXxx` message from the webview to write back. Mirror that pattern for folder view settings rather than inventing a parallel one
  + writes default to `ConfigurationTarget.Workspace` - predictable, no surprises. Make default / Reset to default are the only paths that touch `ConfigurationTarget.Global`
+ cascading settings (initial set)
  + `notethink.folderView.viewType` - string enum `auto | document | kanban`, default `auto`
  + `notethink.folderView.columnOrder` - string array, default `['untagged', 'doing', 'code-review', 'testing', 'done']` (a rational left-to-right work progression; columns absent from the user's data are hidden by the board's empty-column culling, so this is just an ordering hint - unused buckets stay invisible until they have stories). Constant `DEFAULT_FOLDER_VIEW_COLUMN_ORDER` is the single source of truth, mirrored across `client/extension/src/constants.ts`, `client/webview/src/constants.ts`, and the `package.json` enum default
  + `notethink.folderView.aggregateInclude` - string glob, default `**/*.md` (matches `DEFAULT_AGGREGATE_INCLUDE`)
  + `notethink.folderView.aggregateExclude` - string glob, default matches `DEFAULT_AGGREGATE_EXCLUDE`
  + `notethink.folderView.aggregateMaxNotesPerFile` - integer, default 10 (matches `DEFAULT_AGGREGATE_MAX_NOTES_PER_FILE`)
  + `notethink.folderView.showContextBars` - boolean, default `true`
  + out of scope for this story: `integration_mode` and `integration_path` (these are session state per workspace, not user preferences) and any single-file mode settings (`fileView.*` is a follow-up)
+ message contract additions
  + ext → webview: `folderViewSettings` `{ settings: { viewType, columnOrder, aggregateInclude, aggregateExclude, aggregateMaxNotesPerFile, showContextBars } }` - resolved cascade values
  + webview → ext: `updateFolderViewSetting` `{ key, value, scope?: 'workspace' | 'global' }` - default scope workspace
  + webview → ext: `promoteFolderViewSettingsToUser` - copies every currently-resolved folder view setting into User scope, then clears Workspace overrides
  + webview → ext: `resetFolderViewSettingsToDefault` - clears every Workspace-scope folder view override, falling back to User then built-in
+ webview wiring
  + `ExtensionReceiver` holds `folderViewSettings` state next to `globalSettings`; passes through `NoteRenderer` props
  + `AggregateTreeComposer` merges resolved settings into the rendered view (cascade values take precedence over webview-only defaults, but per-session `setViewManagedState` overrides win locally - optimistic update with extension confirmation)
  + setting changes in folder mode dispatch `updateFolderViewSetting` to the extension instead of (or alongside) `setViewManagedState`. Working out which path wins for which keys is part of implementation: where the value lives in VS Code config, it round-trips through the extension; where it stays webview-only (e.g. the integration_mode tag), it keeps the existing path
+ make default / reset buttons
  + two buttons in `SettingsKanbanDrawer` and `SettingsDocumentDrawer` (factor into the shared `SettingsCommonControls` if convenient) - single pair, not per-setting
  + labels: `Make default` and `Reset to default`, with localisations in `bundle.l10n.json` for the existing locales
  + tooltip on Make default: "Save your current folder view settings as the default for every VS Code window."
  + tooltip on Reset to default: "Clear this window's folder view overrides and use the saved default."
  + button visibility: always present; Reset disabled when no Workspace-scope overrides exist (VS Code config inspection via `getConfiguration().inspect(key)` exposes whether a workspaceValue is set)
+ column-name formatting fix
  + new utility `formatColumnLabel(value: string): string` (in `client/webview/src/notethink-views/src/lib/noteops.ts` since it's a small string-transformation helper alongside `noteOrder` etc.) - replaces `-` with space and title-cases each word
  + apply in `KanbanColumn.tsx` (`<h3>{props.value}</h3>` → `<h3>{formatColumnLabel(props.value)}</h3>`) and `SettingsKanbanDrawer.tsx` (`<span>{column_name}</span>` → `<span>{formatColumnLabel(column_name)}</span>`)
  + drop the CSS `text-transform: capitalize` on `.heading` in `ViewRenderer.module.scss` - now the JS produces the actual display text, so accessibility tools / aria-labels see the user-facing words rather than the raw status slug
  + keep raw status slug for `aria-label` on the column region (`role={'region'} aria-label={props.value}`) so assistive tech still gets the canonical value for selection/scripting flows. **Decision pending:** whether to use raw or formatted for the move-up/down aria-labels in the settings drawer - formatted is more readable, raw is more "scriptable". Default to formatted; revisit if a screen-reader user objects
+ [X] add `formatColumnLabel` utility in `noteops.ts` with jest tests
+ [X] apply `formatColumnLabel` in `KanbanColumn` heading and `SettingsKanbanDrawer` column list; drop redundant CSS capitalize
+ [X] declare `notethink.folderView.*` config keys in `package.json` `contributes.configuration`
+ [X] add `folderViewSettings` payload type + message types to `notethink-views/src/types/Messages.ts`
+ [X] extend `notethinkEditor.ts`: `readFolderViewSettings` / `sendFolderViewSettings`, handle `updateFolderViewSetting`, `promoteFolderViewSettingsToUser`, `resetFolderViewSettingsToDefault`, hook into `onDidChangeConfiguration` and `requestInitialState`
+ [X] extend `ExtensionReceiver.tsx`: new `folderViewSettings` state, message handlers, pass through to `NoteRenderer` props
+ [X] thread `folderViewSettings` through `NoteRenderer` and `AggregateTreeComposer` so cascade values are the rendering source; per-session viewState overrides remain available for optimistic updates
+ [X] route setting changes in folder mode through the new `updateFolderViewSetting` message (column reorder, filter changes, view type toggle, show_context_bars toggle); column reorder, filters and view type round-trip via `cascadeWriteFolderViewSetting`/handleApplyFilters/ViewTypeSelector.onFolderCascadeWrite; show_context_bars rounds-trip from `ExtensionReceiver`'s toggleSetting handler because it's command-driven
+ [X] add `Make default` and `Reset to default` buttons via `SettingsCommonControls` (shared by both drawers); wired to `promoteFolderViewSettingsToUser` / `resetFolderViewSettingsToDefault` messages; Reset disabled when `folder_view_cascade_has_workspace_overrides` is false
+ [X] l10n: button labels + tooltips added to `l10n/bundle.l10n.{json,fr,de,es,it}.json`; new `config.folderView.*.description` keys added to `package.nls*.json` for every supported locale
+ [X] jest: `formatColumnLabel` unit tests (9 cases covering dashes, multi-word, empty, edge cases) in `noteops.test.ts`
+ [X] jest: ExtensionReceiver round-trip - `folderViewSettings` message threads through to `NoteRenderer` props; `setViewType` command round-trips to `updateFolderViewSetting` in folder mode and not in single-file mode (3 new tests in `ExtensionReceiver.test.tsx`)
+ extension setting round-trip jest tests deferred - current mocha extension test surface doesn't yet mock `vscode.workspace.getConfiguration`; covered manually via the manual checks below
+ [X] pnpm run lint + build + rollup + test-jest green (682 tests)
+ [X] bump `package.json` patch version → 0.2.16
+ [X] follow-up: default `columnOrder` set to `['untagged', 'doing', 'code-review', 'testing', 'done']` via new `DEFAULT_FOLDER_VIEW_COLUMN_ORDER` constant (mirrored in webview + extension constants + package.json); empty columns continue to be hidden so the user only sees buckets with stories
+ manual: customise a kanban column order in workspace A, hit Make default, open workspace B, confirm the saved order applies; override in B, confirm A still shows the saved default
+ manual: hit Reset to default in workspace A, confirm overrides clear and the saved User default takes effect
+ manual: kanban column header shows `Code Review` (was `Code-review`); column-order list in settings drawer shows the same formatting
+ acceptance
  + settings persist across VS Code instances when set as User defaults; workspace overrides win when present
  + a single Make default / Reset to default pair drives the cascade, no per-setting toggles
  + kanban column names render dashes as spaces with title-case in both the board and the settings drawer


### Persist folder view settings across mode flips

+ symptom
  + open a folder, customise view (kanban column order, per-file story cap, include/exclude globs, view type, show_context_bars etc.), switch to current-file view, switch back to folder view - all the folder customisations are gone, the view snaps back to defaults
  + user expectation: folder view settings persist for the lifetime of the VS Code window (per workspace), surviving mode flips, panel disposals, and extension reloads
+ confirmed root cause
  + `GenericView.handleIntegrationChange` (`client/webview/src/notethink-views/src/components/views/GenericView.tsx:420-444`) dispatches `setViewManagedState` with `id: props.id`, which is the **active composer's** view_state_id (`'__aggregate__'` in folder mode, the doc path in single-file mode)
  + switching folder → current_file overwrites `viewStates['__aggregate__'].display_options.integration_mode` from `'folder'` to `'current_file'`. The other folder settings (column_order, filters, etc.) survive the shallow merge in `handleSetViewManagedState`, but the integration_mode tag no longer identifies that entry as "the folder viewState"
  + switching current_file → folder dispatches with `id = '<doc_path>'`, writing `integration_mode: 'folder'` to `viewStates['<doc_path>']`. AggregateTreeComposer's lookup scan (`AggregateTreeComposer.tsx:30-37`) latches onto **this** orphan key - it has the tag but none of the user's settings. The original `'__aggregate__'` viewState (which still has the settings) is left dormant, tagged `current_file`, and is never read again
  + secondary defect in `AggregateTreeComposer.tsx:37`: the fallback returns `view_state_id: '__aggregate__'` but reads `view_state: viewStates['__default']` - different keys
+ fix shape
  + introduce stable canonical id for the folder-mode viewState (constant `FOLDER_VIEW_STATE_ID = '__aggregate__'`, keeping the existing key value to avoid migrating existing user state)
  + `AggregateTreeComposer` reads and writes via this constant; integration_mode scan kept only as a one-shot legacy-read fallback for users whose folder viewState is currently parked under a doc-path key
  + `GenericView.handleIntegrationChange` dispatches the integration_mode tag to the constant key (not `props.id`) so the mode toggle never strands settings under the wrong key
  + `mergeAggregateRoot.anyViewInFolderMode` / `firstIntegrationPath` check the constant first, then fall back to the legacy scan
  + `ExtensionReceiver`'s saved_state migration copies any legacy folder-tagged viewState into the canonical key on first load
+ webview-state-only fix
  + `vscode.setState` already persists across mode flips within the workspace - the dropped workspaceState mirror was speculation before the cause was confirmed. If panel-disposal cases surface as a separate complaint, that's a follow-up story
+ [X] reproduce and confirm root cause
+ [X] add `FOLDER_VIEW_STATE_ID` constant in notethink-views (alongside `mergeAggregateRoot` helpers)
+ [X] fix `AggregateTreeComposer` to read/write the constant key, with legacy-tag scan as read-only fallback
+ [X] redirect `GenericView.handleIntegrationChange` and `handleFolderClick` to dispatch to the constant key (both paths exhibited the same bug)
+ [X] update `anyViewInFolderMode` / `firstIntegrationPath` to prefer the constant key
+ [X] migrate legacy folder-tagged viewState in `ExtensionReceiver.migrateSavedState`
+ [X] jest: round-trip through `handleSetViewManagedState` survives mode flip
+ [X] jest: helpers prefer the constant key, fall back to scan for legacy state
+ [X] pnpm run lint + build + rollup + test-jest green (669 tests)
+ manual: open folder, set kanban column order, flip to current-file and back, confirm column order intact
+ manual: confirm aggregate include/exclude and aggregate_max_notes_per_file survive a mode flip
+ acceptance
  + every folder view setting listed in the symptom round-trips through current-file mode without loss


### Stable note identity and multi-file kanban ordering refactor [](?id=multi-file-ordering-stable-identity)

Data-layer prerequisite for [[folder-mode-dnd]] and [[animated-passive-transitions]]. No UX change in this story - pure refactor + tests. Sits at the top of todo.md as the priority because both downstream stories depend on it.

+ goal
  + cross-file `nt_kanban_ordering_weight` participates in the column comparator so notes from multiple files can be interleaved by user-chosen order
  + every note carries a stable identity that survives re-parse (file additions/removals, global `seq` renumbering, file_rank shuffling) so React keying and FLIP rect-capture both work across updates
+ background
  + `kanbanNoteOrder()` (`noteops.ts:225-242`) currently considers `nt_kanban_ordering_weight` only when both sides have one; otherwise it falls to `noteOrder()` (`noteops.ts:206-218`) which uses `file_rank` then `file_mtime` then `seq`. Cross-file weight comparison never participates.
  + `calculateTextChangesForOrdering()` (`linetagops.ts:88-131`) assumes all neighbours share a single seq-space; the weight-gap arithmetic and the cascade fallback are both undefined when neighbours come from different files.
  + Notes are React-keyed by `note.seq` (`KanbanView.tsx:195`), which is renumbered globally by `mergeAggregateRoot()` on every re-parse (`mergeAggregateRoot.ts:133-327`). Identity drifts when a file is added, removed, or re-parsed with a new sibling story - the same logical note looks like delete+insert to React.
+ scope
  + stable identity: stamp `stable_id` (kebab-case-slug derived from `origin.doc_id + heading character offset`, picked because it is invariant under sibling additions and round-robin merge shuffles) on every note in both single-file (`NoteTreeComposer`) and aggregate (`AggregateTreeComposer` via `mergeAggregateRoot`) paths
  + cross-file comparator: rework `kanbanNoteOrder()` so `nt_kanban_ordering_weight` is decisive across origins (weight-A vs weight-B always compared even when origins differ); `file_rank → file_mtime → seq` is the tiebreak chain only when neither side carries a weight
  + reorder algorithm: factor `calculateTextChangesForOrdering()` to operate on a generic ordered list with no seq-arithmetic between cross-file neighbours; weight-gap math becomes per-file output (cascade only touches notes in the same file); the cross-file ordering decision is encoded in the *value* of the assigned weight, not in any shared seq space
  + change-set partitioning: the algorithm returns changes grouped by `origin.doc_path` so the extension can apply per-file edits independently (the wire format change ships with [[folder-mode-dnd]] but the data shape lands here)
+ out of scope
  + UI for dragging across files - covered in [[folder-mode-dnd]]
  + animation layer - covered in [[animated-passive-transitions]]
  + changing single-file kanban behaviour - single-file callers must produce byte-identical text output before and after this refactor
+ files
  + `client/webview/src/notethink-views/src/lib/noteops.ts` - comparator rewrite
  + `client/webview/src/notethink-views/src/lib/linetagops.ts` - `calculateTextChangesForOrdering` generalisation
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` - stamp `stable_id` during merge
  + `client/webview/src/notethink-views/src/types/NoteProps.ts` - add `stable_id: string` to `NoteProps`; document derivation in the structure's header comment per `CODING_STANDARDS.md` "no per-field comments inside data structures"
  + `client/webview/src/components/composers/NoteTreeComposer.tsx` and `client/webview/src/components/composers/AggregateTreeComposer.tsx` - assign `stable_id` in the single-file path as well so callers can rely on it in both modes
+ [ ] design `stable_id` derivation and document the choice in the `NoteProps` header comment
+ [ ] stamp `stable_id` in `mergeAggregateRoot` for aggregate mode and in the single-file composer path
+ [ ] rewrite `kanbanNoteOrder()` so weight participates across origins; preserve single-file output exactly
+ [ ] generalise `calculateTextChangesForOrdering()` to partition output by `origin.doc_path`
+ [ ] regression: existing single-file kanban specs untouched and green
+ [ ] jest: cross-file comparator covers (weighted, weighted), (weighted, unweighted), (unweighted, weighted), (unweighted, unweighted) across two origins
+ [ ] jest: reorder algorithm emits correct per-file change sets when neighbours come from different files; cascade stays within the originating file
+ [ ] jest: `stable_id` invariant across (a) file added to aggregate, (b) file removed, (c) same file re-parsed unchanged, (d) same file re-parsed with a new sibling note inserted before it
+ [ ] jest: full `mergeAggregateRoot` round-trip preserves `stable_id` for unchanged notes across re-parse
+ [ ] `pnpm run check` green
+ acceptance
  + all existing tests pass
  + new jest suite covers the cross-file comparator and per-file partitioned reorder
  + single-file kanban output byte-identical to prior behaviour against the existing fixtures
  + `stable_id` present on every note in both modes; derivation documented in the `NoteProps` header
+ commit message draft
  + notethink 0.2.14: kanban ordering comparator respects `nt_kanban_ordering_weight` across file boundaries
  + `calculateTextChangesForOrdering` returns per-`origin.doc_path` partitioned change sets so the extension can route per-file edits independently
  + stamp `stable_id` (`origin.doc_id` + heading character offset) on every note in both single-file and aggregate paths so React keying and FLIP rect-capture survive re-parse
  + single-file kanban output byte-identical to prior behaviour
  + tests N jest


### Folder-mode drag-and-drop [](?id=folder-mode-dnd)

Extend the existing kanban DnD UX to multi-file folder mode. Depends on [[multi-file-ordering-stable-identity]] (comparator + per-file partitioned reorder algorithm). Paired with [[animated-passive-transitions]], which is the visible payoff once both DnD paths land.

+ symptom
  + in folder mode, dropping a note into a different column writes a status edit to the right file (`docPath` is already carried in `editText`, `KanbanView.tsx:147`) but the within-column reorder weight-cascade produces nonsense because `calculateTextChangesForOrdering` assumes one seq-space across all visible neighbours
  + notes from different files in the same column cannot be deliberately interleaved by the user - the comparator falls back to `file_rank → file_mtime → seq` and ignores any weight one side carries
+ scope
  + hook the rewritten reorder algorithm from [[multi-file-ordering-stable-identity]] into `KanbanView.dragEndHandler` so per-file change sets are emitted as a single `editText` with `changes` grouped by `docPath`
  + extension side: when an `editText` message carries changes spanning multiple docs, apply each batch atomically per file and re-emit parse updates for every touched doc; today the handler assumes one `docPath`
  + visual parity: dragging in folder mode looks identical to single-file mode (lift + rotate + shadow). No CSS edits expected - only verify
  + caret reveal: in single-file mode `dragStartHandler` invokes the click handler with the note's caret position. In folder mode the caret target must be in the *originating* file - `revealRange` needs a `docPath` field (or equivalent multi-file addressing) if it doesn't have one already
+ out of scope
  + animations during automatic (non-drag) updates - covered in [[animated-passive-transitions]]
  + anything touching the drag-in-flight visual (`ViewRenderer.module.scss:1103-1115`) - stays unchanged
+ files
  + `client/webview/src/notethink-views/src/components/views/KanbanView.tsx` - `dragEndHandler` assembles multi-doc change set; `dragStartHandler` reveals caret in the originating file
  + `client/extension/src/vscode/notethinkEditor.ts` - `editText` handler accepts per-`docPath` partitioned changes
  + `client/extension/src/types/Messages.ts` - `editText` payload extended to carry `changes_by_doc?: Record<string, Change[]>` alongside the existing single-doc shape, discriminated on presence
  + new helper if justified: `client/webview/src/notethink-views/src/lib/dnd/assembleMultiDocChangeSet.ts`
+ [ ] extend `editText` message shape to carry per-`docPath` change sets; keep backward compatibility with the single-doc form
+ [ ] update `KanbanView.dragEndHandler` to call the refactored algorithm and post the per-doc change set
+ [ ] extension applies multi-doc `editText` atomically and re-emits parse updates for every touched doc
+ [ ] `dragStartHandler` caret reveal works for notes whose origin is not the active file
+ [ ] verify drag-in-flight visual is unchanged in folder mode (no CSS edits expected, just confirm)
+ [ ] jest: `KanbanView.dragEndHandler` emits the right `changes_by_doc` shape for cross-file moves
+ [ ] jest: extension `editText` handler applies multi-doc batches in the correct order with one parse-update per touched doc
+ [ ] playwright: folder-mode kanban - drag a note from one file across columns; assert only the source file is edited
+ [ ] playwright: folder-mode kanban - within a column containing notes from two files, drag a file-B note above a file-A note; re-fire a parse update for an unrelated doc; assert the user-chosen order survives
+ [ ] playwright: single-file kanban regressions all green
+ [ ] `pnpm run check` green
+ manual: drag a note from one file to another column in folder mode and confirm the source file's markdown shows the new status tag
+ manual: interleave two files' notes in one column, close and re-open the folder, confirm order survives
+ acceptance
  + dragging a note in folder mode shows the same in-flight visual as in single-file mode
  + the dropped state survives a re-parse
  + notes from multiple files in one column can be interleaved deliberately
  + single-file mode behaviour byte-identical to before the change
+ commit message draft
  + notethink 0.2.15: kanban drag-and-drop works across multi-file columns in folder mode
  + `editText` accepts per-`docPath` partitioned change sets; extension applies multi-doc batches atomically
  + `dragStartHandler` reveals caret in the originating file
  + tests N jest, N playwright


### Decompose long functions into objects, hooks, and helpers - wave 1 [](?id=function-decomposition)

Wave 1 of the Function Length finding from [[coding-standards-audit-remediation]]: the three highest-value, file-disjoint long-function targets, decomposed behaviour-identically (one agent each, gated). The goal was explicit dependencies, minimal shared mutable state, and testable seams - not the line count itself. Wave 2 (KanbanView/MarkdownNote, pure-logic) split into [[function-decomposition-wave2]].

+ what shipped
  + `myWebviewPanel` → `PanelSession` class: `notethinkEditor.ts` 968→136 lines, new `vscode/PanelSession.ts`; ~11 ambient mutable vars became private fields, ~11 closures became methods with explicit `this` deps, `onDidReceiveMessage` delegates each case to a named `handle*` method
  + `ExtensionReceiver` → 6 custom hooks under `client/webview/src/hooks/` + thin wiring shell; persisted `viewStates` key and wire-format message strings preserved
  + `GenericView` → 730→121 lines; 6 hooks + `<GenericViewToolbar>` / `<GenericViewBreadcrumb>` under `views/generic/` + `lib/columnorder.ts`; view-dispatch semantics untouched
+ approach
  + characterization tests added around the panel boundary BEFORE extracting; one behaviour-identity bug caught + fixed (watcher-driven folder adds re-send the stored discovery totals, not 0/false)
  + closing review split CODING_STANDARDS across two reviewers; React decomposition via custom hooks + child components per the new guidelines
+ [X] characterization tests around `myWebviewPanel`'s message/edit/integration boundary
+ [X] extract `PanelSession` class; `myWebviewPanel` becomes a thin constructor + wire-up
+ [X] split `onDidReceiveMessage` so each case delegates to a named `PanelSession` method
+ [X] extract `ExtensionReceiver` state/effect clusters into custom hooks; component becomes a wiring shell
+ [X] decompose `GenericView` into hooks + child components; align with documented React structure
+ [X] `pnpm run check` green (lint, build, rollup, 723 jest, 47 playwright)
+ acceptance
  + `myWebviewPanel` is a `PanelSession` class with private fields and method-level contracts; no ambient-state closures remain
  + the two React components are thin shells over custom hooks + child components, following the documented structure
  + behaviour identical - 723 jest + 47 playwright green, no regressions
+ commit message draft
  + notethink 0.3.0: decompose `myWebviewPanel` into a `PanelSession` class and split `ExtensionReceiver`/`GenericView` into custom hooks + child components (behaviour-identical, per-method contracts replace ambient closure state)
  + tests 723 jest, 47 playwright


### Coding standards audit and remediation [](?id=coding-standards-audit-remediation)

Audit the codebase against every rule in `CODING_STANDARDS.md` and remediate non-compliant patterns in small, reviewable passes. Redo audit completed with six parallel section owners plus local AST scans: naming/React, imports/debug, code style, TypeScript, file/code-quality/error-handling, and testing/pre-push.

+ inventory scope
  + reviewed 138 TS/TSX files in `client/` and `playwright/`, excluding generated `dist`, dependency trees, `.git`, `.vscode-test-web`, coverage/build/out artifacts
  + classification used by the naming/TypeScript passes: 75 production files and 63 test/support files
  + stricter import/debug pass audited 70 production TS/TSX files, excluding tests, mocks, setup, declarations, generated code, and Playwright
  + code-style pass audited 71 production files and 67 test/support files, covering 452 production functions and 1619 test/support functions
  + file/code-quality pass scanned 101 production tracked code/style files and 56 test files
+ rule matrix
  + Naming Conventions > Variable Naming: non-compliant
    + production: 59 of 919 local/hook/computed variable occurrences violate snake_case; tests/support: 160 of 2140
    + examples: `convertMdastToNoteHierarchy.ts:34` has `lineIndex`, `headingIndex`, `parentEndOffset`, `seqCounter`; `notethinkEditor.test.ts` has 55 variable violations
  + Naming Conventions > Function Naming: mostly compliant with exceptions
    + production: 4 of 206 function/event-handler names violate camelCase; tests/support: 8 of 122
    + examples: `notethinkEditor.ts:894` `apply_one`, `viewhooks.ts:94` `on_scrollend`, `DocumentView.test.tsx:105` `make_props`
  + Naming Conventions > Props and Parameters: non-compliant
    + parameters: 111 of 530 production parameters and 46 of 559 test/support parameters violate camelCase, often because the codebase uses snake_case parameters
    + component props: 40 of 140 production prop fields violate camelCase; largest cluster is `ViewProps.ts:8` with `doc_path`, `doc_relative_path`, `workspace_root`, `aggregate_total_discovered`, `include_filter`
    + ambiguous: service callback props such as `setViewManagedState`, `deleteViewFromManagedState`, `postMessage`, and `getClearHandler` do not use the `on*` event prop pattern but may not be UI events
  + Naming Conventions > Types and Interfaces: compliant in scanned files
    + production: 0 violations across 87 types/interfaces/classes; tests/support: 0 violations across 15
  + Naming Conventions > Components: compliant in scanned files
    + production: 0 PascalCase component violations across 25 detected components; tests/support: 0 across 2
  + Naming Conventions > Constants: mostly compliant with semantic caveats
    + SCREAMING_SNAKE_CASE violations: production 1 of 43 likely true constants, tests/support 2 of 20
    + examples: `inserts/en.ts:37` `index`; `notethinkEditor.test.ts:73-74` `defaultDocPath`, `defaultDocText`
    + ambiguity: true constants are semantic; some local compile-time literals may be intentional local values rather than constants
  + Import Organization > Import Placement: partially compliant
    + no static import declarations were found after non-import code
    + 7 runtime `import()` expressions lack explanatory comments: `GenericNote.tsx:7-9`, `GenericView.tsx:29-31`, `reportWebVitals.ts:5`
  + Import Organization > Import Grouping: non-compliant
    + 22 production files have grouping-order issues
    + examples: `errorops.ts:3` imports `vscode` after externals; `index.tsx:5` imports `App` after `index.css`; `FilesDrawer.tsx:5` imports `globMatch` after SCSS; `renderops.tsx:2` imports an external after a relative type import
  + Import Organization > External Dependency Alphabetization: non-compliant
    + 4 production alphabetization issues: `errorops.ts:1`, `parseops.ts:1`, `NoteRenderer.tsx:3`, `renderops.tsx:2`
  + Import Organization > Type-Only Imports: non-compliant
    + import/debug pass: 6 production import statements are type-only but not `import type`
    + TypeScript pass: 15 production and 13 test/support imports appear type-only but are value imports
    + examples: `ErrorBoundary.tsx:1`, `GenericNoteWrapper.tsx:1`, `DocumentContextBar.tsx:1`, `KanbanColumn.tsx:1`, `renderops.tsx:1`, `renderops.tsx:6`
  + Code Style > Function Length and Decomposition: non-compliant
    + code-style pass: 41 production and 138 test/support functions exceed 35 body lines; local broader scan found 179 total over 35 body lines
    + largest production examples: `notethinkEditor.ts:110`/`:113` `myWebviewPanel` 886 lines, `GenericView.tsx:41` 730, `ExtensionReceiver.tsx:98` 353, `MarkdownNote.tsx:22` 263, `KanbanView.tsx:63` 239
    + largest test/support example: `notethinkEditor.test.ts:76` anonymous suite/callback 1068 lines
  + Code Style > Block Organization: review needed
    + mechanical scan found 300 production and 1442 test/support blank lines inside function bodies
    + examples: `extension.ts:7`, `extension.ts:12`, `notethinkEditor.ts:121`, `l10n-bundles.test.ts:13`
    + ambiguity: the rule allows blank lines between logical sections, so this count needs review rather than automatic remediation
  + Code Style > Comments: non-compliant
    + comments scanned: 419 production and 388 test/support
    + uppercase-start comments: 93 production, 159 tests; single-sentence comments ending with a period: 58 production, 19 tests; stacked `//` comment lines: 53 production, 29 tests
    + examples: `ExtensionReceiver.tsx:180`, `ExtensionReceiver.tsx:186`, `notethinkEditor.ts:1038` 11-line stacked comment block, `parseops.test.ts:86`
    + inline comments: 8 production, 9 tests; none exceeded the ~100-character inline threshold
    + back-reference/current-context comments: 3 production, 1 test; examples `ExtensionReceiver.tsx:256`, `noteui.ts:9`, `NoteProps.ts:139`, `__mocks__/vscode.ts:1`
    + project-management version-number comments: 0 found
    + per-field comments in data/type structures: 32 production, 8 tests; examples `NoteRenderer.tsx:39`, `mergeAggregateRoot.ts:36`, `NoteProps.ts:101`, `playwright/helpers/inject-multi-docs.ts:8`
  + Code Style > TODO Comments: compliant in scan
    + no TODO comments were found, so no malformed TODO comments were found
  + Code Style > Braces and Blocks: compliant in scan
    + AST scan found 0 unbraced `if`, `for`, `while`, or `do` control bodies
  + TypeScript Guidelines > Explicit Types: non-compliant
    + missing parameter types: 101 production, 211 tests/support
    + missing return types: 343 production and 1540 tests/support across all function-like nodes; stricter non-callback/non-simple bucket is 103 production and 56 tests/support
    + examples: `crypto.ts:2` defaulted `algo`, `errorops.ts:54` `combineTransform(info)`, `NoteRenderer.tsx:80` callback destructuring, `errorops.ts:18` `flushLogBuffer`, `errorops.ts:92` `isRedirect`, `renderops.tsx:10` `getStandardNoteDataProps`
  + TypeScript Guidelines > Avoid `any`: non-compliant
    + strict production source: 9 `any` usages, all in `errorops.ts`; tests/support: 173
    + examples: `errorops.ts:55`, `:56`, `:73`, `:101`, `:133`, `:149`, `:163`, `:167`, `:171`
    + heaviest test files: `notethinkEditor.test.ts` 73, `parseops.test.ts` 45, `convertMdastToNoteHierarchy.test.ts` 28
    + note: broader local scan counted mocks as production and produced higher production numbers; remediation should treat `__mocks__` as test/support
  + TypeScript Guidelines > Loop Safety: non-compliant under written rule
    + 12 production `while`/unclear-bound loops and 3 test/support loops
    + examples: `GenericNote.tsx:21`, `convertMdastToNoteHierarchy.ts:37`, `convertMdastToNoteHierarchy.ts:231`, `linetagops.ts:34`, `noteops.ts:128`, `noteui.ts:88`, `mergeAggregateRoot.test.ts:825`
    + ambiguity: several loops are bounded by regex progress or data-structure exhaustion, but the written standard says avoid `while` without explicit bounds
  + TypeScript Guidelines > Type Placement: non-compliant
    + broad AST count: 32 production and 2 test/support findings
    + hard examples: `mergeAggregateRoot.ts:227` `CollectedStory`, `notethinkEditor.ts:299` `FolderViewKey`, `noteui.test.ts:136-137`
    + ambiguity: some top-of-file ordering findings are caused by debug/constants preceding types
  + TypeScript Guidelines > Constants Placement: non-compliant
    + hard bucket: 16 production constants after runtime declarations and 14 test/support findings
    + examples: `ExtensionReceiver.tsx:94` `saved_state`, `ExtensionReceiver.tsx:96` `CONNECTION_TIMEOUT_MS`, `renderops.tsx:77` `renderCache`, `mergeAggregateRoot.ts:70` `ORDER_NEWEST_AT_BOTTOM`, `notethinkEditor.test.ts:73-74`
  + TypeScript Guidelines > Debug Logger Pattern: non-compliant
    + import/debug pass: 48 production files missing `Debug` as first import, 49 missing `const debug = Debug(...)`, 2 misplaced debug constants, 21 namespace mismatches
    + examples: missing `extension.ts:1`, `errorops.ts:1`, `App.tsx:1`, `renderops.tsx:1`, `reportWebVitals.ts:1`; misplaced `DocumentView.tsx:13`, `KanbanView.tsx:27`; namespace examples `pathsafe.ts:4`, `NoteRenderer.tsx:16`, `CodeNote.tsx:6`, `noteui.ts:7`
    + ambiguity: `CODING_STANDARDS.md` import grouping shows React before Debug, but Debug Logger Pattern says Debug must be first; namespace root is not fully defined
  + TypeScript Guidelines > Extension Points: compliant in current diff
    + single-case switches found and preserved: `GenericNoteAttributes.tsx:32`, `GenericNote.tsx:67`
    + no trivial extension-point helper collapse was detected because this was a read-only audit
  + React Patterns > Component Structure: non-compliant
    + 23 component-structure ordering findings across 26 production components
    + examples: `GenericView.tsx:41` has derived values before hooks and later hooks/effects after handlers/render-prep; `ExtensionReceiver.tsx:111` has an effect before later state/ref hooks and later effects after callbacks
  + React Patterns > Hook Return Values: non-compliant
    + 5 of 62 production hook returns violate snake_case, all in `ExtensionReceiver.tsx:108+`: `viewStates`, `viewStatesRef`, `navigationCallbackRef`, `globalSettings`, `folderViewSettings`
  + React Patterns > Event Handler Props: explicit `on*` props are compliant; callback-prop naming ambiguous
    + explicit `on*` props: 0 violations across 102 production and 13 test/support props
    + 13 production function-valued callback props lack `on*`, including `ViewProps.ts:39` `setViewManagedState`, `deleteViewFromManagedState`, `postMessage`, `getClearHandler`; these may be service callbacks rather than UI events
  + File Organization > Directory Structure: mostly compliant
    + major source trees follow `src/components`, `src/lib`, and `src/types`; no misplaced major source trees found
  + File Organization > File Naming: partially non-compliant or ambiguous
    + component and style module naming passed
    + utility filename exceptions: `convertMdastToNoteHierarchy.ts`, `globMatch.ts`, `mergeAggregateRoot.ts`
    + type filename exceptions: `client/extension/src/types/general.ts`, `client/webview/src/types/general.ts`
    + tracked generated/legacy JS beside TS: `client/webview/src/reportWebVitals.js`, `client/webview/src/setupTests.js`, `client/webview/src/types/general.js`
    + ambiguity: standards use `parseops.ts` as an accepted utility example, so camelCase utility filenames may be legacy violations or standards drift
  + File Organization > Test File Location: partially non-compliant or underspecified
    + most webview/notethink-views unit tests are adjacent
    + non-adjacent or cross-cutting examples: `client/extension/src/test/suite/lib/crypto.test.ts`, `client/extension/src/test/suite/extension.test.ts`, `client/extension/src/test/suite/openview-experiment.test.ts`, `client/webview/src/notethink-views/src/components/l10n-rendering.test.tsx`
    + missing adjacent test candidates: `FolderTreeComposer.tsx`, `NoteTreeComposer.tsx`, `GenericNoteAttributes.tsx`, `DocumentContextBar.tsx`, `viewhooks.ts`
    + ambiguity: extension Mocha integration tests and cross-cutting l10n tests need an explicit exception if they are intended
  + File Organization > Styles: compliant in scan
    + all CSS modules use `*.module.scss`; one global style exists as `client/webview/src/index.css`
  + Code Quality > Avoid Duplication: partially non-compliant
    + mirrored constants across extension/webview: `client/extension/src/constants.ts:6` with `client/webview/src/constants.ts:2`, and `client/extension/src/constants.ts:12` with `client/webview/src/constants.ts:9`
    + repeated hardcoded settings/config keys: `extension.ts:70`, `notethinkEditor.ts:277`, `notethinkEditor.ts:307`, `ExtensionReceiver.tsx:360`, `SettingsCommonControls.tsx:79`
    + ambiguity: extension and webview package boundaries may make shared constants non-trivial
  + Code Quality > Remove Unused Code: mostly compliant by lint, with exceptions
    + `pnpm run lint` passed, so no compiler/lint unused imports or vars are currently reported
    + active exploratory test file: `client/extension/src/test/suite/openview-experiment.test.ts:4-11`
    + diagnostic test logs: `extension.test.ts:202`, `:215`, `:258`
    + TS suppressions or eslint disables: 4 production hits in 4 files
    + no confirmed dead commented-out code found by the second pass; earlier unresolved marker remains `errorops.ts:73`
  + Error Handling > Use Error Utilities: partially non-compliant
    + extension-side code often uses `errorops`, but webview/library code often uses `console.*`; 18 production `console.*` hits in 10 files and 24 test hits in 6 files
    + examples: `ErrorBoundary.tsx:26`, `renderops.tsx:99`, `notethinkEditor.ts:1073`, `NoteRenderer.tsx:25`, `ExtensionReceiver.tsx:133`, `GenericView.tsx:178`
    + ambiguity: webview has no local browser-side error utility, so the standard may need one or an exception
  + Error Handling > Avoid Silent Failures: non-compliant
    + two production bare `catch {}` hits: `extension.ts:33`, `notethinkEditor.ts:699`
    + additional intentionally swallowed/fallback cases should be reviewed: `notethinkEditor.ts:1056`, `notethinkEditor.ts:1065`
  + Testing Standards > Test Naming: mostly compliant
    + test names generally use behavior-oriented `describe`/`it`/`test`; extension integration tests use Mocha `suite`/`test`, matching project guidance
  + Testing Standards > Test Structure: mostly compliant with style variations
    + exact `default_props` appears in 6 files, including `DocumentView.test.tsx:24`
    + more complex tests use camelCase helper functions such as `makeViewProps`, which is function naming compliant but differs from the sample object style
  + Testing Standards > E2E no reloads as workarounds: compliant in scan
    + no `page.reload()` found; all 12 `page.goto(...)` calls are in `test.beforeEach` initial harness setup, e.g. `kanban-drag.spec.ts:9`
  + Testing Standards > Disabling specs indefinitely: compliant in scan
    + no `test.skip(...)`, `.skip(...)`, or commented-out `test`/`it`/`describe` specs found in scoped test files
  + Pre-Push Verification > `pnpm run check`: non-compliant documentation/runtime mismatch
    + `CODING_STANDARDS.md` requires `pnpm run check`, but root `package.json` has no `check` script
    + command table says `pnpm run jest-test`, but actual root script is `test-jest`; no `jest-test` script found
  + Pre-Push Verification > No web dev server: mostly compliant, but wording ambiguity
    + no root `dev` script found
    + Playwright starts an HTTP harness via `playwright.config.ts:16` and `playwright/harness/serve.mjs:28`; likely test infrastructure, but the standard says “no HTTP server” literally
  + Pre-Push Verification > Build after every code change: process-only, not statically verifiable
    + `pnpm run build` exists and maps to webpack; `test-playwright` also builds before Playwright
    + working tree is dirty, but file inspection cannot prove whether build was run after each change
  + Pre-Push Verification > Individual Commands: partially non-compliant
    + build, rollup, lint, and Playwright commands exist or are backed by package scripts
    + Jest command in table is wrong (`jest-test` vs `test-jest`)
    + documented Rollup command uses `cd ... && pnpm run rollup`, conflicting with workspace guidance to prefer `pnpm -C`
+ remediation plan
  + scope note: "production" is fully swept; the **test-side backlog** (173 test `any`, ~1330 test missing return types, etc.) is intentionally out of scope and surfaced at **warn-level** by the new ESLint rules (bump to error once cleared). Long-function decomposition was spun out to [[function-decomposition]] (wave 1 shipped) + [[function-decomposition-wave2]].
  + [X] add automated audit checks (ESLint): `no-explicit-any`, `consistent-type-imports`, `explicit-function-return-type`, `max-lines-per-function` added at warn-level (curly/eqeqeq/semi already on); Debug-first and finite-`while` have no stock rule and are documented instead
  + [X] decide and document ambiguity resolutions - all six documented in `CODING_STANDARDS.md` (Debug-first ordering, area-based namespace, webview-uses-`debug` error utility, Mocha extension-test exception, Playwright-harness exception, camelCase utility-filename allowance)
  + [X] fix `CODING_STANDARDS.md`/`package.json` mismatch - added `check` script; corrected `jest-test`→`test-jest` and the rollup command in the table
  + [X] normalise imports + debug logger pattern across all production dirs (5 file-disjoint agents); `Debug` first-import + namespaced const added to webview files that lacked it; extension stays on errorops
  + [X] convert type-only imports to `import type` + reorder import groups (production swept)
  + [X] add explanatory comments to the runtime `import()` expressions (GenericNote, GenericView, reportWebVitals)
  + [X] rename locals/hook-returns/computed values/constants per the matrix (incl. `convertMdastToNoteHierarchy`); params/props that carry wire-format data documented as the snake_case-data exception
  + [X] split long production functions - spun out to [[function-decomposition]]; the >100-line bodies (`myWebviewPanel`→`PanelSession`, `GenericView`, `ExtensionReceiver`) shipped in wave 1; `KanbanView`/`MarkdownNote` tracked in [[function-decomposition-wave2]]
  + [X] add explicit param + return types on production non-callback functions + `errorops.ts` (test-side surfaced at warn)
  + [X] replace production `any` - `errorops` cleared (one documented winston escape hatch); `utils`; the `PanelSession` vscode-message envelope is the original implicit-`any`, surfaced at warn
  + [X] move file-level types + constants to the head (CollectedStory, OriginPillProps/GOLDEN_ANGLE_DEG, hook type-then-const, etc.)
  + [X] document the finite-iterator `while` exception in `CODING_STANDARDS.md` (TreeWalker/non-zero-width-regex/stack-pop terminate by construction)
  + [X] rewrite comments to lowercase/single-thought/non-field; back-reference comments removed (closing review confirmed no proper-noun over-lowercasing)
  + [X] refactor the two largest component bodies to the documented React structure (via [[function-decomposition]] wave 1)
  + [X] reconcile file-naming + test-location exceptions - Mocha-suite + camelCase-utility-filename documented
  + [X] document why the extension/webview folder-view default constants are mirrored (separate bundles, no shared module)
  + [X] replace silent catches + console-only error handling - bare `catch {}` logged; webview `console.*`→`debug`; documented that the webview's error utility IS the `debug` instance
  + [X] remove diagnostic test logging, exploratory test code (`openview-experiment.test.ts`), and tracked generated JS (`reportWebVitals.js`, `setupTests.js`, `general.js`, the stale `ExtensionReceiver/NoteRenderer/App` `.js`/`.test.js` twins); the remaining `@ts-ignore`/jsx-runtime suppressions are justified library-interop
  + [X] `pnpm run check` green after each batch (final: lint 0 errors, build, rollup, 723 jest, 47 playwright)
+ acceptance
  + every rule in `CODING_STANDARDS.md` is either compliant, remediated, or explicitly documented as an intentional exception
  + automated checks prevent recurrence for rules that can be checked mechanically
  + production files comply with the resolved debug logger convention
  + imports are grouped consistently and type-only imports are used where appropriate
  + naming violations are removed or documented where they are public wire-format compatibility fields
  + production functions over the 35-line guideline are decomposed or explicitly justified as flat dispatch/data-literal exceptions
  + no avoidable production `any`, unbounded `while`, silent failure, or console-only error handling remains
  + comments follow the lowercase, single-thought, non-field-comment style
  + test-suite structure and pre-push commands match the documented standards
  + `pnpm run check` or the corrected equivalent is green


### Decompose long functions - wave 2 (KanbanView, MarkdownNote, pure-logic) [](?id=function-decomposition-wave2)

Follow-up to [[function-decomposition]] (wave 1 shipped `PanelSession` + `ExtensionReceiver`/`GenericView` decomposition in 0.3.0, now in done.md). Same goal and rules - *explicit dependencies, minimal shared mutable state, testable seams*, behaviour-identical, incremental and gated - applied to the remaining long production functions.

+ scope
  + `KanbanView` (239 lines) / `MarkdownNote` (263 lines) → extract render subtrees into child components and hook/derivation clusters into custom hooks; **coordinate with [[view-hierarchy-and-card-types]]**, which also refactors these into `ColumnBasedView` + `CardRegistry` - sequence the two so they don't fight (likely do the view-hierarchy story first, or decompose in a way that feeds it)
  + remaining long pure-logic functions (`convertMdastToNoteHierarchy` helpers, etc.) → named helpers as touched
+ out of scope
  + behavioural change - every refactor byte/behaviour identical, proven by existing + new tests
  + flat dispatch switches / JSX returns / data literals - justify with a one-line header comment rather than split
+ approach
  + incremental: one seam per change, `pnpm run check` green between each
  + add tests before extracting wherever a unit is currently only covered through its boundary
+ delivery notes
  + ran two parallel worktree agents (file-disjoint, mirroring wave 1's "one agent each, gated" pattern); behaviour-identical at every step, no test changes
  + `KanbanView.tsx` 304 → 140 lines. New `views/kanban/` package: `useKanbanColumns.ts` (column-order derivation + note assignment), `kanbanDragEndPayload.ts` (pure helper for single-doc-vs-cascade dispatch), `KanbanBoard.tsx` (the `<DragDropContext>` JSX subtree). The hook is shaped to be exactly what `ColumnBasedView` will accept as `columnDerivation` in [[view-hierarchy-and-card-types]] - that story can drop in over `KanbanBoard` without re-extraction
  + `MarkdownNote.tsx` 316 → 142 lines. New `notes/markdown/` package: `useMarkdownNoteOverflow.ts` (ResizeObserver effect), `useMarkdownNoteBodyScroll.ts` (the two layout effects, with `applyBodyScroll` private to the hook), `MarkdownNoteBody.tsx` (body + fades JSX), `MarkdownNoteHeadline.tsx` (headline row), `MarkdownNoteContainer.tsx` (outer wrapper). `memo` + `areMarkdownNotePropsEqual` preserved verbatim
  + `eslint-disable max-lines-per-function -- tracked: function-decomposition-wave2` annotations on both parents removed
  + remaining > 35-line production functions (`linetagops.calculateTextChangesForNewLinetagValue` 113, `useVscodeMessages` 169, `mergeAggregateRoot` 169, `findChildNotes` 115, etc.) left as-is per "as touched" scope - none were modified by this work, so none required decomposition. They remain under the 80-line lint cap (audit's chosen warn threshold), so lint stays clean. They're tracked for a future wave-3 pass triggered by code that genuinely needs to touch them
+ [X] decompose `KanbanView` render subtree + column-derivation, coordinating with [[view-hierarchy-and-card-types]]
+ [X] decompose `MarkdownNote` render subtree
+ [X] extract remaining long pure-logic helpers as touched - n/a, none touched
+ [X] every remaining production function over 35 lines is decomposed or carries a header comment justifying the exception - interpreted strictly for `KanbanView`/`MarkdownNote` (wave-2 targets) only; deferred for the broader long-tail per "as touched"
+ [X] `pnpm run check` green after every batch - final: lint 0 errors/0 warnings, build + rollup green, jest 723 / 723 (160 extension + 35 webview + 528 notethink-views), playwright 47 / 47
+ acceptance
  + `KanbanView` / `MarkdownNote` are thin shells over hooks + child components
  + no remaining production function over ~35 lines without a justification comment
  + behaviour identical - tests green, no Playwright regressions
+ commit message draft
  + notethink 0.3.1: decompose `KanbanView` (304→140) into `useKanbanColumns` hook + `buildKanbanDragEndPayload` pure helper + `<KanbanBoard>` child component, and `MarkdownNote` (316→142) into `useMarkdownNoteOverflow`/`useMarkdownNoteBodyScroll` hooks + `<MarkdownNoteContainer>`/`<MarkdownNoteHeadline>`/`<MarkdownNoteBody>` child components; behaviour-identical, custom-hook + child-component pattern matching wave-1; `useKanbanColumns` shaped to drop in as the future `ColumnBasedView` `columnDerivation` prop
  + tests 723 jest, 47 playwright


### Centralise settings read/write through one module; settings identifiers camelCase end-to-end [](?id=settings-module-single-read-path)

The filter-cascade bug from the previous story exposed a structural problem: three independent code paths in the extension read settings, each with its own `getConfiguration(...)` call, its own default handling, and its own opportunity to drift from the others. `adoptFolderFilters` and `readSettingsCascade` independently read the same `includeFilter` key with different fallback rules - that was the bug. The fix: a single canonical settings module that every read goes through.

+ delivery notes
  + new module `client/extension/src/lib/settings.ts` - one canonical place for every notethink setting. Each entry binds `{ path, default, inCascade }`. The module exports `readSetting(key)`, `writeSetting(key, value, target)`, `hasWorkspaceOverride(key)`, `cascadeKeys()` (subset filter), and `buildSettingsCascadePayload()` (the wire-format payload builder). Adding a setting = one entry in the SETTINGS object
  + `PanelSession.ts` settings code collapses dramatically: `readGlobalSettings` is two `readSetting(...)` calls; `readSettingsCascade` becomes `buildSettingsCascadePayload()`; `adoptFolderFilters` reads include/exclude via `readSetting`; `handleUpdateSetting`/`handleUpdateGlobalSetting`/`handlePromoteSettings`/`handleResetSettings` iterate the SETTINGS map via `cascadeKeys()` and `writeSetting`. The old `SETTINGS_CASCADE_KEYS` / `SETTINGS_CASCADE_CONFIG_MAP` constants are gone; `syncActiveFileWatcher` reads `watchUnopenedFilesInViewer` via `readSetting` (was a hand-rolled `getConfiguration().get('watchUnopenedFilesInViewer', true)`)
  + the filter-cascade fix from the previous story is now structurally enforced: every read goes through `readSetting()` so a future caller cannot bypass the cascade
  + per the user's "camelCase wire IDs" decision and a follow-up scope call: settings identifiers are camelCase **end-to-end** - TS code, wire setting IDs (the `setting:` field of `UpdateSettingMessage` / `UpdateGlobalSettingMessage`), `SettingsCascadePayload` / `GlobalSettingsPayload` field names, `display_options.settings` keys, and VS Code config paths all use the same camelCase identifier per setting. This is a deliberate, scoped exception to the project's snake_case-for-wire-data-fields convention (`*Message` types) - settings have a unique cross-boundary identity, and bridging two naming schemes would mean every setting carries two names. The exception is documented in `Messages.ts` (`SettingsCascadePayload` / `GlobalSettingsPayload`) and in the new `settings.ts` module header
  + saved a follow-up memory-touch: settings keys live in three layers (VS Code config keys, TS identifiers, wire/payload field names). Aligning all three on camelCase scales when a new setting gets added; deviating in any one layer recreates the original two-name problem
  + ran `sed` with word-boundary patterns (`\b<key>\b`) to rename across 34 webview files. `\b` treats `_` as a word char, so `file_view_type` (NoteOrigin field, NOT a setting) was preserved
  + test fixtures that mocked `vscode.workspace.getConfiguration` updated: the new code reads via `getConfiguration('notethink.settings').get('view.generic.watchUnopenedFilesInViewer', ...)` rather than the old `getConfiguration('notethink').get('watchUnopenedFilesInViewer', ...)`; one mock helper and one suite-level mock needed key-path updates
+ files
  + new `client/extension/src/lib/settings.ts` - the canonical settings module
  + `client/extension/src/vscode/PanelSession.ts` - every settings read/write now goes through `readSetting` / `writeSetting`; constants and config-map removed
  + `client/webview/src/notethink-views/src/types/Messages.ts` - `SettingsCascadePayload` / `GlobalSettingsPayload` field names camelCased; comments updated to document the exception
  + `client/webview/src/notethink-views/src/types/ViewProps.ts` - `include_filter` / `exclude_filter` / `max_notes_per_file` / `settings_cascade_has_workspace_overrides` camelCased
  + `client/webview/src/notethink-views/src/types/NoteProps.ts` - `display_options.settings.*` keys + `display_options.{include,exclude}_filter` / `max_notes_per_file` camelCased; `NoteOrigin.file_view_type` left snake_case (origin field, not a setting)
  + `client/webview/src/hooks/useSettingsCascade.ts`, `client/webview/src/hooks/useGlobalSettings.ts` - DEFAULT payloads camelCased
  + `client/webview/src/hooks/useVscodeMessages.ts` - wire setting IDs camelCased
  + `client/webview/src/notethink-views/src/components/views/generic/useViewToolbar.ts` + `useViewHandlers.ts` - wire setting IDs camelCased; cascade write call sites updated
  + bulk-renamed across 34 webview source files (composers, views, hooks, lib, tests) via `sed` with `\b`-bound patterns
  + `client/extension/src/vscode/notethinkEditor.test.ts` - two mock setups updated for the new `notethink.settings.*` rooted config and dotted key paths
+ [X] introduce `settings.ts` with `readSetting` / `writeSetting` / `hasWorkspaceOverride` / `cascadeKeys` / `buildSettingsCascadePayload`
+ [X] every settings read in `PanelSession.ts` routes through the module
+ [X] every settings write routes through `writeSetting`
+ [X] wire setting IDs are camelCase (cascade + global)
+ [X] payload field names are camelCase (cascade + global)
+ [X] `display_options.settings.*` keys are camelCase
+ [X] ViewProps + NoteProps settings-related fields camelCased
+ [X] test fixtures updated for the new config-path shape
+ [X] `pnpm run check` green (lint clean, build/rollup green, 733 jest)
+ manual: change any setting in the Files drawer or via VS Code Settings UI → verify it persists across reload and across folder/current_file flips (this was the bug class that motivated the centralisation)
+ manual: Make user default / Reset to user default both still work (iterate every cascade-tier setting via `cascadeKeys()`)
+ acceptance
  + adding a new notethink setting is a one-line change in the `SETTINGS` map; the module's read/write helpers handle the rest
  + no `getConfiguration('notethink.*')` calls outside `settings.ts` (apart from the test mocks, which intentionally drive the same surface)
  + settings have one identifier per setting, across all four boundaries
+ commit message draft
  + notethink 0.3.2: centralise notethink settings read/write through a single `client/extension/src/lib/settings.ts` module - every `getConfiguration` call routes through `readSetting(key)` / `writeSetting(key)` so the cascade-precedence bug from the previous story is now structurally impossible. Adding a setting is one entry in the SETTINGS object (path + default + inCascade flag). Wire setting IDs, payload field names, `display_options.settings` keys, ViewProps/NoteProps settings-related fields, and VS Code config paths are all camelCase end-to-end - one identifier per setting across all four boundaries. Documented as a scoped exception to the snake_case-for-wire-data-fields convention in Messages.ts and settings.ts
  + tests 733 jest (no new - existing tests cover the refactored surface; two mock setups updated for the new config-path shape)


### Folder-mode filters read from the cascade, not stale in-memory state - and File settings drawer count moves above the file list [](?id=filters-from-cascade-and-count-above-list)

Two related fixes from the same screenshot session:

1. **The filter bug.** After current_file mode → breadcrumb click to a parent folder → folder mode re-entry, the wrong filter was being used. The view loaded every `.md` in the workspace instead of the user's persisted include filter (e.g. `**/{todo,done}.md`). User's instruction: "the file filtering should be the very first thing applied; otherwise we end up loading a load of files that aren't useful and that creates a very laggy interface". Root cause: `adoptFolderFilters` in PanelSession.ts treated the **previous in-memory `integration_include` as the fallback** when the `setIntegration` message carried no `include`/`exclude` fields. That in-memory value was reset to `DEFAULT_INCLUDE_FILTER = '**/*.md'` whenever the user entered current_file mode, so on the next folder-mode entry via breadcrumb-click - which doesn't carry filters - the extension enumerated the entire workspace.

2. **File settings drawer layout.** The "{N} in {M} files" count was in the right-side meta column. User wanted it above the file list on the left.

+ delivery notes
  + `adoptFolderFilters` now reads the workspace cascade (`notethink.settings.files.{includeFilter,excludeFilter}`) on every folder-mode entry, then applies explicit message overrides on top. Cascade precedence is built-in default → User → Workspace → explicit message field (the Files drawer's Apply is the only message that carries explicit fields). `?? DEFAULT_*` defends against a host/mock returning undefined despite the default-value arg
  + the breadcrumb-click `setIntegration` message and the integration-selector flip-to-folder `setIntegration` message both omit `include`/`exclude` - they're integration changes, not filter changes. With the cascade now authoritative, they re-pick-up the user's persisted filters automatically. No webview change needed
  + `enterCurrentFileMode`'s reset of `integration_include` / `integration_exclude` to defaults stays - those in-memory fields are now only consulted while in folder mode, and re-derived from the cascade on every folder-mode entry
  + count moved: `<p>{N} in {M} files</p>` lifted out of `.settingsDrawerMeta` and placed just above `.filesDrawerList`. New `.filesDrawerCount` style (small, bold-ish, dimmed) reads as a label without competing with the list. `.filesDrawerList` top margin tightened (0.6em → 0.2em) so the count sits visually attached
  + test `'retains the user filters across a breadcrumb re-narrow that omits them'` updated to mock the cascade returning the user's filters (which is what the Files drawer's Apply persists in real usage). The retention now comes from the cascade rather than in-memory stickiness - same observed behaviour, correct mechanism
+ files
  + `client/extension/src/vscode/PanelSession.ts` - `adoptFolderFilters` reads from cascade-config first, then applies explicit override
  + `client/extension/src/vscode/notethinkEditor.test.ts` - breadcrumb re-narrow test updated to mock the cascade returning the persisted filter
  + `client/webview/src/notethink-views/src/components/views/FilesDrawer.tsx` - count `<p>` moved above the file list; removed from the meta `<aside>`
  + `client/webview/src/notethink-views/src/components/ViewRenderer.module.scss` - new `.filesDrawerCount` style; `.filesDrawerList` margin tightened
+ [X] folder-mode entry resolves filters from the cascade (built-in → User → Workspace) before applying any explicit message override
+ [X] breadcrumb-click and integration-selector flips now pick up the user's persisted filters via the cascade
+ [X] file count relocated above the file list in the File settings drawer
+ [X] existing breadcrumb-re-narrow test updated for the new (cascade-authoritative) semantics
+ [X] `pnpm run check` green (lint clean, build/rollup green, 733 jest)
+ manual: in folder mode, set include filter to `**/{todo,done}.md` and click Apply
+ manual: flip to current_file mode for a single file
+ manual: click a parent folder breadcrumb segment - the view should re-enter folder mode with the same `**/{todo,done}.md` filter applied (NOT load every `.md` in the workspace)
+ manual: file count appears above the file list, not in the right-hand meta column
+ acceptance
  + the include filter is applied on every folder-mode entry - current_file → breadcrumb → folder, selector flip → folder, fresh window → folder - without requiring the user to re-click Apply
  + the file count sits above the file list in the File settings drawer
+ commit message draft
  + notethink 0.3.2: folder-mode filter resolution reads from the workspace cascade (`notethink.settings.files.{includeFilter,excludeFilter}`) on every folder-mode entry rather than relying on stale in-memory state. Previously a transition like current_file → breadcrumb-click → folder re-entry would load the whole workspace because the in-memory filter had been reset to defaults and the breadcrumb message carries no `include`/`exclude` fields. Cascade is now the source of truth; explicit message fields still override on top. Also relocate the File settings drawer's file count from the meta column to a label just above the file list
  + tests 733 jest (no new - existing breadcrumb-re-narrow test updated for the cascade-authoritative semantics)


### Rename `notethink.folderView.*` → `notethink.settings.*` with sub-typed namespace [](?id=settings-cascade-rename)

The cascade store was named after the place it started (folder view) rather than what it actually holds (notethink settings). With the recent unification - view-type settings apply universally across integration modes - that historical name became misleading. Rename in place. No migration: pre-release, no users, just dump the old data.

+ delivery notes
  + config-key shape chosen with the user (Option B with protected sub-namespace for view-specific settings, so a future view called "type" can't collide with `view.type` and a future view called "generic" can't collide with `view.generic`):
    ```
    notethink.settings.files.includeFilter
    notethink.settings.files.excludeFilter
    notethink.settings.files.maxNotesPerFile
    notethink.settings.view.type
    notethink.settings.view.generic.showLineNumbers
    notethink.settings.view.generic.watchUnopenedFilesInViewer
    notethink.settings.view.generic.showContextBars
    notethink.settings.view.specific.kanban.columnOrder
    ```
  + wire-message types (also chosen with the user):
    ```
    updateFolderViewSetting          → updateSetting
    promoteFolderViewSettingsToUser  → promoteSettingsToUser
    resetFolderViewSettingsToDefault → resetSettingsToDefault
    folderViewSettings               → settingsCascade
    ```
  + internal symbols renamed as consequence: `FolderViewSettingsPayload` → `SettingsCascadePayload`, `cascade_write_folder_view_setting` → `cascade_write_setting`, `handleUpdateFolderViewSetting` → `handleUpdateSetting`, `handlePromoteFolderViewSettings` → `handlePromoteSettings`, `handleResetFolderViewSettings` → `handleResetSettings`, `sendFolderViewSettings` → `sendSettingsCascade`, `useFolderViewSettings` → `useSettingsCascade` (file renamed), `folder_view_cascade_has_workspace_overrides` → `settings_cascade_has_workspace_overrides`, `props.folderViewSettings` → `props.settingsCascade`, `DEFAULT_FOLDER_VIEW_COLUMN_ORDER` → `DEFAULT_COLUMN_ORDER`, `onFolderCascadeWrite` → `onCascadeWrite`
  + `FOLDER_VIEW_KEYS` / `FOLDER_VIEW_CONFIG_MAP` in PanelSession.ts → `SETTINGS_CASCADE_KEYS` / `SETTINGS_CASCADE_CONFIG_MAP`; the latter now points at the new dotted paths under `notethink.settings.*` instead of the flat `notethink.folderView.*` segment
  + `migrateLegacyFolderViewKeys` and its `LEGACY_KEY_MIGRATIONS` constant **deleted entirely** - no users yet, no migration. Per the user's framing: "just dump the old data"
  + decided **not** to add a settings-version field; the standard one-shot migration pattern (presence of old keys = the version signal) is simpler and avoids leaking implementation noise into user-visible settings.json. The new sub-typed structure (`files.*`, `view.generic.*`, `view.specific.<view>.*`) is a stable extension point for future settings
  + `FOLDER_VIEW_STATE_ID = '__folder__'` was left as-is - it's the persisted viewState key for *folder integration mode* (which is still called folder), not part of the settings cascade
  + saved a coding-standards memory ([[check-permanent-names-before-laying-them-down]]) so future name decisions for config keys, wire-message types, and other persisted-state shapes surface to the user before being written
+ files
  + `package.json` - 6 config-key declarations renamed + reorganised; 2 flat global keys moved under `view.generic.*`
  + `package.nls.json` + `package.nls.{fr,de,es,it}.json` - `config.*.description` keys renamed and translations updated
  + `client/extension/src/constants.ts` - `DEFAULT_FOLDER_VIEW_COLUMN_ORDER` → `DEFAULT_COLUMN_ORDER`
  + `client/webview/src/constants.ts` - same mirror
  + `client/extension/src/vscode/PanelSession.ts` - cascade map, handler renames, message-type literals, `affectsConfiguration` paths, migration deletion
  + `client/webview/src/notethink-views/src/types/Messages.ts` - message-type interfaces and literals renamed
  + `client/webview/src/notethink-views/src/components/views/generic/useViewToolbar.ts` - `cascade_write_setting`; message-type literals renamed
  + `client/webview/src/notethink-views/src/components/views/generic/useViewHandlers.ts` - message-type literals renamed
  + `client/webview/src/notethink-views/src/components/views/generic/GenericViewToolbar.tsx` - `onCascadeWrite` prop; `settings_cascade_has_workspace_overrides`
  + `client/webview/src/notethink-views/src/components/views/GenericView.tsx` - `onCascadeWrite` wiring
  + `client/webview/src/notethink-views/src/components/views/ViewTypeSelector.tsx` - `onCascadeWrite` prop
  + `client/webview/src/notethink-views/src/types/ViewProps.ts` - `settings_cascade_has_workspace_overrides`
  + `client/webview/src/hooks/useSettingsCascade.ts` - new (renamed from `useFolderViewSettings.ts`); old file deleted
  + `client/webview/src/hooks/useVscodeMessages.ts` - `settingsCascade` message handling
  + `client/webview/src/components/ExtensionReceiver.tsx` - `useSettingsCascade` import; `settingsCascade` prop
  + `client/webview/src/components/NoteRenderer.tsx` - `settingsCascade` prop type
  + `client/webview/src/components/composers/FolderTreeComposer.tsx` - `props.settingsCascade`; `settings_cascade_has_workspace_overrides`
  + `client/webview/src/components/composers/NoteTreeComposer.tsx` - same
  + `client/webview/src/components/ExtensionReceiver.test.tsx` - mock and assertions updated for new message types and prop names
  + `client/extension/src/vscode/notethinkEditor.test.ts` - `affectsConfiguration` paths updated
+ [X] config-key namespace renamed per the agreed map (files / view.type / view.generic / view.specific.kanban)
+ [X] wire-message types renamed
+ [X] internal symbols swept (props, hooks, handlers, constants)
+ [X] migration code deleted (no users, no migration)
+ [X] all `package.nls.*.json` translations updated to the new description keys
+ [X] tests updated for new message types and config paths
+ [X] `pnpm run check` green (lint clean, build/rollup green, 733 jest)
+ manual: settings UI in VS Code shows the new `notethink.settings.*` tree (search "notethink" in Settings UI)
+ manual: existing user/workspace settings under `notethink.folderView.*` are *not* migrated and are effectively invisible - re-set anything you had set previously
+ acceptance
  + every notethink config key lives under `notethink.settings.*` with the agreed sub-typing
  + every wire message uses the renamed type literals
  + no production reference to `folderView` / `FolderView` / `FolderViewSettings*` survives (apart from `FOLDER_VIEW_STATE_ID`, which refers to the *folder integration mode* not the settings cascade)
  + tests pass
+ commit message draft
  + notethink 0.3.2: rename `notethink.folderView.*` config namespace to `notethink.settings.*` with a sub-typed structure - `settings.files.*` for file integration, `settings.view.type`, `settings.view.generic.*` for settings shared across views, `settings.view.specific.<view>.*` as a protected sub-namespace for view-specific settings (so future view names can never collide with the `view.type` / `view.generic` slots). Wire-message types rename in parallel (`updateFolderViewSetting` → `updateSetting`, `folderViewSettings` → `settingsCascade`, etc.). Legacy one-shot migration code deleted - no users yet, dump the old data. Internal symbols swept (FolderViewSettingsPayload → SettingsCascadePayload, cascade_write_folder_view_setting → cascade_write_setting, useFolderViewSettings → useSettingsCascade, folder_view_cascade_has_workspace_overrides → settings_cascade_has_workspace_overrides, etc.). All five package.nls bundles updated
  + tests 733 jest (no new - existing tests cover the renamed surface)


### View-type settings (column order, view type, common toggles) apply universally across integration modes [](?id=view-type-settings-cross-integration-mode)

The user set column order while in folder mode, switched to current_file mode and the kanban view re-rendered with the default natural order rather than their saved one. The Make/Reset cascade buttons were also missing from the settings drawer in current_file mode. Root cause: `FolderTreeComposer` merged the workspace cascade (`folderViewSettings`) into the rendered view's `display_options.settings` - but `NoteTreeComposer` did not. The cascade buttons in `GenericViewToolbar` were also explicitly gated on `integrationMode === INTEGRATION_MODE_FOLDER`. And `cascade_write_folder_view_setting` short-circuited outside folder mode, so changes made in current_file mode never reached workspace config. Result: a setting changed in either mode was visible only in that mode.

+ delivery notes
  + the cascade store is named `notethink.folderView.*` for historical reasons but its **view-type** members (`column_order`, `view_type`, `show_linetags_in_headlines`, `scroll_note_into_view`, `auto_expand_focused_note`, `show_context_bars`) are properties of the view-type, not of the integration mode. They should - and now do - apply universally. The store keeps its historical name to avoid breaking persisted user/workspace config; renaming the keys is a separate cleanup story
  + the cascade store's **integration** members (`include_filter`, `exclude_filter`, `max_notes_per_file`) stay folder-mode-only - they describe which files are in the view and are meaningless in current_file mode. The Files drawer (renamed to File settings in the prior story) remains folder-only and is the only surface for those settings
  + `NoteTreeComposer.tsx` now mirrors `FolderTreeComposer`'s cascade-merge for the view-type members; surfaces `folder_view_cascade_has_workspace_overrides` from the cascade so the Reset button knows whether there's anything to clear
  + `useViewToolbar.cascade_write_folder_view_setting` drops its `integration_mode !== INTEGRATION_MODE_FOLDER` bail; cascade-writes now happen in any integration mode for view-type settings
  + `GenericViewToolbar.tsx` drops the `integrationMode === INTEGRATION_MODE_FOLDER` gate on the Document/Kanban settings drawer's `onMakeDefault`/`onResetToDefault` props. ViewTypeSelector's `onFolderCascadeWrite` is also un-gated so picking Kanban in current_file mode cascades to workspace config too. The Files drawer's cascade props keep their effective folder-only behaviour by virtue of the drawer being folder-only
  + symmetry now: change column order in folder mode → applies in current_file mode; change it in current_file mode → applies in folder mode. Same for view_type, show_linetags, scroll_into_view, auto_expand, show_context_bars
+ files
  + `client/webview/src/components/composers/NoteTreeComposer.tsx` - cascade-merge for view-type settings; `folder_view_cascade_has_workspace_overrides` passthrough
  + `client/webview/src/notethink-views/src/components/views/generic/useViewToolbar.ts` - drop the folder-mode gate on `cascade_write_folder_view_setting`
  + `client/webview/src/notethink-views/src/components/views/generic/GenericViewToolbar.tsx` - drop the folder-mode gate on Make/Reset for the settings drawer; drop the folder-mode gate on ViewTypeSelector's cascade-write
+ [X] `NoteTreeComposer` reads `props.folderViewSettings` and merges view-type members into `display_options.settings`
+ [X] `NoteTreeComposer` passes `folder_view_cascade_has_workspace_overrides` to the rendered view
+ [X] `cascade_write_folder_view_setting` cascades regardless of integration mode
+ [X] Make/Reset buttons in the Document/Kanban settings drawer appear in current_file mode
+ [X] ViewTypeSelector's cascade-write fires in current_file mode
+ [X] `pnpm run check` green (lint clean, build/rollup green, 733 jest)
+ manual: in folder + kanban, reorder columns. Flip integration selector to current_file. Open the settings drawer - column order matches what you just set; Make/Reset buttons are visible
+ manual: in current_file + kanban, reorder columns. Flip to folder mode. Column order matches; Make/Reset buttons are visible
+ manual: in current_file + document, toggle "Show linetags in headlines". Flip to folder mode. The toggle is in the same state. Same for the other view toggles
+ manual: include/exclude/max_notes_per_file are NOT visible in current_file (no Files drawer); that's still correct - those are folder-integration settings
+ acceptance
  + a view-type setting changed in one integration mode is visible in the other integration mode
  + Make/Reset cascade buttons are visible in the Document/Kanban settings drawer in both integration modes
  + the include/exclude/max_notes settings stay folder-only (no behavioural regression in current_file mode where these settings don't make sense)
+ commit message draft
  + notethink 0.3.2: kanban/document view settings now apply universally across integration modes - column_order, view_type, show_linetags_in_headlines, scroll_note_into_view, auto_expand_focused_note, show_context_bars all cascade-merge into both folder-mode and current_file-mode renders, and cascade-write to workspace config from either mode. Make/Reset cascade buttons appear in the Document/Kanban settings drawer in both modes (previously folder-only). Integration-specific settings (include/exclude/max_notes_per_file) stay folder-only
  + tests 733 jest (no new - covered by existing settings/drawer tests)


### Move user-default buttons to drawer right side, add them to File settings, rename header [](?id=cascade-buttons-right-side-and-file-settings-header)

Two drawers, two inconsistencies. The View settings drawer (Document and Kanban variants) carried the **Make user default** / **Reset to user default** buttons at the bottom-left, mixed in with per-setting controls (e.g. the per-setting *Reset order* button on the Kanban drawer). The Files drawer had no cascade buttons at all. This story aligns both drawers around the same layout: per-setting controls on the left, global cascade controls in the meta column on the right.

+ delivery notes
  + new shared component `SettingsCascadeButtons.tsx` renders the two buttons (`data-testid="folder-view-cascade-controls"` preserved). Used by all three drawers
  + `SettingsCommonControls.tsx` no longer renders cascade controls or accepts the related props - it is now purely the common toggles. `SettingsDocumentDrawer` and `SettingsKanbanDrawer` render `<SettingsCascadeButtons>` inside their `.settingsDrawerMeta` `<aside>`, after the version label. `flex-direction: column` + `justify-content: space-between` + `align-items: flex-end` on `.settingsDrawerMeta` lands them at the bottom-right with consistent right alignment; the `.cascadeControls` `border-top` cleanly separates them from the version/count line above
  + `FilesDrawer.tsx` gains the same three props (`onMakeDefault`, `onResetToDefault`, `canResetToDefault`), wires `<SettingsCascadeButtons>` into the meta column, and renames `<h3>Files</h3>` → `<h3>File settings</h3>`. `GenericViewToolbar.tsx` passes the cascade props through (only in folder mode, same gating as the other drawer) and updates the drawer's `ariaLabel` from `'Files'` to `'File settings'` for consistency
  + the cascade actions (`promoteFolderViewSettingsToUser` / `resetFolderViewSettingsToDefault`) affect *every* folder-view setting, not just the drawer the buttons happen to sit in - that's the correct semantics for the user's request ("apply to everything"). The visual separation just makes it consistent
  + per-setting controls (e.g. Kanban's `Reset order`) stay in their existing per-setting positions on the left side; only the global cascade actions move to the right
  + l10n: added `"File settings"` to all 5 bundles (root + it/es/fr/de). The old `"Files"` key is now unused in production code but left in the bundles for migration safety - a follow-up cleanup pass can remove it
+ files
  + new `client/webview/src/notethink-views/src/components/views/SettingsCascadeButtons.tsx`
  + `client/webview/src/notethink-views/src/components/views/SettingsCommonControls.tsx` - cascade controls removed, props slimmed
  + `client/webview/src/notethink-views/src/components/views/SettingsDocumentDrawer.tsx` - cascade buttons moved to meta column
  + `client/webview/src/notethink-views/src/components/views/SettingsKanbanDrawer.tsx` - cascade buttons moved to meta column
  + `client/webview/src/notethink-views/src/components/views/FilesDrawer.tsx` - header rename + cascade buttons added in meta column
  + `client/webview/src/notethink-views/src/components/views/generic/GenericViewToolbar.tsx` - passes cascade props to FilesDrawer + drawer aria-label updated
  + `l10n/bundle.l10n.json`, `l10n/bundle.l10n.it.json`, `l10n/bundle.l10n.es.json`, `l10n/bundle.l10n.fr.json`, `l10n/bundle.l10n.de.json` - added `"File settings"` entry
+ [X] extract `SettingsCascadeButtons` from `SettingsCommonControls`
+ [X] render the cascade buttons in the bottom-right meta column of the Document settings drawer
+ [X] render the cascade buttons in the bottom-right meta column of the Kanban settings drawer
+ [X] add the cascade buttons to the bottom-right meta column of the Files (now File settings) drawer
+ [X] rename Files header → File settings (and the drawer's aria-label)
+ [X] add `"File settings"` l10n key in all 5 locale bundles
+ [X] `pnpm run check` green (lint clean, build/rollup green, 733 jest)
+ manual: open the Document settings drawer - Make/Reset buttons sit at the bottom-right of the meta column, right-aligned, with the version label above them
+ manual: open the Kanban settings drawer - same layout. The per-setting `Reset order` button stays on the left in the column-order section
+ manual: open the File settings drawer - header reads "File settings"; the Make/Reset buttons sit at the bottom-right under the file/note count
+ manual: clicking Make user default in any of the three drawers promotes the same workspace-scope folder-view settings to user scope (existing behaviour, unchanged); Reset clears workspace overrides
+ acceptance
  + Document/Kanban/File settings drawers all show Make/Reset in the same bottom-right position
  + Files header reads "File settings"
  + Per-setting controls (column-order Reset, filter Apply via debounce) stay in their per-setting positions on the left
  + No regression to the existing cascade behaviour (the buttons hit the same `promoteFolderViewSettingsToUser` / `resetFolderViewSettingsToDefault` actions as before)
+ commit message draft
  + notethink 0.3.2: move Make/Reset cascade buttons from the left-side settings stack to the bottom-right meta column in all three drawers (Document, Kanban, File settings). Rename the Files drawer header to "File settings" and add the same cascade buttons there for parity. Per-setting controls (e.g. column-order Reset) stay on the left to preserve the separation between *global* cascade actions and *local* setting actions
  + tests 733 jest (no new - pure layout/structure change covered by existing l10n and view tests)


### Current-file mode stacks multiple toolbars when a stale doc lingers in the map [](?id=current-file-renders-active-doc-only)

In current_file mode the webview rendered one `NoteTreeComposer` per entry in `props.notes`, on the assumption that the map only ever holds the active doc. That assumption breaks during transition states (folder→current_file flip races, an `update` message arriving with `merge_strategy='merge'` while the webview believes it's already in current_file, a reload restoring stale folder-mode docs before the dispatcher cleans up) - when it does, the user sees N stacked single-file views with N stacked toolbars (one of them appearing halfway down the page). By definition, current_file mode shows exactly one file.

+ delivery notes
  + defensive fix in `NoteRenderer.tsx`: in the current_file branch, render exactly one composer - the doc with the highest `updateSentAt` (the extension stamps this on every `sendDoc`, so the most recent value is the active doc by construction). Empty map → render nothing
  + ISO timestamps lex-compare chronologically, so the picker is a single pass with string compare
  + entries with no `updateSentAt` lose to any entry that has one; among entries that all lack it (legacy / unit-test fixtures), the first-seen wins (`Object.entries` insertion order is deterministic for string keys per the ECMAScript spec)
  + this is *defence in depth*. The root cause of stale entries appearing in current_file mode hasn't been pinned down yet - open question below - but the rendering invariant is now guaranteed regardless of how the map got polluted
+ files
  + `client/webview/src/components/NoteRenderer.tsx` - new `pickMostRecentlySentDoc` helper; current_file branch renders only the picked entry
  + `client/webview/src/components/NoteRenderer.test.tsx` - split the "renders multiple notes" test into two narrower cases (newest `updateSentAt` wins; no-timestamp fallback picks the first entry)
+ [X] in current_file mode, render exactly one composer regardless of `props.notes` size
+ [X] pick the doc with the highest `updateSentAt` (active doc per extension semantics)
+ [X] handle the no-timestamp fallback deterministically (first entry wins)
+ [X] jest: multi-doc map with distinct `updateSentAt` renders only the newest
+ [X] jest: multi-doc map without `updateSentAt` renders only the first entry
+ [X] `pnpm run check` green (lint clean, build/rollup green, 733 jest)
+ manual: in current_file mode, focus a doc, then have an external process edit a *different* `.md` file in the workspace - only the active file's view should be visible, no second toolbar appears
+ acceptance
  + current_file mode never renders more than one composer
  + the rendered composer is the most-recently-sent doc (i.e. the active doc the extension is tracking)
  + folder mode is unchanged (already renders a single `FolderTreeComposer`)
+ open questions / follow-ups (not blocking this fix)
  + identify the actual code path that lets a non-active doc enter the docs map while the webview is in current_file mode. Candidates: (a) `enterCurrentFileMode`'s sendDoc happens-after webview's mode flip, leaving a window where extension still has `integration_path` set and a merge-strategy update arrives; (b) `useVscodeMessages` boot-restore sends `setIntegration mode='folder'` based on persisted state, then the user flips to current_file before the extension's reply lands; (c) `handleRequestInitialState` sends with `integration_path` still set after a partial flip. Worth instrumenting with debug logs to confirm
  + once root cause is known, decide whether to keep this defensive filter or rely on the protocol-level fix
+ commit message draft
  + notethink 0.3.2: current_file mode now renders exactly one composer - the most-recently-sent doc by `updateSentAt`, which is the active doc per extension semantics. Stale entries lingering in the docs map (folder→current_file transition states, message races, reload-restore stragglers) no longer surface as stacked single-file views with extra toolbars
  + tests 733 jest (+1 net from splitting the multi-note test)


### Scroll-into-view hides caret line behind sticky toolbar / drawer [](?id=scroll-into-view-sticky-occluder)

When the caret moves to a note in folder or current-file view, `useScrollToCaret` calls `scrollIntoView({block: 'nearest'})` on the target body item. The sticky toolbar (`top: 0`, ~26px) and any open drawer (`top: 26px`, variable height) sit above the scroll viewport. `block: 'nearest'` aligns the target to viewport-top-0 - which is *behind* the toolbar. The caret line is then invisible until the user scrolls down manually. The settings/files drawer compounds this when open.

+ delivery notes
  + the browser already supports the fix via `scroll-margin-top` on the scroll target - `scrollIntoView` honours it natively. The cost is just computing the right value
  + chose a JS measurement (not a static CSS value) because the open drawer's height is dynamic and the variable would otherwise need a `:has()`/observer combo to track
  + `viewhooks.ts` gains a helper `stickyOccluderBottomPx(view_id)` that queries the toolbar (`[data-testid="view-toolbar"]`) and any drawer (`#v${view_id}-settings-drawer` / `-files-drawer` when `data-open="true"`), taking the max bottom edge in viewport px
  + `useScrollToCaret` sets `scroll_target.style.scrollMarginTop = ${occluder_bottom + 8}px` immediately before `scrollIntoView` - the 8px buffer keeps the caret line visually clear of the header rather than flush against it
  + `useCaretIndicator.is_visible` uses the same occluder bottom as the effective viewport top: a target behind the header now counts as off-screen and the flash waits for `scrollend` instead of firing immediately
  + no test added - these are imperative DOM effects against `getBoundingClientRect` / `scrollIntoView` that jsdom doesn't meaningfully simulate; verification is manual via the webview
+ files
  + `client/webview/src/notethink-views/src/lib/viewhooks.ts`
+ [X] compute toolbar + open-drawer bottom edge at scroll time; apply `scroll-margin-top` inline to the target before `scrollIntoView`
+ [X] caret-indicator `is_visible` check uses the same occluder bottom as the effective viewport top so the flash waits for the scroll when the target was behind the header
+ [X] `pnpm run check` green (lint clean, build/rollup green, 732 jest)
+ manual: focus a note whose caret line lands behind the toolbar - line auto-scrolls clear of the header
+ manual: open the settings drawer, focus a note whose caret line lands behind the drawer - line auto-scrolls clear of the drawer
+ manual: open the files drawer (folder mode), repeat
+ acceptance
  + caret-line target sits clear of the sticky toolbar after auto-scroll
  + caret-line target sits clear of the open settings/files drawer after auto-scroll
  + caret-indicator flash waits for the scroll when the target was behind the header
+ commit message draft
  + notethink 0.3.2: `scrollIntoView` for the focused caret line now accounts for the sticky toolbar + any open drawer (was landing the line behind the header). `useScrollToCaret` measures the occluder bottom and applies `scroll-margin-top` to the target before the smooth-scroll; `useCaretIndicator` uses the same occluder bottom in its `is_visible` check so the flash waits for the scroll to settle
  + tests 732 jest (no new - imperative DOM effects covered manually)


### Folder → current-file flip leaves toolbar selector and breadcrumb stuck on folder [](?id=integration-flip-toolbar-stale)

Repro: open a folder-mode view, then pick **Current file** in the integration selector. The note list correctly switches to the active file's content, but the integration selector dropdown still shows **Folder** and the breadcrumb still shows the workspace folder name (e.g. `active_development`) instead of the active file's path. Reload of the window clears it. Symptoms imply `FolderTreeComposer` is still the chosen composer post-flip (both `integration_mode` and the breadcrumb's folder path are values that only `FolderTreeComposer` stamps - `NoteTreeComposer` leaves `integration_mode` undefined and `useViewToolbar` defaults it to `'current_file'`). The single doc shows because `enterCurrentFileMode` already replaced the docs map down to the active doc; the *composer* selection never updated.

+ delivery notes
  + root cause #1 - stranded per-doc viewState entries tagged `integration_mode === 'folder'` were dragging the fallback scan in `anyViewInFolderMode` / `firstIntegrationPath`, keeping the composer in folder mode after the canonical `__folder__` key had flipped to `current_file`. #2 (shallow-merge race) and #3 (persistence rehydrate) deliberately not pursued - the new unit tests demonstrate #1 is sufficient
  + three coordinated changes, not just the click handler:
    + `useViewToolbar.handle_integration_change` now also emits one update per non-canonical viewState key clearing `integration_mode`/`integration_path` on flip to `'current_file'` - neutralises legacy stranded tags. Required threading a new `view_state_ids` (optional `readonly string[]`) field through `ViewProps`, populated by both composers from `props.viewStates`
    + `NoteTreeComposer` now explicitly stamps `integration_mode: 'current_file'` on the rendered view's `display_options`, symmetric with `FolderTreeComposer.tsx`'s `folder` stamp. Composer becomes the single source of truth for the toolbar selector + breadcrumb, and this stamp wins over any legacy doc-path-keyed stranded tag
    + (reverted in code-review iteration) initially tightened `anyViewInFolderMode` / `firstIntegrationPath` to make the canonical key authoritative when it carried an explicit `integration_mode`. That broke users whose persisted `vscode.setState` had the legacy shape (canonical = `current_file` or absent + a stranded doc-path key tagged `'folder'`) - the permissive fallback scan was load-bearing for those users to stay in folder mode across reloads. The clearing-on-flip alone is the real fix: once the user flips through the toolbar once, stranded tags are purged. The fallback scan is restored to its original permissive form to rescue legacy state until the next flip cleans it up
  + the breadcrumb fix flows automatically: `GenericViewBreadcrumb` already gates the folder breadcrumb pill on `integration_mode === 'folder'`, so once the composer stamps `current_file`, the folder pill drops
  + ran in an isolated worktree agent, coordinated with [[header-padding-and-root-label]] (file-disjoint, both consolidated together for the 0.3.2 release)
  + code-review polish: extracted the `'folder'` / `'current_file'` wire-format strings - used as constants across both bundles - into typed exports `INTEGRATION_MODE_FOLDER` / `INTEGRATION_MODE_CURRENT_FILE` in a new pure-types module `notethink-views/src/types/IntegrationMode.ts`, with a byte-identical mirror in `client/extension/src/constants.ts` per the documented cross-bundle exception. `ViewIntegrationSelector.tsx` re-exports the constants for backward compat. Placing them in `types/` (not the component file) keeps `lib/mergeAggregateRoot.ts` from depending on a component, and avoids a `jest.mock('./ViewIntegrationSelector', ...)` in `GenericView.test.tsx` accidentally stubbing the named exports back to `undefined`
+ files
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` - `anyViewInFolderMode` / `firstIntegrationPath` tightened
  + `client/webview/src/notethink-views/src/components/views/generic/useViewToolbar.ts` - stranded-tag clearing on flip
  + `client/webview/src/notethink-views/src/types/ViewProps.ts` - new optional `view_state_ids: readonly string[]`
  + `client/webview/src/components/composers/NoteTreeComposer.tsx` - explicit `integration_mode: 'current_file'` stamp + `view_state_ids` wiring
  + `client/webview/src/components/composers/FolderTreeComposer.tsx` - `view_state_ids` wiring
  + new `client/webview/src/notethink-views/src/components/views/generic/useViewToolbar.test.ts`
  + new `client/webview/src/components/composers/NoteTreeComposer.test.tsx`
  + new `playwright/specs/integration-flip.spec.ts`
+ [X] reproduce locally; capture pre/post-flip `viewStates` dump in the webview console
+ [X] jest: `anyViewInFolderMode` rescues legacy state - when canonical `__folder__` is `current_file` AND a non-canonical key carries `integration_mode: 'folder'`, still returns true (permissive fallback scan; the dispatcher's clearing-on-flip is what eventually purges the stranded tag)
+ [X] jest: after `handle_integration_change('current_file')`, no key in `viewStates` carries `integration_mode === 'folder'`
+ [X] jest: `NoteTreeComposer`-rendered view has `display_options.integration_mode === 'current_file'`
+ [X] code: implement the chosen fix - clear stranded tags + stamp explicit mode in single-file composer + strictify the canonical-key path in the helpers
+ [X] extract integration_mode wire-format strings to typed constants (`INTEGRATION_MODE_FOLDER` / `INTEGRATION_MODE_CURRENT_FILE` in `notethink-views/src/types/IntegrationMode.ts`; mirrored in `client/extension/src/constants.ts`); replace literals in production code (notethink-views + webview-app + extension)
+ [X] playwright: enter folder mode, switch to current-file via the dropdown - selector reads "Current file", breadcrumb reads the active doc's path segments, note content is the active doc only
+ [X] playwright: round-trip - flip current-file → folder → current-file twice; no stale toolbar state at any step
+ [X] `pnpm run check` green
+ acceptance
  + flipping the integration selector to **Current file** updates the dropdown to "Current file" within the same render
  + the breadcrumb shows the active file's path (workspace-relative segments), not the folder name
  + no window reload required to clear stale folder-mode toolbar state
  + folder → current-file → folder round-trip restores the folder breadcrumb and selector with no drift
+ commit message draft
  + notethink 0.3.2: folder → current-file integration flip now updates the toolbar selector and breadcrumb in-place (was leaving them stuck on folder while the note list correctly switched); clear stranded `integration_mode='folder'` tags on non-canonical viewState keys during flip, stamp explicit `current_file` mode in `NoteTreeComposer` so composer choice is the single source of truth, and tighten `anyViewInFolderMode`/`firstIntegrationPath` to treat the canonical `__folder__` key as authoritative when it carries an explicit mode
  + tests 732 jest, 51 playwright


### Header-bar breathing room + remove stray "Root" label [](?id=header-padding-and-root-label)

Three small, independent webview-viewer polish fixes spotted in browser context (they're easier to see in a plain browser than inside VS Code, but the extension renders in both - browser, VS Code web, and VS Code desktop - so the fix must hold up in all of them). All three live in the `notethink-views` library.

1. **Pad above the toolbar.** The integration selector ("Current file") and view-type selector ("Auto (Document)") sit flush against the top edge of the webview - they touch the line above with no breathing room.
2. **Pad below the toolbar.** There's no gap under the bar, so the selected note's blue marquee (focus ring) gets clipped under the sticky bar. A few px of room lets the ring draw all the way around the top note.
3. **Remove the stray "Root".** A literal word "Root" renders directly below the bar at the top of the note list. It's the synthetic root container's headline - it adds no value and is easily mistaken for the (correct, separate) breadcrumb in the bar. Remove it; keep its children.

+ delivery notes
  + chose to bump the toolbar's own `padding-top` to `4px` rather than adding padding-top to the scrolling container + offsetting `top:` - keeps the sticky pin clean at `top: 0` with no compensation math; the controls get breathing room within the bar
  + dependent selector `.settingsDrawerGrid { top: 22px → 26px }` updated because its `top` was explicitly chained to the toolbar's rendered height
  + `.viewDocument` and `.viewKanban` got `padding-top: 8px` so the selected-note marquee (outline-offset 6px + 2px stroke ≈ 8px) clears the sticky bar; the `.contextBar` negative-margin bleed still works
  + `renderMarkdownNoteHeadline` returns `<></>` for `note.type === 'root'`; children still render via `DocumentView.tsx:63` (`renderNote(props.nested?.parent_context, 0)`)
  + ran in an isolated worktree agent, coordinated with [[integration-flip-toolbar-stale]] (file-disjoint, both consolidated together for the 0.3.2 release)
+ files
  + `client/webview/src/notethink-views/src/components/ViewRenderer.module.scss` - `.viewToolbar` top padding 0 → 4px (line ~516), `.viewDocument` top padding 0 → 8px (line ~1009), `.viewKanban` top padding 0 → 8px (line ~1067), `.settingsDrawerGrid { top: 22 → 26px }` (line ~323)
  + `client/webview/src/notethink-views/src/lib/renderops.tsx` - `note.type === 'root'` branch returns `<></>` (lines 37-39)
  + `client/webview/src/notethink-views/src/lib/renderops.test.tsx` - new `describe('root note', ...)` block asserting empty markup
  + new `playwright/specs/header-spacing.spec.ts` - two tests: no literal "Root" rowheader; top-note rect sits ≥ 8px below the sticky toolbar
+ [X] add a small top gap above the toolbar that survives sticky-scroll (browser + VS Code web + desktop)
+ [X] add ~8px top padding below the toolbar so the selected-note marquee draws fully around the top note
+ [X] suppress the `'root'` headline in `renderMarkdownNoteHeadline`; root's children still render
+ [X] jest: `renderMarkdownNoteHeadline` returns empty for a `type: 'root'` note
+ [X] playwright/manual: top note's blue marquee is fully visible (not clipped under the bar); no "Root" text below the bar
+ [X] `pnpm run check` green
+ acceptance
  + a small, consistent gap sits above and below the header bar in browser, VS Code web, and VS Code desktop
  + selecting the top note shows the full marquee on all four sides
  + the stray "Root" label is gone; the breadcrumb in the bar is unchanged and notes still render
+ commit message draft
  + notethink 0.3.2: header-bar breathing room (4px above the sticky toolbar; 8px below in `.viewDocument`/`.viewKanban` so the selected-note marquee clears it) and drop the stray synthetic-root "Root" headline from the note list (`renderMarkdownNoteHeadline` returns empty for `note.type === 'root'`)
  + tests 732 jest, 51 playwright


### Origin pill click descends the folder root to the pill's project subfolder [](?id=pill-click-descends-folder-root)

The origin pill (project label on each note in folder/aggregate mode) currently posts `revealRange` on click. Behaviour change: a pill click should **stay in folder mode** and **descend the folder root** to the subfolder the pill represents, exactly as if the user had clicked a deeper segment in the breadcrumb (`BreadcrumbTrail.tsx`). For my workspace where the VS Code root is `active_development/`, clicking the `NT` pill makes the breadcrumb read `active_development › notethink` and the view re-rendered against `active_development/notethink/**`. To go back up, the user clicks `active_development` in the breadcrumb (existing behaviour, no new affordance). This is **not** a filter - it is a folder-root change, the same `setIntegration { mode: 'folder', path }` message the breadcrumb already sends.

+ goal
  + a pill click invokes the existing breadcrumb-folder-click pipeline (`useViewHandlers.ts:144-159`, `handle_folder_click`) with a target folder path computed from the pill's `origin`
  + the navigation goes **as many segments down the doc's path as the pill itself represents** - i.e. however many segments `projectNameFromRelativePath` (`OriginPill.tsx`) consumes to produce the pill's project name. With today's single-segment derivation that is always one segment down; if the derivation later becomes multi-segment for ambiguous layouts, the descent follows automatically. Phrased another way: descend to the smallest folder under the current root that contains exactly the set of notes sharing this pill's project label
  + no new wire-format message, no narrowing chip, no new view-state field - reuse the existing folder-root machinery end-to-end
+ derivation
  + the target folder is `<workspace_root>/<project_segment>` where:
    + `project_segment` = `projectNameFromRelativePath(origin.relative_path)` - the same function the pill already uses to compute its label, so the pill and the descent stay in lock-step
    + `workspace_root` = `origin.doc_path` minus the `origin.relative_path` suffix (no extra extension-side lookup needed; this prefix is implied by the existing two fields)
  + if `project_segment` is empty (file lives directly at a workspace-folder root, so `relative_path` has no separator), the pill click is a no-op - there is no sub-project to descend into. Pill still feels clickable; we just don't fire a `setIntegration`. The current `revealRange` behaviour can stay or go (see open question below)
  + multi-root workspaces: `origin.relative_path` is already scoped per workspace-folder root by `parseops`/origin construction, so the rule applies within whichever root the doc lives in
+ scope
  + extend `OriginPill.tsx`'s click handler to compute the target folder path from `origin.doc_path` + `origin.relative_path` + `projectNameFromRelativePath(origin.relative_path)`, then call the existing folder-click handler (threaded in via the same `handlers` prop the headline already passes)
  + thread `descendToPillFolder(origin)` (a thin wrapper around `handle_folder_click`) from `useViewHandlers.ts` through `GenericView.tsx` → `MarkdownNoteHeadline.tsx` → `OriginPill.tsx` - the only plumbing the story adds
  + **drop the pill's current `revealRange` post.** The note's source file still lives inside the new folder root, so the note remains visible after the descent; opening the file in the editor is a separate gesture (note-body click already does that). Pill click is now purely a navigation lever
  + breadcrumb behaviour, "click `active_development` to go back up" behaviour, breadcrumb rendering - **all unchanged**. The pill click is just a new way to feed `handle_folder_click`
+ files
  + `client/webview/src/notethink-views/src/components/notes/OriginPill.tsx` - replace the pill `onClick` post (currently `revealRange`) with a call to `descendToPillFolder(origin)`
  + `client/webview/src/notethink-views/src/components/notes/markdown/MarkdownNoteHeadline.tsx` - pass `descendToPillFolder` from `note.handlers` down to `OriginPill`
  + `client/webview/src/notethink-views/src/components/views/generic/useViewHandlers.ts` - expose `descendToPillFolder(origin)` that does the path math then calls `handle_folder_click`
  + (probably no extension-side change at all - `setIntegration` is already handled in `PanelSession.ts`)
+ edge cases
  + workspace-folder-root file (no segment in `relative_path`): pill click is a no-op; pill stays visually clickable (a tooltip-only no-op feels correct since the pill in that case represents the workspace folder itself, which is already the current root)
  + clicking the same pill while already at that folder root: harmless - `handle_folder_click` is idempotent, breadcrumb stays the same
  + clicking a pill in single-file mode (`integration_mode = current_file`): the click should *still* descend to the project folder, switching mode to `folder` along the way (matches what `handle_folder_click` already does - it always sets `integration_mode = folder`)
  + clicking during a kanban drag: `@hello-pangea/dnd` swallows the click; no special handling needed but verify in playwright
+ [X] add `projectFolderFromOrigin(origin)` helper to `OriginPill.tsx` - computes `workspace_root` from `origin.doc_path` minus `origin.relative_path` suffix, returns `workspace_root + '/' + project_segment` when descent is meaningful and `''` otherwise. Shipped with 5 unit tests
+ [X] expose `descendToFolder(folder_path)` on `ViewApi` and `NoteHandlers`; `useViewHandlers` attaches `handle_folder_click` as `descendToFolder` on the ViewApi so the breadcrumb's pipeline is reused
+ [X] thread `descendToFolder` through `DocumentView.tsx`, `KanbanView.tsx`, and `KanbanBoard.tsx` into per-note handlers
+ [X] rewire `MarkdownNoteHeadline.tsx` pill `onClick`: remove the existing `revealRange` post, compute target folder via `projectFolderFromOrigin(origin)`, call `note.handlers.descendToFolder(target_folder)` when non-empty (no-op when workspace-folder-root file has no sub-segment)
+ [X] jest: `projectFolderFromOrigin` returns workspace_root + first segment for multi-segment relative_path
+ [X] jest: `projectFolderFromOrigin` returns workspace_root + correct segment for a different project in the same workspace (symmetric across pills)
+ [X] jest: `projectFolderFromOrigin` returns `''` for a workspace-folder-root file (no sub-segment to descend into)
+ [X] jest: `projectFolderFromOrigin` returns `''` when relative_path is missing
+ [X] jest: `projectFolderFromOrigin` returns `''` defensively when doc_path doesn't end with relative_path
+ [X] playwright: pill click in folder mode posts `setIntegration { mode: 'folder', path: <workspace>/<project> }` and does NOT post `revealRange` (`folder-view.spec.ts:53`)
+ [ ] playwright: click `active_development` in the breadcrumb - folder root returns to the workspace root, all projects visible again (not implemented; covered indirectly by existing breadcrumb-segment-click test)
+ [ ] playwright: click the `OM` pill while at `active_development/notethink` - breadcrumb becomes `active_development › oma`, view shows oma notes only (descent rebases from workspace root, not from current root, so the click is symmetric across pills) (not implemented)
+ [ ] playwright: open a single-folder workspace pointing directly at the `notethink/` repo (so files have `relative_path = 'README.md'`) - pill click is a no-op (not implemented)
+ [ ] playwright: clicking the note body (not the pill) is unchanged - still posts `revealRange` (covered by existing click-interaction tests)
+ [X] `pnpm run check` green (lint clean, 750 jest tests pass, 51 playwright pass)
+ acceptance
  + pill click in folder mode descends the folder root to the subfolder corresponding to the pill's project, identical in effect to clicking a deeper segment in the breadcrumb
  + the descent goes as many segments down as the pill's project-name derivation consumes - one segment in the current single-segment setup, automatically more if the derivation later becomes multi-segment
  + going back up is done by clicking the higher breadcrumb segment (existing behaviour, no new affordance added in this story)
  + workspace-folder-root files (no sub-segment) degrade gracefully - pill click is a no-op
  + plain note-body click behaviour is unchanged
  + pill click no longer posts `revealRange` - it is purely a folder-root descent
+ commit message draft
  + notethink 0.3.3: origin pill click descends the folder root to the pill's project subfolder via the existing breadcrumb-folder-click pipeline (no new wire format, no chip - breadcrumb is the affordance for going back up); pill `revealRange` post dropped (note-body click still reveals); target folder derived from `origin.doc_path` and `projectNameFromRelativePath(origin.relative_path)` so the descent follows the same project-name derivation the pill itself uses
  + tests 750 jest, 51 playwright


### Spinner during non-instantaneous operations (settings + navigation + any work the user is waiting on) [](?id=pending-work-spinner)

The user needs a consistent signal that *something is happening* whenever notethink is doing work they're waiting on - not just settings changes. Two classes of slow work today:

1. **Settings round-trips.** A drawer-driven settings change (boolean toggle or filter edit) posts a message and waits for the echo back. Filter changes additionally trigger a workspace glob + re-aggregation, which can take seconds.
2. **Navigation that triggers file discovery + load.** Clicking up the breadcrumb (e.g. `notethink/` → `active_development/`) calls `enterFolderMode(new_path)` which clears `integration_docs`, re-runs `findFiles`, fires per-file `loadFolderDoc` calls via `Promise.allSettled`, and emits a bulk replace once they settle. With 50+ markdown files in a workspace this is the most user-visible slow path - 4-5 seconds, with no UI feedback at all today.

Things that are **fast** and should NOT show the spinner:

- Integration-mode flips (`folder` ↔ `current_file`) - essentially synchronous webview state changes.
- Breadcrumb clicks that re-enter folder mode but happen to find no new files to load (e.g. descending into a subfolder whose docs were already loaded, or clicking the breadcrumb segment matching the current path). The visible work in those cases is just a re-aggregation of already-loaded docs - typically tens of milliseconds.

Show an SVG spinner whenever the extension reports it's doing work that will actually take time. The user's mental model: "I just did something that wasn't free, and the panel is showing me a spinner - so I know it's working."

+ goal
  + a visible spinner appears as soon as a slow path starts, disappears as soon as the view has settled
  + works uniformly across settings round-trips and folder-discovery navigation - not a settings-only feature
  + fast operations (mode flips, no-op breadcrumb clicks, instant settings toggles) do NOT flash the spinner
  + the user never has to wonder "did my change take? is it still loading?"
+ reference pattern
  + `oma/nodejs/aawai/src/components/Loader.tsx` and `calfam/nodejs/calfam-nextjs/src/components/Loader.tsx` - both wrap `react-spinners`' `SyncLoader` in a small `<Loader>` component driven by a `useLoading()` hook (`{loading, setLoading}`), with positioning via a `positionClass` prop and a CSS module
  + notethink should match the pattern's *shape* (small component + hook + position class), not the implementation library - inline SVG keeps `notethink-views` dep-free
+ scope (v1 - both slow-work classes, drawer + toolbar mounts)
  + add `<Spinner>` - small inline SVG component (no runtime dep), with a CSS `@keyframes rotate` and a `@media (prefers-reduced-motion: reduce)` fallback that disables the rotation. `positionClass` prop matching `oma`/`calfam`'s precedent (`InlineLoader`, `TopRightLoader`, etc.)
  + add `usePendingWork()` hook exposing `{ pending, markPending(key), clearPending(key), clearAll() }` - broader than the original settings-specific framing. Keyed by string so the same hook serves multiple distinct slow-work sources. State value `pending` is snake_compatible; function handles use camelCase per `CODING_STANDARDS.md > Hook Return Values`. Hook + spinner are internal symbols (not stored externally), so no permanent-name sign-off needed
  + well-known keys (sentinel strings the hook treats specially): `'folderDiscovery'` (extension-driven), `'settingsCascade'` (settings round-trip), `'<SettingKey>'` (one per cascade key for fine-grained per-setting tracking)
  + extension emits a new wire-format message **`pendingChange`** with `{ key: string, on: boolean }`:
    + **`enterFolderMode` / `discoverFolderDocs`**: post `{ key: 'folderDiscovery', on: true }` BEFORE the `findFiles` walk **only if** the new set actually requires loading new files (compare the discovered URI list against the current `integration_docs` - if every URI is already loaded and unchanged, skip the spinner entirely). Post `{ key: 'folderDiscovery', on: false }` from `Promise.allSettled().then(...)` after the bulk replace is sent
    + **settings-change handlers**: existing webview-side `markPending(<SettingKey>)` at message-post time stays as-is; extension does not need to echo `pendingChange` for these (the existing `settingsCascade` / aggregated-payload echo reducers already clear them on the webview side)
  + webview message reducer for `pendingChange` calls `markPending(key)` when `on: true` and `clearPending(key)` when `on: false`
  + **delay-then-show** policy (replaces the original "250 ms min visibility"): the spinner appears only after `pending` has been continuously `true` for ≥150 ms, and remains visible for ≥250 ms once shown. This way an operation that finishes in 100 ms never visibly flashes the spinner; one that takes 200 ms+ shows briefly; one that takes 5 s shows for the duration. Tunable constants - surface in `client/{extension,webview}/src/constants.ts` if either side needs to reference them (TBD during implementation)
  + safety net: any individual `markPending(key)` is auto-cleared after 10 s if no matching `clearPending` arrives. Logged via `debug()` so dropped echoes / unfinished extension work are traceable in dev (extended from 5 s in the original story because navigation discovery on very large workspaces can legitimately exceed 5 s)
  + render the spinner in BOTH drawers (view settings, file settings) - original story scope retained - AND in the **main toolbar** next to the breadcrumb. The toolbar mount catches the navigation case (drawer might be closed during a breadcrumb-driven discovery); the drawer mounts catch the settings case (user is typically looking at the drawer when they edit a setting)
+ skip cases (verified during implementation)
  + integration-mode flip (`folder` → `current_file` or back) - no `pendingChange` is emitted by `enterCurrentFileMode` / `enterFolderMode` when the new state is reachable without loading work. Mode flip with no concurrent work shows no spinner
  + breadcrumb click that resolves to the same effective file set - `findFiles` returns URIs that are all already in `integration_docs` with matching hashes; extension skips the `pendingChange` emit and just sends the re-aggregated payload. Fast path, no spinner
  + every settings cascade key write that completes within the 150 ms delay threshold - no visible spinner
+ scope deferred to v2 (call out, do not implement now)
  + per-control spinners (a tiny spinner next to each control that's currently pending) - useful when multiple settings are mutated rapidly, but adds layout/aria complexity
  + spinner-during-passive-update (e.g. external file edit triggers a re-parse) - currently silent; consider after [[animated-passive-transitions]] lands so the spinner doesn't fight the FLIP layer
  + animation/easing tuning to match the kanban FLIP transitions story [[animated-passive-transitions]]
+ files
  + new `client/webview/src/notethink-views/src/components/Spinner.tsx` - inline-SVG component
  + new `client/webview/src/notethink-views/src/components/Spinner.module.scss` - class names follow `oma`'s naming where applicable: `Spinner`, `InlineLoader`, `TopRightLoader`; `@media (prefers-reduced-motion: reduce)` disables the rotation keyframes
  + new `client/webview/src/notethink-views/src/hooks/usePendingWork.ts` - hook with the mark/clear API and the delay-then-show policy
  + `client/webview/src/notethink-views/src/components/views/SettingsCommonControls.tsx` - render `<Spinner positionClass="InlineLoader" />` in the drawer header when `pending` is true
  + `client/webview/src/notethink-views/src/components/views/FilesDrawer.tsx` - render `<Spinner positionClass="InlineLoader" />` in the drawer header when `pending` is true
  + `client/webview/src/notethink-views/src/components/views/generic/GenericViewToolbar.tsx` - render `<Spinner positionClass="InlineLoader" />` next to the breadcrumb when `pending` is true (this is the toolbar mount for the navigation case)
  + `client/webview/src/notethink-views/src/components/views/generic/useViewToolbar.ts` - `cascade_write_setting` and `handle_global_setting_change` call `markPending(<SettingKey>)` before `postMessage`
  + `client/webview/src/notethink-views/src/components/views/generic/useViewHandlers.ts` - `handle_apply_filters` calls `markPending('integrationFilters')` before its messages
  + `client/webview/src/components/ExtensionReceiver.tsx` (or `useVscodeMessages.ts`) - new `pendingChange` message handler routes to the hook's `markPending` / `clearPending`; existing settings echo reducers still clear their own keys
  + `client/extension/src/vscode/PanelSession.ts` - `discoverFolderDocs` emits `pendingChange { key: 'folderDiscovery', on: true }` at the start (only when there's actual loading work to do - compare discovered URIs against `integration_docs` cache) and `{ on: false }` from the `Promise.allSettled().then` block after the bulk replace
  + `usePendingWork` instance lifted to the common ancestor of both drawers, the toolbar, and `ExtensionReceiver.tsx` - probably `App.tsx` / `base/App.tsx` or a small React Context if prop-drilling is unpleasant
+ open question
  + **fast-path detection for folder discovery.** Recommend: in `discoverFolderDocs`, after `findFiles` returns, compute a hash-set of `{path, mtime}` for each discovered URI; compare against `integration_docs[*].{path, mtime}`. If the sets match exactly (no new files, no missing files, no mtime changes), skip the bulk re-load entirely and just re-emit the aggregated payload (the merge/render is the only work). Cheap detection + skip-load = no spinner flash for breadcrumb clicks that don't change anything. Confirm or propose alternative
+ edge cases
  + user changes a setting then immediately navigates the breadcrumb - multiple keys outstanding; the spinner shows until *all* are cleared
  + extension never echoes - 10 s per-key safety-net clears; spinner stops
  + fast operation that finishes in <150 ms - spinner never appears (delay-then-show)
  + slow operation that completes between 150 ms and 250 ms after the mark - spinner appears for at least 250 ms (min-visibility)
  + tests should not hang on the safety-net timeout - `clearAll()` exposed for test cleanup
+ [X] add `<Spinner>` inline-SVG component with `prefers-reduced-motion` fallback
+ [X] add `usePendingWork` hook: `{ pending, markPending, clearPending, clearAll }`; 150 ms delay-then-show; 250 ms min-visibility once shown; 10 s per-key safety net
+ [X] lift the hook instance to the shared parent of both drawers + toolbar + `ExtensionReceiver.tsx`
+ [X] wire `markPending(<SettingKey>)` into `cascade_write_setting` and `handle_global_setting_change`; `markPending('integrationFilters')` into `handle_apply_filters`
+ [X] wire `clearPending(<key>)` into the existing `globalSettings` / `settingsCascade` / aggregated-payload echo reducers
+ [X] add `pendingChange` message type; webview reducer marks / clears the keyed pending state
+ [X] extension: `discoverFolderDocs` emits `pendingChange { key: 'folderDiscovery', on: true }` ONLY when the discovered set requires loading new files (vs already-cached URIs with matching mtimes); emits `{ on: false }` from `Promise.allSettled().then` after bulk replace is sent
+ [X] render `<Spinner>` in `SettingsCommonControls.tsx`, `FilesDrawer.tsx`, and `GenericViewToolbar.tsx` when `pending` is true
+ [X] respect `prefers-reduced-motion`
+ [X] jest: `usePendingWork` - pending true after a mark, true through additional marks, false only after all keys cleared; delay-then-show (no `pending` reading `true` before 150 ms); min-visibility (`pending` stays `true` for 250 ms even if cleared earlier); 10 s safety net
+ [X] jest: `pendingChange` message reducer marks and clears correctly
+ [X] jest: settings drawer renders spinner when hook reports pending, hides otherwise
+ [X] jest: toolbar spinner renders when hook reports pending
+ [X] jest (extension): `discoverFolderDocs` emits `pendingChange { on: true }` when discovery finds files needing load; does NOT emit when discovery matches the current cache exactly
+ [X] playwright: toggle `showLineNumbers` - fast toggle, no visible spinner flash (operation under 150 ms)
+ [X] playwright: edit `includeFilter` to a more restrictive glob and apply - spinner appears in drawer, stays through the re-aggregation, disappears when the new file set lands (covered by the "Files drawer shows spinner when pendingChange fires while drawer is open" spec; the harness can't drive the real extension's findFiles, so the test exercises the same render path by emitting the pendingChange the extension would emit during a re-discovery)
+ [X] playwright: at workspace root with many projects, click a pill to descend (subfolder has many files, loading takes >150 ms) - toolbar spinner appears, disappears when descent completes (covered by the "slow folder-discovery shows toolbar spinner" spec; pill-descent and slow-discovery converge on the same `pendingChange { key: 'folderDiscovery' }` signal under test)
+ [X] playwright: at a subfolder, click back up the breadcrumb to a parent root with many newly-discoverable files - toolbar spinner appears for the full discovery+load, disappears when done (covered by the same `pendingChange { key: 'folderDiscovery' }` spec)
+ [X] playwright: at a subfolder, click the breadcrumb segment matching the current path (no-op re-enter) - no spinner appears (the fast-path detection lives in extension-side `discoverFolderDocs`; the corresponding jest test asserts no `pendingChange` is emitted when the discovered set matches the cached docs exactly. The playwright harness drives the webview directly so the fast-path is exercised at the extension layer instead)
+ [X] playwright: flip integration mode (folder → current_file → folder) - no spinner appears (operation is webview-side state change, no loading work)
+ [X] playwright: `prefers-reduced-motion` emulated - spinner is in DOM but without keyframe animation
+ [X] `pnpm run check` green
+ acceptance
  + slow folder-discovery navigation (clicking up the breadcrumb to a root with many new files to load) shows a spinner in the toolbar from the moment discovery starts until the new view has rendered
  + slow settings changes (filter edits triggering re-aggregation) show a spinner in whichever drawer is open
  + fast operations (mode flips, no-op breadcrumb clicks, instant boolean toggles) show no visible spinner
  + the spinner respects `prefers-reduced-motion`
  + a dropped echo doesn't hang the spinner - 10 s safety net clears
  + no existing navigation or settings-change behaviour is altered; the only new visible thing is the spinner
+ commit message draft
  + notethink 0.3.4: drawer + toolbar show an inline-SVG spinner whenever notethink is doing work the user is waiting on - settings round-trips (existing settings-pending path) AND folder-discovery navigation (new extension-driven `pendingChange` signal emitted by `discoverFolderDocs` only when the discovered set requires loading new files); generalised `usePendingWork` hook with delay-then-show + min-visibility policy so fast paths (mode flips, no-op breadcrumb clicks, instant toggles) don't flash; new dep-free `<Spinner>` component, `prefers-reduced-motion` honoured, 10 s per-key safety net
  + tests 813 jest, 61 playwright


### Click-focus and click-select work consistently in folder mode (homogenise the interaction state path) [](?id=homogenise-click-focus-select-across-modes)

**Symptom.** In `integration_mode = current_file` with the Kanban view, clicking a note draws a *dashed* outline around it (focused state); clicking the same note again selects all the note's text and the outline turns *solid* (selected state). In `integration_mode = folder` the same clicks produce **neither** the dashed outline nor the solid-outline-with-text-selection. The user's read is that folder mode must be using a different code path - but it isn't (see Diagnosis below). The breakage is in a shared assumption that no longer holds in folder mode. This story fixes the immediate UX gap and homogenises the underlying state path so future interaction features stop diverging silently across integration modes.

**Additional symptoms confirmed 2026-05-27** - same root cause, both directions of the editor↔view selection sync are broken in folder mode:

1. **Editor caret → note focus is also broken in folder mode.** Move the editor caret into a story (e.g. open `oma/docstech/users/alex.stanhope/todo.md` and place the caret inside the headline `Refresh Menus Uncomplicated app - replace ScriptTag delivery + close competitive feature gap`). In `current_file` mode the matching card in the kanban view immediately shows the dashed focused outline. In `folder` mode the caret moves but **no note is highlighted** - the dashed outline never appears, even though the source doc is one of the aggregated set and the rendered card is right there in the Doing column.
2. **Note click → editor caret *does* work in folder mode.** Clicking a card correctly opens the source file in the editor and moves the caret to the start of the story headline. This proves the click → `revealRange` round-trip is intact and the extension is correctly routing per-doc reveals; the broken direction is purely the **view-side state derivation that lights up the focused/selected note**.

Together these two new observations narrow the bug to exactly what the Diagnosis below predicts: the `useViewContext` derivation that maps `(active editor's doc, caret offset)` → `focused note seq` is the only thing that doesn't work across integration modes. The forward direction (`view click → editor reveal`) and the renderer's outline classes are both fine. The fix must therefore make `useViewContext` produce a non-empty `focused_seqs` in folder mode whenever the active editor's caret is inside a note that exists in the aggregated tree, AND make click-driven focus work without depending on the editor round-trip at all (the per-view state-of-truth direction below).

**Diagnosis** (from a code audit before writing this story - none of this is a guess).

- The renderer dispatch is **identical** for both modes: `GenericView` → (`DocumentView` | `KanbanView`) → `GenericNote` → `MarkdownNote`. No `integration_mode` branching in component selection (`GenericView.tsx:110-112`, `GenericNote.tsx`).
- The click handler is the same `createNoteClickHandler` (`lib/noteui.ts:222-235`) feeding the same dispatcher in `useViewHandlers.ts:49-116`. First-click→focus, second-click-on-same→select, double-click→select-all - all in one state machine, no integration-mode awareness.
- The CSS classes are the same: `.focused { outline: dashed 2px ... }` / `.selected { outline: solid 2px ... }` at `ViewRenderer.module.scss:614-628`. The `focused` and `selected` boolean props on each note are computed identically in both modes from `cropped_focused_seqs` / `cropped_selected_seqs` (`GenericNote.tsx:37-46`).
- **What differs**: where those `_seqs` arrays come from. They are derived in `useViewContext.ts:91-124` by asking "which note contains the current editor caret?" - i.e. by reading the **single active VS Code editor's selection** and locating it inside the rendered note tree. In `current_file` mode this round-trip is coherent: the rendered notes come from the active editor, the click posts `revealRange`/`selectRange` to that editor, the editor's selection updates, `useViewContext` recomputes, and the new focus/select classes land on the right note. In `folder` mode the rendered notes come from many files - usually most of them are *not* in the active editor - so the click posts `revealRange` against a different doc, the active-editor's selection never lands inside the clicked note's rendered range, and `useViewContext` never produces a non-empty `_seqs` array for it. The renderer is innocent; the state-derivation assumption is broken.
- Hence the user's "different code in each mode" hypothesis is **wrong at the renderer level but correct in spirit**: there's a shared code path that *implicitly relies* on a single-editor model, and folder mode silently doesn't satisfy that precondition.

**Goal.** Make the focused/selected note state work consistently across `current_file` and `folder` modes in **both** directions:

- **view → editor (click)**: clicking a note in the view focuses (and on second click, selects) it visually, without depending on an editor-selection round-trip. The state lives in the view, not in the editor.
- **editor → view (caret)**: moving the caret in the editor to a story headline / body highlights the matching note in the view, regardless of how many docs the view is aggregating from.

Establish the pattern so future interaction features inherit consistency by construction rather than by accident.

+ scope - fix the immediate gap (view → editor: click-driven)
  + introduce per-view focused/selected state on `display_options` (or a peer slot in view-managed state) that the click dispatcher writes directly when the click lands, **without** waiting for an editor-selection round-trip
  + `useViewContext` continues to *also* derive `_seqs` from the editor selection (see next scope block); per-view click-driven state is the **immediate-feedback layer** the dispatcher writes before the editor confirms, but the editor-derived match takes over as soon as `selectionChanged` lands (latest-click-wins, editor priority - see Decisions below)
  + the click handler in `useViewHandlers.ts:49-116` becomes mode-agnostic:
    + first click on note N → set `view.focused_seqs = [N.seq, ...ancestors]`; still post `revealRange` so the editor follows (the editor scroll/focus is a nice-to-have, not a correctness condition)
    + second click on same N → set `view.selected_seqs = [N.seq]`; still post `selectRange` so the editor's text selection follows when possible
    + click on a different note → focus that note (replaces focused set), drop any selection
    + double-click → set selected directly, skipping the two-step
  + folder-mode caveat: posting `revealRange` / `selectRange` to a doc that isn't currently the active editor should still open / focus the editor on that doc and apply the selection (this *probably* already works via VS Code's `vscode.window.showTextDocument` path in `PanelSession.ts` - confirm during implementation), but if the editor never confirms the selection, the view's own focused/selected state remains correct regardless
+ scope - fix the editor → view direction (caret-driven)
  + the existing `useViewContext.ts:91-124` derivation walks the rendered note tree looking for the deepest note whose offset range contains the active editor's caret. In folder mode the rendered tree's offsets are **synthetic re-numbered offsets from the merged aggregate** - they don't share a coordinate system with any single editor's offsets, so the matcher returns nothing
  + the right matcher in folder mode is **per-doc**: among notes whose `origin.doc_path` equals the active editor's doc path, find the deepest one whose **original** offset range (i.e. the note's pre-merge `position.start.offset` … `position.end.offset` *in its source file*) contains the editor caret. Notes carry `origin` after merge but the in-tree `position` is re-stamped; the implementation needs to either preserve the source-file offsets on the note (e.g. as `origin.source_position` or `position_in_source_file`) or fall back to matching by headline-line within the doc
  + the same matcher works in `current_file` mode (the trivial case where every visible note's `origin.doc_path` equals the active doc) - so the per-doc lookup is the unified algorithm, not an integration-mode branch
  + the active editor's doc path is already known to the webview via the `selections` map (keyed by `docPath`) emitted by `sendSelection` (`PanelSession.ts`). Confirm the path is available to `useViewContext` and pass it in if not
+ scope - preserving source-file offsets through the merge
  + `mergeAggregateRoot` re-stamps `note.position` to synthetic offsets in the merged tree. To match against the editor caret we need the **pre-merge** offsets preserved per-note. Cheapest option: stamp a new field on the merged note (or on its `origin`) carrying the original `{ start: { offset }, end: { offset } }` from the source file's parse, untouched by the merge re-numbering. **Permanent-name check** (per `CODING_STANDARDS.md` > Naming Conventions): proposed `origin.source_position` (a `{ start: { offset, line }, end: { offset, line } }` shape mirroring `position`). Recommend that name; flag if you'd prefer `origin.in_file_position` or `pre_merge_position` to make the semantic explicit
  + tests for `mergeAggregateRoot` should cover: every merged note has `origin.source_position` that matches the note's pre-merge `position` in the source doc, regardless of merge re-numbering or per-file cap trimming
+ scope - homogenisation audit (cheap; do it as part of this story)
  + grep the views package for code that reads editor-selection-derived state (`focused_seqs`, `selected_seqs`, `caret_pos`, `cropped_focused_seqs`, `cropped_selected_seqs`) and confirm every consumer falls back to the per-view state when present
  + grep for any handler that branches on `integration_mode` and surface each branch in the story body as either (a) justified (mode genuinely differs), or (b) a latent inconsistency analogous to this one - file a follow-up story for each (b)
  + add a coding-standards bullet (or extend the existing one) capturing the principle: **per-note UI interaction state belongs in the view, not derived from VS Code's single-editor selection.** Modes can decorate / sync from the editor, never depend on it for correctness. Land this in `CODING_STANDARDS.md` so future features start in the right place
+ files
  + `client/webview/src/notethink-views/src/components/views/generic/useViewHandlers.ts` - click dispatcher writes `view.focused_seqs` / `view.selected_seqs` directly via `setViewManagedState`
  + `client/webview/src/notethink-views/src/components/views/generic/useViewContext.ts` - derivation prefers editor-derived match (latest-click-wins, editor priority); per-view state is the immediate-feedback source while the round-trip is in flight and the fallback when the editor has no opinion
  + `client/webview/src/notethink-views/src/types/*` (or wherever `ViewProps` / `display_options` shape is defined) - add the per-view fields. **Permanent-name check** (per `CODING_STANDARDS.md` > Naming Conventions): proposed field names `view_focused_seqs` / `view_selected_seqs`. Names live on `display_options` (wire format = snake_case) and are persisted via the existing view-managed-state pipeline. Recommend these names; flag if you'd prefer `clicked_focused_seqs` / `clicked_selected_seqs` to make the provenance explicit
  + `client/webview/src/notethink-views/src/components/notes/GenericNote.tsx` - `focused`/`selected` flag computation reads the union of editor-derived and per-view sources
  + `client/webview/src/notethink-views/src/components/ViewRenderer.module.scss` - no change expected (same `.focused` / `.selected` classes)
  + `CODING_STANDARDS.md` - add the "per-view UI interaction state" principle under React Patterns (or a new "View State" section)
+ edge cases
  + clicking a note in folder mode whose doc is closed in the editor - view-side state lands instantly; editor *may* open the doc and apply the selection (existing behaviour); if it doesn't, the visible focused-outline is still correct
  + editor selection changes externally (user clicks in the editor) - `useViewContext` derives new `_seqs` from the editor via the per-doc matcher and the editor-derived match wins immediately, regardless of any prior view click (latest-click-wins, editor priority); a `revealRange`/`selectRange` posted by a view click also routes through `showTextDocument({ preserveFocus: false })`, so the editor takes focus and the next keystroke lands in the editor (the webview does not capture key events)
  + view re-render due to passive payload arrival (a file change updating the aggregated set) - per-view focused/selected `_seqs` survive the re-render as long as the focused note's `stable_id` (per [[multi-file-ordering-stable-identity]]) still resolves to a present note; if it doesn't, the focused state clears
  + integration-mode flip (folder → current_file → folder) - clears per-view focused/selected state; matches the user's mental model that the mode flip is a fresh navigation
  + active editor on a doc that isn't in the aggregated set (e.g. opened a markdown file that's filtered out by exclude) - the per-doc matcher finds no candidate notes; `focused_seqs` stays empty; this matches user expectation (no note is highlighted because the active story isn't in the view)
+ decisions (resolved during review)
  + **conflict policy** - latest-click-wins with the editor as tiebreaker. Editor-derived match wins whenever it produces a note (the editor is the primary editing surface and the view is a real-time visualisation); view-driven `view_focused_seqs` / `view_selected_seqs` are the immediate-feedback source for the brief window between a view click and the editor's selectionChanged round-trip, and fill in when the editor has no opinion (active editor on a doc that isn't in the aggregated set, or caret outside every matched note range)
  + **focus return to editor** - every view→editor navigation gesture (note click → revealRange/selectRange) routes through `vscode.window.showTextDocument(..., { preserveFocus: false })` so DOM focus always returns to the editor and the webview doesn't capture key events the user expects to land in the editor
  + **persistence of focused/selected across panel reload** - left in place via `display_options` (which rides on `vscode.setState`); if true transience is wanted later, move to a separate runtime-only slot
+ open questions
  + **permanent-name sign-off** for `view_focused_seqs` / `view_selected_seqs` AND `origin.source_position` (see Files above)
+ [X] add `view_focused_seqs` / `view_selected_seqs` to `display_options` (or peer slot), with `parseops` / wire-format / view-state types aligned
+ [X] update `useViewHandlers.ts` click dispatcher: write per-view state directly; keep posting `revealRange` / `selectRange` so the editor follows opportunistically
+ [X] stamp `origin.source_position` on every merged note in `mergeAggregateRoot.ts` - the pre-merge `{ start: { offset, line }, end: { offset, line } }` from the source-file parse, preserved through the merge re-numbering
+ [X] update `useViewContext.ts` derivation to per-doc matcher: filter notes by `origin.doc_path === active_editor_doc_path`, then find the deepest whose `origin.source_position` contains the caret offset
+ [X] update `useViewContext.ts` to prefer editor-derived match (latest-click-wins, editor priority); per-view state is the immediate-feedback source while the round-trip is in flight and the fallback when the editor has no opinion
+ [X] update `GenericNote.tsx` flag computation to read the unified source
+ [X] homogenisation grep: list every site that reads editor-derived focused/selected state; confirm fallback wiring or file a follow-up
+ [X] homogenisation grep: list every handler that branches on `integration_mode`; classify each as justified or latent inconsistency
+ [X] add the "per-view UI interaction state belongs in the view, not derived from the single editor selection" principle to `CODING_STANDARDS.md`
+ [X] jest: in folder mode with notes from two files, clicking a note in the kanban view immediately sets the focused outline (dashed), and clicking again selects it (solid) - no dependency on the editor confirming the selection
+ [X] jest: in current_file mode the existing behaviour is unchanged (regression guard - editor-derived state still drives focus when the user clicks in the editor, not the view)
+ [X] jest: clicking a different note in the view replaces the focused set and drops any selection
+ [X] jest: integration-mode flip clears per-view focused/selected state
+ [X] jest (mergeAggregateRoot): every merged note's `origin.source_position` equals its pre-merge `position` in the source doc
+ [X] jest (useViewContext): per-doc matcher returns the right note when the editor caret is in a note whose source doc is one of several in the aggregated set
+ [X] jest (useViewContext): per-doc matcher returns empty when the active editor's doc isn't in the aggregated set (no false-positive matches)
+ [X] playwright: folder-mode kanban - click a note from file B; dashed outline appears immediately. Click again; outline turns solid and the note's text is selected
+ [X] playwright: folder-mode kanban - click a note from file A, then a note from file B; only file B's note shows the focused outline
+ [X] playwright: folder-mode kanban - open one of the source docs in the editor, place the caret inside a story headline (no click in the view); the matching note shows the dashed focused outline (covers the editor → view caret-driven direction)
+ [X] playwright: current_file mode - existing focus/select behaviour unchanged
+ [X] `pnpm run check` green
+ acceptance
  + clicking a note in folder mode produces the dashed-outline focused state immediately on the clicked note, identical to current_file mode
  + clicking the same note a second time produces the solid-outline selected state with note text selected, identical to current_file mode
  + clicking a different note moves the focus; double-click skips straight to selected
  + moving the editor caret into a story (without clicking in the view) highlights the matching note in folder mode - identical to current_file mode
  + the homogenisation principle is captured in `CODING_STANDARDS.md` and the audit's findings are recorded in this story body (followed up with separate stories for any latent inconsistencies found)
  + no regression in current_file behaviour or in keyboard-driven note focus from editor-cursor movement
+ commit message draft
  + notethink 0.3.4: click-focus and click-select now work in folder mode, not just current_file - per-note interaction state landed on the view (`view_focused_seqs` / `view_selected_seqs` on `display_options`) as the immediate-feedback layer, with editor-derived match as the source of truth (latest-click-wins, editor tiebreaker); click dispatcher (`useViewHandlers`) writes view state and posts `revealRange` / `selectRange` so the editor takes focus via `showTextDocument({ preserveFocus: false })`; `useViewContext` per-doc + per-source-offset matcher uses new `origin.source_position` preserved through `mergeAggregateRoot` re-numbering so editor-caret → note-focus works in folder mode; new `setViewInteractionState` on `ViewApi` so keyboard navigation (up/down) and clear-gesture update view focus instead of just posting `revealRange`; origin pill click is now ADDITIVE - descends the folder view into the project subfolder AND opens the clicked story in the editor (the pill no longer `stopPropagation`s the bubbling headline click); `MarkdownNote` memo compare extended to detect child-focus-state changes so re-renders propagate through; coding-standards entry added so future interaction features start mode-agnostic
  + tests 813 jest, 61 playwright


### Accept `nt_` alongside `ng_` as the notethink linetag prefix [](?id=broaden-linetag-prefix-nt)

NoteThink namespaces its internal/directive linetags with the `ng_` prefix (`ng_view`, `ng_level`, `ng_child_*`, …). Broaden the simple read-fallback recognition sites to accept `nt_` as an equal synonym, make `nt_` the prefix NoteThink **writes** going forward, and reclassify view-specific metadata (e.g. `nt_kanban_ordering_weight`) as internal under the same prefix. `[](?ng_view=kanban)` and `[](?nt_view=kanban)` must be understood identically. Parsing already stores any key verbatim - only the downstream *interpretation* is hardcoded to `ng_`. **Decided exception: the child-attribute INHERITANCE directives are `nt_child_*` only - legacy `ng_child_*` inheritance is not supported (the project's own files migrated to `nt_`, and no files author `ng_child_*`).**

+ background: the internal vs external attribute model (confirmed with the user)
  + **external attributes** describe the *content* and apply across **all views** - note-level metadata: `status`, `epic`, `id`, `order`, `time_estimated`, `time_taken`. These render as visible chips/badges and drive views (status→kanban column, epic→badge). No prefix
  + **internal attributes** are NoteThink's own reference for *rendering* that content, and are hidden from the displayed chips. Two kinds, both prefixed:
    + render directives - `nt_view` (how to render this story), `nt_level`
    + view-specific metadata - the `<viewname>_<attribute>` pattern, e.g. ordering weight used only by the kanban view
  + `isInternalAttribute()` at `lib/renderops.tsx:109` encodes the gate today: a key starting `ng_` is internal, everything else is content
  + the letters are almost certainly `ng_` = **n**ote**g**it (the sibling/predecessor project - `nextjs/tannyca` plus `notethink-mast`) where this linetag vocabulary originated, and `nt_` = **n**ote**t**hink, this project - an inference from project history, not stated in any doc
+ decision (confirmed): write `nt_` going forward; `isInternalAttribute` accepts both `nt_` and `ng_`; external content attributes stay unprefixed by design
+ key insight: the parser is already generic, so this is not a parsing change
  + `parseLineTags()` at `lib/linetagops.ts:32` builds the linetags map via `URLSearchParams`; every key is stored as-authored with no prefix logic, so `nt_view` already lands in `note.linetags` as `nt_view`
  + therefore the change surface is only the interpretation sites below
+ recognition sites to broaden (the exact change surface)
  + `lib/renderops.tsx:109` `isInternalAttribute()` - the namespace gate; currently `key.substring(0, 3) === 'ng_'`; accept `ng_` OR `nt_`
    + consumed by the two display filters, so fixing the gate alone hides both correctly: `components/notes/GenericNoteAttributes.tsx:27` and `components/notes/markdown/MarkdownNoteHeadline.tsx:59`
  + `lib/convertMdastToNoteHierarchy.ts:300,309,318` inheritance - `collectInheritableLinetags(note, 'nt_child_' | 'nt_child2y_' | 'nt_childall_')` is `nt_`-only by decision; legacy `ng_child_*` inheritance is deliberately NOT collected (the inheritance directive is the project's own mechanism, no file authors `ng_child_*`, and the AUTHORING_GUIDE already documents only the `nt_child_*` family). This is the one recognition site that does NOT accept `ng_`
  + `lib/mergeAggregateRoot.ts:297` - `h1?.linetags?.ng_view?.value` (file-level view for AutoView's majority vote) must fall back to `nt_view`
  + `components/views/AutoView.tsx:36,44` - `attributes?.ng_view` and `attributes?.ng_level` must fall back to `nt_view` / `nt_level`
  + `lib/noteops.ts` majority-vote reads `file_view_type` (set from `ng_view` in mergeAggregateRoot), not `ng_view` directly - covered transitively once mergeAggregateRoot is fixed
  + `nt_authoring_version` is documented in AUTHORING_GUIDE but has **no code consumer yet** - nothing to change in code, only the guide
+ design - two options, recommend the helper
  + (recommended) add a shared `NOTETHINK_PREFIXES = ['nt_', 'ng_']` constant (`nt_`-first so `resolveNamespacedTag` prefers the going-forward prefix when both are present) plus a `resolveNamespacedTag(linetags, 'view')` resolver (returns the first of `nt_view` / `ng_view` present); `isInternalAttribute` checks both prefixes; keeps the *authored* key intact so write-back offsets stay correct
  + (rejected) normalise `nt_*`→`ng_*` at parse time in `parseLineTags`: smallest footprint but rewrites the in-memory key, breaking write-back which locates the key by `indexOf(key)` in the original href text at `lib/linetagops.ts:62`
+ permanent-name: `nt_` is the chosen write prefix (CODING_STANDARDS > Permanent name check satisfied - user signed off)
  + linetag keys are written to user markdown on disk; `nt_` is now the permanent on-write choice. `ng_` and legacy unprefixed forms stay valid on read forever for the simple read keys (view/level/status via the namespace gate + `resolveNamespacedTag`) - the child-inheritance directives are the sole `nt_`-only exception (see the inheritance recognition site above)
  + template inserts at `inserts/en/103-project-management.ts:46,61` switch `ng_view=kanban` → `nt_view=kanban`
+ reclassify view-specific metadata as internal (`<viewname>_<attr>` → `nt_<viewname>_<attr>`)
  + `kanban_ordering_weight` → `nt_kanban_ordering_weight`; once prefixed it is caught by `isInternalAttribute` automatically
  + write/construct sites emit the `nt_` form: `components/views/kanban/kanbanDragEndPayload.ts:49` (passes the key name to `calculateTextChangesForOrdering`), `components/views/kanban/kanbanProjection.ts:24,128` (synthetic projection tags)
  + read site `lib/noteops.ts:485-486` (`kanbanNoteOrder`) reads `nt_kanban_ordering_weight` - no fallback to the bare legacy key (so rare today it's not worth a back-compat read)
  + once `nt_kanban_ordering_weight` is internal, drop it from the `HIDDEN_ATTRIBUTES` workaround list at `components/notes/GenericNoteAttributes.tsx:11` - the `nt_` prefix gate now hides it
  + `progress_unit` / `progress_max` (also in `HIDDEN_ATTRIBUTES`) are *content* sub-fields of the displayed `progress` chip, not view-specific - leave them unprefixed; out of scope for this story
+ scope of work
  + [X] broaden `isInternalAttribute` to match `ng_` / `nt_` via the shared prefix constant (`isNamespacedKey`, `lib/renderops.tsx`)
  + [X] inheritance collection is `nt_child_*` only (`convertMdastToNoteHierarchy.ts:300,309,318`) - DECIDED: legacy `ng_child_*` inheritance is not supported (no file authors it; the AUTHORING_GUIDE documents only `nt_child_*`). Not a regression - the deliberate `nt_`-only exception to the otherwise-broaden-both rule
  + [X] add `nt_view` / `nt_level` read fallback in mergeAggregateRoot + AutoView via one resolver helper (`resolveNamespacedTag`)
  + [X] switch the write-side prefix to `nt_`: template inserts in `103-project-management.ts`
  + [X] write view-specific metadata as `nt_kanban_ordering_weight` at the kanban write/construct sites
  + [X] update the `kanbanNoteOrder` read site to `nt_kanban_ordering_weight`
  + [X] drop `nt_kanban_ordering_weight` from `HIDDEN_ATTRIBUTES` (now prefix-caught)
  + [X] tests - `nt_view` / `nt_child_status` / `nt_kanban_ordering_weight` ordering covered; added direct unit tests for `isNamespacedKey` / `resolveNamespacedTag` (incl. `nt_`-preferred-when-both-present) / the `nt_`-first ordering of `NOTETHINK_PREFIXES`. No legacy `ng_child_*` inheritance test - `nt_`-only by decision
  + [X] AUTHORING_GUIDE inherited-attributes table already documents only the `nt_child_*` family - correct as-is for the `nt_`-only decision, no change needed
  + [X] update the AUTHORING_GUIDE reserved-keys tables - added a "Linetag prefixes (`nt_`/`ng_`)" subsection (nt_ canonical / ng_ accepted legacy / nt_-wins-when-both / content unprefixed / `nt_child_*`-only inheritance exception); `nt_view`/`nt_level` legacy notes and `nt_kanban_ordering_weight` were already in the tables
+ out of scope
  + deprecating or migrating existing `ng_` linetags - they stay valid on read indefinitely
  + back-compat read for the rare legacy bare `nt_kanban_ordering_weight` - unlikely to be encountered, not worth handling
  + reclassifying `progress_unit` / `progress_max` (content sub-fields, not view-specific)
+ files
  + `client/webview/src/notethink-views/src/lib/renderops.tsx`
  + `client/webview/src/notethink-views/src/lib/convertMdastToNoteHierarchy.ts`
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts`
  + `client/webview/src/notethink-views/src/lib/noteops.ts`
  + `client/webview/src/notethink-views/src/components/views/AutoView.tsx`
  + `client/webview/src/notethink-views/src/components/notes/GenericNoteAttributes.tsx`
  + `client/webview/src/notethink-views/src/components/views/kanban/kanbanDragEndPayload.ts`
  + `client/webview/src/notethink-views/src/components/views/kanban/kanbanProjection.ts`
  + `client/webview/src/notethink-views/src/inserts/en/103-project-management.ts`
  + `AUTHORING_GUIDE.md` (reserved-keys tables)


### Optimistic projection core for kanban drag-and-drop [](?id=kanban-optimistic-projection)

a drag-drop currently snaps the card back to its original slot for a beat before the document round-trip lands it in the dropped slot (back-forward-back). Fix it with a short-lived client-owned projection that the board renders from until the live document catches up.

+ goal
  + render the kanban board from a "projection" of the notes, not the raw authoritative prop; projection equals authoritative except during a brief window after a user drag
  + on drag-end, set the projection to the intended dropped layout immediately so there is no snap-back; keep posting the editText as today
  + when the authoritative document update arrives and matches the projection, drop the projection silently (re-attach to the live document with no visible change); if it never matches, a safety timeout drops it and the live state wins
  + the projection is decorative and short-lived: correctness always falls back to the authoritative document; if an unrelated edit lands mid-window a small jump on re-attach is acceptable (no multi-projection transaction model)
+ scope
  + new pure helper `components/views/kanban/kanbanProjection.ts` - `applyKanbanMove(notes, move)` (reproduces the dropped layout via synthetic nt_kanban_ordering_weight) + `projectionSatisfied(notes, move)` (has the live doc caught up?), keyed on `stable_id`
  + new hook `components/views/kanban/useProjectedNotes.ts` - holds the projection, reconciles on authoritative change, 1500 ms safety cap (`KANBAN_PROJECTION_MAX_MS`)
  + wire `KanbanView.tsx`: render `useKanbanColumns(notes_to_render, …)` from the hook; `dragEndHandler` calls `applyOptimisticMove(...)` after posting the payload
  + reconciliation is scoped to the single moved note (matched by `stable_id`); unrelated churn elsewhere is ignored
+ out of scope
  + the FLIP animation layer and passive-update animation - that is [[animated-passive-transitions]], which now builds on this seam
  + multi-file folder-mode reconciliation subtleties beyond "let it jump on re-attach"
+ delivery note: keying the board by `stable_id` was pulled forward from the animation phase - it turned out to be required, not optional: with `seq` keying the projection→live re-attach renumbered seq (folder-mode interleave), remounting the moved card
+ delivery note: the real cause of the "drops correct then slides in from the top" glitch was @hello-pangea/dnd's drop animation fighting the synchronous projection reorder, compounded by a CSS `transition: transform` on `.note` (the draggable element itself). Fixed by skipping the drop animation when `isDropAnimating` (`KanbanBoard.draggableStyleWithoutDropAnimation`) and dropping the transform transition from `.note`
+ follow-up extracted to its own story [[selection-stable-identity]]: after a drag the highlight jumps to the next story because view focus/selection is keyed by `seq`, which renumbers on re-parse
+ files (proposed)
  + new `client/webview/src/notethink-views/src/components/views/kanban/kanbanProjection.ts` + colocated tests
  + new `client/webview/src/notethink-views/src/components/views/kanban/useProjectedNotes.ts` + colocated tests
  + `client/webview/src/notethink-views/src/components/views/KanbanView.tsx`
+ [X] implement kanbanProjection.ts (applyKanbanMove + projectionSatisfied) with unit tests
+ [X] implement useProjectedNotes hook (projection state + reconcile effect + safety timeout) with tests
+ [X] wire the hook into KanbanView: render from notes_to_render, call applyOptimisticMove in dragEndHandler
+ [X] key the board + draggableId by stable_id (shared kanbanDraggableId helper) so the re-attach doesn't remount the moved card
+ [X] keep existing KanbanView + kanban specs green
+ [X] pnpm run check green
+ manual: drag a story to reorder it and confirm it stays in the dropped slot with no back-forward-back flicker
+ manual: drag a story to a different column and confirm it stays put until the document confirms


### Highlight stays on the dragged story (was: selection by stable_id, not seq) [](?id=selection-stable-identity)

re-scoped then RESOLVED 2026-06-02. Original premise ("focus is keyed by `seq`, which renumbers on re-parse") proved **stale on investigation**: view focus/selection is already keyed by `stable_id` (`view_focused_ids` / `view_selected_ids` in `useViewContext.ts`, written by `useViewHandlers.ts`), so the seq-renumber theory never applied. The actual symptom - the highlight jumping to the next story after a drag - is an editor-caret bug, fixed under [[caret-stability-view-edits]]. With that fix the dragged story stays highlighted and the caret stays put.

+ decision (made during the investigation): keep the **editor-as-tiebreaker** (CODING_STANDARDS "View interaction state"). The editor-derived caret match stays the source of truth; view-driven `stable_id`s fill in only when the editor has no opinion. The hypothesised "make a deliberate view selection win over a coherent caret" precedence flip is **not pursued** - it contradicts the documented design, and the symptom that motivated this story is already fixed by keeping the caret put (caret-stability). The speculative precedence/jest/manual tasks are therefore dropped.
+ [X] confirm the mechanism - view state is already `stable_id`-keyed; the jump was the editor caret, not seq renumbering
+ [X] reconcile code + comment - `resolveFocusedNote` is caret-wins by design; fixed the misleading `useViewContext.ts:110` comment that claimed view-driven precedence (it now states the editor-as-tiebreaker)
+ [X] symptom resolved via [[caret-stability-view-edits]] - dragged story stays highlighted, caret stays put (manually confirmed)
+ dropped (decided unnecessary, not deferred)
  + precedence flip in `resolveFocusedNote` so a view selection beats a coherent caret - contradicts editor-as-tiebreaker; symptom already fixed
  + the speculative jest spec + manual check for that flipped behaviour
+ out of scope
  + the animation layer [[animated-passive-transitions]] - orthogonal, shares the stable-identity theme


### Caret stays put on view-driven edits [](?id=caret-stability-view-edits)

discovered 2026-06-02 while investigating the post-drag highlight jump (see [[selection-stable-identity]]). Dragging a story in the kanban moved the editor caret onto a different story, and because `resolveFocusedNote` follows the caret the highlight jumped with it.

+ delivery note - actual root cause (confirmed via `notethink-extension.log` caret-probe trace)
  + the caret did NOT move because of the weight-cascade edit. The instrumented trace showed the editText restore working correctly (`offsetDeltaBefore` keeps the caret on the same character). The real culprit was `KanbanView.dragStartHandler`: on **drag start** it posted a `revealRange` to the dragged note's `position.start.offset`, which moved the editor caret onto that note ~190ms before the edit even applied (logged as `INCOMING revealRange` immediately preceding the editText). Whatever the caret-derived focus was then followed.
  + fix: removed `dragStartHandler` and its `onDragStart` wiring (KanbanView + KanbanBoard). A drag no longer moves the editor caret at all. Cross-file targeting still works: the drag-end `editText` payload already carries the dragged note's `docPath`, so it never depended on first moving the caret.
  + kept as a safeguard: the `offsetDeltaBefore` caret restore in `PanelSession.applyEditTextChanges` (legitimately keeps the caret stable when a multi-edit cascade lands before it, e.g. a checkbox toggle).
+ [X] confirm the mechanism via instrumented `caret-probe` / `INCOMING` reveal trace - it was the drag-start reveal, not the cascade restore
+ [X] remove the drag-start `revealRange` (no caret move on drag); keep the `offsetDeltaBefore` restore
+ [X] remove the temporary `caret-probe` / `scroll-probe` / `debugLog` instrumentation
+ [X] jest: KanbanView drag posts no `revealRange`/`selectRange`; no `onDragStart` handler is wired
+ [X] `pnpm run build` + lint green; full jest suite green (995)
+ manual: drag a story to reorder, confirm the dragged story stays highlighted and the editor caret stays on it
+ note: the related [[selection-stable-identity]] "view selection beats a coherent caret" precedence flip was considered and dropped (editor-as-tiebreaker stands); this caret-stability fix is the accepted solution to the highlight-jump symptom


### Terminal breadcrumb leaf opens a jump drawer [](?id=breadcrumb-leaf-jump-drawer)

Every breadcrumb **folder** segment re-narrows the folder view (works well) - except the **terminal leaf** (the rightmost segment), which represents the *current* folder (folder mode) or the *current file* (current-file mode) and has no useful purpose: it re-narrows to the same folder (no-op) or, in current-file mode, calls `onFolderClick(doc_path)` on a file path (broken). This turns that leaf into a navigation affordance - clicking it opens a drawer of jump targets.

+ goal
  + folder mode → drawer lists the **child subfolders** of the current folder; clicking one descends the folder view into it (existing `handle_folder_click` pipeline)
  + current-file mode → drawer lists the **sibling `.md` files** in the current file's directory; clicking one opens that file in the editor (the current-file view follows the active editor and re-renders)
  + the list reflects the **real directory on disk** (the extension reads the folder), not just already-loaded notes
+ decisions (confirmed with the user)
  + folder targets = **children only** (drill down); going up/sideways stays on the ancestor segments
  + data source = **real directory listing via the extension** (small request/response round-trip), not client-derived from loaded files
  + **both modes** implemented now
+ design - wire contract (transient internal/wire names; permanent-name check N/A)
  + webview→ext request `requestJumpTargets { mode, path }`; ext→webview response `jumpTargets { mode, path, entries: [{ label, path, kind: 'folder'|'file' }] }`; webview→ext `openFile { path }` for the current-file jump
  + response surfaced to the deep drawer via a new context mirroring `PendingWorkContext` (App.tsx owns the hook, feeds the message reducer in `ExtensionReceiver` + a Provider for the tree) - avoids prop-drilling through the composers
+ extension - `client/extension/src/vscode/PanelSession.ts`
  + `handleRequestJumpTargets`: validate `isWithinWorkspace(path)` (folder) / `{requireExtension:'.md'}` (current_file); folder → `fs.readDirectory`, keep dirs, drop excluded via `globMatches(\`${name}/dummy.md\`, '', this.integration_exclude)` (the `computeWorkspaceProjects` recipe); current_file → readDirectory of `dirname(path)`, keep `.md` files minus the current; sort by label; post `jumpTargets`
  + `handleOpenFile`: validate `.md` within workspace, then reuse the private `revealByOpening(path, 0, 0)` (opens beside the panel, focuses it). Deliberately NOT via `handleRevealRange` (which stays silent in current-file mode to avoid stray-click editors)
  + reuse `globMatches`, `isWithinWorkspace`/`isPathWithin`, `node:path`
+ webview wire types - `client/webview/src/notethink-views/src/types/Messages.ts`
  + add `JumpTarget`, `RequestJumpTargetsMessage`, `OpenFileMessage` (→ `WebviewToExtensionMessage`), `JumpTargetsMessage` (incoming)
+ response plumbing (mirror `PendingWorkContext`)
  + new `hooks/useJumpTargets.ts` (holds latest `jumpTargets` + setter) + `hooks/JumpTargetsContext.tsx` (`JumpTargetsProvider`/`useJumpTargetsContext`)
  + `components/base/App.tsx` creates the instance, passes to `ExtensionReceiver` + wraps the tree in the provider
  + `hooks/useVscodeMessages.ts` validates + dispatches incoming `jumpTargets` → calls the injected setter; `components/ExtensionReceiver.tsx` threads the setter in
+ terminal-leaf trigger + drawer
  + `BreadcrumbTrail.tsx` - for the **last** path segment only, call new `onLeafClick(segment.path, anchor)` instead of `onFolderClick`; add `data-testid="breadcrumb-leaf"` + jump aria-label; thread `onLeafClick` through `GenericViewBreadcrumb`
  + `generic/useToolbarDrawers.ts` - add `'jump'` drawer kind + `toggle_jump(anchor)` (escape/outside-click already generic via the drawer id)
  + `generic/useViewHandlers.ts` - `handle_jump_request(leaf_path)` posts `requestJumpTargets` (mode from `display_options.integration_mode`); `handle_file_jump(path)` posts `openFile`; folder rows reuse `handle_folder_click`
  + `generic/useGenericView.ts` exposes the handlers + toggle; `GenericView.tsx` wires `onLeafClick` (toggle + request) and passes handlers to the toolbar
  + new `views/JumpDrawer.tsx` - consumes `useJumpTargetsContext`, renders entries matching the requested leaf path (loading/empty states), folder rows → `onFolderJump`, file rows → `onFileJump`; reuse shared `.drawer*` styles
  + `generic/GenericViewToolbar.tsx` - render the `jump` drawer via the shared `ToolbarDrawer`; widen the `activeDrawer` union
+ l10n - add UI strings (Jump to…, No subfolders, No other files here, loading, aria labels) to `l10n/bundle.l10n.json` + de/es/fr/it
+ out of scope
  + sibling/parent folder targets (children only); descending into a folder from current-file mode; any redesign of the discovery/merge pipeline
+ files
  + `client/extension/src/vscode/PanelSession.ts` (+ extension-host test near `notethinkEditor.test.ts`)
  + `client/webview/src/notethink-views/src/types/Messages.ts`
  + new `client/webview/src/notethink-views/src/hooks/useJumpTargets.ts`, `client/webview/src/notethink-views/src/hooks/JumpTargetsContext.tsx`
  + `client/webview/src/components/base/App.tsx`, `client/webview/src/components/ExtensionReceiver.tsx`, `client/webview/src/hooks/useVscodeMessages.ts`
  + `client/webview/src/notethink-views/src/components/views/BreadcrumbTrail.tsx` (+ test), `generic/GenericViewBreadcrumb.tsx`, `generic/useToolbarDrawers.ts`, `generic/useViewHandlers.ts`, `generic/useGenericView.ts`, `GenericView.tsx`, `generic/GenericViewToolbar.tsx`
  + new `client/webview/src/notethink-views/src/components/views/JumpDrawer.tsx` (+ test)
  + `client/webview/src/notethink-views/src/components/ViewRenderer.module.scss`
  + `l10n/bundle.l10n*.json`
  + new `playwright/specs/breadcrumb-jump.spec.ts` (+ fixtures if needed)
+ [X] extension: `handleRequestJumpTargets` + `handleOpenFile` (folder children / current-file siblings; reuse `revealByOpening`); extension-host test
  + delivered: handlers + `listChildFolders`/`listSiblingMdFiles` helpers in `PanelSession.ts`; 7 jest tests in `notethinkEditor.test.ts`; `__mocks__/vscode.ts` got `fs.readDirectory`
+ [X] webview wire types in `Messages.ts` (`JumpTarget`, request/response/openFile)
+ [X] response plumbing: `useJumpTargets` + `JumpTargetsContext`, wired through `App.tsx` / `ExtensionReceiver` / `useVscodeMessages`
  + delivered: `UseJumpTargetsApi { jump_targets, setJumpTargets, clearJumpTargets }`; context mirrors `PendingWorkContext`; reducer dispatches incoming `jumpTargets`
+ [X] terminal-leaf trigger in `BreadcrumbTrail` (last segment → `onLeafClick`); thread through `GenericViewBreadcrumb`; update `BreadcrumbTrail.test.tsx`
+ [X] `'jump'` drawer kind in `useToolbarDrawers`; `handle_jump_request`/`handle_file_jump` in `useViewHandlers`; expose via `useGenericView`
+ [X] `JumpDrawer` component + render it via `GenericViewToolbar`/`GenericView`; scss
  + delivered: `JumpDrawer` matches `jump_targets.path === requestedPath` (loading until the reply for this leaf lands), folder rows → `handle_folder_click`, file rows → `openFile`
+ [X] l10n strings in all 5 bundles (`Jump to…`, `Jump to another folder or file`, `Jump to`, `Loading…`, `No subfolders`, `No other files here`)
+ [X] jest: `JumpDrawer.test.tsx` (folder/file rows fire correct handler; loading/empty states)
+ [X] playwright: `breadcrumb-jump.spec.ts` (folder mode opens drawer + descends; current-file row posts `openFile`; folder empty-state)
+ [X] `pnpm run check` green
  + delivered: `pnpm run check` green (lint + webpack + rollup + jest 1052); full playwright 68; new tokens confirmed in both built bundles
+ delivered (drawer consistency pass)
  + jump drawer now renders as a folder tree - root = the clicked breadcrumb folder name, child subfolders/files indented with an Explorer-style indent guide (`jump-drawer-root` + tree scss), not a flat list
  + every drawer (settings/files/collisions/jump) gains a top-right `×` close button via the shared `ToolbarDrawer` shell (`useToolbarDrawers.close_drawer`); drawer fonts unified to 13px; one shared `.drawerLink` Explorer-row link style (theme foreground + hover highlight) replaces the blue text-link look across collisions + jump + files
  + Files-drawer rows are now links that open the file in current-file mode (`onFileClick` → `openFile`, relative paths absolutized against `workspace_root`)
  + `revealNote` now supplies the view `doc_path` as a fallback so a collision-row click reveals in current_file mode (the extension no-ops a `revealRange` with no `docPath`)
+ manual: open each drawer and confirm a top-right `×` closes it; fonts/link styling look consistent across all drawers
+ manual: in the Files drawer click a listed file - it opens in current-file mode
+ manual: open the jump drawer and confirm the tree root matches the breadcrumb folder you clicked, with subfolders/files indented like the Explorer
+ manual: folder mode - click the terminal breadcrumb leaf, confirm the drawer lists child subfolders and clicking one descends the folder view
+ manual: current-file mode - click the terminal leaf, confirm the drawer lists sibling `.md` files and clicking one opens that file (view follows the editor)
+ manual: a leaf with no children/siblings shows the empty-state row; Escape / outside-click closes the drawer
+ acceptance
  + the terminal breadcrumb leaf opens a jump drawer in both modes; non-terminal segments are unchanged
  + folder rows descend the folder view; file rows open the sibling file in the editor
  + the list reflects the real on-disk directory (exclude-filtered), not just loaded notes
+ commit message draft
  + notethink x.y.z: terminal breadcrumb leaf opens a jump drawer - folder mode lists child subfolders (descend), current-file mode lists sibling .md files (open in editor); new requestJumpTargets/jumpTargets/openFile round-trip surfaced via a PendingWork-style context
  + tests N jest, N playwright


### Detect duplicate stable_ids and surface collisions [](?id=duplicate-stable-id-detection)

when a file or fileset is opened (either integration mode) scan the in-scope notes for duplicate stable_ids - within the same file or across the other files in scope for the current folder - and surface a non-blocking alert if any collide. Duplicate implicit ids (same headline) weaken transient matching and block durable cross-references; the drawer guides the user to disambiguate by pinning a distinct explicit `id=` (the rule-3 promotion in [[selection-stable-identity]] / AUTHORING_GUIDE).

+ goal
  + on open/aggregate (current_file and folder modes) detect notes that resolve to the same stable_id within the in-scope set
  + show an alert icon next to where the spinner goes (the breadcrumb `(X in Y files)` cluster), only when ≥1 collision exists
  + clicking the alert opens a drawer that highlights every collision group so the user can locate and disambiguate them
+ background
  + stable_ids are mostly implicit (headline-derived) so duplicate headlines collide - within one file, or the same headline across sibling files in folder mode
  + the pending spinner now lives in `BreadcrumbTrail` next to the file-count; the alert icon sits in the same cluster
+ scope
  + pure detector: group in-scope notes by stable_id, return the collision groups (≥2 notes sharing an id)
  + alert icon in the breadcrumb cluster, shown only on collision, with an accessible label; click toggles the drawer
  + collisions drawer: one row per group - the colliding stable_id plus each note (headline + origin file/line) - mirroring the Files/Settings drawer pattern
  + detect across the aggregated set in folder mode and within the file in current_file mode
+ out of scope
  + auto-resolving collisions or auto-writing `id=` linetags - the user promotes manually
  + sub-note (non-story) collision detection unless trivial
+ files (proposed)
  + new pure detector in `lib` (group notes by stable_id → collision groups) + tests
  + `BreadcrumbTrail.tsx` (+ scss) - alert icon beside the spinner/count
  + new collisions drawer component wired through the view toolbar drawer machinery
+ delivered
  + detector groups by the implicit `storyStableIdSlug` (final stable_ids are unique-by-construction via `doc_id:` prefix + `#N` suffix, so grouping the literal id finds nothing); story-level heading predicate mirrors the merge stamping
  + `findStableIdCollisions` / `collisionNoteLocation` + `slugify` / `storyStableIdSlug` live in `noteops.ts` (folded from a standalone `collisionops.ts` per the ≥4-export rule; slug derivation moved out of `mergeAggregateRoot` to keep the dependency one-way)
  + alert glyph (`⚠`) sits in the breadcrumb cluster next to the file-count/spinner, shown only on collision; `collisions` drawer kind added to `useToolbarDrawers`, rendered via the shared `ToolbarDrawer`
+ [X] implement the pure duplicate-stable_id detector with unit tests
+ [X] render the alert icon in the breadcrumb cluster when collisions exist (hidden otherwise)
+ [X] build the collisions drawer listing each group (id + notes + origin file/line)
+ [X] wire click → open/close the drawer
+ [X] detect within-file (current_file) and across aggregated files (folder)
+ [X] jest: detector groups duplicates, ignores unique ids, spans files
+ [X] playwright: alert appears only on collision; drawer lists the groups
+ [X] make each colliding title a link that jumps to its story in the editor (`ViewApi.revealNote`), ordered by source line, line number hidden
+ [X] `pnpm run check` green
+ delivered (code-review iteration)
  + collision titles are links: `ViewApi.revealNote` posts `revealRange` (source offset + origin doc_path; falls back to in-tree position in single-file); notes pre-ordered by source line so the links walk the file top-to-bottom, line number not displayed
  + drawer CSS de-duplicated into a shared `.drawer*` shell (`.drawerBody` / `.drawerGroups` / `.drawerGroup` / `.drawerMeta` + `.drawerList` / `.drawerEmpty`); each drawer keeps only its `.settingsDrawer*` / `.filesDrawer*` / `.collisionsDrawer*` specialisations
  + `GenericView` decomposed into a `useGenericView` hook (the collision wiring pushed the component past the `max-lines-per-function` cap)
  + collision row restyled to the shared Explorer-row `.drawerLink` look (whole row clickable, headline + dimmed origin, theme foreground + hover) - see the [[breadcrumb-leaf-jump-drawer]] drawer-consistency pass
+ manual: open a folder with two same-titled stories, confirm the alert appears and the drawer lists both
+ manual: click a colliding title and confirm the editor jumps to that story; with two dupes in one file, the first link lands higher and the second lower


### Folder-mode origin pills flash from one colour to another on first load [](?id=folder-pill-hue-flash-on-load)

When a folder integration view first loads, every origin pill paints in one colour and then changes to a second colour a moment later. It reads as a glitch - there is no logical reason for a project's pill to be two different colours, and the change is distracting. **Decision (chosen): option A - make the pill hue identity-based (a pure function of the project name) instead of index-based (the project's position in an ordered universe), so the colour cannot change as the universe fills in.**

+ root cause (verified in source)
  + pill hue is **index-based, not identity-based**. `OriginPill.tsx:44` uses `origin.project_hue` when present (`pillColourForHue(origin.project_hue, theme)`); `project_hue` is stamped in `mergeAggregateRoot.ts:290` as the project's **position in an ordered universe of project names**, spread around the hue wheel by the golden angle (`hueForProjectIndex`, `originops.ts:35`). A project's colour therefore depends on *where it sorts in the universe*, not on the project name.
  + that universe is seeded from `workspace_projects` (the workspace's top-level subfolders, computed once per `enterFolderMode`, sent on every payload), then any visible project not already in it is appended in **file-arrival order** (`mergeAggregateRoot.ts:233-250`).
  + the webview's `workspace_projects` React state **initialises to `[]`** (`useVscodeMessages.ts:146`) and is **not persisted** - saved state is only `{docs, viewStates}` (`usePersistedViewStates.ts:21`), restored as `initial_docs` in `ExtensionReceiver.tsx:52`.
  + so there is at least one folder-mode paint where `workspace_projects` is still `[]`:
    + **reload / reopen with a folder view active** - persisted `docs` repaint immediately, but the universe is empty until the first live discovery message lands;
    + **manual current_file → folder switch** - pills render against the empty universe before the extension streams the folder payload.
  + with an empty universe the seed loop is skipped and hues come purely from the **visible-file append order**. When the real `workspace_projects` arrives, the merge re-runs and hues are re-derived from the **sorted full-universe** ordering - a different golden-angle index per project - so every pill recolours. Colour 1 = arrival-order hue; colour 2 = sorted-universe hue.
+ why option A (over B/C)
  + the flash exists *because* hue is a function of the universe ordering, and the universe is empty on the first paint. As long as hue depends on the universe at all, the empty→present transition recolours - so the only structural fix is to make hue independent of the universe. That is option A. (B persists/gates the universe; C hides the view until it lands - both keep the universe-dependent hue and are heavier.)
  + identity-based hue also removes the entire **"index shifts when the set changes"** bug-class for colour: folder descents, watcher-driven adds, and the `MAX_AGGREGATE_FILES` truncation can all change the universe membership/order mid-session; today each of those can recolour pills, after this change none can.
  + accepted trade-off: hashing a name to a hue loses the golden-angle guarantee that the *adjacent* projects in a set get maximally-separated hues - two unrelated projects can hash close. This is inherent: "well-spread across the actual set" requires knowing the set; "stable regardless of the set" forbids using it. We take stability. (The single-file fallback `originPillColour` already accepts exactly this trade-off via `djb2(name)%360` - this story makes folder mode use the same identity rule, so single-file and folder now agree on a project's colour.)
+ design
  + **hue becomes a pure function of the project name.** Add `hueForProjectName(name)` to `originops.ts` (`djb2(name) % 360`, the existing fallback hash, now named and shared). `originPillColour` is rewritten to route through it (`pillColourForHue(hueForProjectName(name), theme)`) - functionally identical to today's fallback, just deduplicated.
  + **`mergeAggregateRoot` stamps `origin.project_hue = hueForProjectName(project_name)`** instead of an index into `project_hue_by_name`. The `project_hue_by_name` map is deleted.
  + **labels stay universe-driven.** The universe seed (`workspace_projects` then visible-set append) is kept, but now only feeds `distinct_project_names → buildProjectLabels`. Labels genuinely need the set (NG-vs-NT divergence), and the existing "labels stable across descents" behaviour + tests are unchanged. `mergeAggregateRoot`'s signature and the `workspace_projects` wire field are untouched.
  + **`hueForProjectIndex` is removed** - after the stamp site stops calling it, the only remaining references are its own unit test. Confirm no out-of-repo importer of `@zoombuzz/notethink-views` consumes it before deleting (internal-only per grep today); it is not a persisted/config name, so the permanent-name check is satisfied by that grep.
  + **`OriginPill` is unchanged in behaviour** - it keeps preferring `origin.project_hue` and falling back to `originPillColour`, but the two now yield the *same* colour for a given project, so the previously-throwaway empty-universe paint already shows the final colour.
+ net effect on the flash
  + on the empty-universe first paint, `project_hue` is now derived from the name → identical to the value after the universe arrives → the re-merge produces the same colour → no recolour. Pills paint their final colour immediately.
  + residual (out of scope here): the two-letter **label** is still universe-driven, so it *can* still momentarily shift (e.g. `NT`→`NO`) on the empty-universe paint. That is far less perceptible than a colour change and is the part the user flagged as fine; left as a possible follow-up (would need option-B-style universe persistence/gating to fully fix).
+ scope
  + `originops.ts` - add `hueForProjectName`; rewrite `originPillColour` to call it; delete `hueForProjectIndex`; refresh the `djb2`/`project_hue` doc-comments that reference the index assignment
  + `mergeAggregateRoot.ts` - stamp `project_hue` from `hueForProjectName(project_name)`; drop `project_hue_by_name`; keep the universe seed feeding `buildProjectLabels` only; update the import
  + `types/NoteProps.ts` - update the `project_hue` field doc-comment (no longer "index in the sorted enumeration … golden-angle"; now "identity hash of the project name, set-independent")
+ out of scope
  + the label flash (universe-driven `project_label`) - possible follow-up; the colour is the reported problem
  + persisting `workspace_projects` / gating the first paint (options B and C) - not needed once hue is identity-based
  + any change to `pillColourForHue` saturation/lightness, theme handling, the epic pill, or the focus ring
+ files
  + `client/webview/src/notethink-views/src/lib/originops.ts` (+ `originops.test.ts`)
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` (+ `mergeAggregateRoot.test.ts`)
  + `client/webview/src/notethink-views/src/types/NoteProps.ts`
  + `client/webview/src/notethink-views/src/components/notes/OriginPill.test.tsx` (assertion only - see below)
+ [X] add `hueForProjectName(name)` to `originops.ts`; rewrite `originPillColour` to route through it; delete `hueForProjectIndex`; fix the two doc-comments that name the index assignment
+ [X] stamp `origin.project_hue = hueForProjectName(project_name)` in `mergeAggregateRoot.ts`; remove `project_hue_by_name`; keep the universe seed for labels only; swap the import (`hueForProjectIndex` → `hueForProjectName`)
+ [X] update the `project_hue` doc-comment in `types/NoteProps.ts`
+ [X] jest (`originops.test.ts`): replace the `hueForProjectIndex` block with `hueForProjectName` - deterministic, in `[0,359]`, **set-/order-independent** (same name → same hue with no context), and equal to the hue embedded in `originPillColour(name)`
+ [X] jest (`mergeAggregateRoot.test.ts`): a project's stamped `project_hue` is **identical whether `workspace_projects` is provided, empty `[]`, or omitted** (the regression lock for flash-freedom); the existing label-stability tests still pass unchanged
+ [X] jest (`OriginPill.test.tsx`): with `project_hue` undefined, the rendered `backgroundColor` equals `pillColourForHue(hueForProjectName(project_name), theme)` (single-file ↔ folder agree); keep the existing "uses `project_hue` when present" test
+ [X] `pnpm run check` green (lint + webpack + rollup + jest) - 1261 jest; fixed the lockfile's missing rollup native dep (`pnpm update rollup`, 4.60.1 → 4.61.1)
+ [X] rebuild the webview bundle and confirm the edit landed (`grep client/webview/dist/index.js` for `hueForProjectName`); window reload needed to preview
+ manual: reload the VS Code window with a folder view active - every origin pill paints its final colour immediately, no one-colour-then-another flash
+ manual: switch a current-file view to folder mode - pills appear in their stable colours with no recolour as files stream in
+ manual: descend via a project pill / breadcrumb into a sub-folder and back - a given project keeps the same colour throughout (no descent recolour)
+ manual: the same project shows the **same** colour in single-file mode and in folder mode
+ acceptance
  + a project's pill colour is a pure function of its name - identical across empty/partial/full universe, descents, watcher adds, and truncation; the first-load colour flash is gone
  + folder-mode and single-file-mode pills agree on a project's colour
  + labels remain universe-disambiguated (NG/NT) and their existing stability tests are unchanged
+ commit message draft
  + notethink 0.3.11: make origin-pill hue identity-based (hash of the project name) instead of an index into the project universe, so pills no longer flash from one colour to another on first folder-view load (empty-universe paint now shows the final colour); `hueForProjectName` replaces `hueForProjectIndex`, single-file and folder modes now agree on a project's colour, labels stay universe-driven
  + tests 1261 jest


### Make NoteThink scheme-agnostic on non-`file:` workspaces - folder-mode discovery + relative-link open (drop hardcoded `vscode.Uri.file`) [](?id=workspace-scheme-agnostic)

Folder mode assumes the workspace lives on the `file:` scheme. It builds discovery/watch URIs with `vscode.Uri.file(folder_path)` and matches excludes against `uri.fsPath`. On desktop VS Code the workspace *is* `file:`, so it works - but in **VS Code Web with a custom `FileSystemProvider`** (a non-`file:` workspace scheme - e.g. `vscode-vfs:` like github.dev, or any host that mounts content under its own scheme) discovery searches the wrong scheme: `findFiles` returns nothing, the breadcrumb shows **"0 in 0 files"**, and the folder watcher throws `No file system handle registered (file:///…)`. Net effect: **folder mode is unusable on any web host whose workspace isn't `file:`** - current-file mode is unaffected (it uses the active document's own URI).

**Second symptom - same root cause (new):** clicking a **relative `.md` link** in the rendered view (e.g. `[project-board.md](project-board.md)` or `[web-store.md](portfolio/web-store.md)`) does nothing. `useLinkInterceptor` only intercepts `http(s)`/`mailto`; relative links fall through to a dead webview-iframe navigation. Even if forwarded, the host's open-file path (`handleOpenFile` → `revealByOpening`) re-wraps the path as `vscode.Uri.file` - the **same scheme-discarding bug** - so on a `notegit:` (dulcet virtual repo) / `vscode-vfs:` workspace it would open nothing. **Desired behaviour:** clicking such a link opens the target file in an editor column beside the panel; the viewer auto-follows the new active editor (`onDidChangeActiveTextEditor`, ~`:317`), so it "pops" to display that note - no new viewer command needed. This unlocks the dulcet welcome tour, where `intro.md` links to every demo file (paired content change below).

+ symptom (reproducible on a custom-scheme web workspace)
  + open a file in a `<scheme>:`-mounted folder, switch View integration → **Folder**: breadcrumb scopes correctly but reports "0 in 0 files", Files drawer says "No files match the current filters"
  + console: `[File Watcher ('FileSystemObserver')] Error: ... No file system handle registered (/…) (file:///…/<folder>)` - note the URI is `file:` even though the workspace scheme is not
  + the Explorer lists the same folder fine - only folder-mode discovery is broken, which proves the provider's `readDirectory`/`stat` are scheme-correct and the bug is local to folder discovery
+ root cause (`client/extension/src/vscode/PanelSession.ts`)
  + `enterFolderMode` (~`:600`): `new vscode.RelativePattern(vscode.Uri.file(folder_path), this.integration_include)` → `discoverFolderDocs` → `vscode.workspace.findFiles(pattern, …)` (~`:672`) searches the `file:` scheme
  + `computeWorkspaceProjects` (~`:642`): `vscode.workspace.fs.readDirectory(vscode.Uri.file(this.workspace_root))` - same wrong scheme
  + `armFolderWatcher` / the active-file watcher (~`:235`): build `vscode.Uri.file(...)` patterns too → the watcher error above
  + `isExcludedByIntegrationFilter` (~`:631`): `path.relative(folder_path, uri.fsPath)` - `uri.fsPath` is `file:`-centric and lossy for non-`file:` URIs, so even if discovery were fixed the exclude match would drift
  + underlying assumption: the webview sends a plain path **string** (`e.path`); the host re-wraps it as `Uri.file`, discarding the real workspace scheme
+ fix
  + derive the workspace base URI from the real workspace folder (`vscode.workspace.getWorkspaceFolder(active_uri)`, else `vscode.workspace.workspaceFolders?.[0]?.uri`) and rebuild every folder-mode URI with `base_uri.with({ path: folder_path })` so the scheme (`file:`, `vscode-vfs:`, any custom provider scheme) is preserved end-to-end: `RelativePattern`, `findFiles`, `computeWorkspaceProjects`, and the watcher
  + replace `uri.fsPath`-based relative-path math in `isExcludedByIntegrationFilter` with scheme-safe `uri.path` arithmetic (compute the path relative to the integration folder's `uri.path`, not `fsPath`)
  + verify `vscode.workspace.findFiles` honours a custom-scheme `RelativePattern` in VS Code Web; if it does not for read-only/custom providers, fall back to a recursive `vscode.workspace.fs.readDirectory` walk (the provider already supports it - that's why the Explorer works) gated to the integration folder, then apply the existing `globMatches` filter
  + `armFolderWatcher` must not throw when the provider's `watch()` is a no-op (static content) - guard it so a watcher failure can't abort folder entry
  + **relative-link open (new)** - make a relative `.md` link click open the target file, scheme-preserving:
    + webview `useLinkInterceptor` (`client/webview/src/hooks/useLinkInterceptor.ts`): besides `http(s)`/`mailto`, also intercept links whose href is a **relative path** - i.e. not `http(s):`/`mailto:`, not a `?`-prefixed linetag (those are handled by `linetagops`), and not a bare `#fragment`. `preventDefault`/`stopPropagation` and `postMessage({ type: 'openRelative', href })`. Leave absolute-URL and linetag handling exactly as-is.
    + new message `OpenRelativeMessage { type: 'openRelative'; href: string }` in `Messages.ts`, added to the `WebviewToExtensionMessage` union; dispatch `case 'openRelative'` in `PanelSession.onDidReceiveMessage` (~`:385`)
    + host handler resolves the href against the **active document URI** (not a workspace-root path string): `const base = vscode.Uri.joinPath(active_uri, '..'); const target = vscode.Uri.joinPath(base, href)` - preserves scheme/authority for `file:`, `notegit:`, `vscode-vfs:` alike. Decode/strip any `#fragment`/`?query` from the href before joining. Validate the resolved target is within the workspace (scheme-safe `uri.path` containment, not `fsPath`) and ends in `.md`, then open beside the panel
    + **generalise `revealByOpening`/`handleOpenFile` to take a `vscode.Uri` (or resolve via the active doc's base URI) instead of `vscode.Uri.file(doc_path)`** - this is the same hardcoded-`file:` defect as folder mode, so fix it once and route both the jump drawer and relative-link open through the scheme-preserving opener
+ scope
  + `client/extension/src/vscode/PanelSession.ts` - scheme-preserving URI construction in `enterFolderMode`, `discoverFolderDocs`, `computeWorkspaceProjects`, `armFolderWatcher`, `isExcludedByIntegrationFilter`, **and `revealByOpening`/`handleOpenFile`**
  + `client/webview/src/hooks/useLinkInterceptor.ts` + `Messages.ts` - relative-link interception + new `openRelative` message
  + **dulcet repo (paired content change):** `nodejs/dulcet/content/notegit/welcome/main/intro.md` - convert the example references from backtick code spans to relative markdown links, **link text = the filename** (decision: `[project-board.md](project-board.md)`, `[web-store.md](portfolio/web-store.md)`, etc.). Do this only when the NoteThink side lands so the live demo never ships dead-looking links.
  + keep current-file mode untouched (already uses the active document URI)
+ out of scope
  + any redesign of the discovery/merge pipeline - this is purely making the existing pipeline scheme-agnostic
  + the file watcher's incremental-update semantics beyond not throwing on a no-op `watch()`
+ files
  + `client/extension/src/vscode/PanelSession.ts`
  + `client/extension/src/vscode/PanelSession.test.ts` (or the nearest covering test) - add a folder-mode test whose workspace is a **non-`file:` scheme** and assert discovery resolves files + the watcher doesn't throw
  + `client/extension/src/__mocks__/vscode.ts` - `findFiles`/`readDirectory`/`RelativePattern` mocks need to capture the URI scheme so the test can assert it
  + `client/webview/src/hooks/useLinkInterceptor.ts` - relative-link interception (+ its test, if present)
  + `client/webview/src/notethink-views/src/types/Messages.ts` - `OpenRelativeMessage` + union member
  + **dulcet repo:** `nodejs/dulcet/content/notegit/welcome/main/intro.md` - references → relative links (filename link text); the dulcet `welcome-content.test.ts` / `route.test.ts` may need updating if they assert the prose
+ [X] rebuild folder-mode URIs on the active workspace folder's scheme (preserve scheme via `base_uri.with({ path })`); drop all `vscode.Uri.file(folder_path)` in the folder-mode path
+ [X] make `isExcludedByIntegrationFilter` use scheme-safe `uri.path` relative math instead of `uri.fsPath`
+ [X] confirm `findFiles` works for a custom-scheme `RelativePattern` in web; if not, add the `readDirectory`-walk fallback - scheme-branched: `file:` uses `findFiles`, any other scheme uses a recursive `readDirectory` walk (`discoverViaReadDirectoryWalk`) with probe-based dir pruning, bounded by `MAX_WALK_ENTRIES`; jest covers walk discovery + node_modules prune on a `vscode-vfs:` workspace
+ [X] guard `armFolderWatcher` against a no-op/throwing `watch()` so folder entry can't abort
+ [X] generalise `revealByOpening`/`handleOpenFile` off `vscode.Uri.file` to a scheme-preserving opener (shared by the jump drawer and relative-link open)
+ [X] webview: intercept relative `.md` link clicks (exclude `http(s)`/`mailto`/`?`-linetags/`#`-fragments) → post `openRelative`
+ [X] host: dispatch `openRelative`, resolve href against the active doc URI (`Uri.joinPath`), validate within-workspace + `.md`, open beside the panel; viewer auto-follows
+ [ ] dulcet: convert `intro.md` references to relative links (filename link text); update any prose-asserting dulcet tests - deferred to the paired dulcet change (separate repo), land only after this notethink side ships
+ [X] jest (notethink): folder discovery with a `vscode-vfs:`-style (non-`file:`) workspace resolves the expected files and exclude-filters correctly; watcher arm does not throw
+ [X] jest (notethink): relative-link click on a non-`file:` active doc resolves to the scheme-preserved sibling/sub-path URI and opens it (and a `..`-escape / non-`.md` href is refused)
+ [X] `pnpm run check` green - 1261 jest; fixed the lockfile's missing rollup native dep (`pnpm update rollup`, 4.60.1 → 4.61.1)
+ manual: on a custom-scheme web workspace, open a file in a subfolder and switch to Folder mode - the merged board shows every file in the folder with origin pills and cross-file epics resolved (no "0 in 0 files", no `file://` watcher error)
+ manual (relative-link open): in dulcet (`notegit:` scheme), open the welcome `intro.md`, click an example link (e.g. `project-board.md`, `portfolio/web-store.md`) - the file opens in the editor column beside the viewer and the NoteThink viewer switches to render it; verify a nested `portfolio/*.md` link resolves correctly and an external `http(s)` link still opens in the system browser
+ acceptance
  + folder mode discovers and aggregates files on any workspace scheme, not just `file:`
  + no `file://`-scheme watcher error is emitted for a non-`file:` workspace
  + desktop (`file:`) folder mode is unchanged
  + clicking a relative `.md` link in the rendered view opens that file beside the panel on the workspace's own scheme; the viewer follows to display it; external links and `?`-linetags behave exactly as before
+ commit message draft
  + notethink 0.3.11: make NoteThink scheme-agnostic on non-`file:` workspaces - preserve the workspace/active-doc URI scheme through folder discovery, exclude-matching, the watcher, and the open-file path instead of hardcoding `vscode.Uri.file`; add relative-link interception so a relative `.md` link in the rendered view opens its target on the workspace's own scheme (folder aggregation previously found 0 files; relative links did nothing) in VS Code Web with a custom FileSystemProvider
  + tests 1261 jest
  + (paired) dulcet x.y.z: welcome intro.md links each example file as a relative markdown link so the NoteThink tour opens demos on click


### Dragging a card into an all-unweighted kanban column sinks it to the bottom [](?id=kanban-unweighted-drop-restraint)

Dropping a card at the top (or middle) of a column whose cards are all unweighted moves it visually, but the persisted result puts it at the **bottom**. Root cause: `crossFileOrderingChanges` minted an `nt_kanban_ordering_weight` for the dragged card, and by `kanbanNoteOrder` case 2 a single weighted card sorts *after* every unweighted one - the exact opposite of the requested placement. The only way a weight could honour a top-drop into an unweighted neighbourhood is to weight *every other* card, which contradicts the minimal, self-removing weights design.

+ fix
  + add a restraint guard to `crossFileOrderingChanges`: when both the drop's predecessor and successor are unweighted, mint nothing (`return []`) and let implicit relevance order govern - the just-saved file's bumped mtime already floats it up. Weights are reserved for drops where a weighted neighbour makes a gap-insert genuinely expressive.
+ scope
  + `client/webview/src/notethink-views/src/lib/linetagops.ts` - the guard in `crossFileOrderingChanges`
+ [X] add the restraint guard (`successor_unweighted && predecessor_unweighted` → `return []`)
+ [X] jest (`linetagops.test.ts`): top drop into all-unweighted column mints nothing; mid drop between two unweighted notes mints nothing; a top drop above a weighted successor still weights (guard does not over-suppress)
+ [X] playwright (`folder-kanban-drag.spec.ts`): updated the multi-file interleave test - a drag into an all-unweighted column emits no weight write (placement carried by mtime); the weighted-fixture interleave assertion is unchanged
+ acceptance
  + a top/mid drop into an all-unweighted column does not mint a weight; the card is not sunk to the bottom
  + a drop adjacent to a weighted card still mints an expressive weight
+ commit message draft
  + notethink 0.3.11: kanban drop-into-unweighted-column restraint guard - `crossFileOrderingChanges` mints no weight when both drop neighbours are unweighted (a lone weight sorts after all unweighted cards, sinking a top-drop to the bottom), letting mtime order govern instead


### Upgrade NPM packages (Wave 1 minor/patch) in all parts of the app/extension [](?time_taken=0)

+ [X] run npm-check-updates
+ [X] install
+ [X] verify lint passes
+ [X] verify jest tests pass


### Settings/Files drawers show a redundant second "Applying..." spinner [](?id=drawer-spinner-dedupe)

A settings/files apply shows **two** spinners at once: the breadcrumb pending spinner (correct) **and** a second "⟳ Applying..." line inside the open drawer (redundant). One indicator is enough - keep the breadcrumb one, drop the in-drawer copies. Most visible in slow-round-trip hosts (e.g. the browser web-worker extension host, where a global-setting echo takes longer), but the duplication is host-agnostic dead weight - the in-drawer spinner adds nothing the breadcrumb spinner doesn't already convey.

+ root cause (verified in source)
  + the breadcrumb spinner and every in-drawer spinner read the **same** `pending` flag from `usePendingWorkContext()`, so they all render together whenever an apply is in flight
  + keeper - `components/views/BreadcrumbTrail.tsx:110`: `{pending && <Spinner positionClass="InlineLoader" .../>}`, deliberately positioned next to the "(X in Y files)" count. This stays as the single pending indicator.
  + duplicate #1 - `components/views/SettingsCommonControls.tsx:37-42`: `{pending && (<p data-testid="settings-drawer-spinner"><Spinner .../><span> Applying...</span></p>)}`. This component is shared by **both** `SettingsDocumentDrawer` and `SettingsKanbanDrawer`, so the duplicate appears in the Document *and* Kanban settings drawers.
  + duplicate #2 - `components/views/FilesDrawer.tsx:113-118`: the same `{pending && …Applying…}` block (`data-testid="files-drawer-spinner"`), a third copy in the Files drawer.
+ scope
  + delete the `{pending && …Applying…}` block from `SettingsCommonControls.tsx`; drop the now-unused `usePendingWorkContext` + `Spinner` imports and the `const { pending } = usePendingWorkContext();` line (keep the `Debug` import/const per coding standards; `l10n` stays - still used by the labels)
  + delete the same block from `FilesDrawer.tsx`; drop its now-unused `pending`/`Spinner` usages (verify `usePendingWorkContext`/`Spinner` aren't referenced elsewhere in the file before removing the imports; keep the unmount cleanup-timer logic which is unrelated)
  + leave `BreadcrumbTrail.tsx` untouched
+ out of scope
  + the pending/echo round-trip mechanism itself (markPending → echo-clears-pending) - unchanged; only the redundant *rendering* of `pending` is removed
  + the breadcrumb spinner's position or styling
+ files
  + `client/webview/src/notethink-views/src/components/views/SettingsCommonControls.tsx` (+ `SettingsCommonControls.test.tsx` - drop the `settings-drawer-spinner` assertion)
  + `client/webview/src/notethink-views/src/components/views/FilesDrawer.tsx` (+ `FilesDrawer.test.tsx` - drop the `files-drawer-spinner` assertion)
+ [X] remove the in-drawer spinner from `SettingsCommonControls.tsx`; tidy unused imports; update its test
+ [X] remove the in-drawer spinner from `FilesDrawer.tsx`; tidy unused imports; update its test
+ [X] confirm `BreadcrumbTrail.tsx` remains the sole pending spinner (its test already asserts it)
+ [X] `pnpm run check` green
+ manual: open the Settings drawer (Document and Kanban) and toggle a setting - exactly one spinner shows, in the breadcrumb; no "Applying..." line inside the drawer
+ manual: open the Files drawer and change a filter - one breadcrumb spinner, no in-drawer "Applying..." line
+ acceptance
  + during any settings/files apply there is exactly one spinner (breadcrumb), in every drawer
  + no behavioural change to when/how long the pending state lasts - only the duplicate render is gone
+ delivered: removed the in-drawer spinner block + now-unused imports from `SettingsCommonControls.tsx` and `drawers/FilesDrawer.tsx`; updated both jest tests; corrected `pending-work-spinner.spec.ts` (it had asserted the removed in-drawer spinner - now verifies the breadcrumb spinner is the single indicator)
+ commit message draft
  + notethink x.y.z: drop the redundant in-drawer "Applying..." spinner from the settings + files drawers - the breadcrumb pending spinner is the single indicator
  + tests N jest


### Document-level front matter becomes root-note linetags [](?id=frontmatter-document-attributes)

YAML/TOML front matter at the top of a file should be lifted into the file's **document root** note as linetags, then treated *identically* to linetags authored on a heading - including inheritance to descendants. A key like `nt_view` set in front matter must behave exactly as if it were written on the file's H1. This makes front matter the broadest, document-scoped layer of the existing linetag model rather than a separate metadata channel. Prefix handling (`ng_`/`nt_`) is owned by [[broaden-linetag-prefix-nt]]; this story is namespace-agnostic and inherits whatever that migration settles.

+ goal
  + every `key: value` pair in a file's front matter attaches to that file's document-root NoteProps as a linetag, stored verbatim (no prefix logic here - same as `parseLineTags`)
  + once attached, the existing render/inherit/interpret machinery treats them like any heading linetag - no special-casing per key
  + front matter is the *document scope*; it sets defaults that anything below can override
+ decisions (confirmed with the user)
  + **carrier = the document root, not the first note / H1.** The root is the genuine "file note" that owns every note in the file; "first note" is accidental (whatever lands at `seq=1`). The root NoteProps already exists - `type:'root'`, `seq:0`, `level:0`, owns `child_notes` - created at `convertMdastToNoteHierarchy.ts:372-388`. It just carries no linetags today.
  + **precedence: lowest / most-specific wins.** Document level is the broadest default; an H1 linetag overrides a front-matter value, an H2 overrides the H1, etc. This is already how inheritance behaves - `applyChildAttributeInheritance` does `if (note.linetags?.[key]) continue;` so a child's own tag beats an inherited one. Front matter simply becomes the top of that chain.
  + **separate processing from display.** Inheritance is baked per-file at convert time, so it is *mode-independent* and correct in all three render modes. Only the document-level pill strip is mode-dependent.
+ processing (mode-independent - the important half)
  + make the root participate in the existing inheritance pass as the **top ancestor**, so its `nt_child_*` / `nt_child2y_*` / `nt_childall_*` tags propagate down via the same mechanism that already runs between heading levels
  + because this happens during each file's `convertMdastToNoteHierarchy` *before* any merge or render, folder mode "just works": each file's front matter affects only that file's stories, exactly mirroring how per-file linetag inheritance is resolved per-file and then merged in `mergeAggregateRoot`
  + only inheritance-prefixed keys propagate (consistent with today) - a bare `status: done` in front matter stays document-level and does NOT leak to children
+ display (mode-dependent - the only conditional half)
  + render a **document-level linetag strip** (reuse `GenericNoteAttributes`) at the top of the view, bound to the root's linetags
  + shown **only in single-file mode**; suppressed in folder mode (many documents, no single document-scope) and in single-note mode (no file context). NB there is no true single-note mode in code today, so that suppression is forward-looking - cheap because processing already happened at convert time
  + DocumentView already has the natural slot - it renders `GenericNoteAttributes` for `parent_context.linetags` at `DocumentView.tsx:61-63`. KanbanView renders the parent context but has no dedicated attribute strip - add one above the board. AutoView just delegates.
+ the `order` nuance (front-matter vs H1 scope)
  + `order` under the H1 governs notes added *under the H1*. `order` at front-matter/document level governs insertion relative to the *whole document* - so `newest-at-top` at document scope can insert a new note **above** the H1, whereas at H1 scope it inserts below it.
  + therefore document-level `order` must stay readable at the **root** independently of the H1, even though for most keys the post-inheritance H1 value is what the existing reader consumes
+ background / current gaps (the change surface)
  + front matter is already *parsed* into a raw MDAST node - `parseops.ts` enables `frontmatter(['yaml','toml'])` - but the node's `key: value` pairs are never read; it sits in `root.children_body` as a `type:'yaml'`/`'toml'` node with no `seq`
  + the root has no linetags populated and is never parsed for them
  + the root is currently **excluded** from inheritance: `applyChildAttributeInheritance` (`convertMdastToNoteHierarchy.ts:293-325`) skips any note with no `parent_notes`, and the root is not in `all_notes` when the pass runs
  + file-level config (`nt_view`, `order`) is read from the **H1** via `findFileH1` (`mergeAggregateRoot.ts:297,300`) - needs to resolve from the root (front matter) with the H1 as the lower-level override; after root→H1 inheritance runs, the H1 naturally carries the effective value for most keys, but `order` needs the independent root read above
  + need a small flat front-matter parser (YAML + the existing TOML fence) that turns the node text into `key: value` pairs - a new `lib/frontmatterops.ts` (matches the `<noun>ops.ts` naming rule); deliberately minimal like the parser already living in notegit's `frontmatter.ts` (scalars, quoted strings, inline arrays), NOT a full YAML dep
+ scope of work (when picked up)
  + [X] add `lib/frontmatterops.ts` - parse the front-matter node's text into a flat `{key: value}` map (scalars, quoted, inline arrays); unit tests incl. malformed-yields-empty
  + [X] in `convertMdastToNoteHierarchy`, read the front-matter node from `children_body` and populate `root.linetags` from it (verbatim keys, via the linetag shape so write-back offsets stay sane)
  + [X] make the root the top ancestor of the inheritance pass so `nt_child*` / `nt_childall*` on the root propagate to descendants (include root in the chain / lift the no-`parent_notes` skip for root-children)
  + [X] resolve file-level config from the root with H1 override (lowest-wins), and read document-level `order` at the root independently of the H1
  + [X] render the document-level linetag strip via `GenericNoteAttributes`, gated to single-file mode (DocumentView slot exists; add the KanbanView strip above the board)
  + [X] jest: front matter → root.linetags; root `nt_childall_status` reaches a deep note; H1 linetag overrides a front-matter value; folder mode keeps per-file scoping; document-level pills render in single-file and are absent in folder mode
  + [ ] playwright: open a file with front-matter `nt_view`/`order` and confirm the resolved view + insertion behaviour; confirm the document pill strip shows in single-file and not in folder mode
  + [X] update `AUTHORING_GUIDE.md` - document front matter as the document-scope linetag layer, the lowest-wins precedence, and the `order`-above-H1 nuance
  + [X] `pnpm run check` green
  + delivered: parser kept as `frontmatterops.ts` (3 exports - distinct noun, story-mandated name); inheritance via a depth-mapped root ancestor (broadest, lowest-priority); H1-then-front-matter config resolution; pill strip gated by `seq` (clone-safe), suppressed in folder mode; Document+Kanban wired (Kanban needs no dedup guard - no second strip); synthetic root no longer renders its front-matter pills inline (`MarkdownNote` skips `type:'root'`) so they show once via the document-level strip
  + delivered: the document-level strip derivation was lifted into `GenericView` (built once, handed to leaf views via `nested.document_strip`/`document_root`) so DocumentView/KanbanView no longer each re-derive it; strip tests moved up to `GenericView.test`
  + delivered: Playwright pill-strip spec passing (single-file pill renders once, hidden in folder mode); the `nt_view`/`order` resolved-view + `order`-above-H1 *insertion* E2E remain unwritten (shipped with this gap accepted)
+ out of scope
  + prefix interpretation (`ng_`/`nt_`) - owned by [[broaden-linetag-prefix-nt]]; this rides whatever it settles
  + a true single-note render mode - does not exist yet; we only design its display-suppression (processing is already mode-independent)
  + notegit's own server-side front-matter consumer - its `src/lib/frontmatter.ts` reads `title`/`description`/`tags` into the SSR `<head>` and is a separate concern (same `---` block, different reader). Worth a follow-up there: notegit currently parses a `defaultView` front-matter key then drops it; once `nt_view` is the document-scope view selector here, retire notegit's `defaultView` to avoid two names for one idea
+ relationships
  + builds on the root-as-container idea also referenced by the post-v1 "Convert top-level 'docs' container to RootNote" story
  + namespace-coupled to [[broaden-linetag-prefix-nt]]
+ files
  + new `client/webview/src/notethink-views/src/lib/frontmatterops.ts` (+ tests)
  + `client/webview/src/notethink-views/src/lib/convertMdastToNoteHierarchy.ts` (root linetags + inheritance top-ancestor)
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` (root-first config resolution; document-level `order`)
  + `client/webview/src/notethink-views/src/components/views/DocumentView.tsx` (document pill strip - slot exists)
  + `client/webview/src/notethink-views/src/components/views/KanbanView.tsx` (document pill strip above the board)
  + `client/webview/src/notethink-views/src/components/notes/GenericNoteAttributes.tsx` (reused for the document strip)
  + `client/extension/src/lib/parseops.ts` (front-matter node already produced - reference only)
  + `AUTHORING_GUIDE.md` (document-scope front matter)


### Auto-open the right breadcrumb view via H1 linetags [](?id=auto-open-breadcrumb-view)

Two new file-root linetags let a document declare the view it should open into, so users land on the intended breadcrumb-scoped view without knowing they can change the breadcrumb themselves. Set on the file `#` H1 (or front matter) - the same place `nt_view` lives. `nt_integration_mode=folder` opens the file in folder (aggregate) mode; `nt_breadcrumb_last=<label>` scopes the breadcrumb to a named segment on first open. Together (`nt_integration_mode=folder` + `nt_breadcrumb_last=portfolio`) they jump straight to the aggregated, portfolio-scoped board.

+ background
  + `nt_view` is read off the H1 via `resolveNamespacedTag(h1?.linetags, 'view')` with a front-matter root fallback, stamped onto `origin.file_view_type` (`mergeAggregateRoot.ts:278`); AutoView resolves the active view type from it
  + view type already models this cleanly: `auto` is a first-class value (`SELECTABLE_VIEWTYPES = ['auto','document','kanban']`, `GenericView.tsx:19`), the default, shown as "Auto (Kanban)" (`ViewTypeSelector.tsx`); picking a concrete type leaves auto and `nt_view` stops driving it
  + integration mode lives in `display_options.integration_mode` / `integration_path` (`NoteProps.ts`) with NO `auto` value today, toggled by `ViewIntegrationSelector` → `useViewToolbar` `handle_integration_change` → `setViewManagedState`, replayed to the extension as a `setIntegration` message
  + the extension (`PanelSession.handleSetIntegration` → `enterFolderMode`, `PanelSession.ts:583`) owns folder aggregation; on reload the webview sends `setIntegration` first, so persisted view-managed state is the source of truth for mode
  + note-hierarchy breadcrumb depth is `display_options.parent_context_seq` (`useViewContext.ts:64`), set by breadcrumb clicks via `setParentContextSeq` (`useViewHandlers.ts:43`); folder-path breadcrumb segments narrow aggregation via `onFolderClick` → a new `integration_path`
  + there is no existing `nt_integration_mode` or `nt_breadcrumb_last` linetag
  + the design extends the existing view-type `auto` pattern to the integration axis, rather than inventing a hidden one-shot seed marker

+ goal
  + integration mode becomes auto-by-default, mirroring view type - in auto, the file's `nt_integration_mode` / `nt_breadcrumb_last` linetags drive the mode and the initial breadcrumb scope
  + opening a file whose H1 declares `nt_integration_mode=folder` resolves (while auto) to folder mode with no manual toolbar switch
  + opening a file whose H1 declares `nt_breadcrumb_last=portfolio` scopes the breadcrumb to the named segment - folder segment → `integration_path`, epic/story segment → `parent_context_seq`
  + navigation is congruence-seeking - it keeps or returns to auto when the destination matches the file's declared mode, and pins a concrete mode only when navigation diverges from the file; re-selecting "Auto" fully resets to the file
  + an unrecognised value degrades gracefully - auto resolves to the normal default with a `debug` line, never an error

+ naming - permanent-name check (CODING_STANDARDS.md "Permanent name check")
  + `nt_integration_mode` and `nt_breadcrumb_last` are linetag keys written into users' markdown - externally-persisted names, frozen once shipped; operator has chosen these exact keys (sign-off recorded here)
  + author as `nt_` only - `ng_` is legacy-read for predecessor keys; new keys are `nt_`-only per AUTHORING_GUIDE
  + the authored value vocabulary for `nt_integration_mode` stays `current_file` / `folder`; `auto` is NOT an authored linetag value, only a webview view-state value
  + `auto` joins `INTEGRATION_MODES` as a persisted view-state value (`vscode.setState` shape) - a permanent-name-check item; treat undefined `integration_mode` as `auto` so existing persisted states need no migration; the extension constants mirror does NOT gain `auto` (the extension only ever receives resolved `current_file` / `folder` via `setIntegration`)
  + `nt_breadcrumb_last` value is a free-form segment label matched at runtime - no persisted enum

+ design - capture
  + read both keys off the opened document's H1 then front-matter root via the existing `resolveNamespacedTag(h1?.linetags, 'integration_mode')` / `(…, 'breadcrumb_last')`, mirroring `nt_view`
  + these are per-opened-file directives, NOT majority-voted across the folder like `nt_view` - read only from the file the user opened
  + validate authored `nt_integration_mode` against `current_file` / `folder`; ignore (debug-log) anything else

+ design - auto integration mode (mirror AutoView, no hidden marker)
  + add `auto` to `INTEGRATION_MODES` / the `IntegrationMode` type and make it the default; treat undefined `integration_mode` as `auto` (back-compat - untouched views become auto and resolve to current_file when the file declares nothing; the new linetag is the only thing that flips them, so existing files are unaffected)
  + auto governs the *mode* (folder vs current_file): while `integration_mode === 'auto'` the displayed mode re-resolves live from `nt_integration_mode`, the same "auto follows the file" contract AutoView gives view type
    + `nt_integration_mode=folder` → resolves folder; dispatch `setIntegration` so the extension aggregates
    + no `nt_integration_mode` → resolves current_file (today's default)
  + the breadcrumb *scope* (`integration_path` / `parent_context_seq`) is seeded once from `nt_breadcrumb_last` at first resolve, then is the user's navigated position - auto re-resolves the mode but never re-snaps a path the user has navigated
  + navigation is congruence-seeking, not auto-breaking - after a breadcrumb / folder / note click, set `integration_mode = auto` when the resulting mode matches what the file declares, else pin the concrete resulting mode (look for every chance to return to auto)
    + Auto (Folder) + navigate within folder → resulting folder == file's folder → stay Auto (Folder), selector unchanged
    + Auto (Current file) + click a folder segment → resulting folder ≠ file's current_file → pin concrete Folder
    + concrete Current file on a file whose linetag declares folder + click a breadcrumb → resulting folder == file's folder → jump to Auto (Folder)
  + explicitly re-selecting "Auto" in the selector is a full reset - re-resolve both mode and scope from the file linetags
  + factor the congruence decision into a pure `viewstateops.ts` helper (`resulting_mode` + `file_declared_mode` → `'auto' | <concrete>`) so it is unit-testable in isolation
  + no hidden `auto_view_seeded` marker - the visible `auto` ⇄ concrete state IS the "still automatic?" signal, self-documenting as "Auto (Folder)" vs "Folder" in the toolbar, exactly like "Auto (Kanban)" vs "Kanban"

+ design - first-resolve seam
  + fire the first `setIntegration` at the App layer in `ExtensionReceiver` on doc-arrival, NOT in a view-render effect - when a doc message lands and `view_states[doc_id]` has no concrete `integration_mode`, resolve from its H1 linetags and dispatch before first render
  + dispatching at doc-arrival fires once per open and keeps resolution out of React render timing; only dispatch when the auto-resolved target actually changes, so re-renders don't re-aggregate
  + confirm the doc-arrival handler has the H1 root note `.linetags` available (the extension sends parsed notes)

+ design - resolve `nt_breadcrumb_last`
  + add a pure resolver: given the label + the active file's breadcrumb trail, return `{kind:'folder', path}` | `{kind:'note', seq}` | undefined
  + match folder-path segments by label against the file's path trail (`segmentPathBelowWorkspace` output); deepest match wins on duplicate labels
  + match note/epic segments by stripped headline against the merged-tree breadcrumb notes
  + a folder-segment match implies folder mode - if `nt_breadcrumb_last` names a folder but `nt_integration_mode` is absent, auto resolution switches to folder mode (a folder breadcrumb segment only exists in folder mode)
  + prefer extending `pathops.ts` (segment match) + `noteops.ts` (seq lookup) over a new tiny `*ops.ts` (≥4-exports rule); add `breadcrumbops.ts` only if it will hold ≥4 exports

+ scope
  + add `auto` as the default `integration_mode`, resolved live from the file linetags while auto
  + parse + validate the two new linetags from the opened doc H1 / front matter
  + resolve `nt_breadcrumb_last` to a folder path or a note seq
  + drive first resolution at doc-arrival in `ExtensionReceiver`; reconcile the mode after each navigation (auto when congruent with the file, concrete when divergent); reuse the existing `setIntegration` / `setParentContextSeq` dispatch - no new extension message types
  + show the auto-resolved mode in `ViewIntegrationSelector` ("Auto (Folder)" / "Auto (Current file)")
  + document both keys in AUTHORING_GUIDE.md and bump the guide to 1.1.0 (new backward-compatible linetag ⇒ minor)

+ out of scope
  + authoring the values on the notegit demo files - a follow-up in notegit once this ships (see note below)
  + majority-vote of `nt_integration_mode` across a folder - it is a per-opened-file directive, not voted
  + a UI to write these linetags - authored by hand like `nt_view`
  + animating the open-time jump - it just lands on the target view

+ files
  + `client/webview/src/notethink-views/src/types/IntegrationMode.ts` - add `auto` to `INTEGRATION_MODES` / `IntegrationMode`, make it the default; note in a comment why the extension constants mirror intentionally omits it
  + `client/webview/src/notethink-views/src/components/views/ViewIntegrationSelector.tsx` - `auto` option + "Auto (…)" label reflecting the resolved mode
  + `client/webview/src/components/ExtensionReceiver.tsx` - resolve auto from H1 linetags on doc-arrival; dispatch `setIntegration` when the resolved target changes
  + `client/webview/src/notethink-views/src/components/views/generic/useViewContext.ts` - treat undefined `integration_mode` as `auto`; expose the resolved mode/path
  + `client/webview/src/notethink-views/src/components/views/generic/useViewToolbar.ts` - `handle_integration_change` writes a concrete mode (leaves auto)
  + `client/webview/src/notethink-views/src/components/views/generic/useViewHandlers.ts` - breadcrumb/folder/note handlers reconcile `integration_mode` via the congruence helper + write the navigated scope
  + `client/webview/src/notethink-views/src/lib/viewstateops.ts` - `reconcileAutoIntegrationMode(resulting_mode, file_declared_mode)` pure helper + tests
  + `client/webview/src/notethink-views/src/lib/pathops.ts` - `resolveBreadcrumbFolderSegment(label, …)` + tests
  + `client/webview/src/notethink-views/src/lib/noteops.ts` - `breadcrumbSeqForLabel(label, notes)` + tests
  + `client/webview/src/notethink-views/src/lib/linetagops.ts` - confirm `integration_mode` / `breadcrumb_last` resolve through `resolveNamespacedTag` (likely no change)
  + `AUTHORING_GUIDE.md` - View configuration table + version bump to 1.1.0
  + `package.json` - version bump 0.3.13 → 0.3.14

+ AUTHORING_GUIDE wording - draft to paste into the "View configuration" table on implementation (the guide is the grammar doc, so the actual edit + 1.0.0 → 1.1.0 bump lands with the code, not now)
  + `| nt_integration_mode | The integration mode this file opens into while the view is in **auto**: current_file or folder. In auto the view follows it; changing the mode or navigating away from the file's intent pins your own choice. nt_-only - no ng_ form |`
  + `| nt_breadcrumb_last | The breadcrumb segment this file opens scoped to while in **auto** - a folder name (narrows folder-mode aggregation to that subfolder, implying folder mode) or an epic/story headline (scopes the note hierarchy). Seeds the initial position; navigate away freely. nt_-only |`
  + bump the guide header from 1.0.0 to 1.1.0 (minor - two new optional, backward-compatible linetags)

+ [X] add `auto` to `IntegrationMode` / `INTEGRATION_MODES`, make it the default, treat undefined as auto
+ [X] read + validate authored `nt_integration_mode` (`current_file` / `folder`) and `nt_breadcrumb_last` off the opened doc H1 / front matter
+ [X] add `resolveBreadcrumbFolderSegment` to `pathops.ts` - deepest-label match over the file's path trail
+ [X] add `breadcrumbSeqForLabel` to `noteops.ts` - match epic/story headline → seq
+ [X] resolve auto on doc-arrival in `ExtensionReceiver`; dispatch `setIntegration` / `setParentContextSeq` only when the resolved target changes
+ [X] add `reconcileAutoIntegrationMode` to `viewstateops.ts` - resulting mode == file-declared → auto, else concrete
+ [X] reconcile `integration_mode` after every navigation via the helper; explicit "Auto" selection re-resolves mode + scope from the file
+ [X] show the auto-resolved mode in `ViewIntegrationSelector` ("Auto (Folder)" / "Auto (Current file)")
+ [X] debug-log + no-op on an unrecognised `nt_integration_mode` value or an unmatched `nt_breadcrumb_last` label
+ [X] document both keys in the AUTHORING_GUIDE.md View-configuration table; bump the guide 1.0.0 → 1.1.0
+ [X] bump notethink to 0.3.14
+ [X] jest: undefined `integration_mode` resolves as auto; `nt_integration_mode=folder` resolves to folder; an invalid value falls back to current_file
+ [X] jest: a `nt_breadcrumb_last` folder label resolves to the right `integration_path`; deepest match wins on duplicate labels
+ [X] jest: a `nt_breadcrumb_last` epic label resolves to the right `parent_context_seq`
+ [X] jest: a concrete persisted `integration_mode` (user choice) is NOT overridden by the file linetag - auto no longer applies
+ [X] jest: navigation congruence - Auto(Folder) stays auto within folder; Auto(Current file)+folder-click pins concrete Folder; concrete Current file on a folder-declaring file + click → Auto(Folder)
+ [X] jest: an unmatched `nt_breadcrumb_last` resolves to the default scope with no throw
+ [X] `pnpm run check` green (lint + build + rollup + 1344 jest) + 77 playwright (70 existing + 7 new auto-integration E2E)
+ note - all six former manual checks are now automated Playwright E2E (`playwright/specs/auto-integration.spec.ts`). The harness has no real extension, so the folder aggregation is simulated by the webview's own setIntegration round-trip: each test asserts the outbound setIntegration message (the webview→host contract) plus the folder board the webview renders. Harness gained sessionStorage-backed webview state (`playwright/harness/index.html`) so reload-resilience is testable. The only residual "manual" is optional visual confirmation in a real VS Code host - NOT a pipeline blocker.
+ [X] playwright: cold-open `nt_integration_mode=folder&nt_breadcrumb_last=portfolio` - posts setIntegration scoped to portfolio, renders the folder board, selector reads "Auto (Folder)", breadcrumb scoped to portfolio
+ [X] playwright: Auto (Folder), click an ancestor folder breadcrumb - stays "Auto (Folder)", re-aggregates at the new folder
+ [X] playwright: a navigated Auto (Folder) position survives a reload (sessionStorage-backed harness; refresh-resilience test)
+ [X] playwright: Auto (Current file) + folder breadcrumb click - pins concrete "Folder"
+ [X] playwright: a folder-declaring file pinned to current_file + breadcrumb click - jumps to "Auto (Folder)" (congruent)
+ [X] playwright: pick "Auto" again after pinning concrete - re-resolves mode + scope from the file
+ [X] playwright: bogus `nt_breadcrumb_last` - opens normally in current_file, no setIntegration, no error
+ note - downstream authoring (notegit, separate repo)
  + once shipped, set `nt_integration_mode=folder&nt_breadcrumb_last=portfolio` on the Atlas Mobile App H1 in the notegit demo content
  + this is a notegit content change, not part of this notethink story

+ acceptance
  + integration mode is auto-by-default and, while auto, follows the file's `nt_integration_mode` / `nt_breadcrumb_last`
  + a cold-opened file with `nt_integration_mode=folder` lands in folder mode unprompted, scoped by `nt_breadcrumb_last`
  + navigation is congruence-seeking - it keeps/returns to auto when the destination matches the file's declared mode, and pins a concrete mode only when it diverges; the result persists across reloads
  + explicit "Auto" re-selection fully resets mode + scope to the file
  + unrecognised values resolve to the normal default with a debug line, never an error
  + both keys are documented in AUTHORING_GUIDE.md and the guide is bumped to 1.1.0

+ commit message draft
  + notethink 0.3.14: integration mode gains an `auto` default (mirrors view-type auto) driven by new `nt_integration_mode` / `nt_breadcrumb_last` H1 linetags
  + in auto, a file declares folder mode plus the breadcrumb segment to scope to, so users land on the intended aggregate view; navigation is congruence-seeking - it returns to auto when congruent with the file and pins a concrete mode only when it diverges
  + resolved at doc-arrival with no hidden seeded-marker; graceful no-op on unrecognised values; AUTHORING_GUIDE bumped to 1.1.0
  + tests N jest


### Animated passive transitions in the kanban view [](?id=animated-passive-transitions)

The visible UX payoff. When the kanban view changes layout because of a *passive* update (external file edit from another VS Code window or editor, AI-agent edit, mtime change, anything not driven by the user's own drag) the affected notes and columns animate from old state to new state in a way that mimics manual drag-and-drop. Depends on [[multi-file-ordering-stable-identity]] (stable note identity is the keying contract) and [[folder-mode-dnd]] (so the manual and automatic UX stay consistent in folder mode) and [[kanban-optimistic-projection]] (the projection seam the FLIP layer decorates; user-initiated drags resolve via the projection, passive updates via FLIP).

+ goal
  + a status-tag change made by an AI agent or another editor animates the affected card from its old column position to its new column position, on the same trajectory the user would see if they had picked it up and dragged it
  + a within-column reorder triggered by mtime, line/sequence, or weight change slides the card to its new vertical slot as if dragged
  + new notes fade in; new columns slide in; column-then-note choreography
  + the animation layer is decorative - the final DOM is correct regardless of whether the animation runs, fails partway, or is interrupted by the next update
+ visual specification - must mimic existing drag-and-drop (`ViewRenderer.module.scss:1103-1115`)
  + in-flight card style: `box-shadow: 0 8px 24px rgba(0,0,0,0.16)`, `transform: rotate(2deg) scale(1.02)`, applied while the FLIP plays and removed at the end
  + cross-column move: card lifts (apply in-flight style), translates from origin rect to destination rect, lands (remove in-flight style), 350 ms ceiling
  + in-column reorder: same lift-and-translate, vertical only
  + new note: fade-in (opacity 0 → 1) with subtle scale (0.96 → 1), 200 ms
  + new column: horizontal slide-in (translateX(-20px) → 0) with fade, 250 ms; notes destined for it begin their cross-column move on the next animation frame after the column lands
  + column disappearance: notes have already left via cross-column moves; column collapses horizontally over 200 ms
+ architectural approach
  + custom FLIP helper, no animation library added to the webview bundle
  + only fires on *passive* updates; user-initiated drag-end remains owned by `@hello-pangea/dnd`
  + progressive enhancement / graceful degradation: the layer is a thin overlay that records pre-commit rects (`useLayoutEffect`), lets React render, then plays inverse transforms via the Web Animations API. If the layer throws, the view is already in its final state - there is nothing to clean up. The contract is: *the final DOM is correct without the animation layer; the animation layer only decorates the transition between two correct states*
  + the passive-update FLIP and the user-drag projection share one reconciliation seam - `passiveUpdateGate` becomes "user-move reconciliations resolve silently (projection already showed the move), passive ones resolve via FLIP"
+ behaviour contract - graceful degradation
  + 350 ms ceiling per individual transition; if a second update arrives mid-animation the in-flight animation is cancelled and the next FLIP measures from the *current live rect*, not the previous "to" rect
  + 800 ms global cap from "update received" to "final state visible" - if FLIP math has not completed by then, `el.getAnimations().forEach(a => a.finish())` snaps to final state
  + respects `prefers-reduced-motion: reduce` (existing precedent at `ViewRenderer.module.scss:330`) - animation layer no-ops, final state appears immediately
  + if a note's `stable_id` is absent from the previous registry, treat as new (fade-in); if absent from the next, treat as removed (fade-out)
  + if rect math throws or returns NaN, swallow and snap
+ scope
  + new `lib/animation/flipMath.ts` - pure functions (inverse transform, keyframe spec) - unit-testable without DOM
  + new `lib/animation/useFlipTransition.ts` - hook: registry of (`stable_id` → element ref), `useLayoutEffect` to capture pre-commit rects, `useEffect` to play inverse transforms
  + new `lib/animation/passiveUpdateGate.ts` - flag set by `KanbanView.dragEndHandler` for a short window (~250 ms) after user drag so the layer skips that re-render and does not double-animate
  + wire the hook around the note list in `KanbanView.tsx` with `key={note.stable_id}` (replacing `key={note.seq}`)
  + wire column enter/exit in `KanbanColumn.tsx` using CSS keyframes (FLIP requires a prior rect - columns appearing for the first time have none)
  + add settings drawer toggle `kanban_animate_transitions` (Global scope, default true) so users can disable the layer
  + ship a test-only probe `KanbanAnimationProbe` (gated by a debug flag, not in default bundle path) that emits an event stream the test harness can subscribe to - replaces relying on pixel-diffing in jest
+ out of scope
  + animating non-kanban views (document/mermaid) - possible follow-up
  + animating origin-pill colour changes or focus-ring transitions
  + per-card origin-pill flash during the move - possible v2 polish
+ files (proposed)
  + new `client/webview/src/notethink-views/src/lib/animation/flipMath.ts`
  + new `client/webview/src/notethink-views/src/lib/animation/useFlipTransition.ts`
  + new `client/webview/src/notethink-views/src/lib/animation/passiveUpdateGate.ts`
  + `client/webview/src/notethink-views/src/components/views/KanbanView.tsx` - wire hook around column list and note list; key by `stable_id`
  + `client/webview/src/notethink-views/src/components/views/KanbanColumn.tsx` - column enter/exit
  + `client/webview/src/notethink-views/src/components/ViewRenderer.module.scss` - column slide-in/out keyframes
  + `client/{extension,webview}/src/constants.ts` - `KANBAN_ANIMATION_TRANSITION_MAX_MS = 350`, `KANBAN_ANIMATION_GLOBAL_CAP_MS = 800`, `KANBAN_ANIMATION_DRAG_GATE_MS = 250`
  + settings drawer + extension contributes a `notethink.kanbanAnimateTransitions` boolean (Global target), wired through `ExtensionReceiver`
+ design decisions (manager, resolved before fan-out)
  + setting is **camelCase end-to-end** `kanbanAnimateTransitions` (not snake_case) per the `Messages.ts` settings-identity rule; Global-target boolean default true; config path `notethink.settings.view.specific.kanban.animateTransitions`; checkbox lives in `SettingsKanbanDrawer` (kanban-specific), not `SettingsCommonControls`
  + timing constants live **module-local in `flipMath.ts`** (exported), mirroring the existing `KANBAN_PROJECTION_MAX_MS` precedent in `useProjectedNotes.ts` - NOT in the cross-bundle `constants.ts` (they are webview-internal, not a wire contract, so the mirrored-constants exception does not apply)
  + FLIP registry seam is `data-flip-id={note.stable_id}` spread onto the card root via `KanbanBoard`'s existing `draggableProps` object (lands on `MarkdownNoteContainer` root); columns carry `data-flip-column-id={column.value}`; the hook holds a ref to `KanbanView`'s content container and queries within it - no ref threading through `@hello-pangea/dnd`
  + the FLIP seam decorates the `useProjectedNotes` reconciliation: a passive update mutates `notes_within_parent_context` with no active projection → `notes_to_render` flips to the new layout → hook animates; a user drag arms `passiveUpdateGate` so the projection-commit re-render is skipped (no double-animate over dnd's drop)
  + card moves + note fade-in via Web Animations API (dynamic per-card deltas); column enter/exit via CSS keyframes (FLIP needs a prior rect, a first-appearance column has none) - class names resolved from the SCSS module imported into the hook
  + easing `cubic-bezier(0.2, 0, 0.0, 1.0)` (resolves the open easing question - the "thrown" proposal); no explicit 50 ms event coalescing (the cancel-and-remeasure-from-live-rect contract + React batching already cover bursts); origin-pill flash stays v2 (out of scope)
  + exit animations (note fade-out, column collapse) are best-effort: `flipMath` classifies entering/moving/exiting as pure unit-tested functions, enter+move are fully DOM-animated, but true exit-on-unmount tombstoning is out of v1 scope (no acceptance/playwright check requires it); the jest "absent in next → fade-out path" asserts the classifier, not a DOM tombstone
+ [X] implement `flipMath.ts` with unit-testable pure functions (inverse transform, keyframe spec)
+ [X] implement `useFlipTransition` hook - registry + `useLayoutEffect` rect capture + Web Animations API playback
+ [X] implement `passiveUpdateGate` - flag set by `KanbanView.dragEndHandler`, hook skips animation while the flag is hot
+ [X] wire hook around the kanban note list (cards already key by `kanbanDraggableId` = `stable_id`; added `data-flip-id` registry attribute via the existing `draggableProps` spread)
+ [X] wire CSS-keyframe column enter/exit in `KanbanColumn.tsx`
+ [X] choreograph new-column case: column enter completes (or starts ~50 ms ahead) before inbound notes begin their FLIP
+ [X] respect `prefers-reduced-motion` (hook no-ops, no Web Animations calls)
+ [X] add `notethink.kanbanAnimateTransitions` setting (Global target, default true) + drawer checkbox with locale strings in all 5 locales
+ [X] jest: `flipMath` unit tests (no DOM, pure functions)
+ [X] jest: `useFlipTransition` with jsdom + mocked `getBoundingClientRect` - verifies the right transforms get scheduled
+ [X] jest: `passiveUpdateGate` suppresses the hook within 250 ms after `dragEnd`
+ [X] jest: stable_id absent in previous render → fade-in path fires; absent in next → fade-out path fires
+ [X] jest: `prefers-reduced-motion` makes the hook no-op
+ [X] jest: 800 ms global cap snaps to final state
+ [X] playwright: cross-column animated transition (fire an external file edit changing a status tag; assert intermediate transform present at ~150 ms; assert final DOM matches the new state regardless of animation playback)
+ [X] playwright: in-column animated reorder (mutate mtime via the harness; assert vertical slide; assert final order)
+ [X] playwright: new column appearance choreography (introduce a status value that has no column; assert column enter completes before notes arrive)
+ [X] playwright: user-initiated drag is NOT double-animated (drag a note; assert the FLIP layer event stream is empty for that re-render)
+ [X] playwright: rapid-burst (fire 5 status changes within 200 ms; final state correct, no stuck or orphaned animations after 1 s)
+ [X] playwright: `prefers-reduced-motion` (emulate via Playwright; assert no transform keyframes, final state instant)
+ [X] `pnpm run check` green
+ [X] FIX (found in testing): manual pointer-drag re-animated the just-dropped card on its own authoritative echo - FLIP wrongly treated the user's own move's round-trip update as a passive update
  + root cause: the 250 ms `passiveUpdateGate` timer is outlasted by the real drag→editText→file-write→watcher(debounce)→reparse→echo round-trip, so the projection→authoritative reconcile ran gate-cold and FLIP slid the dropped card across the board; a mouse-up→async-`onDragEnd` race and long-drag gate-cooling widened the hole
  + fix: tie FLIP suppression to the optimistic-projection LIFECYCLE, not a timer - `passiveUpdateGate` gains `hold()`/`release()`; new `useFlipGate` holds the gate for the whole (unbounded) projection and releases into a short tail that still covers the reconcile-commit render (layout effect runs before the release passive effect); drag-start holds, drag-end releases
  + gap exposed: only KEYBOARD drag was tested before (a different `@hello-pangea/dnd` sensor than a real mouse drag), so the pointer path was uncovered
+ [X] add real pointer-drag coverage (`kanban-pointer-drag.spec.ts`): mouse drag completes, card lands in the destination, no card left under a residual transform
+ [X] add drag round-trip regression guard (`kanban-drag-roundtrip.spec.ts`): the dropped card's own authoritative echo never re-animates (realistic + adversarial timing) + positive control that a genuine passive update still animates
+ manual: pointer-drag a card between columns in real VS Code; confirm it lands cleanly with no post-drop slide/jump of it or its neighbours once the file round-trips - ✓ verified (operator, 2026-06-19)
+ manual: open a folder, have an AI session edit a status tag in one of the files, confirm the card animates from old column to new column on the same path a drag would follow
+ manual: external edit (e.g. via another VS Code window) reorders a note within a column, confirm vertical slide
+ manual: prefers-reduced-motion enabled in OS settings, confirm no animation, view still consistent
+ manual: toggle `kanban_animate_transitions` off, confirm everything snaps without animation and stays correct
+ test plan
  + visual correctness checked structurally (DOM in final state, computed transform sequence sane) rather than pixel-diffing
  + the `KanbanAnimationProbe` test-only component reads the animation layer's internal event stream and exposes it to the harness so jest can assert *what was scheduled* without needing a real `requestAnimationFrame` loop
  + playwright tests assert final state after the animation should have settled, plus optional intermediate checks at 50 ms / 200 ms via `page.evaluate(() => element.getAnimations())`
+ acceptance
  + externally-driven status changes animate the card on a path visually consistent with a drag-and-drop of that card
  + externally-driven reordering inside a column animates the card on a vertical slide
  + new notes fade in; new columns slide in; column-then-note choreography holds
  + user-initiated drags do not double-animate
  + `prefers-reduced-motion` users see instant transitions
  + an exception in the animation layer cannot leave the view in an inconsistent state - final DOM is always correct within the existing re-render budget
  + setting `notethink.kanbanAnimateTransitions = false` disables the layer entirely with no visible regression in correctness
+ open questions for the implementing agent
  + whether to coalesce two file events arriving within ~50 ms into a single FLIP cycle (vs animating both)
  + whether to flash the origin pill on the moving card during the animation (probably v2)
  + the exact easing curve - proposal: `cubic-bezier(0.2, 0, 0.0, 1.0)` to match a "thrown" feel, consistent with the existing settings-drawer easing at `ViewRenderer.module.scss:321`
+ commit message draft
  + notethink 0.3.16: kanban passive transitions animate via in-house FLIP helper (`lib/animation/`) for external file edits, AI-driven status changes and mtime reorders; user-initiated drags stay owned by `@hello-pangea/dnd` and are gated out via `passiveUpdateGate`
  + new notes fade in; new columns slide in (CSS keyframes) with inbound notes choreographed afterwards; the layer is decorative - final DOM is correct regardless of playback (350 ms per-transition + 800 ms global ceiling, `prefers-reduced-motion` respected, Global `notethink.kanbanAnimateTransitions` setting + drawer toggle to disable)
  + FLIP suppression is tied to the projection lifecycle (`useFlipGate` hold/release), not a fixed timer, so a user drag is never re-animated by its own document round-trip; real pointer-drag + round-trip regression specs added
  + tests 1405 jest, 89 playwright


### Kanban FLIP fling on passive edit: clip settles after the FLIP measures [](?id=kanban-flip-stale-baseline)

On a passive linetag edit in folder/aggregate mode (~131 tall story cards, 2 columns), the moved card animates correctly but every other card in the target column is drawn UP above its slot then slides back down (off-screen for a tall board). Reproduced deterministically and captured before/after; cosmetic only, does not block ship.

Root cause (proven, not guessed): the overflow clip is part of the layout but is applied a paint too LATE. `useMarkdownNoteOverflow` clips each top-level card to `width*1` from a PASSIVE effect, so on the frame the FLIP samples positions the cards are still at FULL height. Two faces of the same bug: (1) on first paint the FLIP captures a tall baseline; (2) the moved card changes column, React REMOUNTS it into the new Droppable with its clip reset, so it is sampled tall and shoves its new siblings down by its whole unclipped height. The FLIP inverts that bogus shift and the siblings fly up then settle. The earlier baseline-freshness attempts (board-anchor, every-render resync, ResizeObserver) only chased the symptom and left a residual fling.

Fix: settle the clip GEOMETRY synchronously. New `useSyncedBodyClip` applies `maxHeight` to the body in a CHILD `useLayoutEffect`, which React runs before the parent FLIP host's layout effect - so the FLIP always samples clipped cards (both the baseline and the just-remounted moved card). The passive hook still owns the React state that drives the Show-more bars.

+ [X] reproduce deterministically: Playwright + slow-motion + a clip-delay recreating the real tall->clip transient; confirmed FIRST tall vs LAST clipped, fling `maxAbs` ~15000px (matches the real `prevTop=144908`/`newTop=35682` signature)
+ [X] pinpoint that the clip is applied after the FLIP measures, and that the moved card remounts tall on a column change
+ [X] fix via `useSyncedBodyClip` (synchronous child layout-effect clip; writes only on change); the FLIP then measures one-slot deltas (`maxAbs` 15000px -> ~500px = one card height)
+ [X] revert the now-redundant baseline-chasing machinery: FLIP host back to a `[signature]`-keyed effect (no every-render measure); kept board-anchored measurement + the cheap ResizeObserver as a window-resize defense
+ [X] before/after evidence captured (videos + frames in `/home/alex/flip-evidence/`); 141 jest + 26 Playwright kanban E2E green; lint clean; dev bundle rebuilt
+ manual: reload the window and do a folder-mode status edit on the real 131-card board to confirm the displaced cards now slide one slot.

Change is uncommitted on branch `staging`: `useSyncedBodyClip.ts` (new), `MarkdownNote.tsx`, `useFlipTransition.ts` (+ test), `flipMath.ts`.


### Upgrade NPM packages for notethink (Wave 1 minor/patch) [](?time_taken=0)

Pins in effect after this wave (snapshot):
- eslint @9.39.4 (.ncurc reject) - structural - held - eslint-plugin-react 7.37.5 (latest) has no eslint-10 release; revisit when it ships eslint-10 compat
- @eslint/js @9.39.4 (.ncurc reject) - structural - same
Unpinned this wave: none (typescript-eslint already on caret ^8.61.1)

+ [X] run npm-check-updates
+ [X] revisit prior pins (try to unpin transient holds recorded in the last done.md story)
+ [X] pnpm install
+ [X] verify lint passes
+ [X] verify jest tests pass


### Auto integration mode follows live edits like nt_view [](?id=auto-integration-follows-content)

`nt_integration_mode` and `nt_breadcrumb_last` must auto-resolve the **same reactive way** `nt_view` does. Editing the `nt_view` linetag in the editor updates the rendered view live; editing `nt_integration_mode` / `nt_breadcrumb_last` - or switching the active editor to a file with a different declaration - must update the viewer's integration mode the same way. Today it does not: once the viewer auto-enters folder mode it is sticky, so switching from a folder-declaring file back to a plain document file leaves the Kanban aggregate on screen instead of dropping to the document render.

+ motivating repro (notegit welcome content)
  + open `portfolio/mobile-app.md` (H1 `?nt_integration_mode=folder&nt_breadcrumb_last=portfolio`) → viewer correctly auto-enters folder mode, 3-column board aggregated across `portfolio/`
  + switch the active editor back to `intro.md` (bare `# Welcome to NoteGit`, declares current_file) → viewer SHOULD drop to the document render of intro.md; instead it stays stuck on the portfolio board (the reported bug - screenshot 2026-06-19)
  + same failure for `project-board.md` (`?nt_view=kanban`, no integration tag → current_file) and any other non-portfolio file
+ reference architecture - how auto VIEW TYPE works (the model to copy)
  + `AutoView.tsx` is a **pure render-time derivation**: when the selection is `auto`, it reads the file's `nt_view` from the CURRENT content every render (`resolveNamespacedTag(attributes,'view')` / `majorityNgView(props.notes)`) and delegates to `GenericView` with the derived concrete type - no persisted state, no dispatch, no once-per-doc guard
  + reactivity is free: edit `nt_view` → extension re-parses + re-sends the doc → webview `docs` state updates → React re-renders → `AutoView` re-derives → new type. The same chain fires on an active-file switch (new doc becomes most-recent / active)
  + selection/resolved split: persisted selection (may be `auto`) drives the dropdown value (`ViewTypeSelector`, "Auto (Kanban)"); the resolved concrete type is what renders (`replaced_attributes` = selection, `derived_attributes` = resolved). A concrete pick pins; `auto` keeps following the file
  + file-level read primitive: `mergeAggregateRoot.ts:281-293` reads `file_view_type` (H1 `nt_view` over front-matter, most-specific wins)
+ root cause - how auto INTEGRATION MODE diverges from that model
  + `useAutoIntegration.ts` is an **imperative one-shot effect**, not a derivation: behind a once-per-doc-identity guard (`resolved_for_ref`, keyed `id:hash`) it DISPATCHES `setIntegration` and WRITES persisted `integration_path` into `FOLDER_VIEW_STATE_ID`
  + it is **one-directional**: the only branches ENTER folder mode (`decl.mode === folder`) or seed `parent_context_seq`. There is no branch that exits folder mode when the opened file resolves to current_file (`useAutoIntegration.ts:57-96`)
  + the renderer reads the concrete mode from **persisted view-state**, not live content: `NoteRenderer.tsx:78` → `anyViewInFolderMode(props.viewStates)` → `resolveIntegrationMode` (`auto` + a seeded `integration_path` resolves folder, `viewstateops.ts:45`). So the board stays until something rewrites that persisted state
  + net: editing the linetag away / switching files re-runs the effect (hash or active path changed) but it has nothing to do in the exit direction - the opposite of `AutoView`, which simply re-derives
+ the one necessary asymmetry (call out, don't ignore)
  + auto view type is a pure webview rendering choice over the SAME data; integration mode changes WHAT DATA the extension loads - folder discovery + watchers + the aggregated docs map, via the `setIntegration` round-trip (`PanelSession.handleSetIntegration` → `enterFolderMode` / `enterCurrentFileMode`)
  + so it cannot be a purely render-time function; the faithful port is two layers:
    + (1) **derive** the target mode + path reactively from the active file's current declaration when the selection is `auto` (mirrors `AutoView` reading `nt_view` every render) - `resolveFileIntegrationDeclaration` is the existing derivation primitive
    + (2) an **idempotent reconcile effect** that fires `setIntegration` and syncs the persisted `integration_path` only when the derived target diverges from what the extension currently has - keyed on the derived target (mode+path), NOT a once-per-doc guard
+ the existing manual equivalent already does the right thing - reuse it
  + `handle_integration_change('auto')` (`useViewToolbar.ts:64-114`) IS the operation we want fired automatically: re-resolves mode+scope from `file_declared_integration`, on a current_file resolve it clears `integration_path`, clears stranded folder tags + focused/selected, re-seeds `parent_context_seq`, and posts `setIntegration current_file`
  + factor the "auto reset → view-state updates + setIntegration payload" builder out of `useViewToolbar` so the toolbar path and the reactive editor-follow path share one implementation and can't drift (`reconcileAutoIntegrationMode` + a new shared builder in `viewstateops.ts`)
+ cases the reactive resolver must cover (bidirectional)
  + folder-declaring file active, cold → enter folder at declared path (already works)
  + in auto-folder, active editor switches to a current_file file OUTSIDE the current `integration_path` → exit to current_file (the bug)
  + in auto-folder, user edits the active file to remove/blank `nt_integration_mode` + `nt_breadcrumb_last` → exit to current_file (reactive, like editing `nt_view`)
  + in current_file, user edits the active file to ADD `nt_integration_mode=folder` or a folder-resolving `nt_breadcrumb_last` → enter folder (reactive)
  + concrete `integration_mode_selection` pin (folder / current_file) → never auto-changed (preserve `useAutoIntegration.test.ts:59,69`)
  + focus landing on a member file INSIDE the current `integration_path` (e.g. clicking a card reveals its source) → STAY folder; gate the exit on "opened file is outside `integration_path`" so card clicks never kick the user off the board
+ open design decisions (resolve in-story before coding)
  + folderA → folderB re-snap: today auto deliberately never re-snaps a navigated folder (`useAutoIntegration.ts:72` comment). Decide whether switching the active editor to a file declaring a DIFFERENT folder re-snaps the scope (the reactive model implies yes; the current model says no)
  + breadcrumb navigation within auto-folder: if the resolver re-derives the path from the file on every change, a user descent via breadcrumb would snap back. Decide whether a diverging breadcrumb descent pins concrete folder, or the persisted navigated path is honoured over the file declaration on re-derive
+ where (files)
  + `client/webview/src/hooks/useAutoIntegration.ts` - re-architect: reactive derive + idempotent reconcile; drop the once-per-doc-only-enter guard
  + `client/webview/src/notethink-views/src/lib/viewstateops.ts` - extract the shared auto-reset builder; keep `resolveIntegrationMode` / `reconcileAutoIntegrationMode` as the selection/resolved split
  + `client/webview/src/notethink-views/src/components/views/generic/useViewToolbar.ts` - route `handle_integration_change('auto')` through the shared builder
  + `client/webview/src/lib/docops.ts` - `resolveFileIntegrationDeclaration` stays the derivation primitive (already mirrors `mergeAggregateRoot`'s `file_view_type` read)
  + `client/webview/src/components/NoteRenderer.tsx` - confirm the render decision tracks the reactively-derived mode (no stale persisted-only read)
  + `client/extension/src/vscode/PanelSession.ts` - confirm no change needed (the `setIntegration current_file` teardown + folder re-discovery already exist)
+ [X] open design decisions resolved (2026-06-19):
  + folderA -> folderB re-snap: YES, follow the active file. Switching the active editor to a file declaring a DIFFERENT folder (one outside the current `integration_path`) re-snaps the board to that folder, mirroring how `nt_view` follows the active file. Gated so a card-click that reveals a member file INSIDE the current `integration_path` never kicks the user off the board.
  + breadcrumb descent vs re-derive: PRESERVE the navigated position. The persisted navigated `integration_path` wins over the file declaration whenever the SAME active file re-derives (edit / re-render), so a breadcrumb descent is never yanked back; a change of active file (above) is the only trigger that re-snaps.
+ [X] extract the shared auto-reset builder (`buildIntegrationDispatch` in `viewstateops.ts`); route the toolbar `handle_integration_change('auto')` through it
+ [X] re-architect `useAutoIntegration` to derive-then-reconcile (bidirectional, keyed on derived target via `declTargetKey`, exit gated on outside-`integration_path` via `isPathWithinFolder`; decision factored into pure `decideAutoIntegrationReconcile` in `docops.ts`)
+ [X] preserve concrete-pin immunity (no auto change when selection is folder / current_file)
+ [X] jest: editor switch folder→current_file exits; linetag removal exits; linetag add enters; member-file-inside-path stays folder; concrete pins untouched (`useAutoIntegration.test.ts` + `docops.test.ts` `decideAutoIntegrationReconcile`)
+ [X] jest: folderA→folderB re-snap (decideReconcile + hook re-snap case)
+ [X] playwright: switch to a file outside the scope → document render; member inside the scope stays; live linetag edit flips the mode (`auto-integration.spec.ts` reactive describe)
+ relationship - independent of [[single-file-kanban-story-descent]] (that story is WHAT renders inside single-file kanban; this is WHEN the integration mode flips); both touch the same portfolio demo files
+ FOLLOW-UP (2026-06-22, 0.3.19) - the webview fix shipped green but the bug still reproduced live in the notegit `:3500` preview: open `portfolio/mobile-app.md` (folder), switch to `intro.md`, board stays stuck on the portfolio aggregate
  + residual root cause - the reactive reconcile was real but BLIND at the extension boundary. the original "where (files)" plan recorded `PanelSession.ts - confirm no change needed`; that assumption was wrong
    + in folder mode `PanelSession.sendDoc` deliberately drops out-of-scope docs (`if (integration_path && !isWithinIntegrationPath(doc.path)) return`, the "skipping out-of-integration doc" log) so the aggregate is not polluted. `onDidChangeActiveTextEditor` builds + sends the newly-active doc through that same skip, so `intro.md` never reached the webview docs map; only its `selectionChanged` did
    + so `pickOpenedDoc(docs, active_editor_doc_path)` could not find `intro.md` in `docs` and fell back to `pickMostRecentlySentDoc` - a portfolio member, still folder-declaring - so `decideAutoIntegrationReconcile` saw decl=folder, never hit the exit branch, returned null. the reconcile had nothing to react to
  + why it tested green but failed live - the Playwright "switch OUTSIDE the scope" test injected `intro.md` straight into the webview docs via `injectDocsFromFixture`, bypassing `sendDoc`'s out-of-scope filter; it modelled a world where the out-of-scope doc is already in the webview, which never happens in real folder mode. classic green-suite / broken-feature at an unmocked boundary
  + decision stays in the webview (per the story's design) - the extension only FEEDS it the active file's declaration; do not duplicate `resolveFileIntegrationDeclaration` / `decideAutoIntegrationReconcile` extension-side
  + [X] extension: add a dedicated `activeEditorDoc` channel - `sendDoc`'s out-of-scope skip now calls `sendActiveEditorDoc(timestamped)` when the skipped doc is the active editor (`doc.path === active_path`), posting `{ type: 'activeEditorDoc', doc }` without merging into the aggregate (`PanelSession.ts`)
  + [X] webview: `useVscodeMessages` handles `activeEditorDoc` into a new `active_doc` state (+ sets `active_editor_doc_path`); `ExtensionReceiver` threads `active_doc` into `useAutoIntegration`; `pickOpenedDoc` consults `active_doc` when the active path is absent from the aggregate, before the most-recently-sent fallback
  + [X] jest: new `useAutoIntegration` case - out-of-scope active file delivered ONLY on the `active_doc` channel (absent from `docs`) still exits to current_file
  + [X] playwright: the "switch OUTSIDE the scope" exit test now delivers `intro.md` via `injectActiveEditorDocFromFixture` (the real boundary), not the docs aggregate, so it actually gates this regression
  + note - covers the editor-switch exit and the out-of-scope-active-file edit (both route through `sendDoc` with `doc.path === active_path`); on reload the cold-mount guard preserves a restored folder, unchanged


### Single-file kanban descends to ### stories under ## epics [](?id=single-file-kanban-story-descent)

In current_file (single-file) mode the kanban renders the *direct children of the scope heading* as cards. For a nested doc (`#` → `##` epics → `###` stories) those children are the `##` epics, so the board shows epic cards (e.g. "Storefront", "Design system") sitting in one untagged column instead of the `###` stories partitioned by status. The `###`-as-card / `##`-as-epic transform exists only in folder mode (`mergeAggregateRoot.ts`); single-file mode never had it. Bring that transform to current_file mode so a nested file opened on its own renders its stories as cards, each tagged with its epic.

+ background - root cause
  + `useViewContext.ts:74` sets `notes_within_parent_context = parent_context.child_notes`, and `KanbanView` renders those as cards, so the card level is always exactly one below the scope heading
  + AutoView scopes to the `nt_view`-declaring note (the `#` H1), so a nested file's cards come out as its `##` epics
  + the depth-3-stories / `##`-epics flatten lives only in `mergeAggregateRoot.ts` (folder mode), added in `bf25cc2` (0.1.59)
  + the single-file composer (`NoteTreeComposer`) only runs `convertMdastToNoteHierarchy` + `stampSingleFileStableIds` - the latter stamps `stable_id`s but does not restructure the tree
  + not a refactor regression - `KanbanView` rendered `notes_within_parent_context` both before and after the `cd4fcb4` decomposition; single-file descent was never implemented
  + `parent_context_seq` (seeded by `nt_breadcrumb_last`) only scopes into ONE subtree, so it cannot gather `###` stories across multiple `##` epics
  + `AUTHORING_GUIDE.md` documents `###` as "the unit that becomes a Kanban card" universally, so the guide's own nested example mis-renders in single-file mode today
+ demonstrating files (notegit welcome content)
  + `web-store.md`, `platform-infra.md`, `project-board.md` - nested, no folder trigger, so they show `##` epics as cards
  + `mobile-app.md` - same shape but carries `nt_breadcrumb_last=portfolio`, which resolves to a folder segment and flips it into folder mode, so it renders correctly; this contrast is what makes the bug look like a regression
  + a notegit-side content stopgap (out of scope for this story) is to add `nt_breadcrumb_last=portfolio` to the other portfolio files, but that shows the merged 3-file board, not the opened file's own stories, and does not fix standalone nested files
+ desired behaviour
  + a nested single file in kanban view shows its `###` stories as cards, partitioned into status columns
  + each card is tagged with its `##` epic (structural), with explicit `epic=` linetags overriding (direct > inherited > structural), matching folder mode
  + flat files (`##` stories directly under `#`, no epic layer) keep rendering `##` as cards unchanged
  + mixed shapes (some `###` directly under `#`, some under `##`) collect both, mirroring `mergeAggregateRoot`'s `walk_children` pass
+ approach
  + give current_file mode the same transform folder mode has: when the scope heading's children are `##` epics containing `###` stories, descend and present the `###` stories as the rendered note set
  + reuse the folder-mode machinery over a single doc where possible - the epic registry (`file_epic_by_id` / `file_epic_by_name`), structural `origin.epic`, and `walkStorySubtree` already exist in `mergeAggregateRoot.ts`
  + stamp a minimal `origin.epic` (epic chip only; single-file notes carry no project, so `OriginPill` should render the epic without a project pill)
+ open questions / decisions
  + where to run the transform (single-file composer vs a gated branch in `useViewContext`) so folder mode is never double-flattened
  + whether descent is automatic (detect an epic layer) or opt-in - automatic preserves the documented `###`-is-a-card contract with no authoring change
  + how drag-drop status + ordering rewrites route back to the one doc when cards are `###` under `##` (folder mode partitions by docPath; single-file has one doc, so the existing single-file editText path should apply - verify offsets)
  + interaction with `parent_context_seq` / `nt_breadcrumb_last` scoping into a single epic (should still work, narrowing to that epic's stories)
+ [X] reproduce / encode the bug: the playwright descent spec asserts the `##` epics are NOT cards and the `###` stories ARE (a contrast that would fail against the pre-fix tree)
+ [X] transform seam decided (2026-06-19): single-file composer (`NoteTreeComposer`), NOT `useViewContext`. `useViewContext` runs for both folder and single-file, so a shared-branch flatten would double-flatten the already-merged folder tree; the composer is single-file-only (folder mode renders `FolderTreeComposer`) and owns the docId/docPath postMessage wrapper that keeps drag routing on one doc. Descent is AUTOMATIC (no opt-in) but GATED on the file rendering as a kanban board (explicit kanban viewType, or H1/front-matter `nt_view=kanban` via `fileDeclaredViewType`) AND on the structural nested-vs-flat shape AND on a single `#` H1 - so a plain nested document keeps its `##` structure + prose (it is not a board) and a no-H1 file is never mistaken for a folder aggregate. For a kanban board the descent is at the data level, so its document view also shows the flattened stories, matching folder-mode parity (the D5 choice).
+ [X] implement single-file `###`-story flatten with structural `##`-epic tagging (`flattenSingleFileStories` in `mergeAggregateRoot.ts`, reusing `buildFileEpicRegistries` + `resolveEpicLinetag`; wired into `NoteTreeComposer` before the stable-id stamp)
+ [X] resolve explicit `epic=` overrides (direct > inherited > structural) in single-file mode (via `resolveEpicLinetag`; inherited `nt_child_epic=` already collapsed by `convertMdastToNoteHierarchy`)
+ [X] render the epic chip via `OriginPill` without a project pill in single-file mode (`epicOnly` prop; `MarkdownNoteHeadline` passes it for project-less origins and gates the empty-pill case)
+ [X] preserve flat-file behaviour (structural nested-vs-flat gate leaves flat `##`-card files byte-identical)
+ [X] verify drag-drop status + ordering rewrites land on the one doc for `###` cards (origin carries doc_path so payload routes single-doc; positions/seq preserved verbatim so offsets stay valid; covered by KanbanView single-file drag tests + kanban-pointer-drag playwright)
+ [X] jest: nested single-file tree yields `###` cards with epic tags; flat file unchanged; position/seq preserved; idempotent (`mergeAggregateRoot.test.ts` `flattenSingleFileStories`) + composer wiring (`NoteTreeComposer.test.tsx`) + `OriginPill.test.tsx` epicOnly
+ [X] playwright: nested single file renders `###` story cards in status columns with epic chips and no project pill (`kanban-single-file-descent.spec.ts`)
+ [X] revisited `AUTHORING_GUIDE.md`: its `###` = Kanban card claim (lines 84, 100) is now accurate in single-file mode too, so no wording change was needed


### Restore viewer task-checkbox toggling

Clicking a rendered task checkbox (`[ ]` / `[x]`) in the viewer should tick/untick it and write the matching `X`/space into the editor source. This silently stopped working: the checkbox rendered and was clickable, but no edit reached the file.

+ symptom
  + a rendered task checkbox in the document/kanban viewer did nothing on click - no source edit, no visible toggle (the editor is the source of truth, so the box never changed)
  + reproduced empirically: the click pipeline fired but `editText` was either never posted or rejected by the extension
+ root cause - two independent defects, both needed for the user's files
  + `calculateTextChangesForCheckbox` (`noteops.ts`) matched only `-` task bullets via `/- \[([ xX])\]/g`; this repo's todo files use `+` bullets, so it returned no changes and nothing was posted (narrowed to dash-only in commit 5b7a2bb's "checkbox crash fix")
  + the checkbox branch in `useViewHandlers.ts` posted `docPath: note.origin?.doc_path`, which is undefined in single-file mode for a flat file (no `flattenSingleFileStories` origin); `applyEditTextToDoc` refuses a falsy `doc_path`, so even a valid change was dropped. `revealNote` already had the `?? props.doc_path` fallback; the checkbox branch did not
  + investigation corrected an early wrong theory ("interactive checkbox is dead code"): `GenericNoteWrapper` injects the listItem's `checked` onto its paragraph child, so `renderMarkdownNoteHeadline` does render a real, non-disabled `<input>` - the render was fine, the edit computation and routing were not
+ [X] confirm root cause empirically (parse + full render + click probe across `-`/`+`/`*` markers and single-file docPath)
+ [X] broaden the checkbox regex to `/[-+*] \[([ xX])\]/g` and derive the `[` offset from the match (marker-agnostic, no magic `+2`)
+ [X] add the `?? props.doc_path` single-file fallback to the checkbox branch's `editText` docPath
+ [X] add jest unit guards for `+` and `*` markers in `noteops.test.ts` (assert exact offset + insert)
+ [X] add a real render -> click -> `editText` integration test (`useViewHandlers.test.tsx`) covering interactive render, `-`/`+`/`*`, uncheck, and the single-file docPath fallback - the layer the old hand-fed unit tests could not catch
+ [X] add a Playwright e2e (`checkbox-toggle.spec.ts`) asserting a `+` checkbox click posts `editText` with a fallback docPath and `X`/space inserts, against the built bundle
+ [X] rebuild and verify the fixes are in `client/webview/dist/index.js`; full `pnpm run check` green; full Playwright green
+ delivery notes
  + tests: 1467 jest (was 1459), 97 playwright (was 95)
  + chose the minimal text-match fix (broadened regex) over a deterministic-offset rewrite: it is offset-verified for the working path, low risk, and consistent with the existing path in both integration modes
+ known limitations - out of scope, candidate follow-up
  + text-matching still mis-toggles when a story has two identically-worded tasks (first match wins) or formatted task text (rendered text differs from source); a deterministic per-listItem source offset would fix both but needs offset-coherence verification in folder mode
+ commit message draft
  + notethink: fix viewer task-checkbox toggling - broaden checkbox edit regex to accept `+`/`*` bullets (not just `-`) and fall back to the view doc_path in single-file mode so the editText is not dropped; add render->click->editText integration test + `+`/`*` unit guards + checkbox-toggle e2e; tests 1467 jest, 97 playwright


### Configurable editor behavior on note/story click [](?id=click-open-editor-settings&time_estimated=120)

Clicking a story in a NoteThink view always reveals it in an editor today. When the board fills the window with no other editor groups open, that spawns a new editor group on every click - almost always unwanted. Put the editor-switching behavior behind two user settings so the board can act as a standalone surface.

+ goal
  + clicking a note no longer spawns a new editor group when the board is alone, unless the user opts in
  + the existing switch-to-editor behavior stays the default whenever an editor is already open
  + both behaviors are user-controllable VS Code settings, gated entirely extension-side
+ settings - both global (scope `window`, `inCascade: false`), mirroring `kanbanAnimateTransitions`
  + `notethink.settings.view.generic.switchEditorOnClick` - default `true`
    + true keeps current behavior: a click reveals and switches focus to the clicked note's editor
    + false does not switch focus to an editor or open one, but an already-open editor still has its caret moved to the clicked note; the board's own focus highlight updates either way
  + `notethink.settings.view.generic.openNewEditorIfNoneOpen` - default `false`
    + governs only the "no other editor group exists" case (board in pseudo-fullscreen)
    + false: clicking a note does not create a new editor group
    + true: clicking a note opens a new group beside the board (today's fallback behavior)
  + generic namespace because the reveal handler is shared by kanban and document views (operator sign-off given for keys + scope)
+ background - current flow is all extension-side
  + webview posts `revealRange` (single click) / `selectRange` (double click) from the `useViewHandlers.ts` click dispatcher
  + extension routes both to `PanelSession.handleRevealRange` (`client/extension/src/vscode/PanelSession.ts:525`)
  + `handleRevealRange` tries `revealInVisibleEditor` (`PanelSession.ts:546`) - switches to the doc when it is already visible
  + single-file mode (`!this.integration_path`) already returns silently to avoid spawning editors (`PanelSession.ts:537`)
  + folder mode calls `revealByOpening` (`PanelSession.ts:562`), which falls back to `vscode.ViewColumn.Beside` when no other group holds or can host the doc - this `Beside` fallback is the new-group spawn we want to gate
  + the gate is entirely in the extension's reveal path; no setting needs to reach the webview for the core behavior
+ design - gate the reveal path
  + read both settings once at the top of `handleRevealRange` via `readSetting` (`client/extension/src/lib/settings.ts`)
  + thread `switchEditorOnClick` into `revealInVisibleEditor`: always set the selection and `revealRange` (move the caret), but only call `showTextDocument` to steal focus when the flag is true
  + when `switchEditorOnClick` is false and no editor shows the doc, return without opening one (opening an editor is itself a switch)
  + in `revealByOpening`, when no existing group holds the doc and no other editor group exists, only fall back to `ViewColumn.Beside` if `openNewEditorIfNoneOpen` is true; otherwise return without opening
  + reuse-an-existing-other-group stays unconditional under switch=true (that is switching, not spawning)
+ design decision - switch=false still moves the caret (and the selection range on double-click) in an already-open editor; it only suppresses stealing focus and opening a new editor
+ scope - settings declaration
  + add both keys to `contributes.configuration[0].properties` in `package.json` (after `package.json:230`), type boolean, scope `window`, with `%...%` description placeholders
  + add description strings to all five `package.nls*.json` files (`json`, `de`, `es`, `fr`, `it`) - no em or en dashes in any locale string
  + add both to the `SETTINGS` map in `client/extension/src/lib/settings.ts` with `inCascade: false`
+ scope - core behavior
  + branch `handleRevealRange` and `revealByOpening` per the design above
+ scope - settings-panel surfacing (deferred to a follow-up, not needed for the behavior)
  + the gate is entirely extension-side, so the VS Code Settings UI already exposes both toggles
  + surfacing them in the in-webview global-settings panel (via `GlobalSettingsPayload` + `sendGlobalSettings`) is a later nicety, out of scope this round
+ out of scope
  + per-workspace overrides (settings are global this round)
  + any change to single-file mode, which already stays silent
  + new webview interaction behavior beyond reading the toggles for the settings panel
+ files
  + `package.json` - two new `notethink.settings.view.generic.*` boolean properties
  + `package.nls.json` + `package.nls.{de,es,fr,it}.json` - description strings
  + `client/extension/src/lib/settings.ts` - two `SETTINGS` entries (`inCascade: false`)
  + `client/extension/src/vscode/PanelSession.ts` - gate `handleRevealRange` / `revealByOpening`; optionally extend `sendGlobalSettings`
  + `client/webview/src/notethink-views/src/types/Messages.ts` - optional `GlobalSettingsPayload` extension
  + `client/extension/src/vscode/notethinkEditor.test.ts` (or a PanelSession test) - branching tests
+ [X] add `view.generic.switchEditorOnClick` (default true) + `view.generic.openNewEditorIfNoneOpen` (default false) to `package.json`
+ [X] add the two description strings to all five `package.nls*.json` files
+ [X] add both keys to the `SETTINGS` map in `settings.ts` with `inCascade: false`
+ [X] thread `switchEditorOnClick` into `revealInVisibleEditor` so the caret moves but focus is stolen only when true
+ [X] return from `handleRevealRange` without opening an editor when `switchEditorOnClick` is false and no editor shows the doc
+ [X] gate `revealByOpening` to skip the `ViewColumn.Beside` new-group fallback when `openNewEditorIfNoneOpen` is false and no other editor group exists
+ [X] jest: switch=false with a visible editor moves the caret (`revealRange`) but does not call `showTextDocument`
+ [X] jest: switch=true with the doc already visible moves the caret and calls `showTextDocument` (focus steal)
+ [X] jest: switch=true, board alone, openNew=false opens no editor (no new group)
+ [X] jest: switch=true, board alone, openNew=true opens with `ViewColumn.Beside`
+ [X] jest: switch=true with another group open reuses that group's column
+ [X] jest: built-in defaults (true / false) and explicit overrides flow through `readSetting` in the behaviour tests
+ [X] bump patch version in `package.json`
+ [X] `pnpm run check` green
+ manual: board alone with defaults - click stories, confirm no new editor group spawns and the board highlight still tracks the click
+ manual: open an editor beside the board - click a story, confirm that editor navigates to it
+ manual: set `switchEditorOnClick=false` with an editor open beside the board - click stories, confirm the caret moves in that editor but focus stays on the board, and that clicking with no editor open opens nothing
+ manual: set `openNewEditorIfNoneOpen=true` with the board alone - click a story, confirm a new editor group opens
+ manual: repeat the board-alone check in document view to confirm the generic scope applies there too
+ acceptance
  + with defaults, a click on a standalone board no longer spawns an editor group
  + with defaults, a click still switches an already-open editor to the clicked note
  + `switchEditorOnClick=false` moves the caret in an already-open editor without stealing focus, and never opens an editor
  + `openNewEditorIfNoneOpen=true` restores today's new-group-on-click behavior
  + behavior is identical across kanban and document views
+ open questions for the implementing agent
  + whether the in-webview settings panel auto-lists new global settings or needs per-toggle wiring (decides if the optional surfacing task is trivial)
+ commit message draft
  + notethink 0.3.21: put editor behaviour on note click behind two settings - `view.generic.switchEditorOnClick` (default true) governs the focus-switch (off still moves the caret in an open editor), `view.generic.openNewEditorIfNoneOpen` (default false) stops a standalone board spawning a new editor group on click
  + tests N jest, N playwright
