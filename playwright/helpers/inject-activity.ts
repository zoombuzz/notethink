import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from '@playwright/test';

/*
 * Drive the agent card from the contract fixtures with no live agent anywhere.
 *
 * playwright/fixtures/activity is a populated `.notethink/` directory, laid out exactly as a producer
 * writes one. This helper reads it the way the extension host will and folds it into the same
 * `ActivitySnapshot` the host posts, through the mocked VS Code channel every other injector uses. The
 * snapshot is per contract root, so a spec can place the fixture directory anywhere in the workspace
 * and the card's join has to resolve it from `root_relative` alone.
 *
 * The manifest is authoritative about which sessions are live, so the failure fixtures beside them are
 * read only when a spec asks for one as a refusal.
 */

const ACTIVITY_FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'activity');

interface ActivityRefusalSpec {
    file: string;
    code: string;
    reason: string;
    session_id?: string;
}

interface InjectActivityOptions {
    // where the host found the `.notethink/` directory, relative to the workspace folder; '' when it IS the workspace folder
    root_relative?: string;
    root_path?: string;
    live?: boolean;
    refusals?: ActivityRefusalSpec[];
    unreadable_session_ids?: string[];
    // session ids to keep, defaulting to every session the manifest declares live
    sessions?: string[];
}

const DEFAULT_ROOT_RELATIVE = 'notethink';
const DEFAULT_ROOT_PATH = '/mnt/workspace/in_development/notethink';

function readJson<T>(...segments: string[]): T {
    return JSON.parse(fs.readFileSync(path.join(ACTIVITY_FIXTURE_DIR, ...segments), 'utf-8')) as T;
}

/** the snapshot the extension host posts, assembled from the fixture directory exactly as it would read one */
export function activityFixtureSnapshot(options: InjectActivityOptions = {}): Record<string, unknown> {
    const root_relative = options.root_relative ?? DEFAULT_ROOT_RELATIVE;
    const root_path = options.root_path ?? DEFAULT_ROOT_PATH;
    const manifest = readJson<{ producer: unknown; capabilities: unknown; written_at: string; heartbeat_seconds: number; sessions: string[] }>('manifest.json');
    const live_ids = options.sessions ?? manifest.sessions;
    const sessions = live_ids.map(id => {
        const digest_path = path.join(ACTIVITY_FIXTURE_DIR, 'sessions', `${id}.digest.json`);
        return {
            root_path,
            root_relative,
            session: readJson<Record<string, unknown>>('sessions', `${id}.session.json`),
            events: [],
            digest: fs.existsSync(digest_path) ? JSON.parse(fs.readFileSync(digest_path, 'utf-8')) : undefined,
        };
    });
    return {
        contract_version: '1.0.0',
        producers: [{
            root_path,
            root_relative,
            project: 'notethink',
            producer: manifest.producer,
            written_at: manifest.written_at,
            heartbeat_seconds: manifest.heartbeat_seconds,
            live: options.live !== false,
            capabilities: manifest.capabilities,
            declared_session_ids: manifest.sessions,
            unreadable_session_ids: options.unreadable_session_ids ?? [],
            refusals: options.refusals ?? [],
        }],
        sessions,
        trees: [{ root_path, root_relative, tree: readJson('tree.json') }],
    };
}

/** post one activity snapshot to the webview */
export async function injectActivity(page: Page, options: InjectActivityOptions = {}): Promise<void> {
    const activity = activityFixtureSnapshot(options);
    await page.evaluate((payload) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'activity', activity: payload } }));
    }, activity);
}

/** post a snapshot saying nothing is writing anywhere the host can see, which is what a workspace with no producer looks like */
export async function injectNoProducer(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'activity', activity: { contract_version: '1.0.0', producers: [], sessions: [], trees: [] } },
        }));
    });
}

/** post the host's answer that a row's request could not be carried out */
export async function injectActivityUnavailable(page: Page, notice: { request: 'diff' | 'chat'; reason: string; path?: string; session_id?: string }): Promise<void> {
    await page.evaluate((payload) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'activityUnavailable', ...payload } }));
    }, notice);
}
