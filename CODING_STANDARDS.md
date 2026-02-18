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

- start with lowercase
- no period at end (unless multiple sentences)
- place above the code, not inline

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

## React Patterns

### Component Structure

```typescript
import React, { useState, useEffect } from 'react';
import type { ComponentProps } from './types';
import styles from './Component.module.scss';

const debug = Debug('notethink:ComponentName');

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
