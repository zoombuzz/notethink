#!/usr/bin/env node
/**
 * Moves a finished story from todo.md to the end of done.md.
 *
 * usage: node move-to-done.mjs <story> [--dir <folder>] [--todo <file>] [--done <file>] [--dry-run]
 *
 * <story> is the id= value on the heading, or else the heading title as written or as a slug.
 * Exit code 0 when the story moved (or would, under --dry-run), 1 when it was refused, 2 on bad usage.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OPEN_BOX = /^\s*[-+*]\s+\[ \]/;
const HEADING = /^(#{1,3})\s/;
const LINETAG = /\s*\[\]\(\?([^)]*)\)/;

export function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function headingParts(line) {
    const tag = LINETAG.exec(line);
    const title = line.replace(/^#+\s+/, '').replace(LINETAG, '').trim();
    const params = new URLSearchParams(tag ? tag[1] : '');
    return { title, params };
}

/**
 * Returns the [start, end) line range of every story heading matching the reference.
 * A story runs from its `###` heading to the next heading of level three or above.
 */
export function findStories(lines, reference) {
    const wanted = slugify(reference);
    const found = [];
    lines.forEach((line, index) => {
        if (!/^###\s/.test(line)) { return; }
        const { title, params } = headingParts(line);
        const matches = params.get('id') === reference || title === reference || slugify(title) === wanted;
        if (!matches) { return; }
        let end = index + 1;
        while (end < lines.length && !HEADING.test(lines[end])) { end++; }
        found.push([index, end]);
    });
    return found;
}

/** Removes the status key from a heading's linetag, dropping the linetag when nothing else is left. */
export function stripStatus(heading) {
    const tag = LINETAG.exec(heading);
    if (!tag) { return heading; }
    const rest = tag[1].split('&').filter((pair) => pair !== '' && pair.split('=')[0] !== 'status').join('&');
    return heading.replace(LINETAG, rest ? ` [](?${rest})` : '');
}

function trimBlank(lines) {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start].trim() === '') { start++; }
    while (end > start && lines[end - 1].trim() === '') { end--; }
    return lines.slice(start, end);
}

/** Rebuilds todo.md without the story, keeping two blank lines between the stories that remain. */
export function removeStory(lines, start, end) {
    const before = trimBlank(lines.slice(0, start));
    const after = trimBlank(lines.slice(end));
    if (after.length === 0) { return before.join('\n') + '\n'; }
    const after_epic = before.length > 0 && /^## /.test(before[before.length - 1]) && /^### /.test(after[0]);
    const gap = after_epic ? '\n\n' : '\n\n\n';
    return before.join('\n') + (before.length > 0 ? gap : '') + after.join('\n') + '\n';
}

export function appendStory(done_text, story_lines) {
    const base = done_text.trim() === '' ? '# Done' : done_text.replace(/\s+$/, '');
    return base + '\n\n\n' + story_lines.join('\n') + '\n';
}

/** Plans the move without touching a file: returns { ok, message, todo_text, done_text }. */
export function planMove(todo_text, done_text, reference) {
    const lines = todo_text.split('\n');
    const matches = findStories(lines, reference);
    if (matches.length === 0) { return { ok: false, message: `no story matches "${reference}"` }; }
    if (matches.length > 1) { return { ok: false, message: `"${reference}" matches ${matches.length} stories, use its id` }; }
    const [start, end] = matches[0];
    const story = trimBlank(lines.slice(start, end));
    const open = story.filter((line) => OPEN_BOX.test(line));
    if (open.length > 0) {
        return { ok: false, message: `refusing: ${open.length} open box(es) remain under "${headingParts(story[0]).title}"` };
    }
    const moved = [stripStatus(story[0]), ...story.slice(1)];
    return {
        ok: true,
        message: `moved "${headingParts(story[0]).title}" (${story.length} lines) to the end of done.md`,
        todo_text: removeStory(lines, start, end),
        done_text: appendStory(done_text, moved),
    };
}

function parseArgs(argv) {
    const options = { dry_run: false, positional: [] };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--dry-run') { options.dry_run = true; }
        else if (arg === '--dir' || arg === '--todo' || arg === '--done') { options[arg.slice(2)] = argv[++index]; }
        else { options.positional.push(arg); }
    }
    return options;
}

export function main(argv) {
    const options = parseArgs(argv);
    if (options.positional.length !== 1) {
        console.error('usage: move-to-done.mjs <story> [--dir <folder>] [--todo <file>] [--done <file>] [--dry-run]');
        return 2;
    }
    const dir = resolve(options.dir ?? '.');
    const todo_path = resolve(options.todo ?? join(dir, 'todo.md'));
    const done_path = resolve(options.done ?? join(dir, 'done.md'));
    if (!existsSync(todo_path)) {
        console.error(`no todo file at ${todo_path}`);
        return 2;
    }
    const done_text = existsSync(done_path) ? readFileSync(done_path, 'utf8') : '';
    const plan = planMove(readFileSync(todo_path, 'utf8'), done_text, options.positional[0]);
    if (!plan.ok) {
        console.error(plan.message);
        return 1;
    }
    if (options.dry_run) {
        console.log(`dry run: ${plan.message}`);
        return 0;
    }
    writeFileSync(done_path, plan.done_text);
    writeFileSync(todo_path, plan.todo_text);
    console.log(plan.message);
    return 0;
}

if (process.argv[1]?.endsWith('move-to-done.mjs')) {
    process.exitCode = main(process.argv.slice(2));
}
