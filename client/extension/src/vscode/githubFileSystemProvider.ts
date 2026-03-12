import * as vscode from 'vscode';

interface GitHubContentResponse {
	name: string;
	path: string;
	sha: string;
	size: number;
	type: 'file' | 'dir' | 'symlink' | 'submodule';
	content?: string;
	encoding?: string;
}

interface GitHubWriteResponse {
	content: { sha: string } | null;
}

export interface ParsedGitHubUri {
	owner: string;
	repo: string;
	branch: string;
	filepath: string;
}

export class GitHubFileSystemProvider implements vscode.FileSystemProvider {

	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile = this._emitter.event;

	private _shas = new Map<string, string>();
	private _authenticated: boolean | null = null;
	private _apiBaseUrl: string;

	constructor(apiBaseUrl: string) {
		this._apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
	}

	// --- URI helpers ---

	static parseUri(uri: vscode.Uri): ParsedGitHubUri {
		const parts = uri.path.split('/').filter(Boolean);
		if (parts.length < 3) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		const [owner, repo, branch, ...rest] = parts;
		return { owner, repo, branch, filepath: rest.join('/') };
	}

	static createUri(owner: string, repo: string, branch: string, filepath: string): vscode.Uri {
		return vscode.Uri.parse(`github:///${owner}/${repo}/${branch}/${filepath}`);
	}

	// --- Auth ---

	async checkAuthenticated(): Promise<boolean> {
		if (this._authenticated !== null) { return this._authenticated; }
		try {
			const response = await fetch(`${this._apiBaseUrl}/api/auth/github/token`);
			this._authenticated = response.ok;
		} catch {
			this._authenticated = false;
		}
		return this._authenticated;
	}

	clearAuthCache(): void {
		this._authenticated = null;
	}

	// --- SHA tracking ---

	getSha(uri: vscode.Uri): string | undefined {
		return this._shas.get(uri.toString());
	}

	// --- API helpers ---

	private async githubFetch(path: string, options?: RequestInit): Promise<Response> {
		const url = `${this._apiBaseUrl}/api/github/${path}`;
		return fetch(url, {
			...options,
			headers: {
				'Accept': 'application/vnd.github.v3+json',
				...(options?.headers as Record<string, string>),
			},
			credentials: 'include',
		});
	}

	private contentsApiPath(parsed: ParsedGitHubUri): string {
		const encoded_path = parsed.filepath
			? parsed.filepath.split('/').map(encodeURIComponent).join('/')
			: '';
		const base = `repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/contents`;
		const ref = `ref=${encodeURIComponent(parsed.branch)}`;
		return encoded_path ? `${base}/${encoded_path}?${ref}` : `${base}?${ref}`;
	}

	// --- FileSystemProvider ---

	watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
		return new vscode.Disposable(() => {});
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const parsed = GitHubFileSystemProvider.parseUri(uri);

		if (!parsed.filepath) {
			return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
		}

		const response = await this.githubFetch(this.contentsApiPath(parsed));
		if (!response.ok) {
			if (response.status === 404) {
				throw vscode.FileSystemError.FileNotFound(uri);
			}
			throw vscode.FileSystemError.Unavailable(`GitHub API error: ${response.status}`);
		}

		const data = await response.json() as GitHubContentResponse | GitHubContentResponse[];

		if (Array.isArray(data)) {
			return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
		}

		this._shas.set(uri.toString(), data.sha);
		return {
			type: data.type === 'dir' ? vscode.FileType.Directory : vscode.FileType.File,
			ctime: 0,
			mtime: 0,
			size: data.size,
		};
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const parsed = GitHubFileSystemProvider.parseUri(uri);
		const response = await this.githubFetch(this.contentsApiPath(parsed));

		if (!response.ok) {
			if (response.status === 404) {
				throw vscode.FileSystemError.FileNotFound(uri);
			}
			throw vscode.FileSystemError.Unavailable(`GitHub API error: ${response.status}`);
		}

		const data = await response.json() as GitHubContentResponse;

		if (data.type !== 'file' || !data.content) {
			throw vscode.FileSystemError.FileIsADirectory(uri);
		}

		this._shas.set(uri.toString(), data.sha);

		const clean_base64 = data.content.replace(/\n/g, '');
		const binary_string = atob(clean_base64);
		const bytes = new Uint8Array(binary_string.length);
		for (let i = 0; i < binary_string.length; i++) {
			bytes[i] = binary_string.charCodeAt(i);
		}
		return bytes;
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const parsed = GitHubFileSystemProvider.parseUri(uri);
		const response = await this.githubFetch(this.contentsApiPath(parsed));

		if (!response.ok) {
			if (response.status === 404) {
				throw vscode.FileSystemError.FileNotFound(uri);
			}
			throw vscode.FileSystemError.Unavailable(`GitHub API error: ${response.status}`);
		}

		const data = await response.json() as GitHubContentResponse[];

		if (!Array.isArray(data)) {
			throw vscode.FileSystemError.FileNotADirectory(uri);
		}

		return data.map(item => [
			item.name,
			item.type === 'dir' ? vscode.FileType.Directory : vscode.FileType.File,
		]);
	}

	async commitFile(uri: vscode.Uri, content: Uint8Array, message: string): Promise<void> {
		const parsed = GitHubFileSystemProvider.parseUri(uri);

		let binary_string = '';
		for (let i = 0; i < content.length; i++) {
			binary_string += String.fromCharCode(content[i]);
		}
		const content_base64 = btoa(binary_string);

		const encoded_path = parsed.filepath.split('/').map(encodeURIComponent).join('/');
		const api_path = `repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/contents/${encoded_path}`;

		const sha = this._shas.get(uri.toString());
		const body: Record<string, string> = {
			message,
			content: content_base64,
			branch: parsed.branch,
		};

		if (sha) {
			body.sha = sha;
		}

		const response = await this.githubFetch(api_path, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			if (response.status === 409) {
				throw vscode.FileSystemError.Unavailable(
					'Conflict: file was modified on GitHub since last read. Reload and try again.',
				);
			}
			if (response.status === 401 || response.status === 403) {
				throw vscode.FileSystemError.NoPermissions(uri);
			}
			throw vscode.FileSystemError.Unavailable(`GitHub API error: ${response.status}`);
		}

		const data = await response.json() as GitHubWriteResponse;
		if (data.content?.sha) {
			this._shas.set(uri.toString(), data.content.sha);
		}

		this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
		const sha = this._shas.get(uri.toString());

		if (!sha && !options.create) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		if (sha && !options.overwrite) {
			throw vscode.FileSystemError.FileExists(uri);
		}

		const parsed = GitHubFileSystemProvider.parseUri(uri);
		await this.commitFile(uri, content, `Update ${parsed.filepath}`);
	}

	async delete(uri: vscode.Uri): Promise<void> {
		const parsed = GitHubFileSystemProvider.parseUri(uri);
		let sha = this._shas.get(uri.toString());

		if (!sha) {
			await this.stat(uri);
			sha = this._shas.get(uri.toString());
			if (!sha) {
				throw vscode.FileSystemError.FileNotFound(uri);
			}
		}

		const encoded_path = parsed.filepath.split('/').map(encodeURIComponent).join('/');
		const api_path = `repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/contents/${encoded_path}`;

		const response = await this.githubFetch(api_path, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				message: `Delete ${parsed.filepath}`,
				sha,
				branch: parsed.branch,
			}),
		});

		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				throw vscode.FileSystemError.NoPermissions(uri);
			}
			throw vscode.FileSystemError.Unavailable(`GitHub API error: ${response.status}`);
		}

		this._shas.delete(uri.toString());
		this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
		const content = await this.readFile(oldUri);
		await this.writeFile(newUri, content, { create: true, overwrite: options.overwrite });
		await this.delete(oldUri);
	}

	createDirectory(): void {
		// GitHub doesn't support empty directories — they are created implicitly with files
	}
}
