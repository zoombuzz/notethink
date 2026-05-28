import Debug from "debug";
import React from "react";
import styles from "./Spinner.module.scss";

const debug = Debug("nodejs:notethink-views:Spinner");

export type SpinnerPositionClass = 'InlineLoader' | 'TopRightLoader';

interface SpinnerProps {
    positionClass?: SpinnerPositionClass;
    ariaLabel?: string;
}

/**
 * Inline-SVG spinner with no runtime dependency. Rotation is driven by a CSS
 * @keyframes block in Spinner.module.scss; a prefers-reduced-motion media query
 * disables the animation but keeps the SVG visible so the "something is happening"
 * affordance is preserved for users with reduced-motion preferences.
 *
 * positionClass picks a position helper class (InlineLoader, TopRightLoader)
 * matching the oma/calfam Loader precedent. Callers that need different positioning
 * can wrap the spinner in their own container instead.
 */
export default function Spinner(props: SpinnerProps): React.ReactElement {
    const position_class = props.positionClass ? styles[props.positionClass] : '';
    const class_name = `${styles.Spinner} ${position_class}`.trim();
    return (
        <span
            className={class_name}
            data-testid="pending-work-spinner"
            role="status"
            aria-label={props.ariaLabel ?? 'Working'}
            aria-live="polite"
        >
            <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <circle
                    cx="16" cy="16" r="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeOpacity="0.25"
                />
                <path
                    d="M16 4 a12 12 0 0 1 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                />
            </svg>
        </span>
    );
}
