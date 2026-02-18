# NoteThink Agent Guidelines

This document provides essential information for AI agents working on the NoteThink codebase.

## Project Overview

NoteThink is a VS Code extension that renders markdown files as interactive visualizations. It uses a React webview for the UI and includes a reusable component library (`notethink-views`).

### Architecture

```
notethink/
├── client/
│   ├── extension/          # VS Code extension (TypeScript)
│   │   ├── src/
│   │   │   ├── extension.ts           # extension entry point
│   │   │   ├── vscode/                # VS Code integration
│   │   │   │   └── notethinkEditor.ts # custom editor provider
│   │   │   ├── lib/                   # utilities
│   │   │   │   ├── crypto.ts          # hashing utilities
│   │   │   │   ├── parseops.ts        # markdown parsing
│   │   │   │   ├── errorops.ts        # error handling
│   │   │   │   └── utils.ts           # general utilities
│   │   │   ├── types/                 # TypeScript types
│   │   │   └── test/                  # extension tests (Mocha)
│   │   └── dist/                      # compiled extension
│   │
│   └── webview/            # React webview application
│       ├── src/
│       │   ├── components/
│       │   │   ├── base/App.tsx       # webview entry point
│       │   │   ├── ExtensionReceiver.tsx  # message handler
│       │   │   └── NoteRenderer.tsx   # note rendering
│       │   ├── notethink-views/       # component library (npm package)
│       │   │   ├── src/
│       │   │   │   ├── components/
│       │   │   │   │   ├── views/     # view components (DocumentView, etc.)
│       │   │   │   │   └── notes/     # note components
│       │   │   │   ├── types/         # shared types
│       │   │   │   └── lib/           # rendering utilities
│       │   │   └── dist/              # built library
│       │   └── types/                 # webview types
│       └── dist/                      # built webview
│
├── eslint.config.mjs       # linting configuration
├── webpack.config.js       # build configuration
└── package.json            # root package
```

### Entry Points

| Component | Entry Point | Purpose |
|-----------|-------------|---------|
| Extension | `client/extension/src/extension.ts` | VS Code extension activation |
| Webview | `client/webview/src/components/base/App.tsx` | React app root |
| Component Library | `client/webview/src/notethink-views/src/index.ts` | Public exports |

## Naming Conventions

**Critical:** Follow these conventions strictly.

### Variables and Identifiers

| Type | Convention | Examples |
|------|------------|----------|
| Local variables | `snake_case` | `user_name`, `is_valid`, `note_count` |
| Hook returns | `snake_case` | `const user_data = useUserData()` |
| Computed values | `snake_case` | `const total_price = items.reduce(...)` |
| Functions | `camelCase` | `getUserName()`, `handleClick()` |
| Event handlers | `camelCase` | `onClick`, `onSubmit`, `handleChange` |
| Props | `camelCase` | `userName`, `isDisabled`, `onClick` |
| Types/Interfaces | `PascalCase` | `UserData`, `NoteProps`, `ViewOptions` |
| Components | `PascalCase` | `DocumentView`, `GenericNote` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES`, `API_BASE_URL` |

### Examples

```typescript
// correct
function calculateTotal(items: ItemList): number {
    const item_count = items.length;
    const total_price = items.reduce((sum, item) => sum + item.price, 0);
    return total_price;
}

// incorrect
function calculateTotal(items: ItemList): number {
    const itemCount = items.length;      // should be snake_case
    const totalPrice = items.reduce(...); // should be snake_case
    return totalPrice;
}
```

## Import Organization

Order imports as follows:

```typescript
// 1. React and framework imports
import React, { useState, useEffect } from 'react';
// 2. External dependencies
import Debug from 'debug';
import { someUtil } from 'external-package';
// 3. UI framework / component library
import { Button, Modal } from '@zoombuzz/notethink-views';
// 4. Internal utilities and libraries
import { generateIdentifier } from '@/lib/crypto';
import { parseMarkdown } from '@/lib/parseops';
// 5. Types
import type { NoteProps } from '@/types/NoteProps';
import type { ViewProps } from '@/types/ViewProps';
// 6. Components (local)
import DocumentView from './DocumentView';
import GenericNote from '../notes/GenericNote';
// 7. Styles
import styles from './Component.module.scss';
```

## Comment Style

- comments start with lowercase letters
- no period at the end unless multiple sentences
- place comments on the line above, not inline
- use `//` for single-line, `/* */` for multi-line

```typescript
// calculate the total including tax
const total_with_tax = subtotal * (1 + tax_rate);

/*
 * this function handles the complex logic for
 * determining note visibility based on multiple factors
 */
function determineVisibility(note: NoteProps): boolean {
    // ...
}
```

## Debug Logging

Use the `debug` library for logging. Each module should create its own debug instance:

```typescript
import Debug from 'debug';

const debug = Debug('notethink:module-name');
// or for views
const debug = Debug('notethink-views:ComponentName');

// usage
debug('processing note %s', note.id);
debug('state update: %O', new_state);
```

To enable debug output in browser console:
```javascript
localStorage.debug = 'notethink:*'
```

## Testing Guidelines

### Extension Tests (Mocha)

Located in `client/extension/src/test/`. Run via VS Code launch configuration.

```typescript
import * as assert from 'assert';
import { generateIdentifier } from '../../lib/crypto';

suite('Crypto Utils', () => {
    test('generates consistent hash for same input', async () => {
        const hash1 = await generateIdentifier('test');
        const hash2 = await generateIdentifier('test');
        assert.strictEqual(hash1, hash2);
    });
});
```

### Component Tests (Jest + React Testing Library)

Located in `client/webview/src/notethink-views/`. Run with `npm test`.

```typescript
import { render, screen } from '@testing-library/react';
import DocumentView from './DocumentView';

describe('DocumentView', () => {
    it('renders document container', () => {
        render(<DocumentView id="test" />);
        expect(screen.getByTestId('document-test-inner')).toBeInTheDocument();
    });
});
```

## Pre-Completion Checklist

Before marking a task complete, verify:

- [ ] Code compiles without errors (`npm run compile`)
- [ ] Linting passes (`npm run lint`)
- [ ] Naming conventions followed (snake_case variables, camelCase functions, PascalCase types)
- [ ] Imports properly organized
- [ ] No `console.log` statements (use `debug` instead)
- [ ] Tests pass (if applicable)
- [ ] Types are explicit, not inferred as `any`
- [ ] Comments are lowercase and placed above code
- [ ] No unused imports or variables
