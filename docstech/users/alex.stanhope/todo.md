# Todo [](?nt_view=kanban)


### Auto-open the right breadcrumb view via H1 linetags [](?id=auto-open-breadcrumb-view)

Two new file-root linetags let a document declare the view it should open into, so users land on the intended breadcrumb-scoped view without knowing they can change the breadcrumb themselves. Set on the file `#` H1 (or front matter) — the same place `nt_view` lives. `nt_integration_mode=folder` opens the file in folder (aggregate) mode; `nt_breadcrumb_last=<label>` scopes the breadcrumb to a named segment on first open. Together (`nt_integration_mode=folder` + `nt_breadcrumb_last=portfolio`) they jump straight to the aggregated, portfolio-scoped board.

+ background
  + `nt_view` is read off the H1 via `resolveNamespacedTag(h1?.linetags, 'view')` with a front-matter root fallback, stamped onto `origin.file_view_type` (`mergeAggregateRoot.ts:278`); AutoView resolves the active view type from it
  + view type already models this cleanly: `auto` is a first-class value (`SELECTABLE_VIEWTYPES = ['auto','document','kanban']`, `GenericView.tsx:19`), the default, shown as "Auto (Kanban)" (`ViewTypeSelector.tsx`); picking a concrete type leaves auto and `nt_view` stops driving it
  + integration mode lives in `display_options.integration_mode` / `integration_path` (`NoteProps.ts`) with NO `auto` value today, toggled by `ViewIntegrationSelector` → `useViewToolbar` `handle_integration_change` → `setViewManagedState`, replayed to the extension as a `setIntegration` message
  + the extension (`PanelSession.handleSetIntegration` → `enterFolderMode`, `PanelSession.ts:583`) owns folder aggregation; on reload the webview sends `setIntegration` first, so persisted view-managed state is the source of truth for mode
  + note-hierarchy breadcrumb depth is `display_options.parent_context_seq` (`useViewContext.ts:64`), set by breadcrumb clicks via `setParentContextSeq` (`useViewHandlers.ts:43`); folder-path breadcrumb segments narrow aggregation via `onFolderClick` → a new `integration_path`
  + there is no existing `nt_integration_mode` or `nt_breadcrumb_last` linetag
  + the design extends the existing view-type `auto` pattern to the integration axis, rather than inventing a hidden one-shot seed marker

+ goal
  + integration mode becomes auto-by-default, mirroring view type — in auto, the file's `nt_integration_mode` / `nt_breadcrumb_last` linetags drive the mode and the initial breadcrumb scope
  + opening a file whose H1 declares `nt_integration_mode=folder` resolves (while auto) to folder mode with no manual toolbar switch
  + opening a file whose H1 declares `nt_breadcrumb_last=portfolio` scopes the breadcrumb to the named segment — folder segment → `integration_path`, epic/story segment → `parent_context_seq`
  + navigation is congruence-seeking — it keeps or returns to auto when the destination matches the file's declared mode, and pins a concrete mode only when navigation diverges from the file; re-selecting "Auto" fully resets to the file
  + an unrecognised value degrades gracefully — auto resolves to the normal default with a `debug` line, never an error

+ naming — permanent-name check (CODING_STANDARDS.md "Permanent name check")
  + `nt_integration_mode` and `nt_breadcrumb_last` are linetag keys written into users' markdown — externally-persisted names, frozen once shipped; operator has chosen these exact keys (sign-off recorded here)
  + author as `nt_` only — `ng_` is legacy-read for predecessor keys; new keys are `nt_`-only per AUTHORING_GUIDE
  + the authored value vocabulary for `nt_integration_mode` stays `current_file` / `folder`; `auto` is NOT an authored linetag value, only a webview view-state value
  + `auto` joins `INTEGRATION_MODES` as a persisted view-state value (`vscode.setState` shape) — a permanent-name-check item; treat undefined `integration_mode` as `auto` so existing persisted states need no migration; the extension constants mirror does NOT gain `auto` (the extension only ever receives resolved `current_file` / `folder` via `setIntegration`)
  + `nt_breadcrumb_last` value is a free-form segment label matched at runtime — no persisted enum

+ design — capture
  + read both keys off the opened document's H1 then front-matter root via the existing `resolveNamespacedTag(h1?.linetags, 'integration_mode')` / `(…, 'breadcrumb_last')`, mirroring `nt_view`
  + these are per-opened-file directives, NOT majority-voted across the folder like `nt_view` — read only from the file the user opened
  + validate authored `nt_integration_mode` against `current_file` / `folder`; ignore (debug-log) anything else

+ design — auto integration mode (mirror AutoView, no hidden marker)
  + add `auto` to `INTEGRATION_MODES` / the `IntegrationMode` type and make it the default; treat undefined `integration_mode` as `auto` (back-compat — untouched views become auto and resolve to current_file when the file declares nothing; the new linetag is the only thing that flips them, so existing files are unaffected)
  + auto governs the *mode* (folder vs current_file): while `integration_mode === 'auto'` the displayed mode re-resolves live from `nt_integration_mode`, the same "auto follows the file" contract AutoView gives view type
    + `nt_integration_mode=folder` → resolves folder; dispatch `setIntegration` so the extension aggregates
    + no `nt_integration_mode` → resolves current_file (today's default)
  + the breadcrumb *scope* (`integration_path` / `parent_context_seq`) is seeded once from `nt_breadcrumb_last` at first resolve, then is the user's navigated position — auto re-resolves the mode but never re-snaps a path the user has navigated
  + navigation is congruence-seeking, not auto-breaking — after a breadcrumb / folder / note click, set `integration_mode = auto` when the resulting mode matches what the file declares, else pin the concrete resulting mode (look for every chance to return to auto)
    + Auto (Folder) + navigate within folder → resulting folder == file's folder → stay Auto (Folder), selector unchanged
    + Auto (Current file) + click a folder segment → resulting folder ≠ file's current_file → pin concrete Folder
    + concrete Current file on a file whose linetag declares folder + click a breadcrumb → resulting folder == file's folder → jump to Auto (Folder)
  + explicitly re-selecting "Auto" in the selector is a full reset — re-resolve both mode and scope from the file linetags
  + factor the congruence decision into a pure `viewstateops.ts` helper (`resulting_mode` + `file_declared_mode` → `'auto' | <concrete>`) so it is unit-testable in isolation
  + no hidden `auto_view_seeded` marker — the visible `auto` ⇄ concrete state IS the "still automatic?" signal, self-documenting as "Auto (Folder)" vs "Folder" in the toolbar, exactly like "Auto (Kanban)" vs "Kanban"

+ design — first-resolve seam
  + fire the first `setIntegration` at the App layer in `ExtensionReceiver` on doc-arrival, NOT in a view-render effect — when a doc message lands and `view_states[doc_id]` has no concrete `integration_mode`, resolve from its H1 linetags and dispatch before first render
  + dispatching at doc-arrival fires once per open and keeps resolution out of React render timing; only dispatch when the auto-resolved target actually changes, so re-renders don't re-aggregate
  + confirm the doc-arrival handler has the H1 root note `.linetags` available (the extension sends parsed notes)

+ design — resolve `nt_breadcrumb_last`
  + add a pure resolver: given the label + the active file's breadcrumb trail, return `{kind:'folder', path}` | `{kind:'note', seq}` | undefined
  + match folder-path segments by label against the file's path trail (`segmentPathBelowWorkspace` output); deepest match wins on duplicate labels
  + match note/epic segments by stripped headline against the merged-tree breadcrumb notes
  + a folder-segment match implies folder mode — if `nt_breadcrumb_last` names a folder but `nt_integration_mode` is absent, auto resolution switches to folder mode (a folder breadcrumb segment only exists in folder mode)
  + prefer extending `pathops.ts` (segment match) + `noteops.ts` (seq lookup) over a new tiny `*ops.ts` (≥4-exports rule); add `breadcrumbops.ts` only if it will hold ≥4 exports

+ scope
  + add `auto` as the default `integration_mode`, resolved live from the file linetags while auto
  + parse + validate the two new linetags from the opened doc H1 / front matter
  + resolve `nt_breadcrumb_last` to a folder path or a note seq
  + drive first resolution at doc-arrival in `ExtensionReceiver`; reconcile the mode after each navigation (auto when congruent with the file, concrete when divergent); reuse the existing `setIntegration` / `setParentContextSeq` dispatch — no new extension message types
  + show the auto-resolved mode in `ViewIntegrationSelector` ("Auto (Folder)" / "Auto (Current file)")
  + document both keys in AUTHORING_GUIDE.md and bump the guide to 1.1.0 (new backward-compatible linetag ⇒ minor)

+ out of scope
  + authoring the values on the notegit demo files — a follow-up in notegit once this ships (see note below)
  + majority-vote of `nt_integration_mode` across a folder — it is a per-opened-file directive, not voted
  + a UI to write these linetags — authored by hand like `nt_view`
  + animating the open-time jump — it just lands on the target view

+ files
  + `client/webview/src/notethink-views/src/types/IntegrationMode.ts` — add `auto` to `INTEGRATION_MODES` / `IntegrationMode`, make it the default; note in a comment why the extension constants mirror intentionally omits it
  + `client/webview/src/notethink-views/src/components/views/ViewIntegrationSelector.tsx` — `auto` option + "Auto (…)" label reflecting the resolved mode
  + `client/webview/src/components/ExtensionReceiver.tsx` — resolve auto from H1 linetags on doc-arrival; dispatch `setIntegration` when the resolved target changes
  + `client/webview/src/notethink-views/src/components/views/generic/useViewContext.ts` — treat undefined `integration_mode` as `auto`; expose the resolved mode/path
  + `client/webview/src/notethink-views/src/components/views/generic/useViewToolbar.ts` — `handle_integration_change` writes a concrete mode (leaves auto)
  + `client/webview/src/notethink-views/src/components/views/generic/useViewHandlers.ts` — breadcrumb/folder/note handlers reconcile `integration_mode` via the congruence helper + write the navigated scope
  + `client/webview/src/notethink-views/src/lib/viewstateops.ts` — `reconcileAutoIntegrationMode(resulting_mode, file_declared_mode)` pure helper + tests
  + `client/webview/src/notethink-views/src/lib/pathops.ts` — `resolveBreadcrumbFolderSegment(label, …)` + tests
  + `client/webview/src/notethink-views/src/lib/noteops.ts` — `breadcrumbSeqForLabel(label, notes)` + tests
  + `client/webview/src/notethink-views/src/lib/linetagops.ts` — confirm `integration_mode` / `breadcrumb_last` resolve through `resolveNamespacedTag` (likely no change)
  + `AUTHORING_GUIDE.md` — View configuration table + version bump to 1.1.0
  + `package.json` — version bump 0.3.13 → 0.3.14

+ AUTHORING_GUIDE wording — draft to paste into the "View configuration" table on implementation (the guide is the grammar doc, so the actual edit + 1.0.0 → 1.1.0 bump lands with the code, not now)
  + `| nt_integration_mode | The integration mode this file opens into while the view is in **auto**: current_file or folder. In auto the view follows it; changing the mode or navigating away from the file's intent pins your own choice. nt_-only — no ng_ form |`
  + `| nt_breadcrumb_last | The breadcrumb segment this file opens scoped to while in **auto** — a folder name (narrows folder-mode aggregation to that subfolder, implying folder mode) or an epic/story headline (scopes the note hierarchy). Seeds the initial position; navigate away freely. nt_-only |`
  + bump the guide header from 1.0.0 to 1.1.0 (minor — two new optional, backward-compatible linetags)

+ [x] add `auto` to `IntegrationMode` / `INTEGRATION_MODES`, make it the default, treat undefined as auto
+ [x] read + validate authored `nt_integration_mode` (`current_file` / `folder`) and `nt_breadcrumb_last` off the opened doc H1 / front matter
+ [x] add `resolveBreadcrumbFolderSegment` to `pathops.ts` — deepest-label match over the file's path trail
+ [x] add `breadcrumbSeqForLabel` to `noteops.ts` — match epic/story headline → seq
+ [x] resolve auto on doc-arrival in `ExtensionReceiver`; dispatch `setIntegration` / `setParentContextSeq` only when the resolved target changes
+ [x] add `reconcileAutoIntegrationMode` to `viewstateops.ts` — resulting mode == file-declared → auto, else concrete
+ [x] reconcile `integration_mode` after every navigation via the helper; explicit "Auto" selection re-resolves mode + scope from the file
+ [x] show the auto-resolved mode in `ViewIntegrationSelector` ("Auto (Folder)" / "Auto (Current file)")
+ [x] debug-log + no-op on an unrecognised `nt_integration_mode` value or an unmatched `nt_breadcrumb_last` label
+ [x] document both keys in the AUTHORING_GUIDE.md View-configuration table; bump the guide 1.0.0 → 1.1.0
+ [x] bump notethink to 0.3.14
+ [x] jest: undefined `integration_mode` resolves as auto; `nt_integration_mode=folder` resolves to folder; an invalid value falls back to current_file
+ [x] jest: a `nt_breadcrumb_last` folder label resolves to the right `integration_path`; deepest match wins on duplicate labels
+ [x] jest: a `nt_breadcrumb_last` epic label resolves to the right `parent_context_seq`
+ [x] jest: a concrete persisted `integration_mode` (user choice) is NOT overridden by the file linetag — auto no longer applies
+ [x] jest: navigation congruence — Auto(Folder) stays auto within folder; Auto(Current file)+folder-click pins concrete Folder; concrete Current file on a folder-declaring file + click → Auto(Folder)
+ [x] jest: an unmatched `nt_breadcrumb_last` resolves to the default scope with no throw
+ [x] `pnpm run check` green (lint + build + rollup + 1344 jest) + 77 playwright (70 existing + 7 new auto-integration E2E)
+ note — all six former manual checks are now automated Playwright E2E (`playwright/specs/auto-integration.spec.ts`). The harness has no real extension, so the folder aggregation is simulated by the webview's own setIntegration round-trip: each test asserts the outbound setIntegration message (the webview→host contract) plus the folder board the webview renders. Harness gained sessionStorage-backed webview state (`playwright/harness/index.html`) so reload-resilience is testable. The only residual "manual" is optional visual confirmation in a real VS Code host — NOT a pipeline blocker.
+ [x] playwright: cold-open `nt_integration_mode=folder&nt_breadcrumb_last=portfolio` — posts setIntegration scoped to portfolio, renders the folder board, selector reads "Auto (Folder)", breadcrumb scoped to portfolio
+ [x] playwright: Auto (Folder), click an ancestor folder breadcrumb — stays "Auto (Folder)", re-aggregates at the new folder
+ [x] playwright: a navigated Auto (Folder) position survives a reload (sessionStorage-backed harness; refresh-resilience test)
+ [x] playwright: Auto (Current file) + folder breadcrumb click — pins concrete "Folder"
+ [x] playwright: a folder-declaring file pinned to current_file + breadcrumb click — jumps to "Auto (Folder)" (congruent)
+ [x] playwright: pick "Auto" again after pinning concrete — re-resolves mode + scope from the file
+ [x] playwright: bogus `nt_breadcrumb_last` — opens normally in current_file, no setIntegration, no error
+ note — downstream authoring (notegit, separate repo)
  + once shipped, set `nt_integration_mode=folder&nt_breadcrumb_last=portfolio` on the Atlas Mobile App H1 in the notegit demo content
  + this is a notegit content change, not part of this notethink story

+ acceptance
  + integration mode is auto-by-default and, while auto, follows the file's `nt_integration_mode` / `nt_breadcrumb_last`
  + a cold-opened file with `nt_integration_mode=folder` lands in folder mode unprompted, scoped by `nt_breadcrumb_last`
  + navigation is congruence-seeking — it keeps/returns to auto when the destination matches the file's declared mode, and pins a concrete mode only when it diverges; the result persists across reloads
  + explicit "Auto" re-selection fully resets mode + scope to the file
  + unrecognised values resolve to the normal default with a debug line, never an error
  + both keys are documented in AUTHORING_GUIDE.md and the guide is bumped to 1.1.0

+ commit message draft
  + notethink 0.3.14: integration mode gains an `auto` default (mirrors view-type auto) driven by new `nt_integration_mode` / `nt_breadcrumb_last` H1 linetags
  + in auto, a file declares folder mode plus the breadcrumb segment to scope to, so users land on the intended aggregate view; navigation is congruence-seeking — it returns to auto when congruent with the file and pins a concrete mode only when it diverges
  + resolved at doc-arrival with no hidden seeded-marker; graceful no-op on unrecognised values; AUTHORING_GUIDE bumped to 1.1.0
  + tests N jest


### Animated passive transitions in the kanban view [](?id=animated-passive-transitions)

The visible UX payoff. When the kanban view changes layout because of a *passive* update (external file edit from another VS Code window or editor, AI-agent edit, mtime change, anything not driven by the user's own drag) the affected notes and columns animate from old state to new state in a way that mimics manual drag-and-drop. Depends on [[multi-file-ordering-stable-identity]] (stable note identity is the keying contract) and [[folder-mode-dnd]] (so the manual and automatic UX stay consistent in folder mode) and [[kanban-optimistic-projection]] (the projection seam the FLIP layer decorates; user-initiated drags resolve via the projection, passive updates via FLIP).

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
  + the passive-update FLIP and the user-drag projection share one reconciliation seam — `passiveUpdateGate` becomes "user-move reconciliations resolve silently (projection already showed the move), passive ones resolve via FLIP"
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
