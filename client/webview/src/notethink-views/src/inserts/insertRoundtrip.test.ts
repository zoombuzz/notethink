import { fromMarkdown } from 'mdast-util-from-markdown';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import type { Root as MdastRoot } from 'mdast';
import inserts from './en';
import { convertMdastToNoteHierarchy } from '../lib/convertMdastToNoteHierarchy';
import { flattenAllNotes } from '../lib/noteops';
import { resolveNamespacedTag } from '../lib/linetagops';
import type { NoteProps } from '../types/NoteProps';

/**
 * Mirror of the extension's parseops.parse() so this round-trip exercises the
 * exact markdown → MDAST → note-hierarchy path the viewer sees in production:
 * an Insert lands as editor text, the extension parses it, and the webview
 * converts the MDAST into the note tree DocumentView renders.
 */
function parse(text: string): MdastRoot {
    return fromMarkdown(text, {
        extensions: [gfm(), frontmatter(['yaml', 'toml'])],
        mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml', 'toml'])],
    });
}

function toNotes(markdown: string): NoteProps {
    return convertMdastToNoteHierarchy(parse(markdown), markdown);
}

const ENTRIES = Object.entries(inserts);

// every distinct body an Insert can place into the document — both the bare template and (where present) its worked example.
const BODIES: Array<[string, string]> = ENTRIES.flatMap(([key, insert]) => {
    const bodies: Array<[string, string]> = [[`${key} (content)`, insert.content]];
    if (insert.example_content) {
        bodies.push([`${key} (example)`, insert.example_content]);
    }
    return bodies;
});

describe('insert round-trip (markdown → MDAST → notes)', () => {

    it.each(BODIES)('%s parses into a valid note hierarchy', (_label, body) => {
        let root: NoteProps;
        expect(() => { root = toNotes(body); }).not.toThrow();
        root = toNotes(body);
        expect(root.type).toBe('root');
        expect(root.level).toBe(0);
        // every note carries a sequence number and a position the editor can map back to.
        for (const note of flattenAllNotes(root)) {
            expect(typeof note.seq).toBe('number');
            expect(note.position?.start?.offset).toBeGreaterThanOrEqual(0);
        }
    });

    describe('heading templates', () => {
        it('"# " produces a level-1 heading note', () => {
            const notes = flattenAllNotes(toNotes(inserts['heading1'].content));
            const heading = notes.find((n) => n.type === 'heading');
            expect(heading).toBeDefined();
            expect(heading!.level).toBe(1);
        });

        it('heading example content keeps the rendered heading text', () => {
            const root = toNotes(inserts['heading1'].example_content!);
            const heading = flattenAllNotes(root).find((n) => n.type === 'heading');
            expect(heading?.headline_raw).toContain('# Main heading');
        });
    });

    describe('code block template', () => {
        it('produces a fenced code note', () => {
            const notes = flattenAllNotes(toNotes(inserts['codeblock'].content));
            expect(notes.some((n) => n.type === 'code')).toBe(true);
        });
    });

    describe('table template', () => {
        it('parses into a GFM table node', () => {
            const root = parse(inserts['table'].content);
            // the table itself stays a raw MDAST node in children_body
            const json = JSON.stringify(root);
            expect(json).toContain('"type":"table"');
        });
    });

    describe('list templates', () => {
        it('produces a list note for the bullet template', () => {
            const notes = flattenAllNotes(toNotes(inserts['listitem'].example_content!));
            expect(notes.some((n) => n.type === 'list')).toBe(true);
        });

        it('preserves checkbox state for the to-do template', () => {
            const root = parse(inserts['todoitem'].example_content!);
            const json = JSON.stringify(root);
            // GFM task list items carry a `checked` boolean — both states appear in the example.
            expect(json).toContain('"checked":false');
            expect(json).toContain('"checked":true');
        });
    });

    describe('kanban template', () => {
        it('marks the project heading with the kanban view linetag', () => {
            const notes = flattenAllNotes(toNotes(inserts['pm_kanban'].content));
            const project = notes.find((n) => n.type === 'heading' && n.level === 1);
            expect(project).toBeDefined();
            const view = resolveNamespacedTag(project!.linetags, 'view');
            expect(view?.value).toBe('kanban');
        });

        it('attaches status linetags to the seeded tickets', () => {
            const notes = flattenAllNotes(toNotes(inserts['pm_kanban'].content));
            const statuses = notes
                .map((n) => n.linetags?.['status']?.value)
                .filter(Boolean);
            expect(statuses).toEqual(expect.arrayContaining(['done', 'doing', 'backlog']));
        });

        it('parses the richer kanban example without losing its tickets', () => {
            const notes = flattenAllNotes(toNotes(inserts['pm_kanban'].example_content!));
            const tickets = notes.filter((n) => n.type === 'heading' && n.level === 2);
            expect(tickets.length).toBeGreaterThan(3);
        });
    });

    describe('mermaid diagram templates', () => {
        const mermaid = ENTRIES.filter(([, i]) => i.content.includes('```mermaid'));

        it.each(mermaid)('"%s" lands its diagram as a mermaid code note', (_key, insert) => {
            const notes = flattenAllNotes(toNotes(insert.content));
            const code = notes.find((n) => n.type === 'code');
            expect(code).toBeDefined();
            expect(code!.lang).toBe('mermaid');
        });
    });
});
