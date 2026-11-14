import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import type { Root as MdastRoot } from "mdast";

/**
 * Markdown text to mdast, with GFM and yaml or toml frontmatter. Mirrors parse() in
 * client/extension/src/lib/parseops.ts exactly: the extension host is a separate bundle with no module
 * graph reaching this package, so the two must agree by hand.
 */
export function parse(text: string): MdastRoot {
    return fromMarkdown(text, {
        extensions: [
            gfm(),
            frontmatter(['yaml', 'toml']),
        ],
        mdastExtensions: [
            gfmFromMarkdown(),
            frontmatterFromMarkdown(['yaml', 'toml']),
        ],
    });
}
