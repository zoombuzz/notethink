/**
 * Webpack config for the perf runner's bundles: wraps the root webview configs and redirects their
 * output to NOTETHINK_PERF_OUT instead of client/webview/dist, so a perf run never overwrites the
 * bundle the dev host is serving. Bundle mode (production vs dev) is chosen by env vars
 * scripts/perf/bundle.mjs sets before webpack loads this file.
 *
 * Every config outputting to client/webview/dist - the webview entry and the parseWorker.js worker -
 * is redirected, not just the first match: useWorkerParsedDocs.ts needs the worker bundle at
 * NOTETHINK_PERF_OUT too.
 */
const path = require('path');
const configs = require('../../webpack.config.js');

const WEBVIEW_DIST = path.join('client', 'webview', 'dist');

const out_dir = process.env.NOTETHINK_PERF_OUT;
if (!out_dir) {
    throw new Error('NOTETHINK_PERF_OUT is unset - build through scripts/perf/bundle.mjs, not by invoking webpack on this config directly');
}
const webview_configs = configs.filter((config) => String(config.output && config.output.path).endsWith(WEBVIEW_DIST));
if (webview_configs.length === 0) {
    throw new Error(`webpack.config.js exposes no webview config (no output.path ending in ${WEBVIEW_DIST})`);
}

module.exports = webview_configs.map((config) => ({ ...config, output: { ...config.output, path: out_dir } }));
