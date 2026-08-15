import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './playwright/specs',
    /*
     * Keep Playwright's artefacts in a subdirectory rather than letting them default to test-results/ itself.
     * Playwright empties outputDir at the START of every run, and test-results/ is also where the workspace keeps
     * long-running build and dev logs - here the webpack watcher's dev.log. Defaulting therefore deletes the log of
     * a process that is still running, and because that process holds the file open it keeps writing to an unlinked
     * inode: the log does not error, it silently stops existing. Scoping the output to test-results/playwright lets
     * Playwright clean up after itself without taking the watcher's log with it.
     */
    outputDir: './test-results/playwright',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: 'http://localhost:9123',
        trace: 'on-first-retry',
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
    ],
    webServer: {
        command: 'node playwright/harness/serve.mjs',
        port: 9123,
        reuseExistingServer: !process.env.CI,
    },
});
