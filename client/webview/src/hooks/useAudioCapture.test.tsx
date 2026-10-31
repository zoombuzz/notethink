import React from 'react';
import { act, render } from '@testing-library/react';
import { useAudio, useAudioCapture } from './useAudioCapture';
import { isAudioStatePayload, shouldRunMicrophone, useAudioState } from './useAudioState';
import type { AudioState } from '../notethink-views/src/types/Messages';

const mock_instances: Array<{ start: jest.Mock; stop: jest.Mock; options: { onChunk: (c: unknown) => void; onStatus: (s: unknown) => void } }> = [];
let mock_worklet_url: string | undefined = 'https://example.com/audioWorklet.js';
let mock_frame_check: jest.Mock = jest.fn(async () => 'allowed');

jest.mock('../lib/audioCapture', () => ({
    ERROR_UNSUPPORTED: 'Unsupported',
    readAudioWorkletUrl: () => mock_worklet_url,
    readMicrophoneFrameEnv: () => ({}),
    checkMicrophoneFrame: () => mock_frame_check(),
    AudioCapture: jest.fn().mockImplementation((options) => {
        const instance = { start: jest.fn(async () => {}), stop: jest.fn(), options };
        mock_instances.push(instance);
        return instance;
    }),
}));

const ON: AudioState = { available: true, enabled: true, owner: true, capturing: false, dropped_count: 0 };

function Probe(props: { state: AudioState | undefined; count: number; post: (m: unknown) => void }): React.ReactElement {
    useAudioCapture(props.state, props.count, props.post);
    return <div />;
}

beforeEach(() => {
    mock_instances.length = 0;
    mock_worklet_url = 'https://example.com/audioWorklet.js';
    mock_frame_check = jest.fn(async () => 'allowed');
});

describe('shouldRunMicrophone truth table', () => {
    const cases: Array<[string, AudioState | undefined, number, boolean]> = [
        ['no state', undefined, 1, false],
        ['available false', { ...ON, available: false }, 1, false],
        ['disabled', { ...ON, enabled: false }, 1, false],
        ['not the owner', { ...ON, owner: false }, 1, false],
        ['an error is set', { ...ON, error_name: 'NotAllowedError' }, 1, false],
        ['no dot mounted', ON, 0, false],
        ['everything holds', ON, 1, true],
        ['several dots', ON, 3, true],
    ];
    it.each(cases)('%s', (_name, state, count, expected) => {
        expect(shouldRunMicrophone(state, count)).toBe(expected);
    });
});

describe('useAudioCapture', () => {
    it('never builds a capture, so never calls getUserMedia, when the feature is unavailable', () => {
        const get_user_media = jest.fn();
        Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: get_user_media }, configurable: true });
        const post = jest.fn();
        render(<Probe state={{ ...ON, available: false }} count={1} post={post} />);
        render(<Probe state={undefined} count={1} post={post} />);
        expect(mock_instances).toHaveLength(0);
        expect(get_user_media).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
    });

    it('starts when the gate opens and forwards chunks and status', () => {
        const post = jest.fn();
        render(<Probe state={ON} count={1} post={post} />);
        expect(mock_instances).toHaveLength(1);
        expect(mock_instances[0].start).toHaveBeenCalledTimes(1);
        const pcm = new Uint8Array(4);
        mock_instances[0].options.onChunk({ chunk_index: 2, started_at: 't', pcm });
        mock_instances[0].options.onStatus({ capturing: false, error_name: 'NotAllowedError' });
        expect(post).toHaveBeenCalledWith({ type: 'audioChunk', chunk_index: 2, started_at: 't', pcm });
        expect(post).toHaveBeenCalledWith({ type: 'audioCaptureStatus', capturing: false, error_name: 'NotAllowedError' });
    });

    it('stops when the dot count falls to 0, and starts again when one returns', () => {
        const post = jest.fn();
        const view = render(<Probe state={ON} count={1} post={post} />);
        view.rerender(<Probe state={ON} count={0} post={post} />);
        expect(mock_instances[0].stop).toHaveBeenCalledTimes(1);
        view.rerender(<Probe state={ON} count={1} post={post} />);
        expect(mock_instances).toHaveLength(2);
    });

    it('stops on ownership loss and on unmount', () => {
        const post = jest.fn();
        const view = render(<Probe state={ON} count={1} post={post} />);
        view.rerender(<Probe state={{ ...ON, owner: false }} count={1} post={post} />);
        expect(mock_instances[0].stop).toHaveBeenCalledTimes(1);
        view.rerender(<Probe state={ON} count={1} post={post} />);
        view.unmount();
        expect(mock_instances[1].stop).toHaveBeenCalledTimes(1);
    });

    it('never captures for a non-owner', () => {
        render(<Probe state={{ ...ON, owner: false }} count={2} post={jest.fn()} />);
        expect(mock_instances).toHaveLength(0);
    });

    it('does not restart after a reported error until the gate reopens', () => {
        const post = jest.fn();
        const view = render(<Probe state={ON} count={1} post={post} />);
        view.rerender(<Probe state={{ ...ON, error_name: 'NotAllowedError' }} count={1} post={post} />);
        view.rerender(<Probe state={{ ...ON, error_name: 'NotAllowedError', dropped_count: 1 }} count={1} post={post} />);
        expect(mock_instances).toHaveLength(1);
    });

    it('reports Unsupported when the worklet url is missing, without building a capture', () => {
        mock_worklet_url = undefined;
        const post = jest.fn();
        render(<Probe state={ON} count={1} post={post} />);
        expect(mock_instances).toHaveLength(0);
        expect(post).toHaveBeenCalledWith({ type: 'audioCaptureStatus', capturing: false, error_name: 'Unsupported' });
    });
});

describe('isAudioStatePayload', () => {
    it('accepts a full state and rejects malformed ones', () => {
        expect(isAudioStatePayload(ON)).toBe(true);
        expect(isAudioStatePayload({ ...ON, error_name: 'X' })).toBe(true);
        expect(isAudioStatePayload({ ...ON, available: 'yes' })).toBe(false);
        expect(isAudioStatePayload({ ...ON, error_name: 5 })).toBe(false);
        expect(isAudioStatePayload(null)).toBe(false);
    });
});

describe('useAudioState', () => {
    let api: ReturnType<typeof useAudioState>;
    function Host(props: { post: (m: unknown) => void }): React.ReactElement {
        api = useAudioState(props.post);
        return <div />;
    }

    it('stores the pushed state, ignores bad payloads, and posts toggles', () => {
        const post = jest.fn();
        render(<Host post={post} />);
        expect(api.audio_state).toBeUndefined();
        act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'audioState', state: ON } })); });
        expect(api.audio_state).toEqual(ON);
        act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'audioState', state: { nope: true } } })); });
        expect(api.audio_state).toEqual(ON);
        act(() => api.toggleAudio(false));
        expect(post).toHaveBeenCalledWith({ type: 'audioToggle', enabled: false });
    });

    it('counts mounted dots and never goes below 0', () => {
        render(<Host post={jest.fn()} />);
        act(() => api.reportAudioIndicatorPresence(true));
        act(() => api.reportAudioIndicatorPresence(true));
        expect(api.indicator_count).toBe(2);
        act(() => api.reportAudioIndicatorPresence(false));
        act(() => api.reportAudioIndicatorPresence(false));
        act(() => api.reportAudioIndicatorPresence(false));
        expect(api.indicator_count).toBe(0);
    });
});

describe('useAudio', () => {
    const post = jest.fn();
    let props: ReturnType<typeof useAudio>;
    function Host(): React.ReactElement {
        props = useAudio(post);
        return <div />;
    }

    async function pushState(state: AudioState): Promise<void> {
        await act(async () => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'audioState', state } })); });
    }

    it('runs the microphone only once a state arrives, the frame check passes and a dot reports in', async () => {
        render(<Host />);
        await pushState(ON);
        expect(props.audioState).toEqual(ON);
        expect(mock_instances).toHaveLength(0);
        act(() => props.reportAudioIndicatorPresence(true));
        expect(mock_instances).toHaveLength(1);
        act(() => props.reportAudioIndicatorPresence(false));
        expect(mock_instances[0].stop).toHaveBeenCalledTimes(1);
    });

    it('reports the feature unavailable and never builds a capture when the frame check refuses', async () => {
        mock_frame_check = jest.fn(async () => 'policy-refuses');
        render(<Host />);
        await pushState(ON);
        expect(props.audioState).toMatchObject({ available: false });
        act(() => props.reportAudioIndicatorPresence(true));
        expect(mock_instances).toHaveLength(0);
    });

    it('reports the feature unavailable while the frame check is still running', async () => {
        mock_frame_check = jest.fn(() => new Promise<string>(() => {}));
        render(<Host />);
        await pushState(ON);
        expect(props.audioState).toMatchObject({ available: false });
        act(() => props.reportAudioIndicatorPresence(true));
        expect(mock_instances).toHaveLength(0);
    });

    it('does not check the frame until the extension reports the feature available, then checks once', async () => {
        render(<Host />);
        await pushState({ ...ON, available: false });
        expect(mock_frame_check).not.toHaveBeenCalled();
        await pushState(ON);
        await pushState({ ...ON, available: false });
        await pushState(ON);
        expect(mock_frame_check).toHaveBeenCalledTimes(1);
        expect(props.audioState).toEqual(ON);
    });

    it('reports the verdict to the extension once, so a hidden control can be explained in its log', async () => {
        mock_frame_check = jest.fn(async () => 'policy-refuses');
        post.mockClear();
        render(<Host />);
        await pushState(ON);
        await pushState({ ...ON, dropped_count: 1 });
        const reports = post.mock.calls.map((call) => call[0]).filter((message) => message.type === 'audioFrameCheck');
        expect(reports).toEqual([{ type: 'audioFrameCheck', verdict: 'policy-refuses' }]);
    });
});
