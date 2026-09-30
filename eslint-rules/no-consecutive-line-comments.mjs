/**
 * ESLint rule: no-consecutive-line-comments
 *
 * enforces the workspace comment standard: an inline line comment is exactly one
 * line, never two standalone `//` lines in a row. a wrapped thought, several stacked
 * thoughts, or an ASCII / structure illustration is too complex to be inline and
 * belongs in a block (header) comment above the declaration. directive comments
 * (eslint-*, @ts-*, prettier-ignore, etc.) and trailing comments (a `//` after code
 * on the same line) are skipped; only two standalone line comments on consecutive
 * lines are reported.
 */
const DIRECTIVE = /^\s*(eslint\b|eslint-|globals?\b|exported\b|@ts-|prettier-ignore|c8\b|istanbul\b|v8\b|@jsx)/;

const rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'an inline line comment is one line; stacked/wrapped comments belong in a block (header) comment',
        },
        messages: {
            consecutive:
                'consecutive // comments - make it one line or lift to a block (header) comment',
        },
        schema: [],
    },
    create(context) {
        const source_code = context.sourceCode ?? context.getSourceCode();
        const isStandalone = (comment) => {
            const before = source_code.getTokenBefore(comment, { includeComments: true });
            return !before || before.loc.end.line < comment.loc.start.line;
        };
        return {
            Program() {
                let prev = null;
                for (const comment of source_code.getAllComments()) {
                    if (comment.type !== 'Line' || DIRECTIVE.test(comment.value) || !isStandalone(comment)) {
                        prev = null;
                        continue;
                    }
                    if (prev && comment.loc.start.line === prev.loc.end.line + 1) {
                        context.report({ loc: comment.loc, messageId: 'consecutive' });
                    }
                    prev = comment;
                }
            },
        };
    },
};

export default rule;
