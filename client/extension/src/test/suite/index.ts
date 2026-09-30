// imports mocha for the browser, defining the `mocha` global
require('mocha/mocha');

/**
 * @vscode/test-web calls `mocha.run()` itself as soon as this module loads; the exported `run()`
 * never actually fires it. `resolveRun`/`runResult` report the outcome from the runner's own
 * events instead, and `MOCHA_SUITE_RESULT` lets `scripts/test-mocha.sh` read an exit code from
 * console output.
 */
let resolveRun: (failures: number) => void;
const runResult = new Promise<number>(resolve => {
	resolveRun = resolve;
});

/**
 * A worker-safe reporter: the default HTML reporter builds a DOM fragment through `document`,
 * absent in the web-worker extension host. Passing a reporter as a function keeps mocha from
 * constructing it.
 */
function reportToConsole(runner: Mocha.Runner): void {
	runner.on('pass', (test: Mocha.Test) => console.log(`  ✓ ${test.fullTitle()}`));
	runner.on('fail', (test: Mocha.Test, err: Error) => console.error(`  ✗ ${test.fullTitle()}: ${err.message}`));
	runner.on('end', () => {
		const failures = runner.stats?.failures ?? 0;
		console.log(`MOCHA_SUITE_RESULT failures=${failures} passes=${runner.stats?.passes ?? 0}`);
		resolveRun(failures);
	});
}

mocha.setup({
	ui: 'tdd',
	reporter: reportToConsole
});

/**
 * Tests are registered here, at module scope: @vscode/test-web calls the global `mocha.run()`
 * as soon as this module loads, so registering them inside `run()` left it running with none.
 */
const importAll = (r: __WebpackModuleApi.RequireContext): void => r.keys().forEach(r);
importAll(require.context('.', true, /\.test$/));

export function run(): Promise<void> {
	try {
		// starts the run if the host has not already started one
		mocha.run();
	} catch {
		// a run is already in progress or complete; reportToConsole's listeners still cover it
	}
	return runResult.then(failures => {
		if (failures > 0) {
			throw new Error(`${failures} tests failed.`);
		}
	});
}
