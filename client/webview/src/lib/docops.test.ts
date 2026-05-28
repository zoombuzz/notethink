import type { Doc, HashMapOf } from "../types/general";
import { pickMostRecentlySentDoc } from "./docops";

function buildDoc(overrides: Partial<Doc> = {}): Doc {
    return {
        id: 'doc',
        path: '/test.md',
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
