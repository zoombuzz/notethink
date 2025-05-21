# Todo [](?type=board&ng_level=1&ng_child_type=story&ng_child_status=backlog&ng_view=kanban)


### work on DX

+ goal is to make the parent vscode instance debugger work
  + with TS-based Webview
  + currently reports that `Source map failed to load.`
+ [X] test with reference sample to see if it's broadly doable
  + no evidence of it there
  + perhaps because there's no TS-mapping
+ [X] fix access: can't inspect HTML
  + going to need to be able to see rendered HTML
    + works on reference samples
    + suspect bad CSP
  + can inspect basic output
    + when rendered by the webview embed code directly
  + can inspect
    + so long as NoteThink extension run before `Toggle Developer Tools` on
+ [ ] fix missing sourcemap
  + need to tell it where to find that source


### convert top-level 'docs' container to MDAST

+ goal
  + should be possible to render any MDAST node
    + including one that contains a bunch of files
  + will eventually have dynamic collections
+ rename to `RootNote`
  + probably contentless
  + but children render content
    + children might be visualised in a bunch of different ways
    + simply as a set of files
      + clicking on each one shifts the context to that


### compute delta on `partial` in ExtensionReceiver 

+ `partial` update may be different
  + but might be the same
  + want to avoid re-rendering React components if possible


### optimisation cycle

+ create language server
  + communicate to separate thread via LSP
    + add to webpack watch


