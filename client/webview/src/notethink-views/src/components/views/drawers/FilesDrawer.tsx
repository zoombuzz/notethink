import Debug from "debug";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { globMatches } from "../../../lib/globMatch";
import SettingsCascadeButtons from "../SettingsCascadeButtons";
import styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:FilesDrawer");

// debounce between a keystroke in a filter box and (a) re-filtering the drawer list client-side and (b) the background re-discovery round-trip
const FILES_FILTER_DEBOUNCE_MS = 200;
// floor for the per-file story cap; an empty/NaN input falls back to the current value, never 0
const MIN_MAX_NOTES_PER_FILE = 1;

type FilesDrawerField = 'include' | 'exclude' | 'max_notes';

interface FilesDrawerProps {
    include: string;
    exclude: string;
    maxNotesPerFile: number;
    fileCount: number;
    noteCount: number;
    files: Array<string>;
    onApplyFilters: (include: string, exclude: string, maxNotesPerFile: number) => void;
    onFileClick?: (file_path: string) => void;
    workspaceRoot?: string;
    onMakeDefault?: () => void;
    onResetToDefault?: () => void;
    canResetToDefault?: boolean;
    onRestoreBuiltinDefault?: () => void;
    canRestoreBuiltinDefault?: boolean;
}

// resolve a Files-drawer entry to the absolute path the openFile message needs (aggregate_loaded_files are workspace-relative where known)
function absolutizeFilePath(file_path: string, workspace_root?: string): string {
    if (file_path.startsWith('/')) { return file_path; }
    return workspace_root ? `${workspace_root}/${file_path}` : file_path;
}

/**
 * Files drawer: the folder-mode counterpart of the Settings drawer. Shows the editable
 * include/exclude globs, the per-file story cap, the file/note count, and the live list of
 * currently-selected files. Typing in a box debounces FILES_FILTER_DEBOUNCE_MS, then
 * re-filters the list client-side (instant feedback) and calls onApplyFilters so the owning
 * view can persist the globs/cap and post a background setIntegration that re-discovers the
 * whole folder view. The per-file cap is webview-only and never round-trips to the extension.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
function FilesDrawer(props: FilesDrawerProps): ReactElement {
    // controlled input state, seeded from the effective globs/cap
    const [include_value, setIncludeValue] = useState(props.include);
    const [exclude_value, setExcludeValue] = useState(props.exclude);
    // keep the cap input as a string so an in-progress edit (empty box) doesn't snap to a number
    const [max_notes_value, setMaxNotesValue] = useState(String(props.maxNotesPerFile));
    // debounced copies drive both the visible list and the background reapply
    const [applied_include, setAppliedInclude] = useState(props.include);
    const [applied_exclude, setAppliedExclude] = useState(props.exclude);
    const debounce_timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // the field the user is typing in owns its value: an echo must never rewrite it, or the caret jumps to the end
    const focused_field = useRef<FilesDrawerField | null>(null);
    const skipped_echo = useRef(false);
    // globs of an apply whose echo has not landed yet; an echo arriving meanwhile is older than what the user applied
    const awaited_echo = useRef<{ include: string; exclude: string } | null>(null);
    const resyncFromProps = useCallback((skip_field: FilesDrawerField | null) => {
        if (skip_field !== 'include') {
            setIncludeValue(props.include);
            setAppliedInclude(props.include);
        }
        if (skip_field !== 'exclude') {
            setExcludeValue(props.exclude);
            setAppliedExclude(props.exclude);
        }
        if (skip_field !== 'max_notes') { setMaxNotesValue(String(props.maxNotesPerFile)); }
    }, [props.include, props.exclude, props.maxNotesPerFile]);
    // resync when the effective globs/cap change underneath us (extension echo, reload, breadcrumb re-narrow)
    useEffect(() => {
        if (awaited_echo.current?.include === props.include && awaited_echo.current?.exclude === props.exclude) { awaited_echo.current = null; }
        skipped_echo.current = focused_field.current !== null;
        resyncFromProps(focused_field.current);
    }, [resyncFromProps, props.include, props.exclude]);
    // parse the cap input to a clamped integer; an empty/NaN box keeps the current effective value
    const resolveMaxNotes = useCallback((raw: string): number => {
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed)) { return props.maxNotesPerFile; }
        return Math.max(MIN_MAX_NOTES_PER_FILE, parsed);
    }, [props.maxNotesPerFile]);
    const scheduleApply = useCallback((next_include: string, next_exclude: string, next_max_raw: string) => {
        if (debounce_timer.current) { clearTimeout(debounce_timer.current); }
        debounce_timer.current = setTimeout(() => {
            debounce_timer.current = undefined;
            const next_max = resolveMaxNotes(next_max_raw);
            debug('applying filters include=%s exclude=%s maxNotesPerFile=%d', next_include, next_exclude, next_max);
            // (a) instant: re-filter the drawer list client-side
            setAppliedInclude(next_include);
            setAppliedExclude(next_exclude);
            awaited_echo.current = { include: next_include, exclude: next_exclude };
            // (b) background: persist + re-discover the whole folder view
            props.onApplyFilters(next_include, next_exclude, next_max);
        }, FILES_FILTER_DEBOUNCE_MS);
    }, [props.onApplyFilters, resolveMaxNotes]);
    // clear any pending timer on unmount so a debounced apply can't fire after the drawer closes
    useEffect(() => () => {
        if (debounce_timer.current) { clearTimeout(debounce_timer.current); }
    }, []);
    const handleIncludeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setIncludeValue(value);
        scheduleApply(value, exclude_value, max_notes_value);
    }, [scheduleApply, exclude_value, max_notes_value]);
    const handleExcludeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setExcludeValue(value);
        scheduleApply(include_value, value, max_notes_value);
    }, [scheduleApply, include_value, max_notes_value]);
    const handleMaxNotesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setMaxNotesValue(value);
        scheduleApply(include_value, exclude_value, value);
    }, [scheduleApply, include_value, exclude_value]);
    const handleFieldFocus = useCallback((field: FilesDrawerField) => {
        focused_field.current = field;
    }, []);
    // on leaving a field, adopt an effective value it skipped while focused; an apply still pending or awaiting its echo will do that instead
    const handleFieldBlur = useCallback(() => {
        focused_field.current = null;
        if (skipped_echo.current && !debounce_timer.current && !awaited_echo.current) { resyncFromProps(null); }
        skipped_echo.current = false;
    }, [resyncFromProps]);
    const visible_files = useMemo(
        () => props.files.filter(f => globMatches(f, applied_include, applied_exclude)),
        [props.files, applied_include, applied_exclude],
    );
    return (
        <div className={styles.drawerBody} data-testid="files-drawer">
            <div className={styles.drawerGroups}>
                <section className={styles.drawerGroup}>
                    {props.noteCount === 0 && (
                        <div className={styles.filesDrawerInstructions} data-testid="files-drawer-instructions">
                            <p className={styles.filesDrawerInstructionsTitle}>{l10n.t('Point NoteThink at your stories')}</p>
                            <p>{l10n.t('Set the Include filter to the markdown files where you keep your notes, for example {0} or {1}.', '**/todo.md', 'docs/**/*.md')}</p>
                            <p>{l10n.t('NoteThink turns each {0} heading into a story card, with task list items written as {1} and {2}.', '###', '+ [ ]', '+ [X]')}</p>
                        </div>
                    )}
                    <p>
                        <label htmlFor="notethink-files-include">{l10n.t('Include filter')}</label>
                        <input
                            id="notethink-files-include"
                            type="text"
                            className={styles.filesDrawerInput}
                            data-testid="files-drawer-include"
                            spellCheck={false}
                            value={include_value}
                            placeholder="**/*.md"
                            onChange={handleIncludeChange}
                            onFocus={() => handleFieldFocus('include')}
                            onBlur={handleFieldBlur}
                        />
                    </p>
                    <p>
                        <label htmlFor="notethink-files-exclude">{l10n.t('Exclude filter')}</label>
                        <input
                            id="notethink-files-exclude"
                            type="text"
                            className={styles.filesDrawerInput}
                            data-testid="files-drawer-exclude"
                            spellCheck={false}
                            value={exclude_value}
                            placeholder=""
                            onChange={handleExcludeChange}
                            onFocus={() => handleFieldFocus('exclude')}
                            onBlur={handleFieldBlur}
                        />
                    </p>
                    <p>
                        <label htmlFor="notethink-files-max-notes">{l10n.t('Max stories per file')}</label>
                        <input
                            id="notethink-files-max-notes"
                            type="number"
                            min={MIN_MAX_NOTES_PER_FILE}
                            step={1}
                            className={styles.filesDrawerInput}
                            data-testid="files-drawer-max-notes"
                            spellCheck={false}
                            value={max_notes_value}
                            placeholder="10"
                            onChange={handleMaxNotesChange}
                            onFocus={() => handleFieldFocus('max_notes')}
                            onBlur={handleFieldBlur}
                        />
                    </p>
                    <p className={styles.filesDrawerCount} data-testid="files-drawer-count">
                        {l10n.t('{0} in {1} files', String(props.noteCount), String(props.fileCount))}
                    </p>
                    <ul className={`${styles.drawerList} ${styles.filesDrawerList}`} data-testid="files-drawer-list">
                        {visible_files.length === 0 && (
                            <li className={styles.drawerEmpty}>{l10n.t('No files match the current filters')}</li>
                        )}
                        {visible_files.map(f => (
                            <li key={f}>
                                <button
                                    type="button"
                                    className={styles.drawerLink}
                                    data-testid="files-drawer-file"
                                    title={f}
                                    onClick={() => props.onFileClick?.(absolutizeFilePath(f, props.workspaceRoot))}
                                >
                                    {f}
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>

            <aside className={styles.drawerMeta}>
                <h3>{l10n.t('File settings')}</h3>
                {props.onMakeDefault && props.onResetToDefault && props.onRestoreBuiltinDefault && (
                    <SettingsCascadeButtons
                        onMakeDefault={props.onMakeDefault}
                        onResetToDefault={props.onResetToDefault}
                        canResetToDefault={props.canResetToDefault}
                        onRestoreBuiltinDefault={props.onRestoreBuiltinDefault}
                        canRestoreBuiltinDefault={props.canRestoreBuiltinDefault}
                    />
                )}
            </aside>
        </div>
    );
}

export default React.memo(FilesDrawer);
