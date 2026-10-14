import { createThrottledProgressSender, drainWorklist, formatDiscoveryLogLine, resolveDiscoveryMethod } from './discoveryops';

describe('discoveryops', () => {
	describe('resolveDiscoveryMethod()', () => {
		it('uses findFiles on the file: scheme', () => {
			expect(resolveDiscoveryMethod('file')).toBe('findFiles');
		});

		it('uses findFiles on the vscode-remote: scheme', () => {
			expect(resolveDiscoveryMethod('vscode-remote')).toBe('findFiles');
		});

		it('walks every other scheme, such as a static vscode-vfs: content provider', () => {
			expect(resolveDiscoveryMethod('vscode-vfs')).toBe('walk');
		});
	});

	describe('formatDiscoveryLogLine()', () => {
		it('formats a findFiles run with no dirs_walked', () => {
			const line = formatDiscoveryLogLine({ method: 'findFiles', scheme: 'file', discovered_count: 2235, elapsed_ms: 412 });
			expect(line).toBe('discovery via findFiles (scheme file): found 2235 docs in 412ms');
		});

		it('formats a walk run with dirs_walked appended', () => {
			const line = formatDiscoveryLogLine({ method: 'walk', scheme: 'vscode-remote', discovered_count: 2200, dirs_walked: 340, elapsed_ms: 29800 });
			expect(line).toBe('discovery via walk (scheme vscode-remote): found 2200 docs in 29800ms, walked 340 directories');
		});

		it('never includes a path', () => {
			const line = formatDiscoveryLogLine({ method: 'walk', scheme: 'vscode-remote', discovered_count: 1, dirs_walked: 1, elapsed_ms: 1 });
			expect(line).not.toContain('/');
		});
	});

	describe('createThrottledProgressSender()', () => {
		it('sends the first tick immediately, with no prior send to compare against', () => {
			const send = jest.fn();
			const sender = createThrottledProgressSender<number>(send, () => 1000);
			sender.tick(1);
			expect(send).toHaveBeenCalledTimes(1);
			expect(send).toHaveBeenCalledWith(1);
		});

		it('drops a tick landing inside the throttle window since the last send', () => {
			const send = jest.fn();
			let now = 1000;
			const sender = createThrottledProgressSender<number>(send, () => now);
			sender.tick(1);
			now += 100;
			sender.tick(2);
			expect(send).toHaveBeenCalledTimes(1);
			expect(send).toHaveBeenCalledWith(1);
		});

		it('sends again once the throttle window has elapsed', () => {
			const send = jest.fn();
			let now = 1000;
			const sender = createThrottledProgressSender<number>(send, () => now);
			sender.tick(1);
			now += 250;
			sender.tick(2);
			expect(send).toHaveBeenCalledTimes(2);
			expect(send).toHaveBeenLastCalledWith(2);
		});

		it('always sends a final call, even immediately after a throttled tick', () => {
			const send = jest.fn();
			let now = 1000;
			const sender = createThrottledProgressSender<number>(send, () => now);
			sender.tick(1);
			now += 10;
			sender.tick(2);
			sender.final(3);
			expect(send).toHaveBeenCalledTimes(2);
			expect(send).toHaveBeenLastCalledWith(3);
		});
	});

	describe('drainWorklist()', () => {
		// a small directed tree: 1 -> [2,3], 2 -> [4,5], 3 -> [6], 4/5/6 are leaves
		const TREE: Record<number, Array<number>> = { 1: [2, 3], 2: [4, 5], 3: [6], 4: [], 5: [], 6: [] };
		const visitingProcess = (visited: Array<number>) => async (id: number): Promise<Array<number>> => {
			visited.push(id);
			return TREE[id] ?? [];
		};

		it('visits every node reachable from the roots, regardless of concurrency', async () => {
			for (const concurrency of [1, 3, 8]) {
				const visited: Array<number> = [];
				const result = await drainWorklist([1], visitingProcess(visited), { concurrency, max_items: 100 });
				expect(new Set(visited)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
				expect(result).toEqual({ processed_count: 6, capped: false, stopped: false });
			}
		});

		it('never runs more than `concurrency` items at once', async () => {
			let active = 0;
			let peak = 0;
			const release: Array<() => void> = [];
			const process = (id: number): Promise<Array<number>> => {
				active++;
				peak = Math.max(peak, active);
				return new Promise(resolve => { release.push(() => { active--; resolve(TREE[id] ?? []); }); });
			};
			const drain_promise = drainWorklist([1, 2, 3, 4, 5, 6], process, { concurrency: 3, max_items: 100 });
			await Promise.resolve();
			expect(peak).toBe(3);
			while (release.length > 0) {
				release.shift()!();
				await Promise.resolve();
			}
			await drain_promise;
			expect(peak).toBe(3);
		});

		it('stops at max_items and reports capped, leaving the rest of the worklist undrained', async () => {
			const visited: Array<number> = [];
			const result = await drainWorklist([1], visitingProcess(visited), { concurrency: 1, max_items: 2 });
			expect(result).toEqual({ processed_count: 2, capped: true, stopped: false });
			expect(visited).toHaveLength(2);
		});

		it('stops starting new items once isStopped reports true, and posts no further onItemProcessed call', async () => {
			const visited: Array<number> = [];
			const processed_counts: Array<number> = [];
			let superseded = false;
			const result = await drainWorklist([1], visitingProcess(visited), {
				concurrency: 1,
				max_items: 100,
				isStopped: () => superseded,
				onItemProcessed: (n) => {
					processed_counts.push(n);
					// simulates a newer scan superseding this one right after its first directory lands
					superseded = true;
				},
			});
			expect(result).toEqual({ processed_count: 1, capped: false, stopped: true });
			expect(visited).toEqual([1]);
			expect(processed_counts).toEqual([1]);
		});
	});
});
