import { jsx as _jsx } from "react/jsx-runtime";
import { render } from '@testing-library/react';
import App from './App';
// mock NoteRenderer to avoid ESM-only dependencies in unit tests
jest.mock('../NoteRenderer', () => ({
    __esModule: true,
    default: () => _jsx("div", { "data-testid": "NoteRenderer" }),
}));
// acquireVsCodeApi mock is provided by setupEnv.js
describe('App', () => {
    it('renders app container', () => {
        const { container } = render(_jsx(App, {}));
        expect(container.firstChild).toBeInTheDocument();
    });
});
