import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ViewIntegrationSelector from './ViewIntegrationSelector';

describe('ViewIntegrationSelector', () => {

    it('renders with the persisted selection as the select value (auto)', () => {
        const handle_change = jest.fn();
        render(<ViewIntegrationSelector currentSelection="auto" resolvedMode="current_file" onChange={handle_change} />);
        const selector = screen.getByTestId('view-integration-selector') as HTMLSelectElement;
        expect(selector.value).toBe('auto');
    });

    it('renders an option per mode and labels the auto option with the resolved mode', () => {
        const handle_change = jest.fn();
        render(<ViewIntegrationSelector currentSelection="auto" resolvedMode="folder" onChange={handle_change} />);
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(3);
        expect(options[0]).toHaveTextContent('Auto (Folder)');
        expect(options[1]).toHaveTextContent('Current file');
        expect(options[2]).toHaveTextContent('Folder');
    });

    it('shows "Auto (Current file)" when auto resolved to current_file', () => {
        const handle_change = jest.fn();
        render(<ViewIntegrationSelector currentSelection="auto" resolvedMode="current_file" onChange={handle_change} />);
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveTextContent('Auto (Current file)');
    });

    it('calls onChange when the selection is changed', () => {
        const handle_change = jest.fn();
        render(<ViewIntegrationSelector currentSelection="auto" resolvedMode="current_file" onChange={handle_change} />);
        const selector = screen.getByTestId('view-integration-selector');
        fireEvent.change(selector, { target: { value: 'folder' } });
        expect(handle_change).toHaveBeenCalledWith('folder');
    });

    it('shows a concrete folder pin as the select value', () => {
        const handle_change = jest.fn();
        render(<ViewIntegrationSelector currentSelection="folder" resolvedMode="folder" onChange={handle_change} />);
        const selector = screen.getByTestId('view-integration-selector') as HTMLSelectElement;
        expect(selector.value).toBe('folder');
    });
});
