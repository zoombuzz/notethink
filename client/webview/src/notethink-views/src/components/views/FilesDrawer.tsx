import Debug from "debug";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import styles from "../ViewRenderer.module.scss";
import { globMatches } from "../../lib/globMatch";

const debug = Debug("nodejs:notethink-views:FilesDrawer");

// debounce between a keystroke in a filter box and (a) re-filtering the drawer list client-side and (b) the background re-discovery round-trip
const FILES_FILTER_DEBOUNCE_MS = 200;
// floor for the per-file story cap; an empty/NaN input falls back to the current value, never 0
const MIN_MAX_NOTES_PER_FILE = 1;

interface FilesDrawerProps {
    include: string;
    exclude: string;
    maxNotesPerFile: number;
    fileCount: number;
    noteCount: number;
    files: Array<string>;
    onApplyFilters: (include: string, exclude: string, maxNotesPerFile: number) => void;
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

    // resync when the effective globs/cap change underneath us (extension echo, reload, breadcrumb re-narrow)
    useEffect(() => {
        setIncludeValue(props.include);
        setExcludeValue(props.exclude);
        setMaxNotesValue(String(props.maxNotesPerFile));
        setAppliedInclude(props.include);
        setAppliedExclude(props.exclude);
    }, [props.include, props.exclude, props.maxNotesPerFile]);

    // parse the cap input to a clamped integer; an empty/NaN box keeps the current effective value
    const resolveMaxNotes = useCallback((raw: string): number => {
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed)) { return props.maxNotesPerFile; }
        return Math.max(MIN_MAX_NOTES_PER_FILE, parsed);
    }, [props.maxNotesPerFile]);

    const scheduleApply = useCallback((next_include: string, next_exclude: string, next_max_raw: string) => {
        if (debounce_timer.current) { clearTimeout(debounce_timer.current); }
        debounce_timer.current = setTimeout(() => {
            const next_max = resolveMaxNotes(next_max_raw);
            debug('applying filters include=%s exclude=%s maxNotesPerFile=%d', next_include, next_exclude, next_max);
            // (a) instant: re-filter the drawer list client-side
            setAppliedInclude(next_include);
            setAppliedExclude(next_exclude);
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

    const visible_files = useMemo(
        () => props.files.filter(f => globMatches(f, applied_include, applied_exclude)),
        [props.files, applied_include, applied_exclude],
    );

    return (
        <div className={styles.settingsDrawerBody} data-testid="files-drawer">
            <div className={styles.settingsDrawerGroups}>
                <section className={styles.settingsDrawerGroup}>
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
                        />
                    </p>
                    <ul className={styles.filesDrawerList} data-testid="files-drawer-list">
                        {visible_files.length === 0 && (
                            <li className={styles.filesDrawerEmpty}>{l10n.t('No files match the current filters')}</li>
                        )}
                        {visible_files.map(f => (
                            <li key={f} title={f}>{f}</li>
                        ))}
                    </ul>
                </section>
            </div>

            <aside className={styles.settingsDrawerMeta}>
                <h3>{l10n.t('Files')}</h3>
                <p className={styles.settingsDrawerVersion} data-testid="files-drawer-count">
                    {l10n.t('{0} in {1} files', String(props.noteCount), String(props.fileCount))}
                </p>
            </aside>
        </div>
    );
}

export default React.memo(FilesDrawer);
