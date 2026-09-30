import { bindSessionToStory, storiesForWriteCall, type StoryBindingWriteCall, type StoryDocument } from './agentstorybindingops';

const TODO_PATH = 'docstech/users/alex/todo.md';
const DONE_PATH = 'docstech/users/alex/done.md';

const TODO_TEXT = `# Todo


### First story [](?id=first-story&status=code-review)

+ [X] done already


### Second story [](?id=second-story&status=doing)

+ [ ] still working


### Third story [](?id=third-story)

+ [ ] untagged, not doing


### Untagged story with no linetag at all

+ [ ] a real backlog story
`;

function call(doc_path: string, overrides: Partial<StoryBindingWriteCall> = {}): StoryBindingWriteCall {
    return { doc_path, ...overrides };
}

function edit(new_text?: string, old_text?: string): NonNullable<StoryBindingWriteCall['edits']>[number] {
    return { new_text, old_text };
}

describe('bindSessionToStory', () => {
    const docs: StoryDocument[] = [{ doc_path: TODO_PATH, text: TODO_TEXT }];

    it('binds to the story whose section the edit is found in, by its new_text', () => {
        const calls = [call(TODO_PATH, { edits: [edit('+ [ ] still working')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([{ doc_path: TODO_PATH, id: 'second-story' }]);
    });

    it('binds to a code-review story, not whichever story happens to be doing, since location - not status - decides now', () => {
        const calls = [call(TODO_PATH, { edits: [edit('done already')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([{ doc_path: TODO_PATH, id: 'first-story' }]);
    });

    it('binds a story with no authored id under the slug derived from its headline', () => {
        const calls = [call(TODO_PATH, { edits: [edit('untagged, not doing')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([{ doc_path: TODO_PATH, id: 'third-story' }]);
    });

    it('binds a story with no linetag block at all (a real backlog heading) under its derived slug', () => {
        const calls = [call(TODO_PATH, { edits: [edit('a real backlog story')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([{ doc_path: TODO_PATH, id: 'untagged-story-with-no-linetag-at-all' }]);
    });

    it('does not bind when the session touched no story board', () => {
        const calls = [call('client/extension/src/lib/foo.ts', { edits: [edit('some code')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([]);
    });

    it('does not bind a whole-file write, whatever edits it happens to carry', () => {
        const calls = [call(TODO_PATH, { whole_file: true, edits: [edit('+ [ ] still working')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([]);
    });

    it('does not bind when the edit text is found nowhere in the board', () => {
        const calls = [call(TODO_PATH, { edits: [edit('nothing like this exists anywhere')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([]);
    });

    it('falls back to a distinctive line of the snippet when the whole snippet is not found verbatim', () => {
        const calls = [call(TODO_PATH, { edits: [edit('+ [ ] still working\nsome context that has since changed')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([{ doc_path: TODO_PATH, id: 'second-story' }]);
    });

    it('falls back to old_text when new_text cannot be located anywhere', () => {
        const calls = [call(TODO_PATH, { edits: [edit('this replacement text is nowhere in the board', '+ [X] done already')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([{ doc_path: TODO_PATH, id: 'first-story' }]);
    });

    it('binds a story a session moved into done.md, keeping its credit rather than losing the binding', () => {
        const moved_docs: StoryDocument[] = [
            { doc_path: TODO_PATH, text: TODO_TEXT.replace(/### Second story.*\n\n\+ \[ \] still working\n\n\n/s, '') },
            { doc_path: DONE_PATH, text: '# Done\n\n\n### Second story [](?id=second-story&status=doing)\n\n+ [X] still working\n' },
        ];
        const calls = [call(TODO_PATH, { edits: [edit('+ [X] still working')] })];
        expect(bindSessionToStory(calls, moved_docs)).toEqual([{ doc_path: DONE_PATH, id: 'second-story' }]);
    });

    it('binds once, not twice, when a located edit is itself a truncated linetag fragment rather than a whole heading line', () => {
        // a prefix with no closing paren locates the heading's line but is not itself a real heading
        const calls = [call(TODO_PATH, { edits: [edit('### Second story [](?id=second-story')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([{ doc_path: TODO_PATH, id: 'second-story' }]);
    });

    it('does not derive a wrong id from an edit boundary that ends exactly at an unrelated heading title, its own linetag left outside the edit', () => {
        // an edit boundary at a bare title with no linetag must not slugify that title into a wrong id
        const calls = [call(TODO_PATH, { edits: [edit('# Todo\n\n\n### First story [](?id=first-story&status=code-review)\n\nsome new content\n\n\n### Second story')] })];
        const result = bindSessionToStory(calls, docs);
        expect(result).toEqual([{ doc_path: TODO_PATH, id: 'first-story' }]);
    });

    it('binds the story named by a heading line carried inside the edit itself, even when the edit cannot otherwise be located', () => {
        const calls = [call(TODO_PATH, { edits: [edit('### A brand new story [](?id=brand-new-story)\n\n+ [ ] first task')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([{ doc_path: TODO_PATH, id: 'brand-new-story' }]);
    });

    it('binds both the story named inside the edit and the story its own location encloses, when both apply', () => {
        const calls = [call(TODO_PATH, { edits: [edit('+ [ ] still working\n\n\n### A brand new story [](?id=brand-new-story)\n')] })];
        const result = bindSessionToStory(calls, docs);
        expect(result).toContainEqual({ doc_path: TODO_PATH, id: 'second-story' });
        expect(result).toContainEqual({ doc_path: TODO_PATH, id: 'brand-new-story' });
    });

    it('binds every story two separate edits in one MultiEdit call touched, deduplicated', () => {
        const calls = [call(TODO_PATH, {
            edits: [edit('done already'), edit('untagged, not doing'), edit('done already')],
        })];
        const result = bindSessionToStory(calls, docs);
        expect(result).toHaveLength(2);
        expect(result).toContainEqual({ doc_path: TODO_PATH, id: 'first-story' });
        expect(result).toContainEqual({ doc_path: TODO_PATH, id: 'third-story' });
    });

    it('binds every story two separate write calls in one session touched', () => {
        const calls = [
            call(TODO_PATH, { edits: [edit('done already')] }),
            call(TODO_PATH, { edits: [edit('untagged, not doing')] }),
        ];
        const result = bindSessionToStory(calls, docs);
        expect(result).toHaveLength(2);
        expect(result).toContainEqual({ doc_path: TODO_PATH, id: 'first-story' });
        expect(result).toContainEqual({ doc_path: TODO_PATH, id: 'third-story' });
    });

    it('skips short, generic fallback lines within an unmatched multi-line snippet rather than matching board noise', () => {
        // no verbatim match, and every line is too short/generic to be a fallback locator, so this binds nothing
        const calls = [call(TODO_PATH, { edits: [edit('+ [ ]\n+ [X]')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([]);
    });

    it('skips this workspace\'s own generic section-divider bullets as a fallback locator, even though they clear the length bound', () => {
        // an inserted "+ out of scope" line could fallback-match an unrelated story's identical divider bullet
        const board_with_divider: StoryDocument[] = [{
            doc_path: TODO_PATH,
            text: TODO_TEXT.replace('+ [ ] still working', '+ [ ] still working\n+ out of scope\n  + nothing relevant here'),
        }];
        // no verbatim match; the only line long enough to be a fallback candidate is the generic divider itself
        const calls = [call(TODO_PATH, { edits: [edit('+ out of scope\n  + a completely different, unrelated concern this snippet is actually about')] })];
        expect(bindSessionToStory(calls, board_with_divider)).toEqual([]);
    });

    it('a write outside any board binds nothing', () => {
        const calls = [call('README.md', { edits: [edit('some new readme text')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([]);
    });

    it('rebinds against new text when the same doc object has its text replaced, never serving a stale cached index', () => {
        const doc: StoryDocument = { doc_path: TODO_PATH, text: TODO_TEXT };
        const shared_docs: StoryDocument[] = [doc];
        const before = bindSessionToStory([call(TODO_PATH, { edits: [edit('+ [ ] still working')] })], shared_docs);
        expect(before).toEqual([{ doc_path: TODO_PATH, id: 'second-story' }]);
        doc.text = '# Todo\n\n\n### Replaced story [](?id=replaced-story)\n\n+ [ ] still working\n';
        const after = bindSessionToStory([call(TODO_PATH, { edits: [edit('+ [ ] still working')] })], shared_docs);
        expect(after).toEqual([{ doc_path: TODO_PATH, id: 'replaced-story' }]);
    });

    it('does not bind an edit located above the first heading (a preamble line)', () => {
        const calls = [call(TODO_PATH, { edits: [edit('# Todo')] })];
        expect(bindSessionToStory(calls, docs)).toEqual([]);
    });

    it('locates an edit near the end of a long board and binds it to the right enclosing story', () => {
        const story_count = 400;
        let text = '# Done\n\n\n';
        for (let i = 0; i < story_count; i++) {
            text += `### Story ${i} [](?id=story-${i})\n\n`;
            for (let line = 0; line < 8; line++) {
                text += `+ [X] padding line ${line} for story ${i}\n`;
            }
            text += '\n\n';
        }
        const long_docs: StoryDocument[] = [{ doc_path: DONE_PATH, text }];
        const calls = [call(DONE_PATH, { edits: [edit(`+ [X] padding line 3 for story ${story_count - 1}`)] })];
        expect(bindSessionToStory(calls, long_docs)).toEqual([{ doc_path: DONE_PATH, id: `story-${story_count - 1}` }]);
    });
});

describe('storiesForWriteCall', () => {
    // bindSessionToStory folds across a whole session; AgentAnalyser.ts's per-turn split needs the per-call answer
    const docs: StoryDocument[] = [{ doc_path: TODO_PATH, text: TODO_TEXT }];

    it('binds the one call to the story its edit is found in, same as bindSessionToStory would for a single-call session', () => {
        const result = storiesForWriteCall(call(TODO_PATH, { edits: [edit('+ [ ] still working')] }), docs);
        expect(result).toEqual([{ doc_path: TODO_PATH, id: 'second-story' }]);
    });

    it('binds every story this one call touched, deduplicated, when its edits span several sections', () => {
        const result = storiesForWriteCall(call(TODO_PATH, { edits: [edit('done already'), edit('untagged, not doing'), edit('done already')] }), docs);
        expect(result).toEqual([{ doc_path: TODO_PATH, id: 'first-story' }, { doc_path: TODO_PATH, id: 'third-story' }]);
    });

    it('does not bind a whole-file write, whatever edits it happens to carry', () => {
        const result = storiesForWriteCall(call(TODO_PATH, { whole_file: true, edits: [edit('+ [ ] still working')] }), docs);
        expect(result).toEqual([]);
    });

    it('a call outside any board binds nothing', () => {
        const result = storiesForWriteCall(call('README.md', { edits: [edit('some new readme text')] }), docs);
        expect(result).toEqual([]);
    });

    it('a call with no edits binds nothing', () => {
        const result = storiesForWriteCall(call(TODO_PATH), docs);
        expect(result).toEqual([]);
    });

    it('summing storiesForWriteCall over every call in a session reproduces what bindSessionToStory returns for the same session', () => {
        const calls = [
            call(TODO_PATH, { edits: [edit('done already')] }),
            call(TODO_PATH, { edits: [edit('untagged, not doing')] }),
        ];
        const per_call = calls.flatMap(c => storiesForWriteCall(c, docs));
        // storiesForWriteCall does not dedup ACROSS calls - only bindSessionToStory folds and dedups the whole session
        expect(per_call).toEqual([{ doc_path: TODO_PATH, id: 'first-story' }, { doc_path: TODO_PATH, id: 'third-story' }]);
        expect(bindSessionToStory(calls, docs)).toEqual(per_call);
    });
});

describe('bindSessionToStory mirrors the webview slug derivation', () => {
    // mirrors noteops.ts's storyStableIdSlug coverage: both sides must derive the same id, since they join on it
    const cases: Array<[string, string]> = [
        ['### Agent activity card [](?id=agent-activity-card&status=doing)', 'agent-activity-card'],
        ['### Save drawer changes into an existing custom view type', 'save-drawer-changes-into-an-existing-custom-view-type'],
        ['### Kanban perf harness and budgets', 'kanban-perf-harness-and-budgets'],
        ['### Research suggested queries and structured reports', 'research-suggested-queries-and-structured-reports'],
        ['### Implement resolutions from last meeting', 'implement-resolutions-from-last-meeting'],
        ["### What's next? A question, punctuated!", 'what-s-next-a-question-punctuated'],
        ['### 🎉 Emoji-only headline 🎉', 'emoji-only-headline'],
        // no ASCII alphanumeric survives an emoji-only headline, so the fallback is its 1-based line number
        ['### 🎉🎉', 'headline-4'],
    ];

    it.each(cases)('derives %s -> %s', (heading, expected_id) => {
        const text = `# Todo\n\n\n${heading}\n\n+ [ ] a task\n`;
        const calls = [call(TODO_PATH, { edits: [edit('a task')] })];
        expect(bindSessionToStory(calls, [{ doc_path: TODO_PATH, text }])).toEqual([{ doc_path: TODO_PATH, id: expected_id }]);
    });
});
