# Todo [](?nt_view=kanban)


### Stop two specs timing out on web server start [](?id=playwright-webserver-start-timeouts&tokens_estimated=3)

Two specs failed a full Playwright run by waiting 60 seconds for their web server, then passed alone and in the next full run.

+ evidence 2026-11-18: `folder-latest-scan-real-host.spec.ts` and `open-viewer-single-file-kanban.spec.ts` failed once, and each passed alone in 13 seconds
+ suspected, not measured: load on the machine during the full run
+ [ ] measure what delays the web server start when the full suite runs
+ [ ] fix the cause so both specs start reliably in a full run


### Make the target line match what coordinators build [](?id=coordinator-target-line-rule&tokens_estimated=6)

The coordinator panel says an agent may work from the top of the board down to its target line. Coordinators now build the stories sent or delegated to them, and `coord=` only names the hosts allowed to build a story, so moving that line does not change what gets built.

+ evidence 2026-11-18: the hint in `CoordinatorTargetLine.tsx:123` and the range described in the header of `client/extension/src/lib/coordinatorops.ts`
+ related: [[coordinator-board-lines]] draws the coordinator's real build line on story views
+ [ ] decide whether the panel control should send stories, set host placement, or go
+ [ ] change the panel and its wording to match that decision


### Draw the build and ship lines on story views [](?id=coordinator-board-lines&status=code-review&sent=go-20261118&tokens_estimated=18)

A board's order decides what happens next, but no story view shows where that work stops. You cannot see how far a coordinator will get if left to run, or which stories a push would ship.

+ goal: two lines across every view that shows a board's stories in order, whichever card type is in use
+ builds on: the coordinator rows of the activity snapshot, `coordinatorsFrom` in `client/extension/src/lib/coordinatorops.ts`
+ builds on: the per-project coordinator file read, `readProgress` in `client/extension/src/vscode/AgentAnalyser.ts`
+ decision: the build line is solid, in the highlight colour `--vscode-focusBorder`, below the last story the coordinator will build
+ decision: the ship line is dashed, in the same colour, below the last story that has passed the release gate
+ decision: the lines belong to the view, not the card, so no card type draws or branches on them
+ decision: the lines only show position; moving work stays with the existing target controls
+ proceeded on the recommendation 2026-11-18, for the operator to confirm: which stories count towards each line
  + build line: a story tagged `sent=`, a `delegated-` id, or at `doing`
  + build line leaves out a story at `code-review` or `testing`, and one parked on an open question, a blocked note, an open manual task or an open delegated task
  + ship line: a story named in the coordinator's `ready.json`, or at `code-review` or `testing`
  + reversing either rule is a change to one pure function
+ proceeded on the recommendation 2026-11-18, for the operator to confirm: in a grouped view each group draws the line between its own cards
  + a group whose cards all sit above the line draws it last, and one whose cards all sit below draws it first
  + an empty group draws nothing
  + a view sorted away from board order draws no lines, since position there says nothing about the board
+ decision: each coordinator row carries both lines as `build_after` and `ship_after`, counts of the board's stories at or above the line; a view matches its stories to the board by document path and story id, so a filtered view still places the line correctly
+ decision: a document view draws the lines among the body items of the note holding the stories, so a card type that draws only a headline lists no stories there and has no line to draw
+ [X] add the build and ship positions to each coordinator row, computed by a pure function with Jest cases for every rule above
+ [X] read `ready.json` beside `progress.json`, treating a missing or malformed file as no ready stories
+ [X] draw both lines in the document, line and kanban views, virtualized columns included
+ [X] stack the lines cleanly when both fall at the same position
+ [X] show the lines on a board opened as a single file and in a folder view
+ [X] give each line a localised accessible name and tooltip saying what it marks
+ [X] cover both lines, every card type and a grouped view in a Playwright spec
+ [X] bump the patch version
+ the stacked-row form of both lines is measured in a rendered page by `board-lines.spec.ts`: vertical strokes, solid and dashed, between cards, with no card moved or resized
+ manual: check both lines on a live board in VS Code, with a coordinator running


### Keep each card tag on one row [](?status=code-review)

A tag value too long for its card wrapped onto a new line under its key, so the key and value columns broke apart. Coordinator envelope ids (`sent=...`) made this common.

+ decision: keep showing every tag; no new hidden keys, since a hidden name could clash with a tag a user invents
+ decision: each key stays in the left-hand column and its value stays on the same line, clipped at the card's right edge with no ellipsis
+ [X] lay each tag row out as one non-wrapping flex line in `ViewRenderer.module.scss`, the value clipped at the card edge
+ [X] cover a long unbroken value, a long multi-word value and an unclipped short value in `linetag-row-overflow.spec.ts`
+ [X] bump the patch version
+ manual: check a board with `sent=` tags in VS Code at a narrow viewer width


### Pulse the editor caret instead of blinking it [](?status=code-review)

The caret drawn in card titles and linetag values blinks hard on and off. It should pulse instead: fade smoothly down and back up.

+ decision: fade to 15% opacity rather than 0, so the caret stays faintly visible between pulses
+ decision: hard-code the pulse for now, not following VS Code's `editor.cursorBlinking` setting
+ [X] swap the stepped blink keyframes for an eased, alternating fade in `VirtualCaret.module.scss`
+ [X] check the eased, alternating timing in `editor-caret.prod.spec.ts`
+ [X] bump the patch version
+ manual: check that the pulse looks right next to the editor's own cursor in VS Code


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
