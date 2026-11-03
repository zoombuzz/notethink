import { cropToNewestBytes, sliceTail, type TailBookmark } from './agenttailparseops';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('sliceTail', () => {
    it('parses the whole file on first sight, and hands back a bookmark at the last complete line', () => {
        const bytes = enc.encode('{"a":1}\n{"a":2}\n');
        const result = sliceTail(undefined, bytes);
        expect(result.mode).toBe('whole');
        expect(dec.decode(result.slice)).toBe('{"a":1}\n{"a":2}\n');
        expect(result.next).toEqual({ offset: bytes.length, hash: expect.any(String) });
    });

    it('an appended line is sliced to just that line, and parsed once', () => {
        const first = enc.encode('{"a":1}\n');
        const first_result = sliceTail(undefined, first);
        const grown = enc.encode('{"a":1}\n{"a":2}\n');
        const second_result = sliceTail(first_result.next, grown);
        expect(second_result.mode).toBe('tail');
        expect(dec.decode(second_result.slice)).toBe('{"a":2}\n');
    });

    it('several appended lines in one scan are all sliced together, none re-sent', () => {
        const first = enc.encode('{"a":1}\n');
        const bookmark = sliceTail(undefined, first).next;
        const grown = enc.encode('{"a":1}\n{"a":2}\n{"a":3}\n{"a":4}\n');
        const result = sliceTail(bookmark, grown);
        expect(result.mode).toBe('tail');
        expect(dec.decode(result.slice)).toBe('{"a":2}\n{"a":3}\n{"a":4}\n');
    });

    it('a torn last line waits until it completes, contributing nothing this scan', () => {
        const first = enc.encode('{"a":1}\n');
        const bookmark = sliceTail(undefined, first).next;
        const torn = enc.encode('{"a":1}\n{"a":2');
        const result = sliceTail(bookmark, torn);
        expect(result.mode).toBe('none');
        expect(result.slice.length).toBe(0);
        expect(result.next).toBeUndefined();
    });

    it('a torn line completed on a later scan is then parsed exactly once', () => {
        const first = enc.encode('{"a":1}\n');
        let bookmark: TailBookmark | undefined = sliceTail(undefined, first).next;
        const torn = enc.encode('{"a":1}\n{"a":2');
        const torn_result = sliceTail(bookmark, torn);
        expect(torn_result.mode).toBe('none');
        // the bookmark is unchanged across a 'none' scan, so the caller keeps retrying from the same offset
        const completed = enc.encode('{"a":1}\n{"a":2}\n');
        const completed_result = sliceTail(bookmark, completed);
        expect(completed_result.mode).toBe('tail');
        expect(dec.decode(completed_result.slice)).toBe('{"a":2}\n');
    });

    it('a shrunk file is parsed whole again', () => {
        const grown = enc.encode('{"a":1}\n{"a":2}\n{"a":3}\n');
        const bookmark = sliceTail(undefined, grown).next;
        const shrunk = enc.encode('{"a":1}\n');
        const result = sliceTail(bookmark, shrunk);
        expect(result.mode).toBe('whole');
        expect(dec.decode(result.slice)).toBe('{"a":1}\n');
    });

    it('a rewritten prefix (same or greater size) is parsed whole again', () => {
        const original = enc.encode('{"a":1}\n{"a":2}\n');
        const bookmark = sliceTail(undefined, original).next;
        // same length as `original`, but its first line's content differs: the window hash over the prefix no longer matches
        const rewritten = enc.encode('{"a":9}\n{"a":2}\n');
        expect(rewritten.length).toBe(original.length);
        const result = sliceTail(bookmark, rewritten);
        expect(result.mode).toBe('whole');
        expect(dec.decode(result.slice)).toBe('{"a":9}\n{"a":2}\n');
    });

    it('an unchanged file (identical bytes) reports none, not a re-send of an empty tail', () => {
        const bytes = enc.encode('{"a":1}\n{"a":2}\n');
        const bookmark = sliceTail(undefined, bytes).next;
        const result = sliceTail(bookmark, bytes);
        expect(result.mode).toBe('none');
    });

    it('a bookmark from a stale worker generation is treated as no bookmark at all (caller passes undefined)', () => {
        // AgentAnalyser.ts never passes a stale-generation bookmark through; this documents the contract sliceTail relies on
        const grown = enc.encode('{"a":1}\n{"a":2}\n');
        const result = sliceTail(undefined, grown);
        expect(result.mode).toBe('whole');
    });
});

describe('cropToNewestBytes', () => {
    it('returns a buffer within the bound unchanged', () => {
        const bytes = enc.encode('{"a":1}\n');
        expect(cropToNewestBytes(bytes, 100)).toEqual({ bytes, cropped: false });
    });

    it('keeps the newest lines, starting just after the first newline inside the bound', () => {
        const text = '{"a":1}\n{"a":2}\n{"a":3}\n';
        const result = cropToNewestBytes(enc.encode(text), 19);
        expect(result.cropped).toBe(true);
        expect(dec.decode(result.bytes)).toBe('{"a":2}\n{"a":3}\n');
    });

    it('keeps a line that starts exactly at the bound, never skipping a whole line', () => {
        const text = '{"a":1}\n{"a":2}\n';
        expect(dec.decode(cropToNewestBytes(enc.encode(text), 8).bytes)).toBe('{"a":2}\n');
    });

    it('drops a partial first line, never handing a torn line to the parser', () => {
        const text = '{"a":1}\n{"a":2}\n';
        expect(dec.decode(cropToNewestBytes(enc.encode(text), 12).bytes)).toBe('{"a":2}\n');
    });

    it('is empty when no newline falls inside the bound', () => {
        const result = cropToNewestBytes(enc.encode('{"long":"line"}\n'), 5);
        expect(result.cropped).toBe(true);
        expect(result.bytes.length).toBe(0);
    });
});
