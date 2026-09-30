# Todo [](?nt_view=kanban)


### Publish NoteThink to Open VSX [](?id=open-vsx-publish)

Editors built on Open VSX (VSCodium, Cursor, Gitpod and others) cannot find NoteThink: the Open VSX API answers "Extension not found: NoteThink.notethink".

+ split out of [[marketplace-findability]] by operator decision 2026-09-30
+ the token placeholder `general::notethink::ovsx::alex_publishonly_pat` (`TF_VAR_notethink_ovsx_alex_publishonly_pat`) is staged, uncommitted, in lightenna-iac's `secrets.eyaml` and `devdesktop-envvars.yaml`, beside the vsce PAT
+ [ ] [](?work=manual) create an Open VSX access token on the account that owns the `NoteThink` namespace, paste it into the staged slot during `eyaml edit`, commit, and run puppet
+ [ ] add an `ovsx` dev dependency and a `publish:openvsx` script shaped like `publish:marketplace`, reading `TF_VAR_notethink_ovsx_alex_publishonly_pat` by name
+ [ ] claim the `NoteThink` namespace if it is unclaimed, then publish the current packaged `.vsix`, confirming each public write with the operator
+ [ ] confirm the Open VSX API returns the extension and its listing shows the Marketplace README and screenshots


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
