import type { ActivityStoryProgress } from '../types/AgentActivity';

/**
 * Reading a coordinator's progress file: the pure half. A coordinator keeps a rough percentage per
 * story in `coordinator/<project>/progress.json` under the thinkersync home, shaped
 * `{ "<story id>": { "pct", "at", "by", "note"? } }`. The file is written by other tooling and
 * replaced whole, so a missing, empty or malformed file and a missing entry are all ordinary, and
 * every function here answers them with an empty result rather than an error.
 */

// the thinkersync home below the OS home directory; the extension cannot see an override of it
export const THINKERSYNC_HOME_SEGMENTS = ['.local', 'share', 'thinkersync'] as const;

// a progress file is a handful of short entries; anything larger is not one and is left unread
export const PROGRESS_FILE_MAX_BYTES = 256 * 1024;

// the longest note carried, so a runaway writer cannot bloat every activity post
export const PROGRESS_NOTE_MAX_CHARS = 200;

/** one entry of a progress file, before it is placed in a repository */
export type ProgressFileEntry = Omit<ActivityStoryProgress, 'root_relative'>;

/** the path segments of a project's progress file below the thinkersync home */
export function progressFileSegments(project: string): string[] {
    return ['coordinator', project, 'progress.json'];
}

/** the project name a coordinator files a repository under: the repository directory's basename */
export function progressProjectName(root_path: string): string | undefined {
    const segments = root_path.split('/').filter(segment => segment.length > 0);
    return segments.length > 0 ? segments[segments.length - 1] : undefined;
}

/**
 * The entries of one progress file's text, in the file's own order. A file that is not a JSON object
 * gives none, and so does an entry without a story id, an integer-valued `pct` from 0 to 100, or a
 * parseable `at`; one bad entry never costs the rest.
 */
export function parseProgressFile(text: string): ProgressFileEntry[] {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { return []; }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { return []; }
    const entries: ProgressFileEntry[] = [];
    for (const [story_id, raw] of Object.entries(parsed as Record<string, unknown>)) {
        if (story_id.length === 0 || raw === null || typeof raw !== 'object') { continue; }
        const candidate = raw as { pct?: unknown; at?: unknown; by?: unknown; note?: unknown };
        const { pct, at, by, note } = candidate;
        if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) { continue; }
        if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) { continue; }
        entries.push({
            story_id,
            pct: Math.round(pct),
            at,
            by: typeof by === 'string' ? by : 'coordinator',
            ...(typeof note === 'string' && note.length > 0 ? { note: note.slice(0, PROGRESS_NOTE_MAX_CHARS) } : {}),
        });
    }
    return entries;
}

/** a repository's entries stamped with where the repository sits in the workspace, ready for the activity snapshot */
export function progressForRepository(entries: ReadonlyArray<ProgressFileEntry>, root_relative: string): ActivityStoryProgress[] {
    return entries.map(entry => ({ root_relative, ...entry }));
}

// a ready file names a handful of story slugs; anything larger is not one and is left unread
export const READY_FILE_MAX_BYTES = 256 * 1024;

// the most stories one ready file contributes, so a runaway writer cannot bloat every activity post
export const READY_STORIES_MAX = 300;

/** the path segments of a project's ready file below the thinkersync home, beside its progress file */
export function readyFileSegments(project: string): string[] {
    return ['coordinator', project, 'ready.json'];
}

/**
 * The story slugs a ready file names: the `stories` array of its top-level object, which records the
 * stories the release gate last passed. A missing, empty or malformed file, a file with no `stories`
 * array and any entry that is not a non-empty string all give nothing for that part, so a bad file
 * means no ready stories rather than an error.
 */
export function parseReadyFile(text: string): string[] {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { return []; }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { return []; }
    const stories = (parsed as { stories?: unknown }).stories;
    if (!Array.isArray(stories)) { return []; }
    return stories.filter((slug): slug is string => typeof slug === 'string' && slug.length > 0).slice(0, READY_STORIES_MAX);
}
