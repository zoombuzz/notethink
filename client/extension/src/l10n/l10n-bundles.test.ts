import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BUNDLE_DIR = path.join(PROJECT_ROOT, 'l10n');
const LOCALES = ['fr', 'it', 'de', 'es'];

function readJson(file_path: string): Record<string, string> {
    return JSON.parse(fs.readFileSync(file_path, 'utf-8'));
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
                for (const [key, value] of Object.entries(bundle)) {
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
        });
    }
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
                for (const [key, value] of Object.entries(nls)) {
                    expect(typeof value).toBe('string');
                    expect(value.length).toBeGreaterThan(0);
                }
            });
        });
    }
});
