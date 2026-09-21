import React from "react";
import AgentDrawer from "../../views/drawers/AgentDrawer";
import type { ActivitySessionState, ActivityUnavailable } from "../../../lib/agentactivityops";
import styles from "../AgentNote.module.scss";

/**
 * The push-down region a session's drawer opens into, on the card rather than under the toolbar.
 *
 * The 0fr -> 1fr grid trick is the same one the toolbar drawers use, but the shell is local: the
 * toolbar's is sticky-positioned against the toolbar's own height, which means nothing inside a card
 * that may be sitting in a kanban lane. The region is always in the DOM so `aria-controls` on the
 * agent row resolves whether or not anything is open.
 */
export interface AgentSessionDrawerRegionProps {
    drawerId: string;
    state: ActivitySessionState | undefined;
    unavailable: ActivityUnavailable | undefined;
    onOpenChat: (vendor: string, session_id: string) => void;
}

function AgentSessionDrawerRegion(props: AgentSessionDrawerRegionProps): React.ReactElement {
    const open = props.state !== undefined;
    return (
        <div id={props.drawerId} className={styles.drawerGrid} data-open={open} data-testid="agent-drawer" aria-hidden={!open}>
            <div className={styles.drawer}>
                {props.state && <AgentDrawer state={props.state} unavailable={props.unavailable} onOpenChat={props.onOpenChat} />}
            </div>
        </div>
    );
}

export default React.memo(AgentSessionDrawerRegion);
