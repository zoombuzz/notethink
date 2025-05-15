# Todo [](?type=board&ng_level=1&ng_child_type=story&ng_child_status=backlog&ng_view=kanban)


### get tests running again

+ no results currently
  + non-specific `fetch` error


### open named folder on startup

+ currently opening the last folder opened
  + like to standardise that in the code


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


