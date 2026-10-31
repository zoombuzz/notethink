import type { AudioState } from "../types/Messages";
import { applyFrameCheck, audioErrorName, audioToggleAction, audioToggleTarget, isAudioAvailable, isAudioRecordingOn } from "./audiostateops";

function makeState(overrides: Partial<AudioState> = {}): AudioState {
    return { available: true, enabled: true, owner: true, capturing: true, dropped_count: 0, ...overrides };
}

describe('isAudioRecordingOn', () => {
    it.each([
        { available: false, enabled: false, error_name: undefined, expected: false },
        { available: false, enabled: true, error_name: undefined, expected: false },
        { available: false, enabled: true, error_name: 'NotAllowedError', expected: false },
        { available: true, enabled: false, error_name: undefined, expected: false },
        { available: true, enabled: false, error_name: 'NotAllowedError', expected: false },
        { available: true, enabled: true, error_name: undefined, expected: true },
        { available: true, enabled: true, error_name: '', expected: true },
        { available: true, enabled: true, error_name: 'NotAllowedError', expected: false },
    ])('available=$available enabled=$enabled error=$error_name gives $expected', ({ available, enabled, error_name, expected }) => {
        expect(isAudioRecordingOn(makeState({ available, enabled, error_name }))).toBe(expected);
    });

    it('is false for an absent state', () => {
        expect(isAudioRecordingOn(undefined)).toBe(false);
    });

    it('ignores owner, capturing and dropped_count', () => {
        expect(isAudioRecordingOn(makeState({ owner: false, capturing: false, dropped_count: 9 }))).toBe(true);
    });
});

describe('isAudioAvailable', () => {
    it('is true only when the extension reports the feature available', () => {
        expect(isAudioAvailable(makeState())).toBe(true);
        expect(isAudioAvailable(makeState({ available: false }))).toBe(false);
        expect(isAudioAvailable(undefined)).toBe(false);
    });
});

describe('audioToggleTarget and audioToggleAction', () => {
    it('turns recording on from off and off from on', () => {
        expect(audioToggleTarget(makeState({ enabled: false }))).toBe(true);
        expect(audioToggleAction(makeState({ enabled: false }))).toBe('start');
        expect(audioToggleTarget(makeState())).toBe(false);
        expect(audioToggleAction(makeState())).toBe('stop');
    });

    it('retries after a failure instead of switching off again', () => {
        const failed = makeState({ error_name: 'NotAllowedError' });
        expect(audioToggleTarget(failed)).toBe(true);
        expect(audioToggleAction(failed)).toBe('start');
    });
});

describe('audioErrorName', () => {
    it('returns the name when set and undefined when not', () => {
        expect(audioErrorName(makeState({ error_name: 'NotFoundError' }))).toBe('NotFoundError');
        expect(audioErrorName(makeState())).toBeUndefined();
        expect(audioErrorName(undefined)).toBeUndefined();
    });

    it('trims, caps the length and never returns an empty string for a set name', () => {
        expect(audioErrorName(makeState({ error_name: '  X  ' }))).toBe('X');
        expect(audioErrorName(makeState({ error_name: 'a'.repeat(200) }))).toHaveLength(64);
        expect(audioErrorName(makeState({ error_name: '   ' }))).toBe('Error');
    });
});


describe('applyFrameCheck', () => {
    it('passes the state through unchanged when the frame check passed', () => {
        const state = makeState();
        expect(applyFrameCheck(state, true)).toBe(state);
    });

    it.each([false, undefined])('reports unavailable when the frame check gave %s, so neither control nor capture runs', (frame_allows) => {
        const checked = applyFrameCheck(makeState(), frame_allows);
        expect(checked).toMatchObject({ available: false, enabled: true });
        expect(isAudioAvailable(checked)).toBe(false);
        expect(isAudioRecordingOn(checked)).toBe(false);
    });

    it('leaves an absent or already unavailable state as it is', () => {
        expect(applyFrameCheck(undefined, true)).toBeUndefined();
        const unavailable = makeState({ available: false });
        expect(applyFrameCheck(unavailable, false)).toBe(unavailable);
    });
});
