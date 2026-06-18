import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/*
 * local rule enforcing CODING_STANDARDS.md > Comments: an inline line comment is exactly one line,
 * never two standalone `//` lines in a row. A wrapped thought, several stacked thoughts, or an
 * ASCII/structure illustration is too complex to be inline and belongs in a block (header) comment.
 * Skips directive comments (eslint-*, @ts-*, etc.) and trailing comments (a `//` after code on the
 * same line); only two standalone line comments on consecutive lines are reported.
 */
const noConsecutiveLineComments = {
    meta: {
        type: "problem",
        docs: { description: "an inline line comment is one line; stacked/wrapped comments belong in a block (header) comment" },
        messages: { consecutive: "consecutive // comments — make it one line or lift to a block (header) comment" },
        schema: [],
    },
    create(context) {
        const source_code = context.sourceCode ?? context.getSourceCode();
        const directive = /^\s*(eslint\b|eslint-|globals?\b|exported\b|@ts-|prettier-ignore|c8\b|istanbul\b|v8\b|@jsx)/;
        const isStandalone = (comment) => {
            const before = source_code.getTokenBefore(comment, { includeComments: true });
            return !before || before.loc.end.line < comment.loc.start.line;
        };
        return {
            Program() {
                let prev = null;
                for (const comment of source_code.getAllComments()) {
                    if (comment.type !== "Line" || directive.test(comment.value) || !isStandalone(comment)) {
                        prev = null;
                        continue;
                    }
                    if (prev && comment.loc.start.line === prev.loc.end.line + 1) {
                        context.report({ loc: comment.loc, messageId: "consecutive" });
                    }
                    prev = comment;
                }
            },
        };
    },
};

const localPlugin = { rules: { "no-consecutive-line-comments": noConsecutiveLineComments } };

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
            "local/no-consecutive-line-comments": "error",
            /*
             * automated audit checks (coding-standards-audit-remediation) — kept at "warn" not "error".
             * error-level would fail the gate on the test-side backlog (173 test `any`, ~1330 test missing
             * return types), out of scope here. warn still surfaces violations in editors/CI and blocks
             * casual new ones; bump to "error" once the test backlog is cleared
             */
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
        // test-suite and playwright spec bodies are namespaces (describe/suite wrapping many tests, or end-to-end scenarios) — they do not fit the 80-line function-length cap, which is calibrated for production unit clarity
        files: ["**/*.test.ts", "**/*.test.tsx", "**/test/suite/**/*.ts", "playwright/**/*.ts"],
        rules: {
            "max-lines-per-function": "off",
        },
    },
];