# NoteThink Coding Standards

This document defines the coding standards for the NoteThink project. **It is the authoritative rulebook: read it end-to-end at the start of any session that touches `notethink`, and re-read the relevant section before any high-consequence action (commit, push, merge, version bump, refactor, new-file placement) rather than recalling from memory.** Don't grep for keywords mid-task in place of reading it, and don't fall back to training-data defaults when a rule seems missing - if an expected rule is absent, flag the gap and ask whether to add it here. Memory files are thin pointers into this document; if a rule belongs anywhere, it belongs here.

**Workspace-wide rules** (story state machine, story tracking format, version bumps, commit policy, git workflow, releaseable-state gate, test-failure discipline, edit verification, dev-server lifecycle, browser-snapshot cleanup) live in [`../AGENTS.md`](../AGENTS.md). This file documents only NoteThink-specific overrides and coding standards.

## Naming Conventions

### Variable Naming

Use `snake_case` for local variables, hook returns, and computed values.

```typescript
// correct
const user_name = 'Alice';
const is_valid = checkValidity();
const total_count = items.length;
const display_options = props.display_options;
const note_data = useNoteData();

// incorrect
const userName = 'Alice';       // should be snake_case
const isValid = checkValidity(); // should be snake_case
const totalCount = items.length; // should be snake_case
```

### Function Naming

Use `camelCase` for functions and event handlers.

```typescript
// correct
function calculateTotal() { }
function handleClick() { }
function parseMarkdown() { }
const onSubmit = () => { };

// incorrect
function calculate_total() { }  // should be camelCase
function handle_click() { }     // should be camelCase
```

### Props and Parameters

Use `camelCase` for component props and function parameters.

```typescript
// correct
interface ButtonProps {
    onClick: () => void;
    isDisabled: boolean;
    buttonText: string;
}

function processNote(noteId: string, isVisible: boolean) { }

// incorrect
interface ButtonProps {
    on_click: () => void;    // should be camelCase
    is_disabled: boolean;    // should be camelCase
}
```

**Exception - snake_case data fields and the parameters that carry them.** This codebase follows a deliberate *snake_case for data, camelCase for behaviour* split. Fields on the note/view data shapes and message payloads (`NoteProps`, `ViewProps`, `NoteOrigin`, the `*Message` types) use `snake_case` - e.g. `doc_path`, `relative_path`, `workspace_root`, `aggregate_total_discovered`, `include_filter` - because they mirror the serialized extension↔webview wire format, which is snake_case end-to-end. Renaming them to camelCase would split the field name from its on-the-wire key. Function **parameters that receive these data values** therefore also stay `snake_case` (`function processNote(note_id: string)`), consistent with the local-variable rule. What stays `camelCase`: genuine UI event-handler props (`onClick`, `onSubmit`, `onNoteChange`) and function/callback names (including service-callback props like `setViewManagedState`, `postMessage` - these are functions, named per Function Naming, not `on*` UI events).

### Types and Interfaces

Use `PascalCase` for types, interfaces, and components.

```typescript
// correct
type UserRole = 'admin' | 'user';
interface NoteProps { }
type ViewOptions = { };
class DocumentParser { }
function DocumentView() { }

// incorrect
type userRole = 'admin' | 'user';  // should be PascalCase
interface noteProps { }             // should be PascalCase
```

### Constants

Use `SCREAMING_SNAKE_CASE` for true constants (values known at compile time).

```typescript
// correct
const MAX_RETRY_COUNT = 3;
const API_BASE_URL = 'https://api.example.com';
const DEFAULT_TIMEOUT_MS = 5000;

// note: computed values at runtime are not constants
const user_count = users.length;  // snake_case, not a constant
```

### Permanent name check

**This rule only applies to names that get stored in some permanent or semi-permanent state *outside the notethink codebase*.** Internal names (variables, function names, types, in-memory data shapes, transient wire-format messages between the extension and webview bundles) do **not** need the check - pick a name and rename freely later.

The check applies because the names below land in a store this codebase can't unilaterally rewrite. A later rename requires either a migration path for existing data or simply breaks any user / tool that already pinned the old name:

- VS Code (or any host) config keys (`notethink.settings.X.Y`) - written to `settings.json` on disk, on machines we don't own
- Persisted-state keys (`vscode.setState` shapes, IndexedDB key names, JSON file keys on user disk)
- Database table / column names; cookie / header names; URL path segments
- Public API names that code outside this repo will import (anything exported from a published npm package)
- File / directory names that other tools, scripts, or workflows target (workflows, glob patterns, lockfiles, manifests, schema files)

Before introducing or renaming anything in those categories, surface the candidate to the user and get explicit sign-off.

**Why this rule exists.** The `notethink.folderView.*` workspace-config namespace was originally introduced when the only place those settings lived was the folder view; the scope later grew to cover all view-type settings but the namespace name didn't, forcing a rename pass (and would have required a user-facing migration if there had been external users). A 30-second naming check at the moment of introduction would have prevented the whole episode. When in doubt, default to asking - the question is cheap, the rename is expensive.

### `stable_id` field: implicit vs explicit provenance

Every note has a `stable_id` field (the field name is fixed). Its value has two grades:

- **Implicit (transient)** - derived from the headline via `storyStableIdSlug`; present at parse time, never written to the file. Tracks the title, so it changes on rename. Use for React keys, kanban drag projections, and any intra-session matching.
- **Explicit (persistent)** - the authored `[](?id=slug)` linetag; frozen once written, survives renames and reloads. The only grade safe for durable cross-session references.

**Implementer rule:** transient code uses the implicit derived id and writes nothing to the file. Write an explicit `id=` linetag only when a durable artifact (a `[[…]]` cross-reference, a user-authored link) needs to survive across sessions or renames. See [AUTHORING_GUIDE.md - Stable ids: implicit vs explicit](./AUTHORING_GUIDE.md#stable-ids-implicit-vs-explicit) for the full decision rules.

## Import Organization

### Import Placement
- **All `import` statements must be at the top of the file**, before any non-import code
- The only exception is dynamic `import()` expressions used inline, which must include a comment explaining why a static import is not suitable

### Import Grouping

Organize imports in this order. **`import Debug from "debug"` always comes first** (the Debug Logger Pattern rule overrides grouping - it sits above React even though `debug` is otherwise an "external dependency"):

```typescript
// 0. Debug (first import in every webview file - see Debug Logger Pattern)
import Debug from 'debug';
// 1. React and framework imports
import React, { useState, useEffect, useCallback } from 'react';
// 2. External dependencies (alphabetized)
import { marked } from 'marked';
// 3. UI framework / component library
import { Button, Modal } from '@zoombuzz/notethink-views';
// 4. Internal utilities and libraries
import { generateIdentifier } from '@/lib/crypto';
import { parseMarkdown } from '@/lib/parseops';
// 5. Types (prefer type-only imports)
import type { NoteProps } from '@/types/NoteProps';
import type { ViewProps } from '@/types/ViewProps';
// 6. Components (local, relative paths)
import DocumentView from './DocumentView';
import GenericNote from '../notes/GenericNote';
// 7. Styles
import styles from './Component.module.scss';
import './global.css';
```

## Code Style

### Function Length and Decomposition

- **Keep functions short - aim for ≤ 30-35 lines of body.** When a function grows past that, break it into meaningful, well-named sub-functions rather than letting it sprawl. The threshold is guidance, not a hard cap: a flat data literal or an unavoidable single dispatch can run longer, but branching logic that spills past ~35 lines is almost always hiding extractable steps.
- **Extract by responsibility, not by line count.** Each sub-function should do one nameable thing. Split where there is a genuine seam (validation → transformation → output, or a self-contained sub-algorithm), not at an arbitrary line picked to satisfy the number.
- **The caller should read as a sequence of named steps.** After decomposition the top-level body reads like a table of contents - `firstInvalidChange(...)`, `logEditTextChanges(...)`, `applyEditTextChanges(...)` - so a reader follows the flow without diving into every detail. Well-named calls replace narration.
- **Favor function-header comments over interleaved line comments.** Put the explanation (what, why, invariants) in the block comment immediately above the function. Both header and inline comments are permitted, but the header is the default home for anything longer than a one-line local note. If you find yourself narrating each step inline, that is a signal the steps want to become named sub-functions - inline comments should stay sparse because the code already reads logically.
- **The point is explicit inputs/outputs and testable seams, not the number.** Line count is the symptom you watch; the cause you fix is *shared mutable state and implicit dependencies*. A 40-line function whose every input is a parameter and whose output is a return value is fine; a 25-line function reaching into ten ambient mutable variables is not. Optimise for "I can read this unit's signature and know its whole contract," and for "I can unit-test it without standing up its whole surrounding context."
- **Closures-as-objects should be real classes.** When a long function owns several pieces of mutable state that many inner closures read and write (a per-session/per-panel controller written as one big function), the length is a symptom of missing encapsulation: every nested closure has ambient access to everything, nothing has a contract, and the unit is untestable except through its outer boundary. Promote it to a **class** - the mutable state becomes private fields, the closures become methods, and each method's dependencies become explicit (`this.x`). This is the preferred fix for stateful **non-React** closures.
- **In React, decompose with custom hooks and child components - not plain helpers.** The Rules of Hooks forbid lifting a block that calls `useState`/`useEffect`/`useMemo` into an ordinary function. Extract a cohesive hook+derivation cluster into a **custom hook** (`useFolderDocs()`), and a JSX subtree into a **child component** (`<KanbanBoard>`). A long component body is shortened by moving these out, never by splitting at an arbitrary line.

```typescript
// avoid - one function doing validation, logging, application, and dispatch inline
async function applyEdit(doc_path, changes) {
    // ...60+ lines mixing offset checks, audit logging, edit application, re-emit...
}

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

### Block Organization

No blank lines within function bodies unless separating logical sections:

```typescript
// correct
function processNote(note: NoteProps) {
    const note_id = note.id;
    const processed_content = parseContent(note.content);
    return { id: note_id, content: processed_content };
}

// correct (logical sections)
function complexProcess(data: Data) {
    // validation
    const is_valid = validateData(data);
    if (!is_valid) return null;

    // transformation
    const transformed = transformData(data);
    const enriched = enrichData(transformed);

    // output
    return formatOutput(enriched);
}
```

### Comments

See workspace [`../AGENTS.md`](../AGENTS.md) > Code conventions > Comment style for the full rules: lowercase-first, one comment is exactly one line and never two `//` lines in a row, keep inline comments short (~100 chars), no back-reference comments, no project-management version numbers, and the TODO format (`// TODO: description`, `// TODO(#123): description`). The no-consecutive-line-comments rule is mechanically enforced in this repo by the local `local/no-consecutive-line-comments` ESLint rule.

notethink-specific extras:

- never use the em or en dash character anywhere in this repo - see workspace [`../AGENTS.md`](../AGENTS.md) > Code conventions > Dashes
- no period at end (unless multiple sentences)
- **No per-field comments inside data structures.** See workspace [`../AGENTS.md`](../AGENTS.md) > Code conventions > No per-field comments inside data structures.
  - **Exception - section dividers.** Short comments that group related fields by purpose (e.g. `// --- identity ---`, `// --- mdast passthrough ---`, `// --- tree links ---`, `// --- runtime decoration added at React render stage ---`) are explicitly permitted and load-bearing as visual structure in long interfaces. Don't strip these when sweeping a data structure for comment violations. Classify each inline comment: a per-single-field explanation gets removed (lift to the type's header comment if useful); a comment that introduces ≥2 conceptually-grouped fields with a single purpose stays. A comment grouping the *absence* of related fields (e.g. `// doc_path/doc_relative_path/doc_text intentionally undefined for the merged view` above three `undefined` assignments) still qualifies as a section divider.

```typescript
// correct
// calculate tax based on region
const tax_amount = calculateTax(subtotal, region);

// correct (multiple sentences)
// this handles edge cases for empty arrays. it also validates input.
const result = processItems(items);

// incorrect
const tax_amount = calculateTax(subtotal, region); // Calculate tax
const result = processItems(items); // This handles edge cases
```

### Braces and Blocks

Always use braces for control structures:

```typescript
// correct
if (is_valid) {
    processItem();
}

// incorrect
if (is_valid) processItem();
if (is_valid)
    processItem();
```

## TypeScript Guidelines

### Explicit Types

Prefer explicit types over inference for function parameters and returns:

```typescript
// correct
function calculateSum(values: number[]): number {
    return values.reduce((sum, val) => sum + val, 0);
}

// acceptable (simple arrow functions)
const double = (n: number) => n * 2;

// avoid
function calculateSum(values) {  // missing types
    return values.reduce((sum, val) => sum + val, 0);
}
```

### Avoid `any`

Use specific types or `unknown` instead of `any`:

```typescript
// correct
function processData(data: unknown): void {
    if (typeof data === 'string') {
        handleString(data);
    }
}

interface ApiResponse {
    data: Record<string, unknown>;
}

// incorrect
function processData(data: any): void { }
```

### Type-Only Imports

Use type-only imports when importing only types:

```typescript
// correct
import type { NoteProps } from '@/types/NoteProps';

// also acceptable (mixed import)
import { NoteComponent, type NoteProps } from '@/components';
```

### Loop Safety
- **Avoid potentially infinite loops** (do-while, while without bounds)
- Use bounded for-loops with a maximum iteration count instead
- **Exception - `while` driven by a strictly-progressing finite iterator.** A `while` loop whose continuation is a finite iterator that cannot stall is acceptable without an explicit counter: `regexp.exec(str)` with a **non-zero-width** pattern (lastIndex advances each match), `TreeWalker.nextNode()` (walks a finite DOM and returns null at the end), and a stack/queue drain that only `pop()`s (strictly shrinks). These terminate by construction; a `MAX_ITERATIONS` guard would be defensive clutter. The rule targets loops that *could* run forever (unbounded conditions, zero-width regex matches) - those still need a bound.

### Type Placement
- **File-level type definitions** (`type Foo = ...`, `interface Bar {...}`) should be declared **near the head of the file**, below imports and above constants/functions
- Do not declare types in the middle of a file, interleaved with function definitions - even a small helper type used by one function belongs at the top with the others, so the reader has a single place to find all type shapes
- If a type is only used in one file and has no external consumers, keep it in that file rather than splitting into `types/`; if it outgrows the file (many variants, many consumers), lift it to `src/types/`
- Discriminated-union result types (e.g. `type FetchResult = {kind: 'found'; ...} | {kind: 'not_found'}`) count as type definitions and must sit at the top too, not above the function that happens to return them

### Constants Placement
- **File-level constants** (e.g. `const MAX_ITERATIONS = 1000`) should be declared **near the head of the file**, below imports and type definitions
- This makes them easy to find, reuse, review, and change
- Do not declare the same constant inline within multiple functions - hoist it to module level

### Debug Logger Pattern
**Always include the debug import and constant in webview production files**, even if not currently used. This serves as a placeholder for adding debug statements during development. This applies to webview production source files (`.ts`, `.tsx`), not test files (`.test.ts`, `.test.tsx`).

**Rules:**
- `import Debug from "debug"` must be the **first import** in every file
- `const debug = Debug("nodejs:...")` should appear after imports, before the component/function
- **Never remove** the debug constant, even if ESLint reports it as unused
- The debug namespace is `nodejs:<area>:<File>` where `<area>` is the bundle/package the file belongs to (`notethink` for the webview app, `notethink-views` for the component library) and `<File>` is the source basename - e.g. `Debug("nodejs:notethink-views:KanbanView")`. It is **area-based, not a literal directory path**.

**Scope - webview only.** This pattern (the npm `debug` library + `nodejs:` namespace) is the convention for the **webview / notethink-views** bundles. The **extension host** (`client/extension/**`) does not use it: extension code logs through `writeToLog` / `writeToErrorLog` (winston, in `lib/errorops.ts`). Extension files therefore do **not** carry an `import Debug from "debug"` placeholder - adding one would introduce an unused dependency that doesn't match the extension's logging stack. Pure type-definition modules (files containing only `interface` / `type` declarations, e.g. `types/NoteProps.ts`) are also exempt: they have no statements to instrument and a runtime import would defeat their erasability.

### Extension Points

See workspace [`../AGENTS.md`](../AGENTS.md) > Code conventions > Extension points (keep single-case `switch`/`if` dispatches and trivial-bodied helpers that mark meaningful extension points, rather than collapsing or deleting them).

## React Patterns

### Component Structure

```typescript
import React, { useState, useEffect } from 'react';
import type { ComponentProps } from './types';
import styles from './Component.module.scss';

const debug = Debug("nodejs:notethink:ComponentName");

interface Props {
    id: string;
    title: string;
    onAction?: () => void;
}

export default function ComponentName(props: Props) {
    // hooks first
    const [is_loading, setIsLoading] = useState(false);
    const computed_value = useMemo(() => expensive(props.id), [props.id]);

    // effects
    useEffect(() => {
        debug('component mounted');
        return () => debug('component unmounted');
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
    return (
        <div className={styles.container}>
            <h1>{props.title}</h1>
            <button onClick={handleClick}>Action</button>
        </div>
    );
}
```

### Hook Return Values

Hook return values follow snake_case:

```typescript
// correct
const user_data = useUserData();
const [is_open, setIsOpen] = useState(false);
const note_state = useNoteState(props.id);

// incorrect
const userData = useUserData();  // should be snake_case
```

### Event Handler Props

Event handler props use camelCase with `on` prefix:

```typescript
// correct
interface Props {
    onClick: () => void;
    onSubmit: (data: FormData) => void;
    onNoteChange: (note: Note) => void;
}

// in usage
<Button onClick={handleClick} onHover={handleHover} />
```

### View interaction state: latest-click-wins with the editor as tiebreaker

**Per-view UI interaction state has two layers, and the editor wins ties.** The view writes its own click/drag/hover state directly to `display_options` (or a peer slot in view-managed state) so a gesture lands immediately - no waiting for an editor-selection round-trip. But the editor-derived match (caret-in-note via the per-doc + source-position matcher) is the **source of truth** whenever it produces a result: almost all real editing happens in the editor, and the view is a real-time visualisation that should reflect editor activity instantly. The view-driven layer is the immediate-feedback bridge for the brief window between a view click and the editor's `selectionChanged` round-trip, and the fallback when the editor has no opinion (active editor on a doc that isn't in the aggregated set, or caret outside every matched note).

Two non-negotiable consequences for any view→editor gesture (click, keyboard nav, clear):
- **Editor takes DOM focus.** `revealRange` / `selectRange` posted by the view must route through `vscode.window.showTextDocument(..., { preserveFocus: false })` so the editor - not the webview - receives subsequent key events. The webview never captures keystrokes the user expects to land in the editor.
- **The view follows the editor, not the other way round.** If the editor moves to a different note (the user clicked in the editor, an external file edit moved the caret, anything), the view's focused/selected state updates to match on the next derivation - even if the user previously clicked a different note in the view.

Why this matters: the view aggregates from N source files (folder mode); the editor only ever has one active doc. Driving view-interaction state through the editor selection alone silently breaks the moment the rendered tree contains anything outside that single doc - the round-trip never confirms and the view never updates. Pinning view focus on the most-recent view click instead silently breaks the moment the user starts editing in the editor - the visualisation goes stale. The fix is structural: write view state directly from the user's gesture for immediate feedback, then let the editor-derived match override as soon as it has an answer. See `client/webview/src/notethink-views/src/components/views/generic/useViewHandlers.ts` (click dispatcher writes `view_focused_seqs` / `view_selected_seqs` directly via `setViewManagedState`) and `useViewContext.ts` (`resolveFocusedNote` prefers editor-derived; view-driven fills in when the editor has no opinion) for the canonical pattern.

The same principle applies in reverse for editor-driven decoration: when the editor caret should highlight a note, the matcher must work across however many docs the view is aggregating from. Don't write a matcher that assumes a single coherent coordinate space - use per-doc origin metadata (e.g. `origin.doc_path` + `origin.source_position`) so the unified algorithm works in both `current_file` (trivial: all notes share one doc) and `folder` (N-doc merge with synthetic offsets) modes without an `integration_mode` branch.

### Focused-note scroll framing

When a note becomes focused/selected and `useScrollToCaret` (`viewhooks.ts`) scrolls it into the viewer, the framing rule is:

- **The focus/selection highlight ring must be visible all the way around the note** - never cropped on any edge. The ring is an `outline` with offset + width that `getBoundingClientRect` excludes, so the scroll must reserve space for it (measure against the actual scroll-container client size, **not** `window.innerWidth/innerHeight`).
- **When the note fits** the viewer (not wider AND not taller than the viewer's client area): show the **whole note**, ring included.
- **When the note is wider OR taller** than the viewer: anchor to the **top and the left** (show top-left), since the whole thing can't fit.
- Within-note caret reveal (scrolling the clipped body to the caret line) is owned by `useMarkdownNoteBodyScroll`, **not** this hook - this hook only positions the whole story in the viewer plus its horizontal scroll container.

The recurring regression is the ring being cropped on the left edge when a card sits flush against the scroll container's edge; verify by focusing a card in the leftmost column - the left ring must show.

## File Organization

### Directory Structure

```
src/
├── components/
│   ├── views/           # view-level components
│   │   ├── DocumentView.tsx
│   │   └── DocumentView.test.tsx
│   └── notes/           # note-level components
│       ├── GenericNote.tsx
│       └── GenericNote.test.tsx
├── lib/                 # utility functions, grouped by domain (*ops.ts)
│   ├── noteops.ts       # note traversal, position, classification
│   ├── originops.ts     # origin / project identification + colour
│   ├── pathops.ts       # path segmentation, workspace-root derivation
│   ├── viewstateops.ts  # view-managed-state operations
│   └── parseops.ts      # parsing
├── types/               # shared types
│   ├── NoteProps.ts
│   └── ViewProps.ts
└── styles/              # global styles
    └── variables.scss
```

### File Naming

- Components: `PascalCase.tsx` (e.g., `DocumentView.tsx`)
- **Domain lib files**: `<noun>ops.ts` - see [Library organisation](#library-organisation) below.
- **Single-export utility modules**: `camelCase.ts` when the filename mirrors the primary exported function - `convertMdastToNoteHierarchy.ts`, `mergeAggregateRoot.ts`, `globMatch.ts`. This is the accepted alternative to the `*ops.ts` pattern when a file's only purpose is one named operation. Pick one style per module and keep it stable.
- **Component-local helper files**: keep them next to the component they serve (e.g. `components/views/kanban/kanbanDragEndPayload.ts`), not in `lib/`. The path itself signals "not a general op". Filename follows the single-export camelCase rule above.
- Types: `PascalCase.ts` (e.g., `NoteProps.ts`)
- Tests: `*.test.tsx` or `*.test.ts` next to source file
- Styles: `Component.module.scss` (CSS modules)

### Library organisation

Files under `lib/` group **pure utility functions by domain**, named `<noun>ops.ts` (single concatenated word, no hyphen, no separator). The convention is project-agnostic - apply it whenever you reach for a `lib/` file in any JS/TS project.

**The pattern**:

- `noteops.ts` - operations on `Note` shapes (traversal, position checks, classification, chain construction; also generic array helpers when their only consumers are note-adjacent)
- `originops.ts` - operations on `Origin` / project metadata (label derivation, hue, identification, folder derivation)
- `pathops.ts` - path string operations (segmentation, containment, workspace-root derivation)
- `viewstateops.ts` - operations on view-managed state (canonical-key resolution, state-update builders, mode detection)
- `docops.ts` - operations on `Doc` shapes (picking, merging, abbreviating)
- `editops.ts` - operations on text edits (change validation, audit logging)
- `cryptoops.ts` - hashing, nonces, identifiers
- `vscodeops.ts` - VS Code API wrappers + persisted state shape (project-specific example)

**The rules**:

1. **Group by the noun the operations act on, not by where the code is called from.** A function that walks notes goes in `noteops.ts` regardless of which component imports it. A function that builds a view-state payload goes in `viewstateops.ts` even if only one site calls it today.
2. **Pure functions only.** No React hooks, no JSX, no `useState`/`useEffect`/`useRef`. Closures over component state belong in the component or a custom hook.
3. **Prefer extending an existing `*ops.ts` over creating a new one.** A new helper that operates on `Note` extends `noteops.ts`; create `notetreeops.ts` only when the existing file's domain genuinely splits.
4. **Aim for ≥ 4 exports per `*ops.ts` file. Rationalise periodically.** A standalone file with one or two exports is usually over-engineered - fold it into a closely-related `*ops.ts` that shares the same noun cluster or consumes/produces the same type. Worked examples from this codebase: a generic `arraysEqual<T>` helper folded into `noteops.ts` because its two consumers were both note-adjacent (with a docstring noting it would lift back out if a non-note caller appeared); a `stateops.ts` holding `VSCodeState` + `migrateSavedState` folded into `vscodeops.ts` because the wrappers there produce and consume the type. **When you finish a refactor that leaves any `*ops.ts` with fewer than 4 exports, do the merge pass in the same session** - small files accumulate fast and the rationalisation cost grows with every new contributor who imports them. The target is guidance, not a hard floor: a 1-export file with a genuinely distinct noun and plausible future growth (e.g. `docops.ts` holding only `pickMostRecentlySentDoc`) can stay if you can name the second function that's coming.
5. **One domain per file.** A "junk drawer" `utils.ts` is the anti-pattern this convention exists to prevent - when you find one, split it by the noun each export operates on (`crypto.ts` + `getNonce` from `utils.ts` → one `cryptoops.ts`; `abbrevDoc` from `utils.ts` → `docops.ts`).
6. **Mirrored constants across bundle boundaries are the documented exception.** If two bundles (e.g. extension host + webview) cannot share a module graph, a small set of constants may be byte-identical-duplicated in two `constants.ts` files. Don't `*ops.ts`-ify either side; the duplication is the wire contract. See [Avoid Duplication](#avoid-duplication) below.
7. **Component-local helpers stay under `components/`**, not under `lib/`. If a pure helper is genuinely only ever used by one component family and lifting to `lib/` would imply general reusability that doesn't exist, leave it co-located with the component. The path is the signal.
8. **Tests colocated** next to the lib file (`noteops.test.ts` next to `noteops.ts`).

**Why this matters**: file-name-as-domain-label makes it obvious where to look for a function and where to add a new one. The alternative - `utils.ts` / `helpers.ts` / scattered `parse-X.ts` / mixed-purpose modules - defeats grepability and leads to duplication (two files independently growing helpers for the same noun because neither author found the other). `<noun>ops.ts` is the cheap convention that prevents both. The ≥ 4-exports target keeps the opposite failure mode - proliferation of tiny single-helper files - in check.

**When to keep a non-`*ops.ts` name**: a single-function file whose name reads as a sentence (`convertMdastToNoteHierarchy.ts`, `mergeAggregateRoot.ts`, `globMatch.ts`) - the filename mirrors the primary export and lifting to a `*ops.ts` would muddle the "one file = one named operation" signal. These are explicitly permitted and the ≥ 4-exports target does **not** apply to them; do not rename them.

## Code Quality

### Avoid Duplication
- Extract repeated code into shared utility functions
- Use shared constants instead of hardcoding values
- Create shared components for repeated UI patterns
- **Exception - mirrored constants across the extension/webview bundle boundary.** A small set of folder-view defaults (include/exclude globs, default column order, max-notes-per-file) is intentionally duplicated in `client/extension/src/constants.ts` and `client/webview/src/constants.ts`. The two run as **separate webpack bundles with no shared module graph**, so there is no import path to a single source; the duplication is the wire contract (both sides must agree on the same defaults). Keep the two copies byte-identical and cross-reference them in a comment rather than trying to share a module.

### Remove Unused Code
- Remove unused imports
- Remove unused variables (check compiler warnings)
- Remove commented-out code that's no longer needed

## Error Handling

### Use Error Utilities

**Extension host** logs through `writeToLog` / `writeToErrorLog` (winston, `client/extension/src/lib/errorops.ts`). **Webview** has no winston/output-channel access, so it logs through the `debug` library instance (`const debug = Debug("nodejs:...")`) and, for render failures that should reach the host, posts a `renderError` message to the extension. Either way, **`console.*` is not the error utility** - see "No `console.log` in committed code" in the workspace `AGENTS.md`. A caught error that is intentionally non-fatal must still be logged (`debug('… %O', err)` in the webview, `writeToErrorLog(...)` in the extension), never silently swallowed.

```typescript
import { createError, handleError } from '@/lib/errorops';

try {
    await riskyOperation();
} catch (error) {
    handleError(error, 'Failed to perform operation');
}
```

### Reading VS Code logs

**The primary, CLI-friendly log is `notethink-extension.log`, written to the extension's standard VS Code log directory** - `vscode.ExtensionContext.logUri`, the canonical per-extension log location. **Never** the user's open workspace folder (a shipped extension must not litter the user's project with log files). Every `writeToLog` / `writeToErrorLog` call (and `logEditTextChanges`) is mirrored there by the file logger in `errorops.ts` (`initLogDir(context.logUri)` in `activate()`).

`logUri` resolves under the rotating per-session logs dir. NoteThink is a **web-worker** extension (publisher `NoteThink.notethink`), so on Linux it is:

```
~/.config/Code/logs/<session-timestamp>/window<N>/exthost/webWorker/NoteThink.notethink/notethink-extension.log
```

(macOS: `~/Library/Application Support/Code/logs/...`; the OS-standard logs root differs but the `…/exthost/webWorker/NoteThink.notethink/` tail is the same.) Reading these needs `dangerouslyDisableSandbox: true` (under `~/.config`/`~/Library`). Find and tail the live one:

```bash
# resolve the latest session + window that actually has our log, then tail it
LOG=$(ls -t ~/.config/Code/logs/*/window*/exthost/webWorker/NoteThink.notethink/notethink-extension.log 2>/dev/null | head -1)
echo "$LOG"; tail -f "$LOG"
grep -E "editText|caret-probe" "$LOG"
```

- **Dev-only, off by default.** Gated by the `NOTETHINK_DEV` webpack define, which is `process.env.SELFINSPECT_ENV === 'dev'` (the workspace-standard env marker - never `NODE_ENV`). The `build` / `watch` scripts export `SELFINSPECT_ENV=dev` to opt in; every other build (the marketplace `package` build, and any hosted/web build) leaves it unset, so the file logger is stripped (`if (true) { return; }` → dead-code-eliminated). Off-by-default is deliberate: a shipped extension must never silently fill a user's disk with logs. The Output-panel channel below still works in production.
- **Rolling buffer.** Last 500 lines, flushed ~1s after a write, written wholesale (overwritten each flush, not appended).
- If missing/empty: production build (no `NOTETHINK_DEV`), the window wasn't reloaded after a rebuild (so `activate`/`initLogDir` didn't re-run), or nothing has logged yet. A **new session dir is created each time VS Code starts**, so always re-resolve the latest with the `ls -t` one-liner - don't cache the path.
- **Spurious in-repo copies.** `**/notethink-extension.log` is gitignored ("ignore spurious logs"). The `logUri` path above is the *only* authoritative runtime log - if you find a `notethink-extension.log` in the repo root or a parent dir, it's stale leftover litter, not the live log; don't read it, delete it.
- **Desktop-only path.** The file logger writes via `vscode.workspace.fs.writeFile(logUri, …)`, so the tailable on-disk `notethink-extension.log` exists only in **desktop** VS Code. In a **web host** (any vscode-web build serving the extension) `workspace.fs` writes to browser/virtual storage with no terminal-readable file - there, read runtime/webview logs from the **browser devtools console** instead.

**Two log streams, two homes - don't conflate them.** The `notethink-extension.log` above is the **runtime / behaviour** log (what the running extension did). It is distinct from the **build / watch** log (webpack compile output: did the bundle compile, with what errors):

| Stream | Home | How to read |
|--------|------|-------------|
| Runtime / behaviour | `logUri` (the `…/NoteThink.notethink/notethink-extension.log` above) | `ls -t` one-liner, `dangerouslyDisableSandbox` |
| Build / watch (webpack) | **`test-results/dev.log`** in the repo (gitignored) | `tail -f test-results/dev.log` |

`test-results/dev.log` is where `/open-dev` redirects the `pnpm run watch` (`webpack --watch`) output, matching the cross-project `test-results/dev.log` convention. Use it to confirm a clean compile after edits; use the `logUri` log for runtime behaviour. Never route build output to `/tmp` - it's ephemeral and breaks the "one documented place per stream" narrative.

**Interactive alternative - the Output panel.** `writeToLog` also feeds the "NoteThink" `LogOutputChannel` (winston via `LogOutputChannelTransport`), visible under *View → Output → NoteThink*. VS Code persists that channel to `NoteThink.log` in the **same** `logUri` directory as above (subject to the channel's selected log level, so it is sometimes empty - prefer `notethink-extension.log` for CLI reads).

The `debug` library (webview only - `const debug = Debug("nodejs:...")`) is **not** captured to any file. Enable it via `localStorage.debug = 'nodejs:*'` in the webview Developer Tools console. Webview `console.error()` / `console.warn()` is also not file-captured - only visible in "Developer: Open Webview Developer Tools".

### Avoid Silent Failures

```typescript
// correct
function parseConfig(json: string): Config | null {
    try {
        return JSON.parse(json);
    } catch (error) {
        debug('failed to parse config: %O', error);
        return null;
    }
}

// incorrect
function parseConfig(json: string): Config | null {
    try {
        return JSON.parse(json);
    } catch {
        return null;  // silent failure, no logging
    }
}
```

## Testing Standards

### Test File Location

Place Jest tests next to source files:

```
components/
├── DocumentView.tsx
├── DocumentView.test.tsx
└── DocumentView.module.scss
```

**Exception - VS Code extension-host Mocha suite.** Tests that exercise the live VS Code API (`client/extension/src/test/suite/**`) run under the `@vscode/test-electron` Mocha runner, not Jest, and are deliberately kept in that central suite rather than colocated. The runner discovers them by directory, and they need the real extension-host environment a colocated Jest test can't provide. Colocate everything else (pure logic, webview components) next to source as above.

### Test Naming

```typescript
describe('DocumentView', () => {
    it('renders document container with correct id', () => { });
    it('displays loading state when data is fetching', () => { });
    it('calls onClick handler when note is clicked', () => { });
});
```

### Test Structure

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentView from './DocumentView';

describe('DocumentView', () => {
    const default_props = {
        id: 'test-doc',
        title: 'Test Document',
    };

    it('renders with required props', () => {
        render(<DocumentView {...default_props} />);
        expect(screen.getByTestId('document-test-doc-inner')).toBeInTheDocument();
    });

    it('handles click events', () => {
        const handle_click = jest.fn();
        render(<DocumentView {...default_props} onClick={handle_click} />);

        fireEvent.click(screen.getByRole('button'));
        expect(handle_click).toHaveBeenCalledTimes(1);
    });
});
```

### E2E Test Scope - no reloads as workarounds

See workspace [`../AGENTS.md`](../AGENTS.md) > Testing conventions > No page reloads as test workarounds. (Reloads are legitimate only for an explicit refresh-resilience test; if the UI doesn't update after an action, the bug is in the UI, not the test.)

### Disabling a spec indefinitely - comment it out, don't `test.skip`

See workspace [`../AGENTS.md`](../AGENTS.md) > Testing conventions > Disable a spec by commenting it out, not `test.skip`. (`test.skip` is for runtime-conditional skips; an indefinite disable comments out the whole file body with a leading reason/re-enable comment and a trailing `export {};`. Same applies to a single `test(...)` inside a larger `test.describe`.)

## Working Style

### Present, don't force a decision

When the user asks to "have a look", "let me see them", "just present them", or "show me the options", **present the artifacts/options with a brief honest assessment and stop**. Do not follow up with an `AskUserQuestion` (or any other prompt) that forces an immediate choice. The user wants to evaluate on their own time and will volunteer the choice. Reserve `AskUserQuestion` for genuinely blocking ambiguity - not "which do you prefer?" when the user has explicitly asked to look first.

### No speculative specs in todo.md

When working through a story's planned phases, **do not invent new feature specs, phases, or tasks beyond what was originally scoped**. Phases and tasks come from the user, not extrapolated by Claude. Speculative additions clutter the backlog and waste time on work the user didn't ask for. If a follow-up genuinely seems worth doing, mention it in the wrap-up so the user can choose to add it - do not write it into `todo.md` unilaterally.

---

## Pre-Push Verification

All tests must pass locally before pushing. After any session where files are updated, run:

```bash
pnpm run check
```

This runs, in order:
1. **Lint** - eslint + `tsc --noEmit` across all three tsconfigs
2. **Build** - webpack (extension + webview bundles)
3. **Rollup** - notethink-views component library build
4. **Jest** - all unit/component tests across extension, webview, and notethink-views

CI only runs lint and build (no tests). Tests are the developer's responsibility before push.

### No web dev server
notethink is a VS Code extension - there is no `pnpm run dev` and no HTTP server to start. The webview/extension bundles are produced by webpack (`pnpm run build` or `pnpm run watch`) and previewed inside the VS Code Extension Development Host. Per the `/open-dev` skill's special cases, this project is exempt from the workspace dev-server start pattern (see workspace `AGENTS.md`, `## Dev servers`).

The "no HTTP server" rule is about a long-running **dev** server. The Playwright **test** harness (`playwright.config.ts` auto-starts `playwright/harness/serve.mjs` on port 9123 for the run, then tears it down) is throwaway test infrastructure, not a dev server, and is exempt.

### After every code change

Always rebuild the extension after each code change so the developer can preview it in the VS Code dev host. Run `pnpm run build` (or `pnpm run check` which includes the build) before considering a change complete.

**For webview/React changes specifically**, a source edit alone does NOT change what VS Code shows - the extension serves the prebuilt `client/webview/dist/index.js`. After editing anything under `client/webview/src/`:

1. **Identify the live code path first** when the component has multiple branches. Example: `BreadcrumbTrail.tsx` has two independent code paths - a single-file `splitPathSegments` branch (used when the toolbar shows "Current file") and a directory-aggregate `integration_path` branch. Determine which one is live from the current screenshot/state before editing, otherwise you'll edit the wrong branch and the visible behaviour will not change.
2. Run `pnpm run build` (webpack compiles `notethink-views` from `src/`). `build-and-rollup` also refreshes `notethink-views/dist/esm`.
3. **Confirm the edit landed in the bundle**: `grep client/webview/dist/index.js` for a token from your edit.
4. The user must **reload the VS Code window** for an already-open webview to pick up the new bundle.
5. Never report a UI change as done from a source edit alone - verify the bundle and ask the user to reload.

**Webview bundle caching (dev):** webview resources are cached by URL. Historically a rebuilt `index.js` could be served **stale** across reloads (the bundle URL never changed), so a webview fix appeared not to take effect. `getHtmlForWebview` now appends a per-load `?v=<timestamp>` cache-buster **when `NOTETHINK_DEV`**, so a dev reload always fetches the fresh bundle (production keeps the cacheable URL). If a webview change still seems not to apply, confirm the running build via the file log and that the window was actually reloaded - don't assume the bundle is fresh.

### Individual commands

| What | Command |
|------|---------|
| Lint only | `pnpm run lint` |
| Build only | `pnpm run build` |
| Rollup only | `pnpm -C client/webview/src/notethink-views run rollup` |
| Jest only | `pnpm run test-jest` |
| Playwright E2E | `pnpm run test-playwright` |
| Everything | `pnpm run check` |

## Release & Publishing

`sh/git/merge-main.sh` (staging -> main) is the production release: it fast-forwards `main`, pushes, then runs `vsce publish` to the VS Code Marketplace. The push to `main` also triggers CI to publish `@zoombuzz/notethink` to GitHub Packages and cut a GitHub Release with the `.vsix`. Two invariants must hold or the release breaks, and both break *after* the merge has already shipped to `main`.

### `@types/vscode` must not exceed `engines.vscode`

`vsce package` / `vsce publish` reject the build when `devDependencies.@types/vscode` declares a higher version than `engines.vscode` (`ERROR @types/vscode ^A greater than engines.vscode ^B`). The two are a matched pair: `engines.vscode` is the minimum VS Code the extension supports, and you must not type-check against an API surface newer than that floor.

- bump them in lockstep. Whenever a dependency update raises `@types/vscode`, in the same commit either raise `engines.vscode` to the same minor or pin `@types/vscode` back down.
- this fails only at publish time, which in this repo is *after* `merge-main.sh` has fast-forwarded `main`. `/prod-ready` does not catch it (lint, build, jest, and playwright never invoke `vsce`), so a mismatch surfaces mid-deploy with `main` already advanced. Treat the pairing as a pre-merge checklist item on any `@types/vscode` bump.

### CI skips Playwright browser downloads

`release.yml` and `publish.yml` set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. CI only lints, builds, packages, and publishes - it never runs Playwright - but `@playwright/browser-chromium` (pulled in transitively by `@vscode/test-web`) otherwise runs its install script during `pnpm install`, downloads ~167MB of Chrome, then hangs until the 6h job timeout cancels the run. Do not remove the env var; if a CI job ever needs browsers, run `playwright install` as an explicit step instead.

