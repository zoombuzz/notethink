/**
 * Minimal VS Code-style glob matcher for host-side path filtering.
 *
 * Mirrors the webview-side helper at `client/webview/src/notethink-views/src/lib/globMatch.ts`
 * because the extension and webview run as separate webpack bundles with no shared module
 * graph — keep these two files byte-identical (minus the debug import the extension stack
 * doesn't use). Treat the pair as a shared cross-boundary contract.
 *
 * Used by `PanelSession.discoverFolderDocs` and `PanelSession.loadFolderDoc` so the
 * exclude filter is applied deterministically against every URI we'd otherwise admit
 * to `integration_docs`, independent of any quirk in `vscode.workspace.findFiles` and
 * independent of the file-system watcher (which has no exclude argument).
 *
 * Supports the subset of glob syntax notethink actually uses: `**`, `*`, `?`, and
 * `{a,b,c}` brace alternation, over posix-separated paths.
 */

const REGEX_SPECIAL = new Set('.+^$()|[]\\'.split(''));

function escapeRegexChar(ch: string): string {
    return REGEX_SPECIAL.has(ch) ? '\\' + ch : ch;
}

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

export function globMatches(path: string, include: string, exclude: string): boolean {
    const included = include.trim() === '' ? true : globToRegExp(include).test(path);
    if (!included) { return false; }
    if (exclude.trim() === '') { return true; }
    return !globToRegExp(exclude).test(path);
}
