# Todo [](?nt_view=kanban)


### Cards on the target ratio, lanes at a draggable breadth [](?id=kanban-card-ratio-height&status=testing)

With lanes side by side, a card does not land on the Target card ratio. A board of real stories set to 1 : 1.4 comes out nearer 1 : 1.5, and changing the ratio moves the lane width far more than it moves the card's shape. Follows the `kanban-column-width` story in done.md.

Landing cards on the ratio then made the lanes far too wide: a narrow panel shows one lane where it showed three or four. The width becomes a pixel setting the user drags from the gap between any two lanes or types into the view settings, and the ratio only shapes the card.

+ problem: side by side, the ratio sets only the lane width, so a card's height is decided by an older, separate rule
+ problem: once the probe stopped reading the clip, a board of real stories solves lanes far too wide to scan
+ problem: there is no direct way to make the lanes wider or narrower, only a ratio that moves them indirectly
+ background: what sets the height today, verified against the code 2026-09-16
  + the whole card is measured: the probe reads each card's border box (`useColumnWidth.ts:69`)
  + side by side, no target height reaches the card (`useColumnWidth.ts:227`)
  + so the body clip falls back to the body's own width, `HEIGHT_RATIO = 1` (`useMarkdownNoteOverflow.ts:4`, `:30`)
  + a clipped card is therefore a square body plus its heading and attribute rows, whatever the target
  + the width solve `w = sqrt(A / rho)` assumes a card reflows like text, which a clipped card does not
  + the probe clones cards with the body's inline `max-height` still set (`useColumnWidth.ts:77`), so it measures whatever clip the live board had
+ background: measured in the Playwright harness 2026-09-16, ten real todo.md files grouped by first level folder, 800px board
  + every card was clipped at every target, except 3 of 97 at 1 : 1
  + medians: target 1 : 1 gave 1 : 1.37, 1 : 1.4 gave 1 : 1.50, 1 : 2 gave 1 : 1.63, 1 : 3 gave 1 : 2.06
  + at 1 : 1.4 every body clipped at 197px under 57 to 133px of heading and attributes, so cards ran 1 : 1.31 to 1 : 1.69
  + the probe area followed the live clip: 362543 px² on a one-lane board with unclipped bodies, 55261 px² on the ten-lane board
  + on the same board in VS Code 2026-09-16, the three fully visible cards measured 1 : 1.36, 1 : 1.43 and 1 : 1.53
+ background: what the 1 : 1 clip is for
  + it abridges a content-heavy top-level note so it cannot grow very tall (`Height-based abridging` in done.md)
  + it applies in every view, and only the lane board has a ratio to replace it with
  + after this change a lane board clips to the ratio instead, so a 1 : 3 target shows taller bodies and fewer cards per screen
  + outside the lane board the 1 : 1 clip is unchanged
+ approach
  + hand side by side cards `card_target_height = card width × ratio`, the rule stacked lanes already use
  + `bodyClipHeight` already subtracts each card's own chrome from a target, so a clipped card lands on the ratio
  + a card shorter than the target stays short, since the clip applies only when the body overflows
  + strip the body clip from the probe clones, so the width solve reads content rather than a stale clip
+ measured 2026-09-18: the clip only ever truncates, so a card's height is `min(natural height, drawn width x ratio)`
  + `manual-expand.md` at 1280x720: ratio 1.4 gives 617 x 869 clipped; ratio 3 gives 610 x 1060 unclipped, short of its 1830 target
  + raising the ratio reveals more of the note and can never grow the card past the note's own content at that width
  + where the clip does bite, the Show more bar starts below the fold and ordinary page scrolling reaches it
+ decided 2026-09-18: the target is the width the card is DRAWN at (`column - lane_padding`), not the width the ratio solved
  + the two differ whenever the lanes all fit and spread to fill the board, the common wide-board case
  + the solved width would clip a filling board's card to a height solved for a much narrower card
  + they agree exactly when the board scrolls; carried as `sideBySideHeight` on `SolvedWidths`
+ background: measured 2026-09-21 in the Playwright harness, the same ten todo.md files grouped by first level folder, 1 : 1.4
  + lanes now solve at 576px: 1 lane on a 760px board, 2 on a 1590px board
  + the old probe, reproduced on the same cards, gave 220 to 226px: 3 lanes at 760px, 6 at 1590px
  + the median card is 2431px tall at the 200px probe width, so the whole-note solve sizes a lane to show all of it
  + the old narrow width never came from the ratio reading content
    + the probe read a 1 : 1 body clip cut while the lanes sat at the 17em stylesheet fallback
    + so every card looked like a square body plus chrome, and the solve came back near 17em
  + a card that clips to width × ratio has the right shape at any width, so the ratio can no longer choose the width
+ decided 2026-09-21: the lane breadth is a pixel setting the user drags or types, and the ratio only shapes the card
  + chosen over re-deriving the width from an abridged card, and over capping the whole-note solve
  + a pixel setting needs one stable number to show and to drag, and both of those recompute it from content
  + supersedes the width solve from the `kanban-column-width` story in done.md
+ design: the lane breadth setting
  + cascade key `lineBreadth`, persisted at `notethink.settings.view.specific.line.lineBreadth` (operator sign-off 2026-09-21)
  + homed at `line`, beside `orientation`, since Line and Kanban both render through it (`LineView.tsx:124`)
  + default 220px, the measured old layout: 3 lanes on a 760px board, 7 on 1590px
  + a custom view type holds its own value in its overrides, as it can any setting
  + drawer row: a pixel text box labelled "Column width" when the lanes are columns and "Row height" when they are rows
  + a minimum, not an exact width: lanes that all fit still spread to fill the board (operator decision 2026-09-21)
    + the fill rule is `solveColumnLayout` today (`columnwidthops.ts:162`), and it keeps doing it
+ design: dragging the gap between two lanes
  + the whole gap between two columns is the drag target, with no separate handle drawn inside it
  + stacked, the whole gap between two rows is the target, and dragging it sets the row height
  + hovering a gap shows a `col-resize` cursor between columns and `row-resize` between rows
  + dragging any one gap resizes every lane together
  + the dragged gap stays under the pointer: breadth is the distance from the board's start over the lanes before it
  + the gap has to become an element, since a CSS `gap` takes no pointer events
    + `.board` spaces its lanes with `gap: 8px` today (`ViewRenderer.module.scss:1502`)
    + a separator exactly that size replaces it, so `BOARD_GAP` (`useColumnWidth.ts:16`) and the fill arithmetic hold
  + the drawer's text box follows the drag live, and the setting is written once, on release
  + a release writes where the drawer would, per `handle_row_change` (`SettingsViewDrawer.tsx:737`)
    + into the rendered custom view type when it holds the key, otherwise at workspace scope
  + on a board its lanes fill, dragging narrower moves the number but not the lanes until the breadth passes the fill
  + follows PATTERNS.md > "Accessible drag and resize affordances", reference calfam's `FamilyVisualisation.tsx` splitter
    + the gap element carries `role="separator"`, `aria-valuenow`, `aria-valuemin`, a translated `aria-label` and `tabIndex={0}`
    + arrow keys on a focused gap nudge the breadth
    + the drawer's text box is the non-drag path to the same value
+ design: what the ratio does now
  + side by side, a card is drawn at its lane minus the lane padding and clips its body at drawn width × ratio, as above
  + stacked, a card stands the row height minus the lane padding, and its width comes from its own text as today
    + floored at height / ratio, the width a card needs to stand on the ratio
  + the probe survives only for the stacked per-card widths; side by side reads no measurement
+ [X] pass the target card height to side by side lanes in `useBoardColumnStyle`
+ [X] strip the body's inline clip from the probe clones in `measureAtProbeWidth`
+ [X] update the header comments in `columnwidthops.ts` and `useColumnWidth.ts` to the new rule
+ [X] jest: a side by side board hands its cards a target height of width × ratio
+ [X] playwright: side by side, a clipped card's height is within 2% of width × ratio
+ [X] playwright: the probe area is the same whether the live board is clipped or not
+ [X] add the `lineBreadth` setting, homed at line, defaulting to 220
  + wire all six places a setting lives, as `kanbanCardRatio` did in the `kanban-column-width` story
  + `SETTINGS` (`settings.ts:61`), the package contribution and its five NLS files, the wire payload
  + `SETTING_HOMES` (`viewregistryops.ts:128`), the default cascade and `VIEW_SETTING_ROWS` (`settingRows.ts:46`)
+ [X] add a pixel text box control to the drawer, labelled by orientation
  + "Column width" and "Row height" both through `l10n.t`, with the five l10n bundles
  + reject a value that is not a number, and clamp to a floor of 120px
+ [X] size side by side lanes from `lineBreadth` through `solveColumnLayout`, keeping the fill rule
+ [X] size stacked cards from `lineBreadth`: the row height less lane padding, widths floored at height / ratio
+ [X] retire the side by side area solve, `targetColumnWidth` (`columnwidthops.ts:105`), and anything only it reads
+ [X] replace the board's CSS `gap` with a separator element of the same size between each pair of lanes
+ [X] make the whole of each gap a drag target that resizes all lanes and keeps the dragged gap under the pointer
+ [X] show `col-resize` on a gap between columns and `row-resize` on a gap between rows
+ [X] hold the in-flight breadth where the board and the drawer both read it, so the text box follows the drag
+ [X] write `lineBreadth` once on release, routed as the drawer routes a row change
+ [X] give the gap element the separator role, aria values, a translated label and arrow-key nudges
+ [X] rewrite the Target card ratio description in `package.nls.json` and its four translations
  + it says the column width is derived from the ratio, which stops being true
+ [X] update the header comments in `columnwidthops.ts`, `useColumnWidth.ts` and `settingRows.ts:83` to the breadth rule
+ [X] jest: the drag arithmetic, breadth from the pointer and the lanes before the gap, clamped at the floor
+ [X] jest: side by side lanes take the breadth setting, and spread to fill when they all fit
+ [X] jest: stacked cards stand the row height less padding, and no card is narrower than height / ratio
+ [X] playwright: rewrite `kanban-column-width.spec.ts:72` and `:106`, which assert the ratio moves the lane width
+ [X] playwright: move the probe-independence spec in `kanban-card-ratio.spec.ts` onto the stacked card widths
+ [X] playwright: at the default breadth, a board with more lanes than fit shows 3 whole lanes at 760px and 7 at 1590px
+ [X] playwright: a drag started at either edge of a gap resizes every lane, and the drawer shows the width mid-drag
+ [X] playwright: stacked, dragging the gap between two rows changes the row height
+ [X] playwright: hovering a gap shows `col-resize`, and `row-resize` when stacked
+ [X] playwright: releasing a drag posts one `updateSetting` for `lineBreadth`
+ [X] playwright: typing a width into the drawer resizes the lanes, and stacked the same box reads "Row height"
+ manual: drag the gap between two lanes on your own board in VS Code and judge whether 220px is the right default


### Save drawer changes into an existing custom view type [](?id=user-view-type-update&status=code-review)

On a custom view type such as "Next up by project", changing a setting only offers to save a new view type. There is no way to keep the change in the type already selected, and a value the type already holds cannot be changed from the drawer at all.

+ problem: a custom view type can be created, renamed and deleted, but never updated
+ background: verified against the code 2026-09-16
  + saving always mints a new type whose parent is the selected node (`SettingsViewDrawer.tsx:715`, `:721`)
  + the only other controls on a custom type are rename and delete (`SettingsViewDrawer.tsx:463`)
  + the offer fires when a row's owner is a strict ancestor of the selected node (`viewregistryops.ts:366`)
  + a setting with no registry presence answers its flat home (`viewregistryops.ts:349`), so Target card ratio is always owned by Kanban
  + a custom type's overrides are layered over the whole cascade when the board renders (`composerops.ts:32`)
+ background: measured in the Playwright harness 2026-09-16, with the operator's saved type copied from User settings
  + the type is `user-next-up-by-project`, parent `kanban`, one override `kanbanGroupBy: nt_first_level_folder`
  + changing Target card ratio to 1 : 1.6 offered "Target card ratio is owned by Kanban. Save your change as a new view type..."
  + the panel held three buttons: Save as a new view type, Rename view type, Delete view type
  + saving minted "Next up by project by 1.6" as a child of the selected type
  + setting Group by to Status wrote `kanbanGroupBy: status` at workspace scope, but the lanes stayed notegit, notethink and oma
  + the Group by control then snapped back to First Level Folder, because the type's override wins at render
+ confirmed 2026-09-18: a ratio saved into a custom type showed a Kanban pill, since the flat home ignored user types
  + measured by asserting `owningNodeFor` against the unfixed code: expected the custom type, got `kanban`
  + the row also kept offering to mint a type for a value the selected type already held
+ approach
  + on a custom type, offer "Update this view type" beside "Save as a new view type"
  + updating writes the diverged ancestor-owned rows into the selected type's overrides
  + then clears those keys at workspace scope, the same clear the mint already does
  + a row whose key the selected type already holds writes into that type's overrides, not the workspace
  + a key held in a custom type's overrides reports that type as its owner, so its pill and offer agree
+ [X] offer "Update this view type" in the Custom view types panel when the selected node is a custom type
+ [X] write updated values into the selected type's overrides and clear them at workspace scope
+ [X] route a change to a key the selected type already holds into that type's overrides
+ [X] report a custom type as the owner of any key its overrides hold, in `owningNodeFor`
+ [X] jest: updating a custom type merges the diverged rows into its overrides and clears the workspace keys
+ [X] jest: a key held by a custom type is owned by that type and offers nothing
+ [X] playwright: changing Group by on a custom type that holds it changes the lanes
+ [X] playwright: updating a custom type keeps the change after the workspace scope is cleared


### Agent activity card [](?id=agent-activity-card&status=code-review)

+ goal: a card type showing, live, which AI agents are working on a story and what each is doing
+ goal: one pane across every project, clicking through to the detail of any single activity
+ scope: Claude Code, OpenAI Codex and xAI Grok sessions
+ background: why a card type and not a view type, operator decision 2026-09-16
  + the story is the key that joins agents, files and status, and a card is what draws one story
  + every card type works in every view, so this card is designed for all of them, not for one
  + CODING_STANDARDS.md > Every card type works in every view
  + the activity join is keyed by document path and story id, neither of which depends on the view
  + follows the sticky card restyle (`sticky-card` in done.md), which exercised the card axis first
+ background: what the extension host can do, measured 2026-09-16
  + notethink is a web extension: `package.json:40` declares `browser` with no `main`
  + both bundles target `webworker` (`webpack.config.js:29` and `:111`), and `fs` resolves to `memfs`
  + so the host has no `child_process`, cannot run git and cannot listen on a port
  + the built-in git extension is node-only, so its exported API sits in another host, out of reach
  + `FileSystem.readFile(uri)` in `vscode.d.ts` takes no offset or length, so every read is of a whole file
  + agent transcripts measured over 100 MB, so tailing one from the host is unavailable, not merely slow
  + the webview CSP is `default-src 'none'` with no `connect-src` (`notethinkEditor.ts:89`)
  + consequence: notethink reads small files that a producer writes, and never watches agents itself
  + consequence: agents on another machine are invisible to any local read, so only a producer there can show them
+ background: what each vendor exposes, measured 2026-09-16
  + Claude Code: a per-process session file whose `status` is `busy` or `idle`, and a full hook matrix
  + Grok: a live session registry, a model-written `last_turn_summary`, and a full hook matrix
  + Codex: a SQLite thread store and only `notify` and `agent-turn-complete` hooks, so no live tool call
  + Codex exposes no permission request record at all
  + only Claude Code has a VS Code extension installed to open a chat in
+ binding an agent to a story, operator decision 2026-09-16
  + the agent declares which story it is on, including declaring that it is on no story
  + a working directory names a project, never a story, so the binding cannot come from cwd
  + file inference is rejected as the binding: matching write calls to file mtimes hit 9 of 12 on a real repo
  + the misses were files written by shell commands rather than edit tools
  + preferred declarer: a start-work skill that also sets `status=doing`
    + it makes the `-> doing` transition structural, where today it is implicit and often missed
    + PATTERNS.md > Making the gate structural rather than remembered
  + an external watcher can audit declared bindings against the files a session actually touched
  + the skill, hooks and watcher are workspace tooling outside this repo
  + notethink depends only on a documented file contract, so without that tooling the board shows no bindings, honestly
+ card anatomy, agreed as proposed 2026-09-18
  + state owns the colour and vendor is a monospace monogram, so the only saturated mark is the one to act on
  + one live line per agent showing its current tool call
  + the conversation opens in a drawer rather than scrolling as bubbles on the card
  + a pending question renders as a band on the card
  + changed files show in two bands: uncommitted, and committed on the branch
  + a file with no matching write call renders as unattributed, never credited to a guessed agent
+ virtual notes: where an agent that declared no story is drawn, operator decision 2026-09-18
  + a card draws one note (`cardregistryops.ts:11-16`), so an unbound agent draws on a virtual note
  + a virtual note is a note no markdown file holds, carrying the same `NoteProps` shape as a parsed one
  + the abstraction is central, taken once on behalf of every view, never per view
  + a view cannot tell a virtual note from a real one, so no view branches on the distinction
  + rejected: a synthetic markdown story note from the producer, which the folder watcher would draw twice
  + the agent declares "no story" in the binding; the virtual note is what that declaration renders as
+ [X] define and version the activity contract notethink reads
  + every path-valued field names the root it is relative to, and the reader resolves it one way
  + a reader resolves against where it actually FOUND the `.notethink/` directory, never rebuilding a location from `project`
  + a contract root can sit several folders below the workspace folder, so `${project}/${doc_path}` names a file that does not exist
  + `project`, `arg`, `facts`, `base_ref` and `session_id` look resolvable and are not, and the contract says so
  + a producer never writes a workspace-relative path, since the same repo may be opened alone, in a multi-root workspace, or nested under a parent
  + its files live under `.notethink/` in the repo the agent works in, inside an open workspace folder
  + the host finds them by a workspace-relative glob, since `workspace.fs` reads nothing outside workspace folders
  + nothing lives under a vendor's home directory or anywhere else outside the workspace
  + keep `.notethink/` out of git, so the contract never shows in the uncommitted files band it feeds
  + a session binding: session id, vendor, project, story id or none, start time
  + an event line: session id, time, kind, tool name, short argument
  + a session digest bounded to the last N messages and tool calls, small enough to read whole
  + working tree state in two bands, written by the producer since the host cannot run git
  + both sides of each changed file's diff, since the host cannot produce the HEAD side
+ [X] document the contract beside the linetag format, versioned the same way
+ found and fixed 2026-09-18: a card-type change never repainted the document view, a pre-existing defect this card uncovered
  + `areMarkdownNotePropsEqual` compared three settings and not `cardType`, so the root note skipped its re-render
  + the document view renders every story inside the root note's body via `renderBodyItems`, so the stories below kept the card they first mounted with
  + kanban and line render cards directly from the column, so `sticky-card.spec.ts` could never have caught it
  + proved rather than inferred: settings read `cardType: agent` and AutoView carried the attribute while `[data-card-type]` was empty, and any message changing the note set flipped every card with no settings change
  + this is CODING_STANDARDS.md > Every card type works in every view failing in practice, found because `agent` is the first card type tried in the document view as anything but the default
+ [X] add the `agent` card type as a `CARD_REGISTRY` node and a `CARD_COMPONENTS` line
+ [X] carry activity on its own extension-to-webview message, never on `NoteProps`
  + `NoteProps` is the mdast contract (`NoteProps.ts:146`) and stays free of agent, git and process fields
  + join activity to a card at render on `story.id` plus `story.doc_path` resolved ONCE against where the `.notethink/` directory was found
  + never try a second interpretation such as matching `Doc.relative_path` as well: two readings can match two files, and a guessed story is the one thing this card must never draw
  + jest: two files sharing a repo-relative path in different repos do not collide
+ measured 2026-09-18 on the operator's real workspace, 1,535,139 files and 52 `node_modules` directories
  + an unexcluded contract scan costs 1088 to 1136ms per glob, 2185ms for the two the reader runs
  + a `null` exclude and an omitted one are indistinguishable, so the user's `files.exclude` was never the cost
  + `**/node_modules/**` alone takes it to 29ms, about 30x, and widening the pattern further adds nothing measurable
  + a hand-written pattern is not an omitted one: VS Code applies ours, so a dotted `.notethink` stays visible whatever the user hides
  + the reader therefore passes the narrow pattern and no longer holds `resolveCustomTextEditor` while it scans
+ [X] watch the contract files with a dedicated watcher, separate from the folder markdown watcher
  + `loadFolderDoc` parses whatever it is given into a markdown doc in `integration_docs` (`PanelSession.ts:942-983`)
  + so contract files never reach it, and `includeFilter` never widens past `**/*.md` (`constants.ts:8`)
+ [X] admit virtual notes centrally, so any view draws a card for a note no file holds
+ [X] render the card: state rail, agent rows, question band and file bands
+ [X] make agent rows and file rows keyboard operable
  + PATTERNS.md > Rows that must be clickable
+ [X] open a file row as a two-column diff through `vscode.diff`
  + nothing calls `vscode.diff` today
  + `vscode.diff` needs two URIs, and the host cannot run git to produce the HEAD side
  + take both sides from the contract, where the producer writes the HEAD copy
  + verify first whether a `git:` scheme URI resolves from a web host, which would spare the producer that copy
  + admit a non-markdown path only when the contract lists it and it is within the workspace
  + keep the `.md` gate on every existing reveal and jump path (`PanelSession.ts:573`, `:1029`, `:1065`, `:1110`, `:1143`)
  + cover it in Jest: a contract-listed `.ts` path is admitted, and a path outside the workspace is refused
+ [X] open an agent row's chat in the vendor's own chat panel where one exists
  + Claude Code registers `claude-vscode.editor.open`, whose first argument is a session id
  + it is undocumented and has no stability contract, so guard the call and fall back on failure
  + measured 2026-09-18: the command resolves and opens a tab even for a session id the extension does not know
  + so a successful call is NOT proof the conversation loaded, and only an outright rejection returns `command_failed`
  + the affordance therefore says it asked the vendor to open, never that the chat opened, and the drawer stays reachable
+ [X] show an agent drawer with the digest's conversation, tool calls and session facts
  + PATTERNS.md > Bounded lists say they are bounded: the drawer states the digest's window
+ [X] say plainly when no producer is writing, so an empty board never reads as idle agents
  + PATTERNS.md > Empty states: fix the error path before the presentation
  + the copy covers a producer writing outside the workspace, where the host cannot see it
+ [X] test the card against contract fixtures in the Playwright harness, with no live agent
+ reach, operator decision 2026-09-18: notethink's side only, proven against contract fixtures
  + the producer and the start-work skill stay workspace tooling, built outside this repo
  + until they exist the board says no producer is writing, which is the honest empty state
+ dependencies
  + a producer that writes the contract from vendor hooks and runs git
  + a start-work skill that writes the binding
+ acceptance criteria
  + the agent card draws in document, line and kanban views
  + a bound, working agent's current tool call shows on its story's card within a second of the event
  + a question pending on an agent shows on that story's card
  + clicking a file row opens a two-column diff in an editor column
  + clicking a Claude Code agent row opens that session's chat, or the drawer when it cannot
  + an agent that declared no story is never drawn on a guessed story's card
  + the contract's own files never appear in any card's uncommitted files band
  + with no producer writing, the board says so


### Remove blank lines between statements [](?id=code-layout-blank-lines&status=code-review&time_estimated=60)

+ goal: notethink's function bodies follow CODE_LAYOUT.md > Blank lines, so CODING_STANDARDS.md records no blank-line delta
+ background, measured 2026-09-14
  + CODING_STANDARDS.md lets a blank line separate commented sections of a function body; no reason was ever recorded
  + a scratch count of blank lines between two statements in non-test `client/` source: 268 in 53 of 143 files, 14.9 per 1000 lines
  + siblings on the same count, per 1000 lines: calfam 2.4, zooey 1.9, aawai 1.3, ledger 1.2, dulcet 0.0
  + the count is a heuristic (a statement-ending line, a blank, a statement-starting line); count again before editing
  + recounted 2026-09-18 by the jest check's TypeScript AST walk: 296 in 53 of 144 non-test files, the same 53 files
  + operator decision 2026-09-14: align notethink rather than sanction the style, from lightenna-iac's docs-consolidation sign-off
+ follows workspace `AGENTS.md` > Bulk edits on a dirty tree: predict the count, do the first file by hand, then apply
+ [X] write the rule as a jest check over `client/`, since CODE_LAYOUT.md says no eslint rule scopes to inside blocks
+ [X] remove the blank lines, starting with one file by hand
+ swept 2026-09-18: 277 blank lines removed across 52 files, 2 by hand and 275 by script
  + the fresh count came in BELOW the earlier one, 277 in 52 against 296 in 53, which was the direction that means the walk may be broken
  + the whole difference was one file: `mergeAggregateRoot.ts` went from 19 offenders to 0 because it was rewritten clean for [[kanban-incremental-merge]]
  + verified by mutation rather than by arithmetic: a blank line inserted into that file and into a new untracked one took the count to 279 in 54, each reported at the inserted line
  + the applier re-derives offenders through its own independent walk and agreed exactly, and refuses any target that is not blank or that falls inside a comment range
  + zero targets anywhere in `client/` sat inside a comment, so no prose was reflowed
+ [X] run lint, jest and Playwright green
+ [X] drop the blank-line delta from CODING_STANDARDS.md
+ acceptance criteria
  + the check passes over `client/` with no allowlist
  + CODING_STANDARDS.md records no blank-line delta


### Kanban perf harness and budgets [](?id=kanban-perf-harness&status=code-review)

Measurement tooling that gates the whole performance cycle (stories [[dev-host-production-react]] through [[extension-parse-offload]]). Every acceptance budget below was baselined 2026-07-07 by driving the real webview bundle in the existing Playwright harness (`playwright/harness/index.html` + mocked VS Code API) with the exact wire-format messages `PanelSession` posts.

+ goal
  + one command produces per-scenario timings (elapsed, long-task count/total/max) against the current bundle as JSON
  + each optimization story proves its budget with this tool; regressions fail loudly before push
+ background - the measured baseline (production-mode bundle unless marked dev)
  + folder progressive load (8KB files, 10 cards each): 50 files 9.2s, 100 files 36.4s, 200 files 211.8s with 206.8s of long tasks - clean O(N^2); 200 is the extension's own `MAX_AGGREGATE_FILES` cap (`client/extension/src/constants.ts:5`)
  + interactions on a 50-file/500-card board: card click 168ms, editor caret move (selectionChanged) 154ms, one-file merge update 155ms; dev bundle: 708ms / 840ms / 2758ms
  + single-file kanban (nt_view=kanban): 400KB/467 cards loads in 1.7s; a 400KB edit re-send crashed the renderer (repeatable); a 100-file progressive load under the CPU profiler also crashed the renderer
  + extension-host costs (node bench): mdast parse 0.6ms/KB (400KB done.md = 230ms per debounced keystroke); mdast JSON payload is 6.2x the source text (200-file folder load ships ~9.3MB through postMessage); hashing negligible
  + real workspace shape this models: ~601 md files, done.md files 400-820KB, maxNotesPerFile=10
+ scope
  + `scripts/perf/` node runner + `pnpm run test-perf`; writes `test-results/perf.json`
  + scenarios: folder progressive load (20/50/100/200 files), folder interactions (click, selectionChanged, single-file merge), folder with 10x400KB long files, single-file load + edit re-send (100KB and 400KB)
  + budget config in one file, asserted per scenario, exit non-zero on breach; initial thresholds = baseline + 20%, ratcheted down by later stories
  + defaults to the production-mode webview bundle; `--dev-bundle` flag for the dev build
+ out of scope
  + CI integration (CI skips browser downloads by design - see CODING_STANDARDS Release section)
+ implementation notes (from the analysis prototypes - port, do not rediscover)
  + generate synthetic story files (`### Story [](?status=...)` + checkbox bullets); single-file kanban needs H1 `[](?nt_view=kanban)` plus a selectionChanged at offset 2 so AutoView resolves kanban
  + stage messages into the page as JSON strings and JSON.parse in-page; playwright's structured argument walk hangs for minutes on large mdast graphs
  + settle = `[data-flip-id]` count reaches expected, then double-rAF; long tasks via a buffered PerformanceObserver installed in an init script
  + folder mode boots via pre-seeded `window.__vsCodeState` viewStates (`__folder__` with `type: 'kanban'`, `integration_mode: 'folder'`)
+ acceptance criteria
  + `pnpm run test-perf` runs headless, writes `test-results/perf.json`, asserts budgets, exits non-zero on breach
  + scenario semantics documented in the runner header comment, including how to add a scenario
  + baseline JSON captured and committed alongside the budget config so later ratchets have provenance
+ [X] build the generator + scenario runner under `scripts/perf/` with JSON-string staging and settle/longtask instrumentation
+ [X] add budget config + assertions + `test-perf` script; capture the initial baseline file
+ [X] document scenarios and the add-a-scenario recipe in the runner header


### Dev host: production React in the webview bundle [](?id=dev-host-production-react&status=code-review)

The dev-host webview currently runs the React development build: `webpack.config.js:110` sets `mode: 'none'` unless `NODE_ENV=production`, and the `build`/`watch` scripts never set it, so `process.env.NODE_ENV` stays undefined and React's dev instrumentation ships. Measured cost on a 50-file board: card click 708ms vs 168ms, caret move 840ms vs 154ms, single-file merge 2758ms vs 155ms - a 4-17x tax on every interaction the developer feels daily. CPU profiles attribute ~22% of load time to dev-only functions (`addObjectDiffToProperties`, `logComponentRender`).

+ goal
  + the bundle the dev host serves runs production React while keeping the NOTETHINK_DEV conveniences (file logger, cache-buster) and usable source maps
+ scope
  + make `build`/`watch` produce a production-mode (or at minimum NODE_ENV=production-defined) webview bundle; NOTETHINK_DEV define stays driven by SELFINSPECT_ENV as today (`webpack.config.js:23,87,172`)
  + keep `devtool: 'source-map'` for dev builds so webview debugging still works
  + decide (and document in CODING_STANDARDS Pre-Push Verification) whether the extension bundle follows or stays as-is; only the webview bundle carries React
+ out of scope
  + changing the marketplace `package` build (already production)
+ acceptance criteria
  + perf harness interaction scenarios on the build produced by `pnpm run build` meet the production-bundle baseline (click <= 200ms, selectionChanged <= 200ms, single-file merge <= 250ms on the 50-file scenario)
  + `NOTETHINK_DEV` gated features still function: file logger writes to `logUri`, webview cache-buster appends `?v=`
  + webview sources remain debuggable (source map resolves in webview devtools)
+ measured 2026-09-18 with `pnpm run test-perf`, both bundle modes on the same tree
  + the harness reports the React build it found in each: production mode "production React, minified, 3.95MB", dev mode "production React, unminified, 11.26MB"
  + 50-file interactions, dev bundle vs production bundle: click 154.7 vs 140.8ms, selectionChanged 85.9 vs 136.1ms, single-file merge 153.4 vs 119.6ms
  + every acceptance budget is met on the dev-workflow bundle, and the production run is green on all 16 metrics
  + this is dev vs production on today's tree, not the whole gap attributed to the React build: [[kanban-incremental-merge]] landed in between and cut card renders per update from 1022 to 34 at 500 cards, so both columns beat the 2026-07-07 baseline
  + one breach in the dev run, folder-load-20 at 528.5/490.5/502.9ms over a 485 budget calibrated on the production bundle
  + the breach is the unminified bundle, not React: dev minus production is a fixed cost that does not scale with board size, the shape of one-time lazy compilation
  + read the offset as a shape, not a figure: one set of runs gave 103 to 160ms across the four sizes, another gave 44ms at 20 files and 56ms at 200, and the two distributions nearly touch
  + what holds across both is that it does not grow with N, so it hits the smallest scenario hardest, which is why `folder-load-20` is the one that crosses
  + every count is identical in both modes, conversions 20/50/100/200 and board commits 1/2/4/9, so the difference is cost and not behaviour
  + resolved by scope rather than by tuning: the budgets are calibrated on the production bundle, so `--dev-bundle` reports breaches without gating on them
  + minifying the dev bundle would close it and cost the source-map readability and watch speed this story exists to protect
+ [X] wire NODE_ENV/production mode into the default build + watch for the webview bundle
+ [X] verify NOTETHINK_DEV logger + cache-buster still work in the dev host
+ [X] run test-perf against the dev-workflow bundle and record the delta in this story


### Incremental folder merge with stable card identity [](?id=kanban-incremental-merge&status=code-review)

The core structural fix. Today every incoming doc update rebuilds the entire merged tree: `FolderTreeComposer.tsx:56-72` re-runs `mergeAggregateRoot`, which re-runs `convertMdastToNoteHierarchy` for EVERY doc (`mergeAggregateRoot.ts:263`), and `walkStorySubtree` renumbers every note's `seq` globally (`mergeAggregateRoot.ts:203`), which defeats `areMarkdownNotePropsEqual` (`MarkdownNote.tsx:127` compares seq first) so every card re-renders. A progressive N-file load therefore does O(N^2) conversions and N full-board renders; one file changing (watcher event, or the drag write-back echo) re-converts all 200 files and re-renders 2000 cards.

+ goal
  + a doc update re-converts only the changed doc and re-renders only the affected cards
  + the post-drag authoritative echo lands well inside `KANBAN_PROJECTION_MAX_MS` (1500ms, `useProjectedNotes.ts:10`) so drops never snap back
+ background
  + measured: one-file merge on a 50-file board costs 155ms (prod) / 2758ms (dev) as a single long task; at 200 files this scales ~4x further and breaks the projection window
  + `renderCache` (renderops.tsx:82) is a WeakMap keyed on mdast node identity - unchanged docs keep identity across merges, so preserving NoteProps identity unlocks the whole memo chain
+ scope
  + cache per-doc `convertMdastToNoteHierarchy` results keyed on `(doc id, hash_sha256)`; invalidate on hash change or doc removal
  + make story/card identity stable across merges: derive per-story keys and memo checks from `stable_id` (already stamped) instead of the global seq; assign seqs deterministically per (file, story) so an unchanged file's notes keep their numbers when a sibling file changes
  + audit the in-place mutation in `walkStorySubtree` - a cached subtree must not be mutated into a state React cannot detect; clone story roots on stamp or version them explicitly
  + memoize `flattenAllNotes` (`NoteTreeComposer.tsx:47`) and stop sorting `notes_within_parent_context` inside render (`useViewContext.ts:80` mutates and sorts every render)
+ out of scope
  + message batching (see [[kanban-folder-load-coalescing]]) and windowing (see [[kanban-virtualized-columns]])
+ acceptance criteria
  + perf harness single-file-merge, 50-file board: no long task > 50ms (prod bundle)
    + NOT MET: 50 to 57ms across runs, with five of nine runs producing no long task at all
  + perf harness single-file-merge, 200-file board: no long task > 150ms (prod bundle)
    + MET: 73ms
  + the post-drag authoritative echo lands well inside `KANBAN_PROJECTION_MAX_MS`
    + MET on the webview half: 206 to 220ms against the 1500ms window; the extension half is unverified here
  + both elapsed targets were removed as instrument-bound, operator decision 2026-09-18
    + the harness carries a ~50ms three-frame settle floor under every `elapsed_ms`, so a <= 60ms target allowed about 10ms of real work
    + no implementation could have met it, which makes it a statement about the instrument rather than about the code
    + the long task is what tracks this change, so the criteria are expressed against it
  + conversion-call probe (debug counter exposed for tests): a one-doc merge converts exactly 1 doc on a 50-doc board
  + drag round-trip: folder-kanban-drag playwright specs stay green; add a spec asserting no snap-back with a simulated 200-file-scale echo delay
  + jest: unchanged docs' NoteProps (or their memo-relevant fields) are reference-stable across a merge; changed doc's notes re-derive
  + full `pnpm run check` green; all 106 playwright specs green
+ measured 2026-09-18 against the real bundle: the conversion cost is gone, and what remains is render
  + `mergeAggregateRoot` for a one-doc update: 50 docs 7.5ms uncached to 0.4ms cached, 200 docs 25.4ms to 1.4ms, 1 doc converted either way
  + echo to painted card: 178ms at 50 docs, 632ms at 200 docs, so at 200 docs the merge is 1.4ms of 632ms
  + the balance is React reconciliation and FLIP measurement over 2000 cards, which this story scopes out
  + corpus caveat: synthetic docs of 10 short stories each, not real 400KB done.md files, so a real board is larger
+ found and fixed 2026-09-18: the memo chain was defeated by this repo's own comparator, so identity alone bought nothing
  + `areMarkdownNotePropsEqual` compared @hello-pangea/dnd's `provided` bags by identity, and dnd rebuilds them on every render of its `Draggable`
  + a probe proved the values were identical every time, so every card re-rendered twice per update: 1022 renders against 506 mounted cards
  + `providedPropsEqual` now compares by value, bounded at one level of nesting; a diagnostic confirmed dnd's `innerRef` identity never changes, so skipping the repaint cannot strand it
  + card renders per update: 1022 to 34 at 500 cards and 4022 to 33 at 2000, so renders are flat in board size
  + the 34 are the changed file's own ten cards and 27 legitimate bails, whose `linetags_from` and `position.start.offset` genuinely moved
  + `draggableProps_identity_only` went from 1980 occurrences to zero
  + the `card_target_height` bail went from 1500 to zero, so the side by side target height was a victim of this defect and not a cause
+ measured and rejected 2026-09-18: memoizing `GenericNote` properly buys nothing, so it was not done
  + it already carries `React.memo` with the default shallow compare, which always fails because the parent rebuilds `display_options` every render
  + a three-arm A/B on a 506-card board: memo off 119.6ms at 1056 renders, a real comparator 121.6ms at 1051, and an always-equal arm 124.6ms at 6
  + so eliminating 1050 of 1056 executions moved elapsed not at all, and the always-equal arm bounds the ceiling at zero
  + the residual cost is React reconciling 506 mounted card subtrees and the FLIP measurement, which no comparator reaches
  + a working comparator would also need `handlers` and `display_options.selected_notes` stabilised in `KanbanBoard` and `useViewContext` first
+ residue 2026-09-18: the 50-file long-task criterion sits on its boundary and is the one thing not delivered
  + `folder-merge-50` post-fix over 9 harness runs: elapsed median 83.5ms, range 73.3 to 94.1, 1 conversion and 1 commit every run
  + five of the nine runs produced no long task at all, and the rest produced one of 50 to 57ms against a 50ms ceiling
  + trajectory: 155ms at the 2026-07-07 baseline, 105 to 130ms before the memo fix, 83.5ms median after it
  + `folder-merge-200` clears its 150ms ceiling comfortably at 73ms, so expressing the criteria against the instrument moved the shortfall from the large board to the small one
  + `folder-merge-200` now measures 206.4ms against the <= 120ms criterion, so it misses by ~1.7x, with 1 conversion and 1 commit
  + a pre-registered prediction of 450 to 650ms scaling linearly at 0.27ms per card was REFUTED, and the linear model is withdrawn
  + the real scaling is sub-linear: 4x the cards buys 1.5 to 2.2x the work once the ~50ms settle floor is backed out
  + so `windowing closes this` is an open question for [[kanban-virtualized-columns]], not an inherited conclusion
  + the linear model was fitted to a different event: the story's own probe moved a story from doing to done, a column change that fires the FLIP layer to re-measure every mounted node
  + the harness scenario appends a task instead, so no card changes column and no FLIP re-measure runs; turning animation off moved a 500-card read from 137.7ms to 104.5ms
  + two differences separate the two readings, update shape and bundle, and they have not been separated, so FLIP is not claimed to account for all of the gap
+ eliminated 2026-09-18, by measurement rather than by argument, as the source of the residual cost
  + per-doc conversion: 1 at both 50 and 200 files
  + MarkdownNote bodies: flat at 33 renders for both 500 and 2000 cards
  + GenericNote executions: eliminating 1050 of 1056 changed elapsed by nothing
  + `useViewContext`'s `deepest.note` memo never holds, since `parent_context` is a fresh object every render and `resolveFocusedNote` rescans ~8000 notes; fixing it changed nothing at any size and was reverted
  + what remains is React's own reconciliation and commit of mounted subtrees, the FLIP layer and dnd's machinery, none reachable without reducing mounted nodes
+ met 2026-09-18: the post-drag echo lands well inside `KANBAN_PROJECTION_MAX_MS` on the webview half
  + a 200-file merge update completes in 206 to 220ms against the 1500ms window, so over 1.2s of headroom
  + the extension half of the round trip belongs to other stories and is not measured here
+ handover to [[kanban-virtualized-columns]]: the interaction path is the sharper lead, not card count
  + `folder-selection-200` 466ms with a 327ms long task and `folder-click-200` 445ms, both with 0 conversions and 0 commits
  + that is a large interaction cost at 2000 cards with no merge in it at all
  + the `useViewContext` memo above is free to fix for whoever works that path
  + the echo criterion is met for the webview half only; end to end through the real extension host is unverified here
+ decided 2026-09-18: clone on stamp rather than version the stamped subtree
  + the stamp writes seq, level, parent_notes, origin and stable_id, so stamping a cached subtree changes what a card renders without changing what React compares
  + clones share the mdast `children` arrays, so renderops' WeakMap still hits
  + versioning was rejected: it hands React the same object and needs every memo comparison to opt in
+ consequence 2026-09-18: merged seqs are sparse, not contiguous, and are visible in `data-seq` and `v<view>-n<seq>` element ids
  + every lookup goes through `findNoteBySeq` or a comparator, so nothing indexes by seq
+ [X] add per-doc conversion cache keyed on (id, hash) with removal handling
+ [X] make seq assignment deterministic per file + story; key React and memo comparisons on stable_id
+ [X] resolve the walkStorySubtree mutation-vs-cache hazard (clone or version stamped subtrees)
+ [X] memoize flattenAllNotes and the parent-context sort
+ budgets, operator decision 2026-09-18: left at measurement + 20% as regression guards, not ratcheted
  + the interaction spread widens under machine load, `folder-click-50` ranging 144 to 192ms across captures on one tree, so a tight budget becomes a flake generator
  + a gate that cries wolf gets ignored, and an ignored gate is worse than none
  + the sharp assertions carry the weight instead: conversions and board commits held at exactly 1/1 through every run including a breaching one
+ [X] add the conversion-call probe + jest coverage; ratchet perf budgets


### Folder-load batching and update coalescing [](?id=kanban-folder-load-coalescing&status=code-review)

Initial folder discovery streams one postMessage per file (`PanelSession.ts:826` fan-out, `:912` per-file merge update), and the webview commits a full state update per message (`useVscodeMessages.ts:245`), so a 200-file load produces 200 board renders plus a final aggregate replace. Measured: 20 files 5.3s, 50 files 9.2s (prod), 200 files 211.8s; the per-message costs (render + FLIP re-measure + persist) multiply with the O(N^2) merge fixed in [[kanban-incremental-merge]].

+ goal
  + a 200-file folder load reaches a settled board in seconds with bounded, small long tasks, while still showing progressive fill (spinner + growing board), not a blank wait
+ scope
  + extension: batch per-file merge updates during discovery - flush every ~100ms or every ~20 docs, whichever first; watcher-driven single-file updates keep streaming individually
  + webview: coalesce incoming update messages within an animation frame into one setState (queue + rAF flush in useVscodeMessages); message validation unchanged
  + keep the pendingChange spinner semantics (`pending-work-spinner` specs must stay green)
+ out of scope
  + changing the wire payload shape (see [[folder-wire-payload-diet]])
+ acceptance criteria
  + perf harness folder-200 progressive scenario: settled in <= 15s on the prod bundle with [[kanban-incremental-merge]] landed; no single long task > 500ms after the first paint
  + board commit probe: <= 15 board-level commits for a 200-file load (vs ~200 today)
  + progressive fill still visible: harness asserts cards appear before the final flush (not one big bang)
  + all pending-work-spinner + folder playwright specs green; `pnpm run check` green
+ found and fixed 2026-09-18: a queued batch could post a stale doc over a fresher watcher copy
  + discovery queued `f0` version A, a watcher then read and posted version B, and the flush posted the queued A after it
  + the same window let a flush resurrect a doc a tombstone had just dropped
  + both self-corrected at the aggregate replace, so the board held the wrong state until then
  + fix: the batch holds doc ids, not snapshots, and resolves each against `integration_docs` at flush time, skipping ids no longer present
+ measured 2026-09-18 on the production bundle, once the harness modelled the batched wire
  + folder-200 settled 124 to 195s before, 10.7s after, board commits 199 to 9
  + folder-100 28 to 40s to 2.5s at 99 to 4 commits; folder-50 6.4 to 9.2s to 0.82s at 49 to 2; folder-20 1.3 to 1.7s to 0.38s at 19 to 1
  + settled <= 15s is MET at 10.7s, and <= 15 board commits is MET at 9, the budget flipped to 15 after seeing the number rather than on the prediction
  + the aggregate replace costs 0 commits, since `mergeUpdatedDocs` finds nothing changed and returns the same object
  + `folder-long-files-10` is unchanged at 7.3s and 7 commits, correctly: 10 docs sit under the 20-doc cap and arrive slower than the 100ms timer
+ open for the operator 2026-09-18: the criterion says `after the first paint` and the instrument does not measure that
  + the harness's long-task window opens at FIRST DISPATCH, so it counts the initial mount a user genuinely waits through
  + at 50 files the peak at +224.8ms IS the first commit's mount at +214.0ms, which a literal reading of the criterion would exclude entirely
  + the measure was deliberately NOT changed to fit the wording, and the mismatch is documented in the page-agent header and `budgets.mjs`
  + immaterial at 200 files, where the peak at +7599ms is unambiguously after first paint
+ residue 2026-09-18: no long task > 500ms after first paint is NOT met, and most of the height is not batching's
  + measured against the unbatched control: 200 files 1410ms to 1829ms, a 1.3x rise, against an 11x cut in elapsed and an 18x cut in long-task total
  + at 50 files the rise is 1.8x over six paired same-run samples, 234 to 284ms unbatched against 452 to 478ms batched, and every batched sample is still under 500ms
  + the ratio falls with N because the accumulated-docs term dominates as the corpus grows
  + a prediction that the peak would be roughly unchanged was REFUTED: there is a real batch-size term, second order at large N rather than absent
  + attribution by the probe's own `at` stamps: every peak lands on a commit, so the cost is merge and render downstream, not the drain
  + commit spacing on the batched 200 run, 457 to 2066ms between successive commits each carrying an identical 20 docs, is the accumulated-docs scaling made visible
  + so [[kanban-incremental-merge]] must bring the ceiling down from ~1410ms on the old wire, not from 1829ms: only the 1.3x is attributable here
  + provenance, and the thin number is the TARGET rather than the ratio: the batched 200-file arm has six tight measurements from 1791 to 1847ms
  + the ~1410ms unbatched control is a SINGLE sample, so the figure to treat with caution is the one this sets as [[kanban-incremental-merge]]'s target
  + the 50-file pair is six paired same-run samples and is firm in both arms
  + the 200-file control came from a one-off scenario that was removed again, so the permanent set is unchanged at 10
  + measured and NOT pulled: ramping the batch size cannot move the 200-file peak, which lands on the 8th flush where batch size is only the 1.3x
+ found and fixed 2026-09-18: the tombstone regression test carried a pre-existing race in its own synchronisation helper
  + `discoverHoldingOneFile` drained a fixed five event-loop turns while `generateIdentifier` hashing is genuinely async and no host call marks its end
  + five turns was always marginal; a second start-up task in the panel was enough to lose the race in 2 runs of 5, and 30 turns passed 6 of 6
  + diagnosed by measurement: the chosen watcher was the folder watcher in failing runs too, so watcher selection was never the cause
  + the failing runs simply posted no tombstone, because `handleFolderDocDeleted` only posts one for a doc already in `integration_docs`
  + the drain is now generous and a new guard asserts the batch is still queued, so a scenario that collapses into testing nothing fails loudly instead of passing
+ [X] batch discovery-phase merge posts in PanelSession with a flush timer + size cap
+ [X] coalesce webview update handling into per-frame state commits
+ [X] add a board-commit probe for the harness; assert progressive fill + budgets


### Virtualized kanban columns [](?id=kanban-virtualized-columns)

Every card mounts into the DOM: 200 files x 10 stories = 2000 `Draggable` cards (`KanbanBoard.tsx:96-127`), each rendering markdown, and the FLIP layer measures every `[data-flip-id]` node with getBoundingClientRect on each membership change (`useFlipTransition.ts:292`, fired per merge via the `signature` memo). CPU profiles show querySelectorAll + getAnimations at ~9-12% of load. @hello-pangea/dnd officially supports virtual lists (react-window pattern, overscan required). The factor-out this story asked to coordinate with is now [[line-view]], and the ordering is resolved: it lands FIRST, so windowing is implemented once in `LineView` and every grouped view inherits it. This is the only story in the perf cycle that the view programme blocks.

+ goal
  + DOM card count is bounded by viewport + overscan regardless of corpus size; scrolling a column streams cards in (the infinite-scroll feel)
  + FLIP measurement cost scales with visible cards, not total cards
+ scope
  + adopt react-window (or equivalent fixed/variable-size list) per kanban column following the dnd virtual-lists pattern, with overscanning and drag-clone rendering per their docs
  + variable card heights: measure-and-cache strategy (cards clip to a max height already via useMarkdownNoteOverflow)
  + scroll-to-focused-card (`useScrollToCaret`, viewhooks.ts) must ask the virtualizer to scroll before framing; keyboard navigation and the focus ring rules (CODING_STANDARDS Focused-note scroll framing) still hold
  + FLIP: restrict measure/animate to mounted (visible) cards; skip animation entirely when a membership change exceeds a threshold (bulk load)
  + land inside `LineView` so grouped views inherit it - [[line-view]] is a hard prerequisite, not a coordination question
+ out of scope
  + virtualizing document view (different scroll model; follow-up once LineView ships)
+ acceptance criteria
  + 200-file board: mounted cards <= visible + overscan (assert via DOM count in the harness); folder-200 settled load <= 8s prod with prior stories landed
  + card click and selectionChanged on the 200-file board <= 200ms with no long task > 100ms
  + all kanban drag playwright specs green, including cross-column drags of cards that start off-screen (add spec)
  + keyboard navigation + focused-card scroll framing specs green (focus ring fully visible per CODING_STANDARDS)
  + kanban-animation specs green with FLIP scoped to visible cards; bulk-load renders skip animation (assert via animation probe events)
+ [ ] implement windowed lanes inside `LineView` per the dnd virtual pattern (after [[line-view]])
+ [ ] wire scroll-to-focus + keyboard nav through the virtualizer
+ [ ] scope FLIP to mounted cards + bulk-change skip; keep animation probe coverage
+ [ ] add off-screen drag + DOM-bound assertions to playwright; ratchet perf budgets


### Webview state persistence diet [](?id=webview-state-persistence-diet)

`useVscodeStatePersistence` calls `vscode.setState({docs, viewStates})` on every docs change (`usePersistedViewStates.ts:78-82`), serializing the full docs map - text plus mdast at 6.2x text size - once per incoming message. On a 200-file load that is ~200 serializations of a growing multi-MB object; profiles show setItem/setState at 2-3% even in the mock, and the real VS Code setState crosses an IPC boundary. It is also a memory-pressure contributor to the observed renderer crashes (docs map + persisted copy + NoteProps trees).

+ goal
  + setState payloads become small and infrequent; reload still restores the board without a blank flash
+ background
  + reload already re-requests state: the webview replays setIntegration + requestInitialState on mount (`useVscodeMessages.ts:330-368`), and the extension's discovery fast-path skips reloading unchanged files via mtime (`PanelSession.ts:839`)
+ scope
  + persist viewStates always; persist doc METADATA only (id, path, relative_path, hash, mtime) instead of full text + mdast
  + debounce persistence (e.g. 500ms trailing) and flush on visibilitychange/dispose
  + reload path: render from re-requested extension state; verify the folder restore flow needs no persisted doc bodies (fast-path makes this cheap)
  + migrate old persisted shapes via migrateSavedState (vscodeops.ts) so stale full-doc states load cleanly once then shrink
+ acceptance criteria
  + setState payload per persist <= 100KB on the 200-file board (probe in harness mock)
  + persist frequency during a 200-file load <= 5 calls (debounced), not ~200
  + reload of a folder-mode board restores columns/cards without error and without a persisted-docs dependency (playwright reload spec)
  + `pnpm run check` green
+ [ ] slim the persisted shape to metadata + viewStates with migration
+ [ ] debounce persist + flush on hide/dispose
+ [ ] add payload-size + frequency probes and a folder reload spec


### Folder wire-payload diet (no mdast over the wire) [](?id=folder-wire-payload-diet)

Every Doc ships `text` plus the full mdast `content` (6.2x text) through postMessage (`PanelSession.ts:178,912`): a 200-file folder load transfers ~9.3MB, a single 400KB done.md re-send ~2.6MB, and serialization blocks both the extension host and the webview realms. The webview then derives its own NoteProps hierarchy anyway and caps each file at maxNotesPerFile=10 stories - most of the shipped tree is discarded. Design-first story: pick and prove one of the two payload shapes below, then implement.

+ goal
  + folder-mode wire payload per file scales with what the board renders (capped stories), not file size; memory footprint stops duplicating full mdast per doc
  + unlocks raising MAX_AGGREGATE_FILES (today 200, workspace has ~601 files) and file-level lazy loading
+ constraint from [[group-by-enumeration]] - whichever option wins
  + group-by candidates are enumerated from `note.linetags`, so the wire shape MUST preserve every linetag on whatever it ships
  + option A is the exposed one: a digest that drops or summarises linetags silently shrinks the group-by selector's options
  + option B is safe by construction - the webview parses the text itself, so every linetag survives
+ option A - ship digests
  + extension converts to hierarchy + applies the per-file story cap host-side, ships only capped story subtrees (NoteProps + the text slices those stories cover, with source offsets preserved in origin.source_position)
  + conversion code is pure TS in notethink-views; the extension bundle can import it (verify webpack config supports the cross-package import; the mirrored-constants exception in CODING_STANDARDS documents why modules are not currently shared - this import goes the allowed direction, webview package -> extension consumer)
  + edits still route by source offsets, so buildKanbanDragEndPayload and editText flows are unchanged
+ option B - ship text only
  + drop `content` from the wire Doc; the webview parses text in a Web Worker (workers in webviews load via blob: URI per the VS Code webview docs) and feeds the existing convertMdastToNoteHierarchy path
  + keeps one parser location but moves parse cost into the webview; combine with [[kanban-incremental-merge]] caching so each file parses once per hash
+ scope
  + spike both options against the perf harness long-files scenario (50 files with 10x400KB); pick by measured payload, settle time, and memory; record the decision in this story
  + implement the winner behind the existing message validation; update playwright helpers (inject-docs/inject-multi-docs build wire docs) and fixtures accordingly
  + document view (current_file mode) keeps full text + mdast for the active doc - only folder aggregation goes on the diet
+ acceptance criteria
  + wire payload for one 400KB file's folder update <= 100KB (measure serialized message size in the harness)
  + folder-50-with-long-files scenario: settled <= 6s prod (baseline 40s dev / to-be-measured prod); no renderer crash at 200 files under the harness memory probe
  + drag write-back, click-to-editor reveal, and caret matching still work in folder mode (existing folder specs + drag roundtrip specs green)
  + `pnpm run check` green
+ [ ] spike option A vs B on the harness; record numbers + decision here
+ [ ] implement the chosen shape end-to-end (PanelSession, Messages types, useVscodeMessages, composers, playwright helpers)
+ [ ] add payload-size + memory probes; ratchet budgets and raise-cap follow-up note


### Extension parse offload and adaptive debounce [](?id=extension-parse-offload)

mdast parse costs 0.6ms/KB on the extension host: each debounced keystroke on a 400KB done.md re-parses for 230ms (800KB: 509ms) on the same web worker that services every other extension request, and initial folder discovery parses up to 200 files inline (620ms for 200x8KB, several seconds with real done.md sizes). The web extension host supports spawning nested Web Workers (VS Code web-extensions guide), which is the safe first step; a WASM parser (markdown-rs, micromark's Rust sibling, via the @vscode/wasm toolchain) is the escalation if parse itself remains the bottleneck after offload.

+ goal
  + typing in a large file never saturates the extension host; parse work happens off the host thread and only the final result crosses back
+ scope
  + move parse() calls (buildDoc / buildDocFromUriAndText / loadFolderDoc paths in PanelSession) onto a worker pool (size ~cores/2, bounded queue); results post back as the existing Doc shape
  + adaptive debounce: scale CHANGE_DEBOUNCE_MS (PanelSession.ts:13) with the last parse duration for that doc (floor 250ms, cap ~1s) so big files self-throttle
  + drop stale parses: a newer edit for the same doc cancels the queued/in-flight older parse
  + verify worker creation works in both desktop (webWorker extension host) and vscode-test-web; feature-detect and fall back inline if Worker is unavailable
+ out of scope
  + WASM parser swap - leave a spike task with clear go/no-go criteria instead of committing to it
+ acceptance criteria
  + extension jest: worker pool parses and returns identical mdast to inline parse for fixture corpus; stale-parse cancellation covered
  + keystroke scenario: webview receives the re-send and the extension host stays responsive - measure by interleaving a settings round-trip during a 400KB keystroke storm in the harness (round-trip latency <= 100ms)
  + folder discovery of the long-files scenario does not block watcher/selection handling (same interleaving probe)
  + `pnpm run check` green including the extension Mocha suite
+ [ ] implement the parse worker pool with fallback + stale cancellation
+ [ ] make the change debounce adaptive to measured parse cost
+ [ ] add the host-responsiveness interleaving probe to the perf harness
+ [ ] write the markdown-rs/WASM spike task with go/no-go criteria (mdast position-compatibility, payload parity, measured speedup >= 3x) as a follow-up candidate for the user to green-light


### Multi-view management [post-v1]

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


### Convert top-level 'docs' container to RootNote [post-v1]

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


### Optimisation review 2026-07 for notethink

Systemic findings from a deep multi-agent optimisation review (scout + 5 dimension reviewers + synthesis + per-item adversarial verification against the code, 2026-07). The review independently converged on the existing kanban perf cycle and verified its premises at specific sites; the tasks below are the additional findings not already scoped there.

+ verified and already scoped in the perf cycle - no duplicate tasks here, evidence recorded for confidence
  + per-doc conversion caching keyed on (id, hash): confirmed missing in folder mode (single-file NoteTreeComposer already memoises on hash; folder merge and useAutoIntegration both re-convert) - covered by [[kanban-incremental-merge]]
  + folder-entry message storm: confirmed per-file posts then a whole-map aggregate re-post (double-ship), no batching on the host side - covered by [[kanban-folder-load-coalescing]]
  + full-corpus setState per edit tick incl. mdast: confirmed synchronous, undebounced - covered by [[webview-state-persistence-diet]]; small delta: also release the module-scope saved_state pin (ExtensionReceiver.tsx:22) after first consumption to free the restored corpus

+ [ ] Restore webview code splitting: drop LimitChunkCountPlugin and switch chunk loading to browser-style
  + the single-bundle constraint applies to the extension host only; the webview config also declares target 'webworker' (webpack.config.js:111), so set target 'web' or output.chunkLoading 'jsonp' for the webview config alongside removing the plugin (webpack.config.js:164)
  + React.lazy splitting is already written but collapsed: GenericView lazy-loads the views and GenericNote lazy-loads MermaidNote (mermaid's static import lives only inside that lazy subtree); built dist/index.js is currently 11.9MB dev
  + set __webpack_public_path__ from asWebviewUri and __webpack_nonce__ so injected chunk script tags pass the CSP (notethinkEditor.ts:83); the extension-host config's LimitChunkCountPlugin (webpack.config.js:76) must stay
  + retainContextWhenHidden (notethinkEditor.ts:16) means every hidden tab keeps the whole parsed bundle resident today
  + refs: webpack.config.js:164, webpack.config.js:111, client/webview/src/notethink-views/src/components/views/GenericView.tsx:15, client/webview/src/notethink-views/src/components/notes/GenericNote.tsx:11, client/extension/src/vscode/notethinkEditor.ts:16
  + impact: multi-MB less JS fetched and parsed on every panel open; users who never render a diagram stop paying for mermaid entirely; effort: M

+ [ ] Cut extension-host startup and vsix weight: trim activation events and replace winston with the native LogOutputChannel
  + activationEvents include onStartupFinished and onLanguage:markdown, but activate() only registers the custom editor, a webview serializer and commands - onCustomEditor/onWebviewPanel suffice, so the 666KB bundle currently loads in every VS Code window for nothing
  + winston wraps an output channel created with {log:true} that natively provides levels and timestamps (file logging is separately hand-rolled via workspace.fs); deleting winston removes 11 root polyfill deps and the webpack resolve.fallback list
  + vscode-languageclient 9.0.1 is declared with zero usages (grep-verified); drop it
  + .vscodeignore's 'dist/**/test/**' is anchored at the package root and does not match client/extension/dist/test/**, so a 361KB dead mocha bundle ships in every marketplace vsix - fix the glob
  + refs: package.json:31, client/extension/src/lib/errorops.ts:94, webpack.config.js:46, .vscodeignore:7
  + impact: zero startup cost until first NoteThink use and a 70-80% smaller extension bundle for every install; effort: M

+ [ ] Hoist stable handler and display_options objects so GenericNote's React.memo stops whole-tree reconciles
  + GenericNote is React.memo with default shallow equality, but KanbanBoard passes fresh display_options and handlers object literals per Draggable render, and buildChildNoteDisplayOptions allocates a new object per call - the memo never passes
  + DocumentView already hoists stable note_handlers via useMemo but still calls buildChildNoteDisplayOptions inline, so its props stay unstable too; useViewContext also rebuilds display_options and sorts in place per render
  + add a custom areEqual on note identity plus focus/selection scalars; derive per-note flags at the view level; complements the stable_id/seq work in [[kanban-incremental-merge]]
  + cheap follow-on: content-visibility:auto on cards to skip offscreen layout until [[kanban-virtualized-columns]] lands
  + refs (client/webview/src/notethink-views/src/): components/notes/GenericNote.tsx:15, components/views/kanban/KanbanBoard.tsx:101, lib/noteui.ts:265, components/views/generic/useViewContext.ts:41
  + impact: caret movement and typing become O(affected notes) instead of O(all notes), attacking the documented 50k-fibers-per-commit crash cliff; effort: M

+ [ ] Hash-gate and visibility-gate PanelSession posts (small delta to [[kanban-folder-load-coalescing]])
  + watcher onDidCreate/onDidChange and sendDoc never compare hash or mtime before re-parsing and re-posting, so every save ships the doc twice
  + no webviewPanel.visible check gates background work anywhere in PanelSession - hidden and duplicate panels run the full pipeline
  + fold into the coalescing story when picked up, or land as a small standalone
  + refs: client/extension/src/vscode/PanelSession.ts:964, client/extension/src/vscode/PanelSession.ts:166
  + impact: eliminates redundant parse and post work on every save and for hidden panels; effort: S


### Make the mocha web-extension suite runnable [](?id=mocha-web-suite-runnable)

`client/extension/src/test/suite/` is a real suite that no script runs and that cannot currently produce a
result. It is excluded from `jest.config.cjs`, so nothing in `pnpm run check` touches it, and the tests in
it are edited by hand whenever a command is retired without anyone finding out whether they still pass.

+ background - measured 2026-09-07, driving it by hand
  + the runner is a WEB extension suite: `require('mocha/mocha')` plus `require.context`, so it runs under `@vscode/test-web`, which is already a devDependency and already builds as a webpack entry to `client/extension/dist/test/suite/index.js`
  + the invocation is `vscode-test-web --browserType=chromium --headless --port=<free> --extensionDevelopmentPath=. --extensionTestsPath=./client/extension/dist/test/suite/index.js ./docstech`
  + it fails with `ReferenceError: document is not defined` inside `new HTML` before any test runs: `mocha.setup({ reporter: undefined })` leaves mocha's browser default, the HTML reporter, which builds a fragment through `document` - and an extension host is a worker
  + naming a built-in reporter by string does not fix it, because the browser bundle resolves an unknown name through `require`, which webpack cannot serve inside the bundle it just built; a reporter FUNCTION does clear the crash
  + the host drives `mocha.run` itself as soon as the mocha global exists, and does not wait for the exported `run()` - measured by placing a `throw` first inside `run()`, which never fired while the reporter's ReferenceError did
  + so setting the reporter inside `run()` is too late; setting it at module scope clears the crash and the run then HANGS instead, because the tests are registered by an `importAll` that only `run()` reaches
  + extension-host `console` output is not forwarded to the terminal, so a console-printing reporter reports nothing; the exit code is the only channel that currently carries a result
+ [ ] settle who drives the run - register the tests at module scope, or stop the host driving mocha itself
+ [ ] supply a worker-safe reporter function, since the HTML default cannot work in an extension host
+ [ ] add a `test-mocha` script and put it in `pnpm run check`
+ [ ] confirm the suite actually passes, and fix whatever it finds - it has never been run, so it has never been green
+ acceptance criteria
  + `pnpm run test-mocha` exits non-zero on a deliberately broken assertion and zero otherwise
  + a retired command breaks the suite rather than being quietly edited out of it
