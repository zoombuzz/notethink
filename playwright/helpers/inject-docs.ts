import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { parse } from './parse-markdown';

interface InjectOptions {
    workspace_root?: string;
    relative_path?: string;
}

interface FixtureDoc {
    doc: { id: string; path: string; relative_path: string | undefined; text: string; hash_sha256: string };
    mdast_json: string;
    workspace_root: string;
}

// read a fixture file and parse its markdown server-side (same mdast libraries as the extension) into the wire-format doc the extension would post
function readFixtureDoc(fixture_name: string, doc_path?: string, workspace_root_or_options?: string | InjectOptions): FixtureDoc {
    const fixture_path = path.join(__dirname, '..', 'fixtures', fixture_name);
    const text = fs.readFileSync(fixture_path, 'utf-8');
    const resolved_path = doc_path || `/workspace/${fixture_name}`;
    const id = crypto.createHash('sha256').update(resolved_path).digest('hex').slice(0, 16);
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
    const mdast = parse(text);
    const options: InjectOptions = typeof workspace_root_or_options === 'string'
        ? { workspace_root: workspace_root_or_options }
        : (workspace_root_or_options || {});
    return {
        doc: { id, path: resolved_path, relative_path: options.relative_path, text, hash_sha256: hash },
        mdast_json: JSON.stringify(mdast),
        workspace_root: options.workspace_root || '',
    };
}

export async function injectDocsFromFixture(page: Page, fixture_name: string, doc_path?: string, workspace_root_or_options?: string | InjectOptions): Promise<{ id: string; path: string }> {
    const { doc, mdast_json, workspace_root } = readFixtureDoc(fixture_name, doc_path, workspace_root_or_options);
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
    }, { doc, mdast_json, ws_root: workspace_root });
    return { id: doc.id, path: doc.path };
}

// deliver a doc on the dedicated activeEditorDoc channel WITHOUT merging it into the docs aggregate - this models the extension's behaviour when the active editor sits outside the current folder scope (sendDoc drops it from the merged view but surfaces it here so useAutoIntegration can follow the editor out of the folder)
export async function injectActiveEditorDocFromFixture(page: Page, fixture_name: string, doc_path?: string, workspace_root_or_options?: string | InjectOptions): Promise<{ id: string; path: string }> {
    const { doc, mdast_json } = readFixtureDoc(fixture_name, doc_path, workspace_root_or_options);
    await page.evaluate(({ doc, mdast_json }) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'activeEditorDoc',
                doc: {
                    ...doc,
                    content: JSON.parse(mdast_json),
                },
            },
        }));
    }, { doc, mdast_json });
    return { id: doc.id, path: doc.path };
}
