/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  moduleNameMapper: {
    // handle CSS files
    '\\.(css|scss|sass)$': 'identity-obj-proxy',
  },
  setupFiles: ['<rootDir>/src/setupEnv.js'],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  testMatch: [
    '<rootDir>/src/**/*.test.{ts,tsx}',
  ],
  // exclude notethink-views tests (they have their own jest config)
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/notethink-views/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
