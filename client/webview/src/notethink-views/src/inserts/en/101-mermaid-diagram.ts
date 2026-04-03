export const mermaid_sequence = {
    title: 'Sequence diagram (Mermaid)',
    group: 'Charts and diagrams',
    content: `

\`\`\`mermaid
sequenceDiagram
    A->>B: Request
    B->>A: Response
\`\`\`
`,
    insert_point: 'endOfLine',
    example_content: `

\`\`\`mermaid
sequenceDiagram
    participant A as Abbott
    participant C as Costello
    C->>A: You know the guys' names?
    A->>C: I'm telling you their names!
    C->>A: Well who's on first?
    A->>C: Yeah
    C->>A: Go ahead and tell me
    A->>C: Who
    C->>A: The guy on first
    A->>C: Who
    C->>A: The guy playin' first base
    A->>C: Who
    C->>A: The guy on first
    A->>C: Who is on first!
    C->>A: What are you askin' me for? I'm askin' you!
    A->>C: I'm not asking you, I'm telling you
\`\`\`
`,
    example_insert_point: 'endOfLine',
};

export const mermaid_state = {
    title: 'State diagram (Mermaid)',
    group: 'Charts and diagrams',
    content: `

\`\`\`mermaid
stateDiagram-v2
    state "State" as s1
    [*] --> s1
    s1 --> [*]
\`\`\`
`,
    insert_point: 'endOfLine',
    example_content: `

\`\`\`mermaid
stateDiagram-v2
    state "Untested" as c0
    [*] --> c0
    c0 --> c1
    c0 --> c2

    state "Condition" as c1 {
        state if_int_state <<choice>>
        [*] --> IsInt
        IsInt --> if_int_state
        if_int_state --> Decimal : if (n % 1) != 0
        if_int_state --> Integer : if (n % 1) == 0
    }
    state "Condition" as c2 {
        state if_pos_state <<choice>>
        [*] --> IsPos
        IsPos --> if_pos_state
        if_pos_state --> Negative : if n < 0
        if_pos_state --> Positive : if n >= 0
    }
\`\`\`
`,
    example_insert_point: 'endOfLine',
};
