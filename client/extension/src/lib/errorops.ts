import {type TransformFunction} from "logform";
import * as winston from "winston";
import * as vscode from 'vscode';
import { LogOutputChannelTransport } from 'winston-transport-vscode';
import * as util from 'util';

const logSourceMaxLen = 24;
const outputChannel = vscode.window.createOutputChannel('NoteThink', {
    log: true,
});

// polyfill for winston call to `setImmediate()` as undefined in browser, https://github.com/webpack/webpack/issues/8280
if (typeof global.setImmediate === 'undefined') {
    // @ts-ignore method signature doesn't exactly match Node.js `setImmediate()`
    global.setImmediate = (action) => {
        setTimeout(action, 1);
    };
}

// https://stackoverflow.com/a/78208018/1444233
const combineTransform: TransformFunction = (info) => {
    const output: any = { ...info };
    const data: any = info[Symbol.for('splat')];
    if (data) { output.message = util.format(info.message, ...data); }
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

type TransportStream = /*unresolved*/ any
const transports = [
    // write out logs to stdout (console)
    new winston.transports.Console({
        level: 'info',
        format: default_format,
    }),
    // write out to the VSCode output channel
    // new LogOutputChannelTransport({ outputChannel }) as TransportStream,
];

const logger = winston.createLogger({
    level: 'trace',
    // use predefined VS Code log levels
    // levels: LogOutputChannelTransport.config.levels,
    // format: LogOutputChannelTransport.format(),
    transports,
});

export function isRedirect(error: any) {
    return error instanceof Response && error.status >= 300 && error.status < 400;
}

/**
 * Fatal errors are not translated
 * @param data
 * @param additional
 */
export function fatalError(data: string, additional: any = {status: 500}) {
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

function formatFirstArg(arg: any, length: number) {
    if (arg && typeof arg === 'string') {
        // don't include opening '['
        return arg.slice(-length).padStart(length, ' ') + ']';
    }
    return arg;
}

/**
 * Write to the log
 * @param level
 * @param {array} data
 * data[0] source
 * data[1] message description
 * data[2] abbreviated shop details (if available)
 */
export function writeToLogAtLevel(level: string, ...data: Array<any>) {
    // format the first argument as a source
    let source = '';
    if (data[0]) {
        source = formatFirstArg(data.shift(), logSourceMaxLen);
    }
    logger.log(level, source, ...data);
}

export function writeToLog(...data: Array<any>) {
    writeToLogAtLevel('info', ...data);
}

export function writeToErrorLog(...data: Array<any>) {
    writeToLogAtLevel('error', ...data);
}

export function debug(...args: any[]) {
	if (process.env.NODE_ENV !== 'production') {
		console.debug(...args);
	}
}
