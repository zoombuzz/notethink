import * as vscode from 'vscode';
import { Uri } from '../__mocks__/vscode';
import { writeToLog, writeToErrorLog, writeToLogAtLevel, debug, isRedirect, fatalError, nonFatalErrorInternally, nonFatalErrorReport, errorLikeFields, initLogDir } from './errorops';

type ChannelSpy = { info: jest.Mock; error: jest.Mock; warn: jest.Mock; debug: jest.Mock; trace: jest.Mock };

/*
 * The channel errorops opened at module load. createOutputChannel is a jest.fn returning a fresh
 * object per call, so the handle has to come back off the first recorded result rather than a
 * second call, which would hand back a different channel.
 */
function loggedLines(level: keyof ChannelSpy): Array<string> {
	const create_mock = vscode.window.createOutputChannel as unknown as jest.Mock;
	const channel = create_mock.mock.results[0].value as ChannelSpy;
	return channel[level].mock.calls.map((call: Array<unknown>) => String(call[0]));
}

// the transport reaches the channel through a stream, so a line is not there on the next statement
function flushLogger(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

describe('errorops', () => {
	describe('writeToLog()', () => {
		it('does not throw when called with a single string', () => {
			expect(() => writeToLog('test message')).not.toThrow();
		});

		it('does not throw when called with multiple arguments', () => {
			expect(() => writeToLog('source', 'message', 'details')).not.toThrow();
		});

		it('does not throw when called with no arguments', () => {
			expect(() => writeToLog()).not.toThrow();
		});
	});

	describe('writeToErrorLog()', () => {
		it('does not throw when called with a string', () => {
			// eslint-disable-next-line no-restricted-syntax -- deliberately exercises the <3-arg path
			expect(() => writeToErrorLog('error message')).not.toThrow();
		});

		it('does not throw when called with source and error', () => {
			expect(() => writeToErrorLog('source', 'something failed', new Error('oops'))).not.toThrow();
		});
	});

	describe('writeToErrorLog() client-error forwarding', () => {
		// the worker-hook registers at module load; the define stays unset at import time, so the listeners are never added here
		let fetch_mock: jest.Mock;
		const HREF = 'https://example.test/viewer';

		beforeEach(() => {
			// sendClientError never reads the response, so a minimal stub avoids the Response-constructor's status validation
			fetch_mock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
			(globalThis as { fetch?: unknown }).fetch = fetch_mock;
			(globalThis as { location?: unknown }).location = { href: HREF };
		});

		afterEach(() => {
			delete (globalThis as { NOTETHINK_CLIENT_ERROR_REPORTING?: boolean }).NOTETHINK_CLIENT_ERROR_REPORTING;
			delete (globalThis as { fetch?: unknown }).fetch;
			delete (globalThis as { location?: unknown }).location;
		});

		it('issues NO fetch when the define is unset', () => {
			// eslint-disable-next-line no-restricted-syntax -- deliberately exercises the <3-arg path
			writeToErrorLog('source', 'boom');
			expect(fetch_mock).not.toHaveBeenCalled();
		});

		it('issues NO fetch when the define is false', () => {
			(globalThis as { NOTETHINK_CLIENT_ERROR_REPORTING?: boolean }).NOTETHINK_CLIENT_ERROR_REPORTING = false;
			// eslint-disable-next-line no-restricted-syntax -- deliberately exercises the <3-arg path
			writeToErrorLog('source', 'boom');
			expect(fetch_mock).not.toHaveBeenCalled();
		});

		it('issues exactly one POST to the receiver when the define is true', () => {
			(globalThis as { NOTETHINK_CLIENT_ERROR_REPORTING?: boolean }).NOTETHINK_CLIENT_ERROR_REPORTING = true;
			// eslint-disable-next-line no-restricted-syntax -- deliberately exercises the <3-arg path
			writeToErrorLog('source', 'boom');
			expect(fetch_mock).toHaveBeenCalledTimes(1);
			const [url, init] = fetch_mock.mock.calls[0];
			expect(url).toBe('/api/client-error');
			expect(init.method).toBe('POST');
			expect(init.keepalive).toBe(true);
			const body = JSON.parse(init.body);
			expect(body.kind).toBe('notethink.writeToErrorLog');
			expect(body.message).toContain('boom');
			expect(body.href).toBe(HREF);
		});

		it('does not throw when fetch rejects', () => {
			(globalThis as { NOTETHINK_CLIENT_ERROR_REPORTING?: boolean }).NOTETHINK_CLIENT_ERROR_REPORTING = true;
			fetch_mock.mockRejectedValue(new Error('network down'));
			// eslint-disable-next-line no-restricted-syntax -- deliberately exercises the <3-arg path
			expect(() => writeToErrorLog('source', 'boom')).not.toThrow();
		});

		it('includes the stack in the body when passed an Error', () => {
			(globalThis as { NOTETHINK_CLIENT_ERROR_REPORTING?: boolean }).NOTETHINK_CLIENT_ERROR_REPORTING = true;
			// eslint-disable-next-line no-restricted-syntax -- deliberately exercises the <3-arg path
			writeToErrorLog('source', new Error('exploded'));
			const body = JSON.parse(fetch_mock.mock.calls[0][1].body);
			expect(body.stack).toContain('exploded');
		});
	});

	/*
	 * These assertions verify more than that the call does not throw. writeToLogAtLevel shifts
	 * the source into winston's message slot, so every argument after it travels in splat, and both
	 * the logger's `levels` and its `format` have to be wired for any of it to reach the channel.
	 * Each test in this group exercises a different half of that requirement: drop `levels` and
	 * the transport gate discards the record entirely; drop `format` and only the source survives.
	 */
	describe('what actually reaches the output channel', () => {
		it('renders the description that follows the source', async () => {
			writeToLog('editText', '3 changes on /x/a.md');
			await flushLogger();
			expect(loggedLines('info')).toContainEqual(expect.stringContaining('3 changes on /x/a.md'));
		});

		it('renders the source alongside the description rather than in place of it', async () => {
			writeToLog('discoverFolderDocs', 'cap hit at 200 files');
			await flushLogger();
			const line = loggedLines('info').find(l => l.includes('cap hit at 200 files'));
			expect(line).toContain('discoverFolderDocs');
		});

		it('renders a third argument, which is where every writeToErrorLog call puts its error', async () => {
			writeToErrorLog('buildInitialDoc', 'failed to build initial document', new Error('EntryNotFound'));
			await flushLogger();
			expect(loggedLines('error')).toContainEqual(expect.stringContaining('EntryNotFound'));
		});

		it('routes a record to the channel method matching its level', async () => {
			writeToLogAtLevel('warn', 'settings', 'unknown setting foo');
			await flushLogger();
			expect(loggedLines('warn')).toContainEqual(expect.stringContaining('unknown setting foo'));
			expect(loggedLines('info')).not.toContainEqual(expect.stringContaining('unknown setting foo'));
		});

		it('reaches the channel at trace, the level winston has no default for', async () => {
			writeToLogAtLevel('trace', 'caretProbe', 'offset 412');
			await flushLogger();
			expect(loggedLines('trace')).toContainEqual(expect.stringContaining('offset 412'));
		});
	});

		/*
		 * writeToLogAtLevel's file-log formatter JSON.stringifies a non-string argument directly, and
		 * Error.prototype.message/.stack are non-enumerable own properties, so a bare Error collapses to
		 * "{}" without errorLikeFields extracting them first. errorLikeFields is the extraction every
		 * non-string file-log argument runs through; these test it directly since NOTETHINK_DEV (and so
		 * the whole buffered file-log write path) is off in this test environment.
		 */
		describe('errorLikeFields()', () => {
			it('extracts name, message and stack from an Error, none of which JSON.stringify sees on its own', () => {
				const fields = errorLikeFields(new Error('agent analyser worker timed out'));
				expect(fields).toMatchObject({ name: 'Error', message: 'agent analyser worker timed out' });
				expect(typeof fields?.stack).toBe('string');
				expect(JSON.stringify(fields)).not.toBe('{}');
			});

			it('preserves a subclass name, such as TypeError', () => {
				expect(errorLikeFields(new TypeError('bad input'))).toMatchObject({ name: 'TypeError', message: 'bad input' });
			});

			it('carries extra own-enumerable fields attached to an Error, such as an ErrorEvent\'s filename/lineno', () => {
				const err = Object.assign(new Error('agent analyser worker error'), { filename: 'agentAnalyserWorker.js', lineno: 42 });
				expect(errorLikeFields(err)).toMatchObject({ message: 'agent analyser worker error', filename: 'agentAnalyserWorker.js', lineno: 42 });
			});

			it('unwraps an ErrorEvent-like object (message/filename/lineno/error) into its parts', () => {
				const fake_error_event = { message: 'script error', filename: 'agentAnalyserWorker.js', lineno: 42, error: new Error('inner cause') };
				const fields = errorLikeFields(fake_error_event);
				expect(fields).toMatchObject({ message: 'script error', filename: 'agentAnalyserWorker.js', lineno: 42 });
				expect(fields?.error).toMatchObject({ message: 'inner cause' });
			});

			it('returns undefined for a plain object, leaving the caller\'s own JSON.stringify(d) in charge', () => {
				expect(errorLikeFields({ foo: 'bar' })).toBeUndefined();
			});
		});

		describe('the file log actually writes an Error\'s message, not "{}"', () => {
			beforeEach(() => {
				(globalThis as { NOTETHINK_DEV?: boolean }).NOTETHINK_DEV = true;
				jest.useFakeTimers();
			});

			afterEach(() => {
				jest.useRealTimers();
				delete (globalThis as { NOTETHINK_DEV?: boolean }).NOTETHINK_DEV;
			});

			it('flushes a buffered line containing the Error\'s message', async () => {
				initLogDir(Uri.file('/mock/logs'));
				writeToErrorLog('sendToWorker', 'agent analyser worker attempt 1 failed', new Error('agent analyser worker timed out'));
				await jest.advanceTimersByTimeAsync(1000);
				const write_mock = vscode.workspace.fs.writeFile as unknown as jest.Mock;
				const last_call = write_mock.mock.calls[write_mock.mock.calls.length - 1];
				const line = new TextDecoder().decode(last_call[1] as Uint8Array);
				expect(line).toContain('agent analyser worker timed out');
				expect(line).not.toContain('{}');
			});
		});

	describe('writeToLogAtLevel()', () => {
		it('does not throw for info level', () => {
			expect(() => writeToLogAtLevel('info', 'source', 'msg')).not.toThrow();
		});

		it('does not throw for error level', () => {
			expect(() => writeToLogAtLevel('error', 'source', 'msg')).not.toThrow();
		});

		it('does not throw for warn level', () => {
			expect(() => writeToLogAtLevel('warn', 'source', 'msg')).not.toThrow();
		});
	});

	describe('debug()', () => {
		let debugSpy: jest.SpiedFunction<typeof console.debug>;

		beforeEach(() => {
			debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
		});

		afterEach(() => {
			debugSpy.mockRestore();
		});

		it('does not throw', () => {
			expect(() => debug('test')).not.toThrow();
		});

		it('calls console.debug when not in production', () => {
			const origEnv = process.env.NODE_ENV;
			process.env.NODE_ENV = 'test';
			debug('hello', 'world');
			expect(debugSpy).toHaveBeenCalledWith('hello', 'world');
			process.env.NODE_ENV = origEnv;
		});

		it('does not call console.debug in production', () => {
			const origEnv = process.env.NODE_ENV;
			process.env.NODE_ENV = 'production';
			debug('should not appear');
			expect(debugSpy).not.toHaveBeenCalled();
			process.env.NODE_ENV = origEnv;
		});
	});

	describe('isRedirect()', () => {
		it('returns true for a Response with status 301', () => {
			const resp = new Response('', { status: 301 });
			expect(isRedirect(resp)).toBe(true);
		});

		it('returns true for a Response with status 302', () => {
			const resp = new Response('', { status: 302 });
			expect(isRedirect(resp)).toBe(true);
		});

		it('returns false for a Response with status 200', () => {
			const resp = new Response('', { status: 200 });
			expect(isRedirect(resp)).toBe(false);
		});

		it('returns false for a Response with status 404', () => {
			const resp = new Response('', { status: 404 });
			expect(isRedirect(resp)).toBe(false);
		});

		it('returns false for non-Response objects', () => {
			expect(isRedirect({ status: 301 })).toBe(false);
			expect(isRedirect(null)).toBe(false);
			expect(isRedirect(undefined)).toBe(false);
		});
	});

	describe('fatalError()', () => {
		it('throws a Response', () => {
			expect(() => fatalError('boom')).toThrow();
			try {
				fatalError('boom');
			} catch (err) {
				expect(err).toBeInstanceOf(Response);
				expect((err as Response).status).toBe(500);
			}
		});

		it('throws with custom status', () => {
			try {
				fatalError('not found', { status: 404 });
			} catch (err) {
				expect((err as Response).status).toBe(404);
			}
		});
	});

	describe('nonFatalErrorInternally()', () => {
		it('returns an error object with field, type, and tone', () => {
			const result = nonFatalErrorInternally('email', 'required', 'warning');
			expect(result).toEqual({
				errors: {
					field: 'email',
					type: 'required',
					tone: 'warning',
				},
			});
		});
	});

	describe('nonFatalErrorReport()', () => {
		it('throws a Response containing the error JSON', () => {
			expect(() => nonFatalErrorReport('name', 'invalid', 'error')).toThrow();
			try {
				nonFatalErrorReport('name', 'invalid', 'error');
			} catch (err) {
				expect(err).toBeInstanceOf(Response);
				expect((err as Response).status).toBe(500);
			}
		});

		it('throws with custom status', () => {
			try {
				nonFatalErrorReport('name', 'invalid', 'error', 422);
			} catch (err) {
				expect((err as Response).status).toBe(422);
			}
		});
	});
});
