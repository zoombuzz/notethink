---
name: what-next
description: Read the board's todo.md, point out the stories that need a human, and plan the next story an agent can implement
user-invocable: true
---

# What next?

Choose the next piece of work from the board and prepare an implementation plan for approval. The rules for reading a board are in [AGENTS.md](../../AGENTS.md) > How stories work.

## 1. Find the board

Look for `todo.md` in this order and use the first that exists: the workspace root, `docstech/`, `docs/`, then any single `todo.md` elsewhere in the repo. If there are several candidates, list them and ask which one is the board. Read `done.md` beside it when it exists, to see what has already shipped.

If there is no `todo.md`, or it holds no stories, say that nothing is queued and stop.

## 2. Parse the stories

Stories are `###` headings under `# Todo`, ordered by priority, top first. For each story note:

- its title and its `status` linetag, if any
- how many `+ [ ]` tasks are open and how many `+ [X]` are ticked
- whether an open task carries `[](?work=manual)`

A `+ manual:` bullet is a check for a human in the `testing` state. It is not a task, so it never counts as open work.

## 3. Classify each open story

- **Agent can implement**: it has at least one open task without `[](?work=manual)`.
- **Waiting on a human**: every open task is `[](?work=manual)`, or the story is in `code-review` or `testing` with nothing left to build.
- **Finished**: every box is ticked. It needs review or shipping, not implementation.

## 4. Show the overview

List each story that is not finished, in priority order, one line each:

```
1. ⚠️ **story title** - waiting on a human (what they need to do)
2. **story title** - an agent can implement (3 of 5 tasks open)
3. **story title** - doing, 1 task open
```

Use ⚠️ for a story that is entirely manual, and say so for a story that mixes manual and agent work.

## 5. Pick and plan

Take the topmost story an agent can implement. A story already at `doing` comes before an untagged story at the same position, because someone has started it. If the topmost story mixes manual and agent tasks, plan the agent tasks and name the manual ones for the human.

Read the files the story names, then write a plan:

- the concrete steps, in order
- the files to create or change
- anything ambiguous, and what you would choose

Present the plan and put every question alongside it, so the human can answer all of them in one reply.

## 6. After approval

Set the story to `doing` on the board, implement it, and tick each task the moment it is done. Follow the advance rules in [AGENTS.md](../../AGENTS.md) > An advance is a claim. Do not commit unless the human asks.
