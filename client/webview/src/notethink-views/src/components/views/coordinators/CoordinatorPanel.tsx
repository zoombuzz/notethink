import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { COORDINATOR_MOVE_MARKER_MESSAGE_TYPE, COORDINATOR_SEND_MESSAGE_TYPE } from "../../../lib/agentactivityops";
import { readCoordinatorCompose, useAgentActivity, useAgentActivityDemand, useCoordinatorCompose, useCoordinatorResult } from "../../../lib/activityhooks";
import { convoyCountLabel, coordinatorResultMessage, coordinatorsInScope, coordinatorStateLabel } from "../../../lib/coordinatorops";
import type { ActivityCoordinator } from "../../../types/AgentActivity";
import CoordinatorTargetLine from "./CoordinatorTargetLine";
import styles from "./CoordinatorPanel.module.scss";

interface CoordinatorPanelProps {
    loaded_files: ReadonlyArray<string> | undefined;
    post_message: ((message: Record<string, unknown>) => void) | undefined;
}

/**
 * The registered coordinators beside the board of a folder view: one row per agent whose repository
 * holds a file the view has loaded, so a folder holding several repositories lists each repository's
 * agent, and a view open on one repository lists the one agent that owns it. It draws nothing when no
 * agent is registered, and nothing at all where the host cannot read the registry (a browser host).
 *
 * The panel only shows and asks. It never starts, stops or restarts an agent: the two things it can do
 * are a message to an agent's mailbox, written only when the user presses Send, and a move of the
 * target line on the agent's board. The host does both; the panel names the agent and nothing else.
 */
export default function CoordinatorPanel(props: CoordinatorPanelProps): ReactElement | null {
    useAgentActivityDemand(props.post_message, false);
    const snapshot = useAgentActivity();
    const coordinators = useMemo(() => coordinatorsInScope(snapshot?.coordinators ?? [], props.loaded_files), [snapshot, props.loaded_files]);
    if (coordinators.length === 0) { return null; }
    return (
        <section className={styles.panel} role="region" aria-label={l10n.t('Coordinators')} data-testid="coordinator-panel">
            {coordinators.map(coordinator => <CoordinatorRow key={coordinator.agent} coordinator={coordinator} post_message={props.post_message} />)}
        </section>
    );
}

interface RowProps {
    coordinator: ActivityCoordinator;
    post_message: ((message: Record<string, unknown>) => void) | undefined;
}

function CoordinatorRow(props: RowProps): ReactElement {
    const { coordinator, post_message } = props;
    const [send_open, setSendOpen] = useState(false);
    const [target_open, setTargetOpen] = useState(false);
    const [text, setText] = useState('');
    // the line's position the user just asked for, held until the board reports it or the host refuses
    const [pending_position, setPendingPosition] = useState<number | undefined>(undefined);
    const text_ref = useRef<HTMLTextAreaElement>(null);
    const handled_compose_seq = useRef(readCoordinatorCompose()?.seq ?? 0);
    const result = useCoordinatorResult();
    const compose = useCoordinatorCompose();
    const own_result = result?.agent === coordinator.agent ? result : undefined;
    const position = pending_position ?? coordinator.marker_after;
    // a new position from the board is the answer to a move, so the held one is let go
    useEffect(() => { setPendingPosition(undefined); }, [coordinator.marker_after]);
    // a refused move, or one that left the board unsaved, lets the line show what the board holds
    useEffect(() => {
        if (own_result?.request === 'move' && own_result.code !== 'moved') { setPendingPosition(undefined); }
    }, [own_result?.seq]);
    // a sent message is on its way, so the form empties
    useEffect(() => {
        if (own_result?.request === 'send' && own_result.ok) { setText(''); }
    }, [own_result?.seq]);
    // a story card asked for this agent's send form, opened with its story named
    useEffect(() => {
        if (!compose || compose.seq === handled_compose_seq.current || compose.agent !== coordinator.agent) { return; }
        handled_compose_seq.current = compose.seq;
        setSendOpen(true);
        setText(compose.text);
        setTimeout(() => text_ref.current?.focus(), 0);
    }, [compose, coordinator.agent]);
    function handleSend(event: FormEvent): void {
        event.preventDefault();
        post_message?.({ type: COORDINATOR_SEND_MESSAGE_TYPE, agent: coordinator.agent, body: text });
    }
    function handleMove(next: number): void {
        setPendingPosition(next);
        post_message?.({ type: COORDINATOR_MOVE_MARKER_MESSAGE_TYPE, agent: coordinator.agent, after: next });
    }
    const message = own_result ? coordinatorResultMessage(own_result) : undefined;
    const convoys = coordinator.open_convoys.length;
    return (
        <div className={styles.row} data-testid="coordinator-row" data-agent={coordinator.agent} data-state={coordinator.state}>
            <div className={styles.rowHead}>
                <span className={styles.stateDot} data-state={coordinator.state} aria-hidden="true" />
                <span className={styles.agentName} data-testid="coordinator-name">{coordinator.agent}</span>
                <span className={styles.state} data-testid="coordinator-state">{coordinatorStateLabel(coordinator.state)}</span>
                {coordinator.story && <span className={styles.detail} data-testid="coordinator-story-now">{l10n.t('On story {0}', coordinator.story)}</span>}
                {coordinator.version && <span className={styles.detail} data-testid="coordinator-version">{l10n.t('Version {0}', coordinator.version)}</span>}
                {convoys > 0 && <span className={styles.detail} data-testid="coordinator-convoys">{convoyCountLabel(convoys)}</span>}
                <span className={styles.actions}>
                    <button type="button" className={styles.action} aria-expanded={send_open} data-testid="coordinator-send-toggle" onClick={() => setSendOpen(open => !open)}>{l10n.t('Send to agent')}</button>
                    <button type="button" className={styles.action} aria-expanded={target_open} data-testid="coordinator-target-toggle" onClick={() => setTargetOpen(open => !open)}>{l10n.t('Target line')}</button>
                </span>
            </div>
            {send_open && (
                <form className={styles.sendForm} onSubmit={handleSend} data-testid="coordinator-send-form">
                    <textarea
                        ref={text_ref}
                        className={styles.sendText}
                        rows={3}
                        value={text}
                        aria-label={l10n.t('Message for {0}', coordinator.agent)}
                        data-testid="coordinator-send-text"
                        onChange={event => setText(event.target.value)}
                    />
                    <button type="submit" className={styles.action} disabled={text.trim().length === 0} data-testid="coordinator-send-submit">{l10n.t('Send')}</button>
                </form>
            )}
            {target_open && <CoordinatorTargetLine coordinator={coordinator} position={position} onMove={handleMove} />}
            <div className={styles.status} role="status" aria-live="polite" data-testid="coordinator-status" data-code={own_result?.code}>{message}</div>
        </div>
    );
}
