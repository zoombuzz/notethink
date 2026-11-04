# Todo [](?nt_view=kanban)


### README prose on one line per paragraph [](?status=code-review&id=readme-reflow)

Most of `README.md` writes each paragraph and list item as one line that the editor soft-wraps, but the Agent activity, agent registry and progress pie sections, and a few intro lines, are hard-wrapped at about 100 characters. One transcripts paragraph now mixes both. Rejoin the hard-wrapped prose so the whole file reads one way.

+ background
  + measured: about 66 hard-wrapped lines, most of them in Agent activity, The agent registry and Story progress pie; Features, Setup, Testing, Known Limitations and Contributing are already one line per paragraph or bullet
+ approach
  + reflow only: join each hard-wrapped paragraph, list item and its continuation lines into one line, with no change of wording
  + leave code fences, tables, headings and deliberate line breaks as they are
  + the rendered markdown must be identical before and after
+ decision 2026-11-04: markdown prose in this repo is written one line per paragraph or list item, never hard-wrapped
+ [X] rejoin every hard-wrapped paragraph and list item in `README.md` into one line
+ [X] show the rendered output is unchanged and the only differences are line breaks turned into spaces
+ rejoined 67 hard-wrapped lines in `README.md` (intro, Opening a file, Agent activity, The agent registry, Story progress pie); the file is identical once whitespace is collapsed and parses to the same markdown tree


### Progress pie matches the project pill [](?id=pie-matches-pill&status=code-review)

The progress pie from [[story-progress-pie]] fills in a fixed green and sits apart from the project pill. Drawn in the pill's colour and on the pill's line, the two read as a matched pair of dots at the top of each card.

+ background
  + measured: `OriginPill.tsx` colours the pill with `pillColourForHue(hueForOrigin(origin), theme)` (`originops.ts`), the hue the sticky card shares
  + measured: `MarkdownNoteHeadline.tsx` renders both the pill and `StoryProgressPie`
  + measured: the pie's filled wedge uses `--vscode-charts-green`; its unfilled part is grey
+ approach
  + the filled wedge takes the same colour as the card's project pill, through the same hue and theme helpers
  + the unfilled part stays grey, so the pie fills with the pill's colour as tasks complete
  + the pie sits on the pill's horizontal line, centred on the same axis and at the same size, so the two read as a pair of dots
  + a card with no pill keeps the pie in its current place and colour
+ decision 2026-11-03: the pie's completed share is drawn in the project pill's colour, and the pie lines up with the pill at the top of the card
+ open question: the coloured wedge has weak luminance contrast against the grey remainder for about half of project hues (computed: 1.05:1 to 2.7:1 in dark, 1.0:1 to 2.05:1 in light, below 1.5:1 for 184 of 360 hues dark and 205 light); it still reads by hue. Keep it, or give the grey remainder a theme-aware lightness, or outline the pie? Recommendation: a thin outline in the editor's muted foreground, which keeps both colours as asked and gives the disc a clear edge.
+ [X] colour the pie's filled wedge from the card's pill colour, keeping the grey remainder
+ [X] align the pie with the pill on one line at the same size, in the card, sticky and agent card types
+ [X] cover the colour and the no-pill fallback in `StoryProgressPie.test.tsx`
+ [X] assert the pie's colour matches the pill and their vertical centres align in `story-progress-pie.spec.ts`
+ [X] bump the patch version, once for the batch: skip it if the version is already above the last commit's


### Agent tree behaves like a VS Code tree [](?id=agent-tree-vscode&status=code-review)

The agent card's rows read as a flat list with a "Show N earlier finished subagents" link. A reader expects a tree like VS Code's own: each agent expands to show what runs inside it, and finished subagents stay out of the way until asked for.

+ background
  + measured: `AgentChildRows.tsx` shows running subagents plus the latest three finished, folding earlier ones behind "Show N earlier finished subagents"
  + measured: a main row's rail covers that row only; each subagent row has its own indented rail
  + VS Code trees draw a chevron on each expandable item and an indent guide down each expanded group
  + no PATTERNS.md entry for a nested tree inside a card; follow VS Code's own tree
+ approach
  + every agent row with subagents is a tree item with a chevron
  + it is expanded by default while the agent is working or waiting, and collapsed otherwise
  + an expanded agent's rail runs the full height of its group, as VS Code's indent guide does, coloured by its state
  + so its subagents sit visibly inside it
  + every finished subagent is hidden behind one "Show N finished subagents" item; none show by default
  + anything nested deeper follows the same expand and collapse model
  + keyboard and screen readers get the tree pattern: `tree` and `treeitem` roles, `aria-expanded`, Right and Left arrows to expand and collapse
  + an expand or collapse the reader chose survives snapshot updates for that session
+ decision 2026-11-03: the agent rows look and behave as close to a VS Code tree as they can, with the state-coloured rail serving as the group's indent guide
+ [X] make each agent row with subagents an expandable tree item, expanded by default while working or waiting
+ [X] draw the agent's rail down its whole expanded group as the indent guide
+ [X] hide every finished subagent behind one "Show N finished subagents" item
+ [X] add the tree roles, `aria-expanded` and arrow-key handling
+ [X] keep each session's chosen expansion across snapshot updates
+ [X] cover expansion defaults, the finished item and the keys in jest
+ [X] update `agent-session-tree.spec.ts` for the tree, the guide and the keyboard path
+ [X] describe the tree in the Agent activity section of `README.md`
+ [X] bump the patch version, once for the batch: skip it if the version is already above the last commit's


### Quieter agent row header [](?id=agent-row-header-quiet&status=code-review)

An agent row's header carries the monogram, session name, model, state label and clock. On a narrow card that is too much to read at a glance.

+ background
  + measured: `AgentSessionRow.tsx` prints a state label from `agentStateLabel`, such as "Working" or "Waiting on you"
  + the story's own headline already says when an agent is waiting on the reader, and the rail colour shows the state
  + the model is the least useful field on the row
+ approach
  + drop the "Working" and "Waiting on you" labels from agent rows; keep the label for any other state
  + header order: monogram, session name, clock, then model
  + the live line (current command or prompt) stays on its own line under the header
  + when the header runs out of room the model hides first, then the clock; the session name stays
  + done in CSS, such as a container query or flex order, with no measuring in script
+ decision 2026-11-03: running rows do not repeat "Working" or "Waiting on you", and the model gives way to everything else
+ [X] drop the working and waiting labels from agent rows and their subagent rows
+ [X] reorder the header and hide the model, then the clock, when space runs out
+ [X] update the jest tests on the state labels
+ [X] update the narrow and wide layout cases in `agent-card.spec.ts` and `agent-session-tree.spec.ts`
+ [X] bump the patch version, once for the batch: skip it if the version is already above the last commit's


### Oversized transcripts are read from their newest end [](?id=transcript-tail-over-bound&status=code-review)

A transcript over the size bound is refused whole, so its session draws a "could not be read" card with no activity, even though its newest part is what the board needs.

+ background
  + measured: `transcriptSizeRefusal` (`AgentAnalyserWorker.ts`) refuses any transcript over `AGENT_TRANSCRIPT_MAX_BYTES` (64 MiB, `agentvendorops.ts`) as `too_large`
  + measured: a 78.5 MB transcript, last written 16 days earlier and no longer live, draws a card carrying that refusal
  + inferred: a refused session carries state `unknown`, which [[quiet-idle-agents]] counts as live, so a long-ended session keeps its card
+ approach
  + read the newest 64 MiB of an oversized transcript, from the first complete line, and analyse it as the session
  + mark such a session as read from its tail, so its usage and time say they cover the newest part only
  + an oversized session takes its liveness from the vendor's live session record like any other, so an ended one draws no card
  + the same rule covers every vendor whose transcript can pass the bound
  + the tail cache and resumed reads keep working for a tail-read transcript
+ decision 2026-11-03: over the bound, analyse the newest part of the transcript up to the bound instead of refusing it
+ open question: the crop keeps whole lines only, so one giant line straddling the window start leaves far less than the bound (measured: a 77.5 MB transcript kept 30 KB, a 113.7 MB one kept 32 MB). Keep it as designed, or skip a giant line and keep filling the bound from the lines before it? Recommendation: keep it, since such transcripts are usually old and outside the 30-day window.
+ [X] read the newest bound's worth of an oversized transcript from its first complete line
  + the worker crops a whole job (`cropToNewestBytes`) and trims a resumed one to the bound; the vendor readers no longer judge size, and `too_large` is gone from the refusal codes
+ [X] mark tail-read sessions and say so beside their usage and time
+ [X] give a tail-read session its liveness from the live session record
+ [X] keep the tail cache and resume path correct for tail-read transcripts
+ [X] replace the `too_large` jest cases with tail-read cases, including an ended oversized session that draws no card
+ [X] add a Playwright case for a tail-read session's note
+ [X] bump the patch version, once for the batch: skip it if the version is already above the last commit's


### Idle agents stop reordering columns [](?id=quiet-idle-agents&status=code-review)

On a board grouped by project with agent cards, a project where nothing is happening keeps moving to the newest end, and one live coordinator can show as several cards.

+ background
  + measured: a card for a session bound to no story is timed by `session.updated_at` (`cardregistryops.ts` `agentOrderTimestamp`), the latest record in its transcript
  + measured: an idle coordinator wakes every 30 minutes to re-arm its watcher, adding transcript records, while its registry entry, mailbox, run directory and board stay unchanged
  + measured: `unboundSessions()` (`agentactivityops.ts`) keeps every unbound session from the 30-day window, ended ones included
  + so one repo shows a card per old session beside its one live agent
  + no PATTERNS.md entry for activity-based ordering; new
+ approach
  + a session bound to no story gives its column no ordering time
  + a column is timed by its stories: `storyLastActiveMs`, the bound story's `last_at`
  + a card for an unbound session is minted only while that session is live (working, waiting or idle), never once it has ended
  + a session bound to a story shows inside that story's card, never as a separate card; keep this covered
+ decision: a session in state `unknown` (a vendor that cannot report liveness) counts as live, so a running codex or grok agent stays visible
+ decision 2026-11-03: ended sessions with no story are hidden completely, with no per-column ended count
+ [X] stop `agentOrderTimestamp` timing a virtual note from its session's `updated_at`
+ [X] admit only live sessions in `virtualNotesForActivity`
+ [X] update `cardregistryops.test.ts`, `agentactivityops.test.ts` and `grouporderops.test.ts` for both changes
+ [X] update `group-order-saved-type.spec.ts`, whose session `updated_at` ordering test asserts the old contract
  + its ordering tests use sessions bound to stories, which still order by `last_at` or `updated_at`, so they hold unchanged
+ [X] add a spec where a newer record on an idle unbound session leaves the column order unchanged
+ [X] bump the patch version, once for the batch: skip it if the version is already above the last commit's


### Session cards show the agent and session name [](?id=agent-session-card-title&status=code-review)

A card for an agent with no story reads `claude-code in notegit`: the vendor slug, and the project the column already names. It should name the session instead, such as `CC coord-notegit`.

+ background
  + measured: the headline is `unboundSessionHeadline` (`agentactivityops.ts`), built as `${vendor} in ${project}`
  + measured: Claude Code's live session files, read by `claudeLiveSessions` (`AgentAnalyser.ts`), carry a `name` field that nothing reads
  + measured: `vendorMonogram` derives the monogram from the slug; the only display names are `CHAT_VENDOR_LABELS` (`ChatTranscriptView.ts`)
  + measured: `agent-card.spec.ts` and `AgentNote.test.tsx` assert the slug headline
+ approach
  + headline: the vendor monogram, then the session name, such as `CC coord-thinkersync`, with no project
  + name order: the vendor's own session name, then the registry agent name from [[agent-registry-source]], then a short session id
  + the headline takes a vendor colour token, so it reads differently from a story title
  + one vendor display table (slug, monogram, label, colour token) in one module
  + cards, session rows and the chat panel all read it, so CC means the same everywhere
  + an unknown vendor still gets a derived monogram and its slug as label
+ decision 2026-11-03: session cards read `CC <session name>`, such as `CC coord-<project>` where that is the session's name
+ [X] read the session name from Claude Code's live session file into `ActivitySession`, in both type mirrors
+ [X] read a session name for Codex and Grok where their files carry one
  + measured: neither reader parses a name (`codexops.ts` skips `session_meta`; `grokops.ts` reads only `events.jsonl` and `usage.json`), so those cards fall back to the short session id
+ [X] add the vendor display table and point `vendorMonogram`, the session rows and the chat panel labels at it
+ [X] build the virtual note headline from the monogram and session name, in the vendor colour
+ [X] update the jest and Playwright assertions on the old headline and cover the name fallback order
+ [X] note the session name in the Agent activity section of `README.md`
+ [X] bump the patch version, once for the batch: skip it if the version is already above the last commit's


### Agent cards show the story's linetags [](?id=agent-card-linetags&status=code-review)

The ordinary card lists a story's linetags, such as `status=doing` and the time tags. The agent card shows only the headline, so a board of agent cards hides which stories are in the batch.

+ background
  + measured: `MarkdownNote.tsx` appends `GenericNoteAttributes` when a note has linetags
  + measured: `AgentNote.tsx` renders `MarkdownNoteHeadline` and never `GenericNoteAttributes`
+ approach
  + render `GenericNoteAttributes` under the headline in `AgentNote`, under the same condition as `MarkdownNote`
  + a virtual note has no linetags and renders none
+ [X] render the linetag row on the agent card
+ [X] cover it in `AgentNote.test.tsx`
+ [X] add an `agent-card.spec.ts` case where a story's `status=doing` shows on its agent card
+ [X] bump the patch version, once for the batch: skip it if the version is already above the last commit's


### Progress pie on stories in flight [](?id=story-progress-pie&status=code-review)

A story being worked on shows no sign of how far along it is. Each story in flight gets a small pie, so over time the board shows pies filling and stories leaving.

+ background
  + measured: a coordinator keeps a rough percentage per story in `progress.json` in its thinkersync run directory, `coordinator/<project>/`
  + measured: its shape is `{ "<story id>": { "pct", "at", "by", "note"? } }`
  + measured: it is written when a story is dispatched and at each task tick, and an entry is pruned once its story leaves doing, code-review or testing
  + measured: coordinators write no percentage into the story; the story carries its ticked tasks and its `status` linetag
  + measured: `GenericNoteAttributes.tsx` renders a `progress` linetag as text only
  + inferred: it reads `progress_max.value_numeric` and `progress_unit.value` unguarded, so a `progress` tag without those siblings throws
  + no PATTERNS.md entry for a progress indicator; new
+ approach
  + percentage source, first found wins: the coordinator's progress entry for the story's id, then the story's own `progress` linetag, then ticked over total task boxes in the story
  + shown on a story at `status` doing, code-review or testing, or with a live agent bound, in every card type
  + a small pie beside the headline, labelled "<n>% complete", whose tooltip names the source
  + it animates between values and stays still under `prefers-reduced-motion`
  + a progress entry's `at` times its story's column, as an agent write does ([[quiet-idle-agents]])
  + the extension reads progress files read-only, through the same remote-aware home lookup as agent sessions, only for repos in the open folder
+ decision 2026-11-03: the percentage source order above
+ [X] add a progress file reader in the extension, with jest tests over its parse and repo filter
+ [X] carry each story's percentage, source and time to the webview in the activity snapshot
+ [X] add a pure ticked-over-total function for a story's task boxes, with jest tests
+ [X] guard the `progress` linetag's sibling reads and cover a tag without them
+ [X] add the pie component and render it in the card, sticky and agent card types
+ [X] time a story's column from its progress entry
+ [X] add a Playwright spec: a story's pie shows its percentage, changes on a new snapshot, and falls back to its task count
+ [X] describe the pie and its sources in `README.md`
+ [X] bump the patch version, once for the batch: skip it if the version is already above the last commit's


### Agent tree inside the story card [](?id=agent-session-tree&status=code-review)

A story card lists one flat row per session. A coordinator's work runs in subagents, which are merged into the parent's totals and never shown, so the card cannot say what is running.

+ decision 2026-11-03: design revised in review; the rows become a VS Code style tree in [[agent-tree-vscode]] and the header is quietened in [[agent-row-header-quiet]]

+ background
  + measured: subagent transcripts under `<session>/subagents/` are merged into the parent's calls and active time (`claudecodeops.ts`, `AgentAnalyser.ts`)
  + measured: each `agent-<id>.jsonl` has an `agent-<id>.meta.json` beside it holding `description` (its title), `agentType`, a model field and a `finished` flag
  + measured: `AgentSessionRow` draws the rail, monogram, model, state, clock, live line and usage, with no indent
  + the registry entry from [[agent-registry-source]] names the main agent and its story
+ approach
  + the analyser keeps each subagent as a child record of its session: title, type, model, start and end, active time, tokens, live line
  + the parent's usage and time still include its children
  + main row: monogram, model, session name, state, and the live line (current command or prompt)
  + child rows sit indented under the main row, on the same rail, with their title, model, run time and tokens
  + finished children dim, and past a few they collapse behind a count
  + a vendor without subagents, or an agent known only from the registry, renders as a flat row with what it has
+ [X] keep subagents as child records in `ActivitySession`, in both type mirrors, reading each meta file
+ [X] cover the child records in the analyser and worker jest tests, keeping the parent totals unchanged
+ [X] render the tree in the agent card: main row, indented child rows, dimmed and collapsed finished children
+ [X] extend `inject-activity.ts` and add a Playwright spec for a session with a running and a finished subagent
+ [X] describe the tree in the Agent activity section of `README.md`
+ [X] bump the patch version, once for the batch: skip it if the version is already above the last commit's


### Read the agent registry into agent activity [](?id=agent-registry-source&status=code-review)

Agent activity knows only what Claude Code, Codex and Grok session files say. The thinkersync registry names every agent of any vendor with its state and story, so a coordinator can be named and placed on its story, and an agent with no session reader can still show.

+ background
  + measured: each agent has one `registry/<agent>/agent.json` in the thinkersync state directory
  + measured: its fields are agent, agent_kind, vendor, repo, machine, state, story, session_id, previous_session_ids, binary_version, updated_at
  + measured: a non-Claude vendor already registers there, and NoteThink reads none of its sessions
  + measured: `updated_at` changes only on a state change or a restart, so `state` is a hint and not a heartbeat
  + measured: one entry read working hours after its work ended; another read idle while its agent ran a story
  + [[coordinator-views]] plans the registry reader and the agent list in the folder and project views
+ approach
  + read-only: NoteThink never writes the registry and changes nothing about how a coordinator runs
  + read the entries whose `repo` sits inside the open folder, through the same remote-aware home lookup as vendor sessions
  + join an entry to a vendor session by `session_id` or `previous_session_ids`; the entry supplies the session name and story
  + bind a `working` entry to its `story` id when that story is at doing, code-review or testing on the board
  + so a coordinator shows in its story's tree before its first write
  + an entry with no vendor session shows as a registry-only row: name, vendor monogram, state, story
  + every live registered agent shows: in its story's tree when working, as its project's session card when not
  + a `working` entry hours old with no progress or transcript activity shows as stale, not working
+ decision 2026-11-03: read the registry to build the agent tree and the agent list; [[coordinator-views]] keeps its own tasks
+ [X] add a registry reader in the extension: parse, repo filter, join to sessions, with jest tests
+ [X] bind working entries to their stories and cover the board-status cross-check
+ [X] render registry-only rows and the stale state
+ [X] add a Playwright spec with a registry-only agent and a working coordinator bound before its first write
+ [X] add the registry source and the read-only rule to the Agent activity section of `README.md`
+ [X] bump the patch version, once for the batch: skip it if the version is already above the last commit's


### Coordinators beside boards in folder and project views [](?id=coordinator-views)

The `agent` card shows which sessions are editing a story, but not the long-lived coordinator that owns a repo's board. With many repos open under one folder, the operator cannot see which repos have a coordinator, what state each is in, or message one without leaving the board.

+ background
  + a coordinator is the long-lived agent session that owns one repo's board and working tree on one machine
  + each coordinator registers itself on its machine with one `agent.json` (repo path, machine, agent kind, mailbox, state, binary version, open convoys)
  + the registry, the mailbox and the envelope are public interfaces defined by thinkersync, a separate open-source project whose stories live in its own repo
  + this story extends the Agent activity section of `README.md`, which reads vendor session files; the registry is a second, separate source
  + order: this follows the coordinator rollout, which creates the registry entries and mailboxes this story reads
+ approach
  + folder view: NoteThink open on a folder lists every registered agent whose repo path is inside that folder, beside that repo's board
  + project view: NoteThink open on one repo lists the one agent whose repo path is that repo
  + show only: NoteThink never starts, stops or restarts an agent, and a repo with no registered agent shows none
  + each agent row shows its state, current story, binary version and open convoys, read from the registry
  + sending writes an envelope into the agent's mailbox on the same machine, from the board or from a card
  + the `[](?coord=<host>)` target marker renders as a line on the board that can be dragged
  + dragging the line moves the marker between story headings; a keyboard path does the same (PATTERNS.md > Accessible drag and resize affordances)
  + open convoys and their operator steps show on the story they belong to
  + over Remote-SSH the web-worker extension host runs locally but reads the remote machine's files through the workspace file system, so it reads that machine's registry
  + desktop only, like the `agent` card, because a browser host has no file access
+ [ ] add a registry reader that lists `agent.json` entries and filters by repo path inside the open folder
+ [ ] add a list of registered agents with their state to the folder view and the project view
+ [ ] add a "send to agent" action on the board and on a card that writes an envelope to the agent's mailbox
+ [ ] render the `[](?coord=<host>)` marker as a draggable line, rewriting the linetag on drop
+ [ ] add a keyboard path that moves the target line without dragging
+ [ ] show open convoys and operator steps on their stories
+ [ ] cover the registry filter, the envelope write and the marker move with Jest tests
+ [ ] cover the folder view, the project view and the draggable line with Playwright tests
+ [ ] extend the Agent activity section of `README.md` with the registry source and the show-only rule
+ [ ] bump the patch version


### Send envelopes between machines through a sync service [](?id=coordinator-sync-client)

Story [[coordinator-views]] reaches agents on the same machine only. An agent on another machine is out of reach unless the operator opens a second window there. This story adds delivery between machines, through a sync service chosen in a setting.

+ background
  + the sync client and the per-instance process belong to thinkersync, a separate open-source project; this story only uses them
  + dependency: delivery between machines cannot be built until thinkersync's client library exists, so this story waits on it
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


### Docs match the tree: shared constants list [](?id=docs-match-tree&status=code-review)

`CODING_STANDARDS.md` lists the constants shared between the extension and webview bundles; `DEFAULT_GROUP_DISPLAY` is exported from both and was missing.

+ [X] add `DEFAULT_GROUP_DISPLAY` to the shared subset in `CODING_STANDARDS.md` and point at the grep that lists the one-sided constants


### Watcher applies dependency and config changes [](?id=watch-restarts-on-config)

`pnpm run watch` recompiles on source changes, including those a `git pull` lands. A pull that changes a `package.json`, a `pnpm-lock.yaml`, `webpack.config.js` or a `tsconfig*.json` is not applied: the bundles keep building against stale config or modules until someone restarts the watcher by hand.

+ background
  + `watch` is `SELFINSPECT_ENV=dev webpack --watch` (`package.json` scripts); it logs to `test-results/dev.log`
  + inferred, untested: webpack watches only its module graph, so it never re-reads `webpack.config.js` or ts-loader's `tsconfig`
  + there are four lockfiles: root, `client/extension`, `client/webview` and `client/webview/src/notethink-views`, the last three installed by the root `postinstall`
  + no PATTERNS.md entry for a self-restarting watcher; new pattern
+ approach
  + a `scripts/watch.mjs` supervisor runs webpack in watch mode as a child and watches the config and dependency files itself
  + a lockfile or `package.json` change stops webpack, runs `pnpm install --frozen-lockfile`, then restarts webpack
  + a `webpack.config.js` or `tsconfig*.json` change restarts webpack only
  + changes are debounced, so a pull touching many files causes one restart
  + a failed install is logged loudly and webpack is not restarted against half-installed modules
  + SIGTERM and SIGINT are forwarded to the child, so stopping the watcher by PID stops everything
+ [ ] add `scripts/watch.mjs` and point the `watch` script at it, keeping `SELFINSPECT_ENV=dev`
+ [ ] keep the child's command line matching `webpack --watch` with the repo root as cwd, which is how a running watcher is found
+ [ ] cover the decision logic with tests: which changed path means install and restart, restart only, or nothing
+ [ ] verify against a running watcher: rewrite `webpack.config.js` unchanged, touch a lockfile, and read each restart and the new compile in `test-results/dev.log`
+ [ ] bump the patch version


### Single-file kanban falls back to document view [](?id=single-file-kanban-auto-view)

Opening a file tagged `[](?nt_view=kanban)` through NoteThink: Open Viewer draws a flat document instead of a board whenever the workspace holds other files. View settings resolve to "Auto (Document)" and no columns render.

+ background
  + measured in vscode-test-web, 2026-09-25: the file alone in its workspace resolves "Auto (Kanban)" with 2 columns and 7 cards; the same file among four sibling files resolves "Auto (Document)" with none
  + identical at ee0626c and on the current tree, so it predates the performance work
  + the Playwright specs miss it because they inject `selectionChanged` directly instead of going through the real open-viewer path
  + inferred, untested: the default "Watch unopened files in viewer" setting may let sibling files outvote the active file's own `nt_view` during auto-resolution
+ [ ] find where auto-resolution picks the view type in current-file mode and why sibling files change it
+ [ ] make a current-file open honour the active file's `nt_view`
+ [ ] add a spec that opens a file through the real open-viewer path in a multi-file workspace and asserts kanban columns render


### Spike a WASM markdown parser in the parse worker [](?id=wasm-parser-spike)

Decide go or no-go on replacing `mdast-util-from-markdown` in `ParseWorker.ts` with markdown-rs compiled to WASM (via @vscode/wasm). The worker pool from [[extension-parse-offload]] already keeps parsing off the host thread, so this spike is only about raw parse speed. The hot-path survey ([[hot-path-survey]]) leans no-go: the mdast tree has to be rebuilt as JS objects on the way back, which may eat the gain.

+ go/no-go criteria, all three must hold
  + position compatibility: `position.start` / `position.end` line, column and offset on every node type `convertMdastToNoteHierarchy` and origin tracking read, on the parseops fixture corpus
  + payload parity: 400KB and 800KB done.md-shaped fixtures render identically through both parsers, with no dropped linetags or stable_ids
  + speedup of at least 3x in wall-clock parse time, worker to worker, including rebuilding the JS mdast
+ scope
  + a throwaway `ParseWorker.ts` variant or a `scripts/perf/` script, never wired into the shipped extension before the decision
+ [ ] build the WASM parse path and measure all three criteria on the same fixtures
+ [ ] record the numbers and the go or no-go decision here, before any implementation task is filed


### Latest folder scan wins [](?id=latest-folder-scan-wins)

Typing a new Include filter can leave the board and the Files drawer showing the result of an older, partial pattern. On 2026-09-25, in a workspace of about 2200 markdown files, `**/{todo,done}.md` showed `(0 in 0 files)` while 22 files on disk match it.

+ background
  + measured: NoteThink.log 11:07:42, first scan with built-in `**/*.md` found 2235 and loaded 200
  + measured: the workspace `.vscode/settings.json` born 11:08:10; its VS Code local history copy holds the three Files-drawer keys with Include `**/{todo,done}.md`
  + measured: a python walk with the same excludes finds 22 `todo.md` / `done.md` files
  + measured in code: each debounced drawer edit posts `setIntegration` (useViewHandlers.ts `handle_apply_filters`)
  + measured in code: `onDidReceiveMessage` does not await `handleMessage`, so two `enterFolderMode` runs overlap (PanelSession.ts)
  + measured in code: `discoverFolderDocs` sets `integration_total_discovered`, then an un-awaited `allSettled` republishes and clears pending
  + measured in code: `loadFolderDoc` rejects only a different folder, never an older scan of the same folder
  + measured in code: `globMatch.ts` already expands `{a,b}`, so the host-side filter is not the fault
  + inferred: a partial-pattern scan finished last and overwrote the full one; the production build does not log enough to confirm
  + `(0 in 0 files)` also renders when discovered equals loaded at zero (BreadcrumbTrail.tsx count label), so the label alone does not prove scan order
+ follows PATTERNS.md > "Empty states": fix the error path before the presentation, so this lands before [[files-drawer-change-defaults]] and any first-run copy
+ [ ] stamp each folder discovery with a generation number in PanelSession
+ [ ] drop a stale scan's findFiles result, its per-file loads, its aggregate payload and its `pending=false`
+ [ ] add an extension test: two deferred `findFiles`, the older resolves last, the board keeps the newer set and discovered count
  + assert payload fields, not the breadcrumb string
  + include one `**/{todo,done}.md` case on the same path
  + do not use `**/{todo` as the only fixture
+ [ ] keep `(X in Y of M files)` when the winning scan is truncated (PATTERNS.md > "Bounded lists say they are bounded")
+ [ ] verify in that workspace: reload the window with Include `**/{todo,done}.md` and confirm stories from 22 files
+ out of scope
  + cancelling in-flight parses from the parse-offload work; a stale scan's results are ignored, not aborted


### Files drawer defaults under Change defaults [](?id=files-drawer-change-defaults)

The Files drawer shows Make user default, Reset to user default and Reset to built-in default all the time, while View settings keeps its default actions in a closed Change defaults disclosure. Every drawer that offers default actions should use that one disclosure.

+ background
  + measured: FilesDrawer.tsx renders `SettingsCascadeButtons` unconditionally in its `drawerMeta` aside
  + measured: `SettingsCascadeButtons.tsx` always enables "Make user default", which applies every NoteThink setting
  + measured: `ChangeDefaultsDisclosure` (SettingsViewDrawer.tsx) is a closed `<details>` with a diverged tally, and disables save when nothing diverged
  + measured: SettingsCardDrawer.tsx has no cascade buttons by design; the default actions cover every setting
  + design: the disclosure sits in the drawer's side column under its File settings title, closed, with the same tally text as View settings
+ [ ] extract `ChangeDefaultsDisclosure` into one shared component, keeping its tally and disabled rules
  + the caller passes the count; the component never computes it
+ [ ] render it in the Files drawer in place of `SettingsCascadeButtons`, closed by default
+ [ ] count the Files tally over the three NODE_FILES keys: includeFilter, excludeFilter, maxNotesPerFile
  + measured: View's count covers only its own rows (SettingsViewDrawer.tsx `diverged_count`), and those rows leave out the NODE_FILES keys (settingRows.ts header)
  + disable save only when none of the three diverged
  + both buttons still write every NoteThink setting; only the tally is scoped
  + do not pass View's count into Files
+ [ ] keep the built-in restore button on the Files drawer only, where a wiped filter must be recoverable
+ [ ] align the Files labels with View settings (Save as user default, Revert to user default)
+ [ ] retire `SettingsCascadeButtons` once nothing renders it, moving its tests to the shared component
+ [ ] extend FilesDrawer.test.tsx and a playwright spec to open the disclosure before clicking a default action
  + include a files-only divergence: Include changed, no view setting changed, save enabled and tally at 1
+ out of scope
  + cascade buttons on the card drawer
  + narrowing the whole-cascade message to file filters only


### Split view: two panes on the view registry [](?id=split-view) [post-v1]

Two views visible at once, such as a document pane beside a kanban pane. The view hierarchy and per-view state this story once asked for already exist; the gap is mounting a second view.

+ goal
  + two views mounted side by side, each scrolling independently and addressed by its own view id
  + a drag handle between the panes resizes the split, persisted like other view settings
+ background
  + the view hierarchy is data already: [[view-registry]] (`viewregistryops.ts`)
  + per-view state exists: `setViewManagedState` / `deleteViewFromManagedState` / `revertAllViewsToDefaultState` (ViewProps.ts) and the `viewStates` map; a second pane is a second entry, not a new state system
  + `parent_view` / `child_views` on ViewProps are declared and read (`useViewContext.ts`) but never written
  + mermaid renders inline as a card type, so "document + mermaid" is no longer a split-view case
+ ordering
  + lands after [[kanban-virtualized-columns]], [[webview-state-persistence-diet]], [[folder-wire-payload-diet]] and [[extension-parse-offload]], since a second pane doubles the costs they bound
+ scope
  + each pane is an ordinary `GenericView` reading its own `viewStates` entry; no parallel render path
  + two panes only; two different view types or two different scopes (current file beside a folder)
+ out of scope
  + more than two panes
+ acceptance criteria
  + both panes render with their own toolbar, breadcrumb and drawers
  + the split ratio and both panes survive a reload
  + closing a pane leaves no stranded `viewStates` entry
  + `pnpm run check` green
+ [ ] build the pane container: a CSS split with a drag handle around two `GenericView` mounts
+ [ ] route add-pane and close-pane through the existing view-state handlers
+ [ ] populate `parent_view` / `child_views` for the pane relationship, or delete them as dead code
+ [ ] persist the split ratio and each pane's view id across reload
+ [ ] add jest: each pane resolves its own view state; closing a pane removes exactly its entry
+ [ ] add playwright: open a second pane, resize, reload, both panes and the ratio survive
