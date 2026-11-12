import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '..', '..', '..', '..', 'workflows', 'chief-of-staff', 'scripts', 'move-to-done.mjs');

const TODO = [
    '# Todo [](?nt_view=kanban)',
    '',
    '',
    '### Finished story [](?status=code-review&id=finished&epic=wave)',
    '',
    'Some prose.',
    '',
    '+ [X] first task',
    '+ [X] second task',
    '  + [X] nested task',
    '+ manual: a check for a human',
    '',
    '',
    '### Open story [](?status=doing&id=open-one)',
    '',
    '+ [X] done task',
    '+ [ ] open task',
    '',
    '',
    '### Last story',
    '',
    '+ [X] only task',
    '',
].join('\n');

const DONE = ['# Done', '', '', '### Earlier story', '', '+ [X] shipped', ''].join('\n');

let dir: string;

function run(args: string[]): { code: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function read(name: string): string {
    return fs.readFileSync(path.join(dir, name), 'utf8');
}

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'move-to-done-'));
    fs.writeFileSync(path.join(dir, 'todo.md'), TODO);
    fs.writeFileSync(path.join(dir, 'done.md'), DONE);
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('move-to-done.mjs', () => {
    it('appends the story at the end of done.md and removes it from todo.md', () => {
        const result = run(['finished', '--dir', dir]);
        expect(result.code).toBe(0);
        const done = read('done.md');
        expect(done.startsWith(DONE.trimEnd() + '\n\n\n### Finished story')).toBe(true);
        expect(done.endsWith('+ manual: a check for a human\n')).toBe(true);
        expect(read('todo.md')).not.toContain('Finished story');
    });

    it('strips the status key, keeps the other keys, and leaves the others untouched', () => {
        run(['finished', '--dir', dir]);
        expect(read('done.md')).toContain('### Finished story [](?id=finished&epic=wave)');
        expect(read('todo.md')).toContain('### Open story [](?status=doing&id=open-one)');
    });

    it('drops the linetag when status was its only key', () => {
        fs.writeFileSync(path.join(dir, 'todo.md'), '# Todo\n\n\n### Solo [](?status=testing)\n\n+ [X] t\n');
        run(['Solo', '--dir', dir]);
        expect(read('done.md')).toContain('\n\n\n### Solo\n');
    });

    it('keeps exactly two blank lines between the stories that remain', () => {
        run(['finished', '--dir', dir]);
        const todo = read('todo.md');
        expect(todo.startsWith('# Todo [](?nt_view=kanban)\n\n\n### Open story')).toBe(true);
        expect(todo).not.toMatch(/\n\n\n\n/);
        expect(todo.endsWith('\n')).toBe(true);
    });

    it('finds a story by title or by slug of its title', () => {
        expect(run(['Last story', '--dir', dir]).code).toBe(0);
        expect(read('done.md')).toContain('### Last story');
    });

    it('refuses while a box is open and changes nothing', () => {
        const result = run(['open-one', '--dir', dir]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('open box');
        expect(read('todo.md')).toBe(TODO);
        expect(read('done.md')).toBe(DONE);
    });

    it('does not count a manual check as an open box', () => {
        expect(run(['finished', '--dir', dir]).code).toBe(0);
    });

    it('writes nothing under --dry-run, and says what it would do', () => {
        const result = run(['finished', '--dir', dir, '--dry-run']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('dry run');
        expect(read('todo.md')).toBe(TODO);
        expect(read('done.md')).toBe(DONE);
    });

    it('refuses an unknown story and an ambiguous one', () => {
        expect(run(['nothing-here', '--dir', dir]).code).toBe(1);
        fs.writeFileSync(path.join(dir, 'todo.md'), '# Todo\n\n\n### Twin\n\n+ [X] a\n\n\n### Twin\n\n+ [X] b\n');
        const result = run(['Twin', '--dir', dir]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('matches 2 stories');
    });

    it('creates done.md when it is missing', () => {
        fs.rmSync(path.join(dir, 'done.md'));
        expect(run(['finished', '--dir', dir]).code).toBe(0);
        expect(read('done.md').startsWith('# Done\n\n\n### Finished story')).toBe(true);
    });

    it('honours explicit --todo and --done paths and reports usage errors', () => {
        const todo = path.join(dir, 'board', 'a.md');
        const done = path.join(dir, 'board', 'b.md');
        fs.mkdirSync(path.dirname(todo));
        fs.writeFileSync(todo, TODO);
        expect(run(['finished', '--todo', todo, '--done', done]).code).toBe(0);
        expect(fs.readFileSync(done, 'utf8')).toContain('### Finished story');
        expect(run([]).code).toBe(2);
        expect(run(['x', '--dir', path.join(dir, 'missing')]).code).toBe(2);
    });
});
