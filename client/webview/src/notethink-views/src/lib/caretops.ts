import type { NoteProps } from "../types/NoteProps";
import { titleEndOffset } from "./noteops";

// replaced at build time by webpack's DefinePlugin: true only in a dev build, undefined in a library consumer
declare const NOTETHINK_DEV: boolean | undefined;

/**
 * Pure helpers for the virtual caret: the mapping between a title's
 * rendered text and its markdown source, the caret field a note offers (its title, or one linetag
 * value), and (dev builds only) the single-key edits relayed to the extension as `editText` changes. Everything here is
 * in the source file's own offset space (the space `editText` and `selectRange` speak), never the
 * merged-tree space.
 */

/** Whether the typing half of the virtual caret runs (click to arm, key relay, hidden input): a dev build only. The editor's caret is drawn in every build and needs no gate. */
export function virtualCaretEnabled(): boolean {
    return typeof NOTETHINK_DEV !== 'undefined' && NOTETHINK_DEV === true;
}

/**
 * The rendered-to-source mapping of one title.
 * - rendered: the text a reader sees once markdown is applied (no emphasis marks, link destinations)
 * - starts / ends: for rendered character i, the source range [starts[i], ends[i]) it comes from, as
 *   offsets into the title's own source text
 * - source_length: the title source's length, the offset after the last rendered character
 */
export interface TitleMap {
    rendered: string;
    starts: number[];
    ends: number[];
    source_length: number;
}

/**
 * One place the caret can sit: a note's title, or the value of one of its linetags.
 * - kind: which field it is; `key` names the linetag for a linetag value
 * - doc_path: the file the note lives in (folder mode), undefined in single-file mode
 * - from / to: the field's source range in the file, to exclusive of any trailing space
 * - map: the rendered-to-source mapping; the identity for a linetag value, whose rendering is its text
 */
export interface CaretField {
    kind: 'title' | 'linetag';
    key?: string;
    doc_path?: string;
    from: number;
    to: number;
    map: TitleMap;
}

/** A single edit relayed to the extension, in the shape `editText` carries. */
export interface CaretEdit {
    change: { from: number; to?: number; insert: string };
    next_caret: number;
}

export type CaretMove = 'left' | 'right' | 'home' | 'end';

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const EMPHASIS_DELIMITERS = ['**', '__', '~~', '*', '_'];
// characters a linetag value may take from a keystroke without breaking its `[](?key=value)` link
const LINETAG_VALUE_CHAR = /^[A-Za-z0-9._-]$/;

function isSpace(char: string | undefined): boolean {
    return char === undefined || char === '' || /\s/.test(char);
}

function isWordChar(char: string | undefined): boolean {
    return char !== undefined && /[A-Za-z0-9]/.test(char);
}

/**
 * Builds the rendered-to-source map of a single-line markdown title. Handles backslash escapes, code
 * spans, `[text](url)` links, `![alt](src)` images (rendered as nothing) and `**` `__` `~~` `*` `_`
 * emphasis whose delimiters pair up on the same line. Anything it does not recognise (autolinks,
 * entities, raw HTML, reference links, unbalanced or nested-ambiguous emphasis) counts as literal text,
 * so the map can disagree with a real parse there; the jest suite measures how often against mdast.
 */
export function buildTitleMap(source: string): TitleMap {
    const rendered: string[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    function emit(char: string, from: number, to: number): void {
        rendered.push(char);
        starts.push(from);
        ends.push(to);
    }
    scanInline(source, 0, source.length, emit);
    return { rendered: rendered.join(''), starts, ends, source_length: source.length };
}

type Emit = (char: string, from: number, to: number) => void;

function scanInline(source: string, from: number, to: number, emit: Emit): void {
    let i = from;
    while (i < to) {
        const char = source[i];
        if (char === '\\' && i + 1 < to && PUNCTUATION.test(source[i + 1])) {
            emit(source[i + 1], i, i + 2);
            i += 2;
            continue;
        }
        if (char === '`') {
            const next = scanCodeSpan(source, i, to, emit);
            if (next > i) { i = next; continue; }
        }
        if (char === '!' && source[i + 1] === '[') {
            const link = findLinkEnd(source, i + 1, to);
            if (link) { i = link.end; continue; }
        }
        if (char === '[') {
            const link = findLinkEnd(source, i, to);
            if (link) {
                scanInline(source, i + 1, link.text_end, emit);
                i = link.end;
                continue;
            }
        }
        const delimiter = EMPHASIS_DELIMITERS.find(candidate => source.startsWith(candidate, i));
        if (delimiter && canOpenEmphasis(source, i, delimiter, to)) {
            const close = findEmphasisClose(source, i + delimiter.length, delimiter, to);
            if (close >= 0) {
                scanInline(source, i + delimiter.length, close, emit);
                i = close + delimiter.length;
                continue;
            }
        }
        emit(char, i, i + 1);
        i += 1;
    }
}

// a code span's content renders verbatim; returns the offset after the closing run, or `at` when unclosed
function scanCodeSpan(source: string, at: number, to: number, emit: Emit): number {
    let run = 0;
    while (source[at + run] === '`' && at + run < to) { run += 1; }
    const fence = '`'.repeat(run);
    let search = at + run;
    while (search < to) {
        const close = source.indexOf(fence, search);
        if (close < 0 || close >= to) { return at; }
        // a longer backtick run is not the closer of a shorter fence
        if (source[close + run] === '`') {
            let longer = close;
            while (source[longer] === '`') { longer += 1; }
            search = longer;
            continue;
        }
        for (let k = at + run; k < close; k += 1) { emit(source[k], k, k + 1); }
        return close + run;
    }
    return at;
}

// finds the end of a `[text](destination)` link opening at `at`; the text range and the offset after the `)`
function findLinkEnd(source: string, at: number, to: number): { text_end: number; end: number } | undefined {
    let depth = 0;
    for (let k = at; k < to; k += 1) {
        if (source[k] === '\\') { k += 1; continue; }
        if (source[k] === '[') { depth += 1; }
        if (source[k] === ']') {
            depth -= 1;
            if (depth === 0) {
                if (source[k + 1] !== '(') { return undefined; }
                const close = source.indexOf(')', k + 2);
                if (close < 0 || close >= to) { return undefined; }
                return { text_end: k, end: close + 1 };
            }
        }
    }
    return undefined;
}

function canOpenEmphasis(source: string, at: number, delimiter: string, to: number): boolean {
    const after = source[at + delimiter.length];
    if (at + delimiter.length >= to || isSpace(after)) { return false; }
    // intraword underscores are literal, as in snake_case
    if (delimiter.startsWith('_') && isWordChar(source[at - 1])) { return false; }
    return true;
}

function findEmphasisClose(source: string, from: number, delimiter: string, to: number): number {
    for (let k = from; k + delimiter.length <= to; k += 1) {
        if (source[k] === '\\') { k += 1; continue; }
        if (source[k] === '`') {
            // a closer inside a code span does not count
            const skip = scanCodeSpan(source, k, to, () => {});
            if (skip > k) { k = skip - 1; continue; }
        }
        if (source.startsWith(delimiter, k) && !isSpace(source[k - 1]) && k > from) {
            if (delimiter.startsWith('_') && isWordChar(source[k + delimiter.length])) { continue; }
            return k;
        }
    }
    return -1;
}

/**
 * The offset of the first title character inside a headline: past a heading's `#` marks and their
 * space. Only headings are caret fields: a task line is a paragraph whose headline holds a checkbox
 * input that the card's styling selects as a direct child, so marking its text would break that.
 */
export function titleStartInHeadline(note: Pick<NoteProps, 'type' | 'headline_raw'>): number | undefined {
    if (note.type === 'heading') {
        const marks = /^#{1,6}[ \t]+/.exec(note.headline_raw);
        return marks ? marks[0].length : undefined;
    }
    return undefined;
}

/**
 * The note's start in its own file: the folder origin's source position when present, else the in-tree
 * position. An edit inside the note's own title or linetag values never moves it, which is what lets the
 * caret find its note again after a re-parse that renames it.
 */
export function noteSourceStart(note: NoteProps): number | undefined {
    return note.origin?.source_position?.start.offset ?? note.position?.start?.offset;
}

/**
 * The caret field of a note's title, in source offsets. Undefined for a note that is not a heading, a
 * note with no position, a headline over more than one line, or an empty title.
 */
export function titleField(note: NoteProps): CaretField | undefined {
    const base = noteSourceStart(note);
    const start_in_headline = titleStartInHeadline(note);
    const end_abs = titleEndOffset(note);
    if (base === undefined || start_in_headline === undefined || end_abs === undefined) { return undefined; }
    const end_in_headline = end_abs - base;
    if (end_in_headline <= start_in_headline) { return undefined; }
    const source = note.headline_raw.slice(start_in_headline, end_in_headline);
    if (source.includes('\n')) { return undefined; }
    return {
        kind: 'title',
        doc_path: note.origin?.doc_path,
        from: base + start_in_headline,
        to: base + end_in_headline,
        map: buildTitleMap(source),
    };
}

/**
 * The caret field of one linetag value. The linetag parser records offsets that can land on an earlier
 * occurrence of the same text, so the field is offered only when the headline text at the computed
 * range is exactly the value; a value that fails the check has no field rather than a wrong one.
 */
export function linetagField(note: NoteProps, key: string): CaretField | undefined {
    const base = noteSourceStart(note);
    const tag = note.linetags?.[key];
    if (base === undefined || !tag || tag.inherited || note.linetags_from === undefined) { return undefined; }
    const in_headline = note.linetags_from - note.position.start.offset + tag.value_offset;
    if (note.headline_raw.slice(in_headline, in_headline + tag.value.length) !== tag.value) { return undefined; }
    const identity = Array.from(tag.value, (_char, index) => index);
    return {
        kind: 'linetag',
        key,
        doc_path: note.origin?.doc_path,
        from: base + in_headline,
        to: base + in_headline + tag.value.length,
        map: {
            rendered: tag.value,
            starts: identity,
            ends: identity.map(index => index + 1),
            source_length: tag.value.length,
        },
    };
}

/** Every caret field a note offers: its title first, then each real linetag value that verifies. */
export function caretFieldsOf(note: NoteProps): CaretField[] {
    const fields: CaretField[] = [];
    const title = titleField(note);
    if (title) { fields.push(title); }
    for (const key of Object.keys(note.linetags ?? {})) {
        const field = linetagField(note, key);
        if (field) { fields.push(field); }
    }
    return fields;
}

/** The source offset a rendered caret offset stands for: the start of the character it sits before. */
export function renderedToSource(field: CaretField, rendered_offset: number): number {
    const { map } = field;
    const clamped = Math.max(0, Math.min(rendered_offset, map.rendered.length));
    const inside = clamped < map.rendered.length ? map.starts[clamped] : map.source_length;
    return field.from + inside;
}

/**
 * The rendered caret offset a source offset falls on. An offset inside markup (between a `**` and the
 * text) lands on the nearest rendered character at or after it.
 */
export function sourceToRendered(field: CaretField, source_offset: number): number {
    const relative = source_offset - field.from;
    const { map } = field;
    for (let i = 0; i < map.rendered.length; i += 1) {
        if (relative <= map.starts[i]) { return i; }
        if (relative < map.ends[i]) { return i; }
    }
    return map.rendered.length;
}

/** The field whose source range holds an offset, and the rendered offset it lands on there. */
export function fieldAt(fields: CaretField[], doc_path: string | undefined, source_offset: number): { field: CaretField; rendered_offset: number } | undefined {
    for (const field of fields) {
        if (field.doc_path !== doc_path) { continue; }
        if (source_offset >= field.from && source_offset <= field.to) {
            return { field, rendered_offset: sourceToRendered(field, source_offset) };
        }
    }
    return undefined;
}

/** Moves a rendered caret offset within its field. */
export function moveCaret(field: CaretField, rendered_offset: number, move: CaretMove): number {
    const length = field.map.rendered.length;
    switch (move) {
        case 'left': return Math.max(0, rendered_offset - 1);
        case 'right': return Math.min(length, rendered_offset + 1);
        case 'home': return 0;
        case 'end': return length;
    }
}

/**
 * The edit a keystroke relays, or undefined when the field takes none (nothing to delete at that
 * end, or a character a linetag value cannot hold). Backspace and Delete remove the whole source
 * span of the rendered character, so an escaped character goes with its backslash. Typing inserts at
 * the source offset the caret stands for; inside a title that can land within emphasis marks, which
 * is the intended place for text typed in the middle of emphasised words.
 */
export function editForKey(field: CaretField, rendered_offset: number, key: 'Backspace' | 'Delete' | { text: string }): CaretEdit | undefined {
    const { map } = field;
    if (typeof key === 'object') {
        if (field.kind === 'linetag' && !LINETAG_VALUE_CHAR.test(key.text)) { return undefined; }
        if (key.text.length === 0 || key.text.includes('\n')) { return undefined; }
        return { change: { from: renderedToSource(field, rendered_offset), insert: key.text }, next_caret: rendered_offset + key.text.length };
    }
    if (key === 'Backspace') {
        if (rendered_offset <= 0) { return undefined; }
        const index = rendered_offset - 1;
        return { change: { from: field.from + map.starts[index], to: field.from + map.ends[index], insert: '' }, next_caret: index };
    }
    if (rendered_offset >= map.rendered.length) { return undefined; }
    return { change: { from: field.from + map.starts[rendered_offset], to: field.from + map.ends[rendered_offset], insert: '' }, next_caret: rendered_offset };
}
