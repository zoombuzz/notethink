import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import {
    ABSENT_VALUE_BUCKET,
    PROTOCOL_VERSION,
    VIEW_REGISTRY,
    buildKanbanDragEndPayload,
    calculateTextChangesForCheckbox,
    calculateTextChangesForNewLinetagValue,
    convertMdastToNoteHierarchy,
    flattenAllNotes,
    kanbanColumnValue,
    kanbanNoteOrder,
    notesInKanbanColumn,
    parse,
    selectableViewIds,
    stripHeadlineLinetags,
    type EditTextChange,
    type NoteProps,
} from './core';

const BOARD = [
    '# Board',
    '',
    '### First story [](?status=doing&id=first)',
    '',
    '+ [ ] write it',
    '+ [X] plan it',
    '',
    '### Second story',
    '',
    'Some body text.',
    '',
].join('\n');

// a module specifier a renderer-neutral module must never pull in at load
const FORBIDDEN_IMPORTS = [/^react(-dom)?(\/|$)/, /^@hello-pangea\//, /^mermaid$/, /\.(scss|sass|css)$/];
const IMPORT_PATTERN = /^(?:import|export)\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm;

function treeOf(text: string): NoteProps {
    return convertMdastToNoteHierarchy(parse(text), text);
}

function storiesOf(text: string): NoteProps[] {
    return flattenAllNotes(treeOf(text)).filter(note => note.type === 'heading' && note.depth === 3);
}

// applies changes the way a host does: from the end of the text backwards, so earlier offsets stay valid
function applyChanges(text: string, changes: EditTextChange[]): string {
    let result = text;
    for (const change of [...changes].sort((a, b) => b.from - a.from)) {
        result = result.slice(0, change.from) + change.insert + result.slice(change.to ?? change.from);
    }
    return result;
}

function resolveSource(from_file: string, specifier: string): string | undefined {
    const base = join(dirname(from_file), specifier);
    return [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(candidate => existsSync(candidate));
}

/** Every module specifier reachable from a source file by a value import or re-export, with the file that names it. */
function reachableImports(entry_file: string): Array<{ file: string; specifier: string }> {
    const found: Array<{ file: string; specifier: string }> = [];
    const visited = new Set<string>();
    const pending = [entry_file];
    while (pending.length > 0) {
        const file = pending.pop()!;
        if (visited.has(file)) { continue; }
        visited.add(file);
        for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_PATTERN)) {
            const specifier = match[1];
            found.push({ file, specifier });
            const source = specifier.startsWith('.') ? resolveSource(file, specifier) : undefined;
            if (source) { pending.push(source); }
        }
    }
    return found;
}

describe('core entry point', () => {
    it('reads a board into stories with their status and tasks', () => {
        const stories = storiesOf(BOARD);
        expect(stories.map(story => stripHeadlineLinetags(story.headline_raw))).toEqual(['First story', 'Second story']);
        expect(stories.map(story => kanbanColumnValue(story))).toEqual(['doing', ABSENT_VALUE_BUCKET]);
        expect(stories[0].linetags?.id?.value).toBe('first');
    });
    it('turns a status change into text changes that a reparse confirms', () => {
        const [, second] = storiesOf(BOARD);
        const changes = calculateTextChangesForNewLinetagValue(second, 'status', 'code-review', ABSENT_VALUE_BUCKET);
        expect(changes.length).toBeGreaterThan(0);
        const edited = applyChanges(BOARD, changes);
        expect(storiesOf(edited).map(story => kanbanColumnValue(story))).toEqual(['doing', 'code-review']);
        // the first story's text is untouched by an edit to the second
        expect(edited.startsWith(BOARD.slice(0, BOARD.indexOf('### Second story')))).toBe(true);
    });
    it('turns a task tick into a text change that a reparse confirms', () => {
        const [first] = storiesOf(BOARD);
        const changes = calculateTextChangesForCheckbox(first, true, 'write it', []);
        expect(changes).toHaveLength(1);
        const edited = applyChanges(BOARD, changes);
        const tasks = flattenAllNotes(treeOf(edited)).filter(note => note.type === 'listItem');
        expect(tasks.map(note => note.checked)).toEqual([true, true]);
    });
    it('turns a drop into another column into the edit a kanban drop sends, and a reparse confirms the order', () => {
        const board = ['# Board', '', '### One [](?status=doing)', '', '### Two [](?status=doing)', '', '### Three', ''].join('\n');
        const stories = storiesOf(board);
        const message = buildKanbanDragEndPayload({
            dragged_note: stories[2],
            destination_column_value: 'doing',
            destination_column_children: notesInKanbanColumn(stories, 'doing'),
            destination_column_position: 1,
        });
        expect(message?.type).toBe('editText');
        const edited = storiesOf(applyChanges(board, message?.changes ?? []));
        expect(notesInKanbanColumn(edited, 'doing').map(story => stripHeadlineLinetags(story.headline_raw))).toEqual(['One', 'Three', 'Two']);
        expect([...edited].sort(kanbanNoteOrder).map(story => stripHeadlineLinetags(story.headline_raw))).toEqual(['One', 'Three', 'Two']);
    });
    it('offers the view registry and a protocol version', () => {
        expect(selectableViewIds(VIEW_REGISTRY)).toEqual(['document', 'line', 'kanban']);
        expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    });
    it('reaches no React, drag-and-drop, diagram or stylesheet module', () => {
        const imports = reachableImports(join(__dirname, 'core.ts'));
        // the walk really followed the graph into the library folder
        expect(imports.some(found => found.file.endsWith('linetagops.ts'))).toBe(true);
        const offending = imports.filter(found => FORBIDDEN_IMPORTS.some(pattern => pattern.test(found.specifier)) || found.file.endsWith('.tsx'));
        expect(offending).toEqual([]);
    });
});
