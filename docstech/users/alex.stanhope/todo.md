# Todo [](?nt_view=kanban)


### Evaluate AgentChevron as a duplicate expand control [](?id=agent-chevron-duplicate-eval)

Question: is `AgentChevron` (`client/webview/src/notethink-views/src/components/notes/agent/AgentChevron.tsx`) a duplicate of another expand or collapse control that is worth refactoring, to reduce technical debt and make the code more readable?

+ known: 8042cc4 (agent tree) added `AgentChevron.tsx`
+ suspected: other expand or collapse controls in the webview may already do the same job under another name; nothing has searched for them yet
+ [ ] Search the webview for existing chevron, caret, disclosure or expand controls and compare each with `AgentChevron` (`git log` on each)
+ [ ] Record a verdict with `file:line` evidence: a duplicate worth refactoring, or different enough to keep, and why
+ [ ] If it is worth refactoring, file the refactor as its own story at the top of this board, with a `builds on` line naming the component to keep


### Write a story evaluating a possible duplicate chevron [](?id=duplicate-eval-agent-chevron&status=code-review)

Wanted: to know whether `AgentChevron` is a good example of duplicated functionality that should be refactored, to reduce technical debt and make the code more readable. A read-only sweep for duplicated entities across the codebase (2026-11-06) classed it as unclear, worth a second look.

+ known: 8042cc4 (agent tree) added `client/webview/src/notethink-views/src/components/notes/agent/AgentChevron.tsx`
+ suspected: other expand or collapse controls in the webview may already do the same job under another name; the sweep did not search for them
+ decision 2026-11-06 (operator): write a story that evaluates this; this story only files it
+ [X] write the evaluation story at the top of this board, following `standards/STORY_STANDARDS.md`, with tasks to:
    + filed as [[agent-chevron-duplicate-eval]]
    + search the webview for existing chevron, caret, disclosure or expand controls and compare each with `AgentChevron` (`git log` on each)
    + record a verdict with `file:line` evidence: a duplicate worth refactoring, or different enough to keep, and why
    + if it is worth refactoring, file the refactor as its own story at the top of this board, with a `builds on` line naming the component to keep


### Clear focus with an editor open [](?id=clear-focus-editor-hold&status=code-review)

With a text editor open on the file, a click on the board background (or empty toolbar space) does not clear focus: the next story lights up instead. The clear moves the editor caret to the focused story's end + 1, which is the start of the next story, and with an editor open the editor caret always decides the focused card.

+ background
  + `getClearHandler` (`useViewHandlers.ts`) clears the view-driven ids and view_caret, then posts `revealRange` at `deepest_note_end + 1`
  + `useViewContext.ts` derives `editor_derived_match` from `props.selection`, and `resolveFocusedNote` (`noteops.ts`) returns it ahead of everything else, so any caret inside a story focuses that story
  + read in `PanelSession.ts`: `sendCurrentSelection` runs after every debounced document change, file-watcher reload, visible-editor change and initial-state request, so the webview sees the same selection more than once with no caret move
+ decision 2026-11-06 (operator): hold the clear until the editor caret moves, rather than parking the caret above the first story
  + parking the caret scrolls the editor to the top and loses the user's place, has no spot to go in a file that starts with a story, and needs a folder-board lookup fix
  + the hold leaves the editor alone and behaves the same for every file layout and both board modes
+ builds on: the clear path in `getClearHandler` and the editor-derived match in `useViewContext.ts`; extend them, no second focus path
+ approach
  + the clear stops posting `revealRange`; the editor caret stays where it is
  + the clear records the editor selection it happened at (active doc path, head and anchor) in webview state that is not persisted with the panel
  + while the incoming editor selection still equals that record, `editor_derived_match` is suppressed, so no card is focused
  + a resent identical selection keeps the hold; any different selection, a different active doc, or an edit releases it and focus follows the editor again
  + with no editor open nothing changes: the clear already leaves no focused card
+ [X] Drop the `revealRange` post from the background clear, which the toolbar clear shares
  + `getClearHandler` in `useViewHandlers.ts` posts nothing; Jest asserts no post
+ [X] Record the selection at the moment of the clear and suppress the editor-derived match while it is unchanged
  + `editor_hold_ref` in `useViewContext.ts` is set by the clear, and `editor_derived_match` and the range selection are skipped while it applies
+ [X] Release the hold on a different selection, a different active doc or an edit, and keep it across a resent identical selection
  + `editorHoldApplies` in `viewstateops.ts` compares head, anchor, doc path and doc text; a focus click or keyboard move also drops it
+ [X] Keep the hold out of the persisted view state, so a restored panel follows the editor caret
  + the hold is a ref, never written to view state, so `migrateSavedState` and the persisted shape are untouched
+ [X] Update the `getClearHandler` Jest assertions that expect the `revealRange` post
  + `useViewHandlers.test.ts` and `GenericView.test.tsx` now assert no `revealRange`
+ [X] Add Jest cases for the hold, its survival across a resent selection and each release
  + `useViewContext.test.ts` 'clear hold with an editor open' and `viewstateops.test.ts` 'editor hold'
+ [X] Add a Playwright spec with an editor caret in a story: click the background, assert no card is focused, move the caret, assert focus returns
  + `clear-focus-background.spec.ts` last test
+ [X] Bump the patch version
  + 0.4.26
+ new pattern: a view-side clear that suppresses an editor-driven state until the editor next moves


### Antigravity monogram on the agent activity card [](?id=activity-vendor-antigravity&status=code-review)

Give Antigravity CLI an explicit vendor entry with monogram AG, so the agent activity card shows the same two-letter codes as other tools that label agents (CC, CO, GR, AG). Today an unlisted slug falls back through `vendorMonogram`, which would draw antigravity as AN.

+ [X] Add an `ACTIVITY_VENDOR_ANTIGRAVITY` slug (`antigravity`) and an `ACTIVITY_VENDOR_DISPLAY` entry: monogram AG, label Antigravity, a `vscode-charts` colour not already taken (purple, blue and yellow are in use)
  + colour is `--vscode-charts-green` (fallback #89d185), types/AgentActivity.ts
+ [X] Add it to `ACTIVITY_KNOWN_VENDORS` only if that list means displayable rather than detected, and record which it means
  + it means detected: its comment says the vendors read today and nothing else references it, so antigravity is left out
+ [X] Make the change in both mirrored files, `client/webview/src/notethink-views/src/types/AgentActivity.ts` and `client/extension/src/types/AgentActivity.ts`, keeping them byte-identical apart from the header cross-reference
  + diff of the two files shows only the header cross-reference line
+ [X] Cover the new entry in the Jest tests for the display table or `vendorMonogram`
  + agentactivityops.test.ts: vendorMonogram, vendorLabel and vendorColour cases for antigravity
+ scope: display entry only; the analyser does not read Antigravity session files, and this story does not add that


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


### Watcher applies dependency and config changes [](?id=watch-restarts-on-config)

`pnpm run watch` recompiles on source changes, including those a `git pull` lands. A pull that changes a `package.json`, a `pnpm-lock.yaml`, `webpack.config.js` or a `tsconfig*.json` is not applied: the bundles keep building against stale config or modules until someone restarts the watcher by hand.

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


### Single-file kanban falls back to document view [](?id=single-file-kanban-auto-view)

Opening a file tagged `[](?nt_view=kanban)` through NoteThink: Open Viewer draws a flat document instead of a board whenever the workspace holds other files. View settings resolve to "Auto (Document)" and no columns render.

+ background
  + measured in vscode-test-web, 2026-09-25: the file alone in its workspace resolves "Auto (Kanban)" with 2 columns and 7 cards; the same file among four sibling files resolves "Auto (Document)" with none
  + identical at ee0626c and on the current tree, so it predates the performance work
  + the Playwright specs miss it because they inject `selectionChanged` directly instead of going through the real open-viewer path
  + inferred, untested: the default "Watch unopened files in viewer" setting may let sibling files outvote the active file's own `nt_view` during auto-resolution
+ [ ] find where auto-resolution picks the view type in current-file mode and why sibling files change it
+ [ ] make a current-file open honour the active file's `nt_view`
+ [ ] add a spec that opens a file through the real open-viewer path in a multi-file workspace and asserts kanban columns render


### Spike a WASM markdown parser in the parse worker [](?id=wasm-parser-spike)

Decide go or no-go on replacing `mdast-util-from-markdown` in `ParseWorker.ts` with markdown-rs compiled to WASM (via @vscode/wasm). The worker pool from [[extension-parse-offload]] already keeps parsing off the host thread, so this spike is only about raw parse speed. The hot-path survey ([[hot-path-survey]]) leans no-go: the mdast tree has to be rebuilt as JS objects on the way back, which may eat the gain.

+ go/no-go criteria, all three must hold
  + position compatibility: `position.start` / `position.end` line, column and offset on every node type `convertMdastToNoteHierarchy` and origin tracking read, on the parseops fixture corpus
  + payload parity: 400KB and 800KB done.md-shaped fixtures render identically through both parsers, with no dropped linetags or stable_ids
  + speedup of at least 3x in wall-clock parse time, worker to worker, including rebuilding the JS mdast
+ scope
  + a throwaway `ParseWorker.ts` variant or a `scripts/perf/` script, never wired into the shipped extension before the decision
+ [ ] build the WASM parse path and measure all three criteria on the same fixtures
+ [ ] record the numbers and the go or no-go decision here, before any implementation task is filed


### Latest folder scan wins [](?id=latest-folder-scan-wins)

Typing a new Include filter can leave the board and the Files drawer showing the result of an older, partial pattern. On 2026-09-25, in a workspace of about 2200 markdown files, `**/{todo,done}.md` showed `(0 in 0 files)` while 22 files on disk match it.

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
