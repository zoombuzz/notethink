/**
 * Ambient type declarations for the WebWorker extension environment.
 *
 * The extension targets "lib": ["WebWorker", "ES2023"] but uses several
 * Node-like modules that are polyfilled by webpack at build time. These
 * declarations satisfy tsc --noEmit without pulling in the full @types/node.
 */

// webpack polyfill for `util` (util@0.12.x browser shim)
declare module 'util' {
    export function format(fmt: string, ...args: unknown[]): string;
    export function inspect(obj: unknown, opts?: unknown): string;
}

// webpack polyfill for `assert` (assert@2.x browser shim, used in mocha tests)
declare module 'assert' {
    function assert(value: unknown, message?: string | Error): asserts value;
    namespace assert {
        function ok(value: unknown, message?: string | Error): asserts value;
        function strictEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T;
        function notStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void;
        function deepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void;
        function match(value: string, regexp: RegExp, message?: string | Error): void;
        function fail(message?: string | Error): never;
    }
    export = assert;
}

// injected by webpack DefinePlugin - true for dev builds, false for production
declare const NOTETHINK_DEV: boolean;

// `global` object available at runtime via webpack's node polyfills
declare var global: typeof globalThis & {
    setImmediate: ((callback: (...args: unknown[]) => void, ...args: unknown[]) => number) | undefined;
};
