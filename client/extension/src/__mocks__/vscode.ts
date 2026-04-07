/**
 * Minimal mock of the `vscode` module for jest unit tests.
 * Only the APIs actually used by the extension source code are stubbed here.
 */

export class Uri {
	readonly scheme: string;
	readonly authority: string;
	readonly path: string;
	readonly query: string;
	readonly fragment: string;
	readonly fsPath: string;

	private constructor(scheme: string, authority: string, path: string, query: string, fragment: string) {
		this.scheme = scheme;
		this.authority = authority;
		this.path = path;
		this.query = query;
		this.fragment = fragment;
		this.fsPath = path;
	}

	static file(path: string) {
		return new Uri('file', '', path, '', '');
	}

	static parse(value: string) {
		const match = value.match(/^([^:]+):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/);
		if (!match) { return new Uri('', '', value, '', ''); }
		return new Uri(match[1], match[2], match[3], (match[4] ?? '').replace(/^\?/, ''), (match[5] ?? '').replace(/^#/, ''));
	}

	static joinPath(base: Uri, ...pathSegments: string[]) {
		return new Uri(base.scheme, base.authority, [base.path, ...pathSegments].join('/'), '', '');
	}

	toString() {
		return `${this.scheme}://${this.authority}${this.path}`;
	}
}

export class Disposable {
	constructor(private callOnDispose: () => void) {}
	dispose() { this.callOnDispose(); }
}

export class EventEmitter<T> {
	private listeners: Array<(e: T) => void> = [];
	event = (listener: (e: T) => void) => {
		this.listeners.push(listener);
		return new Disposable(() => {
			this.listeners = this.listeners.filter(l => l !== listener);
		});
	};
	fire(data: T) {
		for (const listener of this.listeners) { listener(data); }
	}
	dispose() { this.listeners = []; }
}

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

export enum FileChangeType {
	Changed = 1,
	Created = 2,
	Deleted = 3,
}

export class FileSystemError extends Error {
	readonly code: string;
	constructor(messageOrUri?: string | Uri) {
		super(typeof messageOrUri === 'string' ? messageOrUri : messageOrUri?.toString());
		this.code = '';
	}
	static FileNotFound(messageOrUri?: string | Uri) {
		const e = new FileSystemError(messageOrUri);
		(e as any).code = 'FileNotFound';
		return e;
	}
	static FileExists(messageOrUri?: string | Uri) {
		const e = new FileSystemError(messageOrUri);
		(e as any).code = 'FileExists';
		return e;
	}
	static FileNotADirectory(messageOrUri?: string | Uri) {
		const e = new FileSystemError(messageOrUri);
		(e as any).code = 'FileNotADirectory';
		return e;
	}
	static FileIsADirectory(messageOrUri?: string | Uri) {
		const e = new FileSystemError(messageOrUri);
		(e as any).code = 'FileIsADirectory';
		return e;
	}
	static NoPermissions(messageOrUri?: string | Uri) {
		const e = new FileSystemError(messageOrUri);
		(e as any).code = 'NoPermissions';
		return e;
	}
	static Unavailable(messageOrUri?: string | Uri) {
		const e = new FileSystemError(messageOrUri);
		(e as any).code = 'Unavailable';
		return e;
	}
}

export class Position {
	constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
	constructor(public readonly start: Position, public readonly end: Position) {}
}

export class Selection {
	readonly anchor: Position;
	readonly active: Position;

	constructor(anchorOrLine: Position | number, activeOrChar: Position | number) {
		if (typeof anchorOrLine === 'number') {
			this.anchor = new Position(anchorOrLine, activeOrChar as number);
			this.active = new Position(anchorOrLine, activeOrChar as number);
		} else {
			this.anchor = anchorOrLine;
			this.active = activeOrChar as Position;
		}
	}
}

export class WorkspaceEdit {
	private _edits: Array<{ uri: Uri; range: Range; newText: string }> = [];

	replace(uri: Uri, range: Range, newText: string) {
		this._edits.push({ uri, range, newText });
	}

	insert(uri: Uri, position: Position, newText: string) {
		this._edits.push({ uri, range: new Range(position, position), newText });
	}

	get edits() {
		return this._edits;
	}
}

export enum TextEditorRevealType {
	Default = 0,
	InCenter = 1,
	InCenterIfOutsideViewport = 2,
	AtTop = 3,
}

export enum ViewColumn {
	Active = -1,
	Beside = -2,
	One = 1,
	Two = 2,
	Three = 3,
}

export enum QuickPickItemKind {
	Separator = -1,
	Default = 0,
}

export const window = {
	createOutputChannel: jest.fn(() => ({
		appendLine: jest.fn(),
		append: jest.fn(),
		clear: jest.fn(),
		show: jest.fn(),
		hide: jest.fn(),
		dispose: jest.fn(),
	})),
	registerCustomEditorProvider: jest.fn(),
	showInformationMessage: jest.fn(),
	showErrorMessage: jest.fn(),
	showWarningMessage: jest.fn(),
	showInputBox: jest.fn(),
	showQuickPick: jest.fn(),
	showTextDocument: jest.fn(),
	createWebviewPanel: jest.fn(),
	registerWebviewPanelSerializer: jest.fn(() => ({ dispose: jest.fn() })),
	activeTextEditor: undefined as any,
	visibleTextEditors: [] as any[],
	onDidChangeTextEditorSelection: jest.fn(() => ({ dispose: jest.fn() })),
	onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
};

export const workspace = {
	findFiles: jest.fn(async () => []),
	openTextDocument: jest.fn(),
	createFileSystemWatcher: jest.fn(() => ({
		onDidCreate: jest.fn(),
		onDidChange: jest.fn(),
		onDidDelete: jest.fn(),
		dispose: jest.fn(),
	})),
	onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
	applyEdit: jest.fn(async () => true),
	getWorkspaceFolder: jest.fn(() => undefined),
	workspaceFolders: undefined as any,
	asRelativePath: jest.fn((pathOrUri: any) => {
		// Default mock: return the path unchanged (no workspace folder to relativize against)
		const p = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri?.path || pathOrUri?.toString?.() || '';
		return p;
	}),
	getConfiguration: jest.fn(() => ({
		get: jest.fn(() => undefined),
		update: jest.fn(async () => {}),
	})),
	onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
	registerFileSystemProvider: jest.fn(() => ({ dispose: jest.fn() })),
	fs: {
		readFile: jest.fn(async () => new Uint8Array()),
		writeFile: jest.fn(async () => {}),
		stat: jest.fn(async () => ({ type: 1, ctime: 0, mtime: 0, size: 0 })),
	},
};

export const commands = {
	registerCommand: jest.fn(),
	executeCommand: jest.fn(),
};

export const env = {
	appName: '',
	openExternal: jest.fn(async () => true),
};

export const ExtensionContext = jest.fn();

/**
 * Helper: create a mock WebviewPanel for testing message handlers.
 */
export function createMockWebviewPanel() {
	const onDidReceiveMessageListeners: Array<(e: any) => void> = [];
	const onDidDisposeListeners: Array<() => void> = [];
	const onDidChangeViewStateListeners: Array<(e: any) => void> = [];
	const postedMessages: any[] = [];

	const panel: any = {
		active: true,
		webview: {
			options: {},
			html: '',
			postMessage: jest.fn((msg: any) => {
				postedMessages.push(msg);
				return Promise.resolve(true);
			}),
			onDidReceiveMessage: jest.fn((listener: (e: any) => void) => {
				onDidReceiveMessageListeners.push(listener);
				return { dispose: jest.fn() };
			}),
			asWebviewUri: jest.fn((uri: Uri) => uri),
			cspSource: 'https://test.csp.source',
		},
		onDidDispose: jest.fn((listener: () => void) => {
			onDidDisposeListeners.push(listener);
			return { dispose: jest.fn() };
		}),
		onDidChangeViewState: jest.fn((listener: (e: any) => void) => {
			onDidChangeViewStateListeners.push(listener);
			return { dispose: jest.fn() };
		}),
	};

	return {
		panel,
		postedMessages,
		/** Simulate a message arriving from the webview */
		simulateMessage: async (msg: any) => {
			for (const listener of onDidReceiveMessageListeners) {
				await listener(msg);
			}
		},
		simulateDispose: () => {
			for (const listener of onDidDisposeListeners) {
				listener();
			}
		},
	};
}
