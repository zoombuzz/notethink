# Todo [](?ng_view=kanban)


### Aggregate (Directory) view: merge files into a single view

+ goal
  + in Directory mode, show one merged visualisation of all matching files rather than N stacked copies of the single-file view
  + each merged leaf note carries an origin tag so the user can see which file it came from
  + this is the foundation for a project-plan Kanban that aggregates stories (the `###` headings) from every `todo.md` under `active_development/*/` into one board
  + the user-facing authoring conventions this story relies on (heading levels, linetag encoding, epic IDs) live in `AUTHORING_GUIDE.md` at the repo root — keep any UI copy, error messages, and badge formatting consistent with that guide

+ current broken behaviour (to anchor the design)
  + `setIntegration` in `client/extension/src/vscode/notethinkEditor.ts` sends the full set of directory docs in one `update` message
  + `ExtensionReceiver` stores the whole set in `state.docs`
  + `NoteRenderer` loops `Object.entries(props.notes).map(...)` and renders one `<NoteView>` per doc, so every file gets its own `GenericView`, toolbar and breadcrumb (visible as multiple stacked top-level headers in the screenshot from 2026-04-24)
  + the breadcrumb click handler in each `NoteView` is scoped to that file — clicking `docstech` inside `done.md`'s breadcrumb only re-issues `setIntegration path=.../docstech`; the rendered DOM (N stacked views) does not change because the server-sent `docs` map is unchanged, so the breadcrumb at the top appears frozen
  + `AutoView` reads `ng_view` per-file with no cross-file reconciliation — if two files disagree there is no concept of "the" view type

+ design decisions (please approve or adjust before implementation)
  1. **single merged root, not composite stacking** — build a synthetic `RootNote` (seq=0) in the webview whose `child_notes` are the `###` stories gathered from every matching file. This is the only shape that lets AutoView pick one view type and lets a single Kanban render stories from many files in the same columns.
  2. **merge in the webview, not the extension** — extension stays a pure file provider (per-doc MDAST, unchanged). `NoteRenderer` detects `integration_mode === 'directory'` and calls a new `mergeAggregateRoot(docs)` helper. Keeps single-file mode's incremental-edit round-trip fast and avoids duplicating MDAST parsing on the extension side.
  3. **origin tagging as a new `NoteProps` field, not a linetag** — add optional `origin?: { doc_id: string; doc_path: string; relative_path?: string }` in `notethink-views/src/types/NoteProps.ts`. Origin is derived from the file path and is not user-authored, so it doesn't belong in the linetag vocabulary. The field is undefined in single-file mode — no change to existing behaviour.
  4. **no data-shape change to `todo.md` / `done.md`** — origin is inferred from the file path on load. If we later want a project label independent of the path, a root-level linetag like `[](?ng_origin_label=oma)` can be added without touching the rest of the design. Flagging this rather than doing it now.
  5. **AutoView resolution across merged children** — when the merged root has children with mixed origins, take a majority vote on `ng_view` across the top-level note of each originating file (one vote per file, not per story). Ties or no votes fall back to `document`. Manual override via `ViewTypeSelector` continues to work and is persisted via `setViewManagedState` as today.
  6. **single breadcrumb, path segments = integration directory** — in Directory mode, breadcrumb path segments reflect the aggregated directory path (e.g. `notethink › docstech › users`), not any single file. Clicking a segment re-issues `setIntegration` with the segment's path, which narrows the set. Note-hierarchy segments keep working because they operate on the merged tree's `parent_notes`.
  7. **edits must round-trip to the right file** — the merged tree's `postMessage` wrapper (currently stamped with one docId per `NoteView` in `NoteRenderer.tsx`) must instead resolve the docId from the clicked note's `origin`. Applies to `editText`, `revealRange`, `selectRange`.
  8. **cross-project aggregation (`active_development/*/docstech/...`) is a follow-up**, not this story. Current `setIntegration` only accepts a single directory path. Once in-directory merge works, a later story can introduce a multi-root integration (a setting or a glob that spans workspace roots).
  9. **story-heading convention** — confirmed across all `active_development/*/docstech/users/alex.stanhope/{todo,done}.md` files. Reserved levels:
     + `#` = file title (one per file; e.g. `# Todo`, `# Done`)
     + `##` = **epic** — an optional grouping above stories, not a card itself; may carry an optional `id=` linetag (e.g. `## New Relic integration [](?id=nr)`) for stable references
     + `###` = **story** — the unit that becomes a Kanban card
     + `####`+ = sub-sections within a story
     The aggregator therefore walks children of the file `#`. Depth-3 children are stories, added directly to the merged root. Depth-2 children are epics — the aggregator recurses one level and surfaces their depth-3 children as stories, with the epic's headline carried as `origin.epic` metadata so the card can show an epic badge alongside the project badge.
  10. **epic resolution rule** — a story can pick up its epic from three places. Evaluate **most-specific first**, stop at the first hit:
     1. direct linetag on the story — `[](?epic=X)`. Resolves to the unique epic with `[](?id=X)` if one exists, else to the unique epic whose stripped headline equals `X`, else the literal value is rendered as the badge label with no link.
     2. inherited from an ancestor — `ng_child_epic=X` (or `ng_child2y_epic=`, `ng_childall_epic=`) on a parent. Same id-or-exact-name resolution. **The inheritance itself is already wired**: `applyChildAttributeInheritance` in `client/webview/src/notethink-views/src/lib/convertMdastToNoteHierarchy.ts` already propagates `ng_child_*` linetags down to descendants and stamps `inherited: true` — `ng_child_epic` works for free without new inheritance code.
     3. structural — the parent `##` heading; epic name = parent's stripped headline, epic id = parent's `id=` linetag if present.
     **"Stripped headline"** = `headline_raw` with the heading prefix (`#+\s*`) and any trailing linetag block (`\s*\[[^\]]*\]\(\?[^)]*\)\s*$`, repeated) removed. Define this once as a helper in `noteops.ts` (or wherever fits) and reuse it in `BreadcrumbTrail.tsx` (which currently has its own inline `stripMarkdownHeadline` that only handles the heading prefix).
     **Not regex.** Reference values are exact-match against id or stripped headline. Regex/glob is a future view-level filter concern (e.g. `ng_filter_epic=^Phase\s` on the view root) and is explicitly out of scope here.
  11. **linetag value encoding** — values are URL-form-encoded so they remain valid CommonMark link destinations and continue to render as invisible empty links on github.com. Rules:
     + space → `+` (form-encoding standard; `URLSearchParams` already decodes `+` → space, no NoteThink parser change needed)
     + literal `+` → `%2B`
     + literal `&` → `%26` (because `&` separates linetag keys)
     + literal `)` → avoid (it terminates the link destination in the regex)
     + everything else passes through unchanged. CommonMark forbids spaces in unbracketed link destinations, so writing `[](?epic=Phase 3)` would render as visible markdown source on GitHub — `+` keeps it invisible.

+ data migration
  + countingsheet/todo.md already migrated `## Phase` → `### Phase` (verified 0 `##` in todo.md as of 2026-04-30); countingsheet/done.md still has 17 `##` historical entries — out of scope for this story unless the user wants them fixed
  + [ ] notegit: fix 4 stray `##` story-level headings to `###`
    + `notegit/docstech/users/alex.stanhope/todo.md:1097` — `## NG priorities surfaced by alpha feedback`
    + `notegit/docstech/users/alex.stanhope/done.md:1097` — `## NG confirm dialogue`
    + `notegit/docstech/users/alex.stanhope/done.md:1345` — `## NG multi-tenancy`
    + `notegit/docstech/users/alex.stanhope/done.md:1465` — `## NG images not working on live`
  + zoombuzz/done.md is missing a `# Done` H1 — minor; aggregator must already cope with files lacking an H1 (see test list below)

+ code changes
  + [ ] add `origin?: { doc_id: string; doc_path: string; relative_path?: string }` to `NoteProps` in `client/webview/src/notethink-views/src/types/NoteProps.ts`
  + [ ] new `client/webview/src/notethink-views/src/lib/mergeAggregateRoot.ts`
    + `mergeAggregateRoot(docs: HashMapOf<Doc>, integration_path: string): { root: NoteProps; all_notes: NoteProps[] }`
    + parses each doc via `convertMdastToNoteHierarchy` (which already applies `applyChildAttributeInheritance`, so inherited `ng_child_epic` arrives pre-resolved on each story's `linetags`)
    + classification of headings is via mdast `depth` field — **never regex on raw text**. lightenna-iac/todo.md contains lines like `# before` / `# after` inside fenced HCL code blocks, which a regex would mis-classify as headings; `convertMdastToNoteHierarchy` correctly classifies them as `code` nodes
    + for each parsed file, walks the children of the file's H1 root:
      + depth-3 children → push as stories under the synthetic merged root, stamping `origin = { doc_id, doc_path, relative_path }`
      + depth-2 children (epics) → recurse one level; their depth-3 children become stories, stamped with `origin.epic = { name, id? }` where `name` is the epic's stripped headline and `id` is the epic's optional `id=` linetag value
      + ignores deeper-than-3 children at the file root (those are sub-sections inside a story, not separate cards)
      + handles the file-with-no-H1 case (zoombuzz/done.md) by treating depth-3 children of the document root as stories
      + handles the empty file / no-stories case (oma/todo.md) by contributing zero entries
    + after the per-file walk, builds a `Map<id-or-name, EpicRef>` across all loaded epics and resolves each story's `epic=` / inherited `ng_child_epic=` linetag against it (id wins; else exact name; else literal). The story's resolved epic overrides any structural `origin.epic` set during the walk.
    + concatenates the resulting stories under a synthetic root with stable sort (relative path, then in-file seq)
    + re-numbers `seq` globally so seqs remain unique within the merged tree
  + [ ] new `mergeAggregateRoot.test.ts` — one file, many files, empty files, files with no H1 (zoombuzz/done.md case), files with `##` epics wrapping `###` stories, mixed `ng_view` root attributes; **epic resolution**: id-based ref resolves; exact-name ref resolves; ambiguous name across projects resolves separately per project; unresolved ref renders as literal label; direct `epic=` overrides inherited `ng_child_epic=` overrides structural `##` parent
  + [ ] `client/webview/src/components/NoteRenderer.tsx` — when any `viewState.display_options.integration_mode === 'directory'`, stop the per-doc map and render a single `<NoteView>` built from `mergeAggregateRoot(...)`. The wrapper that stamps outgoing messages with `docId`/`docPath` must read `note.origin` for aggregated notes.
  + [ ] `client/webview/src/notethink-views/src/components/views/AutoView.tsx` — detect a synthetic root (root note with children of mixed origins) and apply the majority-vote rule before falling back to `document`
  + [ ] `client/webview/src/notethink-views/src/components/views/GenericView.tsx` — pass an `integration_path` through to `BreadcrumbTrail` in directory mode so path segments reflect the aggregated directory rather than any one file
  + [ ] `client/webview/src/notethink-views/src/components/views/BreadcrumbTrail.tsx` — accept the new `integration_path` prop and branch `splitPathSegments` on it in directory mode (doc-path behaviour unchanged in current-file mode)
  + [ ] `client/webview/src/notethink-views/src/components/notes/` — render a small origin pill next to the headline when `note.origin` is set (tooltip = full relative path; click = `revealRange` on the origin doc). Exact location to confirm during implementation; likely `GenericNoteAttributes.tsx` or a sibling.
  + [ ] `client/extension/src/vscode/notethinkEditor.ts` `setIntegration` handler — replace the one-shot `findFiles` with a watcher scoped to the integration path so adds/edits/deletes stream incremental `update` messages (same UX as current-file hot-reload)

+ tests (Jest)
  + [ ] `mergeAggregateRoot`: single file, multiple files, empty files (oma/todo.md case — file with H1 but no stories), file with no H1 (zoombuzz/done.md case), `##` epic containing `###` stories (epic metadata propagates), stable ordering, origin stamped on descendants (not just direct children), global seq uniqueness
  + [ ] `mergeAggregateRoot`: epic resolution — id-based ref, exact-name ref, unresolved literal, precedence (direct > inherited > structural)
  + [ ] `AutoView`: majority-vote picks the right type across mixed `ng_view`; ties fall back to `document`; single-file mode unchanged
  + [ ] `NoteRenderer`: directory mode renders one `GenericView`, not N
  + [ ] `NoteRenderer`: outgoing `editText` in directory mode carries the origin doc's path, not the synthetic root's
  + [ ] `BreadcrumbTrail`: directory mode renders integration-path segments; current-file mode unchanged
  + [ ] `linetagops`: `[](?epic=Phase+3+New+Relic)` round-trips to `epic = "Phase 3 New Relic"` (sanity-add — relies on `URLSearchParams` form-decoding); `%26` round-trips to literal `&`; literal-space inputs (e.g. legacy markdown) still parse via the lenient `[^\)]*` regex
  + [ ] **regression guard** — every existing Jest test must continue to pass. The change should be additive: single-file (current_file) mode behaviour is unchanged; the only new code path is when `integration_mode === 'directory'`. `pnpm run jest-test` baseline is 488 — the new tests should bring this up, never down.

+ tests (Playwright)
  + [ ] open a directory with 2+ `todo.md` files, switch to Directory mode, observe a single toolbar and a single breadcrumb at the top
  + [ ] click a breadcrumb path segment — breadcrumb updates and the aggregated set narrows to that subdirectory
  + [ ] switch the aggregated view to Kanban — stories from all files land in the correct columns (by status linetag); origin pills visible
  + [ ] toggle a checkbox on an aggregated story — the correct origin file is edited (verify file content on disk)

+ open questions for the user
  + origin pill styling — project-only label (e.g. `oma`), project+area (`oma/docstech`), or icon + tooltip? when an `origin.epic` is also set, render as a second pill or combine (`oma · Phase 3`)?
  + in aggregate Kanban, should stories without a status linetag land in a default column or be hidden? (current single-file behaviour is: they go to Untagged)
  + countingsheet/done.md still has 17 historical `## Phase`/`## Stream` entries; leave as-is or migrate them too?

+ notes
  + supersedes the `Convert top-level 'docs' container to RootNote [post-v1]` story below — that story described the same merged-root idea but as a post-v1 rewrite of the single-file case. Consider deleting the post-v1 story once this one is approved.


### Publish NoteThink 0.1.x to marketplace (requires manual work)

+ [ ] create extension icon
  + 128x128 or 256x256 PNG in `media/icon.png`
  + needs to be visually clear at small sizes in the marketplace sidebar
  + once created, add `"icon": "media/icon.png"` to root package.json
+ [ ] create ZoomBuzz publisher account
  + register at marketplace.visualstudio.com
+ [ ] test against edge cases before release (manual)
  + install the .vsix locally (`code --install-extension notethink-0.1.0.vsix`)
  + file with special paths (spaces, unicode filenames)
  + workspace with 100+ markdown files (performance check)
  + verify no console errors in developer tools
+ [ ] publish to marketplace
  + `vsce publish 0.1.x`
  + verify listing appears correctly


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
