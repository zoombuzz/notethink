/**
 * ESLint rule: comment-style
 *
 * Enforces the checkable parts of the workspace comment standard (AGENTS.md > Code conventions >
 * Comment style); whether a comment earns its place stays a review judgement.
 * - blockCapital: a multi-line block comment is prose, so its first word is capitalised. A first
 *   word that is an identifier (camelCase, snake_case, backticked) is exempt.
 * - fieldComment: no comment inside an interface or type literal except a `// ---` section divider;
 *   a field is documented in the structure's header block.
 * - lineLowercase: a line comment does not open with a sentence-case function word ("The", "This").
 * - lineLength: a line comment stays within `maxLineLength` characters (URLs exempt).
 * - trailingPeriod: a one-sentence line comment has no trailing full stop (on when `trailingPeriod`
 *   is true).
 * - backReference: no "see above/below" pointer and no dated note ("measured 2026-09", "review
 *   2026-07"); a date describing a test fixture is not a note.
 */
const DIRECTIVE = /^\s*(eslint\b|eslint-|globals?\b|exported\b|@ts-|prettier-ignore|c8\b|istanbul\b|v8\b|@jsx|@type\b|@typedef\b|webpackChunkName)/;
const DIVIDER = /^\s*-{3}/;
const SENTENCE_STARTERS = new Set(['The', 'This', 'These', 'That', 'Those', 'A', 'An', 'If', 'When', 'We', 'It', 'Its', 'For', 'Note', 'In', 'On', 'To', 'Use', 'Used', 'Only', 'Otherwise', 'Also', 'Here', 'Then', 'Ensure', 'Make', 'Keep', 'Check', 'Set', 'Get', 'Return', 'Returns']);
const BACK_REFERENCE = /\bsee (above|below)\b|\b(measured|blessed|decision|decided|review|reviewed|verified|confirmed|checked|added|fixed|updated|since|as of)\s+(on\s+)?20\d\d-(0[1-9]|1[0-2])\b/i;
const ALLOWED_PERIOD_ENDINGS = /(\.\.\.|\b(e\.g|i\.e|etc|vs)\.)$/;
const FIELD_CONTAINERS = new Set(['TSInterfaceBody', 'TSTypeLiteral']);

const rule = {
    meta: {
        type: 'suggestion',
        docs: { description: 'the checkable parts of the workspace comment standard' },
        messages: {
            blockCapital: 'a multi-line block comment is prose: capitalise its first word',
            fieldComment: 'no comment inside a data structure: document the field in its header block as `- field: ...`',
            lineLowercase: 'a line comment starts lowercase',
            lineLength: 'line comment is {{length}} characters (max {{max}}): say less, or lift it to the header block',
            trailingPeriod: 'a line comment has no trailing full stop',
            backReference: 'no back-references or dated notes in comments: state the fact itself',
        },
        schema: [{
            type: 'object',
            properties: {
                maxLineLength: { type: 'integer', minimum: 40 },
                trailingPeriod: { type: 'boolean' },
            },
            additionalProperties: false,
        }],
    },
    create(context) {
        const options = context.options[0] ?? {};
        const max_line_length = options.maxLineLength ?? 120;
        const source_code = context.sourceCode ?? context.getSourceCode();
        const firstWord = (text) => text.replace(/^[\s*]+/, '').split(/\s+/)[0] ?? '';
        const checkBlock = (comment) => {
            if (comment.loc.start.line === comment.loc.end.line) { return; }
            const word = firstWord(comment.value);
            if (/^[a-z]+(-[a-z]+)*[,:;.]?$/.test(word)) {
                context.report({ loc: comment.loc, messageId: 'blockCapital' });
            }
        };
        const checkLine = (comment) => {
            const text = comment.value.trim();
            if (text === '' || DIVIDER.test(text)) { return; }
            if (SENTENCE_STARTERS.has(firstWord(text))) {
                context.report({ loc: comment.loc, messageId: 'lineLowercase' });
            }
            if (text.length > max_line_length && !/https?:\/\//.test(text)) {
                context.report({ loc: comment.loc, messageId: 'lineLength', data: { length: text.length, max: max_line_length } });
            }
            if (options.trailingPeriod && text.endsWith('.') && !ALLOWED_PERIOD_ENDINGS.test(text) && !/[.!?]\s+[A-Z]/.test(text)) {
                context.report({ loc: comment.loc, messageId: 'trailingPeriod' });
            }
        };
        return {
            Program() {
                for (const comment of source_code.getAllComments()) {
                    if (DIRECTIVE.test(comment.value.replace(/^\*/, ''))) { continue; }
                    const container = source_code.getNodeByRangeIndex(comment.range[0]);
                    if (container && FIELD_CONTAINERS.has(container.type) && !(comment.type === 'Line' && DIVIDER.test(comment.value))) {
                        context.report({ loc: comment.loc, messageId: 'fieldComment' });
                    }
                    if (BACK_REFERENCE.test(comment.value)) {
                        context.report({ loc: comment.loc, messageId: 'backReference' });
                    }
                    if (comment.type === 'Block') { checkBlock(comment); } else { checkLine(comment); }
                }
            },
        };
    },
};

export default rule;
