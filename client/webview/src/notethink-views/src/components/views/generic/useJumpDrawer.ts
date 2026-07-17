import Debug from "debug";
import { useCallback, useState } from "react";
import type { ViewProps } from "../../../types/ViewProps";

const debug = Debug("nodejs:notethink-views:useJumpDrawer");

export interface JumpDrawerModel {
    requested_jump_path: string | undefined;
    open_jump_drawer: (leaf_path: string, anchor: HTMLElement) => void;
}

/**
 * Owns the Jump drawer's requested leaf - the folder whose navigation targets the drawer lists. The
 * leaf names itself: the drawer opens from the breadcrumb's terminal segment, which passes its own
 * path, so the drawer always lists the subtree the visible trail ends at. The requested path is what
 * JumpDrawer matches the extension's reply against, so a stale reply for a previous leaf never
 * renders.
 */
export function useJumpDrawer(
    props: ViewProps,
    toggle_jump: (anchor: HTMLElement) => void,
    handle_jump_request: (leaf_path: string) => void,
): JumpDrawerModel {
    const [requested_jump_path, setRequestedJumpPath] = useState<string | undefined>(undefined);

    const open_jump_drawer = useCallback((leaf_path: string, anchor: HTMLElement): void => {
        setRequestedJumpPath(leaf_path);
        toggle_jump(anchor);
        handle_jump_request(leaf_path);
    }, [toggle_jump, handle_jump_request]);

    debug("requested=%s view=%s", requested_jump_path, props.id);
    return { requested_jump_path, open_jump_drawer };
}
