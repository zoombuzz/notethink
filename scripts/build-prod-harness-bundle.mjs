/*
 * Builds the production-mode webview bundle (minified, NOTETHINK_DEV false) the `*.prod.spec.ts`
 * Playwright specs run against, into the gitignored test-results tree. The dev bundle in
 * client/webview/dist is left alone, since the rest of the suite needs it.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBundle } from './perf/bundle.mjs';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const bundle = await prepareBundle(REPO_ROOT, 'production');
console.log(`production harness bundle at ${bundle.out_dir}`);
