import * as vscode from 'vscode';
import { writeToLogAtLevel, writeToErrorLog } from '../lib/errorops';
import { parse } from '../lib/parseops';
import { ParseScheduler, isParseStaleError, ParseStaleError, type ParseSchedulerEvent } from '../lib/ParseScheduler';
import type { ParseWorkerRequest, ParseWorkerResponse } from './ParseWorker';
import type { Root as MdastRoot } from 'mdast';

export { isParseStaleError, ParseStaleError };

let request_sequence = 0;
function nextRequestId(): string { return `parse-${++request_sequence}`; }

/**
 * A small pool of parse workers, spawned lazily up to `pool_size` and kept warm across calls, shared
 * per extension host. `key` identifies the doc being parsed: a newer parse for the same key supersedes
 * whatever older one is still queued or in flight, rather than race it to the caller. The slot,
 * queue and crash mechanics live in the shared ParseScheduler; this adapter supplies the worker URL,
 * the request encoding and the logging. Feature detection has no upfront `typeof Worker` check: the
 * first `new Worker(...)` either succeeds or throws, and the scheduler's spawn catch is what falls back
 * to inline parsing - so a test can inject a fake factory and exercise the real dispatch path with no
 * `Worker` global present.
 */
export class ParsePool {
    private readonly scheduler: ParseScheduler<{ text: string }, MdastRoot, ParseWorkerRequest, ParseWorkerResponse>;

    constructor(
        context: vscode.ExtensionContext,
        worker_factory: () => Worker = () => new Worker(vscode.Uri.joinPath(context.extensionUri, 'client/extension/dist/parseWorker.js').toString()),
        pool_size?: number,
        queue_max_length?: number,
    ) {
        this.scheduler = new ParseScheduler({
            createWorker: worker_factory,
            buildRequest: (input) => ({ request_id: nextRequestId(), text: input.text }),
            decodeResponse: (response) => {
                if ('error' in response) { throw new Error(response.error); }
                return response.mdast;
            },
            parseInline: (input) => parse(input.text),
            onEvent: logSchedulerEvent,
        }, { pool_size, queue_max_length });
    }

    /** Parse `text` off the host thread, keyed by `key`. Rejects with ParseStaleError if a later call for the same key arrives before this one settles. */
    public parse(key: string, text: string): Promise<MdastRoot> {
        return this.scheduler.submit({ text }, key);
    }

    /** Stops every worker and rejects whatever is still queued or in flight; called once, on extension host deactivation. */
    public dispose(): void {
        this.scheduler.dispose();
    }
}

function logSchedulerEvent(event: ParseSchedulerEvent): void {
    switch (event.kind) {
        case 'spawned':
            // proof-of-spawn for manual verification: a real worker vs. the inline fallback otherwise look identical from outside
            writeToLogAtLevel('debug', 'ParsePool', `spawned parse worker ${event.slot_count}/${event.pool_size}`);
            return;
        case 'spawn_failed':
            writeToErrorLog('ParsePool', 'worker unavailable, falling back to inline parsing', event.error);
            return;
        case 'worker_crashed':
            writeToErrorLog('ParsePool', 'parse worker crashed, falling back to inline parse for the in-flight job', event.error);
            return;
    }
}
