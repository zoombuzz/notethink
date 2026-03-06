import { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { parse } from './parse-markdown';

interface InjectOptions {
    workspace_root?: string;
    relative_path?: string;
}

export async function injectDocsFromFixture(page: Page, fixture_name: string, doc_path?: string, workspace_root_or_options?: string | InjectOptions) {
    const fixture_path = path.join(__dirname, '..', 'fixtures', fixture_name);
    const text = fs.readFileSync(fixture_path, 'utf-8');
    const resolved_path = doc_path || `/workspace/${fixture_name}`;
    const id = crypto.createHash('sha256').update(resolved_path).digest('hex').slice(0, 16);
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

    // Parse markdown server-side using the same mdast libraries as the extension
    const mdast = parse(text);

    const options: InjectOptions = typeof workspace_root_or_options === 'string'
        ? { workspace_root: workspace_root_or_options }
        : (workspace_root_or_options || {});

    await page.evaluate(({ doc, mdast_json, ws_root }) => {
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
                workspace_root: ws_root,
            },
        }));
    }, {
        doc: {
            id,
            path: resolved_path,
            relative_path: options.relative_path,
            text,
            hash_sha256: hash,
        },
        mdast_json: JSON.stringify(mdast),
        ws_root: options.workspace_root || '',
    });

    return { id, path: resolved_path };
}
