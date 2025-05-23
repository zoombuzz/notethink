/* allow typescript to import scss files */
declare module '*.scss' {
  const content: {[className: string]: string};
  export = content;
}
