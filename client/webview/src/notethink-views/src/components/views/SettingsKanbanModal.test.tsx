import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsKanbanModal from './SettingsKanbanModal';

beforeAll(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
        this.removeAttribute('open');
    });
});

const defaultProps = {
    opened: false,
    onClose: jest.fn(),
    columnOrder: ['backlog', 'doing', 'review', 'done'],
    settings: {},
    onSave: jest.fn(),
    showLineNumbers: false,
    postMessage: jest.fn(),
};

function renderModal(overrides: Partial<typeof defaultProps> = {}) {
    const props = { ...defaultProps, ...overrides };
    return render(<SettingsKanbanModal {...props} />);
}

describe('SettingsKanbanModal', () => {

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

    it('shows all column names from columnOrder', () => {
        renderModal({ opened: true, columnOrder: ['backlog', 'doing', 'review', 'done'] });
        expect(screen.getByText('backlog')).toBeInTheDocument();
        expect(screen.getByText('doing')).toBeInTheDocument();
        expect(screen.getByText('review')).toBeInTheDocument();
        expect(screen.getByText('done')).toBeInTheDocument();
    });

    it('checkboxes reflect initial settings values', () => {
        renderModal({
            opened: true,
            settings: {
                show_linetags_in_headlines: true,
                scroll_note_into_view: false,
            },
        });
        const checkboxes = screen.getAllByRole('checkbox');
        const linetags_checkbox = checkboxes.find(
            (cb) => cb.closest('label')?.textContent?.toLowerCase().includes('linetag')
        ) ?? checkboxes[0];
        const scroll_checkbox = checkboxes.find(
            (cb) => cb.closest('label')?.textContent?.toLowerCase().includes('scroll')
        ) ?? checkboxes[1];
        expect(linetags_checkbox).toBeChecked();
        expect(scroll_checkbox).not.toBeChecked();
    });

    it('clicking Move up reorders columns', () => {
        const onSave = jest.fn();
        renderModal({
            opened: true,
            columnOrder: ['backlog', 'doing', 'review'],
            onSave,
        });
        // move "doing" (index 1) up to index 0
        const move_up_button = screen.getByLabelText('Move doing up');
        fireEvent.click(move_up_button);

        fireEvent.click(screen.getByText('Save'));

        expect(onSave).toHaveBeenCalledTimes(1);
        const saved_settings = onSave.mock.calls[0][0];
        expect(saved_settings.column_order).toBeDefined();
        const order = saved_settings.column_order as string[];
        expect(order.indexOf('doing')).toBeLessThan(order.indexOf('backlog'));
    });

    it('clicking Move down reorders columns', () => {
        const onSave = jest.fn();
        renderModal({
            opened: true,
            columnOrder: ['backlog', 'doing', 'review'],
            onSave,
        });
        // move "doing" (index 1) down to index 2
        const move_down_button = screen.getByLabelText('Move doing down');
        fireEvent.click(move_down_button);

        fireEvent.click(screen.getByText('Save'));

        expect(onSave).toHaveBeenCalledTimes(1);
        const saved_settings = onSave.mock.calls[0][0];
        const order = saved_settings.column_order as string[];
        expect(order.indexOf('doing')).toBeGreaterThan(order.indexOf('review'));
    });

    it('first column Move up button is disabled', () => {
        renderModal({
            opened: true,
            columnOrder: ['backlog', 'doing', 'review'],
        });
        const move_up_button = screen.getByLabelText('Move backlog up');
        expect(move_up_button).toBeDisabled();
    });

    it('last column Move down button is disabled', () => {
        renderModal({
            opened: true,
            columnOrder: ['backlog', 'doing', 'review'],
        });
        const move_down_button = screen.getByLabelText('Move review down');
        expect(move_down_button).toBeDisabled();
    });

    it('toggling checkboxes changes their state', () => {
        renderModal({
            opened: true,
            settings: {
                show_linetags_in_headlines: false,
                scroll_note_into_view: false,
            },
        });
        const checkboxes = screen.getAllByRole('checkbox');
        const first_checkbox = checkboxes[0];
        expect(first_checkbox).not.toBeChecked();
        fireEvent.click(first_checkbox);
        expect(first_checkbox).toBeChecked();
    });

    it('clicking Save calls onSave with updated settings', () => {
        const onSave = jest.fn();
        renderModal({
            opened: true,
            settings: {
                show_linetags_in_headlines: false,
                scroll_note_into_view: false,
            },
            onSave,
        });
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]);

        fireEvent.click(screen.getByText('Save'));

        expect(onSave).toHaveBeenCalledTimes(1);
        const saved = onSave.mock.calls[0][0];
        expect(saved).toBeDefined();
    });

    it('clicking Cancel calls onClose without calling onSave', () => {
        const onClose = jest.fn();
        const onSave = jest.fn();
        renderModal({
            opened: true,
            onClose,
            onSave,
        });
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('clicking Reset order clears column_order to undefined on save', () => {
        const onSave = jest.fn();
        renderModal({
            opened: true,
            columnOrder: ['backlog', 'doing', 'review'],
            settings: {
                column_order: ['review', 'doing', 'backlog'],
            },
            onSave,
        });
        fireEvent.click(screen.getByText('Reset order'));
        fireEvent.click(screen.getByText('Save'));

        expect(onSave).toHaveBeenCalledTimes(1);
        const saved = onSave.mock.calls[0][0];
        expect(saved.column_order).toBeUndefined();
    });

    it('uses custom column_order from settings when provided', () => {
        renderModal({
            opened: true,
            columnOrder: ['backlog', 'doing', 'review', 'done'],
            settings: {
                column_order: ['done', 'review', 'doing', 'backlog'],
            },
        });
        const column_texts = screen.getAllByText(/^(done|review|doing|backlog)$/);
        expect(column_texts[0]).toHaveTextContent('done');
        expect(column_texts[1]).toHaveTextContent('review');
        expect(column_texts[2]).toHaveTextContent('doing');
        expect(column_texts[3]).toHaveTextContent('backlog');
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
