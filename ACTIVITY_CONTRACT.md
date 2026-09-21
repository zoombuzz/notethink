# NoteThink Activity Contract

How an external tool tells NoteThink which AI coding agents are working in a
repository, what each one is doing, and which files they have changed.

NoteThink does not watch agents. It reads small files that a **producer** writes
into a `.notethink/` directory inside the repository the agent works in. This
document is the specification of those files. Write a producer against this
document and NoteThink's agent card will draw your sessions; write nothing and
NoteThink says so plainly rather than showing an empty board that looks like
idle agents.

This is the contract's own document. For the markdown grammar NoteThink renders,
see [AUTHORING_GUIDE.md](./AUTHORING_GUIDE.md). For coding standards, see
[CODING_STANDARDS.md](./CODING_STANDARDS.md).

**This contract is versioned. Current version: `1.0.0`.** See
[Versioning](#versioning) for what patch / minor / major changes mean and what a
reader does with a version it does not know.

---

## Versioning

The contract is versioned with [semantic versioning](https://semver.org/) -
`MAJOR.MINOR.PATCH`. The current version is **`1.0.0`**, the first formally
versioned baseline.

| Bump | What changes | Effect on a producer |
|---|---|---|
| **patch** (`1.0.x`) | Editorial fixes, clarifications, examples - the file shapes are unchanged | None. Keep writing what you write |
| **minor** (`1.x.0`) | New, backward-compatible additions (a new optional field, a new event kind, a new capability name) | None. A producer that writes only `1.0.0` fields stays correct |
| **major** (`x.0.0`) | Changes that alter or remove how an existing field is interpreted | A reader built for the old major **refuses** your files and says so |

### Every file states its version

Unlike the authoring guide, where a markdown file is interpreted against the
latest version and pins a version only in the rare breaking case, **every file
in this contract carries a required `contract_version` field**. The reason is
the difference in who writes them: a markdown file is written by a person using
NoteThink, whereas these files are written by tools NoteThink does not ship and
cannot see. A reader must be able to tell, from one whole-file read on its own,
what it is looking at.

In `events.jsonl` the field is on **every line**, not on a header line, so that
each line stays independently valid. Losing a header would cost the whole file;
the per-line cost is a few bytes against a bounded file.

### What a reader does with a version it does not know

A reader compares the file's `contract_version` against its own:

| File's version | Reader's action |
|---|---|
| Same MAJOR, MINOR at or below the reader's | Read it normally |
| Same MAJOR, MINOR above the reader's | Read it, ignoring fields it does not recognise. A minor bump is backward-compatible by definition |
| A different MAJOR | **Refuse the file.** Say plainly that a producer is writing a contract version this build cannot read, naming both versions |
| Missing, or not `MAJOR.MINOR.PATCH` | Refuse the file, as malformed |

Refusing loudly is the point. A board that silently drops a file it cannot read
looks exactly like a board with nothing happening on it, and the difference is
the whole reason this contract exists.

### Unknown values inside a known version

Three fields are deliberately open, so a minor bump can extend them without a
reader change:

- **`vendor`** is a free string. A reader draws a monogram from a vendor it does
  not know rather than dropping the session.
- **`kind`** on an event is a free string. A reader ignores a kind it has no
  rendering for.
- **`state`** on a session has known values, and a reader **coerces** anything
  else to `unknown`. It never guesses `idle`.

Everything else with a fixed value set is closed: a value outside the set means
the entry is malformed.

---

## Where the files live

```
<repository root>/
  .notethink/
    manifest.json
    tree.json
    sessions/
      <session_id>.session.json
      <session_id>.events.jsonl
      <session_id>.digest.json
    blobs/
      <blob name>
```

Three properties are load-bearing, and a producer that breaks any of them is
invisible to NoteThink:

1. **`.notethink/` sits in the repository the agent is working in, and that
   repository is inside an open VS Code workspace folder.** NoteThink is a web
   extension: it reads through the VS Code file-system API, which reads nothing
   outside the workspace folders. A producer that writes to a vendor's home
   directory, to a temporary directory, or to any other place outside the
   workspace cannot be seen at all.
2. **Nothing lives outside the workspace, and no path is absolute.** Every path
   in every file is relative to one of the two roots below.
3. **`.notethink/` is kept out of git.** The contract feeds a band of changed
   files, and its own files must never appear in that band.

### Path bases

Two roots, and every path-valued field is relative to exactly one of them:

- The **contract root** is the directory that holds `.notethink/`, which is the
  repository the agent is working in.
- The **contract directory** is `.notethink/` itself.

| Field | Relative to | Example |
|---|---|---|
| `story.doc_path` on a session | contract root | `docstech/users/alex/todo.md` |
| `path` on a changed file | contract root | `client/extension/src/extension.ts` |
| `previous_path` on a changed file | contract root | `client/extension/src/old.ts` |
| `base_blob` on a changed file | contract directory | `blobs/<sha256>.ts` |
| `head_blob` on a changed file | contract directory | `blobs/<sha256>.ts` |

**A producer never writes a workspace-relative path**, because it cannot know
what the workspace is. The same repository may be opened on its own, as one
folder of a multi-root workspace, or nested inside a parent folder that is the
workspace root, and the user can change that at any time without the producer
noticing. A path relative to the contract root is the only thing a producer can
write correctly, and it is what git already gives it. Resolving that against a
workspace is the reader's job, and the reader does it one way: it knows where it
found the `.notethink/` directory, so it joins that location to the path.

Three fields **look like paths and are not**, and a reader must never resolve
them as one:

- **`project`** on a session is the contract root directory's *name*, not its
  path. A contract root can sit several folders below the workspace folder, so
  a reader that rebuilds a location as `project` joined to `doc_path` will point
  at a file that does not exist. Use where the `.notethink/` directory actually
  was found.
- **`arg`** on an event or a digest tool call is display text. It is frequently
  a path, because tool arguments often are, but it is bounded, truncated and
  written for a person to read. Nothing resolves it or opens it.
- **`facts`** values on a digest are free-form display strings, whatever they
  happen to contain.

`base_ref` on `tree.json` is a git ref rather than a path, and `session_id` is a
path *segment* rather than a path.

### Keeping `.notethink/` out of git is the producer's job

The producer writes into repositories it does not own, so it cannot rely on a
committed `.gitignore` being there. Use whichever of these fits:

- add `.notethink/` to the repository's own `.gitignore`, where the repository
  is one you can commit to
- add `.notethink/` to `.git/info/exclude` in the repository, which needs no
  commit and affects only that clone
- add `.notethink/` to the user's global git ignore file

A reader defends itself as well: it drops any changed-file entry whose path
falls inside `.notethink/`. That is a backstop for a producer that forgot, not a
licence to skip the ignore rule, because an un-ignored `.notethink/` shows up in
the user's own `git status` too.

### How a reader finds them

By workspace-relative glob, so one watcher covers every repository in the
workspace at once:

| Pattern | Matches |
|---|---|
| `**/.notethink/*.json` | `manifest.json` and `tree.json` |
| `**/.notethink/sessions/*` | the three per-session files |

`blobs/` is deliberately outside both patterns. Blobs are fetched on demand when
a reader opens a file's diff, and are never watched; a changed `package.json`'s
stored side would otherwise fire the watcher on every write.

### Session ids are path segments

A `session_id` becomes part of a filename, so it must match
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`: an ASCII letter or digit first, then
letters, digits, dots, hyphens and underscores, up to 128 characters. A vendor
UUID satisfies this as it stands. The pattern is also what stops a session id
being used to walk out of the contract directory, so a reader rejects a session
whose id does not match it.

---

## Reading and writing while the other side is busy

The producer writes while the reader reads, so a **truncated file is the normal
failure**, not an exceptional one. The contract handles it in three ways.

**Write whole files atomically.** Write to a temporary file in the same
directory and rename it over the target. A rename is atomic on every file system
NoteThink runs on, so a reader sees either the old file or the new one. This
applies to `manifest.json`, `tree.json`, `<id>.session.json` and
`<id>.digest.json`.

**Append or rewrite the event log, never patch it.** `events.jsonl` is one JSON
object per line. A producer either appends a whole line, or rewrites the file
wholesale to drop old lines from the front. Both survive a concurrent read: a
half-written trailing line is the only damage, and a reader drops that one line
and keeps the rest. That is why the event log is newline-delimited rather than a
JSON array, which would be unreadable the moment it was truncated.

**A reader keeps its last good value.** When a file fails to parse, the reader
logs the reason, keeps what it read last, and tries again on the next watcher
event. It never renders a half-read file, and it never blanks a card because one
read landed mid-write.

### Size bounds

NoteThink's file API reads whole files only: there is no offset and no length,
so a large file cannot be tailed, it can only be read entirely or not at all.
Agent transcripts run past 100 MB, which is why this contract is many small
files rather than one big one, and why the digest is bounded.

**Every file has a bound. A reader refuses a file over its bound, before
decoding it.** A producer that cannot fit inside a bound drops content until it
does, and says so in the file (see `dropped` on the digest).

| File | Bound |
|---|---|
| `manifest.json` | 8 KiB |
| `<id>.session.json` | 16 KiB |
| `<id>.events.jsonl` | 64 KiB, and at most 200 lines |
| `<id>.digest.json` | 64 KiB |
| `tree.json` | 256 KiB |
| `blobs/<name>` | 1 MiB each |

Bounds are on the file's UTF-8 byte size. A reader may also check the decoded
length against the same number, which can only be smaller and so never admits a
file the byte check would refuse.

One further bound is a producer obligation rather than a reader check: the
`arg` on an event or a digest tool call is a **short** argument, at most 200
characters. A reader truncates for display rather than refusing a session over
one long argument, but a producer that writes whole file contents into `arg`
will blow the file bound and lose the whole log.

---

## `manifest.json`

The one file that answers "is anything writing here at all". Without it a reader
cannot tell a stopped producer from a quiet one.

```json
{
  "contract_version": "1.0.0",
  "producer": { "name": "example-activity-producer", "version": "0.4.1" },
  "written_at": "2026-09-18T09:14:02Z",
  "heartbeat_seconds": 10,
  "capabilities": { "tree_state": "supported", "blob_base": "supported" },
  "sessions": ["b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01"]
}
```

| Field | Type | Meaning |
|---|---|---|
| `contract_version` | string | required, `MAJOR.MINOR.PATCH` |
| `producer.name` | string | the producer's own name, shown when a reader explains where its data came from |
| `producer.version` | string | the producer's version, free-form |
| `written_at` | string | when this file was last written, as an ISO 8601 UTC instant |
| `heartbeat_seconds` | number | how often the producer promises to rewrite this file, even when nothing has changed |
| `capabilities` | object | producer-wide capabilities, see [Capabilities](#capabilities) |
| `sessions` | array of string | the session ids that are currently live |

### The heartbeat, and what "no producer" means

**The producer rewrites `manifest.json` at least every `heartbeat_seconds`, with
`written_at` updated, whether or not anything else changed.** A reader treats
the producer as live while `written_at` is within `3 * heartbeat_seconds` of now,
and as stopped beyond that. A stopped producer is reported as a stopped
producer, never as idle agents.

A value of 10 seconds is a reasonable default: it keeps the stale threshold at
half a minute without writing often enough to matter.

A reader compares the producer's clock against its own, which is sound because
both are local to the machine the workspace is on. Agents running on another
machine are invisible to a local read at all, so only a producer on that machine
can report them.

### `sessions` is authoritative

A session file that is not listed in `sessions` is ignored, and a listed session
whose file is missing or unreadable is reported as such. That is what stops a
crashed producer's leftover session file being drawn as a live agent forever,
and it lets a reader say honestly that three sessions were declared and two
could be read.

---

## `sessions/<session_id>.session.json`

One per live session: the binding, the state, and the one live line the card
draws.

```json
{
  "contract_version": "1.0.0",
  "session_id": "b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01",
  "vendor": "claude-code",
  "project": "notethink",
  "started_at": "2026-09-18T08:51:30Z",
  "updated_at": "2026-09-18T09:14:01Z",
  "state": "working",
  "story_binding": "bound",
  "story": { "doc_path": "docstech/users/alex.stanhope/todo.md", "id": "agent-activity-card" },
  "capabilities": {
    "live_tool_call": "supported",
    "question": "supported",
    "digest": "supported",
    "file_attribution": "supported"
  },
  "current": { "at": "2026-09-18T09:14:01Z", "kind": "tool_call", "tool": "Edit", "arg": "client/extension/src/types/AgentActivity.ts" }
}
```

| Field | Type | Meaning |
|---|---|---|
| `contract_version` | string | required |
| `session_id` | string | matches the session id pattern, and matches the filename |
| `vendor` | string | `claude-code`, `codex`, `grok`, or another vendor's slug |
| `project` | string | the project this session is working in, see below |
| `started_at` | string | when the session began, ISO 8601 UTC |
| `updated_at` | string | when this file was last written, ISO 8601 UTC |
| `state` | string | `working`, `waiting`, `idle`, `ended` or `unknown` |
| `story_binding` | string | `bound`, `none` or `undeclared`, see below |
| `story` | object | required when `story_binding` is `bound`, absent otherwise |
| `capabilities` | object | per-session capabilities, see [Capabilities](#capabilities) |
| `current` | object | optional, the latest event, same shape as an event line without its `contract_version` and `session_id` |
| `question` | object | optional, a question pending on the operator |
| `ended_at` | string | optional, when the session ended, ISO 8601 UTC |

### `project`

The name of the directory holding `.notethink/`, which is the repository's root
directory name. NoteThink derives a project name for the markdown it renders the
same way, from the first segment of a file's workspace-relative path, so the two
agree when the workspace folder is the parent of the repositories. It drives the
card's project colour, not the join to a story.

It is a name and not a path, so nothing locates a file from it
([Path bases](#path-bases)).

### `state`

`state` owns the card's colour, so it is the field to get right.

| Value | Means |
|---|---|
| `working` | the agent is executing |
| `waiting` | the agent is blocked on a question to the operator |
| `idle` | the session is alive with nothing running |
| `ended` | the session has finished |
| `unknown` | the producer cannot tell |

`unknown` is not a failure value, it is an honest one. A vendor that exposes no
live status gets `unknown` and a reader says "not reported" rather than drawing
an idle agent.

A producer that writes a `question` writes `state: "waiting"` with it. The two
are not allowed to disagree; a reader trusts `state` for the colour and
`question` for the band.

### `story_binding` and `story`: the agent declares, nobody guesses

**The agent declares which story it is on, including declaring that it is on no
story.** A working directory names a project, never a story, and matching an
agent's writes against file timestamps was measured at 9 hits in 12 on a real
repository, with the misses being files written by shell commands rather than
edit tools. So the binding comes from a declaration and from nothing else.

| `story_binding` | `story` | Means |
|---|---|---|
| `bound` | present | the agent declared this story |
| `none` | absent | the agent declared that it is on no story |
| `undeclared` | absent | nothing ever declared a binding for this session |

The distinction between `none` and `undeclared` is the point of the field. An
agent that declared no story is drawn away from every story's card, honestly; a
session nobody declared anything for is a gap in the tooling, and a reader
surfaces it as one. This is why the binding is a required three-valued string
rather than a nullable object: a JSON serialiser that drops nulls would
otherwise turn "nobody declared anything" into "declared: no story" silently.

`story.doc_path` is the posix path of the markdown file holding the story,
**relative to the contract root** ([Path bases](#path-bases)), which is what the
producer can write without knowing anything about the reader's workspace.
`story.id` is the story's authored `[](?id=slug)` linetag value. Both are
needed: NoteThink joins activity to a card on the pair, because a story id is
unique within a file and not across a workspace.

**`story.id` must be an authored `id=` linetag, not a title-derived slug.**
NoteThink derives an implicit id from a story's headline for its own in-session
use, and that id changes the moment the story is renamed. Only the authored
linetag is frozen, and a binding is a cross-session reference by definition. A
declarer that has to invent the id writes the `id=` linetag into the markdown
file in the same step, which is what makes the reference durable.

### `question`

```json
{
  "question_id": "q-4417",
  "asked_at": "2026-09-18T09:13:40Z",
  "prompt": "Apply the rename across all 14 call sites?",
  "options": ["Yes", "No, just this one", "Cancel"]
}
```

| Field | Type | Meaning |
|---|---|---|
| `question_id` | string | stable while the question is pending, so a reader can tell a re-ask from a repaint |
| `asked_at` | string | ISO 8601 UTC |
| `prompt` | string | short, one line, plain text |
| `options` | array of string | optional, the choices offered |

A session with no pending question omits the field. That is why the `question`
capability matters: an absent `question` on a session that declares
`"question": "supported"` means nothing is pending, and an absent `question` on
a session that does not means nothing is known. See
[Capabilities](#capabilities).

---

## `sessions/<session_id>.events.jsonl`

One JSON object per line, in write order, bounded to the most recent 200 lines
and 64 KiB.

```
{"contract_version":"1.0.0","session_id":"b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01","at":"2026-09-18T09:13:58Z","kind":"tool_call","tool":"Read","arg":"client/extension/src/constants.ts"}
{"contract_version":"1.0.0","session_id":"b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01","at":"2026-09-18T09:14:01Z","kind":"tool_call","tool":"Edit","arg":"client/extension/src/types/AgentActivity.ts"}
```

| Field | Type | Meaning |
|---|---|---|
| `contract_version` | string | required, on every line |
| `session_id` | string | required, and equal to the session's id on every line |
| `at` | string | ISO 8601 UTC |
| `kind` | string | `tool_call`, `tool_result`, `message`, `question`, `answer`, `notice`, or a kind a reader does not know |
| `tool` | string | optional, the tool's name |
| `arg` | string | optional, a short argument, at most 200 characters |

**Order is file order, and a reader must not re-sort by `at`.** Two events in
the same millisecond are ordered by which was written first, and `at` is a
display value rather than a key.

A line that does not parse is dropped, and only that line. A reader counts the
drops and logs them, because a log that is quietly one line short reads exactly
like a log that is complete.

---

## `sessions/<session_id>.digest.json`

What the agent drawer shows: the last few messages and tool calls, small enough
to read whole, and **honest about being bounded**.

```json
{
  "contract_version": "1.0.0",
  "session_id": "b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01",
  "generated_at": "2026-09-18T09:14:02Z",
  "messages": {
    "kept": 2,
    "dropped": 47,
    "items": [
      { "at": "2026-09-18T09:12:10Z", "role": "user", "text": "carry on with the contract" },
      { "at": "2026-09-18T09:12:44Z", "role": "assistant", "text": "Writing the types now." }
    ]
  },
  "tool_calls": {
    "kept": 1,
    "dropped": 12,
    "items": [
      { "at": "2026-09-18T09:14:01Z", "tool": "Edit", "arg": "client/extension/src/types/AgentActivity.ts", "outcome": "ok" }
    ]
  },
  "facts": { "model": "an example model name", "cwd": "notethink", "turns": "23" }
}
```

| Field | Type | Meaning |
|---|---|---|
| `contract_version` | string | required |
| `session_id` | string | required |
| `generated_at` | string | ISO 8601 UTC |
| `messages.kept` | number | how many messages `items` holds |
| `messages.dropped` | number | how many older messages were left out, `0` when the digest is complete |
| `messages.items` | array | oldest first: `at`, `role`, `text` |
| `tool_calls.kept` | number | how many tool calls `items` holds |
| `tool_calls.dropped` | number | how many older tool calls were left out |
| `tool_calls.items` | array | oldest first: `at`, `tool`, optional `arg`, optional `outcome` |
| `facts` | object | optional, free-form string pairs shown as session facts |

**`kept` and `dropped` are what let the drawer state its window.** A bounded
list that does not say it is bounded gives a partial answer that looks complete,
which is worse than no answer. `dropped: 0` means the digest holds the whole
session.

`facts` is deliberately open: a producer puts whatever a reader would usefully
show beside a session, and a reader renders the pairs it gets without knowing
them. Both keys and values are plain strings.

**Every string in this contract is rendered as text.** A reader never renders a
contract string as markdown or as HTML, because its content comes from a
transcript the reader did not author.

---

## `tree.json`

The working tree in two bands, written by the producer because a reader cannot
run git. NoteThink is a web extension with no child processes, and the built-in
git extension runs in a different extension host it cannot reach.

```json
{
  "contract_version": "1.0.0",
  "generated_at": "2026-09-18T09:14:02Z",
  "branch": "staging",
  "head_commit": "ef11de8b1c9a4d2f6e5b0a3c7d8e9f01a2b3c4d5",
  "base_ref": "origin/main",
  "uncommitted": [
    {
      "path": "client/extension/src/types/AgentActivity.ts",
      "change": "added",
      "session_id": "b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01"
    },
    {
      "path": "package.json",
      "change": "modified",
      "base_blob": "blobs/6f2c1d9a44e0b7835c1ee2a90d4b67f3c8a15e7d9b0426ff31ac58e2d70b9134.json"
    }
  ],
  "committed": [
    {
      "path": "client/webview/src/notethink-views/src/components/notes/StickyNote.tsx",
      "change": "modified",
      "session_id": "b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01",
      "base_blob": "blobs/1a7d0c3e8b924f65a0d1c2b3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d.tsx",
      "head_blob": "blobs/93be2f014c7a8d6b5e4f3a2910c8d7e6f5a4b3c29180d7e6f5a4b3c291807d6e.tsx"
    }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `contract_version` | string | required |
| `generated_at` | string | ISO 8601 UTC |
| `branch` | string | the branch the working tree is on |
| `head_commit` | string | the commit `HEAD` points at |
| `base_ref` | string | optional, what the `committed` band is measured against, such as `origin/main` |
| `uncommitted` | array | files changed in the working tree and not yet committed |
| `committed` | array | files changed by commits on this branch since `base_ref` |

### A changed file

| Field | Type | Meaning |
|---|---|---|
| `path` | string | posix path relative to the contract root, as git reports it |
| `change` | string | `added`, `modified`, `deleted` or `renamed` |
| `previous_path` | string | required when `change` is `renamed`, absent otherwise; relative to the contract root |
| `session_id` | string | optional, the session whose write calls account for this file |
| `base_blob` | string | optional, path of the left-hand side relative to the contract directory |
| `head_blob` | string | optional, path of the right-hand side relative to the contract directory |
| `omitted` | string | optional, `size` or `binary`: a side exists but was not stored |

### Attribution: unattributed is the safe answer

`session_id` is present only when the producer can account for the file from a
session's own write calls. **A file with no matching write call is left
unattributed and is never credited to a guessed agent.** An absent `session_id`
therefore means unattributed, which stays correct even through a serialiser that
drops empty fields, and is the reason this field is nullable-by-absence where
`story_binding` is not: here the value that goes missing is the safe one.

### The two sides of a diff

A reader can open a file's diff only if it holds both sides, and it can produce
neither side out of git. It can, however, read the file in the workspace. So:

- **`base_blob`** is the left-hand side: the committed content for an
  `uncommitted` entry, and the `base_ref` content for a `committed` entry. It is
  absent when there is no left-hand side, which is what `change: "added"` means.
- **`head_blob`** is the right-hand side, and is present **only when the
  right-hand side is not the file in the workspace**. An `uncommitted` entry
  omits it, because the working file is the right-hand side. A `committed` entry
  supplies it, because the working file may carry further uncommitted edits on
  top of the commit.
- **`omitted`** distinguishes "there is no such side" from "there is a side and
  the producer did not store it". A blob missing with no `omitted` means the
  side does not exist; a blob missing with `omitted: "size"` or
  `omitted: "binary"` means it does, and a reader says the diff is unavailable
  rather than showing an empty pane.

### Blob paths

A blob reference is the one kind of path relative to the **contract directory**
rather than the contract root ([Path bases](#path-bases)): it starts with
`blobs/`, uses forward slashes, and contains no `..` segment, no leading slash
and no empty segment. A reader rejects anything else, because a blob path is
turned into a file URI and an unchecked one walks out of the contract directory.

The name inside `blobs/` is the producer's business. Content addressing works
well: name a blob for the lowercase hex SHA-256 of its bytes, so identical
content is stored once. **Keep the original file's extension on the end.** VS
Code picks a diff pane's syntax highlighting from the path, so
`blobs/<sha256>.ts` reads as TypeScript and `blobs/<sha256>` reads as plain
text.

### The contract's own files are not changes

A producer does not list anything under `.notethink/` in either band, and a
reader drops any entry that is. The contract must never show up in the band it
feeds.

---

## Capabilities

The hard problem this contract exists to solve: **a reader must be able to tell
"this vendor cannot report that" apart from "nothing is happening".** A blank
question band on a Codex session must not read as "Codex is not waiting on you",
because Codex exposes no permission request record at all and the producer has
nothing to report either way.

A `capabilities` object answers it. Keys are capability names, values are
`"supported"` or `"unsupported"`.

**A capability counts as available only when it is declared `"supported"`.**
Anything else, `"unsupported"` or an absent key alike, means the producer cannot
report it, and a reader says "not reported" rather than showing an empty result.
Silence never reads as "all quiet". A producer that can report something must
say so explicitly.

### Producer capabilities, on `manifest.json`

| Name | Supported means |
|---|---|
| `tree_state` | the producer runs git and writes `tree.json` |
| `blob_base` | the producer stores blobs, so a file's diff can be opened |

### Session capabilities, on `<id>.session.json`

| Name | Supported means |
|---|---|
| `live_tool_call` | `current` and the event log carry the tool call running now |
| `question` | a pending question would appear in `question` |
| `digest` | a digest file is written for this session |
| `file_attribution` | `session_id` on a changed file can be filled in from this session's write calls |

A reader ignores a capability name it does not know, so a minor version can add
one.

### What each vendor can supply

Measured 2026-09-16. This table is a producer's starting point, not a rule: a
producer declares what it can actually do, and a later vendor release may move a
row.

| Capability | `claude-code` | `codex` | `grok` |
|---|---|---|---|
| `live_tool_call` | supported | unsupported | supported |
| `question` | supported | unsupported | supported |
| `digest` | supported | supported | supported |
| `file_attribution` | supported | unsupported | supported |

- **Claude Code** exposes a per-process session file whose status is busy or
  idle, and a full hook matrix, so every session capability is reachable.
- **Codex** exposes a SQLite thread store and only the `notify` and
  `agent-turn-complete` hooks, so there is no live tool call, and it exposes no
  permission request record at all. Its digest comes from the thread store after
  a turn. A producer that can mine write calls out of that store may declare
  `file_attribution` supported; the measurement above does not assume it can.
- **Grok** exposes a live session registry, a model-written last-turn summary,
  and a full hook matrix.

---

## A worked example

One contract root, the `notethink` repository, with one Claude Code session
bound to a story, one Grok session waiting on a question, and one Codex session
that declared no story.

Every session in one `.notethink/` is working in the repository that holds it,
so they all carry the same `project` and every `story.doc_path` resolves inside
that repository. A second project on a reader's board comes from a second
repository with its own `.notethink/`, which the watcher glob picks up on its
own; it is never a second `project` value inside one contract root.

```
.notethink/
  manifest.json
  tree.json
  sessions/
    b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01.session.json
    b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01.events.jsonl
    b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01.digest.json
    grok-7712.session.json
    codex-4d19.session.json
  blobs/
    6f2c1d9a44e0b7835c1ee2a90d4b67f3c8a15e7d9b0426ff31ac58e2d70b9134.json
```

`manifest.json`:

```json
{
  "contract_version": "1.0.0",
  "producer": { "name": "example-activity-producer", "version": "0.4.1" },
  "written_at": "2026-09-18T09:14:02Z",
  "heartbeat_seconds": 10,
  "capabilities": { "tree_state": "supported", "blob_base": "supported" },
  "sessions": ["b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01", "grok-7712", "codex-4d19"]
}
```

`sessions/b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01.session.json`, a bound agent at
work:

```json
{
  "contract_version": "1.0.0",
  "session_id": "b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01",
  "vendor": "claude-code",
  "project": "notethink",
  "started_at": "2026-09-18T08:51:30Z",
  "updated_at": "2026-09-18T09:14:01Z",
  "state": "working",
  "story_binding": "bound",
  "story": { "doc_path": "docstech/users/alex.stanhope/todo.md", "id": "agent-activity-card" },
  "capabilities": {
    "live_tool_call": "supported",
    "question": "supported",
    "digest": "supported",
    "file_attribution": "supported"
  },
  "current": { "at": "2026-09-18T09:14:01Z", "kind": "tool_call", "tool": "Edit", "arg": "client/extension/src/types/AgentActivity.ts" }
}
```

`sessions/grok-7712.session.json`, waiting on the operator:

```json
{
  "contract_version": "1.0.0",
  "session_id": "grok-7712",
  "vendor": "grok",
  "project": "notethink",
  "started_at": "2026-09-18T09:02:11Z",
  "updated_at": "2026-09-18T09:13:40Z",
  "state": "waiting",
  "story_binding": "bound",
  "story": { "doc_path": "docstech/users/alex.stanhope/todo.md", "id": "user-view-type-update" },
  "capabilities": {
    "live_tool_call": "supported",
    "question": "supported",
    "digest": "supported",
    "file_attribution": "supported"
  },
  "current": { "at": "2026-09-18T09:13:40Z", "kind": "question", "arg": "rename across call sites" },
  "question": {
    "question_id": "q-4417",
    "asked_at": "2026-09-18T09:13:40Z",
    "prompt": "Apply the rename across all 14 call sites?",
    "options": ["Yes", "No, just this one", "Cancel"]
  }
}
```

`sessions/codex-4d19.session.json`, on no story, and unable to report a
question either way:

```json
{
  "contract_version": "1.0.0",
  "session_id": "codex-4d19",
  "vendor": "codex",
  "project": "notethink",
  "started_at": "2026-09-18T09:05:00Z",
  "updated_at": "2026-09-18T09:12:00Z",
  "state": "unknown",
  "story_binding": "none",
  "capabilities": {
    "live_tool_call": "unsupported",
    "question": "unsupported",
    "digest": "supported",
    "file_attribution": "unsupported"
  }
}
```

A reader draws that last session away from every story's card, with its state
rail neutral and its question band reading "Codex cannot report questions"
rather than blank.

`tree.json`, both bands populated, with one unattributed file:

```json
{
  "contract_version": "1.0.0",
  "generated_at": "2026-09-18T09:14:02Z",
  "branch": "staging",
  "head_commit": "ef11de8b1c9a4d2f6e5b0a3c7d8e9f01a2b3c4d5",
  "base_ref": "origin/main",
  "uncommitted": [
    {
      "path": "client/extension/src/types/AgentActivity.ts",
      "change": "added",
      "session_id": "b7f1c2de-3a44-4f90-9d12-5a6b7c8d9e01"
    },
    {
      "path": "package.json",
      "change": "modified",
      "base_blob": "blobs/6f2c1d9a44e0b7835c1ee2a90d4b67f3c8a15e7d9b0426ff31ac58e2d70b9134.json"
    }
  ],
  "committed": []
}
```

`package.json` carries no `session_id` because no session's write calls account
for it, which is what an unattributed file looks like. It is not guessed onto
the one session that happens to be running.

---

## Producer checklist

1. Write `.notethink/` inside the repository, and keep it out of git.
2. Put `contract_version` on every file, and on every event line.
3. Rename temporary files over whole-file targets; append or rewrite the event
   log.
4. Stay inside every size bound, and drop content rather than exceeding one.
5. Declare a capability `"supported"` only when you can actually report it.
6. Rewrite `manifest.json` every `heartbeat_seconds`, whether or not anything
   changed.
7. Write `story_binding` on every session, and `bound` only against an authored
   `[](?id=slug)` linetag.
8. Leave a file unattributed rather than guessing which agent wrote it.
9. List every live session in `manifest.sessions`, and remove a session when it
   ends.
