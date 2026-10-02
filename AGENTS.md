# NoteThink Agent Guidelines

This document provides essential information for AI agents working on the NoteThink codebase.

**Workspace-wide rules** live in [`../AGENTS.md`](../AGENTS.md) - story state machine, story tracking format, version bumps, commit policy, git workflow, releaseable-state gate, test-failure discipline, edit verification, dev-server lifecycle, browser-snapshot cleanup. Read both: the workspace `AGENTS.md` defines the cross-project rules; this file documents this project's architecture and overrides. Per-project coding standards are in [`CODING_STANDARDS.md`](CODING_STANDARDS.md).

## Project Overview

NoteThink is a VS Code extension that renders markdown files as interactive visualizations. It uses a React webview for the UI and includes a reusable component library (`notethink-views`). The repo, `zoombuzz/notethink`, is public and ships to the VS Code Marketplace.

## This repository is public: everything committed is published

`zoombuzz/notethink` is a public GitHub repository. Everything committed here is published the moment it is pushed, including `docstech/` story boards, reports and test fixtures. Removing it in a later commit does not unpublish it, because it stays in git history and on GitHub. **This is a hard rule: before writing anything into this repo, and again before committing, ask whether it is safe and insensitive to publish.** Never commit:

- **secrets, or where secrets are kept**: no tokens or keys, and no secret-store key names, `TF_VAR_*` names, or eyaml, puppet or hieradata paths. A build or publish script reads a credential from the environment by a generic name; where it is stored belongs in the private infrastructure repo.
- **anything about the operator's machines, accounts or sessions**: home or other absolute paths, usernames, hostnames, uids, session ids, transcript paths, or the names of internal tools and scripts.
- **commercial material**: notethink is a free VSCode extension, so there aren't any commercialisation plans, but promotion or marketing plans, audiences, channels, user or install counts beyond what the public Marketplace listing shows, analytics property or stream ids, and ad plans, are not stored here.
- **the operator's private words or internal process**: a quote from a conversation, who decided what without whom, or an agent's mistakes and retries. Record the decision and what was built, not how the conversation went.
- **links or paths into private repositories or tools** that a reader of this repo cannot open. The one exception is the agent instruction files (this file, `CLAUDE.md` and `CODING_STANDARDS.md`), which may point at the workspace's shared standards and at notegit by relative path, because that is how agents find them.

Write a story as a contributor would read it: the problem, the decision and what shipped. **Stories containing any of the excluded material listed above are filed on notegit's `todo.md`, not here**, even when part of the code change lands in this repo; so is any note that can only be written by naming one of the above. Before committing, read the diff of `docstech/`, `README.md`, `media/` and any fixture against this list, and leave out whatever fails it.

### Architecture

There is no root `src/`: the three source roots are described in [`CODING_STANDARDS.md`](CODING_STANDARDS.md) > File Organization.

```
notethink/
├── client/
│   ├── extension/src/            # extension host - VS Code API, LogOutputChannel logging, no DOM
│   │   ├── extension.ts          # activation
│   │   ├── vscode/               # VS Code integration, incl. notethinkEditor.ts (custom editor provider)
│   │   ├── lib/                  # utility modules, each with a colocated test
│   │   └── test/                 # Mocha suite against the live VS Code API
│   └── webview/src/              # React webview app - debug logging, no fs
│       ├── components/           # base/App.tsx, ExtensionReceiver.tsx, NoteRenderer.tsx
│       └── notethink-views/src/  # nested component-library package
├── eslint.config.mjs
├── webpack.config.js
└── package.json
```

| Component | Entry Point |
|-----------|-------------|
| Extension | `client/extension/src/extension.ts` |
| Webview | `client/webview/src/components/base/App.tsx` |
| Component Library | `client/webview/src/notethink-views/src/index.ts` (public exports) |

## Naming Conventions

Canonical: [`NAMING.md`](../lightenna-iac/docstech/standards/NAMING.md) plus [`CODING_STANDARDS.md`](CODING_STANDARDS.md) > Naming Conventions. In short: `snake_case` for locals, hook returns and wire-format data fields; `camelCase` for functions, event handlers and props; `PascalCase` for types, interfaces and components; `SCREAMING_SNAKE_CASE` for constants. A name that persists outside the codebase (a config key, a persisted-state key, a published API name) needs the operator's sign-off before it is introduced or renamed.

## Import Organization

All `import` statements go at the top of the file, one statement per module, and grouping is freeform: [`CODE_LAYOUT.md`](../lightenna-iac/docstech/standards/CODE_LAYOUT.md) > Import organisation.

## Comment Style

See workspace [`../AGENTS.md`](../AGENTS.md) > Code conventions > Comment style, and > Dashes for the em and en dash ban. notethink's extras, and the lint rules that enforce the checkable parts, are in [`CODING_STANDARDS.md`](CODING_STANDARDS.md) > Comments.

## Cruft that only makes sense on one machine

`zoombuzz/notethink` is public, so its next readers are contributors and users who have none of the tooling any given author happened to use. A reference that resolves only in one person's setup does not fail loudly for them: it reads as noise, or as a lead they follow and lose time on. This section is about usefulness, not safety: anything sensitive is already excluded by the hard rule above, and beyond that this is judgement, so nothing here wants auditing or sweeping. **The test is one question: would this line still mean something to someone who has just cloned the repo?**

- **Pointers nobody else can follow** - a link to a page only the author's account can open, a path under `~/.claude/`, a session scratchpad directory, a workstation hostname, an absolute path out of one person's home. **Say the thing rather than point at it**: where a design exploration or a scratch document produced a decision, the decision belongs in the story or the comment, written out in full.
- **Residue of how the work got done** - which tool ran what, where a copy was made to check something, how many attempts it took. Record what was decided and what it means; the method earns its place only when a future reader would have to repeat it.
- **Naming the tooling as a fact of the world is fine.** `DEFAULT_EXCLUDE_FILTER` in `client/extension/src/constants.ts` excludes `.claude` because agent worktrees mirror the repo tree and would otherwise duplicate every story in a folder view. That is product behaviour explained in terms of what the user sees; depending on the reader having the tool is the problem, not naming it.

Two things this deliberately does not cover: agent instruction files (this file, `CLAUDE.md`, `CODING_STANDARDS.md`), which exist to describe how the work gets done; and the sanitised absolute paths in the tests (`playwright/specs/breadcrumb.spec.ts` and `BreadcrumbTrail.test.tsx` use `/mnt/secure/home/dev/git/github.com/in_development`), which look like a real path without being anyone's.

## Debug Logging

The webview bundles log through `debug`, namespaced by area (`Debug("nodejs:notethink:ModuleName")`, `Debug("nodejs:notethink-views:ComponentName")`); the extension host logs through `vscode.LogOutputChannel` directly. Enable webview output with `localStorage.debug = 'nodejs:*'` in the webview devtools console. The rules, and where each log stream lands: [`CODING_STANDARDS.md`](CODING_STANDARDS.md) > Logging and Error Handling.

## Testing Guidelines

- **Extension tests (Mocha)** live in `client/extension/src/test/suite/` and run under `@vscode/test-web`, headless, via `pnpm run test-mocha` (part of `pnpm run check`) or the VS Code launch configuration; `client/extension/src/test/suite/lib/cryptoops.test.ts` is a representative suite.
- **Jest specs** sit next to their source in three packages, each with its own `jest.config.cjs`: `client/extension`, `client/webview` (which ignores the nested package) and `client/webview/src/notethink-views`. Run all three from the repo root with `pnpm run test-jest`, which is `scripts/test-jest.sh`; the root has no `test` script, and `pnpm test` inside one package runs that package alone.

## Workflow and Commit Messages

Commit policy (when to commit, single-line messages, test-summary suffix, explicit staging) lives in workspace [`../AGENTS.md`](../AGENTS.md) > Commit policy. notethink-specific override: match this repo's existing commit history (`git log --oneline`) for style.

**Examples from this repo's history:**
```
sorted out linting config for all modules; tests 157, 21
added component views including context; added playwright e2e tests; tests 157, 21
```

## Dev Server

notethink is a VS Code extension with no HTTP dev server, so there is no port to probe and no browser page to open. It is **not** exempt from the workspace dev-server start pattern: `/open-dev` launches its `webpack --watch` (`pnpm run watch`) with `systemd-run --user --scope --slice=devservers.slice`, logging to `test-results/dev.log`, and workspace `AGENTS.md` > Dev servers names zahara as its only exception. `/open-dev` previews the bundles in an ordinary VS Code window, not the Extension Development Host: VS Code loads the working copy through a hand-made `~/.vscode/extensions/notethink-dev` symlink, and **Developer: Reload Window** picks up a rebuild. The symlink is per machine and nothing provisions it, so check `ls ~/.vscode/extensions` first. The F5 Extension Development Host in `README.md` is the manual alternative.
