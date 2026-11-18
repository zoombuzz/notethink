import * as l10n from "@vscode/l10n";
import { useMemo } from "react";
import type { ReactElement } from "react";
import { useAgentActivityDemand } from "../../lib/activityhooks";
import { useBoardLineSlots } from "../../lib/boardlinehooks";
import type { BoardLineMark, BoardLineSlots } from "../../lib/boardlineops";
import { isChildNote, renderBodyItems } from "../../lib/renderops";
import type { NoteProps } from "../../types/NoteProps";
import line_styles from "./BoardLines.module.scss";

/** the words a line carries as its accessible name and its tooltip, saying what it marks */
export function boardLineLabel(kind: BoardLineMark): string {
    if (kind === 'idle') { return l10n.t('Build line: the coordinator has no work set on this board'); }
    return kind === 'build'
        ? l10n.t('Build line: the coordinator will build the stories above this line if left to run')
        : l10n.t('Ship line: the stories above this line have passed the release gate');
}

/**
 * BoardLines draws the lines that fall at one position among a view's stories. The one component every
 * view shares, so no card type draws a line or branches on one. The build line is solid and the ship line
 * dashed, both in the highlight colour; when both fall at the same position they stack, build first. The
 * idle line is the build line of a board with nothing to build, drawn solid with words of its own.
 * - kinds: the lines at this position
 * - edge: when set, the lines overlay a gap instead of taking room of their own, so no card moves. `before` and `after` are the edges of a windowed group's row (its rows are placed by solved offsets); `top` is the gap between a group's title and its first card, for a group whose container is positioned
 */
export default function BoardLines(props: { kinds: ReadonlyArray<BoardLineMark>; edge?: 'before' | 'after' | 'top' }): ReactElement | null {
    const { kinds, edge } = props;
    if (kinds.length === 0) { return null; }
    const classes = [line_styles.boardLines];
    if (edge === 'before') { classes.push(line_styles.edgeBefore); }
    if (edge === 'after') { classes.push(line_styles.edgeAfter); }
    if (edge === 'top') { classes.push(line_styles.edgeTop); }
    return (
        <div className={classes.join(' ')} data-board-lines={kinds.join(' ')} data-testid="board-lines">
            {kinds.map(kind => (
                <div key={kind}
                     role="separator"
                     aria-label={boardLineLabel(kind)}
                     title={boardLineLabel(kind)}
                     className={`${line_styles.boardLine} ${kind === 'ship' ? line_styles.ship : line_styles.build}`}
                     data-board-line={kind}
                     data-testid={`board-line-${kind}`}
                />
            ))}
        </div>
    );
}

/**
 * Items with their lines laid between them: slot `i` of `slots` is drawn before item `i`, and the last slot
 * after the final item. Items come back unchanged when no line applies. The lines before the first item
 * overlay the gap above it and take no room, so adding them never moves an item: in a positioned container
 * (`positioned_parent`, a kanban group's cards) they are placed against the container itself, and
 * elsewhere through a zero-height anchor standing where the first item begins.
 */
export function withBoardLines(items: ReadonlyArray<ReactElement>, slots: BoardLineSlots | undefined, positioned_parent = false): ReactElement[] {
    if (!slots || !slots.some(slot => slot.length > 0)) { return [...items]; }
    const laid: ReactElement[] = [];
    items.forEach((item, index) => {
        if (slots[index]?.length) {
            const lines = <BoardLines key={`board-lines-${index}`} kinds={slots[index]} edge={index === 0 ? 'top' : undefined} />;
            laid.push(index === 0 && !positioned_parent ? <div key={`board-lines-${index}`} className={line_styles.topAnchor}>{lines}</div> : lines);
        }
        laid.push(item);
    });
    const last = slots[items.length];
    if (last?.length) { laid.push(<BoardLines key={`board-lines-${items.length}`} kinds={last} />); }
    return laid;
}

/**
 * Asks the host for agent activity while mounted, without holding the scan spinner, because the lines
 * are drawn from the board lines of the activity snapshot. Mounted only by a view showing board stories.
 */
export function BoardLineDemand(props: { post_message: ((message: Record<string, unknown>) => void) | undefined }): null {
    useAgentActivityDemand(props.post_message, false);
    return null;
}

/**
 * A note's body items with the build and ship lines laid among them, for the document view, where a board's
 * stories are the body items of the note holding them. The caller mounts it only for a note that has a
 * story of a board file among its items, since it listens to the activity snapshot.
 */
export function BoardLinedBodyItems(props: { note: NoteProps }): ReactElement {
    const { note } = props;
    const items = note.children_body;
    const child_notes = useMemo(() => items.map(item => (isChildNote(item) ? item as NoteProps : undefined)), [items]);
    useAgentActivityDemand(note.handlers?.postMessage, false);
    const slots = useBoardLineSlots(child_notes, note.display_options?.activity_doc_path as string | undefined);
    return <>{withBoardLines(renderBodyItems(note, items), slots)}</>;
}
