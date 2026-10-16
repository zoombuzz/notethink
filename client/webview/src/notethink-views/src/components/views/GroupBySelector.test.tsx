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

    it('labels the option matching the inherited value, whether or not it is also the current selection', () => {
        render(<GroupBySelector {...base} selection="assignee" inheritedValue="status" />);
        const select = screen.getByTestId('group-by-selector') as HTMLSelectElement;
        const option_labels = Array.from(select.options).map(o => o.textContent);
        expect(option_labels).toContain('Status (inherited)');
        expect(option_labels).not.toContain('Status');
    });

    it('labels auto itself "(inherited)" when auto is what the view would inherit', () => {
        render(<GroupBySelector {...base} inheritedValue="auto" />);
        const select = screen.getByTestId('group-by-selector') as HTMLSelectElement;
        expect(select.options[0].textContent).toBe('Auto (First Level Folder) (inherited)');
    });

    it('labels no option when there is no inherited value to mark', () => {
        render(<GroupBySelector {...base} />);
        const select = screen.getByTestId('group-by-selector') as HTMLSelectElement;
        const option_labels = Array.from(select.options).map(o => o.textContent);
        expect(option_labels.some(label => label?.includes('(inherited)'))).toBe(false);
    });
});
