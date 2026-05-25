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

	static file(path: string): Uri {
		return new Uri('file', '', path, '', '');
	}

	static parse(value: string): Uri {
		const match = value.match(/^([^:]+):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/);
		if (!match) { return new Uri('', '', value, '', ''); }
		return new Uri(match[1], match[2], match[3], (match[4] ?? '').replace(/^\?/, ''), (match[5] ?? '').replace(/^#/, ''));
	}

	static joinPath(base: Uri, ...pathSegments: string[]): Uri {
		return new Uri(base.scheme, base.authority, [base.path, ...pathSegments].join('/'), '', '');
	}

	toString(): string {
		return `${this.scheme}://${this.authority}${this.path}`;
	}
}

export class RelativePattern {
	readonly baseUri: Uri;
	readonly base: string;
	readonly pattern: string;

	constructor(base: Uri | string, pattern: string) {
		this.baseUri = typeof base === 'string' ? Uri.file(base) : base;
		this.base = this.baseUri.path;
		this.pattern = pattern;
	}
}

export class Disposable {
	constructor(private callOnDispose: () => void) {}
	dispose(): void { this.callOnDispose(); }
}

export class EventEmitter<T> {
	private listeners: Array<(e: T) => void> = [];
	event = (listener: (e: T) => void): Disposable => {
		this.listeners.push(listener);
		return new Disposable(() => {
			this.listeners = this.listeners.filter(l => l !== listener);
		});
	};
	fire(data: T): void {
		for (const listener of this.listeners) { listener(data); }
	}
	dispose(): void { this.listeners = []; }
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
	static FileNotFound(messageOrUri?: string | Uri): FileSystemError {
		const e = new FileSystemError(messageOrUri);
		(e as { code: string }).code = 'FileNotFound';
		return e;
	}
	static FileExists(messageOrUri?: string | Uri): FileSystemError {
		const e = new FileSystemError(messageOrUri);
		(e as { code: string }).code = 'FileExists';
		return e;
	}
	static FileNotADirectory(messageOrUri?: string | Uri): FileSystemError {
		const e = new FileSystemError(messageOrUri);
		(e as { code: string }).code = 'FileNotADirectory';
		return e;
	}
	static FileIsADirectory(messageOrUri?: string | Uri): FileSystemError {
		const e = new FileSystemError(messageOrUri);
		(e as { code: string }).code = 'FileIsADirectory';
		return e;
	}
	static NoPermissions(messageOrUri?: string | Uri): FileSystemError {
		const e = new FileSystemError(messageOrUri);
		(e as { code: string }).code = 'NoPermissions';
		return e;
	}
	static Unavailable(messageOrUri?: string | Uri): FileSystemError {
		const e = new FileSystemError(messageOrUri);
		(e as { code: string }).code = 'Unavailable';
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

	replace(uri: Uri, range: Range, newText: string): void {
		this._edits.push({ uri, range, newText });
	}

	insert(uri: Uri, position: Position, newText: string): void {
		this._edits.push({ uri, range: new Range(position, position), newText });
	}

	get edits(): Array<{ uri: Uri; range: Range; newText: string }> {
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

export enum ConfigurationTarget {
	Global = 1,
	Workspace = 2,
	WorkspaceFolder = 3,
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
	activeTextEditor: undefined as unknown,
	visibleTextEditors: [] as unknown[],
	onDidChangeTextEditorSelection: jest.fn(() => ({ dispose: jest.fn() })),
	onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
	onDidChangeVisibleTextEditors: jest.fn(() => ({ dispose: jest.fn() })),
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
	workspaceFolders: undefined as unknown,
	asRelativePath: jest.fn((pathOrUri: unknown) => {
		// default mock: return the path unchanged (no workspace folder to relativize against)
		const u = pathOrUri as { path?: string; toString?: () => string } | string | undefined;
		const p = typeof u === 'string' ? u : u?.path || u?.toString?.() || '';
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
 * The returned `panel` is typed as `unknown` because the production code accepts
 * `vscode.WebviewPanel`; tests cast it through `as unknown as vscode.WebviewPanel`.
 */
export interface MockWebviewPanelHelper {
	panel: unknown;
	postedMessages: Array<Record<string, unknown>>;
	simulateMessage: (msg: Record<string, unknown>) => Promise<void>;
	simulateDispose: () => void;
}

export function createMockWebviewPanel(): MockWebviewPanelHelper {
	const onDidReceiveMessageListeners: Array<(e: Record<string, unknown>) => void> = [];
	const onDidDisposeListeners: Array<() => void> = [];
	const onDidChangeViewStateListeners: Array<(e: Record<string, unknown>) => void> = [];
	const postedMessages: Array<Record<string, unknown>> = [];

	const panel = {
		active: true,
		webview: {
			options: {},
			html: '',
			postMessage: jest.fn((msg: Record<string, unknown>) => {
				postedMessages.push(msg);
				return Promise.resolve(true);
			}),
			onDidReceiveMessage: jest.fn((listener: (e: Record<string, unknown>) => void) => {
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
		onDidChangeViewState: jest.fn((listener: (e: Record<string, unknown>) => void) => {
			onDidChangeViewStateListeners.push(listener);
			return { dispose: jest.fn() };
		}),
	};

	return {
		panel,
		postedMessages,
		/** Simulate a message arriving from the webview */
		simulateMessage: async (msg: Record<string, unknown>): Promise<void> => {
			for (const listener of onDidReceiveMessageListeners) {
				await listener(msg);
			}
		},
		simulateDispose: (): void => {
			for (const listener of onDidDisposeListeners) {
				listener();
			}
		},
	};
}
