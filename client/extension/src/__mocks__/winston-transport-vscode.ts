/**
 * Mock for winston-transport-vscode which depends on the vscode module.
 * Provides a minimal LogOutputChannelTransport that acts as a no-op transport.
 */
import Transport from 'winston-transport';

export class LogOutputChannelTransport extends Transport {
	constructor(opts?: any) {
		super(opts);
	}

	log(info: any, callback: () => void) {
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

	static format() {
		const { format } = require('winston');
		return format.simple();
	}
}
