# Todo [](?ng_view=kanban&ng_child_status=backlog)


### cursor positioning: editor caret position to NoteThink view

+ goal
  + when the editor caret is inside a long note, scroll the NoteThink view to show the relevant part
  + currently `DocumentView` scrolls the focused note element into view, but for long notes the caret may be at the bottom while only the top is visible
  + need sub-note scroll precision: scroll the specific body item (paragraph, list, etc.) that contains the caret
+ architecture
  + `selectionChanged` message from extension carries `{head, anchor}` offsets (debounced 120ms)
  + `GenericView` calls `findDeepestNote(notes, head)` to determine the focused note
  + `DocumentView.useEffect` scrolls the focused note element via `scrollIntoView`
  + body items are MDAST nodes with `position.start.offset` / `position.end.offset` but these offsets are not exposed in the DOM
  + `renderNodeUnified` in `renderops.tsx` converts MDAST → HAST → JSX but does not attach position data attributes
  + `MarkdownNote.renderBodyItems` wraps each rendered body item in a `<Fragment>` with no DOM element to attach attributes to
+ shared foundation: position-aware body items
  + [X] add `data-offset-start` and `data-offset-end` attributes to rendered body items
    + `MarkdownNote.renderBodyItems`: replaced bare `<Fragment>` with `<div data-offset-start data-offset-end>` for MDAST nodes
    + child notes already have position data via their note element; no change needed
  + [X] add `findBodyItemElement()` utility in `noteops.ts`
    + queries `[data-offset-start]` elements within a note, returns the one whose range contains the caret
    + 6 unit tests: range matching, boundaries, empty container, out-of-range
+ phase 1: sub-note scroll in DocumentView and KanbanView
  + [X] update `DocumentView.useEffect` scroll logic
    + after finding focused note, calls `findBodyItemElement(note_element, caret_offset)`
    + scrolls body item into view if found; falls back to note-level scroll
    + added `props.selection?.main.head` to dependency array
  + [X] update `KanbanView.useEffect` scroll logic (same pattern)
  + [X] headline caret handled automatically: `findBodyItemElement` returns undefined → falls back to note scroll
+ phase 2: smooth scroll and abridged notes
  + [X] abridged notes auto-expand on focus: existing `should_clip = !props.focused && overflow_state.overflows`
    + expansion completes before scroll because React renders synchronously and useEffect runs after paint
  + [ ] consider debouncing sub-note scroll separately from note-level scroll if rapid cursor movement causes jitter
+ verification
  + open a long note (e.g. todo.md performance story) in VS Code
  + move caret to the bottom of the note — NoteThink view should scroll to show that section
  + move caret to headline — view should show the top of the note
  + abridged note should expand then scroll when caret enters a lower section
  + all existing tests still pass


### cursor positioning: Notethink view to editor caret position

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


### insert modal

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


### settings modals

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


### publish NoteThink 0.1.0 to marketplace (requires manual work)

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


### multi-view management [post-v1]

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


### convert top-level 'docs' container to RootNote [post-v1]

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


### optimisation cycle [post-v1]

+ create language server
  + communicate to separate thread via LSP
    + add to webpack watch
  + investigated previously, deferred as non-essential for now
  + revisit once delta computation works
+ consider whether parsing (mdast-util-from-markdown) is the bottleneck
  + or whether it's the React re-rendering
  + profile before optimising
