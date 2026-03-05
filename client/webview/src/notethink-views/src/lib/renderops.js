import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { sanitize } from "hast-util-sanitize";
import { toHast } from "mdast-util-to-hast";
import { toMarkdown } from "mdast-util-to-markdown";
import { toString } from "mdast-util-to-string";
import { renderToStaticMarkup } from "react-dom/server";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
export function getStandardNoteDataProps(note) {
    return {
        "data-seq": note.seq,
        "data-mdast-type": note.type,
        "data-start": note.position.start?.offset,
        "data-end": note.position.end?.offset,
        "data-end-body": note.position.end_body?.offset,
        "data-updated": note.updated,
        "data-updated-by-view": note.updated_by_view,
    };
}
export function renderMarkdownNoteHeadline(note, options_arg = {}) {
    const options = Object.assign({}, {
        render: 'all_children',
        output_type: 'html',
    }, options_arg);
    let headline;
    if (note.type === 'root') {
        headline = _jsx("span", { children: "Root" });
    }
    else {
        const checked_set = (note.checked === true || note.checked === false);
        let render_target = note;
        if (note.type === 'paragraph' && checked_set) {
            render_target = {
                type: 'root',
                children: note.children,
                position: note.position,
            };
        }
        if ((options.render === 'first_child_only') && (render_target.children?.length > 1)) {
            render_target = {
                ...render_target,
                children: [render_target.children[0]],
            };
        }
        if (options.render === 'strip_linetags' && options.linetags_from !== undefined) {
            render_target = {
                ...render_target,
                children: render_target.children.filter((child) => child.position && child.position.end.offset <= options.linetags_from),
            };
        }
        // strip paragraph (note) and instead render nested elements only (like text, link etc.) in virtual 'root'
        const headline_text = renderNodeUnified(render_target, {
            output_type: options.output_type
        });
        headline = headline_text;
        // wrap outputs in certain cases
        if (note.type === 'paragraph' && checked_set) {
            // render checkbox for list items with a checkbox
            headline = _jsxs(_Fragment, { children: [_jsx("input", { type: "checkbox", role: "checkbox", checked: note.checked, readOnly: true }), headline_text] });
        }
    }
    const debugging_only = renderToStaticMarkup(headline);
    return headline;
}
export function renderNodeUnified(node, options_arg = {}) {
    const options = Object.assign({}, {
        render: 'all_children',
        output_type: 'html',
    }, options_arg);
    if (!(node.children?.length > 0)) {
        return _jsx(_Fragment, {});
    }
    if (options.output_type === 'markdown') {
        return _jsx(_Fragment, { children: toMarkdown(node) });
    }
    else if (options.output_type === 'string') {
        return _jsx(_Fragment, { children: toString(node) });
    }
    else {
        const hast = sanitize(toHast(node));
        // @ts-ignore safe to ignore type error on jsx and jsxs (https://github.com/syntax-tree/hast-util-to-jsx-runtime)
        return toJsxRuntime(hast, { Fragment, jsx, jsxs });
    }
}
export function isInternalAttribute(key) {
    return (key.length >= 3 && key.substring(0, 3) === 'ng_');
}
export function isChildNote(child) {
    return ('seq' in child && child.seq !== undefined);
}
