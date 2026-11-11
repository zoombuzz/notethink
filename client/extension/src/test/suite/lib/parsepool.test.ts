import * as assert from 'assert';
import * as vscode from 'vscode';
import { ParsePool } from '../../../vscode/ParsePool';

const EXTENSION_ID = 'NoteThink.notethink';

suite('ParsePool in the web extension host', () => {
    test('parses through a real worker built from the extension bundle, not the inline fallback', async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, 'extension is installed in the test host');
        const worker_url = vscode.Uri.joinPath(extension.extensionUri, 'client/extension/dist/parseWorker.js').toString();
        let spawned = 0;
        let answered = 0;
        let crashed = 0;
        const pool = new ParsePool({ extensionUri: extension.extensionUri } as vscode.ExtensionContext, () => {
            spawned++;
            const worker = new Worker(worker_url);
            worker.addEventListener('message', () => { answered++; });
            worker.addEventListener('error', () => { crashed++; });
            return worker;
        }, 2);
        try {
            const roots = await Promise.all([pool.parse('/a.md', '# A\n\ntext'), pool.parse('/b.md', '- one\n- two\n')]);
            assert.deepStrictEqual(roots.map((root) => root.type), ['root', 'root']);
            assert.strictEqual(roots[0].children[0].type, 'heading');
            assert.ok(spawned >= 1, 'a worker was constructed');
            assert.strictEqual(answered, 2, 'a real worker answered each parse');
            assert.strictEqual(crashed, 0, 'no worker crashed into the inline fallback');
        } finally {
            pool.dispose();
        }
    });
});
