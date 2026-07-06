import { renderHook } from '@testing-library/react';
import { useViewContext } from './useViewContext';
import type { NoteProps, NoteOrigin } from '../../../types/NoteProps';
import type { ViewProps } from '../../../types/ViewProps';

// minimal NoteProps factory mirroring the structural fields useViewContext reads
function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 0,
        level: 1,
        children_body: [],
        children: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
            end_body: { offset: 50, line: 5 },
        },
        headline_raw: '',
        body_raw: '',
        ...overrides,
    };
}

function makeViewProps(overrides: Partial<ViewProps> = {}): ViewProps {
    return {
        id: 'test-view',
        type: 'document',
        display_options: {},
        ...overrides,
    };
}

describe('useViewContext', () => {

    describe('per-doc + source_position matcher (folder mode editor → view direction)', () => {
        // simulate a folder-mode merged tree: notes from two files, with origin.source_position carrying each note's source-file offsets (not the merged-tree offsets in `position`)
        const origin_a: NoteOrigin = { doc_id: 'a', doc_path: '/repo/a.md', source_position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } } };
        const origin_b: NoteOrigin = { doc_id: 'b', doc_path: '/repo/b.md', source_position: { start: { offset: 100, line: 2 }, end: { offset: 130, line: 3 }, end_body: { offset: 200, line: 6 } } };

        const root = makeNote({ seq: 0, level: 0, position: { start: { offset: 0, line: 1 }, end: { offset: 0, line: 1 } } });
        const story_a = makeNote({
            seq: 1, level: 1, origin: origin_a,
            position: { start: { offset: 1000, line: 1 }, end: { offset: 1020, line: 2 }, end_body: { offset: 1040, line: 3 } },
        });
        const story_b = makeNote({
            seq: 2, level: 1, origin: origin_b,
            position: { start: { offset: 1100, line: 4 }, end: { offset: 1120, line: 5 }, end_body: { offset: 1180, line: 8 } },
        });

        it('locates the right note when the editor caret is in file A (caret in source-file offsets)', () => {
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, story_a, story_b],
                selection: { main: { head: 25, anchor: 25 } },
                active_editor_doc_path: '/repo/a.md',
            })));
            expect(result.current.deepest.note?.seq).toBe(story_a.seq);
            expect(result.current.display_options.focused_seqs).toContain(story_a.seq);
        });

        it('locates the right note when the editor caret is in file B', () => {
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, story_a, story_b],
                selection: { main: { head: 120, anchor: 120 } },
                active_editor_doc_path: '/repo/b.md',
            })));
            expect(result.current.deepest.note?.seq).toBe(story_b.seq);
        });

        it('returns no story (falls back to parent_context) when the active doc is not in the merged set', () => {
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, story_a, story_b],
                selection: { main: { head: 25, anchor: 25 } },
                active_editor_doc_path: '/repo/c.md',
            })));
            // no merged note matches /repo/c.md, the parent_context (root) is the fallback
            expect(result.current.deepest.note?.seq).toBe(root.seq);
        });

        it('returns no story when the caret is outside every same-doc story range', () => {
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, story_a, story_b],
                // caret beyond a's end_body (50) and not in b's range either
                selection: { main: { head: 75, anchor: 75 } },
                active_editor_doc_path: '/repo/a.md',
            })));
            expect(result.current.deepest.note?.seq).toBe(root.seq);
        });
    });

    describe('current_file regression: editor-derived focus still drives the deepest note when no view state is set', () => {
        // single-file shape: no origin, in-tree position coherent with the active editor's offsets
        const root = makeNote({ seq: 0, level: 0, position: { start: { offset: 0, line: 1 }, end: { offset: 100, line: 10 } } });
        const story = makeNote({
            seq: 1, level: 1,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 60, line: 5 } },
        });

        it('caret inside the story position highlights the story', () => {
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, story],
                selection: { main: { head: 25, anchor: 25 } },
                active_editor_doc_path: '/repo/a.md',
            })));
            expect(result.current.deepest.note?.seq).toBe(story.seq);
            expect(result.current.display_options.focused_seqs).toContain(story.seq);
        });
    });

    describe('latest-click-wins with editor as tiebreaker (editor-derived wins; view-driven fills in when the editor has no opinion)', () => {
        // root.position.end is the clamping ceiling for the in-tree caret match - set it past every child range so a caret beyond a child's end_body still resolves through the in-tree matcher
        const root = makeNote({ seq: 0, level: 0, stable_id: 'root', position: { start: { offset: 0, line: 1 }, end: { offset: 200, line: 10 } } });
        const child = makeNote({ seq: 1, level: 1, stable_id: 'child', position: { start: { offset: 10, line: 1 }, end: { offset: 30, line: 1 }, end_body: { offset: 50, line: 2 } } });
        const other = makeNote({ seq: 2, level: 1, stable_id: 'other', position: { start: { offset: 60, line: 3 }, end: { offset: 80, line: 4 }, end_body: { offset: 95, line: 5 } } });

        it('view_focused_ids is the immediate-feedback source when no editor selection has confirmed yet', () => {
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, child],
                // no selection - editor has no opinion
                display_options: { view_focused_ids: [child.stable_id!] },
            })));
            expect(result.current.deepest.note?.seq).toBe(child.seq);
            expect(result.current.display_options.focused_seqs).toContain(child.seq);
        });

        it('editor-derived match overrides a stale view_focused_ids (latest click wins, editor priority)', () => {
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, child, other],
                // user clicked `child` in the view (view_focused_ids = [child]), then moved the editor caret into `other`'s range - editor wins
                selection: { main: { head: 70, anchor: 70 } },
                active_editor_doc_path: '/repo/a.md',
                display_options: { view_focused_ids: [child.stable_id!] },
            })));
            expect(result.current.deepest.note?.seq).toBe(other.seq);
        });

        it('view_focused_ids fills in when the active editor is on a doc that is not in the aggregated set (per-doc matcher returns nothing)', () => {
            // give the notes an origin so the per-doc matcher runs; point the active editor at an unrelated doc
            const origin: NoteOrigin = { doc_id: 'a', doc_path: '/repo/a.md', source_position: { start: { offset: 0, line: 1 }, end: { offset: 20, line: 1 } } };
            const note_with_origin = makeNote({ seq: 1, level: 1, stable_id: 'with-origin', origin, position: { start: { offset: 10, line: 1 }, end: { offset: 30, line: 1 }, end_body: { offset: 50, line: 2 } } });
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, note_with_origin],
                selection: { main: { head: 25, anchor: 25 } },
                active_editor_doc_path: '/repo/c.md',
                display_options: { view_focused_ids: [note_with_origin.stable_id!] },
            })));
            // per-doc matcher returns nothing (active doc not in aggregated set); view-driven fills in
            expect(result.current.deepest.note?.seq).toBe(note_with_origin.seq);
        });

        it('falls back to editor-derived match when view_focused_ids is unset', () => {
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, child],
                selection: { main: { head: 20, anchor: 20 } },
                // no view_focused_ids
            })));
            // editor caret at 20 lands inside child's position (10-50)
            expect(result.current.deepest.note?.seq).toBe(child.seq);
        });

        it('view_selected_ids is the immediate-feedback source for selection while no editor range selection is in effect', () => {
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, child],
                display_options: { view_selected_ids: [child.stable_id!] },
            })));
            expect(result.current.display_options.selected_seqs).toContain(child.seq);
        });

        it('editor range selection overrides a stale view_selected_ids', () => {
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, child, other],
                // user clicked `child` (view_selected_ids = [child]); then dragged a selection in the editor across `other`'s range - editor wins
                selection: { main: { head: 60, anchor: 95 } },
                active_editor_doc_path: '/repo/a.md',
                display_options: { view_selected_ids: [child.stable_id!] },
            })));
            expect(result.current.display_options.selected_seqs).toContain(other.seq);
            expect(result.current.display_options.selected_seqs).not.toContain(child.seq);
        });
    });

    describe('stable_id survives a re-parse that renumbers seq', () => {
        const root = makeNote({ seq: 0, level: 0, stable_id: 'root', position: { start: { offset: 0, line: 1 }, end: { offset: 200, line: 10 } } });

        it('a re-parse that renumbers seq keeps the same note selected', () => {
            // before re-parse: stable_id 'X' lives at seq 5
            const before_x = makeNote({ seq: 5, level: 1, stable_id: 'X', position: { start: { offset: 10, line: 1 }, end: { offset: 30, line: 1 }, end_body: { offset: 50, line: 2 } } });
            const before_y = makeNote({ seq: 6, level: 1, stable_id: 'Y', position: { start: { offset: 60, line: 3 }, end: { offset: 80, line: 4 }, end_body: { offset: 95, line: 5 } } });
            const { result, rerender } = renderHook((props: ViewProps) => useViewContext(props), {
                initialProps: makeViewProps({
                    notes: [root, before_x, before_y],
                    display_options: { view_selected_ids: ['X'] },
                }),
            });
            expect(result.current.display_options.selected_seqs).toEqual([5]);
            // after re-parse: stable_id 'X' is renumbered to seq 9 (a Y-like note inherited seq 5)
            const after_y = makeNote({ seq: 5, level: 1, stable_id: 'Y', position: { start: { offset: 60, line: 3 }, end: { offset: 80, line: 4 }, end_body: { offset: 95, line: 5 } } });
            const after_x = makeNote({ seq: 9, level: 1, stable_id: 'X', position: { start: { offset: 10, line: 1 }, end: { offset: 30, line: 1 }, end_body: { offset: 50, line: 2 } } });
            rerender(makeViewProps({
                notes: [root, after_y, after_x],
                display_options: { view_selected_ids: ['X'] },
            }));
            // selection still resolves to the 'X' note, now reflecting its NEW seq
            expect(result.current.display_options.selected_notes?.map((n) => n.stable_id)).toEqual(['X']);
            expect(result.current.display_options.selected_seqs).toEqual([9]);
        });

        it('a re-parse that renumbers seq keeps the same note focused', () => {
            const before_x = makeNote({ seq: 5, level: 1, stable_id: 'X', position: { start: { offset: 10, line: 1 }, end: { offset: 30, line: 1 }, end_body: { offset: 50, line: 2 } } });
            const before_y = makeNote({ seq: 6, level: 1, stable_id: 'Y', position: { start: { offset: 60, line: 3 }, end: { offset: 80, line: 4 }, end_body: { offset: 95, line: 5 } } });
            const { result, rerender } = renderHook((props: ViewProps) => useViewContext(props), {
                initialProps: makeViewProps({
                    notes: [root, before_x, before_y],
                    display_options: { view_focused_ids: ['X'] },
                }),
            });
            expect(result.current.deepest.note?.stable_id).toBe('X');
            expect(result.current.display_options.focused_seqs).toContain(5);
            const after_y = makeNote({ seq: 5, level: 1, stable_id: 'Y', position: { start: { offset: 60, line: 3 }, end: { offset: 80, line: 4 }, end_body: { offset: 95, line: 5 } } });
            const after_x = makeNote({ seq: 9, level: 1, stable_id: 'X', position: { start: { offset: 10, line: 1 }, end: { offset: 30, line: 1 }, end_body: { offset: 50, line: 2 } } });
            rerender(makeViewProps({
                notes: [root, after_y, after_x],
                display_options: { view_focused_ids: ['X'] },
            }));
            // focus still resolves to the 'X' note, now reflecting its NEW seq
            expect(result.current.deepest.note?.stable_id).toBe('X');
            expect(result.current.display_options.focused_seqs).toContain(9);
        });
    });

    describe('editor-open vs editor-closed parity (single-caret ownership)', () => {
        // one caret, two owners: with an identical view store, the resolved focus/selection must match whether the caret lives in a real editor (props.selection set) or is the board's virtual caret (props.selection undefined)
        const root = makeNote({ seq: 0, level: 0, stable_id: 'root', position: { start: { offset: 0, line: 1 }, end: { offset: 200, line: 10 } } });
        const child = makeNote({ seq: 1, level: 1, stable_id: 'child', position: { start: { offset: 10, line: 1 }, end: { offset: 30, line: 1 }, end_body: { offset: 50, line: 2 } } });

        it('resolves the same focused + selected note with the editor closed (virtual caret) as open (real caret) at the same offset', () => {
            // identical view store for both renders: focused/selected chain plus a caret at 25 (inside child 10-50)
            const view_store: NoteProps['display_options'] = { view_focused_ids: ['child'], view_selected_ids: ['child'], view_caret: 25 };
            const closed_render = renderHook(() => useViewContext(makeViewProps({
                notes: [root, child],
                display_options: { ...view_store },
            })));
            const open_render = renderHook(() => useViewContext(makeViewProps({
                notes: [root, child],
                selection: { main: { head: 25, anchor: 25 } },
                display_options: { ...view_store },
            })));
            expect(closed_render.result.current.deepest.note?.stable_id).toBe('child');
            expect(open_render.result.current.deepest.note?.stable_id).toBe(closed_render.result.current.deepest.note?.stable_id);
            expect(closed_render.result.current.display_options.selected_seqs).toEqual([child.seq]);
            expect(open_render.result.current.display_options.selected_seqs).toEqual(closed_render.result.current.display_options.selected_seqs);
        });

        it('parity holds off the virtual caret alone when the clicked note has no stable_id (findDeepestNote fallback)', () => {
            // no view_focused_ids and a stable_id-less child: closed relies on the resolveFocusedNote caret fallback, open on the editor caret
            const no_id_child = makeNote({ seq: 1, level: 1, position: { start: { offset: 10, line: 1 }, end: { offset: 30, line: 1 }, end_body: { offset: 50, line: 2 } } });
            const view_store: NoteProps['display_options'] = { view_focused_ids: [], view_caret: 25 };
            const closed_render = renderHook(() => useViewContext(makeViewProps({
                notes: [root, no_id_child],
                display_options: { ...view_store },
            })));
            const open_render = renderHook(() => useViewContext(makeViewProps({
                notes: [root, no_id_child],
                selection: { main: { head: 25, anchor: 25 } },
                display_options: { ...view_store },
            })));
            expect(closed_render.result.current.deepest.note?.seq).toBe(no_id_child.seq);
            expect(open_render.result.current.deepest.note?.seq).toBe(closed_render.result.current.deepest.note?.seq);
        });
    });

    describe('editor drag-select preserved (head != anchor yields a multi-note range)', () => {
        it('folder mode: a range spanning two same-doc notes selects both via origin source positions', () => {
            const origin_a: NoteOrigin = { doc_id: 'a', doc_path: '/repo/a.md', source_position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 4 } } };
            const origin_b: NoteOrigin = { doc_id: 'a', doc_path: '/repo/a.md', source_position: { start: { offset: 60, line: 5 }, end: { offset: 80, line: 6 }, end_body: { offset: 95, line: 7 } } };
            const root = makeNote({ seq: 0, level: 0, position: { start: { offset: 0, line: 1 }, end: { offset: 0, line: 1 } } });
            const story_a = makeNote({ seq: 1, level: 1, origin: origin_a, position: { start: { offset: 1000, line: 1 }, end: { offset: 1020, line: 2 }, end_body: { offset: 1040, line: 3 } } });
            const story_b = makeNote({ seq: 2, level: 1, origin: origin_b, position: { start: { offset: 1100, line: 4 }, end: { offset: 1120, line: 5 }, end_body: { offset: 1180, line: 8 } } });
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, story_a, story_b],
                // drag from before a's start to past b's end, in source-file offsets
                selection: { main: { head: 5, anchor: 100 } },
                active_editor_doc_path: '/repo/a.md',
            })));
            expect(result.current.display_options.selected_seqs).toEqual(expect.arrayContaining([story_a.seq, story_b.seq]));
        });

        it('single-file mode: an in-tree range spanning two notes selects both', () => {
            const root = makeNote({ seq: 0, level: 0, position: { start: { offset: 0, line: 1 }, end: { offset: 200, line: 10 } } });
            const note_a = makeNote({ seq: 1, level: 1, position: { start: { offset: 10, line: 1 }, end: { offset: 30, line: 1 }, end_body: { offset: 50, line: 2 } } });
            const note_b = makeNote({ seq: 2, level: 1, position: { start: { offset: 60, line: 3 }, end: { offset: 80, line: 4 }, end_body: { offset: 95, line: 5 } } });
            const { result } = renderHook(() => useViewContext(makeViewProps({
                notes: [root, note_a, note_b],
                // no active_editor_doc_path exercises the in-tree findSelectedNotes range path
                selection: { main: { head: 10, anchor: 95 } },
            })));
            expect(result.current.display_options.selected_seqs).toEqual(expect.arrayContaining([note_a.seq, note_b.seq]));
        });
    });
});
