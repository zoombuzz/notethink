import type { Page } from '@playwright/test';
import * as crypto from 'node:crypto';
import { fixtureText } from './fixtures';
import { parse } from './parse-markdown';

/**
 * - omit_content: drop `content` (mdast) from the injected doc, modelling a folder-mode doc as the
 *   extension ships it, so the webview must parse `text` itself
 */
interface InjectOptions {
    workspace_root?: string;
    relative_path?: string;
    omit_content?: boolean;
}

interface FixtureDoc {
    doc: { id: string; path: string; relative_path: string | undefined; text: string; hash_sha256: string };
    mdast_json: string | undefined;
    workspace_root: string;
}

// reads a fixture and parses its markdown server-side into the wire-format doc the extension would post
function readFixtureDoc(fixture_name: string, doc_path?: string, workspace_root_or_options?: string | InjectOptions): FixtureDoc {
    const text = fixtureText(fixture_name);
    const resolved_path = doc_path || `/workspace/${fixture_name}`;
    const id = crypto.createHash('sha256').update(resolved_path).digest('hex').slice(0, 16);
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
    const options: InjectOptions = typeof workspace_root_or_options === 'string'
        ? { workspace_root: workspace_root_or_options }
        : (workspace_root_or_options || {});
    // omit_content models a post-diet folder doc: the webview's worker/fallback parse has to fill `content` in
    const mdast_json = options.omit_content ? undefined : JSON.stringify(parse(text));
    return {
        doc: { id, path: resolved_path, relative_path: options.relative_path, text, hash_sha256: hash },
        mdast_json,
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
                            ...(mdast_json === undefined ? {} : { content: JSON.parse(mdast_json) }),
                        },
                    },
                },
                workspace_root: ws_root,
            },
        }));
    }, { doc, mdast_json, ws_root: workspace_root });
    return { id: doc.id, path: doc.path };
}

// delivers a doc via activeEditorDoc without merging into docs, modeling an editor outside the folder scope
export async function injectActiveEditorDocFromFixture(page: Page, fixture_name: string, doc_path?: string, workspace_root_or_options?: string | InjectOptions): Promise<{ id: string; path: string }> {
    // the active-editor channel always carries full content, unaffected by the diet, so this never passes omit_content
    const { doc, mdast_json } = readFixtureDoc(fixture_name, doc_path, workspace_root_or_options);
    await page.evaluate(({ doc, mdast_json }) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'activeEditorDoc',
                doc: {
                    ...doc,
                    content: JSON.parse(mdast_json!),
                },
            },
        }));
    }, { doc, mdast_json: mdast_json! });
    return { id: doc.id, path: doc.path };
}
