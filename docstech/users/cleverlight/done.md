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


### get tests running again

+ no results currently
  + non-specific `fetch` error
+ just needed a path sorting out
> runs nicely


### open named folder on startup

+ currently opening the last folder opened
  + like to standardise that in the code
+ after failing 4 attempts, AI says there's no way to do it
  + `When you use "type": "extensionHost" with "request": "launch", the --folder-uri argument is ignored by VS Code.`
  + `There is currently no supported way to force the debug extension host to always open a specific folder via launch.json alone. This is a limitation of VS Code itself.`
+ will have to do it manually
  + can't test on `notethink` repo itself
  + because `notethink` is already open in vscode
  + need another test repo
    + recommend note-templates


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
      + can't debug webview (in parent instance) currently
      + but can `Toggle Developer Tools`
        + to debug in child instance
+ make update work
  + currently update knocks out all the content
    + suspect we're smashing the MDAST
  + just need to always send an updated MDAST
    + might need to bounce that
      + give the frequency of update


### wire notethink-views into rendering pipeline

+ [X] build MDAST-to-NoteProps transformer
  + `convertMdastToNoteHierarchy` in notethink-views/src/lib/
  + walks MDAST tree, produces NoteProps with seq, level, position, children_body, headline_raw, body_raw
  + handles headings, code, list, listItem, paragraph-under-listItem
  + nests notes by position containment
  + 9 tests covering nesting, boundaries, edge cases
+ [X] replace NoteRenderer internals
  + NoteRenderer routes through DocumentView when doc.text is available
  + fallback to raw MDAST→HAST→JSX for docs without text (backwards compatible)
  + removed double type assertion (`as unknown as`) with MdastInput union type
+ [X] notethink-views consumed directly by webpack
  + lives inside client/webview/src/ so webpack resolves it via ts-loader
  + no rollup build needed in the webpack watch chain
  + rollup still used for standalone npm package builds


### get a first basic release of NoteThink extension out

+ goal
  + ship a working 0.1.0 that people can install from the VS Code marketplace
  + renders markdown files as structured, interactive note hierarchies
  + no need for editing, just viewing
  + must feel solid: no crashes, no visible jank on typical markdown repos

+ [X] fix client/extension/package.json metadata
  + publisher → ZoomBuzz, version → 0.1.0, repo URL → NoteThink, description updated
+ [X] add marketplace metadata to root package.json
  + added license, homepage, bugs; categories → ["Visualization", "Other"]
  + fixed `vscode:prepublish` to run `package` (production build) instead of `compile`
  + added `package:vsix` script; installed `@vscode/vsce`
  + note: `"icon"` field removed — vsce hard-errors without the actual PNG; re-add once icon exists
+ [X] update CHANGELOG.md for 0.1.0
  + features, known limitations, dated 2026-02-18
+ [X] update README.md for public consumption
  + npm → pnpm throughout, added Status line (preview/beta), added Known Limitations
  + "From Marketplace" section notes not yet published
+ [X] review .vscodeignore for production packaging
  + added exclusions for .github, .claude, docstech, node_modules, client source, test files
  + `vsce ls --no-dependencies` shows 19 files, no source/node_modules leak
+ [X] verify the production build pipeline
  + `pnpm run package` — 0 errors, `pnpm run lint` — clean, `pnpm test` — 33 pass
  + `vsce package --no-dependencies` → `notethink-0.1.0.vsix` (21 files, 496 KB)


### bring notethink up to active-dev standard

+ [X] migrate from npm to pnpm
  + updated postinstall script, removed package-lock.json files
  + generated pnpm-lock.yaml at root, extension, webview, and notethink-views
  + updated .github/ PR template references from npm to pnpm
+ [X] replace `console.warn` with `debug` library
  + ExtensionReceiver.tsx now uses `Debug('notethink:ExtensionReceiver')`
  + fixed debug namespaces in notethink-views (nextjs:app: → notethink-views:)
+ [X] replace `any` types with explicit types
  + defined `Doc` interface in both extension and webview types/general.ts
  + `HashMapOf<Doc>` in notethinkEditor.ts, ExtensionReceiver.tsx, NoteRenderer.tsx
  + `acquireVsCodeApi<VSCodeState>()` typed with proper state generic
  + defined `NoteDisplayOptions`, `NoteHandlers`, `ClickPositionInfo` in NoteProps.ts
  + typed `ViewApi` methods, replaced `any` in ViewProps nested fields
  + typed `RenderOptions` in renderops.tsx, `attrib_key: string` in GenericNoteAttributes
+ [X] review and clean up dist/ files in git status
  + added `**/dist/` to .gitignore
+ [X] add test scripts and get all tests passing
  + root `pnpm test` runs both webview (12 tests) and notethink-views (21 tests)
  + created jest.config.cjs, setupEnv.js, setupTests.ts for client/webview
  + added NoteRenderer.test.tsx (5 tests), ExtensionReceiver.test.tsx (6 tests)
  + added GenericNote.test.tsx (7 tests)
  + fixed pre-existing bugs: CodeNote imports, DocumentView missing function, index.ts export
  + webpack compiles both configs; eslint 0 errors
+ [X] harden extension security and reliability
  + replaced Math.random() nonce with crypto.getRandomValues()
  + removed CSP `style-src 'unsafe-inline'`, switched to nonce-based styles
  + removed commented-out permissive CSP policies
  + fixed watcher memory leak (watcher.dispose() on panel close)
  + added try-catch to all async file operations (initial load, onCreate, onChange)
  + added 250ms debounce on onDidChangeTextDocument
  + fixed inconsistent document ID generation (all paths use uri.path)
+ [X] fix CI pipeline
  + switched from npm to pnpm install --frozen-lockfile
  + added pnpm/action-setup@v4
  + added webview test job alongside notethink-views tests
  + aligned vscode engine version (^1.99.0) between root and extension package.json
+ [X] commit untracked files on bootstrap branch
  + AGENTS.md, CODING_STANDARDS.md, .github/
  + test infrastructure (jest configs, setup files, new test files)
  + client/extension/src/test/suite/lib/
  + pnpm-lock.yaml files, media/.gitkeep, *.vsix in .gitignore


### work on DX

+ [X] test with reference sample to see if it's broadly doable
+ [X] fix access: can't inspect HTML
+ [X] fix missing sourcemap
  + webpack.config.js now uses `source-map` in dev, `nosources-source-map` in production
  + controlled via `isProduction` flag derived from `NODE_ENV`


### compute delta on `partial` in ExtensionReceiver

+ [X] use hash_sha256 on doc content for change detection
  + `generateIdentifier(text)` computed at all 3 doc creation/update points in notethinkEditor.ts
  + `hash_sha256` added to Doc interface in both extension and webview types
  + ExtensionReceiver compares incoming hash to current state, skips setState for unchanged docs
  + 2 new tests: skip on same hash, update on changed hash (35 tests total)
+ [X] add React.memo to DocumentView and GenericNote
  + DocumentView wrapped in React.memo (shallow prop comparison)
  + GenericNote wrapped in React.memo (shallow prop comparison)


### port notegit features into NoteThink (phases 1-5)

+ [X] phase 1: linetag parsing and display
  + ported linetagops.ts (findLineTags, parseLineTags, calculateTextChangesForOrdering, calculateTextChangesForNewLinetagValue)
  + integrated linetag parsing into convertMdastToNoteHierarchy
  + populated child_notes arrays for kanban column assignment
+ [X] phase 2: extension-webview message protocol
  + defined message types (revealRange, selectRange, editText, selectionChanged)
  + expanded notethinkEditor.ts onDidReceiveMessage handler
  + wired ExtensionReceiver to receive selectionChanged and expose postMessage
  + wired NoteRenderer to pass selection and postMessage to views
+ [X] phase 3: GenericView, focus/selection, BreadcrumbTrail, AutoView
  + ported noteops.ts (withinNoteHeadlineOrBody, findDeepestNote, findSelectedNotes, aggregateNoteLinetags, noteIsVisible, calculateTextChangesForCheckbox, kanbanNoteOrder)
  + ported GenericView with click handler state machine, breadcrumb computation, view routing
  + ported BreadcrumbTrail (clickable ancestor navigation)
  + ported AutoView (linetag-driven view type selection via ng_view/ng_level)
  + replaced notegit's CodeMirror dispatch with postMessage
+ [X] phase 4: KanbanView with drag-and-drop
  + ported KanbanView (column assignment by status linetag, drag-drop reordering)
  + ported KanbanColumn and KanbanContextBar
  + added @hello-pangea/dnd dependency
  + updated CSP for style-src unsafe-inline
+ [X] phase 5: mermaid diagrams
  + ported MermaidNote and MermaidDiagram components
  + added mermaid case to GenericNote switch
  + added mermaid dependency
+ [X] coding standards audit and fixes
  + fixed 19 violations: import type, variable naming, constants, braces, any→unknown, import organization
  + fixed noteIsVisible bug (>= should have been <=)
+ [X] comprehensive test suite
  + 8 new test files: GenericView, AutoView, BreadcrumbTrail, KanbanView, KanbanColumn, KanbanContextBar, MermaidDiagram, MermaidNote
  + expanded noteops.test.ts (+16 tests: selectionSpans, noteIsVisible, calculateTextChangesForCheckbox, kanbanNoteOrder edge cases)
  + expanded linetagops.test.ts (+3 tests: ordering weight assignment, cascading)
  + total: 150 tests (136 notethink-views + 14 webview), 0 lint warnings, 0 compile errors


### CSS variable bridge and click/selection fix

+ [X] CSS variable bridge (vscode-mantine-bridge.css)
  + maps 7 --mantine-* vars used in ViewRenderer.module.scss to --vscode-* equivalents
  + shared SCSS works unchanged in both NoteGit (Mantine) and NoteThink (VS Code)
  + index.css updated to use --vscode-font-family, --vscode-editor-foreground, --vscode-editor-background
  + dark mode attribute sync via MutationObserver in notethinkEditor.ts inline script
  + deleted CRA boilerplate App.css
+ [X] fix click/selection flow
  + revealRange handler now sets editor.selection (was only scrolling, never placing cursor)
  + preserveFocus changed to false for both revealRange and selectRange
  + GenericView click handler fixed: proper singleClick/doubleClick else-if chain
  + 9 new click state machine tests in GenericView.test.tsx
  + total: 158 tests (144 notethink-views + 14 webview), 0 compile errors


