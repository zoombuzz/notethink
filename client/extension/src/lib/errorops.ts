import type { TransformFunction } from "logform";
import * as util from 'util';
import * as vscode from 'vscode';
import * as winston from "winston";
import { LogOutputChannelTransport } from 'winston-transport-vscode';

const LOG_SOURCE_MAX_LEN = 24;
// the host's client-error receiver; relative so a hosted build POSTs same-origin with no URL config
const CLIENT_ERROR_ENDPOINT = '/api/client-error';
// per-field cap matching the receiver so the POST body stays well under its size limit
const CLIENT_ERROR_FIELD_MAX = 4000;
const output_channel = vscode.window.createOutputChannel('NoteThink', {
    log: true,
});

// --- file log: buffer lines and flush to the extension's standard VS Code log dir ---
const LOG_BUFFER_MAX = 2000;
const LOG_FLUSH_MS = 1000;
const LOG_FILE_NAME = 'notethink-extension.log';
const logBuffer: string[] = [];
let logFlushTimer: ReturnType<typeof setTimeout> | undefined;

/*
 * the extension's standard log directory (vscode.ExtensionContext.logUri), set by initLogDir at activation
 * this is the canonical VS Code-managed place for extension log files - NEVER the user's open workspace folder
 * it resolves under the rotating session logs dir (~/.config/Code/logs/<session>/window<N>/exthost/webWorker/NoteThink.notethink/ on Linux)
 * VS Code guarantees logUri's parent exists but not logUri itself, so we create it once
 */
let logDir: vscode.Uri | undefined;

/**
 * pin the file log to the extension's standard log directory. Call once from activate() with
 * context.logUri. Creates the directory (logUri may not exist yet) so the first flush succeeds.
 */
export function initLogDir(log_uri: vscode.Uri): void {
    logDir = log_uri;
    vscode.workspace.fs.createDirectory(log_uri).then(undefined, () => {});
}

function flushLogBuffer(): void {
    logFlushTimer = undefined;
    if (logBuffer.length === 0 || !logDir) { return; }
    const logUri = vscode.Uri.joinPath(logDir, LOG_FILE_NAME);
    const content = logBuffer.join('\n') + '\n';
    // fire-and-forget; never block logging on I/O
    vscode.workspace.fs.writeFile(logUri, new TextEncoder().encode(content)).then(
        undefined,
        () => {} // silently ignore write failures
    );
}

function appendToFileLog(line: string): void {
    if (typeof NOTETHINK_DEV === 'undefined' || !NOTETHINK_DEV) { return; }
    logBuffer.push(line);
    if (logBuffer.length > LOG_BUFFER_MAX) {
        logBuffer.splice(0, logBuffer.length - LOG_BUFFER_MAX);
    }
    if (!logFlushTimer) {
        logFlushTimer = setTimeout(flushLogBuffer, LOG_FLUSH_MS);
    }
}

// polyfill for winston call to `setImmediate()` as undefined in browser, https://github.com/webpack/webpack/issues/8280
if (typeof global.setImmediate === 'undefined') {
    // @ts-ignore method signature doesn't exactly match Node.js `setImmediate()`
    global.setImmediate = (action) => {
        setTimeout(action, 1);
    };
}

// https://stackoverflow.com/a/78208018/1444233
const combineTransform: TransformFunction = (info) => {
    const output = { ...info };
    const data = info[Symbol.for('splat')] as unknown[] | undefined;
    if (data) { output.message = util.format(String(info.message), ...data); }
    return output;
};

// default is full-fat comprehensive logging, but different format is used for some transports
const default_format = winston.format.combine(
    winston.format.timestamp({format: 'YYYY-MM-DD HH:mm:ss.SSS'}),
    winston.format.errors({stack: true}),
    winston.format(combineTransform)(),
    winston.format.printf(
        ({ level, message, timestamp, label }) =>
            `${level.toUpperCase().slice(-5).padEnd(5, ' ')} ${message}`,
    ),
    winston.format.colorize(),
);

// winston-transport-vscode does not export a public Transport type we can name here; the cast keeps the array element assignable to winston's transports option
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- documented escape hatch: winston-transport-vscode does not export a public Transport type
type TransportStream = any;
const transports = [
    new LogOutputChannelTransport({ outputChannel: output_channel }) as TransportStream,
];

const logger = winston.createLogger({
    level: 'trace',
    transports,
});

export function isRedirect(error: unknown): boolean {
    return error instanceof Response && error.status >= 300 && error.status < 400;
}

/**
 * Fatal errors are not translated
 * @param data
 * @param additional
 */
export function fatalError(data: string, additional: ResponseInit = {status: 500}): never {
    throw new Response(data, additional);
}

/**
 * (External) non-fatal errors should be returned to the client, translated and processed
 * @param field
 * @param type
 * @param tone
 * @param status
 */
export function nonFatalErrorReport(field: string, type: string, tone: string, status = 500): never {
    return fatalError(JSON.stringify(nonFatalErrorInternally(field, type, tone)), {status: status});
}

/**
 * Internally thrown errors should be caught (server-side) and processed
 * @param field
 * @param type
 * @param tone
 * @param status
 */
export function nonFatalErrorInternally(field: string, type: string, tone: string, status = 500): { errors: { field: string; type: string; tone: string } } {
    return {
        errors: {
            'field': field,
            'type': type,
            'tone': tone,
        }
    };
}

function formatFirstArg(arg: unknown, length: number): string {
    if (arg && typeof arg === 'string') {
        // don't include opening '['
        return arg.slice(-length).padStart(length, ' ') + ']';
    }
    return String(arg);
}

/**
 * Write to the log
 * @param level
 * @param {array} data
 * data[0] source
 * data[1] message description
 * data[2] abbreviated shop details (if available)
 */
export function writeToLogAtLevel(level: string, ...data: Array<unknown>): void {
    // format the first argument as a source
    const raw_data = [...data];
    let source = '';
    if (data[0]) {
        source = formatFirstArg(data.shift(), LOG_SOURCE_MAX_LEN);
    }
    logger.log(level, source, ...data);
    // mirror to file log for CLI access
    const ts = new Date().toISOString();
    const msg = raw_data.map(d => typeof d === 'string' ? d : JSON.stringify(d)).join(' ');
    appendToFileLog(`${ts} ${level.toUpperCase().padEnd(5)} ${msg}`);
}

export function writeToLog(...data: Array<unknown>): void {
    writeToLogAtLevel('info', ...data);
}

export function writeToErrorLog(...data: Array<unknown>): void {
    writeToLogAtLevel('error', ...data);
    try {
        const message = data.map(d => d instanceof Error ? d.message : (typeof d === 'string' ? d : JSON.stringify(d))).join(' ');
        const stack = (data.find(d => d instanceof Error) as Error | undefined)?.stack ?? '';
        sendClientError('notethink.writeToErrorLog', message, stack);
    } catch {
        // never let report-prep disturb logging
    }
}

/**
 * gated, fire-and-forget POST of a caught/logged error to the host's client-error receiver.
 * no-ops unless the build opted in via the NOTETHINK_CLIENT_ERROR_REPORTING define (guarded with
 * typeof so the absent symbol - e.g. under jest - is safe), and swallows every failure so reporting
 * can never disturb the logging path.
 */
function sendClientError(kind: string, message: string, stack: string): void {
    if (typeof NOTETHINK_CLIENT_ERROR_REPORTING === 'undefined' || !NOTETHINK_CLIENT_ERROR_REPORTING) { return; }
    try {
        const href = (globalThis as { location?: { href?: string } }).location?.href ?? '';
        const payload = JSON.stringify({
            kind,
            message: String(message || '(no message)').slice(0, CLIENT_ERROR_FIELD_MAX),
            stack: stack ? String(stack).slice(0, CLIENT_ERROR_FIELD_MAX) : '',
            href,
        });
        void fetch(CLIENT_ERROR_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
        }).catch(() => {});
    } catch {
        // reporting must never disturb the logging path
    }
}

/*
 * uncaught extension-host (webworker) errors never reach the host window, so hook the worker's own
 * global error / unhandledrejection handlers and forward them to the receiver with distinct kinds
 */
if (typeof NOTETHINK_CLIENT_ERROR_REPORTING !== 'undefined' && NOTETHINK_CLIENT_ERROR_REPORTING) {
    const worker_scope = globalThis as typeof globalThis & { addEventListener?: (type: string, listener: (event: unknown) => void) => void };
    if (typeof worker_scope.addEventListener === 'function') {
        worker_scope.addEventListener('error', (event: unknown) => {
            const e = event as { message?: string; error?: { stack?: string }; filename?: string; lineno?: number; colno?: number };
            sendClientError('notethink.self.onerror', e?.message ?? 'uncaught error', e?.error?.stack ?? `${e?.filename ?? ''}:${e?.lineno ?? ''}:${e?.colno ?? ''}`);
        });
        worker_scope.addEventListener('unhandledrejection', (event: unknown) => {
            const reason = (event as { reason?: { message?: string; stack?: string } })?.reason ?? {};
            sendClientError('notethink.unhandledrejection', reason.message ?? String(reason), reason.stack ?? '');
        });
    }
}

export function debug(...args: unknown[]): void {
	if (process.env.NODE_ENV !== 'production') {
		console.debug(...args);
	}
}
