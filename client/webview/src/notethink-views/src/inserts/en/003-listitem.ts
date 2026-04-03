export const listitem = {
    title: 'List item',
    group: 'Lists',
    content: `+ `,
    example_content: `
+ This is an example list item.
+ New items are added with a plus sign.
  + Sub-items are indented with two spaces.
+ Lists can be nested.
  + One
    + Two
      + Three
`,
};

export const todoitem = {
    title: 'To-do item',
    group: 'Lists',
    content: `+ [ ] `,
    example_content: `
+ [ ] This is an example to-do item.
+ [ ] Items can be unchecked.
+ [X] Items can be marked as completed by using an 'X' character.
+ [ ] To-do items can also be nested.
  + [ ] One
    + [ ] Two
      + [X] Three
`,
};
