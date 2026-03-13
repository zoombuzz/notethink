# Done [](?ng_view=kanban)


### child attribute inheritance

+ [X] add `inherited?: true` flag to LineTag interface in `notethink-views/src/types/NoteProps.ts`
+ [X] add `applyChildAttributeInheritance(allNotes)` in `convertMdastToNoteHierarchy.ts`
  + ng_child_ → direct children, ng_child2y_ → grandchildren, ng_childall_ → all descendants
  + child's own linetags always win (no override)
+ [X] guard edit operations against inherited linetags in `linetagops.ts`
  + drag-drop on inherited-status notes writes a real linetag into markdown
+ [X] distinguish inherited attributes in `GenericNoteAttributes.tsx` (lighter opacity, italic)
+ [X] unit tests: 8 new tests in `convertMdastToNoteHierarchy.test.ts`


### theme tweaks

+ [X] make border clearer in dark themes
  + dark-mode override in `ViewRenderer.module.scss` using `--vscode-editorWidget-border`
+ [X] style checkboxes to match theme
  + `accent-color: var(--mantine-primary-color-2)` on checkbox input


## Breadcrumb accessibility

BreadcrumbTrail uses clickable `<div>` elements with onClick handlers. These are not
keyboard-accessible and have no ARIA roles. Convert to `<button>` elements so screen
readers and keyboard users can navigate the breadcrumb trail.

- [X] Convert breadcrumb clickable divs to `<button>` in `BreadcrumbTrail.tsx`
- [X] Reset default button styles to match current visual appearance
- [X] Ensure Enter/Space triggers navigation (native button behaviour)
- [X] Add `aria-label` to breadcrumb items (note headline text)
- [X] Add unit test: breadcrumb buttons are keyboard-focusable and have correct ARIA


## Validate incoming messages in ExtensionReceiver

ExtensionReceiver blindly destructures incoming messages from the extension. A malformed
message (missing `type`, missing `partial.docs`, wrong shape) could silently corrupt
state or throw. Add runtime validation at the message boundary.

- [X] Add type guard / validation for incoming messages in `ExtensionReceiver.tsx` onMessage handler
- [X] Validate `message.type` exists and is a known type before switching
- [X] Validate `message.partial.docs` structure for `update` messages
- [X] Validate `message.selection` structure for `selectionChanged` messages
- [X] Log and discard invalid messages (don't throw, don't corrupt state)
- [X] Add unit tests: malformed messages are discarded without crashing


## CHANGELOG for 0.1.1

Document user-facing changes from this session.

- [X] Add 0.1.1 entry to CHANGELOG.md covering: second-click blank view fix, kanban drag no longer spawns new editor, dragging to Untagged removes status tag instead of writing literal "untagged", sass deprecation warning fixed


## Progressive document loading on startup

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


## E2E test for kanban drag-and-drop

The kanban drag-and-drop flow (drag card between columns, reorder within column) has
unit tests but no playwright E2E coverage for the full interaction.

- [X] Add playwright spec: drag a card from one kanban column to another
- [X] Assert: `editText` message sent with status tag change
- [X] Simulate extension responding with updated doc (re-parsed MDAST with new linetag)
- [X] Assert: card appears in the destination column after re-render
- [X] Assert: card no longer appears in the source column


## Error boundary for view crash recovery

When a malformed markdown file or unexpected data causes a React component to throw,
the entire NoteThink webview goes blank with no feedback. Add a React error boundary
that catches render errors and shows a fallback UI with a user-friendly message plus
expandable error details (standard VS Code extension pattern).

- [X] Create ErrorBoundary component in `client/webview/src/notethink-views/src/components/`
- [X] Fallback shows: friendly message, file path, expandable stack trace / error details
- [X] Wrap NoteRenderer children (GenericView / AutoView / DocumentView / KanbanView)
- [X] Add unit test: component that throws renders fallback instead of blanking
- [X] Add playwright E2E test: inject malformed MDAST, verify fallback appears (view doesn't blank)


## Extension-side unit tests (mocked vscode)

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


## fix critical rendering gaps

+ [X] strip linetag text from rendered headlines
  + renderops.tsx: added `strip_linetags` render option that filters MDAST children by position offset using `linetags_from`
  + MarkdownNote.tsx: switched from `first_child_only` to `strip_linetags`, preserving inline formatting (bold, links) before the linetag
  + the linetag text is hidden from the headline; GenericNoteAttributes renders it as badges
+ [X] uncomment and wire notes_within_parent_context rendering in DocumentView
  + not needed — child notes already render correctly via recursive `MarkdownNote.children_body` → `GenericNote` rendering
  + notegit has the same line commented out; this is not a bug


## dynamic kanban columns

+ [X] derive column definitions from notes' status linetag values
  + KanbanView columns replaced from useState with useMemo deriving from notes_within_parent_context
  + scans notes for unique status linetag values, always includes 'untagged' as first pseudo-column
  + columns sorted alphabetically; dynamic — appear/disappear as notes change


## view menu and toolbar

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


## theme integration (partial)

+ [X] detect VS Code theme kind and apply to webview
  + inline script in notethinkEditor.ts reads body.vscode-dark/vscode-high-contrast
  + sets data-mantine-color-scheme on <html> for dark-mode SCSS selector
  + MutationObserver syncs attribute on live theme changes
+ [X] CSS variable bridge (vscode-mantine-bridge.css)
  + maps 7 --mantine-* variables to --vscode-* equivalents
  + ViewRenderer.module.scss works unchanged in both NoteGit and NoteThink
  + index.css uses --vscode-font-family, --vscode-editor-foreground, --vscode-editor-background


## keyboard shortcuts for view navigation

+ [X] implement keyboard handler in GenericView
  + navigation callback registered via onNavigationCommand ref on ViewApi
  + Escape: clearFocus — calls getClearHandler to move caret past focused note
  + Up/Down: navigate between sibling notes via setCaretPosition
  + Enter: drillIn — calls setParentContextSeq on focused note with children
  + Backspace: drillOut — navigates to grandparent or root
+ [X] register VS Code keybindings for NoteThink-specific commands
  + keybindings declared in package.json with `when: "activeCustomEditorId == 'zoombuzz.notethink'"`
  + escape, up, down, enter, backspace bound to navigation commands
  + extension.ts registers all 10 commands relaying to active webview panel


## bootstrap compiled typescript client

+ [X] fix restart bug
+ [X] re-base extension on webpack
+ [X] investigate LSP
+ [X] understand how Markdown Language Service works
+ [X] look at LSP sample
+ [X] modify webpack config to bundle a second set of files
+ [X] setup `tasks.json`
+ [X] get extension running


## continue dev setup

+ [X] chase down log entries
+ [X] mark index.tsx HTML as only being used for testing


## get document data flowing

+ [X] replicate using extension samples


## wire notethink-views into rendering pipeline

+ [X] build MDAST-to-NoteProps transformer
+ [X] replace NoteRenderer internals
+ [X] notethink-views consumed directly by webpack


## get a first basic release of NoteThink extension out

+ [X] fix client/extension/package.json metadata
+ [X] add marketplace metadata to root package.json
+ [X] update CHANGELOG.md for 0.1.0
+ [X] update README.md for public consumption
+ [X] review .vscodeignore for production packaging
+ [X] verify the production build pipeline


## bring notethink up to active-dev standard

+ [X] migrate from npm to pnpm
+ [X] replace `console.warn` with `debug` library
+ [X] replace `any` types with explicit types
+ [X] review and clean up dist/ files in git status
+ [X] add test scripts and get all tests passing
+ [X] harden extension security and reliability
+ [X] fix CI pipeline
+ [X] commit untracked files on bootstrap branch


## work on DX

+ [X] test with reference sample to see if it's broadly doable
+ [X] fix access: can't inspect HTML
+ [X] fix missing sourcemap


## compute delta on `partial` in ExtensionReceiver

+ [X] use hash_sha256 on doc content for change detection
+ [X] add React.memo to DocumentView and GenericNote


## port notegit features into NoteThink (phases 1-5)

+ [X] phase 1: linetag parsing and display
+ [X] phase 2: extension-webview message protocol
+ [X] phase 3: GenericView, focus/selection, BreadcrumbTrail, AutoView
+ [X] phase 4: KanbanView with drag-and-drop
+ [X] phase 5: mermaid diagrams
+ [X] coding standards audit and fixes
+ [X] comprehensive test suite


## CSS variable bridge and click/selection fix

+ [X] CSS variable bridge (vscode-mantine-bridge.css)
+ [X] fix click/selection flow


### install notethink-dev to get using it all the time

+ symlink
  + `ln -s /mnt/secure/home/alex/git/github.com/active_development/notethink ~/.vscode/extensions/notethink-dev`
+ can remove that once we've got a deployed version out
+ goal is to establish what I use this for
  + how useful is it
  + what features do I rely on
+ no point launching a product that I do not value myself


### dynamic kanban columns

+ goal
  + kanban columns are hardcoded to untagged/backlog/doing/done
  + notegit derives columns from the linetags present in the document
  + users should be able to define columns via linetags or settings
+ [X] derive column definitions from notes' status linetag values
  + KanbanView columns replaced from useState with useMemo deriving from notes_within_parent_context
  + scans notes for unique status linetag values, always includes 'untagged' as first pseudo-column
  + columns sorted alphabetically; dynamic — appear/disappear as notes change
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


### view state persistence

+ goal
  + when the webview reloads (e.g. tab switch), view state is lost
  + notegit persists view state in LocalStorage; NoteThink should use VS Code's webview state API
+ [X] persist view type and parent_context_seq via vscode.getState/setState
  + save on setViewManagedState calls
  + restore on webview init in ExtensionReceiver
+ [X] persist kanban column scroll positions


### view selector

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


### theme integration

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


### kanban visual polish

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


### height-based abridging

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


