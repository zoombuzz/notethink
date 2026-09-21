/**
 * @jest-environment node
 *
 * CODE_LAYOUT.md > Blank lines: no blank line sits between two statements inside a block. That doc
 * keeps it as a review rule because `padding-line-between-statements` has no inside-blocks-only
 * scope and would strip the separation between top-level declarations too, so the rule is encoded
 * here instead, over every source file under `client/` and therefore across all three packages.
 *
 * A blank line before a comment line is an offence like any other: the canonical rule groups related
 * statements behind a single comment line with no blank line before or after it, so there is no
 * exemption here for a blank that opens a commented section.
 *
 * Blocks are found through the TypeScript parser rather than by regex, because only a real
 * statement list tells a blank line between two statements apart from one inside an object literal,
 * a JSX tree, a template literal or a multi-line call, none of which this rule touches. A
 * SourceFile is not a Block, so blank lines between top-level declarations are never visited.
 *
 * Scope is source, not specs: `*.test.ts` and `*.test.tsx` are excluded, matching the sweep the
 * rule was adopted for. There is no allowlist. Offenders print as `file:line` from the repo root.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLIENT_ROOT = path.join(REPO_ROOT, 'client');
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const SKIPPED_DIRECTORY_NAMES = ['node_modules', 'dist', '.vscode-test-web'];
const TEST_FILE_PATTERN = /\.test\.tsx?$/;
// a walk that silently found nothing would pass forever, so hold it to a floor well under the real count
const MINIMUM_SOURCE_FILES = 100;

function isSourceFile(file_name: string): boolean {
    return SOURCE_EXTENSIONS.includes(path.extname(file_name)) && !TEST_FILE_PATTERN.test(file_name);
}

function listSourceFiles(start_dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(start_dir, {withFileTypes: true})) {
        const full_path = path.join(start_dir, entry.name);
        if (entry.isDirectory() && !SKIPPED_DIRECTORY_NAMES.includes(entry.name)) {
            found.push(...listSourceFiles(full_path));
        } else if (entry.isFile() && isSourceFile(entry.name)) {
            found.push(full_path);
        }
    }
    return found;
}

function parseSourceFile(file_path: string, text: string): ts.SourceFile {
    const script_kind = file_path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    return ts.createSourceFile(file_path, text, ts.ScriptTarget.Latest, true, script_kind);
}

/**
 * Every statement list the rule governs: a block body (function, conditional, loop, try, catch,
 * finally, or a bare block) and the statements of a switch clause, which carries them without one.
 */
function collectStatementLists(source_file: ts.SourceFile): ts.NodeArray<ts.Statement>[] {
    const lists: ts.NodeArray<ts.Statement>[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
            lists.push(node.statements);
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(source_file, visit);
    return lists;
}

function isBlankLine(line: string | undefined): boolean {
    return (line ?? '').trim().length === 0;
}

/**
 * The 1-based offending lines in the gap between two adjacent statements. The gap runs to the start
 * of the next statement's own text, so the comment lines leading it are inside the window and a
 * blank above them counts like any other.
 */
function offendingLinesBetween(source_file: ts.SourceFile, lines: string[], previous: ts.Statement, next: ts.Statement): number[] {
    const first_line = source_file.getLineAndCharacterOfPosition(previous.getEnd()).line + 1;
    const last_line = source_file.getLineAndCharacterOfPosition(next.getStart(source_file)).line - 1;
    const offenders: number[] = [];
    for (let index = first_line; index <= last_line; index += 1) {
        if (isBlankLine(lines[index])) {
            offenders.push(index + 1);
        }
    }
    return offenders;
}

function findOffenders(file_path: string): string[] {
    const text = fs.readFileSync(file_path, 'utf8');
    const source_file = parseSourceFile(file_path, text);
    const lines = text.split('\n');
    const relative_path = path.relative(REPO_ROOT, file_path);
    const offending_lines: number[] = [];
    for (const statements of collectStatementLists(source_file)) {
        for (let index = 1; index < statements.length; index += 1) {
            offending_lines.push(...offendingLinesBetween(source_file, lines, statements[index - 1], statements[index]));
        }
    }
    return [...new Set(offending_lines)].sort((a, b) => a - b).map((line) => `${relative_path}:${line}`);
}

const source_files = listSourceFiles(CLIENT_ROOT);

describe('CODE_LAYOUT.md > Blank lines', () => {
    it('finds the client source files', () => {
        expect(source_files.length).toBeGreaterThan(MINIMUM_SOURCE_FILES);
    });

    it('has no blank line between two statements inside a block', () => {
        const offenders = source_files.flatMap(findOffenders);
        const offending_files = new Set(offenders.map((entry) => entry.slice(0, entry.lastIndexOf(':'))));
        const report = [`${offenders.length} blank lines in ${offending_files.size} files`, ...offenders].join('\n');
        expect(report).toBe('0 blank lines in 0 files');
    });
});
