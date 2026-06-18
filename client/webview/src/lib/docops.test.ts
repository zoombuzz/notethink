import type { Doc, HashMapOf } from "../types/general";
import { pickMostRecentlySentDoc, resolveFileIntegrationDeclaration } from "./docops";

function buildDoc(overrides: Partial<Doc> = {}): Doc {
    return {
        id: 'doc',
        path: '/test.md',
        ...overrides,
    };
}

// build a Doc with manually-offset MDAST headings so resolveFileIntegrationDeclaration can parse the H1
function parsedDoc(lines: Array<{ line: string; depth: number }>, overrides: Partial<Doc> = {}): Doc {
    let offset = 0;
    const children = lines.map(({ line, depth }) => {
        const node = {
            type: 'heading',
            depth,
            position: { start: { offset, line: 0 }, end: { offset: offset + line.length, line: 0 } },
            children: [],
        };
        offset += line.length + 1;
        return node;
    });
    const text = lines.map(l => l.line).join('\n') + '\n';
    return {
        id: 'doc-1',
        path: '/repo/portfolio/atlas.md',
        relative_path: 'portfolio/atlas.md',
        content: { type: 'root', position: { start: { offset: 0, line: 0 }, end: { offset: text.length, line: 0 } }, children } as unknown as Doc['content'],
        text,
        ...overrides,
    };
}

describe('docops.pickMostRecentlySentDoc', () => {

    it('returns undefined for an empty map', () => {
        const result = pickMostRecentlySentDoc({});
        expect(result).toBeUndefined();
    });

    it('returns the only entry when the map has one doc (even without updateSentAt)', () => {
        const docs: HashMapOf<Doc> = {
            'doc-1': buildDoc({ id: 'doc-1' }),
        };
        const result = pickMostRecentlySentDoc(docs);
        expect(result).toEqual({ note_id: 'doc-1', note: docs['doc-1'] });
    });

    it('picks the doc with the latest ISO updateSentAt', () => {
        const docs: HashMapOf<Doc> = {
            'a': buildDoc({ id: 'a', updateSentAt: '2026-01-01T00:00:00.000Z' }),
            'b': buildDoc({ id: 'b', updateSentAt: '2026-03-15T12:00:00.000Z' }),
            'c': buildDoc({ id: 'c', updateSentAt: '2026-02-10T08:30:00.000Z' }),
        };
        const result = pickMostRecentlySentDoc(docs);
        expect(result?.note_id).toBe('b');
    });

    it('prefers any stamped doc over an unstamped doc', () => {
        const docs: HashMapOf<Doc> = {
            'unstamped': buildDoc({ id: 'unstamped' }),
            'stamped': buildDoc({ id: 'stamped', updateSentAt: '2026-01-01T00:00:00.000Z' }),
        };
        const result = pickMostRecentlySentDoc(docs);
        expect(result?.note_id).toBe('stamped');
    });

    it('returns the first iterated entry when every doc has the same updateSentAt (strict > tiebreak)', () => {
        const docs: HashMapOf<Doc> = {
            'first': buildDoc({ id: 'first', updateSentAt: '2026-01-01T00:00:00.000Z' }),
            'second': buildDoc({ id: 'second', updateSentAt: '2026-01-01T00:00:00.000Z' }),
            'third': buildDoc({ id: 'third', updateSentAt: '2026-01-01T00:00:00.000Z' }),
        };
        const result = pickMostRecentlySentDoc(docs);
        expect(result?.note_id).toBe('first');
    });

    it('returns the first iterated entry when no docs have updateSentAt (all equal at "")', () => {
        const docs: HashMapOf<Doc> = {
            'alpha': buildDoc({ id: 'alpha' }),
            'beta': buildDoc({ id: 'beta' }),
        };
        const result = pickMostRecentlySentDoc(docs);
        expect(result?.note_id).toBe('alpha');
    });

});

describe('docops.resolveFileIntegrationDeclaration', () => {

    it('defaults to current_file for a file that declares nothing', () => {
        const decl = resolveFileIntegrationDeclaration(parsedDoc([{ line: '# Atlas', depth: 1 }]), '/repo');
        expect(decl).toEqual({ mode: 'current_file' });
    });

    it('resolves nt_integration_mode=folder to folder, scoped to the file\'s own parent folder', () => {
        const decl = resolveFileIntegrationDeclaration(parsedDoc([{ line: '# Atlas [](?nt_integration_mode=folder)', depth: 1 }]), '/repo');
        expect(decl.mode).toBe('folder');
        expect(decl.integration_path).toBe('/repo/portfolio');
    });

    it('ignores an unrecognised nt_integration_mode value and degrades to current_file (no throw)', () => {
        const decl = resolveFileIntegrationDeclaration(parsedDoc([{ line: '# Atlas [](?nt_integration_mode=bogus)', depth: 1 }]), '/repo');
        expect(decl.mode).toBe('current_file');
        expect(decl.integration_path).toBeUndefined();
    });

    it('resolves an nt_breadcrumb_last folder label to that segment, implying folder mode', () => {
        const decl = resolveFileIntegrationDeclaration(parsedDoc([{ line: '# Atlas [](?nt_breadcrumb_last=portfolio)', depth: 1 }]), '/repo');
        expect(decl.mode).toBe('folder');
        expect(decl.integration_path).toBe('/repo/portfolio');
    });

    it('combines nt_integration_mode=folder with an nt_breadcrumb_last folder scope (the headline case)', () => {
        const decl = resolveFileIntegrationDeclaration(
            parsedDoc([{ line: '# Atlas [](?nt_integration_mode=folder&nt_breadcrumb_last=portfolio)', depth: 1 }]),
            '/repo',
        );
        expect(decl.mode).toBe('folder');
        expect(decl.integration_path).toBe('/repo/portfolio');
    });

    it('resolves an nt_breadcrumb_last epic label to a parent_context_seq in current_file mode', () => {
        const decl = resolveFileIntegrationDeclaration(
            parsedDoc([
                { line: '# Atlas [](?nt_breadcrumb_last=Backend)', depth: 1 },
                { line: '## Backend', depth: 2 },
                { line: '### Wire alerts', depth: 3 },
            ], { path: '/repo/atlas.md', relative_path: 'atlas.md' }),
            '/repo',
        );
        expect(decl.mode).toBe('current_file');
        expect(decl.integration_path).toBeUndefined();
        // seq is assigned in document order by convertMdastToNoteHierarchy: root=0, H1=1, ## Backend=2
        expect(decl.parent_context_seq).toBe(2);
    });

    it('gives a folder-segment match precedence over a same-label heading (folder wins, no parent_context_seq)', () => {
        const decl = resolveFileIntegrationDeclaration(
            parsedDoc([
                { line: '# Atlas [](?nt_breadcrumb_last=portfolio)', depth: 1 },
                { line: '## portfolio', depth: 2 },
            ]),
            '/repo',
        );
        // the default parsedDoc path is /repo/portfolio/atlas.md, so "portfolio" matches a folder segment
        expect(decl.mode).toBe('folder');
        expect(decl.integration_path).toBe('/repo/portfolio');
        expect(decl.parent_context_seq).toBeUndefined();
    });

    it('degrades to the default scope with no throw when nt_breadcrumb_last matches nothing', () => {
        const decl = resolveFileIntegrationDeclaration(
            parsedDoc([{ line: '# Atlas [](?nt_breadcrumb_last=nope)', depth: 1 }], { path: '/repo/atlas.md', relative_path: 'atlas.md' }),
            '/repo',
        );
        expect(decl).toEqual({ mode: 'current_file' });
    });

    it('returns current_file for a doc with no content (no throw)', () => {
        expect(resolveFileIntegrationDeclaration(undefined, '/repo')).toEqual({ mode: 'current_file' });
        expect(resolveFileIntegrationDeclaration({ id: 'x', path: '/x.md' }, '/repo')).toEqual({ mode: 'current_file' });
    });

});
