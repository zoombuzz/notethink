# Todo [](?ng_view=kanban&ng_child_status=backlog)


### view toolbar, breadcrumbs, and integration selector

+ goal
  + improve the top-of-view toolbar: breadcrumb context, smarter view selector, and a new ViewIntegrationSelector
  + currently breadcrumbs render inside DocumentContextBar/KanbanContextBar but are hidden when `show_context_bars` is off
  + the view type selector shows raw type names; when Auto is selected it should show the resolved view, e.g. "Auto (Kanban)"
  + introduce a ViewIntegrationSelector that controls what data the view displays (current file, directory, etc.)
  + kanban Untagged column should appear last, not first
+ architecture
  + BreadcrumbTrail already exists in `notethink-views/src/components/views/BreadcrumbTrail.tsx`
  + GenericView builds `breadcrumb_trail` and passes it via `nested.breadcrumb_trail`
  + DocumentContextBar and KanbanContextBar render `nested.breadcrumb_trail` + ViewTypeSelector
  + AutoView wraps GenericView and sets `data-auto-selected-viewtype` on a wrapper div
  + ViewTypeSelector is a `<select>` driven by `SELECTABLE_VIEWTYPES` from GenericView
  + KanbanView builds columns in `useMemo`; Untagged is hardcoded at `seq: 0` / first position
  + ExtensionReceiver manages viewStates and sends docs via postMessage
+ phase 1: kanban untagged column last
  + [X] move Untagged to the end of the default column order in KanbanView `useMemo`
    + change default sort: named columns alphabetically first, then Untagged at the end
    + when `custom_order` is set, respect user order (no change needed)
  + [X] update `visible_columns` filter: keep hiding empty Untagged, but now at end position
  + [X] update KanbanView tests for new column order
+ phase 2: always-visible breadcrumb bar
  + [X] extract breadcrumb + toolbar into a shared top bar rendered by GenericView itself
    + render `breadcrumb_trail` above the view type switch, outside the context bar toggle
    + ensures breadcrumbs are always visible regardless of `show_context_bars` setting
  + [ ] add file path breadcrumb segment
    + show the document file path (from `Doc.path`) as the root breadcrumb segment
    + clicking a directory segment in the path triggers ViewIntegrationSelector change (phase 4)
  + [ ] fix breadcrumb root to coincide with VSCode folder root
    + so should only show the first folder within that root
      + e.g. notethink > docstech > users > alex.stanhope > todo.md
      + not mnt > secure > home > alex > git > github.com > active_development > ...
    + match Markdown editor breadcrumb
      + increase breadcrumb font size
  + [X] style: breadcrumb bar should be compact, single-line, with overflow ellipsis
+ phase 3: auto view label in selector
  + [X] pass the auto-resolved view type up from AutoView to the toolbar
    + AutoView passes `derived_attributes.type` via `nested.auto_resolved_type`
  + [X] update ViewTypeSelector to display "Auto (Document)" / "Auto (Kanban)" when type is auto
    + only the display label changes; the `<option value="auto">` value stays the same
  + [X] add test: when auto resolves to kanban, selector shows "Auto (Kanban)"
+ phase 4: ViewIntegrationSelector
  + [X] create `ViewIntegrationSelector.tsx` in `notethink-views/src/components/views/`
    + `<select>` dropdown with options: "Current file" (default), "Directory"
    + rendered left of the breadcrumb in the top bar
    + fires a new message type or state update when changed
  + [X] "Current file" mode (default, existing behaviour)
    + shows the single file currently open in the editor
    + no changes to existing data flow
  + [X] "Directory" mode
    + extension sends all markdown files in the selected directory to the webview
    + webview renders them as a multi-doc view (similar to how NoteRenderer loops over `props.notes`)
    + `setIntegration` message sends directory path to extension
  + [ ] wire directory breadcrumb click to ViewIntegrationSelector
    + clicking a directory segment in the file path breadcrumb sets integration to "Directory"
    + requires file path breadcrumb segment (phase 2 remaining task)
  + [X] add extension handler for directory integration
    + `notethinkEditor.ts`: handle `setIntegration` message
    + use `vscode.workspace.findFiles` scoped to the requested directory
    + parse and send all matching docs to the webview
  + [X] add tests for ViewIntegrationSelector component
  + [ ] add test for directory breadcrumb click triggering integration change
+ verification
  + kanban Untagged column renders last in default order
  + breadcrumb always visible at top of view
  + auto view selector shows resolved type in parentheses
  + ViewIntegrationSelector defaults to "Current file"
  + clicking directory in breadcrumb switches to Directory mode and loads sibling docs
  + all existing tests still pass


### performance: large file rendering [](?status=reviewing)

+ problem
  + NoteThink UI is sluggish for big files (e.g. shopify-uncomplicated todo.md: 2761 lines, 274 headings)
  + full re-parse → full hierarchy conversion → full React re-render on every edit (after 250ms debounce)
+ profiled hotspots (ordered by estimated impact)
  1. `makePosition` linear scan: O(offset) per call, called ~3× per note
     + for 274 headings in a 100KB file: ~274 × 3 × 50K chars = ~41M char iterations
     + fix: pre-compute a line-offset index array in a single pass, then binary search
     + file: `convertMdastToNoteHierarchy.ts:18-24`
  2. `nestChildNotes` backward scan: O(n²) worst case for flat structures
     + 274 notes × backward scan = up to ~37K iterations
     + fix: maintain a stack of open ancestors, push/pop as sections open/close — O(n)
     + file: `convertMdastToNoteHierarchy.ts:214-234`
  3. full React re-render on every doc update
     + GenericNote wrapped in React.memo but props always new objects (display_options, handlers)
     + fix: stabilise prop references with useRef/useMemo in parent views; skip re-render when note content unchanged
     + files: `GenericView.tsx`, `DocumentView.tsx`, `KanbanView.tsx`
  4. `renderNodeUnified` per body item: mdast→hast→sanitize→jsx per non-note child
     + each call walks entire subtree; duplicated across re-renders
     + fix: memoize rendered JSX keyed on mdast node identity (reference equality or position hash)
     + file: `renderops.tsx:78-93`
  5. selection messages sent on every cursor move with no debounce
     + each triggers `findSelectedNotes` traversal in webview
     + fix: debounce selection updates (100-150ms) in extension
     + file: `notethinkEditor.ts:346-352`
  6. single webpack chunk (maxChunks: 1) loads mermaid + dnd for every file
     + fix: lazy-load mermaid (only needed for files containing mermaid blocks)
     + file: `webpack.config.js:150`
+ implementation phases
  + phase 1: algorithmic fixes (items 1-2) — biggest bang, no API changes
    + [X] pre-compute line-offset index in `convertMdastToNoteHierarchy`
    + [X] replace `nestChildNotes` backward scan with ancestor stack
    + [ ] add benchmark test: parse shopify-uncomplicated todo.md, assert < 50ms
  + phase 2: React rendering (items 3-4) — moderate effort
    + [X] stabilise display_options and handlers references in DocumentView
    + [X] memoize `renderNodeUnified` output keyed on node reference
    + [X] remove `renderToStaticMarkup` debugging call from renderops.tsx
    + [ ] add React profiler measurement in dev mode
  + phase 3: messaging and bundle (items 5-6) — polish
    + [X] debounce selection updates in notethinkEditor.ts
    + [ ] lazy-import mermaid behind dynamic import() (blocked by maxChunks: 1)
+ verification
  + open shopify-uncomplicated todo.md in VS Code dev host, confirm responsive scrolling and editing
  + run `pnpm run test-jest` — all tests pass
  + run `npx playwright test` — all tests pass


### kanban visual polish [](?status=reviewing)

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
