import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import JumpDrawer from './JumpDrawer';
import { JumpTargetsProvider } from '../../../hooks/JumpTargetsContext';
import type { UseJumpTargetsApi } from '../../../hooks/useJumpTargets';
import type { JumpTargetsMessage } from '../../../types/Messages';
import { INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER } from '../../../types/IntegrationMode';

function makeApi(jump_targets: JumpTargetsMessage | undefined): UseJumpTargetsApi {
    return {
        jump_targets,
        setJumpTargets: jest.fn(),
    };
}

function renderWith(
    jump_targets: JumpTargetsMessage | undefined,
    requestedPath: string | undefined,
    handlers: { onFolderJump?: jest.Mock; onFileJump?: jest.Mock; onReturn?: jest.Mock } = {},
): { onFolderJump: jest.Mock; onFileJump: jest.Mock; onReturn: jest.Mock } {
    const onFolderJump = handlers.onFolderJump ?? jest.fn();
    const onFileJump = handlers.onFileJump ?? jest.fn();
    const onReturn = handlers.onReturn ?? jest.fn();
    render(
        <JumpTargetsProvider api={makeApi(jump_targets)}>
            <JumpDrawer requestedPath={requestedPath} onFolderJump={onFolderJump} onFileJump={onFileJump} onReturn={onReturn} />
        </JumpTargetsProvider>,
    );
    return { onFolderJump, onFileJump, onReturn };
}

describe('JumpDrawer', () => {
    it('renders folder entries and dispatches onFolderJump with the entry path', () => {
        const jump_targets: JumpTargetsMessage = {
            type: 'jumpTargets',
            mode: INTEGRATION_MODE_FOLDER,
            path: '/ws/docs',
            entries: [
                { label: 'alpha', path: '/ws/docs/alpha', kind: 'folder' },
                { label: 'beta', path: '/ws/docs/beta', kind: 'folder' },
            ],
        };
        const { onFolderJump, onReturn } = renderWith(jump_targets, '/ws/docs');
        const list = screen.getByTestId('jump-drawer-list');
        const rows = within(list).getAllByTestId('jump-drawer-entry');
        expect(rows).toHaveLength(2);
        expect(rows.every(r => r.getAttribute('data-kind') === 'folder')).toBe(true);
        fireEvent.click(within(list).getByText('beta'));
        expect(onFolderJump).toHaveBeenCalledTimes(1);
        expect(onFolderJump).toHaveBeenCalledWith('/ws/docs/beta');
        // descending into the subfolder also dismisses the drawer
        expect(onReturn).toHaveBeenCalledTimes(1);
    });

    it('renders file entries and dispatches onFileJump with the entry path', () => {
        const jump_targets: JumpTargetsMessage = {
            type: 'jumpTargets',
            mode: INTEGRATION_MODE_CURRENT_FILE,
            path: '/ws/docs/todo.md',
            entries: [
                { label: 'notes.md', path: '/ws/docs/notes.md', kind: 'file' },
                { label: 'plan.md', path: '/ws/docs/plan.md', kind: 'file' },
            ],
        };
        const { onFileJump, onReturn } = renderWith(jump_targets, '/ws/docs/todo.md');
        const list = screen.getByTestId('jump-drawer-list');
        const rows = within(list).getAllByTestId('jump-drawer-entry');
        expect(rows.every(r => r.getAttribute('data-kind') === 'file')).toBe(true);
        fireEvent.click(within(list).getByText('plan.md'));
        expect(onFileJump).toHaveBeenCalledTimes(1);
        expect(onFileJump).toHaveBeenCalledWith('/ws/docs/plan.md');
        // opening the file also dismisses the drawer
        expect(onReturn).toHaveBeenCalledTimes(1);
    });

    it('renders the root header with the basename of requestedPath', () => {
        const jump_targets: JumpTargetsMessage = {
            type: 'jumpTargets',
            mode: INTEGRATION_MODE_FOLDER,
            path: '/ws/oma/docstech',
            entries: [{ label: 'specs', path: '/ws/oma/docstech/specs', kind: 'folder' }],
        };
        renderWith(jump_targets, '/ws/oma/docstech');
        expect(screen.getByTestId('jump-drawer-root')).toHaveTextContent('docstech');
    });

    it('clicking the root row calls onReturn to dismiss the drawer back to the current view', () => {
        const jump_targets: JumpTargetsMessage = {
            type: 'jumpTargets',
            mode: INTEGRATION_MODE_FOLDER,
            path: '/ws/oma/docstech',
            entries: [],
        };
        const { onReturn } = renderWith(jump_targets, '/ws/oma/docstech');
        fireEvent.click(screen.getByTestId('jump-drawer-root'));
        expect(onReturn).toHaveBeenCalledTimes(1);
    });

    it('shows the folder-mode empty-state row when entries is empty', () => {
        const jump_targets: JumpTargetsMessage = {
            type: 'jumpTargets',
            mode: INTEGRATION_MODE_FOLDER,
            path: '/ws/docs',
            entries: [],
        };
        renderWith(jump_targets, '/ws/docs');
        expect(screen.getByTestId('jump-drawer-empty')).toHaveTextContent('No subfolders');
        expect(screen.queryByTestId('jump-drawer-entry')).not.toBeInTheDocument();
    });

    it('shows the current-file empty-state row when entries is empty', () => {
        const jump_targets: JumpTargetsMessage = {
            type: 'jumpTargets',
            mode: INTEGRATION_MODE_CURRENT_FILE,
            path: '/ws/docs/todo.md',
            entries: [],
        };
        renderWith(jump_targets, '/ws/docs/todo.md');
        expect(screen.getByTestId('jump-drawer-empty')).toHaveTextContent('No other files here');
    });

    it('shows the loading row when no response has arrived yet', () => {
        renderWith(undefined, '/ws/docs');
        expect(screen.getByTestId('jump-drawer-loading')).toBeInTheDocument();
        expect(screen.queryByTestId('jump-drawer-entry')).not.toBeInTheDocument();
    });

    it('shows the loading row when the response is for a different leaf', () => {
        const jump_targets: JumpTargetsMessage = {
            type: 'jumpTargets',
            mode: INTEGRATION_MODE_FOLDER,
            path: '/ws/other',
            entries: [{ label: 'alpha', path: '/ws/other/alpha', kind: 'folder' }],
        };
        // requestedPath differs from jump_targets.path, so the reply hasn't arrived for this leaf
        renderWith(jump_targets, '/ws/docs');
        expect(screen.getByTestId('jump-drawer-loading')).toBeInTheDocument();
        expect(screen.queryByTestId('jump-drawer-entry')).not.toBeInTheDocument();
    });
});
