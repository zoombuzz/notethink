# Chief of staff workflow pack

A small, self-contained pack for people who run coding agents against a `todo.md`. It gives you two agent skills, the story rules they rely on, a script that retires finished stories, and a board you can open in NoteThink.

## What is in the pack

| File | What it is |
|---|---|
| [AGENTS.md](AGENTS.md) | the story rules every agent follows; start here |
| [CLAUDE.md](CLAUDE.md) | a one-line file that imports `AGENTS.md` for agents that read that name |
| [skills/what-next/SKILL.md](skills/what-next/SKILL.md) | picks the next story an agent can implement and plans it |
| [skills/me-now/SKILL.md](skills/me-now/SKILL.md) | lists what you should do now to keep the agents busy |
| [todo.md](todo.md) | the board, a worked example you can open in the viewer |
| [done.md](done.md) | where finished stories go |
| `scripts/move-to-done.mjs` | moves a finished story from `todo.md` to `done.md` |

## Use it

1. Install the NoteThink extension for VS Code, and open `todo.md` with **NoteThink: Open Viewer**. The first line, `# Todo [](?nt_view=kanban)`, asks for a kanban board, so each `###` story shows as a card and each card links to the file that explains it.
2. Make the skills available to your agent: copy the two skill folders into its skills folder, or point it at them here. Keep `AGENTS.md` in the repo root.
3. Run `/what-next` to get a plan for the next story, and `/me-now` to see what is waiting on you.
4. When a story ships, move it:

   ```
   node scripts/move-to-done.mjs <story-id> --dry-run
   node scripts/move-to-done.mjs <story-id>
   ```

   The script takes the story's `id=` value or its title, appends the story to the end of `done.md`, removes its `status` key and keeps its other keys. It refuses while a task is still open. Pass `--dir <folder>` when your board is not in the current folder, or `--todo` and `--done` for explicit paths.

## Using the board in your own repo

Copy `AGENTS.md`, the `skills` folder and `scripts` into your repo, and start `todo.md` with `# Todo [](?nt_view=kanban)`. Keep two blank lines around every story, and put new stories at the top.
