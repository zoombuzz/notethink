import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import GroupBySelector, { groupByKeyLabel } from './GroupBySelector';

describe('groupByKeyLabel', () => {
    it('title-cases an authored attribute key', () => {
        expect(groupByKeyLabel('assignee')).toBe('Assignee');
    });

    it('strips the nt_ prefix and words the implicit folder key', () => {
        expect(groupByKeyLabel('nt_first_level_folder')).toBe('First Level Folder');
    });

    it('strips the ng_ legacy prefix too', () => {
        expect(groupByKeyLabel('ng_first_level_folder')).toBe('First Level Folder');
    });
});

describe('GroupBySelector', () => {
    const base = { selection: 'auto', resolvedKey: 'nt_first_level_folder', candidateKeys: ['assignee', 'status'], onChange: jest.fn() };

    it('labels the auto option with the resolved key and lists the categorical candidates', () => {
        render(<GroupBySelector {...base} />);
        const select = screen.getByTestId('group-by-selector') as HTMLSelectElement;
        const option_labels = Array.from(select.options).map(o => o.textContent);
        expect(option_labels).toContain('Auto (First Level Folder)');
        expect(option_labels).toContain('Assignee');
        expect(option_labels).toContain('Status');
    });

    it('dispatches onChange with the picked candidate key', () => {
        const on_change = jest.fn();
        render(<GroupBySelector {...base} onChange={on_change} />);
        fireEvent.change(screen.getByTestId('group-by-selector'), { target: { value: 'assignee' } });
        expect(on_change).toHaveBeenCalledWith('assignee');
    });

    it('renders disabled and pinned to the fixed value, naming the unlocking view', () => {
        render(<GroupBySelector selection="auto" resolvedKey="status" candidateKeys={['status']} fixed fixedValue="status" unlockView="line" onChange={jest.fn()} />);
        const select = screen.getByTestId('group-by-selector') as HTMLSelectElement;
        expect(select).toBeDisabled();
        expect(select.value).toBe('status');
        expect(screen.getByTestId('group-by-fixed-hint')).toBeInTheDocument();
    });
});
