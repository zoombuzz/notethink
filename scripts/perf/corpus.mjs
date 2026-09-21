/*
 * Synthetic corpus generation for the perf runner.
 *
 * Produces the wire-format docs PanelSession posts, from markdown shaped like the real workspace
 * this models: `### Story [](?status=...)` headings with checkbox bullets under them, ~8KB per
 * folder file with maxNotesPerFile (10) stories, and done.md-scale long files of 100-400KB.
 *
 * Generation is deterministic - no randomness anywhere - so two runs on the same machine compare
 * like for like, and a scenario's card count is known before the browser opens.
 *
 * A single-file kanban board additionally needs its H1 to carry `[](?nt_view=kanban)`, because
 * AutoView resolves the view type from the file's own declaration; a folder board does not, since
 * the runner pre-seeds the `__folder__` view state with `type: 'kanban'` instead. Folder mode caps
 * each file at maxNotesPerFile stories and single-file mode does not, so a folder file's card count
 * is its story count only while that stays at or below the cap.
 */
import { createHash } from 'node:crypto';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';

// the statuses a generated story cycles through, matching DEFAULT_COLUMN_ORDER so every kanban column fills
const STATUSES = ['untagged', 'doing', 'code-review', 'testing', 'done'];

// filler sentences, cycled by index, so a story's body reaches its byte target with prose a markdown parser has to walk rather than one repeated character
const FILLER = [
    'the composer re-derives the merged tree whenever a doc arrives, so this body is parsed again on every update',
    'each bullet below becomes a task node, and the card renders the checked ones with a struck-through label',
    'a long body is what makes a card expensive: the markdown is converted to hast and then to React elements',
    'the origin pill on the card resolves its project from the workspace-relative path this file was given',
    'nothing here is read by an assertion; it exists to give the parser and the renderer realistic work to do',
];

// source text of one story: its heading, then checkbox bullets until the story reaches target_bytes
function generateStory(index, target_bytes) {
    const status = STATUSES[index % STATUSES.length];
    const linetag = status === 'untagged' ? '' : ` [](?status=${status})`;
    const lines = [`### Story ${index + 1}${linetag}`, ''];
    let bytes = lines[0].length + 2;
    let bullet = 0;
    while (bytes < target_bytes) {
        const done = bullet % 3 === 0 ? 'X' : ' ';
        const line = `+ [${done}] step ${bullet + 1}: ${FILLER[bullet % FILLER.length]}`;
        lines.push(line);
        bytes += line.length + 1;
        bullet += 1;
    }
    lines.push('');
    return lines.join('\n');
}

/**
 * The source text of one generated file: an H1, then `story_count` stories sharing the remaining
 * byte budget. `view_declaration` adds the `[](?nt_view=...)` linetag a single-file board needs.
 */
function generateFileText({ title, story_count, target_bytes, view_declaration }) {
    const linetag = view_declaration ? ` [](?nt_view=${view_declaration})` : '';
    const header = `# ${title}${linetag}\n\n`;
    const per_story = Math.max(120, Math.floor((target_bytes - header.length) / story_count));
    const stories = [];
    for (let index = 0; index < story_count; index += 1) {
        stories.push(generateStory(index, per_story));
    }
    return header + stories.join('\n');
}

// sha256 as lowercase hex, the identifier form client/extension/src/lib/cryptoops.ts generateIdentifier produces
function identifier(message) {
    return createHash('sha256').update(message).digest('hex');
}

/**
 * Wrap source text in the Doc shape PanelSession.buildDocFromUriAndText posts, mdast content
 * included. The mdast is parsed with the same libraries and extensions the extension host uses, so
 * the payload the webview receives is byte-comparable with a real one.
 */
export function buildWireDoc({ doc_path, relative_path, text, created_by = 'perfHarness' }) {
    const content = fromMarkdown(text, {
        extensions: [gfm(), frontmatter(['yaml', 'toml'])],
        mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml', 'toml'])],
    });
    return {
        path: doc_path,
        relative_path,
        id: identifier(doc_path),
        content,
        text,
        hash_sha256: identifier(text),
        mtime: 1751846400000,
        updatedAt: '2026-07-07T00:00:00.000Z',
        createdBy: created_by,
    };
}

/**
 * A folder-mode corpus: `file_count` project directories, each holding one todo.md of
 * `stories_per_file` stories at roughly `file_bytes`. Returns the docs in discovery order plus the
 * card count a settled board must reach, which is what the runner waits on.
 */
export function buildFolderCorpus({ workspace_root, file_count, stories_per_file, file_bytes, max_notes_per_file }) {
    const docs = [];
    for (let index = 0; index < file_count; index += 1) {
        const project = `project-${String(index + 1).padStart(3, '0')}`;
        const relative_path = `${project}/docstech/todo.md`;
        const text = generateFileText({
            title: `${project} todo`,
            story_count: stories_per_file,
            target_bytes: file_bytes,
        });
        docs.push(buildWireDoc({ doc_path: `${workspace_root}/${relative_path}`, relative_path, text }));
    }
    const cards_per_file = Math.min(stories_per_file, max_notes_per_file);
    return {
        docs,
        expected_cards: file_count * cards_per_file,
        source_bytes: docs.reduce((total, doc) => total + doc.text.length, 0),
    };
}

/**
 * A single-file kanban corpus: one declared board of roughly `file_bytes`, its story count derived
 * from `story_bytes` so a bigger file means more cards rather than fatter ones. Also returns a
 * second copy carrying one extra task, which the edit re-send scenario posts to model a keystroke
 * arriving as a fresh parse of the whole document.
 */
export function buildSingleFileCorpus({ workspace_root, file_bytes, story_bytes }) {
    const relative_path = 'docstech/board.md';
    const doc_path = `${workspace_root}/${relative_path}`;
    const story_count = Math.max(1, Math.round(file_bytes / story_bytes));
    const text = generateFileText({
        title: 'Perf board',
        story_count,
        target_bytes: file_bytes,
        view_declaration: 'kanban',
    });
    const edited_text = `${text}\n+ [ ] one more task typed into the last story\n`;
    return {
        doc: buildWireDoc({ doc_path, relative_path, text, created_by: 'activeEditor' }),
        edited_doc: buildWireDoc({ doc_path, relative_path, text: edited_text, created_by: 'activeEditor' }),
        expected_cards: story_count,
        doc_path,
        source_bytes: text.length,
    };
}
