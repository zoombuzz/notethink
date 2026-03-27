import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './playwright/specs',
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
