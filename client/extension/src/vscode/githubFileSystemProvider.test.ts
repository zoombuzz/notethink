import { Uri, FileType, FileChangeType } from 'vscode';
import { GitHubFileSystemProvider } from './githubFileSystemProvider';

const API_BASE = 'https://dulcet.notegit.com';

function mockFetch(response: { ok: boolean; status: number; json?: () => Promise<unknown> }) {
	return jest.fn().mockResolvedValue({
		ok: response.ok,
		status: response.status,
		json: response.json ?? (() => Promise.resolve({})),
	});
}

describe('GitHubFileSystemProvider', () => {
	let provider: GitHubFileSystemProvider;

	beforeEach(() => {
		provider = new GitHubFileSystemProvider(API_BASE);
	});

	afterEach(() => {
		(globalThis as any).fetch = undefined;
	});

	describe('parseUri', () => {
		it('parses owner/repo/branch/filepath from URI path', () => {
			const uri = Uri.parse('github:///octocat/hello-world/main/docs/readme.md');
			const parsed = GitHubFileSystemProvider.parseUri(uri);
			expect(parsed).toEqual({
				owner: 'octocat',
				repo: 'hello-world',
				branch: 'main',
				filepath: 'docs/readme.md',
			});
		});

		it('handles files at repo root', () => {
			const uri = Uri.parse('github:///octocat/hello-world/main/README.md');
			const parsed = GitHubFileSystemProvider.parseUri(uri);
			expect(parsed).toEqual({
				owner: 'octocat',
				repo: 'hello-world',
				branch: 'main',
				filepath: 'README.md',
			});
		});

		it('handles repo root with no filepath', () => {
			const uri = Uri.parse('github:///octocat/hello-world/main');
			const parsed = GitHubFileSystemProvider.parseUri(uri);
			expect(parsed).toEqual({
				owner: 'octocat',
				repo: 'hello-world',
				branch: 'main',
				filepath: '',
			});
		});

		it('throws for URIs with fewer than 3 path segments', () => {
			const uri = Uri.parse('github:///octocat/hello-world');
			expect(() => GitHubFileSystemProvider.parseUri(uri)).toThrow();
		});
	});

	describe('createUri', () => {
		it('creates a github:// URI from components', () => {
			const uri = GitHubFileSystemProvider.createUri('octocat', 'hello-world', 'main', 'docs/readme.md');
			expect(uri.scheme).toBe('github');
			expect(uri.path).toContain('octocat');
			expect(uri.path).toContain('hello-world');
			expect(uri.path).toContain('main');
			expect(uri.path).toContain('docs/readme.md');
		});
	});

	describe('stat', () => {
		it('returns Directory for repo root (no filepath)', async () => {
			const uri = Uri.parse('github:///octocat/hello-world/main');
			const result = await provider.stat(uri);
			expect(result.type).toBe(FileType.Directory);
		});

		it('returns File stat and tracks SHA', async () => {
			(globalThis as any).fetch = mockFetch({
				ok: true,
				status: 200,
				json: () => Promise.resolve({
					name: 'readme.md',
					path: 'readme.md',
					sha: 'abc123',
					size: 42,
					type: 'file',
				}),
			});

			const uri = Uri.parse('github:///octocat/hello-world/main/readme.md');
			const result = await provider.stat(uri);

			expect(result.type).toBe(FileType.File);
			expect(result.size).toBe(42);
			expect(provider.getSha(uri)).toBe('abc123');
		});

		it('returns Directory stat for directory response', async () => {
			(globalThis as any).fetch = mockFetch({
				ok: true,
				status: 200,
				json: () => Promise.resolve([
					{ name: 'file1.md', type: 'file' },
					{ name: 'subdir', type: 'dir' },
				]),
			});

			const uri = Uri.parse('github:///octocat/hello-world/main/docs');
			const result = await provider.stat(uri);
			expect(result.type).toBe(FileType.Directory);
		});

		it('throws FileNotFound for 404', async () => {
			(globalThis as any).fetch = mockFetch({ ok: false, status: 404 });

			const uri = Uri.parse('github:///octocat/hello-world/main/missing.md');
			await expect(provider.stat(uri)).rejects.toThrow();
		});
	});

	describe('readFile', () => {
		it('decodes base64 content and tracks SHA', async () => {
			const content = 'Hello, World!';
			const encoded = btoa(content);

			(globalThis as any).fetch = mockFetch({
				ok: true,
				status: 200,
				json: () => Promise.resolve({
					name: 'test.md',
					path: 'test.md',
					sha: 'def456',
					size: content.length,
					type: 'file',
					content: encoded,
					encoding: 'base64',
				}),
			});

			const uri = Uri.parse('github:///octocat/hello-world/main/test.md');
			const bytes = await provider.readFile(uri);
			const decoded = new TextDecoder().decode(bytes);

			expect(decoded).toBe('Hello, World!');
			expect(provider.getSha(uri)).toBe('def456');
		});

		it('handles base64 content with embedded newlines', async () => {
			const content = 'Line 1\nLine 2\nLine 3';
			const raw_base64 = btoa(content);
			const with_newlines = raw_base64.slice(0, 10) + '\n' + raw_base64.slice(10);

			(globalThis as any).fetch = mockFetch({
				ok: true,
				status: 200,
				json: () => Promise.resolve({
					name: 'test.md',
					path: 'test.md',
					sha: 'ghi789',
					size: content.length,
					type: 'file',
					content: with_newlines,
					encoding: 'base64',
				}),
			});

			const uri = Uri.parse('github:///octocat/hello-world/main/test.md');
			const bytes = await provider.readFile(uri);
			expect(new TextDecoder().decode(bytes)).toBe(content);
		});

		it('throws for directory response', async () => {
			(globalThis as any).fetch = mockFetch({
				ok: true,
				status: 200,
				json: () => Promise.resolve({
					name: 'docs',
					path: 'docs',
					sha: 'xxx',
					size: 0,
					type: 'dir',
				}),
			});

			const uri = Uri.parse('github:///octocat/hello-world/main/docs');
			await expect(provider.readFile(uri)).rejects.toThrow();
		});
	});

	describe('readDirectory', () => {
		it('returns entries with correct types', async () => {
			(globalThis as any).fetch = mockFetch({
				ok: true,
				status: 200,
				json: () => Promise.resolve([
					{ name: 'readme.md', path: 'docs/readme.md', sha: 'a1', size: 100, type: 'file' },
					{ name: 'images', path: 'docs/images', sha: 'b2', size: 0, type: 'dir' },
					{ name: 'notes.md', path: 'docs/notes.md', sha: 'c3', size: 50, type: 'file' },
				]),
			});

			const uri = Uri.parse('github:///octocat/hello-world/main/docs');
			const entries = await provider.readDirectory(uri);

			expect(entries).toEqual([
				['readme.md', FileType.File],
				['images', FileType.Directory],
				['notes.md', FileType.File],
			]);
		});
	});

	describe('writeFile', () => {
		it('sends PUT with base64 content and SHA for updates', async () => {
			const fetch_mock = jest.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ content: { sha: 'new_sha_456' } }),
			});
			(globalThis as any).fetch = fetch_mock;

			const uri = Uri.parse('github:///octocat/hello-world/main/test.md');
			// simulate a previously-read file with known SHA
			(provider as any)._shas.set(uri.toString(), 'old_sha_123');

			const content = new TextEncoder().encode('Updated content');
			await provider.writeFile(uri, content, { create: false, overwrite: true });

			expect(fetch_mock).toHaveBeenCalledTimes(1);
			const call_url = fetch_mock.mock.calls[0][0];
			expect(call_url).toContain('/api/github/repos/octocat/hello-world/contents/test.md');

			const call_options = fetch_mock.mock.calls[0][1];
			const body = JSON.parse(call_options.body);
			expect(body.sha).toBe('old_sha_123');
			expect(body.branch).toBe('main');
			expect(body.content).toBe(btoa('Updated content'));

			// SHA should be updated after write
			expect(provider.getSha(uri)).toBe('new_sha_456');
		});

		it('omits SHA for new file creation', async () => {
			const fetch_mock = jest.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ content: { sha: 'created_sha' } }),
			});
			(globalThis as any).fetch = fetch_mock;

			const uri = Uri.parse('github:///octocat/hello-world/main/new-file.md');
			const content = new TextEncoder().encode('New file');
			await provider.writeFile(uri, content, { create: true, overwrite: false });

			const body = JSON.parse(fetch_mock.mock.calls[0][1].body);
			expect(body.sha).toBeUndefined();
		});

		it('throws FileNotFound when updating nonexistent file without create', async () => {
			const uri = Uri.parse('github:///octocat/hello-world/main/missing.md');
			const content = new TextEncoder().encode('data');
			await expect(
				provider.writeFile(uri, content, { create: false, overwrite: true }),
			).rejects.toThrow();
		});

		it('throws FileExists when file exists and overwrite is false', async () => {
			const uri = Uri.parse('github:///octocat/hello-world/main/existing.md');
			(provider as any)._shas.set(uri.toString(), 'some_sha');

			const content = new TextEncoder().encode('data');
			await expect(
				provider.writeFile(uri, content, { create: true, overwrite: false }),
			).rejects.toThrow();
		});

		it('throws on 409 conflict', async () => {
			(globalThis as any).fetch = mockFetch({ ok: false, status: 409 });

			const uri = Uri.parse('github:///octocat/hello-world/main/test.md');
			(provider as any)._shas.set(uri.toString(), 'stale_sha');

			const content = new TextEncoder().encode('data');
			await expect(
				provider.writeFile(uri, content, { create: false, overwrite: true }),
			).rejects.toThrow(/Conflict/);
		});
	});

	describe('checkAuthenticated', () => {
		it('returns true when token endpoint responds ok', async () => {
			(globalThis as any).fetch = mockFetch({ ok: true, status: 200 });
			const result = await provider.checkAuthenticated();
			expect(result).toBe(true);
		});

		it('returns false when token endpoint responds 401', async () => {
			(globalThis as any).fetch = mockFetch({ ok: false, status: 401 });
			const result = await provider.checkAuthenticated();
			expect(result).toBe(false);
		});

		it('caches the result', async () => {
			const fetch_mock = mockFetch({ ok: true, status: 200 });
			(globalThis as any).fetch = fetch_mock;

			await provider.checkAuthenticated();
			await provider.checkAuthenticated();
			expect(fetch_mock).toHaveBeenCalledTimes(1);
		});

		it('clearAuthCache resets the cache', async () => {
			const fetch_mock = mockFetch({ ok: true, status: 200 });
			(globalThis as any).fetch = fetch_mock;

			await provider.checkAuthenticated();
			provider.clearAuthCache();
			await provider.checkAuthenticated();
			expect(fetch_mock).toHaveBeenCalledTimes(2);
		});
	});

	describe('onDidChangeFile', () => {
		it('fires change event after writeFile', async () => {
			(globalThis as any).fetch = jest.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ content: { sha: 'new' } }),
			});

			const uri = Uri.parse('github:///octocat/hello-world/main/test.md');
			(provider as any)._shas.set(uri.toString(), 'old');

			const events: any[] = [];
			provider.onDidChangeFile(e => events.push(...e));

			await provider.writeFile(uri, new TextEncoder().encode('x'), { create: false, overwrite: true });

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe(FileChangeType.Changed);
		});
	});

	describe('watch', () => {
		it('returns a disposable', () => {
			const disposable = provider.watch(
				Uri.parse('github:///octocat/hello-world/main'),
				{ recursive: false, excludes: [] },
			);
			expect(typeof disposable.dispose).toBe('function');
		});
	});
});
