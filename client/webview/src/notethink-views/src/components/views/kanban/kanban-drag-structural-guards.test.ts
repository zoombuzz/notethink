import fs from 'fs';
import path from 'path';

// the drag-start settle/hold machinery lives in the useLineViewDrag hook (LineView's extracted drag lifecycle)
const drag_hook_source = fs.readFileSync(path.join(__dirname, '..', 'useLineViewDrag.ts'), 'utf8');
const view_renderer_scss = fs.readFileSync(path.join(__dirname, '..', '..', 'ViewRenderer.module.scss'), 'utf8');

// walk balanced braces from the first `{` at or after start_index and return the whole `{ ... }` block, nesting-aware
function extractRuleBody(source: string, start_index: number): string {
    const brace_open = source.indexOf('{', start_index);
    if (brace_open === -1) { return ''; }
    let depth = 0;
    for (let i = brace_open; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '{') { depth += 1; }
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) { return source.slice(brace_open, i + 1); }
        }
    }
    return source.slice(brace_open);
}

// collect every rule body whose selector text contains `selector` (the SCSS uses `> div > .note` in two theme variants)
function extractAllRuleBodies(source: string, selector: string): Array<string> {
    const bodies: Array<string> = [];
    let search_from = 0;
    for (let guard = 0; guard < 100; guard += 1) {
        const start = source.indexOf(selector, search_from);
        if (start === -1) { break; }
        bodies.push(extractRuleBody(source, start));
        search_from = start + selector.length;
    }
    return bodies;
}

describe('kanban drag structural guards', () => {

    // the card is dragged in place (no portal) so it keeps its column-scoped card styling; the geometry stays safe because the FLIP gate suppresses every card/column transform for the whole drag. drag-start must settle any in-flight FLIP first, so a card grabbed mid-animation is at its true box before dnd lifts it
    describe('drag-start settles in-flight FLIP before holding the gate', () => {

        it('imports settleFlipAnimations', () => {
            expect(drag_hook_source).toMatch(/import\s*\{[^}]*settleFlipAnimations[^}]*\}\s*from/);
        });

        it('settles the flip animations inside the drag-start handler', () => {
            expect(drag_hook_source).toContain('settleFlipAnimations(content_ref.current)');
        });

        it('settles before holding the gate so a card grabbed mid-animation is at rest', () => {
            const settle_index = drag_hook_source.indexOf('settleFlipAnimations(content_ref.current)');
            const hold_index = drag_hook_source.indexOf('flip_gate.hold()');
            expect(settle_index).toBeGreaterThan(-1);
            expect(hold_index).toBeGreaterThan(-1);
            expect(settle_index).toBeLessThan(hold_index);
        });
    });

    describe('ViewRenderer .note rule has no transform transition', () => {

        const note_rule_bodies = extractAllRuleBodies(view_renderer_scss, '> div > .note');

        it('locates the card rule bodies', () => {
            expect(note_rule_bodies.length).toBeGreaterThan(0);
        });

        it('declares no transition on transform on any .note rule (dnd owns the draggable transform)', () => {
            for (const body of note_rule_bodies) {
                expect(body).not.toMatch(/transition:\s*transform/);
            }
        });

        it('keeps the box-shadow transition on the main card rule instead', () => {
            const main_card_rule = note_rule_bodies.find((body) => body.includes('transition: box-shadow'));
            expect(main_card_rule).toBeDefined();
            expect(main_card_rule as string).not.toMatch(/transition:\s*transform/);
        });
    });
});
