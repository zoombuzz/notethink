# NoteThink Authoring Guide

How to structure your markdown files so NoteThink renders them well — as
documents, as Kanban boards, and (in Folder mode) as cross-file aggregate
views.

This guide covers the conventions you need to follow as a **document author**.
For coding standards (TypeScript, React, file naming), see
[CODING_STANDARDS.md](./CODING_STANDARDS.md). For agent-facing project
guidance, see [AGENTS.md](./AGENTS.md).

**This guide is versioned. Current version: `1.1.0`.** See
[Versioning](#versioning) for what patch / minor / major changes mean and how a
file can pin itself to an older version.

---

## Versioning

The grammar this guide describes is versioned with [semantic
versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`. The current version is
**`1.1.0`**. `1.1.0` added the optional `nt_integration_mode` and
`nt_breadcrumb_last` view-configuration linetags (backward-compatible — files
that don't use them are unaffected); `1.0.0` was the first formally versioned
baseline of the existing grammar.

What each kind of change means for your files:

| Bump | What changes | Effect on existing files |
|---|---|---|
| **patch** (`1.0.x`) | Editorial fixes, clarifications, examples — the grammar itself is unchanged | None. Every file renders exactly as before |
| **minor** (`1.x.0`) | New, backward-compatible features (a new optional linetag, key, or behaviour) | None. Files that don't use the new feature render exactly as before |
| **major** (`x.0.0`) | Changes that could alter or remove how an existing construct is interpreted | A file written for an older major version *may* render differently — see locking below |

### The default: latest

Every file is interpreted against the **latest** version of this guide. Files
do **not** need to record which version they were written for, and most never
will. (We may revisit this once a second major version exists.)

### Locking to an older version

When a future **major** version introduces a breaking change, an author can
keep a file on the old behaviour by pinning it on the file root (`#`):

```markdown
# Todo [](?nt_view=kanban&nt_authoring_version=1)
```

`nt_authoring_version` accepts `MAJOR` or `MAJOR.MINOR` (e.g. `1` or `1.2`).
It is **reserved and documented now for forward-compatibility** — only versions
`1.0.0` and `1.1.0` exist today (no major bump yet), so the flag currently has
no effect. It exists so that files authored today keep working unchanged the day
a `2.0.0` ships.

Mixed-version workspaces are supported: in Folder mode, different files may pin
different versions and each is interpreted independently.

---

## TL;DR

```markdown
# Todo [](?nt_view=kanban)


## New Relic integration [](?id=nr)

### Add APM agent [](?status=doing&epic=nr)

Description of the story goes here.

+ [ ] task one
+ [X] task two


### Add synthetic monitor [](?status=todo&epic=nr)

Another story.
```

- One `#` per file (the title).
- `##` is an **epic** (an optional grouping above stories). Add `[](?id=...)` for stable references.
- `###` is a **story** (a Kanban card).
- Two blank lines before and after each story.
- Linetags use `key=value&key2=value2`. Spaces in values become `+`.

That's enough to get going. The rest of this document explains the rules in detail.

---

## File structure

### Heading levels are reserved

| Level | Meaning | Example |
|---|---|---|
| `#` | File title — exactly one per file | `# Todo`, `# Done` |
| `##` | Epic — an optional grouping above stories | `## New Relic integration` |
| `###` | Story — the unit that becomes a Kanban card | `### Add APM agent` |
| `####`+ | Sub-sections inside a story | `#### Manual steps` |

You may skip `##` entirely — most projects don't use epics.

You may **not** use `##` for anything other than an epic. NoteThink's aggregate
view treats every `##` heading as an epic and every `###` heading as a story,
regardless of what you intended. Mixing meanings will produce a garbled Kanban.

### Spacing

- **No blank line** at the top of the file above the file's title.
- **Exactly two blank lines** before and after each story (`###`).
- **One blank line** between an epic heading and the first story under it.

The two-blank-line rule is what distinguishes a story break from a section
break inside a story. Tools that update `todo.md` / `done.md` rely on it.

### `todo.md` and `done.md`

Each developer keeps their work in two files at
`docstech/users/<username>/todo.md` and `docstech/users/<username>/done.md`.

- Stories in `todo.md` are read **top-to-bottom** — the next story to work on
  is always the one at the top.
- When all tasks in a story are checked off, move the whole story from
  `todo.md` to the **end** of `done.md` (preserve the two-blank-line spacing).

---

## Linetags

A **linetag** is an empty markdown link with a query-string body, written at
the end of a heading or paragraph. It carries metadata that NoteThink reads
but humans (and GitHub) treat as invisible.

```markdown
### Add APM agent [](?status=doing&epic=nr)
```

That `[](?status=doing&epic=nr)` is a linetag with two keys: `status=doing`
and `epic=nr`.

### Why the `[]` is empty

A markdown link with empty link text and no visible characters renders as
nothing on github.com. NoteThink's parser ignores the empty `[]` but reads the
URL. So linetags carry data without polluting the rendered prose.

You can also write linetags with link text — `[Done](?status=done)` — in which
case GitHub renders "Done" as a clickable link and NoteThink uses the same
metadata. Most authors use the empty form.

### Anatomy

```
[link-text](?key1=value1&key2=value2&key3=value3)
^         ^ ^                                   ^
|         | |                                   |
|         | |                                   end of linetag
|         | start of linetag (the leading ?)
|         |
|         link destination begins
|
optional visible link text
```

### Multiple keys

Separate keys with `&`, just like a URL query string:

```markdown
### Some story [](?status=doing&epic=phase3&time_estimated=180)
```

Order is irrelevant. Keys are unique within a single linetag — if you write
the same key twice, the last value wins.

### Multiple linetags on one line

You can stack linetags side by side. NoteThink merges them as if they were a
single linetag:

```markdown
### Some story [](?status=doing) [](?epic=nr)
```

Equivalent to:

```markdown
### Some story [](?status=doing&epic=nr)
```

The merged form is preferred unless you have a reason to split (e.g. one
linetag is auto-generated and another is hand-written).

### Encoding rules — what to type when your value contains a special character

NoteThink linetag values are URL-form-encoded. The full set of rules:

| Character in your value | Type instead | Why |
|---|---|---|
| space | `+` | CommonMark forbids spaces in unbracketed link destinations; `+` is the form-encoding standard for space and decodes back automatically |
| literal `+` | `%2B` | because `+` now means space |
| literal `&` | `%26` | because `&` separates linetag keys |
| literal `)` | avoid | it terminates the link destination — pick another character |
| literal `=` | (no escape needed) | NoteThink uses the *first* `=` as the key/value separator, so subsequent `=` characters pass through unchanged |
| every other character | as-is | including `.`, `:`, `-`, `_`, `/`, accented letters, emoji |

In practice you'll only ever hit the `+`-for-space rule. The others exist for
edge cases.

#### Example

You want to set the epic to `Phase 3 — New Relic & APM`.

Wrong:

```markdown
### Some story [](?epic=Phase 3 — New Relic & APM)
```

This breaks GitHub rendering (spaces aren't allowed in CommonMark link
destinations) and also splits at the `&` into two keys (`epic=Phase 3 — New
Relic ` and `APM=`).

Right:

```markdown
### Some story [](?epic=Phase+3+—+New+Relic+%26+APM)
```

Or — better — use a stable id (see [Epic references](#epic-references) below):

```markdown
## Phase 3 — New Relic & APM [](?id=phase3)

### Some story [](?epic=phase3)
```

### Why not `%20` for spaces?

You can use `%20` and NoteThink will decode it correctly, but `+` is shorter
and is the standard for form-encoded URLs. Stick with `+`.

### Why not just allow spaces?

NoteThink's own parser would accept literal spaces. The reason we don't allow
them is that the same `todo.md` files are also viewed on github.com and other
markdown renderers, which strictly follow CommonMark. CommonMark requires that
link destinations contain no spaces, so `[](?epic=Phase 3)` would render as
visible markdown source on GitHub instead of an invisible empty link. Using
`+` keeps the file rendering cleanly in every viewer.

---

## Reserved linetag keys

These keys have special meaning in NoteThink. Avoid using them for your own
metadata.

### Linetag prefixes (`nt_` and `ng_`)

NoteThink's internal/directive keys carry a namespace prefix so they stay
distinct from your content attributes:

- **`nt_`** is the canonical prefix (short for **n**ote**t**hink). It is what
  NoteThink **writes** going forward, and the form you should author —
  `nt_view`, `nt_level`, `nt_child_status`, `nt_kanban_ordering_weight`.
- **`ng_`** is the legacy prefix inherited from the predecessor project. It is
  still **accepted on read** as an equal synonym for the directive keys
  (`ng_view` ≡ `nt_view`, `ng_level` ≡ `nt_level`, …) so older files keep
  working. When both forms are present on the same heading, `nt_` wins.
- **Content attributes are unprefixed** — `status`, `epic`, `id`, `order`,
  `time_estimated`, `time_taken`. They describe your content and render as
  visible chips; they take no prefix.

**One exception:** the child-attribute *inheritance* directives are `nt_` only
— `nt_child_<key>`, `nt_child2y_<key>`, `nt_childall_<key>`. Legacy
`ng_child_*` is **not** inherited; author inheritance with the `nt_` form.

### View configuration

Set on the file root (`#`) or any heading to override how that subtree
renders.

| Key | Effect |
|---|---|
| `nt_view` | View type for this subtree: `auto`, `document`, `kanban`. Legacy `ng_view` is still accepted on read |
| `nt_integration_mode` | The integration mode this file opens into while the view is in **auto**: `current_file` or `folder`. In auto the view follows it; changing the mode or navigating away from the file's intent pins your own choice. Set on the file root (`#`). `nt_`-only — no `ng_` form |
| `nt_breadcrumb_last` | The breadcrumb segment this file opens scoped to while in **auto** — a folder name (narrows folder-mode aggregation to that subfolder, implying folder mode) or an epic/story headline (scopes the note hierarchy). Seeds the initial position; navigate away freely. Set on the file root (`#`). `nt_`-only |
| `nt_level` | Render level (advanced; usually leave unset). Legacy `ng_level` is still accepted on read |
| `order` | Which end of the file holds the **newest** stories: `newest-at-top` (default) or `newest-at-bottom`. Read off the file root (`#`) only. Tells Folder mode which end to keep when the per-file note cap truncates the file — see [Per-file note cap](#per-file-note-cap-and-the-order-linetag) |
| `nt_authoring_version` | Pin this file to an older Authoring Guide version (`MAJOR` or `MAJOR.MINOR`, e.g. `1` or `1.2`) instead of the latest. Set on the file root (`#`). Reserved for forward-compatibility — only `1.0.0` and `1.1.0` exist today (no major bump), so it has no effect yet. See [Versioning](#versioning) |

### Story status

Set on a story (`###`) heading.

| Key | Effect |
|---|---|
| `status` | Story status: `todo`, `doing`, `blocked`, `done`, etc. Maps to Kanban columns |
| `time_estimated` | Forward-looking forecast in minutes (forecast only — never put actual time here) |
| `time_taken` | **Actual** time worked, in minutes. Non-zero by definition. Never write an estimate here — these values may feed billing |
| `epic` | Reference to a parent epic — see below |

### Inherited attributes

Set on an `##` epic, `###` story, or any subtree root to propagate a value
down to descendants.

| Key | Inherits to |
|---|---|
| `nt_child_<key>` | direct children only |
| `nt_child2y_<key>` | grandchildren only |
| `nt_childall_<key>` | all descendants |

For example, `[](?nt_child_status=done)` on a `# Done [](?nt_child_status=done)`
heading marks every direct child story as `status=done` without each story
having to repeat the linetag.

A child's own real linetag always wins over an inherited value.

### Reserved structural keys (set by NoteThink, not by you)

You should never write these by hand. NoteThink computes them.

| Key | Purpose |
|---|---|
| `id` | Optional stable identifier for an epic (`##` heading) — see below |
| `nt_kanban_ordering_weight` | Per-card position weight written by the Kanban view when you drag cards to reorder them. Internal — never write it by hand |

`id` is the one exception: you set it on `##` epic headings to enable stable
references.

---

## Front matter (document scope)

A YAML or TOML **front matter** block at the very top of a file — fenced by
`---` (YAML) or `+++` (TOML) — is lifted into the file's **document root**, and
each `key: value` pair becomes a linetag on that root, treated *identically* to a
linetag authored on a heading. Front matter is therefore the **broadest,
document-scoped layer** of the linetag model, not a separate metadata channel.

```
---
nt_view: kanban
status: active
nt_childall_owner: alex
---

# Project board

### First story [](?status=doing)
```

- **Same keys, same meaning.** Author the keys you already know — `nt_view`,
  `order`, `status`, `nt_child_<key>`, etc. A front-matter `nt_view: kanban`
  behaves exactly as if it were written on the file's `#` H1.
- **Precedence — most-specific wins.** Front matter sets document-wide defaults
  that anything below can override: an H1 linetag beats a front-matter value, an
  H2 beats the H1, and a story's own linetag beats everything inherited. This is
  the same "a child's own real linetag wins" rule from
  [Inherited attributes](#inherited-attributes) — front matter is simply the top
  of that chain.
- **Only inheritance directives propagate.** As on a heading, just the
  `nt_child_<key>` / `nt_child2y_<key>` / `nt_childall_<key>` forms flow down to
  descendants — front-matter `nt_childall_owner: alex` reaches every note, while a
  bare `status: active` stays on the document root and does **not** leak to
  children.
- **Display.** In Current-file mode the unprefixed front-matter keys render as a
  document-level chip strip at the top of the view (prefixed directive keys such
  as `nt_view` stay invisible, exactly like on a heading). Folder mode aggregates
  many files, so there is no single document scope and the strip is suppressed —
  but each file's front-matter inheritance is still resolved per file before the
  merge, so `nt_childall_*` and friends keep working in both modes.

### Document-level `order` vs H1 `order`

`order` is scope-sensitive. On the `#` H1 it governs where new stories are
inserted *under the H1*. In **front matter** it governs insertion relative to the
*whole document* — so `newest-at-top` at document scope can place a new note
**above** the H1, whereas at H1 scope the new note lands below it. Document-level
`order` is read off the root independently; an H1 `order` overrides it for the
per-file cap (see
[Per-file note cap](#per-file-note-cap-and-the-order-linetag)).

---

## Epics and stories

### Epics are optional

If your file has no `##` headings, every `###` is a story directly under the
file title. That's the common case.

If your file uses `##` epics, NoteThink groups stories under their parent
epic. In a Kanban view, epic membership shows as a small badge on each card.

### Epic references

A story can declare which epic it belongs to in three ways. NoteThink
evaluates them **most-specific first** and stops at the first hit:

1. **Direct linetag on the story** — `[](?epic=X)`
2. **Inherited linetag from an ancestor** — `[](?nt_child_epic=X)` on a parent
3. **Structural** — the story sits under a `##` heading; that heading is the
   epic

For methods 1 and 2, the value `X` is resolved against all loaded epics:

- if some epic has `[](?id=X)`, that's the match
- else if some epic's stripped headline equals `X`, that's the match
- else the literal value is rendered as the badge label, with no link

**References are exact-match. Regex and globs are not supported** for
references. (View-level filters that *query* across stories may use regex in
future, but that's a separate feature.)

### Stable IDs for long epic names

Epic headlines tend to be long (`## New Relic APM & Synthetic Monitoring`). A
story that tags `epic=New+Relic+APM+%26+Synthetic+Monitoring` is hard to type
and brittle if you rename the epic.

Add a short stable id to the epic and reference by that id:

```markdown
## New Relic APM & Synthetic Monitoring [](?id=nr)

### Add APM agent [](?epic=nr)
### Add synthetic monitor [](?epic=nr)
### Wire alerts [](?epic=nr)
```

If you later rename the epic from `## New Relic APM & Synthetic Monitoring` to
`## New Relic monitoring`, the references still resolve because the `id=nr`
stays put.

### When to use IDs vs exact names

- **Use IDs** when you have more than two or three stories per epic, or when
  the epic name is long, or when the epic name might change.
- **Use exact names** for one-off references where adding an id feels like
  ceremony.

Both work. You can mix them.

### Stable ids: implicit vs explicit

Every note carries a `stable_id` at runtime. It has two **provenances**:

- **Implicit id** — derived automatically from the headline (lowercased, punctuation stripped, spaces hyphenated). It is present on every note at parse time and is **never written to the file**. Because it tracks the title, it changes whenever the story is renamed. Safe for in-session use only.
- **Explicit id** — the `[](?id=slug)` linetag you author. It is **frozen once written** and survives title edits and reloads. The only form safe to reference across sessions.

The resolved `stable_id` is the explicit id when an `id=` linetag is present; otherwise it is the implicit derived id.

**Promoting an id from implicit to explicit** is a deliberate write. Because the explicit value is pre-populated from the same derivation as the implicit one, the resolved id is continuous at the moment you write it — it doesn't jump. Once written, the explicit id is frozen and may legitimately diverge from what the headline would now derive. That divergence is the whole point: it is what makes the reference durable.

#### When should you write an explicit `id=`?

Write an explicit `id=` **only when a durable artifact will reference the note across sessions or renames.** The test to apply: "would this reference need to survive a title edit, or a reload next week?"

**Write an explicit id when:**

1. **The note becomes the target of a `[[…]]` cross-reference.** Pin the target's `id=` and write the reference together — they travel as a pair.
2. **You author one directly** (e.g. to keep a short reference slug on a long epic name — the `id=nr` pattern from the example above).
3. **Disambiguation** — two notes share the same headline and one of them is being referenced. Give the target a distinct authored id.

**Leave it implicit (write nothing) when:**

- Drag keying or Kanban column projection — these are in-session operations.
- Holding the selected note across a re-parse for a few seconds.
- Ordering, sorting, or any intra-session matching.

**Principle: persistent ⇒ explicit; transitory ⇒ implicit.**

#### Duplicate headlines

Two notes with identical headlines produce colliding implicit ids. This is fine for transient use (React keys, in-session selection). If you need to reference one of them across sessions, that is a promotion trigger: author a distinct `id=` on the target to disambiguate.

```markdown
## Authentication [](?id=auth-phase1)

## Authentication [](?id=auth-phase2)

### Wire login [](?epic=auth-phase1)
```

### Cross-project epic references

In Folder mode (and the upcoming cross-project Kanban), an epic id is
resolved against all loaded epics. If two projects each have an epic with
`[](?id=auth)`, a story in either project that says `epic=auth` will resolve
to the epic from its own file (each project resolves independently). If you
genuinely need to reference an epic in a *different* project, use a
namespaced id: `[](?id=zoombuzz/auth)` and `[](?epic=zoombuzz/auth)`.

---

## Folder mode

NoteThink has two integration modes, selected from the toolbar at the top of
the view.

| Mode | What it shows |
|---|---|
| **Current file** | The file open in the active editor |
| **Folder** | Every `*.md` file under the active file's folder, merged into one view |

In Folder mode, NoteThink:

1. Loads every `*.md` file under the folder.
2. Walks each file's tree:
   - depth-3 (`###`) headings become stories on the merged board
   - depth-2 (`##`) headings become epics; their depth-3 children become stories
     stamped with the epic
3. Merges all stories into one synthetic root.
4. Picks one view type (`auto`, `document`, `kanban`) by majority vote across
   the files' top-level `nt_view` linetags (legacy `ng_view` still counts).
5. Renders one view, one toolbar, one breadcrumb.

Each story shows a small **origin pill** with the source file (and epic, if
any). Clicking it opens the source file at the story's location.

Editing a checkbox or status in Folder mode writes to the correct origin
file — the merged view is just a presentation layer.

### Breadcrumb in Folder mode

The breadcrumb's path segments represent the **aggregated folder**, not
any single file. Clicking a path segment narrows the aggregation to that
subfolder.

The note-hierarchy segments after the path operate on the merged tree —
clicking an epic name in the breadcrumb scopes the view to that epic's
stories.

### Per-file note cap and the `order` linetag

Folder mode caps how many top-level stories it takes **from each source
file** (default **10**, adjustable in the Files drawer — see below). Without
this, a long `done.md` with hundreds of completed stories would swamp the
merged view with mostly-irrelevant history.

Which end of the file the kept stories come from depends on the file root's
`order` linetag:

| `order` value | Meaning | Cap keeps |
|---|---|---|
| `newest-at-top` *(default — also used when `order` is absent or unrecognised)* | The newest stories are written at the **top** of the file (e.g. `todo.md`: the next thing to do is first) | the **first** N stories |
| `newest-at-bottom` | The newest stories are appended at the **bottom** of the file (e.g. `done.md`: the most recently completed work is last) | the **last** N stories |

```markdown
# Done [](?nt_view=kanban&nt_child_status=done&order=newest-at-bottom)
```

Notes:

- The cap and `order` apply **only in Folder mode**. Current-file mode always
  shows the whole file.
- The kept stories are always presented **newest-first** so every file reads
  consistently in the merged view (newest at the top of its column). For
  `newest-at-top` files that is just document order; for `newest-at-bottom`
  files the kept slice is reversed (the document-bottom story sorts first).
- The cap counts the stories a file contributes (depth-3 `###` headings,
  including those nested under `##` epics), in document order.
- Adjust the cap (or set it to a large number to effectively disable it) per
  view from the **Files drawer**; the value persists with the view like the
  include/exclude globs.

### Best practices for files that will be aggregated

- **Stick to the heading levels** — `#` for the title, `##` for an optional
  epic, `###` for stories. Don't use `##` for sub-sections inside a story.
- **Give long-named epics an `id`** to keep references readable.
- **Keep status linetags on stories**, not on the file root — the file root's
  status would propagate to every story via inheritance and override your
  per-story values.
- **Don't repeat epic linetags** that you can inherit. If every story under a
  `##` heading has the same status, set `nt_child_status=...` on the heading
  once instead.

---

## Validating your file

Before pushing changes to a `todo.md` / `done.md`:

1. Open the file in NoteThink (Current file mode). Does the document view
   show what you expect? Does the Kanban view group stories correctly?
2. Switch to Folder mode. Are there any stacked headers, frozen
   breadcrumbs, or stories that show up in the wrong column? If yes, you
   likely have a heading-level mismatch (e.g. a `##` where you meant `###`).
3. Open the file on github.com. The empty linetags should be invisible. If
   you see `[](?...)` text leaking into the rendered output, you've used a
   character that needs encoding (most often a literal space — replace with
   `+`).

---

## Quick reference card

```markdown
# File title [](?nt_view=kanban)


## Epic name [](?id=epic-id)

### Story title [](?status=doing&epic=epic-id&time_estimated=180)

Story description.

+ [ ] task one
+ [X] task two

#### Sub-section inside the story

More content.


### Another story [](?status=todo)
```

Encoding cheat-sheet:

| You want | You write |
|---|---|
| space | `+` |
| literal `+` | `%2B` |
| literal `&` | `%26` |
| literal `)` | avoid |

That's the whole grammar.
