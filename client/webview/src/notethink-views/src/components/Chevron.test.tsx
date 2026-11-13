import React from 'react';
import { render, screen } from '@testing-library/react';
import Chevron from './Chevron';

describe('Chevron', () => {
    it('draws one decorative svg mark hidden from assistive tech', () => {
        render(<Chevron direction="right" testId="mark" />);
        const mark = screen.getByTestId('mark');
        expect(mark.tagName.toLowerCase()).toBe('svg');
        expect(mark).toHaveAttribute('aria-hidden', 'true');
        expect(mark.querySelectorAll('path')).toHaveLength(1);
    });

    it.each(['right', 'down', 'up'] as const)('publishes its %s direction as data and as a distinct class', (direction) => {
        render(<Chevron direction={direction} testId={`mark-${direction}`} />);
        const mark = screen.getByTestId(`mark-${direction}`);
        expect(mark).toHaveAttribute('data-direction', direction);
        expect(mark.getAttribute('class')).toContain('chevron');
    });
});
