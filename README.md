# NoteThink

A VS Code extension that renders markdown files as interactive visualizations.

> **Status:** Preview / Beta — this is an early release. Expect rough edges.

## Features

- **Custom Editor**: Open markdown files in a visual editor alongside the standard text editor
- **Interactive Views**: Notes rendered as structured, interactive components
- **Component Library**: Reusable React components for building note visualizations
- **Live Updates**: File changes detected and re-rendered with debounce
- **GFM Support**: Tables, strikethrough, task lists, footnotes
- **Frontmatter**: YAML frontmatter parsed and handled
- **Debug Support**: Built-in debug logging for development

## Installation

### From Marketplace

Not yet published. See [Development Install](#development-install) below.

### Development Install

```bash
# clone the repository
git clone https://github.com/ZoomBuzz/NoteThink.git
cd NoteThink

# install dependencies
pnpm install

# compile the extension
pnpm run compile

# open in VS Code
code .
```

Then press `F5` to launch the Extension Development Host.

## Usage

1. Open any markdown file (`.md`)
2. Use the command palette (`Ctrl+Shift+P`) and run "NoteThink: Open View"
3. Or right-click on a markdown file and select "Open With..." → "NoteThink"

### Browser Debugging

Enable debug messages in the browser console:

```javascript
localStorage.debug = 'notethink:*'
```

## Project Structure

```
notethink/
├── client/
│   ├── extension/           # VS Code extension
│   │   ├── src/
│   │   │   ├── extension.ts # entry point
│   │   │   ├── vscode/      # VS Code integration
│   │   │   └── lib/         # utilities
│   │   └── dist/            # compiled output
│   │
│   └── webview/             # React webview
│       ├── src/
│       │   ├── components/  # webview components
│       │   └── notethink-views/  # component library
│       └── dist/            # bundled webview
│
├── .github/
│   └── workflows/ci.yml     # CI pipeline
│
├── AGENTS.md                # AI agent guidelines
├── CODING_STANDARDS.md      # coding conventions
└── eslint.config.mjs        # linting rules
```

## Development

### Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies (root + client packages) |
| `pnpm run compile` | Build the extension |
| `pnpm run watch` | Watch mode for development |
| `pnpm run package` | Production build |
| `pnpm run lint` | Run ESLint |
| `pnpm test` | Run all tests |
| `pnpm run chrome` | Test in browser (Chromium) |

### Component Library

The `notethink-views` package contains reusable React components:

```bash
cd client/webview/src/notethink-views

# run storybook
pnpm run storybook

# run tests
pnpm test

# build library
pnpm run rollup
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        VS Code                              │
│  ┌───────────────────┐    ┌─────────────────────────────┐   │
│  │    Extension      │    │        Webview              │   │
│  │                   │    │                             │   │
│  │  ┌─────────────┐  │    │  ┌───────────────────────┐  │   │
│  │  │ notethink   │◄─┼────┼──│  ExtensionReceiver    │  │   │
│  │  │ Editor.ts   │  │    │  │                       │  │   │
│  │  └─────────────┘  │    │  └───────────┬───────────┘  │   │
│  │         │         │    │              │              │   │
│  │         ▼         │    │              ▼              │   │
│  │  ┌─────────────┐  │    │  ┌───────────────────────┐  │   │
│  │  │  parseops   │  │    │  │    NoteRenderer       │  │   │
│  │  │  crypto     │  │    │  │                       │  │   │
│  │  └─────────────┘  │    │  └───────────┬───────────┘  │   │
│  │                   │    │              │              │   │
│  └───────────────────┘    │              ▼              │   │
│                           │  ┌───────────────────────┐  │   │
│                           │  │   notethink-views     │  │   │
│                           │  │   (component lib)     │  │   │
│                           │  └───────────────────────┘  │   │
│                           └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Message Flow:**
1. Extension reads markdown file and parses it
2. Parsed data sent to webview via `postMessage`
3. `ExtensionReceiver` handles messages and updates state
4. `NoteRenderer` displays notes using `notethink-views` components

## Known Limitations

- **Read-only**: No editing support yet — NoteThink is a viewer, not an editor
- **Single file view**: No multi-document navigation
- **No icon**: Extension icon is a placeholder until a proper design is provided

## Contributing

See [CODING_STANDARDS.md](./CODING_STANDARDS.md) for code style guidelines and [AGENTS.md](./AGENTS.md) for project conventions.

## License

Apache-2.0
