import * as l10n from "@vscode/l10n";
import { COORDINATOR_RESULT_MESSAGE_TYPE } from "./agentactivityops";
import type { ActivityCoordinator } from "../types/AgentActivity";

/**
 * Coordinators beside boards: the webview's pure half. Which registered coordinators a folder view
 * lists, how a position on the target line is read from a pointer or a key, and the words every state
 * and every host answer is drawn in. The wire shapes are mirrored from the extension
 * (`client/extension/src/types/AgentActivity.ts`, `client/extension/src/vscode/CoordinatorCommands.ts`),
 * since the two bundles share no module graph.
 */

// a story board lives at <project>/docstech/users/<name>/todo.md; a folder view holding one is worth a registry read
const BOARD_FILE_PATTERN = /(^|\/)docstech\/users\/[^/]+\/todo\.md$/;

/**
 * CoordinatorResult is the host's answer to a send or a marker move.
 * - request: which of the two it answers
 * - code: the machine-readable outcome, since the copy belongs to the webview
 * - seq: counted by the store as each answer lands, so two identical answers in a row still read as two
 */
export interface CoordinatorResult {
    request: 'send' | 'move';
    agent: string;
    code: string;
    ok: boolean;
    seq?: number;
}

/** whether any file loaded into the view is a story board, which is what makes a coordinator relevant to it */
export function hasBoardFiles(loaded_files: ReadonlyArray<string> | undefined): boolean {
    return (loaded_files ?? []).some(file => BOARD_FILE_PATTERN.test(file));
}

/**
 * The coordinators a folder view lists: those whose repository holds a file the view has loaded. That is
 * every registered agent whose repository sits inside the open folder, and, when the view is open on
 * one repository or a folder within it, the one agent whose repository contains it.
 */
export function coordinatorsInScope(coordinators: ReadonlyArray<ActivityCoordinator>, loaded_files: ReadonlyArray<string> | undefined): ActivityCoordinator[] {
    const files = loaded_files ?? [];
    return coordinators.filter(coordinator => files.some(file => coordinator.root_relative === '' || file === coordinator.root_relative || file.startsWith(`${coordinator.root_relative}/`)));
}

/** how many story rows have their middle above this point, which is the position a line dropped there takes: 0 above every story, the count below every one */
export function targetPositionFromPointer(story_midpoints: ReadonlyArray<number>, y: number): number {
    return story_midpoints.filter(midpoint => midpoint < y).length;
}

/**
 * The position a key moves the target line to, or undefined for a key it does not handle. Up and Down
 * move one story, Home takes the line off the board and End puts it below the last story.
 */
export function targetPositionFromKey(key: string, position: number, story_count: number): number | undefined {
    switch (key) {
        case 'ArrowUp': return Math.max(0, position - 1);
        case 'ArrowDown': return Math.min(story_count, position + 1);
        case 'Home': return 0;
        case 'End': return story_count;
        default: return undefined;
    }
}

/** the line's value as a screen reader reads it: the story it sits after, or that it is not on the board */
export function targetValueText(coordinator: ActivityCoordinator, position: number): string {
    if (position <= 0) { return l10n.t('No target line: nothing is set to run'); }
    return l10n.t('After {0}', coordinator.board_stories[position - 1]?.title ?? '');
}

/** the registry's state word as the row says it; an unknown word is carried rather than hidden */
export function coordinatorStateLabel(state: string): string {
    switch (state) {
        case 'working': return l10n.t('Working');
        case 'idle': return l10n.t('Idle');
        case 'starting': return l10n.t('Starting');
        case 'recycling': return l10n.t('Recycling');
        case 'stopped': return l10n.t('Stopped');
        default: return l10n.t('State not reported');
    }
}

/** how many convoys are open, in words */
export function convoyCountLabel(count: number): string {
    return count === 1 ? l10n.t('1 open convoy') : l10n.t('{0} open convoys', count);
}

/** what to tell the user about an answer, undefined when there is nothing to say (a marker that moved, which the line itself shows) */
export function coordinatorResultMessage(result: CoordinatorResult): string | undefined {
    switch (result.code) {
        case 'sent': return l10n.t('Sent to {0}.', result.agent);
        case 'moved': return undefined;
        case 'moved_unsaved': return l10n.t('Moved, but the board has other unsaved edits, so it is not saved yet.');
        case 'unknown_agent': return l10n.t('That agent is no longer listed.');
        case 'bad_message': return l10n.t('Write a message first.');
        case 'unavailable': return l10n.t("This host cannot reach the agent's mailbox.");
        case 'no_mailbox': return l10n.t('The agent has no mailbox yet.');
        case 'no_board': return l10n.t('This agent has no board here.');
        case 'bad_position': return l10n.t('That position is not on the board.');
        default: return result.request === 'send' ? l10n.t('The message could not be written.') : l10n.t('The board could not be changed.');
    }
}

/** turn a posted message into a coordinator result, or undefined when it is not one */
export function parseCoordinatorResult(message: unknown): CoordinatorResult | undefined {
    if (message === null || typeof message !== 'object') { return undefined; }
    const envelope = message as Record<string, unknown>;
    if (envelope.type !== COORDINATOR_RESULT_MESSAGE_TYPE) { return undefined; }
    const request = envelope.request === 'send' || envelope.request === 'move' ? envelope.request : undefined;
    if (!request || typeof envelope.agent !== 'string' || typeof envelope.code !== 'string') { return undefined; }
    return { request, agent: envelope.agent, code: envelope.code, ok: envelope.ok === true };
}
