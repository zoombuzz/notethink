import * as vscode from 'vscode';
import { chooseTargetColumn, type TargetColumnGroup } from './chooseTargetColumn';

describe('chooseTargetColumn', () => {
	describe('chooseTargetColumn()', () => {
		it('spawns a group beside the viewer when it is the only group open and alone_mode is beside', () => {
			const groups: TargetColumnGroup[] = [{ view_column: vscode.ViewColumn.One, doc_paths: [] }];
			expect(chooseTargetColumn(vscode.ViewColumn.One, groups, undefined, 'beside')).toBe(vscode.ViewColumn.Beside);
		});

		it('leaves the click unhandled when the viewer is alone and alone_mode is none', () => {
			const groups: TargetColumnGroup[] = [{ view_column: vscode.ViewColumn.One, doc_paths: [] }];
			expect(chooseTargetColumn(vscode.ViewColumn.One, groups, undefined, 'none')).toBeUndefined();
		});

		it('reuses the one other group even when it currently holds focus', () => {
			const groups: TargetColumnGroup[] = [
				{ view_column: vscode.ViewColumn.Two, doc_paths: [] },
				{ view_column: vscode.ViewColumn.One, doc_paths: [] },
			];
			expect(chooseTargetColumn(vscode.ViewColumn.One, groups, undefined, 'none')).toBe(vscode.ViewColumn.Two);
		});

		it('picks the first group besides the viewer when two others are open', () => {
			const groups: TargetColumnGroup[] = [
				{ view_column: vscode.ViewColumn.One, doc_paths: [] },
				{ view_column: vscode.ViewColumn.Two, doc_paths: [] },
				{ view_column: vscode.ViewColumn.Three, doc_paths: [] },
			];
			expect(chooseTargetColumn(vscode.ViewColumn.One, groups, undefined, 'beside')).toBe(vscode.ViewColumn.Two);
		});

		it('reuses the group already showing the target document over any other rule', () => {
			const groups: TargetColumnGroup[] = [
				{ view_column: vscode.ViewColumn.One, doc_paths: [] },
				{ view_column: vscode.ViewColumn.Two, doc_paths: ['/ws/other.md'] },
				{ view_column: vscode.ViewColumn.Three, doc_paths: ['/ws/note.md'] },
			];
			expect(chooseTargetColumn(vscode.ViewColumn.One, groups, '/ws/note.md', 'beside')).toBe(vscode.ViewColumn.Three);
		});

		it('falls through to the other-group rule when the target document is not open anywhere', () => {
			const groups: TargetColumnGroup[] = [
				{ view_column: vscode.ViewColumn.One, doc_paths: [] },
				{ view_column: vscode.ViewColumn.Two, doc_paths: ['/ws/other.md'] },
			];
			expect(chooseTargetColumn(vscode.ViewColumn.One, groups, '/ws/note.md', 'beside')).toBe(vscode.ViewColumn.Two);
		});
	});
});
