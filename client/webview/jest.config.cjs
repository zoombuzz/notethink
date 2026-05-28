/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.jest.json',
    }],
  },
  moduleNameMapper: {
    // handle CSS files
    '\\.(css|scss|sass)$': 'identity-obj-proxy',
    // force a single React copy so hooks imported from notethink-views run against the same React instance the test runner uses (notethink-views ships its own node_modules/react which would otherwise resolve to a different react@x.y.z and trigger "Invalid hook call")
    '^react$': '<rootDir>/node_modules/react',
    '^react-dom$': '<rootDir>/node_modules/react-dom',
    '^react/jsx-runtime$': '<rootDir>/node_modules/react/jsx-runtime',
    '^react/jsx-dev-runtime$': '<rootDir>/node_modules/react/jsx-dev-runtime',
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
