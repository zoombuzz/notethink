import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ViewIntegrationSelector from './ViewIntegrationSelector';

describe('ViewIntegrationSelector', () => {

    it('renders with default current_file mode', () => {
        const handle_change = jest.fn();
        render(<ViewIntegrationSelector currentMode="current_file" onChange={handle_change} />);
        const selector = screen.getByTestId('view-integration-selector') as HTMLSelectElement;
        expect(selector.value).toBe('current_file');
    });

    it('displays correct labels for each mode', () => {
        const handle_change = jest.fn();
        render(<ViewIntegrationSelector currentMode="current_file" onChange={handle_change} />);
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(2);
        expect(options[0]).toHaveTextContent('Current file');
        expect(options[1]).toHaveTextContent('Folder');
    });

    it('calls onChange when mode is changed', () => {
        const handle_change = jest.fn();
        render(<ViewIntegrationSelector currentMode="current_file" onChange={handle_change} />);
        const selector = screen.getByTestId('view-integration-selector');
        fireEvent.change(selector, { target: { value: 'folder' } });
        expect(handle_change).toHaveBeenCalledWith('folder');
    });

    it('shows folder mode when selected', () => {
        const handle_change = jest.fn();
        render(<ViewIntegrationSelector currentMode="folder" onChange={handle_change} />);
        const selector = screen.getByTestId('view-integration-selector') as HTMLSelectElement;
        expect(selector.value).toBe('folder');
    });
});
