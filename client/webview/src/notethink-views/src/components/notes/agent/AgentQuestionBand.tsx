import React from "react";
import { factStateFor, type ActivitySessionState } from "../../../lib/agentactivityops";
import styles from "../AgentNote.module.scss";

/**
 * The question band: what each agent on this card is waiting on the operator for.
 *
 * A band is drawn only for a pending question the vendor reported, with its prompt and, where the
 * vendor exposes them, the options offered. A vendor that cannot report a question draws nothing here:
 * the session row states the agent's state in words, and a line on every card saying what a vendor
 * cannot do is noise, not information. Claude Code reports that it is waiting through its own session
 * status, which reaches the row as the `waiting` state, with no question text to draw.
 *
 * Every string here comes from a transcript this codebase did not author, so it is rendered as text
 * and never as markdown or HTML.
 */
export interface AgentQuestionBandProps {
    sessions: ReadonlyArray<ActivitySessionState>;
}

function AgentQuestionBand(props: AgentQuestionBandProps): React.ReactElement | null {
    const questions = props.sessions.filter(state => factStateFor(state.session, 'question', state.session.question !== undefined) === 'reported');
    if (questions.length === 0) { return null; }
    return (
        <ul className={styles.questionBands} data-testid="agent-question-bands">
            {questions.map(state => state.session.question && (
                <li key={state.session.session_id} className={styles.questionBand} data-fact="reported" data-testid="agent-question-band">
                    <span className={styles.questionPrompt} data-testid="agent-question-prompt">{state.session.question.prompt}</span>
                    {state.session.question.options && state.session.question.options.length > 0 && (
                        <span className={styles.questionOptions} data-testid="agent-question-options">{state.session.question.options.join(' / ')}</span>
                    )}
                </li>
            ))}
        </ul>
    );
}

export default React.memo(AgentQuestionBand);
