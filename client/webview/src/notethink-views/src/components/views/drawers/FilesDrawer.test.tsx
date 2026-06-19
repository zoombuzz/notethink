import React from 'react';
import { render, screen, fireEvent, act, type RenderResult } from '@testing-library/react';
import FilesDrawer from './FilesDrawer';

// library-side test fixture: a realistic exclude glob to feed the drawer prop. intentionally not coupled to the app's DEFAULT_EXCLUDE_FILTER (extension/webview own those) - this test exercises FilesDrawer rendering, not the app default
const DERIVED_DIR_EXCLUDE = '**/{node_modules,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage}/**';

const default_props = {
    include: '**/*.md',
    exclude: DERIVED_DIR_EXCLUDE,
    maxNotesPerFile: 10,
    fileCount: 3,
    noteCount: 42,
    files: ['docs/a.md', 'docs/users/alex/todo.md', 'node_modules/pkg/readme.md'],
    onApplyFilters: jest.fn(),
};

function renderDrawer(overrides: Partial<typeof default_props> = {}): RenderResult & { props: typeof default_props } {
    const props = { ...default_props, ...overrides };
    return { props, ...render(<FilesDrawer {...props} />) };
}

describe('FilesDrawer', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it('seeds the include/exclude/max-notes inputs from props and shows the count', () => {
        renderDrawer();
        expect(screen.getByTestId('files-drawer-include')).toHaveValue('**/*.md');
        expect(screen.getByTestId('files-drawer-exclude')).toHaveValue(DERIVED_DIR_EXCLUDE);
        expect(screen.getByTestId('files-drawer-max-notes')).toHaveValue(10);
        expect(screen.getByTestId('files-drawer-count')).toHaveTextContent('42 in 3 files');
    });

    it('seeds the max-notes input from the prop value', () => {
        renderDrawer({ maxNotesPerFile: 25 });
        expect(screen.getByTestId('files-drawer-max-notes')).toHaveValue(25);
    });

    it('lists only files selected by the current filters (derived dir excluded)', () => {
        renderDrawer();
        const list = screen.getByTestId('files-drawer-list');
        expect(list).toHaveTextContent('docs/a.md');
        expect(list).toHaveTextContent('docs/users/alex/todo.md');
        expect(list).not.toHaveTextContent('node_modules/pkg/readme.md');
    });

    it('debounces: list re-filters and onApplyFilters fires only after the delay', () => {
        const { props } = renderDrawer();
        fireEvent.change(screen.getByTestId('files-drawer-include'), { target: { value: '**/users/**' } });
        // before the debounce elapses: nothing applied, list unchanged
        expect(props.onApplyFilters).not.toHaveBeenCalled();
        expect(screen.getByTestId('files-drawer-list')).toHaveTextContent('docs/a.md');

        act(() => { jest.advanceTimersByTime(200); });

        // after the debounce: list re-filtered client-side and the apply callback fired once
        const list = screen.getByTestId('files-drawer-list');
        expect(list).not.toHaveTextContent('docs/a.md');
        expect(list).toHaveTextContent('docs/users/alex/todo.md');
        expect(props.onApplyFilters).toHaveBeenCalledTimes(1);
        expect(props.onApplyFilters).toHaveBeenCalledWith('**/users/**', DERIVED_DIR_EXCLUDE, 10);
    });

    it('clearing the exclude box surfaces the derived-dir files after the debounce', () => {
        const { props } = renderDrawer();
        fireEvent.change(screen.getByTestId('files-drawer-exclude'), { target: { value: '' } });
        act(() => { jest.advanceTimersByTime(200); });
        expect(screen.getByTestId('files-drawer-list')).toHaveTextContent('node_modules/pkg/readme.md');
        expect(props.onApplyFilters).toHaveBeenCalledWith('**/*.md', '', 10);
    });

    it('coalesces rapid keystrokes into a single apply', () => {
        const { props } = renderDrawer();
        const input = screen.getByTestId('files-drawer-include');
        fireEvent.change(input, { target: { value: '**/a' } });
        act(() => { jest.advanceTimersByTime(100); });
        fireEvent.change(input, { target: { value: '**/users/**' } });
        act(() => { jest.advanceTimersByTime(200); });
        expect(props.onApplyFilters).toHaveBeenCalledTimes(1);
        expect(props.onApplyFilters).toHaveBeenCalledWith('**/users/**', DERIVED_DIR_EXCLUDE, 10);
    });

    it('resyncs the inputs when the effective globs/cap change underneath it', () => {
        const { rerender } = renderDrawer();
        rerender(<FilesDrawer {...default_props} include="**/notes/**" exclude="" maxNotesPerFile={5} />);
        expect(screen.getByTestId('files-drawer-include')).toHaveValue('**/notes/**');
        expect(screen.getByTestId('files-drawer-exclude')).toHaveValue('');
        expect(screen.getByTestId('files-drawer-max-notes')).toHaveValue(5);
    });

    it('debounces a max-notes change and applies the clamped integer', () => {
        const { props } = renderDrawer();
        fireEvent.change(screen.getByTestId('files-drawer-max-notes'), { target: { value: '3' } });
        expect(props.onApplyFilters).not.toHaveBeenCalled();
        act(() => { jest.advanceTimersByTime(200); });
        expect(props.onApplyFilters).toHaveBeenCalledTimes(1);
        expect(props.onApplyFilters).toHaveBeenCalledWith('**/*.md', DERIVED_DIR_EXCLUDE, 3);
    });

    it('clamps a max-notes value below the floor to 1', () => {
        const { props } = renderDrawer();
        fireEvent.change(screen.getByTestId('files-drawer-max-notes'), { target: { value: '0' } });
        act(() => { jest.advanceTimersByTime(200); });
        expect(props.onApplyFilters).toHaveBeenCalledWith('**/*.md', DERIVED_DIR_EXCLUDE, 1);
    });

    it('an empty/NaN max-notes box falls back to the current value, not 0', () => {
        const { props } = renderDrawer({ maxNotesPerFile: 8 });
        fireEvent.change(screen.getByTestId('files-drawer-max-notes'), { target: { value: '' } });
        act(() => { jest.advanceTimersByTime(200); });
        expect(props.onApplyFilters).toHaveBeenCalledWith('**/*.md', DERIVED_DIR_EXCLUDE, 8);
    });

    it('shows the empty-state when no files match', () => {
        renderDrawer({ include: '**/*.nope' });
        expect(screen.getByTestId('files-drawer-list')).toHaveTextContent('No files match the current filters');
    });

    it('clicking a file row calls onFileClick with the workspace-absolutized path', () => {
        const onFileClick = jest.fn();
        renderDrawer({ onFileClick, workspaceRoot: '/ws' });
        const rows = screen.getAllByTestId('files-drawer-file');
        const relative_row = rows.find(r => r.textContent === 'docs/a.md');
        fireEvent.click(relative_row as HTMLElement);
        expect(onFileClick).toHaveBeenCalledTimes(1);
        expect(onFileClick).toHaveBeenCalledWith('/ws/docs/a.md');
    });

    it('passes an already-absolute file path through unchanged', () => {
        const onFileClick = jest.fn();
        renderDrawer({ onFileClick, workspaceRoot: '/ws', files: ['/abs/docs/a.md'] });
        const rows = screen.getAllByTestId('files-drawer-file');
        fireEvent.click(rows[0]);
        expect(onFileClick).toHaveBeenCalledTimes(1);
        expect(onFileClick).toHaveBeenCalledWith('/abs/docs/a.md');
    });
});
