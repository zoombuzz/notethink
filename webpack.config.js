/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require("copy-webpack-plugin");

const pkg = require('./package.json');
const isProduction = process.env.NODE_ENV === 'production';
const devtool = isProduction ? 'nosources-source-map' : 'source-map';
// NOTETHINK_DEV gates the on-disk file logger and the webview cache-buster: OFF by default so any
// shipped build (a `vsce publish` to the marketplace, or a hosted/web build) never litters a user's
// machine with logs. The `build`/`watch` scripts opt in by exporting SELFINSPECT_ENV=dev (the
// workspace-standard env marker, not NODE_ENV - see AGENTS.md).
const isDevBuild = process.env.SELFINSPECT_ENV === 'dev';

/** @type WebpackConfig */
const clientExtensionConfig = {
	context: path.join(__dirname, 'client', 'extension'),
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'none',
	target: 'webworker', // web extensions run in a webworker context
	entry: {
		'extension': './src/extension.ts',
		'test/suite/index': './src/test/suite/index.ts',
	},
	output: {
		filename: '[name].js',
		path: path.join(__dirname, 'client', 'extension', 'dist'),
		libraryTarget: 'commonjs',
		devtoolModuleFilenameTemplate: '../[resource-path]'
	},
	resolve: {
		mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
		extensions: ['.ts', '.js'], // support ts-files and js-files
		alias: {
			// provides alternate implementation for node module and source files
		},
		fallback: {
			// Webpack 5 no longer polyfills Node.js core modules automatically.
			// see https://webpack.js.org/configuration/resolve/#resolvefallback
			// for the list of Node.js core module polyfills.
			'assert': require.resolve('assert'),
			'events': require.resolve('events/'),
			'process/browser': require.resolve('process/browser'),
			'os': require.resolve('os-browserify/browser'),
			'buffer': require.resolve('buffer/'),
			'path': require.resolve('path-browserify'),
			'zlib': require.resolve('browserify-zlib'),
			'fs': require.resolve('memfs'),
			'http': require.resolve('stream-http'),
			'https': require.resolve('https-browserify'),
			'stream': require.resolve('stream-browserify'),
			'url': require.resolve('url/'),
			'util': require.resolve('util/'),
		}
	},
	module: {
		rules: [{
			test: /\.ts$/,
			exclude: /node_modules/,
			use: [{
				loader: 'ts-loader',
				options: { transpileOnly: true },
			}]
		}]
	},
	plugins: [
		new webpack.optimize.LimitChunkCountPlugin({
			maxChunks: 1 // disable chunks by default since web extensions must be a single bundle
		}),
		new webpack.ProvidePlugin({
			process: 'process/browser', // provide a shim for the global `process` variable
		}),
		// strip node: protocol prefix so fallback polyfills can resolve (memfs 4.x+)
		new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
			resource.request = resource.request.replace(/^node:/, '');
		}),
		new webpack.DefinePlugin({
			NOTETHINK_DEV: JSON.stringify(isDevBuild),
			NOTETHINK_CLIENT_ERROR_REPORTING: JSON.stringify(process.env.NOTETHINK_CLIENT_ERROR_REPORTING === '1'),
		}),
	],
	externals: {
		'vscode': 'commonjs vscode', // ignored because it doesn't exist
	},
	ignoreWarnings: [
		// mocha uses dynamic require() internally which webpack cannot statically analyse
		{ module: /node_modules[\\/]mocha/ },
	],
	performance: {
		hints: false
	},
	devtool,
	infrastructureLogging: {
		level: "log", // enables logging required for problem matchers
	},
};

/*
 * The agent activity analyser's nested worker: decoding, parsing and pricing run here, off the
 * extension host's own thread, loaded by `AgentAnalyser.ts` as a real `Worker` (agent-activity-card
 * story). It cannot share `clientExtensionConfig`: that config's `libraryTarget: 'commonjs'` makes
 * webpack emit `const __webpack_export_target__ = exports;` at the top of the bundle, and `exports`
 * is a CommonJS/extension-host global a plain nested `Worker` never has, so the worker throws before
 * its own `self.onmessage` line runs (measured 2026-09-22: a worker built this way rejects every
 * request on `onerror`). This config has no `library`/`libraryTarget` at all, so
 * the bundle runs as a plain worker script instead of trying to export a module.
 */
/** @type WebpackConfig */
const agentAnalyserWorkerConfig = {
	context: path.join(__dirname, 'client', 'extension'),
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'none',
	target: 'webworker',
	entry: {
		'agentAnalyserWorker': './src/vscode/AgentAnalyserWorker.ts',
	},
	output: {
		filename: '[name].js',
		path: path.join(__dirname, 'client', 'extension', 'dist'),
		devtoolModuleFilenameTemplate: '../[resource-path]'
	},
	resolve: clientExtensionConfig.resolve,
	module: clientExtensionConfig.module,
	plugins: [
		new webpack.optimize.LimitChunkCountPlugin({
			maxChunks: 1
		}),
		new webpack.ProvidePlugin({
			process: 'process/browser',
		}),
		new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
			resource.request = resource.request.replace(/^node:/, '');
		}),
	],
	performance: {
		hints: false
	},
	devtool,
	infrastructureLogging: {
		level: "log",
	},
};

/** @type WebpackConfig */
const clientWebviewConfig = {
	context: path.join(__dirname, 'client', 'webview'),
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'none',
	/*
	 * React chooses its development build from process.env.NODE_ENV, which `mode: 'none'` leaves
	 * undefined, so without this pin the dev host runs React's dev instrumentation and pays several
	 * times the cost on every interaction. Pinning NODE_ENV to production gives every build
	 * production React while `mode` stays 'none', so watch rebuilds stay fast, the app code stays
	 * unminified and the source map stays useful in webview devtools. The webview bundle alone
	 * carries React, and the extension bundle gates its errorops `debug()` helper on
	 * NODE_ENV !== 'production', so the same pin there would silence a dev convenience for nothing.
	 * NOTETHINK_DEV is a separate switch, driven by SELFINSPECT_ENV.
	 */
	optimization: {
		nodeEnv: 'production',
	},
	target: 'webworker', // extensions run in a webworker context
	entry: {
		'index': './src/index.tsx',
	},
	output: {
		filename: '[name].js',
		path: path.join(__dirname, 'client', 'webview', 'dist'),
		libraryTarget: 'commonjs',
		devtoolModuleFilenameTemplate: '../[resource-path]'
	},
	resolve: {
		mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
		extensions: ['.tsx', '.ts', '.js', '.mjs'],
		alias: {
			// force a single React instance across webview and nested sub-packages (notethink-views)
			// without this, pnpm's per-package node_modules causes webpack to bundle two copies of React
			'react': path.resolve(__dirname, 'client', 'webview', 'node_modules', 'react'),
			'react-dom': path.resolve(__dirname, 'client', 'webview', 'node_modules', 'react-dom'),
		},
		fallback: {
			// Webpack 5 no longer polyfills Node.js core modules automatically.
			// see https://webpack.js.org/configuration/resolve/#resolvefallback
			// for the list of Node.js core module polyfills.
			'assert': require.resolve('assert'),
		}
	},
	module: {
		rules: [
			{
				test: /\.m?js$/,
				resolve: {
					fullySpecified: false,
				},
			},
			{
				test: /\.tsx?$/,
				exclude: /node_modules/,
				use: [{
					loader: 'ts-loader',
					options: { transpileOnly: true },
				}]
			},
			{
				test: /\.css$/,
				use: ["style-loader", { loader: "css-loader", options: { modules: { namedExport: false, exportLocalsConvention: "as-is" } } }],
			},
			{
				test: /\.scss$/,
				use: ["style-loader", { loader: "css-loader", options: { modules: { namedExport: false, exportLocalsConvention: "as-is" } } }, { loader: "sass-loader", options: { api: "modern-compiler" } }],
			},
		]
	},
	plugins: [
		new webpack.optimize.LimitChunkCountPlugin({
			maxChunks: 1 // disable chunks by default since web extensions must be a single bundle
		}),
		new webpack.ProvidePlugin({
			process: 'process/browser', // provide a shim for the global `process` variable
		}),
		new webpack.DefinePlugin({
			NOTETHINK_VERSION: JSON.stringify(pkg.version),
			NOTETHINK_DEV: JSON.stringify(isDevBuild),
			NOTETHINK_CLIENT_ERROR_REPORTING: JSON.stringify(process.env.NOTETHINK_CLIENT_ERROR_REPORTING === '1'),
		}),
		new CopyWebpackPlugin({
			patterns: [{ from: "public" }],
		}),
	],
	externals: {
		'vscode': 'commonjs vscode', // ignored because it doesn't exist
	},
	performance: {
		hints: false
	},
	devtool,
	infrastructureLogging: {
		level: "log", // enables logging required for problem matchers
	},
};

module.exports = [ clientExtensionConfig, agentAnalyserWorkerConfig, clientWebviewConfig ];