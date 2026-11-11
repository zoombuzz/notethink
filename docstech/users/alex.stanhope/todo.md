# Todo [](?nt_view=kanban)


### Share parse-worker scheduling and recovery [](?id=shared-parse-worker-scheduling&status=code-review)

+ goal: keep current-file and folder parsing responsive when a parse worker fails.
+ problem: two parse schedulers maintain the same mechanics with different failure handling.
+ parallel: edits `PanelSession.ts`, `ParsePool.ts` and `useWorkerParsedDocs.ts`; run it after [[latest-folder-scan-wins]], which also edits `PanelSession.ts`, and alongside any other batch story
+ builds on: `client/extension/src/vscode/ParsePool.ts:61` and its existing crash-recovery behavior.
+ builds on: the folder parsing adapter in `client/webview/src/hooks/useWorkerParsedDocs.ts:105`.
+ background
  + measured: both pools implement lazy slots, FIFO jobs, pump/free-slot/spawn/dispatch and inline spawn fallback.
  + measured: both size the pool to half the reported cores, capped at four.
  + measured: `client/extension/src/vscode/notethinkEditor.ts:49` constructs the extension pool.
  + measured: `client/extension/src/vscode/PanelSession.ts:198` uses it for document parsing.
  + measured: `client/webview/src/hooks/useWorkerParsedDocs.ts:278` submits folder documents to the webview pool.
  + measured: `client/webview/src/hooks/useVscodeMessages.ts:473` consumes the resulting parsed documents.
  + measured: `ParsePool.ts:80` bounds its queue; `:103` supersedes stale requests; `:156` wires worker errors.
  + measured: `ParsePool.ts:173` resolves a crashed worker's current job inline and replaces the worker.
  + measured: `useWorkerParsedDocs.ts:200` registers only a message listener before posting at `:218`.
  + inferred: a webview worker error without a response leaves that job's promise unresolved.
    + Its pending key clears only when the promise resolves at `useWorkerParsedDocs.ts:279`.
    + This is a source-level settlement gap, not a reproduced production failure.
  + measured: the extension tsconfig restricts its root to `src`; the webview uses a separate build graph.
  + measured: `CODING_STANDARDS.md` deliberately mirrors a few defaults across the two bundles.
  + inferred: a runtime-neutral scheduling core can share lifecycle policy while retaining both execution sites.
+ approach
  + This is a new pattern for shared parse scheduling; no existing scheduler abstraction covers both callers.
  + Extract the existing extension pool's mechanics into one environment-neutral source built into both bundles.
  + Inject worker construction, protocol encoding, inline parsing and logging instead of importing VS Code or DOM APIs.
  + Keep webview blob preparation, content cache and parse probes in the existing webview adapter.
  + Keep extension URI construction and keyed stale-request handling in its adapter.
  + Keep the sticky-session `AgentAnalyserWorkerPool` separate; its cache affinity and batching differ.
+ [X] isolate the shared parse scheduling core from the existing pool implementation.
  + decision: the core is `client/extension/src/lib/ParseScheduler.ts`, imported by relative path into the webview bundle; it imports nothing runtime-specific, and no webpack or tsconfig change was needed.
  + Adjust build inclusion only where required; keep two bundles and introduce no external package or worker service.
  + Preserve the documented mirrored-default exception instead of sweeping constants into the new core.
+ [X] route both current-file and folder parsing through the shared lifecycle mechanics.
  + decision: `ParsePool` and the webview's `ParseWorkerPool` are now thin adapters over `ParseScheduler`; a worker error settles its in-flight job inline, a job superseded before its worker crashes costs no inline parse, and `dispose` now rejects in-flight jobs as well as queued ones.
  + Settle in-flight work on worker error with the existing inline fallback behavior.
  + Drain queued work after spawn failure; prevent later jobs from being stranded.
  + Bound queued work and settle superseded or evicted jobs explicitly.
  + Preserve response identity/hash checks and ignore stale results.
  + Dispose workers at the owning runtime's existing lifecycle boundary.
  + decision: `NotethinkEditorProvider` owns the extension's pool, so its constructor pushes the pool's `dispose` onto `context.subscriptions` (the pattern `activate` uses for the audio coordinator); `notethinkEditor.test.ts` > 'parse pool lifecycle' proves disposing the subscriptions disposes the pool.
+ [X] exercise shared scheduler behavior with controlled worker doubles.
  + `ParseScheduler.test.ts` covers success, concurrency, error answer, spawn failure, crash, stale response, supersession, overflow and disposal; `ParsePool.test.ts` still passes through the adapter.
  + Cover success, concurrent work, spawn failure, worker crash, stale response, queue overflow and disposal.
  + Use `client/extension/src/vscode/ParsePool.test.ts:79`, `:139` and `:169` as existing behavioral references.
  + Assert every submitted promise settles and a later job still completes after a crash.
+ [X] add a worker-path webview regression for crash recovery and pending-key release.
  + `useWorkerParsedDocs.worker.test.ts` runs the hook through a Worker double: success, crash then later docs, error answer releasing the pending key, and a mismatched response ignored.
  + `client/webview/src/hooks/useWorkerParsedDocs.test.ts:6` currently runs all cases through inline fallback.
  + Preserve hash-based caching and released-document memory behavior from the existing hook tests.
+ [X] verify both bundles load real workers and preserve current-file/folder rendering.
  + webview: `node scripts/perf/run.mjs --only folder-progressive-20,folder-progressive-50,folder-progressive-200,single-file-100k` in headless chromium read the parse-mode probe as worker_parses 20, 50 and 200 with fallback_parses 0, every budget verdict ok.
  + extension: a new Mocha suite `client/extension/src/test/suite/lib/parsepool.test.ts` under vscode-test-web constructs a real `Worker` from `parseWorker.js` through `ParsePool`, and both parses were answered by the worker with no crash; the full Playwright suite (313) also passes.
  + Use the existing parse-mode probe in `scripts/perf/page-agent.js:169` to distinguish workers from fallback.
  + Do not claim a speedup; this change shares policy and closes a settlement gap.
+ acceptance criteria
  + One scheduling implementation owns worker slot lifecycle and crash settlement for both parse adapters.
  + A crashed folder parser leaves no permanently pending document and later work continues.
  + Extension supersession and folder cache/release behavior remain intact.
  + Existing parse behavior and rendered document content are unchanged.


### Agent card: one quiet line when nothing is uncommitted or pending [](?id=agent-card-quiet-line&status=code-review)

An agent card with nothing uncommitted and nothing to push spends two lines saying so: `No uncommitted files`, then `No pending commits` under it. The two greys also differ. The card should say both on one line, in the grey the files row already uses.

+ parallel: touches only the agent card files under `components/notes/agent/` and `AgentNote.module.scss`, which no other story in this batch touches, so it can run alongside any of them
+ builds on: [[agent-card-compact]], which added both rows
  + files row: `agent/AgentFileBands.tsx:36` renders `No uncommitted files` as `styles.fileBandEmpty` above the pending row
  + pending row: `agent/AgentPendingCommits.tsx:16` renders `No pending commits`, `No upstream` or `N pending commits` as `styles.pendingCommits`
+ measured: the greys come from two different rules in `AgentNote.module.scss`
  + `.fileBandEmpty` (`:536`) dims the card's foreground with `opacity: 0.55`; this is the right grey (operator)
  + `.pendingCommits` (`:526`) sets `color: var(--nt-agent-idle)`, which is `--vscode-descriptionForeground`; this is the wrong grey
+ decision 2026-11-11 (operator): with no uncommitted files and no pending commits, the card shows one line, not two
  + recommended wording: `No uncommitted files or pending commits`, as one l10n string
  + the line is not expandable, like `No uncommitted files` today
+ decision 2026-11-11 (operator): every grey state of the pending row uses the files row's grey, not `--nt-agent-idle`
  + applies to `No pending commits` under a files row with changes, and to `No upstream`
  + `N pending commits` stays `--nt-agent-waiting`
  + one shared style for both rows, so the two greys cannot drift apart again
+ decision 2026-11-11 (operator): with no uncommitted files and no upstream, the card also folds to one line, `No uncommitted files, no upstream`
+ [X] render a single combined line in `AgentFileBands` when `uncommitted` is empty and `pending_commits` is 0 or there is no upstream, keeping a stable test id for it
+ [X] move the pending row's grey states onto the files row's grey through one shared style in `AgentNote.module.scss`
+ [X] extend `AgentFileBands.test.tsx` for the combined line, and for two rows whenever either side has something to show
+ [X] update `playwright/specs/agent-card.spec.ts:317` to assert the combined line, and that the pending row's grey equals the `No uncommitted files` grey
+ [X] add a "design revised 2026-11-11" line on [[agent-card-compact]], whose decision named `--nt-agent-idle` for the pending row
+ [X] update `README.md` > Agent activity if it describes the two empty rows
+ [X] bump the patch version
+ note: the combined line is `No uncommitted files or pending commits`, or `No uncommitted files, no upstream`; with a git tree it folds only when pending is 0 or there is no upstream, and a card with no git tree keeps the plain `No uncommitted files` line
+ manual: on a clean, pushed story in the kanban view, confirm one grey line; then add a commit and confirm the pending row splits out in the waiting colour


### Agent card: short count, expandable pending commits [](?id=agent-card-pending-detail&status=code-review)

The agent card's count reads `1 agent` or `2 agents`, which is longer than the status line needs. The pending commits row shows only a count, so the operator cannot see which commits are waiting or how much they change without leaving the card.

+ builds on: [[agent-card-compact]], which added the status line and the pending commits row
+ builds on: the collapsed uncommitted files row in `agent/AgentFileBands.tsx`, with `AgentChevron` and `LineDiffCounts`; no new disclosure component
+ verified: the count is `AgentMetaRow.tsx:38`
+ verified: the pending row is `agent/AgentPendingCommits.tsx:21`, drawing only a number
+ verified: the host sends only an ahead count, `ActivityTree.pending_commits` (`types/AgentActivity.ts:318`), with no hashes, files or line counts
+ decision 2026-11-11 (operator): the count reads `1 ag`, `2 ag`, with no plural form
+ decision 2026-11-11 (operator): the pending commits row expands like the uncommitted files row, collapsed by default
  + the row carries the green and red line totals across all pending commits: `2 pending commits +120 -34`
  + expanded, it lists each pending commit: its short hash and how many files it changes
  + with no pending commits, or no upstream, the row stays as today and does not expand
+ [X] change the count to `{0} ag` in `AgentMetaRow.tsx`, updating its tests and any l10n bundle entries
  + `AgentMetaRow.tsx` now reads `l10n.t('{0} ag', ...)`; `1 agent` and `{0} agents` are gone from all five bundles, and `AgentMetaRow.test.tsx`, `AgentNote.test.tsx` and `agent-card.spec.ts` read `1 ag` / `2 ag`
+ [X] add per-commit detail for the pending commits to `ActivityTree`: sha, files changed, lines added, lines removed
  + `ActivityTree.pending_detail` is `ActivityPendingCommit[]` (`short_sha`, `files`, `added`, `removed`), mirrored in both `AgentActivity.ts` files; `AgentAnalyser.test.ts` > `pending commit detail` reads it end to end
  + read the commits between upstream and HEAD through the git extension API
    + the git extension's cross-host commands carry no log: `git.api.getRepositoryState` gives HEAD's sha, `ahead` and every ref's sha, and the other two commands read no repository
    + so `agentgitops.ts` takes the stop point and bound from that state (`upstreamCommitOf`, `pendingCommitsOf`) and reads each commit and its changed files from the loose object store through `vscode.workspace.fs` (`agentgitobjectops.ts`); a packed object reads as absent and its commit lists with no figures
  + compute it with the scan's fresh line diffs (`postFreshLineDiffs`), never in an early batch
    + `attributeTrees` calls `pendingDetailFor` only with `compute_fresh_line_diffs`, and earlier batches answer from a cache keyed by HEAD, the upstream sha and the ahead count; `AgentAnalyser.test.ts` asserts the live post carries no detail
  + bound the list, saying so on the row when it is bounded (PATTERNS.md > "Bounded lists say they are bounded")
    + the list is the newest `ACTIVITY_PENDING_DETAIL_MAX` (20) commits, and the row reads `Showing the latest N of M pending commits` and a `Line counts cover N of M pending commits` hover when it lists fewer than are pending
+ [X] make `AgentPendingCommits` an expandable row with `AgentChevron` and `LineDiffCounts` totals
  + `AgentPendingCommits.tsx` reuses `AgentChevron` and the now exported `LineDiffCounts`; with none pending, no upstream or no detail it stays the plain row `agent/AgentFileBands.tsx` and `quietLineFor` already draw
  + keep its expansion in the card-level `setNoteExpanded` state, as the files row does
    + decision: each row opens on its own, as its own entry on the view's `view_expanded_ids` list: the files row keeps the bare `stable_id`, the pending row uses `stable_id` plus `PENDING_COMMITS_EXPANSION_SUFFIX` (`#pending-commits`), both written through `setNoteExpanded` in `AgentNote.tsx`, so each survives a re-render on its own
    + `AgentFileBands.test.tsx` and `AgentNote.test.tsx` assert opening one leaves the other closed, and the reverse; `agent-card.spec.ts` > `opens the pending commits row and the files row independently of each other` asserts it in the browser
+ evidence: `agentgitops.realrepo.test.ts` builds a real repository with the `git` CLI (a bare clone as the tracked remote, three pending commits that edit, add in a nested folder and delete files) and reads it through an fs-backed loose object reader and the real `DecompressionStream`; the short shas, file counts and added and removed lines equal `git log --numstat --no-renames @{u}..HEAD`, and a packed parent or a fully `git gc`ed repository lists no figures rather than a guess
+ [X] list each pending commit when expanded: short hash and `N files`
  + `agent-pending-commit-row` shows `abc1234  3 files`, with `1 file` singular and the hash alone for a commit whose objects could not be read
+ [X] update the Jest cases in `AgentFileBands.test.tsx` and `AgentNote.test.tsx`, and the agent card Playwright spec
  + `AgentFileBands.test.tsx` > `pending commit detail`, `AgentNote.test.tsx`, `agentgitobjectops.test.ts`, `agentgitops.test.ts` and `agent-card.spec.ts` (two new specs, the existing pending specs now allow the totals)


### Fast agent scans that say when each card is done [](?id=agent-scan-per-card&status=code-review)

Every agent card says "Scanning agent activity..." until the analyser's whole first scan ends, even a card already drawing its own sessions, so the board cannot tell a finished card from a stuck scan. That first scan is slow on a large history in a Remote-SSH window, and it is paid again on every window start. Switching the card type away and back must never redo it: moving between views should be instant.

+ builds on: the agent analyser in `client/extension/src/vscode/AgentAnalyser.ts`, and the card notice in `agent/AgentActivityBanner.tsx:63`
+ measured 2026-11-11, a large history in a Remote-SSH window, from the extension log's `runScan` timing lines
  + the first scan read several hundred sessions whole, about 9.5 GB, in 76 batches
  + the first cards drew sessions after about 6 s; the state turned `live` after about 6.3 min
  + reading took 372 s of the 379 s scan; parsing took 26 s, overlapped with reading
  + the next rescan, with the in-memory cache warm, took about 7.6 s
+ verified: the notice is global; `emptyNotice` shows it while `analyser.state === 'scanning'` before any completed scan, whatever the card holds (`AgentActivityBanner.tsx:63`)
+ verified: `state` stays `scanning` through every batch but the last (`AgentAnalyser.ts:780`)
+ verified: the read cache `file_cache` (`AgentAnalyser.ts:315`) is in memory only, so every window start reads every transcript whole again
+ verified: a transcript over `AGENT_TRANSCRIPT_MAX_BYTES` is cropped in the worker (`AgentAnalyserWorker.ts:44`), after it has crossed the wire whole
+ confirmed 2026-11-11: Claude Code session folders are named for their launch cwd, with every character outside `[a-zA-Z0-9]` replaced by a dash (`encodeClaudeProjectDirName`), so that vendor's repository is known at discovery
  + measured against a real Claude Code projects folder: for every project folder holding a readable cwd (33 of 33) the folder name equalled the encoding of the newest transcript's first `cwd`; the one other folder had no `cwd` in its first 64 KB
  + disproved for Grok: its folder is the URI-encoded cwd and discovery already decodes it (`discoverGrok`), so it too is scoped before any read; only Codex reveals its directory once read, so a Codex rollout counts as possibly belonging anywhere
+ card-type switching today
  + verified: withdrawing the last card stops the analyser after `AGENT_STOP_GRACE_MS`, 5 s (`AgentAnalyser.ts:37`), disposing the worker pool (`stopRunning`, `AgentAnalyser.ts:579`)
  + verified: after a completed scan, a restart posts the last snapshot at once (`demand`, `startRunning`), and unchanged sessions are reused from `file_cache`
  + confirmed 2026-11-11 by the Jest case below, run before the fix: pool disposal did not bump `worker_generation`, so the restart sent the grown transcript to a fresh worker as a `tail`, and `AgentAnalyser.test.ts` > `a stop and restart with the session still live and growing` read 10 input tokens where the whole transcript holds 20
  + confirmed 2026-11-11, run before the fix: the grace elapsing mid-scan disposed the pool under the in-flight round trip, abandoning the scan, and the snapshot stayed `scanning` after the card came back (`lets a scan in flight finish through a withdrawal` and `keeps scanning when a card returns during the first scan` both failed)
+ new pattern: persisting a parse cache across restarts, noted here; no PATTERNS.md entry covers it. The shape is `lib/agentscancacheops.ts` (pure: versioned store, window eviction, trim, key by home) plus `AgentAnalyser.loadScanCache` and `saveScanCache` (the I/O)
+ [X] persist each session's analyser output across window restarts, keyed by its file identities (path, mtime, size)
  + `lib/agentscancacheops.ts` and `AgentAnalyser.loadScanCache` / `saveScanCache`; `AgentAnalyser.test.ts` > `AgentAnalyser persisted read cache` shows a fresh host reading zero transcripts, and only the changed session re-read
  + store it under the extension's global storage, keyed by vendor home, so a remote and a local window never share entries
    + the file is `agent-scan-<hash of the home URI>.json` under `context.globalStorageUri` (`scanCacheFileNameFor`); `keys the store by vendor home` asserts two homes look for two files
  + load it before the first scan, so unchanged sessions are reused and the first post is the last known state
    + decision: the load runs in `resolveVendorHomeAndRun` before the watchers arm and the first scan is scheduled; the first post follows that scan's stat pass, which reads nothing for an unchanged session, rather than being posted before discovery, since a snapshot needs the git trees and story boards the scan reads
  + version the stored shape and discard it on a mismatch
    + `AGENT_SCAN_CACHE_VERSION`; `agentscancacheops.test.ts` and `discards a store of another version or a corrupt one` cover a wrong version, bad JSON and malformed entries; `stores an output of the shape the current store version describes` pins the output's keys so a shape change fails there and asks for a bump
  + evict sessions that leave the 30-day window, so the store stays bounded
    + `serialiseScanCache` leaves out any session whose newest file is past the window and `parseScanCache` drops one that aged out since it was written; `pruneFileCache` already drops sessions no longer found
  + decision: only what a card draws is stored; a call's edit bodies are dropped unless it targets a story board (the binder reads only those), and no message text is ever held (`stores no edit body of a source file and no message text`)
  + decision: a first scan saves at most every 15 s between batches, so an interrupted one resumes, and every scan saves at its end when anything changed
+ [X] carry first-scan progress on the snapshot: sessions read so far and sessions found
  + `ActivityAnalyserState.progress` in both type files, set by `AgentAnalyser.noteScanProgress` on every scanning post and absent once live; `AgentAnalyser.test.ts` > `reads the open repository's sessions before newer ones` asserts 8 of 10
+ [X] drop the scanning notice from a card already drawing sessions, keeping the dimmed count `AgentMetaRow` shows while scanning
  + `AgentActivityBanner.tsx` > `emptyNotice` shows it only with no sessions; `AgentNote.test.tsx` and `agent-card.spec.ts` > `draws no scanning notice on a card already drawing sessions` assert no notice and `data-scanning` on the count
+ [X] show progress in the notice on a card with no sessions, e.g. `Scanning agent activity, 212 of 624 sessions`
  + new string in all five l10n bundles; asserted in `AgentNote.test.tsx` and `agent-card.spec.ts`
+ [X] mark a card's own scan done once every session that could belong to its repository has been read
  + `ActivityAnalyserState.done_roots` lists the repository roots no unread session could belong to (`rootsWithNothingLeftToRead`, `scopeMayBelongTo` in `agentanalyserops.ts`); `isAgentCardScanDone` in the webview turns it, a live state or a completed scan into the card's own `scan_done`
  + confirm the Claude Code folder-name mapping first; where it holds, use it at discovery
    + it holds (the confirmed line above); discovery now stamps each Claude Code and Grok candidate with its scope, and `names a Claude Code project folder for its sessions' own cwd` ties the fixture folder to the cwd
    + decision: a session could belong to a repository when its folder names the root, a folder inside it or a symlinked alias of it, or sits above it (an umbrella-folder session can write into a repository below); a Codex rollout, whose folder is unknown, holds every repository back until it is read, so a card is never called done early
  + read sessions in the open folder's repositories first, newest first within them
    + `orderCandidates` puts sessions that could belong to an open workspace folder or repository first, then the rest, each by mtime; the first test above reads four older `/ws` sessions ahead of six newer ones from another folder
  + a done card with no sessions says `No agent activity in 30 days` without waiting for the rest
    + asserted in `AgentNote.test.tsx` and `agent-card.spec.ts` > `says a card has no agent activity once its own repository is read`; a card whose repository is not among the finished ones keeps the progress notice
+ [X] write a Jest case that stops, restarts, appends to a live session and asserts its usage covers the whole transcript
  + `AgentAnalyser.test.ts` > `a stop and restart with the session still live and growing keeps its usage covering the whole transcript`; its worker double clears the line cache on `terminate`, as a real worker thread does; run before the fix it failed with 10 tokens against 20
  + run it before the fix, to confirm or disprove the suspected under-count
+ [X] bump `worker_generation` whenever the pool is disposed, if that case fails
  + the case failed, so `stopRunning` now bumps it; the same case passes
+ [X] let a scan in flight finish through a withdrawal, stopping the analyser only once it ends
  + the grace timer sets `stop_after_scan` while a scan runs and `runScan` stops the analyser when it ends, unless a card came back; `lets a scan in flight finish through a withdrawal` and `keeps scanning when a card returns during the first scan` pass, having failed before the change
+ [X] add a Jest case asserting a restart with nothing changed reads zero transcripts
  + `a restart after the grace with nothing changed reads zero transcripts and posts the last snapshot at once` (in-memory restart) and `a new window reuses what the last one read` (fresh host from the store); also the log line `loaded N session(s) from the persisted read cache` and the scan line's `0 read, N skipped` show it on a real restart
+ [X] add a Playwright case: agent card type on, wait for live, switch card type away past the grace and back, and assert the sessions redraw at once with no scanning notice
  + `agent-card.spec.ts` > `redraws every session at once, with no scanning notice, when the card type is switched away past the stop grace and back`; the harness has no host grace, so it covers the webview's side (the latched completed scan) and the Jest cases above cover the host's
+ [X] log one debug line per first-scan batch with sessions read so far, so a long first scan reads as progressing
  + `runScanBatch` debug line, `first scan batch 2 of 76: 140 of 624 session(s) read, 41200ms in`; `logs one debug line per first-scan batch` asserts it and that a later scan adds none
+ manual: restart a Remote-SSH window on a large history and confirm the agent cards fill within seconds


### Single-file kanban falls back to document view [](?id=single-file-kanban-auto-view&status=code-review)

Opening a file tagged `[](?nt_view=kanban)` through NoteThink: Open Viewer draws a flat document instead of a board whenever the workspace holds other files. View settings resolve to "Auto (Document)" and no columns render.

+ parallel: inferred to sit in the webview auto-view path (`AutoView.tsx`, `useAutoIntegration.ts`), so it can run alongside the other batch stories; if the fix lands in `PanelSession.ts`, run it apart from [[latest-folder-scan-wins]] and [[shared-parse-worker-scheduling]]
+ background
  + measured in vscode-test-web, 2026-09-25: the file alone in its workspace resolves "Auto (Kanban)" with 2 columns and 7 cards; the same file among four sibling files resolves "Auto (Document)" with none
  + identical at ee0626c and on the current tree, so it predates the performance work
  + the Playwright specs miss it because they inject `selectionChanged` directly instead of going through the real open-viewer path
  + inferred, untested: the default "Watch unopened files in viewer" setting may let sibling files outvote the active file's own `nt_view` during auto-resolution
+ [X] find where auto-resolution picks the view type in current-file mode and why sibling files change it
  + measured in vscode-test-web with a real Open Viewer: the sibling files do not matter, the file alone in its workspace resolves Auto (Document) too when it declares `nt_view` on its H1
  + measured: with the source editor visible beside the viewer the same file resolves Auto (Kanban), alone or among siblings; a front-matter `nt_view` resolves kanban either way
  + cause: Open Viewer opens over the source's only tab, so no editor shows it and the host sends a null selection; the focused chain is then only the root note, and AutoView read `nt_view` only from the focused chain, which misses the H1
  + the inferred "Watch unopened files in viewer" cause did not hold: its watcher arms for the active file only (PanelSession.ts syncActiveFileWatcher) and never feeds a sibling into the view
+ [X] make a current-file open honour the active file's `nt_view`
  + AutoView.tsx: a non-folder view takes the file's declared view type (fileDeclaredViewType, H1 over front matter) when no focused note votes; a focused note's own `nt_view` still wins
  + the fix lands in the webview (AutoView.tsx), not PanelSession.ts
+ [X] add a spec that opens a file through the real open-viewer path in a multi-file workspace and asserts kanban columns render
  + `playwright/specs/open-viewer-single-file-kanban.spec.ts` serves the built extension through @vscode/test-web, opens a tagged file beside four siblings, runs NoteThink: Open Viewer and asserts kanban with columns; it failed (document, no columns) before the fix and passes after
  + unit coverage in `AutoView.test.tsx` (cleared caret, no focus, no tag, focused note override)


### Latest folder scan wins [](?id=latest-folder-scan-wins)

Typing a new Include filter can leave the board and the Files drawer showing the result of an older, partial pattern. On 2026-09-25, in a workspace of about 2200 markdown files, `**/{todo,done}.md` showed `(0 in 0 files)` while 22 files on disk match it.

+ parallel: edits `PanelSession.ts`, as [[shared-parse-worker-scheduling]] does, so those two run one after the other with this one first; it can run alongside every other batch story
+ background
  + measured: NoteThink.log 11:07:42, first scan with built-in `**/*.md` found 2235 and loaded 200
  + measured: the workspace `.vscode/settings.json` born 11:08:10; its VS Code local history copy holds the three Files-drawer keys with Include `**/{todo,done}.md`
  + measured: a python walk with the same excludes finds 22 `todo.md` / `done.md` files
  + measured in code: each debounced drawer edit posts `setIntegration` (useViewHandlers.ts `handle_apply_filters`)
  + measured in code: `onDidReceiveMessage` does not await `handleMessage`, so two `enterFolderMode` runs overlap (PanelSession.ts)
  + measured in code: `discoverFolderDocs` sets `integration_total_discovered`, then an un-awaited `allSettled` republishes and clears pending
  + measured in code: `loadFolderDoc` rejects only a different folder, never an older scan of the same folder
  + measured in code: `globMatch.ts` already expands `{a,b}`, so the host-side filter is not the fault
  + inferred: a partial-pattern scan finished last and overwrote the full one; the production build does not log enough to confirm
  + `(0 in 0 files)` also renders when discovered equals loaded at zero (BreadcrumbTrail.tsx count label), so the label alone does not prove scan order
+ follows PATTERNS.md > "Empty states": fix the error path before the presentation, so this lands before [[files-drawer-change-defaults]] and any first-run copy
+ [ ] stamp each folder discovery with a generation number in PanelSession
+ [ ] drop a stale scan's findFiles result, its per-file loads, its aggregate payload and its `pending=false`
+ [ ] add an extension test: two deferred `findFiles`, the older resolves last, the board keeps the newer set and discovered count
  + assert payload fields, not the breadcrumb string
  + include one `**/{todo,done}.md` case on the same path
  + do not use `**/{todo` as the only fixture
+ [ ] keep `(X in Y of M files)` when the winning scan is truncated (PATTERNS.md > "Bounded lists say they are bounded")
+ [ ] verify in that workspace: reload the window with Include `**/{todo,done}.md` and confirm stories from 22 files
+ out of scope
  + cancelling in-flight parses from the parse-offload work; a stale scan's results are ignored, not aborted


### Chief-of-staff workflow pack [](?id=chief-of-staff-pack)

Someone running coding agents against stories in a `todo.md` has no ready-made way to ask an agent "what should be worked on next?" or "what do I need to do right now to keep the agents busy?", or to watch that work on a board. This story ships a workflow pack in `workflows/chief-of-staff/`: two agent skills, the story rules they rely on, and a board that opens in NoteThink, where each step links to the markdown that drives it.

+ parallel: new files under `workflows/` only, so it can run alongside any other batch story
+ approach
  + layout: `todo.md` (the board, `# Todo [](?nt_view=kanban)`), `AGENTS.md`, `CLAUDE.md`, `README.md`, `skills/what-next/SKILL.md`, `skills/me-now/SKILL.md`, and a script that moves a finished story to `done.md`
  + `AGENTS.md` holds the content, so every agent reads it; `CLAUDE.md` holds only `@AGENTS.md`
  + board stories: install the skills, run `/what-next`, run `/me-now`, let the agent keep the board; each links to the file it describes, so a click opens that markdown in the viewer
  + the skills are written for any repo: they find `todo.md` and `done.md` relative to the workspace, and name no user, path or project outside the pack
  + the board opens signed out in a browser through notethink.com's app route for public GitHub files, which needs [[single-file-kanban-auto-view]] fixed and notethink.com's default view set to auto
+ what `AGENTS.md` > How stories work carries, the subset of the rules these skills depend on
  + encoding: `###` stories under `# Todo` or `# Done`, a `[](?status=...&id=...)` heading linetag, `+ [ ]` and `+ [X]` tasks, exactly two blank lines around each story
  + priority is position: the top story is next, and a new story goes in at the top
  + states: untagged, `doing`, `code-review`, `testing`, done; set `doing` on starting, and tick each task the moment it is done
  + an advance is a claim: the work exists, every box is ticked with evidence, and nobody narrows a story to pass
  + the move to `done.md`: append at the end, strip `status=`, keep the other keys, refuse while any box is open
  + `[](?work=manual)` marks only what no agent can do, and `+ manual:` lines are checks, not tasks
  + content shape, decision lines, phases as separate stories, and `[[slug]]` references to a pinned `id=`
  + left out: rules that only make sense with tooling the pack does not ship, such as a coordinator, a review bus, multi-repo runs, time-taken tags, and machine or server setup
+ sanitise: everything in the pack is published, so it is checked before it is committed
  + a Jest scan over `workflows/` catches absolute home paths, emails, IP addresses and host:port pairs, analytics ids, secret-shaped strings, links that leave the pack, and em or en dash glyphs
  + the scan takes an optional terms file from outside the repo, for names that must not appear but cannot be listed publicly, and reports matches masked
  + quotes and process narrative are still a judgement, per `AGENTS.md` > This repository is public
+ [ ] write `AGENTS.md` with the How stories work section, and a `CLAUDE.md` holding only `@AGENTS.md`
+ [ ] write `what-next` and `me-now` as repo-local skills that point only at files in the pack
+ [ ] add the move-to-done script with Jest tests for the append, the `status=` strip, the open-box refusal and a dry run
+ [ ] write the board `todo.md` and `README.md`, each story linking to its file
+ [ ] add the sanitise scan as a Jest test over `workflows/`, with a test proving each pattern is caught and the terms file is masked
+ [ ] confirm in VS Code that each board link opens its markdown in the viewer
+ [ ] once pushed, open the board signed out through notethink.com's app route and confirm columns render and links open, in the same run
+ [ ] bump the patch version


### Evaluate AgentChevron as a duplicate expand control [](?id=agent-chevron-duplicate-eval)

Question: is `AgentChevron` (`client/webview/src/notethink-views/src/components/notes/agent/AgentChevron.tsx`) a duplicate of another expand or collapse control that is worth refactoring, to reduce technical debt and make the code more readable?

+ parallel: reads code and writes only to this board, so it can run alongside any other batch story
+ known: 8042cc4 (agent tree) added `AgentChevron.tsx`
+ suspected: other expand or collapse controls in the webview may already do the same job under another name; nothing has searched for them yet
+ [ ] Search the webview for existing chevron, caret, disclosure or expand controls and compare each with `AgentChevron` (`git log` on each)
+ [ ] Record a verdict with `file:line` evidence: a duplicate worth refactoring, or different enough to keep, and why
+ [ ] If it is worth refactoring, file the refactor as its own story at the top of this board, with a `builds on` line naming the component to keep


### Watcher applies dependency and config changes [](?id=watch-restarts-on-config)

`pnpm run watch` recompiles on source changes, including those a `git pull` lands. A pull that changes a `package.json`, a `pnpm-lock.yaml`, `webpack.config.js` or a `tsconfig*.json` is not applied: the bundles keep building against stale config or modules until someone restarts the watcher by hand.

+ parallel: touches only `scripts/watch.mjs` and the `watch` script in `package.json`, so it can run alongside any other batch story
+ background
  + `watch` is `SELFINSPECT_ENV=dev webpack --watch` (`package.json` scripts); it logs to `test-results/dev.log`
  + inferred, untested: webpack watches only its module graph, so it never re-reads `webpack.config.js` or ts-loader's `tsconfig`
  + there are four lockfiles: root, `client/extension`, `client/webview` and `client/webview/src/notethink-views`, the last three installed by the root `postinstall`
  + no PATTERNS.md entry for a self-restarting watcher; new pattern
+ approach
  + a `scripts/watch.mjs` supervisor runs webpack in watch mode as a child and watches the config and dependency files itself
  + a lockfile or `package.json` change stops webpack, runs `pnpm install --frozen-lockfile`, then restarts webpack
  + a `webpack.config.js` or `tsconfig*.json` change restarts webpack only
  + changes are debounced, so a pull touching many files causes one restart
  + a failed install is logged loudly and webpack is not restarted against half-installed modules
  + SIGTERM and SIGINT are forwarded to the child, so stopping the watcher by PID stops everything
+ [ ] add `scripts/watch.mjs` and point the `watch` script at it, keeping `SELFINSPECT_ENV=dev`
+ [ ] keep the child's command line matching `webpack --watch` with the repo root as cwd, which is how a running watcher is found
+ [ ] cover the decision logic with tests: which changed path means install and restart, restart only, or nothing
+ [ ] verify against a running watcher: rewrite `webpack.config.js` unchanged, touch a lockfile, and read each restart and the new compile in `test-results/dev.log`
+ [ ] bump the patch version


### Compact agent card: usage in status line, folded files [](?id=agent-card-compact&status=code-review)

The agent card spends space on things the operator does not read. The usage summary (tokens, time window, cost) takes its own line under the status line, and the uncommitted files list shows three rows plus "and N more" at the bottom. The operator wants the card denser: usage folded into the status line, the file list collapsed behind a one-line summary, and a new line showing how many commits are waiting.

+ builds on: the agent card in `client/webview/src/notethink-views/src/components/notes/AgentNote.tsx:43` and its parts in `agent/`
  + status line: `agent/AgentMetaRow.tsx:27` renders `{0} agent(s)` as `styles.agentCount`
  + usage line: `agent/AgentUsageSummary.tsx:26` renders `formatActivityUsage` from `lib/agentactivityops.ts`, e.g. `8203112 tokens (2d) ~$12.40`
  + files: `agent/AgentFileBands.tsx:13` folds at `UNCOMMITTED_ROW_LIMIT = 3`, with the "and N more" and "Show less" buttons in `agent/AgentFileBand.tsx:128`
  + expand control: reuse `AgentChevron` with `aria-expanded`, as the subagent toggle in `agent/AgentChildRows.tsx:80` does; no new disclosure component
  + colours: `--nt-agent-waiting` (the "Waiting on you" orange) and `--nt-agent-idle` (muted grey) in `AgentNote.module.scss:15`
+ no PATTERNS.md entry covers card density or disclosure rows; this is a new pattern, noted when the story lands
+ decision 2026-11-10 (operator): drop the usage line and put tokens and cost on the status line, e.g. `1 agent, 8.2Mt, ~$12.40`
  + drop the `(s)`: one session reads `1 agent`, more read `3 agents`, using a plural-aware l10n string
  + tokens use a `t` suffix with K, M or G: `32Kt`, `8.2Mt`, `1.1Gt`; one decimal below 10 of a unit, none at 10 or above
  + cost is approximate, so always prefixed `~$`
  + the time window is not carried over; the card stops showing it
  + the status line never wraps: `white-space: nowrap` and `overflow: hidden` on the row, no ellipsis
+ decision 2026-11-10 (operator): the uncommitted files become one expandable row, collapsed by default
  + the row reads `5 uncommitted files +120 -34`, with the green and red counts styled as `LineDiffCounts` already does
  + expanding shows the whole file list, with no three-row fold and no "and N more" button
  + with nothing uncommitted the row reads `No uncommitted files`, not expandable
+ decision 2026-11-10 (operator): a pending commits row sits under the files row
  + grey (`--nt-agent-idle`) when there are none: `No pending commits`
  + yellow (`--nt-agent-waiting`, matching "Waiting on you") when there are some: `2 pending commits`
+ decision 2026-11-11 (operator): "pending" means local commits not yet pushed, the count the branch is ahead of its upstream
  + with no upstream branch the row reads `No upstream` in grey
  + verified: no ahead or unpushed count exists today; `ActivityTree` (`types/AgentActivity.ts:311`) has `committed` from the reflog (`agentgitops.ts:152`), which is not an ahead count
  + suspected, not verified: the git extension state behind `git.api.getRepositoryState` (`agentgitops.ts:26`) carries `HEAD.ahead`; confirm before relying on it
+ known gap: line counts stop after `AGENT_LINE_DIFF_MAX_FILES_PER_REPO = 20` files (`AgentAnalyser.ts:58`), so the summary total can undercount
  + when any file lacks counts, the row title (hover text) says how many files the counts cover
+ [X] add a token formatter giving `32Kt`, `8.2Mt`, `1.1Gt` in `lib/agentactivityops.ts`, with Jest cases at each unit boundary
+ [X] rewrite the `AgentMetaRow` count as plural-aware `1 agent` / `3 agents`, followed by `, <tokens>, ~$<cost>`
+ [X] make the status row `nowrap` with hidden overflow, so a narrow card clips the end of the line
+ [X] remove `AgentUsageSummary` from the card and delete the component and its test if nothing else uses it
+ [X] replace the three-row fold in `AgentFileBands` with one collapsed summary row that expands to the full list via `AgentChevron`
  + keep the expansion in the card-level `setNoteExpanded` state the current "and N more" uses, so it survives a re-render
+ [X] show partial-count coverage in the files row hover text when any file has no counts
+ [X] add a `pending_commits` count (or `undefined` with no upstream) to `ActivityTree` in both mirrored type files, `client/extension/src/types/AgentActivity.ts` and the webview copy
+ [X] read the ahead-of-upstream count in `client/extension/src/vscode/agentgitops.ts`, with Jest cases for ahead, level and no upstream
+ [X] render the pending commits row under the files row, grey at zero or no upstream and `--nt-agent-waiting` above zero
+ [X] add Jest coverage for `AgentMetaRow` and `AgentFileBands`, which have no direct tests today
+ [X] update `playwright/specs/agent-card.spec.ts` for the usage line gone, the collapsed files row, its expansion, and both pending commit colours
+ [X] update `README.md` > Agent activity if it describes the usage line or the file fold
+ [X] bump the patch version
+ manual: judge the new card density on a busy story in the kanban view, at a narrow column width
+ note: ahead count verified in the git extension's `git.api.getRepositoryState` handler, which spreads `HEAD` (a `Branch`) so `HEAD.ahead` and `HEAD.upstream` are present, and `ahead` is only set when an upstream exists; `pendingCommitsOf` in `agentgitops.ts` reads `HEAD.upstream` then `HEAD.ahead`
+ note: new pattern for card density: a one-line collapsed summary row opened by `AgentChevron` with `aria-expanded`, state kept in the card-level `setNoteExpanded` list (`AgentFileBand.tsx`), and a single status line carrying counts (`AgentMetaRow.tsx`)
+ design revised 2026-11-11: the pending row's grey states use the files row's grey, not `--nt-agent-idle`, and a clean pushed card folds both rows into one line; see [[agent-card-quiet-line]]


### Coordinators beside boards in folder and project views [](?id=coordinator-views)

The `agent` card shows which sessions are editing a story, but not the long-lived coordinator that owns a repo's board. With many repos open under one folder, the operator cannot see which repos have a coordinator, what state each is in, or message one without leaving the board.

+ background
  + a coordinator is the long-lived agent session that owns one repo's board and working tree on one machine
  + each coordinator registers itself on its machine with one `agent.json` (repo path, machine, agent kind, mailbox, state, binary version, open convoys)
  + the registry, the mailbox and the envelope are public interfaces defined by thinkersync, a separate open-source project whose stories live in its own repo
  + this story extends the Agent activity section of `README.md`, which reads vendor session files; the registry is a second, separate source
  + order: this follows the coordinator rollout, which creates the registry entries and mailboxes this story reads
+ approach
  + folder view: NoteThink open on a folder lists every registered agent whose repo path is inside that folder, beside that repo's board
  + project view: NoteThink open on one repo lists the one agent whose repo path is that repo
  + show only: NoteThink never starts, stops or restarts an agent, and a repo with no registered agent shows none
  + each agent row shows its state, current story, binary version and open convoys, read from the registry
  + sending writes an envelope into the agent's mailbox on the same machine, from the board or from a card
  + the `[](?coord=<host>)` target marker renders as a line on the board that can be dragged
  + dragging the line moves the marker between story headings; a keyboard path does the same (PATTERNS.md > Accessible drag and resize affordances)
  + open convoys and their operator steps show on the story they belong to
  + over Remote-SSH the web-worker extension host runs locally but reads the remote machine's files through the workspace file system, so it reads that machine's registry
  + desktop only, like the `agent` card, because a browser host has no file access
+ [ ] add a registry reader that lists `agent.json` entries and filters by repo path inside the open folder
+ [ ] add a list of registered agents with their state to the folder view and the project view
+ [ ] add a "send to agent" action on the board and on a card that writes an envelope to the agent's mailbox
+ [ ] render the `[](?coord=<host>)` marker as a draggable line, rewriting the linetag on drop
+ [ ] add a keyboard path that moves the target line without dragging
+ [ ] show open convoys and operator steps on their stories
+ [ ] cover the registry filter, the envelope write and the marker move with Jest tests
+ [ ] cover the folder view, the project view and the draggable line with Playwright tests
+ [ ] extend the Agent activity section of `README.md` with the registry source and the show-only rule
+ [ ] bump the patch version


### Send envelopes between machines through a sync service [](?id=coordinator-sync-client)

Story [[coordinator-views]] reaches agents on the same machine only. An agent on another machine is out of reach unless the operator opens a second window there. This story adds delivery between machines, through a sync service chosen in a setting.

+ background
  + the sync client and the per-instance process belong to thinkersync, a separate open-source project; this story only uses them
  + dependency: delivery between machines cannot be built until thinkersync's client library exists, so this story waits on it
  + an instance is one NoteThink instance: a VS Code window on a folder, or the browser workbench
  + each instance runs its own thinkersync client and process, and stays independent of other instances on the same machine
+ approach
  + a VS Code setting names the sync service, defaulting to notethink.com
  + the extension starts and stops one client process per instance, and the views from [[coordinator-views]] list agents from other machines the same way as local ones
  + an envelope for an agent on another machine goes through the chosen service; one for a local agent still goes straight to its mailbox
  + the view shows whether the chosen service reports that it holds nothing for this instance
  + a service that is unreachable leaves local sending working and says so beside the remote agents
+ [ ] add the sync service setting with notethink.com as its default, and document it in `README.md`
+ [ ] start and stop one thinkersync client process per instance
+ [ ] route envelopes for agents on other machines through the chosen service
+ [ ] show remote agents beside local ones, marked by machine
+ [ ] show whether the service holds nothing for this instance
+ [ ] state the network use in the Agent activity section of `README.md`, which today says NoteThink reads no network endpoint for agent activity
+ [ ] cover the setting, the process lifecycle and the routing choice with Jest tests
+ [ ] bump the patch version


### Files drawer defaults under Change defaults [](?id=files-drawer-change-defaults)

The Files drawer shows Make user default, Reset to user default and Reset to built-in default all the time, while View settings keeps its default actions in a closed Change defaults disclosure. Every drawer that offers default actions should use that one disclosure.

+ background
  + measured: FilesDrawer.tsx renders `SettingsCascadeButtons` unconditionally in its `drawerMeta` aside
  + measured: `SettingsCascadeButtons.tsx` always enables "Make user default", which applies every NoteThink setting
  + measured: `ChangeDefaultsDisclosure` (SettingsViewDrawer.tsx) is a closed `<details>` with a diverged tally, and disables save when nothing diverged
  + measured: SettingsCardDrawer.tsx has no cascade buttons by design; the default actions cover every setting
  + design: the disclosure sits in the drawer's side column under its File settings title, closed, with the same tally text as View settings
+ [ ] extract `ChangeDefaultsDisclosure` into one shared component, keeping its tally and disabled rules
  + the caller passes the count; the component never computes it
+ [ ] render it in the Files drawer in place of `SettingsCascadeButtons`, closed by default
+ [ ] count the Files tally over the three NODE_FILES keys: includeFilter, excludeFilter, maxNotesPerFile
  + measured: View's count covers only its own rows (SettingsViewDrawer.tsx `diverged_count`), and those rows leave out the NODE_FILES keys (settingRows.ts header)
  + disable save only when none of the three diverged
  + both buttons still write every NoteThink setting; only the tally is scoped
  + do not pass View's count into Files
+ [ ] keep the built-in restore button on the Files drawer only, where a wiped filter must be recoverable
+ [ ] align the Files labels with View settings (Save as user default, Revert to user default)
+ [ ] retire `SettingsCascadeButtons` once nothing renders it, moving its tests to the shared component
+ [ ] extend FilesDrawer.test.tsx and a playwright spec to open the disclosure before clicking a default action
  + include a files-only divergence: Include changed, no view setting changed, save enabled and tally at 1
+ out of scope
  + cascade buttons on the card drawer
  + narrowing the whole-cascade message to file filters only


### Split view: two panes on the view registry [](?id=split-view) [post-v1]

Two views visible at once, such as a document pane beside a kanban pane. The view hierarchy and per-view state this story once asked for already exist; the gap is mounting a second view.

+ goal
  + two views mounted side by side, each scrolling independently and addressed by its own view id
  + a drag handle between the panes resizes the split, persisted like other view settings
+ background
  + the view hierarchy is data already: [[view-registry]] (`viewregistryops.ts`)
  + per-view state exists: `setViewManagedState` / `deleteViewFromManagedState` / `revertAllViewsToDefaultState` (ViewProps.ts) and the `viewStates` map; a second pane is a second entry, not a new state system
  + `parent_view` / `child_views` on ViewProps are declared and read (`useViewContext.ts`) but never written
  + mermaid renders inline as a card type, so "document + mermaid" is no longer a split-view case
+ ordering
  + lands after [[kanban-virtualized-columns]], [[webview-state-persistence-diet]], [[folder-wire-payload-diet]] and [[extension-parse-offload]], since a second pane doubles the costs they bound
+ scope
  + each pane is an ordinary `GenericView` reading its own `viewStates` entry; no parallel render path
  + two panes only; two different view types or two different scopes (current file beside a folder)
+ out of scope
  + more than two panes
+ acceptance criteria
  + both panes render with their own toolbar, breadcrumb and drawers
  + the split ratio and both panes survive a reload
  + closing a pane leaves no stranded `viewStates` entry
  + `pnpm run check` green
+ [ ] build the pane container: a CSS split with a drag handle around two `GenericView` mounts
+ [ ] route add-pane and close-pane through the existing view-state handlers
+ [ ] populate `parent_view` / `child_views` for the pane relationship, or delete them as dead code
+ [ ] persist the split ratio and each pane's view id across reload
+ [ ] add jest: each pane resolves its own view state; closing a pane removes exactly its entry
+ [ ] add playwright: open a second pane, resize, reload, both panes and the ratio survive