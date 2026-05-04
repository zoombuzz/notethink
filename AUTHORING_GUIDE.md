# NoteThink Authoring Guide

How to structure your markdown files so NoteThink renders them well — as
documents, as Kanban boards, and (in Directory mode) as cross-file aggregate
views.

This guide covers the conventions you need to follow as a **document author**.
For coding standards (TypeScript, React, file naming), see
[CODING_STANDARDS.md](./CODING_STANDARDS.md). For agent-facing project
guidance, see [AGENTS.md](./AGENTS.md).

---

## TL;DR

```markdown
# Todo [](?ng_view=kanban)


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

### View configuration

Set on the file root (`#`) or any heading to override how that subtree
renders.

| Key | Effect |
|---|---|
| `ng_view` | View type for this subtree: `auto`, `document`, `kanban` |
| `ng_level` | Render level (advanced; usually leave unset) |

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
| `ng_child_<key>` | direct children only |
| `ng_child2y_<key>` | grandchildren only |
| `ng_childall_<key>` | all descendants |

For example, `[](?ng_child_status=done)` on a `# Done [](?ng_child_status=done)`
heading marks every direct child story as `status=done` without each story
having to repeat the linetag.

A child's own real linetag always wins over an inherited value.

### Reserved structural keys (set by NoteThink, not by you)

You should never write these by hand. NoteThink computes them.

| Key | Purpose |
|---|---|
| `id` | Optional stable identifier for an epic (`##` heading) — see below |

`id` is the one exception: you set it on `##` epic headings to enable stable
references.

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
2. **Inherited linetag from an ancestor** — `[](?ng_child_epic=X)` on a parent
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

### Cross-project epic references

In Directory mode (and the upcoming cross-project Kanban), an epic id is
resolved against all loaded epics. If two projects each have an epic with
`[](?id=auth)`, a story in either project that says `epic=auth` will resolve
to the epic from its own file (each project resolves independently). If you
genuinely need to reference an epic in a *different* project, use a
namespaced id: `[](?id=zoombuzz/auth)` and `[](?epic=zoombuzz/auth)`.

---

## Directory mode

NoteThink has two integration modes, selected from the toolbar at the top of
the view.

| Mode | What it shows |
|---|---|
| **Current file** | The file open in the active editor |
| **Directory** | Every `*.md` file under the active file's directory, merged into one view |

In Directory mode, NoteThink:

1. Loads every `*.md` file under the directory.
2. Walks each file's tree:
   - depth-3 (`###`) headings become stories on the merged board
   - depth-2 (`##`) headings become epics; their depth-3 children become stories
     stamped with the epic
3. Merges all stories into one synthetic root.
4. Picks one view type (`auto`, `document`, `kanban`) by majority vote across
   the files' top-level `ng_view` linetags.
5. Renders one view, one toolbar, one breadcrumb.

Each story shows a small **origin pill** with the source file (and epic, if
any). Clicking it opens the source file at the story's location.

Editing a checkbox or status in Directory mode writes to the correct origin
file — the merged view is just a presentation layer.

### Breadcrumb in Directory mode

The breadcrumb's path segments represent the **aggregated directory**, not
any single file. Clicking a path segment narrows the aggregation to that
sub-directory.

The note-hierarchy segments after the path operate on the merged tree —
clicking an epic name in the breadcrumb scopes the view to that epic's
stories.

### Best practices for files that will be aggregated

- **Stick to the heading levels** — `#` for the title, `##` for an optional
  epic, `###` for stories. Don't use `##` for sub-sections inside a story.
- **Give long-named epics an `id`** to keep references readable.
- **Keep status linetags on stories**, not on the file root — the file root's
  status would propagate to every story via inheritance and override your
  per-story values.
- **Don't repeat epic linetags** that you can inherit. If every story under a
  `##` heading has the same status, set `ng_child_status=...` on the heading
  once instead.

---

## Validating your file

Before pushing changes to a `todo.md` / `done.md`:

1. Open the file in NoteThink (Current file mode). Does the document view
   show what you expect? Does the Kanban view group stories correctly?
2. Switch to Directory mode. Are there any stacked headers, frozen
   breadcrumbs, or stories that show up in the wrong column? If yes, you
   likely have a heading-level mismatch (e.g. a `##` where you meant `###`).
3. Open the file on github.com. The empty linetags should be invisible. If
   you see `[](?...)` text leaking into the rendered output, you've used a
   character that needs encoding (most often a literal space — replace with
   `+`).

---

## Quick reference card

```markdown
# File title [](?ng_view=kanban)


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
