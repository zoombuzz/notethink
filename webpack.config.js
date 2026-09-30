/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

/** @typedef {import('webpack').Configuration} WebpackConfig **/

const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require("copy-webpack-plugin");

const pkg = require('./package.json');
const isProduction = process.env.NODE_ENV === 'production';
const devtool = isProduction ? 'nosources-source-map' : 'source-map';
/*
 * NOTETHINK_DEV gates the on-disk file logger and the webview cache-buster: off by default so a
 * shipped build never writes logs to a user's machine. The `build`/`watch` scripts opt in with
 * SELFINSPECT_ENV=dev, never NODE_ENV.
 */
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
			/*
			 * Webpack 5 no longer polyfills Node.js core modules automatically:
			 * https://webpack.js.org/configuration/resolve/#resolvefallback lists the polyfills.
			 * 'http'/'https'/'zlib'/'stream'/'url' are deliberately absent: nothing either entry
			 * bundles requires them.
			 */
			'assert': require.resolve('assert'),
			'events': require.resolve('events/'),
			'process/browser': require.resolve('process/browser'),
			'os': require.resolve('os-browserify/browser'),
			'buffer': require.resolve('buffer/'),
			'path': require.resolve('path-browserify'),
			'fs': require.resolve('memfs'),
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
 * The agent activity analyser's nested worker, loaded by `AgentAnalyser.ts` as a real `Worker` so
 * decoding, parsing and pricing run off the extension host's thread. It has no `library`/`libraryTarget`:
 * `libraryTarget: 'commonjs'` emits `const __webpack_export_target__ = exports;`, and a nested
 * `Worker` has no `exports` global, so the worker would throw before `self.onmessage` is set.
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

/*
 * The extension host's parse worker: PanelSession's ParsePool spawns a small pool of these to move
 * mdast parsing off the host thread. No `library`/`libraryTarget`, because a nested Worker has no
 * CommonJS `exports` global.
 */
/** @type WebpackConfig */
const parseWorkerConfig = {
	context: path.join(__dirname, 'client', 'extension'),
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'none',
	target: 'webworker',
	entry: {
		'parseWorker': './src/vscode/ParseWorker.ts',
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
	 * `mode: 'none'` leaves NODE_ENV undefined, which selects React's costly development build.
	 * Pinning it gives every build production React while watch rebuilds stay fast and unminified.
	 */
	optimization: {
		nodeEnv: 'production',
	},
	/*
	 * The webview is a DOM iframe, not a worker, so target 'web'. That makes webpack load split
	 * chunks by <script> tag ('jsonp'); the 'webworker' default, importScripts, does not exist here.
	 */
	target: 'web',
	entry: {
		'index': './src/index.tsx',
	},
	output: {
		filename: '[name].js',
		path: path.join(__dirname, 'client', 'webview', 'dist'),
		libraryTarget: 'commonjs',
		devtoolModuleFilenameTemplate: '../[resource-path]',
		/*
		 * Chunk ids change every build, so clean stops stale chunks shipping in the vsix. `keep`
		 * spares parseWorker.js/.map, which clientWebviewWorkerConfig emits into this directory.
		 */
		clean: {
			keep: /^parseWorker/,
		},
	},
	resolve: {
		mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
		extensions: ['.tsx', '.ts', '.js', '.mjs'],
		alias: {
			// one React for the webview and notethink-views, which pnpm's per-package node_modules would duplicate
			'react': path.resolve(__dirname, 'client', 'webview', 'node_modules', 'react'),
			'react-dom': path.resolve(__dirname, 'client', 'webview', 'node_modules', 'react-dom'),
		},
		fallback: {
			// Webpack 5 no longer polyfills Node.js core modules automatically: https://webpack.js.org/configuration/resolve/#resolvefallback lists the polyfills
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

/*
 * The webview's folder-mode parse worker: a folder doc arrives with `text` but no `content`, and the
 * webview parses it here, off the main thread, rather than the extension shipping mdast over the
 * wire. A nested Worker needs neither `target: 'web'` nor a `libraryTarget`, and useWorkerParsedDocs.ts
 * loads it via fetch-then-blob, never a <script> tag, so it needs no nonce or chunkLoading wiring.
 */
/** @type WebpackConfig */
const clientWebviewWorkerConfig = {
	context: path.join(__dirname, 'client', 'webview'),
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'none',
	target: 'webworker',
	entry: {
		'parseWorker': './src/parseWorker.ts',
	},
	output: {
		filename: '[name].js',
		path: path.join(__dirname, 'client', 'webview', 'dist'),
		devtoolModuleFilenameTemplate: '../[resource-path]'
	},
	resolve: clientWebviewConfig.resolve,
	module: clientWebviewConfig.module,
	plugins: [
		new webpack.optimize.LimitChunkCountPlugin({
			maxChunks: 1
		}),
		new webpack.ProvidePlugin({
			process: 'process/browser',
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

module.exports = [ clientExtensionConfig, agentAnalyserWorkerConfig, parseWorkerConfig, clientWebviewConfig, clientWebviewWorkerConfig ];