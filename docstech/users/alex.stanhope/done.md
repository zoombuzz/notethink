# Done [](?ng_view=kanban&ng_child_status=done&order=newest-at-bottom)


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


### Settings drawer (replace centred modal with top-anchored, full-width, push-down drawer)

+ goal
  + clicking the toolbar gear icon should open a full-width drawer attached below the toolbar, not pop a centred modal dialog
  + the drawer pushes page content down rather than overlaying it; the part of the document the user was looking at remains visible (the page scrolls down by the drawer's height to compensate)
  + changes inside the drawer apply immediately to the view — no Save or Cancel buttons; clicking the gear again (or pressing Escape) closes the drawer
  + must be performant on long documents and large kanbans — opening/closing the drawer must not re-render the note tree

+ research — best practice for a top-anchored push-down drawer in a VSCode webview
  1. **closest precedents inside VSCode** — VSCode's Find widget (Ctrl+F) and the merge-editor toolbar are top-anchored, full-width widgets that animate in/out. They use CSS transitions on `transform: translateY()` and *overlay* content. Push-down required a different primitive
  2. **animating from collapsed to natural content height** — CSS Grid trick: outer `display: grid; grid-template-rows: 0fr; transition: grid-template-rows 150ms` with inner `overflow: hidden; min-height: 0`; toggling to `1fr` animates smoothly to natural height. No JS measurement, no `max-height` brittleness
  3. **scroll anchoring** — capture an anchor element's `getBoundingClientRect().top` before the drawer opens, then `scrollBy` so the anchor returns to its previous viewport-y. CSS `overflow-anchor: auto` is unreliable for deliberate UI toggles
  4. **sticky vs absolute vs fixed** — `position: sticky; top: <toolbar-height>` keeps the drawer in document flow (so content below moves down) but glued just below the toolbar while content scrolls underneath
  5. **VSCode theming** — `var(--vscode-editorWidget-*)`, no backdrop, border-bottom matching the toolbar so the drawer reads as attached
  6. **animation timing** — 150ms `cubic-bezier(0.2, 0, 0.38, 0.9)`; `@media (prefers-reduced-motion: reduce)` zeroes the duration
  7. **performance** — `React.memo` on the drawer; reads from props with no local mirror; always mounted (open/closed is a CSS class); each onChange dispatches for a single key only, so `React.memo` on `DocumentView`/`KanbanView` filters out untouched re-renders
  8. **real-time apply semantics** — per-view settings dispatch via `setViewManagedState`; global settings via `postMessage({ type: 'updateGlobalSetting' })`; Kanban column reorder normalises to `column_order: undefined` when the order matches natural

+ design decisions (locked in 2026-05-11)
  1. **renamed `SettingsDocumentModal` → `SettingsDocumentDrawer` and `SettingsKanbanModal` → `SettingsKanbanDrawer`** — `<dialog>` replaced with plain `<div>` styled via the new `.settingsDrawer` SCSS class
  2. **drawer ownership moved up to `GenericView`** — single, predictable place to insert the push-down element; `DocumentView`/`KanbanView` no longer own settings state or render settings UI
  3. **`position: sticky; top: 22px`** below the toolbar; closing via clicking the gear again or pressing Escape
  4. **no Save / no Cancel** — every input dispatches on change; local mirrored state removed; version label kept for diagnostics
  5. **scroll anchoring in `GenericView`** — `useLayoutEffect` captures the gear button's `getBoundingClientRect().top` before the toggle, then a `requestAnimationFrame` loop calls `window.scrollBy(0, delta)` for ~250ms (covering the 150ms animation + margin) so the gear stays glued at its initial viewport position
  6. **animation via CSS Grid** — `grid-template-rows: 0fr → 1fr`; flipped via `data-open="true"`
  7. **reduced motion** — transition zeroed; `scrollBy` always instant
  8. **gear icon is a toggle** — `aria-expanded={settings_drawer_open}`; tooltip stays `Settings`
  9. **shared controls extracted** — `SettingsCommonControls.tsx` houses the four shared booleans; both drawers compose it
  10. **drawer cap height** — `max-height: 50vh; overflow-y: auto` on the inner wrapper
  11. **layout** — drawer body is a flex row: setting groups on the left (one group for Document, two for Kanban: column order + common controls), title and version pinned right via `justify-content: space-between`

+ code changes
  + [X] new SCSS `.settingsDrawerGrid`, `.settingsDrawer`, `.settingsDrawerBody`, `.settingsDrawerGroups`, `.settingsDrawerGroup`, `.settingsDrawerMeta`, `.settingsDrawerColumnOrder`, `.settingsDrawerVersion` in `ViewRenderer.module.scss`
  + [X] renamed `SettingsDocumentModal.tsx` → `SettingsDocumentDrawer.tsx`; removed `<dialog>`/local state/Save/Cancel; controlled inputs dispatch via `onSettingChange` / `onGlobalSettingChange`
  + [X] renamed `SettingsKanbanModal.tsx` → `SettingsKanbanDrawer.tsx`; column up/down/reset dispatch via `onColumnOrderChange` on every click
  + [X] new `SettingsCommonControls.tsx` housing the four shared boolean checkboxes
  + [X] `GenericView.tsx` — hoisted `settings_drawer_open`; gear button has `aria-expanded` and a ref; `useLayoutEffect` rAF loop anchors gear-button viewport-y; document keydown listener closes on Escape and returns focus to the gear; drawer renders between toolbar and view body; `arraysEqual(custom_order, natural_order)` normalisation lives in `handleColumnOrderChange` so persistence drops to `undefined` when the order matches natural
  + [X] `DocumentView.tsx`, `KanbanView.tsx` — `settings_open` state, `handleSettingsSave`, `onSettingsClick` ref wiring, and inline modal renders removed
  + [X] `ViewProps.ts` — `handlers.onSettingsClick` removed (no other consumers)
  + [X] `l10n-rendering.test.tsx` — updated imports/props for renamed drawers; Save/Cancel assertions dropped (no such buttons)

+ tests (Jest)
  + [X] `SettingsDocumentDrawer.test.tsx` — each onChange dispatches the right handler with the right key/value; no Save/Cancel; version label rendered
  + [X] `SettingsKanbanDrawer.test.tsx` — up/down/reset dispatch the new array; reset dispatches the natural order (consumer normalises to `undefined`); checkboxes dispatch immediately
  + [X] `SettingsCommonControls.test.tsx` — each of the four checkboxes dispatches the expected handler with the expected key
  + [X] `GenericView.test.tsx > settings drawer` — gear toggles `aria-expanded`; drawer `data-open` flips; the right drawer renders by view type; per-view checkbox dispatches `setViewManagedState`; line-numbers checkbox dispatches `postMessage updateGlobalSetting`; Kanban reorder persists `column_order`; reset persists `undefined`; Escape closes and returns focus
  + [X] regression guard — Jest total 492 (baseline 488 + 4 net new) — no regressions; lint clean

+ tests (Playwright)
  + [X] all 35 existing Playwright tests continue to pass (settings-toggle.spec.ts, kanban, view-switching, breadcrumb, click-interaction, document-view, error-boundary, keyboard-navigation, list-bullets)
  + drawer-interaction Playwright tests (open/close animation, scroll anchoring, reduced motion) were not added at the browser level — equivalent assertions live in Jest under jsdom (toggle, dispatch, Escape + focus restoration). Could be added later if browser-level coverage becomes useful; deferred because the jsdom + manual verification already covers the behaviour

+ notes
  + the only remaining `<dialog>` consumer is `InsertModal.tsx` — kept modal because it's a single-shot data entry that interrupts flow
  + the CSS Grid `0fr → 1fr` animation requires Chromium 117+. VSCode ≥ 1.96 ships Electron 32 / Chromium 128 — well within range
  + interacts cleanly with the Aggregate (Directory) story still in todo.md: in Directory mode a single drawer below the single toolbar remains the right model; the drawer's `onSettingChange` dispatches `setViewManagedState` for the merged view's `id`, exactly as for a single-file view
  + post-implementation refinement (user feedback): Kanban Settings title and NoteThink version label pinned right; settings split into multi-column groups so the drawer is shorter and easier to scan


### Aggregate (Directory) view: merge files into a single view

+ goal
  + in Directory mode, show one merged visualisation of all matching files rather than N stacked copies of the single-file view
  + each merged story carries an origin tag so the user can see which file it came from
  + foundation for a project-plan Kanban that aggregates stories from every `todo.md` under `active_development/*/` into one board

+ design (locked in 2026-05-14)
  + synthetic root in the webview (not on the extension side): `mergeAggregateRoot(docs, integration_path)` parses every doc via `convertMdastToNoteHierarchy` then surfaces depth-3 headings under a single seq=0 root, renumbering globally
  + `##` headings are treated as epics: their depth-3 children become stories with `origin.epic = { name, id? }`; the structural epic is overridden by a direct `epic=` linetag (or one propagated via `ng_child_epic=` inheritance — already wired by `applyChildAttributeInheritance`)
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
  + cross-project aggregation (`active_development/*/docstech/...`) — current `setIntegration` accepts a single directory only; multi-root integration is a later story
  + `calfam/docstech/users/alex.stanhope/done.md` historical-context `##` dividers (lines 1367-1368 at the time of writing) interpret as epics; user cleaned these up after this story
  + `linetagops` round-trip tests for `%26` / `+` encoding were not added — encoding works via existing `URLSearchParams` decoding; add when a real edge case appears

+ tests 527, playwright 40, lint clean


### Harden webview→host trust boundary before public release [](?id=webview-path-hardening&time_estimated=90)

Pre-publish security review found the only mitigation between a future webview-script regression and arbitrary file read/write is the markdown sanitizer + CSP. Added host-side validation so the trust boundary is defended in depth before the first public release.

+ background
  + webview-supplied paths reach privileged host fs/editor APIs with no workspace-containment check
  + not exploitable today (sanitizer + nonce CSP block webview script) — this is belt-and-suspenders
  + relates to the "Publish NoteThink 0.1.x to marketplace" story — landed before `vsce publish`
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
  + `notethinkEditor.ts:550` — rejects non-workspace or non-`.md`, logs via `writeToErrorLog`, returns
+ [X] guard `revealRange`/`selectRange` path before `openTextDocument`/`showTextDocument`
  + `notethinkEditor.ts:382` — validated after the `!doc_path` early-return; gates the existing-editor fast-path too
+ [X] guard `setIntegration` directory before `RelativePattern`/`findFiles`/watcher
  + `notethinkEditor.ts:458` — rejects at the top of the directory branch, before any teardown
+ [X] add http/https/mailto scheme allow-list to `openExternal`
  + `notethinkEditor.ts:631` — host-side `ALLOWED_EXTERNAL_SCHEMES` check, parsed once
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
+ manual: open a note whose origin path is forced outside the workspace — confirm refused, not opened
+ manual: click an http link and a mailto link — confirm both still open externally
+ manual: confirm Mermaid diagrams still render after pinning securityLevel
+ commit message draft
  + notethink 0.1.61: harden webview→host trust boundary — workspace-containment guard on editText/revealRange/setIntegration paths, http/https/mailto allow-list for openExternal, pin mermaid securityLevel=strict
  + ; tests 547 jest, 40 playwright


### Publish NoteThink 0.1.x to marketplace [](?id=publish-notethink-0-1-x)

Publisher created (`NoteThink`, notethink.com verified). Extension rebranded off the old `ZoomBuzz` identity, final logo shipped. Only the credentialed `vsce publish` is left for the user.

+ [X] rebrand publisher to NoteThink
  + root package.json: publisher/author → NoteThink, homepage → https://notethink.com
  + viewType `zoombuzz.notethink` → `notethink.notethink`; extension ID is now `NoteThink.notethink`
  + updated notethinkEditor.ts, both mocha suites, client/extension sub-package
  + repo/bugs URLs left at the real remote (github.com/zoombuzz/notethink) — GitHub org not renamed
+ [X] create NoteThink marketplace publisher
  + done by user; not the One Partner account used by other projects
+ [X] add placeholder extension icon
  + `media/icon.png` (256×256) wired via package.json `"icon"`
  + SVG source in docstech/design/logos/, multi-res renders gitignored
+ [X] commission the real logo
  + final mark in docstech/design/logos/notethink-icon.svg; `media/icon.png` re-rendered; drafts archived in variants/
+ [X] publish to marketplace
  + PAT provisioned, Marketplace > Manage scope
  + run `pnpm run publish:marketplace` — non-interactive, bridges the env var to VSCE_PAT, no `vsce login` prompt
+ manual: install the .vsix locally, exercise edge cases — special/unicode paths, 100+ markdown workspace perf, no devtools console errors
+ manual: after publishing, verify the listing renders — icon, README, repo/homepage links


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
  + [X] lib: globMatch.ts — minimal VS Code glob -> RegExp (** , * , ? , {a,b})
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
    notes; no extension round-trip — instant re-render on change)
  + scope: Folder/aggregate mode only; Current-file mode shows the whole file
  + `order` read from the file H1 linetag: `newest-at-top` (default / absent /
    unrecognised) keeps the first N, `newest-at-bottom` keeps the last N;
    document order preserved within the slice (no re-sort)
  + cap counts depth-3 stories the file contributes (incl. epic-nested), in
    document order
  + default cap = 10, persisted per-view in
    `display_options.aggregate_max_notes_per_file`
+ contract (both agents implement against this — no merging, shared copy)
  + `mergeAggregateRoot(docs, integration_path, max_notes_per_file?: number)`
    — new optional 3rd param; when undefined, no cap
  + display-options key `aggregate_max_notes_per_file?: number` on
    `NoteDisplayOptions` and `ViewProps`
  + `DEFAULT_AGGREGATE_MAX_NOTES_PER_FILE = 10` exported from
    AggregateTreeComposer.tsx alongside the existing DEFAULT_AGGREGATE_*
+ [X] docs/data: AUTHORING_GUIDE `order` key + Per-file-note-cap section;
      `done.md` root → `&order=newest-at-bottom`
+ [X] agent A — core: `order` read + per-file first/last-N trim in
      `mergeAggregateRoot.ts` (new `trimFileStories` helper, optional 3rd
      param); display-options key on `NoteProps.ts` + `ViewProps.ts`; +11
      `mergeAggregateRoot.test.ts` cases
+ [X] agent B — UI/wiring: "Max stories per file" numeric input in
      `FilesDrawer.tsx` (default 10, debounced, clamp floor 1); threaded via
      `GenericView.tsx` (persisted by setViewManagedState only — setIntegration
      NOT extended); `AggregateTreeComposer.tsx` resolves + passes the cap and
      exports `DEFAULT_AGGREGATE_MAX_NOTES_PER_FILE=10`; FilesDrawer +
      GenericView jest added
+ [X] coordinated: version 0.2.4 → 0.2.5; integrated gate green centrally —
      build, lint (eslint + 3× tsc), jest 604/604, playwright 42/42
+ [X] fix (review feedback): newest-at-bottom showed oldest-first in the
      column; `selectFileStories` now reverses the kept slice so the
      document-bottom (newest) story gets the smallest merged seq and sorts to
      the top — applies even uncapped; AUTHORING_GUIDE note corrected; tests
      updated + new uncapped-reversal case
+ [X] fix (review feedback): the merge-seq reversal had no effect because
      `kanbanNoteOrder`'s no-weight fallback sorted by `position.start.offset`
      (raw per-file document offset), not the merged seq. fallback now uses
      `seq` (the implicit ordering weight — already file-`order`-aware via
      mergeAggregateRoot; equal seqs tie-break on offset). single-file
      unaffected (seq == doc order). `noteops.test.ts` updated for seq fallback
+ [X] review (review feedback): drag-to-reorder weight write
      (`calculateTextChangesForOrdering` / KanbanView.dragEndHandler) — found
      correct, but it assumed seq-order display while the renderer used offset
      order (now reconciled by the seq fallback above); added end-to-end
      round-trip jest (drop top/bottom/middle → weights → kanbanNoteOrder holds
      the dropped order) which it previously lacked
+ [X] fix (review feedback): folder columns were blocky-by-file (all of
      project A, then all of B). mergeAggregateRoot now interleaves
      round-robin by per-file rank (flattened, epic-nested included) in stable
      relative_path order — rank-0 of every file, then rank-1, … shorter files
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
  + authors can pin with `ng_authoring_version` (`MAJOR` or `MAJOR.MINOR`) on
    the file root — reserved/documented now, not enforced (only 1.0.0 exists)
+ [X] AUTHORING_GUIDE: version banner + `## Versioning` section (patch/minor/
      major table, default-latest, locking) at `1.0.0`
+ [X] AUTHORING_GUIDE: `ng_authoring_version` added to the reserved
      View-configuration linetag table
+ doc-only change — no parser/behaviour change (version-conditional parsing is
  future work, to land with the first breaking major)


### Stop note headlines escaping the card on the right

Kanban card headlines containing a long unbreakable token (path, slug, identifier) punch past the card's right edge — wrap is currently scoped to inline `code` only. Apply the wrap to the whole headline/body, and add an `overflow: hidden` safety net on the kanban card so anything that still escapes is clipped by the rounded border.

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
+ [X] `makeNoteOrder(ctx)` / `makeKanbanNoteOrder(ctx)` — rank-gated relevance
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
      `column_order` didn't list it, so it couldn't be reordered —
      `SettingsKanbanDrawer` now shows the saved order then appends any live
      column (new status / untagged) not in it, matching the board's columns
+ [X] empty columns left over in a stale `column_order` (`done`,
      `code-review`) still rendered — `KanbanView` now shows only columns with
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
+ [X] ignore the event when the target is inside `anchor_el_ref.current` (current trigger) or inside the open drawer wrapper (looked up by id) — so the trigger's own onClick toggles cleanly and clicks inside the drawer don't dismiss
+ [X] no focus restore on outside-click (focus follows the pointer); Escape keeps the existing focus-restore behaviour
+ [X] Playwright coverage in `aggregate-folder.spec.ts` (folder mode exposes both drawers): outside-click closes Files drawer; clicking inside it does not; trigger click toggles cleanly
+ [X] Jest coverage in `GenericView.test.tsx`: outside `pointerdown` flips `data-open` to `false` for the Settings drawer; inside-drawer `pointerdown` leaves it open
+ manual: open Settings, click a note in the body — drawer closes; open Files, click a kanban card — drawer closes; open Settings, toggle a checkbox — drawer stays open


### Watch unopened files shown in the viewer

In single-file mode, change-handling is wired to `onDidChangeTextDocument` (`notethinkEditor.ts:306`) — fires only for editor-open documents. A file shown in the viewer but with no open text editor (custom editor + on-disk edit by another tool, e.g. Claude's Write) never re-parses. Folder mode already has its own `createFileSystemWatcher` (`notethinkEditor.ts:555`); single-file mode does not.

+ [X] add a `notethink.watchUnopenedFilesInViewer` boolean configuration to `package.json` `contributes.configuration` (default `true`); add the l10n string + 5 translations
+ [X] expose it as a checkbox in the Settings drawer (Document + Kanban) alongside the existing `show_line_numbers` global toggle
+ [X] when the setting is on, register a `vscode.workspace.createFileSystemWatcher` for the active viewed file whenever it isn't backed by an open `TextDocument`; on change/create, re-`buildDoc` and `sendDoc`
+ [X] dispose the per-file watcher on viewer dispose, on doc swap, and on setting flip (avoid leaks across active-doc changes)
+ [X] de-dupe with `onDidChangeTextDocument` — if the doc gets opened in an editor while the watcher is live, dispose the watcher to avoid double re-parse
+ [X] tests: Jest in `notethinkEditor.test.ts` covering watcher attach/detach lifecycle + setting flip; Playwright is N/A (no real fs in harness)
+ implementation notes
  + gate is "no visible text editor" rather than "no open TextDocument" — strictly equivalent given that VS Code only fires `onDidChangeTextDocument` for editors that are visible (the empirical bug the story documents)
  + the new setting is `scope: "window"` and written via `ConfigurationTarget.Global` — it's a per-user behavioural preference and follows the user across every workspace, unlike `showLineNumbers` (per-workspace)
  + dedupe via `onDidChangeVisibleTextEditors` instead of `onDidOpenTextDocument`/`onDidCloseTextDocument` — the visible-editor signal already covers both transitions and matches the gate
+ manual: open a `.md` in the viewer with no editor split, edit the file from a separate process (or Claude's Write), confirm the viewer re-renders within ~1s


### Bypass openTextDocument cache on watcher-driven re-parses

The 0.2.9 work added `active_file_watcher` for single-file mode and the existing folder-mode `integration_watcher` already covers aggregate views. Both call `vscode.workspace.openTextDocument(uri)` on change to re-parse the doc. **VS Code's TextDocument cache is not refreshed on external disk changes for files that aren't bound to a visible editor** — the watcher correctly fires `onDidChange`, but `openTextDocument` returns the stale cached doc and `document.getText()` yields stale text. The viewer posts the same content as before and the UI doesn't update. A window reload wipes the cache and the next read pulls fresh content — that's the symptom.

+ [X] factor out a `buildDocFromUriAndText(uri, text, createdBy)` helper from the existing `buildDoc(document)` so we can build a Doc from raw bytes without going through TextDocument
+ [X] in folder-mode `loadOne`, when called from the watcher's `onDidChange`/`onDidCreate`, read bytes via `vscode.workspace.fs.readFile(uri)` and feed them to `buildDocFromUriAndText` (initial discovery keeps `openTextDocument` so editor-buffer/unsaved content still wins on first load)
+ [X] in `active_file_watcher`'s `onChange`, do the same: `fs.readFile` → `buildDocFromUriAndText` instead of `openTextDocument` + `buildDoc`
+ [X] tests: the watcher tests should assert `fs.readFile` is called and the posted doc reflects the disk content (not whatever `openTextDocument` returns); add a folder-mode case for the same pattern in `loadOne`
+ manual: edit todo.md/done.md externally with notethink showing the kanban aggregate; the moved story should appear in its new column within ~1s without a window reload


### Origin-pill color collisions across projects

Aggregate view origin pills colour-code each story by its source file's first letter (project initial). Two pairs of projects observed to hash to the same colour: CalFam ("C") and Shopify Uncomplicated ("S") both render the same red; notegit ("N") and countingsheet ("C") both render the same green. The bucket is too small / the hash isn't spreading the input space — first-letter-only collapses many projects to ~26 inputs, and even those don't fan out evenly.

Investigation: the pill colour used `djb2(project_name) % 360`. The input was already the full project name, not the first letter — but `djb2 % 360` happens to alias for our real-world names. Empirically: calfam→hue 7, shopify-uncomplicated→hue 4 (3° apart); notegit→hue 87, countingsheet→hue 83 (4° apart). Tried FNV-1a, SHA-256, and hash×irrational multipliers — every hash function produces *some* close pair for our 8-project set because 8 random points on a 360-bucket ring are statistically prone to clustering. Only a sorted-index assignment with a golden-angle multiplier guarantees a minimum gap.

+ [X] `hueForProjectIndex(i)` returns `(i * 137.508) % 360` (golden angle) — adjacent indices land far apart on the wheel; deterministic per index
+ [X] `mergeAggregateRoot` enumerates distinct project names from `parsed` (already sorted by `relative_path`), assigns each its sorted-position hue via `hueForProjectIndex`, stamps `origin.project_hue` on every story
+ [X] `OriginPill` prefers `origin.project_hue` when present; falls back to the djb2 hash for single-file mode and legacy callers
+ [X] `pillColourForHue(hue, theme)` factored out so both paths share the final HSL build
+ [X] tests: index spread ≥30° pairwise for the workspace 8-project set; precomputed-hue path takes precedence over the hash; existing djb2 coverage retained for the fallback path
+ manual: open the workspace folder in aggregate mode and verify calfam/shopify-uncomplicated pills are now visually distinct, and notegit/countingsheet pills are too


