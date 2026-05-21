# Todo [](?ng_view=kanban)


### Stable note identity and multi-file kanban ordering refactor [](?id=multi-file-ordering-stable-identity)

Data-layer prerequisite for [[folder-mode-dnd]] and [[animated-passive-transitions]]. No UX change in this story — pure refactor + tests. Sits at the top of todo.md as the priority because both downstream stories depend on it.

+ goal
  + cross-file `kanban_ordering_weight` participates in the column comparator so notes from multiple files can be interleaved by user-chosen order
  + every note carries a stable identity that survives re-parse (file additions/removals, global `seq` renumbering, file_rank shuffling) so React keying and FLIP rect-capture both work across updates
+ background
  + `kanbanNoteOrder()` (`noteops.ts:225-242`) currently considers `kanban_ordering_weight` only when both sides have one; otherwise it falls to `noteOrder()` (`noteops.ts:206-218`) which uses `file_rank` then `file_mtime` then `seq`. Cross-file weight comparison never participates.
  + `calculateTextChangesForOrdering()` (`linetagops.ts:88-131`) assumes all neighbours share a single seq-space; the weight-gap arithmetic and the cascade fallback are both undefined when neighbours come from different files.
  + Notes are React-keyed by `note.seq` (`KanbanView.tsx:195`), which is renumbered globally by `mergeAggregateRoot()` on every re-parse (`mergeAggregateRoot.ts:133-327`). Identity drifts when a file is added, removed, or re-parsed with a new sibling story — the same logical note looks like delete+insert to React.
+ scope
  + stable identity: stamp `stable_id` (kebab-case-slug derived from `origin.doc_id + heading character offset`, picked because it is invariant under sibling additions and round-robin merge shuffles) on every note in both single-file (`NoteTreeComposer`) and aggregate (`AggregateTreeComposer` via `mergeAggregateRoot`) paths
  + cross-file comparator: rework `kanbanNoteOrder()` so `kanban_ordering_weight` is decisive across origins (weight-A vs weight-B always compared even when origins differ); `file_rank → file_mtime → seq` is the tiebreak chain only when neither side carries a weight
  + reorder algorithm: factor `calculateTextChangesForOrdering()` to operate on a generic ordered list with no seq-arithmetic between cross-file neighbours; weight-gap math becomes per-file output (cascade only touches notes in the same file); the cross-file ordering decision is encoded in the *value* of the assigned weight, not in any shared seq space
  + change-set partitioning: the algorithm returns changes grouped by `origin.doc_path` so the extension can apply per-file edits independently (the wire format change ships with [[folder-mode-dnd]] but the data shape lands here)
+ out of scope
  + UI for dragging across files — covered in [[folder-mode-dnd]]
  + animation layer — covered in [[animated-passive-transitions]]
  + changing single-file kanban behaviour — single-file callers must produce byte-identical text output before and after this refactor
+ files
  + `client/webview/src/notethink-views/src/lib/noteops.ts` — comparator rewrite
  + `client/webview/src/notethink-views/src/lib/linetagops.ts` — `calculateTextChangesForOrdering` generalisation
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` — stamp `stable_id` during merge
  + `client/webview/src/notethink-views/src/types/NoteProps.ts` — add `stable_id: string` to `NoteProps`; document derivation in the structure's header comment per `CODING_STANDARDS.md` "no per-field comments inside data structures"
  + `client/webview/src/components/composers/NoteTreeComposer.tsx` and `client/webview/src/components/composers/AggregateTreeComposer.tsx` — assign `stable_id` in the single-file path as well so callers can rely on it in both modes
+ [ ] design `stable_id` derivation and document the choice in the `NoteProps` header comment
+ [ ] stamp `stable_id` in `mergeAggregateRoot` for aggregate mode and in the single-file composer path
+ [ ] rewrite `kanbanNoteOrder()` so weight participates across origins; preserve single-file output exactly
+ [ ] generalise `calculateTextChangesForOrdering()` to partition output by `origin.doc_path`
+ [ ] regression: existing single-file kanban specs untouched and green
+ [ ] jest: cross-file comparator covers (weighted, weighted), (weighted, unweighted), (unweighted, weighted), (unweighted, unweighted) across two origins
+ [ ] jest: reorder algorithm emits correct per-file change sets when neighbours come from different files; cascade stays within the originating file
+ [ ] jest: `stable_id` invariant across (a) file added to aggregate, (b) file removed, (c) same file re-parsed unchanged, (d) same file re-parsed with a new sibling note inserted before it
+ [ ] jest: full `mergeAggregateRoot` round-trip preserves `stable_id` for unchanged notes across re-parse
+ [ ] `pnpm run check` green
+ acceptance
  + all existing tests pass
  + new jest suite covers the cross-file comparator and per-file partitioned reorder
  + single-file kanban output byte-identical to prior behaviour against the existing fixtures
  + `stable_id` present on every note in both modes; derivation documented in the `NoteProps` header
+ commit message draft
  + notethink 0.2.14: kanban ordering comparator respects `kanban_ordering_weight` across file boundaries
  + `calculateTextChangesForOrdering` returns per-`origin.doc_path` partitioned change sets so the extension can route per-file edits independently
  + stamp `stable_id` (`origin.doc_id` + heading character offset) on every note in both single-file and aggregate paths so React keying and FLIP rect-capture survive re-parse
  + single-file kanban output byte-identical to prior behaviour
  + tests N jest


### Folder-mode drag-and-drop [](?id=folder-mode-dnd)

Extend the existing kanban DnD UX to multi-file folder mode. Depends on [[multi-file-ordering-stable-identity]] (comparator + per-file partitioned reorder algorithm). Paired with [[animated-passive-transitions]], which is the visible payoff once both DnD paths land.

+ symptom
  + in folder mode, dropping a note into a different column writes a status edit to the right file (`docPath` is already carried in `editText`, `KanbanView.tsx:147`) but the within-column reorder weight-cascade produces nonsense because `calculateTextChangesForOrdering` assumes one seq-space across all visible neighbours
  + notes from different files in the same column cannot be deliberately interleaved by the user — the comparator falls back to `file_rank → file_mtime → seq` and ignores any weight one side carries
+ scope
  + hook the rewritten reorder algorithm from [[multi-file-ordering-stable-identity]] into `KanbanView.dragEndHandler` so per-file change sets are emitted as a single `editText` with `changes` grouped by `docPath`
  + extension side: when an `editText` message carries changes spanning multiple docs, apply each batch atomically per file and re-emit parse updates for every touched doc; today the handler assumes one `docPath`
  + visual parity: dragging in folder mode looks identical to single-file mode (lift + rotate + shadow). No CSS edits expected — only verify
  + caret reveal: in single-file mode `dragStartHandler` invokes the click handler with the note's caret position. In folder mode the caret target must be in the *originating* file — `revealRange` needs a `docPath` field (or equivalent multi-file addressing) if it doesn't have one already
+ out of scope
  + animations during automatic (non-drag) updates — covered in [[animated-passive-transitions]]
  + anything touching the drag-in-flight visual (`ViewRenderer.module.scss:1103-1115`) — stays unchanged
+ files
  + `client/webview/src/notethink-views/src/components/views/KanbanView.tsx` — `dragEndHandler` assembles multi-doc change set; `dragStartHandler` reveals caret in the originating file
  + `client/extension/src/vscode/notethinkEditor.ts` — `editText` handler accepts per-`docPath` partitioned changes
  + `client/extension/src/types/Messages.ts` — `editText` payload extended to carry `changes_by_doc?: Record<string, Change[]>` alongside the existing single-doc shape, discriminated on presence
  + new helper if justified: `client/webview/src/notethink-views/src/lib/dnd/assembleMultiDocChangeSet.ts`
+ [ ] extend `editText` message shape to carry per-`docPath` change sets; keep backward compatibility with the single-doc form
+ [ ] update `KanbanView.dragEndHandler` to call the refactored algorithm and post the per-doc change set
+ [ ] extension applies multi-doc `editText` atomically and re-emits parse updates for every touched doc
+ [ ] `dragStartHandler` caret reveal works for notes whose origin is not the active file
+ [ ] verify drag-in-flight visual is unchanged in folder mode (no CSS edits expected, just confirm)
+ [ ] jest: `KanbanView.dragEndHandler` emits the right `changes_by_doc` shape for cross-file moves
+ [ ] jest: extension `editText` handler applies multi-doc batches in the correct order with one parse-update per touched doc
+ [ ] playwright: folder-mode kanban — drag a note from one file across columns; assert only the source file is edited
+ [ ] playwright: folder-mode kanban — within a column containing notes from two files, drag a file-B note above a file-A note; re-fire a parse update for an unrelated doc; assert the user-chosen order survives
+ [ ] playwright: single-file kanban regressions all green
+ [ ] `pnpm run check` green
+ manual: drag a note from one file to another column in folder mode and confirm the source file's markdown shows the new status tag
+ manual: interleave two files' notes in one column, close and re-open the folder, confirm order survives
+ acceptance
  + dragging a note in folder mode shows the same in-flight visual as in single-file mode
  + the dropped state survives a re-parse
  + notes from multiple files in one column can be interleaved deliberately
  + single-file mode behaviour byte-identical to before the change
+ commit message draft
  + notethink 0.2.15: kanban drag-and-drop works across multi-file columns in folder mode
  + `editText` accepts per-`docPath` partitioned change sets; extension applies multi-doc batches atomically
  + `dragStartHandler` reveals caret in the originating file
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


### Origin pill click opens note and switches to current-file view [](?id=pill-click-opens-current-file)

The origin pill (project label on each note in folder/aggregate mode) currently posts `revealRange` on click (`MarkdownNote.tsx:219-226`) — it opens the note in its source file but leaves the view in folder mode. Make a pill click *also* flip the view to `current_file` mode for the just-opened file, so the user lands in the single-file view of the project they clicked.

+ scope
  + extend the pill's existing `onClick` (`MarkdownNote.tsx:219-226`) to invoke the integration-mode setter for `'current_file'` in addition to the existing `revealRange` post
  + ordering: flip the integration mode first (so the receiving view is single-file when the editor focus arrives), then post `revealRange` so the editor lands on the right caret
  + the setter lives in `GenericView.tsx:429-457` (`handleIntegrationChange`) — pill needs access to it via the existing `handlers` plumb-through, or it fires the same `setIntegration` message directly
  + plain note-body click behaviour stays unchanged — only the pill triggers the mode flip
+ files
  + `client/webview/src/notethink-views/src/components/notes/MarkdownNote.tsx` (extend the pill `onClick`)
  + `client/webview/src/notethink-views/src/components/views/GenericView.tsx` if a new handler needs to be threaded through
+ [ ] extend pill `onClick` to flip integration mode to `'current_file'` for the pill's origin doc, then `revealRange`
+ [ ] jest: pill click dispatches both `setViewManagedState`/`setIntegration` (mode `'current_file'`) and `revealRange` in that order
+ [ ] playwright: in folder mode with multiple files, click the origin pill on a note from file B — view switches to single-file showing file B with the caret at the note
+ [ ] playwright: clicking the note body (not the pill) still posts `revealRange` only, no mode flip
+ [ ] `pnpm run check` green
+ acceptance
  + clicking the origin pill opens the note in its source file AND switches the view to current-file mode for that file
  + plain note-body click behaviour unchanged
+ commit message draft
  + notethink 0.2.17: origin pill click switches to current-file view of the source project in addition to revealing the caret
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
