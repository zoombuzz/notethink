import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
export function parse(text) {
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
//# sourceMappingURL=parseops.js.map