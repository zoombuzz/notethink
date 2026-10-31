import Debug from 'debug';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioCapture, checkMicrophoneFrame, ERROR_UNSUPPORTED, readAudioWorkletUrl, readMicrophoneFrameEnv } from '../lib/audioCapture';
import { applyFrameCheck, isAudioAvailable } from '../notethink-views/src/lib/audiostateops';
import { shouldRunMicrophone, useAudioState } from './useAudioState';
import type { AudioState } from '../notethink-views/src/types/Messages';

const debug = Debug('nodejs:notethink:useAudioCapture');

/**
 * Runs the microphone while shouldRunMicrophone holds and stops it the moment it does not, and on unmount.
 * Chunks go to the extension as audioChunk, and every status change as audioCaptureStatus. A refused or
 * missing microphone is reported once with its error name; the extension then clears the gate, so there is
 * no retry until the user toggles again.
 */
export function useAudioCapture(
    audio_state: AudioState | undefined,
    indicator_count: number,
    postMessage: (message: unknown) => void,
): void {
    const should_run = shouldRunMicrophone(audio_state, indicator_count);
    useEffect(() => {
        if (!should_run) { return undefined; }
        const worklet_url = readAudioWorkletUrl();
        if (!worklet_url) {
            debug('no worklet url, reporting %s', ERROR_UNSUPPORTED);
            postMessage({ type: 'audioCaptureStatus', capturing: false, error_name: ERROR_UNSUPPORTED });
            return undefined;
        }
        const capture = new AudioCapture({
            worklet_url,
            onChunk: (chunk) => postMessage({ type: 'audioChunk', chunk_index: chunk.chunk_index, started_at: chunk.started_at, pcm: chunk.pcm }),
            onStatus: (status) => postMessage({
                type: 'audioCaptureStatus',
                capturing: status.capturing,
                ...(status.error_name ? { error_name: status.error_name } : {}),
            }),
        });
        void capture.start();
        return () => capture.stop();
    }, [should_run, postMessage]);
}

/** The audio props NoteRenderer passes down to every view. */
export interface AudioRendererProps {
    audioState: AudioState | undefined;
    toggleAudio: (enabled: boolean) => void;
    reportAudioIndicatorPresence: (present: boolean) => void;
}

/**
 * Runs checkMicrophoneFrame once, the first time `should_check` holds, reports the verdict to the extension
 * as audioFrameCheck so a hidden control can be explained in its log, and returns whether the frame allows
 * capture: undefined until then and while it runs. One answer serves the webview's lifetime, so a refusal
 * at the browser's own prompt later shows as an error on the control rather than hiding it.
 */
export function useMicrophoneFrameCheck(should_check: boolean, postMessage: (message: unknown) => void): boolean | undefined {
    const [frame_allows, setFrameAllows] = useState<boolean | undefined>(undefined);
    const started_ref = useRef(false);
    const mounted_ref = useRef(true);
    const post_ref = useRef(postMessage);
    useEffect(() => {
        post_ref.current = postMessage;
    }, [postMessage]);
    useEffect(() => {
        mounted_ref.current = true;
        return () => { mounted_ref.current = false; };
    }, []);
    useEffect(() => {
        if (!should_check || started_ref.current) { return; }
        started_ref.current = true;
        checkMicrophoneFrame(readMicrophoneFrameEnv()).then(
            (verdict) => {
                debug('microphone frame check: %s', verdict);
                post_ref.current({ type: 'audioFrameCheck', verdict });
                if (mounted_ref.current) { setFrameAllows(verdict === 'allowed'); }
            },
            (err: unknown) => {
                debug('microphone frame check failed: %O', err);
                if (mounted_ref.current) { setFrameAllows(false); }
            },
        );
    }, [should_check]);
    return frame_allows;
}

/**
 * Wires the audio state, this frame's microphone check, the dot count and the microphone gate together and
 * returns the props for the renderer. The renderer and the capture gate read the same frame-checked state,
 * so a frame that fails the check shows no control and never requests the microphone.
 * Call it before the document message hook, so the audio listener is attached before the initial-state request goes out.
 */
export function useAudio(postMessage: (message: unknown) => void): AudioRendererProps {
    const { audio_state, indicator_count, toggleAudio, reportAudioIndicatorPresence } = useAudioState(postMessage);
    const frame_allows = useMicrophoneFrameCheck(isAudioAvailable(audio_state), postMessage);
    const checked_state = useMemo(() => applyFrameCheck(audio_state, frame_allows), [audio_state, frame_allows]);
    useAudioCapture(checked_state, indicator_count, postMessage);
    return { audioState: checked_state, toggleAudio, reportAudioIndicatorPresence };
}
