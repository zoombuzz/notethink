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

	static joinPath(base: Uri, ...pathSegments: string[]) {
		return new Uri(base.scheme, base.authority, [base.path, ...pathSegments].join('/'), '', '');
	}

	toString() {
		return `${this.scheme}://${this.path}`;
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
};

export const commands = {
	registerCommand: jest.fn(),
	executeCommand: jest.fn(),
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
