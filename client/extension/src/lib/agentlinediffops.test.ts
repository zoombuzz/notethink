import { AGENT_LINE_DIFF_MAX_BYTES, countLineDiff, lineDiffFromBytes, looksBinary } from './agentlinediffops';

describe('countLineDiff', () => {
    it('counts every line added when the old side is absent, the shape of a newly added file', () => {
        expect(countLineDiff(undefined, 'a\nb\nc\n')).toEqual({ added: 3, removed: 0 });
    });

    it('counts every line removed when the new side is absent, the shape of a deleted file', () => {
        expect(countLineDiff('a\nb\nc\n', undefined)).toEqual({ added: 0, removed: 3 });
    });

    it('reports no change for two identical texts', () => {
        expect(countLineDiff('a\nb\nc\n', 'a\nb\nc\n')).toEqual({ added: 0, removed: 0 });
    });

    it('counts only the changed lines, leaving unchanged lines out of both totals', () => {
        expect(countLineDiff('a\nb\nc\n', 'a\nx\nc\n')).toEqual({ added: 1, removed: 1 });
    });

    it('counts a pure insertion in the middle as one added line and nothing removed', () => {
        expect(countLineDiff('a\nc\n', 'a\nb\nc\n')).toEqual({ added: 1, removed: 0 });
    });

    it('counts a pure deletion in the middle as one removed line and nothing added', () => {
        expect(countLineDiff('a\nb\nc\n', 'a\nc\n')).toEqual({ added: 0, removed: 1 });
    });

    it('does not double-count a missing trailing newline as an extra line', () => {
        expect(countLineDiff('a\nb\n', 'a\nb')).toEqual({ added: 0, removed: 0 });
    });

    it('treats two empty texts as no change', () => {
        expect(countLineDiff('', '')).toEqual({ added: 0, removed: 0 });
    });

    it('counts every line added when the old side is an empty string', () => {
        expect(countLineDiff('', 'a\nb\n')).toEqual({ added: 2, removed: 0 });
    });

    it('counts a change to only the first line as one added and one removed, leaving the rest shared', () => {
        expect(countLineDiff('a\nb\nc\nd\n', 'x\nb\nc\nd\n')).toEqual({ added: 1, removed: 1 });
    });

    it('counts a change to only the last line as one added and one removed, leaving the rest shared', () => {
        expect(countLineDiff('a\nb\nc\nd\n', 'a\nb\nc\nx\n')).toEqual({ added: 1, removed: 1 });
    });

    it('counts a single changed line in the middle of a long file as one added and one removed', () => {
        const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
        const old_text = `${lines.join('\n')}\n`;
        const edited = lines.slice();
        edited[250] = 'changed line';
        const new_text = `${edited.join('\n')}\n`;
        expect(countLineDiff(old_text, new_text)).toEqual({ added: 1, removed: 1 });
    });

    it('falls back correctly when the two texts share no lines at all', () => {
        const old_lines = Array.from({ length: 40 }, (_, i) => `old ${i}`);
        const new_lines = Array.from({ length: 40 }, (_, i) => `new ${i}`);
        const old_text = `${old_lines.join('\n')}\n`;
        const new_text = `${new_lines.join('\n')}\n`;
        expect(countLineDiff(old_text, new_text)).toEqual({ added: 40, removed: 40 });
    });
});

// the old rolling-DP algorithm lcsLength replaced, kept here only as a reference for the property test below
function referenceSplitLines(text: string): string[] {
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') { lines.pop(); }
    return lines;
}

function referenceLcsLength(a: readonly string[], b: readonly string[]): number {
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    let previous = new Array<number>(short.length + 1).fill(0);
    for (let i = 1; i <= long.length; i++) {
        const current = new Array<number>(short.length + 1).fill(0);
        for (let j = 1; j <= short.length; j++) {
            current[j] = long[i - 1] === short[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
        }
        previous = current;
    }
    return previous[short.length];
}

function referenceCountLineDiff(old_text: string | undefined, new_text: string | undefined): LineDiffCounts {
    const old_lines = old_text !== undefined ? referenceSplitLines(old_text) : [];
    const new_lines = new_text !== undefined ? referenceSplitLines(new_text) : [];
    if (old_lines.length === 0) { return { added: new_lines.length, removed: 0 }; }
    if (new_lines.length === 0) { return { added: 0, removed: old_lines.length }; }
    const shared = referenceLcsLength(old_lines, new_lines);
    return { added: new_lines.length - shared, removed: old_lines.length - shared };
}

// a tiny linear congruential generator, seeded, so the property test below is reproducible
function makeLcg(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

function randomLines(random: () => number, alphabet: readonly string[], max_lines: number): string[] {
    const line_count = Math.floor(random() * (max_lines + 1));
    const lines: string[] = [];
    for (let i = 0; i < line_count; i++) {
        lines.push(alphabet[Math.floor(random() * alphabet.length)]);
    }
    return lines;
}

function linesToText(lines: readonly string[]): string {
    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

describe('countLineDiff against the reference DP', () => {
    it('matches the reference DP over many seeded random line-array pairs from a tiny alphabet', () => {
        const random = makeLcg(20260930);
        const alphabet = ['a', 'b', 'c', 'd'];
        for (let trial = 0; trial < 300; trial++) {
            const old_text = linesToText(randomLines(random, alphabet, 12));
            const new_text = linesToText(randomLines(random, alphabet, 12));
            expect(countLineDiff(old_text, new_text)).toEqual(referenceCountLineDiff(old_text, new_text));
        }
    });

    it('matches the reference DP on a 5,000-line pair differing in only three lines', () => {
        const base_lines = Array.from({ length: 5000 }, (_, i) => `line ${i} content`);
        const edited_lines = base_lines.slice();
        edited_lines[10] = 'edited line a';
        edited_lines[2500] = 'edited line b';
        edited_lines[4990] = 'edited line c';
        const old_text = linesToText(base_lines);
        const new_text = linesToText(edited_lines);
        expect(countLineDiff(old_text, new_text)).toEqual(referenceCountLineDiff(old_text, new_text));
        expect(countLineDiff(old_text, new_text)).toEqual({ added: 3, removed: 3 });
    }, 30000);
});

describe('looksBinary', () => {
    it('is false for ordinary UTF-8 text', () => {
        expect(looksBinary(new TextEncoder().encode('function foo() { return 1; }\n'))).toBe(false);
    });

    it('is true for bytes carrying a NUL within the sniff window', () => {
        expect(looksBinary(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))).toBe(true);
    });

    it('ignores a NUL byte past the sniff window', () => {
        const bytes = new Uint8Array(8100);
        bytes.fill(0x41);
        bytes[8050] = 0;
        expect(looksBinary(bytes)).toBe(false);
    });
});

// the compute step both AgentAnalyserWorker.ts's thread and the host fallback run, so the cap and sniff can't drift
describe('lineDiffFromBytes', () => {
    function bytesOf(text: string): Uint8Array {
        return new TextEncoder().encode(text);
    }

    it('counts added and removed lines from both sides\' bytes', () => {
        expect(lineDiffFromBytes(bytesOf('a\nb\nc\n'), bytesOf('a\nx\nc\n'))).toEqual({ added: 1, removed: 1 });
    });

    it('counts every line added when the head side is absent, the shape of a newly added file', () => {
        expect(lineDiffFromBytes(undefined, bytesOf('a\nb\n'))).toEqual({ added: 2, removed: 0 });
    });

    it('counts every line removed when the working side is absent, the shape of a deleted file', () => {
        expect(lineDiffFromBytes(bytesOf('a\nb\nc\n'), undefined)).toEqual({ added: 0, removed: 3 });
    });

    it('declines when either side is over the byte cap', () => {
        expect(lineDiffFromBytes(bytesOf('a'.repeat(AGENT_LINE_DIFF_MAX_BYTES + 1)), bytesOf('a\n'))).toBeUndefined();
    });

    it('declines when either side looks binary', () => {
        expect(lineDiffFromBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]), bytesOf('a\n'))).toBeUndefined();
    });
});
