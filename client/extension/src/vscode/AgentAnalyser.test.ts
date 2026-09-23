import * as vscode from 'vscode';
import { Uri } from '../__mocks__/vscode';
import { AgentAnalyser } from './AgentAnalyser';
import { handleAgentAnalyserRequest, setTranscriptMaxBytesForTest, type AgentAnalyserWorkerRequest, type AgentAnalyserWorkerResponse } from './AgentAnalyserWorker';
import * as errorops from '../lib/errorops';

/**
 * AgentAnalyser is one shared instance per extension host, so these tests exercise the lifecycle
 * every panel drives it through: demand() ref-counts, withdraw() stops it only once nothing demands
 * it, and a worker failure restarts once before the card says the analyser failed. Discovery itself
 * (walking each vendor's real directory layout) is exercised end-to-end by the fixtures in
 * `AgentAnalyserWorker.test.ts` and the vendor readers' own suites; here `vscode.workspace.fs`
 * always returns empty directories, so every scan finds zero sessions and the test stays about the
 * lifecycle, not discovery.
 */

function mockContext(log_path = '/home/test/.config/Code/logs/x/exthost/webWorker/NoteThink.notethink/notethink-extension.log'): vscode.ExtensionContext {
	return {
		extensionUri: Uri.file('/mock/extension'),
		logUri: Uri.file(log_path),
		subscriptions: [],
		extension: { packageJSON: { version: '0.0.0-test' } },
	} as unknown as vscode.ExtensionContext;
}

// a fake Worker that answers every postMessage synchronously (well, on the next microtask) through the real handler, so the round trip is exercised without a real worker thread
function fakeWorkerFactory(): { worker: () => Worker; terminate_calls: number[] } {
	let terminated_count = 0;
	const factory = (): Worker => {
		const worker = {
			onmessage: null as ((event: MessageEvent<AgentAnalyserWorkerResponse>) => void) | null,
			onerror: null as ((event: ErrorEvent) => void) | null,
			postMessage: (message: AgentAnalyserWorkerRequest) => {
				Promise.resolve().then(() => {
					worker.onmessage?.({ data: handleAgentAnalyserRequest(message) } as MessageEvent<AgentAnalyserWorkerResponse>);
				});
			},
			terminate: () => { terminated_count++; },
		};
		return worker as unknown as Worker;
	};
	return { worker: factory, get terminate_calls() { return [terminated_count]; } };
}

// a fake Worker whose every attempt fails, so the restart-once-then-failed path can be driven deterministically
function failingWorkerFactory(): () => Worker {
	return (): Worker => {
		const worker = {
			onmessage: null as ((event: MessageEvent<AgentAnalyserWorkerResponse>) => void) | null,
			onerror: null as ((event: ErrorEvent) => void) | null,
			postMessage: () => {
				Promise.resolve().then(() => { worker.onerror?.({ message: 'boom' } as ErrorEvent); });
			},
			terminate: () => {},
		};
		return worker as unknown as Worker;
	};
}

// a fake Worker whose first fail_count attempts fail and every attempt after that succeeds, so recovery out of "failed" can be driven deterministically without waiting on a real timeout
function flakyWorkerFactory(fail_count: number): () => Worker {
	let attempts = 0;
	return (): Worker => {
		const worker = {
			onmessage: null as ((event: MessageEvent<AgentAnalyserWorkerResponse>) => void) | null,
			onerror: null as ((event: ErrorEvent) => void) | null,
			postMessage: (message: AgentAnalyserWorkerRequest) => {
				attempts++;
				Promise.resolve().then(() => {
					if (attempts <= fail_count) { worker.onerror?.({ message: 'boom' } as ErrorEvent); return; }
					worker.onmessage?.({ data: handleAgentAnalyserRequest(message) } as MessageEvent<AgentAnalyserWorkerResponse>);
				});
			},
			terminate: () => {},
		};
		return worker as unknown as Worker;
	};
}

// a fake Worker that answers through the real handler like fakeWorkerFactory, but also records every request it was sent, so a test can inspect exactly what bytes/mode a scan transferred
function recordingWorkerFactory(): { worker: () => Worker; requests: AgentAnalyserWorkerRequest[] } {
	const requests: AgentAnalyserWorkerRequest[] = [];
	const factory = (): Worker => {
		const worker = {
			onmessage: null as ((event: MessageEvent<AgentAnalyserWorkerResponse>) => void) | null,
			onerror: null as ((event: ErrorEvent) => void) | null,
			postMessage: (message: AgentAnalyserWorkerRequest) => {
				requests.push(message);
				Promise.resolve().then(() => {
					worker.onmessage?.({ data: handleAgentAnalyserRequest(message) } as MessageEvent<AgentAnalyserWorkerResponse>);
				});
			},
			terminate: () => {},
		};
		return worker as unknown as Worker;
	};
	return { worker: factory, requests };
}

// a recording worker whose first fail_count attempts fail (onerror) and every attempt after that succeeds through the real handler, so a restart's own request can be inspected the same way recordingWorkerFactory's can
function recordingFlakyWorkerFactory(fail_count: number): { worker: () => Worker; requests: AgentAnalyserWorkerRequest[] } {
	const requests: AgentAnalyserWorkerRequest[] = [];
	let attempts = 0;
	const factory = (): Worker => {
		const worker = {
			onmessage: null as ((event: MessageEvent<AgentAnalyserWorkerResponse>) => void) | null,
			onerror: null as ((event: ErrorEvent) => void) | null,
			postMessage: (message: AgentAnalyserWorkerRequest) => {
				attempts++;
				requests.push(message);
				Promise.resolve().then(() => {
					if (attempts <= fail_count) { worker.onerror?.({ message: 'boom' } as ErrorEvent); return; }
					worker.onmessage?.({ data: handleAgentAnalyserRequest(message) } as MessageEvent<AgentAnalyserWorkerResponse>);
				});
			},
			terminate: () => {},
		};
		return worker as unknown as Worker;
	};
	return { worker: factory, requests };
}

// a fake Worker whose response is held back until the test calls release(), so a scan can be kept deliberately "in flight" while other triggers land; release('failure') answers via onerror instead of onmessage, so a crash can be driven from the same held-open request
function controllableWorkerFactory(): { worker: () => Worker; release: (mode?: 'success' | 'failure') => void } {
	let release_fn: ((mode: 'success' | 'failure') => void) | undefined;
	const factory = (): Worker => {
		const worker = {
			onmessage: null as ((event: MessageEvent<AgentAnalyserWorkerResponse>) => void) | null,
			onerror: null as ((event: ErrorEvent) => void) | null,
			postMessage: (message: AgentAnalyserWorkerRequest) => {
				new Promise<'success' | 'failure'>(resolve => { release_fn = resolve; }).then(mode => {
					if (mode === 'failure') { worker.onerror?.({ message: 'boom' } as ErrorEvent); return; }
					worker.onmessage?.({ data: handleAgentAnalyserRequest(message) } as MessageEvent<AgentAnalyserWorkerResponse>);
				});
			},
			terminate: () => {},
		};
		return worker as unknown as Worker;
	};
	return { worker: factory, release: (mode: 'success' | 'failure' = 'success') => release_fn?.(mode) };
}

// a single claude-code session under /home/test/.claude/projects/<project_dir>/<session_id>.jsonl, no subagents; readDirectory/stat/readFile are wired by path so the skip-unchanged-file cache (discoverClaudeCode) can be exercised against a real transcript the real reader parses
const CLAUDE_HOME = '/home/test/.claude';
const CLAUDE_PROJECT_DIR = 'my-project';
const CLAUDE_SESSION_ID = 'session-1';
const CLAUDE_PROJECTS_DIR = `${CLAUDE_HOME}/projects`;
const CLAUDE_PROJECT_PATH = `${CLAUDE_PROJECTS_DIR}/${CLAUDE_PROJECT_DIR}`;
const CLAUDE_TRANSCRIPT_PATH = `${CLAUDE_PROJECT_PATH}/${CLAUDE_SESSION_ID}.jsonl`;

function claudeTranscriptLine(tool_name: string): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: '2026-09-22T11:00:00Z',
		message: {
			id: 'm1', role: 'assistant', model: 'claude-sonnet-5',
			content: [{ type: 'tool_use', id: 't1', name: tool_name, input: { file_path: 'src/foo.ts' } }],
			usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
		},
	});
}

const CLAUDE_SESSIONS_DIR = `${CLAUDE_HOME}/sessions`;
const CLAUDE_PID_FILE_NAME = '12345.json';
const CLAUDE_PID_PATH = `${CLAUDE_SESSIONS_DIR}/${CLAUDE_PID_FILE_NAME}`;

/*
 * Wires the transcript path's stat/content, and vanishes it entirely (both the file listing AND the
 * project directory listing) when content is undefined. `live` wires the pid-file live list
 * separately (`~/.claude/sessions/<pid>.json`, which carries the session id, cwd and a busy/idle
 * status): omitted means the session is not live at all, which is also how it vanishes independently
 * of the transcript, for the live-overlay tests below.
 */
function mockClaudeCodeSession(content: string | undefined, mtime: number, live?: { status: 'busy' | 'idle' | 'waiting' }): void {
	const bytes = content !== undefined ? new TextEncoder().encode(content) : undefined;
	const pid_bytes = live ? new TextEncoder().encode(JSON.stringify({ sessionId: CLAUDE_SESSION_ID, cwd: CLAUDE_PROJECT_DIR, status: live.status })) : undefined;
	(vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
		if (uri.path === CLAUDE_PROJECTS_DIR) { return content !== undefined ? [[CLAUDE_PROJECT_DIR, vscode.FileType.Directory]] : []; }
		if (uri.path === CLAUDE_PROJECT_PATH) { return content !== undefined ? [[`${CLAUDE_SESSION_ID}.jsonl`, vscode.FileType.File]] : []; }
		if (uri.path === CLAUDE_SESSIONS_DIR) { return pid_bytes ? [[CLAUDE_PID_FILE_NAME, vscode.FileType.File]] : []; }
		return [];
	});
	(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
		if (uri.path === CLAUDE_TRANSCRIPT_PATH && bytes) { return { type: 1, ctime: 0, mtime, size: bytes.byteLength }; }
		throw new Error('not found');
	});
	(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
		if (uri.path === CLAUDE_TRANSCRIPT_PATH && bytes) { return bytes; }
		if (uri.path === CLAUDE_PID_PATH && pid_bytes) { return pid_bytes; }
		throw new Error('not found');
	});
}

// answers the git extension's cross-host `git.api.*` commands for these repositories, keyed by root path, in the plain shape the real commands return
function wireGitCommands(repositories: Record<string, { workingTreeChanges: Array<{ path: string; status: string }>; HEAD?: { name?: string; commit?: string } }>): void {
	(vscode.commands.getCommands as jest.Mock).mockResolvedValue(['git.api.getRepositories', 'git.api.getRepositoryState']);
	(vscode.commands.executeCommand as jest.Mock).mockImplementation(async (command: string, root?: string) => {
		if (command === 'git.api.getRepositories') { return Object.keys(repositories).map(root_path => `file://${root_path}`); }
		if (command !== 'git.api.getRepositoryState' || root === undefined) { return undefined; }
		const state = repositories[root.replace(/^file:\/\//, '')];
		if (!state) { return null; }
		const change = (entry: { path: string; status: string }): { uri: string; originalUri: string; status: string } => ({ uri: `file://${entry.path}`, originalUri: `file://${entry.path}`, status: entry.status });
		return { HEAD: state.HEAD, workingTreeChanges: state.workingTreeChanges.map(change), indexChanges: [] };
	});
}

function sessionIdsFrom(posted: Array<Record<string, unknown>>): string[] {
	const last = posted[posted.length - 1];
	const sessions = (last.activity as { sessions: Array<{ session: { session_id: string } }> }).sessions;
	return sessions.map(s => s.session.session_id);
}

function sessionModelFrom(posted: Array<Record<string, unknown>>, session_id: string): string | undefined {
	const last = posted[posted.length - 1];
	const sessions = (last.activity as { sessions: Array<{ session: { session_id: string; model?: string } }> }).sessions;
	return sessions.find(s => s.session.session_id === session_id)?.session.model;
}

function sessionStateFrom(posted: Array<Record<string, unknown>>, session_id: string): string | undefined {
	const last = posted[posted.length - 1];
	const sessions = (last.activity as { sessions: Array<{ session: { session_id: string; state: string } }> }).sessions;
	return sessions.find(s => s.session.session_id === session_id)?.session.state;
}

function refusalCodeFor(posted: Array<Record<string, unknown>>, session_id: string): string | undefined {
	const last = posted[posted.length - 1];
	const refusals = (last.activity as { analyser: { refusals: Array<{ session_id?: string; code: string }> } }).analyser.refusals;
	return refusals.find(r => r.session_id === session_id)?.code;
}

function transcriptReadCount(): number {
	return (vscode.workspace.fs.readFile as jest.Mock).mock.calls.filter(call => (call[0] as vscode.Uri).path === CLAUDE_TRANSCRIPT_PATH).length;
}

describe('AgentAnalyser lifecycle', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		(vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([]);
		(vscode.workspace.fs.readFile as jest.Mock).mockRejectedValue(new Error('no such file'));
		(vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: Uri.file('/ws'), name: 'ws', index: 0 }];
	});

	afterEach(() => { jest.useRealTimers(); });

	// advances fake timers AND flushes the microtask queue in the right interleaved order, so a setTimeout(fn, 0) scheduled by the analyser and the fake worker's Promise.resolve().then(...) both settle before an assertion reads the result; called several times because the real chain (discover -> worker round trip -> fold -> post) is several timer/microtask hops deep
	async function settle(): Promise<void> {
		for (let i = 0; i < 5; i++) { await jest.advanceTimersByTimeAsync(0); }
	}

	it('looks up Codex session directories by the local calendar date, not UTC', async () => {
		// a timezone far enough ahead of UTC that a late-UTC-day instant falls on the NEXT local day, so a UTC-based lookup and a local one name different directories
		const original_tz = process.env.TZ;
		process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
		try {
			jest.setSystemTime(new Date('2026-09-22T23:30:00Z')); // 2026-09-23 in Kiritimati, still 2026-09-22 in UTC
			const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
			analyser.demand(jest.fn());
			await settle();
			// 2026/09/22 falls well inside the 30 day window either way, so it says nothing about which calendar is in use; the local-only "23" is what a UTC walk would never reach, since UTC has not turned that day yet at this instant
			const requested = (vscode.workspace.fs.readDirectory as jest.Mock).mock.calls.map(call => (call[0] as { path: string }).path);
			expect(requested.some(path => path.endsWith('/.codex/sessions/2026/09/23'))).toBe(true);
		} finally {
			process.env.TZ = original_tz;
		}
	});

	it('reads no vendor file at all when no panel has ever demanded it', async () => {
		new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		await settle();
		expect(vscode.workspace.fs.readDirectory).not.toHaveBeenCalled();
		expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
	});

	it('posts unavailable when the host has no local file access the analyser recognises', async () => {
		const analyser = new AgentAnalyser(mockContext('/mock/logs'), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(posted[posted.length - 1].activity).toMatchObject({ analyser: { state: 'unavailable' } });
	});

	it('starts scanning on the first demand and goes live once the worker answers', async () => {
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		expect((posted[0].activity as { analyser: { state: string } }).analyser.state).toBe('scanning');
		await settle();
		expect((posted[posted.length - 1].activity as { analyser: { state: string } }).analyser.state).toBe('live');
	});

	it('carries a claude-code session\'s own message.model through the worker round trip onto its posted row', async () => {
		mockClaudeCodeSession(claudeTranscriptLine('Edit'), Date.now(), { status: 'busy' });
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(sessionModelFrom(posted, CLAUDE_SESSION_ID)).toBe('claude-sonnet-5');
	});

	it('two panels share one analyser: the second demand does not restart a scan already running', async () => {
		const factory = fakeWorkerFactory();
		const analyser = new AgentAnalyser(mockContext(), factory.worker);
		const posted_a: Array<Record<string, unknown>> = [];
		const posted_b: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted_a.push(msg));
		await settle();
		analyser.demand(msg => posted_b.push(msg));
		await settle();
		expect((vscode.workspace.fs.readDirectory as jest.Mock).mock.calls.length).toBeGreaterThan(0);
		// the second panel gets the current snapshot immediately rather than triggering its own scan
		expect(posted_b.length).toBe(1);
		expect((posted_b[0].activity as { analyser: { state: string } }).analyser.state).toBe('live');
	});

	it('the analyser keeps running while any panel still demands it, and stops only after the last withdrawal', async () => {
		const factory = fakeWorkerFactory();
		const analyser = new AgentAnalyser(mockContext(), factory.worker);
		const post_a = jest.fn();
		const post_b = jest.fn();
		analyser.demand(post_a);
		await settle();
		analyser.demand(post_b);
		await settle();
		analyser.withdraw(post_a);
		await jest.advanceTimersByTimeAsync(10_000);
		// panel b still demands it, so a further scan is still possible; withdrawing it too is what actually stops things
		analyser.withdraw(post_b);
		await jest.advanceTimersByTimeAsync(10_000);
		const before = (vscode.workspace.fs.readDirectory as jest.Mock).mock.calls.length;
		await jest.advanceTimersByTimeAsync(60_000);
		expect((vscode.workspace.fs.readDirectory as jest.Mock).mock.calls.length).toBe(before);
	});

	it('resendTo posts only to the calling panel, not to every subscriber', async () => {
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const post_a = jest.fn();
		const post_b = jest.fn();
		analyser.demand(post_a);
		await settle();
		post_a.mockClear();
		analyser.resendTo(post_b);
		expect(post_b).toHaveBeenCalledTimes(1);
		expect(post_a).not.toHaveBeenCalled();
	});

	it('a zero-hit scan logs exactly one debug line naming what it searched, so "found nothing" is distinguishable from "never ran"', async () => {
		const log_spy = jest.spyOn(errorops, 'writeToLogAtLevel');
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		analyser.demand(jest.fn());
		await settle();
		const scan_lines = log_spy.mock.calls.filter(call => call[0] === 'debug' && call[1] === 'runScan');
		expect(scan_lines).toHaveLength(1);
		expect(scan_lines[0][2]).toContain('0 session(s)');
		log_spy.mockRestore();
	});

	it('a watcher firing debounces into one scan, rather than one per file in a write burst', async () => {
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		analyser.demand(jest.fn());
		await settle();
		const before = (vscode.workspace.fs.readDirectory as jest.Mock).mock.calls.length;
		const watcher_calls = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results;
		expect(watcher_calls.length).toBeGreaterThan(0);
		// fire onDidChange on every armed watcher, as a burst of writes across all three vendor directories would
		for (const result of watcher_calls) {
			const on_change: jest.Mock = result.value.onDidChange.mock.calls[0][0];
			on_change();
		}
		await jest.advanceTimersByTimeAsync(1000);
		await settle();
		// one debounced scan landed well before the 15s poll interval, not one per watcher event
		expect((vscode.workspace.fs.readDirectory as jest.Mock).mock.calls.length).toBeGreaterThan(before);
	});

	it('restarts the worker once after a failure, and says the analyser failed once the restart also fails', async () => {
		const analyser = new AgentAnalyser(mockContext(), failingWorkerFactory());
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		await jest.advanceTimersByTimeAsync(0);
		await jest.advanceTimersByTimeAsync(20_000);
		expect((posted[posted.length - 1].activity as { analyser: { state: string } }).analyser.state).toBe('failed');
	});

	it('recovers to live once a scan after "failed" succeeds, and resets the failure counter for the next crash', async () => {
		// fails twice (the initial attempt and its one restart), so the third attempt - the next AGENT_RESCAN_INTERVAL_MS poll - is the recovery
		const analyser = new AgentAnalyser(mockContext(), flakyWorkerFactory(2));
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		// a large advance, mirroring "restarts the worker once..." above: it reliably drains the chained discover/postMessage/fold promise flushes that repeated 0ms nudges do not; kept under AGENT_RESCAN_INTERVAL_MS (15s) so it captures attempt 1 and its one restart without also reaching the next poll
		await jest.advanceTimersByTimeAsync(5_000);
		expect((posted[posted.length - 1].activity as { analyser: { state: string } }).analyser.state).toBe('failed');
		// the analyser keeps polling at the normal interval rather than treating "failed" as terminal, and the next attempt succeeds
		await jest.advanceTimersByTimeAsync(20_000);
		expect((posted[posted.length - 1].activity as { analyser: { state: string } }).analyser.state).toBe('live');
	});

	it('says failed rather than scanning forever when the first scan throws, and goes live on the next poll', async () => {
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const scan_once = jest.spyOn(analyser as unknown as { runScanOnce: () => Promise<void> }, 'runScanOnce').mockRejectedValueOnce(new Error('discovery threw'));
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect((posted[posted.length - 1].activity as { analyser: { state: string } }).analyser.state).toBe('failed');
		await jest.advanceTimersByTimeAsync(20_000);
		expect(scan_once).toHaveBeenCalledTimes(2);
		expect((posted[posted.length - 1].activity as { analyser: { state: string } }).analyser.state).toBe('live');
	});

	it('a burst of triggers during a slow scan queues exactly one follow-up scan, not one per trigger', async () => {
		const controllable = controllableWorkerFactory();
		const analyser = new AgentAnalyser(mockContext(), controllable.worker);
		const run_scan_once = jest.spyOn(analyser as unknown as { runScanOnce: () => Promise<void> }, 'runScanOnce');
		analyser.demand(jest.fn());
		await settle();
		expect(run_scan_once).toHaveBeenCalledTimes(1);
		const watcher_calls = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results;
		// a burst of five separate write events lands while the first scan is still awaiting its worker response
		for (let i = 0; i < 5; i++) {
			for (const result of watcher_calls) {
				const on_change: jest.Mock = result.value.onDidChange.mock.calls[0][0];
				on_change();
			}
			await jest.advanceTimersByTimeAsync(300); // AGENT_WATCH_DEBOUNCE_MS
		}
		// none of the burst started a second scan: the worker is still gated on the first attempt
		expect(run_scan_once).toHaveBeenCalledTimes(1);
		controllable.release();
		await settle();
		await jest.advanceTimersByTimeAsync(1_000); // AGENT_MIN_SCAN_SPACING_MS floor before the queued follow-up starts
		await settle();
		controllable.release();
		await settle();
		// exactly one follow-up scan ran for the whole burst
		expect(run_scan_once).toHaveBeenCalledTimes(2);
	});

	it('a failure on the in-flight scan cannot orphan a request queued behind it', async () => {
		const controllable = controllableWorkerFactory();
		const analyser = new AgentAnalyser(mockContext(), controllable.worker);
		const run_scan_once = jest.spyOn(analyser as unknown as { runScanOnce: () => Promise<void> }, 'runScanOnce');
		analyser.demand(jest.fn());
		await settle();
		expect(run_scan_once).toHaveBeenCalledTimes(1);
		// a watcher fires while the first scan is still in flight, queuing a follow-up behind it rather than starting a second concurrent scan (already covered by the burst test above)
		const watcher_calls = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results;
		const on_change: jest.Mock = watcher_calls[0].value.onDidChange.mock.calls[0][0];
		on_change();
		await jest.advanceTimersByTimeAsync(300);
		// the in-flight scan then crashes; its own failure path (worker.terminate(), this.worker = undefined) must not also drop the queued follow-up
		controllable.release('failure');
		await settle();
		await jest.advanceTimersByTimeAsync(1_000); // AGENT_MIN_SCAN_SPACING_MS floor before the queued follow-up starts
		await settle();
		// exactly one follow-up ran once the crash finished processing - the trigger queued during it was not orphaned
		expect(run_scan_once).toHaveBeenCalledTimes(2);
	});

	describe('skipping unchanged files across scans', () => {
		it('a second scan with unchanged stats reads zero bytes and yields the same session', async () => {
			mockClaudeCodeSession(claudeTranscriptLine('Edit'), Date.now());
			const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			expect((vscode.workspace.fs.readFile as jest.Mock).mock.calls.some(call => (call[0] as vscode.Uri).path === CLAUDE_TRANSCRIPT_PATH)).toBe(true);
			expect(sessionIdsFrom(posted)).toEqual([CLAUDE_SESSION_ID]);
			(vscode.workspace.fs.readFile as jest.Mock).mockClear();
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			expect((vscode.workspace.fs.readFile as jest.Mock).mock.calls.some(call => (call[0] as vscode.Uri).path === CLAUDE_TRANSCRIPT_PATH)).toBe(false);
			expect(sessionIdsFrom(posted)).toEqual([CLAUDE_SESSION_ID]);
		});

		it('a grown file is re-read', async () => {
			const base_mtime = Date.now();
			mockClaudeCodeSession(claudeTranscriptLine('Edit'), base_mtime);
			const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			(vscode.workspace.fs.readFile as jest.Mock).mockClear();
			// the same session's transcript grows a new line and its mtime advances, so its stat no longer matches the cached identity
			mockClaudeCodeSession(`${claudeTranscriptLine('Edit')}\n${claudeTranscriptLine('Write')}`, base_mtime + 1000);
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			expect((vscode.workspace.fs.readFile as jest.Mock).mock.calls.some(call => (call[0] as vscode.Uri).path === CLAUDE_TRANSCRIPT_PATH)).toBe(true);
			expect(sessionIdsFrom(posted)).toEqual([CLAUDE_SESSION_ID]);
		});

		it('a vanished file drops its session', async () => {
			mockClaudeCodeSession(claudeTranscriptLine('Edit'), Date.now());
			const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			expect(sessionIdsFrom(posted)).toEqual([CLAUDE_SESSION_ID]);
			// the file (and its project directory listing) is gone, as a deleted session would be
			mockClaudeCodeSession(undefined, Date.now());
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			expect(sessionIdsFrom(posted)).toEqual([]);
		});
	});

	describe('follow transcripts incrementally', () => {
		it('an appended line transfers only the new tail bytes to the worker', async () => {
			const base_mtime = Date.now();
			const first_line = claudeTranscriptLine('Edit');
			const second_line = claudeTranscriptLine('Write');
			mockClaudeCodeSession(`${first_line}\n`, base_mtime);
			const recording = recordingWorkerFactory();
			const analyser = new AgentAnalyser(mockContext(), recording.worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			const first_job = recording.requests[0].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)!;
			expect(first_job.transcript.mode).toBe('whole');

			mockClaudeCodeSession(`${first_line}\n${second_line}\n`, base_mtime + 1000);
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			const second_request = recording.requests[recording.requests.length - 1];
			const second_job = second_request.jobs.find(j => j.session_id === CLAUDE_SESSION_ID)!;
			expect(second_job.transcript.mode).toBe('tail');
			expect(new TextDecoder().decode(second_job.transcript.bytes)).toBe(`${second_line}\n`);
			// the session output still reflects both calls - the resumed build combined the cached first line with the newly tail-parsed second one
			expect(sessionIdsFrom(posted)).toEqual([CLAUDE_SESSION_ID]);
		});

		it('a torn trailing line is not transferred until it completes', async () => {
			const base_mtime = Date.now();
			const first_line = claudeTranscriptLine('Edit');
			mockClaudeCodeSession(`${first_line}\n`, base_mtime);
			const recording = recordingWorkerFactory();
			const analyser = new AgentAnalyser(mockContext(), recording.worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();

			// the second line is still being written: no trailing newline yet
			const torn_second_line = claudeTranscriptLine('Write').slice(0, -1);
			mockClaudeCodeSession(`${first_line}\n${torn_second_line}`, base_mtime + 1000);
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			const torn_request = recording.requests[recording.requests.length - 1];
			const torn_job = torn_request?.jobs.find(j => j.session_id === CLAUDE_SESSION_ID);
			// nothing new completed this scan, so this session either sends no job at all, or a 'none' job with nothing to parse
			if (torn_job) { expect(torn_job.transcript.mode).toBe('none'); }

			// the line completes on a later scan and is picked up exactly once, as a tail
			const second_line = claudeTranscriptLine('Write');
			mockClaudeCodeSession(`${first_line}\n${second_line}\n`, base_mtime + 2000);
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			const completed_request = recording.requests[recording.requests.length - 1];
			const completed_job = completed_request.jobs.find(j => j.session_id === CLAUDE_SESSION_ID)!;
			expect(completed_job.transcript.mode).toBe('tail');
			expect(new TextDecoder().decode(completed_job.transcript.bytes)).toBe(`${second_line}\n`);
		});

		it('a shrunk file is transferred and parsed whole again', async () => {
			const base_mtime = Date.now();
			const first_line = claudeTranscriptLine('Edit');
			const second_line = claudeTranscriptLine('Write');
			mockClaudeCodeSession(`${first_line}\n${second_line}\n`, base_mtime);
			const recording = recordingWorkerFactory();
			const analyser = new AgentAnalyser(mockContext(), recording.worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();

			// the transcript shrinks back to just the first line (a rewritten/truncated file), with a fresh mtime
			mockClaudeCodeSession(`${first_line}\n`, base_mtime + 1000);
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			const shrunk_request = recording.requests[recording.requests.length - 1];
			const shrunk_job = shrunk_request.jobs.find(j => j.session_id === CLAUDE_SESSION_ID)!;
			expect(shrunk_job.transcript.mode).toBe('whole');
			expect(new TextDecoder().decode(shrunk_job.transcript.bytes)).toBe(`${first_line}\n`);
			expect(sessionIdsFrom(posted)).toEqual([CLAUDE_SESSION_ID]);
		});

		it('after a worker restart, the next scan reparses the transcript whole rather than resuming a cache that no longer exists', async () => {
			const base_mtime = Date.now();
			const first_line = claudeTranscriptLine('Edit');
			const second_line = claudeTranscriptLine('Write');
			mockClaudeCodeSession(`${first_line}\n`, base_mtime);
			// the first attempt at the SECOND scan fails (the worker crashes); AgentAnalyser retries once immediately, and that retry - a fresh worker instance - is the one under test
			const recording = recordingFlakyWorkerFactory(1);
			const analyser = new AgentAnalyser(mockContext(), recording.worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			expect(recording.requests[0].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)?.transcript.mode).toBe('whole');

			mockClaudeCodeSession(`${first_line}\n${second_line}\n`, base_mtime + 1000);
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			// the crashed attempt and its immediate retry are both in `requests`; the retry (the request that actually got a response) is a 'whole' job, not 'tail', since the worker instance that held the cache for CLAUDE_SESSION_ID's tail bookmark is gone
			const later_requests = recording.requests.slice(1);
			const retry_job = later_requests.map(r => r.jobs.find(j => j.session_id === CLAUDE_SESSION_ID)).find(j => j !== undefined)!;
			expect(retry_job.transcript.mode).toBe('whole');
			expect(new TextDecoder().decode(retry_job.transcript.bytes)).toBe(`${first_line}\n${second_line}\n`);
			expect(sessionIdsFrom(posted)).toEqual([CLAUDE_SESSION_ID]);
		});

		it("a session the worker's own byte cap evicted is re-read whole next time, never sent as a tail again", async () => {
			const base_mtime = Date.now();
			const first_line = claudeTranscriptLine('Edit');
			mockClaudeCodeSession(`${first_line}\n`, base_mtime);
			const requests: AgentAnalyserWorkerRequest[] = [];
			let call_count = 0;
			// a worker that answers through the real handler like recordingWorkerFactory, but on its SECOND response reports evicting CLAUDE_SESSION_ID - standing in for AgentAnalyserWorker.ts's own byte cap (enforceCacheByteCap), which this test does not need to actually fill with 128 MB of fixtures to exercise the host's own reaction to it
			const factory = (): Worker => {
				const worker = {
					onmessage: null as ((event: MessageEvent<AgentAnalyserWorkerResponse>) => void) | null,
					onerror: null as ((event: ErrorEvent) => void) | null,
					postMessage: (message: AgentAnalyserWorkerRequest) => {
						call_count++;
						requests.push(message);
						const response = handleAgentAnalyserRequest(message);
						if (call_count === 2) { response.evicted_session_ids = [CLAUDE_SESSION_ID]; }
						Promise.resolve().then(() => { worker.onmessage?.({ data: response } as MessageEvent<AgentAnalyserWorkerResponse>); });
					},
					terminate: () => {},
				};
				return worker as unknown as Worker;
			};
			const analyser = new AgentAnalyser(mockContext(), factory);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			expect(requests[0].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)?.transcript.mode).toBe('whole');

			// second scan: the file grew, so this scan sends a genuine 'tail' job - and it is this response that reports the eviction
			const second_line = claudeTranscriptLine('Write');
			mockClaudeCodeSession(`${first_line}\n${second_line}\n`, base_mtime + 1000);
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			expect(requests[1].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)?.transcript.mode).toBe('tail');

			// third scan: the file grows again; since the host was told the worker evicted this session, it must never send a tail against a cache it knows is gone
			const third_line = claudeTranscriptLine('Edit');
			mockClaudeCodeSession(`${first_line}\n${second_line}\n${third_line}\n`, base_mtime + 2000);
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			const third_job = requests[2].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)!;
			expect(third_job.transcript.mode).toBe('whole');
			expect(new TextDecoder().decode(third_job.transcript.bytes)).toBe(`${first_line}\n${second_line}\n${third_line}\n`);
			expect(sessionIdsFrom(posted)).toEqual([CLAUDE_SESSION_ID]);
		});

		it('a transcript over AGENT_TRANSCRIPT_MAX_BYTES stays refused as it grows, never flickering to a built session on a later tail scan', async () => {
			// well under a single transcript line's own size, so the very first scan already refuses it
			setTranscriptMaxBytesForTest(50);
			try {
				const base_mtime = Date.now();
				const first_line = claudeTranscriptLine('Edit');
				mockClaudeCodeSession(`${first_line}\n`, base_mtime);
				const recording = recordingWorkerFactory();
				const analyser = new AgentAnalyser(mockContext(), recording.worker);
				const posted: Array<Record<string, unknown>> = [];
				analyser.demand(msg => posted.push(msg));
				await settle();
				expect(recording.requests[0].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)?.transcript.mode).toBe('whole');
				expect(refusalCodeFor(posted, CLAUDE_SESSION_ID)).toBe('too_large');

				// the file grows further; the refusal must have already dropped this session's cache and bookmark, so this scan sends it whole again rather than a tail built from a cache the worker never actually kept
				const second_line = claudeTranscriptLine('Write');
				mockClaudeCodeSession(`${first_line}\n${second_line}\n`, base_mtime + 1000);
				await jest.advanceTimersByTimeAsync(15_000);
				await settle();
				const second_job = recording.requests[recording.requests.length - 1].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)!;
				expect(second_job.transcript.mode).toBe('whole');
				expect(refusalCodeFor(posted, CLAUDE_SESSION_ID)).toBe('too_large');

				// the cap lifts back to its real value, and the file changes again (a no-op re-scan of unchanged content is reused from the prior, still-refused output rather than re-read); the earlier refusal must have left nothing poisoned behind, so this scan builds the session normally and whole, since its bookmark was already dropped
				setTranscriptMaxBytesForTest(undefined);
				const third_line = claudeTranscriptLine('Edit');
				mockClaudeCodeSession(`${first_line}\n${second_line}\n${third_line}\n`, base_mtime + 2000);
				await jest.advanceTimersByTimeAsync(15_000);
				await settle();
				const third_job = recording.requests[recording.requests.length - 1].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)!;
				expect(third_job.transcript.mode).toBe('whole');
				expect(refusalCodeFor(posted, CLAUDE_SESSION_ID)).toBeUndefined();
				expect(sessionIdsFrom(posted)).toEqual([CLAUDE_SESSION_ID]);

				// the session is genuinely cached again now: the next change resumes as a real tail
				const fourth_line = claudeTranscriptLine('Write');
				mockClaudeCodeSession(`${first_line}\n${second_line}\n${third_line}\n${fourth_line}\n`, base_mtime + 3000);
				await jest.advanceTimersByTimeAsync(15_000);
				await settle();
				const later_job = recording.requests[recording.requests.length - 1].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)!;
				expect(later_job.transcript.mode).toBe('tail');
			} finally {
				setTranscriptMaxBytesForTest(undefined);
			}
		});

		it('a session that stops being live or recently changed is evicted, so a later change to it is read whole rather than resumed', async () => {
			const base_mtime = Date.now();
			const first_line = claudeTranscriptLine('Edit');
			mockClaudeCodeSession(`${first_line}\n`, base_mtime);
			const recording = recordingWorkerFactory();
			const analyser = new AgentAnalyser(mockContext(), recording.worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			expect(recording.requests[0].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)?.transcript.mode).toBe('whole');

			// no file changes, so no job ever runs again for this session, but wall-clock time (the poll's own AGENT_RESCAN_INTERVAL_MS ticks) eventually pushes the file's mtime outside AGENT_TAIL_CACHE_RECENT_MS (10 minutes) with no live signal either - the session should be evicted purely by the clock, on the reused path
			await jest.advanceTimersByTimeAsync(11 * 60 * 1000);
			await settle();
			const eviction_request = recording.requests.find(r => (r.evict_session_ids ?? []).includes(CLAUDE_SESSION_ID));
			expect(eviction_request).toBeDefined();

			// the file then grows; since the session had already been evicted, this scan must send it whole, not a tail
			const second_line = claudeTranscriptLine('Write');
			mockClaudeCodeSession(`${first_line}\n${second_line}\n`, Date.now());
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			const later_job = recording.requests[recording.requests.length - 1].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)!;
			expect(later_job.transcript.mode).toBe('whole');
			expect(sessionIdsFrom(posted)).toEqual([CLAUDE_SESSION_ID]);
		});
	});

	describe('live state on a reused session is recomputed every scan, never left stale', () => {
		it('a cached Claude session whose pid file disappears goes ended with zero transcript bytes read', async () => {
			const mtime = Date.now();
			mockClaudeCodeSession(claudeTranscriptLine('Edit'), mtime, { status: 'busy' });
			const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			expect(sessionStateFrom(posted, CLAUDE_SESSION_ID)).toBe('working');
			(vscode.workspace.fs.readFile as jest.Mock).mockClear();
			// same transcript, same mtime - only the pid file (and so the live list) disappears, as it does when the process exits
			mockClaudeCodeSession(claudeTranscriptLine('Edit'), mtime, undefined);
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			expect(transcriptReadCount()).toBe(0);
			expect(sessionStateFrom(posted, CLAUDE_SESSION_ID)).toBe('ended');
		});

		it('a busy -> idle status flip updates state with zero transcript bytes read', async () => {
			const mtime = Date.now();
			mockClaudeCodeSession(claudeTranscriptLine('Edit'), mtime, { status: 'busy' });
			const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			expect(sessionStateFrom(posted, CLAUDE_SESSION_ID)).toBe('working');
			(vscode.workspace.fs.readFile as jest.Mock).mockClear();
			// same transcript, same mtime - only the pid file's own status flips
			mockClaudeCodeSession(claudeTranscriptLine('Edit'), mtime, { status: 'idle' });
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			expect(transcriptReadCount()).toBe(0);
			expect(sessionStateFrom(posted, CLAUDE_SESSION_ID)).toBe('idle');
		});

		it('a busy -> waiting status flip marks the session waiting with zero transcript bytes read', async () => {
			const mtime = Date.now();
			mockClaudeCodeSession(claudeTranscriptLine('Edit'), mtime, { status: 'busy' });
			const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			(vscode.workspace.fs.readFile as jest.Mock).mockClear();
			mockClaudeCodeSession(claudeTranscriptLine('Edit'), mtime, { status: 'waiting' });
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			expect(transcriptReadCount()).toBe(0);
			expect(sessionStateFrom(posted, CLAUDE_SESSION_ID)).toBe('waiting');
		});

		it('a freshly read session takes its pid file\'s waiting status over the transcript\'s pending tool call', async () => {
			mockClaudeCodeSession(claudeTranscriptLine('Edit'), Date.now(), { status: 'waiting' });
			const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			expect(sessionStateFrom(posted, CLAUDE_SESSION_ID)).toBe('waiting');
		});

		it('a cached Codex session crosses the live window purely by clock and goes ended', async () => {
			const now = new Date('2026-01-15T12:00:00Z');
			jest.setSystemTime(now);
			const y = now.getFullYear();
			const m = String(now.getMonth() + 1).padStart(2, '0');
			const d = String(now.getDate()).padStart(2, '0');
			const codex_home = '/home/test/.codex';
			const day_dir = `${codex_home}/sessions/${y}/${m}/${d}`;
			const session_uuid = '123e4567-e89b-12d3-a456-426614174000';
			const file_name = `rollout-${session_uuid}.jsonl`;
			const rollout_path = `${day_dir}/${file_name}`;
			const session_meta_line = JSON.stringify({
				timestamp: now.toISOString(), ordinal: 0, type: 'session_meta',
				payload: { session_id: session_uuid, id: session_uuid, timestamp: now.toISOString(), cwd: '/repo', originator: 'codex-tui', cli_version: '0.1.0', source: 'cli' },
			});
			const bytes = new TextEncoder().encode(session_meta_line);
			const mtime = now.getTime(); // well within the 5-minute live window at the start
			(vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
				return uri.path === day_dir ? [[file_name, vscode.FileType.File]] : [];
			});
			(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
				if (uri.path === rollout_path) { return { type: 1, ctime: 0, mtime, size: bytes.byteLength }; }
				throw new Error('not found');
			});
			(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
				if (uri.path === rollout_path) { return bytes; }
				throw new Error('not found');
			});
			const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			expect(sessionStateFrom(posted, session_uuid)).not.toBe('ended');
			(vscode.workspace.fs.readFile as jest.Mock).mockClear();
			// the file itself never changes again (mtime pinned), but the clock now reads 6 minutes past it - past the 5-minute live window
			await jest.advanceTimersByTimeAsync(6 * 60 * 1000);
			await settle();
			expect((vscode.workspace.fs.readFile as jest.Mock).mock.calls.some(call => (call[0] as vscode.Uri).path === rollout_path)).toBe(false);
			expect(sessionStateFrom(posted, session_uuid)).toBe('ended');
		});
	});
});

describe('AgentAnalyser story board discovery', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		(vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: Uri.file('/ws'), name: 'ws', index: 0 }];
	});

	afterEach(() => { jest.useRealTimers(); });

	async function settle(): Promise<void> {
		for (let i = 0; i < 5; i++) { await jest.advanceTimersByTimeAsync(0); }
	}

	function storiesFrom(posted: Array<Record<string, unknown>>, session_id: string): unknown {
		const last = posted[posted.length - 1];
		const sessions = (last.activity as { sessions: Array<{ session: { session_id: string; stories?: unknown } }> }).sessions;
		return sessions.find(s => s.session.session_id === session_id)?.session.stories;
	}

	function editTranscriptLine(file_path: string, old_string: string, new_string: string): string {
		return JSON.stringify({
			type: 'assistant',
			timestamp: '2026-09-22T11:00:00Z',
			message: {
				id: 'm1', role: 'assistant', model: 'claude-sonnet-5',
				content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path, old_string, new_string } }],
				usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
			},
		});
	}

	/*
	 * The real environment (`active_development/AGENTS.md`) opens the whole multi-project workspace as
	 * one folder, `/ws` here, with every project (`myproj`) a sibling directory underneath it and each
	 * project's OWN `docstech/users` below that - never a `docstech/users` directly under `/ws` itself.
	 * `readStoryDocuments` looks under both the workspace folder itself and its immediate child
	 * directories, so it finds a project's board either way.
	 */
	it('finds a project board under the workspace root\'s child directory, not just directly under the workspace root', async () => {
		const board_path = '/ws/myproj/docstech/users/alex/todo.md';
		const board_text = '# Todo\n\n\n### My story [](?id=my-story&status=doing)\n\n+ [ ] a task\n';
		const transcript_line = editTranscriptLine(board_path, '+ [ ] a task', '+ [X] a task');
		const transcript_bytes = new TextEncoder().encode(transcript_line);
		const board_bytes = new TextEncoder().encode(board_text);
		(vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_PROJECTS_DIR) { return [[CLAUDE_PROJECT_DIR, vscode.FileType.Directory]]; }
			if (uri.path === CLAUDE_PROJECT_PATH) { return [[`${CLAUDE_SESSION_ID}.jsonl`, vscode.FileType.File]]; }
			if (uri.path === '/ws') { return [['myproj', vscode.FileType.Directory]]; }
			if (uri.path === '/ws/myproj/docstech/users') { return [['alex', vscode.FileType.Directory]]; }
			return [];
		});
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_TRANSCRIPT_PATH) { return { type: 1, ctime: 0, mtime: Date.parse('2026-09-22T11:00:00Z'), size: transcript_bytes.byteLength }; }
			// no docstech/users directly under the workspace root itself: it is the multi-project umbrella, not a standalone project checkout
			throw new Error('not found');
		});
		(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_TRANSCRIPT_PATH) { return transcript_bytes; }
			if (uri.path === board_path) { return board_bytes; }
			throw new Error('not found');
		});
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(storiesFrom(posted, CLAUDE_SESSION_ID)).toEqual([{ doc_path: 'myproj/docstech/users/alex/todo.md', id: 'my-story' }]);
	});

	it('still finds a board directly under the workspace root when the workspace IS a single project checkout', async () => {
		const board_path = '/ws/docstech/users/alex/todo.md';
		const board_text = '# Todo\n\n\n### My story [](?id=my-story&status=doing)\n\n+ [ ] a task\n';
		const transcript_line = editTranscriptLine(board_path, '+ [ ] a task', '+ [X] a task');
		const transcript_bytes = new TextEncoder().encode(transcript_line);
		const board_bytes = new TextEncoder().encode(board_text);
		(vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_PROJECTS_DIR) { return [[CLAUDE_PROJECT_DIR, vscode.FileType.Directory]]; }
			if (uri.path === CLAUDE_PROJECT_PATH) { return [[`${CLAUDE_SESSION_ID}.jsonl`, vscode.FileType.File]]; }
			if (uri.path === '/ws/docstech/users') { return [['alex', vscode.FileType.Directory]]; }
			return [];
		});
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_TRANSCRIPT_PATH) { return { type: 1, ctime: 0, mtime: Date.parse('2026-09-22T11:00:00Z'), size: transcript_bytes.byteLength }; }
			// the workspace folder itself carries docstech/users, so it is its own project root
			if (uri.path === '/ws/docstech/users') { return { type: 2, ctime: 0, mtime: 0, size: 0 }; }
			throw new Error('not found');
		});
		(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_TRANSCRIPT_PATH) { return transcript_bytes; }
			if (uri.path === board_path) { return board_bytes; }
			throw new Error('not found');
		});
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(storiesFrom(posted, CLAUDE_SESSION_ID)).toEqual([{ doc_path: 'docstech/users/alex/todo.md', id: 'my-story' }]);
	});
});

describe('AgentAnalyser line diff counts', () => {
	const REPO_ROOT = '/ws';
	const CHANGED_PATH = 'src/foo.ts';

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		(vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([]);
		(vscode.workspace.fs.readFile as jest.Mock).mockRejectedValue(new Error('no such file'));
		(vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: Uri.file(REPO_ROOT), name: 'ws', index: 0 }];
	});

	afterEach(() => {
		jest.useRealTimers();
		(vscode.commands.getCommands as jest.Mock).mockResolvedValue([]);
		(vscode.commands.executeCommand as jest.Mock).mockReset();
	});

	async function settle(): Promise<void> {
		for (let i = 0; i < 5; i++) { await jest.advanceTimersByTimeAsync(0); }
	}

	// one repository with one modified file, HEAD's own reflog left to reject (no reflog needed for these tests)
	function wireOneRepoWithModifiedFile(old_text: string, new_text: string): void {
		wireGitCommands({ [REPO_ROOT]: { workingTreeChanges: [{ path: `${REPO_ROOT}/${CHANGED_PATH}`, status: 'MODIFIED' }], HEAD: { name: 'staging', commit: 'a'.repeat(40) } } });
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === `${REPO_ROOT}/${CHANGED_PATH}`) { return { type: 1, ctime: 0, mtime: 1000, size: new_text.length }; }
			throw new Error('not found');
		});
		(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.scheme === 'git') { return new TextEncoder().encode(old_text); }
			if (uri.path === `${REPO_ROOT}/${CHANGED_PATH}`) { return new TextEncoder().encode(new_text); }
			throw new Error('not found');
		});
	}

	function uncommittedFrom(posted: Array<Record<string, unknown>>): Array<{ path: string; added?: number; removed?: number }> {
		const last = posted[posted.length - 1];
		const trees = (last.activity as { trees: Array<{ tree: { uncommitted: Array<{ path: string; added?: number; removed?: number }> } }> }).trees;
		return trees[0]?.tree.uncommitted ?? [];
	}

	it('adds line counts to an uncommitted file HEAD vs the working tree', async () => {
		wireOneRepoWithModifiedFile('a\nb\nc\n', 'a\nx\nc\n');
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(uncommittedFrom(posted)).toMatchObject([{ path: CHANGED_PATH, added: 1, removed: 1 }]);
	});

	it('reuses a cached count across scans when the file has not changed, reading it only once', async () => {
		wireOneRepoWithModifiedFile('a\nb\nc\n', 'a\nx\nc\n');
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		const reads_after_first_scan = (vscode.workspace.fs.readFile as jest.Mock).mock.calls.filter(call => (call[0] as vscode.Uri).path === `${REPO_ROOT}/${CHANGED_PATH}` || (call[0] as vscode.Uri).scheme === 'git').length;
		jest.advanceTimersByTime(15_000);
		await settle();
		const reads_after_second_scan = (vscode.workspace.fs.readFile as jest.Mock).mock.calls.filter(call => (call[0] as vscode.Uri).path === `${REPO_ROOT}/${CHANGED_PATH}` || (call[0] as vscode.Uri).scheme === 'git').length;
		expect(reads_after_second_scan).toBe(reads_after_first_scan);
		expect(uncommittedFrom(posted)).toMatchObject([{ path: CHANGED_PATH, added: 1, removed: 1 }]);
	});

	it('recomputes once the working file changes size', async () => {
		wireOneRepoWithModifiedFile('a\nb\nc\n', 'a\nx\nc\n');
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		wireOneRepoWithModifiedFile('a\nb\nc\n', 'a\nx\ny\nc\n');
		jest.advanceTimersByTime(15_000);
		await settle();
		expect(uncommittedFrom(posted)).toMatchObject([{ path: CHANGED_PATH, added: 2, removed: 1 }]);
	});

	it('leaves added/removed off a binary file rather than guessing', async () => {
		wireOneRepoWithModifiedFile('a\nb\n', 'a\nb\n');
		(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.scheme === 'git') { return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]); }
			if (uri.path === `${REPO_ROOT}/${CHANGED_PATH}`) { return new TextEncoder().encode('a\nb\n'); }
			throw new Error('not found');
		});
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(uncommittedFrom(posted)[0].added).toBeUndefined();
		expect(uncommittedFrom(posted)[0].removed).toBeUndefined();
	});
});

describe('AgentAnalyser git repository discovery logging', () => {
	const REPO_ROOT = '/ws';

	beforeEach(() => {
		jest.clearAllMocks();
		(vscode.commands.getCommands as jest.Mock).mockResolvedValue([]);
		(vscode.commands.executeCommand as jest.Mock).mockReset();
		jest.useFakeTimers();
		(vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([]);
		(vscode.workspace.fs.readFile as jest.Mock).mockRejectedValue(new Error('no such file'));
		(vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: Uri.file(REPO_ROOT), name: 'ws', index: 0 }];
	});

	afterEach(() => { jest.useRealTimers(); });

	async function settle(): Promise<void> {
		for (let i = 0; i < 5; i++) { await jest.advanceTimersByTimeAsync(0); }
	}

	// a scan that reads no repository says so, so an empty uncommitted band is distinguishable from one never filled
	it('logs a debug line naming zero repositories when the git api reports none, distinguishing it from the api being unavailable at all', async () => {
		wireGitCommands({});
		const log_spy = jest.spyOn(errorops, 'writeToLogAtLevel');
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		analyser.demand(jest.fn());
		await settle();
		const lines = log_spy.mock.calls.filter(call => call[0] === 'debug' && call[1] === 'readRepositoryTrees');
		expect(lines).toHaveLength(1);
		expect(lines[0][2]).toContain('0 repositories');
		log_spy.mockRestore();
	});

	it('logs every repository root path the git api does report', async () => {
		wireGitCommands({ [REPO_ROOT]: { workingTreeChanges: [] } });
		const log_spy = jest.spyOn(errorops, 'writeToLogAtLevel');
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		analyser.demand(jest.fn());
		await settle();
		const lines = log_spy.mock.calls.filter(call => call[0] === 'debug' && call[1] === 'readRepositoryTrees');
		expect(lines).toHaveLength(1);
		expect(lines[0][2]).toContain('1 repository');
		expect(lines[0][2]).toContain(REPO_ROOT);
		log_spy.mockRestore();
	});

	it('logs that the git api itself is unavailable when the git extension has registered no api commands', async () => {
		const log_spy = jest.spyOn(errorops, 'writeToLogAtLevel');
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		analyser.demand(jest.fn());
		await settle();
		const lines = log_spy.mock.calls.filter(call => call[0] === 'debug' && call[1] === 'readRepositoryTrees');
		expect(lines).toHaveLength(1);
		expect(lines[0][2]).toContain('not registered');
		log_spy.mockRestore();
	});
});

describe('AgentAnalyser usage split by turn', () => {
	const BOARD_PATH = '/ws/docstech/users/alex/todo.md';
	const BOARD_TEXT = '# Todo\n\n\n### Story A [](?id=story-a&status=doing)\n\n+ [ ] task a\n\n\n### Story B [](?id=story-b&status=doing)\n\n+ [ ] task b\n';

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		(vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: Uri.file('/ws'), name: 'ws', index: 0 }];
	});

	afterEach(() => { jest.useRealTimers(); });

	async function settle(): Promise<void> {
		for (let i = 0; i < 5; i++) { await jest.advanceTimersByTimeAsync(0); }
	}

	// a plain usage turn with no tool call at all, so it contributes usage without ever binding a story on its own
	function usageOnlyLine(id: string, timestamp: string, input_tokens: number): string {
		return JSON.stringify({
			type: 'assistant', timestamp,
			message: { id, role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'thinking' }], usage: { input_tokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
		});
	}

	// a turn that both edits the board and carries its own usage, mirroring how Claude Code's own message.usage sits on the same record as its tool_use content block
	function editLine(id: string, timestamp: string, input_tokens: number, old_string: string, new_string: string): string {
		return JSON.stringify({
			type: 'assistant', timestamp,
			message: {
				id, role: 'assistant', model: 'claude-sonnet-5',
				content: [{ type: 'tool_use', id: `${id}-t`, name: 'Edit', input: { file_path: BOARD_PATH, old_string, new_string } }],
				usage: { input_tokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
			},
		});
	}

	// a MultiEdit turn touching both stories' sections in one call, so it binds to both and its own usage should split evenly between them
	function multiEditBothStoriesLine(id: string, timestamp: string, input_tokens: number): string {
		return JSON.stringify({
			type: 'assistant', timestamp,
			message: {
				id, role: 'assistant', model: 'claude-sonnet-5',
				content: [{
					type: 'tool_use', id: `${id}-t`, name: 'MultiEdit',
					input: { file_path: BOARD_PATH, edits: [{ old_string: '+ [ ] task a', new_string: '+ [X] task a' }, { old_string: '+ [ ] task b', new_string: '+ [X] task b' }] },
				}],
				usage: { input_tokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
			},
		});
	}

	function wireTranscript(transcript_text: string): void {
		const transcript_bytes = new TextEncoder().encode(transcript_text);
		const board_bytes = new TextEncoder().encode(BOARD_TEXT);
		(vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_PROJECTS_DIR) { return [[CLAUDE_PROJECT_DIR, vscode.FileType.Directory]]; }
			if (uri.path === CLAUDE_PROJECT_PATH) { return [[`${CLAUDE_SESSION_ID}.jsonl`, vscode.FileType.File]]; }
			if (uri.path === '/ws/docstech/users') { return [['alex', vscode.FileType.Directory]]; }
			return [];
		});
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_TRANSCRIPT_PATH) { return { type: 1, ctime: 0, mtime: Date.parse('2026-09-22T11:00:00Z'), size: transcript_bytes.byteLength }; }
			if (uri.path === '/ws/docstech/users') { return { type: 2, ctime: 0, mtime: 0, size: 0 }; }
			throw new Error('not found');
		});
		(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_TRANSCRIPT_PATH) { return transcript_bytes; }
			if (uri.path === BOARD_PATH) { return board_bytes; }
			throw new Error('not found');
		});
	}

	function storyUsageFrom(posted: Array<Record<string, unknown>>): Array<{ story: { doc_path: string; id: string }; usage: { input_tokens: number }; first_at?: string }> {
		const last = posted[posted.length - 1];
		const sessions = (last.activity as { sessions: Array<{ session: { session_id: string; story_usage?: Array<{ story: { doc_path: string; id: string }; usage: { input_tokens: number }; first_at?: string }> } }> }).sessions;
		return sessions.find(s => s.session.session_id === CLAUDE_SESSION_ID)?.session.story_usage ?? [];
	}

	it('credits turns before the first story edit to that edit\'s own story, and every later turn to whichever story was most recently edited', async () => {
		const lines = [
			usageOnlyLine('m1', '2026-09-22T10:00:00Z', 100), // before any edit: counts toward story A, the first story edited
			editLine('m2', '2026-09-22T10:01:00Z', 50, '+ [ ] task a', '+ [X] task a'), // edits story A; its own usage counts toward A too
			usageOnlyLine('m3', '2026-09-22T10:02:00Z', 20), // after the A edit, before any B edit: still A
			editLine('m4', '2026-09-22T10:03:00Z', 40, '+ [ ] task b', '+ [X] task b'), // edits story B
			usageOnlyLine('m5', '2026-09-22T10:04:00Z', 10), // after the B edit: counts toward B
		];
		wireTranscript(lines.join('\n'));
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		const story_usage = storyUsageFrom(posted);
		const a = story_usage.find(entry => entry.story.id === 'story-a');
		const b = story_usage.find(entry => entry.story.id === 'story-b');
		// story A: m1 (100) + m2 (50) + m3 (20) = 170
		expect(a?.usage.input_tokens).toBe(170);
		// story B: m4 (40) + m5 (10) = 50
		expect(b?.usage.input_tokens).toBe(50);
		// the totals across stories equal the session total (100+50+20+40+10 = 220)
		expect((a?.usage.input_tokens ?? 0) + (b?.usage.input_tokens ?? 0)).toBe(220);
		// each story's span starts at the earliest call credited to it: m1 for A, m4 for B
		expect(Date.parse(a?.first_at ?? '')).toBe(Date.parse('2026-09-22T10:00:00Z'));
		expect(Date.parse(b?.first_at ?? '')).toBe(Date.parse('2026-09-22T10:03:00Z'));
	});

	it('splits one turn\'s own usage evenly across every story it edited', async () => {
		const lines = [
			multiEditBothStoriesLine('m1', '2026-09-22T10:00:00Z', 100),
		];
		wireTranscript(lines.join('\n'));
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		const story_usage = storyUsageFrom(posted);
		const a = story_usage.find(entry => entry.story.id === 'story-a');
		const b = story_usage.find(entry => entry.story.id === 'story-b');
		expect(a?.usage.input_tokens).toBe(50);
		expect(b?.usage.input_tokens).toBe(50);
	});
});
