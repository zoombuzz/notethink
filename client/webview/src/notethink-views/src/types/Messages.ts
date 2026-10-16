/**
 * Message types for extension <-> webview communication.
 *
 * postMessage carries view→host dispatches; selectionChanged carries the host's editor selection into ViewContext.
 */

import type { IntegrationMode } from './IntegrationMode';

// webview -> Extension messages

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
 */
export interface EditTextMessage {
    type: 'editText';
    docId?: string;
    docPath?: string;
    changes?: EditTextChange[];
    changes_by_doc?: Record<string, EditTextChange[]>;
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

export type WebviewToExtensionMessage =
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
    | OpenFileMessage;

// extension -> Webview messages

export interface UpdateMessage {
    type: 'update';
    partial: {
        docs: Record<string, unknown>;
    };
}

export interface SelectionChangedMessage {
    type: 'selectionChanged';
    docPath: string;
    selection: {
        head: number;
        anchor: number;
    };
}

export interface CommandMessage {
    type: 'command';
    command: 'setViewType' | 'navigate';
    viewType?: string;
    direction?: 'up' | 'down' | 'drillIn' | 'drillOut' | 'clearFocus';
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

export type ExtensionToWebviewMessage =
    | UpdateMessage
    | SelectionChangedMessage
    | CommandMessage
    | SettingsCascadeMessage
    | PendingChangeMessage
    | DiscoveryProgressMessage
    | JumpTargetsMessage;
