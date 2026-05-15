# Todo [](?ng_view=kanban)


### Publish NoteThink 0.1.x to marketplace [](?status=doing&id=publish-notethink-0-1-x)

Publisher created (`NoteThink`, notethink.com verified). Extension rebranded off the old `ZoomBuzz` identity, final logo shipped. Only the credentialed `vsce publish` is left for the user.

+ [X] rebrand publisher to NoteThink
  + root package.json: publisher/author → NoteThink, homepage → https://notethink.com
  + viewType `zoombuzz.notethink` → `notethink.notethink`; extension ID is now `NoteThink.notethink`
  + updated notethinkEditor.ts, both mocha suites, client/extension sub-package
  + repo/bugs URLs left at the real remote (github.com/zoombuzz/notethink) — GitHub org not renamed
+ [X] create NoteThink marketplace publisher
  + done by user; not the One Partner account used by other projects
+ [X] add placeholder extension icon
  + `media/icon.png` (256×256) wired via package.json `"icon"`
  + SVG source in docstech/design/logos/, multi-res renders gitignored
+ [X] commission the real logo
  + final mark in docstech/design/logos/notethink-icon.svg; `media/icon.png` re-rendered; drafts archived in variants/
+ [ ] publish to marketplace
  + PAT provisioned as `$TF_VAR_notethink_vsce_alex_publishonly_pat` (puppet-managed ~/.bash_envvars; eyaml `general::notethink::vsce::alex_publishonly_pat`, Marketplace>Manage scope)
  + run `pnpm run publish:marketplace` — non-interactive, bridges the env var to VSCE_PAT, no `vsce login` prompt
+ manual: install the .vsix locally, exercise edge cases — special/unicode paths, 100+ markdown workspace perf, no devtools console errors
+ manual: after publishing, verify the listing renders — icon, README, repo/homepage links


### Continue to refine directory experience

+ [ ] rename "Directory" option as "Folder"
  + this is much more consistent with VSCode's native interface
+ [ ] improve filters


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
