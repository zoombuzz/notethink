import * as vscode from 'vscode';
import type { ActivityCoordinator } from '../types/AgentActivity';
import { buildCoordinatorEnvelope, mailboxInboxSegments } from '../lib/coordinatorops';
import { writeToErrorLog, writeToLogAtLevel } from '../lib/errorops';

export const COORDINATOR_MESSAGE_SEND = 'coordinatorSend';
export const COORDINATOR_MESSAGE_RESULT = 'coordinatorResult';

// the outcomes a webview request is answered with; the webview owns the copy for each, so only the code crosses
export const COORDINATOR_SEND_CODES = ['sent', 'unknown_agent', 'bad_message', 'bad_vendor', 'unavailable', 'no_mailbox', 'write_failed'] as const;

/**
 * What the commands need from the analyser: the coordinator rows its last scan listed, which are the
 * only agents a request may name, and the thinkersync home it read them from. Narrow on purpose, so the
 * commands can be tested against a stub.
 */
export interface CoordinatorLookup {
    coordinatorFor(agent: string): { coordinator: ActivityCoordinator } | undefined;
    thinkersyncHomeUri(): vscode.Uri | undefined;
}

/**
 * The one thing a coordinator row can ask the host to write, only ever on the user's own action in a
 * view. A webview message names an agent, never a path: the mailbox is derived from the agent's name
 * under the thinkersync home the coordinator files were read from, so a request cannot reach a file
 * those files did not point at.
 *
 * Send writes one envelope into the agent's inbox, to a temporary name and then renamed, so the agent
 * never sees half a file. It refuses an agent whose mailbox does not already exist rather than
 * creating one. A message with `kind: 'vendor'` and a `vendor` name writes a vendor-change envelope
 * instead of a free-text request, and is answered as the request `vendor`.
 *
 * Nothing here starts, stops or restarts an agent.
 */
export class CoordinatorCommands {
    constructor(
        private readonly lookup: CoordinatorLookup,
        private readonly post: (message: Record<string, unknown>) => void,
    ) {}

    /** true when the message was a coordinator request and has been answered, so the panel's own dispatch can carry on past it */
    public async handleMessage(e: Record<string, unknown>): Promise<boolean> {
        if (e.type === COORDINATOR_MESSAGE_SEND) { await this.send(e); return true; }
        return false;
    }

    private answer(request: 'send' | 'vendor', agent: string, code: string): void {
        this.post({ type: COORDINATOR_MESSAGE_RESULT, request, agent, code, ok: code === 'sent' });
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
}

// six hex digits for an envelope id's suffix, from the platform's random source
function randomHex(): string {
    const bytes = new Uint8Array(3);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
