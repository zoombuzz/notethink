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

/** @type WebpackConfig */
const clientExtensionConfig = {
	context: path.join(__dirname, 'client', 'extension'),
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'none',
	target: 'webworker', // web extensions run in a webworker context
	entry: {
		'extension': './src/extension.ts',
		'test/suite/index': './src/test/suite/index.ts'
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
			NOTETHINK_DEV: JSON.stringify(!isProduction),
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

/** @type WebpackConfig */
const clientWebviewConfig = {
	context: path.join(__dirname, 'client', 'webview'),
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'none',
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
			NOTETHINK_DEV: JSON.stringify(!isProduction),
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

module.exports = [ clientExtensionConfig, clientWebviewConfig ];