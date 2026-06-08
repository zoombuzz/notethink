# Todo [](?nt_view=kanban)


### Folder-mode origin pills flash from one colour to another on first load [](?id=folder-pill-hue-flash-on-load)

When a folder integration view first loads, every origin pill paints in one colour and then changes to a second colour a moment later. It reads as a glitch — there is no logical reason for a project's pill to be two different colours, and the change is distracting. **Decision (chosen): option A — make the pill hue identity-based (a pure function of the project name) instead of index-based (the project's position in an ordered universe), so the colour cannot change as the universe fills in.**

+ root cause (verified in source)
  + pill hue is **index-based, not identity-based**. `OriginPill.tsx:44` uses `origin.project_hue` when present (`pillColourForHue(origin.project_hue, theme)`); `project_hue` is stamped in `mergeAggregateRoot.ts:290` as the project's **position in an ordered universe of project names**, spread around the hue wheel by the golden angle (`hueForProjectIndex`, `originops.ts:35`). A project's colour therefore depends on *where it sorts in the universe*, not on the project name.
  + that universe is seeded from `workspace_projects` (the workspace's top-level subfolders, computed once per `enterFolderMode`, sent on every payload), then any visible project not already in it is appended in **file-arrival order** (`mergeAggregateRoot.ts:233-250`).
  + the webview's `workspace_projects` React state **initialises to `[]`** (`useVscodeMessages.ts:146`) and is **not persisted** — saved state is only `{docs, viewStates}` (`usePersistedViewStates.ts:21`), restored as `initial_docs` in `ExtensionReceiver.tsx:52`.
  + so there is at least one folder-mode paint where `workspace_projects` is still `[]`:
    + **reload / reopen with a folder view active** — persisted `docs` repaint immediately, but the universe is empty until the first live discovery message lands;
    + **manual current_file → folder switch** — pills render against the empty universe before the extension streams the folder payload.
  + with an empty universe the seed loop is skipped and hues come purely from the **visible-file append order**. When the real `workspace_projects` arrives, the merge re-runs and hues are re-derived from the **sorted full-universe** ordering — a different golden-angle index per project — so every pill recolours. Colour 1 = arrival-order hue; colour 2 = sorted-universe hue.
+ why option A (over B/C)
  + the flash exists *because* hue is a function of the universe ordering, and the universe is empty on the first paint. As long as hue depends on the universe at all, the empty→present transition recolours — so the only structural fix is to make hue independent of the universe. That is option A. (B persists/gates the universe; C hides the view until it lands — both keep the universe-dependent hue and are heavier.)
  + identity-based hue also removes the entire **"index shifts when the set changes"** bug-class for colour: folder descents, watcher-driven adds, and the `MAX_AGGREGATE_FILES` truncation can all change the universe membership/order mid-session; today each of those can recolour pills, after this change none can.
  + accepted trade-off: hashing a name to a hue loses the golden-angle guarantee that the *adjacent* projects in a set get maximally-separated hues — two unrelated projects can hash close. This is inherent: "well-spread across the actual set" requires knowing the set; "stable regardless of the set" forbids using it. We take stability. (The single-file fallback `originPillColour` already accepts exactly this trade-off via `djb2(name)%360` — this story makes folder mode use the same identity rule, so single-file and folder now agree on a project's colour.)
+ design
  + **hue becomes a pure function of the project name.** Add `hueForProjectName(name)` to `originops.ts` (`djb2(name) % 360`, the existing fallback hash, now named and shared). `originPillColour` is rewritten to route through it (`pillColourForHue(hueForProjectName(name), theme)`) — functionally identical to today's fallback, just deduplicated.
  + **`mergeAggregateRoot` stamps `origin.project_hue = hueForProjectName(project_name)`** instead of an index into `project_hue_by_name`. The `project_hue_by_name` map is deleted.
  + **labels stay universe-driven.** The universe seed (`workspace_projects` then visible-set append) is kept, but now only feeds `distinct_project_names → buildProjectLabels`. Labels genuinely need the set (NG-vs-NT divergence), and the existing "labels stable across descents" behaviour + tests are unchanged. `mergeAggregateRoot`'s signature and the `workspace_projects` wire field are untouched.
  + **`hueForProjectIndex` is removed** — after the stamp site stops calling it, the only remaining references are its own unit test. Confirm no out-of-repo importer of `@zoombuzz/notethink-views` consumes it before deleting (internal-only per grep today); it is not a persisted/config name, so the permanent-name check is satisfied by that grep.
  + **`OriginPill` is unchanged in behaviour** — it keeps preferring `origin.project_hue` and falling back to `originPillColour`, but the two now yield the *same* colour for a given project, so the previously-throwaway empty-universe paint already shows the final colour.
+ net effect on the flash
  + on the empty-universe first paint, `project_hue` is now derived from the name → identical to the value after the universe arrives → the re-merge produces the same colour → no recolour. Pills paint their final colour immediately.
  + residual (out of scope here): the two-letter **label** is still universe-driven, so it *can* still momentarily shift (e.g. `NT`→`NO`) on the empty-universe paint. That is far less perceptible than a colour change and is the part the user flagged as fine; left as a possible follow-up (would need option-B-style universe persistence/gating to fully fix).
+ scope
  + `originops.ts` — add `hueForProjectName`; rewrite `originPillColour` to call it; delete `hueForProjectIndex`; refresh the `djb2`/`project_hue` doc-comments that reference the index assignment
  + `mergeAggregateRoot.ts` — stamp `project_hue` from `hueForProjectName(project_name)`; drop `project_hue_by_name`; keep the universe seed feeding `buildProjectLabels` only; update the import
  + `types/NoteProps.ts` — update the `project_hue` field doc-comment (no longer "index in the sorted enumeration … golden-angle"; now "identity hash of the project name, set-independent")
+ out of scope
  + the label flash (universe-driven `project_label`) — possible follow-up; the colour is the reported problem
  + persisting `workspace_projects` / gating the first paint (options B and C) — not needed once hue is identity-based
  + any change to `pillColourForHue` saturation/lightness, theme handling, the epic pill, or the focus ring
+ files
  + `client/webview/src/notethink-views/src/lib/originops.ts` (+ `originops.test.ts`)
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` (+ `mergeAggregateRoot.test.ts`)
  + `client/webview/src/notethink-views/src/types/NoteProps.ts`
  + `client/webview/src/notethink-views/src/components/notes/OriginPill.test.tsx` (assertion only — see below)
+ [ ] add `hueForProjectName(name)` to `originops.ts`; rewrite `originPillColour` to route through it; delete `hueForProjectIndex`; fix the two doc-comments that name the index assignment
+ [ ] stamp `origin.project_hue = hueForProjectName(project_name)` in `mergeAggregateRoot.ts`; remove `project_hue_by_name`; keep the universe seed for labels only; swap the import (`hueForProjectIndex` → `hueForProjectName`)
+ [ ] update the `project_hue` doc-comment in `types/NoteProps.ts`
+ [ ] jest (`originops.test.ts`): replace the `hueForProjectIndex` block with `hueForProjectName` — deterministic, in `[0,359]`, **set-/order-independent** (same name → same hue with no context), and equal to the hue embedded in `originPillColour(name)`
+ [ ] jest (`mergeAggregateRoot.test.ts`): a project's stamped `project_hue` is **identical whether `workspace_projects` is provided, empty `[]`, or omitted** (the regression lock for flash-freedom); the existing label-stability tests still pass unchanged
+ [ ] jest (`OriginPill.test.tsx`): with `project_hue` undefined, the rendered `backgroundColor` equals `pillColourForHue(hueForProjectName(project_name), theme)` (single-file ↔ folder agree); keep the existing "uses `project_hue` when present" test
+ [ ] `pnpm run check` green (lint + webpack + rollup + jest)
+ [ ] rebuild the webview bundle and confirm the edit landed (`grep client/webview/dist/index.js` for `hueForProjectName`); window reload needed to preview
+ manual: reload the VS Code window with a folder view active — every origin pill paints its final colour immediately, no one-colour-then-another flash
+ manual: switch a current-file view to folder mode — pills appear in their stable colours with no recolour as files stream in
+ manual: descend via a project pill / breadcrumb into a sub-folder and back — a given project keeps the same colour throughout (no descent recolour)
+ manual: the same project shows the **same** colour in single-file mode and in folder mode
+ acceptance
  + a project's pill colour is a pure function of its name — identical across empty/partial/full universe, descents, watcher adds, and truncation; the first-load colour flash is gone
  + folder-mode and single-file-mode pills agree on a project's colour
  + labels remain universe-disambiguated (NG/NT) and their existing stability tests are unchanged
+ commit message draft
  + notethink x.y.z: make origin-pill hue identity-based (hash of the project name) instead of an index into the project universe, so pills no longer flash from one colour to another on first folder-view load (empty-universe paint now shows the final colour); `hueForProjectName` replaces `hueForProjectIndex`, single-file and folder modes now agree on a project's colour, labels stay universe-driven
  + tests N jest


### Folder mode finds 0 files on non-`file:` workspace schemes (hardcoded `vscode.Uri.file`) [](?id=folder-mode-workspace-scheme)

Folder mode assumes the workspace lives on the `file:` scheme. It builds discovery/watch URIs with `vscode.Uri.file(folder_path)` and matches excludes against `uri.fsPath`. On desktop VS Code the workspace *is* `file:`, so it works — but in **VS Code Web with a custom `FileSystemProvider`** (a non-`file:` workspace scheme — e.g. `vscode-vfs:` like github.dev, or any host that mounts content under its own scheme) discovery searches the wrong scheme: `findFiles` returns nothing, the breadcrumb shows **"0 in 0 files"**, and the folder watcher throws `No file system handle registered (file:///…)`. Net effect: **folder mode is unusable on any web host whose workspace isn't `file:`** — current-file mode is unaffected (it uses the active document's own URI).

+ symptom (reproducible on a custom-scheme web workspace)
  + open a file in a `<scheme>:`-mounted folder, switch View integration → **Folder**: breadcrumb scopes correctly but reports "0 in 0 files", Files drawer says "No files match the current filters"
  + console: `[File Watcher ('FileSystemObserver')] Error: ... No file system handle registered (/…) (file:///…/<folder>)` — note the URI is `file:` even though the workspace scheme is not
  + the Explorer lists the same folder fine — only folder-mode discovery is broken, which proves the provider's `readDirectory`/`stat` are scheme-correct and the bug is local to folder discovery
+ root cause (`client/extension/src/vscode/PanelSession.ts`)
  + `enterFolderMode` (~`:600`): `new vscode.RelativePattern(vscode.Uri.file(folder_path), this.integration_include)` → `discoverFolderDocs` → `vscode.workspace.findFiles(pattern, …)` (~`:672`) searches the `file:` scheme
  + `computeWorkspaceProjects` (~`:642`): `vscode.workspace.fs.readDirectory(vscode.Uri.file(this.workspace_root))` — same wrong scheme
  + `armFolderWatcher` / the active-file watcher (~`:235`): build `vscode.Uri.file(...)` patterns too → the watcher error above
  + `isExcludedByIntegrationFilter` (~`:631`): `path.relative(folder_path, uri.fsPath)` — `uri.fsPath` is `file:`-centric and lossy for non-`file:` URIs, so even if discovery were fixed the exclude match would drift
  + underlying assumption: the webview sends a plain path **string** (`e.path`); the host re-wraps it as `Uri.file`, discarding the real workspace scheme
+ fix
  + derive the workspace base URI from the real workspace folder (`vscode.workspace.getWorkspaceFolder(active_uri)`, else `vscode.workspace.workspaceFolders?.[0]?.uri`) and rebuild every folder-mode URI with `base_uri.with({ path: folder_path })` so the scheme (`file:`, `vscode-vfs:`, any custom provider scheme) is preserved end-to-end: `RelativePattern`, `findFiles`, `computeWorkspaceProjects`, and the watcher
  + replace `uri.fsPath`-based relative-path math in `isExcludedByIntegrationFilter` with scheme-safe `uri.path` arithmetic (compute the path relative to the integration folder's `uri.path`, not `fsPath`)
  + verify `vscode.workspace.findFiles` honours a custom-scheme `RelativePattern` in VS Code Web; if it does not for read-only/custom providers, fall back to a recursive `vscode.workspace.fs.readDirectory` walk (the provider already supports it — that's why the Explorer works) gated to the integration folder, then apply the existing `globMatches` filter
  + `armFolderWatcher` must not throw when the provider's `watch()` is a no-op (static content) — guard it so a watcher failure can't abort folder entry
+ scope
  + `client/extension/src/vscode/PanelSession.ts` — scheme-preserving URI construction in `enterFolderMode`, `discoverFolderDocs`, `computeWorkspaceProjects`, `armFolderWatcher`, `isExcludedByIntegrationFilter`
  + keep current-file mode untouched (already uses the active document URI)
+ out of scope
  + any redesign of the discovery/merge pipeline — this is purely making the existing pipeline scheme-agnostic
  + the file watcher's incremental-update semantics beyond not throwing on a no-op `watch()`
+ files
  + `client/extension/src/vscode/PanelSession.ts`
  + `client/extension/src/vscode/PanelSession.test.ts` (or the nearest covering test) — add a folder-mode test whose workspace is a **non-`file:` scheme** and assert discovery resolves files + the watcher doesn't throw
  + `client/extension/src/__mocks__/vscode.ts` — `findFiles`/`readDirectory`/`RelativePattern` mocks need to capture the URI scheme so the test can assert it
+ [ ] rebuild folder-mode URIs on the active workspace folder's scheme (preserve scheme via `base_uri.with({ path })`); drop all `vscode.Uri.file(folder_path)` in the folder-mode path
+ [ ] make `isExcludedByIntegrationFilter` use scheme-safe `uri.path` relative math instead of `uri.fsPath`
+ [ ] confirm `findFiles` works for a custom-scheme `RelativePattern` in web; if not, add the `readDirectory`-walk fallback
+ [ ] guard `armFolderWatcher` against a no-op/throwing `watch()` so folder entry can't abort
+ [ ] jest: folder discovery with a `vscode-vfs:`-style (non-`file:`) workspace resolves the expected files and exclude-filters correctly; watcher arm does not throw
+ [ ] `pnpm run check` green
+ manual: on a custom-scheme web workspace, open a file in a subfolder and switch to Folder mode — the merged board shows every file in the folder with origin pills and cross-file epics resolved (no "0 in 0 files", no `file://` watcher error)
+ acceptance
  + folder mode discovers and aggregates files on any workspace scheme, not just `file:`
  + no `file://`-scheme watcher error is emitted for a non-`file:` workspace
  + desktop (`file:`) folder mode is unchanged
+ commit message draft
  + notethink x.y.z: fix folder mode on non-`file:` workspace schemes — preserve the workspace folder URI scheme through discovery, exclude-matching, and the watcher instead of hardcoding `vscode.Uri.file`, so folder aggregation works in VS Code Web with a custom FileSystemProvider (previously found 0 files)
  + tests N jest


### Settings/Files drawers show a redundant second "Applying..." spinner [](?id=drawer-spinner-dedupe)

A settings/files apply shows **two** spinners at once: the breadcrumb pending spinner (correct) **and** a second "⟳ Applying..." line inside the open drawer (redundant). One indicator is enough — keep the breadcrumb one, drop the in-drawer copies. Most visible in slow-round-trip hosts (e.g. the browser web-worker extension host, where a global-setting echo takes longer), but the duplication is host-agnostic dead weight — the in-drawer spinner adds nothing the breadcrumb spinner doesn't already convey.

+ root cause (verified in source)
  + the breadcrumb spinner and every in-drawer spinner read the **same** `pending` flag from `usePendingWorkContext()`, so they all render together whenever an apply is in flight
  + keeper — `components/views/BreadcrumbTrail.tsx:110`: `{pending && <Spinner positionClass="InlineLoader" .../>}`, deliberately positioned next to the "(X in Y files)" count. This stays as the single pending indicator.
  + duplicate #1 — `components/views/SettingsCommonControls.tsx:37-42`: `{pending && (<p data-testid="settings-drawer-spinner"><Spinner .../><span> Applying...</span></p>)}`. This component is shared by **both** `SettingsDocumentDrawer` and `SettingsKanbanDrawer`, so the duplicate appears in the Document *and* Kanban settings drawers.
  + duplicate #2 — `components/views/FilesDrawer.tsx:113-118`: the same `{pending && …Applying…}` block (`data-testid="files-drawer-spinner"`), a third copy in the Files drawer.
+ scope
  + delete the `{pending && …Applying…}` block from `SettingsCommonControls.tsx`; drop the now-unused `usePendingWorkContext` + `Spinner` imports and the `const { pending } = usePendingWorkContext();` line (keep the `Debug` import/const per coding standards; `l10n` stays — still used by the labels)
  + delete the same block from `FilesDrawer.tsx`; drop its now-unused `pending`/`Spinner` usages (verify `usePendingWorkContext`/`Spinner` aren't referenced elsewhere in the file before removing the imports; keep the unmount cleanup-timer logic which is unrelated)
  + leave `BreadcrumbTrail.tsx` untouched
+ out of scope
  + the pending/echo round-trip mechanism itself (markPending → echo-clears-pending) — unchanged; only the redundant *rendering* of `pending` is removed
  + the breadcrumb spinner's position or styling
+ files
  + `client/webview/src/notethink-views/src/components/views/SettingsCommonControls.tsx` (+ `SettingsCommonControls.test.tsx` — drop the `settings-drawer-spinner` assertion)
  + `client/webview/src/notethink-views/src/components/views/FilesDrawer.tsx` (+ `FilesDrawer.test.tsx` — drop the `files-drawer-spinner` assertion)
+ [ ] remove the in-drawer spinner from `SettingsCommonControls.tsx`; tidy unused imports; update its test
+ [ ] remove the in-drawer spinner from `FilesDrawer.tsx`; tidy unused imports; update its test
+ [ ] confirm `BreadcrumbTrail.tsx` remains the sole pending spinner (its test already asserts it)
+ [ ] `pnpm run check` green
+ manual: open the Settings drawer (Document and Kanban) and toggle a setting — exactly one spinner shows, in the breadcrumb; no "Applying..." line inside the drawer
+ manual: open the Files drawer and change a filter — one breadcrumb spinner, no in-drawer "Applying..." line
+ acceptance
  + during any settings/files apply there is exactly one spinner (breadcrumb), in every drawer
  + no behavioural change to when/how long the pending state lasts — only the duplicate render is gone
+ commit message draft
  + notethink x.y.z: drop the redundant in-drawer "Applying..." spinner from the settings + files drawers — the breadcrumb pending spinner is the single indicator
  + tests N jest


### Document-level front matter becomes root-note linetags [](?id=frontmatter-document-attributes)

YAML/TOML front matter at the top of a file should be lifted into the file's **document root** note as linetags, then treated *identically* to linetags authored on a heading — including inheritance to descendants. A key like `nt_view` set in front matter must behave exactly as if it were written on the file's H1. This makes front matter the broadest, document-scoped layer of the existing linetag model rather than a separate metadata channel. Prefix handling (`ng_`/`nt_`) is owned by [[broaden-linetag-prefix-nt]]; this story is namespace-agnostic and inherits whatever that migration settles.

+ goal
  + every `key: value` pair in a file's front matter attaches to that file's document-root NoteProps as a linetag, stored verbatim (no prefix logic here — same as `parseLineTags`)
  + once attached, the existing render/inherit/interpret machinery treats them like any heading linetag — no special-casing per key
  + front matter is the *document scope*; it sets defaults that anything below can override
+ decisions (confirmed with the user)
  + **carrier = the document root, not the first note / H1.** The root is the genuine "file note" that owns every note in the file; "first note" is accidental (whatever lands at `seq=1`). The root NoteProps already exists — `type:'root'`, `seq:0`, `level:0`, owns `child_notes` — created at `convertMdastToNoteHierarchy.ts:372-388`. It just carries no linetags today.
  + **precedence: lowest / most-specific wins.** Document level is the broadest default; an H1 linetag overrides a front-matter value, an H2 overrides the H1, etc. This is already how inheritance behaves — `applyChildAttributeInheritance` does `if (note.linetags?.[key]) continue;` so a child's own tag beats an inherited one. Front matter simply becomes the top of that chain.
  + **separate processing from display.** Inheritance is baked per-file at convert time, so it is *mode-independent* and correct in all three render modes. Only the document-level pill strip is mode-dependent.
+ processing (mode-independent — the important half)
  + make the root participate in the existing inheritance pass as the **top ancestor**, so its `nt_child_*` / `nt_child2y_*` / `nt_childall_*` tags propagate down via the same mechanism that already runs between heading levels
  + because this happens during each file's `convertMdastToNoteHierarchy` *before* any merge or render, folder mode "just works": each file's front matter affects only that file's stories, exactly mirroring how per-file linetag inheritance is resolved per-file and then merged in `mergeAggregateRoot`
  + only inheritance-prefixed keys propagate (consistent with today) — a bare `status: done` in front matter stays document-level and does NOT leak to children
+ display (mode-dependent — the only conditional half)
  + render a **document-level linetag strip** (reuse `GenericNoteAttributes`) at the top of the view, bound to the root's linetags
  + shown **only in single-file mode**; suppressed in folder mode (many documents, no single document-scope) and in single-note mode (no file context). NB there is no true single-note mode in code today, so that suppression is forward-looking — cheap because processing already happened at convert time
  + DocumentView already has the natural slot — it renders `GenericNoteAttributes` for `parent_context.linetags` at `DocumentView.tsx:61-63`. KanbanView renders the parent context but has no dedicated attribute strip — add one above the board. AutoView just delegates.
+ the `order` nuance (front-matter vs H1 scope)
  + `order` under the H1 governs notes added *under the H1*. `order` at front-matter/document level governs insertion relative to the *whole document* — so `newest-at-top` at document scope can insert a new note **above** the H1, whereas at H1 scope it inserts below it.
  + therefore document-level `order` must stay readable at the **root** independently of the H1, even though for most keys the post-inheritance H1 value is what the existing reader consumes
+ background / current gaps (the change surface)
  + front matter is already *parsed* into a raw MDAST node — `parseops.ts` enables `frontmatter(['yaml','toml'])` — but the node's `key: value` pairs are never read; it sits in `root.children_body` as a `type:'yaml'`/`'toml'` node with no `seq`
  + the root has no linetags populated and is never parsed for them
  + the root is currently **excluded** from inheritance: `applyChildAttributeInheritance` (`convertMdastToNoteHierarchy.ts:293-325`) skips any note with no `parent_notes`, and the root is not in `all_notes` when the pass runs
  + file-level config (`nt_view`, `order`) is read from the **H1** via `findFileH1` (`mergeAggregateRoot.ts:297,300`) — needs to resolve from the root (front matter) with the H1 as the lower-level override; after root→H1 inheritance runs, the H1 naturally carries the effective value for most keys, but `order` needs the independent root read above
  + need a small flat front-matter parser (YAML + the existing TOML fence) that turns the node text into `key: value` pairs — a new `lib/frontmatterops.ts` (matches the `<noun>ops.ts` naming rule); deliberately minimal like the parser already living in notegit's `frontmatter.ts` (scalars, quoted strings, inline arrays), NOT a full YAML dep
+ scope of work (when picked up)
  + [ ] add `lib/frontmatterops.ts` — parse the front-matter node's text into a flat `{key: value}` map (scalars, quoted, inline arrays); unit tests incl. malformed-yields-empty
  + [ ] in `convertMdastToNoteHierarchy`, read the front-matter node from `children_body` and populate `root.linetags` from it (verbatim keys, via the linetag shape so write-back offsets stay sane)
  + [ ] make the root the top ancestor of the inheritance pass so `nt_child*` / `nt_childall*` on the root propagate to descendants (include root in the chain / lift the no-`parent_notes` skip for root-children)
  + [ ] resolve file-level config from the root with H1 override (lowest-wins), and read document-level `order` at the root independently of the H1
  + [ ] render the document-level linetag strip via `GenericNoteAttributes`, gated to single-file mode (DocumentView slot exists; add the KanbanView strip above the board)
  + [ ] jest: front matter → root.linetags; root `nt_childall_status` reaches a deep note; H1 linetag overrides a front-matter value; folder mode keeps per-file scoping; document-level pills render in single-file and are absent in folder mode
  + [ ] playwright: open a file with front-matter `nt_view`/`order` and confirm the resolved view + insertion behaviour; confirm the document pill strip shows in single-file and not in folder mode
  + [ ] update `AUTHORING_GUIDE.md` — document front matter as the document-scope linetag layer, the lowest-wins precedence, and the `order`-above-H1 nuance
  + [ ] `pnpm run check` green
+ out of scope
  + prefix interpretation (`ng_`/`nt_`) — owned by [[broaden-linetag-prefix-nt]]; this rides whatever it settles
  + a true single-note render mode — does not exist yet; we only design its display-suppression (processing is already mode-independent)
  + notegit's own server-side front-matter consumer — its `src/lib/frontmatter.ts` reads `title`/`description`/`tags` into the SSR `<head>` and is a separate concern (same `---` block, different reader). Worth a follow-up there: notegit currently parses a `defaultView` front-matter key then drops it; once `nt_view` is the document-scope view selector here, retire notegit's `defaultView` to avoid two names for one idea
+ relationships
  + builds on the root-as-container idea also referenced by the post-v1 "Convert top-level 'docs' container to RootNote" story
  + namespace-coupled to [[broaden-linetag-prefix-nt]]
+ files
  + new `client/webview/src/notethink-views/src/lib/frontmatterops.ts` (+ tests)
  + `client/webview/src/notethink-views/src/lib/convertMdastToNoteHierarchy.ts` (root linetags + inheritance top-ancestor)
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` (root-first config resolution; document-level `order`)
  + `client/webview/src/notethink-views/src/components/views/DocumentView.tsx` (document pill strip — slot exists)
  + `client/webview/src/notethink-views/src/components/views/KanbanView.tsx` (document pill strip above the board)
  + `client/webview/src/notethink-views/src/components/notes/GenericNoteAttributes.tsx` (reused for the document strip)
  + `client/extension/src/lib/parseops.ts` (front-matter node already produced — reference only)
  + `AUTHORING_GUIDE.md` (document-scope front matter)


### Animated passive transitions in the kanban view [](?id=animated-passive-transitions)

The visible UX payoff. When the kanban view changes layout because of a *passive* update (external file edit from another VS Code window or editor, AI-agent edit, mtime change, anything not driven by the user's own drag) the affected notes and columns animate from old state to new state in a way that mimics manual drag-and-drop. Depends on [[multi-file-ordering-stable-identity]] (stable note identity is the keying contract) and [[folder-mode-dnd]] (so the manual and automatic UX stay consistent in folder mode) and [[kanban-optimistic-projection]] (the projection seam the FLIP layer decorates; user-initiated drags resolve via the projection, passive updates via FLIP).

+ goal
  + a status-tag change made by an AI agent or another editor animates the affected card from its old column position to its new column position, on the same trajectory the user would see if they had picked it up and dragged it
  + a within-column reorder triggered by mtime, line/sequence, or weight change slides the card to its new vertical slot as if dragged
  + new notes fade in; new columns slide in; column-then-note choreography
  + the animation layer is decorative — the final DOM is correct regardless of whether the animation runs, fails partway, or is interrupted by the next update
+ visual specification — must mimic existing drag-and-drop (`ViewRenderer.module.scss:1103-1115`)
  + in-flight card style: `box-shadow: 0 8px 24px rgba(0,0,0,0.16)`, `transform: rotate(2deg) scale(1.02)`, applied while the FLIP plays and removed at the end
  + cross-column move: card lifts (apply in-flight style), translates from origin rect to destination rect, lands (remove in-flight style), 350 ms ceiling
  + in-column reorder: same lift-and-translate, vertical only
  + new note: fade-in (opacity 0 → 1) with subtle scale (0.96 → 1), 200 ms
  + new column: horizontal slide-in (translateX(-20px) → 0) with fade, 250 ms; notes destined for it begin their cross-column move on the next animation frame after the column lands
  + column disappearance: notes have already left via cross-column moves; column collapses horizontally over 200 ms
+ architectural approach
  + custom FLIP helper, no animation library added to the webview bundle
  + only fires on *passive* updates; user-initiated drag-end remains owned by `@hello-pangea/dnd`
  + progressive enhancement / graceful degradation: the layer is a thin overlay that records pre-commit rects (`useLayoutEffect`), lets React render, then plays inverse transforms via the Web Animations API. If the layer throws, the view is already in its final state — there is nothing to clean up. The contract is: *the final DOM is correct without the animation layer; the animation layer only decorates the transition between two correct states*
  + the passive-update FLIP and the user-drag projection share one reconciliation seam — `passiveUpdateGate` becomes "user-move reconciliations resolve silently (projection already showed the move), passive ones resolve via FLIP"
+ behaviour contract — graceful degradation
  + 350 ms ceiling per individual transition; if a second update arrives mid-animation the in-flight animation is cancelled and the next FLIP measures from the *current live rect*, not the previous "to" rect
  + 800 ms global cap from "update received" to "final state visible" — if FLIP math has not completed by then, `el.getAnimations().forEach(a => a.finish())` snaps to final state
  + respects `prefers-reduced-motion: reduce` (existing precedent at `ViewRenderer.module.scss:330`) — animation layer no-ops, final state appears immediately
  + if a note's `stable_id` is absent from the previous registry, treat as new (fade-in); if absent from the next, treat as removed (fade-out)
  + if rect math throws or returns NaN, swallow and snap
+ scope
  + new `lib/animation/flipMath.ts` — pure functions (inverse transform, keyframe spec) — unit-testable without DOM
  + new `lib/animation/useFlipTransition.ts` — hook: registry of (`stable_id` → element ref), `useLayoutEffect` to capture pre-commit rects, `useEffect` to play inverse transforms
  + new `lib/animation/passiveUpdateGate.ts` — flag set by `KanbanView.dragEndHandler` for a short window (~250 ms) after user drag so the layer skips that re-render and does not double-animate
  + wire the hook around the note list in `KanbanView.tsx` with `key={note.stable_id}` (replacing `key={note.seq}`)
  + wire column enter/exit in `KanbanColumn.tsx` using CSS keyframes (FLIP requires a prior rect — columns appearing for the first time have none)
  + add settings drawer toggle `kanban_animate_transitions` (Global scope, default true) so users can disable the layer
  + ship a test-only probe `KanbanAnimationProbe` (gated by a debug flag, not in default bundle path) that emits an event stream the test harness can subscribe to — replaces relying on pixel-diffing in jest
+ out of scope
  + animating non-kanban views (document/mermaid) — possible follow-up
  + animating origin-pill colour changes or focus-ring transitions
  + per-card origin-pill flash during the move — possible v2 polish
+ files (proposed)
  + new `client/webview/src/notethink-views/src/lib/animation/flipMath.ts`
  + new `client/webview/src/notethink-views/src/lib/animation/useFlipTransition.ts`
  + new `client/webview/src/notethink-views/src/lib/animation/passiveUpdateGate.ts`
  + `client/webview/src/notethink-views/src/components/views/KanbanView.tsx` — wire hook around column list and note list; key by `stable_id`
  + `client/webview/src/notethink-views/src/components/views/KanbanColumn.tsx` — column enter/exit
  + `client/webview/src/notethink-views/src/components/ViewRenderer.module.scss` — column slide-in/out keyframes
  + `client/{extension,webview}/src/constants.ts` — `KANBAN_ANIMATION_TRANSITION_MAX_MS = 350`, `KANBAN_ANIMATION_GLOBAL_CAP_MS = 800`, `KANBAN_ANIMATION_DRAG_GATE_MS = 250`
  + settings drawer + extension contributes a `notethink.kanbanAnimateTransitions` boolean (Global target), wired through `ExtensionReceiver`
+ [ ] implement `flipMath.ts` with unit-testable pure functions (inverse transform, keyframe spec)
+ [ ] implement `useFlipTransition` hook — registry + `useLayoutEffect` rect capture + Web Animations API playback
+ [ ] implement `passiveUpdateGate` — flag set by `KanbanView.dragEndHandler`, hook skips animation while the flag is hot
+ [ ] wire hook around the kanban note list; replace `key={note.seq}` with `key={note.stable_id}`
+ [ ] wire CSS-keyframe column enter/exit in `KanbanColumn.tsx`
+ [ ] choreograph new-column case: column enter completes (or starts ~50 ms ahead) before inbound notes begin their FLIP
+ [ ] respect `prefers-reduced-motion` (hook no-ops, no Web Animations calls)
+ [ ] add `notethink.kanbanAnimateTransitions` setting (Global target, default true) + drawer checkbox with locale strings in all 5 locales
+ [ ] jest: `flipMath` unit tests (no DOM, pure functions)
+ [ ] jest: `useFlipTransition` with jsdom + mocked `getBoundingClientRect` — verifies the right transforms get scheduled
+ [ ] jest: `passiveUpdateGate` suppresses the hook within 250 ms after `dragEnd`
+ [ ] jest: stable_id absent in previous render → fade-in path fires; absent in next → fade-out path fires
+ [ ] jest: `prefers-reduced-motion` makes the hook no-op
+ [ ] jest: 800 ms global cap snaps to final state
+ [ ] playwright: cross-column animated transition (fire an external file edit changing a status tag; assert intermediate transform present at ~150 ms; assert final DOM matches the new state regardless of animation playback)
+ [ ] playwright: in-column animated reorder (mutate mtime via the harness; assert vertical slide; assert final order)
+ [ ] playwright: new column appearance choreography (introduce a status value that has no column; assert column enter completes before notes arrive)
+ [ ] playwright: user-initiated drag is NOT double-animated (drag a note; assert the FLIP layer event stream is empty for that re-render)
+ [ ] playwright: rapid-burst (fire 5 status changes within 200 ms; final state correct, no stuck or orphaned animations after 1 s)
+ [ ] playwright: `prefers-reduced-motion` (emulate via Playwright; assert no transform keyframes, final state instant)
+ [ ] `pnpm run check` green
+ manual: open a folder, have an AI session edit a status tag in one of the files, confirm the card animates from old column to new column on the same path a drag would follow
+ manual: external edit (e.g. via another VS Code window) reorders a note within a column, confirm vertical slide
+ manual: prefers-reduced-motion enabled in OS settings, confirm no animation, view still consistent
+ manual: toggle `kanban_animate_transitions` off, confirm everything snaps without animation and stays correct
+ test plan
  + visual correctness checked structurally (DOM in final state, computed transform sequence sane) rather than pixel-diffing
  + the `KanbanAnimationProbe` test-only component reads the animation layer's internal event stream and exposes it to the harness so jest can assert *what was scheduled* without needing a real `requestAnimationFrame` loop
  + playwright tests assert final state after the animation should have settled, plus optional intermediate checks at 50 ms / 200 ms via `page.evaluate(() => element.getAnimations())`
+ acceptance
  + externally-driven status changes animate the card on a path visually consistent with a drag-and-drop of that card
  + externally-driven reordering inside a column animates the card on a vertical slide
  + new notes fade in; new columns slide in; column-then-note choreography holds
  + user-initiated drags do not double-animate
  + `prefers-reduced-motion` users see instant transitions
  + an exception in the animation layer cannot leave the view in an inconsistent state — final DOM is always correct within the existing re-render budget
  + setting `notethink.kanbanAnimateTransitions = false` disables the layer entirely with no visible regression in correctness
+ open questions for the implementing agent
  + whether to coalesce two file events arriving within ~50 ms into a single FLIP cycle (vs animating both)
  + whether to flash the origin pill on the moving card during the animation (probably v2)
  + the exact easing curve — proposal: `cubic-bezier(0.2, 0, 0.0, 1.0)` to match a "thrown" feel, consistent with the existing settings-drawer easing at `ViewRenderer.module.scss:321`
+ commit message draft
  + notethink 0.2.16: kanban transitions animate via in-house FLIP helper for passive updates (external file edits, AI-driven status changes, mtime reorders)
  + new notes fade in; new columns slide in with notes choreographed in afterwards; user-initiated drags untouched
  + animation layer is decorative — final DOM is correct regardless of playback (350 ms per-transition + 800 ms global ceiling, `prefers-reduced-motion` respected, `notethink.kanbanAnimateTransitions` setting to disable)
  + tests N jest, N playwright


### View hierarchy and per-view card-type axis [](?id=view-hierarchy-and-card-types)

The view system today has a flat dispatch (`GenericView.tsx:774-776`): `auto` → `document` → `kanban`. Two structural changes in one story:

1. **View hierarchy.** Kanban is one instance of a more general *column-based* view. Other column-based views (group-by-assignee, group-by-type, group-by-any-attribute) should inherit kanban's column primitives without re-implementing them. Introduce a `ColumnBasedView` base.
2. **Card-type axis.** Orthogonal to view choice. Within any view a note can be rendered as a full card (current default — pill, title, attributes, body) or a compact summary (e.g. a sticky-note). Introduce an `nt_card` linetag alongside `ng_view`, with auto-resolution and a second toolbar selector — "Auto (Card)" alongside the existing "Auto (Kanban)".

+ goal
  + future column-based views can declare a different column-derivation function and reuse all of kanban's column rendering, ordering, drag-and-drop, and (once it lands) animation infrastructure
  + the card rendering used by any view is selectable independently of the view itself; the default per view stays the current full card
  + `nt_card` overrides apply at the file H1 level just like `ng_view` does today, with the same auto-resolution semantics
+ background
  + view dispatch lives at `GenericView.tsx:33` (`SELECTABLE_VIEWTYPES = ['auto', 'document', 'kanban']`) and `GenericView.tsx:774-776` (hard-coded switch)
  + auto-resolution: `AutoView.tsx:27-49` majority-votes `origin.file_view_type` across files in aggregate mode; `AutoView.tsx:75-77` reads focused-note `ng_view`
  + card rendering: `GenericNote.tsx:13-74` lazy-routes by `props.type` (default `'markdown'`); `MarkdownNote.tsx` renders pill → title → attributes → body
  + view toolbar selector: `ViewTypeSelector.tsx:30-54` rendered at `GenericView.tsx:662-670`, labels the chip "Auto (Kanban)" using the auto-resolved type
  + no existing extension point — each view today is independent and hard-coded; no base class, no registry
+ scope — view hierarchy
  + new `components/views/ColumnBasedView.tsx` — base component that owns the column-building memo, the column header bar, the drop-zone wiring, and column-order persistence (factored out of `KanbanView.tsx:73-107`)
  + `ColumnBasedView` accepts a `columnDerivation` prop: `(notes) => { columns, assignNoteToColumn, columnLabel }` — kanban supplies "by `status` linetag value", future views supply their own (by `assignee` linetag, by `type` linetag, by any computed attribute)
  + `KanbanView.tsx` becomes a thin wrapper that supplies the status-tag derivation and delegates the rest to `ColumnBasedView`
  + no new column-based view shipped in this story — the proof is the kanban refactor demonstrating no regression
+ scope — card-type axis
  + new `nt_card` linetag, parsed alongside `ng_view` by `mergeAggregateRoot` and stamped onto `origin.file_card_type`
  + new `SELECTABLE_CARDTYPES = ['auto', 'card', 'sticky']` — `auto` + the existing full card + one new compact card to prove the registry
  + new `components/notes/CardRegistry.ts` — registry `{ [card_type]: (note, display_options) => ReactElement }`; entries: `card` → existing `MarkdownNote`, `sticky` → new `StickyNote`
  + new `components/notes/StickyNote.tsx` + `.module.scss` — compact rendering: pill + title only, no attributes, no body, tighter padding
  + `GenericNote.tsx` switches on `props.display_options?.card_type` and dispatches via the registry instead of hard-routing by `props.type`
  + auto-resolution for card type: majority-vote `origin.file_card_type` across files (mirror `AutoView.tsx`); each view registers its own default card type (kanban → `'card'`)
+ scope — toolbar UI
  + extend `ViewTypeSelector` (or add a sibling component) to render a second select labelled "Auto (Card)" / "Card" / "Sticky"
  + label semantics match the view selector — show the auto-resolved type in parentheses when set to auto
  + dispatch: `setViewManagedState({ card_type: ... })` mirroring the view-type dispatch
  + layout: two selects side-by-side at `GenericView.tsx:662-670`; on narrow widths they wrap to two rows
+ out of scope
  + shipping a second column-based view (group-by-assignee etc.) — follow-up; this story only sets up inheritance
  + further card types beyond `card` and `sticky` — registry is open, more added later
  + per-note `nt_card` override (file-level only for now)
  + animation-layer integration — the work in [[animated-passive-transitions]] keys on `stable_id`, which is orthogonal to card type
+ files
  + new `client/webview/src/notethink-views/src/components/views/ColumnBasedView.tsx`
  + `client/webview/src/notethink-views/src/components/views/KanbanView.tsx` — slim wrapper around `ColumnBasedView`
  + new `client/webview/src/notethink-views/src/components/notes/CardRegistry.ts`
  + new `client/webview/src/notethink-views/src/components/notes/StickyNote.tsx` + `StickyNote.module.scss`
  + `client/webview/src/notethink-views/src/components/notes/GenericNote.tsx` — switch on `card_type` via registry
  + `client/webview/src/notethink-views/src/components/views/ViewTypeSelector.tsx` — second select for card type
  + `client/webview/src/notethink-views/src/components/views/GenericView.tsx` — `SELECTABLE_CARDTYPES`, dispatch handlers
  + `client/webview/src/notethink-views/src/components/views/AutoView.tsx` — majority-vote card type alongside view type
  + `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts` — capture `nt_card` from file H1 → `origin.file_card_type`
  + `client/webview/src/notethink-views/src/types/NoteProps.ts` — `card_type?: string` on `NoteDisplayOptions`; `file_card_type?: string` on `NoteOrigin`
+ [ ] factor `ColumnBasedView` out of `KanbanView`; verify byte-identical render for existing fixtures
+ [ ] introduce `CardRegistry` with `card` (existing `MarkdownNote`) + `sticky` (new `StickyNote`)
+ [ ] add `nt_card` linetag parsing in `mergeAggregateRoot`; capture on `origin.file_card_type`
+ [ ] add card-type auto-resolution in `AutoView` mirroring the view-type majority vote
+ [ ] add second toolbar selector — "Auto (Card)" / "Card" / "Sticky" — dispatch to `setViewManagedState`
+ [ ] each view declares its default card type (kanban → `'card'`); auto picks the default when no `nt_card` votes are present
+ [ ] jest: `ColumnBasedView` exposes the same column shape under arbitrary `columnDerivation` (kanban-derivation + a fake derivation by another attribute)
+ [ ] jest: kanban refactor renders byte-identical against existing fixtures
+ [ ] jest: `CardRegistry` returns `MarkdownNote` for `'card'`, `StickyNote` for `'sticky'`, falls back to view default for `'auto'`
+ [ ] jest: `nt_card` on a file H1 is captured into `origin.file_card_type`
+ [ ] jest: `AutoView` majority-votes card type independently of view type
+ [ ] playwright: switch second selector from "Auto" to "Sticky" — note cards collapse to compact form
+ [ ] playwright: file with `nt_card=sticky` on H1 in folder mode — auto-resolved card type is sticky for that file's notes
+ [ ] playwright: existing kanban specs all green (refactor regression check)
+ [ ] `pnpm run check` green
+ manual: open a folder with mixed `nt_card` values across files — toolbar shows "Auto (...)" with the majority-voted card type
+ manual: explicitly set card type to "Sticky" — all notes render compactly across columns
+ manual: switch back to "Auto" — auto resolution recovers
+ acceptance
  + kanban view works identically after the `ColumnBasedView` refactor (no visible regression)
  + a second selector appears in the toolbar with the same Auto / explicit semantics as the view-type selector
  + `nt_card` linetag at file H1 cascades into the auto-resolved card type for that file
  + `StickyNote` renders pill + title only; switching back to `card` restores the full card
  + future column-based views can be added by supplying a different `columnDerivation` without re-implementing column layout or drag-and-drop
+ open questions for the implementing agent
  + per-note `nt_card` override (currently file-level only) — defer to a follow-up unless trivial
  + whether the two selectors share a single composite control or stay as two siblings — leaning two siblings for symmetry with "Auto (Kanban)"
  + naming of the base — `ColumnBasedView` vs `GroupedView` vs `BoardView`; first is most descriptive
+ commit message draft
  + notethink 0.2.18: kanban becomes a thin specialisation of new `ColumnBasedView` base so future column-based views (group-by-assignee, group-by-type, etc.) can inherit column layout, ordering, and drag-and-drop
  + introduce `nt_card` linetag and `CardRegistry` — second toolbar selector "Auto (Card)" picks between `card` (full) and `sticky` (compact summary); `nt_card` on file H1 cascades into auto-resolution
  + tests N jest, N playwright


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


### Optimisation cycle [post-v1]

+ create language server
  + communicate to separate thread via LSP
    + add to webpack watch
  + investigated previously, deferred as non-essential for now
  + revisit once delta computation works
+ consider whether parsing (mdast-util-from-markdown) is the bottleneck
  + or whether it's the React re-rendering
  + profile before optimising
