import React, { useState } from "react";
import * as l10n from "@vscode/l10n";
import { ACTIVITY_ARG_MAX_CHARS, type ActivitySession } from "../../../types/AgentActivity";
import { AGENT_CLOCK_MODE_DEFAULT, agentClockTooltip, factStateFor, formatActivityUsage, formatAgentClock, sessionDisplayName, sessionExpandedByDefault, sessionStateOf, sessionUsageForStory, shortModelId, truncateActivityArg, vendorLabel, vendorMonogram, type ActivityRefusal, type AgentClockMode, type ActivitySessionState, type ActivityStoryKey } from "../../../lib/agentactivityops";
import Chevron from "../../Chevron";
import AgentChildRows from "./AgentChildRows";
import { agentStateDrawn, agentStateLabel } from "./agentStateLabel";
import { useAgentClockNow } from "./useAgentClockNow";
import styles from "../AgentNote.module.scss";

/**
 * One agent on a card: the state rail, the vendor's monospace monogram, and the one live line saying
 * what the agent is doing now.
 *
 * The row is two lines at every card width: a quiet header (the monogram and the session's name, the
 * clock, then the model), and under it the live line with the counter at its right. The header is one
 * clipped line, so the model drops out when there is no room, then the clock, and the name stays. A
 * working or waiting agent draws no state word, since the rail colour and the story's own headline say
 * it, but the word stays in the row's accessible name; every other state is drawn. Every cell stays on
 * one line and truncates, carrying its whole text as a hover title, because a cell broken inside a word
 * cannot be read at all.
 *
 * A session that launched subagents is a tree item, as in a VS Code tree: a chevron beside its row
 * expands and collapses the group of subagents drawn under it (`AgentChildRows`), and the state rail
 * runs the whole height of the item, so an expanded group sits visibly inside its agent. The group
 * shows by default while the agent is working or waiting; a reader's own choice then wins, and is kept
 * in this row's state, which survives snapshot updates because the roster keys each row by session id.
 * Right and Left expand and collapse it from the keyboard. The row's own name sits beside its
 * monogram and model when the vendor or the registry gave the session one.
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
 * A session whose transcript was over the size limit carries a short note beside its clock, saying its
 * usage and time cover only the newest part.
 *
 * A file the host refused that belongs to this session is drawn on this row rather than only in the
 * card's banner, so a session whose transcript or event log could not be read says so where a reader
 * is looking at that session.
 *
 * The row's label is one native button rather than a div carrying tabIndex and a hand-rolled key
 * handler, so Enter and Space and focus order come for free. It opens the session in VS Code, in the
 * vendor's own chat panel or as its transcript, and when the host could open neither, the reason is
 * drawn under the row. The chevron is a second button with its own name, so the two never share one.
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

/** the reasons a file of this session, or opening the session, was refused, drawn under its row */
function AgentRowRefusals(props: { refusals: ReadonlyArray<ActivityRefusal>; openRefusal?: string; vendor: string }): React.ReactElement | null {
    if (props.refusals.length === 0 && props.openRefusal === undefined) { return null; }
    return (
        <ul className={styles.agentRowRefusals} data-testid="agent-row-refusals">
            {props.refusals.map(refusal => (
                <li key={`${refusal.file}:${refusal.code}`}>{l10n.t('{0} could not be read: {1}', refusal.file, refusal.reason)}</li>
            ))}
            {props.openRefusal !== undefined && (
                <li key="open" data-testid="agent-open-refusal">{openRefusalLabel(props.openRefusal, props.vendor)}</li>
            )}
        </ul>
    );
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
    const children = session.children ?? [];
    const has_children = children.length > 0;
    // undefined until the reader chooses, so the default keeps following the session's state until then
    const [chosen_expanded, setChosenExpanded] = useState<boolean | undefined>(undefined);
    const [finished_open, setFinishedOpen] = useState(false);
    const expanded = chosen_expanded ?? sessionExpandedByDefault(session);
    const label = named ?? sessionDisplayName(session);
    const state_label = rowStateLabel(session);
    const state_drawn = session.registry_stale === true || agentStateDrawn(sessionStateOf(session));
    const onKeyDown = (event: React.KeyboardEvent<HTMLLIElement>): void => {
        if (!has_children || (event.target as HTMLElement).closest('[role="treeitem"]') !== event.currentTarget) { return; }
        if (event.key === 'ArrowRight' && !expanded) { event.preventDefault(); setChosenExpanded(true); }
        if (event.key === 'ArrowLeft' && expanded) { event.preventDefault(); setChosenExpanded(false); }
    };
    return (
        <li
            role="treeitem"
            aria-level={1}
            aria-selected={false}
            aria-expanded={has_children ? expanded : undefined}
            className={styles.agentRow}
            data-state={sessionStateOf(session)}
            data-registry-only={registry_only ? 'true' : undefined}
            data-stale={session.registry_stale ? 'true' : undefined}
            data-testid="agent-row"
            onKeyDown={onKeyDown}
        >
            <span className={styles.agentRail} data-testid="agent-row-rail" aria-hidden={true} />
            <div className={styles.agentRowHeader}>
                {has_children ? (
                    <button
                        type="button"
                        className={styles.agentTwisty}
                        data-testid="agent-row-toggle"
                        aria-label={expanded ? l10n.t('Collapse the subagents of {0}', label) : l10n.t('Expand the subagents of {0}', label)}
                        title={expanded ? l10n.t('Collapse subagents') : l10n.t('Expand subagents')}
                        onClick={(event) => { event.stopPropagation(); setChosenExpanded(!expanded); }}
                    >
                        <Chevron direction={expanded ? "down" : "right"} />
                    </button>
                ) : <span className={styles.agentTwisty} aria-hidden={true} />}
                <button
                    type="button"
                    className={styles.agentRowButton}
                    data-testid="agent-row-button"
                    title={registry_only ? l10n.t('Known from the agent registry only, so there is no session to open') : l10n.t('Open this session in VS Code')}
                    disabled={registry_only}
                    onClick={(event) => { event.stopPropagation(); props.onOpen(session.vendor, session.session_id); }}
                >
                    <span className={styles.agentHeader}>
                        <span className={styles.agentIdent}>
                            <span className={styles.agentMonogram} data-testid="agent-monogram" title={session.vendor}>{vendorMonogram(session.vendor)}</span>
                            {named !== undefined && <span className={styles.agentName} data-testid="agent-name" title={named}>{named}</span>}
                        </span>
                        {state_drawn
                            ? <span className={styles.agentState} data-testid="agent-state">{state_label}</span>
                            : <span className={styles.agentStateQuiet} data-testid="agent-state-quiet">{state_label}</span>}
                        <span className={styles.agentClock} data-testid="agent-clock" title={agentClockTooltip(session, clock_mode, new Date(now_ms).toISOString())}>{formatAgentClock(session, clock_mode, now_ms)}</span>
                        {session.tail_read && <span className={styles.agentTailRead} data-testid="agent-tail-read" title={l10n.t('This transcript is over the size limit, so its usage and time cover only its newest part')}>{l10n.t('newest part only')}</span>}
                        <span className={styles.agentModel} data-testid="agent-model" title={session.model}>{shortModelId(session.model)}</span>
                    </span>
                    <span className={styles.agentLive} data-testid="agent-live" data-fact={live.fact} title={live.text}>{live.text}</span>
                    <span className={styles.agentUsage} data-testid="agent-usage" title={usage}>{usage}</span>
                </button>
            </div>
            {has_children && expanded && (
                <AgentChildRows vendor={session.vendor} items={children} omitted={session.children_omitted} finished_open={finished_open} onToggleFinished={setFinishedOpen} />
            )}
            <AgentRowRefusals refusals={props.refusals} openRefusal={props.openRefusal} vendor={session.vendor} />
        </li>
    );
}

export default React.memo(AgentSessionRow);
