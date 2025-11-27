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

interface CodexFunctionCall {
  type: 'function_call';
  name: string;
  arguments: string;
  call_id: string;
}

interface CodexFunctionCallOutput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

type CodexContent = CodexTextContent | CodexFunctionCall | CodexFunctionCallOutput;

interface CodexResponseItem {
  type: 'response_item';
  timestamp: string;
  payload: {
    type: 'message' | 'function_call' | 'function_call_output';
    role?: 'user' | 'assistant';
    content?: CodexContent[];
    name?: string;
    arguments?: string;
    call_id?: string;
    output?: string;
  };
}

interface CodexEntry {
  type: string;
  timestamp: string;
  payload?: unknown;
}

interface CodexTokenCountEvent {
  type: 'event_msg';
  timestamp: string;
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

    // Get response items (messages and function calls)
    const responseItems = entries.filter(
      (e): e is CodexResponseItem => e.type === 'response_item'
    );

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
    const functionCalls: Map<string, { name: string; args: string; timestamp: string }> = new Map();

    // Track user message count for harness filtering
    let userMessageCount = 0;

    for (const item of responseItems) {
      const payload = item.payload;

      // Handle message types
      if (payload.type === 'message' && payload.role && payload.content) {
        // Track user messages for harness identification
        let isHarness = false;
        if (payload.role === 'user') {
          userMessageCount++;
          if (options?.identifyHarness && userMessageCount <= 2) {
            isHarness = true;
          }
        }

        const content = this.parseContent(payload.content);
        if (content.length > 0) {
          messages.push({
            id: item.timestamp,
            role: payload.role,
            content,
            timestamp: item.timestamp,
            ...(isHarness && { isHarness: true }),
          });
        }
      }

      // Handle function calls (tool use)
      if (payload.type === 'function_call' && payload.name && payload.call_id) {
        functionCalls.set(payload.call_id, {
          name: payload.name,
          args: payload.arguments || '{}',
          timestamp: item.timestamp,
        });

        // Add as assistant message with tool call
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

      // Handle function call outputs (tool results)
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
