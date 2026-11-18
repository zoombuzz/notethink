import {
    COORDINATOR_LEDGER_MAX_BYTES,
    COORDINATOR_SESSION_IDS_MAX,
    coordinatorAgentName,
    coordinatorEntryFrom,
    coordinatorFileSegments,
    ledgerTail,
    parseAssignmentLedger,
    parseHomesFile,
    parseJsonLines,
    parseResumeFile,
    parseSessionLedger,
    parseWaitingFile,
} from './coordinatorfilesops';

function lines(...objects: unknown[]): string {
    return `${objects.map(object => JSON.stringify(object)).join('\n')}\n`;
}

const LAUNCH = { v: 1, ts: '2026-11-18T09:00:00Z', project: 'demo', session: 'sess-1', vendor: 'claude', role: 'coordinator', event: 'launch' };
const RECYCLE = { v: 1, ts: '2026-11-18T10:00:00Z', project: 'demo', session: 'sess-2', vendor: 'agy', role: 'coordinator', event: 'recycle' };
const STOP = { v: 1, ts: '2026-11-18T11:00:00Z', project: 'demo', session: 'sess-2', vendor: 'agy', role: 'coordinator', event: 'stop' };

describe('where a coordinator keeps its files', () => {
    it('names the agent after the project and places each file below the thinkersync home', () => {
        expect(coordinatorAgentName('demo')).toBe('coord-demo');
        expect(coordinatorFileSegments('demo')).toEqual({
            sessions: ['coordinator', 'demo', 'sessions.jsonl'],
            assignments: ['coordinator', 'demo', 'story-assignments.jsonl'],
            waiting: ['coordinator', 'demo', 'waiting.json'],
            homes: ['coordinator-homes.json'],
            resume: ['mailboxes', 'coord-demo', 'resume.json'],
        });
    });
});

describe('parseJsonLines', () => {
    it('keeps the object lines in file order and skips blank, torn and non-object lines', () => {
        const text = `${JSON.stringify({ a: 1 })}\n\n{"torn":\n[1,2]\n"text"\nnull\n${JSON.stringify({ b: 2 })}`;
        expect(parseJsonLines(text)).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('gives nothing for an empty text', () => {
        expect(parseJsonLines('')).toEqual([]);
    });
});

describe('ledgerTail', () => {
    it('leaves a ledger within its bound alone', () => {
        expect(ledgerTail('{"a":1}\n')).toBe('{"a":1}\n');
    });

    it('cuts a ledger over its bound to its newest whole lines', () => {
        const filler = `${JSON.stringify({ pad: 'x'.repeat(1000) })}\n`;
        const text = filler.repeat(Math.ceil(COORDINATOR_LEDGER_MAX_BYTES / filler.length) + 2) + '{"last":true}\n';
        const tail = ledgerTail(text);
        expect(tail.length).toBeLessThanOrEqual(COORDINATOR_LEDGER_MAX_BYTES);
        expect(tail.endsWith('{"last":true}\n')).toBe(true);
        expect(parseJsonLines(tail).every(line => 'pad' in line || 'last' in line)).toBe(true);
    });
});

describe('parseSessionLedger', () => {
    it('takes the vendor from the newest line naming one and the session ids newest first', () => {
        const summary = parseSessionLedger(lines(LAUNCH, RECYCLE));
        expect(summary).toEqual({ vendor: 'antigravity', session_ids: ['sess-2', 'sess-1'], stopped: false, updated_at: RECYCLE.ts });
    });

    it('reads a newest stop line as stopped, and a later launch as running again', () => {
        expect(parseSessionLedger(lines(LAUNCH, STOP))?.stopped).toBe(true);
        expect(parseSessionLedger(lines(LAUNCH, STOP, { ...LAUNCH, ts: '2026-11-18T12:00:00Z', session: 'sess-3' }))?.stopped).toBe(false);
    });

    it('lists a project with an unconfirmed launch but names no session for it', () => {
        expect(parseSessionLedger(lines({ ...LAUNCH, session: '' }))).toMatchObject({ vendor: 'claude-code', session_ids: [] });
    });

    it('counts a session once however many lines name it, and bounds how many it carries', () => {
        expect(parseSessionLedger(lines(LAUNCH, LAUNCH, { ...LAUNCH, event: 'observed' }))?.session_ids).toEqual(['sess-1']);
        const many = Array.from({ length: COORDINATOR_SESSION_IDS_MAX + 10 }, (_, index) => ({ ...LAUNCH, session: `s-${index}` }));
        expect(parseSessionLedger(lines(...many))?.session_ids).toHaveLength(COORDINATOR_SESSION_IDS_MAX);
    });

    it('ignores a line for another role, so a ledger with no coordinator line lists nothing', () => {
        expect(parseSessionLedger(lines({ ...LAUNCH, role: 'overseer' }))).toBeUndefined();
        expect(parseSessionLedger(lines({ ...LAUNCH, role: 'overseer' }, RECYCLE))?.session_ids).toEqual(['sess-2']);
    });

    it('keeps the lines it can read when others are torn, and carries an unknown vendor as its own', () => {
        const text = `{"torn":\n${lines({ ...LAUNCH, vendor: 'Codex', ts: 'not a date' })}nonsense\n`;
        expect(parseSessionLedger(text)).toMatchObject({ vendor: 'codex', session_ids: ['sess-1'], updated_at: undefined });
    });

    it.each(['', '\n', 'not json', '[]', '{}\n', '{"role":"coordinator"'])('gives nothing for %j', text => {
        expect(parseSessionLedger(text)).toBeUndefined();
    });

    it('leaves the vendor empty when no line names one', () => {
        expect(parseSessionLedger(lines({ ...LAUNCH, vendor: '' }))?.vendor).toBe('');
    });
});

describe('parseAssignmentLedger', () => {
    it('reads the last line\'s story as the one in flight', () => {
        const text = lines({ ts: '2026-11-18T09:00:00Z', story: 'alpha', event: 'dispatched' }, { ts: '2026-11-18T09:30:00Z', story: 'beta', event: 'dispatched' });
        expect(parseAssignmentLedger(text)).toEqual({ story: 'beta', updated_at: '2026-11-18T09:30:00Z' });
    });

    it('reads an empty story on the last line, as after a hand back, as none', () => {
        const text = lines({ ts: '2026-11-18T09:00:00Z', story: 'alpha', event: 'dispatched' }, { ts: '2026-11-18T10:00:00Z', story: '', event: 'handed-back' });
        expect(parseAssignmentLedger(text).story).toBe('');
    });

    it('reads a last line with no story or a story of the wrong type as none', () => {
        expect(parseAssignmentLedger(lines({ ts: '2026-11-18T09:00:00Z', event: 'observed' })).story).toBe('');
        expect(parseAssignmentLedger(lines({ story: 7 })).story).toBe('');
    });

    it('skips a torn last line and uses the line before it', () => {
        expect(parseAssignmentLedger(`${lines({ story: 'alpha' })}{"story":"be`).story).toBe('alpha');
    });

    it('gives no story for an empty or unreadable ledger', () => {
        expect(parseAssignmentLedger('')).toEqual({ story: '' });
        expect(parseAssignmentLedger('garbage')).toEqual({ story: '' });
    });
});

describe('parseWaitingFile', () => {
    it('is waiting while it lists a question', () => {
        expect(parseWaitingFile('{"at":"2026-11-18T09:00:00Z","questions":["which one?"],"page":"p"}')).toEqual({ waiting: true, at: '2026-11-18T09:00:00Z' });
    });

    it.each(['{"questions":[]}', '{"questions":"x"}', '{}', '', 'not json', '[]', 'null'])('is not waiting for %j', text => {
        expect(parseWaitingFile(text).waiting).toBe(false);
    });
});

describe('parseHomesFile', () => {
    it('gives the machine for the project, and none for a project the file does not name', () => {
        const text = '{"demo":"host-a","other":"host-b"}';
        expect(parseHomesFile(text, 'demo')).toBe('host-a');
        expect(parseHomesFile(text, 'missing')).toBe('');
    });

    it('never reads an inherited property as a project', () => {
        expect(parseHomesFile('{}', 'constructor')).toBe('');
        expect(parseHomesFile('{}', 'toString')).toBe('');
    });

    it.each(['', 'not json', '[]', 'null', '{"demo":7}', '{"demo":null}'])('gives none for %j', text => {
        expect(parseHomesFile(text, 'demo')).toBe('');
    });
});

describe('parseResumeFile', () => {
    it('reads the origin machine and the open convoys', () => {
        const text = JSON.stringify({ origin_machine: 'host-b', body: { open_convoys: ['repo-a', { repo: 'repo-b' }, '', 7, null] } });
        expect(parseResumeFile(text)).toEqual({ machine: 'host-b', open_convoys: ['repo-a', 'repo-b'] });
    });

    it('answers a note with no body, or a body of the wrong type, with no convoys', () => {
        expect(parseResumeFile('{"origin_machine":"host-b"}')).toEqual({ machine: 'host-b', open_convoys: [] });
        expect(parseResumeFile('{"origin_machine":"host-b","body":[1]}')).toEqual({ machine: 'host-b', open_convoys: [] });
        expect(parseResumeFile('{"body":{"open_convoys":"x"}}')).toEqual({ machine: '', open_convoys: [] });
    });

    it.each(['', 'not json', '[]', 'null', '7'])('gives nothing for %j', text => {
        expect(parseResumeFile(text)).toEqual({ machine: '', open_convoys: [] });
    });
});

describe('coordinatorEntryFrom', () => {
    const sessions = lines(LAUNCH, RECYCLE);
    const assignments = lines({ ts: '2026-11-18T12:00:00Z', story: 'alpha', event: 'dispatched' });
    const homes = '{"demo":"host-a"}';
    const resume = JSON.stringify({ origin_machine: 'host-b', body: { open_convoys: ['repo-a'] } });

    it('builds the entry a row and a session join are drawn from', () => {
        expect(coordinatorEntryFrom('demo', '/ws/demo', { sessions, assignments, homes, resume })).toEqual({
            agent: 'coord-demo', vendor: 'antigravity', repo: '/ws/demo', state: 'working', story: 'alpha', session_ids: ['sess-2', 'sess-1'],
            updated_at: '2026-11-18T12:00:00Z', agent_kind: 'coordinator', machine: 'host-a', open_convoys: ['repo-a'],
        });
    });

    it('is idle with no story in flight and working once one is', () => {
        expect(coordinatorEntryFrom('demo', '/ws/demo', { sessions })?.state).toBe('idle');
        expect(coordinatorEntryFrom('demo', '/ws/demo', { sessions, assignments: lines({ story: '' }) })?.state).toBe('idle');
        expect(coordinatorEntryFrom('demo', '/ws/demo', { sessions, assignments })?.state).toBe('working');
    });

    it('is waiting while questions are open, ahead of working', () => {
        const waiting = '{"at":"2026-11-18T13:00:00Z","questions":["q"]}';
        const entry = coordinatorEntryFrom('demo', '/ws/demo', { sessions, assignments, waiting });
        expect(entry).toMatchObject({ state: 'waiting', story: 'alpha', updated_at: '2026-11-18T13:00:00Z' });
    });

    it('is stopped from a newest stop line, ahead of waiting and working, and has no story', () => {
        const entry = coordinatorEntryFrom('demo', '/ws/demo', { sessions: lines(LAUNCH, STOP), assignments, waiting: '{"questions":["q"]}' });
        expect(entry).toMatchObject({ state: 'stopped', story: '' });
    });

    it('takes the machine from the homes file, else the resume note, else leaves it empty', () => {
        expect(coordinatorEntryFrom('demo', '/ws/demo', { sessions, homes, resume })?.machine).toBe('host-a');
        expect(coordinatorEntryFrom('demo', '/ws/demo', { sessions, homes: '{"other":"host-c"}', resume })?.machine).toBe('host-b');
        expect(coordinatorEntryFrom('demo', '/ws/demo', { sessions, homes: 'garbage', resume })?.machine).toBe('host-b');
        expect(coordinatorEntryFrom('demo', '/ws/demo', { sessions })?.machine).toBe('');
    });

    it('lists nothing for a project with no sessions ledger or no coordinator line in it', () => {
        expect(coordinatorEntryFrom('demo', '/ws/demo', { assignments, homes, resume })).toBeUndefined();
        expect(coordinatorEntryFrom('demo', '/ws/demo', { sessions: '', homes })).toBeUndefined();
        expect(coordinatorEntryFrom('demo', '/ws/demo', { sessions: 'garbage\n{"role":"overseer"}\n', homes })).toBeUndefined();
    });

    it('survives every other file being malformed', () => {
        const entry = coordinatorEntryFrom('demo', '/ws/demo', { sessions, assignments: '{', waiting: '[', homes: 'x', resume: 'y' });
        expect(entry).toMatchObject({ agent: 'coord-demo', state: 'idle', story: '', machine: '', open_convoys: [] });
    });
});
