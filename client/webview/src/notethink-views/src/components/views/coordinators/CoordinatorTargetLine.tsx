import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement, RefObject } from "react";
import * as l10n from "@vscode/l10n";
import { targetPositionFromKey, targetPositionFromPointer, targetValueText } from "../../../lib/coordinatorops";
import type { ActivityCoordinator, ActivityCoordinatorStory } from "../../../types/AgentActivity";
import styles from "./CoordinatorPanel.module.scss";

interface TargetLineProps {
    coordinator: ActivityCoordinator;
    position: number;
    onMove: (position: number) => void;
}

interface TargetLineControls {
    board_ref: RefObject<HTMLDivElement | null>;
    line_ref: RefObject<HTMLDivElement | null>;
    drag_position: number | undefined;
    handlers: {
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
        onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
        onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
        onPointerCancel: () => void;
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
    };
}

// the drag, drop and keyboard handling of the target line, kept apart from the markup it drives
function useTargetLineControls(story_count: number, position: number, onMove: (position: number) => void): TargetLineControls {
    const board_ref = useRef<HTMLDivElement>(null);
    const line_ref = useRef<HTMLDivElement>(null);
    const refocus_ref = useRef(false);
    const [drag_position, setDragPosition] = useState<number | undefined>(undefined);
    useLayoutEffect(() => {
        if (refocus_ref.current) {
            refocus_ref.current = false;
            line_ref.current?.focus();
        }
    }, [position]);
    function positionAt(client_y: number): number {
        const rows = board_ref.current?.querySelectorAll('[data-testid="coordinator-story"]') ?? [];
        const midpoints = Array.from(rows, row => { const box = row.getBoundingClientRect(); return box.top + box.height / 2; });
        return targetPositionFromPointer(midpoints, client_y);
    }
    function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
        if (event.button !== 0) { return; }
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragPosition(position);
    }
    function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
        if (drag_position === undefined) { return; }
        setDragPosition(positionAt(event.clientY));
    }
    function handlePointerUp(event: PointerEvent<HTMLDivElement>): void {
        if (drag_position === undefined) { return; }
        const dropped = positionAt(event.clientY);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        setDragPosition(undefined);
        if (dropped !== position) { onMove(dropped); }
    }
    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
        if (event.key === 'Escape' && drag_position !== undefined) {
            event.preventDefault();
            setDragPosition(undefined);
            return;
        }
        const next = targetPositionFromKey(event.key, position, story_count);
        if (next === undefined) { return; }
        event.preventDefault();
        if (next !== position) {
            refocus_ref.current = true;
            onMove(next);
        }
    }
    return {
        board_ref,
        line_ref,
        drag_position,
        handlers: { onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, onPointerCancel: () => setDragPosition(undefined), onKeyDown: handleKeyDown },
    };
}


/**
 * The board a coordinator works from, with its target line drawn on it: the coordinator may work from
 * the top of the board down to the line, so everything below the line reads dimmed. Open convoys and the
 * steps only the operator can take sit on the stories they belong to.
 *
 * The line moves two ways to the same outcome, a drag and the keyboard (workspace PATTERNS.md >
 * Accessible drag and resize affordances). It is a focusable separator: Up and Down move it one story,
 * Home takes it off the board and End puts it below the last story. A drag moves a ghost line under the
 * pointer and commits on release, because moving the real line would remove the element holding the
 * pointer capture; Escape cancels it. After a keyboard move the line is focused again, since moving it
 * in the document drops focus.
 */
export default function CoordinatorTargetLine(props: TargetLineProps): ReactElement {
    const { coordinator, position, onMove } = props;
    const stories = coordinator.board_stories;
    const { board_ref, line_ref, drag_position, handlers } = useTargetLineControls(stories.length, position, onMove);
    const line = (
        <div
            key="line"
            ref={line_ref}
            className={styles.targetLine}
            role="separator"
            aria-orientation="horizontal"
            aria-label={l10n.t('Target line for {0}', coordinator.agent)}
            aria-valuemin={0}
            aria-valuemax={stories.length}
            aria-valuenow={position}
            aria-valuetext={targetValueText(coordinator, position)}
            tabIndex={0}
            data-testid="coordinator-target-line"
            data-position={position}
            data-dragging={drag_position !== undefined ? 'true' : undefined}
            {...handlers}
        >
            <span className={styles.targetLineGrip} aria-hidden="true" />
        </div>
    );
    const children = arrangeBoard(stories, position, drag_position, line);
    return (
        <div className={styles.targetBoard} ref={board_ref} role="group" aria-label={l10n.t('Target line for {0}', coordinator.agent)} data-testid="coordinator-target-board">
            <p className={styles.targetHint}>{l10n.t('The agent may work from the top of the board down to the line. Drag the line, or use the arrow keys.')}</p>
            {stories.length === 0 ? <p className={styles.targetHint} data-testid="coordinator-target-empty">{l10n.t('This board has no stories.')}</p> : children}
        </div>
    );
}

interface TargetStoryProps {
    story: ActivityCoordinatorStory;
    in_range: boolean;
}

// one story of the board: its title and status, with the open convoys and operator steps that belong to it
function TargetStory(props: TargetStoryProps): ReactElement {
    const { story, in_range } = props;
    return (
        <div className={styles.targetStory} data-testid="coordinator-story" data-story-id={story.id} data-in-range={in_range ? 'true' : 'false'}>
            <span className={styles.targetStoryTitle}>{story.title}</span>
            {story.status && <span className={styles.targetStoryStatus} data-testid="coordinator-story-status">{story.status}</span>}
            {story.convoys.map((repo, convoy_index) => (
                <span key={`convoy:${convoy_index}`} className={styles.targetStoryBadge} data-kind="convoy" data-testid="coordinator-story-convoy">{l10n.t('Convoy: {0}', repo)}</span>
            ))}
            {story.operator_steps.map((step, step_index) => (
                <span key={`step:${step_index}`} className={styles.targetStoryBadge} data-kind="step" data-testid="coordinator-story-step">{l10n.t('Your step: {0}', step)}</span>
            ))}
        </div>
    );
}

/**
 * The board's children in order: each story, the real line before the story at its position (or last),
 * and, while dragging, a ghost line before the story under the pointer.
 */
function arrangeBoard(stories: ReadonlyArray<ActivityCoordinatorStory>, position: number, drag_position: number | undefined, line: ReactElement): ReactElement[] {
    const ghost = <div key="ghost" className={styles.targetGhost} aria-hidden="true" data-testid="coordinator-target-ghost" data-position={drag_position} />;
    const show_ghost = drag_position !== undefined && drag_position !== position;
    const children: ReactElement[] = [];
    stories.forEach((story, index) => {
        if (index === position) { children.push(line); }
        if (show_ghost && index === drag_position) { children.push(ghost); }
        children.push(<TargetStory key={`story:${index}:${story.id}`} story={story} in_range={index < position} />);
    });
    if (position >= stories.length) { children.push(line); }
    if (show_ghost && drag_position >= stories.length) { children.push(ghost); }
    return children;
}
