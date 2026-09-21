import React from "react";
import * as l10n from "@vscode/l10n";
import { factStateFor } from "../../../lib/agentactivityops";
import type { ActivitySessionState } from "../../../lib/agentactivityops";
import styles from "../AgentNote.module.scss";

/**
 * The question band: what each agent on this card is waiting on the operator for.
 *
 * A band is drawn in exactly two cases, and they read differently on purpose. A pending question gets
 * its prompt and, where the vendor exposes them, the options offered. A vendor that exposes no
 * permission record at all gets a band saying so, because the alternative - drawing nothing - is the
 * shape "this agent is not waiting on you" has, and the two must never look alike.
 *
 * A session whose producer can report questions and has none draws no band. That absence is not
 * ambiguous: the session row above states the agent's state in words, so "Working" or "Idle" beside no
 * band says what it means.
 *
 * Every string here comes from a transcript this codebase did not author, so it is rendered as text
 * and never as markdown or HTML.
 */
export interface AgentQuestionBandProps {
    sessions: ReadonlyArray<ActivitySessionState>;
}

function AgentQuestionBand(props: AgentQuestionBandProps): React.ReactElement | null {
    const bands = props.sessions
        .map(state => ({ state, fact: factStateFor(state.session, 'question', state.session.question !== undefined) }))
        .filter(entry => entry.fact !== 'quiet');
    if (bands.length === 0) { return null; }
    return (
        <ul className={styles.questionBands} data-testid="agent-question-bands">
            {bands.map(({ state, fact }) => (
                <li key={state.session.session_id} className={styles.questionBand} data-fact={fact} data-testid="agent-question-band">
                    {fact === 'unsupported' && (
                        <span className={styles.questionUnsupported}>{l10n.t('{0} cannot report whether it is waiting on you', state.session.vendor)}</span>
                    )}
                    {fact === 'reported' && state.session.question && (
                        <>
                            <span className={styles.questionPrompt} data-testid="agent-question-prompt">{state.session.question.prompt}</span>
                            {state.session.question.options && state.session.question.options.length > 0 && (
                                <span className={styles.questionOptions} data-testid="agent-question-options">{state.session.question.options.join(' / ')}</span>
                            )}
                        </>
                    )}
                </li>
            ))}
        </ul>
    );
}

export default React.memo(AgentQuestionBand);
