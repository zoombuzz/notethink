import * as l10n from "@vscode/l10n";
import { COORDINATOR_RESULT_MESSAGE_TYPE } from "./agentactivityops";
import { ACTIVITY_VENDOR_ANTIGRAVITY, ACTIVITY_VENDOR_CLAUDE_CODE, ACTIVITY_VENDOR_DISPLAY, type ActivityCoordinator } from "../types/AgentActivity";

/**
 * Coordinators beside boards: the webview's pure half. Which coordinators a folder view
 * lists, and the words every state and every host answer is drawn in. The wire shapes are mirrored from the extension
 * (`client/extension/src/types/AgentActivity.ts`, `client/extension/src/vscode/CoordinatorCommands.ts`),
 * since the two bundles share no module graph.
 */

// a story board lives at <project>/docstech/users/<name>/todo.md; a folder view holding one is worth a coordinator read
const BOARD_FILE_PATTERN = /(^|\/)docstech\/users\/[^/]+\/todo\.md$/;

/**
 * CoordinatorResult is the host's answer to a send.
 * - request: which of the two it answers: a free-text send or a vendor change
 * - code: the machine-readable outcome, since the copy belongs to the webview
 * - seq: counted by the store as each answer lands, so two identical answers in a row still read as two
 */
export interface CoordinatorResult {
    request: 'send' | 'vendor';
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
 * every coordinator whose repository sits inside the open folder, and, when the view is open on
 * one repository or a folder within it, the one agent whose repository contains it.
 */
export function coordinatorsInScope(coordinators: ReadonlyArray<ActivityCoordinator>, loaded_files: ReadonlyArray<string> | undefined): ActivityCoordinator[] {
    const files = loaded_files ?? [];
    return coordinators.filter(coordinator => files.some(file => coordinator.root_relative === '' || file === coordinator.root_relative || file.startsWith(`${coordinator.root_relative}/`)));
}

/** the state word as the row says it; an unknown word reads as not reported */
export function coordinatorStateLabel(state: string): string {
    switch (state) {
        case 'working': return l10n.t('Working');
        case 'idle': return l10n.t('Idle');
        case 'waiting': return l10n.t('Waiting on you');
        case 'stopped': return l10n.t('Stopped');
        default: return l10n.t('State not reported');
    }
}

/** how many convoys are open, in words */
export function convoyCountLabel(count: number): string {
    return count === 1 ? l10n.t('1 open convoy') : l10n.t('{0} open convoys', count);
}

function coordinatorFailureMessage(request: CoordinatorResult['request']): string {
    return request === 'vendor' ? l10n.t('The vendor change could not be sent.') : l10n.t('The message could not be written.');
}

/** what to tell the user about an answer */
export function coordinatorResultMessage(result: CoordinatorResult): string {
    switch (result.code) {
        case 'sent': return result.request === 'vendor' ? l10n.t('Asked {0} to change vendor.', result.agent) : l10n.t('Sent to {0}.', result.agent);
        case 'unknown_agent': return l10n.t('That agent is no longer listed.');
        case 'bad_message': return l10n.t('Write a message first.');
        case 'bad_vendor': return l10n.t('That is not a vendor a coordinator can change to.');
        case 'unavailable': return l10n.t("This host cannot reach the agent's mailbox.");
        case 'no_mailbox': return l10n.t('The agent has no mailbox yet.');
        default: return coordinatorFailureMessage(result.request);
    }
}

/** turn a posted message into a coordinator result, or undefined when it is not one */
export function parseCoordinatorResult(message: unknown): CoordinatorResult | undefined {
    if (message === null || typeof message !== 'object') { return undefined; }
    const envelope = message as Record<string, unknown>;
    if (envelope.type !== COORDINATOR_RESULT_MESSAGE_TYPE) { return undefined; }
    const request = envelope.request === 'send' || envelope.request === 'vendor' ? envelope.request : undefined;
    if (!request || typeof envelope.agent !== 'string' || typeof envelope.code !== 'string') { return undefined; }
    return { request, agent: envelope.agent, code: envelope.code, ok: envelope.ok === true };
}

/** the vendors a coordinator can be asked to change to, as the display table keys them */
export const COORDINATOR_VENDOR_OPTIONS: ReadonlyArray<string> = Object.keys(ACTIVITY_VENDOR_DISPLAY);

/**
 * A display vendor as thinkersync spells it, which is the name a vendor-change envelope carries:
 * `claude-code` is `claude` and `antigravity` is `agy`, and every other vendor is spelled the same.
 */
export function registryVendorName(vendor: string): string {
    switch (vendor) {
        case ACTIVITY_VENDOR_CLAUDE_CODE: return 'claude';
        case ACTIVITY_VENDOR_ANTIGRAVITY: return 'agy';
        default: return vendor;
    }
}
