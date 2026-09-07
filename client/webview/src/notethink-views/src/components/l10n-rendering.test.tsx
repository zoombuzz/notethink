import React from 'react';
import fs from 'fs';
import path from 'path';
import * as l10n from '@vscode/l10n';
import { render, screen } from '@testing-library/react';
import SettingsCardDrawer from './views/drawers/SettingsCardDrawer';
import SettingsViewDrawer from './views/drawers/SettingsViewDrawer';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');

function readBundle(locale: string): Record<string, string> {
    return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'l10n', `bundle.l10n.${locale}.json`), 'utf-8'));
}

afterEach(() => {
    // reset l10n to default English (no bundle)
    l10n.config({ contents: {} });
});

const DRAWER_PROPS = {
    viewId: 'v1',
    settings: {},
    diverged: [] as string[],
    userTypes: [],
    currentType: 'kanban',
    viewTypeSelection: 'kanban',
    onViewTypeChange: jest.fn(),
    onSettingChange: jest.fn(),
    naturalColumnOrder: ['backlog', 'doing', 'done'],
    onColumnOrderChange: jest.fn(),
    groupByResolvedKey: 'nt_first_level_folder',
    groupByCandidateKeys: [] as string[],
    onMakeDefault: jest.fn(),
    onResetToDefault: jest.fn(),
};

const CARD_DRAWER_PROPS = {
    viewId: 'v1',
    settings: {},
    diverged: [] as string[],
    resolvedCardType: 'card',
    cardTypeSelection: 'auto',
    onCardTypeChange: jest.fn(),
    onSettingChange: jest.fn(),
};

describe('l10n rendering with French bundle', () => {
    beforeEach(() => {
        l10n.config({ contents: readBundle('fr') });
    });

    it('renders the French heading in SettingsViewDrawer', () => {
        render(<SettingsViewDrawer {...DRAWER_PROPS} />);
        // the string heads the settings pane; the drawer's own title carries the short form beside it
        expect(screen.getAllByText('Paramètres de la vue').length).toBeGreaterThan(0);
    });

    it('renders French row labels', () => {
        render(<SettingsViewDrawer {...DRAWER_PROPS} />);
        expect(screen.getByText('Faire défiler la note dans la vue')).toBeInTheDocument();
        expect(screen.getByText('Orientation')).toBeInTheDocument();
    });

    it('renders the French card drawer heading, tree root and row labels', () => {
        render(<SettingsCardDrawer {...CARD_DRAWER_PROPS} />);
        expect(screen.getAllByText('Paramètres des cartes').length).toBeGreaterThan(0);
        expect(screen.getByTestId('card-node-allcards')).toHaveTextContent('Toutes les cartes');
        expect(screen.getByText('Afficher les numéros de ligne')).toBeInTheDocument();
    });

    it('renders the French tree root label', () => {
        render(<SettingsViewDrawer {...DRAWER_PROPS} />);
        // the same string also names the owning type on every root-homed row, so bind to the tree row itself
        expect(screen.getByTestId('view-node-root')).toHaveTextContent('Toutes les vues');
    });
});

describe('l10n rendering with German bundle', () => {
    beforeEach(() => {
        l10n.config({ contents: readBundle('de') });
    });

    it('renders the German Global settings heading', () => {
        render(<SettingsViewDrawer {...DRAWER_PROPS} />);
        expect(screen.getByTestId('global-settings-heading')).toHaveTextContent('Globale Einstellungen');
    });

    it('renders interpolated German aria-labels on the lane chips', () => {
        render(<SettingsViewDrawer {...DRAWER_PROPS} />);
        /*
         * German: "{0} neu anordnen" - the placeholder moves to the start
         * the {0} substitution is the formatted column label (title-case), not the raw slug
         */
        expect(screen.getByLabelText('Backlog neu anordnen')).toBeInTheDocument();
        expect(screen.getByLabelText('Doing neu anordnen')).toBeInTheDocument();
    });
});

describe('l10n rendering with Spanish bundle', () => {
    beforeEach(() => {
        l10n.config({ contents: readBundle('es') });
    });

    it('renders the Spanish Change defaults disclosure', () => {
        render(<SettingsViewDrawer {...DRAWER_PROPS} />);
        expect(screen.getByTestId('change-defaults-summary')).toHaveTextContent('Cambiar valores predeterminados');
    });

    it('renders interpolated Spanish aria-labels on the lane chips', () => {
        render(<SettingsViewDrawer {...DRAWER_PROPS} />);
        // the {0} substitution is the formatted column label (title-case), not the raw slug
        expect(screen.getByLabelText('Reordenar Backlog')).toBeInTheDocument();
        expect(screen.getByLabelText('Reordenar Doing')).toBeInTheDocument();
    });
});

describe('l10n reset to English', () => {
    it('renders the English heading after resetting from French', () => {
        l10n.config({ contents: readBundle('fr') });
        const { unmount } = render(<SettingsViewDrawer {...DRAWER_PROPS} />);
        expect(screen.getAllByText('Paramètres de la vue').length).toBeGreaterThan(0);
        unmount();

        // reset to English
        l10n.config({ contents: {} });
        render(<SettingsViewDrawer {...DRAWER_PROPS} />);
        expect(screen.getAllByText('View settings').length).toBeGreaterThan(0);
    });
});
