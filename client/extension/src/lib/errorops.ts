import {type TransformFunction} from "logform";
import * as winston from "winston";
import * as vscode from 'vscode';
import { LogOutputChannelTransport } from 'winston-transport-vscode';
import * as util from 'util';

const LOG_SOURCE_MAX_LEN = 24;
const output_channel = vscode.window.createOutputChannel('NoteThink', {
    log: true,
});

// --- dev file log: buffer lines and flush to <notethink>/notethink-extension.log ---
const LOG_BUFFER_MAX = 500;
const LOG_FLUSH_MS = 1000;
const logBuffer: string[] = [];
let logFlushTimer: ReturnType<typeof setTimeout> | undefined;

function flushLogBuffer(): void {
    logFlushTimer = undefined;
    if (logBuffer.length === 0) { return; }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return; }
    // prefer a workspace folder whose path ends in /notethink, fall back to first folder
    const folder = folders.find(f => /[\/\\]notethink$/.test(f.uri.path)) ?? folders[0];
    const logUri = vscode.Uri.joinPath(folder.uri, 'notethink-extension.log');
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
export function nonFatalErrorReport(field: string, type: string, tone: string, status = 500) {
    return fatalError(JSON.stringify(nonFatalErrorInternally(field, type, tone)), {status: status});
}

/**
 * Internally thrown errors should be caught (server-side) and processed
 * @param field
 * @param type
 * @param tone
 * @param status
 */
export function nonFatalErrorInternally(field: string, type: string, tone: string, status = 500) {
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
}

export function debug(...args: unknown[]): void {
	if (process.env.NODE_ENV !== 'production') {
		console.debug(...args);
	}
}
