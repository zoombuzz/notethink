# Todo [](?type=board&ng_level=1&ng_child_type=story&ng_child_status=backlog&ng_view=kanban)


### dynamic kanban columns

+ goal
  + kanban columns are hardcoded to untagged/backlog/doing/done
  + notegit derives columns from the linetags present in the document
  + users should be able to define columns via linetags or settings
+ [X] derive column definitions from notes' status linetag values
  + KanbanView columns replaced from useState with useMemo deriving from notes_within_parent_context
  + scans notes for unique status linetag values, always includes 'untagged' as first pseudo-column
  + columns sorted alphabetically; dynamic — appear/disappear as notes change
+ [X] allow column customisation via kanban settings modal
  + [X] create SettingsKanbanModal component (notethink-views/src/components/views/)
    + native dialog with column reorder list, scroll_note_into_view toggle, show_linetags_in_headlines toggle
    + on save, calls handlers.setViewManagedState() with updated display_options.settings
  + [X] add column_order support to KanbanView
    + new optional display_options.settings.column_order: string[] defines column order
    + when set, columns follow that order; unknown status values appended
    + when unset, falls back to current alphabetical sort
  + [X] wire settings gear button in KanbanContextBar to open SettingsKanbanModal
  + [X] add tests for SettingsKanbanModal and column ordering


### view state persistence

+ goal
  + when the webview reloads (e.g. tab switch), view state is lost
  + notegit persists view state in LocalStorage; NoteThink should use VS Code's webview state API
+ [ ] persist view type and parent_context_seq via vscode.getState/setState
  + save on setViewManagedState calls
  + restore on webview init in ExtensionReceiver
+ [ ] persist kanban column scroll positions


### theme integration

+ goal
  + webview should match VS Code's active colour theme (light/dark/high contrast)
  + notegit has custom GitHub light/dark themes; NoteThink should inherit from VS Code
+ [X] detect VS Code theme kind and apply to webview
  + inline script in notethinkEditor.ts reads body.vscode-dark/vscode-high-contrast
  + sets data-mantine-color-scheme on <html> for dark-mode SCSS selector
  + MutationObserver syncs attribute on live theme changes
+ [X] CSS variable bridge (vscode-mantine-bridge.css)
  + maps 7 --mantine-* variables to --vscode-* equivalents
  + ViewRenderer.module.scss works unchanged in both NoteGit and NoteThink
  + index.css uses --vscode-font-family, --vscode-editor-foreground, --vscode-editor-background
+ [ ] verify high-contrast themes
  + test with "High Contrast" and "High Contrast Light" themes
  + ensure focus/selection outlines have sufficient contrast


### insert modal

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


### settings modals

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


### publish NoteThink 0.1.0 to marketplace (requires manual work)

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
  + `vsce publish 0.1.0`
  + verify listing appears correctly


### multi-view management [post-v1]

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


### convert top-level 'docs' container to RootNote [post-v1]

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


### optimisation cycle [post-v1]

+ create language server
  + communicate to separate thread via LSP
    + add to webpack watch
  + investigated previously, deferred as non-essential for now
  + revisit once delta computation works
+ consider whether parsing (mdast-util-from-markdown) is the bottleneck
  + or whether it's the React re-rendering
  + profile before optimising
