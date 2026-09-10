import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BUNDLE_DIR = path.join(PROJECT_ROOT, 'l10n');
const LOCALES = ['fr', 'it', 'de', 'es'];

/*
 * Values that are legitimately identical to their English key, measured 2026-09-10 against all four
 * bundles. Every entry carries the reason it is here, because an uncommented allowlist is
 * indistinguishable from an untranslated string somebody silenced.
 *
 * The split matters. ALLOWED_SAME_EVERY_LOCALE is for strings with no translatable words in them at
 * all; ALLOWED_SAME_BY_LOCALE is for a string that happens to be the same word in one language, so
 * the same value left untranslated in a different locale still fails. A single flat list across four
 * locales would allow "Collisions" in German on the strength of it being correct in French.
 */
const ALLOWED_SAME_EVERY_LOCALE = [
    // the aspect-ratio label "1 : 1.4" - digits and a placeholder, nothing to translate
    '1 : {0}',
];

const ALLOWED_SAME_BY_LOCALE: Record<string, Array<string>> = {
    de: [
        // "Position" is the German word; es/fr/it all differ
        'Position:',
        // "Name" is the German word; es/fr/it all differ
        'Name',
    ],
    es: [
        // "Auto" is the accepted Spanish abbreviation of "automatico"; de and it use the full word
        'Auto ({0})',
    ],
    fr: [
        // "Collisions" is the French word; de/es/it all differ
        'Collisions',
        // "Orientation" is the French word; de/es/it all differ
        'Orientation',
        // "Auto" is the accepted French abbreviation of "automatique"; de and it use the full word
        'Auto ({0})',
    ],
    it: [],
};

/*
 * The three keys carrying the extension's marketplace identity. The product name is not translated,
 * and these are the only package.nls values identical to English in any locale.
 */
const ALLOWED_SAME_NLS = [
    'displayName',
    'editor.displayName',
    'config.title',
];

function readJson(file_path: string): Record<string, string> {
    return JSON.parse(fs.readFileSync(file_path, 'utf-8'));
}

function allowedSame(locale: string): Array<string> {
    return [...ALLOWED_SAME_EVERY_LOCALE, ...(ALLOWED_SAME_BY_LOCALE[locale] ?? [])];
}

describe('l10n bundle completeness', () => {

    const en_bundle = readJson(path.join(BUNDLE_DIR, 'bundle.l10n.json'));
    const en_keys = Object.keys(en_bundle);

    for (const locale of LOCALES) {
        describe(`bundle.l10n.${locale}.json`, () => {
            const bundle = readJson(path.join(BUNDLE_DIR, `bundle.l10n.${locale}.json`));

            it('has all keys from English bundle', () => {
                const missing_keys = en_keys.filter(k => !(k in bundle));
                expect(missing_keys).toEqual([]);
            });

            it('has no extra keys beyond English bundle', () => {
                const extra_keys = Object.keys(bundle).filter(k => !(k in en_bundle));
                expect(extra_keys).toEqual([]);
            });

            it('has non-empty string values for every key', () => {
                for (const [_key, value] of Object.entries(bundle)) {
                    expect(typeof value).toBe('string');
                    expect(value.length).toBeGreaterThan(0);
                }
            });

            it('preserves interpolation placeholders', () => {
                for (const [key, value] of Object.entries(bundle)) {
                    const key_placeholders = (key.match(/\{\d+\}/g) || []).sort();
                    const value_placeholders = (value.match(/\{\d+\}/g) || []).sort();
                    expect(value_placeholders).toEqual(key_placeholders);
                }
            });

            /*
             * The check that catches a new string shipped as English in four languages. Key parity
             * passes on it, non-empty passes on it, and placeholder preservation passes on it, so
             * without this one an untranslated addition reaches users silently.
             */
            it('has no values left identical to English, except the allowlisted ones', () => {
                const allowed = allowedSame(locale);
                const untranslated = en_keys.filter(k => bundle[k] === en_bundle[k] && !allowed.includes(k));
                expect(untranslated).toEqual([]);
            });

            // a stale allowlist entry is an exemption hiding whatever arrives next
            it('has no allowlist entries that are no longer needed', () => {
                const unused = allowedSame(locale).filter(k => bundle[k] !== en_bundle[k]);
                expect(unused).toEqual([]);
            });
        });
    }

    /*
     * The identical-to-English check compares each value against the en bundle rather than against
     * its own key. @vscode/l10n makes the key the English string, so the two baselines are the same
     * thing - but only while that holds, and a single entry where it does not would silently move
     * the check onto a different baseline.
     */
    it('uses an English bundle whose every value equals its key', () => {
        const divergent = en_keys.filter(k => en_bundle[k] !== k);
        expect(divergent).toEqual([]);
    });
});

describe('package.nls completeness', () => {

    const en_nls = readJson(path.join(PROJECT_ROOT, 'package.nls.json'));
    const en_keys = Object.keys(en_nls);

    for (const locale of LOCALES) {
        describe(`package.nls.${locale}.json`, () => {
            const nls = readJson(path.join(PROJECT_ROOT, `package.nls.${locale}.json`));

            it('has all keys from English NLS', () => {
                const missing_keys = en_keys.filter(k => !(k in nls));
                expect(missing_keys).toEqual([]);
            });

            it('has no extra keys beyond English NLS', () => {
                const extra_keys = Object.keys(nls).filter(k => !(k in en_nls));
                expect(extra_keys).toEqual([]);
            });

            it('has non-empty string values for every key', () => {
                for (const [_key, value] of Object.entries(nls)) {
                    expect(typeof value).toBe('string');
                    expect(value.length).toBeGreaterThan(0);
                }
            });

            it('has no values left identical to English, except the marketplace identity', () => {
                const untranslated = en_keys.filter(k => nls[k] === en_nls[k] && !ALLOWED_SAME_NLS.includes(k));
                expect(untranslated).toEqual([]);
            });

            it('has no allowlist entries that are no longer needed', () => {
                const unused = ALLOWED_SAME_NLS.filter(k => nls[k] !== en_nls[k]);
                expect(unused).toEqual([]);
            });
        });
    }
});
