import React from 'react';
import { render } from '@testing-library/react';
import App from './App';

// mock NoteRenderer to avoid ESM-only dependencies in unit tests
jest.mock('../NoteRenderer', () => ({
    __esModule: true,
    default: () => <div data-testid="NoteRenderer" />,
}));

// acquireVsCodeApi mock is provided by setupEnv.js

describe('App', () => {
    it('renders app container', () => {
        render(<App />);
        const app_container = document.querySelector('.App');
        expect(app_container).toBeInTheDocument();
    });
});
