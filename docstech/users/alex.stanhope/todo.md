# Todo [](?nt_view=kanban)


### Auto integration mode follows live edits like nt_view [](?id=auto-integration-follows-content)

`nt_integration_mode` and `nt_breadcrumb_last` must auto-resolve the **same reactive way** `nt_view` does. Editing the `nt_view` linetag in the editor updates the rendered view live; editing `nt_integration_mode` / `nt_breadcrumb_last` — or switching the active editor to a file with a different declaration — must update the viewer's integration mode the same way. Today it does not: once the viewer auto-enters folder mode it is sticky, so switching from a folder-declaring file back to a plain document file leaves the Kanban aggregate on screen instead of dropping to the document render.

+ motivating repro (notegit welcome content)
  + open `portfolio/mobile-app.md` (H1 `?nt_integration_mode=folder&nt_breadcrumb_last=portfolio`) → viewer correctly auto-enters folder mode, 3-column board aggregated across `portfolio/`
  + switch the active editor back to `intro.md` (bare `# Welcome to NoteGit`, declares current_file) → viewer SHOULD drop to the document render of intro.md; instead it stays stuck on the portfolio board (the reported bug — screenshot 2026-06-19)
  + same failure for `project-board.md` (`?nt_view=kanban`, no integration tag → current_file) and any other non-portfolio file
+ reference architecture — how auto VIEW TYPE works (the model to copy)
  + `AutoView.tsx` is a **pure render-time derivation**: when the selection is `auto`, it reads the file's `nt_view` from the CURRENT content every render (`resolveNamespacedTag(attributes,'view')` / `majorityNgView(props.notes)`) and delegates to `GenericView` with the derived concrete type — no persisted state, no dispatch, no once-per-doc guard
  + reactivity is free: edit `nt_view` → extension re-parses + re-sends the doc → webview `docs` state updates → React re-renders → `AutoView` re-derives → new type. The same chain fires on an active-file switch (new doc becomes most-recent / active)
  + selection/resolved split: persisted selection (may be `auto`) drives the dropdown value (`ViewTypeSelector`, "Auto (Kanban)"); the resolved concrete type is what renders (`replaced_attributes` = selection, `derived_attributes` = resolved). A concrete pick pins; `auto` keeps following the file
  + file-level read primitive: `mergeAggregateRoot.ts:281-293` reads `file_view_type` (H1 `nt_view` over front-matter, most-specific wins)
+ root cause — how auto INTEGRATION MODE diverges from that model
  + `useAutoIntegration.ts` is an **imperative one-shot effect**, not a derivation: behind a once-per-doc-identity guard (`resolved_for_ref`, keyed `id:hash`) it DISPATCHES `setIntegration` and WRITES persisted `integration_path` into `FOLDER_VIEW_STATE_ID`
  + it is **one-directional**: the only branches ENTER folder mode (`decl.mode === folder`) or seed `parent_context_seq`. There is no branch that exits folder mode when the opened file resolves to current_file (`useAutoIntegration.ts:57-96`)
  + the renderer reads the concrete mode from **persisted view-state**, not live content: `NoteRenderer.tsx:78` → `anyViewInFolderMode(props.viewStates)` → `resolveIntegrationMode` (`auto` + a seeded `integration_path` resolves folder, `viewstateops.ts:45`). So the board stays until something rewrites that persisted state
  + net: editing the linetag away / switching files re-runs the effect (hash or active path changed) but it has nothing to do in the exit direction — the opposite of `AutoView`, which simply re-derives
+ the one necessary asymmetry (call out, don't ignore)
  + auto view type is a pure webview rendering choice over the SAME data; integration mode changes WHAT DATA the extension loads — folder discovery + watchers + the aggregated docs map, via the `setIntegration` round-trip (`PanelSession.handleSetIntegration` → `enterFolderMode` / `enterCurrentFileMode`)
  + so it cannot be a purely render-time function; the faithful port is two layers:
    + (1) **derive** the target mode + path reactively from the active file's current declaration when the selection is `auto` (mirrors `AutoView` reading `nt_view` every render) — `resolveFileIntegrationDeclaration` is the existing derivation primitive
    + (2) an **idempotent reconcile effect** that fires `setIntegration` and syncs the persisted `integration_path` only when the derived target diverges from what the extension currently has — keyed on the derived target (mode+path), NOT a once-per-doc guard
+ the existing manual equivalent already does the right thing — reuse it
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
  + `client/webview/src/hooks/useAutoIntegration.ts` — re-architect: reactive derive + idempotent reconcile; drop the once-per-doc-only-enter guard
  + `client/webview/src/notethink-views/src/lib/viewstateops.ts` — extract the shared auto-reset builder; keep `resolveIntegrationMode` / `reconcileAutoIntegrationMode` as the selection/resolved split
  + `client/webview/src/notethink-views/src/components/views/generic/useViewToolbar.ts` — route `handle_integration_change('auto')` through the shared builder
  + `client/webview/src/lib/docops.ts` — `resolveFileIntegrationDeclaration` stays the derivation primitive (already mirrors `mergeAggregateRoot`'s `file_view_type` read)
  + `client/webview/src/components/NoteRenderer.tsx` — confirm the render decision tracks the reactively-derived mode (no stale persisted-only read)
  + `client/extension/src/vscode/PanelSession.ts` — confirm no change needed (the `setIntegration current_file` teardown + folder re-discovery already exist)
+ [ ] resolve the two open design decisions and record them here
+ [ ] extract the shared auto-reset builder; route the toolbar `handle_integration_change('auto')` through it
+ [ ] re-architect `useAutoIntegration` to derive-then-reconcile (bidirectional, keyed on derived target, gated on outside-integration_path for the exit)
+ [ ] preserve concrete-pin immunity (no auto change when selection is folder / current_file)
+ [ ] jest: editor switch folder→current_file exits; linetag removal exits; linetag add enters; member-file-inside-path stays folder; concrete pins untouched
+ [ ] jest: folderA→folderB behaviour per the decision above
+ [ ] playwright (welcome front door): open mobile-app.md → board; switch to intro.md → document render; live-edit a linetag flips the mode
+ relationship — independent of [[single-file-kanban-story-descent]] (that story is WHAT renders inside single-file kanban; this is WHEN the integration mode flips); both touch the same portfolio demo files


### Single-file kanban descends to ### stories under ## epics [](?id=single-file-kanban-story-descent)

In current_file (single-file) mode the kanban renders the *direct children of the scope heading* as cards. For a nested doc (`#` → `##` epics → `###` stories) those children are the `##` epics, so the board shows epic cards (e.g. "Storefront", "Design system") sitting in one untagged column instead of the `###` stories partitioned by status. The `###`-as-card / `##`-as-epic transform exists only in folder mode (`mergeAggregateRoot.ts`); single-file mode never had it. Bring that transform to current_file mode so a nested file opened on its own renders its stories as cards, each tagged with its epic.

+ background — root cause
  + `useViewContext.ts:74` sets `notes_within_parent_context = parent_context.child_notes`, and `KanbanView` renders those as cards, so the card level is always exactly one below the scope heading
  + AutoView scopes to the `nt_view`-declaring note (the `#` H1), so a nested file's cards come out as its `##` epics
  + the depth-3-stories / `##`-epics flatten lives only in `mergeAggregateRoot.ts` (folder mode), added in `bf25cc2` (0.1.59)
  + the single-file composer (`NoteTreeComposer`) only runs `convertMdastToNoteHierarchy` + `stampSingleFileStableIds` — the latter stamps `stable_id`s but does not restructure the tree
  + not a refactor regression — `KanbanView` rendered `notes_within_parent_context` both before and after the `cd4fcb4` decomposition; single-file descent was never implemented
  + `parent_context_seq` (seeded by `nt_breadcrumb_last`) only scopes into ONE subtree, so it cannot gather `###` stories across multiple `##` epics
  + `AUTHORING_GUIDE.md` documents `###` as "the unit that becomes a Kanban card" universally, so the guide's own nested example mis-renders in single-file mode today
+ demonstrating files (notegit welcome content)
  + `web-store.md`, `platform-infra.md`, `project-board.md` — nested, no folder trigger, so they show `##` epics as cards
  + `mobile-app.md` — same shape but carries `nt_breadcrumb_last=portfolio`, which resolves to a folder segment and flips it into folder mode, so it renders correctly; this contrast is what makes the bug look like a regression
  + a notegit-side content stopgap (out of scope for this story) is to add `nt_breadcrumb_last=portfolio` to the other portfolio files, but that shows the merged 3-file board, not the opened file's own stories, and does not fix standalone nested files
+ desired behaviour
  + a nested single file in kanban view shows its `###` stories as cards, partitioned into status columns
  + each card is tagged with its `##` epic (structural), with explicit `epic=` linetags overriding (direct > inherited > structural), matching folder mode
  + flat files (`##` stories directly under `#`, no epic layer) keep rendering `##` as cards unchanged
  + mixed shapes (some `###` directly under `#`, some under `##`) collect both, mirroring `mergeAggregateRoot`'s `walk_children` pass
+ approach
  + give current_file mode the same transform folder mode has: when the scope heading's children are `##` epics containing `###` stories, descend and present the `###` stories as the rendered note set
  + reuse the folder-mode machinery over a single doc where possible — the epic registry (`file_epic_by_id` / `file_epic_by_name`), structural `origin.epic`, and `walkStorySubtree` already exist in `mergeAggregateRoot.ts`
  + stamp a minimal `origin.epic` (epic chip only; single-file notes carry no project, so `OriginPill` should render the epic without a project pill)
+ open questions / decisions
  + where to run the transform (single-file composer vs a gated branch in `useViewContext`) so folder mode is never double-flattened
  + whether descent is automatic (detect an epic layer) or opt-in — automatic preserves the documented `###`-is-a-card contract with no authoring change
  + how drag-drop status + ordering rewrites route back to the one doc when cards are `###` under `##` (folder mode partitions by docPath; single-file has one doc, so the existing single-file editText path should apply — verify offsets)
  + interaction with `parent_context_seq` / `nt_breadcrumb_last` scoping into a single epic (should still work, narrowing to that epic's stories)
+ [ ] reproduce: open a nested single file (e.g. `project-board.md`) in kanban, confirm `##` epics render as cards
+ [ ] decide and document the transform seam (composer vs `useViewContext`)
+ [ ] implement single-file `###`-story flatten with structural `##`-epic tagging, reusing `mergeAggregateRoot` machinery
+ [ ] resolve explicit `epic=` overrides (direct > inherited > structural) in single-file mode
+ [ ] render the epic chip via `OriginPill` without a project pill in single-file mode
+ [ ] preserve flat-file behaviour (no epic layer → `##` cards unchanged)
+ [ ] verify drag-drop status + ordering rewrites land correctly for `###` cards in a single doc
+ [ ] jest: nested single-file tree yields `###` cards in status columns with epic tag present; flat file unchanged
+ [ ] playwright: nested single file renders story cards (not epic cards) end-to-end
+ [ ] revisit `AUTHORING_GUIDE.md` once the descent rule lands (it already claims `###` = card universally)


### View hierarchy and per-view card-type axis [](?id=view-hierarchy-and-card-types)

The view system today has a flat dispatch (`GenericView.tsx:774-776`): `auto` → `document` → `kanban`. Two structural changes in one story:

1. **View hierarchy.** Kanban is one instance of a more general *column-based* view. Other column-based views (group-by-assignee, group-by-type, group-by-any-attribute) should inherit kanban's column primitives without re-implementing them. Introduce a `ColumnBasedView` base.
2. **Card-type axis.** Orthogonal to view choice. Within any view a note can be rendered as a full card (current default — pill, title, attributes, body) or a compact summary (e.g. a sticky-note). Introduce an `nt_card` linetag alongside `ng_view`, with auto-resolution and a second toolbar selector — "Auto (Card)" alongside the existing "Auto (Kanban)".

+ goal
  + future column-based views can declare a different column-derivation function and reuse all of kanban's column rendering, ordering, drag-and-drop, and (once it lands) animation infrastructure
  + the card rendering used by any view is selectable independently of the view itself; the default per view stays the current full card
  + `nt_card` overrides apply at the file H1 level just like `ng_view` does today, with the same auto-resolution semantics
+ background
  + view dispatch lives at `GenericView.tsx:33` (`SELECTABLE_VIEWTYPES = ['auto', 'document', 'kanban']`) and `GenericView.tsx:774-776` (hard-coded switch)
  + auto-resolution: `AutoView.tsx:27-49` majority-votes `origin.file_view_type` across files in aggregate mode; `AutoView.tsx:75-77` reads focused-note `ng_view`
  + card rendering: `GenericNote.tsx:13-74` lazy-routes by `props.type` (default `'markdown'`); `MarkdownNote.tsx` renders pill → title → attributes → body
  + view toolbar selector: `ViewTypeSelector.tsx:30-54` rendered at `GenericView.tsx:662-670`, labels the chip "Auto (Kanban)" using the auto-resolved type
  + no existing extension point — each view today is independent and hard-coded; no base class, no registry
+ scope — view hierarchy
  + new `components/views/ColumnBasedView.tsx` — base component that owns the column-building memo, the column header bar, the drop-zone wiring, and column-order persistence (factored out of `KanbanView.tsx:73-107`)
  + `ColumnBasedView` accepts a `columnDerivation` prop: `(notes) => { columns, assignNoteToColumn, columnLabel }` — kanban supplies "by `status` linetag value", future views supply their own (by `assignee` linetag, by `type` linetag, by any computed attribute)
  + `KanbanView.tsx` becomes a thin wrapper that supplies the status-tag derivation and delegates the rest to `ColumnBasedView`
  + no new column-based view shipped in this story — the proof is the kanban refactor demonstrating no regression
+ scope — card-type axis
  + new `nt_card` linetag, parsed alongside `ng_view` by `mergeAggregateRoot` and stamped onto `origin.file_card_type`
  + new `SELECTABLE_CARDTYPES = ['auto', 'card', 'sticky']` — `auto` + the existing full card + one new compact card to prove the registry
  + new `components/notes/CardRegistry.ts` — registry `{ [card_type]: (note, display_options) => ReactElement }`; entries: `card` → existing `MarkdownNote`, `sticky` → new `StickyNote`
  + new `components/notes/StickyNote.tsx` + `.module.scss` — compact rendering: pill + title only, no attributes, no body, tighter padding
  + `GenericNote.tsx` switches on `props.display_options?.card_type` and dispatches via the registry instead of hard-routing by `props.type`
  + auto-resolution for card type: majority-vote `origin.file_card_type` across files (mirror `AutoView.tsx`); each view registers its own default card type (kanban → `'card'`)
+ scope — toolbar UI
  + extend `ViewTypeSelector` (or add a sibling component) to render a second select labelled "Auto (Card)" / "Card" / "Sticky"
  + label semantics match the view selector — show the auto-resolved type in parentheses when set to auto
  + dispatch: `setViewManagedState({ card_type: ... })` mirroring the view-type dispatch
  + layout: two selects side-by-side at `GenericView.tsx:662-670`; on narrow widths they wrap to two rows
+ out of scope
  + shipping a second column-based view (group-by-assignee etc.) — follow-up; this story only sets up inheritance
  + further card types beyond `card` and `sticky` — registry is open, more added later
  + per-note `nt_card` override (file-level only for now)
  + animation-layer integration — the work in [[animated-passive-transitions]] keys on `stable_id`, which is orthogonal to card type
+ files
  + new `client/webview/src/notethink-views/src/components/views/ColumnBasedView.tsx`
  + `client/webview/src/notethink-views/src/components/views/KanbanView.tsx` — slim wrapper around `ColumnBasedView`
  + new `client/webview/src/notethink-views/src/components/notes/CardRegistry.ts`
  + new `client/webview/src/notethink-views/src/components/notes/StickyNote.tsx` + `StickyNote.module.scss`
  + `client/webview/src/notethink-views/src/components/notes/GenericNote.tsx` — switch on `card_type` via registry
  + `client/webview/src/notethink-views/src/components/views/ViewTypeSelector.tsx` — second select for card type
  + `client/webview/src/notethink-views/src/components/views/GenericView.tsx` — `SELECTABLE_CARDTYPES`, dispatch handlers
  + `client/webview/src/notethink-views/src/components/views/AutoView.tsx` — majority-vote card type alongside view type
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` — capture `nt_card` from file H1 → `origin.file_card_type`
  + `client/webview/src/notethink-views/src/types/NoteProps.ts` — `card_type?: string` on `NoteDisplayOptions`; `file_card_type?: string` on `NoteOrigin`
+ [ ] factor `ColumnBasedView` out of `KanbanView`; verify byte-identical render for existing fixtures
+ [ ] introduce `CardRegistry` with `card` (existing `MarkdownNote`) + `sticky` (new `StickyNote`)
+ [ ] add `nt_card` linetag parsing in `mergeAggregateRoot`; capture on `origin.file_card_type`
+ [ ] add card-type auto-resolution in `AutoView` mirroring the view-type majority vote
+ [ ] add second toolbar selector — "Auto (Card)" / "Card" / "Sticky" — dispatch to `setViewManagedState`
+ [ ] each view declares its default card type (kanban → `'card'`); auto picks the default when no `nt_card` votes are present
+ [ ] jest: `ColumnBasedView` exposes the same column shape under arbitrary `columnDerivation` (kanban-derivation + a fake derivation by another attribute)
+ [ ] jest: kanban refactor renders byte-identical against existing fixtures
+ [ ] jest: `CardRegistry` returns `MarkdownNote` for `'card'`, `StickyNote` for `'sticky'`, falls back to view default for `'auto'`
+ [ ] jest: `nt_card` on a file H1 is captured into `origin.file_card_type`
+ [ ] jest: `AutoView` majority-votes card type independently of view type
+ [ ] playwright: switch second selector from "Auto" to "Sticky" — note cards collapse to compact form
+ [ ] playwright: file with `nt_card=sticky` on H1 in folder mode — auto-resolved card type is sticky for that file's notes
+ [ ] playwright: existing kanban specs all green (refactor regression check)
+ [ ] `pnpm run check` green
+ manual: open a folder with mixed `nt_card` values across files — toolbar shows "Auto (...)" with the majority-voted card type
+ manual: explicitly set card type to "Sticky" — all notes render compactly across columns
+ manual: switch back to "Auto" — auto resolution recovers
+ acceptance
  + kanban view works identically after the `ColumnBasedView` refactor (no visible regression)
  + a second selector appears in the toolbar with the same Auto / explicit semantics as the view-type selector
  + `nt_card` linetag at file H1 cascades into the auto-resolved card type for that file
  + `StickyNote` renders pill + title only; switching back to `card` restores the full card
  + future column-based views can be added by supplying a different `columnDerivation` without re-implementing column layout or drag-and-drop
+ open questions for the implementing agent
  + per-note `nt_card` override (currently file-level only) — defer to a follow-up unless trivial
  + whether the two selectors share a single composite control or stay as two siblings — leaning two siblings for symmetry with "Auto (Kanban)"
  + naming of the base — `ColumnBasedView` vs `GroupedView` vs `BoardView`; first is most descriptive
+ commit message draft
  + notethink 0.2.18: kanban becomes a thin specialisation of new `ColumnBasedView` base so future column-based views (group-by-assignee, group-by-type, etc.) can inherit column layout, ordering, and drag-and-drop
  + introduce `nt_card` linetag and `CardRegistry` — second toolbar selector "Auto (Card)" picks between `card` (full) and `sticky` (compact summary); `nt_card` on file H1 cascades into auto-resolution
  + tests N jest, N playwright


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
+ consider whether parsing (mdast-util-from-markdown) is the bottleneck
  + or whether it's the React re-rendering
  + profile before optimising
