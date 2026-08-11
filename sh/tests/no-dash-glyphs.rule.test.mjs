#!/usr/bin/env node
/**
 * Coverage for the local/no-dash-glyphs ESLint rule.
 *
 * WHY IT LIVES HERE RATHER THAN BESIDE THE RULE. Every app's jest testMatch is scoped to its own
 * source tree (zooey's is `<rootDir>/src/**`), so a test placed next to the rule in
 * `nodejs/<app>/eslint-rules/` would never be collected and would quietly never run - the same
 * class of silence this whole guardrail exists to prevent. It sits under `sh/tests/` alongside the
 * shell guard's harness, is run the same way, and is byte-identical in every repo that carries the
 * rule.
 *
 * It locates the rule itself rather than hardcoding a path, because the app directory differs per
 * repo (calfam-nextjs, ledger, dulcet, aawai, zahara, zooey). If a repo grows a second copy, every
 * copy found is tested - divergence between copies is exactly the failure mode worth catching.
 *
 * ESLint's RuleTester throws on a failed assertion and needs no test framework, so this is a plain
 * node script: `node sh/tests/no-dash-glyphs.rule.test.mjs`.
 *
 * This file must not contain either glyph, since the shell guard scans it like anything else. The
 * fixtures are built with String.fromCharCode, exactly as the rule under test builds its needles.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const AMP = String.fromCharCode(0x0026);
const EM_ENTITY = `${AMP}mdash;`;
const EN_ENTITY = `${AMP}ndash;`;

// find every copy of the rule: nodejs/<app>/eslint-rules/no-dash-glyphs.mjs
function findRuleCopies() {
    const apps_dir = path.join(REPO_ROOT, 'nodejs');
    if (!fs.existsSync(apps_dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(apps_dir, {withFileTypes: true})) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(apps_dir, entry.name, 'eslint-rules', 'no-dash-glyphs.mjs');
        if (fs.existsSync(candidate)) out.push({app: entry.name, rule_path: candidate});
    }
    return out;
}

const copies = findRuleCopies();
if (copies.length === 0) {
    console.log('no-dash-glyphs: no copy of the rule in this repo, nothing to test');
    process.exit(0);
}

let failures = 0;

for (const {app, rule_path} of copies) {
    const app_dir = path.join(REPO_ROOT, 'nodejs', app);
    let RuleTester;
    try {
        // eslint is a dependency of the app, not of the repo root, so resolve from the app
        const require_from_app = createRequire(path.join(app_dir, 'package.json'));
        ({RuleTester} = require_from_app('eslint'));
    } catch (err) {
        console.log(`  SKIP ${app}: eslint not resolvable from the app (${err.message})`);
        continue;
    }

    const rule = (await import(pathToFileURL(rule_path).href)).default;
    const tester = new RuleTester({languageOptions: {ecmaVersion: 2022, sourceType: 'module'}});

    try {
        tester.run('local/no-dash-glyphs', rule, {
            valid: [
                {code: 'const a = 1; // a plain hyphen - like this - is fine\n'},
                {code: 'const s = "no glyphs here at all";\n'},
                // the codepoint NAMED in prose is not the codepoint itself: a rule that cannot tell
                // the difference penalises the docs that explain it, which is the bug class this
                // workspace has hit repeatedly
                {code: 'const s = "U+2014 is banned"; // mdash entity, spelled out\n'},
            ],
            invalid: [
                {
                    code: `const s = "an ${EM} dash";\n`,
                    output: 'const s = "an - dash";\n',
                    errors: [{messageId: 'banned'}],
                },
                {
                    code: `const s = "an ${EN} dash";\n`,
                    output: 'const s = "an - dash";\n',
                    errors: [{messageId: 'banned'}],
                },
                // a comment is not an AST node the usual visitors reach; the rule scans raw source
                // precisely so comments are covered, and that is worth pinning
                {
                    code: `const a = 1; // trailing ${EM} comment\n`,
                    output: 'const a = 1; // trailing - comment\n',
                    errors: [{messageId: 'banned'}],
                },
                {
                    code: `const s = \`template ${EN} literal\`;\n`,
                    output: 'const s = `template - literal`;\n',
                    errors: [{messageId: 'banned'}],
                },
                // the HTML entities render as the same glyph, so they are banned too
                {
                    code: `const s = "${EM_ENTITY}";\n`,
                    output: 'const s = "-";\n',
                    errors: [{messageId: 'banned'}],
                },
                {
                    code: `const s = "${EN_ENTITY}";\n`,
                    output: 'const s = "-";\n',
                    errors: [{messageId: 'banned'}],
                },
                // every occurrence is reported, not just the first: a one-report-per-file rule
                // would leave a backlog that eslint --fix appears to clear but does not
                {
                    code: `const s = "${EM} and ${EN}";\n`,
                    output: 'const s = "- and -";\n',
                    errors: [{messageId: 'banned'}, {messageId: 'banned'}],
                },
            ],
        });
        console.log(`  ok   ${app}: no-dash-glyphs passes 3 valid and 7 invalid cases`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${app}: ${err.message}`);
    }
}

console.log('');
if (failures > 0) {
    console.log(`no-dash-glyphs: ${failures} copy/copies failed`);
    process.exit(1);
}
console.log(`no-dash-glyphs: all ${copies.length} copy/copies pass`);
