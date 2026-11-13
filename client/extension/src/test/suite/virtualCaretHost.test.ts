import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Host-side figures for the virtual caret prototype, measured in a real VS Code web host: what an edit
 * on a document no editor shows costs, whether VS Code's undo reaches it, and what saving after each
 * edit costs. Each measurement prints one VIRTUAL_CARET_MEASURE line; the asserts hold only what must
 * be true for the figures to mean anything. The scratch file lives in the test workspace's own
 * in-memory mount and is deleted afterwards.
 */

const SAMPLES = 20;
const SCRATCH_NAME = 'virtual-caret-host-scratch.md';

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const value = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
	return Math.round(value * 100) / 100;
}

function report(name: string, value: unknown): void {
	console.log(`VIRTUAL_CARET_MEASURE ${name} ${JSON.stringify(value)}`);
}

async function scratchUri(): Promise<vscode.Uri> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	assert.ok(folder, 'the test host opens a workspace folder');
	const uri = vscode.Uri.joinPath(folder.uri, SCRATCH_NAME);
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('# Scratch board\n\n## Plain title [](?status=doing)\n\nbody\n'));
	return uri;
}

async function typeAtTitleEnd(document: vscode.TextDocument, character: string): Promise<number> {
	const title_end = document.getText().indexOf(' [](?status');
	const edit = new vscode.WorkspaceEdit();
	edit.insert(document.uri, document.positionAt(title_end), character);
	const started = performance.now();
	const applied = await vscode.workspace.applyEdit(edit);
	assert.ok(applied, 'the edit applies');
	return performance.now() - started;
}

suite('Virtual caret host measurements', () => {

	test('an edit on a document no editor shows applies and leaves it dirty and unsaved', async () => {
		const uri = await scratchUri();
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			assert.ok(!vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === uri.toString()), 'no editor shows the scratch file');
			const times: number[] = [];
			for (let i = 0; i < SAMPLES; i += 1) { times.push(await typeAtTitleEnd(document, 'x')); }
			assert.strictEqual(document.getText().split('\n')[2], `## Plain title${'x'.repeat(SAMPLES)} [](?status=doing)`);
			assert.ok(document.isDirty, 'a WorkspaceEdit leaves the document dirty and unsaved');
			report('workspace_edit_no_editor_ms', { samples: SAMPLES, median: median(times), max: Math.round(Math.max(...times) * 100) / 100 });
		} finally {
			await vscode.workspace.fs.delete(uri).then(undefined, () => undefined);
		}
	});

	test('undo with no editor showing the document, then with one showing it', async () => {
		const uri = await scratchUri();
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			const original = document.getText();
			await typeAtTitleEnd(document, 'a');
			await typeAtTitleEnd(document, 'b');
			const edited = document.getText();
			// no active editor owns the document: the undo command has no target of its own
			await vscode.commands.executeCommand('undo');
			const after_undo_without_editor = document.getText();
			report('undo_without_editor', { text_unchanged_by_undo: after_undo_without_editor === edited, reverted_to_original: after_undo_without_editor === original });
			// once an editor shows it, the document's own undo stack is what undo acts on
			await vscode.window.showTextDocument(document);
			await vscode.commands.executeCommand('undo');
			const after_undo_with_editor = document.getText();
			report('undo_with_editor', { one_edit_undone: after_undo_with_editor !== edited && after_undo_with_editor !== original, reverted_to_original: after_undo_with_editor === original, still_dirty: document.isDirty });
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		} finally {
			await vscode.workspace.fs.delete(uri).then(undefined, () => undefined);
		}
	});

	test('saving after every relayed edit costs a save, and a clean document is not left dirty', async () => {
		const uri = await scratchUri();
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			const times: number[] = [];
			for (let i = 0; i < SAMPLES; i += 1) {
				await typeAtTitleEnd(document, 'y');
				const started = performance.now();
				const saved = await document.save();
				times.push(performance.now() - started);
				assert.ok(saved, 'the save succeeds');
				assert.ok(!document.isDirty, 'a save clears the dirty flag');
			}
			report('save_after_edit_ms', { samples: SAMPLES, median: median(times), max: Math.round(Math.max(...times) * 100) / 100, file_system: uri.scheme });
		} finally {
			await vscode.workspace.fs.delete(uri).then(undefined, () => undefined);
		}
	});
});
