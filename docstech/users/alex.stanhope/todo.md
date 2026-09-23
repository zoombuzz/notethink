# Todo [](?nt_view=kanban)


### Virtualized kanban columns [](?id=kanban-virtualized-columns)

Every card mounts into the DOM: 200 files x 10 stories = 2000 `Draggable` cards (`KanbanBoard.tsx:96-127`), each rendering markdown, and the FLIP layer measures every `[data-flip-id]` node with getBoundingClientRect on each membership change (`useFlipTransition.ts:292`, fired per merge via the `signature` memo). CPU profiles show querySelectorAll + getAnimations at ~9-12% of load. @hello-pangea/dnd officially supports virtual lists (react-window pattern, overscan required). The factor-out this story asked to coordinate with is now [[line-view]], and the ordering is resolved: it lands FIRST, so windowing is implemented once in `LineView` and every grouped view inherits it. This is the only story in the perf cycle that the view programme blocks.

+ goal
  + DOM card count is bounded by viewport + overscan regardless of corpus size; scrolling a column streams cards in (the infinite-scroll feel)
  + FLIP measurement cost scales with visible cards, not total cards
+ scope
  + adopt react-window (or equivalent fixed/variable-size list) per kanban column following the dnd virtual-lists pattern, with overscanning and drag-clone rendering per their docs
  + variable card heights: measure-and-cache strategy (cards clip to a max height already via useMarkdownNoteOverflow)
  + scroll-to-focused-card (`useScrollToCaret`, viewhooks.ts) must ask the virtualizer to scroll before framing; keyboard navigation and the focus ring rules (CODING_STANDARDS Focused-note scroll framing) still hold
  + FLIP: restrict measure/animate to mounted (visible) cards; skip animation entirely when a membership change exceeds a threshold (bulk load)
  + land inside `LineView` so grouped views inherit it - [[line-view]] is a hard prerequisite, not a coordination question
+ out of scope
  + virtualizing document view (different scroll model; follow-up once LineView ships)
+ acceptance criteria
  + 200-file board: mounted cards <= visible + overscan (assert via DOM count in the harness); folder-200 settled load <= 8s prod with prior stories landed
  + card click and selectionChanged on the 200-file board <= 200ms with no long task > 100ms
  + all kanban drag playwright specs green, including cross-column drags of cards that start off-screen (add spec)
  + keyboard navigation + focused-card scroll framing specs green (focus ring fully visible per CODING_STANDARDS)
  + kanban-animation specs green with FLIP scoped to visible cards; bulk-load renders skip animation (assert via animation probe events)
+ [ ] implement windowed lanes inside `LineView` per the dnd virtual pattern (after [[line-view]])
+ [ ] wire scroll-to-focus + keyboard nav through the virtualizer
+ [ ] scope FLIP to mounted cards + bulk-change skip; keep animation probe coverage
+ [ ] add off-screen drag + DOM-bound assertions to playwright; ratchet perf budgets


### Webview state persistence diet [](?id=webview-state-persistence-diet)

`useVscodeStatePersistence` calls `vscode.setState({docs, viewStates})` on every docs change (`usePersistedViewStates.ts:78-82`), serializing the full docs map - text plus mdast at 6.2x text size - once per incoming message. On a 200-file load that is ~200 serializations of a growing multi-MB object; profiles show setItem/setState at 2-3% even in the mock, and the real VS Code setState crosses an IPC boundary. It is also a memory-pressure contributor to the observed renderer crashes (docs map + persisted copy + NoteProps trees).

+ goal
  + setState payloads become small and infrequent; reload still restores the board without a blank flash
+ background
  + reload already re-requests state: the webview replays setIntegration + requestInitialState on mount (`useVscodeMessages.ts:330-368`), and the extension's discovery fast-path skips reloading unchanged files via mtime (`PanelSession.ts:839`)
+ scope
  + persist viewStates always; persist doc METADATA only (id, path, relative_path, hash, mtime) instead of full text + mdast
  + debounce persistence (e.g. 500ms trailing) and flush on visibilitychange/dispose
  + reload path: render from re-requested extension state; verify the folder restore flow needs no persisted doc bodies (fast-path makes this cheap)
  + migrate old persisted shapes via migrateSavedState (vscodeops.ts) so stale full-doc states load cleanly once then shrink
+ acceptance criteria
  + setState payload per persist <= 100KB on the 200-file board (probe in harness mock)
  + persist frequency during a 200-file load <= 5 calls (debounced), not ~200
  + reload of a folder-mode board restores columns/cards without error and without a persisted-docs dependency (playwright reload spec)
  + `pnpm run check` green
+ [ ] slim the persisted shape to metadata + viewStates with migration
+ [ ] debounce persist + flush on hide/dispose
+ [ ] add payload-size + frequency probes and a folder reload spec


### Folder wire-payload diet (no mdast over the wire) [](?id=folder-wire-payload-diet)

Every Doc ships `text` plus the full mdast `content` (6.2x text) through postMessage (`PanelSession.ts:178,912`): a 200-file folder load transfers ~9.3MB, a single 400KB done.md re-send ~2.6MB, and serialization blocks both the extension host and the webview realms. The webview then derives its own NoteProps hierarchy anyway and caps each file at maxNotesPerFile=10 stories - most of the shipped tree is discarded. Design-first story: pick and prove one of the two payload shapes below, then implement.

+ goal
  + folder-mode wire payload per file scales with what the board renders (capped stories), not file size; memory footprint stops duplicating full mdast per doc
  + unlocks raising MAX_AGGREGATE_FILES (today 200, workspace has ~601 files) and file-level lazy loading
+ constraint from [[group-by-enumeration]] - whichever option wins
  + group-by candidates are enumerated from `note.linetags`, so the wire shape MUST preserve every linetag on whatever it ships
  + option A is the exposed one: a digest that drops or summarises linetags silently shrinks the group-by selector's options
  + option B is safe by construction - the webview parses the text itself, so every linetag survives
+ option A - ship digests
  + extension converts to hierarchy + applies the per-file story cap host-side, ships only capped story subtrees (NoteProps + the text slices those stories cover, with source offsets preserved in origin.source_position)
  + conversion code is pure TS in notethink-views; the extension bundle can import it (verify webpack config supports the cross-package import; the mirrored-constants exception in CODING_STANDARDS documents why modules are not currently shared - this import goes the allowed direction, webview package -> extension consumer)
  + edits still route by source offsets, so buildKanbanDragEndPayload and editText flows are unchanged
+ option B - ship text only
  + drop `content` from the wire Doc; the webview parses text in a Web Worker (workers in webviews load via blob: URI per the VS Code webview docs) and feeds the existing convertMdastToNoteHierarchy path
  + keeps one parser location but moves parse cost into the webview; combine with [[kanban-incremental-merge]] caching so each file parses once per hash
+ scope
  + spike both options against the perf harness long-files scenario (50 files with 10x400KB); pick by measured payload, settle time, and memory; record the decision in this story
  + implement the winner behind the existing message validation; update playwright helpers (inject-docs/inject-multi-docs build wire docs) and fixtures accordingly
  + document view (current_file mode) keeps full text + mdast for the active doc - only folder aggregation goes on the diet
+ acceptance criteria
  + wire payload for one 400KB file's folder update <= 100KB (measure serialized message size in the harness)
  + folder-50-with-long-files scenario: settled <= 6s prod (baseline 40s dev / to-be-measured prod); no renderer crash at 200 files under the harness memory probe
  + drag write-back, click-to-editor reveal, and caret matching still work in folder mode (existing folder specs + drag roundtrip specs green)
  + `pnpm run check` green
+ [ ] spike option A vs B on the harness; record numbers + decision here
+ [ ] implement the chosen shape end-to-end (PanelSession, Messages types, useVscodeMessages, composers, playwright helpers)
+ [ ] add payload-size + memory probes; ratchet budgets and raise-cap follow-up note


### Extension parse offload and adaptive debounce [](?id=extension-parse-offload)

mdast parse costs 0.6ms/KB on the extension host: each debounced keystroke on a 400KB done.md re-parses for 230ms (800KB: 509ms) on the same web worker that services every other extension request, and initial folder discovery parses up to 200 files inline (620ms for 200x8KB, several seconds with real done.md sizes). The web extension host supports spawning nested Web Workers (VS Code web-extensions guide), which is the safe first step; a WASM parser (markdown-rs, micromark's Rust sibling, via the @vscode/wasm toolchain) is the escalation if parse itself remains the bottleneck after offload.

+ goal
  + typing in a large file never saturates the extension host; parse work happens off the host thread and only the final result crosses back
+ scope
  + move parse() calls (buildDoc / buildDocFromUriAndText / loadFolderDoc paths in PanelSession) onto a worker pool (size ~cores/2, bounded queue); results post back as the existing Doc shape
  + adaptive debounce: scale CHANGE_DEBOUNCE_MS (PanelSession.ts:13) with the last parse duration for that doc (floor 250ms, cap ~1s) so big files self-throttle
  + drop stale parses: a newer edit for the same doc cancels the queued/in-flight older parse
  + verify worker creation works in both desktop (webWorker extension host) and vscode-test-web; feature-detect and fall back inline if Worker is unavailable
+ out of scope
  + WASM parser swap - leave a spike task with clear go/no-go criteria instead of committing to it
+ acceptance criteria
  + extension jest: worker pool parses and returns identical mdast to inline parse for fixture corpus; stale-parse cancellation covered
  + keystroke scenario: webview receives the re-send and the extension host stays responsive - measure by interleaving a settings round-trip during a 400KB keystroke storm in the harness (round-trip latency <= 100ms)
  + folder discovery of the long-files scenario does not block watcher/selection handling (same interleaving probe)
  + `pnpm run check` green including the extension Mocha suite
+ [ ] implement the parse worker pool with fallback + stale cancellation
+ [ ] make the change debounce adaptive to measured parse cost
+ [ ] add the host-responsiveness interleaving probe to the perf harness
+ [ ] write the markdown-rs/WASM spike task with go/no-go criteria (mdast position-compatibility, payload parity, measured speedup >= 3x) as a follow-up candidate for the user to green-light


### Multi-view management [post-v1]

+ goal
  + notegit supports split views (parent_view/child_views), view hierarchy, and a ViewManager
  + NoteThink currently has a single GenericView entry point per document
  + multi-view would allow side-by-side document+kanban or document+mermaid
+ [ ] implement ViewManager component
  + manages array of ViewProps with unique IDs
  + handles setViewManagedState, deleteViewFromManagedState, revertAllViewsToDefaultState
  + stores view state in webview state API
+ [ ] implement split view UI
  + allow adding a child view alongside the current view
  + drag handle or button to resize split
+ [ ] wire parent_view/child_views relationships
  + child views inherit display_options from parent
  + breadcrumb navigation affects the correct view in the hierarchy


### Convert top-level 'docs' container to RootNote [post-v1]

+ goal
  + should be possible to render any MDAST node
    + including one that contains a bunch of files
  + will eventually have dynamic collections
+ depends on notethink-views being wired in (done)
  + RootNote would be a ViewProps with child_views per document
+ [ ] define RootNote as a synthetic MDAST-like node in the extension
  + type: 'root', children: array of document MdastRoot nodes
  + send as single structure instead of flat HashMap
+ [ ] render RootNote via DocumentView with child_views
  + each child_view represents one document
  + parent_context and breadcrumb_trail for navigation


### Optimisation review 2026-07 for notethink

Systemic findings from a deep multi-agent optimisation review (scout + 5 dimension reviewers + synthesis + per-item adversarial verification against the code, 2026-07). The review independently converged on the existing kanban perf cycle and verified its premises at specific sites; the tasks below are the additional findings not already scoped there.

+ verified and already scoped in the perf cycle - no duplicate tasks here, evidence recorded for confidence
  + per-doc conversion caching keyed on (id, hash): confirmed missing in folder mode (single-file NoteTreeComposer already memoises on hash; folder merge and useAutoIntegration both re-convert) - covered by [[kanban-incremental-merge]]
  + folder-entry message storm: confirmed per-file posts then a whole-map aggregate re-post (double-ship), no batching on the host side - covered by [[kanban-folder-load-coalescing]]
  + full-corpus setState per edit tick incl. mdast: confirmed synchronous, undebounced - covered by [[webview-state-persistence-diet]]; small delta: also release the module-scope saved_state pin (ExtensionReceiver.tsx:22) after first consumption to free the restored corpus

+ [ ] Restore webview code splitting: drop LimitChunkCountPlugin and switch chunk loading to browser-style
  + the single-bundle constraint applies to the extension host only; the webview config also declares target 'webworker' (webpack.config.js:111), so set target 'web' or output.chunkLoading 'jsonp' for the webview config alongside removing the plugin (webpack.config.js:164)
  + React.lazy splitting is already written but collapsed: GenericView lazy-loads the views and GenericNote lazy-loads MermaidNote (mermaid's static import lives only inside that lazy subtree); built dist/index.js is currently 11.9MB dev
  + set __webpack_public_path__ from asWebviewUri and __webpack_nonce__ so injected chunk script tags pass the CSP (notethinkEditor.ts:83); the extension-host config's LimitChunkCountPlugin (webpack.config.js:76) must stay
  + retainContextWhenHidden (notethinkEditor.ts:16) means every hidden tab keeps the whole parsed bundle resident today
  + refs: webpack.config.js:164, webpack.config.js:111, client/webview/src/notethink-views/src/components/views/GenericView.tsx:15, client/webview/src/notethink-views/src/components/notes/GenericNote.tsx:11, client/extension/src/vscode/notethinkEditor.ts:16
  + impact: multi-MB less JS fetched and parsed on every panel open; users who never render a diagram stop paying for mermaid entirely; effort: M

+ [ ] Cut extension-host startup and vsix weight: trim activation events and replace winston with the native LogOutputChannel
  + activationEvents include onStartupFinished and onLanguage:markdown, but activate() only registers the custom editor, a webview serializer and commands - onCustomEditor/onWebviewPanel suffice, so the 666KB bundle currently loads in every VS Code window for nothing
  + winston wraps an output channel created with {log:true} that natively provides levels and timestamps (file logging is separately hand-rolled via workspace.fs); deleting winston removes 11 root polyfill deps and the webpack resolve.fallback list
  + vscode-languageclient 9.0.1 is declared with zero usages (grep-verified); drop it
  + .vscodeignore's 'dist/**/test/**' is anchored at the package root and does not match client/extension/dist/test/**, so a 361KB dead mocha bundle ships in every marketplace vsix - fix the glob
  + refs: package.json:31, client/extension/src/lib/errorops.ts:94, webpack.config.js:46, .vscodeignore:7
  + impact: zero startup cost until first NoteThink use and a 70-80% smaller extension bundle for every install; effort: M

+ [ ] Hoist stable handler and display_options objects so GenericNote's React.memo stops whole-tree reconciles
  + GenericNote is React.memo with default shallow equality, but KanbanBoard passes fresh display_options and handlers object literals per Draggable render, and buildChildNoteDisplayOptions allocates a new object per call - the memo never passes
  + DocumentView already hoists stable note_handlers via useMemo but still calls buildChildNoteDisplayOptions inline, so its props stay unstable too; useViewContext also rebuilds display_options and sorts in place per render
  + add a custom areEqual on note identity plus focus/selection scalars; derive per-note flags at the view level; complements the stable_id/seq work in [[kanban-incremental-merge]]
  + cheap follow-on: content-visibility:auto on cards to skip offscreen layout until [[kanban-virtualized-columns]] lands
  + refs (client/webview/src/notethink-views/src/): components/notes/GenericNote.tsx:15, components/views/kanban/KanbanBoard.tsx:101, lib/noteui.ts:265, components/views/generic/useViewContext.ts:41
  + impact: caret movement and typing become O(affected notes) instead of O(all notes), attacking the documented 50k-fibers-per-commit crash cliff; effort: M

+ [ ] Hash-gate and visibility-gate PanelSession posts (small delta to [[kanban-folder-load-coalescing]])
  + watcher onDidCreate/onDidChange and sendDoc never compare hash or mtime before re-parsing and re-posting, so every save ships the doc twice
  + no webviewPanel.visible check gates background work anywhere in PanelSession - hidden and duplicate panels run the full pipeline
  + fold into the coalescing story when picked up, or land as a small standalone
  + refs: client/extension/src/vscode/PanelSession.ts:964, client/extension/src/vscode/PanelSession.ts:166
  + impact: eliminates redundant parse and post work on every save and for hidden panels; effort: S


### Make the mocha web-extension suite runnable [](?id=mocha-web-suite-runnable)

`client/extension/src/test/suite/` is a real suite that no script runs and that cannot currently produce a
result. It is excluded from `jest.config.cjs`, so nothing in `pnpm run check` touches it, and the tests in
it are edited by hand whenever a command is retired without anyone finding out whether they still pass.

+ background - measured 2026-09-07, driving it by hand
  + the runner is a WEB extension suite: `require('mocha/mocha')` plus `require.context`, so it runs under `@vscode/test-web`, which is already a devDependency and already builds as a webpack entry to `client/extension/dist/test/suite/index.js`
  + the invocation is `vscode-test-web --browserType=chromium --headless --port=<free> --extensionDevelopmentPath=. --extensionTestsPath=./client/extension/dist/test/suite/index.js ./docstech`
  + it fails with `ReferenceError: document is not defined` inside `new HTML` before any test runs: `mocha.setup({ reporter: undefined })` leaves mocha's browser default, the HTML reporter, which builds a fragment through `document` - and an extension host is a worker
  + naming a built-in reporter by string does not fix it, because the browser bundle resolves an unknown name through `require`, which webpack cannot serve inside the bundle it just built; a reporter FUNCTION does clear the crash
  + the host drives `mocha.run` itself as soon as the mocha global exists, and does not wait for the exported `run()` - measured by placing a `throw` first inside `run()`, which never fired while the reporter's ReferenceError did
  + so setting the reporter inside `run()` is too late; setting it at module scope clears the crash and the run then HANGS instead, because the tests are registered by an `importAll` that only `run()` reaches
  + extension-host `console` output is not forwarded to the terminal, so a console-printing reporter reports nothing; the exit code is the only channel that currently carries a result
+ [ ] settle who drives the run - register the tests at module scope, or stop the host driving mocha itself
+ [ ] supply a worker-safe reporter function, since the HTML default cannot work in an extension host
+ [ ] add a `test-mocha` script and put it in `pnpm run check`
+ [ ] confirm the suite actually passes, and fix whatever it finds - it has never been run, so it has never been green
+ acceptance criteria
  + `pnpm run test-mocha` exits non-zero on a deliberately broken assertion and zero otherwise
  + a retired command breaks the suite rather than being quietly edited out of it
