import React from "react";
import * as l10n from "@vscode/l10n";
import { ACTIVITY_ARG_MAX_CHARS, type ActivitySession } from "../../../types/AgentActivity";
import { AGENT_CLOCK_MODE_DEFAULT, agentClockTooltip, factStateFor, formatActivityUsage, formatAgentClock, sessionDisplayName, sessionStateOf, sessionUsageForStory, shortModelId, truncateActivityArg, vendorLabel, vendorMonogram, type ActivityRefusal, type AgentClockMode, type ActivitySessionState, type ActivityStoryKey } from "../../../lib/agentactivityops";
import AgentChildRows from "./AgentChildRows";
import { agentStateLabel } from "./agentStateLabel";
import { useAgentClockNow } from "./useAgentClockNow";
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
 * A session that launched subagents draws them as a tree under this row (`AgentChildRows`); the row's
 * own name sits beside its monogram and model when the vendor or the registry gave the session one.
 *
 * The counter is this session's share of this story, the same figure the story's own total sums, so
 * the row never outweighs the card it is drawn on; it leaves the window to that total. The clock beside
 * the state draws by `clockMode`: `span` (its first record to its last), `active` (time spent, idle
 * gaps over five minutes left out) or `sinceStart` (its first record to now, advancing once a minute
 * while the row is on screen) - like the counter, measuring what the session consumed rather than how
 * long ago it stopped.
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
 * - clockMode: which of the three measures the clock draws; defaults to AGENT_CLOCK_MODE_DEFAULT so a
 *   caller rendering a row before the settingsCascade has arrived still draws a sensible clock
 */
export interface AgentSessionRowProps {
    state: ActivitySessionState;
    storyKey?: ActivityStoryKey;
    refusals: ReadonlyArray<ActivityRefusal>;
    openRefusal?: string;
    clockMode?: AgentClockMode;
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
    if (session.registry_only) {
        const story = session.registry_story?.trim();
        return { fact: 'registry', text: story ? l10n.t('Registered, on {0}', story) : l10n.t('Registered agent') };
    }
    const current = session.current;
    const fact = factStateFor(session, 'live_tool_call', current !== undefined);
    if (fact === 'unsupported') {
        return { fact, text: l10n.t('{0} cannot report what it is running', vendorLabel(session.vendor)) };
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

/** the state word a row draws: a registry entry that says working with nothing to show for it reads `Stale`, never `Working` */
function rowStateLabel(session: ActivitySession): string {
    return session.registry_stale ? l10n.t('Stale') : agentStateLabel(sessionStateOf(session));
}

function AgentSessionRow(props: AgentSessionRowProps): React.ReactElement {
    const session = props.state.session;
    const registry_only = session.registry_only === true;
    const clock_mode = props.clockMode ?? AGENT_CLOCK_MODE_DEFAULT;
    const now_ms = useAgentClockNow(clock_mode === 'sinceStart');
    const live = liveLine(props.state);
    // a registry-only row has no transcript to price, and the empty cell keeps the row's grid columns
    const usage = registry_only ? '' : formatActivityUsage(sessionUsageForStory(props.state, props.storyKey));
    // a name is drawn only when the vendor or the registry gave one; the short id fallback would only add noise to every row
    const named = (session.session_name?.trim() || session.registry_name?.trim()) ? sessionDisplayName(session) : undefined;
    return (
        <li className={styles.agentRow} data-state={sessionStateOf(session)} data-registry-only={registry_only ? 'true' : undefined} data-stale={session.registry_stale ? 'true' : undefined} data-testid="agent-row">
            <button
                type="button"
                className={styles.agentRowButton}
                data-testid="agent-row-button"
                title={registry_only ? l10n.t('Known from the agent registry only, so there is no session to open') : l10n.t('Open this session in VS Code')}
                disabled={registry_only}
                onClick={(event) => { event.stopPropagation(); props.onOpen(session.vendor, session.session_id); }}
            >
                <span className={styles.agentRail} aria-hidden={true} />
                <span className={styles.agentIdent}>
                    <span className={styles.agentMonogram} data-testid="agent-monogram" title={session.vendor}>{vendorMonogram(session.vendor)}</span>
                    {named !== undefined && <span className={styles.agentName} data-testid="agent-name" title={named}>{named}</span>}
                    <span className={styles.agentModel} data-testid="agent-model" title={session.model}>{shortModelId(session.model)}</span>
                </span>
                <span className={styles.agentStatus}>
                    <span className={styles.agentState} data-testid="agent-state">{rowStateLabel(session)}</span>
                    <span className={styles.agentClock} data-testid="agent-clock" title={agentClockTooltip(session, clock_mode, new Date(now_ms).toISOString())}>{formatAgentClock(session, clock_mode, now_ms)}</span>
                </span>
                <span className={styles.agentLive} data-testid="agent-live" data-fact={live.fact} title={live.text}>{live.text}</span>
                <span className={styles.agentUsage} data-testid="agent-usage" title={usage}>{usage}</span>
            </button>
            {session.children !== undefined && session.children.length > 0 && (
                <AgentChildRows vendor={session.vendor} items={session.children} omitted={session.children_omitted} />
            )}
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
