/**
 * ESLint rule: no-midfunction-block-comments
 *
 * enforces the other half of the workspace comment standard: a comment that needs more than one
 * line belongs in the header block above a function, type or declaration, never between statements
 * inside a function body. the sibling rule no-consecutive-line-comments already catches the `//`
 * form of the same fault; this catches the `/* *\/` form, which is the shape people reach for when
 * they have three sentences to say and which nothing was checking.
 *
 * a multi-line block comment is allowed directly above a declaration, a class member, an export, or
 * a test-suite call (describe/it/test and their hooks, in the plain, member and each-tagged forms),
 * because each of those is a header block.
 * a single-line block comment is always allowed, since it is the one-line form the standard permits.
 */
const SUITE_CALLS = new Set(['describe', 'it', 'test', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll']);

const HEADER_POSITIONS = new Set([
    'FunctionDeclaration',
    'ClassDeclaration',
    'TSInterfaceDeclaration',
    'TSTypeAliasDeclaration',
    'TSEnumDeclaration',
    'TSDeclareFunction',
    'ExportNamedDeclaration',
    'ExportDefaultDeclaration',
    'ExportAllDeclaration',
    'MethodDefinition',
    'PropertyDefinition',
    'ImportDeclaration',
]);

const isSuiteCall = (node) => {
    if (node.type !== 'ExpressionStatement') return false;
    let call = node.expression;
    if (call.type === 'AwaitExpression') call = call.argument;
    if (call.type !== 'CallExpression') return false;
    let callee = call.callee;
    // unwrap both the member form (it.only) and the tagged form (it.each([...])(...)), which is a call on a call
    while (callee.type === 'MemberExpression' || callee.type === 'CallExpression') {
        callee = callee.type === 'MemberExpression' ? callee.object : callee.callee;
    }
    return callee.type === 'Identifier' && SUITE_CALLS.has(callee.name);
};

const rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'a multi-line block comment belongs above a declaration, not between statements in a function body',
        },
        messages: {
            midFunction:
                'multi-line block comment between statements - leave one line here and lift the rest into the header block above the function',
        },
        schema: [],
    },
    create(context) {
        const source_code = context.sourceCode ?? context.getSourceCode();
        const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
        const ancestorsOf = (token) => {
            const chain = [];
            let node = source_code.getNodeByRangeIndex(token.range[0]);
            while (node) {
                chain.push(node);
                node = node.parent;
            }
            return chain;
        };
        return {
            Program() {
                for (const comment of source_code.getAllComments()) {
                    if (comment.type !== 'Block' || comment.loc.start.line === comment.loc.end.line) {
                        continue;
                    }
                    const next_token = source_code.getTokenAfter(comment, {includeComments: false});
                    if (!next_token) {
                        continue;
                    }
                    const chain = ancestorsOf(next_token);
                    // a header block above a nested declaration or a test-suite call is the permitted form
                    const is_header = chain.some((n) => n.range[0] === next_token.range[0]
                        && (HEADER_POSITIONS.has(n.type) || isSuiteCall(n)));
                    if (is_header) {
                        continue;
                    }
                    // only a comment sitting inside a function's own body is between statements; module scope is a file header
                    const inside_body = chain.some((n) => FUNCTIONS.has(n.type)
                        && n.body && n.body.type === 'BlockStatement'
                        && n.body.range[0] < comment.range[0] && comment.range[1] < n.body.range[1]);
                    if (!inside_body) {
                        continue;
                    }
                    context.report({node: comment, messageId: 'midFunction'});
                }
            },
        };
    },
};

export default rule;
