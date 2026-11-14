/**
 * Message types for extension <-> webview communication.
 *
 * postMessage carries view→host dispatches; selectionChanged carries the host's editor selection into ViewContext.
 */

import type { IntegrationMode } from './IntegrationMode';
import type { SetIntegrationMessage } from '../lib/viewstateops';

/*
 * The version of the message protocol below. A renderer states it in `requestInitialState` and a host
 * states it in every `update`, so a host that is not the VS Code extension, or a renderer that is not
 * this webview, can tell when the other side speaks a different one. Raise it when a message changes
 * meaning or gains a required field; a new optional field does not need it. Mirrored as PROTOCOL_VERSION
 * in client/extension/src/constants.ts, which shares no module graph with this package.
 *
 * The agent-activity and coordinator messages are not part of it: they serve cards that read files on the
 * machine the extension runs on, and their shapes live with their handlers in client/extension/src/vscode.
 */
export const PROTOCOL_VERSION = 1;

// webview -> Extension messages

/**
 * Webview -> extension, sent once on mount after any `setIntegration` replay: asks for the active doc,
 * its selection and the settings cascade.
 * - protocol_version: the PROTOCOL_VERSION the renderer was built against
 */
export interface RequestInitialStateMessage {
    type: 'requestInitialState';
    protocol_version?: number;
}

export interface RevealRangeMessage {
    type: 'revealRange';
    docId: string;
    docPath: string;
    from: number;
    to?: number;
    forceOpen?: boolean;
}

export interface SelectRangeMessage {
    type: 'selectRange';
    docId: string;
    docPath: string;
    from: number;
    to: number;
    forceOpen?: boolean;
}

export interface EditTextChange {
    from: number;
    to?: number;
    insert: string;
}

/**
 * Webview -> extension request to apply text changes to one or more docs; exactly one of `changes`
 * (paired with `docPath`) or `changes_by_doc` is set.
 * - single-doc: `docPath` + `changes` set. The legacy shape, used for kanban reorders within one file.
 * - multi-doc: `changes_by_doc` set (keyed by `docPath`). Used for folder-mode reorders spanning files;
 *   each entry applies independently, so a failure on one doc does not abort the batch.
 * - doc_hashes: keyed by doc path, the `hash_sha256` of the text each doc's offsets were computed
 *   against. The host refuses a doc whose text now hashes differently and re-sends that doc, so an edit
 *   worked out on stale text never lands on changed text. A doc with no entry is applied unchecked.
 */
export interface EditTextMessage {
    type: 'editText';
    docId?: string;
    docPath?: string;
    changes?: EditTextChange[];
    changes_by_doc?: Record<string, EditTextChange[]>;
    doc_hashes?: Record<string, string>;
}

export interface OpenExternalMessage {
    type: 'openExternal';
    url: string;
}

/**
 * Webview -> extension request to open a relative .md link. The extension resolves `href` against
 * the active document's URI, validates workspace containment and the .md extension, then opens the
 * target beside the panel.
 */
export interface OpenRelativeMessage {
    type: 'openRelative';
    href: string;
}

/**
 * Per-key write to a setting. Scope defaults to 'workspace' on the extension side when omitted,
 * falling back to the user scope in a folderless window where a workspace write throws; 'global'
 * is the promote path. This is the only message that writes a setting; there is no second
 * channel for a subset of keys.
 *
 * `setting: 'views'` / `'cards'` are the one exception to `value` being the setting's own shape:
 * `value` is a `BagDelta` (one or more single-cell changes to that bag) rather than the whole map,
 * because the map spans both config scopes merged node by node and key by key, and only the extension
 * can read the scopes apart to apply the change without clobbering the other. `settingWriteFor` in
 * viewregistryops.ts builds a single-cell delta; a multi-cell delta (minting, renaming or deleting a
 * saved type) is built where it is dispatched, so every related cell lands in one atomic write.
 */
export interface UpdateSettingMessage {
    type: 'updateSetting';
    setting: SettingsCascadeKey | 'views' | 'cards';
    value: unknown;
    scope?: 'workspace' | 'global';
}

/**
 * One cell change inside a `views` or `cards` bag.
 * - node_id: the bag entry the change applies to - a built-in tree node or a saved type's id
 * - key: the field inside that entry, or `null` for a whole-entry operation (minting or deleting a
 *   saved type), since a saved type's creation and removal touch more than one field at once
 * - value: the new value for `key`, `undefined` clearing it (pruning the whole entry once empty); for
 *   a whole-entry operation, the complete replacement object, or `undefined` to delete the entry
 */
export interface BagCellOp {
    node_id: string;
    key: string | null;
    value: unknown;
}

/**
 * The `value` an `UpdateSettingMessage` carries for `setting: 'views'` or `'cards'`: every cell change
 * applies together against the target scope's own copy of that bag, in order, so a multi-field
 * operation (minting a type, renaming it, deleting it and its descendants) is one atomic write rather
 * than a race between several round trips.
 */
export interface BagDelta {
    sets: BagCellOp[];
}

/**
 * Promotes every currently-resolved cascade setting into User scope, then clears the Workspace
 * overrides so the cascade reads from User next time.
 */
export interface PromoteSettingsToUserMessage {
    type: 'promoteSettingsToUser';
}

/**
 * Clears every Workspace-scope cascade override so the cascade falls back to User (or the built-in
 * default if no User override exists).
 */
export interface ResetSettingsToDefaultMessage {
    type: 'resetSettingsToDefault';
}

/**
 * Clears every Workspace- and User-scope cascade override so the cascade falls back to the built-in
 * (package.json) defaults; the recovery path when both have been edited away (e.g. a wiped exclude
 * filter the user can't reconstruct by hand).
 */
export interface RestoreSettingsToBuiltinDefaultMessage {
    type: 'restoreSettingsToBuiltinDefault';
}

/**
 * Webview -> extension request for the jump targets (folders/files) reachable from the breadcrumb
 * terminal leaf. The extension replies asynchronously with a JumpTargetsMessage carrying the same
 * mode/path so the webview can correlate the response.
 */
export interface RequestJumpTargetsMessage {
    type: 'requestJumpTargets';
    mode: IntegrationMode;
    path: string;
}

/**
 * Webview -> extension request to open a file in the editor (e.g. a chosen jump target of kind 'file').
 */
export interface OpenFileMessage {
    type: 'openFile';
    path: string;
}

/** Webview -> extension: the first agent card mounted, so the host starts reading agent activity. */
export interface ActivityDemandMessage {
    type: 'activityDemand';
}

/** Webview -> extension: the last agent card unmounted, so the host may stop reading agent activity. */
export interface ActivityWithdrawMessage {
    type: 'activityWithdraw';
}

/** Webview -> extension: the user switched audio capture on or off for the window. */
export interface AudioToggleMessage {
    type: 'audioToggle';
    enabled: boolean;
}

/**
 * Webview -> extension: one chunk of captured audio from the viewer that owns the microphone.
 * - chunk_index: counts from 0 for each capture; a chunk dropped as silence still advances it
 * - started_at: ISO 8601 time the chunk began, by the capturing client's clock
 * - pcm: 16 kHz mono 16-bit little-endian samples
 */
export interface AudioChunkMessage {
    type: 'audioChunk';
    chunk_index: number;
    started_at: string;
    pcm: ArrayBuffer | Uint8Array;
}

/** Webview -> extension: the owning viewer's microphone went live or stopped, with any failure's name. */
export interface AudioCaptureStatusMessage {
    type: 'audioCaptureStatus';
    capturing: boolean;
    error_name?: string;
}

/** Webview -> extension: whether this frame may ask for the microphone at all, for the host's log. */
export interface AudioFrameCheckMessage {
    type: 'audioFrameCheck';
    verdict: string;
}

/** Webview -> extension: an uncaught error or rejection in the webview, relayed to the host's log. */
export interface RenderErrorMessage {
    type: 'renderError';
    message: string;
    stack: string;
}

export type WebviewToExtensionMessage =
    | RequestInitialStateMessage
    | SetIntegrationMessage
    | RevealRangeMessage
    | SelectRangeMessage
    | EditTextMessage
    | OpenExternalMessage
    | OpenRelativeMessage
    | UpdateSettingMessage
    | PromoteSettingsToUserMessage
    | ResetSettingsToDefaultMessage
    | RestoreSettingsToBuiltinDefaultMessage
    | RequestJumpTargetsMessage
    | OpenFileMessage
    | ActivityDemandMessage
    | ActivityWithdrawMessage
    | AudioToggleMessage
    | AudioChunkMessage
    | AudioCaptureStatusMessage
    | AudioFrameCheckMessage
    | RenderErrorMessage;

// extension -> Webview messages

/**
 * Extension -> webview: one or more docs, keyed by doc id. A doc is its path, its text and the text's
 * `hash_sha256`, with its mdast as `content` when the host parsed it.
 * - merge_strategy: 'merge' adds the docs to those the webview holds (a folder view); absent replaces them
 * - protocol_version: the PROTOCOL_VERSION the host speaks
 * - extension_version: the host's own version, which the webview compares with the bundle it was built from
 * - workspace_projects: the workspace's root folder names, in a multi-root folder view
 * - aggregate_total_discovered, aggregate_truncated: how many files a folder view found, and whether it stopped early
 * - include_filter, exclude_filter: the globs the folder view was discovered with
 */
export interface UpdateMessage {
    type: 'update';
    partial: {
        docs: Record<string, unknown>;
    };
    merge_strategy?: 'merge';
    protocol_version?: number;
    extension_version?: string;
    workspace_root?: string;
    workspace_projects?: string[];
    aggregate_total_discovered?: number;
    aggregate_truncated?: boolean;
    include_filter?: string;
    exclude_filter?: string;
}

/**
 * Extension -> webview: the active editor's doc when it sits outside the folder a view is showing, so the
 * webview can follow the editor without merging the doc into the folder.
 */
export interface ActiveEditorDocMessage {
    type: 'activeEditorDoc';
    doc: Record<string, unknown>;
}

/** Extension -> webview: a file a folder view was showing has been deleted. */
export interface DocDeletedMessage {
    type: 'docDeleted';
    docId: string;
    docPath: string;
}

/**
 * Extension -> webview: where the editor's caret and selection sit in a doc; `selection` is null when no
 * editor owns the doc, which hands focus and selection to the view.
 */
export interface SelectionChangedMessage {
    type: 'selectionChanged';
    docPath: string;
    selection: {
        head: number;
        anchor: number;
    } | null;
}

/**
 * Extension -> webview: a command run from the host's own menus or keys.
 * - viewType: the view to switch to, for 'setViewType'
 * - direction: where to move focus, for 'navigate'
 * - mode, path: the integration scope to adopt, for 'setIntegrationScope'
 */
export interface CommandMessage {
    type: 'command';
    command: 'setViewType' | 'navigate' | 'setIntegrationScope';
    viewType?: string;
    direction?: 'up' | 'down' | 'drillIn' | 'drillOut' | 'clearFocus';
    mode?: IntegrationMode;
    path?: string;
}

/**
 * One group's position and visibility in the group-display order, the cascade's `groupDisplay` entry
 * shape. Mirrored from GroupDisplayEntry in client/extension/src/lib/settings.ts, which the webview
 * cannot import - the two are separate webpack bundles with no shared module graph, so this
 * duplication is the wire contract.
 * - value: the group's raw status/group value ('doing', 'done', 'untagged', ...)
 * - shown: false removes the group from the board (Kanban and Line view both read it); true (or absent) shows it
 * - axis: the group-by key the board groupd by when the entry was written; absent means status
 */
export interface GroupDisplayEntry {
    value: string;
    shown: boolean;
    axis?: string;
}

/**
 * A view type the user minted by saving a change to a setting an ancestor owns. Derived from its entry
 * in the `views` bag (`UserViewTypesFromViews` in viewregistryops.ts): a saved type's bag entry carries
 * `parent` and `label` alongside its override keys, which is what tells it apart from a built-in node's
 * own entry.
 * - id: the registry node id, frozen once written
 * - label: what the tree shows
 * - parent: the built-in node it was saved from and inherits from
 * - overrides: the setting keys and values that distinguish it from that parent
 */
export interface UserViewType {
    id: string;
    label: string;
    parent: string;
    overrides: Record<string, unknown>;
}

/**
 * The settings identifiers every row, label and resolution rule is keyed by, mirrored from
 * client/extension/src/lib/settings.ts's `CASCADE_KEY_DEFAULTS`, which the webview cannot import - the
 * two are separate webpack bundles with no shared module graph, so this duplication is the wire contract.
 * `viewType` and `cardType` are their tree's selection rather than a row; every other key is a row on
 * one drawer pane. Declared as a const array (rather than derived from a payload's keys, as before this
 * story) because the wire payload no longer carries one field per setting - every view- and card-tree
 * setting now lives in the `views` / `cards` bag instead.
 */
export const CASCADE_SETTING_KEYS = [
    'viewType',
    'cardType',
    'showLinetagsInHeadlines',
    'scrollNoteIntoView',
    'autoExpandFocusedNote',
    'showLineNumbers',
    'groupBy',
    'orientation',
    'lineBreadth',
    'groupDisplay',
    'groupOrder',
    'cardRatio',
    'animateTransitions',
    'defaultCardType',
    'clockMode',
    'watchUnopenedFilesInViewer',
    'openNewEditorIfNoneOpen',
    'includeFilter',
    'excludeFilter',
    'maxNotesPerFile',
] as const;

export type SettingsCascadeKey = typeof CASCADE_SETTING_KEYS[number];

/**
 * The raw settings message the extension pushes on requestInitialState and whenever any underlying
 * key changes - the wire shape, not the flat shape a view or a drawer reads. `views` and `cards` are
 * one bag per tree node (built-in nodes and saved types alike for `views`; `allcards`, `card`,
 * `sticky`, `agent` for `cards`), each holding every value that node sets for itself, whatever its
 * key's home. `viewregistryops.ts`'s `resolvedSettingsFromCascade` is the one place this gets unpacked
 * into the flat `ResolvedSettingsCascade` every view, drawer and composer actually reads.
 * - diverged: cells whose resolved value differs from their saved default - the five flat keys below by
 *   name, and a bag cell as `views:<node_id>:<key>` / `cards:<node_id>:<key>`; drives the drawer's M
 *   markers and diverged count, emptying when the user saves or reverts the defaults
 * - hasWorkspaceOverrides: true iff anything has a Workspace-scope value; drives "Revert to defaults"
 * - hasAnyOverrides: true iff anything has a Workspace- or User-scope value; drives whether the
 *   built-in restore is enabled, since there is nothing to restore when everything is already default
 *
 * Settings identifiers stay camelCase end-to-end (TS keys, wire IDs, payload fields, VS Code config
 * paths), unlike the project-wide snake_case wire convention, since bridging the two cases would mean
 * every setting carries two names.
 */
export interface SettingsCascadePayload {
    views: Record<string, Record<string, unknown>>;
    cards: Record<string, Record<string, unknown>>;
    watchUnopenedFilesInViewer: boolean;
    openNewEditorIfNoneOpen: boolean;
    includeFilter: string;
    excludeFilter: string;
    maxNotesPerFile: number;
    diverged: string[];
    hasWorkspaceOverrides: boolean;
    hasAnyOverrides: boolean;
}

/**
 * The flat, resolved shape every view, drawer and composer reads: one field per `SettingsCascadeKey`,
 * plus `viewUserTypes` and `viewOverrides` derived from the wire payload's `views` bag so the rest of
 * the webview - which predates the bag storage model - keeps reading the same two shapes it always has.
 * Built by `resolvedSettingsFromCascade` (viewregistryops.ts); nothing else constructs one by hand.
 */
export interface ResolvedSettingsCascade {
    viewType: string;
    cardType: string;
    viewUserTypes: UserViewType[];
    viewOverrides: Record<string, Record<string, unknown>>;
    cardOverrides: Record<string, Record<string, unknown>>;
    showLinetagsInHeadlines: boolean;
    scrollNoteIntoView: boolean;
    autoExpandFocusedNote: boolean;
    showLineNumbers: boolean;
    groupBy: string;
    orientation: 'columns' | 'rows';
    lineBreadth: number;
    groupDisplay: GroupDisplayEntry[];
    groupOrder: 'custom' | 'newestFirst' | 'newestLast' | 'alphabetical' | 'cardCount';
    cardRatio: number;
    animateTransitions: boolean;
    defaultCardType: string;
    clockMode: 'span' | 'active' | 'sinceStart';
    watchUnopenedFilesInViewer: boolean;
    openNewEditorIfNoneOpen: boolean;
    includeFilter: string;
    excludeFilter: string;
    maxNotesPerFile: number;
    diverged: string[];
    hasWorkspaceOverrides: boolean;
    hasAnyOverrides: boolean;
}

export interface SettingsCascadeMessage {
    type: 'settingsCascade';
    settings: SettingsCascadePayload;
}

/**
 * Extension-driven signal that a unit of work the user is waiting on has started or finished.
 * Routed into the pending-work hook keyed by `key` (opaque; 'folderDiscovery' is a well-known
 * value), whose delay-then-show policy keeps a fast operation from visibly flashing. `on` marks
 * pending (`true`) or clears it (`false`); fields stay camelCase, matching the other
 * extension-to-webview message types.
 */
export interface PendingChangeMessage {
    type: 'pendingChange';
    key: string;
    on: boolean;
}

/**
 * AudioState is the window-wide audio capture state the extension pushes to every viewer.
 * - available: an endpoint is configured and valid; false means no audio control renders at all
 * - enabled: the user's remembered on or off choice
 * - owner: this viewer is the one that captures, one per window
 * - capturing: the owner reports its microphone is live
 * - error_name: the last microphone failure, cleared on the next successful start
 * - dropped_count: chunks dropped from the upload queue this session
 */
export interface AudioState {
    available: boolean;
    enabled: boolean;
    owner: boolean;
    capturing: boolean;
    error_name?: string;
    dropped_count: number;
}

/**
 * Extension -> webview progress ticks during folder discovery, bracketed by the pendingChange
 * folderDiscovery signal. 'walking' only ticks on the non-file: readDirectory walk, where findFiles
 * gives no incremental progress; 'loading' covers the per-file read that follows discovery on every
 * scheme. Throttled on the extension side to roughly one message per quarter second, plus a final
 * tick for each phase, so a large folder does not mean a message per directory or file. The webview
 * clears its own copy on the matching pendingChange rather than waiting for an explicit clear message.
 */
export interface DiscoveryProgress {
    phase: 'walking' | 'loading';
    dirs_walked?: number;
    files_found?: number;
    files_loaded?: number;
    files_total?: number;
}

export interface DiscoveryProgressMessage extends DiscoveryProgress {
    type: 'discoveryProgress';
}

/**
 * One reachable jump target from the breadcrumb terminal leaf.
 * - kind discriminates a directory ('folder') from a leaf file ('file'); the webview opens a file target via OpenFileMessage and descends a folder target via setIntegration
 */
export interface JumpTarget {
    label: string;
    path: string;
    kind: 'folder' | 'file';
}

/**
 * Extension -> webview async reply to RequestJumpTargetsMessage, carrying the originating mode/path
 * back so the webview can match the response to the request that triggered it.
 */
export interface JumpTargetsMessage {
    type: 'jumpTargets';
    mode: IntegrationMode;
    path: string;
    entries: JumpTarget[];
}

/** Extension -> webview: the window-wide audio capture state, pushed whenever it changes. */
export interface AudioStateMessage {
    type: 'audioState';
    state: AudioState;
}

export type ExtensionToWebviewMessage =
    | UpdateMessage
    | ActiveEditorDocMessage
    | DocDeletedMessage
    | SelectionChangedMessage
    | CommandMessage
    | SettingsCascadeMessage
    | PendingChangeMessage
    | DiscoveryProgressMessage
    | JumpTargetsMessage
    | AudioStateMessage;
