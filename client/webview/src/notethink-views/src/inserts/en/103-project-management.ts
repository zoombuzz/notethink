export const pm_gantt = {
    title: 'Gantt chart (Mermaid)',
    group: 'Project management',
    content: `

\`\`\`mermaid
gantt
    dateFormat YYYY-MM-DD
    excludes weekends
    section Section name
        Task name   :  done, 1970-12-08, 3d
\`\`\`
`,
    insert_point: 'endOfLine',
    example_content: `

\`\`\`mermaid
gantt
    dateFormat YYYY-MM-DD
    excludes weekends
    section Development
        Make 'Insert' more usable :done, 2024-08-31, 7d
        Bind tab key option to CodeEditor :3d
        Update packages :2d
        Set caret position on non-data load :0.5d
        Improve localStorage structure: 5d
    section Testing
        Extend test suite to cover Insert :done, 2024-09-01, 1d
        Fix Jest/RTL errors: 15d
    section Documentation
        Remove redundant NG tag on future tickets :done, 2024-09-04, 1d
        Make JSDoc comments consistent :done, 3d
    section Marketing
        Prep blog post :2024-09-25, 2d
        Launch :milestone,
\`\`\`
`,
    example_insert_point: 'endOfLine',
};

export const pm_kanban = {
    title: 'Kanban board',
    group: 'Project management',
    content: `

# Project name [](?ng_view=kanban)
Project description

## Ticket 1 [](?status=done)
Ticket description

## Ticket 2 [](?status=doing)
Ticket description

## Ticket 3 [](?status=backlog)
Ticket description
`,
    insert_point: 'endOfLine',
    example_content: `

# Example project [](?ng_view=kanban)

This a very generalised example of what a project might look like.  It illustrates a small team of collaborators working on a handful of epics.  Please feel free to edit it.


## Create marketing presentation

The Marketing department need a few slides to help them gather feedback from customers on what we're planning.

This story needs more elaboration.


## Apply security patches [](?status=backlog&type=task)

+ Rebuild container images
+ Redeploy to \`staging\` and retest
+ Redeploy to \`prod\` and retest


## As a user, I want to update my profile ('[doing](?status=doing)' [story](?type=story) for [Alex](?assignee=Alex), [35% complete](?progress=35&progress_unit=%25&progress_max=100))

The goal here is to make the static profiles user-updateable.

### Tasks
+ Create user profile page
+ Display existing profile fields
+ Show edit button for authenticated users viewing their own profile
+ Render current profile settings as form

### Acceptance criteria
+ All form fields must be validated server-side at submission time


## As a user, I want to view Markdown rendered ('[backlog](?status=backlog)' [story](?type=story))

The Editor view provides a raw view of the Markdown text.
Other views should show that Markdown properly rendered.


### Tasks

+ Elaborate this ticket
+ Estimate its T-shirt size


## Create 'Our team' page [](?type=task)

### Tasks
+ Add 'name' and 'role' for current team members
    + Alex
    + Kali
    + Ji
    + Vijay
    + Ekon

### Acceptance criteria
+ Page is W3C WCAG 3 compliant


## As a user, I want to collaborate with logged in users [](?status=backlog)

The underlying repo has a security model
that describes who can do what.

### Acceptance criteria
+ Use GitHub repo attributes to authorise GitHub-authenticated users to collaborate.


## As a user, I want to collaborate with anonymous users [](?status=backlog)

Sometimes I want to quickly share the screen that I'm working on with other people, perhaps in a stand-up.

### Tasks
+ Create a collaborate URL variant, that grants read and suggest access.
+ Create a QRCode that link to the collaborate URL.


## As a user, I want to collaborate with myself on other devices [](?status=done)

I should see my own changes, if I'm logged in:
+ to the same GitHub account
+ on the same URL
+ on different devices
`,
    example_insert_point: 'endOfLine',
};
