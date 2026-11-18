import {
    PROGRESS_FILE_MAX_BYTES,
    PROGRESS_NOTE_MAX_CHARS,
    READY_STORIES_MAX,
    THINKERSYNC_HOME_SEGMENTS,
    parseProgressFile,
    parseReadyFile,
    parseReadyMarker,
    progressFileSegments,
    progressForRepository,
    progressProjectName,
    readyFileSegments,
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

describe('ready file', () => {
    it('sits beside the progress file', () => {
        expect(readyFileSegments('notethink')).toEqual(['coordinator', 'notethink', 'ready.json']);
    });

    it('names the stories of its stories array', () => {
        const text = JSON.stringify({ sha: 'abc', version: '1.0.0', stories: ['one', 'two'], closed_at: '2026-11-18T00:00:00Z', report: 'r' });
        expect(parseReadyFile(text)).toEqual(['one', 'two']);
    });

    it('treats a missing array, bad JSON, a non-object and bad entries as no ready stories', () => {
        expect(parseReadyFile('')).toEqual([]);
        expect(parseReadyFile('{not json')).toEqual([]);
        expect(parseReadyFile('[]')).toEqual([]);
        expect(parseReadyFile('null')).toEqual([]);
        expect(parseReadyFile('{"sha":"abc"}')).toEqual([]);
        expect(parseReadyFile('{"stories":"one"}')).toEqual([]);
        expect(parseReadyFile('{"stories":["ok",3,"",null,"also"]}')).toEqual(['ok', 'also']);
    });

    it('reads the marker commit beside its stories, lowercased, and leaves it empty when it is not a sha', () => {
        const full = '6C3D7F27BFB747F9C2C42E9539288A6C19242425';
        expect(parseReadyMarker(JSON.stringify({ sha: full, stories: ['one'] }))).toEqual({ sha: full.toLowerCase(), stories: ['one'] });
        expect(parseReadyMarker(JSON.stringify({ sha: '6c3d7f2', stories: ['one'] }))).toEqual({ sha: '6c3d7f2', stories: ['one'] });
        expect(parseReadyMarker(JSON.stringify({ sha: 'nope', stories: ['one'] }))).toEqual({ sha: '', stories: ['one'] });
        expect(parseReadyMarker(JSON.stringify({ stories: ['one'] }))).toEqual({ sha: '', stories: ['one'] });
    });

    it('has no marker when the file names no stories or is malformed', () => {
        expect(parseReadyMarker('{"sha":"6c3d7f2"}')).toBeUndefined();
        expect(parseReadyMarker('{not json')).toBeUndefined();
        expect(parseReadyMarker('')).toBeUndefined();
    });

    it('bounds how many stories one file contributes', () => {
        const many = Array.from({ length: READY_STORIES_MAX + 5 }, (_, i) => `s${i}`);
        expect(parseReadyFile(JSON.stringify({ stories: many }))).toHaveLength(READY_STORIES_MAX);
    });
});
