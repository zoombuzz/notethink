import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

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
            // automated audit checks (coding-standards-audit-remediation) — kept at "warn" not "error"
            // error-level would fail the gate on the test-side backlog (173 test `any`, ~1330 test missing return types), out of scope here
            // warn still surfaces violations in editors/CI and blocks casual new ones; bump to "error" once the test backlog is cleared
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