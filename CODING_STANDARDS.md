# NoteThink Coding Standards

This document defines the coding standards for the NoteThink project.

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

## Import Organization

### Import Placement
- **All `import` statements must be at the top of the file**, before any non-import code
- The only exception is dynamic `import()` expressions used inline, which must include a comment explaining why a static import is not suitable

### Import Grouping

Organize imports in this order:

```typescript
// 1. React and framework imports
import React, { useState, useEffect, useCallback } from 'react';
// 2. External dependencies (alphabetized)
import Debug from 'debug';
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
**Always include the debug import and constant in production files**, even if not currently used. This serves as a placeholder for adding debug statements during development. This applies to production source files (`.ts`, `.tsx`), not test files (`.test.ts`, `.test.tsx`).

**Rules:**
- `import Debug from "debug"` must be the **first import** in every file
- `const debug = Debug("nodejs:...")` should appear after imports, before the component/function
- **Never remove** the debug constant, even if ESLint reports it as unused
- The debug namespace should follow the pattern: `nodejs:{path}:{filename}`

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

## Code Quality

### Avoid Duplication
- Extract repeated code into shared utility functions
- Use shared constants instead of hardcoding values
- Create shared components for repeated UI patterns

### Remove Unused Code
- Remove unused imports
- Remove unused variables (check compiler warnings)
- Remove commented-out code that's no longer needed

### Verify Edits After Making Them

- **MUST**: After any non-trivial edit, re-read the changed section to confirm the result matches intent. Don't assume edits land correctly.
- When the user references numbered items from a previous message or list, confirm which list they mean before acting.
- **Why:** Past incidents — moving the wrong story, inserting at the wrong position — were all caused by skipping post-edit verification. A 2-second re-read prevents a 10-minute recovery.

## Error Handling

### Use Error Utilities

```typescript
import { createError, handleError } from '@/lib/errorops';

try {
    await riskyOperation();
} catch (error) {
    handleError(error, 'Failed to perform operation');
}
```

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

### Test Failures Must Always Be Fixed
- **All test failures must be investigated and fixed**, regardless of whether they are related to the current change, pre-existing, or caused by external factors.
- Never dismiss a failure as "not related to this change" or "pre-existing" - if a test is red, it needs fixing before the work is complete.
- This applies to Jest, Playwright, and any other test suite.

### Test File Location

Place tests next to source files:

```
components/
├── DocumentView.tsx
├── DocumentView.test.tsx
└── DocumentView.module.scss
```

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

### After every code change

Always rebuild the extension after each code change so the developer can preview it in the VS Code dev host. Run `pnpm run build` (or `pnpm run check` which includes the build) before considering a change complete.

### Individual commands

| What | Command |
|------|---------|
| Lint only | `pnpm run lint` |
| Build only | `pnpm run build` |
| Rollup only | `cd client/webview/src/notethink-views && pnpm run rollup` |
| Jest only | `pnpm run jest-test` |
| Playwright E2E | `pnpm run test-playwright` |
| Everything | `pnpm run check` |

---

## Releaseable State After Each Phase

After completing each phase of development, the codebase must be left in a releaseable state. This means:

1. **All new code has tests** - every new module, model, library function must have corresponding tests before the phase is considered complete
2. **All existing tests still pass** - run `pnpm run jest-test` and verify zero failures
3. **Lint is clean** - run `pnpm run lint` with zero errors
4. **No broken imports or dead references** - new modules must be properly wired and importable

## Story Tracking: todo.md and done.md

Each developer has `todo.md` and `done.md` files under `docstech/users/<username>/`.

### Format Rules

- **No blank lines** at the top of the file above the file's label (e.g. `# Todo` or `# Done`).
- **Exactly two blank lines** before and after each story entry.

### Story IDs and cross-references

Stories that other stories reference need a stable ID. Without one, a cross-reference rots the moment the title changes.

- Add `[](?id=slug)` to the `###` heading to make the story addressable. The slug is kebab-case, scoped to the file (not the workspace).
  ```
  ### Detect provider-side token revocation [](?id=detect-provider-token-revocation)
  ```
- In prose, reference another story with double-square-bracket wiki syntax: `[[detect-provider-token-revocation]]`. NoteThink resolves these against `[](?id=...)` linetags in the same file.
- **Never invent a `[[slug]]` reference without also adding `[](?id=slug)` to the target heading** — the reference won't resolve and the cross-link silently breaks.
- `id` is reserved by NoteThink's authoring guide for `##` epic headings, but the linetag mechanism is generic and `id=` works on `###` story headings identically. We use it on stories because the slug stays stable across title edits.
- The full NoteThink authoring guide (epic ids, view configuration, inherited attributes, encoding rules) lives at `AUTHORING_GUIDE.md`. Read it before introducing a new linetag key.

### todo.md

- Stories are read **top-to-bottom** - the next story to work on is always the one at the top.
- Each story may contain tasks as a checklist (`- [ ]`). When completing a task, mark it `[X]` (e.g. `- [X] Task description`).
- When a story is being actively implemented, attach a status linetag to its heading: `### Story title [](?status=doing)`.
- Linetags use the format `[](?key=value&key2=value2)` appended to a story heading **or to any bullet line**.
- When a story is completed (all tasks done), remove it from `todo.md` and append it to `done.md`.
- **Story plans go in todo.md, not separate files.** When planning a non-trivial story (including plan-mode output), write the implementation plan as expanded sub-bullets under the story's heading. Do **not** create a separate markdown file (e.g. under `~/.claude/plans/`). The todo.md / done.md files are the durable, checked-in record of scope, plan, and progress; `[X]` on each sub-bullet is how progress is shown. External plan files duplicate this, rot quickly, and aren't visible to anyone reviewing repo history.

### Story content shape

These rules cover the *content shape* of a story — its title, bullets, and structure. The format rules above cover *mechanics* (heading level, checklist syntax, linetags). All targets here are guidance, not hard caps.

- **Titles are short.** Aim ≤ 60 chars (visible, excluding linetags). Em-dash qualifiers and sub-theme lists belong in the body, not the heading. No `HUMAN:` / `CLAUDE:` prefix on titles.
- **Top-level bullets fit on one wrapped line.** ~120 chars is the working target. If a bullet runs longer, the surplus moves to child bullets, not the same line.
- **One thought per bullet.** Don't chain ideas with "and", ";", "OR", "—" to glue them together. Split into siblings or parent+children.
- **Task bullets lead with the verb.** Checklist items (`[ ]` / `[X]`) start with an imperative ("add", "rename", "ship", "verify"). Non-task bullets (observations, hypotheses, background notes) can be any shape.
- **No role prefixes on tasks.** Don't write `CLAUDE:` / `HUMAN:` in front of a task. Default assumption: any task can be done by either, often collaboratively via Playwright MCP. Use the `work=manual` linetag (below) for the rare cases that are genuinely manual.
- **Detail lives in children, not parentheticals.** Rationale, file paths, sub-steps, caveats, lettered enumerations — go under the parent as nested bullets, not inside `(…)` glued onto the parent. A short parenthetical is fine; anything longer than a few words moves to a child.
- **Structured sections are bulleted, not prose.** `goal`, `scope`, `out of scope`, `background`, `acceptance criteria`, `dependencies`, `test plan`, `commit message draft` — each item is its own bullet (or child), not a paragraph. A short one-line narrative is fine where it reads naturally.
- **Commit-message draft is bulleted.** One bullet per chunk (version bump, summary, tests count, etc.) as siblings — not a single backticked run-on sentence.
- **Code/file refs are short.** `path/to/file.ts:42` is enough; don't quote whole snippets inside a bullet — fence them as a child code block only if truly needed.

### Manual-work linetag

Tasks default to "either Claude or human can do this, often collaboratively (Playwright MCP, etc.)". Tag a task only when it is **genuinely manual** — when no Claude collaboration can carry it out. Examples: responding to an email under your name, kicking off a Claude Design session, physical-machine actions, captcha-gated flows where automation is disallowed.

- Use `[](?work=manual)` on the task's line.
- "Requires login via SSO" is **not** manual — Playwright MCP plus a one-click SSO prompt is collaborative, not manual-only.
- If several sibling tasks are all manual, group them under a single parent bullet and tag the parent — don't sprinkle the linetag across every leaf.

Example:

```
+ outreach [](?work=manual)
  + [ ] reply to Shopify reviewer email
  + [ ] identify 3-5 SEO publications to pitch
```

### Time Tags

Two distinct tags — do not confuse them. Units: minutes.

- **`time_estimated`** — forward-looking forecast of how long a story is expected to take. Can appear on a story in `todo.md` at creation time, or on a completed story in `done.md` (kept alongside `time_taken` for retrospective accuracy). Optional: if no sensible estimate is available at creation time, omit the tag entirely rather than guess.
- **`time_taken`** — **actual** time spent on the story so far. Non-zero by definition. On an unfinished story in `todo.md` it represents work already done to date; on a completed story in `done.md` it represents total time from inception through completion.

**CRITICAL**: `time_taken` must only ever contain time that has actually been worked. Never put an estimate into `time_taken` — even "a small placeholder" — because these values feed client billing, and recording estimated time as taken time means billing for work that may not have happened. If no time has been worked yet, omit the tag; use `time_estimated` for the forecast instead.

```
### New story [](?time_estimated=180)                        # ok in todo.md — forecast only, no work done yet
### New story                                                 # also ok in todo.md — no estimate available
### In-progress story [](?time_estimated=180&time_taken=45)  # ok in todo.md — 45 min worked so far, 180 min forecast total
### Completed story [](?time_taken=225)                      # ok in done.md — 225 min actually worked
### Completed story [](?time_estimated=180&time_taken=225)   # ok in done.md — keeps the forecast alongside the actual for retrospective accuracy
```

### done.md

- Completed stories are **appended to the end** of the file.
- Maintain exactly two blank lines before and after each story entry.
- When moving a story to done.md, remove any `status` attribute from its linetag - all stories in done.md are implicitly `status=done`.

### Example todo.md

```
# Todo


## Current story [](?status=doing)

Story description here.

- [X] First task already done
- [ ] Second task still to do


## Another story

Another description here.

- [ ] Some task
- [ ] Another task
```

### Example done.md

```
# Done


## Completed story

Description of completed work.

- [X] Task one
- [X] Task two


## Another completed story

Description of another completed story.
```

## Version Bumps

- **Always bump the version** in the governing `package.json` when implementing code changes.
- **Only increment the patch version** (e.g. 2.11.2 → 2.11.3). Major and minor version changes are the user's decision.
- After completing work, show the updated version number in your output.

## Commit Messages

- Commit messages must be a **single line** — no newlines or multi-line bodies.
- **Never** include a `Co-Authored-By` tag.

## Git Workflow

- Develop and test on the `staging` branch.
- Run `/prod-ready` before committing. Only commit + push to `staging` once `/prod-ready` reports green.
- Before every release commit, verify that `engines.vscode` in `package.json` is `>=` the major/minor of `@types/vscode` (and any other vscode-dependent packages). `vsce package` fails CI when `@types/vscode` is greater than `engines.vscode`. If `@types/vscode` has been bumped, bump `engines.vscode` to match.
- Merging `staging` → `main` is a **production deployment**. Always use `sh/git/merge-main.sh` — never merge manually.
- The merge to `main` is decoupled from the staging push; it often runs later, not in the same session.
- **Post-deploy healthcheck: one shot, not a loop.** After any deployment, hit the healthcheck endpoint **once** to confirm the new version is live, then move on. Do not poll in a sleep loop waiting for something to happen — the user will say if something is wrong.
