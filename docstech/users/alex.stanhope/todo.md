# Todo [](?ng_view=kanban)


### Relevance ordering: bump active-file stories within equal rank [](?status=code-review)

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


### Kanban: reorderable new columns + hide empty columns [](?status=code-review)

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
