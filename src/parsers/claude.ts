import { ChatSession, ChatMessage, MessageContent, TokenUsage, Parser, ParseOptions } from '../types.js';

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

interface ClaudeThinkingMetadata {
  level?: string;
  disabled?: boolean;
  triggers?: string[];
}

interface ClaudeTodo {
  content: string;
  status: string;
  activeForm?: string;
}

interface ClaudeToolUseResult {
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  isImage?: boolean;
  oldTodos?: ClaudeTodo[];
  newTodos?: ClaudeTodo[];
}

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
  thinkingMetadata?: ClaudeThinkingMetadata;
  todos?: ClaudeTodo[];
  toolUseResult?: ClaudeToolUseResult | string;
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

  parse(content: string, options?: ParseOptions): ChatSession {
    const lines = content.trim().split('\n').filter(line => line.trim());
    const entries: ClaudeEntry[] = lines.map(line => JSON.parse(line));

    // Filter out non-message entries for session metadata
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

    const messages: ChatMessage[] = [];
    const identifyHarness = options?.identifyHarness !== false;
    let lastTodos: ClaudeTodo[] | undefined;

    for (const entry of entries) {
      if (entry.type === 'file-history-snapshot' || !entry.message) {
        continue;
      }

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

      // Parse primary message content
      const content = this.parseContent(msg.content);
      const baseMessage: ChatMessage = {
        id: entry.uuid,
        role: entry.type as 'user' | 'assistant',
        content,
        timestamp: entry.timestamp,
        model: msg.model,
        usage,
      };
      messages.push(baseMessage);

      // Thinking metadata as a separate harness "thinking" message
      if (entry.thinkingMetadata && this.hasMeaningfulThinking(entry.thinkingMetadata)) {
        const thinkingText = this.formatThinkingMetadata(entry.thinkingMetadata);
        const thinkingMessage: ChatMessage = {
          id: `${entry.uuid}:thinking`,
          role: identifyHarness ? 'system' : 'assistant',
          content: [{
            type: 'thinking',
            text: thinkingText,
          }],
          timestamp: entry.timestamp,
        };
        if (identifyHarness) {
          thinkingMessage.isHarness = true;
        }
        messages.push(thinkingMessage);
      }

      // Todo updates from toolUseResult (preferred when available)
      if (entry.toolUseResult && typeof entry.toolUseResult === 'object') {
        const todoSummary = this.formatTodosSummary(
          Array.isArray(entry.toolUseResult.oldTodos) ? entry.toolUseResult.oldTodos : lastTodos,
          Array.isArray(entry.toolUseResult.newTodos) ? entry.toolUseResult.newTodos : undefined
        );
        if (todoSummary) {
          lastTodos = Array.isArray(entry.toolUseResult.newTodos) ? entry.toolUseResult.newTodos : lastTodos;
          const todoMessage: ChatMessage = {
            id: `${entry.uuid}:todos`,
            role: identifyHarness ? 'system' : 'assistant',
            content: [{
              type: 'text',
              text: todoSummary,
            }],
            timestamp: entry.timestamp,
          };
          if (identifyHarness) {
            todoMessage.isHarness = true;
          }
          messages.push(todoMessage);
        }
      } else if (Array.isArray(entry.todos)) {
        // Fallback: detect changes from top-level todos field
        const todoSummary = this.formatTodosSummary(lastTodos, entry.todos);
        if (todoSummary) {
          lastTodos = entry.todos;
          const todoMessage: ChatMessage = {
            id: `${entry.uuid}:todos`,
            role: identifyHarness ? 'system' : 'assistant',
            content: [{
              type: 'text',
              text: todoSummary,
            }],
            timestamp: entry.timestamp,
          };
          if (identifyHarness) {
            todoMessage.isHarness = true;
          }
          messages.push(todoMessage);
        }
      }
    }

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

  private hasMeaningfulThinking(meta: ClaudeThinkingMetadata): boolean {
    if (!meta) return false;
    const hasLevel = typeof meta.level === 'string' && meta.level !== '' && meta.level !== 'none';
    const hasTriggers = Array.isArray(meta.triggers) && meta.triggers.length > 0;
    const hasEnabledFlag = typeof meta.disabled === 'boolean' && meta.disabled === false;
    return hasLevel || hasTriggers || hasEnabledFlag;
  }

  private formatThinkingMetadata(meta: ClaudeThinkingMetadata): string {
    const parts: string[] = [];
    if (meta.level && meta.level !== 'none') {
      parts.push(`level: ${meta.level}`);
    }
    if (typeof meta.disabled === 'boolean') {
      parts.push(meta.disabled ? 'thinking disabled' : 'thinking enabled');
    }
    if (Array.isArray(meta.triggers) && meta.triggers.length > 0) {
      parts.push(`triggers: ${meta.triggers.join(', ')}`);
    }
    if (parts.length === 0) {
      return 'Thinking metadata available';
    }
    return `Thinking metadata – ${parts.join(' | ')}`;
  }

  private formatTodosSummary(oldTodos?: ClaudeTodo[], newTodos?: ClaudeTodo[]): string | undefined {
    if (!newTodos || newTodos.length === 0) {
      return undefined;
    }

    const formatStatus = (status: string | undefined): string => {
      if (!status) return '';
      return status.replace(/_/g, ' ');
    };

    const lines: string[] = [];
    lines.push('Todo list updated:');

    const oldByContent = new Map<string, ClaudeTodo>();
    if (oldTodos) {
      for (const todo of oldTodos) {
        if (todo && typeof todo.content === 'string') {
          oldByContent.set(todo.content, todo);
        }
      }
    }

    for (const todo of newTodos) {
      if (!todo || typeof todo.content !== 'string') continue;
      const previous = oldByContent.get(todo.content);
      let changeNote = '';
      if (!previous) {
        changeNote = ' (new)';
      } else if (previous.status !== todo.status) {
        changeNote = ` (${formatStatus(previous.status)} → ${formatStatus(todo.status)})`;
      }

      const label = todo.activeForm && todo.activeForm !== todo.content
        ? `${todo.content} – ${todo.activeForm}`
        : todo.content;

      lines.push(`- [${formatStatus(todo.status)}] ${label}${changeNote}`);
      if (previous) {
        oldByContent.delete(todo.content);
      }
    }

    // Any remaining todos in oldByContent were removed
    for (const removed of oldByContent.values()) {
      if (!removed || typeof removed.content !== 'string') continue;
      lines.push(`- [removed] ${removed.content}`);
    }

    return lines.join('\n');
  }
}
