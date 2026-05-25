/**
 * Mock for winston-transport-vscode which depends on the vscode module.
 * Provides a minimal LogOutputChannelTransport that acts as a no-op transport.
 * Must extend Transport so winston can call .on() / .pipe() etc.
 */
import Transport, { type TransportStreamOptions } from 'winston-transport';
import type { format as WinstonFormat } from 'winston';

export class LogOutputChannelTransport extends Transport {
	constructor(opts?: Record<string, unknown>) {
		super(opts as TransportStreamOptions);
	}

	log(info: Record<string, unknown>, callback: () => void): void {
		if (callback) { callback(); }
	}

	static config = {
		levels: {
			error: 0,
			warn: 1,
			info: 2,
			debug: 3,
			trace: 4,
		},
	};

	static format(): ReturnType<typeof WinstonFormat.simple> {
		const { format } = require('winston');
		return format.simple();
	}
}
