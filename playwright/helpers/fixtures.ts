import * as fs from 'node:fs';
import * as path from 'node:path';

// the one place the fixtures directory is located, so no caller has to know the hop from its own file
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

function fixturePath(fixture: string): string {
    return path.join(FIXTURES_DIR, fixture);
}

// the fixture's source text, as the extension would have read it off disk
export function fixtureText(fixture: string): string {
    return fs.readFileSync(fixturePath(fixture), 'utf-8');
}

/**
 * source offset of a literal within a fixture, so a spec can drive a caret to a known place without
 * hand-counting bytes. Throws rather than returning -1, because a silent -1 becomes offset 0 at the
 * top of the document and the spec then asserts against the wrong note instead of failing.
 */
export function fixtureOffsetOf(fixture: string, needle: string): number {
    const text = fixtureText(fixture);
    const offset = text.indexOf(needle);
    if (offset < 0) { throw new Error(`fixture ${fixture} contains no ${needle}`); }
    return offset;
}
