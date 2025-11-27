import { Parser, ChatSession, ParseOptions } from '../types.js';
import { ClaudeParser } from './claude.js';
import { CodexParser } from './codex.js';

// Registry of all available parsers
const parsers: Parser[] = [
  new ClaudeParser(),
  new CodexParser(),
  // Add GeminiParser, etc. here
];

export function parseFile(content: string, options?: ParseOptions): ChatSession {
  const firstLine = content.trim().split('\n')[0];

  for (const parser of parsers) {
    if (parser.canParse(firstLine)) {
      return parser.parse(content, options);
    }
  }

  throw new Error('Unknown file format: no parser could handle this file');
}

export { ClaudeParser, CodexParser };
