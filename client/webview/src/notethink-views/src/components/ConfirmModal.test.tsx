import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ConfirmModal from './ConfirmModal';

beforeAll(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
        this.removeAttribute('open');
    });
});

function renderModal(opened: boolean): { confirm: jest.Mock; cancel: jest.Mock; rerender: (next: boolean) => void } {
    const confirm = jest.fn();
    const cancel = jest.fn();
    const ui = (is_open: boolean): React.ReactElement => <ConfirmModal opened={is_open} title="Send it" message="Really send it?" onConfirm={confirm} onCancel={cancel} />;
    const view = render(ui(opened));
    return { confirm, cancel, rerender: next => view.rerender(ui(next)) };
}

describe('ConfirmModal', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('stays closed until opened, then shows its title and message', () => {
        const { rerender } = renderModal(false);
        expect(screen.getByTestId('confirm-modal')).not.toHaveAttribute('open');
        rerender(true);
        expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('heading', { name: 'Send it' })).toBeInTheDocument();
        expect(screen.getByText('Really send it?')).toBeInTheDocument();
    });

    it('OK confirms once and cancels nothing', () => {
        const { confirm, cancel } = renderModal(true);
        fireEvent.click(screen.getByTestId('confirm-modal-ok'));
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(cancel).not.toHaveBeenCalled();
    });

    it('Cancel cancels and confirms nothing', () => {
        const { confirm, cancel } = renderModal(true);
        fireEvent.click(screen.getByTestId('confirm-modal-cancel'));
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(confirm).not.toHaveBeenCalled();
    });

    it('Escape cancels without closing the dialog itself', () => {
        const { confirm, cancel } = renderModal(true);
        const escape = new Event('cancel', { bubbles: false, cancelable: true });
        screen.getByTestId('confirm-modal').dispatchEvent(escape);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(escape.defaultPrevented).toBe(true);
        expect(confirm).not.toHaveBeenCalled();
    });

    it('a click on the backdrop cancels, and a click inside the box does not', () => {
        const { confirm, cancel } = renderModal(true);
        const dialog = screen.getByTestId('confirm-modal');
        dialog.getBoundingClientRect = () => ({ left: 100, right: 300, top: 100, bottom: 200, width: 200, height: 100, x: 100, y: 100, toJSON: () => ({}) });
        fireEvent.click(dialog, { clientX: 150, clientY: 150 });
        expect(cancel).not.toHaveBeenCalled();
        fireEvent.click(dialog, { clientX: 10, clientY: 10 });
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(confirm).not.toHaveBeenCalled();
    });

    it('closes the native dialog when opened goes false', () => {
        const { rerender } = renderModal(true);
        rerender(false);
        expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    });
});
