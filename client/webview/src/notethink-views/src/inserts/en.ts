import type { Insert } from './types';
import * as heading from './en/001-heading';
import * as paragraph from './en/002-paragraph';
import * as listitem from './en/003-listitem';
import * as linetag from './en/004-linetag';
import * as link from './en/005-link';
import * as image from './en/006-image';
import * as codeblock from './en/007-codeblock';
import * as table from './en/008-table';
import * as mermaid_diagram from './en/101-mermaid-diagram';
import * as mermaid_chart from './en/102-mermaid-chart';
import * as project_management from './en/103-project-management';
import * as architecture from './en/104-architecture';

const raw: Record<string, Omit<Insert, 'title_lowercase' | 'value' | 'index'>> = {
    // elements
    ...paragraph,
    ...linetag,
    ...link,
    ...image,
    ...codeblock,
    ...table,
    // headings
    ...heading,
    // lists
    ...listitem,
    // charts and diagrams
    ...mermaid_chart,
    ...mermaid_diagram,
    // project management
    ...project_management,
    // architecture
    ...architecture,
};

const inserts: Record<string, Insert> = {};
let index = 0;
for (const [key, insert] of Object.entries(raw)) {
    inserts[key] = {
        ...insert,
        value: key,
        title_lowercase: insert.title.toLowerCase(),
        index: index++,
    };
}

export default inserts;
