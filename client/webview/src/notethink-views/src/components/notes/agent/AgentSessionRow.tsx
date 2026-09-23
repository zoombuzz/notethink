import React from "react";
import * as l10n from "@vscode/l10n";
import { ACTIVITY_ARG_MAX_CHARS } from "../../../types/AgentActivity";
import { factStateFor, formatActivityUsage, formatDurationClock, sessionStateOf, sessionUsageForStory, shortModelId, truncateActivityArg, vendorMonogram, type ActivityRefusal, type ActivitySessionState, type ActivityStoryKey } from "../../../lib/agentactivityops";
import { agentStateLabel } from "./agentStateLabel";
import styles from "../AgentNote.module.scss";

/**
 * One agent on a card: the state rail, the vendor's monospace monogram, and the one live line saying
 * what the agent is doing now.
 *
 * The row is laid out by the width of the card it sits in, not by the view: stacked on a narrow card
 * (monogram, model, state and clock; then the live line; then the counter), and on one line where the
 * card is wide enough. Every cell stays on one line and truncates, carrying its whole text as a hover
 * title, because a cell broken inside a word cannot be read at all.
 *
 * The counter is this session's share of this story, the same figure the story's own total sums, so
 * the row never outweighs the card it is drawn on; it leaves the window to that total. The clock beside
 * the state is how long the session ran, from its first record to its last, so like the counter it
 * measures what the session consumed rather than how long ago it stopped.
 *
 * State owns the colour and the monogram is monochrome type, so the only saturated mark on the card is
 * the one worth acting on. The live line distinguishes the three things it may honestly say: the tool
 * call when there is one, "nothing running" when the producer could have reported one and did not, and
 * "not reported" when this vendor cannot report one at all. A blank line would read as the first of
 * those whichever of the three was true.
 *
 * A file the host refused that belongs to this session is drawn on this row rather than only in the
 * card's banner, so a session whose transcript or event log could not be read says so where a reader
 * is looking at that session.
 *
 * The whole row is one native button rather than a div carrying tabIndex and a hand-rolled key
 * handler, so Enter and Space and focus order come for free. It opens the session in VS Code, in the
 * vendor's own chat panel or as its transcript, and when the host could open neither, the reason is
 * drawn under the row.
 * - storyKey: the card's join key, so the counter shows this session's split share of the story;
 *   undefined on a virtual note, whose one session is its whole usage
 * - openRefusal: the host's reason this session could not be opened, undefined when it has not refused
 */
export interface AgentSessionRowProps {
    state: ActivitySessionState;
    storyKey?: ActivityStoryKey;
    refusals: ReadonlyArray<ActivityRefusal>;
    openRefusal?: string;
    onOpen: (vendor: string, session_id: string) => void;
}

/** the host's answer when a session could not be opened in VS Code at all */
function openRefusalLabel(reason: string, vendor: string): string {
    switch (reason) {
        case 'bad_request': return l10n.t('That session id is not one NoteThink will open.');
        case 'no_transcript': return l10n.t('{0} left no transcript NoteThink has read for this session.', vendor);
        default: return l10n.t('VS Code could not open this session.');
    }
}

/** the live line's text, and which of the three honest answers it is */
function liveLine(state: ActivitySessionState): { text: string; fact: string } {
    const session = state.session;
    const current = session.current;
    const fact = factStateFor(session, 'live_tool_call', current !== undefined);
    if (fact === 'unsupported') {
        return { fact, text: l10n.t('{0} cannot report what it is running', session.vendor) };
    }
    if (fact === 'quiet' || !current) {
        return { fact, text: l10n.t('Nothing running') };
    }
    const arg = truncateActivityArg(current.arg, ACTIVITY_ARG_MAX_CHARS);
    if (current.tool) {
        return { fact, text: arg ? `${current.tool} ${arg}` : current.tool };
    }
    return { fact, text: arg || current.kind };
}

function AgentSessionRow(props: AgentSessionRowProps): React.ReactElement {
    const session = props.state.session;
    const live = liveLine(props.state);
    const usage = formatActivityUsage(sessionUsageForStory(props.state, props.storyKey));
    return (
        <li className={styles.agentRow} data-state={sessionStateOf(session)} data-testid="agent-row">
            <button
                type="button"
                className={styles.agentRowButton}
                data-testid="agent-row-button"
                title={l10n.t('Open this session in VS Code')}
                onClick={(event) => { event.stopPropagation(); props.onOpen(session.vendor, session.session_id); }}
            >
                <span className={styles.agentRail} aria-hidden={true} />
                <span className={styles.agentIdent}>
                    <span className={styles.agentMonogram} data-testid="agent-monogram" title={session.vendor}>{vendorMonogram(session.vendor)}</span>
                    <span className={styles.agentModel} data-testid="agent-model" title={session.model}>{shortModelId(session.model)}</span>
                </span>
                <span className={styles.agentStatus}>
                    <span className={styles.agentState} data-testid="agent-state">{agentStateLabel(sessionStateOf(session))}</span>
                    <span className={styles.agentClock} data-testid="agent-clock" title={l10n.t('Ran from {0} to {1}', session.started_at, session.updated_at)}>{formatDurationClock(session.started_at, session.updated_at)}</span>
                </span>
                <span className={styles.agentLive} data-testid="agent-live" data-fact={live.fact} title={live.text}>{live.text}</span>
                <span className={styles.agentUsage} data-testid="agent-usage" title={usage}>{usage}</span>
            </button>
            {(props.refusals.length > 0 || props.openRefusal !== undefined) && (
                <ul className={styles.agentRowRefusals} data-testid="agent-row-refusals">
                    {props.refusals.map(refusal => (
                        <li key={`${refusal.file}:${refusal.code}`}>{l10n.t('{0} could not be read: {1}', refusal.file, refusal.reason)}</li>
                    ))}
                    {props.openRefusal !== undefined && (
                        <li key="open" data-testid="agent-open-refusal">{openRefusalLabel(props.openRefusal, session.vendor)}</li>
                    )}
                </ul>
            )}
        </li>
    );
}

export default React.memo(AgentSessionRow);
