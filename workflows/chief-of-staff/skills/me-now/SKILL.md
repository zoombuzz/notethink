---
name: me-now
description: List the highest-impact things the human should do right now to keep the coding agents productive
user-invocable: true
---

# Me now

The human is the bottleneck: agents can work in parallel, but one person can do one thing at a time. Find the actions that unblock the most agent work and order them so a single pass through the list keeps the agents busy. The rules for reading a board are in [AGENTS.md](../../AGENTS.md) > How stories work.

## 1. Find the boards

Look for every `todo.md` in the workspace, skipping dependency folders. A workspace with several boards (one per project, or one per person) is read as a whole, and each action is labelled with its board.

## 2. Read each story

For every story under `# Todo`, record:

- its position, because the top story is the next one the agents take
- its `status` linetag, or backlog when there is none
- open and ticked task counts
- any open task tagged `[](?work=manual)`
- any `+ manual:` checks
- any story it is blocked on, named in its text or by a `[[slug]]` reference

## 3. Classify what the human can do

A story can need more than one kind of action.

| Type | Badge | Meaning |
|---|---|---|
| Decision | D | a choice only the human can make: scope, priority, approach |
| Review | R | a story in `code-review`, waiting for the human to read the result |
| Manual | M | an open `[](?work=manual)` task |
| Unblock | U | a question or input an agent is waiting for: a credential, a design, a clarification |
| Test | T | `+ manual:` checks on a story in `testing` |

## 4. Rank by what each action unlocks

Order the actions by how much agent work they release:

1. actions that unblock a story at `doing`, where an agent is waiting now
2. actions that unblock the topmost open story of a board
3. actions that unblock several stories at once
4. quick wins, under five minutes, that release real work
5. longer manual work, grouped so it can be done in one sitting

## 5. Present the result

**Now** is a numbered list of at most five actions:

```
1. [R] board-name - review "story title"
   Unlocks: what the agents can do once this is done
   Est: quick / 15 min / 30+ min
```

**Soon** is a shorter list of the remaining actions, grouped by type.

**Parking lot** is one line each for stories with no immediate path forward, so the human knows they exist.

Finish with one sentence: "Completing items 1 to N would unblock X stories across Y boards."

## Rules

- Read only. Do not edit the board, change a status or tick a box.
- Report what the board says, and say so when a story's state looks wrong rather than quietly correcting it.
