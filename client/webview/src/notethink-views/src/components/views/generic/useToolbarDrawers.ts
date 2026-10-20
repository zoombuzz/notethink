import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

type DrawerKind = 'settings' | 'cards' | 'files' | 'collisions' | 'jump';
export type ActiveDrawer = 'none' | DrawerKind;

export interface ToolbarDrawers {
    active_drawer: ActiveDrawer;
    gear_button_ref: React.RefObject<HTMLButtonElement | null>;
    toggle_settings: () => void;
    toggle_cards: (anchor: HTMLElement) => void;
    toggle_files: (anchor: HTMLElement) => void;
    toggle_collisions: (anchor: HTMLElement) => void;
    toggle_jump: (anchor: HTMLElement) => void;
    close_drawer: () => void;
}

/*
 * The open drawer of each view, by view id, shared by every hook instance holding that id. An Auto view
 * renders a second GenericView for the type it resolves to, under the same id, and the toolbar lives at
 * whichever level is concrete; choosing a type in the settings tree moves it between the two and
 * remounts it. One shared value per id keeps the drawer the choice was made in open across that move,
 * and across a remount of the only instance. An entry is dropped once no instance holds its id.
 */
const open_drawer_by_view = new Map<string, ActiveDrawer>();
const drawer_listeners_by_view = new Map<string, Set<() => void>>();
// the trigger that opened each view's drawer, which Escape refocuses and an outside click ignores
const anchor_by_view = new Map<string, HTMLElement>();

function readOpenDrawer(view_id: string): ActiveDrawer {
    return open_drawer_by_view.get(view_id) ?? 'none';
}

function writeOpenDrawer(view_id: string, next: ActiveDrawer): void {
    if (readOpenDrawer(view_id) === next) { return; }
    open_drawer_by_view.set(view_id, next);
    drawer_listeners_by_view.get(view_id)?.forEach(listener => listener());
}

function subscribeOpenDrawer(view_id: string, listener: () => void): () => void {
    const listeners = drawer_listeners_by_view.get(view_id) ?? new Set<() => void>();
    listeners.add(listener);
    drawer_listeners_by_view.set(view_id, listeners);
    return () => {
        listeners.delete(listener);
        // deferred, so a remount that unsubscribes and resubscribes in one commit finds its entry still there
        queueMicrotask(() => {
            if (listeners.size > 0 || drawer_listeners_by_view.get(view_id) !== listeners) { return; }
            drawer_listeners_by_view.delete(view_id);
            open_drawer_by_view.delete(view_id);
            anchor_by_view.delete(view_id);
        });
    };
}

/**
 * Owns the at-most-one-open toolbar drawer (settings | cards | files | collisions | jump) plus
 * Escape and outside-click behaviour. The drawer floats over the view rather than reflowing it,
 * so no scroll-anchoring is needed; Escape restores focus to the trigger that opened it.
 */
export function useToolbarDrawers(view_id: string): ToolbarDrawers {
    const subscribe = useCallback((listener: () => void) => subscribeOpenDrawer(view_id, listener), [view_id]);
    const active_drawer = useSyncExternalStore(subscribe, () => readOpenDrawer(view_id));
    const setActiveDrawer = useCallback((next: ActiveDrawer | ((prev: ActiveDrawer) => ActiveDrawer)): void => {
        writeOpenDrawer(view_id, typeof next === 'function' ? next(readOpenDrawer(view_id)) : next);
    }, [view_id]);
    const gear_button_ref = useRef<HTMLButtonElement>(null);
    const toggleDrawer = useCallback((which: DrawerKind, anchor: HTMLElement | null): void => {
        if (anchor) { anchor_by_view.set(view_id, anchor); }
        setActiveDrawer(prev => (prev === which ? 'none' : which));
    }, [view_id, setActiveDrawer]);
    const toggle_settings = useCallback((): void => {
        toggleDrawer('settings', gear_button_ref.current);
    }, [toggleDrawer]);
    const toggle_cards = useCallback((anchor: HTMLElement): void => {
        toggleDrawer('cards', anchor);
    }, [toggleDrawer]);
    const toggle_files = useCallback((anchor: HTMLElement): void => {
        toggleDrawer('files', anchor);
    }, [toggleDrawer]);
    const toggle_collisions = useCallback((anchor: HTMLElement): void => {
        toggleDrawer('collisions', anchor);
    }, [toggleDrawer]);
    const toggle_jump = useCallback((anchor: HTMLElement): void => {
        toggleDrawer('jump', anchor);
    }, [toggleDrawer]);
    // closes the open drawer (the in-drawer X)
    const close_drawer = useCallback((): void => {
        setActiveDrawer('none');
    }, [setActiveDrawer]);
    // Escape closes whichever drawer is open and returns focus to its trigger element
    useEffect(() => {
        if (active_drawer === 'none') { return; }
        const onKeyDown = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                const anchor = anchor_by_view.get(view_id);
                setActiveDrawer('none');
                requestAnimationFrame(() => anchor?.focus());
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [active_drawer, view_id, setActiveDrawer]);
    // outside-click closes the open drawer, excluding the trigger and drawer body; fires before the target's own onClick
    useEffect(() => {
        if (active_drawer === 'none') { return; }
        const drawer_id = `v${view_id}-${active_drawer}-drawer`;
        const onPointerDown = (e: PointerEvent): void => {
            const target = e.target as Node | null;
            if (!target) { return; }
            const anchor = anchor_by_view.get(view_id);
            if (anchor && anchor.contains(target)) { return; }
            // a remount replaces the tab that opened the drawer, so the new one is recognised by what it controls
            if (target instanceof Element && target.closest(`[aria-controls="${drawer_id}"]`)) { return; }
            const drawer_el = document.getElementById(drawer_id);
            if (drawer_el && drawer_el.contains(target)) { return; }
            setActiveDrawer('none');
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [active_drawer, view_id, setActiveDrawer]);
    return { active_drawer, gear_button_ref, toggle_settings, toggle_cards, toggle_files, toggle_collisions, toggle_jump, close_drawer };
}
