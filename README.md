# chat-to-html

Convert AI chat session logs into readable HTML reports.

chat-to-html takes JSONL log files from AI coding assistants and generates standalone HTML pages with syntax highlighting, tool call visualization, token usage statistics, and filtering controls.

## Supported Formats

- **Claude Code** - Claude's CLI assistant logs
- **OpenAI Codex** - Codex CLI session logs
- **Google Gemini** - Coming soon

## Features

- **Customizable themes** via CLI color options
- Dark themed, responsive HTML output
- Markdown rendering in messages (headers, lists, code blocks, links)
- Tool call and result visualization with syntax highlighting
- Token usage tracking (input, output, cache)
- Filter toggles to show/hide message types (including harness messages)
- Session metadata display (model, branch, working directory)

## Installation

```bash
# Clone or download the project
cd chat-to-html

# Install dependencies
npm install

# Build
npm run build
```

## Usage

```bash
# Convert a single file
node dist/index.js session.jsonl

# Convert multiple files
node dist/index.js session1.jsonl session2.jsonl

# Specify output directory
node dist/index.js -o ./reports session.jsonl

# Disable harness message detection (enabled by default)
node dist/index.js --no-identify-harness session.jsonl

# Apply a custom theme
node dist/index.js \
  --bg-page "#1a1b26" \
  --bg-card "#24283b" \
  --text-main "#c0caf5" \
  --accent-user "#7aa2f7" \
  session.jsonl
```

### Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help message |
| `-o, --output <dir>` | Output directory (default: same as input file) |
| `--no-identify-harness` | Disable harness message detection (enabled by default) |

### Theme Options

All color options accept hex values (e.g., `"#1a1a2e"`):

| Option | Description |
|--------|-------------|
| `--bg-page` | Page background |
| `--bg-card` | Message cards, header |
| `--bg-accent` | Token summary, filter buttons |
| `--text-main` | Main text |
| `--text-muted` | Timestamps, labels |
| `--border` | Card borders, dividers |
| `--accent-user` | User message border, links |
| `--accent-assistant` | Assistant message border |
| `--accent-tool` | Tool call headers, inline code |
| `--accent-result` | Tool result headers |

### Font Options

| Option | Description |
|--------|-------------|
| `--font-ui` | UI font family (prepended to system fallbacks) |
| `--font-code` | Code font family (prepended to monospace fallbacks) |

Output HTML files are created alongside the input files (or in the specified output directory) with the same name but `.html` extension.

## Example Files

The `examples/` directory contains sample session files you can use to try out the tool:

```bash
# Convert the included example files
node dist/index.js examples/claude.jsonl examples/codex.jsonl
```

- `examples/claude.jsonl` - Claude Code CLI session
- `examples/codex.jsonl` - OpenAI Codex CLI session

## Viewing Reports

The generated HTML files are self-contained and can be opened directly in any browser. No server required.

For quick local preview, you can use Python's built-in server:

```bash
python3 -m http.server 3000
# Then open http://localhost:3000/your-file.html
```

## Example Output

The HTML report includes:

- **Header** - Session ID, model, version, working directory, git branch, message count
- **Token Summary** - Total input/output tokens with cache statistics
- **Filter Bar** - Toggle visibility of users, assistants, tool calls, tool results, and harness messages
- **Messages** - Chronological chat history with timestamps and per-message token counts

## License

ISC
