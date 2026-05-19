import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import FilesDrawer from './FilesDrawer';

const DERIVED_DIR_EXCLUDE = '**/{node_modules,.git,.svn,.hg,.terraform,dist,build,out,.next,.cache,coverage}/**';

const default_props = {
    include: '**/*.md',
    exclude: DERIVED_DIR_EXCLUDE,
    fileCount: 3,
    noteCount: 42,
    files: ['docs/a.md', 'docs/users/alex/todo.md', 'node_modules/pkg/readme.md'],
    onApplyFilters: jest.fn(),
};

function renderDrawer(overrides: Partial<typeof default_props> = {}) {
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

    it('seeds the include/exclude inputs from props and shows the count', () => {
        renderDrawer();
        expect(screen.getByTestId('files-drawer-include')).toHaveValue('**/*.md');
        expect(screen.getByTestId('files-drawer-exclude')).toHaveValue(DERIVED_DIR_EXCLUDE);
        expect(screen.getByTestId('files-drawer-count')).toHaveTextContent('42 in 3 files');
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
        expect(props.onApplyFilters).toHaveBeenCalledWith('**/users/**', DERIVED_DIR_EXCLUDE);
    });

    it('clearing the exclude box surfaces the derived-dir files after the debounce', () => {
        const { props } = renderDrawer();
        fireEvent.change(screen.getByTestId('files-drawer-exclude'), { target: { value: '' } });
        act(() => { jest.advanceTimersByTime(200); });
        expect(screen.getByTestId('files-drawer-list')).toHaveTextContent('node_modules/pkg/readme.md');
        expect(props.onApplyFilters).toHaveBeenCalledWith('**/*.md', '');
    });

    it('coalesces rapid keystrokes into a single apply', () => {
        const { props } = renderDrawer();
        const input = screen.getByTestId('files-drawer-include');
        fireEvent.change(input, { target: { value: '**/a' } });
        act(() => { jest.advanceTimersByTime(100); });
        fireEvent.change(input, { target: { value: '**/users/**' } });
        act(() => { jest.advanceTimersByTime(200); });
        expect(props.onApplyFilters).toHaveBeenCalledTimes(1);
        expect(props.onApplyFilters).toHaveBeenCalledWith('**/users/**', DERIVED_DIR_EXCLUDE);
    });

    it('resyncs the inputs when the effective globs change underneath it', () => {
        const { rerender } = renderDrawer();
        rerender(<FilesDrawer {...default_props} include="**/notes/**" exclude="" />);
        expect(screen.getByTestId('files-drawer-include')).toHaveValue('**/notes/**');
        expect(screen.getByTestId('files-drawer-exclude')).toHaveValue('');
    });

    it('shows the empty-state when no files match', () => {
        renderDrawer({ include: '**/*.nope' });
        expect(screen.getByTestId('files-drawer-list')).toHaveTextContent('No files match the current filters');
    });
});
