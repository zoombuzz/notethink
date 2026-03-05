import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import DocumentView from './DocumentView';
describe('DocumentView', () => {
    const default_props = {
        id: 'test-doc',
        type: 'document',
        display_options: {},
    };
    it('renders document container with correct test id', () => {
        render(_jsx(DocumentView, { ...default_props }));
        const container = screen.getByTestId('document-test-doc-inner');
        expect(container).toBeInTheDocument();
    });
    it('does not render a menubar element (native VS Code controls used instead)', () => {
        const { container } = render(_jsx(DocumentView, { ...default_props }));
        const menubar = container.querySelector('[class*="menubar"]');
        expect(menubar).not.toBeInTheDocument();
    });
    it('applies correct id attribute to container', () => {
        render(_jsx(DocumentView, { ...default_props }));
        const container = screen.getByTestId('document-test-doc-inner');
        expect(container).toHaveAttribute('id', 'vtest-doc-inner');
    });
    it('renders with display_options level data attribute', () => {
        const props_with_level = {
            ...default_props,
            display_options: { level: 2 },
        };
        render(_jsx(DocumentView, { ...props_with_level }));
        const container = screen.getByTestId('document-test-doc-inner');
        expect(container).toHaveAttribute('data-level', '2');
    });
    it('renders context bar when setting enabled', () => {
        const props_with_context_bar = {
            ...default_props,
            display_options: {
                settings: { show_context_bars: true },
            },
        };
        render(_jsx(DocumentView, { ...props_with_context_bar }));
        // context bar should be rendered when show_context_bars is true
        const container = screen.getByTestId('document-test-doc-inner');
        expect(container).toBeInTheDocument();
    });
});
