# chat-to-html - Agent Development Guide

## Project Overview

chat-to-html is a TypeScript CLI tool that converts AI chat session logs (JSONL format) into styled HTML reports. It's designed to support multiple AI providers (Claude, Codex, Gemini) through a pluggable parser architecture.

## Project Structure

```
chat-to-html/
├── src/
│   ├── index.ts           # CLI entry point
│   ├── types.ts           # Common types (ChatSession, ChatMessage, etc.)
│   ├── html-generator.ts  # HTML/CSS generation with markdown parsing
│   └── parsers/
│       ├── index.ts       # Parser registry and auto-detection
│       ├── claude.ts      # Claude JSONL parser
│       └── codex.ts       # OpenAI Codex JSONL parser
├── examples/              # Sample JSONL files for testing
│   ├── claude.jsonl       # Claude Code session example
│   └── codex.jsonl        # OpenAI Codex session example
├── dist/                  # Compiled JavaScript output
├── package.json
└── tsconfig.json
```

## Key Conventions

### Adding a New Parser

1. Create a new file in `src/parsers/` (e.g., `codex.ts`)
2. Implement the `Parser` interface from `types.ts`:
   ```typescript
   export interface Parser {
     canParse(firstLine: string): boolean;  // Auto-detect format
     parse(content: string): ChatSession;   // Parse full file
   }
   ```
3. Register the parser in `src/parsers/index.ts` by adding it to the `parsers` array

### CSS Styling

All colors are defined as CSS variables in `html-generator.ts` within the `getStyles()` function:

```css
:root {
  /* Background colors */
  --bg-primary, --bg-secondary, --bg-tertiary, --bg-code, --bg-code-dark
  --bg-overlay-dark, --bg-overlay-light

  /* Text colors */
  --text-primary, --text-secondary

  /* Accent colors */
  --accent-user, --accent-assistant, --accent-tool, --accent-tool-result

  /* Border */
  --border-color

  /* Tool backgrounds */
  --bg-tool-call, --bg-tool-result

  /* Source badges */
  --badge-claude, --badge-codex, --badge-gemini
}
```

Always use CSS variables for colors - never hardcode hex values in style rules.

### Icons

The project uses [Bootstrap Icons](https://icons.getbootstrap.com/) via CDN. Use `<i class="bi bi-*"></i>` syntax. Common icons in use:
- `bi-person` - User
- `bi-robot` - Assistant
- `bi-wrench` - Tool calls
- `bi-box-arrow-right` - Tool results
- `bi-chevron-up` / `bi-chevron-down` - Navigation

### Markdown Parsing

The `parseMarkdown()` function in `html-generator.ts` handles:
- Headers (`#`, `##`, `###`)
- Bold (`**text**`) and italic (`*text*`)
- Code blocks (triple backticks) and inline code (backticks)
- Nested lists with indentation (2 spaces per level)
- Blockquotes (`>`)
- Links (`[text](url)`)
- Paragraphs (double newlines)

The `processLists()` function handles nested list parsing by tracking indentation levels.

### HTML Structure

Messages follow this structure:
```html
<div class="message user|assistant">
  <div class="message-header">...</div>
  <div class="message-content">
    <div class="message-text">...</div>
    <div class="tool-call">...</div>
    <div class="tool-result-container">...</div>
  </div>
  <div class="message-usage">...</div>
</div>
```

### Filter System

The filter bar uses `data-filter` attributes and JavaScript to toggle visibility:
- `data-filter="user"` - User messages
- `data-filter="assistant"` - Assistant messages
- `data-filter="tool-call"` - Tool invocations
- `data-filter="tool-result"` - Tool outputs

Hidden elements get the `.hidden` class (`display: none`).

## Build & Test

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run CLI
node dist/index.js <file.jsonl> [file2.jsonl...]

# With output directory
node dist/index.js -o ./output file.jsonl

# Test with example files
node dist/index.js examples/claude.jsonl examples/codex.jsonl
```

## Example Files

The `examples/` directory contains sample JSONL files for testing:

- **claude.jsonl** - A Claude Code CLI session demonstrating user/assistant messages, tool calls (Read, Edit, Bash), and tool results
- **codex.jsonl** - An OpenAI Codex CLI session with function calls and outputs

Use these to verify parser changes or test HTML output modifications.

## Common Tasks

### Modifying Styles
Edit `getStyles()` in `html-generator.ts`. Use CSS variables for any new colors.

### Adding Filter Options
1. Add toggle HTML in `generateHtml()`
2. Add filter logic in the `<script>` section
3. Add corresponding CSS for the active state

### Extending Token Display
Modify `renderTokenUsage()` and the `TokenUsage` interface in `types.ts`.

### Adding New Message Content Types
1. Add type to `MessageContent` in `types.ts`
2. Handle in `renderContent()` switch statement
3. Add corresponding CSS styles
