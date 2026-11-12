import fs from 'fs';
import os from 'os';
import path from 'path';
import { formatFindings, parseTerms, resolveWithinPack, scanText, type SanitiseFinding } from './sanitiseops';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, 'workflows');
const PACK_DIR = path.join(WORKFLOWS_DIR, 'chief-of-staff');
// the optional terms file lives outside the repo; this names the variable holding its path
const TERMS_ENV_VAR = 'WORKFLOWS_SANITISE_TERMS';

function listFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name === 'node_modules') { return []; }
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(full) : [full];
    });
}

function loadTerms(terms_path: string | undefined): string[] {
    if (!terms_path || !fs.existsSync(terms_path)) { return []; }
    return parseTerms(fs.readFileSync(terms_path, 'utf8'));
}

// each pack's files are scanned relative to that pack, which is what the link rule needs
function scanWorkflows(terms: string[]): SanitiseFinding[] {
    return listFiles(WORKFLOWS_DIR).flatMap((file) => {
        const pack_root = path.join(WORKFLOWS_DIR, path.relative(WORKFLOWS_DIR, file).split(path.sep)[0]);
        const relative = path.relative(pack_root, file).split(path.sep).join('/');
        return scanText(relative, fs.readFileSync(file, 'utf8'), terms);
    });
}

describe('workflows/ publish-safety scan', () => {
    it('finds no private or unsafe material in any workflow pack', () => {
        const findings = scanWorkflows(loadTerms(process.env[TERMS_ENV_VAR]));
        expect(formatFindings(findings)).toBe('');
    });

    it('reads a supplied terms file and reports its matches masked', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflows-terms-'));
        try {
            const terms_path = path.join(dir, 'terms.txt');
            fs.writeFileSync(terms_path, '# private terms\nchief of staff\n');
            const findings = scanWorkflows(loadTerms(terms_path));
            expect(findings.length).toBeGreaterThan(0);
            expect(findings.every((finding) => finding.rule === 'private-term')).toBe(true);
            expect(formatFindings(findings)).not.toMatch(/chief of staff/i);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('runs with no terms file, whether the variable is unset or names a missing file', () => {
        expect(loadTerms(undefined)).toEqual([]);
        expect(loadTerms(path.join(os.tmpdir(), 'workflows-no-such-terms-file.txt'))).toEqual([]);
        expect(() => scanWorkflows([])).not.toThrow();
    });
});

describe('chief-of-staff pack shape', () => {
    const expected_files = [
        'AGENTS.md', 'CLAUDE.md', 'README.md', 'todo.md', 'done.md',
        'skills/what-next/SKILL.md', 'skills/me-now/SKILL.md', 'scripts/move-to-done.mjs',
    ];

    it.each(expected_files)('ships %s', (file) => {
        expect(fs.existsSync(path.join(PACK_DIR, file))).toBe(true);
    });

    it('keeps CLAUDE.md to a single import of AGENTS.md', () => {
        expect(fs.readFileSync(path.join(PACK_DIR, 'CLAUDE.md'), 'utf8').trim()).toBe('@AGENTS.md');
    });

    it('opens the board as a kanban with the two-blank-line story spacing the rules require', () => {
        const todo = fs.readFileSync(path.join(PACK_DIR, 'todo.md'), 'utf8');
        expect(todo.startsWith('# Todo [](?nt_view=kanban)\n\n\n### ')).toBe(true);
        expect(todo).not.toMatch(/\n\n\n\n/);
        const stories = todo.split(/\n(?=### )/).slice(1);
        expect(stories.length).toBeGreaterThanOrEqual(3);
        // splitting before each heading uses up one newline of the gap, so two blank lines leave a trailing pair
        for (const story of stories.slice(0, -1)) { expect(story.endsWith('\n\n')).toBe(true); }
        for (const story of stories) { expect(story).toMatch(/^### .+\[\]\(\?id=[a-z0-9-]+\)\n/); }
    });

    it('links every board story to an existing markdown file inside the pack', () => {
        const todo = fs.readFileSync(path.join(PACK_DIR, 'todo.md'), 'utf8');
        const stories = todo.split(/\n(?=### )/).slice(1);
        for (const story of stories) {
            const targets = [...story.matchAll(/\]\(([^)?#]+\.md)\)/g)].map((match) => match[1]);
            expect(targets.length).toBeGreaterThan(0);
            for (const target of targets) {
                const resolved = resolveWithinPack('todo.md', target);
                expect(resolved).toBeDefined();
                expect(fs.existsSync(path.join(PACK_DIR, resolved as string))).toBe(true);
            }
        }
    });

    it('resolves every markdown link in the pack to an existing file', () => {
        for (const file of listFiles(PACK_DIR).filter((candidate) => candidate.endsWith('.md'))) {
            const relative = path.relative(PACK_DIR, file).split(path.sep).join('/');
            const text = fs.readFileSync(file, 'utf8');
            for (const match of text.matchAll(/\]\(([^)\s?#]+)\)/g)) {
                if (/^[a-z]+:/i.test(match[1])) { continue; }
                const resolved = resolveWithinPack(relative, match[1]);
                expect(`${relative} -> ${match[1]}: ${resolved}`).toBeDefined();
                expect(fs.existsSync(path.join(PACK_DIR, resolved as string))).toBe(true);
            }
        }
    });
});
