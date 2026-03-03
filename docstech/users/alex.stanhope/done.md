# Done


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
