import { MdastNode, MdastNodes, NoteProps } from "../types/NoteProps";
import {sanitize} from "hast-util-sanitize";
import {toHast} from "mdast-util-to-hast";
import {toMarkdown} from "mdast-util-to-markdown";
import {toString} from "mdast-util-to-string";
import {ReactElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {toJsxRuntime} from "hast-util-to-jsx-runtime";
import {Fragment, jsx, jsxs} from "react/jsx-runtime";

export function getStandardNoteDataProps(note: NoteProps) {
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

interface RenderOptions {
    render?: 'all_children' | 'first_child_only';
    output_type?: 'html' | 'markdown' | 'string';
}

export function renderMarkdownNoteHeadline(note: NoteProps, options_arg: RenderOptions = {}) {
    const options = Object.assign({}, {
        render: 'all_children',
        output_type: 'html',
    }, options_arg);
    let headline;
    if (note.type === 'root') {
        headline = <span>Root</span>;
    } else {
        const checked_set = (note.checked === true || note.checked === false);
        let render_target: MdastNode = note;
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
        // strip paragraph (note) and instead render nested elements only (like text, link etc.) in virtual 'root'
        const headline_text = renderNodeUnified(render_target,{
            output_type: options.output_type
        });
        headline = headline_text;
        // wrap outputs in certain cases
        if (note.type === 'paragraph' && checked_set) {
            // render checkbox for list items with a checkbox
            headline = <>
                <input type="checkbox" role="checkbox" checked={note.checked} readOnly/>{headline_text}
            </>;
        }
    }
    const debugging_only = renderToStaticMarkup(headline);
    return headline;
}

export function renderNodeUnified(node: MdastNode, options_arg: RenderOptions = {}): ReactElement {
    const options = Object.assign({}, {
        render: 'all_children',
        output_type: 'html',
    }, options_arg);
    if (!(node.children?.length > 0)) {return <></>;}
    if (options.output_type === 'markdown') {
        return <>{toMarkdown(node as MdastNodes)}</>;
    } else if (options.output_type === 'string') {
        return <>{toString(node as MdastNodes)}</>;
    } else {
        const hast = sanitize(toHast(node as MdastNodes));
        // @ts-ignore safe to ignore type error on jsx and jsxs (https://github.com/syntax-tree/hast-util-to-jsx-runtime)
        return toJsxRuntime(hast, {Fragment, jsx, jsxs});
    }
}

export function isInternalAttribute(key: string) {
    return (key.length >= 3 && key.substring(0, 3) === 'ng_');
}

export function isChildNote(child: NoteProps | MdastNode) {
    return ('seq' in child && child.seq !== undefined);
}
