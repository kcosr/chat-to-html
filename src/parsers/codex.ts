import { ChatSession, ChatMessage, MessageContent, TokenUsage, Parser, ParseOptions } from '../types.js';

// Codex JSONL format types
interface CodexSessionMeta {
  type: 'session_meta';
  timestamp: string;
  payload: {
    id: string;
    cwd?: string;
    cli_version?: string;
    model_provider?: string;
    git?: {
      branch?: string;
      commit_hash?: string;
      repository_url?: string;
    };
  };
}

interface CodexTextContent {
  type: 'input_text' | 'output_text';
  text: string;
}

type CodexContent = CodexTextContent;

interface CodexResponseItem {
  type: 'response_item';
  timestamp: string;
  payload: {
    type: string;
    role?: 'user' | 'assistant';
    content?: CodexContent[];
    name?: string;
    arguments?: string;
    call_id?: string;
    output?: string;
    status?: string;
    input?: string;
    summary?: { type: string; text: string }[];
    encrypted_content?: string;
  };
}

interface CodexEventEntry {
  type: 'event_msg';
  timestamp: string;
  payload?: {
    type?: string;
    message?: string;
    text?: string;
    info?: {
      total_token_usage?: {
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
        reasoning_output_tokens?: number;
        total_tokens: number;
      };
    };
  };
}

interface CodexEntryBase {
  type: string;
  timestamp: string;
  payload?: unknown;
}

type CodexEntry = CodexResponseItem | CodexEventEntry | CodexEntryBase;

interface CodexTokenCountEvent extends CodexEventEntry {
  payload: {
    type: 'token_count';
    info?: {
      total_token_usage?: {
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
        reasoning_output_tokens?: number;
        total_tokens: number;
      };
    };
  };
}

export class CodexParser implements Parser {
  canParse(firstLine: string): boolean {
    try {
      const entry = JSON.parse(firstLine);
      // Codex files start with session_meta or have originator: codex_cli_rs
      return (
        entry.type === 'session_meta' ||
        (entry.payload?.originator === 'codex_cli_rs')
      );
    } catch {
      return false;
    }
  }

  parse(content: string, options?: ParseOptions): ChatSession {
    const lines = content.trim().split('\n').filter(line => line.trim());
    const entries: CodexEntry[] = lines.map(line => JSON.parse(line));

    // Extract session metadata
    const metaEntry = entries.find(e => e.type === 'session_meta') as CodexSessionMeta | undefined;
    const sessionId = metaEntry?.payload?.id || 'unknown';
    const cwd = metaEntry?.payload?.cwd;
    const version = metaEntry?.payload?.cli_version;
    const gitBranch = metaEntry?.payload?.git?.branch;

    // Extract token usage from the last token_count event
    const tokenCountEvents = entries.filter(
      (e): e is CodexTokenCountEvent =>
        e.type === 'event_msg' &&
        (e.payload as { type?: string })?.type === 'token_count'
    );

    const lastTokenEvent = tokenCountEvents[tokenCountEvents.length - 1];
    const tokenInfo = lastTokenEvent?.payload?.info?.total_token_usage;

    const totalUsage: TokenUsage = {
      inputTokens: tokenInfo?.input_tokens || 0,
      outputTokens: tokenInfo?.output_tokens || 0,
      cacheReadTokens: tokenInfo?.cached_input_tokens || 0,
    };

    const messages: ChatMessage[] = [];

    const identifyHarness = options?.identifyHarness !== false;
    let userMessageCount = 0;

    for (const entry of entries) {
      if (entry.type === 'response_item') {
        const item = entry as CodexResponseItem;
        const payload = item.payload;

        if (payload.type === 'message' && payload.role && payload.content) {
          let isHarness = false;
          if (payload.role === 'user') {
            userMessageCount++;
            if (identifyHarness && userMessageCount <= 2) {
              isHarness = true;
            }
          }

          const content = this.parseContent(payload.content);
          if (content.length > 0) {
            const message: ChatMessage = {
              id: item.timestamp,
              role: payload.role,
              content,
              timestamp: item.timestamp,
            };
            if (isHarness) {
              message.isHarness = true;
            }
            messages.push(message);
          }
        }

        if (payload.type === 'function_call' && payload.name && payload.call_id) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(payload.arguments || '{}');
          } catch {
            parsedArgs = { raw: payload.arguments };
          }

          messages.push({
            id: item.timestamp,
            role: 'assistant',
            content: [{
              type: 'tool_use',
              toolCall: {
                id: payload.call_id,
                name: payload.name,
                input: parsedArgs,
              },
            }],
            timestamp: item.timestamp,
          });
        }

        if (payload.type === 'function_call_output' && payload.call_id) {
          messages.push({
            id: item.timestamp,
            role: 'user',
            content: [{
              type: 'tool_result',
              toolResult: {
                toolUseId: payload.call_id,
                content: payload.output || '',
              },
            }],
            timestamp: item.timestamp,
          });
        }

        if (payload.type === 'custom_tool_call' && payload.call_id) {
          let parsedInput: Record<string, unknown> = {};
          if (typeof payload.input === 'string' && payload.input.length > 0) {
            try {
              parsedInput = JSON.parse(payload.input);
            } catch {
              parsedInput = { raw: payload.input };
            }
          }

          messages.push({
            id: item.timestamp,
            role: 'assistant',
            content: [{
              type: 'tool_use',
              toolCall: {
                id: payload.call_id,
                name: payload.name || 'custom_tool_call',
                input: parsedInput,
              },
            }],
            timestamp: item.timestamp,
          });
        }

        if (payload.type === 'custom_tool_call_output' && payload.call_id) {
          let contentText = payload.output || '';
          if (contentText) {
            try {
              const parsed = JSON.parse(contentText);
              if (typeof parsed === 'string') {
                contentText = parsed;
              } else if (parsed && typeof parsed === 'object' && 'output' in parsed && typeof (parsed as { output?: unknown }).output === 'string') {
                contentText = (parsed as { output: string }).output;
              } else {
                contentText = JSON.stringify(parsed, null, 2);
              }
            } catch {
              // leave contentText as-is if it isn't valid JSON
            }
          }

          messages.push({
            id: item.timestamp,
            role: 'user',
            content: [{
              type: 'tool_result',
              toolResult: {
                toolUseId: payload.call_id,
                content: contentText,
              },
            }],
            timestamp: item.timestamp,
          });
        }

        if (payload.type === 'reasoning') {
          // Skip reasoning response_items; we render the corresponding
          // agent_reasoning event_msg entries instead to avoid duplicates.
          continue;
        }
      } else if (entry.type === 'event_msg') {
        const event = entry as CodexEventEntry;
        const payload = event.payload;
        if (!payload || typeof payload.type !== 'string') {
          continue;
        }

        if (payload.type === 'token_count') {
          continue;
        }

        if (payload.type === 'user_message' || payload.type === 'agent_message') {
          continue;
        }

        if (payload.type === 'agent_reasoning' && payload.text) {
          const message: ChatMessage = {
            id: event.timestamp,
            role: identifyHarness ? 'system' : 'assistant',
            content: [{
              type: 'thinking',
              text: payload.text,
            }],
            timestamp: event.timestamp,
          };
          if (identifyHarness) {
            message.isHarness = true;
          }
          messages.push(message);
        }
      }
    }

    return {
      sessionId,
      version,
      cwd,
      gitBranch,
      messages,
      totalUsage,
      source: 'codex',
    };
  }

  private parseContent(content: CodexContent[]): MessageContent[] {
    const result: MessageContent[] = [];

    for (const item of content) {
      if (item.type === 'input_text' || item.type === 'output_text') {
        result.push({
          type: 'text',
          text: item.text,
        });
      }
    }

    return result;
  }
}
