import Debug from "debug";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const debug = Debug("nodejs:notethink-views:useToolbarDrawers");

type DrawerKind = 'settings' | 'files' | 'collisions' | 'jump';
type ActiveDrawer = 'none' | DrawerKind;

export interface ToolbarDrawers {
    active_drawer: ActiveDrawer;
    gear_button_ref: React.RefObject<HTMLButtonElement | null>;
    toggle_settings: () => void;
    toggle_files: (anchor: HTMLElement) => void;
    toggle_collisions: (anchor: HTMLElement) => void;
    toggle_jump: (anchor: HTMLElement) => void;
    close_drawer: () => void;
}

/**
 * Owns the at-most-one-open toolbar drawer (settings | files) plus the shared
 * scroll-anchor, Escape, and outside-click behaviour. The trigger element's
 * viewport position is captured on toggle so the scroll-anchor effect keeps it
 * stable across the 150ms open/close animation; Escape restores focus to it.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export function useToolbarDrawers(view_id: string): ToolbarDrawers {
    const [active_drawer, setActiveDrawer] = useState<ActiveDrawer>('none');
    const gear_button_ref = useRef<HTMLButtonElement>(null);
    // the element whose viewport position is held stable across the open/close animation (and refocused on Escape) - the gear for settings, the breadcrumb count for files
    const anchor_el_ref = useRef<HTMLElement | null>(null);
    const anchor_top_ref = useRef<number | null>(null);

    // toggle a drawer; capture the trigger element's viewport position so the scroll-anchor effect can keep it stable through the open/close animation
    const toggleDrawer = useCallback((which: DrawerKind, anchor: HTMLElement | null): void => {
        if (anchor) {
            anchor_el_ref.current = anchor;
            anchor_top_ref.current = anchor.getBoundingClientRect().top;
        }
        setActiveDrawer(prev => (prev === which ? 'none' : which));
    }, []);

    const toggle_settings = useCallback((): void => {
        toggleDrawer('settings', gear_button_ref.current);
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

    // close whichever drawer is open (the in-drawer X button); hold the trigger's viewport position stable across the close animation, mirroring Escape
    const close_drawer = useCallback((): void => {
        const anchor = anchor_el_ref.current;
        if (anchor) { anchor_top_ref.current = anchor.getBoundingClientRect().top; }
        setActiveDrawer('none');
    }, []);

    // scroll-anchor the trigger element across the open/close animation so the content the user was looking at stays visible
    useLayoutEffect(() => {
        if (anchor_top_ref.current === null) { return; }
        const target_top = anchor_top_ref.current;
        let raf_id: number;
        const deadline = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 250; // 150ms anim + margin
        const tick = (): void => {
            const anchor = anchor_el_ref.current;
            if (anchor) {
                const current_top = anchor.getBoundingClientRect().top;
                const delta = current_top - target_top;
                if (Math.abs(delta) > 0.5) {
                    // legacy 2-arg form is always instant; avoids the 'instant' ScrollBehavior typing issue
                    window.scrollBy(0, delta);
                }
            }
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            if (now < deadline) {
                raf_id = requestAnimationFrame(tick);
            }
        };
        raf_id = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf_id);
    }, [active_drawer]);

    // Escape closes whichever drawer is open and returns focus to its trigger element
    useEffect(() => {
        if (active_drawer === 'none') { return; }
        const onKeyDown = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                const anchor = anchor_el_ref.current;
                if (anchor) {
                    anchor_top_ref.current = anchor.getBoundingClientRect().top;
                }
                setActiveDrawer('none');
                requestAnimationFrame(() => anchor_el_ref.current?.focus());
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [active_drawer]);

    /*
     * outside-click closes whichever drawer is open; the trigger and the drawer body are excluded so the trigger's own onClick toggles cleanly and clicks inside the drawer don't dismiss
     * pointerdown (not click) fires before any onClick on the click target, so the drawer is gone by the time the clicked control runs its handler; no focus restore here - focus follows the pointer
     */
    useEffect(() => {
        if (active_drawer === 'none') { return; }
        const drawer_id = `v${view_id}-${active_drawer}-drawer`;
        const onPointerDown = (e: PointerEvent): void => {
            const target = e.target as Node | null;
            if (!target) { return; }
            const anchor = anchor_el_ref.current;
            if (anchor && anchor.contains(target)) { return; }
            const drawer_el = document.getElementById(drawer_id);
            if (drawer_el && drawer_el.contains(target)) { return; }
            setActiveDrawer('none');
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [active_drawer, view_id]);

    return { active_drawer, gear_button_ref, toggle_settings, toggle_files, toggle_collisions, toggle_jump, close_drawer };
}
