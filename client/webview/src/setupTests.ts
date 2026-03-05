import '@testing-library/jest-dom';

// mock debug library to avoid console noise in tests
jest.mock('debug', () => {
    return () => () => {};
});
