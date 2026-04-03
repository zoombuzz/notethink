# Todo [](?ng_view=kanban)


### Multi-document navigation [](?status=doing)

+ the header bar should always be visible
  + currently when I scroll down, it goes off the top
  + root cause: `.viewToolbar` is `position: static` inside the body scroll container (`body.disableAddressBarHidingOnScroll` has `overflow-y: auto`)
  + toolbar already has opaque `background` — just needs sticky positioning
- [X] make `.viewToolbar` sticky in `ViewRenderer.module.scss`
  + add `position: sticky; top: 0; z-index: 10` to `.viewToolbar`
  + verify toolbar background is opaque (already set via `--vscode-breadcrumb-background`)
- [X] verify in DocumentView and KanbanView
  + scroll long document — toolbar stays pinned
  + scroll kanban with many cards — toolbar stays pinned
  + breadcrumb, view selector, settings gear all still functional
- [ ] add test: toolbar remains visible after scroll (Playwright E2E)


### Insert modal [](?status=doing)

+ goal
  + notegit has a searchable insert modal (~367 lines) with 40+ templates
  + quick way to insert headings, linetags, mermaid diagrams, tables, code blocks
  + this replaces typing boilerplate markdown manually
+ [ ] implement InsertModal component in notethink-views
  + searchable list of insert templates
  + preview of what will be inserted
  + fires postMessage({type: 'editText', changes}) to insert at cursor position
+ [ ] port insert template definitions from notegit
  + start with English templates; i18n can come later
  + categories: basic (heading, paragraph, list, link, image), metadata (linetag), diagram (mermaid), structure (table, code block)
+ [ ] wire insert modal trigger
  + menu bar button and/or keyboard shortcut (Ctrl+I or similar)


### Settings modals

+ goal
  + notegit has per-view settings modals for display preferences
  + NoteThink needs at least kanban settings and global display settings
+ [ ] implement kanban settings modal
  + port from notegit's SettingsKanbanModal (~61 lines)
  + column definitions (add/remove/reorder columns)
  + scroll-note-into-view toggle
  + show-linetags-in-headlines toggle
+ [ ] implement global settings modal
  + port from notegit's GlobalSettingsModal (~80 lines)
  + theme preference, default view type, line numbers


### Publish NoteThink 0.1.x to marketplace (requires manual work)

+ [ ] create extension icon
  + 128x128 or 256x256 PNG in `media/icon.png`
  + needs to be visually clear at small sizes in the marketplace sidebar
  + once created, add `"icon": "media/icon.png"` to root package.json
+ [ ] create ZoomBuzz publisher account
  + register at marketplace.visualstudio.com
+ [ ] test against edge cases before release
  + install the .vsix locally (`code --install-extension notethink-0.1.0.vsix`)
  + empty markdown file
  + very large markdown file (1000+ lines)
  + markdown with frontmatter (already parsed via mdast-util-frontmatter)
  + markdown with GFM tables, strikethrough, footnotes
  + file with unicode characters and special paths
  + workspace with 100+ markdown files (performance check)
  + verify no console errors in developer tools
+ [ ] publish to marketplace
  + `vsce publish 0.1.x`
  + verify listing appears correctly


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
