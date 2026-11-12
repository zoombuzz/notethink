import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CoordinatorCommands, type CoordinatorLookup } from './CoordinatorCommands';
import type { ActivityCoordinator } from '../types/AgentActivity';
import type { CoordinatorTextChange } from '../lib/coordinatorops';

const BOARD = '# Todo\n\n\n### Alpha [](?id=alpha&coord=host-a)\n\n\n### Beta [](?id=beta)\n';

function coordinator(overrides: Partial<ActivityCoordinator> = {}): ActivityCoordinator {
    return {
        agent: 'coord-demo', vendor: 'claude-code', state: 'idle', story: '', version: '1.0', machine: 'host-a', open_convoys: [], root_relative: 'demo',
        board_doc_path: 'demo/docstech/users/dev/todo.md',
        board_stories: [{ id: 'alpha', title: 'Alpha', status: '', convoys: [], operator_steps: [] }, { id: 'beta', title: 'Beta', status: '', convoys: [], operator_steps: [] }],
        marker_after: 1,
        ...overrides,
    };
}

/*
 * Every file the commands write goes into a temporary directory this test makes and removes: the
 * workspace file system the commands use is bridged onto it, so no real mailbox or registry is touched.
 */
describe('coordinator requests from a view', () => {
    let home_dir: string;
    let posted: Array<Record<string, unknown>>;
    let refreshed: number;
    let edits: Array<{ doc_path: string; changes: CoordinatorTextChange[] }>;
    let doc: { text: string; isDirty: boolean; saved: number };
    let commands: CoordinatorCommands;
    let known: ActivityCoordinator | undefined;

    function bridgeFileSystem(): void {
        const fsm = vscode.workspace.fs as unknown as Record<string, jest.Mock>;
        fsm.stat.mockImplementation(async (uri: vscode.Uri) => {
            const stat = fs.statSync(uri.path);
            return { type: stat.isDirectory() ? 2 : 1, ctime: 0, mtime: 0, size: stat.size };
        });
        fsm.createDirectory.mockImplementation(async (uri: vscode.Uri) => { fs.mkdirSync(uri.path, { recursive: true }); });
        fsm.writeFile.mockImplementation(async (uri: vscode.Uri, bytes: Uint8Array) => { fs.writeFileSync(uri.path, bytes); });
        fsm.rename.mockImplementation(async (from: vscode.Uri, to: vscode.Uri, options?: { overwrite?: boolean }) => {
            if (options?.overwrite === false && fs.existsSync(to.path)) { throw new Error('exists'); }
            fs.renameSync(from.path, to.path);
        });
    }

    function inboxFiles(agent: string): string[] {
        const dir = path.join(home_dir, 'mailboxes', agent, 'inbox');
        return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    }

    beforeEach(() => {
        jest.clearAllMocks();
        home_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-commands-'));
        fs.mkdirSync(path.join(home_dir, 'mailboxes', 'coord-demo'), { recursive: true });
        posted = [];
        refreshed = 0;
        edits = [];
        known = coordinator();
        doc = { text: BOARD, isDirty: false, saved: 0 };
        bridgeFileSystem();
        (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 }];
        (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(async () => ({
            getText: () => doc.text,
            get isDirty() { return doc.isDirty; },
            save: async () => { doc.saved++; doc.isDirty = false; return true; },
        }));
        const lookup: CoordinatorLookup = {
            coordinatorFor: agent => (known && agent === known.agent ? { coordinator: known, board_path: '/ws/demo/docstech/users/dev/todo.md' } : undefined),
            thinkersyncHomeUri: () => vscode.Uri.file(home_dir),
            refresh: () => { refreshed++; },
        };
        commands = new CoordinatorCommands(
            lookup,
            message => posted.push(message),
            async (doc_path, changes) => {
                edits.push({ doc_path, changes });
                for (const change of [...changes].sort((a, b) => b.from - a.from)) { doc.text = doc.text.slice(0, change.from) + change.insert + doc.text.slice(change.to); }
                doc.isDirty = true;
            },
            absolute_path => vscode.Uri.file(absolute_path),
        );
    });

    afterEach(() => {
        fs.rmSync(home_dir, { recursive: true, force: true });
    });

    describe('send to agent', () => {
        it('writes one version 0 envelope into the agent\'s inbox, whole and with no temporary file left', async () => {
            expect(await commands.handleMessage({ type: 'coordinatorSend', agent: 'coord-demo', body: ' please pick up beta ' })).toBe(true);
            const files = inboxFiles('coord-demo');
            expect(files).toHaveLength(1);
            expect(files[0]).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{6}\.json$/);
            const envelope = JSON.parse(fs.readFileSync(path.join(home_dir, 'mailboxes', 'coord-demo', 'inbox', files[0]), 'utf8'));
            expect(envelope).toMatchObject({ v: 0, sender_kind: 'operator', target: 'coord-demo@host-a', origin_machine: 'host-a', kind: 'request', state: 'submitted', body: 'please pick up beta', reply_to: '' });
            expect(`${envelope.id}.json`).toBe(files[0]);
            expect(posted).toEqual([{ type: 'coordinatorResult', request: 'send', agent: 'coord-demo', code: 'sent', ok: true }]);
        });

        it('writes nothing for an agent the last scan did not list', async () => {
            await commands.handleMessage({ type: 'coordinatorSend', agent: 'coord-other', body: 'hello' });
            expect(posted).toEqual([{ type: 'coordinatorResult', request: 'send', agent: 'coord-other', code: 'unknown_agent', ok: false }]);
            expect(fs.readdirSync(path.join(home_dir, 'mailboxes'))).toEqual(['coord-demo']);
        });

        it('writes nothing for an empty message', async () => {
            await commands.handleMessage({ type: 'coordinatorSend', agent: 'coord-demo', body: '   ' });
            expect(posted[0]).toMatchObject({ code: 'bad_message', ok: false });
            expect(inboxFiles('coord-demo')).toEqual([]);
        });

        it('never creates a mailbox the agent does not already have', async () => {
            fs.rmSync(path.join(home_dir, 'mailboxes', 'coord-demo'), { recursive: true });
            await commands.handleMessage({ type: 'coordinatorSend', agent: 'coord-demo', body: 'hello' });
            expect(posted[0]).toMatchObject({ code: 'no_mailbox', ok: false });
            expect(fs.existsSync(path.join(home_dir, 'mailboxes', 'coord-demo'))).toBe(false);
        });

        it('says so when this host has no thinkersync home to write under', async () => {
            const lookup: CoordinatorLookup = { coordinatorFor: () => ({ coordinator: coordinator() }), thinkersyncHomeUri: () => undefined, refresh: () => undefined };
            const bare = new CoordinatorCommands(lookup, message => posted.push(message), async () => undefined, absolute_path => vscode.Uri.file(absolute_path));
            await bare.handleMessage({ type: 'coordinatorSend', agent: 'coord-demo', body: 'hello' });
            expect(posted[0]).toMatchObject({ code: 'unavailable', ok: false });
        });

        it('reports a failed write rather than throwing', async () => {
            (vscode.workspace.fs.writeFile as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
            await commands.handleMessage({ type: 'coordinatorSend', agent: 'coord-demo', body: 'hello' });
            expect(posted[0]).toMatchObject({ code: 'write_failed', ok: false });
        });

        it('takes the agent from the message only as a name to look up, never as a path', async () => {
            await commands.handleMessage({ type: 'coordinatorSend', agent: '../../escape', body: 'hello' });
            expect(posted[0]).toMatchObject({ code: 'unknown_agent', ok: false });
        });
    });

    describe('move the target marker', () => {
        it('rewrites the board through the panel\'s edit path, saves it, and asks for a rescan', async () => {
            await commands.handleMessage({ type: 'coordinatorMoveMarker', agent: 'coord-demo', after: 2 });
            expect(edits).toHaveLength(1);
            expect(edits[0].doc_path).toBe('/ws/demo/docstech/users/dev/todo.md');
            expect(doc.text).toContain('### Alpha [](?id=alpha)');
            expect(doc.text).toContain('### Beta [](?id=beta&coord=host-a)');
            expect(doc.saved).toBe(1);
            expect(refreshed).toBe(1);
            expect(posted).toEqual([{ type: 'coordinatorResult', request: 'move', agent: 'coord-demo', code: 'moved', ok: true }]);
        });

        it('leaves a board that already held unsaved edits unsaved, and says so', async () => {
            doc.isDirty = true;
            await commands.handleMessage({ type: 'coordinatorMoveMarker', agent: 'coord-demo', after: 0 });
            expect(doc.saved).toBe(0);
            expect(posted[0]).toMatchObject({ code: 'moved_unsaved', ok: true });
            expect(doc.text).not.toContain('coord=');
        });

        it('edits nothing when the marker already sits there', async () => {
            await commands.handleMessage({ type: 'coordinatorMoveMarker', agent: 'coord-demo', after: 1 });
            expect(edits).toEqual([]);
            expect(posted[0]).toMatchObject({ code: 'moved', ok: true });
        });

        it('refuses an unknown agent, a position outside the board and a board it was not given', async () => {
            await commands.handleMessage({ type: 'coordinatorMoveMarker', agent: 'coord-other', after: 1 });
            await commands.handleMessage({ type: 'coordinatorMoveMarker', agent: 'coord-demo', after: 3 });
            await commands.handleMessage({ type: 'coordinatorMoveMarker', agent: 'coord-demo', after: 'x' });
            expect(posted.map(message => message.code)).toEqual(['unknown_agent', 'bad_position', 'bad_position']);
            expect(edits).toEqual([]);
            known = coordinator({ board_doc_path: undefined });
            const no_board: CoordinatorLookup = { coordinatorFor: () => ({ coordinator: coordinator() }), thinkersyncHomeUri: () => undefined, refresh: () => undefined };
            const bare = new CoordinatorCommands(no_board, message => posted.push(message), async () => undefined, absolute_path => vscode.Uri.file(absolute_path));
            await bare.handleMessage({ type: 'coordinatorMoveMarker', agent: 'coord-demo', after: 1 });
            expect(posted[3]).toMatchObject({ code: 'no_board', ok: false });
        });

        it('reports a failed edit when the board did not change', async () => {
            const lookup: CoordinatorLookup = { coordinatorFor: () => ({ coordinator: coordinator(), board_path: '/ws/demo/docstech/users/dev/todo.md' }), thinkersyncHomeUri: () => undefined, refresh: () => undefined };
            const stuck = new CoordinatorCommands(lookup, message => posted.push(message), async () => undefined, absolute_path => vscode.Uri.file(absolute_path));
            await stuck.handleMessage({ type: 'coordinatorMoveMarker', agent: 'coord-demo', after: 2 });
            expect(posted[0]).toMatchObject({ code: 'write_failed', ok: false });
        });
    });

    it('passes a message that is not a coordinator request back to the panel', async () => {
        expect(await commands.handleMessage({ type: 'editText' })).toBe(false);
        expect(posted).toEqual([]);
    });
});
