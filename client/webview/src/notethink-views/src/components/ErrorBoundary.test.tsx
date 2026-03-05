import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

// Suppress console.error noise from React and our componentDidCatch during tests
const original_console_error = console.error;
beforeAll(() => {
    console.error = jest.fn();
});
afterAll(() => {
    console.error = original_console_error;
});

function GoodChild() {
    return <div data-testid="good-child">Hello</div>;
}

function ThrowingChild({ message }: { message: string }): React.ReactElement {
    throw new Error(message);
}

describe('ErrorBoundary', () => {

    it('renders children when no error is thrown', () => {
        render(
            <ErrorBoundary>
                <GoodChild />
            </ErrorBoundary>
        );
        expect(screen.getByTestId('good-child')).toBeInTheDocument();
        expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument();
    });

    it('renders fallback UI with error message when child throws', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild message="test render failure" />
            </ErrorBoundary>
        );
        expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
        expect(screen.getByText('Something went wrong rendering this view')).toBeInTheDocument();
        expect(screen.getByText('test render failure')).toBeInTheDocument();
    });

    it('shows stack trace in an expandable details element', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild message="stack trace test" />
            </ErrorBoundary>
        );
        const details = screen.getByText('Stack trace').closest('details');
        expect(details).toBeInTheDocument();
        // The pre element inside details should contain the error stack
        const pre = details?.querySelector('pre');
        expect(pre).toBeInTheDocument();
        expect(pre?.textContent).toContain('stack trace test');
    });

    it('"Try Again" button resets error state and re-renders children', () => {
        let should_throw = true;

        function ConditionalChild() {
            if (should_throw) {
                throw new Error('conditional failure');
            }
            return <div data-testid="recovered-child">Recovered</div>;
        }

        render(
            <ErrorBoundary>
                <ConditionalChild />
            </ErrorBoundary>
        );

        // Fallback is shown
        expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
        expect(screen.queryByTestId('recovered-child')).not.toBeInTheDocument();

        // Fix the child so it won't throw on re-render
        should_throw = false;

        // Click "Try Again"
        fireEvent.click(screen.getByText('Try Again'));

        // Children render successfully
        expect(screen.getByTestId('recovered-child')).toBeInTheDocument();
        expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument();
    });
});
