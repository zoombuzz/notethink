import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import noConsecutiveLineComments from "./eslint-rules/no-consecutive-line-comments.mjs";
import noMidfunctionBlockComments from "./eslint-rules/no-midfunction-block-comments.mjs";
import commentStyle from "./eslint-rules/comment-style.mjs";

const localPlugin = {
    rules: {
        "no-consecutive-line-comments": noConsecutiveLineComments,
        "no-midfunction-block-comments": noMidfunctionBlockComments,
        "comment-style": commentStyle,
    },
};

/*
 * Shared selectors enforcing the log-source convention: the first argument to the structured logger
 * is a source IDENTIFIER (the camelCase name of the enclosing function), never a sentence, and
 * writeToErrorLog carries an error object as its third argument. Winston indexes on the source
 * field, so a sentence there is unsearchable and a source shared by many call sites matches them
 * all at once. Kept byte-identical to the same const in the sibling projects that share this
 * logger - copy it whole, do not edit one copy in isolation.
 */
const restrictedSyntax = [
    {
        selector:
            "CallExpression[callee.name='writeToErrorLog'][arguments.length<3]",
        message:
            'writeToErrorLog needs (source, message, error): pass the error object, or use ' +
            "writeToLogAtLevel('error', ...) when there is no error to attach.",
    },
    {
        selector:
            "CallExpression[callee.name=/^(writeToErrorLog|writeToLogAtLevel)$/] > Literal.arguments[value=/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/]",
        message:
            "a bare HTTP-method log source loses route context: build a 'route/METHOD' source const " +
            "(e.g. const source = 'admin/family/status/POST').",
    },
];

export default [
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/out/**",
            "**/coverage/**",
            "**/.vscode-test/**",
            "**/.vscode-test-web/**",
            "**/*.js",
            "**/*.cjs",
            "**/*.mjs",
            // diff-side fixtures: stored file content named by hash, with source extensions but not source
            "playwright/fixtures/activity/blobs/**",
        ],
    },
    {
        files: ["**/*.ts", "**/*.tsx"],

        plugins: {
            "@typescript-eslint": typescriptEslint,
            local: localPlugin,
        },

        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2022,
            sourceType: "module",
        },

        rules: {

            curly: "warn",
            eqeqeq: "warn",
            "no-throw-literal": "warn",
            semi: "warn",
            // a leading underscore marks a deliberately unused argument, variable or caught error
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
            }],
            "local/no-consecutive-line-comments": "error",
            "local/no-midfunction-block-comments": "error",
            "local/comment-style": ["error", { maxLineLength: 120, trailingPeriod: true }],
            "no-restricted-syntax": ["error", ...restrictedSyntax],
            // warn, not error, until the test-side backlog of `any` and missing return types is cleared
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/consistent-type-imports": "warn",
            "@typescript-eslint/explicit-function-return-type": ["warn", {
                allowExpressions: true,
                allowTypedFunctionExpressions: true,
                allowHigherOrderFunctions: true,
            }],
            "max-lines-per-function": ["warn", { max: 80, skipBlankLines: true, skipComments: true }],
        },
    },
    {
        // suite and spec bodies are namespaces, not units, so the 80-line function cap does not fit them
        files: ["**/*.test.ts", "**/*.test.tsx", "**/test/suite/**/*.ts", "playwright/**/*.ts"],
        rules: {
            "max-lines-per-function": "off",
        },
    },
];