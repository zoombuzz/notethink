import { jsx as _jsx } from "react/jsx-runtime";
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
const mock_mermaid = mermaid;
describe('MermaidDiagram', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mock_mermaid.render.mockResolvedValue({ svg: '<svg>diagram</svg>' });
    });
    it('renders a container element', () => {
        render(_jsx(MermaidDiagram, { children: "graph TD; A-->B" }));
        // the component renders a div, not a specific test id by default
        const containers = document.querySelectorAll('[id$="-mermaid"]');
        expect(containers.length).toBeGreaterThan(0);
    });
    it('applies className to container', () => {
        const { container } = render(_jsx(MermaidDiagram, { className: "test-class", children: "graph TD; A-->B" }));
        const diagram = container.firstChild;
        expect(diagram.className).toBe('test-class');
    });
    it('applies custom id to container', () => {
        render(_jsx(MermaidDiagram, { id: "custom", children: "graph TD; A-->B" }));
        expect(document.getElementById('custom-mermaid')).toBeInTheDocument();
    });
    it('applies testId to container', () => {
        render(_jsx(MermaidDiagram, { testId: "my-diagram", children: "graph TD; A-->B" }));
        expect(screen.getByTestId('my-diagram')).toBeInTheDocument();
    });
    it('calls mermaid.initialize on mount', () => {
        render(_jsx(MermaidDiagram, { children: "graph TD; A-->B" }));
        expect(mock_mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: true }));
    });
    it('calls mermaid.render with diagram text', async () => {
        render(_jsx(MermaidDiagram, { children: "graph TD; A-->B" }));
        await waitFor(() => {
            expect(mock_mermaid.render).toHaveBeenCalledWith(expect.stringContaining('-mermaid-svg'), 'graph TD; A-->B');
        });
    });
    it('handles click events', () => {
        const on_click = jest.fn();
        render(_jsx(MermaidDiagram, { testId: "clickable", onClick: on_click, children: "graph TD; A-->B" }));
        fireEvent.click(screen.getByTestId('clickable'));
        expect(on_click).toHaveBeenCalledTimes(1);
    });
    it('calls onError when mermaid.render fails', async () => {
        const on_error = jest.fn();
        mock_mermaid.render.mockRejectedValue(new Error('Parse error'));
        render(_jsx(MermaidDiagram, { onError: on_error, children: "invalid diagram" }));
        await waitFor(() => {
            expect(on_error).toHaveBeenCalledWith(expect.any(Error));
        });
    });
    it('does not call mermaid.render for empty text', () => {
        mock_mermaid.render.mockClear();
        render(_jsx(MermaidDiagram, { children: '' }));
        expect(mock_mermaid.render).not.toHaveBeenCalled();
    });
});
