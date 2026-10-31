import type { AudioState } from "../types/Messages";

// longest error name shown; a DOMException name is a short identifier, so anything longer is not one
const MAX_ERROR_NAME_LENGTH = 64;

/**
 * Whether the audio control exists at all: an endpoint is configured and valid. An absent state
 * (nothing pushed yet) counts as unavailable, so the toolbar renders nothing until the extension speaks.
 */
export function isAudioAvailable(state: AudioState | undefined): boolean {
    return state?.available === true;
}

/**
 * The state as this viewer acts on it: the extension's state, reported unavailable unless this viewer's own
 * frame passed the microphone check. `frame_allows` is undefined while the check is still running, which
 * also counts as unavailable, so neither the control nor capture appears before the answer is known.
 */
export function applyFrameCheck(state: AudioState | undefined, frame_allows: boolean | undefined): AudioState | undefined {
    if (!state || frame_allows === true || !state.available) { return state; }
    return { ...state, available: false };
}

/**
 * The single flag both the recording dot and the capture gate read: the feature is available, the
 * user has it switched on, and the last microphone attempt did not fail. Reading one function in both
 * places is what keeps capture from running while the dot is absent.
 */
export function isAudioRecordingOn(state: AudioState | undefined): boolean {
    if (!state) { return false; }
    return state.available && state.enabled && !state.error_name;
}

/**
 * The `enabled` value the toggle sends. It is the opposite of what the indicator shows, so a refused
 * microphone (shown as off) is retried by the next click rather than turned off again.
 */
export function audioToggleTarget(state: AudioState | undefined): boolean {
    return !isAudioRecordingOn(state);
}

/** Which wording the toggle carries: 'stop' while recording is on, 'start' otherwise. */
export function audioToggleAction(state: AudioState | undefined): 'start' | 'stop' {
    return isAudioRecordingOn(state) ? 'stop' : 'start';
}

/**
 * The last microphone failure to show, or undefined when there is none. Trimmed and capped so an
 * odd value cannot blow out the toolbar; a name that trims to nothing still shows as a generic
 * 'Error', because isAudioRecordingOn already treats any non-empty error_name as a failure.
 */
export function audioErrorName(state: AudioState | undefined): string | undefined {
    if (!state?.error_name) { return undefined; }
    return state.error_name.trim().slice(0, MAX_ERROR_NAME_LENGTH) || 'Error';
}
