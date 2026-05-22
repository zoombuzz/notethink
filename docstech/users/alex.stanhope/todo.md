# Todo [](?ng_view=kanban)


### Coding standards audit and remediation [](?id=coding-standards-audit-remediation&status=doing)

Audit the codebase against every rule in `CODING_STANDARDS.md` and remediate non-compliant patterns in small, reviewable passes. Redo audit completed with six parallel section owners plus local AST scans: naming/React, imports/debug, code style, TypeScript, file/code-quality/error-handling, and testing/pre-push.

+ inventory scope
  + reviewed 138 TS/TSX files in `client/` and `playwright/`, excluding generated `dist`, dependency trees, `.git`, `.vscode-test-web`, coverage/build/out artifacts
  + classification used by the naming/TypeScript passes: 75 production files and 63 test/support files
  + stricter import/debug pass audited 70 production TS/TSX files, excluding tests, mocks, setup, declarations, generated code, and Playwright
  + code-style pass audited 71 production files and 67 test/support files, covering 452 production functions and 1619 test/support functions
  + file/code-quality pass scanned 101 production tracked code/style files and 56 test files
+ rule matrix
  + Naming Conventions > Variable Naming: non-compliant
    + production: 59 of 919 local/hook/computed variable occurrences violate snake_case; tests/support: 160 of 2140
    + examples: `convertMdastToNoteHierarchy.ts:34` has `lineIndex`, `headingIndex`, `parentEndOffset`, `seqCounter`; `notethinkEditor.test.ts` has 55 variable violations
  + Naming Conventions > Function Naming: mostly compliant with exceptions
    + production: 4 of 206 function/event-handler names violate camelCase; tests/support: 8 of 122
    + examples: `notethinkEditor.ts:894` `apply_one`, `viewhooks.ts:94` `on_scrollend`, `DocumentView.test.tsx:105` `make_props`
  + Naming Conventions > Props and Parameters: non-compliant
    + parameters: 111 of 530 production parameters and 46 of 559 test/support parameters violate camelCase, often because the codebase uses snake_case parameters
    + component props: 40 of 140 production prop fields violate camelCase; largest cluster is `ViewProps.ts:8` with `doc_path`, `doc_relative_path`, `workspace_root`, `aggregate_total_discovered`, `include_filter`
    + ambiguous: service callback props such as `setViewManagedState`, `deleteViewFromManagedState`, `postMessage`, and `getClearHandler` do not use the `on*` event prop pattern but may not be UI events
  + Naming Conventions > Types and Interfaces: compliant in scanned files
    + production: 0 violations across 87 types/interfaces/classes; tests/support: 0 violations across 15
  + Naming Conventions > Components: compliant in scanned files
    + production: 0 PascalCase component violations across 25 detected components; tests/support: 0 across 2
  + Naming Conventions > Constants: mostly compliant with semantic caveats
    + SCREAMING_SNAKE_CASE violations: production 1 of 43 likely true constants, tests/support 2 of 20
    + examples: `inserts/en.ts:37` `index`; `notethinkEditor.test.ts:73-74` `defaultDocPath`, `defaultDocText`
    + ambiguity: true constants are semantic; some local compile-time literals may be intentional local values rather than constants
  + Import Organization > Import Placement: partially compliant
    + no static import declarations were found after non-import code
    + 7 runtime `import()` expressions lack explanatory comments: `GenericNote.tsx:7-9`, `GenericView.tsx:29-31`, `reportWebVitals.ts:5`
  + Import Organization > Import Grouping: non-compliant
    + 22 production files have grouping-order issues
    + examples: `errorops.ts:3` imports `vscode` after externals; `index.tsx:5` imports `App` after `index.css`; `FilesDrawer.tsx:5` imports `globMatch` after SCSS; `renderops.tsx:2` imports an external after a relative type import
  + Import Organization > External Dependency Alphabetization: non-compliant
    + 4 production alphabetization issues: `errorops.ts:1`, `parseops.ts:1`, `NoteRenderer.tsx:3`, `renderops.tsx:2`
  + Import Organization > Type-Only Imports: non-compliant
    + import/debug pass: 6 production import statements are type-only but not `import type`
    + TypeScript pass: 15 production and 13 test/support imports appear type-only but are value imports
    + examples: `ErrorBoundary.tsx:1`, `GenericNoteWrapper.tsx:1`, `DocumentContextBar.tsx:1`, `KanbanColumn.tsx:1`, `renderops.tsx:1`, `renderops.tsx:6`
  + Code Style > Function Length and Decomposition: non-compliant
    + code-style pass: 41 production and 138 test/support functions exceed 35 body lines; local broader scan found 179 total over 35 body lines
    + largest production examples: `notethinkEditor.ts:110`/`:113` `myWebviewPanel` 886 lines, `GenericView.tsx:41` 730, `ExtensionReceiver.tsx:98` 353, `MarkdownNote.tsx:22` 263, `KanbanView.tsx:63` 239
    + largest test/support example: `notethinkEditor.test.ts:76` anonymous suite/callback 1068 lines
  + Code Style > Block Organization: review needed
    + mechanical scan found 300 production and 1442 test/support blank lines inside function bodies
    + examples: `extension.ts:7`, `extension.ts:12`, `notethinkEditor.ts:121`, `l10n-bundles.test.ts:13`
    + ambiguity: the rule allows blank lines between logical sections, so this count needs review rather than automatic remediation
  + Code Style > Comments: non-compliant
    + comments scanned: 419 production and 388 test/support
    + uppercase-start comments: 93 production, 159 tests; single-sentence comments ending with a period: 58 production, 19 tests; stacked `//` comment lines: 53 production, 29 tests
    + examples: `ExtensionReceiver.tsx:180`, `ExtensionReceiver.tsx:186`, `notethinkEditor.ts:1038` 11-line stacked comment block, `parseops.test.ts:86`
    + inline comments: 8 production, 9 tests; none exceeded the ~100-character inline threshold
    + back-reference/current-context comments: 3 production, 1 test; examples `ExtensionReceiver.tsx:256`, `noteui.ts:9`, `NoteProps.ts:139`, `__mocks__/vscode.ts:1`
    + project-management version-number comments: 0 found
    + per-field comments in data/type structures: 32 production, 8 tests; examples `NoteRenderer.tsx:39`, `mergeAggregateRoot.ts:36`, `NoteProps.ts:101`, `playwright/helpers/inject-multi-docs.ts:8`
  + Code Style > TODO Comments: compliant in scan
    + no TODO comments were found, so no malformed TODO comments were found
  + Code Style > Braces and Blocks: compliant in scan
    + AST scan found 0 unbraced `if`, `for`, `while`, or `do` control bodies
  + TypeScript Guidelines > Explicit Types: non-compliant
    + missing parameter types: 101 production, 211 tests/support
    + missing return types: 343 production and 1540 tests/support across all function-like nodes; stricter non-callback/non-simple bucket is 103 production and 56 tests/support
    + examples: `crypto.ts:2` defaulted `algo`, `errorops.ts:54` `combineTransform(info)`, `NoteRenderer.tsx:80` callback destructuring, `errorops.ts:18` `flushLogBuffer`, `errorops.ts:92` `isRedirect`, `renderops.tsx:10` `getStandardNoteDataProps`
  + TypeScript Guidelines > Avoid `any`: non-compliant
    + strict production source: 9 `any` usages, all in `errorops.ts`; tests/support: 173
    + examples: `errorops.ts:55`, `:56`, `:73`, `:101`, `:133`, `:149`, `:163`, `:167`, `:171`
    + heaviest test files: `notethinkEditor.test.ts` 73, `parseops.test.ts` 45, `convertMdastToNoteHierarchy.test.ts` 28
    + note: broader local scan counted mocks as production and produced higher production numbers; remediation should treat `__mocks__` as test/support
  + TypeScript Guidelines > Loop Safety: non-compliant under written rule
    + 12 production `while`/unclear-bound loops and 3 test/support loops
    + examples: `GenericNote.tsx:21`, `convertMdastToNoteHierarchy.ts:37`, `convertMdastToNoteHierarchy.ts:231`, `linetagops.ts:34`, `noteops.ts:128`, `noteui.ts:88`, `mergeAggregateRoot.test.ts:825`
    + ambiguity: several loops are bounded by regex progress or data-structure exhaustion, but the written standard says avoid `while` without explicit bounds
  + TypeScript Guidelines > Type Placement: non-compliant
    + broad AST count: 32 production and 2 test/support findings
    + hard examples: `mergeAggregateRoot.ts:227` `CollectedStory`, `notethinkEditor.ts:299` `FolderViewKey`, `noteui.test.ts:136-137`
    + ambiguity: some top-of-file ordering findings are caused by debug/constants preceding types
  + TypeScript Guidelines > Constants Placement: non-compliant
    + hard bucket: 16 production constants after runtime declarations and 14 test/support findings
    + examples: `ExtensionReceiver.tsx:94` `saved_state`, `ExtensionReceiver.tsx:96` `CONNECTION_TIMEOUT_MS`, `renderops.tsx:77` `renderCache`, `mergeAggregateRoot.ts:70` `ORDER_NEWEST_AT_BOTTOM`, `notethinkEditor.test.ts:73-74`
  + TypeScript Guidelines > Debug Logger Pattern: non-compliant
    + import/debug pass: 48 production files missing `Debug` as first import, 49 missing `const debug = Debug(...)`, 2 misplaced debug constants, 21 namespace mismatches
    + examples: missing `extension.ts:1`, `errorops.ts:1`, `App.tsx:1`, `renderops.tsx:1`, `reportWebVitals.ts:1`; misplaced `DocumentView.tsx:13`, `KanbanView.tsx:27`; namespace examples `pathsafe.ts:4`, `NoteRenderer.tsx:16`, `CodeNote.tsx:6`, `noteui.ts:7`
    + ambiguity: `CODING_STANDARDS.md` import grouping shows React before Debug, but Debug Logger Pattern says Debug must be first; namespace root is not fully defined
  + TypeScript Guidelines > Extension Points: compliant in current diff
    + single-case switches found and preserved: `GenericNoteAttributes.tsx:32`, `GenericNote.tsx:67`
    + no trivial extension-point helper collapse was detected because this was a read-only audit
  + React Patterns > Component Structure: non-compliant
    + 23 component-structure ordering findings across 26 production components
    + examples: `GenericView.tsx:41` has derived values before hooks and later hooks/effects after handlers/render-prep; `ExtensionReceiver.tsx:111` has an effect before later state/ref hooks and later effects after callbacks
  + React Patterns > Hook Return Values: non-compliant
    + 5 of 62 production hook returns violate snake_case, all in `ExtensionReceiver.tsx:108+`: `viewStates`, `viewStatesRef`, `navigationCallbackRef`, `globalSettings`, `folderViewSettings`
  + React Patterns > Event Handler Props: explicit `on*` props are compliant; callback-prop naming ambiguous
    + explicit `on*` props: 0 violations across 102 production and 13 test/support props
    + 13 production function-valued callback props lack `on*`, including `ViewProps.ts:39` `setViewManagedState`, `deleteViewFromManagedState`, `postMessage`, `getClearHandler`; these may be service callbacks rather than UI events
  + File Organization > Directory Structure: mostly compliant
    + major source trees follow `src/components`, `src/lib`, and `src/types`; no misplaced major source trees found
  + File Organization > File Naming: partially non-compliant or ambiguous
    + component and style module naming passed
    + utility filename exceptions: `convertMdastToNoteHierarchy.ts`, `globMatch.ts`, `mergeAggregateRoot.ts`
    + type filename exceptions: `client/extension/src/types/general.ts`, `client/webview/src/types/general.ts`
    + tracked generated/legacy JS beside TS: `client/webview/src/reportWebVitals.js`, `client/webview/src/setupTests.js`, `client/webview/src/types/general.js`
    + ambiguity: standards use `parseops.ts` as an accepted utility example, so camelCase utility filenames may be legacy violations or standards drift
  + File Organization > Test File Location: partially non-compliant or underspecified
    + most webview/notethink-views unit tests are adjacent
    + non-adjacent or cross-cutting examples: `client/extension/src/test/suite/lib/crypto.test.ts`, `client/extension/src/test/suite/extension.test.ts`, `client/extension/src/test/suite/openview-experiment.test.ts`, `client/webview/src/notethink-views/src/components/l10n-rendering.test.tsx`
    + missing adjacent test candidates: `FolderTreeComposer.tsx`, `NoteTreeComposer.tsx`, `GenericNoteAttributes.tsx`, `DocumentContextBar.tsx`, `viewhooks.ts`
    + ambiguity: extension Mocha integration tests and cross-cutting l10n tests need an explicit exception if they are intended
  + File Organization > Styles: compliant in scan
    + all CSS modules use `*.module.scss`; one global style exists as `client/webview/src/index.css`
  + Code Quality > Avoid Duplication: partially non-compliant
    + mirrored constants across extension/webview: `client/extension/src/constants.ts:6` with `client/webview/src/constants.ts:2`, and `client/extension/src/constants.ts:12` with `client/webview/src/constants.ts:9`
    + repeated hardcoded settings/config keys: `extension.ts:70`, `notethinkEditor.ts:277`, `notethinkEditor.ts:307`, `ExtensionReceiver.tsx:360`, `SettingsCommonControls.tsx:79`
    + ambiguity: extension and webview package boundaries may make shared constants non-trivial
  + Code Quality > Remove Unused Code: mostly compliant by lint, with exceptions
    + `pnpm run lint` passed, so no compiler/lint unused imports or vars are currently reported
    + active exploratory test file: `client/extension/src/test/suite/openview-experiment.test.ts:4-11`
    + diagnostic test logs: `extension.test.ts:202`, `:215`, `:258`
    + TS suppressions or eslint disables: 4 production hits in 4 files
    + no confirmed dead commented-out code found by the second pass; earlier unresolved marker remains `errorops.ts:73`
  + Error Handling > Use Error Utilities: partially non-compliant
    + extension-side code often uses `errorops`, but webview/library code often uses `console.*`; 18 production `console.*` hits in 10 files and 24 test hits in 6 files
    + examples: `ErrorBoundary.tsx:26`, `renderops.tsx:99`, `notethinkEditor.ts:1073`, `NoteRenderer.tsx:25`, `ExtensionReceiver.tsx:133`, `GenericView.tsx:178`
    + ambiguity: webview has no local browser-side error utility, so the standard may need one or an exception
  + Error Handling > Avoid Silent Failures: non-compliant
    + two production bare `catch {}` hits: `extension.ts:33`, `notethinkEditor.ts:699`
    + additional intentionally swallowed/fallback cases should be reviewed: `notethinkEditor.ts:1056`, `notethinkEditor.ts:1065`
  + Testing Standards > Test Naming: mostly compliant
    + test names generally use behavior-oriented `describe`/`it`/`test`; extension integration tests use Mocha `suite`/`test`, matching project guidance
  + Testing Standards > Test Structure: mostly compliant with style variations
    + exact `default_props` appears in 6 files, including `DocumentView.test.tsx:24`
    + more complex tests use camelCase helper functions such as `makeViewProps`, which is function naming compliant but differs from the sample object style
  + Testing Standards > E2E no reloads as workarounds: compliant in scan
    + no `page.reload()` found; all 12 `page.goto(...)` calls are in `test.beforeEach` initial harness setup, e.g. `kanban-drag.spec.ts:9`
  + Testing Standards > Disabling specs indefinitely: compliant in scan
    + no `test.skip(...)`, `.skip(...)`, or commented-out `test`/`it`/`describe` specs found in scoped test files
  + Pre-Push Verification > `pnpm run check`: non-compliant documentation/runtime mismatch
    + `CODING_STANDARDS.md` requires `pnpm run check`, but root `package.json` has no `check` script
    + command table says `pnpm run jest-test`, but actual root script is `test-jest`; no `jest-test` script found
  + Pre-Push Verification > No web dev server: mostly compliant, but wording ambiguity
    + no root `dev` script found
    + Playwright starts an HTTP harness via `playwright.config.ts:16` and `playwright/harness/serve.mjs:28`; likely test infrastructure, but the standard says “no HTTP server” literally
  + Pre-Push Verification > Build after every code change: process-only, not statically verifiable
    + `pnpm run build` exists and maps to webpack; `test-playwright` also builds before Playwright
    + working tree is dirty, but file inspection cannot prove whether build was run after each change
  + Pre-Push Verification > Individual Commands: partially non-compliant
    + build, rollup, lint, and Playwright commands exist or are backed by package scripts
    + Jest command in table is wrong (`jest-test` vs `test-jest`)
    + documented Rollup command uses `cd ... && pnpm run rollup`, conflicting with workspace guidance to prefer `pnpm -C`
+ remediation plan
  + [ ] add automated audit checks for debug imports, type-only imports, explicit return types, `any`, unbounded `while`, unbraced control bodies, function length, and comment shape where ESLint/AST checks can enforce them
  + [ ] decide and document ambiguity resolutions: Debug import ordering vs import grouping, debug namespace root, browser-side error utility expectation, extension-test colocated exception, Playwright harness exception, utility filename casing
  + [ ] fix `CODING_STANDARDS.md`/`package.json` mismatch by adding `check` or changing the documented command; correct `jest-test` to `test-jest`
  + [ ] normalise imports and debug logger pattern in production files, starting with `notethink-views/src/components`
  + [ ] convert type-only imports to `import type` and reorder import groups consistently
  + [ ] add explanatory comments to runtime `import()` expressions or convert them to static imports
  + [ ] rename locals, hook returns, computed values, functions, parameters, props, and constants according to the naming matrix; preserve public wire-format fields only where deliberately documented
  + [ ] split long production functions by responsibility, prioritising bodies over 100 lines before test callbacks
  + [ ] add missing explicit parameter and return types, starting with production non-callback functions and `errorops.ts`
  + [ ] replace production `any` with concrete types or `unknown` plus narrowing; quarantine unavoidable test casts behind helper types
  + [ ] move file-level type definitions and constants near the head of each file
  + [ ] replace unbounded `while` loops with bounded loops or documented safe alternatives
  + [ ] rewrite comments to lowercase, single-thought, non-field-comment style; remove stale back-reference/current-context comments
  + [ ] refactor component bodies toward documented React structure: hooks first, effects, handlers, early returns, render
  + [ ] reconcile file naming and test-location exceptions, or update `CODING_STANDARDS.md` to document intended exceptions
  + [ ] consolidate duplicated defaults/settings keys where package boundaries allow; otherwise document why they must be mirrored
  + [ ] replace silent catches and console-only production error handling with `debug` or shared error utilities; add a webview-side utility if needed
  + [ ] remove diagnostic test logging, active exploratory test code, tracked generated JS files, TS suppressions where avoidable, and unresolved marker comments
  + [ ] run `pnpm run check` or the corrected equivalent after each remediation batch and fix any red lint, build, rollup, or Jest failures
+ acceptance
  + every rule in `CODING_STANDARDS.md` is either compliant, remediated, or explicitly documented as an intentional exception
  + automated checks prevent recurrence for rules that can be checked mechanically
  + production files comply with the resolved debug logger convention
  + imports are grouped consistently and type-only imports are used where appropriate
  + naming violations are removed or documented where they are public wire-format compatibility fields
  + production functions over the 35-line guideline are decomposed or explicitly justified as flat dispatch/data-literal exceptions
  + no avoidable production `any`, unbounded `while`, silent failure, or console-only error handling remains
  + comments follow the lowercase, single-thought, non-field-comment style
  + test-suite structure and pre-push commands match the documented standards
  + `pnpm run check` or the corrected equivalent is green


### Decompose long functions into objects, hooks, and helpers [](?id=function-decomposition)

Execute the Function Length finding from [[coding-standards-audit-remediation]] (41 production functions over 35 body lines). The goal is not the line count itself but *explicit dependencies, minimal shared mutable state, and testable seams* — the fix differs by the kind of function, so this story splits the work by category rather than by file.

+ goal
  + the worst stateful closures become classes whose methods have explicit `this` dependencies and can be unit-tested without the surrounding context
  + long React components shrink by moving cohesive hook clusters into custom hooks and JSX subtrees into child components
  + pure-logic functions decompose into named helpers that read as a sequence of steps
+ background
  + `notethinkEditor.ts` `myWebviewPanel` (~760 lines after dead-code removal) is a closure-as-object: ~11 mutable vars (`active_doc`, `active_path`, `integration_path`, `integration_watcher`, `integration_docs`, `change_timer`, …) shared ambiently by ~11 inner closures (`buildDoc`, `sendDoc`, `sendSelection`, `sendCurrentSelection`, `syncActiveFileWatcher`, `apply_one`, the `onDidReceiveMessage` handler). No closure has a contract; the unit is only testable through its outer boundary
  + React components (`GenericView` 730, `ExtensionReceiver` 353, `MarkdownNote` 263, `KanbanView` 239) are long for a different reason — the Rules of Hooks forbid lifting hook-containing blocks into plain functions, so they must become custom hooks or child components
  + pure-logic helpers already decompose cleanly (done for `calculateTextChangesForOrdering`, `mergeAggregateRoot`'s walk)
+ scope — extension closure → class
  + extract `myWebviewPanel` into a `PanelSession` class: the mutable state becomes private fields, the closures become methods (`buildDoc`, `sendDoc`, `applyEditText`, `syncActiveFileWatcher`, `handleMessage`, …), `webviewPanel`/`context` become constructor args
  + add characterization tests around the panel boundary FIRST (message-in → doc-out, editText apply, integration flip) so the refactor is safety-netted before any code moves
  + split the `onDidReceiveMessage` switch so each `case` delegates to a named method rather than an inline block
+ scope — React components → hooks + subcomponents
  + `ExtensionReceiver`: extract state+effect clusters into custom hooks (e.g. `useVscodeMessages`, `useFolderViewSettings`, `usePersistedViewStates`); keep the component a thin wiring shell
  + `GenericView`: move derived-value/hook clusters into hooks and large JSX subtrees into child components; align the body with the documented React structure (hooks → effects → handlers → early returns → render)
  + `KanbanView` / `MarkdownNote`: extract column-derivation and render subtrees as the [[view-hierarchy-and-card-types]] work will also touch these — coordinate so the two stories don't fight
+ scope — pure logic
  + continue extracting named helpers from any remaining long pure functions (`convertMdastToNoteHierarchy` helpers, etc.) as they are touched
+ out of scope
  + behavioural change of any kind — every refactor must be byte/behaviour identical, proven by the existing + new characterization tests
  + chasing the 35-line number on flat dispatch switches, JSX returns, or data literals — these are documented exceptions, justify in a header comment rather than splitting
  + test-callback length (the 1068-line `notethinkEditor.test.ts` suite) — lower priority than production bodies
+ approach
  + incremental: one seam per change, `pnpm run check` green between each — never a big-bang rewrite
  + production bodies over 100 lines first (`myWebviewPanel`, `GenericView`), then the 35–100 band
  + add tests before extracting, not after, wherever the unit is currently only covered through its boundary
+ files (primary)
  + `client/extension/src/vscode/notethinkEditor.ts` → new `PanelSession` class (same file or a new `vscode/PanelSession.ts`)
  + `client/webview/src/components/ExtensionReceiver.tsx` + new `client/webview/src/hooks/*` custom hooks
  + `client/webview/src/notethink-views/src/components/views/GenericView.tsx` + extracted child components/hooks
+ [ ] add characterization tests around `myWebviewPanel`'s message/edit/integration boundary
+ [ ] extract `PanelSession` class; `myWebviewPanel` becomes a thin constructor + wire-up
+ [ ] split `onDidReceiveMessage` so each case delegates to a named `PanelSession` method
+ [ ] extract `ExtensionReceiver` state/effect clusters into custom hooks; component becomes a wiring shell
+ [ ] decompose `GenericView` into hooks + child components; align with documented React structure
+ [ ] decompose `KanbanView` / `MarkdownNote` render subtrees, coordinating with [[view-hierarchy-and-card-types]]
+ [ ] extract remaining long pure-logic helpers as touched
+ [ ] each production function over 35 lines is decomposed or carries a header comment justifying the exception
+ [ ] `pnpm run check` green after every batch
+ acceptance
  + `myWebviewPanel` is a `PanelSession` class with private fields and method-level contracts; no ambient-state closures remain
  + long React components are thin shells over custom hooks + child components, following the documented structure
  + every retained over-length function has a one-line header justification
  + behaviour is identical — existing + new tests green, no Playwright regressions
+ commit message draft
  + notethink 0.2.x: decompose `myWebviewPanel` into a `PanelSession` class and split long React components into hooks + child components
  + behaviour-identical refactor backed by new characterization tests; per-method contracts replace ambient closure state
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
