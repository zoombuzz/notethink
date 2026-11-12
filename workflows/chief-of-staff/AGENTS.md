# Chief of staff agent guidelines

This pack lets you run coding agents against a board of stories kept in plain markdown. The board is `todo.md` (open work) and `done.md` (shipped work); this file holds the rules every agent working on the board follows. Two skills build on it: [what-next](skills/what-next/SKILL.md) picks the next story an agent can implement, and [me-now](skills/me-now/SKILL.md) lists what the human should do to keep the agents busy.

## How stories work

### Encoding

- `todo.md` starts with a single `# Todo` heading and `done.md` with a single `# Done` heading, with no blank line above it.
- Each story is a `###` heading. Tasks are `+ [ ]` (open) and `+ [X]` (done) bullets under it, uppercase `X`.
- **Exactly two blank lines** go before and after every story. The gap is what separates one story from the next, so tools that move stories rely on it.
- State and identity ride on the heading as a linetag, an empty link holding a query string: `### Story title [](?status=doing&id=story-title)`. Keys are separated by `&` and their order does not matter.

### Priority is position

- Stories are read top to bottom, and the top story is the next one to work on.
- A new story goes in at the **top** of `todo.md`. The bottom is parked work that nobody picks up.
- Filing several stories at once puts them all at the top as a block. If you cannot tell how a story ranks, put it at the top and say so.

### States

| State | Heading linetag | Meaning |
|---|---|---|
| backlog | no `status` key | not started |
| doing | `status=doing` | being implemented now |
| code-review | `status=code-review` | implementation finished, waiting for a human to review |
| testing | `status=testing` | a human has reviewed it and is running the manual checks |
| done | moved to `done.md`, `status` removed | shipped and finished |

- Set `doing` when you start a story, and tick each task `[X]` the moment it is done, in the same turn. The board is always current, never updated in one pass at the end.
- An agent moves a story forward one state at a time, and never past `testing`. Moving it to `done.md` happens only when a human says the story has shipped.

### An advance is a claim

Moving a story to `code-review` says the implementation is finished and is the best the agent can produce. Make only true claims:

1. **The work exists in the tree.** The test is the code as it stands, not the diff of this session.
2. **Every box is ticked, with evidence.** A tick you cannot back with a file and line, a test name or a commit is a forgery.
3. **Nobody narrows a story to pass.** Deleting, softening or demoting a task so the story clears its gate is a false record. If a requirement has moved, ask the human, with a recommendation and what the code does today.

An unticked box is a question about the code, not a verdict on it. Read the code first, then sort the task into one bucket:

- **Delivered but unticked**: tick it and say what convinced you.
- **Not delivered and you can deliver it**: build it. The first move on an open task is to do it.
- **Not delivered and the requirement moved**: ask.

### Moving a story to `done.md`

Use [move-to-done.mjs](scripts/move-to-done.mjs), which does the whole edit in one step:

- it appends the story at the **end** of `done.md`, creating the file if it is missing;
- it strips the `status` key from the heading linetag and keeps every other key;
- it refuses while any box under the story is still open;
- `--dry-run` prints what it would do and writes nothing.

### Manual work

- Tag a task `[](?work=manual)` only when no agent can carry it out: an email under the human's name, a physical action, a legal signature. Needing a login is not manual.
- A `+ manual:` bullet is a check for the human to run in the `testing` state. It is not a task, has no checkbox, and never blocks the story from reaching `code-review`.
- An agent runs a check itself first, and narrows the `+ manual:` line to what only the human can supply.

### Content shape

- Titles are short, about 60 characters, without the linetag. Qualifiers belong in the body.
- Top-level bullets fit one wrapped line. Detail goes in child bullets, one thought per bullet.
- Task bullets start with a verb: "add", "rename", "verify".
- Record decisions in the story body the moment they are made, one short line each, such as `+ decision 2025-01-31: keep the board in one file`.
- Phased work gets one story per phase, so each story can finish on its own.
- Refer to another story as `[[slug]]` and pin `id=slug` on that story's heading, so the reference survives a rename. Only name a story that exists in the same file.

## What agents do not do

- Do not edit a story you are not working on, and never revert or tidy another session's edits. Several sessions can write the board at once, so make each change one targeted edit and re-read the story afterwards.
- Do not write a completion note ("done", "delivered", with a date) on a story that still has an open box.
- Do not write anything private into a board that is published: no secrets, no personal paths, no machine names.
