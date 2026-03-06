import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BreadcrumbTrail from './BreadcrumbTrail';
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

    it('calls onDirectoryClick with segment path when a path segment is clicked', () => {
        const on_directory_click = jest.fn();
        const current = makeNote({ seq: 0 });
        render(<BreadcrumbTrail {...current} doc_path="/workspace/docs/todo.md" onDirectoryClick={on_directory_click} />);
        fireEvent.click(screen.getByText('docs'));
        expect(on_directory_click).toHaveBeenCalledWith('/workspace/docs');
    });

    it('strips workspace_root prefix from breadcrumb path segments', () => {
        const current = makeNote({ seq: 0 });
        render(<BreadcrumbTrail {...current} doc_path="/home/user/workspace/project/docs/todo.md" workspace_root="/home/user/workspace" />);
        // Should not show 'home', 'user', or 'workspace'
        expect(screen.queryByText('home')).not.toBeInTheDocument();
        expect(screen.queryByText('user')).not.toBeInTheDocument();
        expect(screen.queryByText('workspace')).not.toBeInTheDocument();
        // Should show segments below workspace root
        expect(screen.getByText('project')).toBeInTheDocument();
        expect(screen.getByText('docs')).toBeInTheDocument();
        expect(screen.getByText('todo.md')).toBeInTheDocument();
    });

    it('strips realistic workspace root (active_development) so first segment is the project', () => {
        const current = makeNote({ seq: 0 });
        const workspace_root = '/mnt/secure/home/alex/git/github.com/active_development';
        const doc_path = workspace_root + '/countingsheet/nodejs/ledger/docs/todo.md';
        render(<BreadcrumbTrail {...current} doc_path={doc_path} workspace_root={workspace_root} />);
        // Should NOT show any of the workspace root segments
        expect(screen.queryByText('mnt')).not.toBeInTheDocument();
        expect(screen.queryByText('secure')).not.toBeInTheDocument();
        expect(screen.queryByText('home')).not.toBeInTheDocument();
        expect(screen.queryByText('alex')).not.toBeInTheDocument();
        expect(screen.queryByText('git')).not.toBeInTheDocument();
        expect(screen.queryByText('github.com')).not.toBeInTheDocument();
        expect(screen.queryByText('active_development')).not.toBeInTheDocument();
        // First visible segment should be 'countingsheet'
        expect(screen.getByText('countingsheet')).toBeInTheDocument();
        expect(screen.getByText('nodejs')).toBeInTheDocument();
        expect(screen.getByText('todo.md')).toBeInTheDocument();
    });

    it('preserves full paths in data-path when workspace_root is set', () => {
        const current = makeNote({ seq: 0 });
        const { container } = render(<BreadcrumbTrail {...current} doc_path="/home/user/workspace/project/docs/todo.md" workspace_root="/home/user/workspace" />);
        const path_items = container.querySelectorAll('[data-path]');
        expect(path_items).toHaveLength(3);
        expect(path_items[0]).toHaveAttribute('data-path', '/home/user/workspace/project');
        expect(path_items[1]).toHaveAttribute('data-path', '/home/user/workspace/project/docs');
        expect(path_items[2]).toHaveAttribute('data-path', '/home/user/workspace/project/docs/todo.md');
    });

    it('preserves full paths in data-path with realistic workspace root', () => {
        const current = makeNote({ seq: 0 });
        const workspace_root = '/mnt/secure/home/alex/git/github.com/active_development';
        const doc_path = workspace_root + '/notethink/docstech/users/alex.stanhope/todo.md';
        const { container } = render(<BreadcrumbTrail {...current} doc_path={doc_path} workspace_root={workspace_root} />);
        const path_items = container.querySelectorAll('[data-path]');
        expect(path_items).toHaveLength(5);
        expect(path_items[0]).toHaveAttribute('data-path', workspace_root + '/notethink');
        expect(path_items[1]).toHaveAttribute('data-path', workspace_root + '/notethink/docstech');
        expect(path_items[2]).toHaveAttribute('data-path', workspace_root + '/notethink/docstech/users');
        expect(path_items[3]).toHaveAttribute('data-path', workspace_root + '/notethink/docstech/users/alex.stanhope');
        expect(path_items[4]).toHaveAttribute('data-path', workspace_root + '/notethink/docstech/users/alex.stanhope/todo.md');
    });

    it('calls onDirectoryClick with full path when workspace_root is set', () => {
        const on_directory_click = jest.fn();
        const current = makeNote({ seq: 0 });
        render(<BreadcrumbTrail {...current} doc_path="/home/user/workspace/project/docs/todo.md" workspace_root="/home/user/workspace" onDirectoryClick={on_directory_click} />);
        fireEvent.click(screen.getByText('docs'));
        expect(on_directory_click).toHaveBeenCalledWith('/home/user/workspace/project/docs');
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
        // Should NOT show any absolute path segments
        expect(screen.queryByText('mnt')).not.toBeInTheDocument();
        expect(screen.queryByText('secure')).not.toBeInTheDocument();
        expect(screen.queryByText('active_development')).not.toBeInTheDocument();
        // Should show only relative segments
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
        expect(path_items).toHaveLength(3);
        // Full paths reconstructed from doc_path minus relative suffix
        expect(path_items[0]).toHaveAttribute('data-path', '/mnt/secure/home/alex/git/github.com/active_development/countingsheet');
        expect(path_items[1]).toHaveAttribute('data-path', '/mnt/secure/home/alex/git/github.com/active_development/countingsheet/docs');
        expect(path_items[2]).toHaveAttribute('data-path', '/mnt/secure/home/alex/git/github.com/active_development/countingsheet/docs/todo.md');
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
});
