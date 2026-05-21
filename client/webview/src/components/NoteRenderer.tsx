import Debug from "debug";
import React, { ReactElement, Suspense, useCallback, useRef } from 'react';
import {sanitize} from "hast-util-sanitize";
import {toHast} from "mdast-util-to-hast";
import {toJsxRuntime} from "hast-util-to-jsx-runtime";
import {Fragment, jsx, jsxs} from "react/jsx-runtime";
import type { HashMapOf, Doc } from "../types/general";
import { anyViewInFolderMode, firstIntegrationPath } from "../notethink-views/src/lib/mergeAggregateRoot";
import { ErrorBoundary } from "../notethink-views/src/components";
import type { TextSelection } from "../notethink-views/src/types/NoteProps";
import type { GlobalSettingsPayload, FolderViewSettingsPayload } from "../notethink-views/src/types/Messages";
import type { ViewState } from './ExtensionReceiver';
import NoteTreeComposer from './composers/NoteTreeComposer';
import FolderTreeComposer from './composers/FolderTreeComposer';

const debug = Debug("nodejs:notethink:NoteRenderer");

export type MdastNodes = import("mdast").Nodes;

export function renderNodeUnified(node: MdastNodes): ReactElement {
    try {
        const hast = sanitize(toHast(node));
        // @ts-ignore safe to ignore type error on jsx and jsxs (https://github.com/syntax-tree/hast-util-to-jsx-runtime)
        return toJsxRuntime(hast, {Fragment, jsx, jsxs});
    } catch (err) {
        console.error('renderNodeUnified failed:', err);
        return <></>;
    }
}

export interface NoteRendererProps {
    notes: HashMapOf<Doc>;
    selections?: { [docPath: string]: TextSelection };
    postMessage?: (message: unknown) => void;
    viewStates?: Record<string, ViewState>;
    setViewManagedState?: (updates: Array<Record<string, unknown>>) => void;
    onNavigationCommand?: React.MutableRefObject<((direction: string) => void) | undefined>;
    workspace_root?: string;
    // folder mode: total files discovered before the MAX_AGGREGATE_FILES cap
    aggregate_total_discovered?: number;
    // folder mode: effective include/exclude globs echoed by the extension
    include_filter?: string;
    exclude_filter?: string;
    globalSettings?: GlobalSettingsPayload;
    folderViewSettings?: FolderViewSettingsPayload;
}

/**
 * NoteRenderer dispatches the loaded Docs to a tree-composer.
 *
 * Single-file mode renders one NoteTreeComposer per Doc (legacy stacked-views shape, used
 * in practice with one Doc at a time). Aggregate (folder) mode renders a single
 * FolderTreeComposer that merges every Doc into one synthetic root.
 */
export default function NoteRenderer(props: NoteRendererProps) {
    const ref = useRef<HTMLDivElement>(null);

    const handleRenderError = useCallback((error: Error) => {
        props.postMessage?.({
            type: 'renderError',
            message: error.message,
            stack: error.stack,
        });
    }, [props.postMessage]);

    // folder mode: when any view state has integration_mode === 'folder', pick FolderTreeComposer to build a single merged tree across every loaded doc instead of stacking N per-doc composers
    const folder_mode = anyViewInFolderMode(props.viewStates);
    const integration_path = folder_mode ? firstIntegrationPath(props.viewStates) : undefined;

    if (folder_mode && integration_path) {
        return <div ref={ref} data-testid="NoteRenderer" data-folder-mode="true">
            <Suspense fallback={<div>Loading...</div>}>
                <ErrorBoundary onError={handleRenderError}>
                    <FolderTreeComposer docs={props.notes} integration_path={integration_path} props={props} />
                </ErrorBoundary>
            </Suspense>
        </div>;
    }

    const rendered_notes = Object.entries(props.notes).map(([note_id, note]) => {
        if (!note.content) {
            return null;
        }
        if (note.text) {
            return <Suspense key={note_id} fallback={<div>Loading...</div>}>
                <ErrorBoundary onError={handleRenderError}>
                    <NoteTreeComposer note_id={note_id} note={note} props={props} />
                </ErrorBoundary>
            </Suspense>;
        }
        // fallback: raw MDAST rendering for docs without text
        return <div key={note_id} className="note-renderer">
            {renderNodeUnified(note.content)}
        </div>;
    });
    return <div ref={ref} data-testid="NoteRenderer">
        {rendered_notes}
    </div>;
}
