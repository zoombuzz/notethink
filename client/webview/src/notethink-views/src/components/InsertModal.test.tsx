import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import InsertModal from './InsertModal';

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
    onInsert: jest.fn(),
};

function renderModal(overrides: Partial<typeof default_props> = {}) {
    const props = { ...default_props, ...overrides };
    return render(<InsertModal {...props} />);
}

describe('InsertModal', () => {

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

    it('renders search input when opened', () => {
        renderModal({ opened: true });
        expect(screen.getByTestId('insert-search')).toBeInTheDocument();
    });

    it('renders template list with groups', () => {
        renderModal({ opened: true });
        const list = screen.getByTestId('insert-list');
        expect(list).toBeInTheDocument();
        // should have some templates
        expect(list.querySelectorAll('[data-testid^="insert-item-"]').length).toBeGreaterThan(0);
    });

    it('filters templates by search query', () => {
        renderModal({ opened: true });
        const search = screen.getByTestId('insert-search');
        fireEvent.change(search, { target: { value: 'heading' } });
        const items = screen.getByTestId('insert-list').querySelectorAll('[data-testid^="insert-item-"]');
        // should only show heading templates
        for (const item of items) {
            expect(item.textContent?.toLowerCase()).toContain('heading');
        }
    });

    it('shows empty message when no templates match', () => {
        renderModal({ opened: true });
        const search = screen.getByTestId('insert-search');
        fireEvent.change(search, { target: { value: 'zzzznonexistent' } });
        expect(screen.getByText('No templates match your search')).toBeInTheDocument();
    });

    it('selecting a template enables the Insert button', () => {
        renderModal({ opened: true });
        const insert_button = screen.getByRole('button', { name: 'Insert' });
        expect(insert_button).toBeDisabled();
        // click a template
        const first_item = screen.getByTestId('insert-list').querySelector('[data-testid^="insert-item-"]')!;
        fireEvent.click(first_item);
        expect(insert_button).not.toBeDisabled();
    });

    it('clicking Insert calls onInsert with template content and closes', () => {
        const on_insert = jest.fn();
        const on_close = jest.fn();
        renderModal({ opened: true, onInsert: on_insert, onClose: on_close });
        // select the heading1 template
        fireEvent.click(screen.getByTestId('insert-item-heading1'));
        fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
        expect(on_insert).toHaveBeenCalledTimes(1);
        expect(on_insert.mock.calls[0][0]).toBe('# ');
        expect(on_close).toHaveBeenCalledTimes(1);
    });

    it('clicking Cancel calls onClose without inserting', () => {
        const on_close = jest.fn();
        const on_insert = jest.fn();
        renderModal({ opened: true, onClose: on_close, onInsert: on_insert });
        fireEvent.click(screen.getByText('Cancel'));
        expect(on_close).toHaveBeenCalledTimes(1);
        expect(on_insert).not.toHaveBeenCalled();
    });

    it('shows example content checkbox when template has example', () => {
        renderModal({ opened: true });
        // heading1 has example_content
        fireEvent.click(screen.getByTestId('insert-item-heading1'));
        expect(screen.getByLabelText(/Include example content/)).toBeInTheDocument();
    });

    it('inserts example content when checkbox is checked', () => {
        const on_insert = jest.fn();
        renderModal({ opened: true, onInsert: on_insert });
        fireEvent.click(screen.getByTestId('insert-item-heading1'));
        fireEvent.click(screen.getByLabelText(/Include example content/));
        fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
        expect(on_insert.mock.calls[0][0]).toContain('# Main heading');
    });

    it('does not show example checkbox for template without example', () => {
        renderModal({ opened: true });
        // linetag has no example_content
        fireEvent.click(screen.getByTestId('insert-item-linetag'));
        expect(screen.queryByLabelText(/Include example content/)).not.toBeInTheDocument();
    });

    it('shows position selector when template is selected', () => {
        renderModal({ opened: true });
        fireEvent.click(screen.getByTestId('insert-item-heading1'));
        expect(screen.getByText(/Position:/)).toBeInTheDocument();
    });

    it('defaults position to currentCaret', () => {
        renderModal({ opened: true });
        fireEvent.click(screen.getByTestId('insert-item-paragraph'));
        const select = screen.getByRole('combobox') as HTMLSelectElement;
        expect(select.value).toBe('currentCaret');
    });

    it('uses template default insert_point when available', () => {
        renderModal({ opened: true });
        // linetag defaults to endOfLine
        fireEvent.click(screen.getByTestId('insert-item-linetag'));
        const select = screen.getByRole('combobox') as HTMLSelectElement;
        expect(select.value).toBe('endOfLine');
    });

    it('passes selected position to onInsert', () => {
        const on_insert = jest.fn();
        renderModal({ opened: true, onInsert: on_insert });
        fireEvent.click(screen.getByTestId('insert-item-linetag'));
        fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
        expect(on_insert.mock.calls[0][1]).toBe('endOfLine');
    });
});
