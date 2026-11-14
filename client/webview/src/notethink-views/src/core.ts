/*
 * The renderer-neutral core of NoteThink: markdown to a note tree, the view registry and how a setting
 * resolves on it, the calculators that turn an intent into text changes, and the messages a host and a
 * renderer exchange. Nothing reachable from here imports React or a stylesheet or touches the DOM when it
 * loads, so a renderer that is not the React webview can build on it. `core.test.ts` holds that line.
 */
export { buildKanbanDragEndPayload, type KanbanDragEndPayloadInput } from "./components/views/kanban/kanbanDragEndPayload";
export { ABSENT_VALUE_BUCKET, KANBAN_AXIS_KEY } from "./lib/axisops";
export { convertMdastToNoteHierarchy, type MdastInput } from "./lib/convertMdastToNoteHierarchy";
export {
    calculateTextChangesForNewLinetagValue,
    calculateTextChangesForOrdering,
    findLineTags,
    flattenOrderingChangeSets,
    parseLineTags,
    resolveNamespacedTag,
    type OrderingChange,
    type OrderingChangeSet,
} from "./lib/linetagops";
export {
    fileDeclaredCardType,
    fileDeclaredGroupBy,
    fileDeclaredGroupOrder,
    fileDeclaredViewType,
    findFileH1,
    flattenSingleFileStories,
    mergeAggregateRoot,
    stampSingleFileStableIds,
    type AggregatedDocInput,
    type MergeAggregateRootResult,
} from "./lib/mergeAggregateRoot";
export {
    calculateTextChangesForCheckbox,
    flattenAllNotes,
    kanbanColumnValue,
    kanbanNoteOrder,
    noteOrder,
    notesInKanbanColumn,
    slugify,
    storyStableIdSlug,
    stripHeadlineLinetags,
} from "./lib/noteops";
export { parse } from "./lib/parseops";
export {
    SETTING_HOMES,
    VIEW_REGISTRY,
    chainOf,
    childViewNodes,
    getViewNode,
    isDescendantOf,
    registryWithUserTypes,
    resolveViewSetting,
    resolvedSettingsForView,
    resolvedSettingsFromCascade,
    selectableViewIds,
    type ViewNode,
    type ViewRegistry,
    type ViewSettingResolution,
} from "./lib/viewregistryops";
export {
    CASCADE_SETTING_KEYS,
    PROTOCOL_VERSION,
    type EditTextChange,
    type EditTextMessage,
    type ExtensionToWebviewMessage,
    type RequestInitialStateMessage,
    type ResolvedSettingsCascade,
    type SettingsCascadeKey,
    type SettingsCascadePayload,
    type UpdateMessage,
    type UpdateSettingMessage,
    type WebviewToExtensionMessage,
} from "./types/Messages";
export type { LineTag, MdastNode, NoteOrigin, NoteProps, TextPosition } from "./types/NoteProps";
