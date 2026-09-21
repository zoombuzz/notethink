import * as fs from 'node:fs';
import * as nodepath from 'node:path';
import * as vscode from 'vscode';
import { ActivityReader } from './ActivityReader';
import { writeToErrorLog } from '../lib/errorops';
import { ACTIVITY_ROOT_GLOB, ACTIVITY_SESSIONS_GLOB } from '../types/AgentActivity';
import type { ActivitySnapshot } from '../lib/activitystoreops';

// the reader's log lines are part of what it promises: a refused or failed read that nothing reports is the failure this contract exists to prevent, so they are assertable here
jest.mock('../lib/errorops', () => ({
	writeToLog: jest.fn(),
	writeToErrorLog: jest.fn(),
	writeToLogAtLevel: jest.fn(),
	debug: jest.fn(),
}));

/*
 * Drives the reader against the real `playwright/fixtures/activity` directory through a virtual
 * file system: the fixture text is what a producer writes, and the mocked stat and readFile are the
 * only two calls the reader makes of the host. The three failure fixtures matter as much as the
 * healthy ones, because a producer writes while the reader reads, so a truncated file is the normal
 * failure rather than an exceptional one.
 */
const FIXTURES_DIR = nodepath.join(__dirname, '..', '..', '..', '..', 'playwright', 'fixtures', 'activity');
const WORKSPACE_PATH = '/ws';
const ROOT_PATH = '/ws/notethink';
const CONTRACT_PATH = `${ROOT_PATH}/.notethink`;

function fixture(relative_path: string): string {
	return fs.readFileSync(nodepath.join(FIXTURES_DIR, relative_path), 'utf-8');
}

/** the contract directory as a producer would have written it, keyed by absolute path */
function contractFiles(): Map<string, string> {
	const files = new Map<string, string>();
	files.set(`${CONTRACT_PATH}/manifest.json`, fixture('manifest.json'));
	files.set(`${CONTRACT_PATH}/tree.json`, fixture('tree.json'));
	for (const name of fs.readdirSync(nodepath.join(FIXTURES_DIR, 'sessions'))) {
		files.set(`${CONTRACT_PATH}/sessions/${name}`, fixture(nodepath.join('sessions', name)));
	}
	// the three failure fixtures are deliberately undeclared in the manifest, so each test that wants one puts it where a declared session's file belongs
	files.delete(`${CONTRACT_PATH}/sessions/truncated.session.json`);
	files.delete(`${CONTRACT_PATH}/sessions/future-version.session.json`);
	files.delete(`${CONTRACT_PATH}/sessions/partial-append.events.jsonl`);
	return files;
}

interface MountedContract {
	files: Map<string, string>;
	sizes: Map<string, number>;
	readPaths: string[];
	listedPaths: string[];
	watchers: Map<string, (uri: vscode.Uri) => void>;
	deleters: Map<string, (uri: vscode.Uri) => void>;
}

/** mount a set of contract files as the workspace the reader sees, and record what it asks the host for */
function mountContract(files: Map<string, string>): MountedContract {
	const sizes = new Map<string, number>();
	for (const [file_path, text] of files) { sizes.set(file_path, Buffer.byteLength(text, 'utf-8')); }
	const mounted: MountedContract = { files, sizes, readPaths: [], listedPaths: [], watchers: new Map(), deleters: new Map() };
	(vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: vscode.Uri.file(WORKSPACE_PATH), name: 'ws', index: 0 }];
	// a directory listing derived from the file map, so the reader walks a tree rather than being handed the answer
	(vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
		mounted.listedPaths.push(uri.path);
		const prefix = `${uri.path}/`;
		const entries = new Map<string, number>();
		for (const file_path of mounted.files.keys()) {
			if (!file_path.startsWith(prefix)) { continue; }
			const rest = file_path.slice(prefix.length).split('/');
			entries.set(rest[0], rest.length > 1 ? 2 : 1);
		}
		if (entries.size === 0) { throw new Error(`no such directory ${uri.path}`); }
		return [...entries].map(([name, type]) => [name, type] as [string, number]);
	});
	(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
		const size = mounted.sizes.get(uri.path);
		if (size === undefined) { throw new Error(`no such file ${uri.path}`); }
		return { type: 1, ctime: 0, mtime: 0, size };
	});
	(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
		mounted.readPaths.push(uri.path);
		const text = mounted.files.get(uri.path);
		if (text === undefined) { throw new Error(`no such file ${uri.path}`); }
		return new TextEncoder().encode(text);
	});
	(vscode.workspace.createFileSystemWatcher as jest.Mock).mockImplementation((glob: string) => ({
		onDidCreate: jest.fn(),
		onDidChange: jest.fn((listener: (uri: vscode.Uri) => void) => { mounted.watchers.set(glob, listener); }),
		onDidDelete: jest.fn((listener: (uri: vscode.Uri) => void) => { mounted.deleters.set(glob, listener); }),
		dispose: jest.fn(),
	}));
	return mounted;
}

function snapshotsFrom(posted: Array<Record<string, unknown>>): ActivitySnapshot[] {
	return posted.filter(message => message.type === 'activity').map(message => message.activity as ActivitySnapshot);
}

describe('reading the contract a producer writes', () => {
	let posted: Array<Record<string, unknown>>;
	let reader: ActivityReader;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		posted = [];
	});

	afterEach(() => {
		reader?.dispose();
		jest.useRealTimers();
	});

	function startReader(): ActivityReader {
		reader = new ActivityReader(vscode.Uri.file(WORKSPACE_PATH), message => posted.push(message));
		return reader;
	}

	// the panel's own sequence: the reader starts its scan without the panel waiting for it, and says nothing until the webview asks for its initial state
	async function startAndListen(): Promise<ActivityReader> {
		await startReader().start();
		await reader.initialScanSettled();
		reader.resend();
		return reader;
	}

	it('posts every declared session, the working tree and the producer', async () => {
		mountContract(contractFiles());
		await startAndListen();
		const snapshots = snapshotsFrom(posted);
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0].sessions.map(state => state.session.session_id)).toEqual([
			'claude-bound-busy', 'claude-no-story', 'codex-no-question', 'grok-bound-idle', 'grok-question',
		]);
		expect(snapshots[0].producers[0].root_path).toBe(ROOT_PATH);
		expect(snapshots[0].producers[0].root_relative).toBe('notethink');
		expect(snapshots[0].producers[0].refusals).toEqual([]);
		expect(snapshots[0].trees[0].tree.head_commit).toHaveLength(40);
		const busy = snapshots[0].sessions.find(state => state.session.session_id === 'claude-bound-busy');
		expect(busy?.events).toHaveLength(4);
		expect(busy?.digest?.tool_calls.dropped).toBeGreaterThan(0);
	});

	it('posts nothing a second time when the producer only rewrites its heartbeat', async () => {
		const mounted = mountContract(contractFiles());
		await startAndListen();
		mounted.watchers.get(ACTIVITY_ROOT_GLOB)?.(vscode.Uri.file(`${CONTRACT_PATH}/manifest.json`));
		await jest.advanceTimersByTimeAsync(400);
		expect(snapshotsFrom(posted)).toHaveLength(1);
	});

	it('keeps the last good session when the next read lands mid-write, and says what it refused', async () => {
		const mounted = mountContract(contractFiles());
		await startAndListen();
		const session_path = `${CONTRACT_PATH}/sessions/grok-question.session.json`;
		const truncated = fixture(nodepath.join('sessions', 'truncated.session.json'));
		mounted.files.set(session_path, truncated);
		mounted.sizes.set(session_path, Buffer.byteLength(truncated, 'utf-8'));
		mounted.watchers.get(ACTIVITY_SESSIONS_GLOB)?.(vscode.Uri.file(session_path));
		await jest.advanceTimersByTimeAsync(400);
		const latest = snapshotsFrom(posted).at(-1)!;
		expect(latest.sessions.map(state => state.session.session_id)).toContain('grok-question');
		expect(latest.producers[0].refusals).toHaveLength(1);
		expect(latest.producers[0].refusals[0]).toEqual({
			file: 'sessions/grok-question.session.json',
			code: 'unreadable',
			reason: expect.stringContaining('read mid-write'),
			session_id: 'grok-question',
		});
		expect(latest.producers[0].unreadable_session_ids).toEqual([]);
	});

	it('refuses a contract major it cannot read, naming both versions', async () => {
		const files = contractFiles();
		files.set(`${CONTRACT_PATH}/sessions/grok-question.session.json`, fixture(nodepath.join('sessions', 'future-version.session.json')));
		mountContract(files);
		await startAndListen();
		const snapshot = snapshotsFrom(posted)[0];
		expect(snapshot.sessions.map(state => state.session.session_id)).not.toContain('grok-question');
		expect(snapshot.producers[0].unreadable_session_ids).toEqual(['grok-question']);
		expect(snapshot.producers[0].refusals[0].code).toBe('unsupported_version');
		expect(snapshot.producers[0].refusals[0].reason).toContain('2.0.0');
	});

	it('keeps the whole lines of a half-written event log and counts the one it dropped', async () => {
		const files = contractFiles();
		// the fixture is a real half-written append; its lines name their own session, so they are re-pointed at the declared session whose log they stand in for
		const partial = fixture(nodepath.join('sessions', 'partial-append.events.jsonl')).replaceAll('partial-append', 'claude-bound-busy');
		files.set(`${CONTRACT_PATH}/sessions/claude-bound-busy.events.jsonl`, partial);
		mountContract(files);
		await startAndListen();
		const snapshot = snapshotsFrom(posted)[0];
		const busy = snapshot.sessions.find(state => state.session.session_id === 'claude-bound-busy');
		expect(busy?.events).toHaveLength(2);
		expect(snapshot.producers[0].refusals[0].reason).toContain('dropped 1');
	});

	it('drops an event line that names another session, and says how many', async () => {
		const files = contractFiles();
		files.set(`${CONTRACT_PATH}/sessions/claude-bound-busy.events.jsonl`, fixture(nodepath.join('sessions', 'partial-append.events.jsonl')));
		mountContract(files);
		await startAndListen();
		const snapshot = snapshotsFrom(posted)[0];
		expect(snapshot.sessions.find(state => state.session.session_id === 'claude-bound-busy')?.events).toEqual([]);
		expect(snapshot.producers[0].refusals[0].reason).toContain('naming another session');
	});

	it('refuses a file over its bound before decoding it', async () => {
		const mounted = mountContract(contractFiles());
		const manifest_path = `${CONTRACT_PATH}/manifest.json`;
		mounted.sizes.set(manifest_path, 9 * 1024);
		await startAndListen();
		expect(mounted.readPaths).not.toContain(manifest_path);
		const snapshot = snapshotsFrom(posted)[0];
		// with no readable manifest nothing is declared, so no session is drawn and the reason is on the board
		expect(snapshot.sessions).toHaveLength(0);
		expect(snapshot.producers[0].live).toBe(false);
		expect(snapshot.producers[0].refusals[0]).toEqual({file: 'manifest.json', code: 'too_large', reason: expect.stringContaining('over the')});
	});

	it('drops a contract directory that has been removed', async () => {
		const mounted = mountContract(contractFiles());
		await startAndListen();
		for (const file_path of [...mounted.files.keys()]) {
			mounted.files.delete(file_path);
			mounted.sizes.delete(file_path);
			const glob = file_path.includes('/sessions/') ? ACTIVITY_SESSIONS_GLOB : ACTIVITY_ROOT_GLOB;
			mounted.deleters.get(glob)?.(vscode.Uri.file(file_path));
		}
		const latest = snapshotsFrom(posted).at(-1)!;
		expect(latest.producers).toHaveLength(0);
		expect(latest.sessions).toHaveLength(0);
	});

	it('finds the contract by walking, consulting no search setting of the user\'s', async () => {
		const mounted = mountContract(contractFiles());
		await startAndListen();
		// findFiles cannot be asked to ignore a user's files.exclude and stay cheap, and a dotted directory is exactly what such a setting hides, so discovery never goes near it
		expect(vscode.workspace.findFiles).not.toHaveBeenCalled();
		expect(mounted.listedPaths).toContain(WORKSPACE_PATH);
		expect(mounted.listedPaths).toContain(CONTRACT_PATH);
		expect(snapshotsFrom(posted)[0].sessions).toHaveLength(5);
	});

	it('never reads a contract directory shipped inside a dependency', async () => {
		const files = contractFiles();
		files.set(`${WORKSPACE_PATH}/notethink/node_modules/somepkg/.notethink/manifest.json`, fixture('manifest.json'));
		const mounted = mountContract(files);
		await startAndListen();
		// a `.notethink` inside node_modules is a file a package happened to publish, never a repository an agent is working in
		expect(mounted.listedPaths.some(listed => listed.includes('node_modules'))).toBe(false);
		expect(snapshotsFrom(posted)[0].producers.map(producer => producer.root_path)).toEqual([ROOT_PATH]);
	});

	it('stops walking at its depth bound, and leaves anything deeper to the watchers', async () => {
		const files = contractFiles();
		const deep_root = `${WORKSPACE_PATH}/a/b/c/d/deeprepo`;
		files.set(`${deep_root}/.notethink/manifest.json`, fixture('manifest.json'));
		mountContract(files);
		await startAndListen();
		const roots = snapshotsFrom(posted)[0].producers.map(producer => producer.root_path);
		expect(roots).toEqual([ROOT_PATH]);
		expect(roots).not.toContain(deep_root);
	});

	it('leaves the panel free while the first scan runs, and reports a walk that fails', async () => {
		mountContract(contractFiles());
		(vscode.workspace.fs.readDirectory as jest.Mock).mockRejectedValue(new Error('the file system provider is unavailable'));
		// start resolves without the scan having landed, which is what keeps a slow workspace out of the editor's resolve
		await startReader().start();
		await reader.initialScanSettled();
		reader.resend();
		const snapshot = snapshotsFrom(posted)[0];
		expect(snapshot.producers).toEqual([]);
		expect(writeToErrorLog).toHaveBeenCalledWith('walkForContractDirectories', expect.stringContaining('readDirectory failed'), expect.any(Error));
	});

	it('says nothing until the webview asks, since a post before its bundle loads is dropped', async () => {
		const mounted = mountContract(contractFiles());
		await startReader().start();
		await reader.initialScanSettled();
		// the scan has run and the store is populated: the silence is about posting, not about reading
		expect(mounted.readPaths.length).toBeGreaterThan(0);
		expect(posted).toEqual([]);
		reader.resend();
		expect(snapshotsFrom(posted)).toHaveLength(1);
		expect(snapshotsFrom(posted)[0].sessions).toHaveLength(5);
	});

	it('re-posts on request, for a webview that has just reloaded', async () => {
		mountContract(contractFiles());
		await startAndListen();
		reader.resend();
		expect(snapshotsFrom(posted)).toHaveLength(2);
		expect(snapshotsFrom(posted)[1]).toEqual(snapshotsFrom(posted)[0]);
	});

	it('publishes the working tree for the diff opener to gate on', async () => {
		mountContract(contractFiles());
		await startAndListen();
		expect(reader.treeFor(ROOT_PATH)?.uncommitted).toHaveLength(4);
		expect(reader.treeFor('/ws/somewhere-else')).toBeUndefined();
	});
});
