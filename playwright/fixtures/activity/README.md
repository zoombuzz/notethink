# Activity contract fixtures

A populated `.notethink/` directory, laid out exactly as a producer writes one, so the
agent card can be driven with no live agent anywhere. `ACTIVITY_CONTRACT.md` at the repo
root is the specification these fixtures are written against.

**This directory stands in for one contract root**, notethink's own, so every session
here carries `"project": "notethink"` and every `story.doc_path` resolves inside this
repository. A second project on the board means a second contract root, which is a second
fixture directory beside this one, not another session in this one. The directory is not
literally named `.notethink`, because the repo's `.gitignore` excludes `**/.notethink/`
and the fixtures have to be committed.

The four bound sessions point at four real story ids in
`docstech/users/alex.stanhope/todo.md`, so a spec can join them against the file as it
stands rather than against a story invented for the fixture.

`client/extension/src/lib/activityops.test.ts` reads every file here and asserts the
outcome named below, so a fixture cannot drift away from the validator without a test
going red.

| File | What it covers |
|---|---|
| `manifest.json` | a live producer, both producer capabilities supported, five live sessions |
| `tree.json` | both bands populated, one unattributed file, one renamed file, one whose side exists but was not stored, and both sides of a committed diff |
| `sessions/claude-bound-busy.session.json` | a bound agent at work, with its current tool call |
| `sessions/claude-bound-busy.events.jsonl` | a clean event log |
| `sessions/claude-bound-busy.digest.json` | a bounded digest, stating what it dropped |
| `sessions/grok-bound-idle.session.json` | a bound agent alive with nothing running |
| `sessions/grok-question.session.json` | a pending question, with the session waiting on it |
| `sessions/claude-no-story.session.json` | an agent that declared it is on no story |
| `sessions/codex-no-question.session.json` | a session that cannot report a question either way |
| `sessions/future-version.session.json` | a contract major this build does not read |
| `sessions/truncated.session.json` | a whole-file JSON read mid-write |
| `sessions/partial-append.events.jsonl` | complete lines plus a half-written trailing line |
| `blobs/` | the stored sides `tree.json` references |

The three failure fixtures are the point of the set as much as the healthy ones: a producer
writes while the host reads, so a truncated file is the normal failure and has to be refused
rather than half-read. They are deliberately left out of `manifest.json`, which is
authoritative about which sessions are live, so a spec that renders the board gets five
healthy sessions and drives the failures directly.
