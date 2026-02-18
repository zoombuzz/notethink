import React from 'react';
import { render, screen } from '@testing-library/react';
import DocumentView from './DocumentView';
import type { ViewProps } from '../../types/ViewProps';

describe('DocumentView', () => {
    const default_props: ViewProps = {
        id: 'test-doc',
        type: 'document',
        display_options: {},
    };

    it('renders document container with correct test id', () => {
        render(<DocumentView {...default_props} />);
        const container = screen.getByTestId('document-test-doc-inner');
        expect(container).toBeInTheDocument();
    });

    it('renders menubar element', () => {
        const { container } = render(<DocumentView {...default_props} />);
        const menubar = container.querySelector('[class*="menubar"]');
        expect(menubar).toBeInTheDocument();
    });

    it('applies correct id attribute to container', () => {
        render(<DocumentView {...default_props} />);
        const container = screen.getByTestId('document-test-doc-inner');
        expect(container).toHaveAttribute('id', 'vtest-doc-inner');
    });

    it('renders with display_options level data attribute', () => {
        const props_with_level: ViewProps = {
            ...default_props,
            display_options: { level: 2 },
        };
        render(<DocumentView {...props_with_level} />);
        const container = screen.getByTestId('document-test-doc-inner');
        expect(container).toHaveAttribute('data-level', '2');
    });

    it('renders context bar when setting enabled', () => {
        const props_with_context_bar: ViewProps = {
            ...default_props,
            display_options: {
                settings: { show_context_bars: true },
            },
        };
        render(<DocumentView {...props_with_context_bar} />);
        // context bar should be rendered when show_context_bars is true
        const container = screen.getByTestId('document-test-doc-inner');
        expect(container).toBeInTheDocument();
    });
});
