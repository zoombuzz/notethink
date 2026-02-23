import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MermaidDiagram } from './MermaidDiagram';

// mock mermaid library
jest.mock('mermaid', () => ({
    __esModule: true,
    default: {
        initialize: jest.fn(),
        render: jest.fn(),
    },
}));

import mermaid from 'mermaid';

const mock_mermaid = mermaid as jest.Mocked<typeof mermaid>;

describe('MermaidDiagram', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        (mock_mermaid.render as jest.Mock).mockResolvedValue({ svg: '<svg>diagram</svg>' });
    });

    it('renders a container element', () => {
        render(<MermaidDiagram>graph TD; A--&gt;B</MermaidDiagram>);
        // the component renders a div, not a specific test id by default
        const containers = document.querySelectorAll('[id$="-mermaid"]');
        expect(containers.length).toBeGreaterThan(0);
    });

    it('applies className to container', () => {
        const { container } = render(
            <MermaidDiagram className="test-class">graph TD; A--&gt;B</MermaidDiagram>
        );
        const diagram = container.firstChild as HTMLElement;
        expect(diagram.className).toBe('test-class');
    });

    it('applies custom id to container', () => {
        render(<MermaidDiagram id="custom">graph TD; A--&gt;B</MermaidDiagram>);
        expect(document.getElementById('custom-mermaid')).toBeInTheDocument();
    });

    it('applies testId to container', () => {
        render(<MermaidDiagram testId="my-diagram">graph TD; A--&gt;B</MermaidDiagram>);
        expect(screen.getByTestId('my-diagram')).toBeInTheDocument();
    });

    it('calls mermaid.initialize on mount', () => {
        render(<MermaidDiagram>graph TD; A--&gt;B</MermaidDiagram>);
        expect(mock_mermaid.initialize).toHaveBeenCalledWith(
            expect.objectContaining({ startOnLoad: true })
        );
    });

    it('calls mermaid.render with diagram text', async () => {
        render(<MermaidDiagram>graph TD; A--&gt;B</MermaidDiagram>);
        await waitFor(() => {
            expect(mock_mermaid.render).toHaveBeenCalledWith(
                expect.stringContaining('-mermaid-svg'),
                'graph TD; A-->B'
            );
        });
    });

    it('handles click events', () => {
        const on_click = jest.fn();
        render(
            <MermaidDiagram testId="clickable" onClick={on_click}>
                graph TD; A--&gt;B
            </MermaidDiagram>
        );
        fireEvent.click(screen.getByTestId('clickable'));
        expect(on_click).toHaveBeenCalledTimes(1);
    });

    it('calls onError when mermaid.render fails', async () => {
        const on_error = jest.fn();
        (mock_mermaid.render as jest.Mock).mockRejectedValue(new Error('Parse error'));
        render(
            <MermaidDiagram onError={on_error}>invalid diagram</MermaidDiagram>
        );
        await waitFor(() => {
            expect(on_error).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    it('does not call mermaid.render for empty text', () => {
        (mock_mermaid.render as jest.Mock).mockClear();
        render(<MermaidDiagram>{''}</MermaidDiagram>);
        expect(mock_mermaid.render).not.toHaveBeenCalled();
    });
});
