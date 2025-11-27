import { ChatSession, ChatMessage, MessageContent, TokenUsage, Parser } from '../types.js';

// Claude JSONL format types
interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ClaudeToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

interface ClaudeTextContent {
  type: 'text';
  text: string;
}

type ClaudeContent = ClaudeTextContent | ClaudeToolUse | ClaudeToolResult;

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContent[];
  model?: string;
  id?: string;
  usage?: ClaudeUsage;
}

interface ClaudeEntry {
  type: 'user' | 'assistant' | 'file-history-snapshot';
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  sessionId: string;
  agentId?: string;
  version?: string;
  cwd?: string;
  gitBranch?: string;
  message?: ClaudeMessage;
}

export class ClaudeParser implements Parser {
  canParse(firstLine: string): boolean {
    try {
      const entry = JSON.parse(firstLine);
      // Claude entries have type field with known values
      // file-history-snapshot is a Claude-specific entry type
      // Other entries have sessionId
      return (
        typeof entry.type === 'string' &&
        ['user', 'assistant', 'file-history-snapshot'].includes(entry.type)
      );
    } catch {
      return false;
    }
  }

  parse(content: string): ChatSession {
    const lines = content.trim().split('\n').filter(line => line.trim());
    const entries: ClaudeEntry[] = lines.map(line => JSON.parse(line));

    // Filter out non-message entries
    const messageEntries = entries.filter(
      (e): e is ClaudeEntry & { message: ClaudeMessage } =>
        e.type !== 'file-history-snapshot' && e.message !== undefined
    );

    // Extract session metadata from first entry
    const firstEntry = messageEntries[0];
    const sessionId = firstEntry?.sessionId || 'unknown';
    const agentId = firstEntry?.agentId;
    const version = firstEntry?.version;
    const cwd = firstEntry?.cwd;
    const gitBranch = firstEntry?.gitBranch;

    // Track model used (may vary per message)
    let model: string | undefined;

    const totalUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };

    const messages: ChatMessage[] = messageEntries.map(entry => {
      const msg = entry.message;

      // Track model
      if (msg.model && !model) {
        model = msg.model;
      }

      // Accumulate usage
      let usage: TokenUsage | undefined;
      if (msg.usage) {
        usage = {
          inputTokens: msg.usage.input_tokens || 0,
          outputTokens: msg.usage.output_tokens || 0,
          cacheCreationTokens: msg.usage.cache_creation_input_tokens || 0,
          cacheReadTokens: msg.usage.cache_read_input_tokens || 0,
        };
        totalUsage.inputTokens += usage.inputTokens;
        totalUsage.outputTokens += usage.outputTokens;
        totalUsage.cacheCreationTokens! += usage.cacheCreationTokens || 0;
        totalUsage.cacheReadTokens! += usage.cacheReadTokens || 0;
      }

      // Parse content
      const content = this.parseContent(msg.content);

      return {
        id: entry.uuid,
        role: entry.type as 'user' | 'assistant',
        content,
        timestamp: entry.timestamp,
        model: msg.model,
        usage,
      };
    });

    return {
      sessionId,
      agentId,
      model,
      version,
      cwd,
      gitBranch,
      messages,
      totalUsage,
      source: 'claude',
    };
  }

  private parseContent(content: string | ClaudeContent[]): MessageContent[] {
    if (typeof content === 'string') {
      return [{ type: 'text', text: content }];
    }

    return content.map(item => {
      if (item.type === 'text') {
        return { type: 'text' as const, text: item.text };
      } else if (item.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          toolCall: {
            id: item.id,
            name: item.name,
            input: item.input,
          },
        };
      } else if (item.type === 'tool_result') {
        return {
          type: 'tool_result' as const,
          toolResult: {
            toolUseId: item.tool_use_id,
            content: item.content,
          },
        };
      }
      return { type: 'text' as const, text: JSON.stringify(item) };
    });
  }
}
