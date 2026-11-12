/**
 * Pure helpers for the publish-safety scan over `workflows/`, which ships in a public repository.
 * Everything here works on strings so the scan itself stays free of file access: the Jest suites
 * list the files, read them and hand the text in.
 *
 * Findings never carry the matched text. A match is reported as a masked form (first character, a
 * run of stars and the length), because a finding that echoed a secret or a private term would put
 * it into a CI log.
 */

export interface SanitiseFinding {
    rule: string;
    file: string;
    line: number;
    masked: string;
}

interface SanitiseRule {
    name: string;
    pattern: RegExp;
}

const FILE_EXTENSION_TLDS = '(?:md|mjs|cjs|js|ts|tsx|json|txt|yml|yaml)';
const LINK_HOST_ALLOWLIST = ['notethink.com', 'www.notethink.com', 'marketplace.visualstudio.com', 'open-vsx.org'];
const LINK_GITHUB_PREFIX = '/zoombuzz/notethink';
const MARKDOWN_LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const TEXT_RULES: SanitiseRule[] = [
    { name: 'home-path', pattern: /(?:^|[\s("'`=])(?:\/home|\/Users|\/root|\/mnt|\/Volumes|\/var\/home)\/[A-Za-z0-9._-]+/g },
    { name: 'home-path', pattern: /\b[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/g },
    { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
    { name: 'ip-address', pattern: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g },
    {
        name: 'host-port',
        pattern: new RegExp(`\\b(?:localhost|(?:\\d{1,3}\\.){3}\\d{1,3}|[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?!${FILE_EXTENSION_TLDS}\\b)[a-z]{2,}):\\d{2,5}\\b`, 'gi'),
    },
    { name: 'analytics-id', pattern: /\bG-[A-Z0-9]{8,12}\b/g },
    { name: 'analytics-id', pattern: /\bUA-\d{4,10}-\d{1,4}\b/g },
    { name: 'analytics-id', pattern: /\bGTM-[A-Z0-9]{5,8}\b/g },
    { name: 'analytics-id', pattern: /\bAW-\d{8,12}\b/g },
    { name: 'secret', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
    { name: 'secret', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
    { name: 'secret', pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
    { name: 'secret', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
    { name: 'secret', pattern: /\bxox[abeprs]-[A-Za-z0-9-]{10,}/g },
    { name: 'secret', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
    { name: 'secret', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
    { name: 'secret', pattern: /\b[0-9a-f]{40,}\b/g },
    { name: 'secret', pattern: /(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])\b[A-Za-z0-9+/_-]{32,}\b/g },
    { name: 'secret', pattern: /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s'"`]{8,}/gi },
    { name: 'dash-glyph', pattern: /[\u2013\u2014]|&[mn]dash;/g },
];

/** Shows enough of a match to locate it, without reproducing it. */
export function maskMatch(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) { return '(empty)'; }
    return `${trimmed[0]}${'*'.repeat(Math.min(trimmed.length - 1, 6))} (${trimmed.length} chars)`;
}

/** Parses a terms file: one term per line, blank lines and lines starting with `#` ignored. */
export function parseTerms(text: string): string[] {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'));
}

/** Resolves a relative link against the file's folder, returning undefined when it climbs out of the pack. */
export function resolveWithinPack(file: string, target: string): string | undefined {
    const parts = file.split('/').slice(0, -1);
    for (const segment of target.split('/')) {
        if (segment === '' || segment === '.') { continue; }
        if (segment === '..') {
            if (parts.length === 0) { return undefined; }
            parts.pop();
        } else {
            parts.push(segment);
        }
    }
    return parts.join('/');
}

function linkLeavesPack(file: string, raw_target: string): boolean {
    const target = decodeURI(raw_target).split('#')[0].split('?')[0];
    if (target === '' || raw_target.startsWith('#') || raw_target.startsWith('?')) { return false; }
    if (/^https?:\/\//i.test(target)) {
        const url = new URL(target);
        if (LINK_HOST_ALLOWLIST.includes(url.hostname)) { return false; }
        return !(url.hostname === 'github.com' && url.pathname.toLowerCase().startsWith(LINK_GITHUB_PREFIX));
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) { return !target.toLowerCase().startsWith('mailto:'); }
    if (target.startsWith('/')) { return true; }
    return resolveWithinPack(file, target) === undefined;
}

function lineOf(text: string, index: number): number {
    return text.slice(0, index).split('\n').length;
}

/**
 * Scans one file's text. `file` is its path relative to the pack root with forward slashes, which
 * the link rule needs to tell a link inside the pack from one that leaves it.
 */
export function scanText(file: string, text: string, terms: string[] = []): SanitiseFinding[] {
    const findings: SanitiseFinding[] = [];
    for (const rule of TEXT_RULES) {
        for (const match of text.matchAll(rule.pattern)) {
            findings.push({ rule: rule.name, file, line: lineOf(text, match.index ?? 0), masked: maskMatch(match[0]) });
        }
    }
    for (const match of text.matchAll(MARKDOWN_LINK)) {
        if (linkLeavesPack(file, match[1])) {
            findings.push({ rule: 'link-leaves-pack', file, line: lineOf(text, match.index ?? 0), masked: maskMatch(match[1]) });
        }
    }
    const lowered = text.toLowerCase();
    for (const term of terms) {
        const needle = term.toLowerCase();
        let from = lowered.indexOf(needle);
        while (from !== -1) {
            findings.push({ rule: 'private-term', file, line: lineOf(text, from), masked: maskMatch(term) });
            from = lowered.indexOf(needle, from + needle.length);
        }
    }
    return findings;
}

/** One line per finding, safe to print: the rule, the place and the masked match. */
export function formatFindings(findings: SanitiseFinding[]): string {
    return findings.map((finding) => `${finding.file}:${finding.line} ${finding.rule} ${finding.masked}`).join('\n');
}
