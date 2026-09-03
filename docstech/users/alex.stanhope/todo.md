# Todo [](?nt_view=kanban)


### Unify how settings persist [](?id=settings-persistence-unify&status=doing)

Three mechanisms sit behind controls that look identical, so the drawer cannot honestly say how many settings differ from their defaults. This gates [[view-settings-tree-drawer]]: the diverged marker, the count and both default actions all need one comparison and one write path.

+ goal
  + every setting the settings drawer renders reads and writes through one mechanism
  + "diverged from its default" is computable for every one of them
  + promote and revert act on everything the drawer shows, not on a subset
+ background
  + `client/extension/src/lib/settings.ts` holds `SETTINGS`, the canonical map of path, default, `inCascade` and owning registry `node`
  + `handlePromoteSettings` iterates `cascadeKeys()`, so only `inCascade: true` keys are ever promoted
  + `inCascade: false` keys write straight to a fixed target from `GLOBAL_SETTING_TARGETS`
    + `showLineNumbers` writes to Workspace
    + `watchUnopenedFilesInViewer`, `kanbanAnimateTransitions` and `openNewEditorIfNoneOpen` write to Global
  + `showLinetagsInHeadlines`, `scrollNoteIntoView` and `autoExpandFocusedNote` are absent from `SETTINGS` and live only in per-session viewState
  + precedence today is viewState override, then the extension cascade, then the webview built-in default
  + so three drawer controls can never be promoted or reverted, and four more already sit at their final layer
+ scope
  + declare the three viewState-only settings in `SETTINGS` with a default and an owning node
  + settle one write-target policy and apply it to every key rather than per key
  + widen promote and revert to every `SETTINGS` key the drawer renders
  + expose a per-key diverged result the webview can render
+ out of scope
  + the drawer's layout, which is [[view-settings-tree-drawer]]
  + changing any setting's default value
  + the include and exclude filters, which the Files drawer owns
+ delivered in passing
  + `notethink.toggleLineNumbers` was writing `notethink.showLineNumbers`, an undeclared key nothing reads; it now goes through `writeSetting`
  + `showContextBars` is retired entirely - no renderer ever consumed it, so its config key, command, menu entry and orphaned `.contextBar` CSS are gone
  + the webview no longer holds an optimistic copy of a setting, so a control shows its old value for the frame between the click and the extension's echo; the specs assert with a retrying expect rather than `.check()`
+ files
  + `client/extension/src/lib/settings.ts` - the map, plus a diverged-from-default helper
  + `client/extension/src/vscode/PanelSession.ts` - promote, reset, and the per-setting write target
  + `client/webview/src/lib/composerops.ts` - precedence, once viewState is no longer a separate tier
  + `client/webview/src/notethink-views/src/types/Messages.ts` - cascade payload carries the per-key diverged flags
+ [X] declare the three viewState-only settings in `SETTINGS` with defaults and owning nodes
  + `groupBy` was a fourth control with the same defect, so it went in too, and the drawer's `?? false` for `scrollNoteIntoView` was correcting a default the running code already had as `true`
  + `orientation`, `kanbanGroupBy` and `cardType` joined at the same time, since the drawer renders them in [[view-settings-tree-drawer]] and [[view-hierarchy-and-card-types]]
+ [X] settle and apply one write-target policy across every key
  + every key writes Workspace as the user changes it and promotes to User on save; `editTarget()` falls back to User in a folderless window, where a Workspace write throws
  + `inCascade`, `cascadeKeys()`, `GLOBAL_SETTING_TARGETS`, `updateGlobalSetting` and the `globalSettings` message are all gone - one message each way
+ [X] widen promote and revert to every key the drawer renders
+ [X] add a diverged-from-default helper and carry its result in the cascade payload
  + diverged means "differs from the saved default", the User value when set and the built-in otherwise, so both default actions drive the count to zero
+ [X] jest: every key the drawer renders reports a diverged flag
+ [X] jest: a key at its default reports not diverged, and an override reports diverged
+ [X] jest: promote covers every drawer key and the diverged count falls to zero afterwards
+ [X] jest: revert clears the override and restores the default for each kind of key
+ [X] jest: no `SETTINGS` key lacks a default, and no key the drawer renders is unreachable by promote
  + written as jest, not mocha: `client/extension/src/test/suite/**` is excluded by `jest.config.cjs` and run by no script in the repo, so a mocha test would never execute
+ [X] `pnpm run check` green
  + 1809 jest across three projects and 129 playwright, lint 0 errors
+ manual: toggle each control, reload the window, and confirm each value survives as the settled policy says
+ acceptance criteria
  + one write path and one comparison serve every setting the drawer shows
  + a count of diverged settings is derivable with no special cases
  + no drawer control is silently excluded from promote or revert


### View settings tab: type tree and aligned rows [](?id=view-settings-tree-drawer&status=doing)

The drawer becomes two panes: the view-type tree on the left, that type's settings on the right in four aligned columns. Depends on [[settings-persistence-unify]] for the diverged marker and the default actions. The card half is [[view-hierarchy-and-card-types]].

+ goal
  + the view-type registry renders as a tree, and the tree is how a view type is chosen
  + settings read most-specific-first, so the nearest and most-used sit at the top
  + a setting's owning type is visible without being loud, and decides whether changing it offers a new type
+ background
  + `role="tree"` appears once in the webview (`JumpDrawer.tsx`), hand-rolled with no recursion, so a shared tree has to be extracted
  + `viewregistryops.ts` already carries the hierarchy, each setting's home node, and the fixed and open override modes
  + `settings.ts` already carries an owning `node` per key, which is what the right-hand pill renders - no second table is needed
  + `orientation` homes at line and the board honours it (`LineView.tsx:77`), but no drawer renders it, so it is unreachable today
  + `showContextBars` is declared in `SETTINGS` with node root and likewise has no control anywhere
  + clicking a node and switching to it are two different acts, since `root` and `grouped` own settings but cannot render
  + `selectable` is doing both jobs and wants splitting into `selectable` (switchable) and `configurable` (has settings)
+ scope - the tree
  + extract the `jumpTree*` glyph and indent pattern into a shared recursive component, and repoint JumpDrawer at it
  + render the whole registry, `root` labelled "All views" and `grouped` included, both clickable for their settings
  + carry two independent marks per row: a radio for the type the board renders, a highlight for the type whose settings show
  + give a radio only to types that can render, so abstract nodes read as settings-only
  + show a per-node count of the settings that node owns, and keep future rungs dimmed
+ scope - the settings pane
  + lay every row out as four aligned columns: marker, name, control, owning-type pill
  + order rows most-specific-first - Kanban, then Line, then Grouped, then All views
  + head the columns "View settings" and "View type"
  + group settings belonging to no view type under a "Global settings" heading, and give them no pill
  + mark a diverged row with an M in `gitDecoration.modifiedResourceForeground`, light `#895503` and dark `#E2C08D`
  + tint the diverged row's label to the same colour, matching how the VS Code explorer treats a modified filename
  + retire the view-type `<select>` from `SettingsCommonControls`, since the tree is the selector
  + add the missing controls for `orientation` and `showContextBars`
  + make Group by editable here by writing a kanban-level open override rather than changing the ancestor
+ scope - defaults and divergence
  + replace the three cascade buttons with a collapsed "Change defaults" holding "Save as default" and "Revert to defaults"
  + state the count as "N settings diverged from the defaults and already saved"
  + offer "Save as a new view type" only when the changed setting's pill names a type above the selected one
    + resolved 2026-09-03: this bullet and the jest bullet below contradicted each other over All views, and the jest bullet won - root owns the generic settings every view inherits, so changing one is a preference rather than a new type. Root is exempt; every other ancestor offers
  + prompt for a name on save, pre-filled with the type plus what changed, for example "Kanban by Assignee"
+ out of scope
  + the card-type tab and card settings, which are [[view-hierarchy-and-card-types]]
  + one write path for every setting, which is [[settings-persistence-unify]]
  + moving the Global settings into the Files drawer
+ files
  + new `client/webview/src/notethink-views/src/components/views/drawers/DrawerTree.tsx` - shared, recursive
  + `client/webview/src/notethink-views/src/components/views/drawers/JumpDrawer.tsx` - repoint at it
  + `client/webview/src/notethink-views/src/components/views/drawers/SettingsKanbanDrawer.tsx` - the two-pane body
  + `client/webview/src/notethink-views/src/components/views/SettingsCommonControls.tsx` - selector leaves, rows become four-column
  + `client/webview/src/notethink-views/src/lib/viewregistryops.ts` - split `selectable` from `configurable`
  + `client/webview/src/notethink-views/src/components/ViewRenderer.module.scss` - tree, pane and row classes
+ [X] extract the shared recursive tree component from JumpDrawer's inline markup
+ [X] repoint JumpDrawer at it with no behaviour change
  + `JumpDrawer.test.tsx` was not edited and its 8 tests still pass, which is the proof the extraction preserved behaviour
+ [X] split `selectable` from `configurable` in the registry and update `unlockingViewOnChain`
  + `unlockingViewOnChain` reads `configurable`: it answers where a setting is editable, and the tree offers a node's settings whether or not the board can render it
+ [X] render the whole registry in the left pane with per-node owned-setting counts
+ [X] carry the radio and the highlight as two independent marks
  + the radio switches the board, the highlight moves the pane; clicking an abstract node moves only the highlight, which is what makes root and grouped usable
+ [X] lay the settings pane out as four aligned columns with the owning-type pill
+ [X] order rows most-specific-first and head the columns "View settings" and "View type"
+ [X] group pill-less settings under a "Global settings" heading
+ [X] render the M marker and the label tint for a diverged setting
  + the count is of M-marked rows rather than of `diverged.length`, so a diverged Files-drawer setting that renders no row here is not counted
+ [X] remove the view-type select and add the control for `orientation`
  + `showContextBars` was the other half of this task and is retired instead: no renderer ever consumed it, so a checkbox would have done nothing
+ [X] make Group by editable via a kanban-level open override
  + the row is one setting spelled by two keys, collapsing to whichever is homed deepest, so it writes `kanbanGroupBy` from a kanban board and the ancestor's key from anywhere above
+ [X] replace the cascade buttons with the collapsed "Change defaults" pair
  + the Files drawer keeps `SettingsCascadeButtons` untouched, which is where the built-in restore stays reachable
+ [X] offer "Save as a new view type" on an ancestor-owned change, with a pre-filled name prompt
  + saving mints a real selectable type: it persists to `view.userTypes`, the registry merges it into the tree, and GenericView resolves its component by walking the minted node's chain
+ [X] jest: the tree renders the registry hierarchy and abstract nodes carry no radio
+ [X] jest: clicking an abstract node shows its settings and leaves the rendered view alone
+ [X] jest: rows sort most-specific-first and each carries its owning type
+ [X] jest: an ancestor-owned setting offers a new view type, and one owned by the node or by All views does not
+ [X] jest: changing Group by from kanban writes a kanban override and leaves Line alone
+ [X] jest: the diverged count equals the number of M-marked rows
+ [X] playwright: the jump drawer's tree is unchanged after the extraction
  + `breadcrumb-jump.spec.ts` and `JumpDrawer.test.tsx` both pass unedited, which is the evidence the extraction preserved behaviour
+ [X] playwright: open the view settings tab, change Group by, and the new-view-type offer appears
+ [X] playwright: change Column order and confirm no offer appears
+ [X] playwright: toggle a Global setting and confirm no offer appears
+ [X] playwright: expand "Change defaults", save as default, and the diverged count falls to zero
+ [X] `pnpm run check` green
  + 1844 jest across three projects and 133 playwright, lint 0 errors
+ manual: compare the M colour against a modified file in the VS Code explorer side by side
+ manual: confirm the name and control columns stay aligned at the narrowest usable drawer width
+ acceptance criteria
  + no view-type `<select>` remains, and the tree is the selector
  + the view tree and the jump tree render from one component
  + every row shows its owning type, or no pill when it belongs to none
  + the new-view-type offer follows the pill and needs no per-setting list


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

Every card mounts into the DOM: 200 files x 10 stories = 2000 `Draggable` cards (`KanbanBoard.tsx:96-127`), each rendering markdown, and the FLIP layer measures every `[data-flip-id]` node with getBoundingClientRect on each membership change (`useFlipTransition.ts:292`, fired per merge via the `signature` memo). CPU profiles show querySelectorAll + getAnimations at ~9-12% of load. @hello-pangea/dnd officially supports virtual lists (react-window pattern, overscan required). The factor-out this story asked to coordinate with is now [[line-view]], and the ordering is resolved: it lands FIRST, so windowing is implemented once in `LineView` and every grouped view inherits it. This is the only story in the perf cycle that the view programme blocks.

+ goal
  + DOM card count is bounded by viewport + overscan regardless of corpus size; scrolling a column streams cards in (the infinite-scroll feel)
  + FLIP measurement cost scales with visible cards, not total cards
+ scope
  + adopt react-window (or equivalent fixed/variable-size list) per kanban column following the dnd virtual-lists pattern, with overscanning and drag-clone rendering per their docs
  + variable card heights: measure-and-cache strategy (cards clip to a max height already via useMarkdownNoteOverflow)
  + scroll-to-focused-card (`useScrollToCaret`, viewhooks.ts) must ask the virtualizer to scroll before framing; keyboard navigation and the focus ring rules (CODING_STANDARDS Focused-note scroll framing) still hold
  + FLIP: restrict measure/animate to mounted (visible) cards; skip animation entirely when a membership change exceeds a threshold (bulk load)
  + land inside `LineView` so grouped views inherit it - [[line-view]] is a hard prerequisite, not a coordination question
+ out of scope
  + virtualizing document view (different scroll model; follow-up once LineView ships)
+ acceptance criteria
  + 200-file board: mounted cards <= visible + overscan (assert via DOM count in the harness); folder-200 settled load <= 8s prod with prior stories landed
  + card click and selectionChanged on the 200-file board <= 200ms with no long task > 100ms
  + all kanban drag playwright specs green, including cross-column drags of cards that start off-screen (add spec)
  + keyboard navigation + focused-card scroll framing specs green (focus ring fully visible per CODING_STANDARDS)
  + kanban-animation specs green with FLIP scoped to visible cards; bulk-load renders skip animation (assert via animation probe events)
+ [ ] implement windowed lanes inside `LineView` per the dnd virtual pattern (after [[line-view]])
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


### Per-view card-type axis [](?id=view-hierarchy-and-card-types&status=doing)

The view-hierarchy half of this story was split out to [[line-view]] on 2026-07-17: it gates the view programme, this card axis does not, and bundling them was blocking the gate. What remains is the orthogonal card-type axis, which now stands alone and can run any time after [[view-registry]] (each view declares its default card type, which is a registry entry).

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
  + the view hierarchy and the `LineView` factor-out - split to [[line-view]] 2026-07-17
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
+ scope - card settings tab
  + add a second settings tab beside the view settings tab, titled by the resolved card type
  + render the card-type registry as a tree with `All cards` as the parent and "Card types" as the list heading
  + reuse `DrawerTree` and the four-column row layout from [[view-settings-tree-drawer]] rather than forking them
  + head the columns "Card settings" and "Card type"
  + move `showLinetagsInHeadlines`, `showLineNumbers`, `showContextBars` and `autoExpandFocusedNote` onto the card side, owned by `All cards`
  + apply the same new-type rule, so an ancestor-owned card setting offers "Save as a new card type"
+ [X] introduce `CardRegistry` with `card` (existing `MarkdownNote`) + `sticky` (new `StickyNote`)
  + built as a registry mirroring `viewregistryops`, not a flat `SELECTABLE_CARDTYPES` array, so the card axis is queried the same way the view axis already is
+ [X] add `nt_card` linetag parsing in `mergeAggregateRoot`; capture on `origin.file_card_type`
+ [X] add card-type auto-resolution in `AutoView` mirroring the view-type majority vote
+ [ ] add the card-type selector - "Auto (Card)" / "Card" / "Sticky"
  + operator decision 2026-09-02: delivered as the card tab's tree rather than a second `<select>`, symmetric with the view axis, since [[view-settings-tree-drawer]] retires the view-type `<select>` and makes its tree the selector
  + the tab is titled by the resolved card type, so the toolbar states the current card and the drawer holds the control that changes it - the same split the view tab already uses
+ [X] each view declares its default card type (kanban → `'card'`); auto picks the default when no `nt_card` votes are present
  + declared as `view_defaults` data walked against the view registry's own chain, so a new default is one row rather than a dispatch-site edit
+ [ ] add the card settings tab beside the view settings tab, titled by resolved card type
+ [ ] render the card-type tree with `All cards` as parent, reusing `DrawerTree`
+ [ ] move the four card-owned settings off the view tab and onto the card tab
+ [ ] apply the four-column layout, the diverged marker and the new-card-type offer rule
+ [ ] jest: the card tree renders from the card registry and reuses the shared tree component
+ [ ] jest: the four migrated settings render on the card tab and no longer on the view tab
+ [ ] playwright: change a card-type-owned setting and the new-card-type offer appears
+ [X] jest: `CardRegistry` returns `MarkdownNote` for `'card'`, `StickyNote` for `'sticky'`, falls back to view default for `'auto'`
+ [X] jest: `nt_card` on a file H1 is captured into `origin.file_card_type`
+ [X] jest: `AutoView` majority-votes card type independently of view type
+ [ ] playwright: switch second selector from "Auto" to "Sticky" - note cards collapse to compact form
+ [X] playwright: file with `nt_card=sticky` on H1 in folder mode - auto-resolved card type is sticky for that file's notes
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
  + whether the two selectors share a single composite control or stay as two siblings - settled 2026-09-02: neither, both axes are chosen from their tab's tree
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


### Optimisation review 2026-07 for notethink

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


### l10n bundles are not checked for untranslated values [](?id=l10n-untranslated-check&time_estimated=45)

`client/extension/src/l10n/l10n-bundles.test.ts` is thorough: key parity in both directions, non-empty values, and placeholder preservation, over both `bundle.l10n.*.json` (68 keys) and `package.nls.*.json` (26 keys) for de/es/fr/it. The one check it lacks is whether a value was ever translated, and it is the check that catches a new string shipped as English in four languages.

+ background:
  + a sibling project's i18n test has this assertion (`no es values are identical to en (except proper nouns)`) with a flat `allowed_same` key allowlist. It is the only one of the four notethink is missing; conversely notethink's placeholder-preservation check is one that sibling lacks, and a story is filed there for that direction.
  + counts below were measured 2026-08-03 and re-verified unchanged 2026-08-04
  + the current state is close to clean: `Auto ({0})` identical in all four bundles, `Position:` in de, `Collisions` in fr, and `displayName` / `editor.displayName` / `config.title` identical in all four `package.nls` files - six bundle exceptions and twelve nls exceptions in total
  + the three `package.nls` entries are the extension's marketplace identity and are deliberately untranslated; the three bundle entries need a judgement call
  + note the bundle keys ARE the English strings in `@vscode/l10n`, so "identical to en" here means comparing each value against its own key, not against a separate en file. `bundle.l10n.json` exists and can be used as the baseline, which is what the existing describe block already does - verified: all 68 of its entries have key === value, so the two baselines are equivalent.
+ triage of the three bundle exceptions (assessed 2026-08-04, confirm before acting)
  + `Position:` (de) is the German word, and es/fr/it already differ (`Posición:`, `Position :`, `Posizione:`) - correct, allowlist it
  + `Collisions` (fr) is French, and de/es/it already differ (`Kollisionen`, `Colisiones`, `Collisioni`) - correct, allowlist it
  + `Auto ({0})` is the likely real defect and the reason this check earns its keep: in German and Italian "Auto" means *car*, so de wants "Automatisch" and it wants "Automatico". fr and es "Auto" is a defensible abbreviation of automatique / automático. Used at `ViewIntegrationSelector.tsx:50`.
+ [ ] add an identical-to-en assertion to both describe blocks, with an allowlist
+ [ ] decide whether `Position:`, `Collisions` and `Auto ({0})` are correct translations or oversights, then translate or allowlist
+ acceptance criteria
  + assertion green with every exception named and commented
  + a new key added to `bundle.l10n.json` and copied verbatim into the four locale bundles fails the test


### The extension logger's format is built and never wired to it [](?id=errorops-logger-format-unwired&time_estimated=45)

`client/extension/src/lib/errorops.ts` composes a full winston format into `_default_format`, then calls `winston.createLogger({level, transports})` and never passes it. The extension's Output Channel therefore shows none of what that format was written to add.

+ surfaced 2026-08-11 by the `@typescript-eslint/no-unused-vars` rollout, which is the third time in this workspace that rule has found a wiring gap rather than dead code
+ what is actually lost, reading the composed format at `errorops.ts:87-96`
  + `winston.format.timestamp` - no timestamp on any line
  + `winston.format.errors({stack: true})` - no stack on a logged Error
  + `winston.format(combineTransform)()` - **this is the significant one.** `combineTransform` (`errorops.ts:72`) reads the winston `splat` symbol and interpolates a multi-argument call's extra arguments into the message. Without it, `writeToLog('thing %s', value)` renders the raw `%s` and silently discards `value`
  + `winston.format.printf` - the level-prefixed line shape
  + `winston.format.colorize`
+ `combineTransform` has exactly one reference, inside the unwired format, so it has never run
+ [ ] confirm the loss against a real log line before changing anything: call the logger with an extra argument and read the Output Channel
+ [ ] wire the format into `createLogger`, or delete both it and `combineTransform` if the current bare output is what is wanted
  + the comment says "different format is used for some transports", which suggests a second format was planned and only one transport exists. Decide which is true before wiring
+ [ ] cover the splat interpolation with a test, since nothing would have caught this
+ acceptance criteria
  + a multi-argument log call renders its arguments, verified by reading the output, not by reading the format
+ the binding is underscored rather than deleted, so the intent stays visible until this is decided


### Two playwright specs capture a value and never assert on it [](?id=keyboard-nav-drill-assertions&time_estimated=60)

Both were found by the same lint rollout on 2026-08-11. Each computes exactly the value its title implies it checks, then never compares it, so neither spec can fail on the behaviour it names.

+ `playwright/specs/keyboard-navigation.spec.ts:113` captures `_parent_after_drill`, drills out, captures `parent_after_out`, and asserts only `expect(parent_after_out).toBeDefined()`
  + `getAttribute` returns `string | null`, and `toBeDefined()` passes on `null`, so the one assertion that does run holds even when the attribute is absent entirely
  + [ ] assert the drill-in value differs from the pre-drill value, and that drill-out restores it
+ `playwright/specs/settings-toggle.spec.ts:12` is titled "toggling lineNumbers shows and hides line number elements" and asserts neither
  + it counts line-number spans into `_lineno_count`, toggles on, asserts only that a row is visible - which was already true before the toggle - toggles off, and ends
  + the two comment blocks at `:18` and `:42` describe the assertions that were never written
  + [ ] assert the count is zero at baseline, non-zero after toggling on, and back to zero after toggling off
+ acceptance criteria
  + each spec fails when its behaviour is deliberately broken, verified by breaking it once
+ both bindings are underscored rather than deleted, so the intent stays visible
