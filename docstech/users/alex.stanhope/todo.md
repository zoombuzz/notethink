# Todo [](?nt_view=kanban)


### Give a second renderer a core to build on [](?id=renderer-neutral-core&status=code-review&tokens_estimated=5)

NoteThink's parser, note tree, view registry and edit calculators can be reached only by importing files from inside the views package, and the messages a host and the webview exchange are typed only in part. A renderer that is not the React webview has nothing supported to build on. An edit worked out on a doc's old text can also land on text that has changed since, because an edit names offsets and nothing else.

+ builds on: the `notethink-views` package (`client/webview/src/notethink-views`) and its `types/Messages.ts`
+ approach
  + `src/core.ts` re-exports the parser, the note tree, the view registry, the edit calculators and the message types
  + `core.test.ts` walks the entry's import graph and fails if React, a stylesheet or a `.tsx` file is reachable
  + rollup builds it to `dist/core/index.js`, one module that loads in a page, a worker and Node alike
  + the webview states `PROTOCOL_VERSION` in `requestInitialState`, and the host states it on every `update`
  + an `editText` message carries `doc_hashes`, and the host leaves a doc alone and re-sends it when its text no longer matches
+ new pattern: a renderer-neutral entry point held free of the view framework by an import-graph test
+ open question: are `core` and the names in `src/core.ts` the ones to publish?
  + recommendation: keep the entry named `core` with the exports listed there
  + both become public names of a published package, so the permanent name check has to confirm them before a release
+ [X] add the `core` entry point and its build output
  + measured 2026-11-14: `dist/core/index.js` loads in plain Node with 41 exports and parses a board; it names no React, drag-and-drop or diagram module
  + the kanban drop is part of the core too: `buildKanbanDragEndPayload`, `notesInKanbanColumn` and `kanbanNoteOrder`, so a second renderer writes a status change and an order exactly as a drop in the kanban view does
  + the build asks for each dependency's `worker` condition, because the character-reference decoder's browser build reaches for `document` as it loads
+ [X] move `parse` into the views package so the webview and the core share one copy
+ [X] type the messages the unions left out and add the protocol version
  + added: `requestInitialState`, `setIntegration`, the two activity demand messages, the four audio messages, `renderError`, `activeEditorDoc`, `docDeleted`, `audioState`, and the `setIntegrationScope` command
  + the agent-activity and coordinator messages stay typed beside their handlers, since they serve cards that read files on the extension's own machine
+ [X] add the document hash to `editText`, checked by the host
  + the composers attach `doc_hashes` through `withDocHashes` in `client/webview/src/lib/docops.ts`; `applyEditTextToDoc` in `PanelSession.ts` refuses and re-sends a changed doc
+ [X] document the entry point and the protocol version in `CODING_STANDARDS.md` and `AGENTS.md`
+ [X] bump the patch version
  + 0.4.49
+ measured 2026-11-14: lint clean; Jest 1,255 extension, 268 webview and 2,479 views tests pass; Mocha 43 pass; Playwright 373 pass
+ fixed in passing: `coordinator-views.spec.ts` posted its activity snapshot before any card had mounted to listen for it, which failed one run in several under load; it now waits for the webview's demand first


### Send envelopes between machines through a sync service [](?id=coordinator-sync-client)

Story [[coordinator-views]] reaches agents on the same machine only. An agent on another machine is out of reach unless the operator opens a second window there. This story adds delivery between machines, through a sync service chosen in a setting.

+ background
  + the sync client and the per-instance process belong to thinkersync, a separate open-source project; this story only uses them
  + dependency: delivery between machines cannot be built until thinkersync's client library exists, so this story waits on it
  + measured 2026-11-12: thinkersync's client library is written but not released as a package, its per-instance process is still being built, and its sync service is not yet deployed
  + an instance is one NoteThink instance: a VS Code window on a folder, or the browser workbench
  + each instance runs its own thinkersync client and process, and stays independent of other instances on the same machine
+ approach
  + a VS Code setting names the sync service, defaulting to notethink.com
  + the extension starts and stops one client process per instance, and the views from [[coordinator-views]] list agents from other machines the same way as local ones
  + an envelope for an agent on another machine goes through the chosen service; one for a local agent still goes straight to its mailbox
  + the view shows whether the chosen service reports that it holds nothing for this instance
  + a service that is unreachable leaves local sending working and says so beside the remote agents
+ [ ] add the sync service setting with notethink.com as its default, and document it in `README.md`
+ [ ] start and stop one thinkersync client process per instance
+ [ ] route envelopes for agents on other machines through the chosen service
+ [ ] show remote agents beside local ones, marked by machine
+ [ ] show whether the service holds nothing for this instance
+ [ ] state the network use in the Agent activity section of `README.md`, which today says NoteThink reads no network endpoint for agent activity
+ [ ] cover the setting, the process lifecycle and the routing choice with Jest tests
+ [ ] bump the patch version
+ decision 2026-11-13: hold this story until thinkersync releases its client library and per-instance process; no build against a fake of their contract
