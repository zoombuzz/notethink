# Todo [](?nt_view=kanban)


### Install the skills [](?id=install-skills)

Put the two skills where your coding agent can read them. Each skill is a markdown file that works in place.

+ [ ] copy `skills/what-next` and `skills/me-now` into your agent's skills folder, or point your agent at them here
+ [ ] keep [AGENTS.md](AGENTS.md) in the repo root so the skills can reach the story rules
+ [ ] read the [what-next skill](skills/what-next/SKILL.md) and the [me-now skill](skills/me-now/SKILL.md) once


### Ask what to work on next [](?id=run-what-next)

Run `/what-next` and let the agent read this board. It names the top story an agent can implement and proposes a plan.

+ [ ] run `/what-next` and read the plan against the [what-next skill](skills/what-next/SKILL.md)
+ [ ] answer any questions the plan raises, all in one reply


### Ask what you should do now [](?id=run-me-now)

Run `/me-now` to see which human actions would unblock the most agent work.

+ [ ] run `/me-now` and read its list against the [me-now skill](skills/me-now/SKILL.md)
+ [ ] do the first action on the list


### Let the agent keep the board [](?id=agent-keeps-board)

The agent sets `doing` when it starts, ticks each task the moment it is done, and files new stories at the top. The rules are in [AGENTS.md](AGENTS.md).

+ [ ] ask an agent to implement the top story and watch its card move
+ [ ] when a story ships, move it with the script described in the [pack README](README.md)
