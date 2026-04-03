export const mermaid_flowchart = {
    title: 'Flowchart (Mermaid)',
    group: 'Charts and diagrams',
    content: `

\`\`\`mermaid
flowchart TD
    A[Start] --> E[End]
\`\`\`
`,
    insert_point: 'endOfLine',
    example_content: `

\`\`\`mermaid
flowchart TD
    A[Start] --> B{Question?}
    B -- Yes --> C[Action #1]
    C --> D[Action #2]
    D --> B
    B -- No ----> E[End]
\`\`\`
`,
    example_insert_point: 'endOfLine',
};

export const mermaid_xychart = {
    title: 'XY chart (Mermaid)',
    group: 'Charts and diagrams',
    content: `

\`\`\`mermaid
xychart-beta
    title "Graph title"
    x-axis [A, B, C]
    y-axis "Y-axis legend" 0 --> 40
    bar [10, 20, 30]
    line [10, 20, 30]
\`\`\`
`,
    insert_point: 'endOfLine',
    example_content: `

\`\`\`mermaid
xychart-beta
    title "Server Costs by Month"
    x-axis [January, Feb, March, April, May, June, July, August, Sept, October, Nov, December]
    y-axis "Cost (£)" 400 --> 1100
    bar [1050, 1000, 1020, 920, 850, 700, 600, 500, 600, 750, 820, 950]
    line [1050, 1000, 1020, 920, 850, 700, 600, 500, 600, 750, 820, 950]
\`\`\`
`,
    example_insert_point: 'endOfLine',
};

export const mermaid_piechart = {
    title: 'Pie chart (Mermaid)',
    group: 'Charts and diagrams',
    content: `

\`\`\`mermaid
pie title Pie Chart Title
    "Option A" : 72
    "Option B" : 23
    "Option C" : 5
\`\`\`
`,
    insert_point: 'endOfLine',
    example_content: `

\`\`\`mermaid
pie title Time spent developing this app
    "Inspiration" : 8
    "Research" : 44
    "Debugging" : 122
\`\`\`
`,
    example_insert_point: 'endOfLine',
};
