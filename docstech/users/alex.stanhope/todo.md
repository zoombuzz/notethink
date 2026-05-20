# Todo [](?ng_view=kanban)


### Watch unopened files shown in the viewer

In single-file mode, change-handling is wired to `onDidChangeTextDocument` (`notethinkEditor.ts:306`) — fires only for editor-open documents. A file shown in the viewer but with no open text editor (custom editor + on-disk edit by another tool, e.g. Claude's Write) never re-parses. Folder mode already has its own `createFileSystemWatcher` (`notethinkEditor.ts:555`); single-file mode does not.

+ [ ] add a `notethink.watchUnopenedFilesInViewer` boolean configuration to `package.json` `contributes.configuration` (default `true`); add the l10n string + 5 translations
+ [ ] expose it as a checkbox in the Settings drawer (Document + Kanban) alongside the existing `show_line_numbers` global toggle
+ [ ] when the setting is on, register a `vscode.workspace.createFileSystemWatcher` for the active viewed file whenever it isn't backed by an open `TextDocument`; on change/create, re-`buildDoc` and `sendDoc`
+ [ ] dispose the per-file watcher on viewer dispose, on doc swap, and on setting flip (avoid leaks across active-doc changes)
+ [ ] de-dupe with `onDidChangeTextDocument` — if the doc gets opened in an editor while the watcher is live, dispose the watcher to avoid double re-parse
+ [ ] tests: Jest in `notethinkEditor.test.ts` covering watcher attach/detach lifecycle + setting flip; Playwright is N/A (no real fs in harness)
+ manual: open a `.md` in the viewer with no editor split, edit the file from a separate process (or Claude's Write), confirm the viewer re-renders within ~1s


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


### Optimisation cycle [post-v1]

+ create language server
  + communicate to separate thread via LSP
    + add to webpack watch
  + investigated previously, deferred as non-essential for now
  + revisit once delta computation works
+ consider whether parsing (mdast-util-from-markdown) is the bottleneck
  + or whether it's the React re-rendering
  + profile before optimising
