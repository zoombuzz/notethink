/*
 * Webpack config for the perf runner's bundles.
 *
 * Wraps the root webview config rather than restating it, so the runner measures exactly the bundle
 * the repo builds, and redirects its output to NOTETHINK_PERF_OUT instead of client/webview/dist.
 * A perf run must never replace the bundle the developer's VS Code dev host is serving.
 *
 * Bundle mode is chosen by environment, which scripts/perf/bundle.mjs sets before webpack loads
 * this file: NODE_ENV=production gives the marketplace-shaped bundle, SELFINSPECT_ENV=dev the
 * dev-workflow one. Everything else, React flavour included, comes from webpack.config.js.
 */
const path = require('path');
const configs = require('../../webpack.config.js');

const WEBVIEW_DIST = path.join('client', 'webview', 'dist');

const out_dir = process.env.NOTETHINK_PERF_OUT;
if (!out_dir) {
    throw new Error('NOTETHINK_PERF_OUT is unset - build through scripts/perf/bundle.mjs, not by invoking webpack on this config directly');
}
const webview_config = configs.find((config) => String(config.output && config.output.path).endsWith(WEBVIEW_DIST));
if (!webview_config) {
    throw new Error(`webpack.config.js exposes no webview config (no output.path ending in ${WEBVIEW_DIST})`);
}

module.exports = { ...webview_config, output: { ...webview_config.output, path: out_dir } };
