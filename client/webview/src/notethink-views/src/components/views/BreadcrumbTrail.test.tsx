import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BreadcrumbTrail from './BreadcrumbTrail';
import { PendingWorkProvider } from '../../hooks/PendingWorkContext';
import type { UsePendingWorkApi } from '../../hooks/usePendingWork';
import type { NoteProps } from '../../types/NoteProps';

// mock renderops to avoid ESM dependencies in test
jest.mock('../../lib/renderops', () => ({
    renderMarkdownNoteHeadline: (note: NoteProps, options?: { output_type?: string }) => {
        return <span>{note.headline_raw}</span>;
    },
}));

function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 0,
        level: 1,
        children_body: [],
        children: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
        },
        headline_raw: '# Root',
        body_raw: '',
        ...overrides,
    };
}

describe('BreadcrumbTrail', () => {

    it('renders without parent notes', () => {
        const { container } = render(<BreadcrumbTrail {...makeNote()} />);
        const trail = container.querySelector('[class*="breadcrumbTrail"]');
        expect(trail).toBeInTheDocument();
    });

    it('renders breadcrumb items for each parent note', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const parent2 = makeNote({ seq: 1, headline_raw: '## Section' });
        const current = makeNote({
            seq: 2,
            headline_raw: '### Item',
            parent_notes: [parent1, parent2],
        });
        render(<BreadcrumbTrail {...current} />);
        expect(screen.getByText('# Doc')).toBeInTheDocument();
        expect(screen.getByText('## Section')).toBeInTheDocument();
    });

    it('renders separator between breadcrumb items', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const parent2 = makeNote({ seq: 1, headline_raw: '## Section' });
        const current = makeNote({
            seq: 2,
            parent_notes: [parent1, parent2],
        });
        const { container } = render(<BreadcrumbTrail {...current} />);
        const separators = container.querySelectorAll('[class*="breadcrumbSeparator"]');
        expect(separators).toHaveLength(1);
    });

    it('calls setParentContextSeq when a breadcrumb is clicked', () => {
        const set_parent_context_seq = jest.fn();
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const parent2 = makeNote({ seq: 5, headline_raw: '## Section' });
        const current = makeNote({
            seq: 10,
            parent_notes: [parent1, parent2],
            handlers: {
                setParentContextSeq: set_parent_context_seq,
            },
        });
        render(<BreadcrumbTrail {...current} />);
        fireEvent.click(screen.getByText('# Doc'));
        expect(set_parent_context_seq).toHaveBeenCalledWith(0);
    });

    it('calls setParentContextSeq with correct seq for non-first breadcrumb', () => {
        const set_parent_context_seq = jest.fn();
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const parent2 = makeNote({ seq: 5, headline_raw: '## Section' });
        const current = makeNote({
            seq: 10,
            parent_notes: [parent1, parent2],
            handlers: {
                setParentContextSeq: set_parent_context_seq,
            },
        });
        render(<BreadcrumbTrail {...current} />);
        fireEvent.click(screen.getByText('## Section'));
        expect(set_parent_context_seq).toHaveBeenCalledWith(5);
    });

    it('does not render separator before first item', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Only' });
        const current = makeNote({
            seq: 1,
            parent_notes: [parent1],
        });
        const { container } = render(<BreadcrumbTrail {...current} />);
        const separators = container.querySelectorAll('[class*="breadcrumbSeparator"]');
        expect(separators).toHaveLength(0);
    });

    it('renders breadcrumb items as button elements', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const parent2 = makeNote({ seq: 1, headline_raw: '## Section' });
        const current = makeNote({
            seq: 2,
            parent_notes: [parent1, parent2],
        });
        const { container } = render(<BreadcrumbTrail {...current} />);
        const buttons = container.querySelectorAll('button');
        expect(buttons).toHaveLength(2);
    });

    it('renders breadcrumb buttons with aria-label attributes stripped of markdown', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const parent2 = makeNote({ seq: 1, headline_raw: '## Section' });
        const current = makeNote({
            seq: 2,
            parent_notes: [parent1, parent2],
        });
        render(<BreadcrumbTrail {...current} />);
        expect(screen.getByRole('button', { name: 'Doc' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Section' })).toBeInTheDocument();
    });

    it('renders breadcrumb container with role="navigation"', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const current = makeNote({
            seq: 1,
            parent_notes: [parent1],
        });
        render(<BreadcrumbTrail {...current} />);
        const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
        expect(nav).toBeInTheDocument();
    });

    it('renders file path segments when doc_path is provided', () => {
        const current = makeNote({ seq: 0 });
        render(<BreadcrumbTrail {...current} doc_path="/workspace/docs/todo.md" />);
        expect(screen.getByText('workspace')).toBeInTheDocument();
        expect(screen.getByText('docs')).toBeInTheDocument();
        expect(screen.getByText('todo.md')).toBeInTheDocument();
    });

    it('renders file path segments before note breadcrumbs', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const current = makeNote({
            seq: 1,
            parent_notes: [parent1],
        });
        const { container } = render(<BreadcrumbTrail {...current} doc_path="/docs/todo.md" />);
        const items = container.querySelectorAll('[class*="breadcrumbItem"]');
        // 2 path segments + 1 note breadcrumb
        expect(items).toHaveLength(3);
        expect(items[0]).toHaveTextContent('docs');
        expect(items[1]).toHaveTextContent('todo.md');
        expect(items[2]).toHaveTextContent('# Doc');
    });

    it('uses chevron separator between all breadcrumb segments', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const current = makeNote({
            seq: 1,
            parent_notes: [parent1],
        });
        const { container } = render(<BreadcrumbTrail {...current} doc_path="/docs/todo.md" />);
        const separators = container.querySelectorAll('[class*="breadcrumbSeparator"]');
        // 1 between path segments + 1 between path and notes
        expect(separators).toHaveLength(2);
        expect(separators[0].textContent).toBe('›');
        expect(separators[1].textContent).toBe('›');
    });

    it('renders path segments with data-path attribute', () => {
        const current = makeNote({ seq: 0 });
        const { container } = render(<BreadcrumbTrail {...current} doc_path="/workspace/docs/todo.md" />);
        const path_items = container.querySelectorAll('[data-path]');
        expect(path_items).toHaveLength(3);
        expect(path_items[0]).toHaveAttribute('data-path', '/workspace');
        expect(path_items[1]).toHaveAttribute('data-path', '/workspace/docs');
        expect(path_items[2]).toHaveAttribute('data-path', '/workspace/docs/todo.md');
    });

    it('renders path segments as clickable buttons', () => {
        const current = makeNote({ seq: 0 });
        const { container } = render(<BreadcrumbTrail {...current} doc_path="/docs/todo.md" />);
        const path_buttons = container.querySelectorAll('button[data-path]');
        expect(path_buttons).toHaveLength(2);
    });

    it('calls onFolderClick with segment path when a path segment is clicked', () => {
        const on_folder_click = jest.fn();
        const current = makeNote({ seq: 0 });
        render(<BreadcrumbTrail {...current} doc_path="/workspace/docs/todo.md" onFolderClick={on_folder_click} />);
        fireEvent.click(screen.getByText('docs'));
        expect(on_folder_click).toHaveBeenCalledWith('/workspace/docs');
    });

    it('keeps the opened workspace folder as the first clickable segment', () => {
        const current = makeNote({ seq: 0 });
        render(<BreadcrumbTrail {...current} doc_path="/home/user/workspace/project/docs/todo.md" workspace_root="/home/user/workspace" />);
        // path above the opened workspace folder stays hidden
        expect(screen.queryByText('home')).not.toBeInTheDocument();
        expect(screen.queryByText('user')).not.toBeInTheDocument();
        // the opened workspace folder itself is now the first segment
        expect(screen.getByText('workspace')).toBeInTheDocument();
        expect(screen.getByText('project')).toBeInTheDocument();
        expect(screen.getByText('docs')).toBeInTheDocument();
        expect(screen.getByText('todo.md')).toBeInTheDocument();
    });

    it('keeps the realistic workspace root (active_development) as the first segment', () => {
        const current = makeNote({ seq: 0 });
        const workspace_root = '/mnt/secure/home/alex/git/github.com/active_development';
        const doc_path = workspace_root + '/countingsheet/nodejs/ledger/docs/todo.md';
        render(<BreadcrumbTrail {...current} doc_path={doc_path} workspace_root={workspace_root} />);
        // everything ABOVE the opened folder stays hidden
        expect(screen.queryByText('mnt')).not.toBeInTheDocument();
        expect(screen.queryByText('secure')).not.toBeInTheDocument();
        expect(screen.queryByText('home')).not.toBeInTheDocument();
        expect(screen.queryByText('alex')).not.toBeInTheDocument();
        expect(screen.queryByText('git')).not.toBeInTheDocument();
        expect(screen.queryByText('github.com')).not.toBeInTheDocument();
        // the opened folder itself is the first segment, project sits below it
        expect(screen.getByText('active_development')).toBeInTheDocument();
        expect(screen.getByText('countingsheet')).toBeInTheDocument();
        expect(screen.getByText('nodejs')).toBeInTheDocument();
        expect(screen.getByText('todo.md')).toBeInTheDocument();
    });

    it('first data-path segment is the workspace root itself', () => {
        const current = makeNote({ seq: 0 });
        const { container } = render(<BreadcrumbTrail {...current} doc_path="/home/user/workspace/project/docs/todo.md" workspace_root="/home/user/workspace" />);
        const path_items = container.querySelectorAll('[data-path]');
        expect(path_items).toHaveLength(4);
        expect(path_items[0]).toHaveAttribute('data-path', '/home/user/workspace');
        expect(path_items[1]).toHaveAttribute('data-path', '/home/user/workspace/project');
        expect(path_items[2]).toHaveAttribute('data-path', '/home/user/workspace/project/docs');
        expect(path_items[3]).toHaveAttribute('data-path', '/home/user/workspace/project/docs/todo.md');
    });

    it('preserves full paths in data-path with realistic workspace root', () => {
        const current = makeNote({ seq: 0 });
        const workspace_root = '/mnt/secure/home/alex/git/github.com/active_development';
        const doc_path = workspace_root + '/notethink/docstech/users/alex.stanhope/todo.md';
        const { container } = render(<BreadcrumbTrail {...current} doc_path={doc_path} workspace_root={workspace_root} />);
        const path_items = container.querySelectorAll('[data-path]');
        expect(path_items).toHaveLength(6);
        expect(path_items[0]).toHaveAttribute('data-path', workspace_root);
        expect(path_items[1]).toHaveAttribute('data-path', workspace_root + '/notethink');
        expect(path_items[2]).toHaveAttribute('data-path', workspace_root + '/notethink/docstech');
        expect(path_items[3]).toHaveAttribute('data-path', workspace_root + '/notethink/docstech/users');
        expect(path_items[4]).toHaveAttribute('data-path', workspace_root + '/notethink/docstech/users/alex.stanhope');
        expect(path_items[5]).toHaveAttribute('data-path', workspace_root + '/notethink/docstech/users/alex.stanhope/todo.md');
    });

    it('calls onLeafClick (not onFolderClick) when the terminal segment is clicked', () => {
        const on_folder_click = jest.fn();
        const on_leaf_click = jest.fn();
        const current = makeNote({ seq: 0 });
        render(<BreadcrumbTrail {...current} doc_path="/workspace/docs/todo.md" onFolderClick={on_folder_click} onLeafClick={on_leaf_click} />);
        const leaf = screen.getByTestId('breadcrumb-leaf');
        leaf.click();
        expect(on_leaf_click).toHaveBeenCalledTimes(1);
        expect(on_leaf_click.mock.calls[0][0]).toBe('/workspace/docs/todo.md');
        expect(on_leaf_click.mock.calls[0][1]).toBe(leaf);
        expect(on_folder_click).not.toHaveBeenCalled();
    });

    it('still calls onFolderClick for a non-terminal segment while the leaf calls onLeafClick', () => {
        const on_folder_click = jest.fn();
        const on_leaf_click = jest.fn();
        const current = makeNote({ seq: 0 });
        render(<BreadcrumbTrail {...current} doc_path="/workspace/docs/todo.md" onFolderClick={on_folder_click} onLeafClick={on_leaf_click} />);
        // 'docs' is a non-terminal segment, 'todo.md' is the terminal leaf
        fireEvent.click(screen.getByText('docs'));
        expect(on_folder_click).toHaveBeenCalledWith('/workspace/docs');
        expect(on_leaf_click).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('todo.md'));
        expect(on_leaf_click).toHaveBeenCalledTimes(1);
        expect(on_leaf_click.mock.calls[0][0]).toBe('/workspace/docs/todo.md');
    });

    it('renders the terminal segment with the jump-leaf testid and aria-haspopup', () => {
        const current = makeNote({ seq: 0 });
        render(<BreadcrumbTrail {...current} doc_path="/workspace/docs/todo.md" />);
        const leaf = screen.getByTestId('breadcrumb-leaf');
        expect(leaf).toHaveTextContent('todo.md');
        expect(leaf).toHaveAttribute('aria-haspopup', 'menu');
        expect(leaf).toHaveAttribute('data-path', '/workspace/docs/todo.md');
    });

    it('calls onFolderClick with full path when workspace_root is set', () => {
        const on_folder_click = jest.fn();
        const current = makeNote({ seq: 0 });
        render(<BreadcrumbTrail {...current} doc_path="/home/user/workspace/project/docs/todo.md" workspace_root="/home/user/workspace" onFolderClick={on_folder_click} />);
        fireEvent.click(screen.getByText('docs'));
        expect(on_folder_click).toHaveBeenCalledWith('/home/user/workspace/project/docs');
    });

    it('uses doc_relative_path when provided (handles symlinks)', () => {
        const current = makeNote({ seq: 0 });
        // Simulate: workspace opened via symlink /home/alex/github.com/active_development
        // but doc path resolves via /mnt/secure/home/alex/git/github.com/active_development
        // The extension computes relative_path via asRelativePath which handles this correctly
        render(<BreadcrumbTrail {...current}
            doc_path="/mnt/secure/home/alex/git/github.com/active_development/countingsheet/docs/todo.md"
            doc_relative_path="countingsheet/docs/todo.md"
        />);
        // absolute prefix above the opened folder stays hidden
        expect(screen.queryByText('mnt')).not.toBeInTheDocument();
        expect(screen.queryByText('secure')).not.toBeInTheDocument();
        // the opened folder is derived from doc_path minus the relative suffix
        expect(screen.getByText('active_development')).toBeInTheDocument();
        expect(screen.getByText('countingsheet')).toBeInTheDocument();
        expect(screen.getByText('docs')).toBeInTheDocument();
        expect(screen.getByText('todo.md')).toBeInTheDocument();
    });

    it('data-path attributes use full paths when doc_relative_path is provided', () => {
        const current = makeNote({ seq: 0 });
        const { container } = render(<BreadcrumbTrail {...current}
            doc_path="/mnt/secure/home/alex/git/github.com/active_development/countingsheet/docs/todo.md"
            doc_relative_path="countingsheet/docs/todo.md"
        />);
        const path_items = container.querySelectorAll('[data-path]');
        expect(path_items).toHaveLength(4);
        // first segment is the opened folder, then full paths reconstructed from doc_path minus relative suffix
        expect(path_items[0]).toHaveAttribute('data-path', '/mnt/secure/home/alex/git/github.com/active_development');
        expect(path_items[1]).toHaveAttribute('data-path', '/mnt/secure/home/alex/git/github.com/active_development/countingsheet');
        expect(path_items[2]).toHaveAttribute('data-path', '/mnt/secure/home/alex/git/github.com/active_development/countingsheet/docs');
        expect(path_items[3]).toHaveAttribute('data-path', '/mnt/secure/home/alex/git/github.com/active_development/countingsheet/docs/todo.md');
    });

    it('doc_relative_path takes precedence over workspace_root', () => {
        const current = makeNote({ seq: 0 });
        // Even with mismatched workspace_root (symlink), doc_relative_path wins
        render(<BreadcrumbTrail {...current}
            doc_path="/mnt/secure/home/alex/git/github.com/active_development/notethink/README.md"
            doc_relative_path="notethink/README.md"
            workspace_root="/home/alex/github.com/active_development"
        />);
        expect(screen.queryByText('mnt')).not.toBeInTheDocument();
        expect(screen.getByText('notethink')).toBeInTheDocument();
        expect(screen.getByText('README.md')).toBeInTheDocument();
    });

    it('shows all path segments when workspace_root is empty string', () => {
        const current = makeNote({ seq: 0 });
        render(<BreadcrumbTrail {...current} doc_path="/mnt/secure/home/file.md" workspace_root="" />);
        expect(screen.getByText('mnt')).toBeInTheDocument();
        expect(screen.getByText('secure')).toBeInTheDocument();
        expect(screen.getByText('home')).toBeInTheDocument();
        expect(screen.getByText('file.md')).toBeInTheDocument();
    });

    it('shows all path segments when workspace_root is undefined', () => {
        const current = makeNote({ seq: 0 });
        render(<BreadcrumbTrail {...current} doc_path="/mnt/secure/home/file.md" workspace_root={undefined} />);
        expect(screen.getByText('mnt')).toBeInTheDocument();
        expect(screen.getByText('secure')).toBeInTheDocument();
    });

    describe('folder mode integration_path', () => {

        it('keeps the opened workspace folder as the first segment', () => {
            const current = makeNote({ seq: 0 });
            const workspace_root = '/home/alex/github.com/active_development';
            render(<BreadcrumbTrail {...current}
                workspace_root={workspace_root}
                integration_path={workspace_root + '/calfam'}
            />);
            // one level up: active_development is now the root, calfam below it
            expect(screen.getByText('active_development')).toBeInTheDocument();
            expect(screen.getByText('calfam')).toBeInTheDocument();
            // nothing above the workspace folder leaks in
            expect(screen.queryByText('github.com')).not.toBeInTheDocument();
            expect(screen.queryByText('home')).not.toBeInTheDocument();
        });

        it('data-path on the workspace-folder segment is the workspace root itself', () => {
            const current = makeNote({ seq: 0 });
            const workspace_root = '/home/alex/github.com/active_development';
            const { container } = render(<BreadcrumbTrail {...current}
                workspace_root={workspace_root}
                integration_path={workspace_root + '/calfam'}
            />);
            const path_items = container.querySelectorAll('[data-path]');
            expect(path_items).toHaveLength(2);
            expect(path_items[0]).toHaveAttribute('data-path', workspace_root);
            expect(path_items[1]).toHaveAttribute('data-path', workspace_root + '/calfam');
        });

        it('clicking the workspace-folder segment re-discovers the whole opened folder', () => {
            const on_folder_click = jest.fn();
            const current = makeNote({ seq: 0 });
            const workspace_root = '/home/alex/github.com/active_development';
            render(<BreadcrumbTrail {...current}
                workspace_root={workspace_root}
                integration_path={workspace_root + '/calfam'}
                onFolderClick={on_folder_click}
            />);
            fireEvent.click(screen.getByText('active_development'));
            expect(on_folder_click).toHaveBeenCalledWith(workspace_root);
        });

        it('segments deeper subdirectories below the workspace folder', () => {
            const current = makeNote({ seq: 0 });
            const workspace_root = '/home/alex/github.com/active_development';
            const { container } = render(<BreadcrumbTrail {...current}
                workspace_root={workspace_root}
                integration_path={workspace_root + '/calfam/docstech'}
            />);
            const path_items = container.querySelectorAll('[data-path]');
            expect(path_items).toHaveLength(3);
            expect(path_items[0]).toHaveAttribute('data-path', workspace_root);
            expect(path_items[1]).toHaveAttribute('data-path', workspace_root + '/calfam');
            expect(path_items[2]).toHaveAttribute('data-path', workspace_root + '/calfam/docstech');
        });

        it('when integration_path is the workspace root, shows just the workspace folder', () => {
            const current = makeNote({ seq: 0 });
            const workspace_root = '/home/alex/github.com/active_development';
            const { container } = render(<BreadcrumbTrail {...current}
                workspace_root={workspace_root}
                integration_path={workspace_root}
            />);
            const path_items = container.querySelectorAll('[data-path]');
            expect(path_items).toHaveLength(1);
            expect(path_items[0]).toHaveAttribute('data-path', workspace_root);
            expect(screen.getByText('active_development')).toBeInTheDocument();
        });

        it('falls back to absolute segments when integration_path is outside workspace_root', () => {
            const current = makeNote({ seq: 0 });
            const { container } = render(<BreadcrumbTrail {...current}
                workspace_root="/home/alex/github.com/active_development"
                integration_path="/tmp/elsewhere/notes"
            />);
            const path_items = container.querySelectorAll('[data-path]');
            expect(path_items).toHaveLength(3);
            expect(path_items[0]).toHaveAttribute('data-path', '/tmp');
            expect(path_items[2]).toHaveAttribute('data-path', '/tmp/elsewhere/notes');
        });

        it('shows "(X in Y files)" after the path in folder mode', () => {
            const current = makeNote({ seq: 0 });
            const workspace_root = '/home/alex/github.com/active_development';
            render(<BreadcrumbTrail {...current}
                workspace_root={workspace_root}
                integration_path={workspace_root + '/calfam'}
                file_count={17}
                note_count={214}
            />);
            expect(screen.getByText('(214 in 17 files)')).toBeInTheDocument();
        });

        it('shows "(X in Y of M files)" when the discovery cap truncated the set', () => {
            const current = makeNote({ seq: 0 });
            const workspace_root = '/home/alex/github.com/active_development';
            render(<BreadcrumbTrail {...current}
                workspace_root={workspace_root}
                integration_path={workspace_root}
                file_count={200}
                note_count={1800}
                aggregate_total_discovered={615}
            />);
            expect(screen.getByText('(1800 in 200 of 615 files)')).toBeInTheDocument();
        });

        it('shows the plain form when discovered total is not greater than loaded', () => {
            const current = makeNote({ seq: 0 });
            const workspace_root = '/home/alex/github.com/active_development';
            render(<BreadcrumbTrail {...current}
                workspace_root={workspace_root}
                integration_path={workspace_root + '/calfam'}
                file_count={17}
                note_count={214}
                aggregate_total_discovered={17}
            />);
            expect(screen.getByText('(214 in 17 files)')).toBeInTheDocument();
            expect(screen.queryByText(/of 17 files/)).not.toBeInTheDocument();
        });

        it('treats a missing note_count as 0', () => {
            const current = makeNote({ seq: 0 });
            const workspace_root = '/home/alex/github.com/active_development';
            render(<BreadcrumbTrail {...current}
                workspace_root={workspace_root}
                integration_path={workspace_root + '/calfam'}
                file_count={17}
            />);
            expect(screen.getByText('(0 in 17 files)')).toBeInTheDocument();
        });

        it('calls onFileCountClick with the count element when the count is clicked', () => {
            const current = makeNote({ seq: 0 });
            const workspace_root = '/home/alex/github.com/active_development';
            const onFileCountClick = jest.fn();
            render(<BreadcrumbTrail {...current}
                workspace_root={workspace_root}
                integration_path={workspace_root + '/calfam'}
                file_count={17}
                note_count={214}
                onFileCountClick={onFileCountClick}
            />);
            const count = screen.getByTestId('breadcrumb-file-count');
            count.click();
            expect(onFileCountClick).toHaveBeenCalledTimes(1);
            expect(onFileCountClick.mock.calls[0][0]).toBe(count);
        });

        it('does not render a count when file_count is undefined', () => {
            const current = makeNote({ seq: 0 });
            const workspace_root = '/home/alex/github.com/active_development';
            const { container } = render(<BreadcrumbTrail {...current}
                workspace_root={workspace_root}
                integration_path={workspace_root + '/calfam'}
            />);
            expect(container.textContent).not.toMatch(/\(\d/);
        });
    });

    it('does not show a file count in single-file mode even when file_count is passed', () => {
        const current = makeNote({ seq: 0 });
        const { container } = render(<BreadcrumbTrail {...current}
            doc_path="/home/user/workspace/project/docs/todo.md"
            workspace_root="/home/user/workspace"
            file_count={42}
        />);
        // single-file mode (no integration_path): the count is meaningless and omitted
        expect(screen.queryByText('(42)')).not.toBeInTheDocument();
        expect(container.textContent).not.toMatch(/\(\d/);
    });

    describe('pending-work spinner', () => {
        function withPending(pending: boolean, ui: React.ReactElement): React.ReactElement {
            const api: UsePendingWorkApi = {
                pending,
                markPending: jest.fn(),
                clearPending: jest.fn(),
                clearAll: jest.fn(),
            };
            return <PendingWorkProvider api={api}>{ui}</PendingWorkProvider>;
        }

        function folderModeTrail(): React.ReactElement {
            const workspace_root = '/home/alex/github.com/active_development';
            return <BreadcrumbTrail {...makeNote({ seq: 0 })}
                workspace_root={workspace_root}
                integration_path={workspace_root + '/calfam'}
                file_count={17}
                note_count={214}
            />;
        }

        it('renders the spinner when context reports pending=true', () => {
            render(withPending(true, folderModeTrail()));
            expect(screen.getByTestId('pending-work-spinner')).toBeInTheDocument();
        });

        it('does not render the spinner when context reports pending=false', () => {
            render(withPending(false, folderModeTrail()));
            expect(screen.queryByTestId('pending-work-spinner')).not.toBeInTheDocument();
        });

        it('does not render the spinner with no provider mounted', () => {
            render(folderModeTrail());
            expect(screen.queryByTestId('pending-work-spinner')).not.toBeInTheDocument();
        });

        it('places the spinner immediately to the right of the file count', () => {
            render(withPending(true, folderModeTrail()));
            const count = screen.getByTestId('breadcrumb-file-count');
            const spinner = screen.getByTestId('pending-work-spinner');
            // the spinner is the count button's immediate next sibling in the breadcrumb
            expect(count.nextElementSibling).toBe(spinner);
        });
    });

    describe('collision alert', () => {

        it('renders the alert when has_collisions is true', () => {
            render(<BreadcrumbTrail {...makeNote({ seq: 0 })} has_collisions={true} />);
            expect(screen.getByTestId('breadcrumb-collision-alert')).toBeInTheDocument();
        });

        it('does not render the alert when has_collisions is false', () => {
            render(<BreadcrumbTrail {...makeNote({ seq: 0 })} has_collisions={false} />);
            expect(screen.queryByTestId('breadcrumb-collision-alert')).not.toBeInTheDocument();
        });

        it('does not render the alert when has_collisions is undefined', () => {
            render(<BreadcrumbTrail {...makeNote({ seq: 0 })} />);
            expect(screen.queryByTestId('breadcrumb-collision-alert')).not.toBeInTheDocument();
        });

        it('calls onCollisionsClick with the alert element when clicked', () => {
            const onCollisionsClick = jest.fn();
            render(<BreadcrumbTrail {...makeNote({ seq: 0 })} has_collisions={true} onCollisionsClick={onCollisionsClick} />);
            const alert = screen.getByTestId('breadcrumb-collision-alert');
            alert.click();
            expect(onCollisionsClick).toHaveBeenCalledTimes(1);
            expect(onCollisionsClick.mock.calls[0][0]).toBe(alert);
        });
    });
});
