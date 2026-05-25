import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import type { Root } from 'mdast';

export function parse(text: string): Root {
    return fromMarkdown(text, {
        extensions: [gfm(), frontmatter(['yaml', 'toml'])],
        mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml', 'toml'])],
    });
}
