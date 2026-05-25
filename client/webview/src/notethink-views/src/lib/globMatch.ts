import Debug from "debug";

const debug = Debug("nodejs:notethink-views:globMatch");

/**
 * Minimal VS Code-style glob matcher for client-side (instant) file filtering.
 *
 * The authoritative include/exclude is applied host-side by vscode.workspace.findFiles;
 * this helper exists only so the Files drawer can re-filter the already-loaded file list
 * immediately as the user types, before the background re-discovery round-trips. It is
 * deliberately small (no minimatch/picomatch dependency) and supports the subset of glob
 * syntax NoteThink actually uses: `**`, `*`, `?`, and `{a,b,c}` brace alternation, over
 * posix-separated paths.
 */

const REGEX_SPECIAL = new Set('.+^$()|[]\\'.split(''));

/**
 * Escape a single literal character for safe inclusion in a RegExp source.
 */
function escapeRegexChar(ch: string): string {
    return REGEX_SPECIAL.has(ch) ? '\\' + ch : ch;
}

/**
 * Convert a VS Code glob into an anchored RegExp.
 *
 * Globstar handling matches VS Code semantics for the patterns we use: `**\/` collapses
 * zero or more leading directories (so `**\/*.md` still matches a top-level `todo.md`),
 * and a bare `**` matches across separators.
 */
export function globToRegExp(glob: string): RegExp {
    let source = '';
    for (let i = 0; i < glob.length; i++) {
        const ch = glob[i];
        if (ch === '*') {
            if (glob[i + 1] === '*') {
                if (glob[i + 2] === '/') {
                    // `**/` — zero or more leading path segments
                    source += '(?:.*/)?';
                    i += 2;
                } else {
                    // bare `**` — anything, including separators
                    source += '.*';
                    i += 1;
                }
            } else {
                // single `*` — anything except a separator
                source += '[^/]*';
            }
        } else if (ch === '?') {
            source += '[^/]';
        } else if (ch === '{') {
            const end = glob.indexOf('}', i);
            if (end === -1) {
                source += '\\{';
            } else {
                // brace sets in our patterns never nest, so a flat comma split is sufficient
                const alternatives = glob.slice(i + 1, end).split(',')
                    .map(part => part.split('').map(escapeRegexChar).join(''));
                source += '(?:' + alternatives.join('|') + ')';
                i = end;
            }
        } else {
            source += escapeRegexChar(ch);
        }
    }
    return new RegExp('^' + source + '$');
}

/**
 * Decide whether a path is selected under the given include/exclude globs.
 *
 * An empty include means "match everything" (the host substitutes its default `**\/*.md`,
 * and every loaded doc is already markdown). An empty exclude means "exclude nothing".
 * A path is selected when it matches include and does not match exclude.
 */
export function globMatches(path: string, include: string, exclude: string): boolean {
    const included = include.trim() === '' ? true : globToRegExp(include).test(path);
    if (!included) { return false; }
    if (exclude.trim() === '') { return true; }
    return !globToRegExp(exclude).test(path);
}
