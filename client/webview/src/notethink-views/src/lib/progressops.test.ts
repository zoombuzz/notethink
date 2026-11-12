import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { convertMdastToNoteHierarchy } from './convertMdastToNoteHierarchy';
import { flattenAllNotes } from './noteops';
import {
    hasInFlightStatus,
    hasLiveAgentBound,
    isStoryNote,
    linetagProgressPct,
    percentOfCount,
    progressEntryForStory,
    progressLabel,
    progressLinetagText,
    progressTooltip,
    resolveStoryProgress,
    taskCountOf,
} from './progressops';
import type { ActivitySnapshot } from './agentactivityops';
import type { ActivitySession } from '../types/AgentActivity';
import type { NoteProps } from '../types/NoteProps';

const DOC = 'docstech/todo.md';

function parseNotes(markdown: string): NoteProps[] {
    const root = convertMdastToNoteHierarchy(fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }), markdown);
    return flattenAllNotes(root).filter(note => note.type === 'heading');
}

function storyNote(markdown: string): NoteProps {
    const note = parseNotes(markdown)[0];
    return { ...note, origin: { doc_id: 'x', doc_path: `/ws/${DOC}`, relative_path: DOC } };
}

function snapshot(overrides: Partial<ActivitySnapshot> = {}): ActivitySnapshot {
    return { analyser: { state: 'live', refusals: [] }, sessions: [], trees: [], progress: [], coordinators: [], ...overrides };
}

function session(state: ActivitySession['state'], story_id: string): ActivitySession {
    return {
        session_id: 's1', vendor: 'claude-code', project: 'p', story_binding: 'bound',
        stories: [{ doc_path: DOC, id: story_id }], started_at: '2026-11-03T09:00:00Z', updated_at: '2026-11-03T10:00:00Z',
        state, capabilities: {}, usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true },
    };
}

const TASKS = '### Story [](?id=story-a&status=doing)\n\n+ [X] one\n+ [ ] two\n  + [X] nested\n  + plain bullet\n+ [ ] three\n';

describe('taskCountOf', () => {
    it('counts ticked over all boxes at any depth and ignores plain bullets', () => {
        expect(taskCountOf(storyNote(TASKS).children_body)).toEqual({ done: 2, total: 4 });
    });

    it('counts nothing for a story with no boxes', () => {
        expect(taskCountOf(storyNote('### Story [](?id=a&status=doing)\n\n+ plain\n').children_body)).toEqual({ done: 0, total: 0 });
        expect(taskCountOf(undefined)).toEqual({ done: 0, total: 0 });
    });

    it('does not count the boxes of a story nested below it', () => {
        const note = storyNote('### Outer [](?id=o&status=doing)\n\n+ [X] mine\n\n#### Inner [](?id=i)\n\n+ [ ] theirs\n+ [ ] theirs too\n');
        expect(taskCountOf(note.children_body)).toEqual({ done: 1, total: 1 });
    });

    it('turns a count into a rounded percent, or none without boxes', () => {
        expect(percentOfCount({ done: 1, total: 3 })).toBe(33);
        expect(percentOfCount({ done: 3, total: 3 })).toBe(100);
        expect(percentOfCount({ done: 0, total: 0 })).toBeUndefined();
    });
});

describe('linetagProgressPct and progressLinetagText', () => {
    const tag = (value: string): NoteProps['linetags'] => ({ progress: { key: 'progress', value, value_numeric: Number(value), key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 } });

    it('reads a progress tag with its max sibling as a share', () => {
        const note = storyNote('### S [](?id=s&progress=35&progress_unit=%25&progress_max=100)');
        expect(linetagProgressPct(note.linetags)).toBe(35);
        expect(progressLinetagText(note.linetags)).toBe('35%');
    });

    it('reads a progress tag without siblings, drawing its value and throwing nothing', () => {
        expect(linetagProgressPct(tag('60'))).toBe(60);
        expect(progressLinetagText(tag('60'))).toBe('60');
    });

    it('reads a share of a max other than 100', () => {
        const note = storyNote('### S [](?id=s&progress=3&progress_max=4)');
        expect(linetagProgressPct(note.linetags)).toBe(75);
    });

    it('gives none for a value out of range, a non-number or no tag', () => {
        expect(linetagProgressPct(tag('150'))).toBeUndefined();
        expect(linetagProgressPct(tag('abc'))).toBeUndefined();
        expect(linetagProgressPct(undefined)).toBeUndefined();
        expect(progressLinetagText(undefined)).toBe('');
    });
});

describe('which stories draw a pie', () => {
    it('takes a story at doing, code-review or testing and no other status', () => {
        for (const status of ['doing', 'code-review', 'testing']) {
            expect(hasInFlightStatus(storyNote(`### S [](?id=s&status=${status})`))).toBe(true);
        }
        expect(hasInFlightStatus(storyNote('### S [](?id=s&status=backlog)'))).toBe(false);
        expect(hasInFlightStatus(storyNote('### S [](?id=s)'))).toBe(false);
    });

    it('ignores an inherited status', () => {
        const note = storyNote('### S [](?id=s)');
        note.linetags = { ...note.linetags, status: { ...note.linetags!.id, key: 'status', value: 'doing', inherited: true } };
        expect(hasInFlightStatus(note)).toBe(false);
    });

    it('takes only parsed headings', () => {
        expect(isStoryNote(storyNote('### S [](?id=s)'))).toBe(true);
        expect(isStoryNote({ ...storyNote('### S [](?id=s)'), type: 'listItem' })).toBe(false);
        expect(isStoryNote(undefined)).toBe(false);
    });

    it('counts an agent that has not ended as live and one that has as not', () => {
        const key = { doc_path: DOC, id: 'story-a' };
        const live = (state: ActivitySession['state']): boolean => hasLiveAgentBound(snapshot({ sessions: [{ root_path: '/ws', session: session(state, 'story-a') }] }), key);
        expect(live('working')).toBe(true);
        expect(live('waiting')).toBe(true);
        expect(live('idle')).toBe(true);
        expect(live('ended')).toBe(false);
        expect(live('unknown')).toBe(false);
        expect(hasLiveAgentBound(undefined, key)).toBe(false);
    });
});

describe('progressEntryForStory', () => {
    const entry = (root_relative: string, pct: number, story_id = 'story-a'): ActivitySnapshot['progress'][number] => ({ root_relative, story_id, pct, at: '2026-11-03T10:00:00Z', by: 'agent' });

    it('matches on story id within the repository holding the document', () => {
        const snap = snapshot({ progress: [entry('other', 10), entry('', 20), entry('docstech', 30, 'story-b')] });
        expect(progressEntryForStory(snap, { doc_path: DOC, id: 'story-a' })?.pct).toBe(20);
    });

    it('prefers the deepest repository', () => {
        const snap = snapshot({ progress: [entry('', 20), entry('docstech', 70)] });
        expect(progressEntryForStory(snap, { doc_path: DOC, id: 'story-a' })?.pct).toBe(70);
    });

    it('gives none without a snapshot, a key or an entry', () => {
        expect(progressEntryForStory(undefined, { doc_path: DOC, id: 'story-a' })).toBeUndefined();
        expect(progressEntryForStory(snapshot(), undefined)).toBeUndefined();
        expect(progressEntryForStory(snapshot(), { doc_path: DOC, id: 'story-a' })).toBeUndefined();
    });
});

describe('resolveStoryProgress', () => {
    const with_entry = snapshot({ progress: [{ root_relative: '', story_id: 'story-a', pct: 80, at: '2026-11-03T10:00:00Z', by: 'agent', note: 'nearly' }] });

    it('prefers the coordinator entry over the tag and the task boxes', () => {
        const note = storyNote('### S [](?id=story-a&status=doing&progress=10&progress_max=100)\n\n+ [X] one\n');
        expect(resolveStoryProgress(note, with_entry)).toEqual({ pct: 80, source: 'coordinator', at: Date.parse('2026-11-03T10:00:00Z'), note: 'nearly' });
    });

    it('falls back to the progress tag, then to the task boxes', () => {
        const tagged = storyNote('### S [](?id=story-a&status=doing&progress=10&progress_max=100)\n\n+ [X] one\n');
        expect(resolveStoryProgress(tagged, snapshot())).toEqual({ pct: 10, source: 'linetag' });
        expect(resolveStoryProgress(storyNote(TASKS), snapshot())).toEqual({ pct: 50, source: 'tasks', done: 2, total: 4 });
        expect(resolveStoryProgress(storyNote(TASKS), undefined)).toEqual({ pct: 50, source: 'tasks', done: 2, total: 4 });
    });

    it('gives none for a story with no source, and for a story not in flight with no live agent', () => {
        expect(resolveStoryProgress(storyNote('### S [](?id=story-a&status=doing)\n\n+ plain\n'), snapshot())).toBeUndefined();
        expect(resolveStoryProgress(storyNote('### S [](?id=story-a)\n\n+ [X] one\n'), with_entry)).toBeUndefined();
    });

    it('draws on a story with no in-flight status while a live agent is bound to it', () => {
        const snap = snapshot({ ...with_entry, sessions: [{ root_path: '/ws', session: session('working', 'story-a') }] });
        expect(resolveStoryProgress(storyNote('### S [](?id=story-a)'), snap)?.pct).toBe(80);
    });
});

describe('progressLabel and progressTooltip', () => {
    it('labels the percent and names each source in the tooltip', () => {
        expect(progressLabel({ pct: 40, source: 'tasks', done: 2, total: 5 })).toBe('40% complete');
        expect(progressTooltip({ pct: 40, source: 'tasks', done: 2, total: 5 })).toBe('40% complete (2 of 5 tasks ticked)');
        expect(progressTooltip({ pct: 40, source: 'linetag' })).toBe('40% complete (progress tag)');
        expect(progressTooltip({ pct: 40, source: 'coordinator' })).toBe('40% complete (coordinator estimate)');
        expect(progressTooltip({ pct: 40, source: 'coordinator', note: 'on track' })).toBe('40% complete (coordinator estimate): on track');
    });
});
