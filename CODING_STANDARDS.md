# NoteThink Coding Standards

This document defines the coding standards for the NoteThink project.

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

**Exception — snake_case data fields and the parameters that carry them.** This codebase follows a deliberate *snake_case for data, camelCase for behaviour* split. Fields on the note/view data shapes and message payloads (`NoteProps`, `ViewProps`, `NoteOrigin`, the `*Message` types) use `snake_case` — e.g. `doc_path`, `relative_path`, `workspace_root`, `aggregate_total_discovered`, `include_filter` — because they mirror the serialized extension↔webview wire format, which is snake_case end-to-end. Renaming them to camelCase would split the field name from its on-the-wire key. Function **parameters that receive these data values** therefore also stay `snake_case` (`function processNote(note_id: string)`), consistent with the local-variable rule. What stays `camelCase`: genuine UI event-handler props (`onClick`, `onSubmit`, `onNoteChange`) and function/callback names (including service-callback props like `setViewManagedState`, `postMessage` — these are functions, named per Function Naming, not `on*` UI events).

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

**This rule only applies to names that get stored in some permanent or semi-permanent state *outside the notethink codebase*.** Internal names (variables, function names, types, in-memory data shapes, transient wire-format messages between the extension and webview bundles) do **not** need the check — pick a name and rename freely later.

The check applies because the names below land in a store this codebase can't unilaterally rewrite. A later rename requires either a migration path for existing data or simply breaks any user / tool that already pinned the old name:

- VS Code (or any host) config keys (`notethink.settings.X.Y`) — written to `settings.json` on disk, on machines we don't own
- Persisted-state keys (`vscode.setState` shapes, IndexedDB key names, JSON file keys on user disk)
- Database table / column names; cookie / header names; URL path segments
- Public API names that code outside this repo will import (anything exported from a published npm package)
- File / directory names that other tools, scripts, or workflows target (workflows, glob patterns, lockfiles, manifests, schema files)

Before introducing or renaming anything in those categories, surface the candidate to the user and get explicit sign-off.

**Why this rule exists.** The `notethink.folderView.*` workspace-config namespace was originally introduced when the only place those settings lived was the folder view; the scope later grew to cover all view-type settings but the namespace name didn't, forcing a rename pass (and would have required a user-facing migration if there had been external users). A 30-second naming check at the moment of introduction would have prevented the whole episode. When in doubt, default to asking — the question is cheap, the rename is expensive.

## Import Organization

### Import Placement
- **All `import` statements must be at the top of the file**, before any non-import code
- The only exception is dynamic `import()` expressions used inline, which must include a comment explaining why a static import is not suitable

### Import Grouping

Organize imports in this order. **`import Debug from "debug"` always comes first** (the Debug Logger Pattern rule overrides grouping — it sits above React even though `debug` is otherwise an "external dependency"):

```typescript
// 0. Debug (first import in every webview file — see Debug Logger Pattern)
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

- **Keep functions short — aim for ≤ 30–35 lines of body.** When a function grows past that, break it into meaningful, well-named sub-functions rather than letting it sprawl. The threshold is guidance, not a hard cap: a flat data literal or an unavoidable single dispatch can run longer, but branching logic that spills past ~35 lines is almost always hiding extractable steps.
- **Extract by responsibility, not by line count.** Each sub-function should do one nameable thing. Split where there is a genuine seam (validation → transformation → output, or a self-contained sub-algorithm), not at an arbitrary line picked to satisfy the number.
- **The caller should read as a sequence of named steps.** After decomposition the top-level body reads like a table of contents — `firstInvalidChange(...)`, `logEditTextChanges(...)`, `applyEditTextChanges(...)` — so a reader follows the flow without diving into every detail. Well-named calls replace narration.
- **Favor function-header comments over interleaved line comments.** Put the explanation (what, why, invariants) in the block comment immediately above the function. Both header and inline comments are permitted, but the header is the default home for anything longer than a one-line local note. If you find yourself narrating each step inline, that is a signal the steps want to become named sub-functions — inline comments should stay sparse because the code already reads logically.
- **The point is explicit inputs/outputs and testable seams, not the number.** Line count is the symptom you watch; the cause you fix is *shared mutable state and implicit dependencies*. A 40-line function whose every input is a parameter and whose output is a return value is fine; a 25-line function reaching into ten ambient mutable variables is not. Optimise for "I can read this unit's signature and know its whole contract," and for "I can unit-test it without standing up its whole surrounding context."
- **Closures-as-objects should be real classes.** When a long function owns several pieces of mutable state that many inner closures read and write (a per-session/per-panel controller written as one big function), the length is a symptom of missing encapsulation: every nested closure has ambient access to everything, nothing has a contract, and the unit is untestable except through its outer boundary. Promote it to a **class** — the mutable state becomes private fields, the closures become methods, and each method's dependencies become explicit (`this.x`). This is the preferred fix for stateful **non-React** closures.
- **In React, decompose with custom hooks and child components — not plain helpers.** The Rules of Hooks forbid lifting a block that calls `useState`/`useEffect`/`useMemo` into an ordinary function. Extract a cohesive hook+derivation cluster into a **custom hook** (`useFolderDocs()`), and a JSX subtree into a **child component** (`<KanbanBoard>`). A long component body is shortened by moving these out, never by splitting at an arbitrary line.

```typescript
// avoid — one function doing validation, logging, application, and dispatch inline
async function applyEdit(doc_path, changes) {
    // ...60+ lines mixing offset checks, audit logging, edit application, re-emit...
}

// prefer — the caller reads as named steps; each helper has a header comment
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

- **Always start comments with a lowercase letter** (unless the first word is a proper noun, type, or component name). This applies to the first sentence only — a multi-sentence comment starts lowercase, but every subsequent sentence follows normal capitalisation rules (first word capitalised unless there's a reason not to).
- no period at end (unless multiple sentences)
- place above the code, not inline
- **Keep each comment to a single line.** Do not wrap a single comment across multiple `//` lines just to stay under 80 characters — let the line run long. If you genuinely have two separate thoughts, write two single-line comments stacked together, one thought per line. Long lines are fine; fragmented thoughts are not.
- **Keep inline comments short.** When an inline comment is unavoidable, aim for 100 characters unless there's a good reason to make it more verbose (e.g. a tricky invariant that needs precise wording, or a non-obvious cross-reference). If an explanation genuinely needs more than ~100 chars, lift it into the function header comment (the block comment immediately above the function) rather than cramming it inline — long comments interleaved with statements break up the function body and make it hard to read.
- **No back-reference comments.** Never write inline comments that point readers at context elsewhere in the same file or function — `// see function header for the rationale`, `// see above`, `// see the JSDoc`, `// (see comment on line 42)`. The reader is already there; pointers add clutter without information and rot when the layout changes. When lifting a long inline comment to a function-header JSDoc, either delete the inline outright (the JSDoc + well-named identifiers usually suffice) or replace it with a *short* self-contained factual one-liner that stands on its own — never leave a stub that says "see header for rationale". Same anti-pattern as the rule against referencing the current task / fix / callers (`// used by X`, `// added for the Y flow`, `// handles the case from issue #123`) — pointers belong in the PR description, not inline.
- **No project-management version numbers in comments.** Never write inline comments like `// added in 2.11.0`, `// fixed in 2.12.3`, `// from v2.10 release`, etc. Project-management versions belong in `package.json` and any place that actively uses them — never in comments that don't get re-rendered when the version changes. Stale version-tagged comments accumulate every release and force a search-and-purge pass on the next minor bump. The only acceptable place a version literal appears in code is a block that actively *uses* it.
- **No per-field comments inside data structures.** See workspace `AGENTS.md` > Code conventions > No per-field comments inside data structures.
  - **Exception — section dividers.** Short comments that group related fields by purpose (e.g. `// --- identity ---`, `// --- mdast passthrough ---`, `// --- tree links ---`, `// --- runtime decoration added at React render stage ---`) are explicitly permitted and load-bearing as visual structure in long interfaces. Don't strip these when sweeping a data structure for comment violations. Classify each inline comment: a per-single-field explanation gets removed (lift to the type's header comment if useful); a comment that introduces ≥2 conceptually-grouped fields with a single purpose stays. A comment grouping the *absence* of related fields (e.g. `// doc_path/doc_relative_path/doc_text intentionally undefined for the merged view` above three `undefined` assignments) still qualifies as a section divider.

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

### TODO Comments
- **MUST**: Use format: `// TODO: description`
- **SHOULD**: Include issue number: `// TODO(#123): description`

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
- **Exception — `while` driven by a strictly-progressing finite iterator.** A `while` loop whose continuation is a finite iterator that cannot stall is acceptable without an explicit counter: `regexp.exec(str)` with a **non-zero-width** pattern (lastIndex advances each match), `TreeWalker.nextNode()` (walks a finite DOM and returns null at the end), and a stack/queue drain that only `pop()`s (strictly shrinks). These terminate by construction; a `MAX_ITERATIONS` guard would be defensive clutter. The rule targets loops that *could* run forever (unbounded conditions, zero-width regex matches) — those still need a bound.

### Type Placement
- **File-level type definitions** (`type Foo = ...`, `interface Bar {...}`) should be declared **near the head of the file**, below imports and above constants/functions
- Do not declare types in the middle of a file, interleaved with function definitions — even a small helper type used by one function belongs at the top with the others, so the reader has a single place to find all type shapes
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
- The debug namespace is `nodejs:<area>:<File>` where `<area>` is the bundle/package the file belongs to (`notethink` for the webview app, `notethink-views` for the component library) and `<File>` is the source basename — e.g. `Debug("nodejs:notethink-views:KanbanView")`. It is **area-based, not a literal directory path**.

**Scope — webview only.** This pattern (the npm `debug` library + `nodejs:` namespace) is the convention for the **webview / notethink-views** bundles. The **extension host** (`client/extension/**`) does not use it: extension code logs through `writeToLog` / `writeToErrorLog` (winston, in `lib/errorops.ts`). Extension files therefore do **not** carry an `import Debug from "debug"` placeholder — adding one would introduce an unused dependency that doesn't match the extension's logging stack. Pure type-definition modules (files containing only `interface` / `type` declarations, e.g. `types/NoteProps.ts`) are also exempt: they have no statements to instrument and a runtime import would defeat their erasability.

### Extension Points
- **Keep single-case switch statements** that currently dispatch on only one value. The switch structure signals "this is an extension point — add new variants here alongside the existing case". Do not collapse to `if (x !== 'only-value') return null` — it hides the intent and forces the next contributor to re-derive the pattern.
- **Keep helper functions whose body has become trivial** after a refactor rather than deleting them, when the call site still represents a meaningful extension point. Leave the call site intact and replace the body with an empty return plus an inline comment explaining what must NOT be added and why, and (optionally) how to extend.

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
├── lib/                 # utility functions
│   ├── crypto.ts
│   └── parseops.ts
├── types/               # shared types
│   ├── NoteProps.ts
│   └── ViewProps.ts
└── styles/              # global styles
    └── variables.scss
```

### File Naming

- Components: `PascalCase.tsx` (e.g., `DocumentView.tsx`)
- Utilities: `lowercase.ts` or `kebab-case.ts` (e.g., `crypto.ts`, `parse-ops.ts`)
- Types: `PascalCase.ts` (e.g., `NoteProps.ts`)
- Tests: `*.test.tsx` or `*.test.ts` next to source file
- Styles: `Component.module.scss` (CSS modules)
- **Multi-word utility modules may use `camelCase.ts`** when the name reads as a phrase — `convertMdastToNoteHierarchy.ts`, `mergeAggregateRoot.ts`, `globMatch.ts`. This is an accepted alternative to `kebab-case` for lib functions whose filename mirrors the primary exported function; pick one style per module and keep it stable.

## Code Quality

### Avoid Duplication
- Extract repeated code into shared utility functions
- Use shared constants instead of hardcoding values
- Create shared components for repeated UI patterns
- **Exception — mirrored constants across the extension/webview bundle boundary.** A small set of folder-view defaults (include/exclude globs, default column order, max-notes-per-file) is intentionally duplicated in `client/extension/src/constants.ts` and `client/webview/src/constants.ts`. The two run as **separate webpack bundles with no shared module graph**, so there is no import path to a single source; the duplication is the wire contract (both sides must agree on the same defaults). Keep the two copies byte-identical and cross-reference them in a comment rather than trying to share a module.

### Remove Unused Code
- Remove unused imports
- Remove unused variables (check compiler warnings)
- Remove commented-out code that's no longer needed

## Error Handling

### Use Error Utilities

**Extension host** logs through `writeToLog` / `writeToErrorLog` (winston, `client/extension/src/lib/errorops.ts`). **Webview** has no winston/output-channel access, so it logs through the `debug` library instance (`const debug = Debug("nodejs:...")`) and, for render failures that should reach the host, posts a `renderError` message to the extension. Either way, **`console.*` is not the error utility** — see "No `console.log` in committed code" in the workspace `AGENTS.md`. A caught error that is intentionally non-fatal must still be logged (`debug('… %O', err)` in the webview, `writeToErrorLog(...)` in the extension), never silently swallowed.

```typescript
import { createError, handleError } from '@/lib/errorops';

try {
    await riskyOperation();
} catch (error) {
    handleError(error, 'Failed to perform operation');
}
```

### Reading VS Code logs

NoteThink runs as a **web worker extension** (not Node), so its logs are under `exthost/webWorker/` not `exthost/`. Log sessions rotate — a new session dir is created each time VS Code starts. Reading these files needs `dangerouslyDisableSandbox: true` (they're under `~/.config/`).

```
~/.config/Code/logs/<session-timestamp>/
  main.log                            # VS Code main process
  window1/
    renderer.log                      # renderer (webview crashes, perf warnings)
    exthost/
      exthost.log                     # Node extension host (other extensions)
      webWorker/
        workerexthost.log             # web-worker extension host (activation errors)
        ZoomBuzz.notethink/
          NoteThink.log               # NoteThink OutputChannel (winston via LogOutputChannelTransport)
```

```bash
# find the latest session
ls -t ~/.config/Code/logs/ | head -1

# read the NoteThink extension log (captures writeToLog / writeToErrorLog)
cat ~/.config/Code/logs/<latest>/window1/exthost/webWorker/ZoomBuzz.notethink/NoteThink.log

# read renderer errors
tail -50 ~/.config/Code/logs/<latest>/window1/renderer.log

# read web-worker extension-host log
cat ~/.config/Code/logs/<latest>/window1/exthost/webWorker/workerexthost.log
```

The `debug` library (webview only — `const debug = Debug("nodejs:...")`) is **not** captured to any file. Enable it via `localStorage.debug = 'nodejs:*'` in the webview Developer Tools console. Webview `console.error()` / `console.warn()` is also not file-captured — only visible in "Developer: Open Webview Developer Tools".

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

**Exception — VS Code extension-host Mocha suite.** Tests that exercise the live VS Code API (`client/extension/src/test/suite/**`) run under the `@vscode/test-electron` Mocha runner, not Jest, and are deliberately kept in that central suite rather than colocated. The runner discovers them by directory, and they need the real extension-host environment a colocated Jest test can't provide. Colocate everything else (pure logic, webview components) next to source as above.

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

### E2E Test Scope — no reloads as workarounds
- **Do not insert `page.goto()`, `page.reload()`, or any full-page refresh mid-flow** in a Playwright test as a way to make the assertion pass. The test name usually implies the UI updates reactively in response to a server action — a reload fetches fresh server state and papers over missing client-side state sync.
- Reloads are legitimate only when the test is explicitly about refresh-resilience (e.g. "session persists after reload"). Make that intent clear in the test title and add a comment explaining why the reload is part of the flow.
- If a test fails because the UI doesn't update after an action, the bug is in the UI, not the test. Fix the UI (server action returns the entity, client merges into state).

### Disabling a spec indefinitely — comment it out, don't `test.skip`
- **`test.skip(...)` is for runtime-conditional skips** (e.g. `test.skip(!baseURL?.includes('localhost'), 'requires dev-only hook')` — the spec self-skips in prod but still runs in dev). Reported by Playwright as "1 skipped" every run, which is fine because the gating condition explains it.
- **For an indefinite disable** (spec depends on a feature that's been commented out, a UI that hasn't shipped, an external dep that's down), **comment out the entire spec file contents** — not `test.skip`. Reasons:
  - `test.skip` produces persistent "N skipped" noise in every `/prod-ready` summary, which masks genuinely unintentional skips from other reasons.
  - A commented-out file is visibly unloaded — `git grep test.skip` still finds it and the reader sees exactly what's dormant and why.
- **Required structure for a commented-out spec**: leading comment line stating the disable reason and the re-enable trigger, then the entire file body commented out (`//` per line or a single `/* … */` block), and a trailing `export {};` so the file still parses as a TypeScript module. When the feature re-lands, uncomment in one sweep.
- Same principle applies to a single `test(...)` within a larger `test.describe`: comment it out inline rather than `test.skip(...)` it.

## Working Style

### Present, don't force a decision

When the user asks to "have a look", "let me see them", "just present them", or "show me the options", **present the artifacts/options with a brief honest assessment and stop**. Do not follow up with an `AskUserQuestion` (or any other prompt) that forces an immediate choice. The user wants to evaluate on their own time and will volunteer the choice. Reserve `AskUserQuestion` for genuinely blocking ambiguity — not "which do you prefer?" when the user has explicitly asked to look first.

### No speculative specs in todo.md

When working through a story's planned phases, **do not invent new feature specs, phases, or tasks beyond what was originally scoped**. Phases and tasks come from the user, not extrapolated by Claude. Speculative additions clutter the backlog and waste time on work the user didn't ask for. If a follow-up genuinely seems worth doing, mention it in the wrap-up so the user can choose to add it — do not write it into `todo.md` unilaterally.

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
notethink is a VS Code extension — there is no `pnpm run dev` and no HTTP server to start. The webview/extension bundles are produced by webpack (`pnpm run build` or `pnpm run watch`) and previewed inside the VS Code Extension Development Host. Per the `/open-dev` skill's special cases, this project is exempt from the workspace dev-server start pattern (see workspace `AGENTS.md`, `## Dev servers`).

The "no HTTP server" rule is about a long-running **dev** server. The Playwright **test** harness (`playwright.config.ts` auto-starts `playwright/harness/serve.mjs` on port 9123 for the run, then tears it down) is throwaway test infrastructure, not a dev server, and is exempt.

### After every code change

Always rebuild the extension after each code change so the developer can preview it in the VS Code dev host. Run `pnpm run build` (or `pnpm run check` which includes the build) before considering a change complete.

**For webview/React changes specifically**, a source edit alone does NOT change what VS Code shows — the extension serves the prebuilt `client/webview/dist/index.js`. After editing anything under `client/webview/src/`:

1. **Identify the live code path first** when the component has multiple branches. Example: `BreadcrumbTrail.tsx` has two independent code paths — a single-file `splitPathSegments` branch (used when the toolbar shows "Current file") and a directory-aggregate `integration_path` branch. Determine which one is live from the current screenshot/state before editing, otherwise you'll edit the wrong branch and the visible behaviour will not change.
2. Run `pnpm run build` (webpack compiles `notethink-views` from `src/`). `build-and-rollup` also refreshes `notethink-views/dist/esm`.
3. **Confirm the edit landed in the bundle**: `grep client/webview/dist/index.js` for a token from your edit.
4. The user must **reload the VS Code window** for an already-open webview to pick up the new bundle.
5. Never report a UI change as done from a source edit alone — verify the bundle and ask the user to reload.

### Individual commands

| What | Command |
|------|---------|
| Lint only | `pnpm run lint` |
| Build only | `pnpm run build` |
| Rollup only | `pnpm -C client/webview/src/notethink-views run rollup` |
| Jest only | `pnpm run test-jest` |
| Playwright E2E | `pnpm run test-playwright` |
| Everything | `pnpm run check` |

