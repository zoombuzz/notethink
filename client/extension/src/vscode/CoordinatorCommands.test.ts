import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CoordinatorCommands, type CoordinatorLookup } from './CoordinatorCommands';
import type { ActivityCoordinator } from '../types/AgentActivity';

function coordinator(overrides: Partial<ActivityCoordinator> = {}): ActivityCoordinator {
    return {
        agent: 'coord-demo', vendor: 'claude-code', state: 'idle', story: '', machine: 'host-a', open_convoys: [], root_relative: 'demo',
        board_doc_path: 'demo/docstech/users/dev/todo.md',
        board_stories: [{ id: 'alpha', title: 'Alpha', status: '', convoys: [], operator_steps: [] }, { id: 'beta', title: 'Beta', status: '', convoys: [], operator_steps: [] }],
        ...overrides,
    };
}

/*
 * Every file the commands write goes into a temporary directory this test makes and removes: the
 * workspace file system the commands use is bridged onto it, so no real mailbox is touched.
 */
describe('coordinator requests from a view', () => {
    let home_dir: string;
    let posted: Array<Record<string, unknown>>;
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
        known = coordinator();
        bridgeFileSystem();
        (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 }];
        const lookup: CoordinatorLookup = {
            coordinatorFor: agent => (known && agent === known.agent ? { coordinator: known } : undefined),
            thinkersyncHomeUri: () => vscode.Uri.file(home_dir),
        };
        commands = new CoordinatorCommands(lookup, message => posted.push(message));
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
            const lookup: CoordinatorLookup = { coordinatorFor: () => ({ coordinator: coordinator() }), thinkersyncHomeUri: () => undefined };
            const bare = new CoordinatorCommands(lookup, message => posted.push(message));
            await bare.handleMessage({ type: 'coordinatorSend', agent: 'coord-demo', body: 'hello' });
            expect(posted[0]).toMatchObject({ code: 'unavailable', ok: false });
        });

        it('reports a failed write rather than throwing', async () => {
            (vscode.workspace.fs.writeFile as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
            await commands.handleMessage({ type: 'coordinatorSend', agent: 'coord-demo', body: 'hello' });
            expect(posted[0]).toMatchObject({ code: 'write_failed', ok: false });
        });

        it('writes a vendor-change envelope naming the vendor as thinkersync spells it, and answers as a vendor request', async () => {
            await commands.handleMessage({ type: 'coordinatorSend', agent: 'coord-demo', kind: 'vendor', vendor: 'agy' });
            const files = inboxFiles('coord-demo');
            expect(files).toHaveLength(1);
            const envelope = JSON.parse(fs.readFileSync(path.join(home_dir, 'mailboxes', 'coord-demo', 'inbox', files[0]), 'utf8'));
            expect(envelope).toMatchObject({ v: 0, kind: 'vendor', state: 'submitted', target: 'coord-demo@host-a', body: { vendor: 'agy' } });
            expect(posted).toEqual([{ type: 'coordinatorResult', request: 'vendor', agent: 'coord-demo', code: 'sent', ok: true }]);
        });

        it('writes nothing for a vendor outside the names a coordinator can change to', async () => {
            await commands.handleMessage({ type: 'coordinatorSend', agent: 'coord-demo', kind: 'vendor', vendor: 'gemini' });
            expect(posted).toEqual([{ type: 'coordinatorResult', request: 'vendor', agent: 'coord-demo', code: 'bad_vendor', ok: false }]);
            expect(inboxFiles('coord-demo')).toEqual([]);
        });

        it('takes the agent from the message only as a name to look up, never as a path', async () => {
            await commands.handleMessage({ type: 'coordinatorSend', agent: '../../escape', body: 'hello' });
            expect(posted[0]).toMatchObject({ code: 'unknown_agent', ok: false });
        });
    });

    it('passes a message that is not a coordinator request back to the panel', async () => {
        expect(await commands.handleMessage({ type: 'editText' })).toBe(false);
        expect(posted).toEqual([]);
    });
});
