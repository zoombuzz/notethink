import React from 'react';
import fs from 'fs';
import path from 'path';
import * as l10n from '@vscode/l10n';
import { render, screen } from '@testing-library/react';
import SettingsDocumentModal from './views/SettingsDocumentModal';
import SettingsKanbanModal from './views/SettingsKanbanModal';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');

function readBundle(locale: string): Record<string, string> {
    return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'l10n', `bundle.l10n.${locale}.json`), 'utf-8'));
}

beforeAll(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
        this.removeAttribute('open');
    });
});

afterEach(() => {
    // reset l10n to default English (no bundle)
    l10n.config({ contents: {} });
});

const DOC_MODAL_PROPS = {
    opened: true,
    onClose: jest.fn(),
    settings: {},
    onSave: jest.fn(),
    showLineNumbers: false,
    postMessage: jest.fn(),
};

const KANBAN_MODAL_PROPS = {
    opened: true,
    onClose: jest.fn(),
    columnOrder: ['backlog', 'doing', 'done'],
    settings: {},
    onSave: jest.fn(),
    showLineNumbers: false,
    postMessage: jest.fn(),
};

describe('l10n rendering with French bundle', () => {
    beforeEach(() => {
        l10n.config({ contents: readBundle('fr') });
    });

    it('renders French heading in SettingsDocumentModal', () => {
        render(<SettingsDocumentModal {...DOC_MODAL_PROPS} />);
        expect(screen.getByText('Paramètres du document')).toBeInTheDocument();
    });

    it('renders French button labels', () => {
        render(<SettingsDocumentModal {...DOC_MODAL_PROPS} />);
        expect(screen.getByText('Enregistrer')).toBeInTheDocument();
        expect(screen.getByText('Annuler')).toBeInTheDocument();
    });

    it('renders French checkbox labels', () => {
        render(<SettingsDocumentModal {...DOC_MODAL_PROPS} />);
        expect(screen.getByText('Afficher les numéros de ligne')).toBeInTheDocument();
        expect(screen.getByText('Faire défiler la note dans la vue')).toBeInTheDocument();
    });
});

describe('l10n rendering with German bundle', () => {
    beforeEach(() => {
        l10n.config({ contents: readBundle('de') });
    });

    it('renders German heading in SettingsKanbanModal', () => {
        render(<SettingsKanbanModal {...KANBAN_MODAL_PROPS} />);
        expect(screen.getByText('Kanban-Einstellungen')).toBeInTheDocument();
    });

    it('renders interpolated German aria-labels for column reorder buttons', () => {
        render(<SettingsKanbanModal {...KANBAN_MODAL_PROPS} />);
        // German: "{0} nach oben verschieben" — placeholder moves to start
        expect(screen.getByLabelText('backlog nach oben verschieben')).toBeInTheDocument();
        expect(screen.getByLabelText('doing nach unten verschieben')).toBeInTheDocument();
    });

    it('renders German button labels', () => {
        render(<SettingsKanbanModal {...KANBAN_MODAL_PROPS} />);
        expect(screen.getByText('Speichern')).toBeInTheDocument();
        expect(screen.getByText('Abbrechen')).toBeInTheDocument();
        expect(screen.getByText('Reihenfolge zurücksetzen')).toBeInTheDocument();
    });
});

describe('l10n rendering with Spanish bundle', () => {
    beforeEach(() => {
        l10n.config({ contents: readBundle('es') });
    });

    it('renders Spanish heading in SettingsDocumentModal', () => {
        render(<SettingsDocumentModal {...DOC_MODAL_PROPS} />);
        expect(screen.getByText('Configuración del documento')).toBeInTheDocument();
    });

    it('renders Spanish button labels', () => {
        render(<SettingsDocumentModal {...DOC_MODAL_PROPS} />);
        expect(screen.getByText('Guardar')).toBeInTheDocument();
        expect(screen.getByText('Cancelar')).toBeInTheDocument();
    });

    it('renders interpolated Spanish aria-labels for column reorder buttons', () => {
        render(<SettingsKanbanModal {...KANBAN_MODAL_PROPS} />);
        expect(screen.getByLabelText('Mover backlog hacia arriba')).toBeInTheDocument();
        expect(screen.getByLabelText('Mover doing hacia abajo')).toBeInTheDocument();
    });
});

describe('l10n reset to English', () => {
    it('renders English after resetting from French', () => {
        l10n.config({ contents: readBundle('fr') });
        const { unmount } = render(<SettingsDocumentModal {...DOC_MODAL_PROPS} />);
        expect(screen.getByText('Paramètres du document')).toBeInTheDocument();
        unmount();

        // reset to English
        l10n.config({ contents: {} });
        render(<SettingsDocumentModal {...DOC_MODAL_PROPS} />);
        expect(screen.getByText('Document Settings')).toBeInTheDocument();
        expect(screen.getByText('Save')).toBeInTheDocument();
    });
});
