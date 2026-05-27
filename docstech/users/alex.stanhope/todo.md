# Todo [](?ng_view=kanban)


### Spinner during non-instantaneous operations (settings + navigation + any work the user is waiting on) [](?id=pending-work-spinner)

The user needs a consistent signal that *something is happening* whenever notethink is doing work they're waiting on — not just settings changes. Two classes of slow work today:

1. **Settings round-trips.** A drawer-driven settings change (boolean toggle or filter edit) posts a message and waits for the echo back. Filter changes additionally trigger a workspace glob + re-aggregation, which can take seconds.
2. **Navigation that triggers file discovery + load.** Clicking up the breadcrumb (e.g. `notethink/` → `active_development/`) calls `enterFolderMode(new_path)` which clears `integration_docs`, re-runs `findFiles`, fires per-file `loadFolderDoc` calls via `Promise.allSettled`, and emits a bulk replace once they settle. With 50+ markdown files in a workspace this is the most user-visible slow path — 4–5 seconds, with no UI feedback at all today.

Things that are **fast** and should NOT show the spinner:

- Integration-mode flips (`folder` ↔ `current_file`) — essentially synchronous webview state changes.
- Breadcrumb clicks that re-enter folder mode but happen to find no new files to load (e.g. descending into a subfolder whose docs were already loaded, or clicking the breadcrumb segment matching the current path). The visible work in those cases is just a re-aggregation of already-loaded docs — typically tens of milliseconds.

Show an SVG spinner whenever the extension reports it's doing work that will actually take time. The user's mental model: "I just did something that wasn't free, and the panel is showing me a spinner — so I know it's working."

+ goal
  + a visible spinner appears as soon as a slow path starts, disappears as soon as the view has settled
  + works uniformly across settings round-trips and folder-discovery navigation — not a settings-only feature
  + fast operations (mode flips, no-op breadcrumb clicks, instant settings toggles) do NOT flash the spinner
  + the user never has to wonder "did my change take? is it still loading?"
+ reference pattern
  + `oma/nodejs/aawai/src/components/Loader.tsx` and `calfam/nodejs/calfam-nextjs/src/components/Loader.tsx` — both wrap `react-spinners`' `SyncLoader` in a small `<Loader>` component driven by a `useLoading()` hook (`{loading, setLoading}`), with positioning via a `positionClass` prop and a CSS module
  + notethink should match the pattern's *shape* (small component + hook + position class), not the implementation library — inline SVG keeps `notethink-views` dep-free
+ scope (v1 — both slow-work classes, drawer + toolbar mounts)
  + add `<Spinner>` — small inline SVG component (no runtime dep), with a CSS `@keyframes rotate` and a `@media (prefers-reduced-motion: reduce)` fallback that disables the rotation. `positionClass` prop matching `oma`/`calfam`'s precedent (`InlineLoader`, `TopRightLoader`, etc.)
  + add `usePendingWork()` hook exposing `{ pending, markPending(key), clearPending(key), clearAll() }` — broader than the original settings-specific framing. Keyed by string so the same hook serves multiple distinct slow-work sources. State value `pending` is snake_compatible; function handles use camelCase per `CODING_STANDARDS.md > Hook Return Values`. Hook + spinner are internal symbols (not stored externally), so no permanent-name sign-off needed
  + well-known keys (sentinel strings the hook treats specially): `'folderDiscovery'` (extension-driven), `'settingsCascade'` (settings round-trip), `'<SettingKey>'` (one per cascade key for fine-grained per-setting tracking)
  + extension emits a new wire-format message **`pendingChange`** with `{ key: string, on: boolean }`:
    + **`enterFolderMode` / `discoverFolderDocs`**: post `{ key: 'folderDiscovery', on: true }` BEFORE the `findFiles` walk **only if** the new set actually requires loading new files (compare the discovered URI list against the current `integration_docs` — if every URI is already loaded and unchanged, skip the spinner entirely). Post `{ key: 'folderDiscovery', on: false }` from `Promise.allSettled().then(...)` after the bulk replace is sent
    + **settings-change handlers**: existing webview-side `markPending(<SettingKey>)` at message-post time stays as-is; extension does not need to echo `pendingChange` for these (the existing `settingsCascade` / aggregated-payload echo reducers already clear them on the webview side)
  + webview message reducer for `pendingChange` calls `markPending(key)` when `on: true` and `clearPending(key)` when `on: false`
  + **delay-then-show** policy (replaces the original "250 ms min visibility"): the spinner appears only after `pending` has been continuously `true` for ≥150 ms, and remains visible for ≥250 ms once shown. This way an operation that finishes in 100 ms never visibly flashes the spinner; one that takes 200 ms+ shows briefly; one that takes 5 s shows for the duration. Tunable constants — surface in `client/{extension,webview}/src/constants.ts` if either side needs to reference them (TBD during implementation)
  + safety net: any individual `markPending(key)` is auto-cleared after 10 s if no matching `clearPending` arrives. Logged via `debug()` so dropped echoes / unfinished extension work are traceable in dev (extended from 5 s in the original story because navigation discovery on very large workspaces can legitimately exceed 5 s)
  + render the spinner in BOTH drawers (view settings, file settings) — original story scope retained — AND in the **main toolbar** next to the breadcrumb. The toolbar mount catches the navigation case (drawer might be closed during a breadcrumb-driven discovery); the drawer mounts catch the settings case (user is typically looking at the drawer when they edit a setting)
+ skip cases (verified during implementation)
  + integration-mode flip (`folder` → `current_file` or back) — no `pendingChange` is emitted by `enterCurrentFileMode` / `enterFolderMode` when the new state is reachable without loading work. Mode flip with no concurrent work shows no spinner
  + breadcrumb click that resolves to the same effective file set — `findFiles` returns URIs that are all already in `integration_docs` with matching hashes; extension skips the `pendingChange` emit and just sends the re-aggregated payload. Fast path, no spinner
  + every settings cascade key write that completes within the 150 ms delay threshold — no visible spinner
+ scope deferred to v2 (call out, do not implement now)
  + per-control spinners (a tiny spinner next to each control that's currently pending) — useful when multiple settings are mutated rapidly, but adds layout/aria complexity
  + spinner-during-passive-update (e.g. external file edit triggers a re-parse) — currently silent; consider after [[animated-passive-transitions]] lands so the spinner doesn't fight the FLIP layer
  + animation/easing tuning to match the kanban FLIP transitions story [[animated-passive-transitions]]
+ files
  + new `client/webview/src/notethink-views/src/components/Spinner.tsx` — inline-SVG component
  + new `client/webview/src/notethink-views/src/components/Spinner.module.scss` — class names follow `oma`'s naming where applicable: `Spinner`, `InlineLoader`, `TopRightLoader`; `@media (prefers-reduced-motion: reduce)` disables the rotation keyframes
  + new `client/webview/src/notethink-views/src/hooks/usePendingWork.ts` — hook with the mark/clear API and the delay-then-show policy
  + `client/webview/src/notethink-views/src/components/views/SettingsCommonControls.tsx` — render `<Spinner positionClass="InlineLoader" />` in the drawer header when `pending` is true
  + `client/webview/src/notethink-views/src/components/views/FilesDrawer.tsx` — render `<Spinner positionClass="InlineLoader" />` in the drawer header when `pending` is true
  + `client/webview/src/notethink-views/src/components/views/generic/GenericViewToolbar.tsx` — render `<Spinner positionClass="InlineLoader" />` next to the breadcrumb when `pending` is true (this is the toolbar mount for the navigation case)
  + `client/webview/src/notethink-views/src/components/views/generic/useViewToolbar.ts` — `cascade_write_setting` and `handle_global_setting_change` call `markPending(<SettingKey>)` before `postMessage`
  + `client/webview/src/notethink-views/src/components/views/generic/useViewHandlers.ts` — `handle_apply_filters` calls `markPending('integrationFilters')` before its messages
  + `client/webview/src/components/ExtensionReceiver.tsx` (or `useVscodeMessages.ts`) — new `pendingChange` message handler routes to the hook's `markPending` / `clearPending`; existing settings echo reducers still clear their own keys
  + `client/extension/src/vscode/PanelSession.ts` — `discoverFolderDocs` emits `pendingChange { key: 'folderDiscovery', on: true }` at the start (only when there's actual loading work to do — compare discovered URIs against `integration_docs` cache) and `{ on: false }` from the `Promise.allSettled().then` block after the bulk replace
  + `usePendingWork` instance lifted to the common ancestor of both drawers, the toolbar, and `ExtensionReceiver.tsx` — probably `App.tsx` / `base/App.tsx` or a small React Context if prop-drilling is unpleasant
+ open question
  + **fast-path detection for folder discovery.** Recommend: in `discoverFolderDocs`, after `findFiles` returns, compute a hash-set of `{path, mtime}` for each discovered URI; compare against `integration_docs[*].{path, mtime}`. If the sets match exactly (no new files, no missing files, no mtime changes), skip the bulk re-load entirely and just re-emit the aggregated payload (the merge/render is the only work). Cheap detection + skip-load = no spinner flash for breadcrumb clicks that don't change anything. Confirm or propose alternative
+ edge cases
  + user changes a setting then immediately navigates the breadcrumb — multiple keys outstanding; the spinner shows until *all* are cleared
  + extension never echoes — 10 s per-key safety-net clears; spinner stops
  + fast operation that finishes in <150 ms — spinner never appears (delay-then-show)
  + slow operation that completes between 150 ms and 250 ms after the mark — spinner appears for at least 250 ms (min-visibility)
  + tests should not hang on the safety-net timeout — `clearAll()` exposed for test cleanup
+ [ ] add `<Spinner>` inline-SVG component with `prefers-reduced-motion` fallback
+ [ ] add `usePendingWork` hook: `{ pending, markPending, clearPending, clearAll }`; 150 ms delay-then-show; 250 ms min-visibility once shown; 10 s per-key safety net
+ [ ] lift the hook instance to the shared parent of both drawers + toolbar + `ExtensionReceiver.tsx`
+ [ ] wire `markPending(<SettingKey>)` into `cascade_write_setting` and `handle_global_setting_change`; `markPending('integrationFilters')` into `handle_apply_filters`
+ [ ] wire `clearPending(<key>)` into the existing `globalSettings` / `settingsCascade` / aggregated-payload echo reducers
+ [ ] add `pendingChange` message type; webview reducer marks / clears the keyed pending state
+ [ ] extension: `discoverFolderDocs` emits `pendingChange { key: 'folderDiscovery', on: true }` ONLY when the discovered set requires loading new files (vs already-cached URIs with matching mtimes); emits `{ on: false }` from `Promise.allSettled().then` after bulk replace is sent
+ [ ] render `<Spinner>` in `SettingsCommonControls.tsx`, `FilesDrawer.tsx`, and `GenericViewToolbar.tsx` when `pending` is true
+ [ ] respect `prefers-reduced-motion`
+ [ ] jest: `usePendingWork` — pending true after a mark, true through additional marks, false only after all keys cleared; delay-then-show (no `pending` reading `true` before 150 ms); min-visibility (`pending` stays `true` for 250 ms even if cleared earlier); 10 s safety net
+ [ ] jest: `pendingChange` message reducer marks and clears correctly
+ [ ] jest: settings drawer renders spinner when hook reports pending, hides otherwise
+ [ ] jest: toolbar spinner renders when hook reports pending
+ [ ] jest (extension): `discoverFolderDocs` emits `pendingChange { on: true }` when discovery finds files needing load; does NOT emit when discovery matches the current cache exactly
+ [ ] playwright: toggle `showLineNumbers` — fast toggle, no visible spinner flash (operation under 150 ms)
+ [ ] playwright: edit `includeFilter` to a more restrictive glob and apply — spinner appears in drawer, stays through the re-aggregation, disappears when the new file set lands
+ [ ] playwright: at workspace root with many projects, click a pill to descend (subfolder has many files, loading takes >150 ms) — toolbar spinner appears, disappears when descent completes
+ [ ] playwright: at a subfolder, click back up the breadcrumb to a parent root with many newly-discoverable files — toolbar spinner appears for the full discovery+load, disappears when done
+ [ ] playwright: at a subfolder, click the breadcrumb segment matching the current path (no-op re-enter) — no spinner appears
+ [ ] playwright: flip integration mode (folder → current_file → folder) — no spinner appears (operation is webview-side state change, no loading work)
+ [ ] playwright: `prefers-reduced-motion` emulated — spinner is in DOM but without keyframe animation
+ [ ] `pnpm run check` green
+ acceptance
  + slow folder-discovery navigation (clicking up the breadcrumb to a root with many new files to load) shows a spinner in the toolbar from the moment discovery starts until the new view has rendered
  + slow settings changes (filter edits triggering re-aggregation) show a spinner in whichever drawer is open
  + fast operations (mode flips, no-op breadcrumb clicks, instant boolean toggles) show no visible spinner
  + the spinner respects `prefers-reduced-motion`
  + a dropped echo doesn't hang the spinner — 10 s safety net clears
  + no existing navigation or settings-change behaviour is altered; the only new visible thing is the spinner
+ commit message draft
  + notethink 0.2.18: drawer + toolbar show an inline-SVG spinner whenever notethink is doing work the user is waiting on — settings round-trips (existing settings-pending path) AND folder-discovery navigation (new extension-driven `pendingChange` signal emitted by `discoverFolderDocs` only when the discovered set requires loading new files); generalised `usePendingWork` hook (renamed from settings-only `useSettingsPending`) with delay-then-show + min-visibility policy so fast paths (mode flips, no-op breadcrumb clicks, instant toggles) don't flash; new dep-free `<Spinner>` component, `prefers-reduced-motion` honoured, 10 s per-key safety net
  + tests N jest, N playwright


### Click-focus and click-select work consistently in folder mode (homogenise the interaction state path) [](?id=homogenise-click-focus-select-across-modes&status=doing)

**Symptom.** In `integration_mode = current_file` with the Kanban view, clicking a note draws a *dashed* outline around it (focused state); clicking the same note again selects all the note's text and the outline turns *solid* (selected state). In `integration_mode = folder` the same clicks produce **neither** the dashed outline nor the solid-outline-with-text-selection. The user's read is that folder mode must be using a different code path — but it isn't (see Diagnosis below). The breakage is in a shared assumption that no longer holds in folder mode. This story fixes the immediate UX gap and homogenises the underlying state path so future interaction features stop diverging silently across integration modes.

**Additional symptoms confirmed 2026-05-27** — same root cause, both directions of the editor↔view selection sync are broken in folder mode:

1. **Editor caret → note focus is also broken in folder mode.** Move the editor caret into a story (e.g. open `oma/docstech/users/alex.stanhope/todo.md` and place the caret inside the headline `Refresh Menus Uncomplicated app — replace ScriptTag delivery + close competitive feature gap`). In `current_file` mode the matching card in the kanban view immediately shows the dashed focused outline. In `folder` mode the caret moves but **no note is highlighted** — the dashed outline never appears, even though the source doc is one of the aggregated set and the rendered card is right there in the Doing column.
2. **Note click → editor caret *does* work in folder mode.** Clicking a card correctly opens the source file in the editor and moves the caret to the start of the story headline. This proves the click → `revealRange` round-trip is intact and the extension is correctly routing per-doc reveals; the broken direction is purely the **view-side state derivation that lights up the focused/selected note**.

Together these two new observations narrow the bug to exactly what the Diagnosis below predicts: the `useViewContext` derivation that maps `(active editor's doc, caret offset)` → `focused note seq` is the only thing that doesn't work across integration modes. The forward direction (`view click → editor reveal`) and the renderer's outline classes are both fine. The fix must therefore make `useViewContext` produce a non-empty `focused_seqs` in folder mode whenever the active editor's caret is inside a note that exists in the aggregated tree, AND make click-driven focus work without depending on the editor round-trip at all (the per-view state-of-truth direction below).

**Diagnosis** (from a code audit before writing this story — none of this is a guess).

- The renderer dispatch is **identical** for both modes: `GenericView` → (`DocumentView` | `KanbanView`) → `GenericNote` → `MarkdownNote`. No `integration_mode` branching in component selection (`GenericView.tsx:110-112`, `GenericNote.tsx`).
- The click handler is the same `createNoteClickHandler` (`lib/noteui.ts:222-235`) feeding the same dispatcher in `useViewHandlers.ts:49-116`. First-click→focus, second-click-on-same→select, double-click→select-all — all in one state machine, no integration-mode awareness.
- The CSS classes are the same: `.focused { outline: dashed 2px ... }` / `.selected { outline: solid 2px ... }` at `ViewRenderer.module.scss:614-628`. The `focused` and `selected` boolean props on each note are computed identically in both modes from `cropped_focused_seqs` / `cropped_selected_seqs` (`GenericNote.tsx:37-46`).
- **What differs**: where those `_seqs` arrays come from. They are derived in `useViewContext.ts:91-124` by asking "which note contains the current editor caret?" — i.e. by reading the **single active VS Code editor's selection** and locating it inside the rendered note tree. In `current_file` mode this round-trip is coherent: the rendered notes come from the active editor, the click posts `revealRange`/`selectRange` to that editor, the editor's selection updates, `useViewContext` recomputes, and the new focus/select classes land on the right note. In `folder` mode the rendered notes come from many files — usually most of them are *not* in the active editor — so the click posts `revealRange` against a different doc, the active-editor's selection never lands inside the clicked note's rendered range, and `useViewContext` never produces a non-empty `_seqs` array for it. The renderer is innocent; the state-derivation assumption is broken.
- Hence the user's "different code in each mode" hypothesis is **wrong at the renderer level but correct in spirit**: there's a shared code path that *implicitly relies* on a single-editor model, and folder mode silently doesn't satisfy that precondition.

**Goal.** Make the focused/selected note state work consistently across `current_file` and `folder` modes in **both** directions:

- **view → editor (click)**: clicking a note in the view focuses (and on second click, selects) it visually, without depending on an editor-selection round-trip. The state lives in the view, not in the editor.
- **editor → view (caret)**: moving the caret in the editor to a story headline / body highlights the matching note in the view, regardless of how many docs the view is aggregating from.

Establish the pattern so future interaction features inherit consistency by construction rather than by accident.

+ scope — fix the immediate gap (view → editor: click-driven)
  + introduce per-view focused/selected state on `display_options` (or a peer slot in view-managed state) that the click dispatcher writes directly when the click lands, **without** waiting for an editor-selection round-trip
  + `useViewContext` continues to *also* derive `_seqs` from the editor selection (see next scope block) — but the per-view click-driven state is the source of truth when set, with editor-derived state as a fallback
  + the click handler in `useViewHandlers.ts:49-116` becomes mode-agnostic:
    + first click on note N → set `view.focused_seqs = [N.seq, ...ancestors]`; still post `revealRange` so the editor follows (the editor scroll/focus is a nice-to-have, not a correctness condition)
    + second click on same N → set `view.selected_seqs = [N.seq]`; still post `selectRange` so the editor's text selection follows when possible
    + click on a different note → focus that note (replaces focused set), drop any selection
    + double-click → set selected directly, skipping the two-step
  + folder-mode caveat: posting `revealRange` / `selectRange` to a doc that isn't currently the active editor should still open / focus the editor on that doc and apply the selection (this *probably* already works via VS Code's `vscode.window.showTextDocument` path in `PanelSession.ts` — confirm during implementation), but if the editor never confirms the selection, the view's own focused/selected state remains correct regardless
+ scope — fix the editor → view direction (caret-driven)
  + the existing `useViewContext.ts:91-124` derivation walks the rendered note tree looking for the deepest note whose offset range contains the active editor's caret. In folder mode the rendered tree's offsets are **synthetic re-numbered offsets from the merged aggregate** — they don't share a coordinate system with any single editor's offsets, so the matcher returns nothing
  + the right matcher in folder mode is **per-doc**: among notes whose `origin.doc_path` equals the active editor's doc path, find the deepest one whose **original** offset range (i.e. the note's pre-merge `position.start.offset` … `position.end.offset` *in its source file*) contains the editor caret. Notes carry `origin` after merge but the in-tree `position` is re-stamped; the implementation needs to either preserve the source-file offsets on the note (e.g. as `origin.source_position` or `position_in_source_file`) or fall back to matching by headline-line within the doc
  + the same matcher works in `current_file` mode (the trivial case where every visible note's `origin.doc_path` equals the active doc) — so the per-doc lookup is the unified algorithm, not an integration-mode branch
  + the active editor's doc path is already known to the webview via the `selections` map (keyed by `docPath`) emitted by `sendSelection` (`PanelSession.ts`). Confirm the path is available to `useViewContext` and pass it in if not
+ scope — preserving source-file offsets through the merge
  + `mergeAggregateRoot` re-stamps `note.position` to synthetic offsets in the merged tree. To match against the editor caret we need the **pre-merge** offsets preserved per-note. Cheapest option: stamp a new field on the merged note (or on its `origin`) carrying the original `{ start: { offset }, end: { offset } }` from the source file's parse, untouched by the merge re-numbering. **Permanent-name check** (per `CODING_STANDARDS.md` > Naming Conventions): proposed `origin.source_position` (a `{ start: { offset, line }, end: { offset, line } }` shape mirroring `position`). Recommend that name; flag if you'd prefer `origin.in_file_position` or `pre_merge_position` to make the semantic explicit
  + tests for `mergeAggregateRoot` should cover: every merged note has `origin.source_position` that matches the note's pre-merge `position` in the source doc, regardless of merge re-numbering or per-file cap trimming
+ scope — homogenisation audit (cheap; do it as part of this story)
  + grep the views package for code that reads editor-selection-derived state (`focused_seqs`, `selected_seqs`, `caret_pos`, `cropped_focused_seqs`, `cropped_selected_seqs`) and confirm every consumer falls back to the per-view state when present
  + grep for any handler that branches on `integration_mode` and surface each branch in the story body as either (a) justified (mode genuinely differs), or (b) a latent inconsistency analogous to this one — file a follow-up story for each (b)
  + add a coding-standards bullet (or extend the existing one) capturing the principle: **per-note UI interaction state belongs in the view, not derived from VS Code's single-editor selection.** Modes can decorate / sync from the editor, never depend on it for correctness. Land this in `CODING_STANDARDS.md` so future features start in the right place
+ files
  + `client/webview/src/notethink-views/src/components/views/generic/useViewHandlers.ts` — click dispatcher writes `view.focused_seqs` / `view.selected_seqs` directly via `setViewManagedState`
  + `client/webview/src/notethink-views/src/components/views/generic/useViewContext.ts` — derivation prefers per-view state over editor-derived state; editor-derived state remains the fallback when per-view is empty
  + `client/webview/src/notethink-views/src/types/*` (or wherever `ViewProps` / `display_options` shape is defined) — add the per-view fields. **Permanent-name check** (per `CODING_STANDARDS.md` > Naming Conventions): proposed field names `view_focused_seqs` / `view_selected_seqs`. Names live on `display_options` (wire format = snake_case) and are persisted via the existing view-managed-state pipeline. Recommend these names; flag if you'd prefer `clicked_focused_seqs` / `clicked_selected_seqs` to make the provenance explicit
  + `client/webview/src/notethink-views/src/components/notes/GenericNote.tsx` — `focused`/`selected` flag computation reads the union of editor-derived and per-view sources
  + `client/webview/src/notethink-views/src/components/ViewRenderer.module.scss` — no change expected (same `.focused` / `.selected` classes)
  + `CODING_STANDARDS.md` — add the "per-view UI interaction state" principle under React Patterns (or a new "View State" section)
+ edge cases
  + clicking a note in folder mode whose doc is closed in the editor — view-side state lands instantly; editor *may* open the doc and apply the selection (existing behaviour); if it doesn't, the visible focused-outline is still correct
  + editor selection changes externally (user clicks in the editor) — `useViewContext` derives new `_seqs` from the editor via the per-doc matcher; if the user hasn't click-focused a note in the view, the editor-derived state takes effect; if they *have*, the view-driven state remains visible until they click somewhere else (TBD — flag for confirmation)
  + view re-render due to passive payload arrival (a file change updating the aggregated set) — per-view focused/selected `_seqs` survive the re-render as long as the focused note's `stable_id` (per [[multi-file-ordering-stable-identity]]) still resolves to a present note; if it doesn't, the focused state clears
  + integration-mode flip (folder → current_file → folder) — clears per-view focused/selected state; matches the user's mental model that the mode flip is a fresh navigation
  + active editor on a doc that isn't in the aggregated set (e.g. opened a markdown file that's filtered out by exclude) — the per-doc matcher finds no candidate notes; `focused_seqs` stays empty; this matches user expectation (no note is highlighted because the active story isn't in the view)
+ open questions
  + **conflict policy between editor-derived and view-driven state.** Recommend "view-driven wins while set; editor-driven fills in when view-driven is empty". Alternative: "last writer wins" (most recent of the two sources). The recommendation keeps user click-focus stable across editor-cursor noise; flag if you'd rather the editor cursor always reasserts focus
  + **persistence of focused/selected across panel reload.** Recommend not persisted — focus is a transient UI state, same as text selection. Flag if you want it to survive reload
  + **permanent-name sign-off** for `view_focused_seqs` / `view_selected_seqs` AND `origin.source_position` (see Files above)
+ [ ] add `view_focused_seqs` / `view_selected_seqs` to `display_options` (or peer slot), with `parseops` / wire-format / view-state types aligned
+ [ ] update `useViewHandlers.ts` click dispatcher: write per-view state directly; keep posting `revealRange` / `selectRange` so the editor follows opportunistically
+ [ ] stamp `origin.source_position` on every merged note in `mergeAggregateRoot.ts` — the pre-merge `{ start: { offset, line }, end: { offset, line } }` from the source-file parse, preserved through the merge re-numbering
+ [ ] update `useViewContext.ts` derivation to per-doc matcher: filter notes by `origin.doc_path === active_editor_doc_path`, then find the deepest whose `origin.source_position` contains the caret offset
+ [ ] update `useViewContext.ts` to prefer per-view state when set, fall back to the per-doc editor-derived match
+ [ ] update `GenericNote.tsx` flag computation to read the unified source
+ [ ] homogenisation grep: list every site that reads editor-derived focused/selected state; confirm fallback wiring or file a follow-up
+ [ ] homogenisation grep: list every handler that branches on `integration_mode`; classify each as justified or latent inconsistency
+ [ ] add the "per-view UI interaction state belongs in the view, not derived from the single editor selection" principle to `CODING_STANDARDS.md`
+ [ ] jest: in folder mode with notes from two files, clicking a note in the kanban view immediately sets the focused outline (dashed), and clicking again selects it (solid) — no dependency on the editor confirming the selection
+ [ ] jest: in current_file mode the existing behaviour is unchanged (regression guard — editor-derived state still drives focus when the user clicks in the editor, not the view)
+ [ ] jest: clicking a different note in the view replaces the focused set and drops any selection
+ [ ] jest: integration-mode flip clears per-view focused/selected state
+ [ ] jest (mergeAggregateRoot): every merged note's `origin.source_position` equals its pre-merge `position` in the source doc
+ [ ] jest (useViewContext): per-doc matcher returns the right note when the editor caret is in a note whose source doc is one of several in the aggregated set
+ [ ] jest (useViewContext): per-doc matcher returns empty when the active editor's doc isn't in the aggregated set (no false-positive matches)
+ [ ] playwright: folder-mode kanban — click a note from file B; dashed outline appears immediately. Click again; outline turns solid and the note's text is selected
+ [ ] playwright: folder-mode kanban — click a note from file A, then a note from file B; only file B's note shows the focused outline
+ [ ] playwright: folder-mode kanban — open one of the source docs in the editor, place the caret inside a story headline (no click in the view); the matching note shows the dashed focused outline (covers the editor → view caret-driven direction)
+ [ ] playwright: current_file mode — existing focus/select behaviour unchanged
+ [ ] `pnpm run check` green
+ acceptance
  + clicking a note in folder mode produces the dashed-outline focused state immediately on the clicked note, identical to current_file mode
  + clicking the same note a second time produces the solid-outline selected state with note text selected, identical to current_file mode
  + clicking a different note moves the focus; double-click skips straight to selected
  + moving the editor caret into a story (without clicking in the view) highlights the matching note in folder mode — identical to current_file mode
  + the homogenisation principle is captured in `CODING_STANDARDS.md` and the audit's findings are recorded in this story body (followed up with separate stories for any latent inconsistencies found)
  + no regression in current_file behaviour or in keyboard-driven note focus from editor-cursor movement
+ commit message draft
  + notethink 0.2.19: click-focus and click-select now work in folder mode, not just current_file — per-note interaction state moved into the view (`view_focused_seqs` / `view_selected_seqs` on `display_options`) instead of being derived solely from VS Code's single-editor selection; click dispatcher (`useViewHandlers`) writes view state directly while still posting `revealRange` / `selectRange` so the editor follows opportunistically; `useViewContext` derivation is now per-doc + per-source-offset (uses new `origin.source_position` preserved through `mergeAggregateRoot` re-numbering) so the editor-caret → note-focus direction also works in folder mode; coding-standards entry added so future interaction features start mode-agnostic
  + tests N jest, N playwright


### Animated passive transitions in the kanban view [](?id=animated-passive-transitions)

The visible UX payoff. When the kanban view changes layout because of a *passive* update (external file edit from another VS Code window or editor, AI-agent edit, mtime change, anything not driven by the user's own drag) the affected notes and columns animate from old state to new state in a way that mimics manual drag-and-drop. Depends on [[multi-file-ordering-stable-identity]] (stable note identity is the keying contract) and [[folder-mode-dnd]] (so the manual and automatic UX stay consistent in folder mode).

+ goal
  + a status-tag change made by an AI agent or another editor animates the affected card from its old column position to its new column position, on the same trajectory the user would see if they had picked it up and dragged it
  + a within-column reorder triggered by mtime, line/sequence, or weight change slides the card to its new vertical slot as if dragged
  + new notes fade in; new columns slide in; column-then-note choreography
  + the animation layer is decorative — the final DOM is correct regardless of whether the animation runs, fails partway, or is interrupted by the next update
+ visual specification — must mimic existing drag-and-drop (`ViewRenderer.module.scss:1103-1115`)
  + in-flight card style: `box-shadow: 0 8px 24px rgba(0,0,0,0.16)`, `transform: rotate(2deg) scale(1.02)`, applied while the FLIP plays and removed at the end
  + cross-column move: card lifts (apply in-flight style), translates from origin rect to destination rect, lands (remove in-flight style), 350 ms ceiling
  + in-column reorder: same lift-and-translate, vertical only
  + new note: fade-in (opacity 0 → 1) with subtle scale (0.96 → 1), 200 ms
  + new column: horizontal slide-in (translateX(-20px) → 0) with fade, 250 ms; notes destined for it begin their cross-column move on the next animation frame after the column lands
  + column disappearance: notes have already left via cross-column moves; column collapses horizontally over 200 ms
+ architectural approach
  + custom FLIP helper, no animation library added to the webview bundle
  + only fires on *passive* updates; user-initiated drag-end remains owned by `@hello-pangea/dnd`
  + progressive enhancement / graceful degradation: the layer is a thin overlay that records pre-commit rects (`useLayoutEffect`), lets React render, then plays inverse transforms via the Web Animations API. If the layer throws, the view is already in its final state — there is nothing to clean up. The contract is: *the final DOM is correct without the animation layer; the animation layer only decorates the transition between two correct states*
+ behaviour contract — graceful degradation
  + 350 ms ceiling per individual transition; if a second update arrives mid-animation the in-flight animation is cancelled and the next FLIP measures from the *current live rect*, not the previous "to" rect
  + 800 ms global cap from "update received" to "final state visible" — if FLIP math has not completed by then, `el.getAnimations().forEach(a => a.finish())` snaps to final state
  + respects `prefers-reduced-motion: reduce` (existing precedent at `ViewRenderer.module.scss:330`) — animation layer no-ops, final state appears immediately
  + if a note's `stable_id` is absent from the previous registry, treat as new (fade-in); if absent from the next, treat as removed (fade-out)
  + if rect math throws or returns NaN, swallow and snap
+ scope
  + new `lib/animation/flipMath.ts` — pure functions (inverse transform, keyframe spec) — unit-testable without DOM
  + new `lib/animation/useFlipTransition.ts` — hook: registry of (`stable_id` → element ref), `useLayoutEffect` to capture pre-commit rects, `useEffect` to play inverse transforms
  + new `lib/animation/passiveUpdateGate.ts` — flag set by `KanbanView.dragEndHandler` for a short window (~250 ms) after user drag so the layer skips that re-render and does not double-animate
  + wire the hook around the note list in `KanbanView.tsx` with `key={note.stable_id}` (replacing `key={note.seq}`)
  + wire column enter/exit in `KanbanColumn.tsx` using CSS keyframes (FLIP requires a prior rect — columns appearing for the first time have none)
  + add settings drawer toggle `kanban_animate_transitions` (Global scope, default true) so users can disable the layer
  + ship a test-only probe `KanbanAnimationProbe` (gated by a debug flag, not in default bundle path) that emits an event stream the test harness can subscribe to — replaces relying on pixel-diffing in jest
+ out of scope
  + animating non-kanban views (document/mermaid) — possible follow-up
  + animating origin-pill colour changes or focus-ring transitions
  + per-card origin-pill flash during the move — possible v2 polish
+ files (proposed)
  + new `client/webview/src/notethink-views/src/lib/animation/flipMath.ts`
  + new `client/webview/src/notethink-views/src/lib/animation/useFlipTransition.ts`
  + new `client/webview/src/notethink-views/src/lib/animation/passiveUpdateGate.ts`
  + `client/webview/src/notethink-views/src/components/views/KanbanView.tsx` — wire hook around column list and note list; key by `stable_id`
  + `client/webview/src/notethink-views/src/components/views/KanbanColumn.tsx` — column enter/exit
  + `client/webview/src/notethink-views/src/components/ViewRenderer.module.scss` — column slide-in/out keyframes
  + `client/{extension,webview}/src/constants.ts` — `KANBAN_ANIMATION_TRANSITION_MAX_MS = 350`, `KANBAN_ANIMATION_GLOBAL_CAP_MS = 800`, `KANBAN_ANIMATION_DRAG_GATE_MS = 250`
  + settings drawer + extension contributes a `notethink.kanbanAnimateTransitions` boolean (Global target), wired through `ExtensionReceiver`
+ [ ] implement `flipMath.ts` with unit-testable pure functions (inverse transform, keyframe spec)
+ [ ] implement `useFlipTransition` hook — registry + `useLayoutEffect` rect capture + Web Animations API playback
+ [ ] implement `passiveUpdateGate` — flag set by `KanbanView.dragEndHandler`, hook skips animation while the flag is hot
+ [ ] wire hook around the kanban note list; replace `key={note.seq}` with `key={note.stable_id}`
+ [ ] wire CSS-keyframe column enter/exit in `KanbanColumn.tsx`
+ [ ] choreograph new-column case: column enter completes (or starts ~50 ms ahead) before inbound notes begin their FLIP
+ [ ] respect `prefers-reduced-motion` (hook no-ops, no Web Animations calls)
+ [ ] add `notethink.kanbanAnimateTransitions` setting (Global target, default true) + drawer checkbox with locale strings in all 5 locales
+ [ ] jest: `flipMath` unit tests (no DOM, pure functions)
+ [ ] jest: `useFlipTransition` with jsdom + mocked `getBoundingClientRect` — verifies the right transforms get scheduled
+ [ ] jest: `passiveUpdateGate` suppresses the hook within 250 ms after `dragEnd`
+ [ ] jest: stable_id absent in previous render → fade-in path fires; absent in next → fade-out path fires
+ [ ] jest: `prefers-reduced-motion` makes the hook no-op
+ [ ] jest: 800 ms global cap snaps to final state
+ [ ] playwright: cross-column animated transition (fire an external file edit changing a status tag; assert intermediate transform present at ~150 ms; assert final DOM matches the new state regardless of animation playback)
+ [ ] playwright: in-column animated reorder (mutate mtime via the harness; assert vertical slide; assert final order)
+ [ ] playwright: new column appearance choreography (introduce a status value that has no column; assert column enter completes before notes arrive)
+ [ ] playwright: user-initiated drag is NOT double-animated (drag a note; assert the FLIP layer event stream is empty for that re-render)
+ [ ] playwright: rapid-burst (fire 5 status changes within 200 ms; final state correct, no stuck or orphaned animations after 1 s)
+ [ ] playwright: `prefers-reduced-motion` (emulate via Playwright; assert no transform keyframes, final state instant)
+ [ ] `pnpm run check` green
+ manual: open a folder, have an AI session edit a status tag in one of the files, confirm the card animates from old column to new column on the same path a drag would follow
+ manual: external edit (e.g. via another VS Code window) reorders a note within a column, confirm vertical slide
+ manual: prefers-reduced-motion enabled in OS settings, confirm no animation, view still consistent
+ manual: toggle `kanban_animate_transitions` off, confirm everything snaps without animation and stays correct
+ test plan
  + visual correctness checked structurally (DOM in final state, computed transform sequence sane) rather than pixel-diffing
  + the `KanbanAnimationProbe` test-only component reads the animation layer's internal event stream and exposes it to the harness so jest can assert *what was scheduled* without needing a real `requestAnimationFrame` loop
  + playwright tests assert final state after the animation should have settled, plus optional intermediate checks at 50 ms / 200 ms via `page.evaluate(() => element.getAnimations())`
+ acceptance
  + externally-driven status changes animate the card on a path visually consistent with a drag-and-drop of that card
  + externally-driven reordering inside a column animates the card on a vertical slide
  + new notes fade in; new columns slide in; column-then-note choreography holds
  + user-initiated drags do not double-animate
  + `prefers-reduced-motion` users see instant transitions
  + an exception in the animation layer cannot leave the view in an inconsistent state — final DOM is always correct within the existing re-render budget
  + setting `notethink.kanbanAnimateTransitions = false` disables the layer entirely with no visible regression in correctness
+ open questions for the implementing agent
  + whether to coalesce two file events arriving within ~50 ms into a single FLIP cycle (vs animating both)
  + whether to flash the origin pill on the moving card during the animation (probably v2)
  + the exact easing curve — proposal: `cubic-bezier(0.2, 0, 0.0, 1.0)` to match a "thrown" feel, consistent with the existing settings-drawer easing at `ViewRenderer.module.scss:321`
+ commit message draft
  + notethink 0.2.16: kanban transitions animate via in-house FLIP helper for passive updates (external file edits, AI-driven status changes, mtime reorders)
  + new notes fade in; new columns slide in with notes choreographed in afterwards; user-initiated drags untouched
  + animation layer is decorative — final DOM is correct regardless of playback (350 ms per-transition + 800 ms global ceiling, `prefers-reduced-motion` respected, `notethink.kanbanAnimateTransitions` setting to disable)
  + tests N jest, N playwright


### View hierarchy and per-view card-type axis [](?id=view-hierarchy-and-card-types)

The view system today has a flat dispatch (`GenericView.tsx:774-776`): `auto` → `document` → `kanban`. Two structural changes in one story:

1. **View hierarchy.** Kanban is one instance of a more general *column-based* view. Other column-based views (group-by-assignee, group-by-type, group-by-any-attribute) should inherit kanban's column primitives without re-implementing them. Introduce a `ColumnBasedView` base.
2. **Card-type axis.** Orthogonal to view choice. Within any view a note can be rendered as a full card (current default — pill, title, attributes, body) or a compact summary (e.g. a sticky-note). Introduce an `ng_card` linetag alongside `ng_view`, with auto-resolution and a second toolbar selector — "Auto (Card)" alongside the existing "Auto (Kanban)".

+ goal
  + future column-based views can declare a different column-derivation function and reuse all of kanban's column rendering, ordering, drag-and-drop, and (once it lands) animation infrastructure
  + the card rendering used by any view is selectable independently of the view itself; the default per view stays the current full card
  + `ng_card` overrides apply at the file H1 level just like `ng_view` does today, with the same auto-resolution semantics
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
  + new `ng_card` linetag, parsed alongside `ng_view` by `mergeAggregateRoot` and stamped onto `origin.file_card_type`
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
  + per-note `ng_card` override (file-level only for now)
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
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` — capture `ng_card` from file H1 → `origin.file_card_type`
  + `client/webview/src/notethink-views/src/types/NoteProps.ts` — `card_type?: string` on `NoteDisplayOptions`; `file_card_type?: string` on `NoteOrigin`
+ [ ] factor `ColumnBasedView` out of `KanbanView`; verify byte-identical render for existing fixtures
+ [ ] introduce `CardRegistry` with `card` (existing `MarkdownNote`) + `sticky` (new `StickyNote`)
+ [ ] add `ng_card` linetag parsing in `mergeAggregateRoot`; capture on `origin.file_card_type`
+ [ ] add card-type auto-resolution in `AutoView` mirroring the view-type majority vote
+ [ ] add second toolbar selector — "Auto (Card)" / "Card" / "Sticky" — dispatch to `setViewManagedState`
+ [ ] each view declares its default card type (kanban → `'card'`); auto picks the default when no `ng_card` votes are present
+ [ ] jest: `ColumnBasedView` exposes the same column shape under arbitrary `columnDerivation` (kanban-derivation + a fake derivation by another attribute)
+ [ ] jest: kanban refactor renders byte-identical against existing fixtures
+ [ ] jest: `CardRegistry` returns `MarkdownNote` for `'card'`, `StickyNote` for `'sticky'`, falls back to view default for `'auto'`
+ [ ] jest: `ng_card` on a file H1 is captured into `origin.file_card_type`
+ [ ] jest: `AutoView` majority-votes card type independently of view type
+ [ ] playwright: switch second selector from "Auto" to "Sticky" — note cards collapse to compact form
+ [ ] playwright: file with `ng_card=sticky` on H1 in folder mode — auto-resolved card type is sticky for that file's notes
+ [ ] playwright: existing kanban specs all green (refactor regression check)
+ [ ] `pnpm run check` green
+ manual: open a folder with mixed `ng_card` values across files — toolbar shows "Auto (...)" with the majority-voted card type
+ manual: explicitly set card type to "Sticky" — all notes render compactly across columns
+ manual: switch back to "Auto" — auto resolution recovers
+ acceptance
  + kanban view works identically after the `ColumnBasedView` refactor (no visible regression)
  + a second selector appears in the toolbar with the same Auto / explicit semantics as the view-type selector
  + `ng_card` linetag at file H1 cascades into the auto-resolved card type for that file
  + `StickyNote` renders pill + title only; switching back to `card` restores the full card
  + future column-based views can be added by supplying a different `columnDerivation` without re-implementing column layout or drag-and-drop
+ open questions for the implementing agent
  + per-note `ng_card` override (currently file-level only) — defer to a follow-up unless trivial
  + whether the two selectors share a single composite control or stay as two siblings — leaning two siblings for symmetry with "Auto (Kanban)"
  + naming of the base — `ColumnBasedView` vs `GroupedView` vs `BoardView`; first is most descriptive
+ commit message draft
  + notethink 0.2.18: kanban becomes a thin specialisation of new `ColumnBasedView` base so future column-based views (group-by-assignee, group-by-type, etc.) can inherit column layout, ordering, and drag-and-drop
  + introduce `ng_card` linetag and `CardRegistry` — second toolbar selector "Auto (Card)" picks between `card` (full) and `sticky` (compact summary); `ng_card` on file H1 cascades into auto-resolution
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
  + revisit once delta computation works
+ consider whether parsing (mdast-util-from-markdown) is the bottleneck
  + or whether it's the React re-rendering
  + profile before optimising
