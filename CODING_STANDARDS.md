# NoteThink Coding Standards

**This is notethink's rulebook. Read it at the start of any session that touches `notethink`, and re-read the relevant section before a commit, push, merge, version bump, refactor or new-file placement rather than recalling it from memory.** If a rule you expect is missing, flag the gap and ask whether to add it here; do not fall back to training-data defaults.

**Workspace-wide process** (story lifecycle and tracking format, version bumps, commit policy, git workflow, the never-write-with-git rule, the releaseable-state gate, dev-server lifecycle) lives in [`../AGENTS.md`](../AGENTS.md). **Shared coding standards** live in `lightenna-iac/docstech/standards/` ([index](../lightenna-iac/docstech/standards/README.md)), and this file holds only notethink's deltas from them:

| Doing | Read |
|---|---|
| naming anything | [`NAMING.md`](../lightenna-iac/docstech/standards/NAMING.md) |
| placing imports / types / constants, structuring a file | [`CODE_LAYOUT.md`](../lightenna-iac/docstech/standards/CODE_LAYOUT.md) |
| writing types or props | [`TYPESCRIPT.md`](../lightenna-iac/docstech/standards/TYPESCRIPT.md) |
| adding a log line, debug statement, or error path | [`LOGGING.md`](../lightenna-iac/docstech/standards/LOGGING.md) |
| writing or changing a test | [`TESTING.md`](../lightenna-iac/docstech/standards/TESTING.md) |
| verifying before handback | [`VERIFICATION.md`](../lightenna-iac/docstech/standards/VERIFICATION.md) |

**notethink is a VS Code extension**, so [`NEXTJS.md`](../lightenna-iac/docstech/standards/NEXTJS.md) and [`DATABASE.md`](../lightenna-iac/docstech/standards/DATABASE.md) do not apply, and only the environment-variable part of [`SECURITY.md`](../lightenna-iac/docstech/standards/SECURITY.md) does. The extension host and the webview are different runtimes with different logging stacks, which is where most of the deltas below come from.

**notethink deliberately leads the fleet on `eslint` majors, as a canary**: a new major meets our flat configs here first, where there is no deployed surface. Do not pin it back in a dependency wave (operator decision).

notethink carries the worked examples behind the workspace `<noun>ops.ts` rule; see [Library organisation](#library-organisation).

## Naming Conventions

Canonical: [`NAMING.md`](../lightenna-iac/docstech/standards/NAMING.md). notethink deltas:

- **snake_case for data, camelCase for behaviour.** Fields on the note, view and message shapes (`NoteProps`, `ViewProps`, `NoteOrigin`, the `*Message` types) are `snake_case` (`doc_path`, `include_filter`), because they mirror the extension-webview wire format, which is snake_case end to end. A parameter that carries one of those values keeps the snake_case name (`processNote(note_id: string)`). Other parameters and props are camelCase, and so are UI event-handler props (`onClick`, `onNoteChange`) and callbacks (`setViewManagedState`, `postMessage`), which are functions.
- **Constants known at compile time are `SCREAMING_SNAKE_CASE`, exported ones included** (`DEFAULT_COLUMN_ORDER`, `NOTETHINK_VIEW_TYPE`); notethink does not use NAMING.md's PascalCase form for exported configuration constants. A value computed at runtime is a snake_case local, not a constant.

### Permanent name check

A name that lands in a store this codebase cannot rewrite needs the operator's sign-off before it is introduced or renamed, because a later rename needs a migration path or breaks whoever already pinned the old name:

- VS Code (or any host) config keys (`notethink.settings.X.Y`), written to `settings.json` on machines we do not own
- persisted-state keys (`vscode.setState` shapes, IndexedDB key names, JSON keys on user disk)
- database table and column names, cookie and header names, URL path segments
- public API names exported from a published npm package
- file and directory names that other tools, scripts or workflows target

Internal names (variables, functions, types, in-memory shapes, transient extension-webview messages) need no check. Reason: a config namespace named for the one view it first served (`notethink.folderView.*`) stops describing its settings once they apply to every view, and by then it is already in users' `settings.json`. When in doubt, ask.

### `stable_id` field: implicit vs explicit provenance

Every note has a `stable_id`, in two grades:

- **Implicit (transient)** - derived from the headline by `storyStableIdSlug` at parse time and never written to the file. It changes when the title changes. Use it for React keys, kanban drag projections and any intra-session matching.
- **Explicit (persistent)** - the authored `[](?id=slug)` linetag, frozen once written. It is the only grade safe for a durable cross-session reference.

Transient code uses the implicit id and writes nothing to the file. Write an explicit `id=` linetag only when a durable artifact (a `[[…]]` cross-reference, a user-authored link) must survive renames and reloads. NoteThink does not resolve `[[…]]`: the parser is `mdast-util-from-markdown` with the GFM and frontmatter extensions and no wiki-link extension, so `[[x]]` renders as literal text and a reader follows it by searching the file for `?id=x` or the heading it derives from. Decision rules: [AUTHORING_GUIDE.md > Stable ids: implicit vs explicit](./AUTHORING_GUIDE.md#stable-ids-implicit-vs-explicit).

### A `seq` is valid only within the render pass that derived it

`note.seq` is a document-order index, reassigned on every parse and renumbered globally by `mergeAggregateRoot` whenever the per-file trees are re-interleaved. It addresses a position in the current tree, not a note.

**If a value crosses an update boundary - cached in a `useMemo`, written to view-managed state, stashed in a ref, or emitted into the DOM for a later effect to look up - it must be a `stable_id` (identity) or a source offset (position), never a `seq`.** Resolve it back to a `seq` on read, against the tree you are about to render. Same-pass use is fine and cheapest: `focused_seqs` and `resolveCaretTarget`'s `v<view>-n<seq>` element id are derived and consumed in one render.

A React key crosses an update boundary too, because reconciliation matches it against the previous render's keys, so a bare `seq` key hands a renumbered note the previous occupant's component state. `DocumentView` and `renderBodyItems` therefore key by `stable_id ?? seq`; the `?? seq` is unreachable defensive cover, since both stamping walks in `mergeAggregateRoot` reach every note, and must not be read as licence to key by `seq`. The raw mdast body nodes in `renderBodyItems` have no `stable_id` and key by source offset.

There is no mechanical check. The tell is a `seq` on the right-hand side of an assignment that outlives the render: a dependency array, a `setViewManagedState` payload, a `useRef`, a `data-` attribute paired with a stored lookup key. Reason: this has surfaced three times as a user-visible bug that looked like a caching or scrolling fault rather than an identity one; `writeViewInteractionState` (focus and selection stored as `stable_id`s) and `resolveParentContextNote` (scope stored as `parent_context_id`) are the fixed forms.

## Import Organization

Canonical: [`CODE_LAYOUT.md`](../lightenna-iac/docstech/standards/CODE_LAYOUT.md) > Import placement and > Import organisation: every `import` at the top, one statement per module, an inline dynamic `import()` only with a comment saying why a static import will not do, and grouping freeform. One house habit, not a requirement: where a webview file imports `debug`, that import leads the list.

## Code Style

### Function length and decomposition

- **Aim for at most 30-35 lines of function body.** Guidance, not a hard cap: a flat data literal or a single unavoidable dispatch can run longer, but branching logic past that length is almost always hiding extractable steps.
- **Extract by responsibility, at a genuine seam** (validation, transformation, output, a self-contained sub-algorithm), so the caller reads as a sequence of named steps.
- **The target is explicit inputs and outputs, not the number.** A 40-line function whose inputs are parameters and whose output is a return value is fine; a 25-line one reaching into ten ambient mutable variables is not.
- **Put the explanation in the header block above the function**, and keep inline comments sparse. Narrating each step inline means the steps want to become named functions.
- **A long function whose inner closures share its mutable state becomes a class**: the state becomes private fields and the closures methods, each with explicit dependencies. This is the fix for stateful non-React code.
- **In React, decompose into custom hooks (`useFolderDocs()`) and child components (`<KanbanBoard>`)**, never into plain helpers wrapping hook calls, and never by splitting at an arbitrary line.

```typescript
// prefer - the caller reads as named steps; each helper has a header comment
async function applyEdit(doc_path: string, changes: TextChange[]): Promise<void> {
    if (!isWithinWorkspace(doc_path)) { return; }
    const invalid = firstInvalidChange(changes, doc_length);
    if (invalid) { logRejection(invalid); return; }
    logEditTextChanges(document, doc_path, changes);
    await applyEditTextChanges(document, uri, changes);
    reEmit(document);
}
```

### Block organisation

[`CODE_LAYOUT.md`](../lightenna-iac/docstech/standards/CODE_LAYOUT.md) > Blank lines holds the rule. notethink's delta: a single blank line may separate the logical sections of a function body, each section opening with its comment; there are no other blank lines inside a block.

### Braces

Always brace a control structure, a one-statement body included: `if (is_valid) { processItem(); }`, never `if (is_valid) processItem();`.

### Comments

Canonical: [`../AGENTS.md`](../AGENTS.md) > Code conventions > Comment style, and the dash ban in > Dashes. `local/no-consecutive-line-comments` enforces one comment per line here. notethink extras:

- a single-line `//` comment takes no trailing period unless it holds more than one sentence; a `/* */` or `/** */` header block is prose and takes normal capitalisation and punctuation
- the section dividers the workspace rule permits inside a data structure (`// --- identity ---`, `// --- tree links ---`) are load-bearing in notethink's long interfaces, so keep them when sweeping for per-field comments. A divider introduces two or more fields with one purpose, and a comment grouping the deliberate absence of related fields (`// doc_path/doc_relative_path/doc_text intentionally undefined for the merged view`) also qualifies; a comment explaining one field moves to the type's header block

## TypeScript Guidelines

Canonical: [`TYPESCRIPT.md`](../lightenna-iac/docstech/standards/TYPESCRIPT.md) (strict mode, the `any` policy, inline `type` imports) and [`CODE_LAYOUT.md`](../lightenna-iac/docstech/standards/CODE_LAYOUT.md) (types and constants at the head of the file, and no constant repeated inline across functions). notethink deltas:

- **Annotate the parameters and return type of every named function**; only a simple arrow function (`const double = (n: number) => n * 2`) may leave its return to inference.
- **Loop safety has one exception here.** [`LOGGING.md`](../lightenna-iac/docstech/standards/LOGGING.md) > Loop safety bans unbounded loops. A `while` driven by a strictly-progressing finite iterator needs no counter, because it terminates by construction: `regexp.exec(str)` with a non-zero-width pattern, `TreeWalker.nextNode()`, and a stack or queue drain that only `pop()`s. Anything that could stall (an unbounded condition, a zero-width match) still takes a bound.

## Logging and Error Handling

Canonical: [`LOGGING.md`](../lightenna-iac/docstech/standards/LOGGING.md). notethink runs one stack per runtime:

- **The extension host** (`client/extension/**`) logs through `writeToLog` / `writeToErrorLog` (winston, `client/extension/src/lib/errorops.ts`).
- **The webview and `notethink-views`** have no winston and no output channel: they log through `debug`, and a render failure that should reach the host posts a `renderError` message to the extension.

`console.*` is not the error utility in either (workspace `AGENTS.md` > No `console.log` in committed code). **A caught error that is intentionally non-fatal must still be logged, never silently swallowed:**

```typescript
// extension host
try {
    await riskyOperation();
} catch (error) {
    writeToErrorLog('pathops', 'riskyOperation failed', error);
}

// webview - no winston here, so log through the debug instance
try {
    await riskyOperation();
} catch (error) {
    debug('riskyOperation failed %O', error);
}
```

**`debug` is optional**: put it where it earns its place, and never add or remove one as a review action. Two deltas from LOGGING.md:

- **The namespace is area-based**, `nodejs:<area>:<File>`, where `<area>` is the bundle (`notethink` for the webview app, `notethink-views` for the component library) and `<File>` the source basename: `Debug("nodejs:notethink-views:KanbanView")`. The shared path-derived form does not fit a repo whose source tree and bundle boundaries differ.
- **It belongs to the webview bundles.** Reaching for `Debug` in the extension host usually means reaching for the wrong stack; `client/extension/src/lib/pathops.ts` is the one extension-host module that imports it, and whether it moves to `writeToLog` is undecided. Type-only modules (`types/NoteProps.ts`) never import it.

Webview `debug` output is not captured to any file: enable it with `localStorage.debug = 'nodejs:*'` in "Developer: Open Webview Developer Tools", where webview `console.error` / `console.warn` also appear.

### Reading VS Code logs

**The CLI-readable runtime log is `notethink-extension.log` in the extension's own VS Code log directory, `vscode.ExtensionContext.logUri`**, never the user's open workspace folder: a shipped extension must not litter the user's project with log files. `initLogDir(context.logUri)` in `activate()` sets it up, and every `writeToLog` / `writeToErrorLog` (and `logEditTextChanges`) is mirrored there. NoteThink is a web-worker extension (publisher `NoteThink.notethink`), so on Linux:

```bash
LOG=$(ls -t ~/.config/Code/logs/*/window*/exthost/webWorker/NoteThink.notethink/notethink-extension.log 2>/dev/null | head -1)
tail -f "$LOG"
```

On macOS the root is `~/Library/Application Support/Code/logs/`, with the same `…/exthost/webWorker/NoteThink.notethink/` tail.

- **Dev-only, off by default.** The file logger is gated by the `NOTETHINK_DEV` webpack define, which is `process.env.SELFINSPECT_ENV === 'dev'` (the workspace env marker, never `NODE_ENV`). `build` and `watch` export it; the marketplace `package` build and any hosted build leave it unset, so the logger is dead-code-eliminated. A shipped extension must never silently fill a user's disk with logs.
- **A rolling buffer**: the last `LOG_BUFFER_MAX` lines, rewritten wholesale `LOG_FLUSH_MS` after a write. Both constants head `client/extension/src/lib/errorops.ts`.
- **VS Code makes a new session directory each time it starts**, so re-resolve the path with the `ls -t` line every time rather than caching it. Missing or empty means a production build, a window not reloaded after the rebuild, or nothing logged yet.
- **A `notethink-extension.log` in the repo root or a parent directory is stale litter** (gitignored as spurious): do not read it, delete it.
- **Desktop only.** The logger writes through `vscode.workspace.fs`, so in a web host (vscode-web, notegit's workbench) there is no terminal-readable file; read the browser devtools console there.
- The "NoteThink" `LogOutputChannel` (View > Output > NoteThink) carries the same `writeToLog` stream and persists as `NoteThink.log` in the same directory, filtered by the channel's level; prefer `notethink-extension.log` for CLI reads.

**Two log streams, two homes - do not conflate them:**

| Stream | Home |
|---|---|
| Runtime / behaviour | `notethink-extension.log` under `logUri`, above |
| Build / watch (webpack) | `test-results/dev.log` in the repo (gitignored), where `/open-dev` redirects `pnpm run watch` |

Never route build output to `/tmp`: it is ephemeral, and each stream has one documented place.

## Security

notethink has no server-side component, no database and no user accounts, so the auth, server-action and RLS sections of [`SECURITY.md`](../lightenna-iac/docstech/standards/SECURITY.md) do not apply. Its environment-variable rules do, for the build and publish scripts: never put a secret in `argv` or in a committed file. Anything the extension writes to a user's `settings.json` is public by construction (see [Permanent name check](#permanent-name-check)).

## Framework: VS Code extension and React webview

### Component structure

Hook return values are snake_case and the functions a hook returns are camelCase, per [`NAMING.md`](../lightenna-iac/docstech/standards/NAMING.md). A component body runs hooks, effects, handlers, early returns, then render:

```typescript
export default function ComponentName(props: Props) {
    // hooks first
    const [is_loading, setIsLoading] = useState(false);
    // effects
    useEffect(() => {
        debug('component mounted');
    }, []);
    // handlers
    const handleClick = useCallback(() => {
        setIsLoading(true);
        props.onAction?.();
    }, [props.onAction]);
    // early returns
    if (is_loading) {
        return <div>Loading...</div>;
    }
    // render
    return <button onClick={handleClick}>{props.title}</button>;
}
```

### View interaction state: latest-click-wins with the editor as tiebreaker

Per-view interaction state has two layers, and the editor wins ties. A view gesture (click, drag, keyboard nav) writes `view_focused_ids` / `view_selected_ids` straight into view-managed state, so it lands immediately. The editor-derived match (caret in note, per doc and source position) overrides it whenever it produces a result, because almost all editing happens in the editor. The view-driven layer covers the gap before the editor's `selectionChanged` round-trip and the case where the editor has no opinion (its active doc is outside the aggregated set, or the caret is outside every note).

- **The editor takes DOM focus.** A `revealRange` / `selectRange` posted by the view routes through `vscode.window.showTextDocument(..., { preserveFocus: false })`, so the webview never captures keystrokes the user expects to land in the editor.
- **The view follows the editor.** When the editor moves to a different note, for any reason, the view's focused and selected state follows on the next derivation, even over an earlier view click.
- **Matchers work across every aggregated doc.** Editor-driven decoration must not assume one coordinate space: match on per-doc origin metadata (`origin.doc_path` + `origin.source_position`) so one algorithm serves `current_file` and `folder` modes with no `integration_mode` branch.

Reason: a view aggregates N files while the editor has one active doc, so state driven through the editor alone never confirms outside that doc, and state pinned to the last view click goes stale the moment the user types. Canonical: `client/webview/src/notethink-views/src/components/views/generic/useViewHandlers.ts` (the click dispatcher, through `writeViewInteractionState` in `lib/viewstateops.ts`) and `useViewContext.ts` beside it (`resolveFocusedNote`, from `lib/noteops.ts`).

### Focused-note scroll framing

When a note becomes focused or selected, `useScrollToCaret` (`viewhooks.ts`) frames it:

- **The highlight ring is visible on every edge, never cropped.** The ring is an `outline` with offset and width that `getBoundingClientRect` excludes, so the scroll reserves space for it, measured against the scroll container's client size, not `window.innerWidth/innerHeight`.
- **A note that fits** the viewer shows whole, ring included; **one wider or taller** than the viewer anchors top-left.
- Revealing the caret line inside a clipped note body belongs to `useMarkdownNoteBodyScroll`, not this hook.

The recurring regression is a ring cropped on the left edge of a card flush against the scroll container: verify by focusing a card in the leftmost column.

## File Organization

**notethink has no root `src/`.** Establish which of its three source roots you are in first:

| Root | What it is |
|---|---|
| `client/extension/src/` | the extension host - winston logging, VS Code API, no DOM |
| `client/webview/src/` | the webview app - React, `debug` logging, no `fs` |
| `client/webview/src/notethink-views/src/` | a **nested package** with its own `package.json`, `rollup.config.js`, tsconfig and `node_modules`: `components/views/`, `components/notes/`, `lib/`, `types/`, and the public exports in `index.ts` |

`ls` a directory rather than trusting a listing of it. File naming follows [`CODE_LAYOUT.md`](../lightenna-iac/docstech/standards/CODE_LAYOUT.md) > File naming, with these deltas:

- **Types** are `PascalCase.ts` (`NoteProps.ts`). **Styles** are CSS modules beside their component (`components/Spinner.module.scss`); there is no `styles/` directory.
- **A single-operation module** is named `camelCase.ts` after its one export (`convertMdastToNoteHierarchy.ts`, `mergeAggregateRoot.ts`, `globMatch.ts`). Pick one style per module and keep it stable.
- **A component-local helper** sits beside its component (`components/views/kanban/kanbanDragEndPayload.ts`), not in `lib/`; the path signals that it is not a general op.

### Library organisation

The rule is workspace [`../AGENTS.md` > Library organisation](../AGENTS.md#library-organisation-nounopsts), and this is its reference write-up. The nouns here include `noteops` (traversal, position, classification), `originops` (project metadata, hue), `pathops` (segmentation, workspace-root derivation), `viewstateops` (view-managed state), `docops`, `editops` (change validation, audit logging), `cryptoops` (hashing, nonces, identifiers) and `vscodeops` (VS Code API wrappers and the persisted state shape).

The worked examples:

- **Fold a small helper into the noun its consumers share.** The generic `arraysEqual<T>` lives in `noteops.ts` because both its consumers are note-adjacent, and its docstring says it lifts out the moment a non-note caller appears. `VSCodeState` and `migrateSavedState` live in `vscodeops.ts` because the wrappers there produce and consume the type.
- **Split a junk drawer by noun.** A `utils.ts` was split: `getNonce` joined `crypto.ts` as one `cryptoops.ts`, and `abbrevDoc` went to `docops.ts`.
- **Keep a one-export file only when you can name its second export.** `docops.ts` is the example the ≥ 4-exports target's escape clause names.
- **A single-operation module keeps its sentence name** (above); the ≥ 4-exports target does not apply to it.
- **Constants mirrored across the bundle boundary are the documented exception**, below.

### Mirrored constants across the extension/webview boundary

A small set of folder-view defaults is duplicated in `client/extension/src/constants.ts` and `client/webview/src/constants.ts`. The two are separate webpack bundles with no shared module graph, so there is no import path to one source: the duplication is the wire contract, and neither side is `*ops.ts`-ified. **The shared subset must agree; the files are not identical.** Shared: the include/exclude glob defaults and `DEFAULT_COLUMN_ORDER`, each cross-referenced in a comment on both sides. Every other constant in either file is one-sided by design (`DEFAULT_MAX_NOTES_PER_FILE`, for instance, is webview-only and not round-tripped), so do not push it across.

## Code Quality

- Extract repeated code, values and UI into shared functions, constants and components.
- Delete unused imports, variables and commented-out code. `@typescript-eslint/no-unused-vars` is at `error` with `^_` ignore patterns for arguments, variables and caught errors, so an unused `const debug` fails lint like any other binding. A leading underscore opts a binding out: use it only where the binding is evidence of something (an unwired format, a captured value whose missing assertion is a tracked bug, a parameter kept as an extension point), always with a comment saying what it is evidence of and which story tracks it.

## Testing Standards

Canonical: [`TESTING.md`](../lightenna-iac/docstech/standards/TESTING.md), and workspace [`../AGENTS.md`](../AGENTS.md) > Testing conventions (no page reloads as workarounds, comment a spec out rather than `test.skip`). notethink deltas:

- **Jest specs sit beside their source in three packages**, each with its own `jest.config.cjs`: `client/extension`, `client/webview` (which ignores the nested package) and `client/webview/src/notethink-views`. `pnpm run test-jest` at the root runs all three. Component tests use React Testing Library.
- **Extension-host tests that need the live VS Code API** run under the `@vscode/test-electron` Mocha runner in the central `client/extension/src/test/suite/**`, not colocated: the runner discovers them by directory, and they need the real extension-host environment.

## Working Style

### Present, don't force a decision

When the operator asks to "have a look", "let me see them", "just present them" or "show me the options", present them with a brief honest assessment and stop. Do not follow up with an `AskUserQuestion` (or any other prompt) that forces a choice; the operator will volunteer it. Reserve `AskUserQuestion` for genuinely blocking ambiguity.

### No speculative specs in todo.md

When working through a story's planned phases, do not invent feature specs, phases or tasks beyond what was scoped; they come from the operator. Mention a follow-up that seems worth doing in the wrap-up rather than writing it into `todo.md`.

## Pre-Push Verification

Canonical: [`VERIFICATION.md`](../lightenna-iac/docstech/standards/VERIFICATION.md). All tests must pass locally before pushing; CI runs lint and build only. After any session that changed files, run `pnpm run check`: lint (eslint + `tsc --noEmit` over all three tsconfigs), the webpack build, the `notethink-views` rollup, then Jest across all three packages.

| What | Command |
|------|---------|
| Lint | `pnpm run lint` |
| Build | `pnpm run build` |
| Rollup | `pnpm -C client/webview/src/notethink-views run rollup` |
| Jest | `pnpm run test-jest` |
| Playwright E2E | `pnpm run test-playwright` |
| Lint, build, rollup and Jest | `pnpm run check` |

### No web dev server

notethink has no `dev` script and no HTTP server, so there is no port to probe. It is not an exception to the workspace dev-server start pattern: `/open-dev` launches `pnpm run watch` (webpack) with `systemd-run --user --scope --slice=devservers.slice`. The bundles are previewed in an ordinary VS Code window through the `notethink-dev` symlink in [`AGENTS.md` > Dev Server](AGENTS.md#dev-server), or manually through the F5 Extension Development Host. The Playwright harness (`playwright.config.ts` starts `playwright/harness/serve.mjs` on port 9123 for the run and tears it down) is test infrastructure, not a dev server.

### After every code change

Rebuild after every code change (`pnpm run build`, or `pnpm run check`) so the change can be previewed. **A webview or React source edit changes nothing on screen by itself**, because the extension serves the prebuilt `client/webview/dist/index.js`. After editing under `client/webview/src/`:

1. **Find the live code path first** where a component has several. The breadcrumb trail's single-file branch (`splitPathSegments`) and directory-aggregate branch (`integration_path`) both live in `breadcrumbSegmentsForView` in `notethink-views/src/lib/pathops.ts`, not in `BreadcrumbTrail.tsx`; edit the wrong one and nothing visible changes.
2. Run `pnpm run build` (webpack compiles `notethink-views` from `src/`; `build-and-rollup` also refreshes `notethink-views/dist/esm`).
3. **Confirm the edit landed in the bundle**: grep `client/webview/dist/index.js` for a token from it.
4. Ask the user to **reload the VS Code window**; an open webview keeps the old bundle until then.

**Never report a UI change as done from a source edit alone.** When `NOTETHINK_DEV`, `getHtmlForWebview` appends a per-load `?v=<timestamp>` to the bundle URL so a dev reload fetches the fresh bundle (production keeps the cacheable URL). If a change still seems not to apply, confirm the running build through the file log and that the window really was reloaded.

## Release & Publishing

`sh/git/merge-main.sh` (staging -> main) is the production release: it fast-forwards `main`, pushes, then runs `vsce publish` to the VS Code Marketplace. The push to `main` also triggers CI to publish `@zoombuzz/notethink` to GitHub Packages and cut a GitHub Release with the `.vsix`. Three invariants must hold or the release breaks, and all break *after* the merge has already shipped to `main`, so each is a pre-merge checklist item.

### `@types/vscode` must not exceed `engines.vscode`

`vsce package` / `vsce publish` reject the build when `devDependencies.@types/vscode` declares a higher version than `engines.vscode` (`ERROR @types/vscode ^A greater than engines.vscode ^B`). The two are a matched pair: `engines.vscode` is the minimum VS Code the extension supports, and you must not type-check against an API surface newer than that floor.

- bump them in lockstep, always upward. Every dependency wave takes the latest `@types/vscode` (through ncu, like any other dependency) and, in the same change, raises `engines.vscode` in the root `package.json` to `^<same major>.<same minor>.0`. The nested `client/extension/package.json` carries an `engines.vscode` too; vsce never reads it, but it is raised with the root so the two do not drift. Never pin `@types/vscode` down to avoid the raise. This is a standing operator decision (2026-09-11), not a question to put to the operator on each wave: the minimum supported VS Code tracks the current release by choice.
- this fails only at publish time, which in this repo is *after* `merge-main.sh` has fast-forwarded `main`. `/prod-ready` does not catch it (lint, build, jest, and playwright never invoke `vsce`), so a mismatch surfaces mid-deploy with `main` already advanced. Treat the pairing as a pre-merge checklist item on any `@types/vscode` bump.

### A dependency-specifier change must regenerate the lockfile

CI runs `pnpm install` with `CI=true`, which pnpm treats as `--frozen-lockfile`: it aborts (`ERR_PNPM_OUTDATED_LOCKFILE`) when a `package.json` dependency **specifier** does not match the one recorded in the matching `pnpm-lock.yaml`. The root `postinstall` cascades a `pnpm install` into `client/extension`, `client/webview` and `client/webview/src/notethink-views`, so all four package/lockfile pairs must stay in sync; a mismatch in any one fails every workflow at "Install dependencies".

- Regenerate and commit the matching `pnpm-lock.yaml` in the same commit as any specifier change (pinning `@hello-pangea/dnd` from `^18.0.1` to `18.0.1`, say). When the resolved version is unchanged, the only diff is the `specifier:` line.
- Match CI's pnpm major: both workflows run `pnpm/action-setup@v4` with no `version` input, so CI installs the pnpm that the root `package.json` `packageManager` field pins. A newer local pnpm can add format-only fields (`libc:`) that CI's may reject; when only the specifier moved, a one-line hand-edit of the `specifier:` line is the minimal, version-safe fix.
- `/prod-ready` runs a non-frozen local install and never catches this.

### CI skips Playwright browser downloads

`release.yml` and `publish.yml` set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. CI only lints, builds, packages and publishes, but `@playwright/browser-chromium` (pulled in transitively by `@vscode/test-web`) otherwise downloads Chrome during `pnpm install` and hangs until the job timeout cancels the run. Do not remove the env var; if a CI job ever needs browsers, run `playwright install` as an explicit step instead.
