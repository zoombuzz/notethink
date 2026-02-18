import type { Root as MdastRoot } from 'mdast';

export type HashMapOf<S> = { [key: string]: S };

export type EmptyObject = Record<string, never>;

export interface Doc {
    id: string;
    path: string;
    content?: MdastRoot;
    text?: string;
    updatedAt?: string;
    createdBy?: string;
    updateSentAt?: string;
}
