import inserts from './en';
import type { Insert } from './types';

// the insert points InsertModal/useInsertModal know how to resolve; any template declaring an insert_point outside this set would silently fall through to the currentCaret default and land text in the wrong place.
const VALID_INSERT_POINTS = ['currentCaret', 'startOfLine', 'endOfLine', 'endOfNote'];

const ENTRIES = Object.entries(inserts);

describe('inserts registry (en)', () => {

    it('exposes a non-empty registry', () => {
        expect(ENTRIES.length).toBeGreaterThan(0);
    });

    it('keys are unique and match each entry value', () => {
        const keys = ENTRIES.map(([key]) => key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const [key, insert] of ENTRIES) {
            expect(insert.value).toBe(key);
        }
    });

    it('assigns a contiguous, gap-free index sequence', () => {
        const indices = ENTRIES.map(([, insert]) => insert.index);
        const sorted = [...indices].sort((a, b) => (a ?? 0) - (b ?? 0));
        sorted.forEach((value, position) => expect(value).toBe(position));
        // unique indices (no two templates collide on the same slot)
        expect(new Set(indices).size).toBe(indices.length);
    });

    it('derives title_lowercase from title for every template', () => {
        for (const [, insert] of ENTRIES) {
            expect(insert.title_lowercase).toBe(insert.title.toLowerCase());
        }
    });

    describe.each(ENTRIES)('template "%s"', (key, insert: Insert) => {
        it('has a human-readable, trimmed title', () => {
            expect(typeof insert.title).toBe('string');
            expect(insert.title.trim().length).toBeGreaterThan(0);
        });

        it('has insertable content', () => {
            // content must exist and carry something to insert (whitespace-only templates like Paragraph are intentional, so we only forbid empty).
            expect(typeof insert.content).toBe('string');
            expect(insert.content.length).toBeGreaterThan(0);
        });

        it('declares only known insert points', () => {
            if (insert.insert_point !== undefined) {
                expect(VALID_INSERT_POINTS).toContain(insert.insert_point);
            }
            if (insert.example_insert_point !== undefined) {
                expect(VALID_INSERT_POINTS).toContain(insert.example_insert_point);
            }
        });

        it('pairs example_insert_point with example_content', () => {
            // an example insert point is meaningless without example content to place.
            if (insert.example_insert_point !== undefined) {
                expect(insert.example_content).toBeDefined();
                expect(insert.example_content!.length).toBeGreaterThan(0);
            }
        });

        it('balances fenced code blocks in content and example_content', () => {
            // every ``` opener needs a closer; an odd count means a template would bleed a half-open code fence into the document.
            for (const body of [insert.content, insert.example_content]) {
                if (!body) { continue; }
                const fences = (body.match(/```/g) || []).length;
                expect(fences % 2).toBe(0);
            }
        });
    });

    describe('grouping', () => {
        it('every grouped template carries a non-empty group label', () => {
            for (const [, insert] of ENTRIES) {
                if (insert.group !== undefined) {
                    expect(insert.group.trim().length).toBeGreaterThan(0);
                }
            }
        });

        it('exposes the headings, lists, charts, project-management and architecture groups', () => {
            const groups = new Set(ENTRIES.map(([, insert]) => insert.group).filter(Boolean));
            expect(groups).toContain('Headings');
            expect(groups).toContain('Lists');
            expect(groups).toContain('Charts and diagrams');
            expect(groups).toContain('Project management');
            expect(groups).toContain('Architecture');
        });
    });

    describe('mermaid templates', () => {
        const mermaid = ENTRIES.filter(([, i]) => i.group === 'Charts and diagrams'
            || i.group === 'Project management'
            || i.group === 'Architecture');

        it('cover the dynamic diagram set we inherited', () => {
            expect(mermaid.length).toBeGreaterThan(0);
        });

        it.each(mermaid)('"%s" wraps its diagram in a ```mermaid fence', (_key, insert: Insert) => {
            // the kanban board is the one project-management template that is plain markdown rather than a mermaid diagram, so it is exempt.
            if (insert.value === 'pm_kanban') {
                expect(insert.content).toContain('?nt_view=kanban');
                return;
            }
            expect(insert.content).toContain('```mermaid');
        });
    });

    describe('kanban template', () => {
        const kanban = inserts['pm_kanban'];

        it('exists in the project-management group', () => {
            expect(kanban).toBeDefined();
            expect(kanban.group).toBe('Project management');
        });

        it('declares the kanban view and seeds status columns', () => {
            expect(kanban.content).toContain('?nt_view=kanban');
            for (const status of ['done', 'doing', 'backlog']) {
                expect(kanban.content).toContain(`?status=${status}`);
            }
        });
    });
});
