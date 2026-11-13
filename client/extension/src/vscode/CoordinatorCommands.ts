import * as vscode from 'vscode';
import type { ActivityCoordinator } from '../types/AgentActivity';
import { buildCoordinatorEnvelope, coordMarkerChanges, mailboxInboxSegments, type CoordinatorTextChange } from '../lib/coordinatorops';
import { writeToErrorLog, writeToLogAtLevel } from '../lib/errorops';
import { isWithinWorkspace } from '../lib/pathops';

export const COORDINATOR_MESSAGE_SEND = 'coordinatorSend';
export const COORDINATOR_MESSAGE_MOVE_MARKER = 'coordinatorMoveMarker';
export const COORDINATOR_MESSAGE_RESULT = 'coordinatorResult';

// the outcomes a webview request is answered with; the webview owns the copy for each, so only the code crosses
export const COORDINATOR_SEND_CODES = ['sent', 'unknown_agent', 'bad_message', 'bad_vendor', 'unavailable', 'no_mailbox', 'write_failed'] as const;
export const COORDINATOR_MOVE_CODES = ['moved', 'moved_unsaved', 'unknown_agent', 'no_board', 'bad_position', 'write_failed'] as const;

/**
 * What the commands need from the analyser: the coordinator rows its last scan listed, which are the
 * only agents a request may name, the thinkersync home it read them from, and a prompt rescan. Narrow on
 * purpose, so the commands can be tested against a stub.
 */
export interface CoordinatorLookup {
    coordinatorFor(agent: string): { coordinator: ActivityCoordinator; board_path?: string } | undefined;
    thinkersyncHomeUri(): vscode.Uri | undefined;
    refresh(): void;
}

/**
 * The two things a coordinator row can ask the host to write, both only ever on the user's own
 * action in a view. A webview message names an agent, never a path: the mailbox is derived from the
 * agent's name under the thinkersync home the registry was read from, and the board is the one the
 * last scan placed the agent on, so a request cannot reach a file the registry did not point at.
 *
 * - send: writes one envelope into the agent's inbox, to a temporary name and then renamed, so the agent
 *   never sees half a file. It refuses an agent whose mailbox does not already exist rather than
 *   creating one. A message with `kind: 'vendor'` and a `vendor` name writes a vendor-change envelope
 *   instead of a free-text request, and is answered as the request `vendor`.
 * - move marker: rewrites the `coord` linetags on the agent's board so its host's marker sits on one
 *   story, through the panel's own edit path, then saves the board unless it already held unsaved edits
 *   of someone's, which a save would otherwise commit.
 *
 * Nothing here starts, stops or restarts an agent.
 */
export class CoordinatorCommands {
    constructor(
        private readonly lookup: CoordinatorLookup,
        private readonly post: (message: Record<string, unknown>) => void,
        private readonly applyEdit: (doc_path: string, changes: CoordinatorTextChange[]) => Promise<void>,
        private readonly resolveUri: (absolute_path: string) => vscode.Uri,
    ) {}

    /** true when the message was a coordinator request and has been answered, so the panel's own dispatch can carry on past it */
    public async handleMessage(e: Record<string, unknown>): Promise<boolean> {
        if (e.type === COORDINATOR_MESSAGE_SEND) { await this.send(e); return true; }
        if (e.type === COORDINATOR_MESSAGE_MOVE_MARKER) { await this.moveMarker(e); return true; }
        return false;
    }

    private answer(request: 'send' | 'move' | 'vendor', agent: string, code: string): void {
        this.post({ type: COORDINATOR_MESSAGE_RESULT, request, agent, code, ok: code === 'sent' || code === 'moved' || code === 'moved_unsaved' });
    }

    // --- send to agent ---

    private async send(e: Record<string, unknown>): Promise<void> {
        const agent = typeof e.agent === 'string' ? e.agent : '';
        const body = typeof e.body === 'string' ? e.body : '';
        const is_vendor = e.kind === 'vendor';
        const request = is_vendor ? 'vendor' : 'send';
        const vendor = typeof e.vendor === 'string' ? e.vendor : '';
        try {
            const found = this.lookup.coordinatorFor(agent);
            if (!found) { this.answer(request, agent, 'unknown_agent'); return; }
            const home = this.lookup.thinkersyncHomeUri();
            if (!home) { this.answer(request, agent, 'unavailable'); return; }
            const fields = { agent, machine: found.coordinator.machine, now: new Date(), rand_hex: randomHex() };
            const envelope = is_vendor ? buildCoordinatorEnvelope({ ...fields, kind: 'vendor', vendor }) : buildCoordinatorEnvelope({ ...fields, body });
            if (!envelope) { this.answer(request, agent, is_vendor ? 'bad_vendor' : 'bad_message'); return; }
            const mailbox_uri = vscode.Uri.joinPath(home, 'mailboxes', agent);
            try { await vscode.workspace.fs.stat(mailbox_uri); }
            catch { this.answer(request, agent, 'no_mailbox'); return; }
            const inbox_uri = vscode.Uri.joinPath(home, ...mailboxInboxSegments(agent));
            await vscode.workspace.fs.createDirectory(inbox_uri);
            const final_uri = vscode.Uri.joinPath(inbox_uri, `${envelope.id}.json`);
            const temp_uri = vscode.Uri.joinPath(inbox_uri, `${envelope.id}.json.tmp`);
            await vscode.workspace.fs.writeFile(temp_uri, new TextEncoder().encode(`${JSON.stringify(envelope, null, 2)}\n`));
            await vscode.workspace.fs.rename(temp_uri, final_uri, { overwrite: false });
            writeToLogAtLevel('debug', 'sendToCoordinator', `wrote envelope ${envelope.id} to ${envelope.target}`);
            this.answer(request, agent, 'sent');
        } catch (err) {
            writeToErrorLog('sendToCoordinator', `failed to write an envelope for ${agent}`, err);
            this.answer(request, agent, 'write_failed');
        }
    }

    // --- target line ---

    private async moveMarker(e: Record<string, unknown>): Promise<void> {
        const agent = typeof e.agent === 'string' ? e.agent : '';
        const after = typeof e.after === 'number' ? e.after : Number.NaN;
        try {
            const found = this.lookup.coordinatorFor(agent);
            if (!found) { this.answer('move', agent, 'unknown_agent'); return; }
            if (!found.board_path || !isWithinWorkspace(found.board_path, { requireExtension: '.md' })) { this.answer('move', agent, 'no_board'); return; }
            if (!Number.isInteger(after) || after < 0 || after > found.coordinator.board_stories.length) { this.answer('move', agent, 'bad_position'); return; }
            const uri = this.resolveUri(found.board_path);
            const document = await vscode.workspace.openTextDocument(uri);
            const was_dirty = document.isDirty;
            const changes = coordMarkerChanges(document.getText(), found.coordinator.machine, after);
            if (changes.length === 0) { this.answer('move', agent, 'moved'); return; }
            const before_text = document.getText();
            await this.applyEdit(found.board_path, changes);
            if (document.getText() === before_text) { this.answer('move', agent, 'write_failed'); return; }
            // a board that already held someone's unsaved edits is left unsaved, since a save would commit them too
            if (!was_dirty && document.isDirty) { await document.save(); }
            this.lookup.refresh();
            this.answer('move', agent, was_dirty ? 'moved_unsaved' : 'moved');
        } catch (err) {
            writeToErrorLog('moveCoordinatorMarker', `failed to move the target marker for ${agent}`, err);
            this.answer('move', agent, 'write_failed');
        }
    }
}

// six hex digits for an envelope id's suffix, from the platform's random source
function randomHex(): string {
    const bytes = new Uint8Array(3);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
