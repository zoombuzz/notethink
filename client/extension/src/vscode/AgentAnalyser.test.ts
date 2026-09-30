import * as vscode from 'vscode';
import { Uri } from '../__mocks__/vscode';
import { AgentAnalyser, setFileStatMaxEntriesForTest } from './AgentAnalyser';
import { handleAgentAnalyserRequest, resetTailCacheForTest, setTailCacheMaxBytesForTest, setTranscriptMaxBytesForTest, type AgentAnalyserWorkerRequest, type AgentAnalyserWorkerResponse } from './AgentAnalyserWorker';
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

// a fake Worker answering postMessage on the next microtask via the real handler, no real worker thread
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

// a fake Worker whose first fail_count attempts fail, so recovery out of "failed" is deterministic
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

// like fakeWorkerFactory, but also records every request so a test can inspect what a scan transferred
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

// combines flakyWorkerFactory's failure pattern with recordingWorkerFactory's request capture
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

// answers every request except one for poison_session_id, which always fails - a transcript that always crashes the parser
function poisonSessionWorkerFactory(poison_session_id: string): () => Worker {
	return (): Worker => {
		const worker = {
			onmessage: null as ((event: MessageEvent<AgentAnalyserWorkerResponse>) => void) | null,
			onerror: null as ((event: ErrorEvent) => void) | null,
			postMessage: (message: AgentAnalyserWorkerRequest) => {
				Promise.resolve().then(() => {
					if (message.jobs.some(job => job.session_id === poison_session_id)) { worker.onerror?.({ message: 'boom' } as ErrorEvent); return; }
					worker.onmessage?.({ data: handleAgentAnalyserRequest(message) } as MessageEvent<AgentAnalyserWorkerResponse>);
				});
			},
			terminate: () => {},
		};
		return worker as unknown as Worker;
	};
}

// answers session requests normally but fails every line_diff_jobs request, to drive the host fallback deterministically
function lineDiffFailingWorkerFactory(): () => Worker {
	return (): Worker => {
		const worker = {
			onmessage: null as ((event: MessageEvent<AgentAnalyserWorkerResponse>) => void) | null,
			onerror: null as ((event: ErrorEvent) => void) | null,
			postMessage: (message: AgentAnalyserWorkerRequest) => {
				Promise.resolve().then(() => {
					if (message.line_diff_jobs) { worker.onerror?.({ message: 'line diff boom' } as ErrorEvent); return; }
					worker.onmessage?.({ data: handleAgentAnalyserRequest(message) } as MessageEvent<AgentAnalyserWorkerResponse>);
				});
			},
			terminate: () => {},
		};
		return worker as unknown as Worker;
	};
}

// a fake Worker holding its response until release() fires; release('failure') answers via onerror instead
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

// a single claude-code session; fs calls are wired by path so discoverClaudeCode's cache can be tested
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

// answers git.api.* commands for these repositories, keyed by root path, in the shape the real commands return
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

	/**
	 * Advances fake timers and flushes the microtask queue in interleaved order, so a setTimeout(fn, 0)
	 * and a fake worker's Promise.resolve().then(...) both settle before an assertion reads the result;
	 * called several times since discover -> worker round trip -> fold -> post is several hops deep.
	 */
	async function settle(): Promise<void> {
		for (let i = 0; i < 5; i++) { await jest.advanceTimersByTimeAsync(0); }
	}

	it('looks up Codex session directories by the local calendar date, not UTC', async () => {
		// a timezone far ahead of UTC so a late-UTC-day instant falls on the next local day
		const original_tz = process.env.TZ;
		process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
		try {
			jest.setSystemTime(new Date('2026-09-22T23:30:00Z')); // 2026-09-23 in Kiritimati, still 2026-09-22 in UTC
			const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
			analyser.demand(jest.fn());
			await settle();
			// 22 is inside the window either way; the local-only 23 is what a UTC walk could never reach yet
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
		// fails twice (initial attempt plus its one restart), so the third attempt - the next poll - is the recovery
		const analyser = new AgentAnalyser(mockContext(), flakyWorkerFactory(2));
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		// a large advance draining the chained promise flushes that repeated 0ms nudges do not; kept under the poll interval
		await jest.advanceTimersByTimeAsync(5_000);
		expect((posted[posted.length - 1].activity as { analyser: { state: string } }).analyser.state).toBe('failed');
		// the analyser keeps polling at the normal interval rather than treating "failed" as terminal
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
		// minScanDelayMs scales with how long the first scan took, so the follow-up waits ~2s, not the flat 1s floor
		await jest.advanceTimersByTimeAsync(2_000);
		await settle();
		controllable.release();
		await settle();
		// exactly one follow-up scan ran for the whole burst
		expect(run_scan_once).toHaveBeenCalledTimes(2);
	});

	// a session under active write fires the watcher almost every turn, so without this floor scans would run back to back
	it('a watcher-driven scan after a slow one waits proportionally to how long that scan took, not immediately', async () => {
		const controllable = controllableWorkerFactory();
		const analyser = new AgentAnalyser(mockContext(), controllable.worker);
		const run_scan_once = jest.spyOn(analyser as unknown as { runScanOnce: () => Promise<void> }, 'runScanOnce');
		analyser.demand(jest.fn());
		await settle();
		expect(run_scan_once).toHaveBeenCalledTimes(1);
		// the first scan takes a simulated 3s with no burst, so the flat floor alone would let the next trigger start immediately
		await jest.advanceTimersByTimeAsync(3_000);
		controllable.release();
		await settle();
		expect(run_scan_once).toHaveBeenCalledTimes(1);

		// the file change happens well after the first scan ended, clear of any overlap
		const watcher_calls = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results;
		const on_change: jest.Mock = watcher_calls[0].value.onDidChange.mock.calls[0][0];
		on_change();
		await jest.advanceTimersByTimeAsync(300); // AGENT_WATCH_DEBOUNCE_MS settles, so the trigger fires
		await jest.advanceTimersByTimeAsync(500); // nowhere near the ~3s proportional floor the 3s-long first scan set
		await settle();
		expect(run_scan_once).toHaveBeenCalledTimes(1);

		// once the full proportional gap has elapsed, the debounced scan starts
		await jest.advanceTimersByTimeAsync(3_000);
		await settle();
		expect(run_scan_once).toHaveBeenCalledTimes(2);
	});

	it('a failure on the in-flight scan cannot orphan a request queued behind it', async () => {
		const controllable = controllableWorkerFactory();
		const analyser = new AgentAnalyser(mockContext(), controllable.worker);
		const run_scan_once = jest.spyOn(analyser as unknown as { runScanOnce: () => Promise<void> }, 'runScanOnce');
		analyser.demand(jest.fn());
		await settle();
		expect(run_scan_once).toHaveBeenCalledTimes(1);
		// a watcher fires while the first scan is in flight, queuing a follow-up rather than starting a second scan
		const watcher_calls = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results;
		const on_change: jest.Mock = watcher_calls[0].value.onDidChange.mock.calls[0][0];
		on_change();
		await jest.advanceTimersByTimeAsync(300);
		// the in-flight scan crashes; its failure path must not also drop the queued follow-up
		controllable.release('failure');
		await settle();
		await jest.advanceTimersByTimeAsync(1_000); // AGENT_MIN_SCAN_SPACING_MS floor before the queued follow-up starts
		await settle();
		// exactly one follow-up ran once the crash finished processing - the trigger queued during it was not orphaned
		expect(run_scan_once).toHaveBeenCalledTimes(2);
	});

	// once a completed scan has posted, an in-progress or twice-failed rescan must not blank or dim the last snapshot
	it('a rescan that fails twice in a row keeps the last live snapshot visible, without ever posting failed', async () => {
		const controllable = controllableWorkerFactory();
		const analyser = new AgentAnalyser(mockContext(), controllable.worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		controllable.release('success');
		await settle();
		expect((posted[posted.length - 1].activity as { analyser: { state: string } }).analyser.state).toBe('live');
		const before_rescan = posted.length;

		// the poll triggers a rescan; its attempt fails, and its one immediate retry fails too
		await jest.advanceTimersByTimeAsync(15_000); // AGENT_RESCAN_INTERVAL_MS
		await settle();
		controllable.release('failure');
		await settle();
		await jest.advanceTimersByTimeAsync(0); // the retry's scheduleScan(0)
		await settle();
		controllable.release('failure');
		await settle();

		// neither failure produced a single post: the card never showed 'failed', let alone blanked
		expect(posted.slice(before_rescan)).toHaveLength(0);
		expect((posted[posted.length - 1].activity as { analyser: { state: string } }).analyser.state).toBe('live');
	});

	// stopRunning/startRunning never clear this.sessions/this.trees, so reattaching sees completed data, not 'scanning'
	it('a panel reattaching after a full stop/restart cycle sees the last live snapshot immediately, never scanning', async () => {
		mockClaudeCodeSession(claudeTranscriptLine('Edit'), Date.now());
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const first_post = jest.fn();
		analyser.demand(first_post);
		await settle();
		expect(first_post.mock.calls[first_post.mock.calls.length - 1][0].activity.analyser.state).toBe('live');
		analyser.withdraw(first_post);
		await jest.advanceTimersByTimeAsync(5_000); // AGENT_STOP_GRACE_MS, so stopRunning fires
		await settle();

		const second_post = jest.fn();
		analyser.demand(second_post);
		// the first message this subscriber gets is already 'live' with the session on it, never a bare 'scanning'
		expect(second_post).toHaveBeenCalledTimes(1);
		const first_message = second_post.mock.calls[0][0];
		expect(first_message.activity.analyser.state).toBe('live');
		expect(first_message.activity.sessions).toHaveLength(1);
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
			// output still reflects both calls: the resumed build combined the cached first line with the tail-parsed second
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
			// the second scan's first attempt fails; AgentAnalyser retries once immediately with a fresh worker instance
			const recording = recordingFlakyWorkerFactory(1);
			const analyser = new AgentAnalyser(mockContext(), recording.worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			expect(recording.requests[0].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)?.transcript.mode).toBe('whole');

			mockClaudeCodeSession(`${first_line}\n${second_line}\n`, base_mtime + 1000);
			await jest.advanceTimersByTimeAsync(15_000);
			await settle();
			// both attempts land in `requests`; the retry's job is 'whole', not 'tail', since the tail-cache-holding worker is gone
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
			// answers like recordingWorkerFactory, but its second response reports evicting CLAUDE_SESSION_ID for the byte cap
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

			// third scan: the file grows again; the host must never send a tail against a cache it knows is gone
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

				// the file grows further; the refusal already dropped this session's cache, so this scan sends it whole again
				const second_line = claudeTranscriptLine('Write');
				mockClaudeCodeSession(`${first_line}\n${second_line}\n`, base_mtime + 1000);
				await jest.advanceTimersByTimeAsync(15_000);
				await settle();
				const second_job = recording.requests[recording.requests.length - 1].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)!;
				expect(second_job.transcript.mode).toBe('whole');
				expect(refusalCodeFor(posted, CLAUDE_SESSION_ID)).toBe('too_large');

				// the cap lifts and the file changes again; the earlier refusal left nothing poisoned, so this scan builds whole
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

			// wall-clock time alone pushes the mtime past the tail-cache recency window, evicting the session by the clock
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

		// AGENT_TAIL_CACHE_MAX_BYTES splits evenly across pool_size; a session bigger than its share must still keep a cache entry
		it('keeps tailing a session bigger than its own per-worker cache share, rather than evicting it every request', async () => {
			try {
				// a tiny budget split two ways makes this small line outgrow one worker's share, mirroring a real oversized transcript
				setTailCacheMaxBytesForTest(100);
				const base_mtime = Date.now();
				const first_line = claudeTranscriptLine('Edit');
				mockClaudeCodeSession(`${first_line}\n`, base_mtime);
				const recording = recordingWorkerFactory();
				const analyser = new AgentAnalyser(mockContext(), recording.worker, 2);
				const posted: Array<Record<string, unknown>> = [];
				analyser.demand(msg => posted.push(msg));
				await settle();
				const first_job = recording.requests[0].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)!;
				expect(first_job.transcript.mode).toBe('whole');
				expect(recording.requests[0].evicted_session_ids ?? []).not.toContain(CLAUDE_SESSION_ID);

				// this line is already bigger than the 50-byte share, so the next scan must find it cached and send only the delta
				const second_line = claudeTranscriptLine('Write');
				mockClaudeCodeSession(`${first_line}\n${second_line}\n`, base_mtime + 1000);
				await jest.advanceTimersByTimeAsync(15_000);
				await settle();
				const later_requests = recording.requests.slice(1);
				expect(later_requests.some(r => (r.evicted_session_ids ?? []).includes(CLAUDE_SESSION_ID))).toBe(false);
				const second_job = later_requests[later_requests.length - 1].jobs.find(j => j.session_id === CLAUDE_SESSION_ID)!;
				expect(second_job.transcript.mode).toBe('tail');
				expect(new TextDecoder().decode(second_job.transcript.bytes)).toBe(`${second_line}\n`);
			} finally {
				setTailCacheMaxBytesForTest(undefined);
				resetTailCacheForTest();
			}
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
			// the file never changes again, but the clock now reads 6 minutes past mtime, past the 5-minute live window
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
			// no docstech/users directly under the workspace root: it's the multi-project umbrella, not a project checkout
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

	// a git show per file must not hold the live post back; the counts follow in a later post
	it('posts live before any HEAD side is read, then posts the counts once it is', async () => {
		wireOneRepoWithModifiedFile('a\nb\nc\n', 'a\nx\nc\n');
		let releaseHead: () => void = () => undefined;
		const head_gate = new Promise<void>(resolve => { releaseHead = resolve; });
		const read_mock = vscode.workspace.fs.readFile as jest.Mock;
		const wired_read = read_mock.getMockImplementation()!;
		read_mock.mockImplementation(async (uri: vscode.Uri) => {
			if (uri.scheme === 'git') { await head_gate; }
			return wired_read(uri);
		});
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect((posted[posted.length - 1].activity as { analyser: { state: string } }).analyser.state).toBe('live');
		expect(uncommittedFrom(posted)[0]).not.toHaveProperty('added');

		releaseHead();
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

	// the O(a*b) LCS count must never run on this thread - it goes to the worker after the session round trip resolves files
	it('sends the diff to the worker as a line_diff_jobs batch rather than computing it on the host', async () => {
		wireOneRepoWithModifiedFile('a\nb\nc\n', 'a\nx\nc\n');
		const recording = recordingWorkerFactory();
		const analyser = new AgentAnalyser(mockContext(), recording.worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(uncommittedFrom(posted)).toMatchObject([{ path: CHANGED_PATH, added: 1, removed: 1 }]);
		const line_diff_requests = recording.requests.filter(request => request.line_diff_jobs !== undefined);
		expect(line_diff_requests).toHaveLength(1);
		expect(line_diff_requests[0].jobs).toEqual([]);
		expect(line_diff_requests[0].line_diff_jobs).toEqual([{ key: CHANGED_PATH, head_bytes: expect.any(ArrayBuffer), working_bytes: expect.any(ArrayBuffer) }]);
	});

	it('logs line diffs as wall time when two repositories diff in parallel, not the sum of their overlapping spans', async () => {
		const SECOND_ROOT = '/ws2';
		const changed_paths = [`${REPO_ROOT}/${CHANGED_PATH}`, `${SECOND_ROOT}/${CHANGED_PATH}`];
		(vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: Uri.file(REPO_ROOT), name: 'ws', index: 0 }, { uri: Uri.file(SECOND_ROOT), name: 'ws2', index: 1 }];
		const head = { name: 'staging', commit: 'a'.repeat(40) };
		wireGitCommands({
			[REPO_ROOT]: { workingTreeChanges: [{ path: changed_paths[0], status: 'MODIFIED' }], HEAD: head },
			[SECOND_ROOT]: { workingTreeChanges: [{ path: changed_paths[1], status: 'MODIFIED' }], HEAD: head },
		});
		// each repository's identity stat takes 1000ms, so a serial sum would log about 2000ms
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (!changed_paths.includes(uri.path)) { throw new Error('not found'); }
			await new Promise(resolve => setTimeout(resolve, 1000));
			return { type: 1, ctime: 0, mtime: 1000, size: 6 };
		});
		(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.scheme === 'git') { return new TextEncoder().encode('a\nb\nc\n'); }
			if (changed_paths.includes(uri.path)) { return new TextEncoder().encode('a\nx\nc\n'); }
			throw new Error('not found');
		});
		const log_spy = jest.spyOn(errorops, 'writeToLogAtLevel');
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		analyser.demand(jest.fn());
		await settle();
		await jest.advanceTimersByTimeAsync(1000);
		await settle();
		const scan_lines = log_spy.mock.calls.filter(call => call[0] === 'debug' && call[1] === 'runScan').map(call => String(call[2]));
		expect(scan_lines).toHaveLength(1);
		const line_diff_ms = Number(/line diffs (\d+)ms/.exec(scan_lines[0])?.[1]);
		expect(line_diff_ms).toBeGreaterThanOrEqual(1000);
		expect(line_diff_ms).toBeLessThan(2000);
		log_spy.mockRestore();
	});

	it('falls back to computing the batch on the host when the line-diff worker round trip fails, without failing the rest of the scan', async () => {
		wireOneRepoWithModifiedFile('a\nb\nc\n', 'a\nx\nc\n');
		const analyser = new AgentAnalyser(mockContext(), lineDiffFailingWorkerFactory());
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(uncommittedFrom(posted)).toMatchObject([{ path: CHANGED_PATH, added: 1, removed: 1 }]);
		expect((posted[posted.length - 1].activity as { analyser: { state: string } }).analyser.state).toBe('live');
	});
});

describe('AgentAnalyser line diff cost across batches', () => {
	const REPO_ROOT = '/ws';
	const CHANGED_PATH = 'src/foo.ts';

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		(vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: Uri.file(REPO_ROOT), name: 'ws', index: 0 }];
	});

	afterEach(() => {
		jest.useRealTimers();
		(vscode.commands.getCommands as jest.Mock).mockResolvedValue([]);
		(vscode.commands.executeCommand as jest.Mock).mockReset();
	});

	// a batched scan is several timer/microtask hops deeper, so this settles longer than the single-batch helper elsewhere
	async function settle(rounds = 20): Promise<void> {
		for (let i = 0; i < rounds; i++) { await jest.advanceTimersByTimeAsync(0); }
	}

	// enough sessions to spill into a second batch (AGENT_FIRST_BATCH_MAX_JOBS 8), none touching the changed file
	function mockManySessionsAndOneChangedFile(session_ids: string[], old_text: string, new_text: string): void {
		const project_dir_for = (id: string): string => `proj-${id}`;
		const transcript_path_for = (id: string): string => `${CLAUDE_PROJECTS_DIR}/${project_dir_for(id)}/${id}.jsonl`;
		const bytes = new TextEncoder().encode(claudeTranscriptLine('Read'));
		const now = Date.now();
		const mtime_of = new Map(session_ids.map((id, i) => [id, now - i * 1000]));
		wireGitCommands({ [REPO_ROOT]: { workingTreeChanges: [{ path: `${REPO_ROOT}/${CHANGED_PATH}`, status: 'MODIFIED' }], HEAD: { name: 'staging', commit: 'a'.repeat(40) } } });
		(vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_PROJECTS_DIR) { return session_ids.map(id => [project_dir_for(id), vscode.FileType.Directory]); }
			const owner = session_ids.find(id => uri.path === `${CLAUDE_PROJECTS_DIR}/${project_dir_for(id)}`);
			return owner ? [[`${owner}.jsonl`, vscode.FileType.File]] : [];
		});
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === `${REPO_ROOT}/${CHANGED_PATH}`) { return { type: 1, ctime: 0, mtime: 1000, size: new_text.length }; }
			const owner = session_ids.find(id => uri.path === transcript_path_for(id));
			if (owner) { return { type: 1, ctime: 0, mtime: mtime_of.get(owner), size: bytes.byteLength }; }
			throw new Error('not found');
		});
		(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.scheme === 'git') { return new TextEncoder().encode(old_text); }
			if (uri.path === `${REPO_ROOT}/${CHANGED_PATH}`) { return new TextEncoder().encode(new_text); }
			const owner = session_ids.find(id => uri.path === transcript_path_for(id));
			if (owner) { return bytes; }
			throw new Error('not found');
		});
	}

	function uncommittedFrom(posted: Array<Record<string, unknown>>): Array<{ path: string; added?: number; removed?: number }> {
		const last = posted[posted.length - 1];
		const trees = (last.activity as { trees: Array<{ tree: { uncommitted: Array<{ path: string; added?: number; removed?: number }> } }> }).trees;
		return trees[0]?.tree.uncommitted ?? [];
	}

	it('diffs the working tree once per scan, not once per batch, when discovery spills into more than one batch', async () => {
		const session_ids = Array.from({ length: 9 }, (_, i) => `s${i}`);
		mockManySessionsAndOneChangedFile(session_ids, 'a\nb\nc\n', 'a\nx\nc\n');
		const recording = recordingWorkerFactory();
		const analyser = new AgentAnalyser(mockContext(), recording.worker, 1);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(sessionIdsFrom(posted).length).toBe(9);
		// 9 sessions with AGENT_FIRST_BATCH_MAX_JOBS 8 means this scan's session round trip runs in exactly two batches
		const session_batch_requests = recording.requests.filter(request => request.jobs.length > 0);
		expect(session_batch_requests.length).toBe(2);
		// the line-diff round trip is not per-batch: every batch shares the same fresh/stale flag, so 2 batches make one
		const line_diff_requests = recording.requests.filter(request => request.line_diff_jobs !== undefined);
		expect(line_diff_requests).toHaveLength(1);
		expect(uncommittedFrom(posted)).toMatchObject([{ path: CHANGED_PATH, added: 1, removed: 1 }]);
	});

	// this analyser already has a completed scan, so the rescan's internal batches never reach an interim post
	it('a rescan spanning two batches posts once, straight to live, with correct line diff counts', async () => {
		// first scan: nine sessions is already two batches, and warms the line-diff cache
		const first_session_ids = Array.from({ length: 9 }, (_, i) => `s${i}`);
		mockManySessionsAndOneChangedFile(first_session_ids, 'a\nb\nc\n', 'a\nx\nc\n');
		const recording = recordingWorkerFactory();
		const analyser = new AgentAnalyser(mockContext(), recording.worker, 1);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(uncommittedFrom(posted)).toMatchObject([{ path: CHANGED_PATH, added: 1, removed: 1 }]);
		const before_rescan = posted.length;

		// second scan: nine original sessions are reused unchanged, and nine new ones spill into a second batch
		const fresh_session_ids = Array.from({ length: 9 }, (_, i) => `fresh-${i}`);
		mockManySessionsAndOneChangedFile([...first_session_ids, ...fresh_session_ids], 'a\nb\nc\n', 'a\nx\nc\n');
		await jest.advanceTimersByTimeAsync(15_000); // AGENT_RESCAN_INTERVAL_MS
		await settle();

		const rescan_posts = posted.slice(before_rescan);
		expect(rescan_posts).toHaveLength(1);
		expect((rescan_posts[0].activity as { analyser: { state: string } }).analyser.state).toBe('live');
		expect(uncommittedFrom(rescan_posts)).toMatchObject([{ path: CHANGED_PATH, added: 1, removed: 1 }]);
		// the working file never changed between scans, so the cache stays valid and both scans total one round trip
		const line_diff_requests_total = recording.requests.filter(request => request.line_diff_jobs !== undefined).length;
		expect(line_diff_requests_total).toBe(1);
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

	// a turn that edits the board and carries its own usage, like Claude Code's message.usage sitting on the tool_use record
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

	// a MultiEdit touching both stories' sections in one call, splitting its usage evenly between them
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

describe('AgentAnalyser newest-first batching', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		(vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([]);
		(vscode.workspace.fs.readFile as jest.Mock).mockRejectedValue(new Error('no such file'));
		(vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: Uri.file('/ws'), name: 'ws', index: 0 }];
	});

	afterEach(() => { jest.useRealTimers(); });

	// a batched scan is several hops deeper (one round trip per batch, folded before the next), so this settles longer
	async function settle(rounds = 20): Promise<void> {
		for (let i = 0; i < rounds; i++) { await jest.advanceTimersByTimeAsync(0); }
	}

	// one transcript per session, no subagents, no pid file - none of that matters to a test about ordering and posting
	function mockClaudeCodeSessions(sessions: ReadonlyArray<{ id: string; mtime: number }>): void {
		const project_dir_for = (id: string): string => `proj-${id}`;
		const transcript_path_for = (id: string): string => `${CLAUDE_PROJECTS_DIR}/${project_dir_for(id)}/${id}.jsonl`;
		const bytes = new TextEncoder().encode(claudeTranscriptLine('Edit'));
		(vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_PROJECTS_DIR) { return sessions.map(s => [project_dir_for(s.id), vscode.FileType.Directory]); }
			const match = sessions.find(s => uri.path === `${CLAUDE_PROJECTS_DIR}/${project_dir_for(s.id)}`);
			if (match) { return [[`${match.id}.jsonl`, vscode.FileType.File]]; }
			return [];
		});
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			const match = sessions.find(s => uri.path === transcript_path_for(s.id));
			if (match) { return { type: 1, ctime: 0, mtime: match.mtime, size: bytes.byteLength }; }
			throw new Error('not found');
		});
		(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			const match = sessions.find(s => uri.path === transcript_path_for(s.id));
			if (match) { return bytes; }
			throw new Error('not found');
		});
	}

	function statesFrom(posted: Array<Record<string, unknown>>): string[] {
		return posted.map(p => (p.activity as { analyser: { state: string } }).analyser.state);
	}

	function sessionCountsFrom(posted: Array<Record<string, unknown>>): number[] {
		return posted.map(p => (p.activity as { sessions: unknown[] }).sessions.length);
	}

	function totalInputTokensFrom(posted: Array<Record<string, unknown>>): number {
		const last = posted[posted.length - 1];
		const sessions = (last.activity as { sessions: Array<{ session: { usage?: { input_tokens?: number } } }> }).sessions;
		return sessions.reduce((sum, s) => sum + (s.session.usage?.input_tokens ?? 0), 0);
	}

	it('posts the newest 8 sessions in a first, still-scanning batch, then the rest as a final live batch, with no session lost or duplicated', async () => {
		const now = Date.now();
		// s0 newest, s9 oldest by mtime; AGENT_FIRST_BATCH_MAX_JOBS (8) means the first batch is exactly s0-s7
		const sessions = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, mtime: now - i * 1000 }));
		// wired reversed (oldest first) so passing only works if the analyser sorts by mtime, not discovery order
		mockClaudeCodeSessions([...sessions].reverse());
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker, 1);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		const states = statesFrom(posted);
		expect(states[states.length - 1]).toBe('live');
		// exactly one intermediate post carried real sessions while still scanning - the newest batch
		const first_batch_index = posted.findIndex((p, i) => states[i] === 'scanning' && sessionCountsFrom(posted)[i] > 0);
		expect(first_batch_index).toBeGreaterThan(-1);
		const first_batch_ids = sessionIdsFrom(posted.slice(0, first_batch_index + 1));
		expect(new Set(first_batch_ids)).toEqual(new Set(sessions.slice(0, 8).map(s => s.id)));
		// the final, live post carries every session exactly once
		const final_ids = sessionIdsFrom(posted);
		expect(final_ids.length).toBe(10);
		expect(new Set(final_ids)).toEqual(new Set(sessions.map(s => s.id)));
		// totals match a single-pass scan of the same fixture: input_tokens 10 per session, nothing lost or double-counted
		expect(totalInputTokensFrom(posted)).toBe(10 * 10);
	});

	// reading pipelines one batch ahead: batch 2's files open once batch 1's read is collected, not after its round trip
	it('reads the second batch while the first batch\'s own worker round trip is still pending, not after it returns', async () => {
		const now = Date.now();
		const sessions = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, mtime: now - i * 1000 }));
		mockClaudeCodeSessions(sessions);
		const controllable = controllableWorkerFactory();
		const analyser = new AgentAnalyser(mockContext(), controllable.worker, 1);
		analyser.demand(jest.fn());
		// discovery, the first batch's read and its postMessage all happen here, with the worker never released
		await settle();
		const read_paths = (vscode.workspace.fs.readFile as jest.Mock).mock.calls.map(call => (call[0] as vscode.Uri).path);
		// s8 and s9 (batch 2, AGENT_FIRST_BATCH_MAX_JOBS 8) are already read, despite batch 1's round trip still being held open
		expect(read_paths.some(path => path.endsWith('/s8.jsonl'))).toBe(true);
		expect(read_paths.some(path => path.endsWith('/s9.jsonl'))).toBe(true);
		controllable.release();
		await settle();
		controllable.release();
		await settle();
	});

	// batching decides off each candidate's stat-reported size, never bytes read later, so a fake large size exercises the cap
	it('sizes a later batch off the pool\'s own worker count, not a flat cap that ignores how many workers exist', async () => {
		const now = Date.now();
		const sessions = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, mtime: now - i * 1000 }));
		mockClaudeCodeSessions(sessions);
		const FAKE_SESSION_BYTES = 5 * 1024 * 1024;
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			const match = sessions.find(s => uri.path === `${CLAUDE_PROJECTS_DIR}/proj-${s.id}/${s.id}.jsonl`);
			if (match) { return { type: 1, ctime: 0, mtime: match.mtime, size: FAKE_SESSION_BYTES }; }
			throw new Error('not found');
		});
		// pool_size 4 gives a later batch a 4 x 32MB = 128MB cap, so 8 sessions at 5MB each (40MB) fit in one batch, not two
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker, 4);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		const states = statesFrom(posted);
		expect(states[states.length - 1]).toBe('live');
		// one intermediate 'scanning' post carries sessions: the oversized one gets its own batch, then the rest land in one
		const scanning_batches_with_sessions = states.filter((s, i) => s === 'scanning' && sessionCountsFrom(posted)[i] > 0).length;
		expect(scanning_batches_with_sessions).toBe(1);
		expect(sessionIdsFrom(posted).length).toBe(9);
	});

	// a reused session folds into the rescan's first batch, but only the rescan's final post reaches a subscriber
	it('a rescan spanning two batches posts once, straight to live, with the reused session included alongside every fresh one', async () => {
		const now = Date.now();
		const reused_id = 'reused-1';
		// warm the cache for one session on an ordinary first scan
		mockClaudeCodeSessions([{ id: reused_id, mtime: now - 100_000 }]);
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker, 1);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(sessionIdsFrom(posted)).toEqual([reused_id]);
		const before_rescan = posted.length;

		// nine new sessions arrive alongside the reused one, enough to spill into a second batch (AGENT_FIRST_BATCH_MAX_JOBS 8)
		const fresh = Array.from({ length: 9 }, (_, i) => ({ id: `fresh-${i}`, mtime: now - i * 1000 }));
		mockClaudeCodeSessions([{ id: reused_id, mtime: now - 100_000 }, ...fresh]);
		await jest.advanceTimersByTimeAsync(15_000); // AGENT_RESCAN_INTERVAL_MS
		await settle();

		const rescan_posts = posted.slice(before_rescan);
		expect(rescan_posts).toHaveLength(1);
		expect((rescan_posts[0].activity as { analyser: { state: string } }).analyser.state).toBe('live');
		expect(new Set(sessionIdsFrom(rescan_posts))).toEqual(new Set([reused_id, ...fresh.map(s => s.id)]));
		expect(sessionIdsFrom(posted).length).toBe(10);
	});

	it('a session that deterministically crashes the parser fails the scan after one retry, never looping, and keeps whatever the last good batch already posted', async () => {
		const now = Date.now();
		// s0-s7 land in batch 1 (always succeeds); s8-s9 land in batch 2, which always fails because s8's job is poisoned
		const sessions = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, mtime: now - i * 1000 }));
		mockClaudeCodeSessions(sessions);
		const analyser = new AgentAnalyser(mockContext(), poisonSessionWorkerFactory('s8'), 1);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		// the retry's setTimeout needs an explicit elapsed-time jump to fire under fake timers, not settle()'s zero-ms bumps
		await settle();
		await jest.advanceTimersByTimeAsync(0);
		await jest.advanceTimersByTimeAsync(5_000);
		await settle();
		const states = statesFrom(posted);
		expect(states[states.length - 1]).toBe('failed');
		// the board still shows the 8 sessions the last good batch posted, not wiped to empty by the failure
		const final_ids = sessionIdsFrom(posted);
		expect(new Set(final_ids)).toEqual(new Set(sessions.slice(0, 8).map(s => s.id)));
		// bounded to two posts carrying those 8 sessions: the first attempt's batch-1 post, and the retry's failed-state post
		const eight_session_posts = sessionCountsFrom(posted).filter(count => count === 8).length;
		expect(eight_session_posts).toBe(2);
	});
});

describe('AgentAnalyser session fold caching', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		(vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([]);
		(vscode.workspace.fs.readFile as jest.Mock).mockRejectedValue(new Error('no such file'));
		(vscode.commands.getCommands as jest.Mock).mockResolvedValue([]);
		(vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [];
	});

	afterEach(() => { jest.useRealTimers(); });

	async function settle(rounds = 10): Promise<void> {
		for (let i = 0; i < rounds; i++) { await jest.advanceTimersByTimeAsync(0); }
	}

	// no subagents, no live pid file - none of that matters here; mtime is a param so a rescan can match what it cached
	function mockClaudeCodeSessions(ids: string[], mtime = Date.now() - 60_000): void {
		const project_dir_for = (id: string): string => `proj-${id}`;
		const transcript_path_for = (id: string): string => `${CLAUDE_PROJECTS_DIR}/${project_dir_for(id)}/${id}.jsonl`;
		const bytes = new TextEncoder().encode(claudeTranscriptLine('Edit'));
		(vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_PROJECTS_DIR) { return ids.map(id => [project_dir_for(id), vscode.FileType.Directory]); }
			const owner = ids.find(id => uri.path === `${CLAUDE_PROJECTS_DIR}/${project_dir_for(id)}`);
			return owner ? [[`${owner}.jsonl`, vscode.FileType.File]] : [];
		});
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			const owner = ids.find(id => uri.path === transcript_path_for(id));
			if (owner) { return { type: 1, ctime: 0, mtime, size: bytes.byteLength }; }
			throw new Error('not found');
		});
		(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			const owner = ids.find(id => uri.path === transcript_path_for(id));
			if (owner) { return bytes; }
			throw new Error('not found');
		});
	}

	// a fold's expensive part scales with session history; session_fold_cache skips it when the file hasn't changed
	it('skips re-binding a reused session to its story on a rescan where nothing changed', async () => {
		mockClaudeCodeSessions(['s0', 's1', 's2']);
		const bind_spy = jest.spyOn(AgentAnalyser.prototype as unknown as { toActivitySession: () => unknown }, 'toActivitySession');
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(bind_spy).toHaveBeenCalledTimes(3);
		bind_spy.mockClear();

		// a rescan where every session's file is byte-identical to last time, and no story board or repo root changed
		await jest.advanceTimersByTimeAsync(15_000); // AGENT_RESCAN_INTERVAL_MS
		await settle();
		expect(bind_spy).toHaveBeenCalledTimes(0);
		bind_spy.mockRestore();
	});

	// the git extension opens repositories after activation; one appearing must not re-bind every unchanged session
	it('keeps a reused session\'s binding cached when a repository opens between scans', async () => {
		mockClaudeCodeSessions(['s0', 's1']);
		wireGitCommands({ '/repo-a': { workingTreeChanges: [] } });
		const bind_spy = jest.spyOn(AgentAnalyser.prototype as unknown as { toActivitySession: () => unknown }, 'toActivitySession');
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		const treeCount = (): number => (posted[posted.length - 1].activity as { trees: unknown[] }).trees.length;
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(treeCount()).toBe(1);
		expect(bind_spy).toHaveBeenCalledTimes(2);
		bind_spy.mockClear();

		wireGitCommands({ '/repo-a': { workingTreeChanges: [] }, '/repo-b': { workingTreeChanges: [] } });
		await jest.advanceTimersByTimeAsync(15_000);
		await settle();
		expect(treeCount()).toBe(2);
		expect(bind_spy).toHaveBeenCalledTimes(0);
		bind_spy.mockRestore();
	});

	// one board-editing tool call, as an absolute path so workspaceRelative resolves regardless of cwd guessing
	function claudeBoardEditLine(board_path: string): string {
		return JSON.stringify({
			type: 'assistant',
			timestamp: '2026-09-22T11:00:00Z',
			message: {
				id: 'm1', role: 'assistant', model: 'claude-sonnet-5',
				content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: board_path, old_string: '+ [ ] task', new_string: '+ [X] task' } }],
				usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
			},
		});
	}

	// a board edit forces a re-bind only for sessions whose write call targets it; a different (or no) board is unaffected
	it('recomputes a reused session\'s binding once the board it wrote to changes, but leaves an unrelated session\'s binding alone', async () => {
		const mtime = Date.now() - 60_000;
		const board_path = '/ws/docstech/users/alex/todo.md';
		const board_line = claudeBoardEditLine(board_path);
		const other_line = claudeTranscriptLine('Edit'); // targets src/foo.ts, no board at all
		(vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: Uri.file('/ws'), name: 'ws', index: 0 }];
		const transcript_for = (id: string): string => (id === 's0' ? board_line : other_line);
		const wireSessions = (todo_text: string | undefined): void => {
			(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
				if (uri.path === `${CLAUDE_PROJECTS_DIR}/proj-s0/s0.jsonl` || uri.path === `${CLAUDE_PROJECTS_DIR}/proj-s1/s1.jsonl`) {
					const id = uri.path.includes('proj-s0') ? 's0' : 's1';
					return { type: 1, ctime: 0, mtime, size: new TextEncoder().encode(transcript_for(id)).byteLength };
				}
				if (uri.path === '/ws/docstech/users') { return { type: 2, ctime: 0, mtime: 0, size: 0 }; }
				throw new Error('not found');
			});
			(vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
				if (uri.path === CLAUDE_PROJECTS_DIR) { return ['s0', 's1'].map(id => [`proj-${id}`, vscode.FileType.Directory]); }
				if (uri.path === `${CLAUDE_PROJECTS_DIR}/proj-s0` || uri.path === `${CLAUDE_PROJECTS_DIR}/proj-s1`) {
					const id = uri.path.endsWith('s0') ? 's0' : 's1';
					return [[`${id}.jsonl`, vscode.FileType.File]];
				}
				if (uri.path === '/ws/docstech/users') { return todo_text !== undefined ? [['alex', vscode.FileType.Directory]] : []; }
				return [];
			});
			(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
				if (uri.path === `${CLAUDE_PROJECTS_DIR}/proj-s0/s0.jsonl`) { return new TextEncoder().encode(board_line); }
				if (uri.path === `${CLAUDE_PROJECTS_DIR}/proj-s1/s1.jsonl`) { return new TextEncoder().encode(other_line); }
				if (uri.path === board_path && todo_text !== undefined) { return new TextEncoder().encode(todo_text); }
				throw new Error('not found');
			});
		};
		wireSessions(undefined);
		const bind_spy = jest.spyOn(AgentAnalyser.prototype as unknown as { toActivitySession: () => unknown }, 'toActivitySession');
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		expect(bind_spy).toHaveBeenCalledTimes(2);
		bind_spy.mockClear();

		// the board s0 wrote to now exists with real content; s1 never touched any board
		wireSessions('# Todo\n\n\n### A story [](?id=my-story)\n\n+ [ ] task\n');
		await jest.advanceTimersByTimeAsync(15_000);
		await settle();
		// only s0 - whose write call targets this board - needs its binding recomputed; s1 stays cached
		expect(bind_spy).toHaveBeenCalledTimes(1);
		bind_spy.mockRestore();
	});
});

describe('AgentAnalyser discovery concurrency', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		(vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([]);
		(vscode.workspace.fs.readFile as jest.Mock).mockRejectedValue(new Error('no such file'));
		(vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [];
	});

	afterEach(() => { jest.useRealTimers(); });

	// a batched, concurrent scan is several hops deeper, so this settles longer than the single-batch helper elsewhere
	async function settle(rounds = 20): Promise<void> {
		for (let i = 0; i < rounds; i++) { await jest.advanceTimersByTimeAsync(0); }
	}

	// no subagents, no live pid file - none of that matters here; this is only about discovery concurrency
	function mockManySessions(ids: string[]): void {
		const project_dir_for = (id: string): string => `proj-${id}`;
		const transcript_path_for = (id: string): string => `${CLAUDE_PROJECTS_DIR}/${project_dir_for(id)}/${id}.jsonl`;
		const bytes = new TextEncoder().encode(claudeTranscriptLine('Edit'));
		(vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			if (uri.path === CLAUDE_PROJECTS_DIR) { return ids.map(id => [project_dir_for(id), vscode.FileType.Directory]); }
			const owner = ids.find(id => uri.path === `${CLAUDE_PROJECTS_DIR}/${project_dir_for(id)}`);
			return owner ? [[`${owner}.jsonl`, vscode.FileType.File]] : [];
		});
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			const owner = ids.find(id => uri.path === transcript_path_for(id));
			if (owner) { return { type: 1, ctime: 0, mtime: Date.now(), size: bytes.byteLength }; }
			throw new Error('not found');
		});
		(vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			const owner = ids.find(id => uri.path === transcript_path_for(id));
			if (owner) { return bytes; }
			throw new Error('not found');
		});
	}

	// discovery cost dominates a warm rescan once the fold side is cheap, since a real history holds many sessions to stat
	it('stats AGENT_DISCOVERY_STAT_CONCURRENCY sessions at once during a cold scan, not one at a time', async () => {
		const ids = Array.from({ length: 100 }, (_, i) => `s${i}`);
		mockManySessions(ids);
		const pending: Array<() => void> = [];
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation((uri: vscode.Uri) => new Promise(resolve => {
			const owner = ids.find(id => uri.path === `${CLAUDE_PROJECTS_DIR}/proj-${id}/${id}.jsonl`);
			if (!owner) { resolve({ type: 1, ctime: 0, mtime: Date.now(), size: 1 }); return; }
			pending.push(() => resolve({ type: 1, ctime: 0, mtime: Date.now(), size: 10 }));
		}));
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		analyser.demand(jest.fn());
		await settle();
		// exactly one concurrency-wide batch of stats is ever in flight - neither all 100 at once nor one at a time
		expect(pending.length).toBe(64); // AGENT_DISCOVERY_STAT_CONCURRENCY
		for (const resolve of pending) { resolve(); }
		await settle();
	});

	// the first post should pay only the slowest of discovery, story boards and git trees, not their sum
	it('reads git trees while discovery is still statting sessions', async () => {
		mockManySessions(['s0']);
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation(() => new Promise(() => undefined));
		wireGitCommands({ '/repo-a': { workingTreeChanges: [] } });
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		analyser.demand(jest.fn());
		await settle();
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('git.api.getRepositories');
	});

	it('classifies every session correctly regardless of the order its own concurrent stat call resolves in', async () => {
		const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
		mockManySessions(ids);
		const resolvers: Array<(value: { type: number; ctime: number; mtime: number; size: number }) => void> = [];
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation((uri: vscode.Uri) => new Promise(resolve => {
			const owner = ids.find(id => uri.path === `${CLAUDE_PROJECTS_DIR}/proj-${id}/${id}.jsonl`);
			if (!owner) { resolve({ type: 1, ctime: 0, mtime: 0, size: 0 }); return; }
			resolvers.push(resolve);
		}));
		const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
		const posted: Array<Record<string, unknown>> = [];
		analyser.demand(msg => posted.push(msg));
		await settle();
		// stats resolve in reverse dispatch order, proving out-of-order completion still reads and posts every session
		for (const resolve of [...resolvers].reverse()) { resolve({ type: 1, ctime: 0, mtime: Date.now(), size: 10 }); }
		await settle();
		expect(new Set(sessionIdsFrom(posted))).toEqual(new Set(ids));
	});

	it('bounds AGENT_FILE_STAT_MAX_ENTRIES to at most one concurrent batch of overshoot, never to the whole candidate set', async () => {
		setFileStatMaxEntriesForTest(3);
		try {
			const ids = Array.from({ length: 100 }, (_, i) => `s${i}`);
			mockManySessions(ids);
			const analyser = new AgentAnalyser(mockContext(), fakeWorkerFactory().worker);
			const posted: Array<Record<string, unknown>> = [];
			analyser.demand(msg => posted.push(msg));
			await settle();
			// the cap is checked once per session; a batch already past it when crossed still lands, bounding it by concurrency
			expect(sessionIdsFrom(posted).length).toBe(64); // AGENT_DISCOVERY_STAT_CONCURRENCY
		} finally {
			setFileStatMaxEntriesForTest(undefined);
		}
	});
});
