import React from 'react';
import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen } from '@testing-library/react';
import * as sass from 'sass';
import type { AudioState } from '../../../types/Messages';
import AudioRecordingControl from './AudioRecordingControl';

const SCSS_PATH = path.join(__dirname, 'AudioRecordingControl.module.scss');

function makeState(overrides: Partial<AudioState> = {}): AudioState {
    return { available: true, enabled: true, owner: true, capturing: true, dropped_count: 0, ...overrides };
}

describe('AudioRecordingControl', () => {
    it('renders 0 elements when the feature is unavailable', () => {
        const { container } = render(<AudioRecordingControl state={makeState({ available: false })} />);
        expect(container.childElementCount).toBe(0);
        expect(container.innerHTML).toBe('');
    });

    it('renders 0 elements before any state has arrived', () => {
        const { container } = render(<AudioRecordingControl state={undefined} />);
        expect(container.innerHTML).toBe('');
    });

    it('shows the dot inside a status region named by "Recording audio" when on', () => {
        render(<AudioRecordingControl state={makeState()} />);
        expect(screen.getByRole('status')).toHaveTextContent('Recording audio');
        expect(screen.getByTestId('audio-recording-dot')).toBeInTheDocument();
        expect(screen.getByTestId('audio-recording-dot')).toHaveAttribute('title', 'Recording audio');
    });

    it('keeps the status region but removes the dot and its text when off', () => {
        render(<AudioRecordingControl state={makeState({ enabled: false })} />);
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
        expect(screen.queryByTestId('audio-recording-dot')).not.toBeInTheDocument();
    });

    it('shows the error name as visible text, reads the toggle as off and removes the dot', () => {
        render(<AudioRecordingControl state={makeState({ error_name: 'NotAllowedError' })} />);
        expect(screen.getByTestId('audio-error')).toHaveTextContent('Microphone unavailable: NotAllowedError');
        expect(screen.getByRole('status')).toHaveTextContent('Microphone unavailable: NotAllowedError');
        expect(screen.getByTestId('audio-toggle')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByTestId('audio-recording-dot')).not.toBeInTheDocument();
    });

    describe('toggle', () => {
        it('is a native button with aria-pressed that follows the state and changes its wording', () => {
            const { rerender } = render(<AudioRecordingControl state={makeState({ enabled: false })} />);
            const toggle = screen.getByTestId('audio-toggle');
            expect(toggle.tagName).toBe('BUTTON');
            expect(toggle).toHaveAttribute('type', 'button');
            expect(toggle).toHaveAttribute('aria-pressed', 'false');
            expect(toggle).toHaveTextContent('Record audio');
            rerender(<AudioRecordingControl state={makeState()} />);
            expect(toggle).toHaveAttribute('aria-pressed', 'true');
            expect(toggle).toHaveTextContent('Stop recording');
        });

        it('is reachable by keyboard focus', () => {
            render(<AudioRecordingControl state={makeState()} />);
            const toggle = screen.getByTestId('audio-toggle');
            expect(toggle.tabIndex).toBeGreaterThanOrEqual(0);
            toggle.focus();
            expect(toggle).toHaveFocus();
        });

        it('asks for on when off, and for off when on', () => {
            const onToggle = jest.fn();
            const { rerender } = render(<AudioRecordingControl state={makeState({ enabled: false })} onToggle={onToggle} />);
            fireEvent.click(screen.getByTestId('audio-toggle'));
            expect(onToggle).toHaveBeenLastCalledWith(true);
            rerender(<AudioRecordingControl state={makeState()} onToggle={onToggle} />);
            fireEvent.click(screen.getByTestId('audio-toggle'));
            expect(onToggle).toHaveBeenLastCalledWith(false);
            expect(onToggle).toHaveBeenCalledTimes(2);
        });

        it('asks for on again after a failure, which is the retry', () => {
            const onToggle = jest.fn();
            render(<AudioRecordingControl state={makeState({ error_name: 'NotFoundError' })} onToggle={onToggle} />);
            fireEvent.click(screen.getByTestId('audio-toggle'));
            expect(onToggle).toHaveBeenCalledWith(true);
        });

        it('does not let the click reach a parent handler', () => {
            const parent_click = jest.fn();
            render(<div onClick={parent_click}><AudioRecordingControl state={makeState()} /></div>);
            fireEvent.click(screen.getByTestId('audio-toggle'));
            expect(parent_click).not.toHaveBeenCalled();
        });
    });

    describe('presence reporting', () => {
        it('reports true when the dot mounts and false when it unmounts', () => {
            const onPresence = jest.fn();
            const { unmount } = render(<AudioRecordingControl state={makeState()} onPresence={onPresence} />);
            expect(onPresence.mock.calls).toEqual([[true]]);
            unmount();
            expect(onPresence.mock.calls).toEqual([[true], [false]]);
        });

        it('reports false when recording turns off and true when it turns on again', () => {
            const onPresence = jest.fn();
            const { rerender } = render(<AudioRecordingControl state={makeState()} onPresence={onPresence} />);
            rerender(<AudioRecordingControl state={makeState({ enabled: false })} onPresence={onPresence} />);
            rerender(<AudioRecordingControl state={makeState()} onPresence={onPresence} />);
            expect(onPresence.mock.calls).toEqual([[true], [false], [true]]);
        });

        it('reports false when the feature becomes unavailable or a failure arrives', () => {
            const onPresence = jest.fn();
            const { rerender } = render(<AudioRecordingControl state={makeState()} onPresence={onPresence} />);
            rerender(<AudioRecordingControl state={makeState({ error_name: 'NotAllowedError' })} onPresence={onPresence} />);
            expect(onPresence.mock.calls).toEqual([[true], [false]]);
            rerender(<AudioRecordingControl state={makeState()} onPresence={onPresence} />);
            rerender(<AudioRecordingControl state={makeState({ available: false })} onPresence={onPresence} />);
            expect(onPresence.mock.calls).toEqual([[true], [false], [true], [false]]);
        });

        it('does not report a gap when the callback identity changes on a re-render', () => {
            const first = jest.fn();
            const second = jest.fn();
            const { rerender, unmount } = render(<AudioRecordingControl state={makeState()} onPresence={first} />);
            rerender(<AudioRecordingControl state={makeState({ dropped_count: 3 })} onPresence={second} />);
            expect(first.mock.calls).toEqual([[true]]);
            expect(second).not.toHaveBeenCalled();
            unmount();
            expect(second.mock.calls).toEqual([[false]]);
        });

        it('never reports while off, unavailable or failed', () => {
            const onPresence = jest.fn();
            render(<AudioRecordingControl state={makeState({ enabled: false })} onPresence={onPresence} />);
            render(<AudioRecordingControl state={makeState({ available: false })} onPresence={onPresence} />);
            render(<AudioRecordingControl state={makeState({ error_name: 'NotAllowedError' })} onPresence={onPresence} />);
            expect(onPresence).not.toHaveBeenCalled();
        });
    });
});

/*
 * CSS modules are mapped to identity-obj-proxy in Jest, so the stylesheet is compiled with sass here
 * and the compiled rules are read as text. This measures the stylesheet's rules, not a browser's
 * computed style; the Playwright spec measures the computed animation-name.
 */
describe('AudioRecordingControl.module.scss', () => {
    const compiled_css = sass.compile(SCSS_PATH).css;

    it('compiles from the file on disk', () => {
        expect(fs.existsSync(SCSS_PATH)).toBe(true);
        expect(compiled_css).toContain('.audioDot');
    });

    it('pulses the dot slowly (1.6s ease, infinite) outside the reduced-motion rule', () => {
        const before_media = compiled_css.split('@media')[0];
        const dot_rule = /\.audioDot\s*\{([^}]*)\}/.exec(before_media);
        expect(dot_rule).not.toBeNull();
        expect(dot_rule?.[1]).toMatch(/animation:\s*audioDotPulse\s+1\.6s\s+ease\s+infinite/);
    });

    it('sets animation: none on the dot under prefers-reduced-motion: reduce and does not hide it', () => {
        const media = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(compiled_css);
        expect(media).not.toBeNull();
        const dot_rule = /\.audioDot\s*\{([^}]*)\}/.exec(media?.[1] ?? '');
        expect(dot_rule).not.toBeNull();
        expect(dot_rule?.[1]).toMatch(/animation:\s*none/);
        expect(dot_rule?.[1]).not.toMatch(/display:\s*none|visibility:\s*hidden|opacity:\s*0\b/);
    });
});
