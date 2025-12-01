// Common types for chat session data - designed to be format-agnostic
// to support Claude, Codex, Gemini, etc.

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
}

export interface MessageContent {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: MessageContent[];
  timestamp: string;
  model?: string;
  usage?: TokenUsage;
  isHarness?: boolean;
}

export interface ChatSession {
  sessionId: string;
  agentId?: string;
  model?: string;
  version?: string;
  cwd?: string;
  gitBranch?: string;
  messages: ChatMessage[];
  totalUsage: TokenUsage;
  source: 'claude' | 'codex' | 'gemini' | 'unknown';
}

export interface ParseOptions {
  identifyHarness?: boolean;
}

export interface ThemeConfig {
  // Background colors
  bgPage?: string;       // Page background
  bgCard?: string;       // Message cards, header
  bgAccent?: string;     // Token summary, filter buttons

  // Text colors
  textMain?: string;     // Main text
  textMuted?: string;    // Timestamps, labels

  // Border
  border?: string;       // Card borders, dividers

  // Accent colors
  accentUser?: string;       // User message border, links
  accentAssistant?: string;  // Assistant message border
  accentTool?: string;       // Tool call headers, inline code
  accentResult?: string;     // Tool result headers
  accentHarness?: string;    // Harness messages and filter pills
  accentThinking?: string;   // Thinking messages and filter pills

  // Fonts
  fontUi?: string;       // UI font family
  fontCode?: string;     // Code/monospace font family
}

export interface Parser {
  canParse(firstLine: string): boolean;
  parse(content: string, options?: ParseOptions): ChatSession;
}

/**
 * Calculate total tokens based on source type.
 * - Claude: input_tokens is non-cached, cache tokens are separate and should be added
 * - Codex: input_tokens already includes cached tokens, cache_read is informational only
 */
export function getTotalTokens(
  usage: TokenUsage,
  source: 'claude' | 'codex' | 'gemini' | 'unknown'
): number {
  let total = usage.inputTokens + usage.outputTokens;
  if (source === 'claude' || source === 'gemini' || source === 'unknown') {
    // For Claude-style APIs, cache tokens are separate from input_tokens
    total += (usage.cacheCreationTokens || 0) + (usage.cacheReadTokens || 0);
  }
  // For Codex, input_tokens already includes cached, so no addition needed
  return total;
}
