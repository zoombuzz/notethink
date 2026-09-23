// rollup.config.js
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import dts from "rollup-plugin-dts";
import terser from "@rollup/plugin-terser";
import peerDepsExternal from "rollup-plugin-peer-deps-external";
import postcss from "rollup-plugin-postcss";
import * as sass from "sass";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * rollup-plugin-postcss compiles SCSS through sass.render, the legacy API Dart Sass has deprecated for
 * removal. The plugin replaces a loader registered under the same name, so this one takes over `sass` and
 * compiles through the current API instead.
 */
const modernSassLoader = {
    name: "sass",
    test: /\.(sass|scss)$/,
    process({ code }) {
        const result = sass.compileString(code, {
            url: pathToFileURL(this.id),
            syntax: this.id.endsWith(".sass") ? "indented" : "scss",
        });
        for (const loaded of result.loadedUrls) {
            if (loaded.protocol === "file:") { this.dependencies.add(fileURLToPath(loaded)); }
        }
        return { code: result.css };
    },
};

// a cycle wholly inside a dependency (d3-selection's modules import each other) is that package's design; a cycle touching our source still warns
function onwarn(warning, warn) {
    if (warning.code === "CIRCULAR_DEPENDENCY" && warning.ids?.every((id) => id.includes("/node_modules/"))) { return; }
    warn(warning);
}

export default [
    {
        input: "src/index.ts",
        output: [
            {
                file: "dist/esm/index.js",
                format: "esm",
                esModule: true,
                sourcemap: true,
                inlineDynamicImports: true,
            },
        ],
        plugins: [
            peerDepsExternal(),
            resolve({
                extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs'],
                // a browser bundle has no node built-ins, so take each package's browser build, as the webpack build's mainFields already do
                browser: true,
                preferBuiltins: false,
            }),
            commonjs(),
            typescript({ tsconfig: "./tsconfig.json" }),
            terser(),
            postcss({ loaders: [modernSassLoader] }),
        ],
        external: ["react", "react-dom"],
        onwarn,
    },
    {
        input: "src/index.ts",
        output: [{ file: "dist/types.d.ts", format: "es" }],
        plugins: [dts()],
        external: [/\.css$/],
    },
];