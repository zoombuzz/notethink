import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsDocumentModal from './SettingsDocumentModal';

beforeAll(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
        this.removeAttribute('open');
    });
});

const default_props = {
    opened: false,
    onClose: jest.fn(),
    settings: {},
    onSave: jest.fn(),
    showLineNumbers: false,
    postMessage: jest.fn(),
};

function renderModal(overrides: Partial<typeof default_props> = {}) {
    const props = { ...default_props, ...overrides };
    return render(<SettingsDocumentModal {...props} />);
}

describe('SettingsDocumentModal', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does not render dialog as open when opened is false', () => {
        renderModal({ opened: false });
        const dialog = screen.getByRole('dialog', { hidden: true });
        expect(dialog).not.toHaveAttribute('open');
    });

    it('renders dialog as open when opened is true', () => {
        renderModal({ opened: true });
        expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    });

    it('checkboxes reflect initial settings values', () => {
        renderModal({
            opened: true,
            settings: {
                show_linetags_in_headlines: true,
                scroll_note_into_view: false,
                auto_expand_focused_note: true,
            },
        });
        const checkboxes = screen.getAllByRole('checkbox');
        const linetags_cb = checkboxes.find(cb => cb.closest('label')?.textContent?.includes('linetag')) ?? checkboxes[0];
        const scroll_cb = checkboxes.find(cb => cb.closest('label')?.textContent?.includes('Scroll')) ?? checkboxes[1];
        const expand_cb = checkboxes.find(cb => cb.closest('label')?.textContent?.includes('Auto-expand')) ?? checkboxes[2];
        expect(linetags_cb).toBeChecked();
        expect(scroll_cb).not.toBeChecked();
        expect(expand_cb).toBeChecked();
    });

    it('auto_expand defaults to unchecked when not set', () => {
        renderModal({ opened: true, settings: {} });
        const checkboxes = screen.getAllByRole('checkbox');
        const expand_cb = checkboxes.find(cb => cb.closest('label')?.textContent?.includes('Auto-expand')) ?? checkboxes[2];
        expect(expand_cb).not.toBeChecked();
    });

    it('clicking Save calls onSave with updated settings', () => {
        const on_save = jest.fn();
        renderModal({
            opened: true,
            settings: { auto_expand_focused_note: false },
            onSave: on_save,
        });
        // toggle auto-expand on
        const expand_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('Auto-expand')
        )!;
        fireEvent.click(expand_cb);
        fireEvent.click(screen.getByText('Save'));

        expect(on_save).toHaveBeenCalledTimes(1);
        expect(on_save.mock.calls[0][0].auto_expand_focused_note).toBe(true);
    });

    it('clicking Cancel calls onClose without calling onSave', () => {
        const on_close = jest.fn();
        const on_save = jest.fn();
        renderModal({ opened: true, onClose: on_close, onSave: on_save });
        fireEvent.click(screen.getByText('Cancel'));
        expect(on_close).toHaveBeenCalledTimes(1);
        expect(on_save).not.toHaveBeenCalled();
    });

    it('does not have column order controls', () => {
        renderModal({ opened: true });
        expect(screen.queryByText('Column order')).not.toBeInTheDocument();
        expect(screen.queryByText('Reset order')).not.toBeInTheDocument();
    });

    it('shows line numbers checkbox reflecting showLineNumbers prop', () => {
        renderModal({ opened: true, showLineNumbers: true });
        const line_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('line numbers')
        );
        expect(line_cb).toBeChecked();
    });

    it('sends updateGlobalSetting when line numbers changed on save', () => {
        const post_message = jest.fn();
        renderModal({ opened: true, showLineNumbers: false, postMessage: post_message });
        const line_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('line numbers')
        )!;
        fireEvent.click(line_cb);
        fireEvent.click(screen.getByText('Save'));
        expect(post_message).toHaveBeenCalledWith({
            type: 'updateGlobalSetting',
            setting: 'show_line_numbers',
            value: true,
        });
    });

    it('does not send updateGlobalSetting when line numbers unchanged on save', () => {
        const post_message = jest.fn();
        renderModal({ opened: true, showLineNumbers: false, postMessage: post_message });
        fireEvent.click(screen.getByText('Save'));
        expect(post_message).not.toHaveBeenCalled();
    });
});
