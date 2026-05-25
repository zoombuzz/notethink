import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import type { Root as MdastRoot } from "mdast";

export function parse(text: string): MdastRoot {
    const mdast = fromMarkdown(text, {
        extensions: [
            gfm(),
            frontmatter(['yaml', 'toml']),
        ],
        mdastExtensions: [
            gfmFromMarkdown(),
            frontmatterFromMarkdown(['yaml', 'toml']),
        ],
    });
    return mdast;
}
