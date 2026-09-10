/** @type {import('jest').Config} */

// unified ecosystem packages are ESM-only and need transformation
const esm_packages = [
  'hast-util-.*',
  'mdast-util-.*',
  'unist-util-.*',
  'micromark.*',
  'devlop',
  'ccount',
  'escape-string-regexp',
  'markdown-table',
  'longest-streak',
  'zwitch',
  'decode-named-character-reference',
  'character-entities.*',
  'vfile.*',
  'bail',
  'is-plain-obj',
  'trough',
  'trim-lines',
].join('|');

/*
 * The vscode module is mocked below; winston-transport-vscode deliberately is not. Its dist requires
 * only logform, triple-beam and winston-transport, never vscode, and it takes the output channel as a
 * constructor argument, so the real transport runs here against the vscode mock's channel. The mock it
 * replaced had a no-op log(), which is why no test could see that createLogger was dropping every record.
 */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        target: 'ES2023',
        module: 'commonjs',
        moduleResolution: 'node10',
        ignoreDeprecations: '6.0',
        esModuleInterop: true,
        strict: true,
        skipLibCheck: true,
        isolatedModules: true,
        resolveJsonModule: true,
      },
    }],
    // transform ESM-only node_modules with babel
    '^.+\\.js$': ['babel-jest', {
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    }],
  },
  // allow ESM packages to be transformed via babel
  transformIgnorePatterns: [],
  moduleNameMapper: {
    // mock the vscode module
    '^vscode$': '<rootDir>/src/__mocks__/vscode.ts',
  },
  testMatch: [
    '<rootDir>/src/**/*.test.ts',
  ],
  // exclude the old mocha test suite
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/src/test/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
