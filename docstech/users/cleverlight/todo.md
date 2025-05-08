# Todo [](?type=board&ng_level=1&ng_child_type=story&ng_child_status=backlog&ng_view=kanban)


### get document data flowing

+ definitely being sent from extension
  + no sign of it being received in ExtensionReceiver
+ currently `received updated` message is full of rubbish
  + it's arrival in client/display is very delayed
+ [ ] replicate using extension samples
  + cscratch in lsp-web
  + cscratch using TS
  + always shows "blocked vscode-webview request"
    + even though it works fine for `direct`
      + adds listener
      + receives message with all the content
    + doesn't work for `indirect`
      + adds listener, removes then adds again
      + doesn't report receiving message
        + state seems to get preserved (vscode.state)
          + closing the file and re-opening shows
            + nothing sent through
  + `onMessage` is called for direct
    + not called for indirect
      + though does seem to get it out of band
        + could be React issue
      + try out-of-band in `notethink` repo
        + works
          + we get the console message
      + we also get the message where `webpack` forces an update
        + something about recompiling the code
          + must trigger a refresh
    + however indirect can send a `requestState` message
      + and the response is then processed


### test debug

+ can we migrate without having to frequently re-enable
+ if not, investigate vscode logging options


### create language server

+ communicate to separate thread via LSP
  + add to webpack watch


### parse markdown data using NPM module

+ include an NPM module
  + parse documents with [mdast]()
