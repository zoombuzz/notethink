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

const debug = Debug("nodejs:notethink:module-name");
// or for views
const debug = Debug("nodejs:notethink-views:ComponentName");

// usage
debug('processing note %s', note.id);
debug('state update: %O', new_state);
```

To enable debug output in browser console:
```javascript
localStorage.debug = 'nodejs:*'
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

## Workflow and Commit Messages

**Do not commit unless explicitly asked.** Write code, run lint and tests, and present your changes in the working copy for review. Only create a commit when the user explicitly requests it.

**"What's next?"** means: read `docstech/users/alex.stanhope/todo.md`, take the top story, and prepare an implementation plan. Present the plan for approval. If there are ambiguities, choices, or approvals needed, ask those questions alongside the plan so the user can resolve everything in one go. When the user approves and asks you to implement, launch multiple agents simultaneously to work on independent parts of the plan in parallel.

When committing, messages must be consistent with the existing commit history. Review `git log --oneline` to match the style.

**Rules:**
- **Never add "Co-authored-by:" lines** to commit messages. No attribution footers of any kind.
- The message should purely inform the reader what was done — concise, lowercase, descriptive.
- **Commit messages must be a single line** — no newlines, no multi-line bodies.
- After the description, append a test summary: `; tests <jest>, <playwright>`
- Run `pnpm jest-test` for Jest counts and the Playwright suite for E2E counts.

**Examples from this repo's history:**
```
sorted out linting config for all modules; tests 157, 21
added component views including context; added playwright e2e tests; tests 157, 21
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

## Story and Task Tracking

Developer stories and tasks are tracked in `docstech/users/<username>/todo.md` and `done.md`.

- **Mark completed tasks** with `[X]` in `todo.md` (e.g. `- [X] Task description`).
- **Move completed stories** — when all tasks in a story are done, remove the story from `todo.md` and append it to `done.md` (with exactly two blank lines before and after each story).

## Dev Server Management

Multiple projects in this workspace use Next.js and share similar process names. A broad `pkill` or `killall` command intended for one dev server can inadvertently kill others.

**Rules:**
- When starting a dev server (`pnpm dev`, `pnpm dev:worker`, etc.) via `run_in_background`, capture the new process's **PID** immediately afterwards (e.g. `lsof -ti :PORT`) and **store it in memory**.
- When stopping a dev server, **kill only the specific PID** — never use `pkill node`, `pkill next`, `killall node`, or any pattern-based kill that could match other running servers.
- If you don't have the PID, use `lsof -ti :PORT` for the specific port to find the correct process before killing it.

## Screenshots

Ubuntu screenshots are saved to `~/Pictures/Screenshots/`. When the user refers to "the latest screenshot", "my screenshot", or similar, find the most recent file:

```
ls -t ~/Pictures/Screenshots/*.png | head -1
```

Then read it with the Read tool and include it in your analysis.
