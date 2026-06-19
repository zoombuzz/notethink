import type { Root } from "mdast";

export type HashMapOf<S> = { [key: string]: S };

export type EmptyObject = Record<string, never>;

export type MdastRoot = Root;

/**
 * Doc represents a loaded markdown file on its way from extension to webview.
 * - mtime: on-disk modification time (epoch ms from vscode.workspace.fs.stat); the implicit ordering signal - newer files float to the top of each file_rank band so background edits surface without any explicit prioritisation
 */
export interface Doc {
    id: string;
    path: string;
    relative_path?: string;
    content?: MdastRoot;
    text?: string;
    hash_sha256?: string;
    mtime?: number;
    updatedAt?: string;
    createdBy?: string;
    updateSentAt?: string;
}
