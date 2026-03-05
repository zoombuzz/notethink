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
  'property-information',
  'comma-separated-tokens',
  'space-separated-tokens',
  'web-namespaces',
  'vfile.*',
  'bail',
  'is-plain-obj',
  'trough',
  'decode-named-character-reference',
  'character-entities.*',
  'stringify-entities',
  'trim-lines',
].join('|');

// eslint-disable-next-line no-undef
module.exports = {
  globals: {
    NOTETHINK_VERSION: 'test',
  },
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
    // transform ESM-only node_modules with babel
    '^.+\\.js$': ['babel-jest', {
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    }],
  },
  // allow all ESM packages to be transformed via babel
  // the unified ecosystem (hast-util, mdast-util, etc.) has many ESM-only packages
  transformIgnorePatterns: [],
  moduleNameMapper: {
    // handle CSS modules
    '\\.module\\.(css|scss|sass)$': 'identity-obj-proxy',
    // handle regular CSS
    '\\.(css|scss|sass)$': 'identity-obj-proxy',
    // handle path aliases
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/src/setupEnv.js'],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  testMatch: [
    '<rootDir>/src/**/*.test.{ts,tsx}',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.stories.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
};
