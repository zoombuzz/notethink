# Todo [](?nt_view=kanban)


### Manual "Show more" expand collapses on any edit; only "Show less" should collapse it [](?id=manual-expand-survives-edits)

A top-level note the user has expanded with "Show more" silently re-collapses on the next content edit - most visibly, ticking one of its own checkboxes. `MarkdownNote.tsx` keeps the manual-expand flag in local state and force-resets it on every body change: `useEffect(() => setManuallyExpanded(false), [props.body_raw])` (`client/webview/src/notethink-views/src/components/notes/MarkdownNote.tsx:48-51`). Ticking a checkbox rewrites the body (`[ ]` -> `[X]`), so `body_raw` changes, the effect fires, `useSyncedBodyClip` re-applies the clip, and the card snaps back to its collapsed summary a beat after the click - reading as if the click scrolled the note. The only intended collapse path is the "Show less" button (`MarkdownNote.tsx:117`).

+ goal
  + a manually-expanded note stays expanded across content edits (checkbox tick, text edit); the only thing that collapses it is a "Show less" click
+ why the reset is not needed (safe to remove)
  + cards are keyed by stable identity, not content or position: `kanbanDraggableId(note)` returns `note.stable_id ?? String(note.seq)` (`client/webview/src/notethink-views/src/lib/noteops.ts:562`), used as the `<Draggable key>` in `KanbanBoard.tsx:99`. React remounts a card only when a DIFFERENT note takes the slot (fresh state, flag defaults to false); the same note keeps its instance across edits. So the effect is not guarding against instance reuse - it only produces the bug
  + the "note shrank below the overflow threshold" case is already covered: the clip gates on `overflow_state.overflows` (`MarkdownNote.tsx:57`), so a note that no longer overflows will not clip regardless of the flag
+ scope
  + remove the `body_raw` reset effect (`MarkdownNote.tsx:48-51`), leaving "Show less" (line 117) as the sole collapse trigger; if a defensive reset is still wanted, key it on note identity (`props.seq`), never on `props.body_raw`
+ acceptance criteria
  + expand a long note (Show more), tick one of its checkboxes: the note stays expanded and only the box fills
  + click "Show less": the note collapses
  + move the note to another column, or replace the slot with a different note: expand resets to collapsed (unchanged)
  + a note edited short enough that it no longer overflows shows no clip and no Show-more bar (unchanged)
+ found by: the notegit typical-user demo video (which doubles as a regression check) - ticking three checkboxes on an expanded card collapsed it mid-demo
+ [ ] remove (or narrow to `props.seq`) the manually_expanded reset effect in `MarkdownNote.tsx`
+ [ ] add a test: expanded note + checkbox tick stays expanded; "Show less" collapses it


### View registry: the view hierarchy as data [](?id=view-registry)

The keystone for the column-view programme. Today the view hierarchy does not exist as data: `SELECTABLE_VIEWTYPES = ['auto', 'document', 'kanban']` is a flat array (`GenericView.tsx:19`), dispatch is three parallel `props.type ===` guards (`GenericView.tsx:87-89`), and the settings drawer dispatches the same way (`GenericViewToolbar.tsx:142,161`). Every part of the column-view design - the indented selector tree, column->kanban parentage, a group-by that is locked in the child and unlocked in the parent, a group-by shared by the column and row families - is a query against a registry that declares parent, children, and per-setting ownership. Build it once here or write the same inheritance logic in three places later.

+ goal
  + one declarative registry describes every view: id, parent, label, selectable, own settings, locked settings
  + settings resolve by walking a view's ancestor chain, most-specific wins
  + that same walk answers "is this setting locked for this view, and which ancestor would unlock it"
+ background - the config namespace is already a two-level view tree
  + `view.generic.*` is the settings of the ROOT view node (applies to all views) - `settings.ts:21,25,26,28`
  + `view.specific.kanban.*` is the settings of a LEAF node - `settings.ts:20,27`
  + so `generic`/`specific` already mirrors a root+leaves tree; what is missing is only the ability to name an INTERMEDIATE node
  + `files.*` is a separate sibling namespace and is out of scope
+ scope - the tree
  + declare the tree: root -> {document, grouped}; grouped -> {column, row}; column -> {kanban}; row -> {gantt}
  + `grouped` is abstract: it owns settings but is not selectable, so the selector still reads Column -> Kanban with no phantom node
  + it exists so `groupBy` is declared once for both the column and row families rather than duplicated on each
  + ship only the nodes that have a view today (root, document, kanban); column/row/gantt land with their own stories
  + replace `SELECTABLE_VIEWTYPES` and the parallel type guards with registry lookups
+ scope - settings ownership
  + extend `view.specific.<node>.*` so `<node>` is any registry node id, including abstract ancestors
  + `groupBy` therefore lands at `view.specific.grouped.groupBy` and is inherited by column, kanban, row, gantt
  + a child that pins an inherited setting to a constant (kanban pins groupBy=status) declares it as locked, naming the ancestor that unlocks it
  + resolution order stays as today: per-session viewState -> extension cascade -> built-in default (`composerops.ts:49`)
+ out of scope
  + renaming `generic`/`specific` to a literal tree mirror (`view.all.*`, `view.grouped.*`) - see the decision below
  + any UI change; the selector and drawers keep their current shape until [[view-settings-tree-drawer]]
  + shipping column, row or gantt views
+ decisions
  + [X] keep `generic`/`specific` and extend `specific` to intermediate nodes - zero migration for the six shipped config keys, and this extension is published so a rename breaks real users' settings.json. The wart is that "specific" reads oddly for a node shared by four views; accepted
  + [ ] `columnOrder` default is `['untagged','doing','code-review','testing','done']`, which is inherently a STATUS order and meaningless under group-by=assignee - so the order is per-(view, group-by key), not per-view. Decide whether it becomes a map keyed by group-by key and moves to `grouped` as a group order (a shape change to the shipped `view.specific.kanban.columnOrder`, currently `string[]`), or stays as-is and simply resets per key
+ files
  + new `client/webview/src/notethink-views/src/lib/viewregistryops.ts` - the tree, ancestor walk, settings resolution, lock query
  + `client/webview/src/notethink-views/src/components/views/GenericView.tsx` - drop `SELECTABLE_VIEWTYPES`, dispatch from the registry
  + `client/extension/src/lib/settings.ts` - `SETTINGS` entries gain their owning node
  + `package.json` - `contributes.configuration` follows any new path
+ [ ] build the registry + ancestor-walk settings resolution + lock query
+ [ ] dispatch `GenericView` from the registry instead of the parallel type guards
+ [ ] drive the settings drawer's per-type dispatch from the registry
+ [ ] jest: ancestor walk resolves most-specific-wins across root/abstract/leaf nodes
+ [ ] jest: a locked setting reports its value and the ancestor that unlocks it
+ [ ] jest: existing document + kanban settings resolve byte-identically to today (regression)
+ [ ] `pnpm run check` green
+ acceptance criteria
  + the view tree is one data structure; adding a view is one registry entry plus its component
  + every existing setting resolves exactly as it does today
  + no `SELECTABLE_VIEWTYPES` and no parallel `props.type ===` dispatch remains


### Group-by candidate enumeration [](?id=group-by-enumeration)

Pure-lib groundwork for [[column-view-group-by]], with no UI. Enumerate the attribute keys a board could group by, and for each the values it would produce. Cheap by construction: the notes are already parsed and in memory, so this is a sweep over `note.linetags`, not a re-parse. Runs in parallel with [[view-registry]].

+ goal
  + given the rendered notes, return the group-by candidate keys and each key's distinct values
  + candidates cover authored attributes plus implicit keys computed from a note's origin
+ background - most of the filtering already exists
  + there is NO whitelist: `parseLineTags` retains every arbitrary key (`linetagops.ts:64-100`), so any authored attribute is already available
  + `isNamespacedKey` (`linetagops.ts:10-25`) already separates internal `nt_`/`ng_` keys from content attributes - that IS the candidate filter, and it is the same rule that drives chip visibility (`renderops.tsx:110`)
  + `value_numeric` (`linetagops.ts:88`) already marks numeric values - that IS the text-vs-numeric filter, so `time_taken` / `time_estimated` self-exclude
  + `HIDDEN_ATTRIBUTES = ['progress_unit', 'progress_max', 'id']` (`GenericNoteAttributes.tsx:9-14`) is the existing noise list
  + "first level folder" already exists as `projectNameFromRelativePath` (`originops.ts:61-65`) - the first segment of `relative_path`, and already what drives the project pills
+ scope
  + enumerate distinct keys across the notes, dropping namespaced, hidden, and all-numeric-valued keys
  + a key qualifies only if it has at least one text value; mixed text/numeric keys qualify on their text values
  + add implicit keys: `nt_first_level_folder`, computed per note via `projectNameFromRelativePath`, not read from linetags
  + implicit keys are namespaced to preserve the authored key space and cannot collide with a real attribute
  + mark each candidate writable or read-only - authored attributes are writable, implicit keys are read-only
  + memoise on the same key as the folder merge cache so the sweep is not O(all notes) per render
+ out of scope
  + any UI, selector, or column derivation - [[column-view-group-by]] consumes this
  + a second implicit key beyond first level folder
+ implementation notes
  + `value_numeric` tests with `parseFloat` but stores `Number(value)` (`linetagops.ts:88`), so `"5px"` passes the test and stores `NaN` - do not treat a present `value_numeric` as proof of a numeric value without checking `isNaN`
  + `status` is read as a bare unnamespaced key (`noteops.ts:470`) while `nt_kanban_ordering_weight` is a namespaced literal (`noteops.ts:539`); neither uses `resolveNamespacedTag`, so an enumeration that assumes one convention will miss the other
  + inherited tags (`nt_child_*`) are real entries in `linetags` with `inherited: true` - they count as values, since a card grouped by an inherited status belongs in that column
+ files
  + new `client/webview/src/notethink-views/src/lib/groupbyops.ts` - candidates, values, implicit-key resolution, writability
+ [ ] enumerate candidate keys + distinct values, dropping namespaced / hidden / all-numeric keys
+ [ ] add the `nt_first_level_folder` implicit key over `projectNameFromRelativePath`
+ [ ] mark candidates writable vs read-only
+ [ ] memoise the sweep against the merge cache key
+ [ ] jest: an authored text attribute becomes a candidate with its distinct values
+ [ ] jest: `nt_`/`ng_`-prefixed, hidden, and numeric-only keys are excluded
+ [ ] jest: a key with mixed text and numeric values qualifies on its text values
+ [ ] jest: `nt_first_level_folder` enumerates per-file folders and reports read-only
+ [ ] jest: inherited tags count toward a key's values
+ [ ] `pnpm run check` green
+ acceptance criteria
  + candidates come from data with no hardcoded key list
  + `time_taken` / `time_estimated` never appear; `status` and any authored text attribute do
  + the sweep costs nothing measurable on a 200-file board (memoised, not per-render)


### Factor ColumnBasedView out of KanbanView [](?id=column-based-view)

Split out of [[view-hierarchy-and-card-types]], which bundled this with the orthogonal `nt_card` axis and was blocking on it. This half gates the whole column-view programme; the card axis does not and now stands alone. Kanban becomes a thin specialisation supplying "group by the `status` linetag", so every future grouped view inherits column layout, ordering, and drag-and-drop.

+ goal
  + a grouped view supplies a group derivation and inherits all of kanban's column rendering, ordering, and drag-and-drop
  + kanban renders identically after the refactor
+ background - the base naming question is now answered
  + the original story left open: `ColumnBasedView` vs `GroupedView` vs `BoardView`
  + row view and gantt resolve it: group-by spans BOTH the column and row families, so grouping is layout-independent and must NOT live inside the column base
  + so this is two pieces - a grouping engine (shared with row view later) and `ColumnBasedView` (column layout only)
  + `kanbanColumnValue` (`noteops.ts:469`) is the single note->column rule and is the natural seam
+ scope
  + extract the grouping engine: `(notes, group_key) => { values, valueForNote, label }`, layout-independent
  + `deriveNaturalColumnOrder` (`noteops.ts:455-462`), `notesInKanbanColumn` (`:478-480`) and `formatColumnLabel` (`:441-449`) generalise off the hardcoded `status` onto the group key
  + new `ColumnBasedView` owns the column memo, header bar, drop zones, and column-order persistence, factored out of `KanbanView.tsx:73-107`
  + `KanbanView` becomes a thin wrapper supplying the `status` derivation
  + no new view ships here; the proof is the kanban refactor with no regression
+ out of scope
  + the `nt_card` axis - stays in [[view-hierarchy-and-card-types]]
  + shipping column, row or gantt views
  + windowing - see the sequencing note in [[kanban-virtualized-columns]]
+ implementation notes
  + the untagged column is synthetic - no file carries `status=untagged`; the `||` in `kanbanColumnValue` invents it, and dropping there DELETES the linetag (`kanbanProjection.ts:49-51`, `cloneWithoutLinetag`)
  + so the generalised engine needs an "absent value" bucket per group key, not a literal `untagged` string
  + `KanbanView.tsx:165-166` culls empty columns and falls back to all columns, so a stale `columnOrder` naming dead values is already harmless
+ files
  + new `client/webview/src/notethink-views/src/components/views/ColumnBasedView.tsx`
  + `client/webview/src/notethink-views/src/components/views/KanbanView.tsx` - thin wrapper
  + `client/webview/src/notethink-views/src/lib/noteops.ts` - generalise the column helpers off `status`
  + `client/webview/src/notethink-views/src/components/views/kanban/useKanbanColumns.ts`
+ [ ] extract the layout-independent grouping engine off `kanbanColumnValue`
+ [ ] generalise the natural-order, membership and label helpers onto a group key
+ [ ] factor `ColumnBasedView` out of `KanbanView`; reduce `KanbanView` to the status derivation
+ [ ] jest: `ColumnBasedView` yields the same column shape under an arbitrary derivation (status + a fake attribute)
+ [ ] jest: the absent-value bucket works for a group key other than `status`
+ [ ] jest: kanban renders identically against existing fixtures
+ [ ] playwright: every existing kanban spec green (refactor regression check)
+ [ ] `pnpm run check` green
+ acceptance criteria
  + kanban is visually and behaviourally unchanged
  + a new grouped view needs only a derivation, not a reimplementation of column layout or drag-and-drop
  + the grouping engine carries no column-layout assumptions, so row view can reuse it


### Column view with group-by [](?id=column-view-group-by)

The feature. Column view is the parent; kanban becomes the child that pins group-by to `status`. Column view exposes a group-by selector over the enumerated candidates, defaulting to first level folder, and honours an `nt_group_by` root attribute with the same auto semantics as `nt_view`. Depends on [[view-registry]], [[group-by-enumeration]] and [[column-based-view]].

+ goal
  + column view groups cards by any candidate attribute, selectable at runtime
  + kanban is column view with group-by pinned to `status` and locked
  + `nt_group_by=assignee` on the file root resolves and displays as "Auto (Assignee)"
+ background
  + auto resolution has an exact precedent to mirror: `majorityNgView` (`noteops.ts:176-198`) - one vote per file, first story wins, strict plurality, ties return undefined
  + the "Auto (X)" label already exists as `viewTypeLabel` (`components/views/viewTypeLabel.ts`)
  + `fileDeclaredViewType` (`mergeAggregateRoot.ts:145-148`) shows the H1-over-frontmatter precedence to copy
+ scope - the view
  + add `column` to the registry as the parent of `kanban`; both render `ColumnBasedView` with different derivations
  + column view defaults group-by to `nt_first_level_folder`, matching how the project pills already read
  + kanban declares groupBy locked to `status`, naming column view as the unlocking ancestor
  + switching kanban -> column changes nothing on screen at first; it only unlocks the options
+ scope - the linetag
  + new `nt_group_by` root attribute, read off the file H1 with frontmatter fallback
  + auto-resolves by majority vote across files, mirroring `majorityNgView`, with a focused-note override
  + values are candidate keys, plus implicit keys in their `nt_` form (`nt_group_by=nt_first_level_folder`)
  + bump AUTHORING_GUIDE to 1.2.0 (new optional backward-compatible key) and add the rows to its tables
+ scope - drag write-back
  + a drop writes the group-by key, generalising today's `status=` write: group by assignee, drop, and it writes `assignee=X`
  + a drop on the absent-value bucket deletes the linetag, as `status` does today
  + drag is DISABLED when the group-by key is read-only, because a drop would have to move a file on disk
  + so first level folder is a read-only grouping: it renders columns but takes no drops
+ out of scope
  + row view and gantt - the `grouped` ancestor exists for them but they ship separately
  + the tree selector and lock UI - [[view-settings-tree-drawer]] presents this; here group-by is a plain select in the view's settings drawer
  + writing an implicit key back (i.e. moving files by drag)
+ implementation notes
  + `nt_group_by` is a permanent name: it lands in users' files and cannot be renamed without a migration
  + implicit values are namespaced (`nt_first_level_folder`) to preserve the authored key space - decided 2026-07-17
  + `DEFAULT_COLUMN_ORDER` is mirrored in THREE places that must stay in lockstep: `client/extension/src/constants.ts:19`, `client/webview/src/constants.ts:9`, `package.json:205-210`
  + that default is a status order, so it must not be applied to a board grouped by anything else - see the open decision in [[view-registry]]
+ files
  + `client/webview/src/notethink-views/src/components/views/ColumnBasedView.tsx` - group-by prop
  + `client/webview/src/notethink-views/src/components/views/AutoView.tsx` - majority-vote `nt_group_by` alongside `nt_view`
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` - capture `nt_group_by` onto origin
  + `client/webview/src/notethink-views/src/components/views/kanban/kanbanProjection.ts` - write the group key, not `status`
  + `AUTHORING_GUIDE.md` - version 1.2.0, `nt_group_by` row, `nt_view=column` value
  + `l10n/bundle.l10n*.json` (5 files) - group-by labels
+ [ ] add `column` to the registry with group-by unlocked; pin kanban's groupBy to `status`, locked
+ [ ] default column view's group-by to `nt_first_level_folder`
+ [ ] add the group-by select over the enumerated candidates in the view's settings drawer
+ [ ] parse `nt_group_by` off the file root and auto-resolve it by majority vote
+ [ ] label the resolved selection "Auto (Assignee)" via `viewTypeLabel`
+ [ ] generalise the drag write-back off `status` onto the group-by key
+ [ ] disable drag when the group-by key is read-only
+ [ ] update AUTHORING_GUIDE to 1.2.0 with `nt_group_by` and `nt_view=column`
+ [ ] add the l10n strings across all 5 bundles
+ [ ] jest: column view groups by an arbitrary attribute; kanban still groups by status
+ [ ] jest: `nt_group_by` majority-votes across files; ties fall back to the default
+ [ ] jest: a drop writes the group-by key, and the absent-value bucket deletes it
+ [ ] jest: a read-only group-by key yields non-draggable cards
+ [ ] playwright: switch to column view, change group-by, columns re-derive
+ [ ] playwright: group by first level folder - columns match the project pills and cards do not drag
+ [ ] playwright: every existing kanban drag spec green
+ [ ] `pnpm run check` green
+ manual: open a folder board, switch to column view, confirm it defaults to first level folder columns matching the pills
+ manual: set `nt_group_by=assignee` on a file root and confirm the selector reads "Auto (Assignee)"
+ manual: group by an authored attribute, drag a card, confirm the attribute is rewritten in the file
+ acceptance criteria
  + column view groups by any enumerated candidate, defaulting to first level folder
  + kanban is unchanged and shows its group-by as status, locked
  + `nt_group_by` resolves with the same auto semantics as `nt_view`
  + dragging writes the group-by attribute, and is disabled entirely for read-only keys


### View settings drawer: view tree and locked settings [](?id=view-settings-tree-drawer)

The deep integration [[drawer-tabs-and-jump-integration]] deliberately left alone. That story lands the thin move - the view-type `<select>` into the drawer body (`SettingsCommonControls.tsx:48`), the tab titled with the resolved type - and says anything clever built there would be thrown away. This is that work: the drawer becomes a view tree on the left and the selected view's settings on the right, with inherited settings shown locked.

+ goal
  + the drawer presents the view hierarchy as an indented tree, replacing the `<select>`
  + selecting a view switches to it and shows its settings alongside
  + a setting a view inherits and pins reads as locked, naming the ancestor that unlocks it
+ background
  + selecting a view in the tree IS switching to it, so selected == active and the right-hand panel can keep keying off `props.type` as it does today
  + the settings drawer already dispatches per view type (`GenericViewToolbar.tsx:142,161`) with a shared `SettingsCommonControls` - the tiering exists, it is only flat
  + `role="tree"` appears exactly ONCE in the whole webview (`JumpDrawer.tsx:48`): hand-rolled inline, root plus one level, CSS-only indent (`.jumpTreeChildren`, `ViewRenderer.module.scss:653-658`), no depth prop, no recursion
  + so there is no reusable tree to be consistent with; it has to be extracted first
  + `.drawerLink` / `.drawerList` ARE already shared across the files, collisions and jump drawers - only the tree glyph/indent pattern is unique to Jump
+ scope
  + extract the `jumpTree*` glyph + indent pattern into a shared tree component, made recursive for arbitrary depth
  + repoint JumpDrawer at it with no behaviour change
  + render the view tree in the drawer's left column from the registry, skipping abstract nodes
  + move the view-type selector out of `SettingsCommonControls` - its placement there was the deliberate thin step
  + show the selected view's settings on the right; render inherited-and-pinned settings as locked with the unlocking ancestor named
  + a locked control unlocks the instant its unlocking ancestor is selected, with the view unchanged underneath
+ out of scope
  + changing which settings exist, or their values
  + the other drawers' contents
+ files
  + new `client/webview/src/notethink-views/src/components/views/drawers/DrawerTree.tsx` - shared, recursive
  + `client/webview/src/notethink-views/src/components/views/drawers/JumpDrawer.tsx` - repoint at it
  + `client/webview/src/notethink-views/src/components/views/SettingsCommonControls.tsx` - selector leaves
  + `client/webview/src/notethink-views/src/components/views/generic/GenericViewToolbar.tsx` - two-column drawer body
  + `client/webview/src/notethink-views/src/components/ViewRenderer.module.scss` - tree + two-column classes
+ [ ] extract the shared recursive tree component from JumpDrawer's inline markup
+ [ ] repoint JumpDrawer at it with no behaviour change
+ [ ] render the registry's view tree in the drawer's left column
+ [ ] move the view-type selector out of `SettingsCommonControls`
+ [ ] render inherited-and-pinned settings as locked, naming the unlocking ancestor
+ [ ] jest: the tree renders the registry hierarchy and skips abstract nodes
+ [ ] jest: selecting a tree node switches the view
+ [ ] jest: kanban shows group-by locked to status; selecting column view unlocks it
+ [ ] playwright: the jump drawer's tree is unchanged after the extraction
+ [ ] playwright: open View settings, select column view from the tree, group-by becomes editable
+ [ ] `pnpm run check` green
+ manual: confirm the view tree reads consistently with the jump drawer's tree
+ manual: in kanban, confirm group-by shows status locked and it is obvious column view unlocks it
+ manual: select column view and confirm the board does not change until an option is changed
+ acceptance criteria
  + no view-type `<select>` remains; the tree is the selector
  + the view tree and the jump tree render from one component
  + a locked setting names the ancestor that unlocks it, and unlocks on selecting that ancestor
  + selecting a parent view changes nothing on screen until an option is changed


### Kanban perf harness and budgets [](?id=kanban-perf-harness)

Measurement tooling that gates the whole performance cycle (stories [[dev-host-production-react]] through [[extension-parse-offload]]). Every acceptance budget below was baselined 2026-07-07 by driving the real webview bundle in the existing Playwright harness (`playwright/harness/index.html` + mocked VS Code API) with the exact wire-format messages `PanelSession` posts.

+ goal
  + one command produces per-scenario timings (elapsed, long-task count/total/max) against the current bundle as JSON
  + each optimization story proves its budget with this tool; regressions fail loudly before push
+ background - the measured baseline (production-mode bundle unless marked dev)
  + folder progressive load (8KB files, 10 cards each): 50 files 9.2s, 100 files 36.4s, 200 files 211.8s with 206.8s of long tasks - clean O(N^2); 200 is the extension's own `MAX_AGGREGATE_FILES` cap (`client/extension/src/constants.ts:5`)
  + interactions on a 50-file/500-card board: card click 168ms, editor caret move (selectionChanged) 154ms, one-file merge update 155ms; dev bundle: 708ms / 840ms / 2758ms
  + single-file kanban (nt_view=kanban): 400KB/467 cards loads in 1.7s; a 400KB edit re-send crashed the renderer (repeatable); a 100-file progressive load under the CPU profiler also crashed the renderer
  + extension-host costs (node bench): mdast parse 0.6ms/KB (400KB done.md = 230ms per debounced keystroke); mdast JSON payload is 6.2x the source text (200-file folder load ships ~9.3MB through postMessage); hashing negligible
  + real workspace shape this models: ~601 md files, done.md files 400-820KB, maxNotesPerFile=10
+ scope
  + `scripts/perf/` node runner + `pnpm run test-perf`; writes `test-results/perf.json`
  + scenarios: folder progressive load (20/50/100/200 files), folder interactions (click, selectionChanged, single-file merge), folder with 10x400KB long files, single-file load + edit re-send (100KB and 400KB)
  + budget config in one file, asserted per scenario, exit non-zero on breach; initial thresholds = baseline + 20%, ratcheted down by later stories
  + defaults to the production-mode webview bundle; `--dev-bundle` flag for the dev build
+ out of scope
  + CI integration (CI skips browser downloads by design - see CODING_STANDARDS Release section)
+ implementation notes (from the analysis prototypes - port, do not rediscover)
  + generate synthetic story files (`### Story [](?status=...)` + checkbox bullets); single-file kanban needs H1 `[](?nt_view=kanban)` plus a selectionChanged at offset 2 so AutoView resolves kanban
  + stage messages into the page as JSON strings and JSON.parse in-page; playwright's structured argument walk hangs for minutes on large mdast graphs
  + settle = `[data-flip-id]` count reaches expected, then double-rAF; long tasks via a buffered PerformanceObserver installed in an init script
  + folder mode boots via pre-seeded `window.__vsCodeState` viewStates (`__folder__` with `type: 'kanban'`, `integration_mode: 'folder'`)
+ acceptance criteria
  + `pnpm run test-perf` runs headless, writes `test-results/perf.json`, asserts budgets, exits non-zero on breach
  + scenario semantics documented in the runner header comment, including how to add a scenario
  + baseline JSON captured and committed alongside the budget config so later ratchets have provenance
+ [ ] build the generator + scenario runner under `scripts/perf/` with JSON-string staging and settle/longtask instrumentation
+ [ ] add budget config + assertions + `test-perf` script; capture the initial baseline file
+ [ ] document scenarios and the add-a-scenario recipe in the runner header


### Dev host: production React in the webview bundle [](?id=dev-host-production-react)

The dev-host webview currently runs the React development build: `webpack.config.js:110` sets `mode: 'none'` unless `NODE_ENV=production`, and the `build`/`watch` scripts never set it, so `process.env.NODE_ENV` stays undefined and React's dev instrumentation ships. Measured cost on a 50-file board: card click 708ms vs 168ms, caret move 840ms vs 154ms, single-file merge 2758ms vs 155ms - a 4-17x tax on every interaction the developer feels daily. CPU profiles attribute ~22% of load time to dev-only functions (`addObjectDiffToProperties`, `logComponentRender`).

+ goal
  + the bundle the dev host serves runs production React while keeping the NOTETHINK_DEV conveniences (file logger, cache-buster) and usable source maps
+ scope
  + make `build`/`watch` produce a production-mode (or at minimum NODE_ENV=production-defined) webview bundle; NOTETHINK_DEV define stays driven by SELFINSPECT_ENV as today (`webpack.config.js:23,87,172`)
  + keep `devtool: 'source-map'` for dev builds so webview debugging still works
  + decide (and document in CODING_STANDARDS Pre-Push Verification) whether the extension bundle follows or stays as-is; only the webview bundle carries React
+ out of scope
  + changing the marketplace `package` build (already production)
+ acceptance criteria
  + perf harness interaction scenarios on the build produced by `pnpm run build` meet the production-bundle baseline (click <= 200ms, selectionChanged <= 200ms, single-file merge <= 250ms on the 50-file scenario)
  + `NOTETHINK_DEV` gated features still function: file logger writes to `logUri`, webview cache-buster appends `?v=`
  + webview sources remain debuggable (source map resolves in webview devtools)
+ [ ] wire NODE_ENV/production mode into the default build + watch for the webview bundle
+ [ ] verify NOTETHINK_DEV logger + cache-buster still work in the dev host
+ [ ] run test-perf against the dev-workflow bundle and record the delta in this story


### Incremental folder merge with stable card identity [](?id=kanban-incremental-merge)

The core structural fix. Today every incoming doc update rebuilds the entire merged tree: `FolderTreeComposer.tsx:56-72` re-runs `mergeAggregateRoot`, which re-runs `convertMdastToNoteHierarchy` for EVERY doc (`mergeAggregateRoot.ts:263`), and `walkStorySubtree` renumbers every note's `seq` globally (`mergeAggregateRoot.ts:203`), which defeats `areMarkdownNotePropsEqual` (`MarkdownNote.tsx:127` compares seq first) so every card re-renders. A progressive N-file load therefore does O(N^2) conversions and N full-board renders; one file changing (watcher event, or the drag write-back echo) re-converts all 200 files and re-renders 2000 cards.

+ goal
  + a doc update re-converts only the changed doc and re-renders only the affected cards
  + the post-drag authoritative echo lands well inside `KANBAN_PROJECTION_MAX_MS` (1500ms, `useProjectedNotes.ts:10`) so drops never snap back
+ background
  + measured: one-file merge on a 50-file board costs 155ms (prod) / 2758ms (dev) as a single long task; at 200 files this scales ~4x further and breaks the projection window
  + `renderCache` (renderops.tsx:82) is a WeakMap keyed on mdast node identity - unchanged docs keep identity across merges, so preserving NoteProps identity unlocks the whole memo chain
+ scope
  + cache per-doc `convertMdastToNoteHierarchy` results keyed on `(doc id, hash_sha256)`; invalidate on hash change or doc removal
  + make story/card identity stable across merges: derive per-story keys and memo checks from `stable_id` (already stamped) instead of the global seq; assign seqs deterministically per (file, story) so an unchanged file's notes keep their numbers when a sibling file changes
  + audit the in-place mutation in `walkStorySubtree` - a cached subtree must not be mutated into a state React cannot detect; clone story roots on stamp or version them explicitly
  + memoize `flattenAllNotes` (`NoteTreeComposer.tsx:47`) and stop sorting `notes_within_parent_context` inside render (`useViewContext.ts:80` mutates and sorts every render)
+ out of scope
  + message batching (see [[kanban-folder-load-coalescing]]) and windowing (see [[kanban-virtualized-columns]])
+ acceptance criteria
  + perf harness single-file-merge scenario on the 50-file board: <= 60ms elapsed, no long task > 50ms (prod bundle); on the 200-file board <= 120ms
  + conversion-call probe (debug counter exposed for tests): a one-doc merge converts exactly 1 doc on a 50-doc board
  + drag round-trip: folder-kanban-drag playwright specs stay green; add a spec asserting no snap-back with a simulated 200-file-scale echo delay
  + jest: unchanged docs' NoteProps (or their memo-relevant fields) are reference-stable across a merge; changed doc's notes re-derive
  + full `pnpm run check` green; all 106 playwright specs green
+ [ ] add per-doc conversion cache keyed on (id, hash) with removal handling
+ [ ] make seq assignment deterministic per file + story; key React and memo comparisons on stable_id
+ [ ] resolve the walkStorySubtree mutation-vs-cache hazard (clone or version stamped subtrees)
+ [ ] memoize flattenAllNotes and the parent-context sort
+ [ ] add the conversion-call probe + jest coverage; ratchet perf budgets


### Folder-load batching and update coalescing [](?id=kanban-folder-load-coalescing)

Initial folder discovery streams one postMessage per file (`PanelSession.ts:826` fan-out, `:912` per-file merge update), and the webview commits a full state update per message (`useVscodeMessages.ts:245`), so a 200-file load produces 200 board renders plus a final aggregate replace. Measured: 20 files 5.3s, 50 files 9.2s (prod), 200 files 211.8s; the per-message costs (render + FLIP re-measure + persist) multiply with the O(N^2) merge fixed in [[kanban-incremental-merge]].

+ goal
  + a 200-file folder load reaches a settled board in seconds with bounded, small long tasks, while still showing progressive fill (spinner + growing board), not a blank wait
+ scope
  + extension: batch per-file merge updates during discovery - flush every ~100ms or every ~20 docs, whichever first; watcher-driven single-file updates keep streaming individually
  + webview: coalesce incoming update messages within an animation frame into one setState (queue + rAF flush in useVscodeMessages); message validation unchanged
  + keep the pendingChange spinner semantics (`pending-work-spinner` specs must stay green)
+ out of scope
  + changing the wire payload shape (see [[folder-wire-payload-diet]])
+ acceptance criteria
  + perf harness folder-200 progressive scenario: settled in <= 15s on the prod bundle with [[kanban-incremental-merge]] landed; no single long task > 500ms after the first paint
  + board commit probe: <= 15 board-level commits for a 200-file load (vs ~200 today)
  + progressive fill still visible: harness asserts cards appear before the final flush (not one big bang)
  + all pending-work-spinner + folder playwright specs green; `pnpm run check` green
+ [ ] batch discovery-phase merge posts in PanelSession with a flush timer + size cap
+ [ ] coalesce webview update handling into per-frame state commits
+ [ ] add a board-commit probe for the harness; assert progressive fill + budgets


### Virtualized kanban columns [](?id=kanban-virtualized-columns)

Every card mounts into the DOM: 200 files x 10 stories = 2000 `Draggable` cards (`KanbanBoard.tsx:96-127`), each rendering markdown, and the FLIP layer measures every `[data-flip-id]` node with getBoundingClientRect on each membership change (`useFlipTransition.ts:292`, fired per merge via the `signature` memo). CPU profiles show querySelectorAll + getAnimations at ~9-12% of load. @hello-pangea/dnd officially supports virtual lists (react-window pattern, overscan required). The `ColumnBasedView` factor-out this story asked to coordinate with is now [[column-based-view]], and the ordering is resolved: it lands FIRST, so windowing is implemented once in the base and every grouped view inherits it. This is the only story in the perf cycle that the column-view programme blocks.

+ goal
  + DOM card count is bounded by viewport + overscan regardless of corpus size; scrolling a column streams cards in (the infinite-scroll feel)
  + FLIP measurement cost scales with visible cards, not total cards
+ scope
  + adopt react-window (or equivalent fixed/variable-size list) per kanban column following the dnd virtual-lists pattern, with overscanning and drag-clone rendering per their docs
  + variable card heights: measure-and-cache strategy (cards clip to a max height already via useMarkdownNoteOverflow)
  + scroll-to-focused-card (`useScrollToCaret`, viewhooks.ts) must ask the virtualizer to scroll before framing; keyboard navigation and the focus ring rules (CODING_STANDARDS Focused-note scroll framing) still hold
  + FLIP: restrict measure/animate to mounted (visible) cards; skip animation entirely when a membership change exceeds a threshold (bulk load)
  + land inside the `ColumnBasedView` base so grouped views inherit it - [[column-based-view]] is a hard prerequisite, not a coordination question
+ out of scope
  + virtualizing document view (different scroll model; follow-up once ColumnBasedView ships)
+ acceptance criteria
  + 200-file board: mounted cards <= visible + overscan (assert via DOM count in the harness); folder-200 settled load <= 8s prod with prior stories landed
  + card click and selectionChanged on the 200-file board <= 200ms with no long task > 100ms
  + all kanban drag playwright specs green, including cross-column drags of cards that start off-screen (add spec)
  + keyboard navigation + focused-card scroll framing specs green (focus ring fully visible per CODING_STANDARDS)
  + kanban-animation specs green with FLIP scoped to visible cards; bulk-load renders skip animation (assert via animation probe events)
+ [ ] agree sequencing with the ColumnBasedView story; implement windowed columns per the dnd virtual pattern
+ [ ] wire scroll-to-focus + keyboard nav through the virtualizer
+ [ ] scope FLIP to mounted cards + bulk-change skip; keep animation probe coverage
+ [ ] add off-screen drag + DOM-bound assertions to playwright; ratchet perf budgets


### Webview state persistence diet [](?id=webview-state-persistence-diet)

`useVscodeStatePersistence` calls `vscode.setState({docs, viewStates})` on every docs change (`usePersistedViewStates.ts:78-82`), serializing the full docs map - text plus mdast at 6.2x text size - once per incoming message. On a 200-file load that is ~200 serializations of a growing multi-MB object; profiles show setItem/setState at 2-3% even in the mock, and the real VS Code setState crosses an IPC boundary. It is also a memory-pressure contributor to the observed renderer crashes (docs map + persisted copy + NoteProps trees).

+ goal
  + setState payloads become small and infrequent; reload still restores the board without a blank flash
+ background
  + reload already re-requests state: the webview replays setIntegration + requestInitialState on mount (`useVscodeMessages.ts:330-368`), and the extension's discovery fast-path skips reloading unchanged files via mtime (`PanelSession.ts:839`)
+ scope
  + persist viewStates always; persist doc METADATA only (id, path, relative_path, hash, mtime) instead of full text + mdast
  + debounce persistence (e.g. 500ms trailing) and flush on visibilitychange/dispose
  + reload path: render from re-requested extension state; verify the folder restore flow needs no persisted doc bodies (fast-path makes this cheap)
  + migrate old persisted shapes via migrateSavedState (vscodeops.ts) so stale full-doc states load cleanly once then shrink
+ acceptance criteria
  + setState payload per persist <= 100KB on the 200-file board (probe in harness mock)
  + persist frequency during a 200-file load <= 5 calls (debounced), not ~200
  + reload of a folder-mode board restores columns/cards without error and without a persisted-docs dependency (playwright reload spec)
  + `pnpm run check` green
+ [ ] slim the persisted shape to metadata + viewStates with migration
+ [ ] debounce persist + flush on hide/dispose
+ [ ] add payload-size + frequency probes and a folder reload spec


### Folder wire-payload diet (no mdast over the wire) [](?id=folder-wire-payload-diet)

Every Doc ships `text` plus the full mdast `content` (6.2x text) through postMessage (`PanelSession.ts:178,912`): a 200-file folder load transfers ~9.3MB, a single 400KB done.md re-send ~2.6MB, and serialization blocks both the extension host and the webview realms. The webview then derives its own NoteProps hierarchy anyway and caps each file at maxNotesPerFile=10 stories - most of the shipped tree is discarded. Design-first story: pick and prove one of the two payload shapes below, then implement.

+ goal
  + folder-mode wire payload per file scales with what the board renders (capped stories), not file size; memory footprint stops duplicating full mdast per doc
  + unlocks raising MAX_AGGREGATE_FILES (today 200, workspace has ~601 files) and file-level lazy loading
+ constraint from [[group-by-enumeration]] - whichever option wins
  + group-by candidates are enumerated from `note.linetags`, so the wire shape MUST preserve every linetag on whatever it ships
  + option A is the exposed one: a digest that drops or summarises linetags silently shrinks the group-by selector's options
  + option B is safe by construction - the webview parses the text itself, so every linetag survives
+ option A - ship digests
  + extension converts to hierarchy + applies the per-file story cap host-side, ships only capped story subtrees (NoteProps + the text slices those stories cover, with source offsets preserved in origin.source_position)
  + conversion code is pure TS in notethink-views; the extension bundle can import it (verify webpack config supports the cross-package import; the mirrored-constants exception in CODING_STANDARDS documents why modules are not currently shared - this import goes the allowed direction, webview package -> extension consumer)
  + edits still route by source offsets, so buildKanbanDragEndPayload and editText flows are unchanged
+ option B - ship text only
  + drop `content` from the wire Doc; the webview parses text in a Web Worker (workers in webviews load via blob: URI per the VS Code webview docs) and feeds the existing convertMdastToNoteHierarchy path
  + keeps one parser location but moves parse cost into the webview; combine with [[kanban-incremental-merge]] caching so each file parses once per hash
+ scope
  + spike both options against the perf harness long-files scenario (50 files with 10x400KB); pick by measured payload, settle time, and memory; record the decision in this story
  + implement the winner behind the existing message validation; update playwright helpers (inject-docs/inject-multi-docs build wire docs) and fixtures accordingly
  + document view (current_file mode) keeps full text + mdast for the active doc - only folder aggregation goes on the diet
+ acceptance criteria
  + wire payload for one 400KB file's folder update <= 100KB (measure serialized message size in the harness)
  + folder-50-with-long-files scenario: settled <= 6s prod (baseline 40s dev / to-be-measured prod); no renderer crash at 200 files under the harness memory probe
  + drag write-back, click-to-editor reveal, and caret matching still work in folder mode (existing folder specs + drag roundtrip specs green)
  + `pnpm run check` green
+ [ ] spike option A vs B on the harness; record numbers + decision here
+ [ ] implement the chosen shape end-to-end (PanelSession, Messages types, useVscodeMessages, composers, playwright helpers)
+ [ ] add payload-size + memory probes; ratchet budgets and raise-cap follow-up note


### Extension parse offload and adaptive debounce [](?id=extension-parse-offload)

mdast parse costs 0.6ms/KB on the extension host: each debounced keystroke on a 400KB done.md re-parses for 230ms (800KB: 509ms) on the same web worker that services every other extension request, and initial folder discovery parses up to 200 files inline (620ms for 200x8KB, several seconds with real done.md sizes). The web extension host supports spawning nested Web Workers (VS Code web-extensions guide), which is the safe first step; a WASM parser (markdown-rs, micromark's Rust sibling, via the @vscode/wasm toolchain) is the escalation if parse itself remains the bottleneck after offload.

+ goal
  + typing in a large file never saturates the extension host; parse work happens off the host thread and only the final result crosses back
+ scope
  + move parse() calls (buildDoc / buildDocFromUriAndText / loadFolderDoc paths in PanelSession) onto a worker pool (size ~cores/2, bounded queue); results post back as the existing Doc shape
  + adaptive debounce: scale CHANGE_DEBOUNCE_MS (PanelSession.ts:13) with the last parse duration for that doc (floor 250ms, cap ~1s) so big files self-throttle
  + drop stale parses: a newer edit for the same doc cancels the queued/in-flight older parse
  + verify worker creation works in both desktop (webWorker extension host) and vscode-test-web; feature-detect and fall back inline if Worker is unavailable
+ out of scope
  + WASM parser swap - leave a spike task with clear go/no-go criteria instead of committing to it
+ acceptance criteria
  + extension jest: worker pool parses and returns identical mdast to inline parse for fixture corpus; stale-parse cancellation covered
  + keystroke scenario: webview receives the re-send and the extension host stays responsive - measure by interleaving a settings round-trip during a 400KB keystroke storm in the harness (round-trip latency <= 100ms)
  + folder discovery of the long-files scenario does not block watcher/selection handling (same interleaving probe)
  + `pnpm run check` green including the extension Mocha suite
+ [ ] implement the parse worker pool with fallback + stale cancellation
+ [ ] make the change debounce adaptive to measured parse cost
+ [ ] add the host-responsiveness interleaving probe to the perf harness
+ [ ] write the markdown-rs/WASM spike task with go/no-go criteria (mdast position-compatibility, payload parity, measured speedup >= 3x) as a follow-up candidate for the user to green-light


### Per-view card-type axis [](?id=view-hierarchy-and-card-types)

The view-hierarchy half of this story was split out to [[column-based-view]] on 2026-07-17: it gates the column-view programme, this card axis does not, and bundling them was blocking the gate. What remains is the orthogonal card-type axis, which now stands alone and can run any time after [[view-registry]] (each view declares its default card type, which is a registry entry).

**Card-type axis.** Orthogonal to view choice. Within any view a note can be rendered as a full card (current default - pill, title, attributes, body) or a compact summary (e.g. a sticky-note). Introduce an `nt_card` linetag alongside `nt_view`, with auto-resolution and a second selector - "Auto (Card)" alongside the existing "Auto (Kanban)".

+ goal
  + the card rendering used by any view is selectable independently of the view itself; the default per view stays the current full card
  + `nt_card` overrides apply at the file H1 level just like `nt_view` does today, with the same auto-resolution semantics
+ background - line refs below drifted before the split; re-derive them rather than trusting the numbers
  + auto-resolution: `AutoView.tsx:27-49` majority-votes `origin.file_view_type` across files in aggregate mode; `AutoView.tsx:75-77` reads focused-note `nt_view`
  + card rendering: `GenericNote.tsx:13-74` lazy-routes by `props.type` (default `'markdown'`); `MarkdownNote.tsx` renders pill -> title -> attributes -> body
  + the view-type selector now lives in the settings drawer body, not the toolbar row, and labels via `viewTypeLabel.ts`
  + the view side of the extension point is [[view-registry]]'s job; each view declares its default card type there
+ scope - card-type axis
  + new `nt_card` linetag, parsed alongside `ng_view` by `mergeAggregateRoot` and stamped onto `origin.file_card_type`
  + new `SELECTABLE_CARDTYPES = ['auto', 'card', 'sticky']` - `auto` + the existing full card + one new compact card to prove the registry
  + new `components/notes/CardRegistry.ts` - registry `{ [card_type]: (note, display_options) => ReactElement }`; entries: `card` → existing `MarkdownNote`, `sticky` → new `StickyNote`
  + new `components/notes/StickyNote.tsx` + `.module.scss` - compact rendering: pill + title only, no attributes, no body, tighter padding
  + `GenericNote.tsx` switches on `props.display_options?.card_type` and dispatches via the registry instead of hard-routing by `props.type`
  + auto-resolution for card type: majority-vote `origin.file_card_type` across files (mirror `AutoView.tsx`); each view registers its own default card type (kanban → `'card'`)
+ scope - toolbar UI
  + extend `ViewTypeSelector` (or add a sibling component) to render a second select labelled "Auto (Card)" / "Card" / "Sticky"
  + label semantics match the view selector - show the auto-resolved type in parentheses when set to auto
  + dispatch: `setViewManagedState({ card_type: ... })` mirroring the view-type dispatch
  + layout: two selects side-by-side at `GenericView.tsx:662-670`; on narrow widths they wrap to two rows
+ out of scope
  + the view hierarchy and the `ColumnBasedView` factor-out - split to [[column-based-view]] 2026-07-17
  + further card types beyond `card` and `sticky` - registry is open, more added later
  + per-note `nt_card` override (file-level only for now)
  + animation-layer integration - the work in [[animated-passive-transitions]] keys on `stable_id`, which is orthogonal to card type
+ files
  + new `client/webview/src/notethink-views/src/components/notes/CardRegistry.ts`
  + new `client/webview/src/notethink-views/src/components/notes/StickyNote.tsx` + `StickyNote.module.scss`
  + `client/webview/src/notethink-views/src/components/notes/GenericNote.tsx` - switch on `card_type` via registry
  + `client/webview/src/notethink-views/src/components/views/ViewTypeSelector.tsx` - second select for card type
  + `client/webview/src/notethink-views/src/components/views/GenericView.tsx` - `SELECTABLE_CARDTYPES`, dispatch handlers
  + `client/webview/src/notethink-views/src/components/views/AutoView.tsx` - majority-vote card type alongside view type
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` - capture `nt_card` from file H1 → `origin.file_card_type`
  + `client/webview/src/notethink-views/src/types/NoteProps.ts` - `card_type?: string` on `NoteDisplayOptions`; `file_card_type?: string` on `NoteOrigin`
+ [ ] introduce `CardRegistry` with `card` (existing `MarkdownNote`) + `sticky` (new `StickyNote`)
+ [ ] add `nt_card` linetag parsing in `mergeAggregateRoot`; capture on `origin.file_card_type`
+ [ ] add card-type auto-resolution in `AutoView` mirroring the view-type majority vote
+ [ ] add second toolbar selector - "Auto (Card)" / "Card" / "Sticky" - dispatch to `setViewManagedState`
+ [ ] each view declares its default card type (kanban → `'card'`); auto picks the default when no `nt_card` votes are present
+ [ ] jest: `CardRegistry` returns `MarkdownNote` for `'card'`, `StickyNote` for `'sticky'`, falls back to view default for `'auto'`
+ [ ] jest: `nt_card` on a file H1 is captured into `origin.file_card_type`
+ [ ] jest: `AutoView` majority-votes card type independently of view type
+ [ ] playwright: switch second selector from "Auto" to "Sticky" - note cards collapse to compact form
+ [ ] playwright: file with `nt_card=sticky` on H1 in folder mode - auto-resolved card type is sticky for that file's notes
+ [ ] `pnpm run check` green
+ manual: open a folder with mixed `nt_card` values across files - toolbar shows "Auto (...)" with the majority-voted card type
+ manual: explicitly set card type to "Sticky" - all notes render compactly across columns
+ manual: switch back to "Auto" - auto resolution recovers
+ acceptance
  + a second selector appears with the same Auto / explicit semantics as the view-type selector
  + `nt_card` linetag at file H1 cascades into the auto-resolved card type for that file
  + `StickyNote` renders pill + title only; switching back to `card` restores the full card
+ open questions for the implementing agent
  + per-note `nt_card` override (currently file-level only) - defer to a follow-up unless trivial
  + whether the two selectors share a single composite control or stay as two siblings - leaning two siblings for symmetry with "Auto (Kanban)"
+ commit message draft
  + introduce `nt_card` linetag and `CardRegistry` - second selector "Auto (Card)" picks between `card` (full) and `sticky` (compact summary); `nt_card` on file H1 cascades into auto-resolution
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


### Optimisation review 2026-07

Systemic findings from a deep multi-agent optimisation review (scout + 5 dimension reviewers + synthesis + per-item adversarial verification against the code, 2026-07). The review independently converged on the existing kanban perf cycle and verified its premises at specific sites; the tasks below are the additional findings not already scoped there.

+ verified and already scoped in the perf cycle - no duplicate tasks here, evidence recorded for confidence
  + per-doc conversion caching keyed on (id, hash): confirmed missing in folder mode (single-file NoteTreeComposer already memoises on hash; folder merge and useAutoIntegration both re-convert) - covered by [[kanban-incremental-merge]]
  + folder-entry message storm: confirmed per-file posts then a whole-map aggregate re-post (double-ship), no batching on the host side - covered by [[kanban-folder-load-coalescing]]
  + full-corpus setState per edit tick incl. mdast: confirmed synchronous, undebounced - covered by [[webview-state-persistence-diet]]; small delta: also release the module-scope saved_state pin (ExtensionReceiver.tsx:22) after first consumption to free the restored corpus

+ [ ] Restore webview code splitting: drop LimitChunkCountPlugin and switch chunk loading to browser-style
  + the single-bundle constraint applies to the extension host only; the webview config also declares target 'webworker' (webpack.config.js:111), so set target 'web' or output.chunkLoading 'jsonp' for the webview config alongside removing the plugin (webpack.config.js:164)
  + React.lazy splitting is already written but collapsed: GenericView lazy-loads the views and GenericNote lazy-loads MermaidNote (mermaid's static import lives only inside that lazy subtree); built dist/index.js is currently 11.9MB dev
  + set __webpack_public_path__ from asWebviewUri and __webpack_nonce__ so injected chunk script tags pass the CSP (notethinkEditor.ts:83); the extension-host config's LimitChunkCountPlugin (webpack.config.js:76) must stay
  + retainContextWhenHidden (notethinkEditor.ts:16) means every hidden tab keeps the whole parsed bundle resident today
  + refs: webpack.config.js:164, webpack.config.js:111, client/webview/src/notethink-views/src/components/views/GenericView.tsx:15, client/webview/src/notethink-views/src/components/notes/GenericNote.tsx:11, client/extension/src/vscode/notethinkEditor.ts:16
  + impact: multi-MB less JS fetched and parsed on every panel open; users who never render a diagram stop paying for mermaid entirely; effort: M

+ [ ] Cut extension-host startup and vsix weight: trim activation events and replace winston with the native LogOutputChannel
  + activationEvents include onStartupFinished and onLanguage:markdown, but activate() only registers the custom editor, a webview serializer and commands - onCustomEditor/onWebviewPanel suffice, so the 666KB bundle currently loads in every VS Code window for nothing
  + winston wraps an output channel created with {log:true} that natively provides levels and timestamps (file logging is separately hand-rolled via workspace.fs); deleting winston removes 11 root polyfill deps and the webpack resolve.fallback list
  + vscode-languageclient 9.0.1 is declared with zero usages (grep-verified); drop it
  + .vscodeignore's 'dist/**/test/**' is anchored at the package root and does not match client/extension/dist/test/**, so a 361KB dead mocha bundle ships in every marketplace vsix - fix the glob
  + refs: package.json:31, client/extension/src/lib/errorops.ts:94, webpack.config.js:46, .vscodeignore:7
  + impact: zero startup cost until first NoteThink use and a 70-80% smaller extension bundle for every install; effort: M

+ [ ] Hoist stable handler and display_options objects so GenericNote's React.memo stops whole-tree reconciles
  + GenericNote is React.memo with default shallow equality, but KanbanBoard passes fresh display_options and handlers object literals per Draggable render, and buildChildNoteDisplayOptions allocates a new object per call - the memo never passes
  + DocumentView already hoists stable note_handlers via useMemo but still calls buildChildNoteDisplayOptions inline, so its props stay unstable too; useViewContext also rebuilds display_options and sorts in place per render
  + add a custom areEqual on note identity plus focus/selection scalars; derive per-note flags at the view level; complements the stable_id/seq work in [[kanban-incremental-merge]]
  + cheap follow-on: content-visibility:auto on cards to skip offscreen layout until [[kanban-virtualized-columns]] lands
  + refs (client/webview/src/notethink-views/src/): components/notes/GenericNote.tsx:15, components/views/kanban/KanbanBoard.tsx:101, lib/noteui.ts:265, components/views/generic/useViewContext.ts:41
  + impact: caret movement and typing become O(affected notes) instead of O(all notes), attacking the documented 50k-fibers-per-commit crash cliff; effort: M

+ [ ] Hash-gate and visibility-gate PanelSession posts (small delta to [[kanban-folder-load-coalescing]])
  + watcher onDidCreate/onDidChange and sendDoc never compare hash or mtime before re-parsing and re-posting, so every save ships the doc twice
  + no webviewPanel.visible check gates background work anywhere in PanelSession - hidden and duplicate panels run the full pipeline
  + fold into the coalescing story when picked up, or land as a small standalone
  + refs: client/extension/src/vscode/PanelSession.ts:964, client/extension/src/vscode/PanelSession.ts:166
  + impact: eliminates redundant parse and post work on every save and for hidden panels; effort: S
