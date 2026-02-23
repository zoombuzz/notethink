import { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { parse } from './parse-markdown';

export async function injectDocsFromFixture(page: Page, fixture_name: string, doc_path?: string) {
    const fixture_path = path.join(__dirname, '..', 'fixtures', fixture_name);
    const text = fs.readFileSync(fixture_path, 'utf-8');
    const resolved_path = doc_path || `/workspace/${fixture_name}`;
    const id = crypto.createHash('sha256').update(resolved_path).digest('hex').slice(0, 16);
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

    // Parse markdown server-side using the same mdast libraries as the extension
    const mdast = parse(text);

    await page.evaluate(({ doc, mdast_json }) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'update',
                partial: {
                    docs: {
                        [doc.id]: {
                            ...doc,
                            content: JSON.parse(mdast_json),
                        },
                    },
                },
            },
        }));
    }, {
        doc: { id, path: resolved_path, text, hash_sha256: hash },
        mdast_json: JSON.stringify(mdast),
    });

    return { id, path: resolved_path };
}
