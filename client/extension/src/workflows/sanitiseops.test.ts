import { formatFindings, maskMatch, parseTerms, resolveWithinPack, scanText } from './sanitiseops';

// built at runtime so this file holds no literal that looks like a credential to an outside scanner
const GITHUB_TOKEN = 'gh' + 'p_' + 'a1B2c3D4'.repeat(5);
const AWS_KEY = 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP';
const LONG_SECRET = 'Zx9' + 'qW3eR7tY1uI5oP2aS4dF6gH8jK0lM';
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

function rulesFor(text: string, file = 'a.md'): string[] {
    return scanText(file, text).map((finding) => finding.rule);
}

describe('scanText rules', () => {
    it('passes plain prose', () => {
        expect(scanText('a.md', '# Title\n\nSome words, a link to [other](b.md) and a ref src/file.ts:42.\n')).toEqual([]);
    });

    it.each([
        ['a home path', 'open /home/someone/project now'],
        ['a macOS home path', 'see (/Users/someone/code)'],
        ['a mount path', 'run `/mnt/disk/work`'],
        ['a Windows home path', 'at C:\\Users\\someone\\code'],
    ])('catches %s', (_name, text) => {
        expect(rulesFor(text)).toContain('home-path');
    });

    it('catches an email address', () => {
        expect(rulesFor('mail someone@example.org please')).toContain('email');
    });

    it('catches an IPv4 address', () => {
        expect(rulesFor('server at 192.168.1.20 today')).toContain('ip-address');
    });

    it.each([['localhost:3000'], ['dev.example.com:8080'], ['10.0.0.5:5432']])('catches host:port %s', (text) => {
        expect(rulesFor(`call ${text} now`)).toContain('host-port');
    });

    it('does not mistake a file:line reference for host:port', () => {
        expect(rulesFor('see README.md:12 and scripts/move-to-done.mjs:30')).toEqual([]);
    });

    it.each([['G-ABCDE12345'], ['UA-1234567-1'], ['GTM-ABC1234'], ['AW-123456789']])('catches analytics id %s', (id) => {
        expect(rulesFor(`id ${id} here`)).toContain('analytics-id');
    });

    it.each([
        ['a GitHub token', GITHUB_TOKEN],
        ['an AWS key id', AWS_KEY],
        ['a long mixed-case token', LONG_SECRET],
        ['a private key header', '-----BEGIN RSA PRIVATE KEY-----'],
        ['a bearer token', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123'],
        ['an assigned password', 'password = hunter2hunter2'],
        ['a forty character hex digest', 'a'.repeat(20) + '0123456789'.repeat(2)],
    ])('catches %s', (_name, text) => {
        expect(rulesFor(`value ${text} end`)).toContain('secret');
    });

    it('catches an em dash, an en dash and the entity forms', () => {
        for (const glyph of [EM_DASH, EN_DASH, '&mdash;', '&ndash;']) {
            expect(rulesFor(`one ${glyph} two`)).toContain('dash-glyph');
        }
    });
});

describe('scanText link rule', () => {
    it('allows a link that stays inside the pack', () => {
        expect(rulesFor('[x](skills/what-next/SKILL.md) [y](#anchor) [z](?status=doing)')).toEqual([]);
        expect(rulesFor('[back](../../AGENTS.md)', 'skills/what-next/SKILL.md')).toEqual([]);
    });

    it('catches a relative link that climbs out of the pack', () => {
        expect(rulesFor('[x](../outside.md)', 'README.md')).toContain('link-leaves-pack');
        expect(rulesFor('[x](../../../outside.md)', 'skills/a/SKILL.md')).toContain('link-leaves-pack');
    });

    it('catches an absolute path link and a file link', () => {
        expect(rulesFor('[x](/docs/page.md)')).toContain('link-leaves-pack');
        expect(rulesFor('[x](file:///tmp/a.md)')).toContain('link-leaves-pack');
    });

    it('catches an external link to an unlisted host and allows the project hosts', () => {
        expect(rulesFor('[x](https://example.org/page)')).toContain('link-leaves-pack');
        expect(rulesFor('[x](https://www.notethink.com/app)')).toEqual([]);
        expect(rulesFor('[x](https://github.com/zoombuzz/notethink)')).toEqual([]);
        expect(rulesFor('[x](https://github.com/someone/else)')).toContain('link-leaves-pack');
    });
});

describe('terms and masking', () => {
    it('parses a terms file, skipping blanks and comments', () => {
        expect(parseTerms('# header\nAcme Widgets\n\n  secretproj  \n')).toEqual(['Acme Widgets', 'secretproj']);
    });

    it('reports a private term case-insensitively and masked', () => {
        const findings = scanText('a.md', 'line one\nthe ACME WIDGETS plan\n', ['Acme Widgets']);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ rule: 'private-term', file: 'a.md', line: 2 });
        expect(findings[0].masked).toBe('A****** (12 chars)');
        expect(formatFindings(findings)).not.toMatch(/acme/i);
    });

    it('never echoes a matched secret in its findings', () => {
        const output = formatFindings(scanText('a.md', `token ${GITHUB_TOKEN} and ${AWS_KEY}\n`));
        expect(output).not.toContain(GITHUB_TOKEN);
        expect(output).not.toContain(AWS_KEY);
        expect(output).toContain('a.md:1 secret');
    });

    it('masks short and empty values', () => {
        expect(maskMatch('ab')).toBe('a* (2 chars)');
        expect(maskMatch('   ')).toBe('(empty)');
    });
});

describe('resolveWithinPack', () => {
    it('resolves relative targets against the file folder', () => {
        expect(resolveWithinPack('skills/a/SKILL.md', '../../AGENTS.md')).toBe('AGENTS.md');
        expect(resolveWithinPack('README.md', './skills/a/SKILL.md')).toBe('skills/a/SKILL.md');
        expect(resolveWithinPack('README.md', '../x.md')).toBeUndefined();
    });
});
