# Reporting a Bug

When something misbehaves in NoteThink, the fastest path from "this is weird" to a fixed cause is a short slice of the debug logs around the failure. The extension logs in two places — host and webview — and getting Claude (or anyone else) useful context means grabbing from the right one.

## Where the logs live

| Layer | Source files | Log mechanism | Where output lands |
|-------|-------------|---------------|--------------------|
| Extension host | `client/extension/**` | `writeToLog` / `writeToErrorLog` (winston, `lib/errorops.ts`) | **Output panel** (View → Output → "NoteThink" channel) **and**, in dev builds, mirrored to `<workspace>/notethink-extension.log` |
| Webview | `client/webview/**` (incl. `notethink-views`) | `debug` library (`const debug = Debug("nodejs:...")`) | **DevTools Console** inside the webview iframe |

The host-side file log only writes when the build flag `NOTETHINK_DEV` is true (set by the F5 / `pnpm run watch` dev launch). Packaged `.vsix` installs do not produce the file.

## Reproducing with logs enabled

1. Launch a dev session: open the repo in VS Code, press **F5** ("Run Web Extension"). This sets `NOTETHINK_DEV` and starts the Extension Development Host.
2. Open a note that exercises the broken path.
3. In the dev host window: **Help → Toggle Developer Tools** (`Shift+Ctrl+I`), then the **Console** tab.
4. The webview auto-enables `nodejs:*` debug output in dev mode (`client/webview/src/index.tsx` calls `Debug.enable('nodejs:*')` when `NOTETHINK_DEV` is set), so no `localStorage` setup is needed. For a packaged build you'd type `localStorage.debug = 'nodejs:*'` in the **iframe's** console (use the frame selector at the top of the Console — the `top` frame's localStorage is a separate store and won't reach the webview).
5. Reproduce the failure. Note the wall-clock time of the failed action so it's easy to find in the logs afterward.

## What to include in the report

A good bug report has three parts:

1. **Reproduction steps** — exact clicks/keys, and which file(s) you had open.
2. **What you expected vs what happened.**
3. **A log excerpt** — the last ~20 lines of webview console output around the failure, and/or the tail of `notethink-extension.log` if the issue is host-side (file watcher, save round-trip, settings cascade, kanban persistence, etc.). Paste as text; screenshots of consoles are harder to grep.

If you don't know which layer to grab from, a rough guide:

- **Looks wrong on screen, doesn't update, layout/render bug** → webview console.
- **Wrong content loaded, file saved in the wrong place, settings/config behaviour, watcher behaviour, multi-file aggregation** → host log (`notethink-extension.log` or Output panel).
- **When in doubt** → include both. Brief is fine.

### Filtering to one area

Webview debug namespaces follow `nodejs:<area>:<File>`:

- `nodejs:notethink:*` — webview app (`client/webview/src/...`)
- `nodejs:notethink-views:*` — the embedded component library (`client/webview/src/notethink-views/...`)

To narrow output to one component while reproducing:

```js
localStorage.debug = 'nodejs:notethink-views:KanbanView'
// or a wildcard within an area:
localStorage.debug = 'nodejs:notethink-views:Kanban*'
```

Reload the webview after changing the value.

## Grabbing the host log file

In a dev session the file appears as `notethink-extension.log` in the workspace root of the dev-host window (the folder whose name ends in `notethink`, or the first workspace folder otherwise). It's a rolling 500-line buffer flushed every 1s — so capture it shortly after the repro and before doing anything else, otherwise older lines roll off.

```bash
tail -200 notethink-extension.log
```

Paste the relevant slice into the bug report. Don't redact timestamps — they're how the host and webview events get correlated.
