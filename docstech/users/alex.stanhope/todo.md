# Todo [](?nt_view=kanban)


### Show idle boards and an honest ready line [](?id=board-lines-idle-and-ready-run&status=code-review&sent=go-20261118&tokens_estimated=8)

A board with nothing for its coordinator to build shows no solid line, so an idle project is easy to miss. The dashed line sits below the last ready story, which implies every story above it is ready when many are not.

+ goal: the solid line shows at a glance where no coordinator work is set
+ goal: everything above the dashed line is ready
+ builds on: `boardLinePositions` in `client/extension/src/lib/coordinatorops.ts`
+ builds on: `boardLineSlots` in `client/webview/src/notethink-views/src/lib/boardlineops.ts`
+ evidence 2026-11-18: on one 106-story board the only ready story is number 22, so the dashed line claimed 21 unready stories were ready
+ decision: with nothing to build, the solid line sits at the top of the column, in the gap between its title and first story
+ decision: a line at the top never moves the first story down
+ proceeded on the recommendation 2026-11-18, for the operator to confirm: the dashed line sits below the unbroken run of ready stories from the top of the board, and is absent when the first story is not ready
+ [X] move the dashed line to the end of the unbroken ready run, with Jest cases
+ [X] draw the solid line at the top of each column when the board has nothing to build, with an accessible name saying so
+ [X] overlay every line at the top of a column in the gap, so no card moves, in normal and windowed groups and both orientations
+ [X] measure in a rendered page that the first card does not move and the line touches neither the title nor the card
+ [X] bump the patch version
+ manual: check the top line on an idle project in VS Code


### Confirm where the dashed line goes [](?id=board-lines-dashed-decision&tokens_estimated=1)

Ready stories are often not at the top of a board, because new stories are filed above them, so one line cannot both mark every ready story and promise that everything above it is ready.

+ evidence 2026-11-18: of the 10 boards with ready stories, 5 have an unready story first, so they would show no dashed line under the unbroken-run rule
+ open question: Where should the dashed line go when ready stories are not all together at the top? The build now places it below the unbroken ready run from the top, so everything above it is ready, but a board whose first story is not ready shows no dashed line even if a push would ship work. Recommendation: keep this, because it never claims an unready story is ready.
+ [ ] apply the confirmed answer to the dashed line and its tests


### Make the board lines match what will happen [](?id=board-lines-accuracy&status=code-review&sent=go-20261118&tokens_estimated=8)

The build and ship lines can sit far below the work they describe. A folder view shows only the first stories of each file, so a line further down is drawn at the bottom of the shown stories, and the counting rules include stories that neither a coordinator nor a push will act on.

+ evidence 2026-11-18: a file capped to 20 of 64 stories drew both lines at its bottom, though they belonged at 32 and 24
+ evidence 2026-11-18: stories left at `doing` moved the solid line on boards where the coordinator had nothing to build
+ evidence 2026-11-18: older `code-review` stories moved the dashed line past the last story in the ready marker
+ evidence 2026-11-18: a ready marker already pushed still moved the dashed line
+ evidence 2026-11-18: two stories sharing one id make the order check fail, which removes both lines from that board
+ related: [[coordinator-board-lines]]
+ decision: the solid line counts only what the coordinator would run: sent or delegated stories that are not parked or in review, plus the story its ledger shows in flight
+ decision: a story at `doing` that is neither sent, delegated nor in flight does not move the solid line
+ decision: the dashed line counts the stories of an unpushed ready marker, plus every story at `code-review` or `testing`
+ decision: a line below the displayed stories stays drawn at the bottom of them
+ design: a story waiting in the coordinator's `waiting.json`, or placed on another machine by `coord=`, counts as parked
+ design: a marker counts as pushed when the branch has no unpushed commits, its commit is the upstream commit, or a complete list of unpushed commits leaves it out
+ design: when git cannot say, the marker still counts
+ [X] apply the solid and dashed line rules, with Jest cases for each
+ [X] keep the lines on a board where two stories share an id
+ [X] compare the solid line with the coordinator's own selection on real boards, read-only
+ [X] bump the patch version
+ the in-flight story is exempt from the `coord=` check, as the coordinator's own selection treats it
+ a coordinator with no recorded machine parks nothing on `coord=`, so a board placed on another machine by `coord=` can draw the solid line on a machine that would not build it


### Stop two specs timing out on web server start [](?id=playwright-webserver-start-timeouts&tokens_estimated=3)

Two specs failed a full Playwright run by waiting 60 seconds for their web server, then passed alone and in the next full run.

+ evidence 2026-11-18: `folder-latest-scan-real-host.spec.ts` and `open-viewer-single-file-kanban.spec.ts` failed once, and each passed alone in 13 seconds
+ suspected, not measured: load on the machine during the full run
+ [ ] measure what delays the web server start when the full suite runs
+ [ ] fix the cause so both specs start reliably in a full run


### Rebuild the coordinator panel on current data [](?id=coordinator-target-line-rule&status=code-review&sent=go-20261118&tokens_estimated=14)

The coordinator panel lists nothing, and cards offer no send action, because both read an agent registry that is no longer written. Its target line also says an agent works down to it, but coordinators now build the stories sent or delegated to them, and `coord=` only names the hosts allowed to build a story.

+ goal: the panel lists each coordinator of the open repositories from the files coordinators write today, and can message it
+ builds on: `coordinatorsFrom` in `client/extension/src/lib/coordinatorops.ts`
+ builds on: the per-project coordinator file reads in `client/extension/src/vscode/AgentAnalyser.ts`
+ evidence 2026-11-18: no `registry/` directory exists under the coordinator state home on either development machine
+ evidence 2026-11-18: the hint in `CoordinatorTargetLine.tsx:123` describes a range coordinators no longer use
+ related: [[coordinator-board-lines]] now shows where coordinator work stops
+ decision: rebuild the panel on current coordinator data
+ decision: remove the target line and its marker move
+ design: a coordinator is listed when `coordinator/<project>/sessions.jsonl` holds a coordinator session for an open repository
+ design: its vendor and session ids come from that ledger, newest first
+ design: state is stopped from a newest `stop` line, waiting from `waiting.json`, working from the last `story-assignments.jsonl` story, otherwise idle
+ design: its machine comes from `coordinator-homes.json`, else the resume note in its mailbox, and with neither it has no address and is not listed
+ design: open convoys come from the resume note
+ [X] read coordinators from those files through a pure parser, with Jest cases for missing and malformed files
+ [X] keep the panel rows, the card send action and the agent card names working from that data
+ [X] remove the target line control, the marker move command, their strings and their tests
+ [X] check the parser against real coordinator files, read-only
+ [X] bump the patch version
+ manual: send a short message to a coordinator from the panel in VS Code


### Draw the build and ship lines on story views [](?id=coordinator-board-lines&status=code-review&sent=go-20261118&tokens_estimated=18)

A board's order decides what happens next, but no story view shows where that work stops. You cannot see how far a coordinator will get if left to run, or which stories a push would ship.

+ goal: two lines across every view that shows a board's stories in order, whichever card type is in use
+ builds on: the activity snapshot and the board files `readStoryDocuments` loads in `client/extension/src/vscode/AgentAnalyser.ts`
+ builds on: the per-project coordinator file read, `readProgress` in `client/extension/src/vscode/AgentAnalyser.ts`
+ evidence 2026-11-18: no lines appear in VS Code, because they were attached to coordinator rows and those rows come from an agent registry that is no longer written
+ decision: the build line is solid, in the highlight colour `--vscode-focusBorder`, below the last story the coordinator will build
+ decision: the ship line is dashed, in the same colour, below the last story that has passed the release gate
+ decision: the lines belong to the view, not the card, so no card type draws or branches on them
+ decision: the lines only show position
+ decision 2026-11-18: which stories count towards each line
  + the rules are set by [[board-lines-accuracy]]
+ decision 2026-11-18: in a grouped view each group draws the line between its own cards
  + a group whose cards all sit above the line draws it last, and one whose cards all sit below draws it first
  + an empty group draws nothing
  + a view sorted away from board order draws no lines, since position there says nothing about the board
+ decision: each board file gets its own line positions from what the window can read, so the lines need no coordinator session or registry
+ decision: a window connected to another machine shows that machine's board and ready file
+ decision: a view matches its stories to the board by document path and story id, so a filtered view still places the line correctly
+ decision: a document view draws the lines among the body items of the note holding the stories, so a card type that draws only a headline lists no stories there and has no line to draw
+ [X] add the build and ship positions, computed by a pure function with Jest cases for every rule above
+ [X] read `ready.json` beside `progress.json`, treating a missing or malformed file as no ready stories
+ [X] draw both lines in the document, line and kanban views, virtualized columns included
+ [X] stack the lines cleanly when both fall at the same position
+ [X] show the lines on a board opened as a single file and in a folder view
+ [X] give each line a localised accessible name and tooltip saying what it marks
+ [X] cover both lines, every card type and a grouped view in a Playwright spec
+ [X] bump the patch version
+ [X] compute the line positions per board file, with no dependency on coordinator rows
  + `boardLinesFrom` in `coordinatorops.ts` feeds the snapshot's `board_lines` list, read from the boards and posted whether or not an agent home or session scan exists; `coordinatorops.test.ts` and the board lines block of `AgentAnalyser.test.ts` cover it
  + the same path fixed a workspace folder rooted at `/` never resolving its boards, which a web host mounts
+ [X] prove the lines appear on a real extension host with a board on disk and no agent registry
  + `playwright/specs/board-lines-real-host.spec.ts` passes on this tree and fails on the previous build, in the kanban and document views
+ [X] bump the patch version for this fix
+ the stacked-row form of both lines is measured in a rendered page by `board-lines.spec.ts`: vertical strokes, solid and dashed, between cards, with no card moved or resized
+ manual: check both lines on a live board in VS Code


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
