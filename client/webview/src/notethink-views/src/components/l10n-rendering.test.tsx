import React from 'react';
import fs from 'fs';
import path from 'path';
import * as l10n from '@vscode/l10n';
import { render, screen } from '@testing-library/react';
import SettingsDocumentDrawer from './views/SettingsDocumentDrawer';
import SettingsKanbanDrawer from './views/SettingsKanbanDrawer';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');

function readBundle(locale: string): Record<string, string> {
    return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'l10n', `bundle.l10n.${locale}.json`), 'utf-8'));
}

afterEach(() => {
    // reset l10n to default English (no bundle)
    l10n.config({ contents: {} });
});

const DOC_DRAWER_PROPS = {
    settings: {},
    showLineNumbers: false,
    onSettingChange: jest.fn(),
    onGlobalSettingChange: jest.fn(),
};

const KANBAN_DRAWER_PROPS = {
    settings: {},
    naturalColumnOrder: ['backlog', 'doing', 'done'],
    showLineNumbers: false,
    onSettingChange: jest.fn(),
    onGlobalSettingChange: jest.fn(),
    onColumnOrderChange: jest.fn(),
};

describe('l10n rendering with French bundle', () => {
    beforeEach(() => {
        l10n.config({ contents: readBundle('fr') });
    });

    it('renders French heading in SettingsDocumentDrawer', () => {
        render(<SettingsDocumentDrawer {...DOC_DRAWER_PROPS} />);
        expect(screen.getByText('Paramètres du document')).toBeInTheDocument();
    });

    it('renders French checkbox labels', () => {
        render(<SettingsDocumentDrawer {...DOC_DRAWER_PROPS} />);
        expect(screen.getByText('Afficher les numéros de ligne')).toBeInTheDocument();
        expect(screen.getByText('Faire défiler la note dans la vue')).toBeInTheDocument();
    });
});

describe('l10n rendering with German bundle', () => {
    beforeEach(() => {
        l10n.config({ contents: readBundle('de') });
    });

    it('renders German heading in SettingsKanbanDrawer', () => {
        render(<SettingsKanbanDrawer {...KANBAN_DRAWER_PROPS} />);
        expect(screen.getByText('Kanban-Einstellungen')).toBeInTheDocument();
    });

    it('renders interpolated German aria-labels for column reorder buttons', () => {
        render(<SettingsKanbanDrawer {...KANBAN_DRAWER_PROPS} />);
        // German: "{0} nach oben verschieben" - placeholder moves to start
        expect(screen.getByLabelText('backlog nach oben verschieben')).toBeInTheDocument();
        expect(screen.getByLabelText('doing nach unten verschieben')).toBeInTheDocument();
    });

    it('renders German Reset order button label', () => {
        render(<SettingsKanbanDrawer {...KANBAN_DRAWER_PROPS} />);
        expect(screen.getByText('Reihenfolge zurücksetzen')).toBeInTheDocument();
    });
});

describe('l10n rendering with Spanish bundle', () => {
    beforeEach(() => {
        l10n.config({ contents: readBundle('es') });
    });

    it('renders Spanish heading in SettingsDocumentDrawer', () => {
        render(<SettingsDocumentDrawer {...DOC_DRAWER_PROPS} />);
        expect(screen.getByText('Configuración del documento')).toBeInTheDocument();
    });

    it('renders interpolated Spanish aria-labels for column reorder buttons', () => {
        render(<SettingsKanbanDrawer {...KANBAN_DRAWER_PROPS} />);
        expect(screen.getByLabelText('Mover backlog hacia arriba')).toBeInTheDocument();
        expect(screen.getByLabelText('Mover doing hacia abajo')).toBeInTheDocument();
    });
});

describe('l10n reset to English', () => {
    it('renders English heading after resetting from French', () => {
        l10n.config({ contents: readBundle('fr') });
        const { unmount } = render(<SettingsDocumentDrawer {...DOC_DRAWER_PROPS} />);
        expect(screen.getByText('Paramètres du document')).toBeInTheDocument();
        unmount();

        // reset to English
        l10n.config({ contents: {} });
        render(<SettingsDocumentDrawer {...DOC_DRAWER_PROPS} />);
        expect(screen.getByText('Document Settings')).toBeInTheDocument();
    });
});
