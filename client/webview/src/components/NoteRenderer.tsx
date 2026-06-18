import Debug from "debug";
import React, { type ReactElement, Suspense, useCallback, useRef } from 'react';
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { sanitize } from "hast-util-sanitize";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { toHast } from "mdast-util-to-hast";
import { ErrorBoundary } from "../notethink-views/src/components";
import { anyViewInFolderMode, firstIntegrationPath } from "../notethink-views/src/lib/mergeAggregateRoot";
import { pickMostRecentlySentDoc } from "../lib/docops";
import type { Nodes as MdastNodesType } from "mdast";
import type { HashMapOf, Doc } from "../types/general";
import type { TextSelection } from "../notethink-views/src/types/NoteProps";
import type { GlobalSettingsPayload, SettingsCascadePayload } from "../notethink-views/src/types/Messages";
import type { FileIntegrationDeclaration } from "../lib/docops";
import type { ViewState } from './ExtensionReceiver';
import NoteTreeComposer from './composers/NoteTreeComposer';
import FolderTreeComposer from './composers/FolderTreeComposer';

const debug = Debug("nodejs:notethink:NoteRenderer");

export type MdastNodes = MdastNodesType;

export function renderNodeUnified(node: MdastNodes): ReactElement {
    try {
        const hast = sanitize(toHast(node));
        // @ts-ignore safe to ignore type error on jsx and jsxs (https://github.com/syntax-tree/hast-util-to-jsx-runtime)
        return toJsxRuntime(hast, {Fragment, jsx, jsxs});
    } catch (err) {
        debug('renderNodeUnified failed: %O', err);
        return <></>;
    }
}

/**
 * Props plumbed from ExtensionReceiver into the rendered note/view tree.
 * - activeEditorDocPath: path of the doc whose editor is currently active (the last `selectionChanged` source); feeds the per-doc matcher in useViewContext so the caret-driven note focus works in folder mode where the rendered tree aggregates many files. Surfaces here in camelCase per the component-props naming rule; the composers translate to ViewProps.active_editor_doc_path at the data-shape boundary
 */
export interface NoteRendererProps {
    notes: HashMapOf<Doc>;
    selections?: { [docPath: string]: TextSelection };
    activeEditorDocPath?: string;
    postMessage?: (message: unknown) => void;
    viewStates?: Record<string, ViewState>;
    setViewManagedState?: (updates: Array<Record<string, unknown>>) => void;
    onNavigationCommand?: React.MutableRefObject<((direction: string) => void) | undefined>;
    workspace_root?: string;
    workspace_projects?: string[];
    aggregate_total_discovered?: number;
    includeFilter?: string;
    excludeFilter?: string;
    globalSettings?: GlobalSettingsPayload;
    settingsCascade?: SettingsCascadePayload;
    // the opened file's declared integration intent (folder/current_file + scope), resolved at the App layer; threaded into the view so the navigation handlers can reconcile auto congruence
    fileDeclaredIntegration?: FileIntegrationDeclaration;
}

/**
 * NoteRenderer dispatches the loaded Docs to a tree-composer.
 *
 * Current_file mode renders one NoteTreeComposer for the active doc (the most-recently
 * sent doc — `updateSentAt`-stamped by the extension). Stale entries lingering in the
 * docs map (folder→current_file transition states, message races) must not stack up as
 * extra single-file views. Aggregate (folder) mode renders a single FolderTreeComposer
 * that merges every Doc into one synthetic root.
 */
export default function NoteRenderer(props: NoteRendererProps): ReactElement {
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

    // current_file mode: render exactly one composer for the most-recently-sent doc; never stack N single-file views
    const active_entry = pickMostRecentlySentDoc(props.notes);
    let rendered_note: ReactElement | null = null;
    if (active_entry) {
        const { note_id, note } = active_entry;
        if (note.content && note.text) {
            rendered_note = <Suspense key={note_id} fallback={<div>Loading...</div>}>
                <ErrorBoundary onError={handleRenderError}>
                    <NoteTreeComposer note_id={note_id} note={note} props={props} />
                </ErrorBoundary>
            </Suspense>;
        } else if (note.content) {
            // fallback: raw MDAST rendering for docs without text
            rendered_note = <div key={note_id} className="note-renderer">
                {renderNodeUnified(note.content)}
            </div>;
        }
    }
    return <div ref={ref} data-testid="NoteRenderer">
        {rendered_note}
    </div>;
}
