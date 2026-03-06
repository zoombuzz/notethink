import type { Root as MdastRoot } from 'mdast';

export type HashMapOf<S> = { [key: string]: S };

export type EmptyObject = Record<string, never>;

export interface Doc {
    id: string;
    path: string;
    relative_path?: string;
    content?: MdastRoot;
    text?: string;
    hash_sha256?: string;
    updatedAt?: string;
    createdBy?: string;
    updateSentAt?: string;
}
