# Todo [](?nt_view=kanban)


### Draw unbound agents only beside their own repository [](?id=agent-unbound-repo-scope&status=doing)

Opening one repository's todo.md with the agent card, in a workspace rooted above several repositories, draws a card for every unbound agent session in the workspace: one "grok in calfam" card per session, ahead of the file's own stories, all in one Untagged group.

+ background
  + measured in code: `useAdmittedViewProps` admits `virtualNotesForActivity(activity)` for the whole snapshot whenever the card is the agent card (`useGenericView.ts:67-77`)
  + measured in code: `virtualNotesForActivity` mints one note per unbound session, with no filter (`agentactivityops.ts:371`)
  + measured in code: workspace scope drops only sessions outside every workspace folder, so a parent-folder workspace keeps every repository's sessions (`AgentAnalyser.ts` `foldBatch`)
  + measured in code: the snapshot carries one tree per repository the git extension reports, and a session's `root_path` is resolved against the same set (`AgentAnalyser.ts:1139`, `:1578-1582`)
  + measured in code: `treeForDocPath` already maps a workspace-relative document path to its repository's tree (`agentactivityops.ts:258`)
  + measured in code: a virtual note's origin has no `relative_path`, so the project axis puts every one in Untagged (`virtualnoteops.ts:104`, `noteops.ts:573`)
  + measured in code: single-file notes carry no origin at all, so on the project axis a single file's stories are Untagged too (`NoteTreeComposer.tsx:22`)
  + no PATTERNS.md entry; design freely
+ approach
  + the viewed repositories are the trees of every viewed document path: each note's `origin.relative_path`, plus the view's `doc_relative_path`
  + an unbound session is admitted only when its `root_path` is one of them
  + a document outside every repository admits only sessions outside every repository
  + a virtual note's origin takes its repository's `root_relative` as `relative_path` when the view's own notes carry relative paths, so it joins its project's lane
  + in a single-file view no note carries one, so a virtual note stays in the same lane as the file's stories
+ [X] admit only unbound sessions from the viewed documents' repositories
  + `viewedActivityScope` and a scoped `virtualNotesForActivity` in `agentactivityops.ts`, called from `useAdmittedViewProps`
+ [X] give a virtual note its repository's relative path when the view's notes carry relative paths
  + `VirtualNoteSpec.relative_path`, stamped on the origin by `makeVirtualNote`
+ [X] cover with Jest: two repositories with unbound sessions, a single-file view of one, a folder view of both, and a document outside every repository
  + `agentactivityops.test.ts` "drawing unbound agents only beside their own repository", including a workspace folder that is the repository
+ [X] cover with a Playwright spec: an unbound session from another repository does not draw on a single-file board
  + `agent-card.spec.ts`; the declared-path spec now also expects no card for a session whose repository holds no viewed document
+ [ ] verify in VS Code on a parent-folder workspace that a repository's todo.md draws only that repository's unbound sessions
+ [X] bump the patch version


### Order groups automatically or by hand [](?id=group-order-modes&status=doing)

A board grouped by project lists its groups alphabetically, or in an order dragged by hand. When agents are busy across several projects, the group worth looking at is the one an agent touched last, so a board should be able to order its groups by recent agent activity and keep that order current as agents work.

+ background
  + measured in code: lane order is the saved `groupDisplay` order, then any unsaved lane alphabetically, Untagged last (`useKanbanColumns.ts:50-75`, `noteops.ts:505`)
  + measured in code: `groupDisplay` stores a literal order per axis and has no slot for a mode (`settings.ts:70-74`, `noteops.ts:538-556`)
  + measured in code: lanes are reordered by dragging chips in the view settings drawer's Group display row (`SettingsViewDrawer.tsx:167-224`)
  + measured in code: a saved view type can hold its own value for any cascade key, and a drawer edit to a key it holds is written into the type (`viewregistryops.ts:429-449`)
  + measured in code: a story card's sessions come from `sessionsForStory`, and a virtual note's from its unbound key (`agentactivityops.ts:296`, `:345`)
  + no PATTERNS.md entry; design freely
+ approach
  + one select beside Group display chooses the lane order: custom, or one of several automatic orders
  + custom is today's behaviour, and the default
  + newest last and newest first order groups by the latest ordering timestamp of any card in the group, ties alphabetical
  + the card type defines a card's ordering timestamp, so the view never names agents and view and card type stay independent
    + agent card: when an agent last wrote to the card
    + default card, and any card type that defines none: when the file holding the story last changed (`file_mtime`)
  + newest last runs time left to right: groups with no timestamp first, alphabetically, then oldest to newest, so the group last touched is rightmost
  + newest first runs newest to oldest, then groups with no timestamp, alphabetically
  + Untagged stays last in every order
  + the order recomputes on every render, so groups move as agents work and files change
  + hiding a lane keeps working in every order
+ decisions
  + the key is `groupOrder` at `view.specific.grouped.groupOrder`, values `custom`, `newestFirst`, `newestLast`, `alphabetical`, `cardCount`, default `custom`, signed off
  + Group display and Group order home at the Grouped node, one value shared by Line and Kanban; Group by keeps Kanban's own value, so Kanban still defaults to status
  + Group display moves to `view.specific.grouped.groupDisplay` with no fallback read of the old kanban path, signed off
  + dragging a chip while an automatic order is selected switches to custom, seeded with the order on screen
+ [X] add the lane order setting with its settings contribution and l10n strings
  + homed at the `kanban` node beside `groupDisplay`, so a saved view type can hold its own order; the drawer labels it "Lane order"
+ [X] compute each automatic order from the lanes and the activity snapshot
  + `orderGroupValues` in `lib/grouporderops.ts`; custom reuses `mergeSavedGroupDisplay`, so it is unchanged
+ [X] draw lanes, and the Group display chips, in the chosen order
  + `LineView` and `GroupDisplayControl` both call `orderGroupValues`; a drag that sets both keys on one saved type is one write
+ [X] cover with Jest: each order, ties, lanes without activity, Untagged last, and a saved view type holding its own order
  + `grouporderops.test.ts`, and `SettingsViewDrawer.test.tsx` for the select, chip order and the combined and split writes
+ [X] cover with a Playwright spec: choosing agent activity reorders a project board, and new activity moves its lane first
  + `view-settings-drawer.spec.ts`, plus a chip drag in an automatic order switching to Custom
+ [X] label the setting "Group order", matching Group by and Group display
  + every other setting and the code call the thing a group, and so does everything a user reads (`CODING_STANDARDS.md` > Naming Conventions)
  + `settingRowLabel` in `settingRows.ts`, nls descriptions, README and all five l10n bundles
+ [X] replace the agent activity order with newest first and newest last, taking each card's ordering timestamp from its card type
  + `orderGroupValues` takes a plain note-to-timestamp function; `orderTimestampFnFor` in `cardregistryops.ts` gives the agent card its activity and every other type `file_mtime`
  + the board and the drawer's chips resolve the card type the way `GenericNote` does, so the order follows the card on screen
+ [X] home Group display and Group order at the Grouped node, stored under `view.specific.grouped.*`
  + kanban's open overrides for both removed; Kanban keeps its fixed status axis and its own Group by
  + an edit to either from a Kanban board now offers to save a new view type, as Group by already did
+ [X] list only groups present in the notes in the Group display chips, keeping stored entries for absent groups
  + `splitGroupDisplayByPresence` and `recombineGroupDisplay` in `noteops.ts`, used by `LineView` and `GroupDisplayControl`
  + measured in code: `mergeSavedGroupDisplay` keeps every stored entry (`noteops.ts:526`), and nothing ever writes `groupDisplay` when a group appears or disappears, so a deleted project folder keeps its chip
  + measured in code: the board draws only groups that hold cards (`LineView.tsx:113-115`), so a stale group shows as a chip, never on the board
  + absent entries stay stored because the value is shared by every board on that axis, and a group can be absent only transiently (single-file view, filter, folder discovery streaming in)
+ [X] rule a thin line in the view settings drawer wherever the owning view changes, so each view's settings read as a band
  + `settingsOwnerDivider` in `SettingsPane`; Jest in `SettingsViewDrawer.test.tsx`; seen rendered in the Playwright harness between the Kanban, Line, Grouped and All views bands
+ [X] animate a group to its new position whenever the group order changes, the same way cards animate when they move
  + every cause alike: a newest first or newest last order recomputing, a chip dragged in Group display, a group appearing or disappearing
  + so a board ordered by recency shows groups moving about as activity happens, as a status board shows cards moving
  + `playColumnMove` in `useFlipTransition.ts`: a group slides as one box, and a card measured relative to its group animates only if it moved within or between groups
  + the card bulk guard counts only genuine card moves, so a reorder on a busy board still animates
  + Jest in `useFlipTransition.test.tsx`; Playwright in `kanban-animation.spec.ts`, passed in the full run
+ [ ] verify in VS Code on a project board under newest last that the group an agent last touched is rightmost, before Untagged
+ [X] bump the patch version


### Open a session's own chat from its card [](?id=agent-session-open-chat&status=doing)

Clicking a Claude Code session on an agent card opens a Claude chat tab, but not that session's conversation.

+ background
  + measured in code: a Claude Code session runs `claude-vscode.editor.open` with the session id alone (`ActivityCommands.ts:24`, `:169`)
  + the transcript fallback (`openTranscript`, `:181`) runs only when the command throws, and the command does not throw for an unknown id
  + read from the Claude Code extension's bundle: the command's third argument is an editor column, and it starts its chat process with `--resume <id>`
  + measured: the folder a session started in does not stop it resuming
    + the CLI's `--resume <id>` run from an unrelated folder resumed a session started elsewhere and appended to its transcript
    + the extension's own resumable check looks under the first workspace folder's project directory, then searches every project directory for the id
  + measured: the chat panel then looks the id up in its own session list, which covers only the first workspace folder's project directory
    + an id missing from that list starts a blank chat instead; the extension's log shows the launch with no session id to resume
    + so a session started in a subfolder, or outside the workspace, cannot open its own chat
  + depends on [[activity-open-target-group]] for the column
+ approach
  + settle first which sessions the command resumes
  + a session that resumes opens its chat in the group [[activity-open-target-group]] picks
  + a session that cannot resume opens its transcript in that group instead
+ [X] find which sessions `claude-vscode.editor.open` resumes: one started in the workspace root, one in a subfolder, one outside the workspace
  + only a session filed under the first workspace folder's project directory opens its own chat, per the background above
+ [X] pass the target column as the command's third argument
+ [X] open the transcript instead for a session the command cannot resume
  + `sessionListsWorkspaceRoot` in `ActivityCommands.ts`; a command that throws also falls back to the transcript
  + the transcript opens through the URI the analyser read it from (`transcriptUriFor`), so in a Remote-SSH window it opens on the remote host rather than failing on the local disk
  + a symlinked first workspace folder is compared by its own path, not resolved; the panel resolves it
+ [X] cover the choice between chat and transcript with Jest
  + `ActivityCommands.test.ts`, including a multi-root workspace whose board sits in the second folder
+ [ ] verify in VS Code that a resumable session shows its conversation and an unresumable one its transcript, both in group 2
+ [X] bump the patch version


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
