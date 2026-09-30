import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import type { Root as MdastRoot } from "mdast";

// mirrors client/extension/src/lib/parseops.ts's parse() exactly: folder-mode docs carry no mdast over the wire
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
