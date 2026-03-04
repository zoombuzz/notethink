/* allow typescript to import scss files */
declare module '*.scss' {
  const content: {[className: string]: string};
  export = content;
}

/* injected by webpack DefinePlugin */
declare const NOTETHINK_VERSION: string;
