import { MdastNode, MdastNodes, NoteProps } from "../types/NoteProps";
import {sanitize} from "hast-util-sanitize";
import {toHast} from "mdast-util-to-hast";
import {toMarkdown} from "mdast-util-to-markdown";
import {toString} from "mdast-util-to-string";
import {ReactElement} from "react";
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
    render?: 'all_children' | 'first_child_only' | 'strip_linetags';
    output_type?: 'html' | 'markdown' | 'string';
    linetags_from?: number;
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
        if (options.render === 'strip_linetags' && options.linetags_from !== undefined) {
            render_target = {
                ...render_target,
                children: render_target.children.filter((child: MdastNode) =>
                    child.position && child.position.end.offset <= options.linetags_from!
                ),
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
                <input type="checkbox" role="checkbox" checked={note.checked ?? false} onChange={() => {}}/>{headline_text}
            </>;
        }
    }
    return headline;
}

// Cache rendered JSX by node reference - nodes from unchanged MDAST trees keep the same identity
const renderCache = new WeakMap<MdastNode, ReactElement>();

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
        const cached = renderCache.get(node);
        if (cached) { return cached; }
        try {
            const hast = sanitize(toHast(node as MdastNodes));
            // @ts-ignore safe to ignore type error on jsx and jsxs (https://github.com/syntax-tree/hast-util-to-jsx-runtime)
            const result = toJsxRuntime(hast, {Fragment, jsx, jsxs});
            renderCache.set(node, result);
            return result;
        } catch (err) {
            console.error('renderNodeUnified failed:', err);
            return <></>;
        }
    }
}

export function isInternalAttribute(key: string) {
    return (key.length >= 3 && key.substring(0, 3) === 'ng_');
}

export function isChildNote(child: NoteProps | MdastNode) {
    return ('seq' in child && child.seq !== undefined);
}

// lazy import to break circular dependency: renderops → GenericNote → MarkdownNote → renderops;
// declare require for webpack's runtime (avoids @types/node in this browser-targeted package)
declare const require: (id: string) => { default: React.ComponentType<NoteProps> };
let LazyGenericNote: React.ComponentType<NoteProps> | undefined;
function getGenericNote() {
    if (!LazyGenericNote) {
        LazyGenericNote = require("../components/notes/GenericNote").default;
    }
    return LazyGenericNote!;
}

/**
 * Render a note's children_body array: child notes as GenericNote with IDs,
 * MDAST body nodes as divs with data-offset-start/end for caret tracking.
 */
export function renderBodyItems(note: NoteProps, items: (NoteProps | MdastNode)[], additional_props: Partial<NoteProps> = {}) {
    const GenericNote = getGenericNote();
    return items.map((child: MdastNode | NoteProps, i: number) => {
        if (isChildNote(child)) {
            const child_note = child as NoteProps;
            return <GenericNote
                key={child_note.seq}
                {...child_note}
                {...additional_props}
                display_options={{
                    ...note.display_options,
                    id: `v${note.display_options?.view_id}-n${child_note.seq}`,
                    provided: {
                        draggableProps: undefined,
                        dragHandleProps: undefined,
                    }
                }}
                handlers={note.handlers}
            />;
        } else {
            const mdast = child as MdastNode;
            return <div key={`body-${mdast.position?.start?.offset ?? i}`}
                data-offset-start={mdast.position?.start?.offset}
                data-offset-end={mdast.position?.end?.offset}
            >
                {renderNodeUnified(mdast)}
            </div>;
        }
    });
}
