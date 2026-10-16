import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * Owns the at-most-one-open toolbar drawer (settings | cards | files | collisions | jump) plus
 * Escape and outside-click behaviour. The drawer floats over the view rather than reflowing it,
 * so no scroll-anchoring is needed; Escape restores focus to the trigger that opened it.
 */
export function useToolbarDrawers(view_id: string): ToolbarDrawers {
    const [active_drawer, setActiveDrawer] = useState<ActiveDrawer>('none');
    const gear_button_ref = useRef<HTMLButtonElement>(null);
    // held stable so Escape and outside-click can refocus/exclude it: the gear for settings, breadcrumb count for files
    const anchor_el_ref = useRef<HTMLElement | null>(null);
    const toggleDrawer = useCallback((which: DrawerKind, anchor: HTMLElement | null): void => {
        if (anchor) { anchor_el_ref.current = anchor; }
        setActiveDrawer(prev => (prev === which ? 'none' : which));
    }, []);
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
    }, []);
    // Escape closes whichever drawer is open and returns focus to its trigger element
    useEffect(() => {
        if (active_drawer === 'none') { return; }
        const onKeyDown = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                setActiveDrawer('none');
                requestAnimationFrame(() => anchor_el_ref.current?.focus());
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [active_drawer]);
    // outside-click closes the open drawer, excluding the trigger and drawer body; fires before the target's own onClick
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
    return { active_drawer, gear_button_ref, toggle_settings, toggle_cards, toggle_files, toggle_collisions, toggle_jump, close_drawer };
}
