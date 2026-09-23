import '@testing-library/jest-dom';

// mock debug library to avoid console noise in tests
jest.mock('debug', () => {
    return () => () => {};
});

// close the channels setupEnv recorded, so no open port holds the jest worker once this file's tests finish
afterAll(() => {
    const channels = (globalThis as { __nt_open_message_channels?: MessageChannel[] }).__nt_open_message_channels ?? [];
    for (const channel of channels.splice(0)) {
        channel.port1.close();
        channel.port2.close();
    }
});
