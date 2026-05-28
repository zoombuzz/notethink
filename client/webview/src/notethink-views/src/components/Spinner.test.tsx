import React from 'react';
import { render, screen } from '@testing-library/react';
import Spinner from './Spinner';

describe('Spinner', () => {
    it('renders an SVG with the testid hook', () => {
        render(<Spinner />);
        const spinner = screen.getByTestId('pending-work-spinner');
        expect(spinner).toBeInTheDocument();
        expect(spinner.querySelector('svg')).toBeInTheDocument();
    });

    it('uses the default aria-label "Working" when none is provided', () => {
        render(<Spinner />);
        expect(screen.getByTestId('pending-work-spinner')).toHaveAttribute('aria-label', 'Working');
    });

    it('applies a positionClass when provided', () => {
        render(<Spinner positionClass="InlineLoader" />);
        const spinner = screen.getByTestId('pending-work-spinner');
        // class names are CSS-module hashed; the InlineLoader-suffixed token must appear
        expect(spinner.className).toMatch(/InlineLoader/);
    });

    it('has role status for screen-reader announcement', () => {
        render(<Spinner />);
        const spinner = screen.getByRole('status');
        expect(spinner).toBeInTheDocument();
    });
});
