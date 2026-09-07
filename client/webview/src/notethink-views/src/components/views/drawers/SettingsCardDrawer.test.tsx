import React from 'react';
import { render, screen, fireEvent, within, type RenderResult } from '@testing-library/react';
import SettingsCardDrawer from './SettingsCardDrawer';
import { CARD_REGISTRY } from '../../notes/cardregistryops';
import { CARD_SETTING_ROWS } from '../settingRows';

const default_props = {
    viewId: 'v1',
    settings: {} as Record<string, unknown>,
    diverged: [] as string[],
    resolvedCardType: 'card',
    cardTypeSelection: 'auto',
    onCardTypeChange: jest.fn(),
    onSettingChange: jest.fn(),
};

function renderDrawer(overrides: Partial<typeof default_props> = {}): RenderResult {
    return render(<SettingsCardDrawer {...default_props} {...overrides} />);
}

function renderedRowKeys(): string[] {
    return screen.getAllByTestId(/^setting-row-/).map(el => el.getAttribute('data-testid')!.replace('setting-row-', ''));
}

describe('SettingsCardDrawer tree', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the whole card registry as a hierarchy under All cards', () => {
        renderDrawer();
        for (const node of CARD_REGISTRY.nodes) {
            expect(screen.getByTestId(`card-node-${node.id}`)).toBeInTheDocument();
        }
        const root_item = screen.getByTestId('card-node-allcards').closest('li')!;
        expect(within(root_item).getByTestId('card-node-card')).toBeInTheDocument();
        expect(within(root_item).getByTestId('card-node-sticky')).toBeInTheDocument();
        expect(screen.getByTestId('card-node-allcards')).toHaveTextContent('All cards');
    });

    it('renders through the shared drawer tree rather than markup of its own', () => {
        renderDrawer();
        const tree = screen.getByTestId('settings-card-tree');
        expect(tree).toHaveAttribute('role', 'tree');
        expect(within(tree).getAllByRole('treeitem')).toHaveLength(CARD_REGISTRY.nodes.length);
    });

    it('gives a radio to every card that can render, plus the root, where it stands for auto', () => {
        renderDrawer();
        expect(screen.getByTestId('card-radio-card')).toBeInTheDocument();
        expect(screen.getByTestId('card-radio-sticky')).toBeInTheDocument();
        expect(screen.getByTestId('card-radio-auto')).toBeInTheDocument();
        expect(screen.queryByTestId('card-radio-allcards')).not.toBeInTheDocument();
    });

    it('checks the radio for the persisted selection, and the auto radio when nothing is pinned', () => {
        const { unmount } = renderDrawer();
        expect(screen.getByTestId('card-radio-auto')).toBeChecked();
        unmount();
        renderDrawer({ cardTypeSelection: 'sticky' });
        expect(screen.getByTestId('card-radio-sticky')).toBeChecked();
        expect(screen.getByTestId('card-radio-auto')).not.toBeChecked();
    });

    it('writes the card type through the one setting-change path when a radio is picked', () => {
        const on_card_type_change = jest.fn();
        renderDrawer({ onCardTypeChange: on_card_type_change });
        fireEvent.click(screen.getByTestId('card-radio-sticky'));
        expect(on_card_type_change).toHaveBeenCalledWith('sticky');
    });

    it('shows the count of settings each card node owns', () => {
        const settings = Object.fromEntries(CARD_SETTING_ROWS.map(def => [def.key, undefined]));
        renderDrawer({ settings });
        expect(screen.getByTestId('card-node-count-allcards')).toHaveTextContent('(3)');
        expect(screen.getByTestId('card-node-count-card')).toHaveTextContent('(0)');
        expect(screen.getByTestId('card-node-count-sticky')).toHaveTextContent('(0)');
    });

    it('clicking a node moves the highlight without pinning the card type', () => {
        const on_card_type_change = jest.fn();
        renderDrawer({ onCardTypeChange: on_card_type_change });
        fireEvent.click(screen.getByTestId('card-node-sticky'));
        expect(on_card_type_change).not.toHaveBeenCalled();
        expect(screen.getByTestId('card-node-sticky').closest('li')).toHaveAttribute('aria-selected', 'true');
    });

    it('starts the highlight on the card the notes currently draw as', () => {
        renderDrawer({ resolvedCardType: 'sticky' });
        expect(screen.getByTestId('card-node-sticky').closest('li')).toHaveAttribute('aria-selected', 'true');
    });
});

describe('SettingsCardDrawer rows', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('lists the three card-drawn settings, each pilled to the type that owns it', () => {
        renderDrawer();
        expect(renderedRowKeys()).toEqual([
            'showLinetagsInHeadlines',
            'autoExpandFocusedNote',
            'showLineNumbers',
        ]);
        expect(screen.getByTestId('setting-pill-showLinetagsInHeadlines')).toHaveTextContent('All cards');
        expect(screen.getByTestId('setting-pill-showLineNumbers')).toHaveTextContent('All cards');
    });

    it('names each pane over its own content and heads no column with either name', () => {
        renderDrawer();
        expect(screen.getByTestId('card-types-heading')).toHaveTextContent('Card types');
        expect(screen.getByTestId('card-settings-heading')).toHaveTextContent('Card settings');
        // the title is the short form, so the pane headings are where the axis is spelled out
        expect(screen.getAllByText('Card settings')).toHaveLength(1);
        expect(screen.queryByText('Card type')).not.toBeInTheDocument();
    });

    it('lists no view-owned or global setting, since the view tab keeps those', () => {
        renderDrawer({ settings: { orientation: 'rows', scrollNoteIntoView: true, watchUnopenedFilesInViewer: true, cardType: 'sticky' } });
        for (const key of ['orientation', 'scrollNoteIntoView', 'watchUnopenedFilesInViewer', 'cardType']) {
            expect(screen.queryByTestId(`setting-row-${key}`)).not.toBeInTheDocument();
        }
        expect(screen.queryByTestId('global-settings-heading')).not.toBeInTheDocument();
    });

    it('keeps every row when a concrete card is selected, since all three home at the root', () => {
        renderDrawer();
        fireEvent.click(screen.getByTestId('card-node-sticky'));
        expect(renderedRowKeys()).toHaveLength(CARD_SETTING_ROWS.length);
    });

    it('marks every diverged row with an M and tallies exactly the marked rows', () => {
        renderDrawer({ diverged: ['showLineNumbers', 'scrollNoteIntoView'] });
        const marked = screen.getAllByTestId(/^setting-row-/).filter(row => row.getAttribute('data-diverged') === 'true');
        expect(marked.map(row => row.getAttribute('data-testid'))).toEqual(['setting-row-showLineNumbers']);
        expect(screen.getByTestId('setting-marker-showLineNumbers')).toHaveTextContent('M');
        // scrollNoteIntoView diverges but renders no row here, so the card pane does not count it
        expect(screen.getByTestId('card-diverged-count')).toHaveTextContent('1 setting diverged');
    });

    it('tallies zero in the same words when nothing has diverged', () => {
        renderDrawer({ diverged: [] });
        expect(screen.getByTestId('card-diverged-count')).toHaveTextContent('0 settings diverged');
    });

    it('toggles a checkbox row through the one setting-change path', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change, settings: { showLineNumbers: false } });
        fireEvent.click(screen.getByTestId('setting-control-showLineNumbers'));
        expect(on_setting_change).toHaveBeenCalledWith('showLineNumbers', true);
    });

    it('falls back to each setting built-in default before the first cascade arrives', () => {
        renderDrawer({ settings: {} });
        for (const def of CARD_SETTING_ROWS) {
            expect(screen.getByTestId(`setting-control-${def.key}`)).not.toBeChecked();
        }
    });

    /*
     * This asserted `new-card-type-offer` was absent, which the component could not have failed: it mounts
     * no offer at all, so the query named a testid nothing in the tree ever emits and would have passed
     * against an empty component. What is actually true is that the card drawer carries no minting UI, so
     * that is what is asserted - against the view drawer's own testids, which do exist and are mounted
     * there, so the check fails the day one is copied across without the rest of the machinery.
     */
    it('mounts no minting UI, because every card setting homes at the root where the offer rule is exempt', () => {
        renderDrawer();
        fireEvent.click(screen.getByTestId('setting-control-showLineNumbers'));
        expect(screen.queryByTestId('new-view-type-offer')).not.toBeInTheDocument();
        expect(screen.queryByTestId('new-view-type-open')).not.toBeInTheDocument();
        expect(screen.queryByTestId('custom-view-types')).not.toBeInTheDocument();
    });
});
