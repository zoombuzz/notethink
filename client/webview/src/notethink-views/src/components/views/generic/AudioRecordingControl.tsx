import Debug from "debug";
import React, { useEffect, useRef } from "react";
import * as l10n from "@vscode/l10n";
import type { AudioState } from "../../../types/Messages";
import { audioErrorName, audioToggleAction, audioToggleTarget, isAudioAvailable, isAudioRecordingOn } from "../../../lib/audiostateops";
import styles from "./AudioRecordingControl.module.scss";

const debug = Debug("nodejs:notethink-views:AudioRecordingControl");

/**
 * Props for the recording dot.
 * - onPresence: called with true when the dot mounts and false when it unmounts, nothing else; the webview app runs the microphone only while at least one dot is mounted
 */
interface AudioRecordingDotProps {
    onPresence?: (present: boolean) => void;
}

/**
 * Props for the audio control.
 * - state: the window-wide audio state the extension last pushed; the control renders nothing unless it reports the feature available
 * - onToggle: receives the `enabled` value to ask for
 * - onPresence: forwarded to the dot, see AudioRecordingDotProps
 */
interface AudioRecordingControlProps {
    state: AudioState | undefined;
    onToggle?: (enabled: boolean) => void;
    onPresence?: (present: boolean) => void;
}

/**
 * The red recording dot plus its screen reader text. It exists only while recording is on, and its
 * lifetime is the presence signal the capture gate reads: mounted means a header bar is showing the
 * user that the microphone is live. The callback is held in a ref so a new function identity on a
 * re-render never reports a false gap.
 */
function AudioRecordingDot(props: AudioRecordingDotProps): React.ReactElement {
    const presence_ref = useRef(props.onPresence);
    useEffect(() => {
        presence_ref.current = props.onPresence;
    }, [props.onPresence]);
    useEffect(() => {
        debug("dot mounted");
        presence_ref.current?.(true);
        return () => {
            debug("dot unmounted");
            presence_ref.current?.(false);
        };
    }, []);
    return (
        <>
            <span className={styles.audioDot} data-testid="audio-recording-dot" title={l10n.t('Recording audio')} aria-hidden="true" />
            <span className={styles.audioScreenReaderOnly}>{l10n.t('Recording audio')}</span>
        </>
    );
}

/**
 * The header bar's audio control: a status region, then an on and off toggle.
 *
 * Renders nothing at all (no wrapper) unless the extension reports the feature available.
 *
 * The status region is present whenever the control is, and its content arrives later: the dot and
 * the words "Recording audio" appear inside it when recording starts, and the error text when the
 * microphone is refused. A live region inserted together with its text is often not announced, so
 * the region stays in the tree and only its content changes. The dot itself is decorative
 * (aria-hidden); the region's text is what a screen reader reads, so the dot is never the only signal.
 *
 * The toggle is a native button, so Enter and Space work from the keyboard. It carries aria-pressed
 * and changes its wording with the state. After a failure the state reads off, so the next click asks
 * for on again, which is the retry.
 */
export default function AudioRecordingControl(props: AudioRecordingControlProps): React.ReactElement | null {
    if (!isAudioAvailable(props.state)) { return null; }
    const on = isAudioRecordingOn(props.state);
    const error_name = audioErrorName(props.state);
    const error_text = error_name === undefined ? undefined : l10n.t('Microphone unavailable: {0}', error_name);
    const toggle_label = audioToggleAction(props.state) === 'stop' ? l10n.t('Stop recording') : l10n.t('Record audio');
    return (
        <div className={styles.audioControl} data-testid="audio-control">
            <span role="status" className={styles.audioStatus} data-testid="audio-status">
                {on && <AudioRecordingDot onPresence={props.onPresence} />}
                {error_text !== undefined && (
                    <span className={styles.audioError} data-testid="audio-error" title={error_text}>{error_text}</span>
                )}
            </span>
            <button
                type="button"
                className={styles.audioToggle}
                data-testid="audio-toggle"
                aria-pressed={on}
                title={toggle_label}
                onClick={(e) => { e.stopPropagation(); props.onToggle?.(audioToggleTarget(props.state)); }}
            >
                {toggle_label}
            </button>
        </div>
    );
}
