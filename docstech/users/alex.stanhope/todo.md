# Todo [](?ng_view=kanban&ng_child_status=backlog)


### Fix boundary flicker: typing at end of note causes view to flash blank [](?status=doing)

+ problem
  + typing at the end of the last line of a note (just before the invisible newline) causes the NoteThink view to flicker wildly — goes blank, then re-renders
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
    + `MarkdownNote` is not wrapped in `React.memo` — every parent re-render cascades to all children
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
  + [ ] consider incremental MDAST updates instead of full re-parse (deferred — requires major architectural change)
+ verification
  + place caret at the end of the last line of a note, type rapidly — view should update smoothly without blanking
  + place caret at the end of a mid-document note, type — same smooth behaviour
  + move caret between notes — focus highlighting should still work correctly
  + abridged notes should still expand/collapse correctly
  + all existing tests still pass (404 tests)


### Cursor positioning: editor caret position to NoteThink view [](?status=doing)

+ goal
  + good synchronisation between editor and NoteThink view
+ shared foundation: position-aware body items
  + [X] add `data-offset-start` and `data-offset-end` attributes to rendered body items
  + [X] add `findBodyItemElement()` utility in `noteops.ts` (6 unit tests)
  + [X] extract shared `renderBodyItems` from MarkdownNote into `renderops.tsx`; used by both MarkdownNote and GenericNoteWrapper
+ phase 1: sub-note scroll in DocumentView and KanbanView
  + [X] `useScrollToCaret` hook in `viewhooks.ts` — shared by DocumentView and KanbanView
  + [X] removed broken `noteIsVisible` guard (view element is not a scroll container)
  + [X] fixed `GenericNoteWrapper` not setting DOM `id` or propagating `display_options` to child notes
  + [X] headline caret falls back to note-level scroll
+ phase 2: smooth scroll and abridged notes
  + [X] abridged notes auto-expand on focus
  + [ ] consider debouncing sub-note scroll separately from note-level scroll if rapid cursor movement causes jitter
+ phase 3: virtual caret indicator
  + [X] `.caretTarget` CSS class with `::after` overlay and `@keyframes caretPulse` animation (fade pulse using `--mantine-primary-color-2`)
  + [X] `useCaretIndicator` hook in `viewhooks.ts` — shared by DocumentView and KanbanView
    + prefers body item, falls back to headline element (`[role="rowheader"]`), then note element
    + if target is already visible, flashes immediately
    + if scroll is needed, waits for `scrollend` + 150ms settle; 1000ms fallback
  + [X] 4 unit tests (body item flash, caret move, headline fallback, cleanup)
  + [X] added `data-offset-start`/`data-offset-end` to headline div in MarkdownNote — `findBodyItemElement` now finds headlines directly instead of relying on querySelector fallback
+ other improvements
  + [X] `Debug.enable('nodejs:*')` in dev mode (webview iframe has separate localStorage)
  + [X] fixed `noteIsVisible` partial-visibility check (was always returning "visible")
+ verification
  + open a long note in VS Code
  + move caret to the bottom of the note — NoteThink view should scroll to show that section
  + move caret to headline — view should show the top of the note
  + abridged note should expand then scroll when caret enters a lower section
  + caret pulse visible on body items and headlines when moving through a note
  + all existing tests still pass (401 tests)


### Cursor positioning: Notethink view to editor caret position

+ goal
  + clicking in the NoteThink view should jump the editor caret to the precise position within the note, not just the note start
  + currently `bodyClickPosition` returns `note.position.end.offset` (headline end) as `from`, so clicking anywhere in the body sends the caret to the same position
  + need to map the click target back to the corresponding MDAST offset
+ architecture
  + `createNoteClickHandler` in `noteui.ts` builds an onClick that calls `note.handlers.click(event, note, position)`
  + `GenericView.handlers.click` sends a `revealRange` message with `{from, to}` offsets to the extension
  + extension calls `editor.revealRange` to move the caret
  + the click event's `target` is a DOM element rendered by `renderNodeUnified` (e.g. `<p>`, `<li>`, `<code>`)
  + these elements currently have no offset data — need the `data-offset-start`/`data-offset-end` attributes from the shared foundation
+ depends on
  + shared foundation from "editor caret → NoteThink view" story (position-aware body items)
+ phase 1: offset-aware click handler
  + [ ] update `createNoteClickHandler` (or add a new handler) to extract offset from click target
    + walk up from `event.target` to find the nearest ancestor with `data-offset-start`
    + if found, use that offset as `from` in the `revealRange` message
    + if not found (e.g. click on headline or gap between items), fall back to current behaviour
  + [ ] update `bodyClickPosition` to accept an optional `offset` override
    + when the click handler finds a `data-offset-start`, pass it through as `from`
  + [ ] add tests: clicking a body item with `data-offset-start=150` sends `revealRange` with `from: 150`
+ phase 2: fine-grained position within body items
  + [ ] for text-heavy elements (paragraphs, list items), use `window.getSelection()` to approximate character offset within the element
    + get the selection range from the click
    + count characters from the element start to the selection point
    + add that to `data-offset-start` for a more precise offset
  + [ ] handle inline elements (bold, italic, links) that nest within a paragraph
    + the `data-offset-start` is on the paragraph wrapper, not the inline span
    + character counting needs to walk the text nodes within the element
  + [ ] add tests: clicking in the middle of a paragraph sends an offset that corresponds to that character position
+ phase 3: double-click selection sync
  + [ ] when double-clicking a word in the NoteThink view, send a `selectRange` message (not `revealRange`)
    + use `data-offset-start` + character offset to compute `from` and `to` for the word
    + this selects the corresponding text in the editor
  + [ ] add test: double-click on a word sends `selectRange` with correct `from`/`to` offsets
+ verification
  + click on a specific paragraph in a multi-paragraph note — editor caret should jump to that paragraph
  + click on a list item deep in a note — caret should land at that list item
  + click on headline — caret should go to note start (existing behaviour preserved)
  + double-click a word — editor should select that word
  + all existing tests still pass


### Display what's next for each story

+ when displaying tasks in a story
  + we ideally want to show what's next
    + with some hint of what's just happened (and a Show more) button to see it
  + what's next is defined by the next task
+ if a story has no tasks
  + show it from the top
+ if a story only has incomplete tasks
  + show it from the first incomplete task
+ if a story has many completed tasks and some incomplete ones
  + show it from the first incomplete task


### Insert modal

+ goal
  + notegit has a searchable insert modal (~367 lines) with 40+ templates
  + quick way to insert headings, linetags, mermaid diagrams, tables, code blocks
  + this replaces typing boilerplate markdown manually
+ [ ] implement InsertModal component in notethink-views
  + searchable list of insert templates
  + preview of what will be inserted
  + fires postMessage({type: 'editText', changes}) to insert at cursor position
+ [ ] port insert template definitions from notegit
  + start with English templates; i18n can come later
  + categories: basic (heading, paragraph, list, link, image), metadata (linetag), diagram (mermaid), structure (table, code block)
+ [ ] wire insert modal trigger
  + menu bar button and/or keyboard shortcut (Ctrl+I or similar)


### Settings modals

+ goal
  + notegit has per-view settings modals for display preferences
  + NoteThink needs at least kanban settings and global display settings
+ [ ] implement kanban settings modal
  + port from notegit's SettingsKanbanModal (~61 lines)
  + column definitions (add/remove/reorder columns)
  + scroll-note-into-view toggle
  + show-linetags-in-headlines toggle
+ [ ] implement global settings modal
  + port from notegit's GlobalSettingsModal (~80 lines)
  + theme preference, default view type, line numbers


### Test engines.vscode lower bound against vscode-web and VS Code desktop

+ `engines.vscode` was lowered from `^1.109.0` to `^1.91.1` for dulcet compatibility
  + `vscode-web` npm package tops out at 1.91.1 — NoteThink must be compatible with it
  + VS Code desktop is currently ~1.96+ — the `^1.91.1` range covers both
+ risk: NoteThink may use VS Code APIs introduced after 1.91
  + quick audit found only standard APIs (commands, window, workspace, Uri)
  + `window.tabGroups` (introduced 1.77) used only in test code
  + but a deeper audit is needed to be certain
+ [ ] test NoteThink in dulcet (vscode-web 1.91.1)
  + install `@zoombuzz/notethink` in dulcet, load in browser
  + verify: extension activates, Auto/Document/Kanban views render, keyboard nav works
  + verify: no "Extension is not compatible" errors in console
+ [ ] test NoteThink in VS Code desktop (latest stable)
  + install via `code --install-extension notethink-0.x.x.vsix`
  + verify: all existing functionality works (views, editing, drag-drop, theme sync)
+ [X] audit VS Code API usage against 1.91 API surface
  + all APIs available since 1.40 or earlier, except `createOutputChannel({ log: true })` (1.74)
  + no APIs introduced after 1.91 — fully compatible
+ if issues found, raise `engines.vscode` to the minimum version that works for both hosts


### Publish NoteThink 0.1.0 to marketplace (requires manual work)

+ [ ] create extension icon
  + 128x128 or 256x256 PNG in `media/icon.png`
  + needs to be visually clear at small sizes in the marketplace sidebar
  + once created, add `"icon": "media/icon.png"` to root package.json
+ [ ] create ZoomBuzz publisher account
  + register at marketplace.visualstudio.com
+ [ ] test against edge cases before release
  + install the .vsix locally (`code --install-extension notethink-0.1.0.vsix`)
  + empty markdown file
  + very large markdown file (1000+ lines)
  + markdown with frontmatter (already parsed via mdast-util-frontmatter)
  + markdown with GFM tables, strikethrough, footnotes
  + file with unicode characters and special paths
  + workspace with 100+ markdown files (performance check)
  + verify no console errors in developer tools
+ [ ] publish to marketplace
  + `vsce publish 0.1.0`
  + verify listing appears correctly


### Multi-view management [post-v1]

+ goal
  + notegit supports split views (parent_view/child_views), view hierarchy, and a ViewManager
  + NoteThink currently has a single GenericView entry point per document
  + multi-view would allow side-by-side document+kanban or document+mermaid
+ [ ] implement ViewManager component
  + manages array of ViewProps with unique IDs
  + handles setViewManagedState, deleteViewFromManagedState, revertAllViewsToDefaultState
  + stores view state in webview state API
+ [ ] implement split view UI
  + allow adding a child view alongside the current view
  + drag handle or button to resize split
+ [ ] wire parent_view/child_views relationships
  + child views inherit display_options from parent
  + breadcrumb navigation affects the correct view in the hierarchy


### Convert top-level 'docs' container to RootNote [post-v1]

+ goal
  + should be possible to render any MDAST node
    + including one that contains a bunch of files
  + will eventually have dynamic collections
+ depends on notethink-views being wired in (done)
  + RootNote would be a ViewProps with child_views per document
+ [ ] define RootNote as a synthetic MDAST-like node in the extension
  + type: 'root', children: array of document MdastRoot nodes
  + send as single structure instead of flat HashMap
+ [ ] render RootNote via DocumentView with child_views
  + each child_view represents one document
  + parent_context and breadcrumb_trail for navigation


### Optimisation cycle [post-v1]

+ create language server
  + communicate to separate thread via LSP
    + add to webpack watch
  + investigated previously, deferred as non-essential for now
  + revisit once delta computation works
+ consider whether parsing (mdast-util-from-markdown) is the bottleneck
  + or whether it's the React re-rendering
  + profile before optimising
