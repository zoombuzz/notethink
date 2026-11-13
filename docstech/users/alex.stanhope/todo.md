# Todo [](?nt_view=kanban)


### Sticky notes that look stuck on a board [](?id=sticky-board-look&tokens_estimated=6&status=code-review)

The sticky card reads as a flat coloured box. Its curled corner is drawn with a far larger curve than its other three corners, so the fold looks like a bubble rather than paper. Stickies should look like paper notes stuck on a board: a little taller, each at a slight angle, casting a shadow, with a faint curve across the paper.

+ parallel: touches only `StickyNote.tsx`, `StickyNote.module.scss` and `sticky-card.spec.ts`, so it can run alongside any other story
+ builds on: the `sticky-card` story in `done.md`, through `StickyNote.tsx` and `StickyNote.module.scss`; no new card type or surface
+ background, measured 2026-11-12 in `client/webview/src/notethink-views/src/components/notes/StickyNote.module.scss`
  + vertical padding is 7px top and 11px bottom (`:43`)
  + the paper's corners are `border-radius: 2px` (`:44`)
  + the curl has two parts: the paper's 315deg gradient paints a 12px corner transparent (`:36`, `:47`), and the `::after` flap covers the fold line (`:52-62`)
  + the flap's curve is `border-top-left-radius: 70%` of a 17px square (`:57-60`), about 12px against the other corners' 2px
  + the shadow is `0 1px 3px rgba(0, 0, 0, 0.28)`, deepening on hover (`:30`, `:48`)
  + nothing rotates, and the only gradient is the corner shading
  + the focus ring is an `outline` on the outer `.stickyNote`, while the paper is the inner `.stickyInner` (header comment `:4-7`)
+ decision 2026-11-12 (operator)
  + slightly more vertical padding
  + the curled corner's curve is a small circle matching the radius of the other corners
  + each sticky sits at a small random rotation, as if stuck on a board
  + each sticky drops a shadow that gives it depth off the board
  + a very subtle top-to-bottom graduated fill, as if the paper curves slightly
+ approach
  + one `--sticky-radius` custom property draws the paper's three square corners and the flap's curve, so they cannot drift apart again
  + the angle is hashed from the note's `stable_id` into a small range (about -2deg to +2deg)
    + so a sticky keeps its angle across re-renders, scans and reloads instead of jittering
    + inferred: "random" means irregular from note to note, not changing over time
  + rotate the paper (`.stickyInner`), never the card element
    + the focus ring stays square, and `useScrollToCaret`, which measures the card with `getBoundingClientRect`, frames it as before
    + CODING_STANDARDS.md > Focused-note scroll framing
  + the drop shadow layers a tight contact shadow under a softer, wider one; hover stays the deeper of the two states
  + the vertical shade must not paint the transparent curl corner, or the lifted corner disappears
    + inferred: a background layer under the curl gradient would fill that corner, so the shade goes into the paper colour stops or is masked out of the corner
  + the same look in every view a sticky appears in, light and dark themes alike (CODING_STANDARDS.md > Every card type works in every view)
+ [X] raise `.stickyInner`'s vertical padding slightly, to around 10px top and 14px bottom, keeping the title clear of the curl
+ [X] add `--sticky-radius` and draw both the flap's curve and the paper's other corners from it
+ [X] derive a stable angle per sticky from its `stable_id` in a helper beside `StickyNote.tsx`, passed inline like `--nt-sticky-hue`
+ [X] rotate `.stickyInner` by that angle, leaving the card element and its focus ring unrotated
+ [X] replace the paper's shadow and its hover shadow with layered drop shadows
+ [X] add the subtle top-to-bottom shade to the paper in both themes, leaving the curl corner transparent
+ [X] update the header comment in `StickyNote.module.scss` for the rotation, the shadow and the shade
+ [X] cover the angle helper with Jest: stable for one id, spread across ids, inside the range
+ [X] extend `playwright/specs/sticky-card.spec.ts`
  + two stickies carry different rotations on `.stickyInner`, and the card element carries none
  + the flap's curve radius equals the paper's corner radius
  + the focused-ring test (`:123`) still passes on a rotated sticky in the leftmost column
+ [X] update the `sticky` row of `AUTHORING_GUIDE.md` > Card types (`:361`) if its description no longer fits
+ [X] walk a sticky board in the kanban, document and line views in a browser, light and dark, and inspect the corner close up
+ [X] bump the patch version
+ manual: judge the angle range, the shadow depth and the shade on a full board, and tune any that reads as too much


### Draw every chevron with one shared mark [](?id=shared-chevron-mark&status=code-review)

+ goal: one chevron mark, so a weight or opacity change lands everywhere.
+ problem: the agent card, the drawer tree and the toolbar tabs each draw the same rotating chevron their own way, an SVG in one and a rotated `›` text glyph with its own CSS in the other two, and they have already drifted on opacity and transition.
+ builds on: `AgentChevron` (now `Chevron` in `client/webview/src/notethink-views/src/components/Chevron.tsx`), kept as the one drawn mark; no new disclosure control.
+ parallel: edits `DrawerTree.tsx`, `ToolbarTab.tsx`, `ViewRenderer.module.scss` and `AgentNote.module.scss`, so run it away from other stories touching those
+ [X] Move `AgentChevron` out of `notes/agent/` to a shared components path and give it a direction (right, down, up) in place of the `open` boolean
+ [X] Move the chevron CSS from `AgentNote.module.scss:197-209` beside it, one opacity and one transition
+ [X] Draw `DrawerTree`'s leading slot with the shared mark where the caller passes a glyph, keeping the blank spacer on leaf rows
+ [X] Draw `ToolbarTab`'s chevron with the shared mark, keeping `data-testid`, `data-direction` and `aria-hidden`
+ [X] Delete `.drawerTreeGlyphOpen`, `.toolbarTabChevron*` and the `›` glyph arguments no caller needs
+ [X] Update the `DrawerTree`, `GenericView` and `settings-toggle` assertions that read the old glyph, and walk the toolbar drawers and the jump tree in a browser


### Files drawer defaults under Change defaults [](?id=files-drawer-change-defaults&status=code-review)

The Files drawer shows Make user default, Reset to user default and Reset to built-in default all the time, while View settings keeps its default actions in a closed Change defaults disclosure. Every drawer that offers default actions should use that one disclosure.

+ background
  + measured: FilesDrawer.tsx renders `SettingsCascadeButtons` unconditionally in its `drawerMeta` aside
  + measured: `SettingsCascadeButtons.tsx` always enables "Make user default", which applies every NoteThink setting
  + measured: `ChangeDefaultsDisclosure` (SettingsViewDrawer.tsx) is a closed `<details>` with a diverged tally, and disables save when nothing diverged
  + measured: SettingsCardDrawer.tsx has no cascade buttons by design; the default actions cover every setting
  + design: the disclosure sits in the drawer's side column under its File settings title, closed, with the same tally text as View settings
+ [X] extract `ChangeDefaultsDisclosure` into one shared component, keeping its tally and disabled rules
  + the caller passes the count; the component never computes it
+ [X] render it in the Files drawer in place of `SettingsCascadeButtons`, closed by default
+ [X] count the Files tally over the three NODE_FILES keys: includeFilter, excludeFilter, maxNotesPerFile
  + measured: View's count covers only its own rows (SettingsViewDrawer.tsx `diverged_count`), and those rows leave out the NODE_FILES keys (settingRows.ts header)
  + disable save only when none of the three diverged
  + both buttons still write every NoteThink setting; only the tally is scoped
  + do not pass View's count into Files
+ [X] keep the built-in restore button on the Files drawer only, where a wiped filter must be recoverable
+ [X] align the Files labels with View settings (Save as user default, Revert to user default)
+ [X] retire `SettingsCascadeButtons` once nothing renders it, moving its tests to the shared component
+ [X] extend FilesDrawer.test.tsx and a playwright spec to open the disclosure before clicking a default action
  + include a files-only divergence: Include changed, no view setting changed, save enabled and tally at 1
+ out of scope
  + cascade buttons on the card drawer
  + narrowing the whole-cascade message to file filters only


### Card action tray beside the highlight ring [](?id=card-action-tray&tokens_estimated=16&status=code-review)

A story card on a coordinator's board carries a small envelope beside its progress pie, on every card type, all the time. The action is wanted; its placement is not. Card actions should appear only when a card is highlighted, as a row of blue icons at the card's bottom-right corner, outside the dashed highlight ring. Two actions to start: edit, which puts the text editor's caret at the end of the card's title, and send to the coordinator, which asks before it sends.

+ parallel: edits `MarkdownNoteHeadline.tsx`, which [[virtual-caret-spike]] also edits, so run that one after this
+ builds on: `StorySendButton` (`components/notes/StorySendButton.tsx:21`) from [[coordinator-views]]; its coordinator match moves into the tray and the headline button goes
+ builds on: the `selectRange` message (`types/Messages.ts:11-27`), as the double-click path posts it (`useViewHandlers.ts:117-125`)
+ builds on: the native `<dialog>` with `showModal()` in `components/InsertModal.tsx`, the webview's only modal today
+ builds on: the `coordinatorSend` message and `CoordinatorCommands.send` (`client/extension/src/vscode/CoordinatorCommands.ts:62-87`), unchanged
+ background, measured 2026-11-12, paths under `client/webview/src/notethink-views/src/` unless rooted
  + the envelope renders in `components/notes/markdown/MarkdownNoteHeadline.tsx:55`, so every card type drawing the headline shows it
  + it shows only on a story note, in a folder view, whose story is on a registered coordinator's board (`StorySendButton.tsx:23-35`)
  + its click sends nothing: it opens the coordinator panel's form prefilled with `About story {id}: ` (`StorySendButton.tsx:37-41`)
    + the request is webview-local (`lib/activityhooks.ts:113`), consumed by `CoordinatorPanel.tsx:70-77`
  + the highlight ring is `outline: dashed 2px var(--vscode-focusBorder)` on `.note.focused` (`components/ViewRenderer.module.scss:1123-1124`)
    + offset 6px, or 8px for a nested note (`:1120`, `:1127-1129`)
    + an outer note containing a focused note fades its ring (`:1137-1139`); a selected note draws it solid (`:1142-1143`)
  + the webview has no reusable confirm dialog, and the extension makes no modal `showWarningMessage` call
  + `README.md:230` says the card's envelope "sends nothing until you press Send"
+ decision 2026-11-12 (operator)
  + remove the envelope from the headline of every card type
  + show a row of icons at the bottom-right of a highlighted card, outside the dashed ring
  + the icons are blue, matching the ring
  + hovering an icon explains what it does
  + the mail icon opens a modal confirm asking whether to send the story to the coordinator, with OK and Cancel
  + a pencil icon to the mail icon's left puts the text editor's caret at the end of the card's title text
+ approach
  + the tray shows on the innermost highlighted note, dashed (focused) or solid (selected), never on a faded outer ring
  + one render site serves every card type, found from the card dispatch (`components/notes/cardregistryops.ts`, `AutoView.tsx`)
    + CODING_STANDARDS.md > Every card type works in every view
  + the tray sits beyond the ring's offset plus its width, so the two never overlap
  + icons and their hover use `var(--vscode-focusBorder)`; each button has an `aria-label` and a `title` through `l10n.t`
  + the pencil shows on every note with a source position; the mail icon only where `StorySendButton` shows today
  + the pencil posts `selectRange` with `from` = `to` = the end of the title text, and `forceOpen` so it opens the file when no editor shows it
    + source coordinates, computed as `revealNote` does (`useViewHandlers.ts:160-185`)
    + the title ends before the linetags (`linetags_from`, `types/NoteProps.ts:180`), trailing spaces trimmed, else at the end of the headline line
    + the editor takes focus, as for every view-posted `selectRange` (CODING_STANDARDS.md > View interaction state)
  + a `ConfirmModal` on a native `<dialog>`: OK posts once; Cancel, Escape and a backdrop click post nothing; focus returns to the icon
    + a webview dialog rather than VS Code's modal message, so the Playwright harness, which has no extension host, can drive it
    + new pattern: notethink's first generic confirm dialog, for any later tray action that needs one
  + the `coordinatorResult` code (`sent`, `unknown_agent`, `no_mailbox` and the rest) shows where the panel shows it today, so a refusal is never silent
  + the tray widens the ring's footprint, so `useScrollToCaret` (`viewhooks.ts`) reserves room for it, and no group or column clips it
+ decision 2026-11-12 (operator): OK sends one envelope asking the coordinator to pick up the story and include it in its current batch
  + the message names the story's id and its board, as one l10n string
  + the panel's message box stays for anything longer
+ open question: the tray also leaves out the view's container note, which has a source position but is the view's frame rather than a card in it; accept that as the rule (recommended), or show the tray on the container too?
+ [X] add `titleEndOffset` to `lib/noteops.ts`, the source offset at the end of a note's title text
  + Jest: a plain title, a title with linetags, and a note in a folder view
+ [X] add `ConfirmModal` beside `InsertModal.tsx` on a native `<dialog>`, with Jest tests for OK, Cancel and Escape
+ [X] add the action tray, pencil then mail icon, from one render site for every card type, on the innermost highlighted note only
+ [X] wire the pencil to post `selectRange` at `titleEndOffset` with `forceOpen`
+ [X] wire the mail icon to the confirm, and OK to `coordinatorSend` with the pick-up-in-this-batch message
+ [X] show the user the send result for every result code
+ [X] remove `StorySendButton` from `MarkdownNoteHeadline.tsx:55`, moving its coordinator match into the tray and deleting what no caller needs
+ [X] extend `useScrollToCaret` to keep the tray in view with the ring, and name the tray in CODING_STANDARDS.md > Focused-note scroll framing
+ [X] add each new string to `l10n/bundle.l10n.json` and the de, es, fr and it bundles
+ [X] replace `StorySendButton.test.tsx` with tray tests
  + shown on a focused and a selected note, hidden behind a faded outer ring
  + the mail icon only on a coordinator's board
+ [X] update `playwright/specs/coordinator-views.spec.ts:122-136` for the tray: Cancel sends nothing, OK writes one envelope
+ [X] add a Playwright spec for the tray on a card and a sticky
  + the tray sits outside the ring
  + the pencil posts `selectRange` at the end of the title
+ [X] update `README.md` lines 26, 230 and 245 for the tray, the confirm and the pencil
+ [X] add a "design revised 2026-11-12" line on [[coordinator-views]] for the envelope's move into the tray
+ [X] walk the tray in a browser: highlight cards at the left and bottom edges of a board, hover both icons, edit, send and cancel
+ [X] bump the patch version


### Coordinators in the agent card drawer, with a vendor setting [](?id=coordinator-drawer-vendor&tokens_estimated=14&status=code-review)

The coordinator list sits permanently above the board in every folder view that holds a story board. It is useful, but it should not be a permanent fixture: it belongs in a drawer. Each row also shows the program version, which says less than which agent CLI the coordinator runs in, and that choice should be a setting the user can change from the row.

+ parallel: run after [[card-action-tray]], which moves the story card's send action and changes where its result shows
+ builds on: `CoordinatorPanel` (`client/webview/src/notethink-views/src/components/views/coordinators/CoordinatorPanel.tsx:26`) from [[coordinator-views]], moved rather than rebuilt
+ builds on: `CoordinatorCommands.send` (`client/extension/src/vscode/CoordinatorCommands.ts:62-87`) and its mailbox write; only the envelope's kind is new, defined by thinkersync
+ builds on: `ACTIVITY_VENDOR_DISPLAY` (`types/AgentActivity.ts:41-46`) and `vendorMonogram` (`lib/agentactivityops.ts:550`), the marks the agent card already draws
+ background, measured 2026-11-12, paths under `client/webview/src/notethink-views/src/` unless rooted
  + the panel mounts above the board in `components/views/GenericView.tsx:188`
  + each row draws name, state, story, `Version {0}` (`CoordinatorPanel.tsx:91`) and the open convoy count, then two toggles
    + Send to agent (`:94`) opens a text box; Send writes one request envelope into that agent's mailbox
    + Target line (`:95`) shows the board with the `[](?coord=<host>)` marker as a line that can be dragged or moved by keyboard, rewriting the marker on save
  + the row knows the coordinator's vendor (`ActivityCoordinator.vendor`, `types/AgentActivity.ts:392`) but never draws it
  + the Card drawer (`components/views/drawers/SettingsCardDrawer.tsx`) already holds agent card settings, such as the clock mode select (`:84`)
  + an Antigravity agent draws no mark today: the registry writes `agy`, `registryVendorSlug` maps only `claude` (`client/extension/src/lib/agentregistryops.ts:40-42`), and the display table's key is `antigravity` (`types/AgentActivity.ts:25`)
  + the panel only shows and asks; NoteThink never starts, stops or restarts an agent (`README.md` > Coordinators beside boards)
  + inferred: a coordinator reads a mailbox request as free text, and no request format for changing its vendor exists in this repo or in the registry contract
+ decision 2026-11-12 (operator)
  + the coordinator list is not a permanent fixture above the board
  + it moves into the Card drawer, under the agent card type
  + the version in each row is replaced by the vendor's two-letter mark, such as `CC` for Claude Code
  + the vendor is a setting: a drop-down beside each coordinator shows its current vendor and lets the user pick another
  + picking another vendor sends a message to that coordinator asking it to change to the chosen vendor
+ approach
  + the drop-down asks, it does not switch: the coordinator decides when it can change, and the row shows the registry's vendor until the registry reports the new one
  + the chosen vendor is held as pending, labelled as requested, as the target line holds a pending position (`CoordinatorPanel.tsx:49-61`)
    + a refused send lets the drop-down fall back to the registry's vendor, with the result code shown
  + the options are the vendors `ACTIVITY_VENDOR_DISPLAY` knows, each as its mark and name, in the vendor's colour
  + the request is thinkersync's vendor-change envelope, naming the vendor as the registry writes it (`claude`, `agy`, `codex`, `grok`)
  + the list keeps its scope rule, `coordinatorsInScope`, and stays desktop only
  + dependency: thinkersync's story "Define a vendor-change envelope for coordinators" defines the envelope, and the coordinator tooling's own story makes a coordinator act on it
    + build the drop-down's send against the envelope as thinkersync documents it; until a coordinator acts on it, the row stays at the registry's vendor and shows the reply
+ decision 2026-11-12 (operator): keep Send to agent and Target line in the drawer row, working as they do today
  + Send to agent is a free-text message box per coordinator; [[card-action-tray]] adds a confirmed send from the card
  + Target line is the visual way to move the coordinator's work-down-to-here marker, otherwise edited by hand in `todo.md`
+ decision 2026-11-12 (operator): confirm a vendor change before sending it, through the `ConfirmModal` from [[card-action-tray]]
  + a vendor change restarts the coordinator in another CLI
+ [X] remove the panel from above the board in `GenericView.tsx:188`
+ [X] render the coordinator list in the Card drawer under the agent card type, in folder view, with the same scope rule
+ [X] map the registry's `agy` to `antigravity` in `REGISTRY_VENDOR_SLUGS`, with a Jest case, so an Antigravity coordinator draws `AG`
+ [X] replace `Version {0}` with the vendor mark in the vendor's colour
+ [X] add a vendor drop-down to each row, showing the current vendor and listing the known vendors
+ [X] send the vendor-change envelope through the existing send path when the user picks another vendor, after the confirm
  + the envelope is written by `buildCoordinatorEnvelope` (`client/extension/src/lib/coordinatorops.ts`), extended for the new kind rather than copied
+ [X] hold the requested vendor as pending until the registry reports it, falling back on a refused send
+ [X] carry Send to agent and Target line into the drawer row unchanged
+ [X] add each new string to `l10n/bundle.l10n.json` and the de, es, fr and it bundles
+ [X] update `CoordinatorPanel.test.tsx` and `SettingsCardDrawer.test.tsx` for the move, the mark, the drop-down and the request body
+ [X] move `playwright/specs/coordinator-views.spec.ts` from the panel above the board to the drawer, and add the vendor change
+ [X] rewrite `README.md` > Coordinators beside boards and its feature line (`:26`) for the drawer and the vendor setting
+ [X] add a "design revised 2026-11-12" line on [[coordinator-views]] for the move and the vendor mark
+ [X] walk the drawer in a browser: open it on a folder with two repositories, change a vendor, and cancel one
+ [X] bump the patch version


### Virtual caret in the viewer: viability spike [](?id=virtual-caret-spike&tokens_estimated=20)

Changing a card's title or a linetag value means leaving the viewer for the text editor. Could the viewer show its own caret instead? It would follow the editor's real caret while the file is open in a text editor. When the file is not open, it would move within titles and linetag values in the viewer, relaying each edit as if it had been typed in the editor. This story builds a prototype and records whether the idea is viable; it does not ship the caret to users.

+ parallel: run after [[card-action-tray]], which also edits `MarkdownNoteHeadline.tsx`
+ builds on: `view_caret` in `display_options` (`client/webview/src/notethink-views/src/lib/viewstateops.ts:171-191`), an offset the view already holds but never draws
+ builds on: `selectionChanged` from the editor (`client/extension/src/vscode/PanelSession.ts:525-536`, received at `client/webview/src/hooks/useVscodeMessages.ts:92-99`)
+ builds on: `selectRange` from the view, and `editText` through `applyEditTextChanges` (`PanelSession.ts:59-87`) for writes; no second edit path
+ background, measured 2026-11-12
  + the editor reports its selection only for the doc at `active_path`, debounced by `SELECTION_DEBOUNCE_MS` (`PanelSession.ts:525-536`)
    + so a caret following the editor lags by at least that debounce
  + an `editText` on a document with no visible editor applies a `WorkspaceEdit` to a silently opened document, left dirty and unsaved (`PanelSession.ts:79-86`, `:1531`)
  + the coordinator marker move saves after its edit when the document was clean before (`CoordinatorCommands.ts`, around `:95-112`), the one precedent for saving
  + nothing in the webview edits text today: no `contentEditable`; the only inputs are the drawers, the insert modal and the coordinator form
  + titles render through markdown, so rendered and source offsets diverge wherever a title carries emphasis, code or a link
+ deviates from CODING_STANDARDS.md > View interaction state, which keeps keystrokes out of the webview
  + with no editor open, the prototype has to take keys in the webview
  + the verdict says whether that rule needs rewriting
+ scope
  + titles and linetag values only, never body text
  + the prototype runs only when `NOTETHINK_DEV` is set, so a production build behaves as today and `README.md:245` ("Not a text editor") stays true
  + out of scope: shipping the caret to users; the verdict decides whether a build story follows
+ [ ] draw a caret in a title, and in a linetag value, where the editor's selection falls
  + plain titles first, then titles with emphasis, inline code and a link
+ [ ] move the caret with Left, Right, Home and End within the title and values, posting `selectRange` so the real caret follows when the file is open
+ [ ] relay typing, Backspace and Delete as `editText` when the file is not open in a text editor, and redraw the caret after the round-trip
+ [ ] measure keystroke-to-repaint time for a relayed edit on one small file and on a large folder view, with `pnpm run test-perf`
+ [ ] measure undo and save on a relayed edit
  + whether VS Code's undo reaches a `WorkspaceEdit` on a document no editor shows
  + what saving after each edit costs
+ [ ] cover the rendered-to-source offset mapping with Jest
+ [ ] record the verdict in this story: viable or not, the measured lag and repaint time, the markdown mapping limits, undo and save, and the focus rule
+ [ ] bump the patch version


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


### Share parse-worker scheduling and recovery [](?id=shared-parse-worker-scheduling&status=code-review)

+ goal: keep current-file and folder parsing responsive when a parse worker fails.
+ problem: two parse schedulers maintain the same mechanics with different failure handling.
+ parallel: edits `PanelSession.ts`, `ParsePool.ts` and `useWorkerParsedDocs.ts`; run it after [[latest-folder-scan-wins]], which also edits `PanelSession.ts`, and alongside any other batch story
+ builds on: `client/extension/src/vscode/ParsePool.ts:61` and its existing crash-recovery behavior.
+ builds on: the folder parsing adapter in `client/webview/src/hooks/useWorkerParsedDocs.ts:105`.
+ background
  + measured: both pools implement lazy slots, FIFO jobs, pump/free-slot/spawn/dispatch and inline spawn fallback.
  + measured: both size the pool to half the reported cores, capped at four.
  + measured: `client/extension/src/vscode/notethinkEditor.ts:49` constructs the extension pool.
  + measured: `client/extension/src/vscode/PanelSession.ts:198` uses it for document parsing.
  + measured: `client/webview/src/hooks/useWorkerParsedDocs.ts:278` submits folder documents to the webview pool.
  + measured: `client/webview/src/hooks/useVscodeMessages.ts:473` consumes the resulting parsed documents.
  + measured: `ParsePool.ts:80` bounds its queue; `:103` supersedes stale requests; `:156` wires worker errors.
  + measured: `ParsePool.ts:173` resolves a crashed worker's current job inline and replaces the worker.
  + measured: `useWorkerParsedDocs.ts:200` registers only a message listener before posting at `:218`.
  + inferred: a webview worker error without a response leaves that job's promise unresolved.
    + Its pending key clears only when the promise resolves at `useWorkerParsedDocs.ts:279`.
    + This is a source-level settlement gap, not a reproduced production failure.
  + measured: the extension tsconfig restricts its root to `src`; the webview uses a separate build graph.
  + measured: `CODING_STANDARDS.md` deliberately mirrors a few defaults across the two bundles.
  + inferred: a runtime-neutral scheduling core can share lifecycle policy while retaining both execution sites.
+ approach
  + This is a new pattern for shared parse scheduling; no existing scheduler abstraction covers both callers.
  + Extract the existing extension pool's mechanics into one environment-neutral source built into both bundles.
  + Inject worker construction, protocol encoding, inline parsing and logging instead of importing VS Code or DOM APIs.
  + Keep webview blob preparation, content cache and parse probes in the existing webview adapter.
  + Keep extension URI construction and keyed stale-request handling in its adapter.
  + Keep the sticky-session `AgentAnalyserWorkerPool` separate; its cache affinity and batching differ.
+ [X] isolate the shared parse scheduling core from the existing pool implementation.
  + decision: the core is `client/extension/src/lib/ParseScheduler.ts`, imported by relative path into the webview bundle; it imports nothing runtime-specific, and no webpack or tsconfig change was needed.
  + Adjust build inclusion only where required; keep two bundles and introduce no external package or worker service.
  + Preserve the documented mirrored-default exception instead of sweeping constants into the new core.
+ [X] route both current-file and folder parsing through the shared lifecycle mechanics.
  + decision: `ParsePool` and the webview's `ParseWorkerPool` are now thin adapters over `ParseScheduler`; a worker error settles its in-flight job inline, a job superseded before its worker crashes costs no inline parse, and `dispose` now rejects in-flight jobs as well as queued ones.
  + Settle in-flight work on worker error with the existing inline fallback behavior.
  + Drain queued work after spawn failure; prevent later jobs from being stranded.
  + Bound queued work and settle superseded or evicted jobs explicitly.
  + Preserve response identity/hash checks and ignore stale results.
  + Dispose workers at the owning runtime's existing lifecycle boundary.
  + decision: `NotethinkEditorProvider` owns the extension's pool, so its constructor pushes the pool's `dispose` onto `context.subscriptions` (the pattern `activate` uses for the audio coordinator); `notethinkEditor.test.ts` > 'parse pool lifecycle' proves disposing the subscriptions disposes the pool.
+ [X] exercise shared scheduler behavior with controlled worker doubles.
  + `ParseScheduler.test.ts` covers success, concurrency, error answer, spawn failure, crash, stale response, supersession, overflow and disposal; `ParsePool.test.ts` still passes through the adapter.
  + Cover success, concurrent work, spawn failure, worker crash, stale response, queue overflow and disposal.
  + Use `client/extension/src/vscode/ParsePool.test.ts:79`, `:139` and `:169` as existing behavioral references.
  + Assert every submitted promise settles and a later job still completes after a crash.
+ [X] add a worker-path webview regression for crash recovery and pending-key release.
  + `useWorkerParsedDocs.worker.test.ts` runs the hook through a Worker double: success, crash then later docs, error answer releasing the pending key, and a mismatched response ignored.
  + `client/webview/src/hooks/useWorkerParsedDocs.test.ts:6` currently runs all cases through inline fallback.
  + Preserve hash-based caching and released-document memory behavior from the existing hook tests.
+ [X] verify both bundles load real workers and preserve current-file/folder rendering.
  + webview: `node scripts/perf/run.mjs --only folder-progressive-20,folder-progressive-50,folder-progressive-200,single-file-100k` in headless chromium read the parse-mode probe as worker_parses 20, 50 and 200 with fallback_parses 0, every budget verdict ok.
  + extension: a new Mocha suite `client/extension/src/test/suite/lib/parsepool.test.ts` under vscode-test-web constructs a real `Worker` from `parseWorker.js` through `ParsePool`, and both parses were answered by the worker with no crash; the full Playwright suite (313) also passes.
  + Use the existing parse-mode probe in `scripts/perf/page-agent.js:169` to distinguish workers from fallback.
  + Do not claim a speedup; this change shares policy and closes a settlement gap.
+ acceptance criteria
  + One scheduling implementation owns worker slot lifecycle and crash settlement for both parse adapters.
  + A crashed folder parser leaves no permanently pending document and later work continues.
  + Extension supersession and folder cache/release behavior remain intact.
  + Existing parse behavior and rendered document content are unchanged.


### Agent card: one quiet line when nothing is uncommitted or pending [](?id=agent-card-quiet-line&status=code-review)

An agent card with nothing uncommitted and nothing to push spends two lines saying so: `No uncommitted files`, then `No pending commits` under it. The two greys also differ. The card should say both on one line, in the grey the files row already uses.

+ parallel: touches only the agent card files under `components/notes/agent/` and `AgentNote.module.scss`, which no other story in this batch touches, so it can run alongside any of them
+ builds on: [[agent-card-compact]], which added both rows
  + files row: `agent/AgentFileBands.tsx:36` renders `No uncommitted files` as `styles.fileBandEmpty` above the pending row
  + pending row: `agent/AgentPendingCommits.tsx:16` renders `No pending commits`, `No upstream` or `N pending commits` as `styles.pendingCommits`
+ measured: the greys come from two different rules in `AgentNote.module.scss`
  + `.fileBandEmpty` (`:536`) dims the card's foreground with `opacity: 0.55`; this is the right grey (operator)
  + `.pendingCommits` (`:526`) sets `color: var(--nt-agent-idle)`, which is `--vscode-descriptionForeground`; this is the wrong grey
+ decision 2026-11-11 (operator): with no uncommitted files and no pending commits, the card shows one line, not two
  + recommended wording: `No uncommitted files or pending commits`, as one l10n string
  + the line is not expandable, like `No uncommitted files` today
+ decision 2026-11-11 (operator): every grey state of the pending row uses the files row's grey, not `--nt-agent-idle`
  + applies to `No pending commits` under a files row with changes, and to `No upstream`
  + `N pending commits` stays `--nt-agent-waiting`
  + one shared style for both rows, so the two greys cannot drift apart again
+ decision 2026-11-11 (operator): with no uncommitted files and no upstream, the card also folds to one line, `No uncommitted files, no upstream`
+ [X] render a single combined line in `AgentFileBands` when `uncommitted` is empty and `pending_commits` is 0 or there is no upstream, keeping a stable test id for it
+ [X] move the pending row's grey states onto the files row's grey through one shared style in `AgentNote.module.scss`
+ [X] extend `AgentFileBands.test.tsx` for the combined line, and for two rows whenever either side has something to show
+ [X] update `playwright/specs/agent-card.spec.ts:317` to assert the combined line, and that the pending row's grey equals the `No uncommitted files` grey
+ [X] add a "design revised 2026-11-11" line on [[agent-card-compact]], whose decision named `--nt-agent-idle` for the pending row
+ [X] update `README.md` > Agent activity if it describes the two empty rows
+ [X] bump the patch version
+ note: the combined line is `No uncommitted files or pending commits`, or `No uncommitted files, no upstream`; with a git tree it folds only when pending is 0 or there is no upstream, and a card with no git tree keeps the plain `No uncommitted files` line
+ manual: on a clean, pushed story in the kanban view, confirm one grey line; then add a commit and confirm the pending row splits out in the waiting colour


### Agent card: short count, expandable pending commits [](?id=agent-card-pending-detail&status=code-review)

The agent card's count reads `1 agent` or `2 agents`, which is longer than the status line needs. The pending commits row shows only a count, so the operator cannot see which commits are waiting or how much they change without leaving the card.

+ builds on: [[agent-card-compact]], which added the status line and the pending commits row
+ builds on: the collapsed uncommitted files row in `agent/AgentFileBands.tsx`, with `AgentChevron` and `LineDiffCounts`; no new disclosure component
+ verified: the count is `AgentMetaRow.tsx:38`
+ verified: the pending row is `agent/AgentPendingCommits.tsx:21`, drawing only a number
+ verified: the host sends only an ahead count, `ActivityTree.pending_commits` (`types/AgentActivity.ts:318`), with no hashes, files or line counts
+ decision 2026-11-11 (operator): the count reads `1 ag`, `2 ag`, with no plural form
+ decision 2026-11-11 (operator): the pending commits row expands like the uncommitted files row, collapsed by default
  + the row carries the green and red line totals across all pending commits: `2 pending commits +120 -34`
  + expanded, it lists each pending commit: its short hash and how many files it changes
  + with no pending commits, or no upstream, the row stays as today and does not expand
+ [X] change the count to `{0} ag` in `AgentMetaRow.tsx`, updating its tests and any l10n bundle entries
  + `AgentMetaRow.tsx` now reads `l10n.t('{0} ag', ...)`; `1 agent` and `{0} agents` are gone from all five bundles, and `AgentMetaRow.test.tsx`, `AgentNote.test.tsx` and `agent-card.spec.ts` read `1 ag` / `2 ag`
+ [X] add per-commit detail for the pending commits to `ActivityTree`: sha, files changed, lines added, lines removed
  + `ActivityTree.pending_detail` is `ActivityPendingCommit[]` (`short_sha`, `files`, `added`, `removed`), mirrored in both `AgentActivity.ts` files; `AgentAnalyser.test.ts` > `pending commit detail` reads it end to end
  + read the commits between upstream and HEAD through the git extension API
    + the git extension's cross-host commands carry no log: `git.api.getRepositoryState` gives HEAD's sha, `ahead` and every ref's sha, and the other two commands read no repository
    + so `agentgitops.ts` takes the stop point and bound from that state (`upstreamCommitOf`, `pendingCommitsOf`) and reads each commit and its changed files from the loose object store through `vscode.workspace.fs` (`agentgitobjectops.ts`); a packed object reads as absent and its commit lists with no figures
  + compute it with the scan's fresh line diffs (`postFreshLineDiffs`), never in an early batch
    + `attributeTrees` calls `pendingDetailFor` only with `compute_fresh_line_diffs`, and earlier batches answer from a cache keyed by HEAD, the upstream sha and the ahead count; `AgentAnalyser.test.ts` asserts the live post carries no detail
  + bound the list, saying so on the row when it is bounded (PATTERNS.md > "Bounded lists say they are bounded")
    + the list is the newest `ACTIVITY_PENDING_DETAIL_MAX` (20) commits, and the row reads `Showing the latest N of M pending commits` and a `Line counts cover N of M pending commits` hover when it lists fewer than are pending
+ [X] make `AgentPendingCommits` an expandable row with `AgentChevron` and `LineDiffCounts` totals
  + `AgentPendingCommits.tsx` reuses `AgentChevron` and the now exported `LineDiffCounts`; with none pending, no upstream or no detail it stays the plain row `agent/AgentFileBands.tsx` and `quietLineFor` already draw
  + keep its expansion in the card-level `setNoteExpanded` state, as the files row does
    + decision: each row opens on its own, as its own entry on the view's `view_expanded_ids` list: the files row keeps the bare `stable_id`, the pending row uses `stable_id` plus `PENDING_COMMITS_EXPANSION_SUFFIX` (`#pending-commits`), both written through `setNoteExpanded` in `AgentNote.tsx`, so each survives a re-render on its own
    + `AgentFileBands.test.tsx` and `AgentNote.test.tsx` assert opening one leaves the other closed, and the reverse; `agent-card.spec.ts` > `opens the pending commits row and the files row independently of each other` asserts it in the browser
+ evidence: `agentgitops.realrepo.test.ts` builds a real repository with the `git` CLI (a bare clone as the tracked remote, three pending commits that edit, add in a nested folder and delete files) and reads it through an fs-backed loose object reader and the real `DecompressionStream`; the short shas, file counts and added and removed lines equal `git log --numstat --no-renames @{u}..HEAD`, and a packed parent or a fully `git gc`ed repository lists no figures rather than a guess
+ [X] list each pending commit when expanded: short hash and `N files`
  + `agent-pending-commit-row` shows `abc1234  3 files`, with `1 file` singular and the hash alone for a commit whose objects could not be read
+ [X] update the Jest cases in `AgentFileBands.test.tsx` and `AgentNote.test.tsx`, and the agent card Playwright spec
  + `AgentFileBands.test.tsx` > `pending commit detail`, `AgentNote.test.tsx`, `agentgitobjectops.test.ts`, `agentgitops.test.ts` and `agent-card.spec.ts` (two new specs, the existing pending specs now allow the totals)


### Fast agent scans that say when each card is done [](?id=agent-scan-per-card&status=code-review)

Every agent card says "Scanning agent activity..." until the analyser's whole first scan ends, even a card already drawing its own sessions, so the board cannot tell a finished card from a stuck scan. That first scan is slow on a large history in a Remote-SSH window, and it is paid again on every window start. Switching the card type away and back must never redo it: moving between views should be instant.

+ builds on: the agent analyser in `client/extension/src/vscode/AgentAnalyser.ts`, and the card notice in `agent/AgentActivityBanner.tsx:63`
+ measured 2026-11-11, a large history in a Remote-SSH window, from the extension log's `runScan` timing lines
  + the first scan read several hundred sessions whole, about 9.5 GB, in 76 batches
  + the first cards drew sessions after about 6 s; the state turned `live` after about 6.3 min
  + reading took 372 s of the 379 s scan; parsing took 26 s, overlapped with reading
  + the next rescan, with the in-memory cache warm, took about 7.6 s
+ verified: the notice is global; `emptyNotice` shows it while `analyser.state === 'scanning'` before any completed scan, whatever the card holds (`AgentActivityBanner.tsx:63`)
+ verified: `state` stays `scanning` through every batch but the last (`AgentAnalyser.ts:780`)
+ verified: the read cache `file_cache` (`AgentAnalyser.ts:315`) is in memory only, so every window start reads every transcript whole again
+ verified: a transcript over `AGENT_TRANSCRIPT_MAX_BYTES` is cropped in the worker (`AgentAnalyserWorker.ts:44`), after it has crossed the wire whole
+ confirmed 2026-11-11: Claude Code session folders are named for their launch cwd, with every character outside `[a-zA-Z0-9]` replaced by a dash (`encodeClaudeProjectDirName`), so that vendor's repository is known at discovery
  + measured against a real Claude Code projects folder: for every project folder holding a readable cwd (33 of 33) the folder name equalled the encoding of the newest transcript's first `cwd`; the one other folder had no `cwd` in its first 64 KB
  + disproved for Grok: its folder is the URI-encoded cwd and discovery already decodes it (`discoverGrok`), so it too is scoped before any read; only Codex reveals its directory once read, so a Codex rollout counts as possibly belonging anywhere
+ card-type switching today
  + verified: withdrawing the last card stops the analyser after `AGENT_STOP_GRACE_MS`, 5 s (`AgentAnalyser.ts:37`), disposing the worker pool (`stopRunning`, `AgentAnalyser.ts:579`)
  + verified: after a completed scan, a restart posts the last snapshot at once (`demand`, `startRunning`), and unchanged sessions are reused from `file_cache`
  + confirmed 2026-11-11 by the Jest case below, run before the fix: pool disposal did not bump `worker_generation`, so the restart sent the grown transcript to a fresh worker as a `tail`, and `AgentAnalyser.test.ts` > `a stop and restart with the session still live and growing` read 10 input tokens where the whole transcript holds 20
  + confirmed 2026-11-11, run before the fix: the grace elapsing mid-scan disposed the pool under the in-flight round trip, abandoning the scan, and the snapshot stayed `scanning` after the card came back (`lets a scan in flight finish through a withdrawal` and `keeps scanning when a card returns during the first scan` both failed)
+ new pattern: persisting a parse cache across restarts, noted here; no PATTERNS.md entry covers it. The shape is `lib/agentscancacheops.ts` (pure: versioned store, window eviction, trim, key by home) plus `AgentAnalyser.loadScanCache` and `saveScanCache` (the I/O)
+ [X] persist each session's analyser output across window restarts, keyed by its file identities (path, mtime, size)
  + `lib/agentscancacheops.ts` and `AgentAnalyser.loadScanCache` / `saveScanCache`; `AgentAnalyser.test.ts` > `AgentAnalyser persisted read cache` shows a fresh host reading zero transcripts, and only the changed session re-read
  + store it under the extension's global storage, keyed by vendor home, so a remote and a local window never share entries
    + the file is `agent-scan-<hash of the home URI>.json` under `context.globalStorageUri` (`scanCacheFileNameFor`); `keys the store by vendor home` asserts two homes look for two files
  + load it before the first scan, so unchanged sessions are reused and the first post is the last known state
    + decision: the load runs in `resolveVendorHomeAndRun` before the watchers arm and the first scan is scheduled; the first post follows that scan's stat pass, which reads nothing for an unchanged session, rather than being posted before discovery, since a snapshot needs the git trees and story boards the scan reads
  + version the stored shape and discard it on a mismatch
    + `AGENT_SCAN_CACHE_VERSION`; `agentscancacheops.test.ts` and `discards a store of another version or a corrupt one` cover a wrong version, bad JSON and malformed entries; `stores an output of the shape the current store version describes` pins the output's keys so a shape change fails there and asks for a bump
  + evict sessions that leave the 30-day window, so the store stays bounded
    + `serialiseScanCache` leaves out any session whose newest file is past the window and `parseScanCache` drops one that aged out since it was written; `pruneFileCache` already drops sessions no longer found
  + decision: only what a card draws is stored; a call's edit bodies are dropped unless it targets a story board (the binder reads only those), and no message text is ever held (`stores no edit body of a source file and no message text`)
  + decision: a first scan saves at most every 15 s between batches, so an interrupted one resumes, and every scan saves at its end when anything changed
+ [X] carry first-scan progress on the snapshot: sessions read so far and sessions found
  + `ActivityAnalyserState.progress` in both type files, set by `AgentAnalyser.noteScanProgress` on every scanning post and absent once live; `AgentAnalyser.test.ts` > `reads the open repository's sessions before newer ones` asserts 8 of 10
+ [X] drop the scanning notice from a card already drawing sessions, keeping the dimmed count `AgentMetaRow` shows while scanning
  + `AgentActivityBanner.tsx` > `emptyNotice` shows it only with no sessions; `AgentNote.test.tsx` and `agent-card.spec.ts` > `draws no scanning notice on a card already drawing sessions` assert no notice and `data-scanning` on the count
+ [X] show progress in the notice on a card with no sessions, e.g. `Scanning agent activity, 212 of 624 sessions`
  + new string in all five l10n bundles; asserted in `AgentNote.test.tsx` and `agent-card.spec.ts`
+ [X] mark a card's own scan done once every session that could belong to its repository has been read
  + `ActivityAnalyserState.done_roots` lists the repository roots no unread session could belong to (`rootsWithNothingLeftToRead`, `scopeMayBelongTo` in `agentanalyserops.ts`); `isAgentCardScanDone` in the webview turns it, a live state or a completed scan into the card's own `scan_done`
  + confirm the Claude Code folder-name mapping first; where it holds, use it at discovery
    + it holds (the confirmed line above); discovery now stamps each Claude Code and Grok candidate with its scope, and `names a Claude Code project folder for its sessions' own cwd` ties the fixture folder to the cwd
    + decision: a session could belong to a repository when its folder names the root, a folder inside it or a symlinked alias of it, or sits above it (an umbrella-folder session can write into a repository below); a Codex rollout, whose folder is unknown, holds every repository back until it is read, so a card is never called done early
  + read sessions in the open folder's repositories first, newest first within them
    + `orderCandidates` puts sessions that could belong to an open workspace folder or repository first, then the rest, each by mtime; the first test above reads four older `/ws` sessions ahead of six newer ones from another folder
  + a done card with no sessions says `No agent activity in 30 days` without waiting for the rest
    + asserted in `AgentNote.test.tsx` and `agent-card.spec.ts` > `says a card has no agent activity once its own repository is read`; a card whose repository is not among the finished ones keeps the progress notice
+ [X] write a Jest case that stops, restarts, appends to a live session and asserts its usage covers the whole transcript
  + `AgentAnalyser.test.ts` > `a stop and restart with the session still live and growing keeps its usage covering the whole transcript`; its worker double clears the line cache on `terminate`, as a real worker thread does; run before the fix it failed with 10 tokens against 20
  + run it before the fix, to confirm or disprove the suspected under-count
+ [X] bump `worker_generation` whenever the pool is disposed, if that case fails
  + the case failed, so `stopRunning` now bumps it; the same case passes
+ [X] let a scan in flight finish through a withdrawal, stopping the analyser only once it ends
  + the grace timer sets `stop_after_scan` while a scan runs and `runScan` stops the analyser when it ends, unless a card came back; `lets a scan in flight finish through a withdrawal` and `keeps scanning when a card returns during the first scan` pass, having failed before the change
+ [X] add a Jest case asserting a restart with nothing changed reads zero transcripts
  + `a restart after the grace with nothing changed reads zero transcripts and posts the last snapshot at once` (in-memory restart) and `a new window reuses what the last one read` (fresh host from the store); also the log line `loaded N session(s) from the persisted read cache` and the scan line's `0 read, N skipped` show it on a real restart
+ [X] add a Playwright case: agent card type on, wait for live, switch card type away past the grace and back, and assert the sessions redraw at once with no scanning notice
  + `agent-card.spec.ts` > `redraws every session at once, with no scanning notice, when the card type is switched away past the stop grace and back`; the harness has no host grace, so it covers the webview's side (the latched completed scan) and the Jest cases above cover the host's
+ [X] log one debug line per first-scan batch with sessions read so far, so a long first scan reads as progressing
  + `runScanBatch` debug line, `first scan batch 2 of 76: 140 of 624 session(s) read, 41200ms in`; `logs one debug line per first-scan batch` asserts it and that a later scan adds none
+ manual: restart a Remote-SSH window on a large history and confirm the agent cards fill within seconds


### Single-file kanban falls back to document view [](?id=single-file-kanban-auto-view&status=code-review)

Opening a file tagged `[](?nt_view=kanban)` through NoteThink: Open Viewer draws a flat document instead of a board whenever the workspace holds other files. View settings resolve to "Auto (Document)" and no columns render.

+ parallel: inferred to sit in the webview auto-view path (`AutoView.tsx`, `useAutoIntegration.ts`), so it can run alongside the other batch stories; if the fix lands in `PanelSession.ts`, run it apart from [[latest-folder-scan-wins]] and [[shared-parse-worker-scheduling]]
+ background
  + measured in vscode-test-web, 2026-09-25: the file alone in its workspace resolves "Auto (Kanban)" with 2 columns and 7 cards; the same file among four sibling files resolves "Auto (Document)" with none
  + identical at ee0626c and on the current tree, so it predates the performance work
  + the Playwright specs miss it because they inject `selectionChanged` directly instead of going through the real open-viewer path
  + inferred, untested: the default "Watch unopened files in viewer" setting may let sibling files outvote the active file's own `nt_view` during auto-resolution
+ [X] find where auto-resolution picks the view type in current-file mode and why sibling files change it
  + measured in vscode-test-web with a real Open Viewer: the sibling files do not matter, the file alone in its workspace resolves Auto (Document) too when it declares `nt_view` on its H1
  + measured: with the source editor visible beside the viewer the same file resolves Auto (Kanban), alone or among siblings; a front-matter `nt_view` resolves kanban either way
  + cause: Open Viewer opens over the source's only tab, so no editor shows it and the host sends a null selection; the focused chain is then only the root note, and AutoView read `nt_view` only from the focused chain, which misses the H1
  + the inferred "Watch unopened files in viewer" cause did not hold: its watcher arms for the active file only (PanelSession.ts syncActiveFileWatcher) and never feeds a sibling into the view
+ [X] make a current-file open honour the active file's `nt_view`
  + AutoView.tsx: a non-folder view takes the file's declared view type (fileDeclaredViewType, H1 over front matter) when no focused note votes; a focused note's own `nt_view` still wins
  + the fix lands in the webview (AutoView.tsx), not PanelSession.ts
+ [X] add a spec that opens a file through the real open-viewer path in a multi-file workspace and asserts kanban columns render
  + `playwright/specs/open-viewer-single-file-kanban.spec.ts` serves the built extension through @vscode/test-web, opens a tagged file beside four siblings, runs NoteThink: Open Viewer and asserts kanban with columns; it failed (document, no columns) before the fix and passes after
  + unit coverage in `AutoView.test.tsx` (cleared caret, no focus, no tag, focused note override)


### Latest folder scan wins [](?id=latest-folder-scan-wins&status=doing)

Typing a new Include filter can leave the board and the Files drawer showing the result of an older, partial pattern. On 2026-09-25, in a workspace of about 2200 markdown files, `**/{todo,done}.md` showed `(0 in 0 files)` while 22 files on disk match it.

+ parallel: edits `PanelSession.ts`, as [[shared-parse-worker-scheduling]] does, so those two run one after the other with this one first; it can run alongside every other batch story
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
+ [X] stamp each folder discovery with a generation number in PanelSession
  + `folder_scan_generation` in `PanelSession.ts`, bumped by each `enterFolderMode`; the scan carries its number through `discoverFolderDocs`, `loadDiscoveredDocs` and `loadFolderDoc`
  + re-verified against the current tree first: the overlap and the missing same-folder guard were as described; `ParsePool.ts` and `ParseScheduler.ts` needed no change
+ [X] drop a stale scan's findFiles result, its per-file loads, its aggregate payload and its `pending=false`
  + a superseded scan returns after `computeWorkspaceProjects`, after discovery, after the cache check and after each load, so it never touches the totals, the discovery batch, the aggregate, the pending flag or the watcher
  + decision: the newer scan's own `pending` pair brackets the visible state, so a stale scan sends no `pending=false`; in-flight parses are not cancelled (out of scope)
+ [X] add an extension test: two deferred `findFiles`, the older resolves last, the board keeps the newer set and discovered count
  + `notethinkEditor.test.ts` > "the latest folder scan wins": older resolves last, older resolves first, and a truncated winner; two of the three fail with the guards removed and all pass with them
  + assert payload fields, not the breadcrumb string
  + include one `**/{todo,done}.md` case on the same path
  + do not use `**/{todo` as the only fixture
+ [X] keep `(X in Y of M files)` when the winning scan is truncated (PATTERNS.md > "Bounded lists say they are bounded")
  + the totals and `aggregate_truncated` are still set only by the winning scan; the truncated-winner test asserts `aggregate_truncated`, the full discovered count and the capped doc count when a smaller older scan lands last
+ [ ] verify in that workspace: reload the window with Include `**/{todo,done}.md` and confirm stories from 22 files
  + ran a public-safe stand-in: `playwright/specs/folder-latest-scan-real-host.spec.ts` generates 2222 markdown files with 22 `todo.md` / `done.md`, serves the built extension through @vscode/test-web, opens the viewer in folder mode (label `of 2222 files)`), then types the Include filter `**/{todo`, `**/{todo,`, `**/{todo,d`, `**/{todo,done}.md` with a pause longer than the drawer debounce after each; the settled label is `in 22 files)` with stories from both a first and a last project visible
  + residue: the stand-in also passes with the guards removed (a test-web host walks a virtual filesystem, so its scans complete in order), so it guards the typing path but does not reproduce the race; the reload of the real window with the persisted Include filter on a host using `findFiles` is not automated and stays for the operator
+ open question: will the operator reload the original workspace in VS Code with Include `**/{todo,done}.md` and report the label (expecting stories from 22 files), or split that check into its own story so this one can advance?
+ out of scope
  + cancelling in-flight parses from the parse-offload work; a stale scan's results are ignored, not aborted


### Chief-of-staff workflow pack [](?id=chief-of-staff-pack&status=doing)

Someone running coding agents against stories in a `todo.md` has no ready-made way to ask an agent "what should be worked on next?" or "what do I need to do right now to keep the agents busy?", or to watch that work on a board. This story ships a workflow pack in `workflows/chief-of-staff/`: two agent skills, the story rules they rely on, and a board that opens in NoteThink, where each step links to the markdown that drives it.

+ parallel: new files under `workflows/` only, so it can run alongside any other batch story
+ approach
  + layout: `todo.md` (the board, `# Todo [](?nt_view=kanban)`), `AGENTS.md`, `CLAUDE.md`, `README.md`, `skills/what-next/SKILL.md`, `skills/me-now/SKILL.md`, and a script that moves a finished story to `done.md`
  + `AGENTS.md` holds the content, so every agent reads it; `CLAUDE.md` holds only `@AGENTS.md`
  + board stories: install the skills, run `/what-next`, run `/me-now`, let the agent keep the board; each links to the file it describes, so a click opens that markdown in the viewer
  + the skills are written for any repo: they find `todo.md` and `done.md` relative to the workspace, and name no user, path or project outside the pack
  + the board opens signed out in a browser through notethink.com's app route for public GitHub files, which needs [[single-file-kanban-auto-view]] fixed and notethink.com's default view set to auto
+ what `AGENTS.md` > How stories work carries, the subset of the rules these skills depend on
  + encoding: `###` stories under `# Todo` or `# Done`, a `[](?status=...&id=...)` heading linetag, `+ [ ]` and `+ [X]` tasks, exactly two blank lines around each story
  + priority is position: the top story is next, and a new story goes in at the top
  + states: untagged, `doing`, `code-review`, `testing`, done; set `doing` on starting, and tick each task the moment it is done
  + an advance is a claim: the work exists, every box is ticked with evidence, and nobody narrows a story to pass
  + the move to `done.md`: append at the end, strip `status=`, keep the other keys, refuse while any box is open
  + `[](?work=manual)` marks only what no agent can do, and `+ manual:` lines are checks, not tasks
  + content shape, decision lines, phases as separate stories, and `[[slug]]` references to a pinned `id=`
  + left out: rules that only make sense with tooling the pack does not ship, such as a coordinator, a review bus, multi-repo runs, time-taken tags, and machine or server setup
+ sanitise: everything in the pack is published, so it is checked before it is committed
  + a Jest scan over `workflows/` catches absolute home paths, emails, IP addresses and host:port pairs, analytics ids, secret-shaped strings, links that leave the pack, and em or en dash glyphs
  + the scan takes an optional terms file from outside the repo, for names that must not appear but cannot be listed publicly, and reports matches masked
  + quotes and process narrative are still a judgement, per `AGENTS.md` > This repository is public
+ decision: the Jest scan and script tests live in `client/extension/src/workflows/`, the one Jest project whose node environment fits them, and the move script is a dependency-free `.mjs` so a stranger can run it with plain Node
+ decision: the optional terms file is a path held in an environment variable read by the scan test; findings print rule, file, line and a masked match, never the text
+ decision: `workflows/**` is added to `.vscodeignore` so the pack stays out of the VSIX; `.mjs` is ignored by eslint and tsc includes only each client `src`, so the pack is outside lint scope already
+ decision: the board's link walk is a permanent Playwright spec, which also guards the pack against later changes
+ residue: the signed-out browser check through notethink.com's app route waits on the push, since the pack is not public until then
+ [X] write `AGENTS.md` with the How stories work section, and a `CLAUDE.md` holding only `@AGENTS.md`
  + evidence: `workflows/chief-of-staff/AGENTS.md`, `CLAUDE.md`; `workflowspack.test.ts` asserts CLAUDE.md is exactly `@AGENTS.md`
+ [X] write `what-next` and `me-now` as repo-local skills that point only at files in the pack
  + evidence: `workflows/chief-of-staff/skills/*/SKILL.md`; the link scan and the resolve-every-link test pass over them
+ [X] add the move-to-done script with Jest tests for the append, the `status=` strip, the open-box refusal and a dry run
  + evidence: `workflows/chief-of-staff/scripts/move-to-done.mjs`, 11 tests in `client/extension/src/workflows/movetodone.test.ts` driving the script as a process
+ [X] write the board `todo.md` and `README.md`, each story linking to its file
  + evidence: `workflows/chief-of-staff/todo.md`, `README.md`, `done.md`; `workflowspack.test.ts` checks every board story links an existing markdown file in the pack
+ [X] add the sanitise scan as a Jest test over `workflows/`, with a test proving each pattern is caught and the terms file is masked
  + evidence: `sanitiseops.ts`, `sanitiseops.test.ts` (a test per rule), `workflowspack.test.ts` (scan of `workflows/`, passes with no terms file, masked terms file case)
+ [X] confirm in VS Code that each board link opens its markdown in the viewer
  + evidence: `playwright/specs/workflow-pack-links.spec.ts` runs the real extension in a VS Code web host over a copy of the pack, opens `todo.md` in the viewer and follows the four distinct links (`AGENTS.md`, `README.md`, both `SKILL.md`), each showing its target's title; passed
+ [ ] once pushed, open the board signed out through notethink.com's app route and confirm columns render and links open, in the same run
+ open question: this check can only run after the push, so the story cannot reach code-review first; ship it at doing and run the check straight after the push (recommended), or split the check into its own story?
+ [X] bump the patch version
  + evidence: `package.json` 0.4.35


### Evaluate AgentChevron as a duplicate expand control [](?id=agent-chevron-duplicate-eval&status=code-review)

Question: is `AgentChevron` (`client/webview/src/notethink-views/src/components/notes/agent/AgentChevron.tsx`) a duplicate of another expand or collapse control that is worth refactoring, to reduce technical debt and make the code more readable?

+ parallel: reads code and writes only to this board, so it can run alongside any other batch story
+ known: 8042cc4 (agent tree) added `AgentChevron.tsx`
+ suspected: other expand or collapse controls in the webview may already do the same job under another name; nothing has searched for them yet
+ [X] Search the webview for existing chevron, caret, disclosure or expand controls and compare each with `AgentChevron` (`git log` on each)
  + `AgentChevron.tsx:13-19` is an inline SVG (path `M6 4l4 4-4 4`, `currentColor`) with `.agentChevron` and `.agentChevronOpen` (`AgentNote.module.scss:197-209`: opacity 0.8, 0.1s rotate(90deg), reduced-motion off); 4 callers, all in `agent/` (`AgentSessionRow.tsx:169`, `AgentChildRows.tsx:87`, `AgentFileBand.tsx:98`, `AgentPendingCommits.tsx:73`), each a native button or treeitem with `aria-expanded`; added once in 8042cc4, no history since
  + `DrawerTree.tsx:67,78`: a text `›` glyph passed in by each caller (`JumpDrawer.tsx:58,68`, `SettingsViewDrawer.tsx:527`, `SettingsCardDrawer.tsx:175`) in `.drawerTreeGlyph` (`ViewRenderer.module.scss:755-766`: 1em box, opacity 0.7, rotate(90deg) when open, no transition); the row's `li` carries `aria-expanded`; last touched 14bee99, 9342e9d
  + `ToolbarTab.tsx:42,62-67`: the same `›` glyph in `.toolbarTabChevron` (`ViewRenderer.module.scss:953-967`: 1em box, opacity 0.8, rotate(90deg) closed and rotate(-90deg) open, so it points down then up); `aria-expanded` on the button; `data-direction` read by `GenericView.test.tsx:1468` and `settings-toggle.spec.ts:193`; last touched 19d3010
  + `SettingsViewDrawer.tsx:797,837` and `ErrorBoundary.tsx:64`: native `<details>` and `<summary>`, whose twisty is the browser's own marker, not a drawn chevron: different mechanism, no overlap
  + breadcrumb separators (`BreadcrumbPathSegments.tsx:34`, `BreadcrumbNoteSegments.tsx:41`, `BreadcrumbTrail.tsx:132`) are a static `›`, not a control: no overlap
+ [X] Record a verdict with `file:line` evidence: a duplicate worth refactoring, or different enough to keep, and why
  + verdict: `AgentChevron` is the component to keep, and it is a partial duplicate worth a small refactor: three places draw the same rotating chevron three ways (SVG in `AgentChevron.tsx:15`, rotated text glyph in `DrawerTree.tsx:78`, rotated text glyph in `ToolbarTab.tsx:62-67`), with two near-identical CSS blocks (`ViewRenderer.module.scss:755-766` and `953-967`) beside `AgentNote.module.scss:197-209`
  + the drift is already visible: opacity 0.7 vs 0.8, rotation only transitions on the SVG, and the glyph depends on the font's `›` weight, which the DrawerTree and ToolbarTab comments (`ToolbarTab.tsx:35`) say they match by hand
  + different enough to keep apart: the three differ in wiring, not drawing. `ToolbarTab` flips down to up (a drawer opening, not a tree node), and `DrawerTree` takes its glyph from caller data so a leaf row can be blank; only the drawn mark and its CSS are shared, so the refactor is the mark, not the controls
  + not worth merging: the controls themselves (the agent buttons, `DrawerTreeItem`, `ToolbarTab`) differ in markup and keyboard handling, and `<details>` stays native
+ [X] If it is worth refactoring, file the refactor as its own story at the top of this board, with a `builds on` line naming the component to keep
  + filed as `shared-chevron-mark` at the top of this board


### Watcher applies dependency and config changes [](?id=watch-restarts-on-config&status=code-review)

`pnpm run watch` recompiles on source changes, including those a `git pull` lands. A pull that changes a `package.json`, a `pnpm-lock.yaml`, `webpack.config.js` or a `tsconfig*.json` is not applied: the bundles keep building against stale config or modules until someone restarts the watcher by hand.

+ parallel: touches only `scripts/watch.mjs` and the `watch` script in `package.json`, so it can run alongside any other batch story
+ background
  + `watch` is `SELFINSPECT_ENV=dev webpack --watch` (`package.json` scripts); it logs to `test-results/dev.log`
  + measured: webpack watches only its module graph, so it never re-reads `webpack.config.js` or ts-loader's `tsconfig`; in a minimal project under `webpack --watch`, editing the config and the tsconfig caused no recompile, and a later source edit recompiled with the old DefinePlugin value and the old `target` still applied
  + there are four lockfiles: root, `client/extension`, `client/webview` and `client/webview/src/notethink-views`, the last three installed by the root `postinstall`
  + no PATTERNS.md entry for a self-restarting watcher; new pattern
+ approach
  + a `scripts/watch.mjs` supervisor runs webpack in watch mode as a child and watches the config and dependency files itself
  + a lockfile or `package.json` change stops webpack, runs `pnpm install --frozen-lockfile`, then restarts webpack
  + a `webpack.config.js` or `tsconfig*.json` change restarts webpack only
  + changes are debounced, so a pull touching many files causes one restart
  + a failed install is logged loudly and webpack is not restarted against half-installed modules
  + SIGTERM and SIGINT are forwarded to the child, so stopping the watcher by PID stops everything
+ decision: the decision logic is `scripts/watchops.js` (CommonJS so the extension Jest project, whose `roots` and `testMatch` now include `scripts/*.test.js`, runs `scripts/watchops.test.js`)
+ decision: a `package.json` change installs only when its dependency fields, `pnpm` block or `packageManager` changed; a version bump restarts for the root file (webpack.config.js reads it) and does nothing for nested ones
+ decision: only the four package directories are watched, non-recursively, so there is no inotify cost from `node_modules`
+ [X] add `scripts/watch.mjs` and point the `watch` script at it, keeping `SELFINSPECT_ENV=dev` (`package.json` scripts.watch is `SELFINSPECT_ENV=dev node scripts/watch.mjs`)
+ [X] keep the child's command line matching `webpack --watch` with the repo root as cwd, which is how a running watcher is found (the child is `sh -c 'webpack --watch; exit $?'`, seen in `pgrep -af "webpack --watch"` with cwd at the repo root)
+ [X] cover the decision logic with tests: which changed path means install and restart, restart only, or nothing (`scripts/watchops.test.js`, 38 tests: path classification, dependency fingerprint, batch plan, debounce)
+ [X] verify against a running watcher: rewrite `webpack.config.js` unchanged, touch a lockfile, and read each restart and the new compile in the log (run in a fresh install of a scratch copy so a running dev watcher was left alone: the config rewrite logged `changed: restart` and a new `webpack --watch` compiled; touching `client/webview/pnpm-lock.yaml` logged `changed: install`, a `pnpm install --frozen-lockfile` and a restart; a dependency added without a lockfile logged a loud install failure with webpack left stopped, and reverting it restarted webpack; SIGTERM left no child)
+ [X] bump the patch version (0.4.36)


### Compact agent card: usage in status line, folded files [](?id=agent-card-compact&status=code-review)

The agent card spends space on things the operator does not read. The usage summary (tokens, time window, cost) takes its own line under the status line, and the uncommitted files list shows three rows plus "and N more" at the bottom. The operator wants the card denser: usage folded into the status line, the file list collapsed behind a one-line summary, and a new line showing how many commits are waiting.

+ builds on: the agent card in `client/webview/src/notethink-views/src/components/notes/AgentNote.tsx:43` and its parts in `agent/`
  + status line: `agent/AgentMetaRow.tsx:27` renders `{0} agent(s)` as `styles.agentCount`
  + usage line: `agent/AgentUsageSummary.tsx:26` renders `formatActivityUsage` from `lib/agentactivityops.ts`, e.g. `8203112 tokens (2d) ~$12.40`
  + files: `agent/AgentFileBands.tsx:13` folds at `UNCOMMITTED_ROW_LIMIT = 3`, with the "and N more" and "Show less" buttons in `agent/AgentFileBand.tsx:128`
  + expand control: reuse `AgentChevron` with `aria-expanded`, as the subagent toggle in `agent/AgentChildRows.tsx:80` does; no new disclosure component
  + colours: `--nt-agent-waiting` (the "Waiting on you" orange) and `--nt-agent-idle` (muted grey) in `AgentNote.module.scss:15`
+ no PATTERNS.md entry covers card density or disclosure rows; this is a new pattern, noted when the story lands
+ decision 2026-11-10 (operator): drop the usage line and put tokens and cost on the status line, e.g. `1 agent, 8.2Mt, ~$12.40`
  + drop the `(s)`: one session reads `1 agent`, more read `3 agents`, using a plural-aware l10n string
  + tokens use a `t` suffix with K, M or G: `32Kt`, `8.2Mt`, `1.1Gt`; one decimal below 10 of a unit, none at 10 or above
  + cost is approximate, so always prefixed `~$`
  + the time window is not carried over; the card stops showing it
  + the status line never wraps: `white-space: nowrap` and `overflow: hidden` on the row, no ellipsis
+ decision 2026-11-10 (operator): the uncommitted files become one expandable row, collapsed by default
  + the row reads `5 uncommitted files +120 -34`, with the green and red counts styled as `LineDiffCounts` already does
  + expanding shows the whole file list, with no three-row fold and no "and N more" button
  + with nothing uncommitted the row reads `No uncommitted files`, not expandable
+ decision 2026-11-10 (operator): a pending commits row sits under the files row
  + grey (`--nt-agent-idle`) when there are none: `No pending commits`
  + yellow (`--nt-agent-waiting`, matching "Waiting on you") when there are some: `2 pending commits`
+ decision 2026-11-11 (operator): "pending" means local commits not yet pushed, the count the branch is ahead of its upstream
  + with no upstream branch the row reads `No upstream` in grey
  + verified: no ahead or unpushed count exists today; `ActivityTree` (`types/AgentActivity.ts:311`) has `committed` from the reflog (`agentgitops.ts:152`), which is not an ahead count
  + suspected, not verified: the git extension state behind `git.api.getRepositoryState` (`agentgitops.ts:26`) carries `HEAD.ahead`; confirm before relying on it
+ known gap: line counts stop after `AGENT_LINE_DIFF_MAX_FILES_PER_REPO = 20` files (`AgentAnalyser.ts:58`), so the summary total can undercount
  + when any file lacks counts, the row title (hover text) says how many files the counts cover
+ [X] add a token formatter giving `32Kt`, `8.2Mt`, `1.1Gt` in `lib/agentactivityops.ts`, with Jest cases at each unit boundary
+ [X] rewrite the `AgentMetaRow` count as plural-aware `1 agent` / `3 agents`, followed by `, <tokens>, ~$<cost>`
+ [X] make the status row `nowrap` with hidden overflow, so a narrow card clips the end of the line
+ [X] remove `AgentUsageSummary` from the card and delete the component and its test if nothing else uses it
+ [X] replace the three-row fold in `AgentFileBands` with one collapsed summary row that expands to the full list via `AgentChevron`
  + keep the expansion in the card-level `setNoteExpanded` state the current "and N more" uses, so it survives a re-render
+ [X] show partial-count coverage in the files row hover text when any file has no counts
+ [X] add a `pending_commits` count (or `undefined` with no upstream) to `ActivityTree` in both mirrored type files, `client/extension/src/types/AgentActivity.ts` and the webview copy
+ [X] read the ahead-of-upstream count in `client/extension/src/vscode/agentgitops.ts`, with Jest cases for ahead, level and no upstream
+ [X] render the pending commits row under the files row, grey at zero or no upstream and `--nt-agent-waiting` above zero
+ [X] add Jest coverage for `AgentMetaRow` and `AgentFileBands`, which have no direct tests today
+ [X] update `playwright/specs/agent-card.spec.ts` for the usage line gone, the collapsed files row, its expansion, and both pending commit colours
+ [X] update `README.md` > Agent activity if it describes the usage line or the file fold
+ [X] bump the patch version
+ manual: judge the new card density on a busy story in the kanban view, at a narrow column width
+ note: ahead count verified in the git extension's `git.api.getRepositoryState` handler, which spreads `HEAD` (a `Branch`) so `HEAD.ahead` and `HEAD.upstream` are present, and `ahead` is only set when an upstream exists; `pendingCommitsOf` in `agentgitops.ts` reads `HEAD.upstream` then `HEAD.ahead`
+ note: new pattern for card density: a one-line collapsed summary row opened by `AgentChevron` with `aria-expanded`, state kept in the card-level `setNoteExpanded` list (`AgentFileBand.tsx`), and a single status line carrying counts (`AgentMetaRow.tsx`)
+ design revised 2026-11-11: the pending row's grey states use the files row's grey, not `--nt-agent-idle`, and a clean pushed card folds both rows into one line; see [[agent-card-quiet-line]]


### Coordinators beside boards in folder and project views [](?id=coordinator-views&status=code-review)

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
+ design revised 2026-11-12: a card's send action is no longer an envelope on the headline; it moves into the action tray at a highlighted card's bottom-right corner and asks for confirmation before it writes one envelope; see [[card-action-tray]]
+ design revised 2026-11-12: the coordinator list no longer sits above the board; it moves into the Card drawer under the agent card type, each row shows the vendor's two-letter mark instead of the program version, and a drop-down asks the coordinator to change vendor; see [[coordinator-drawer-vendor]]
+ [X] add a registry reader that lists `agent.json` entries and filters by repo path inside the open folder
  + evidence: `readRegistry` in AgentAnalyser.ts, `parseRegistryEntry` and `coordinatorsInScope` filter in agentregistryops.ts and webview coordinatorops.ts
+ [X] add a list of registered agents with their state to the folder view and the project view
  + evidence: `CoordinatorPanel.tsx` mounted in GenericView.tsx; spec "a folder view lists each registered coordinator..." and "a view open on one repository..."
+ [X] add a "send to agent" action on the board and on a card that writes an envelope to the agent's mailbox
  + evidence: `CoordinatorCommands.ts` send (temp file then rename into inbox) and `StorySendButton.tsx` on cards
+ [X] render the `[](?coord=<host>)` marker as a draggable line, rewriting the linetag on drop
  + evidence: `CoordinatorTargetLine.tsx`; spec "drags with a real pointer to the story it is released after"
+ [X] add a keyboard path that moves the target line without dragging
  + evidence: `useTargetLineControls` Up/Down/Home/End; spec "moves with the keyboard alone, keeping focus on the line"
+ [X] show open convoys and operator steps on their stories
  + evidence: `parseBoardStories` convoys and operator_steps, rendered in `TargetStory`; spec "lists the board with the line... convoys and steps on their stories"
+ [X] cover the registry filter, the envelope write and the marker move with Jest tests
  + evidence: coordinatorops.test.ts (both copies), CoordinatorCommands.test.ts, CoordinatorPanel.test.tsx, StorySendButton.test.tsx
+ [X] cover the folder view, the project view and the draggable line with Playwright tests
  + evidence: playwright/specs/coordinator-views.spec.ts, 14 tests
+ [X] extend the Agent activity section of `README.md` with the registry source and the show-only rule
  + evidence: README.md "Coordinators beside boards" subsection and Known Limitations
+ [X] bump the patch version
  + evidence: package.json 0.4.33 -> 0.4.37 across this batch (0.4.37 is this story)


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
+ open question: hold this story until thinkersync releases its client library and per-instance process (recommended), or build it now against a fake of their contract and swap in the real client later?