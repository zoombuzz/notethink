import {
    PROGRESS_FILE_MAX_BYTES,
    PROGRESS_NOTE_MAX_CHARS,
    THINKERSYNC_HOME_SEGMENTS,
    parseProgressFile,
    progressFileSegments,
    progressForRepository,
    progressProjectName,
} from './progressfileops';

describe('progressFileSegments and progressProjectName', () => {
    it('places a project file under coordinator/<project>', () => {
        expect(progressFileSegments('notethink')).toEqual(['coordinator', 'notethink', 'progress.json']);
        expect(THINKERSYNC_HOME_SEGMENTS.join('/')).toBe('.local/share/thinkersync');
    });

    it('names a repository by its directory basename', () => {
        expect(progressProjectName('/work/active/notethink')).toBe('notethink');
        expect(progressProjectName('/work/active/notethink/')).toBe('notethink');
        expect(progressProjectName('/')).toBeUndefined();
    });
});

describe('parseProgressFile', () => {
    it('reads each valid entry with its fields', () => {
        const text = JSON.stringify({
            'story-a': { pct: 40, at: '2026-11-03T10:00:00Z', by: 'agent' },
            'story-b': { pct: 90.4, at: '2026-11-03T11:00:00Z', by: 'coordinator', note: 'nearly there' },
        });
        expect(parseProgressFile(text)).toEqual([
            { story_id: 'story-a', pct: 40, at: '2026-11-03T10:00:00Z', by: 'agent' },
            { story_id: 'story-b', pct: 90, at: '2026-11-03T11:00:00Z', by: 'coordinator', note: 'nearly there' },
        ]);
    });

    it.each([
        ['empty text', ''],
        ['malformed text', '{"story-a": '],
        ['an array', '[1, 2]'],
        ['null', 'null'],
        ['a number', '7'],
    ])('gives no entries for %s', (_label, text) => {
        expect(parseProgressFile(text)).toEqual([]);
    });

    it('skips a bad entry and keeps the others', () => {
        const text = JSON.stringify({
            'no-pct': { at: '2026-11-03T10:00:00Z', by: 'agent' },
            'over': { pct: 101, at: '2026-11-03T10:00:00Z' },
            'under': { pct: -1, at: '2026-11-03T10:00:00Z' },
            'string-pct': { pct: '50', at: '2026-11-03T10:00:00Z' },
            'bad-at': { pct: 50, at: 'yesterday' },
            'not-an-object': 5,
            'null-entry': null,
            'good': { pct: 0, at: '2026-11-03T10:00:00Z' },
        });
        expect(parseProgressFile(text)).toEqual([{ story_id: 'good', pct: 0, at: '2026-11-03T10:00:00Z', by: 'coordinator' }]);
    });

    it('bounds a long note and drops an empty one', () => {
        const text = JSON.stringify({
            long: { pct: 10, at: '2026-11-03T10:00:00Z', by: 'agent', note: 'x'.repeat(PROGRESS_NOTE_MAX_CHARS + 50) },
            empty: { pct: 10, at: '2026-11-03T10:00:00Z', by: 'agent', note: '' },
        });
        const [long, empty] = parseProgressFile(text);
        expect(long.note).toHaveLength(PROGRESS_NOTE_MAX_CHARS);
        expect(empty.note).toBeUndefined();
    });

    it('keeps the file size bound a sane size', () => {
        expect(PROGRESS_FILE_MAX_BYTES).toBeGreaterThan(1024);
    });
});

describe('progressForRepository', () => {
    it('stamps each entry with the repository root relative to the workspace', () => {
        const entries = parseProgressFile(JSON.stringify({ a: { pct: 5, at: '2026-11-03T10:00:00Z', by: 'agent' } }));
        expect(progressForRepository(entries, 'nt')).toEqual([{ root_relative: 'nt', story_id: 'a', pct: 5, at: '2026-11-03T10:00:00Z', by: 'agent' }]);
        expect(progressForRepository([], 'nt')).toEqual([]);
    });
});
