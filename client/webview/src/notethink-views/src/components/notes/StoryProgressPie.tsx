import { useMemo } from "react";
import type { CSSProperties, ReactElement } from "react";
import { useAgentActivity, useAgentActivityDemand } from "../../lib/activityhooks";
import { hasInFlightStatus, isStoryNote, progressLabel, progressTooltip, resolveStoryProgress } from "../../lib/progressops";
import { hueForOrigin, originHasProject, pillColourForHue } from "../../lib/originops";
import { useVscodeTheme } from "../../lib/themehooks";
import type { NoteProps } from "../../types/NoteProps";
import pie_styles from "./StoryProgressPie.module.scss";

// the wedge is a circle stroked as wide as its diameter, so its dash length is the arc
const PIE_RADIUS = 5;
const PIE_CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS;

interface PieProps {
    note: NoteProps;
}

/**
 * The small pie beside a story's headline saying how far along it is, drawn by every card type. The
 * percentage and its source come from `resolveStoryProgress`, which also decides whether this story
 * shows a pie at all, so a story out of flight and a story with no figure draw nothing.
 *
 * A story at an in-flight status asks the host for agent activity, because the coordinator's own
 * percentage arrives in the activity snapshot; any other story reads whatever snapshot is already
 * held, which is how a live agent bound to it still shows one.
 *
 * Where the headline also draws a project pill, the filled wedge takes the pill's colour (the same hue
 * and theme helpers) and the pie lines up with the pill; the unfilled part stays grey, and a card with
 * no pill keeps the chart green.
 */
export default function StoryProgressPie(props: PieProps): ReactElement | null {
    const { note } = props;
    if (!isStoryNote(note)) { return null; }
    return hasInFlightStatus(note) ? <DemandingPie note={note} /> : <PassivePie note={note} />;
}

function DemandingPie(props: PieProps): ReactElement | null {
    useAgentActivityDemand(props.note.handlers?.postMessage, false);
    return <PassivePie note={props.note} />;
}

function PassivePie(props: PieProps): ReactElement | null {
    const { note } = props;
    const snapshot = useAgentActivity();
    const fallback_doc_path = note.display_options?.activity_doc_path as string | undefined;
    const progress = useMemo(() => resolveStoryProgress(note, snapshot, fallback_doc_path), [note, snapshot, fallback_doc_path]);
    const theme = useVscodeTheme();
    if (!progress) { return null; }
    // a card that draws a project pill (the level-1 headline of a note with a project) fills the pie in the pill's colour
    const pill_colour = note.level === 1 && originHasProject(note.origin) ? pillColourForHue(hueForOrigin(note.origin), theme) : undefined;
    const pie_style = pill_colour ? { '--nt-pie-colour': pill_colour } as CSSProperties : undefined;
    const wedge = `${(progress.pct / 100) * PIE_CIRCUMFERENCE} ${PIE_CIRCUMFERENCE}`;
    return (
        <span className={pie_styles.storyProgressPie}
              role="img"
              aria-label={progressLabel(progress)}
              title={progressTooltip(progress)}
              style={pie_style}
              data-testid="story-progress-pie"
              data-pill-matched={pill_colour ? "true" : undefined}
              data-pct={progress.pct}
              data-source={progress.source}
        >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <circle className={pie_styles.track} cx="10" cy="10" r="10" />
                <circle className={pie_styles.wedge} cx="10" cy="10" r={PIE_RADIUS} strokeWidth={PIE_RADIUS * 2} style={{ strokeDasharray: wedge }} />
            </svg>
        </span>
    );
}
