# NoteThink logo — design brief

> Status: **final shipped** (2026-05-15). `notethink-icon.svg` is the approved mark —
> sticky-note tile, white "N" constellation, lit folded corner. `media/icon.png` was
> re-rendered from it; exploration drafts are archived in `variants/`.

## Workflow / conventions

- **Source of truth is SVG.** All logo source lives here in `docstech/design/logos/` as
  `.svg` files, tracked in git.
- **Renders are disposable.** Rasterise to `docstech/design/logos/render/` as PNGs at
  multiple resolutions (32, 48, 64, 128, 256, 512). That folder is **gitignored** — never
  commit renders; regenerate from SVG.
- **The one shipped artifact is `media/icon.png`** (256×256, tracked). It is what
  `vsce package` bundles and what the marketplace shows. When the final logo is approved,
  re-render it into `media/icon.png` from the chosen SVG.
- Render command (per resolution `N`):
  `inkscape <name>.svg -w N -h N -o render/<name>-N.png`
  (fallback: `convert -background none -resize NxN <name>.svg render/<name>-N.png`)

## What NoteThink is

A VS Code extension that renders markdown notes as interactive visualisations —
document, kanban, mermaid, aggregated folder views. Tagline in `package.nls.json`:
**"Notes in markdown, visualised as anything."**

## Design constraints

- **Square, works as a rounded tile.** Marketplace shows it ~128px on the listing and as
  small as ~28–32px in the Extensions sidebar and editor tab. Must stay legible and
  distinct at 32px — no fine detail, no thin text, no more than ~2 focal elements.
- **Readable on light and dark VS Code themes.** A filled tile with its own background
  (current placeholder approach) is safest.
- **No wordmark inside the icon.** The marketplace renders the name next to it.
- Prefer a simple geometric mark or monogram. Avoid gradients with low contrast.

## Placeholder rationale (what to keep / challenge)

The placeholder is an "N" monogram whose diagonal is an edge linking two accent nodes —
"notes" (the letterform) + "think" (a connected idea graph). Palette: indigo→violet
tile (`#5B5BF0`→`#8B3DEF`), white letterforms, mint accent (`#34E0C8`).

Designer is free to keep the notes-as-graph concept or propose alternatives (e.g. a
stylised note/page, a thought bubble, a node cluster). Deliver:

1. `notethink-icon.svg` (primary, square, ~256 viewBox) — replaces the placeholder.
2. Optional `notethink-wordmark.svg` (horizontal lockup) for README / docs.
3. Renders in `render/` at 32/48/64/128/256/512 for review.
4. Confirm the 32px render is still identifiable before sign-off.

## Done — 2026-05-15

- [x] Final SVG approved and committed here (`notethink-icon.svg`).
- [x] `media/icon.png` re-rendered (256×256) from the approved SVG.
- [x] `package.json` `"icon"` still points at `media/icon.png` (verified).
- [x] Exploration drafts archived in `variants/`; review renders regenerated in `render/`.
- [x] Optional horizontal lockup delivered (`notethink-wordmark.svg`, for README/docs).
