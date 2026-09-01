# NoteThink Agent Guidelines

This document provides essential information for AI agents working on the NoteThink codebase.

**Workspace-wide rules** live in [`../AGENTS.md`](../AGENTS.md) - story state machine, story tracking format, version bumps, commit policy, git workflow, releaseable-state gate, test-failure discipline, edit verification, dev-server lifecycle, browser-snapshot cleanup. Read both: the workspace `AGENTS.md` defines the cross-project rules; this file documents NoteThink-specific architecture and overrides. Per-project coding standards are in [`CODING_STANDARDS.md`](CODING_STANDARDS.md).

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

See workspace [`../AGENTS.md`](../AGENTS.md) > Code conventions > Comment style for the full rules (single-line comments are lowercase-first while multi-line and header blocks take normal capitalisation, one comment is exactly one line and never two `//` in a row, ~100-char inline, no back-reference comments, no PM version numbers, TODO format). The single-line rule is enforced here by the local `local/no-consecutive-line-comments` ESLint rule. notethink-specific extras and the section-divider exception live in [`CODING_STANDARDS.md`](CODING_STANDARDS.md) > Comments.

- no period at the end unless multiple sentences
- inline comments are allowed but kept short; use `//` for single-line, `/* */` for multi-line
- lowercase-first applies to the `//` form; a `/* */` multi-line or header block is prose and takes normal capitalisation
- never use the em or en dash character anywhere in this repo - see workspace [`../AGENTS.md`](../AGENTS.md) > Code conventions > Dashes

```typescript
// calculate the total including tax
const total_with_tax = subtotal * (1 + tax_rate);

/*
 * This function handles the complex logic for
 * determining note visibility based on multiple factors.
 */
function determineVisibility(note: NoteProps): boolean {
    // ...
}
```

## Cruft that only makes sense on one machine

`zoombuzz/notethink` is public and ships as a VS Code extension, so the people reading it next are contributors and users who have none of the tooling any given author happened to be using. A reference that resolves only in one person's setup does not fail loudly for them - it reads as noise, or worse as a lead they follow and lose time on. This is not a hard rule and nothing here wants auditing or sweeping. It is a category of clutter that accumulates one harmless-looking line at a time, and the cost lands on whoever reads the file a year later.

**The test is one question: would this line still mean something to someone who has just cloned the repo?**

Three tiers, roughly in order of what they cost:

- **Pointers nobody else can follow.** A link to a hosted page only the author's account can open, a path under `~/.claude/`, a session scratchpad directory, a workstation hostname, an absolute path out of one person's home directory. The reader hits a wall, or more often quietly concludes the project is missing a document. **The fix is nearly always to say the thing rather than point at it**: where a design exploration or a scratch document produced a decision, the decision belongs in the story or the comment, written out in full, and the exploration can live wherever it lives without being named here.
- **Residue of how the work got done.** Prose describing the process rather than the outcome: which tool ran what, that a copy was made somewhere to check something, how many attempts it took. Individually harmless, and it reads oddly in a repo where every other line is about the product. Record what was decided and what it means; the method earns its place only when a future reader would have to repeat it.
- **Naming the tooling as a fact of the world, which is fine.** `DEFAULT_EXCLUDE_FILTER` in `client/extension/src/constants.ts` excludes `.claude` because agent worktrees mirror the repo tree and would otherwise duplicate every story in a folder view. That is product behaviour serving a real user, explained in terms of what the user sees, and it should stay exactly as it is. Naming a tool is not the problem; depending on the reader having it is.

Two things this deliberately does not cover. **Agent instruction files are agent instruction files** - this file, `CLAUDE.md` and `CODING_STANDARDS.md` exist to describe how the work gets done, and a contributor who ignores them loses nothing. And **the sanitised absolute paths in the tests are the pattern working**: `playwright/specs/breadcrumb.spec.ts` and `BreadcrumbTrail.test.tsx` use `/mnt/secure/home/dev/git/github.com/in_development`, realistic enough to exercise the path logic and belonging to nobody. A fixture path should look like a real path without being anyone's real path.

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

Commit policy (when to commit, single-line messages, test-summary suffix, explicit staging) lives in workspace [`../AGENTS.md`](../AGENTS.md) > Commit policy. notethink-specific override: match this repo's existing commit history (`git log --oneline`) for style.

**Examples from this repo's history:**
```
sorted out linting config for all modules; tests 157, 21
added component views including context; added playwright e2e tests; tests 157, 21
```

## Dev Server

notethink is a VS Code extension - it has no HTTP dev server and is exempt from the workspace dev-server start pattern (see workspace `AGENTS.md`, `## Dev servers`). The webview/extension bundles are produced by webpack (`pnpm run build` or `pnpm run watch`) and previewed inside the VS Code Extension Development Host.
