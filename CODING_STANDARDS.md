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
- **No back-reference comments.** Never write inline comments that point readers at context elsewhere in the same file or function — `// see function header for the rationale`, `// see above`, `// see the JSDoc`, `// (see comment on line 42)`. The reader is already there; pointers add clutter without information and rot when the layout changes. When lifting a long inline comment to a function-header JSDoc, either delete the inline outright (the JSDoc + well-named identifiers usually suffice) or replace it with a *short* self-contained factual one-liner that stands on its own — never leave a stub that says "see header for rationale". Same anti-pattern as the rule against referencing the current task / fix / callers (`// used by X`, `// added for the Y flow`, `// handles the case from issue #123`) — pointers belong in the PR description, not inline.
- **No project-management version numbers in comments.** Never write inline comments like `// added in 2.11.0`, `// fixed in 2.12.3`, `// from v2.10 release`, etc. Project-management versions belong in `package.json` and any place that actively uses them — never in comments that don't get re-rendered when the version changes. Stale version-tagged comments accumulate every release and force a search-and-purge pass on the next minor bump. The only acceptable place a version literal appears in code is a block that actively *uses* it.
- **No per-field comments inside data structures.** Don't interleave `//` comments or per-field JSDoc blocks alongside fields in an `interface`, `type`, `class`, Prisma model, GraphQL schema, JSON-schema, or any other data-shape declaration. Per-field comments fragment the field list, make the shape harder to scan, and decay into inconsistency as new fields are added without matching annotations. If a field needs explanation, lift it into the **structure's header comment** as a short `- field_name: …` line, so every field that warrants a note is documented in one block above the declaration rather than scattered alongside the fields. The only acceptable inline comments inside a data structure are **section dividers** that group related fields by purpose (e.g. `// --- identity ---`, `// --- timestamps ---`) — comments that describe a *group of fields*, not an individual one.

```typescript
// correct — field docs in the header, fields scan cleanly
/**
 * Doc represents a loaded markdown file.
 * - mtime: on-disk modification time (epoch ms); drives within-band relevance ordering
 * - hash_sha256: content hash, used by the webview to skip no-op re-renders
 */
interface Doc {
    id: string;
    path: string;
    text: string;
    hash_sha256?: string;
    mtime?: number;
}

// incorrect — per-field comments interleaved with the fields
interface Doc {
    id: string;
    path: string;
    text: string;
    // content hash, used by the webview to skip no-op re-renders
    hash_sha256?: string;
    // on-disk modification time (epoch ms); drives within-band relevance ordering
    mtime?: number;
}
```

```typescript
// correct — section dividers grouping fields by purpose
interface NoteOrigin {
    // --- identity ---
    doc_id: string;
    doc_path: string;
    relative_path?: string;
    // --- presentation ---
    project_hue?: number;
    project_label?: string;
}
```

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

## Code Quality

### Avoid Duplication
- Extract repeated code into shared utility functions
- Use shared constants instead of hardcoding values
- Create shared components for repeated UI patterns

### Remove Unused Code
- Remove unused imports
- Remove unused variables (check compiler warnings)
- Remove commented-out code that's no longer needed

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

