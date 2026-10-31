import { useCallback, useEffect, useState } from 'react';
import { isAudioRecordingOn } from '../notethink-views/src/lib/audiostateops';
import type { AudioState } from '../notethink-views/src/types/Messages';

export interface UseAudioStateApi {
    audio_state: AudioState | undefined;
    indicator_count: number;
    toggleAudio: (enabled: boolean) => void;
    reportAudioIndicatorPresence: (present: boolean) => void;
}

/** True for a payload shaped like AudioState; anything else from the message channel is ignored. */
export function isAudioStatePayload(value: unknown): value is AudioState {
    if (!value || typeof value !== 'object') { return false; }
    const state = value as Record<string, unknown>;
    return typeof state.available === 'boolean'
        && typeof state.enabled === 'boolean'
        && typeof state.owner === 'boolean'
        && typeof state.capturing === 'boolean'
        && typeof state.dropped_count === 'number'
        && (state.error_name === undefined || typeof state.error_name === 'string');
}

/**
 * Whether this webview runs the microphone: the flag the recording dot reads, this viewer owns the
 * window's capture, and at least one recording dot is mounted so the user can see and stop it.
 */
export function shouldRunMicrophone(state: AudioState | undefined, indicator_count: number): boolean {
    return isAudioRecordingOn(state) && state?.owner === true && indicator_count > 0;
}

/**
 * Holds the latest audio state the extension pushed, counts the recording dots currently mounted
 * (one per toolbar), and exposes the two view handlers that act on them. The listener is its own
 * so the audio state needs no part in the document message pipeline.
 */
export function useAudioState(postMessage: (message: unknown) => void): UseAudioStateApi {
    const [audio_state, setAudioState] = useState<AudioState | undefined>(undefined);
    const [indicator_count, setIndicatorCount] = useState(0);
    useEffect(() => {
        const onMessage = (event: MessageEvent): void => {
            const message = event.data as { type?: unknown; state?: unknown } | undefined;
            if (message?.type === 'audioState' && isAudioStatePayload(message.state)) { setAudioState(message.state); }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);
    const toggleAudio = useCallback((enabled: boolean) => {
        postMessage({ type: 'audioToggle', enabled });
    }, [postMessage]);
    const reportAudioIndicatorPresence = useCallback((present: boolean) => {
        setIndicatorCount((count) => Math.max(0, count + (present ? 1 : -1)));
    }, []);
    return { audio_state, indicator_count, toggleAudio, reportAudioIndicatorPresence };
}
