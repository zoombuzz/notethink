import { fromMarkdown } from 'mdast-util-from-markdown';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import type { Root as MdastRoot } from 'mdast';
import { mergeAggregateRoot } from '../../../lib/mergeAggregateRoot';
import { notesInKanbanColumn } from '../../../lib/noteops';
import { buildKanbanDragEndPayload } from './kanbanDragEndPayload';
import type { NoteProps } from '../../../types/NoteProps';
import type { EditTextChange } from '../../../types/Messages';

/*
 * deterministic drag -> undo -> drag round-trip harness for a FOLDER-mode board. mirrors the real path:
 * parse each source file, mergeAggregateRoot into one board, derive the kanban columns, build the exact
 * drag-end payload the webview posts, and apply it to the file text with the extension's own reverse-sorted
 * end-to-start apply. the user's undo is a single Ctrl+Z in ONE editor, so undo reverts ONLY the dragged
 * card's file - any edits the same drag wrote to SIBLING files would be left on disk. re-parses from the
 * mutated text each cycle so any corruption compounds exactly as it does live, with no webview/focus/FS noise.
 *
 * guards two properties that must hold no matter the drop position or how many cycles run:
 *   1. a drag -> single-file-undo cycle leaves EVERY file byte-identical (no stray cross-file edits)
 *   2. aggregation never mints duplicate stable_ids (duplicates would collide dnd draggableIds and break drag)
 */

function parse(text: string): MdastRoot {
    return fromMarkdown(text, {
        extensions: [gfm(), frontmatter(['yaml', 'toml'])],
        mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml', 'toml'])],
    });
}

interface Board {
    files: Record<string, { path: string; relative_path: string; text: string }>;
}

function aggregate(board: Board): { cards: NoteProps[] } {
    const docs: Record<string, { id: string; path: string; relative_path: string; content: MdastRoot; text: string; mtime: number }> = {};
    let i = 0;
    for (const id of Object.keys(board.files)) {
        const f = board.files[id];
        docs[id] = { id, path: f.path, relative_path: f.relative_path, content: parse(f.text), text: f.text, mtime: 1000 + (i++) };
    }
    const { root } = mergeAggregateRoot(docs, '/board');
    return { cards: root.child_notes || [] };
}

// apply the extension's end-to-start edits to a single file's text (PanelSession.applyEditTextChanges)
function applyChangesToText(text: string, changes: Array<EditTextChange>): string {
    const sorted = [...changes].sort((a, b) => b.from - a.from);
    let out = text;
    for (const change of sorted) {
        const to = change.to !== undefined ? change.to : change.from;
        out = out.slice(0, change.from) + change.insert + out.slice(to);
    }
    return out;
}

function cardByText(cards: NoteProps[], needle: string): NoteProps {
    const found = cards.find((c) => (c.headline_raw || '').includes(needle));
    if (!found) { throw new Error(`card not found: ${needle} (have: ${cards.map((c) => c.headline_raw).join(' | ')})`); }
    return found;
}

function changesByDoc(payload: ReturnType<typeof buildKanbanDragEndPayload>, dragged_doc: string): Record<string, Array<EditTextChange>> {
    if (!payload) { return {}; }
    if ('changes_by_doc' in payload && payload.changes_by_doc) { return payload.changes_by_doc; }
    if ('changes' in payload && payload.changes) {
        const key = payload.docPath ?? dragged_doc;
        return { [key]: payload.changes };
    }
    return {};
}

// drag `card_text` into `dest_status` at `position` (default: bottom), applied to the board texts. returns the files written and the dragged doc
function drag(board: Board, card_text: string, dest_status: string, position?: number): { wrote: string[]; dragged_doc: string } {
    const { cards } = aggregate(board);
    const dragged = cardByText(cards, card_text);
    const dragged_doc = dragged.origin!.doc_path!;
    const dest_children = notesInKanbanColumn(cards, dest_status);
    const drop_pos = position === undefined ? dest_children.length : position;
    const payload = buildKanbanDragEndPayload({
        dragged_note: dragged,
        destination_column_value: dest_status,
        destination_column_children: dest_children,
        destination_column_position: drop_pos,
    });
    const by_doc = changesByDoc(payload, dragged_doc);
    const wrote: string[] = [];
    for (const id of Object.keys(board.files)) {
        const f = board.files[id];
        const changes = by_doc[f.path];
        if (changes && changes.length > 0) {
            f.text = applyChangesToText(f.text, changes);
            wrote.push(f.path);
        }
    }
    return { wrote, dragged_doc };
}

function freshBoard(): Board {
    return {
        files: {
            a: { path: 'projA/a.md', relative_path: 'projA/a.md', text: '# ProjA\n\n### Alpha one [](?status=done)\n\n### Alpha two [](?status=done)\n' },
            b: { path: 'projB/b.md', relative_path: 'projB/b.md', text: '# ProjB\n\n### Bravo mover [](?status=doing)\n\n### Bravo done [](?status=done)\n' },
        },
    };
}

describe('kanban drag -> undo -> drag round-trip (folder mode, cross-file)', () => {
    // dropping at the bottom bypasses the ordering restraint guard and mints nt_kanban_ordering_weight; top does not. exercise both
    it.each([['bottom', undefined], ['top', 0], ['middle', 1]] as Array<[string, number | undefined]>)(
        'a drag(%s) -> single-file undo cycle, run twice, leaves every file byte-identical',
        (_label, position) => {
            const board = freshBoard();
            const original_a = board.files.a.text;
            const original_b = board.files.b.text;

            for (let cycle = 1; cycle <= 2; cycle++) {
                const before_a = board.files.a.text;
                const before_b = board.files.b.text;
                const { dragged_doc } = drag(board, 'Bravo mover', 'done', position);
                // undo = Ctrl+Z in the ONE open editor: revert only the dragged card's file, leaving any sibling-file edits
                if (dragged_doc === board.files.a.path) { board.files.a.text = before_a; }
                if (dragged_doc === board.files.b.path) { board.files.b.text = before_b; }
            }

            // if a drag ever wrote to a file the single-file undo did not revert, one of these fails
            expect(board.files.a.text).toBe(original_a);
            expect(board.files.b.text).toBe(original_b);
        },
    );

    it('aggregation mints no duplicate stable_ids (would collide dnd draggableIds and break the drag placeholder)', () => {
        const { cards } = aggregate(freshBoard());
        const ids = cards.map((c) => c.stable_id);
        expect(ids.every((id) => id !== undefined)).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
