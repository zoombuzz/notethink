# Done [](?type=board&ng_level=1&ng_child_type=story&ng_child_status=done&ng_view=kanban)


### bootstrap compiled typescript client

+ work out app development model
  + model on [VSCode Pull Request Github extension](https://github.com/microsoft/vscode-pull-request-github/)
    + seems to be webpack based
    + [webpack config](https://github.com/microsoft/vscode-pull-request-github/blob/main/webpack.config.js)
+ `/src/web` is currently getting built into `/dist/web`
  + seems to be based on `esbuild`
  + guide to [Bundling VSCode extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
    + esbuild is recommended for speed
    + no reason (yet) to prefer webpack
  + PawDraw [Custom Editor Sample](https://github.com/microsoft/vscode-extension-samples/blob/main/custom-editor-sample/media/pawDraw.js)
    + uses TS + JS
    + no examples have both in TS currently
+ [X] fix restart bug
  + "Run Web Extension" runs the first time
    + and stops
    + but then doesn't seem to run again
  + requires restart of VSCode
    + instance, not all instances
  + same thing happens with "Extension Tests"
    + patched to latest VSCode (1.99), still happening
  + must be problem in my extension
    + sample `vscode-pull-request-github` doesn't have the same problem
      + relaunches perfectly
    + (really) old code branch works `efb3eeb1fe77e10e0dde05969cb74564d3338354`
      + refresh test is the best one
  + try webpack
+ [X] re-base extension on webpack
  + seems to just work better
    + refresh works
+ [X] investigate LSP
  + seems to be doing exactly what we need
    + parsing text files
  + [markdown-language-features](https://github.com/microsoft/vscode/tree/main/extensions/markdown-language-features)
  + "Extensions can add support for additional Markdown syntax by contributing a markdown-it plugin."
    + [markdown-it plugin](https://github.com/markdown-it/markdown-it#syntax-extensions)
    + don't want to add syntax especially
+ understand how MPE works
  + [Markdown Preview Enhanced](https://github.com/shd101wyy/markdown-preview-enhanced)
+ [X] understand how Markdown Language Service works
  + no sight of /server.js file
  + [server ops](https://github.com/microsoft/vscode/blob/014c000f81761f81460ddce4db18f4bee39072c5/extensions/markdown-language-features/src/client/protocol.ts)
    + look relevant
      + `markdown/parse`
        + tokens renderable into HTML with [MarkdownIT](https://github.com/markdown-it/markdown-it)
      + `markdown/findMarkdownFilesInWorkspace`
        + though below the surface it's only what we're already doing
          + `await vscode.workspace.findFiles(mdFileGlob, '**/node_modules/**')`
          + [source code](https://github.com/microsoft/vscode/blob/014c000f81761f81460ddce4db18f4bee39072c5/extensions/markdown-language-features/src/client/client.ts#L139)
      + `markdown/fs/watcher/create`
  + use [VSCode Language client NPM module](https://www.npmjs.com/package/vscode-languageclient)
    + to fire requests
  + this doesn't seem essential now
    + might be worth seeing what the `markdown/parse` tokens look like
    + should be as simple as replicating part of [client.ts](https://github.com/microsoft/vscode/blob/1.75.0/extensions/markdown-language-features/src/client/client.ts)
+ [X] look at LSP sample
  + might illuminate the double-packaging solution
  + includes two clear `WebpackConfig` objects
    + both get exported in `module.exports = []`;
+ [X] modify webpack config to bundle a second set of files
  + client should be TS too
  + delay this until we understand LSP
    + suspect that the server-client LSP split has to solve the same problem
  + create a basic react app (in TS)
+ [X] setup `tasks.json`
  + to make `npm: watch` a background operation
    + which starts on `Run Web Extension` (Ctrl+F5)
+ [X] get extension running
  + currently not activating


### continue dev setup

+ [X] chase down log entries
  + can see all logs issued from `client/extension`
  + where are the logs from `client/webview`
    + Shift+Ctrl+P: Toggle Developer Tools
+ [X] mark index.tsx HTML as only being used for testing
  + the app's real HTML is generated dynamicalled in `notethinkEditor.ts`


### get document data flowing

+ definitely being sent from extension
  + no sign of it being received in ExtensionReceiver
+ currently `received updated` message is full of rubbish
  + it's arrival in client/webview is very delayed
+ [X] replicate using extension samples
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
    + however indirect can send a `requestInitialState` message
      + and the response is then processed
+ this will need optimising, but it's OK for now


### test debug

+ can we migrate without having to frequently re-enable
+ if not, investigate vscode logging options
  + go with `winston`
    + even though it required a raft of Node.js polyfills in webpack
  + overkill but a good experiment in running Node.js NPM modules in a browser


### parse markdown data using NPM module

+ include an NPM module
  + parse documents with [mdast](https://www.npmjs.com/package/mdast-util-from-markdown)
    + just worked
    + no polyfills required


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
> working debugger


