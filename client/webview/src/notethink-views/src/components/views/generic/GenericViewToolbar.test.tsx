import React from 'react';
import { render, screen } from '@testing-library/react';
import GenericViewToolbar from './GenericViewToolbar';
import { PendingWorkProvider } from '../../../hooks/PendingWorkContext';
import type { UsePendingWorkApi } from '../../../hooks/usePendingWork';
import type { ViewApi, ViewProps } from '../../../types/ViewProps';
import { INTEGRATION_MODE_FOLDER } from '../../../types/IntegrationMode';

const noop = jest.fn();

const stub_handlers: ViewApi = {
    setViewManagedState: noop,
    deleteViewFromManagedState: noop,
    revertAllViewsToDefaultState: noop,
    postMessage: noop,
};

const stub_view_props: ViewProps = {
    id: 'v0',
    type: 'document',
    display_options: { settings: {} },
};

const default_toolbar_props = {
    props: stub_view_props,
    handlers: stub_handlers,
    displayOptions: stub_view_props.display_options!,
    breadcrumbTrail: <div data-testid="stub-breadcrumb" />,
    autoResolvedType: undefined,
    integrationMode: INTEGRATION_MODE_FOLDER,
    naturalColumnOrder: [],
    activeDrawer: 'none' as const,
    gearButtonRef: React.createRef<HTMLButtonElement | null>(),
    onSettingsToggle: noop,
    onInsertOpen: noop,
    onIntegrationChange: noop,
    onSettingChange: noop,
    onGlobalSettingChange: noop,
    onColumnOrderChange: noop,
    onMakeDefault: noop,
    onResetToDefault: noop,
    onApplyFilters: noop,
    onCascadeWrite: noop,
};

function withProvider(pending: boolean, ui: React.ReactElement): React.ReactElement {
    const api: UsePendingWorkApi = {
        pending,
        markPending: jest.fn(),
        clearPending: jest.fn(),
        clearAll: jest.fn(),
    };
    return <PendingWorkProvider api={api}>{ui}</PendingWorkProvider>;
}

describe('GenericViewToolbar spinner integration', () => {
    it('renders a spinner directly inside the toolbar (next to the breadcrumb) when context reports pending=true', () => {
        render(withProvider(true, <GenericViewToolbar {...default_toolbar_props} />));
        const toolbar = screen.getByTestId('view-toolbar');
        // multiple spinners can mount (drawers also render one when pending); the assertion is that AT LEAST one lives inside the toolbar
        const spinners = screen.getAllByTestId('pending-work-spinner');
        const toolbar_spinner = spinners.find(el => toolbar.contains(el));
        expect(toolbar_spinner).toBeDefined();
    });

    it('does not render the spinner when context reports pending=false', () => {
        render(withProvider(false, <GenericViewToolbar {...default_toolbar_props} />));
        expect(screen.queryByTestId('pending-work-spinner')).not.toBeInTheDocument();
    });

    it('does not render the spinner with no provider mounted', () => {
        render(<GenericViewToolbar {...default_toolbar_props} />);
        expect(screen.queryByTestId('pending-work-spinner')).not.toBeInTheDocument();
    });
});
