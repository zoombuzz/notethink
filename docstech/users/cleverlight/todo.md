# Todo [](?type=board&ng_level=1&ng_child_type=story&ng_child_status=backlog&ng_view=kanban)


### dev environment

+ make debugging breakpoints bind
  + works fine in `custom-editor-sample`
  + works fine in `modified-lsp-web-extension-sample`
    + which is using the same webpack watch
    + `.vscode/launch.json` defines correct configurations
  + bring across components
    + from `notethink` into `modified-lsp-web-extension-sample`
      + latter isn't versioned
      + better doing it the other way around
    + try to understand at what point does it break
  + works in `notethink` repo using:
    + `client4`
    + `backup-package.json`
    + `backup-webpack.config.json`
    + now try to make it work with client
      + same package.json
      + working with correct `package.json`
    + now try to make it work with correct `webpack.config.js`


### turn MDAST back into React

+ render docs to HTML
+ filter out logs
  + need to differentiate our updates
    + already done by `postMessage()`
      + contamination is not at the send point
  + seems to be bad state
    + probably persisted in VSCode
      + no change on restart
    + visualise object in debugger


### compute delta on `partial` in ExtensionReceiver 

+ `partial` update may be different
  + but might be the same
  + want to avoid re-rendering React components if possible


### optimisation cycle

+ create language server
  + communicate to separate thread via LSP
    + add to webpack watch


