import { writeToLog, writeToErrorLog, writeToLogAtLevel, debug, isRedirect, fatalError, nonFatalErrorInternally, nonFatalErrorReport } from './errorops';

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
			writeToErrorLog('source', 'boom');
			expect(fetch_mock).not.toHaveBeenCalled();
		});

		it('issues NO fetch when the define is false', () => {
			(globalThis as { NOTETHINK_CLIENT_ERROR_REPORTING?: boolean }).NOTETHINK_CLIENT_ERROR_REPORTING = false;
			writeToErrorLog('source', 'boom');
			expect(fetch_mock).not.toHaveBeenCalled();
		});

		it('issues exactly one POST to the receiver when the define is true', () => {
			(globalThis as { NOTETHINK_CLIENT_ERROR_REPORTING?: boolean }).NOTETHINK_CLIENT_ERROR_REPORTING = true;
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
			expect(() => writeToErrorLog('source', 'boom')).not.toThrow();
		});

		it('includes the stack in the body when passed an Error', () => {
			(globalThis as { NOTETHINK_CLIENT_ERROR_REPORTING?: boolean }).NOTETHINK_CLIENT_ERROR_REPORTING = true;
			writeToErrorLog('source', new Error('exploded'));
			const body = JSON.parse(fetch_mock.mock.calls[0][1].body);
			expect(body.stack).toContain('exploded');
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
