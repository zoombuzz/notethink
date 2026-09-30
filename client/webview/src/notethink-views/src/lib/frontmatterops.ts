import Debug from "debug";
import type { LineTag, MdastNode, NoteProps } from "../types/NoteProps";

const debug = Debug("nodejs:notethink-views:frontmatterops");

// yaml uses `key: value`, toml uses `key = value`; first separator splits
const YAML_SEPARATOR = ':';
const TOML_SEPARATOR = '=';
// a line that is only a front-matter fence (--- for yaml, +++ for toml)
const FENCE_LINE = /^\s*(-{3,}|\+{3,})\s*$/;

/**
 * A front-matter block lifted into LineTag-shaped objects, plus the block's absolute start offset.
 * Offsets are relative to linetags_from, matching the heading-linetag convention.
 */
export interface FrontmatterLinetags {
    linetags?: { [key: string]: LineTag };
    linetags_from?: number;
}

// stored scalar value plus the offset of that value within its raw token
interface ScalarValue {
    value: string;
    value_start: number;
}

// finds the first front-matter child (yaml or toml), accepting either MdastNode or NoteProps children
export function findFrontmatterNode(children: ReadonlyArray<MdastNode | NoteProps>): MdastNode | undefined {
    for (const child of children) {
        if (child.type === 'yaml' || child.type === 'toml') {
            return child as MdastNode;
        }
    }
    return undefined;
}

/**
 * Parses a front-matter node into key → LineTag with real file offsets, sliced from `text` over
 * `node.position` and made relative to the block start. Keys are verbatim; values are bare strings
 * with matching quotes stripped, and inline arrays are kept verbatim. Skips blank, comment, fence,
 * malformed and empty-value lines.
 */
export function parseFrontmatterLinetags(
    node: MdastNode,
    text: string,
    note_seq: number,
): FrontmatterLinetags {
    const linetags_from = node.position.start.offset;
    const block = text.slice(linetags_from, node.position.end.offset);
    const separator = node.type === 'toml' ? TOML_SEPARATOR : YAML_SEPARATOR;
    const linetags: { [key: string]: LineTag } = {};
    // cursor tracks each line's offset within the block (== offset relative to linetags_from)
    let cursor = 0;
    for (const line of block.split('\n')) {
        parseFrontmatterLine(line, cursor, separator, note_seq, linetags);
        cursor += line.length + 1;
    }
    if (Object.keys(linetags).length === 0) { return {}; }
    return { linetags, linetags_from };
}

// parses one front-matter line into a LineTag, mutating `linetags` in place (logged and skipped on malformed input)
function parseFrontmatterLine(
    line: string,
    line_offset: number,
    separator: string,
    note_seq: number,
    linetags: { [key: string]: LineTag },
): void {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || FENCE_LINE.test(line)) { return; }
    const separator_at = line.indexOf(separator);
    if (separator_at === -1) {
        debug('skip malformed front-matter line=%s', line);
        return;
    }
    const key_raw = line.slice(0, separator_at);
    const key = key_raw.trim();
    if (!key) {
        debug('skip front-matter line with empty key=%s', line);
        return;
    }
    const scalar = parseScalarValue(line.slice(separator_at + 1));
    // empty value → no LineTag for this key
    if (!scalar) { return; }
    linetags[key] = makeFrontmatterTag(key, scalar, line_offset, separator_at, note_seq);
}

// builds a LineTag from a key/scalar pair, offsets relative to linetags_from; mirrors parseLineTags's coercion
function makeFrontmatterTag(
    key: string,
    scalar: ScalarValue,
    line_offset: number,
    separator_at: number,
    note_seq: number,
): LineTag {
    const linetag: LineTag = {
        key,
        value: scalar.value,
        key_offset: line_offset,
        value_offset: line_offset + separator_at + 1 + scalar.value_start,
        linktext_offset: 0,
        note_seq,
    };
    if (!isNaN(parseFloat(scalar.value))) {
        linetag.value_numeric = Number(scalar.value);
    }
    return linetag;
}

// parses a scalar or inline array, returning its stored value and offset; undefined for an empty value
function parseScalarValue(raw: string): ScalarValue | undefined {
    const leading = leadingWhitespace(raw);
    const token = raw.trim();
    if (!token) { return undefined; }
    // inline arrays are stored verbatim, not expanded
    if (token.startsWith('[') && token.endsWith(']')) {
        return { value: token, value_start: leading };
    }
    // strip matching single / double quotes; stored value starts one char in
    if (isQuoted(token)) {
        const unquoted = token.slice(1, -1);
        if (!unquoted) { return undefined; }
        return { value: unquoted, value_start: leading + 1 };
    }
    return { value: token, value_start: leading };
}

// count of leading whitespace characters
function leadingWhitespace(value: string): number {
    return value.length - value.trimStart().length;
}

// true when token is wrapped in a matching pair of single or double quotes
function isQuoted(token: string): boolean {
    if (token.length < 2) { return false; }
    const first = token[0];
    const last = token[token.length - 1];
    return (first === '"' && last === '"') || (first === "'" && last === "'");
}
