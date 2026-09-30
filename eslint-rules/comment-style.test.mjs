import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import rule from './comment-style.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' } });
const OPTIONS = [{ maxLineLength: 60, trailingPeriod: true }];

tester.run('comment-style', rule, {
    valid: [
        { code: '// a short lowercase comment\nconst a = 1;', options: OPTIONS },
        { code: '/*\n * Capitalised prose block.\n */\nconst a = 1;', options: OPTIONS },
        { code: '/*\n * `content` may start with code.\n */\nconst a = 1;', options: OPTIONS },
        { code: '/*\n * frameStory starts with an identifier.\n */\nconst a = 1;', options: OPTIONS },
        { code: '/* one-line block */\nconst a = 1;', options: OPTIONS },
        { code: '/**\n * Header block.\n * - id: the key\n */\ninterface A {\n    // --- identity ---\n    id: string;\n}', options: OPTIONS },
        { code: '// React renders this twice\nconst a = 1;', options: OPTIONS },
        { code: '// ends with an ellipsis...\nconst a = 1;', options: OPTIONS },
        { code: '// two sentences. Both keep a stop.\nconst a = 1;', options: OPTIONS },
        { code: '// see https://example.com/a/very/long/path/that/would/exceed/the/limit/otherwise\nconst a = 1;', options: OPTIONS },
        { code: '// Wednesday 2026-09-23 02:00 UTC is inside the window\nconst a = 1;', options: OPTIONS },
        { code: '// eslint-disable-next-line no-console\nconst a = 1;', options: OPTIONS },
    ],
    invalid: [
        { code: '/*\n * lowercase prose block.\n */\nconst a = 1;', options: OPTIONS, errors: [{ messageId: 'blockCapital' }] },
        { code: '/*\n * congruence-seeking prose block.\n */\nconst a = 1;', options: OPTIONS, errors: [{ messageId: 'blockCapital' }] },
        { code: 'interface A {\n    /** the id */\n    id: string;\n}', options: OPTIONS, errors: [{ messageId: 'fieldComment' }] },
        { code: 'type A = {\n    id: string; // the id\n};', options: OPTIONS, errors: [{ messageId: 'fieldComment' }] },
        { code: '// The value is cached\nconst a = 1;', options: OPTIONS, errors: [{ messageId: 'lineLowercase' }] },
        { code: '// this comment runs well past the sixty character limit set for the test\nconst a = 1;', options: OPTIONS, errors: [{ messageId: 'lineLength' }] },
        { code: '// no trailing period.\nconst a = 1;', options: OPTIONS, errors: [{ messageId: 'trailingPeriod' }] },
        { code: '// see above for why\nconst a = 1;', options: OPTIONS, errors: [{ messageId: 'backReference' }] },
        { code: '// pinned (measured 2026-09-10)\nconst a = 1;', options: OPTIONS, errors: [{ messageId: 'backReference' }] },
    ],
});
