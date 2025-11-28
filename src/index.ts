#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { basename, dirname, join } from 'path';
import { parseFile } from './parsers/index.js';
import { generateHtml } from './html-generator.js';
import { ParseOptions, ThemeConfig, getTotalTokens } from './types.js';

function showUsage(): void {
  console.log(`
chat-to-html - Convert AI chat session logs to HTML reports

Usage:
  chat-to-html <file1.jsonl> [file2.jsonl] ...

Options:
  -h, --help             Show this help message
  -o, --output           Output directory (default: same as input file)
  --no-identify-harness  Disable harness message detection (enabled by default)

Theme options (hex colors, e.g. "#1a1a2e"):
  --bg-page            Page background
  --bg-card            Message cards, header
  --bg-accent          Token summary, filter buttons
  --text-main          Main text color
  --text-muted         Timestamps, labels
  --border             Card borders, dividers
  --accent-user        User message border, links
  --accent-assistant   Assistant message border
  --accent-tool        Tool call headers, inline code
  --accent-result      Tool result headers

Font options:
  --font-ui            UI font family (e.g. "Inter")
  --font-code          Code font family (e.g. "Fira Code")

Examples:
  chat-to-html session.jsonl
  chat-to-html session1.jsonl session2.jsonl
  chat-to-html -o ./output session.jsonl
  chat-to-html --no-identify-harness codex-session.jsonl
  chat-to-html --bg-page "#0B1220" --accent-user "#38BDF8" session.jsonl

Supported formats:
  - Claude Code JSONL files
  - OpenAI Codex JSONL files
  - (Coming soon) Google Gemini
`);
}

function processFile(inputPath: string, outputDir?: string, options?: ParseOptions, theme?: ThemeConfig): boolean {
  console.log(`Processing: ${inputPath}`);

  if (!existsSync(inputPath)) {
    console.error(`  Error: File not found: ${inputPath}\n`);
    return false;
  }

  try {
    const content = readFileSync(inputPath, 'utf-8');
    const session = parseFile(content, options);

    console.log(`  Source: ${session.source}`);
    console.log(`  Session ID: ${session.sessionId}`);
    console.log(`  Messages: ${session.messages.length}`);
    console.log(`  Total tokens: ${getTotalTokens(session.totalUsage, session.source)}`);

    const html = generateHtml(session, theme);

    // Generate output filename
    const inputBasename = basename(inputPath, '.jsonl');
    const outputPath = join(
      outputDir || dirname(inputPath),
      `${inputBasename}.html`
    );

    writeFileSync(outputPath, html);
    console.log(`  Output: ${outputPath}\n`);
    return true;
  } catch (err) {
    console.error(`  Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return false;
  }
}

// Map of CLI flag to ThemeConfig key
const themeFlags: Record<string, keyof ThemeConfig> = {
  '--bg-page': 'bgPage',
  '--bg-card': 'bgCard',
  '--bg-accent': 'bgAccent',
  '--text-main': 'textMain',
  '--text-muted': 'textMuted',
  '--border': 'border',
  '--accent-user': 'accentUser',
  '--accent-assistant': 'accentAssistant',
  '--accent-tool': 'accentTool',
  '--accent-result': 'accentResult',
  '--font-ui': 'fontUi',
  '--font-code': 'fontCode',
};

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    showUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  // Parse arguments
  let outputDir: string | undefined;
  let identifyHarness = true;
  const files: string[] = [];
  const theme: ThemeConfig = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-o' || arg === '--output') {
      outputDir = args[++i];
      if (!outputDir) {
        console.error('Error: -o/--output requires a directory path');
        process.exit(1);
      }
    } else if (arg === '--no-identify-harness') {
      identifyHarness = false;
    } else if (themeFlags[arg]) {
      const value = args[++i];
      if (!value) {
        console.error(`Error: ${arg} requires a color value`);
        process.exit(1);
      }
      theme[themeFlags[arg]] = value;
    } else if (!arg.startsWith('-')) {
      files.push(arg);
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  if (files.length === 0) {
    console.error('Error: No input files specified');
    showUsage();
    process.exit(1);
  }

  const options: ParseOptions = { identifyHarness };
  const hasTheme = Object.keys(theme).length > 0;

  console.log('chat-to-html - Converting to HTML reports\n');

  let hasErrors = false;
  for (const file of files) {
    const success = processFile(file, outputDir, options, hasTheme ? theme : undefined);
    if (!success) {
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  console.log('Done!');
}

main();
