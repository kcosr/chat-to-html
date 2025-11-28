import { ChatSession, ChatMessage, MessageContent, TokenUsage, ThemeConfig, getTotalTokens } from './types.js';

interface RenderMessage {
  id: string;
  role: ChatMessage['role'];
  content: MessageContent[];
  timestamp: string;
  model?: string;
  usage?: TokenUsage;
  isHarness?: boolean;
  kind: 'normal' | 'tool_call' | 'tool_result';
  parentId?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function processLists(html: string): string {
  const lines = html.split('\n');
  const result: string[] = [];
  const listStack: number[] = []; // Stack of indentation levels

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match list items: spaces + (- or * or digit.) + space + content
    const match = line.match(/^(\s*)([\-\*]|\d+\.)\s+(.+)$/);

    if (match) {
      const indent = match[1].length;
      const content = match[3];

      // Determine nesting level (every 2 spaces = 1 level)
      const level = Math.floor(indent / 2);

      // Close lists that are deeper than current level
      while (listStack.length > 0 && listStack[listStack.length - 1] > level) {
        listStack.pop();
        result.push('</ul>');
      }

      // Open new list if needed
      if (listStack.length === 0 || listStack[listStack.length - 1] < level) {
        listStack.push(level);
        result.push('<ul>');
      }

      result.push(`<li>${content}</li>`);
    } else {
      // Not a list item - close all open lists
      while (listStack.length > 0) {
        listStack.pop();
        result.push('</ul>');
      }
      result.push(line);
    }
  }

  // Close any remaining open lists
  while (listStack.length > 0) {
    listStack.pop();
    result.push('</ul>');
  }

  return result.join('\n');
}

function parseMarkdown(text: string): string {
  // Extract code blocks first to protect them from other markdown processing
  // Use \x00 markers that won't conflict with markdown syntax
  const codeBlocks: string[] = [];
  let html = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `\x00CB${codeBlocks.length}\x00`;
    codeBlocks.push(`<pre class="code-block${lang ? ` language-${lang}` : ''}"><code>${escapeHtml(code.trim())}</code></pre>`);
    return placeholder;
  });

  // Extract inline code to protect it
  const inlineCode: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const placeholder = `\x00IC${inlineCode.length}\x00`;
    inlineCode.push(`<code class="inline-code">${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // Now escape HTML for the rest
  html = escapeHtml(html);

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Process lists with proper nesting
  html = processLists(html);

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Paragraphs: double newlines become paragraph breaks
  html = html.replace(/\n\n+/g, '</p><p>');

  // Single line breaks
  html = html.replace(/\n/g, '<br>');

  // Wrap in paragraph tags
  html = '<p>' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>\s*<\/p>/g, '');

  // Restore inline code
  inlineCode.forEach((code, i) => {
    html = html.replace(`\x00IC${i}\x00`, code);
  });

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    html = html.replace(`\x00CB${i}\x00`, block);
  });

  // Clean up extra <br> and <p> inside block elements
  html = html.replace(/<\/pre><br>/g, '</pre>');
  html = html.replace(/<br><pre/g, '<pre');
  html = html.replace(/<\/h([1-3])><br>/g, '</h$1>');
  html = html.replace(/<\/li><br>/g, '</li>');
  html = html.replace(/<\/ul><br>/g, '</ul>');
  html = html.replace(/<br><ul>/g, '<ul>');
  html = html.replace(/<\/blockquote><br>/g, '</blockquote>');
  html = html.replace(/<ul><br>/g, '<ul>');
  html = html.replace(/<br><li>/g, '<li>');

  // Clean up paragraphs around block elements
  html = html.replace(/<p><ul>/g, '<ul>');
  html = html.replace(/<\/ul><\/p>/g, '</ul>');
  html = html.replace(/<p><pre/g, '<pre');
  html = html.replace(/<\/pre><\/p>/g, '</pre>');
  html = html.replace(/<p><h([1-3])>/g, '<h$1>');
  html = html.replace(/<\/h([1-3])><\/p>/g, '</h$1>');
  html = html.replace(/<\/p><br><p>/g, '</p><p>');
  html = html.replace(/<br><\/p>/g, '</p>');
  html = html.replace(/<p><br>/g, '<p>');

  return html;
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  return date.toLocaleString();
}

function renderTokenUsage(usage: TokenUsage, source?: 'claude' | 'codex' | 'gemini' | 'unknown'): string {
  const parts: string[] = [];
  parts.push(`<span class="token-stat"><span class="label">Input:</span> ${formatNumber(usage.inputTokens)}</span>`);
  parts.push(`<span class="token-stat"><span class="label">Output:</span> ${formatNumber(usage.outputTokens)}</span>`);

  if (usage.cacheCreationTokens && usage.cacheCreationTokens > 0) {
    parts.push(`<span class="token-stat"><span class="label">Cache Created:</span> ${formatNumber(usage.cacheCreationTokens)}</span>`);
  }
  if (usage.cacheReadTokens && usage.cacheReadTokens > 0) {
    parts.push(`<span class="token-stat"><span class="label">Cache Read:</span> ${formatNumber(usage.cacheReadTokens)}</span>`);
  }

  // Calculate total based on source using shared function
  const total = getTotalTokens(usage, source || 'unknown');
  parts.push(`<span class="token-stat total"><span class="label">Total:</span> ${formatNumber(total)}</span>`);

  return parts.join('');
}

function renderToolInput(input: Record<string, unknown>): string {
  // Special handling for common tool inputs
  const formatted = JSON.stringify(input, null, 2);
  return `<pre class="tool-input">${escapeHtml(formatted)}</pre>`;
}

function renderToolResult(content: string): string {
  // Check if the content looks like code/file output (has line numbers like "    1→")
  const hasLineNumbers = /^\s*\d+→/.test(content);

  if (hasLineNumbers) {
    return `<pre class="tool-result code-output">${escapeHtml(content)}</pre>`;
  }

  // Check if it's a simple result
  if (content.length < 200 && !content.includes('\n')) {
    return `<div class="tool-result simple">${escapeHtml(content)}</div>`;
  }

  return `<pre class="tool-result">${escapeHtml(content)}</pre>`;
}

function flattenMessages(messages: ChatMessage[]): RenderMessage[] {
  const flattened: RenderMessage[] = [];

  for (const msg of messages) {
    const base = {
      id: msg.id,
      role: msg.role,
      timestamp: msg.timestamp,
      model: msg.model,
      isHarness: msg.isHarness,
    };

    const originalUsage = msg.usage;
    let usageAttached = false;

    const attachUsage = (): TokenUsage | undefined => {
      if (!usageAttached && originalUsage) {
        usageAttached = true;
        return originalUsage;
      }
      return undefined;
    };

    if (!msg.content || msg.content.length === 0) {
      flattened.push({
        ...base,
        content: [],
        usage: attachUsage(),
        kind: 'normal',
      });
      continue;
    }

    let buffer: MessageContent[] = [];
    let toolIndex = 0;

    const flushBuffer = () => {
      if (buffer.length === 0) return;
      flattened.push({
        ...base,
        content: buffer,
        usage: attachUsage(),
        kind: 'normal',
      });
      buffer = [];
    };

    for (const item of msg.content) {
      if (item.type === 'tool_use' || item.type === 'tool_result') {
        flushBuffer();

        const kind = item.type === 'tool_use' ? 'tool_call' : 'tool_result';
        const toolId =
          item.type === 'tool_use'
            ? item.toolCall?.id
            : item.toolResult?.toolUseId;
        const segmentId = toolId
          ? `${msg.id}:${kind}:${toolId}`
          : `${msg.id}:${kind}:${toolIndex}`;

        flattened.push({
          ...base,
          id: segmentId,
          content: [item],
          usage: attachUsage(),
          kind,
          parentId: msg.id,
        });
        toolIndex++;
      } else {
        buffer.push(item);
      }
    }

    flushBuffer();
  }

  return flattened;
}

function renderContent(item: MessageContent): string {
  switch (item.type) {
    case 'text':
      if (!item.text) return '';
      return `
        <div class="message-text">
          <div class="markdown-view">
            ${parseMarkdown(item.text)}
          </div>
          <pre class="plain-view">${escapeHtml(item.text)}</pre>
        </div>
      `;

    case 'thinking':
      if (!item.text) return '';
      return `
        <div class="message-text thinking-text">
          <div class="markdown-view">
            ${parseMarkdown(item.text)}
          </div>
          <pre class="plain-view">${escapeHtml(item.text)}</pre>
        </div>
      `;

    case 'tool_use':
      if (!item.toolCall) return '';
      const tc = item.toolCall;
      return `
        <div class="tool-call">
          <div class="tool-header">
            <span class="tool-name">${escapeHtml(tc.name)}</span>
            <span class="tool-id">${escapeHtml(tc.id)}</span>
            <button class="tool-expand-toggle" type="button" aria-expanded="false">
              <i class="bi bi-chevron-down"></i>
              <span class="tool-expand-label">Expand</span>
            </button>
          </div>
          ${renderToolInput(tc.input)}
        </div>
      `;

    case 'tool_result':
      if (!item.toolResult) return '';
      const tr = item.toolResult;
      return `
        <div class="tool-result-container">
          <div class="tool-result-header">
            <span class="result-label">Result</span>
            <span class="tool-id">${escapeHtml(tr.toolUseId)}</span>
            <button class="tool-expand-toggle" type="button" aria-expanded="false">
              <i class="bi bi-chevron-down"></i>
              <span class="tool-expand-label">Expand</span>
            </button>
          </div>
          ${renderToolResult(tr.content)}
        </div>
      `;

    default:
      return '';
  }
}

function renderMessage(msg: RenderMessage, source?: 'claude' | 'codex' | 'gemini' | 'unknown'): string {
  const isHarness = msg.isHarness === true;
  const hasThinking = msg.content.some(item => item.type === 'thinking');
  const isToolCallMessage = msg.kind === 'tool_call';
  const isToolResultMessage = msg.kind === 'tool_result';
  const roleClass = isHarness ? 'harness' : (msg.role === 'assistant' ? 'assistant' : 'user');
  const thinkingClass = hasThinking ? ' thinking' : '';
  const toolClass = isToolCallMessage ? ' tool-call-message' : (isToolResultMessage ? ' tool-result-message' : '');

  const roleIcon = isToolCallMessage
    ? '<i class="bi bi-wrench"></i>'
    : isToolResultMessage
      ? '<i class="bi bi-box-arrow-right"></i>'
      : (hasThinking
          ? '<i class="bi bi-lightbulb"></i>'
          : (isHarness
              ? '<i class="bi bi-gear"></i>'
              : (msg.role === 'assistant' ? '<i class="bi bi-robot"></i>' : '<i class="bi bi-person"></i>')));

  const roleText = isToolCallMessage
    ? 'Tool Call'
    : isToolResultMessage
      ? 'Tool Result'
      : (hasThinking
          ? 'Thinking'
          : (isHarness ? 'Harness' : (msg.role === 'assistant' ? 'Assistant' : 'User')));

  const contentHtml = msg.content.map(renderContent).join('\n');

  const usageHtml = msg.usage
    ? `<div class="message-usage">${renderTokenUsage(msg.usage, source)}</div>`
    : '';

  const modelHtml = msg.model
    ? `<span class="message-model">${escapeHtml(msg.model)}</span>`
    : '';

  // Harness messages are hidden by default
  const hiddenClass = isHarness ? ' hidden' : '';

  return `
    <div class="message ${roleClass}${thinkingClass}${toolClass}${hiddenClass}">
      <div class="message-header">
        <span class="role">${roleIcon} ${roleText}</span>
        ${modelHtml}
        <span class="timestamp">${formatTimestamp(msg.timestamp)}</span>
      </div>
      <div class="message-content">
        ${contentHtml}
      </div>
      ${usageHtml}
    </div>
  `;
}

// Helper to parse hex color to RGB components
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

// Helper to darken a hex color
function darkenHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const darken = (c: number) => Math.max(0, Math.floor(c * (1 - amount)));
  return `#${darken(rgb.r).toString(16).padStart(2, '0')}${darken(rgb.g).toString(16).padStart(2, '0')}${darken(rgb.b).toString(16).padStart(2, '0')}`;
}

function getStyles(theme?: ThemeConfig): string {
  // Default theme values - dark greys with high contrast
  const bgPage = theme?.bgPage || '#121212';
  const bgCard = theme?.bgCard || '#1c1c1c';
  const bgAccent = theme?.bgAccent || '#282828';
  const textMain = theme?.textMain || '#f0f0f0';
  const textMuted = theme?.textMuted || '#a0a0a0';
  const border = theme?.border || '#383838';

  // Accent colors - warm, muted earth tones
  const accentUser = theme?.accentUser || '#db7c2c';
  const accentAssistant = theme?.accentAssistant || '#e29d33';
  const accentTool = theme?.accentTool || '#c5b357';
  const accentResult = theme?.accentResult || '#76854a';
  const accentThinking = '#0C4767';

  // Font families with fallbacks
  const defaultUiFont = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif";
  const defaultCodeFont = "'SF Mono', Monaco, 'Cascadia Code', 'Consolas', monospace";
  const fontUi = theme?.fontUi ? `'${theme.fontUi}', ${defaultUiFont}` : defaultUiFont;
  const fontCode = theme?.fontCode ? `'${theme.fontCode}', ${defaultCodeFont}` : defaultCodeFont;

  // Derived colors
  const bgCode = darkenHex(bgPage, 0.3);
  const bgCodeDark = darkenHex(bgPage, 0.5);

  // Get RGB for tool backgrounds
  const toolRgb = hexToRgb(accentTool);
  const assistantRgb = hexToRgb(accentAssistant);
  const bgToolCall = toolRgb
    ? `rgba(${toolRgb.r}, ${toolRgb.g}, ${toolRgb.b}, 0.1)`
    : 'rgba(233, 69, 96, 0.1)';
  const bgToolResult = assistantRgb
    ? `rgba(${assistantRgb.r}, ${assistantRgb.g}, ${assistantRgb.b}, 0.1)`
    : 'rgba(80, 200, 120, 0.1)';

  return `
    :root {
      /* Background colors */
      --bg-primary: ${bgPage};
      --bg-secondary: ${bgCard};
      --bg-tertiary: ${bgAccent};
      --bg-code: ${bgCode};
      --bg-code-dark: ${bgCodeDark};
      --bg-overlay-dark: rgba(0, 0, 0, 0.2);
      --bg-overlay-light: rgba(0, 0, 0, 0.15);

      /* Text colors */
      --text-primary: ${textMain};
      --text-secondary: ${textMuted};

      /* Accent colors */
      --accent-user: ${accentUser};
      --accent-assistant: ${accentAssistant};
      --accent-tool: ${accentTool};
      --accent-tool-result: ${accentResult};
      --accent-thinking: ${accentThinking};

      /* Border */
      --border-color: ${border};

      /* Tool backgrounds (transparent versions of accents) */
      --bg-tool-call: ${bgToolCall};
      --bg-tool-result: ${bgToolResult};

      /* Source badges */
      --badge-claude: #c96b4a;
      --badge-codex: #5a8fba;
      --badge-gemini: #5a8fba;

      /* Fonts */
      --font-ui: ${fontUi};
      --font-code: ${fontCode};
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: var(--font-ui);
      background: var(--bg-primary);
      color: var(--text-primary);
      margin: 0;
      padding: 0;
      line-height: 1.6;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }

    .header {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }

    .header h1 {
      margin: 0 0 15px 0;
      font-size: 1.5rem;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .session-info {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 10px 20px;
      margin-bottom: 15px;
      padding: 0 20px;
    }

    .info-item {
      display: flex;
      flex-direction: column;
    }

    .info-item:nth-child(3n+2) {
      text-align: center;
    }

    .info-item:nth-child(3n) {
      text-align: right;
    }

    .info-item .label {
      font-size: 0.75rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .info-item .value {
      font-family: var(--font-code);
      font-size: 0.9rem;
      color: var(--text-primary);
      word-break: break-all;
    }

    .info-item.wide {
      grid-column: span 2;
    }

    .token-summary {
      background: var(--bg-tertiary);
      border-radius: 6px;
      padding: 15px;
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
    }

    .token-stat {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .token-stat .label {
      font-size: 0.8rem;
      color: var(--text-secondary);
    }

    .token-stat.total {
      font-weight: bold;
      color: var(--accent-assistant);
    }

    .messages {
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .message {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .message.user {
      border-left: 4px solid var(--accent-user);
    }

    .message.assistant {
      border-left: 4px solid var(--accent-assistant);
    }

    .message.harness {
      border-left: 4px solid var(--text-secondary);
      opacity: 0.7;
    }

    .message.thinking {
      border-left-style: dashed;
      opacity: 0.9;
    }

    .message-header {
      display: flex;
      align-items: center;
      gap: 15px;
      padding: 12px 15px;
      background: var(--bg-overlay-dark);
      border-bottom: 1px solid var(--border-color);
    }

    .message-header .role {
      font-weight: 600;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .message-header .message-model {
      font-family: var(--font-code);
      font-size: 0.75rem;
      color: var(--text-secondary);
      background: var(--bg-tertiary);
      padding: 2px 8px;
      border-radius: 4px;
    }

    .message-header .timestamp {
      margin-left: auto;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }

    .message-content {
      padding: 15px;
    }

    .message-text {
      word-wrap: break-word;
      line-height: 1.5;
    }

    .message-text .plain-view {
      white-space: pre-wrap;
      font-family: var(--font-code);
      font-size: 0.9rem;
      margin: 0;
      display: none;
    }

    .message-text p {
      margin: 0 0 0.5em 0;
    }

    .message-text p:last-child {
      margin-bottom: 0;
    }

    .message-text h1, .message-text h2, .message-text h3 {
      margin: 0.5em 0 0.3em 0;
      color: var(--text-primary);
    }

    .message-text h1 { font-size: 1.4rem; }
    .message-text h2 { font-size: 1.2rem; }
    .message-text h3 { font-size: 1.1rem; }

    .message-text ul, .message-text ol {
      margin: 0 0 0.5em 0;
      padding-left: 1.5em;
    }

    .message-text li {
      margin: 0;
    }

    .message-text li > ul, .message-text li > ol {
      margin-bottom: 0;
    }

    .message-text blockquote {
      margin: 0.5em 0;
      padding: 0.5em 1em;
      border-left: 3px solid var(--accent-assistant);
      background: var(--bg-overlay-light);
      color: var(--text-secondary);
    }

    .message-text a {
      color: var(--accent-user);
      text-decoration: none;
    }

    .message-text a:hover {
      text-decoration: underline;
    }

    .message-text .inline-code {
      font-family: var(--font-code);
      font-size: 0.9em;
      background: var(--bg-code);
      padding: 0.15em 0.4em;
      border-radius: 4px;
      color: var(--accent-tool);
    }

    .message-text .code-block {
      font-family: var(--font-code);
      font-size: 0.85rem;
      background: var(--bg-code);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 12px;
      margin: 0.5em 0;
      overflow-x: auto;
    }

    .message-text .code-block code {
      background: none;
      padding: 0;
    }

    .message-text strong {
      color: var(--text-primary);
      font-weight: 600;
    }

    .message-text em {
      font-style: italic;
    }

    .thinking-text {
      font-style: italic;
    }

    .message-usage {
      padding: 10px 15px;
      background: var(--bg-overlay-light);
      border-top: 1px solid var(--border-color);
      font-size: 0.8rem;
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
    }

    .tool-call, .tool-result-container {
      margin: 10px 0;
      background: var(--bg-code);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      overflow: hidden;
    }

    .tool-header, .tool-result-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: var(--bg-tool-call);
      border-bottom: 1px solid var(--border-color);
    }

    .tool-result-header {
      background: var(--bg-tool-result);
    }

    .tool-header i, .tool-result-header i {
      font-size: 1rem;
    }

    .tool-name {
      font-family: var(--font-code);
      font-weight: 600;
      color: var(--accent-tool);
    }

    .result-label {
      font-weight: 600;
      color: var(--accent-assistant);
    }

    .tool-id {
      font-family: var(--font-code);
      font-size: 0.7rem;
      color: var(--text-secondary);
      margin-left: 8px;
    }

    .tool-input {
      margin: 0;
      padding: 12px;
      font-family: var(--font-code);
      font-size: 0.85rem;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      color: var(--text-primary);
      max-height: 300px;
      overflow-y: auto;
    }

    .tool-call.expanded .tool-input,
    .tool-result-container.expanded .tool-result {
      max-height: none;
    }

    .tool-result {
      margin: 0;
      padding: 12px;
      font-family: var(--font-code);
      font-size: 0.85rem;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      color: var(--text-primary);
      max-height: 400px;
      overflow-y: auto;
    }

    .tool-result.code-output {
      background: var(--bg-code-dark);
      font-size: 0.8rem;
    }

    .tool-result.simple {
      padding: 10px 12px;
      font-family: inherit;
      background: transparent;
      max-height: none;
      overflow-y: visible;
    }

    .tool-expand-toggle {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      font-size: 0.75rem;
      background: transparent;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .tool-expand-toggle:hover {
      background: var(--bg-overlay-dark);
      color: var(--text-primary);
    }

    .tool-expand-toggle i {
      font-size: 0.9rem;
    }

    /* Scrollbar styling */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    ::-webkit-scrollbar-track {
      background: var(--bg-primary);
    }

    ::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--text-secondary);
    }

    /* Source badge */
    .source-badge {
      display: inline-block;
      font-size: 0.7rem;
      font-weight: bold;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--accent-assistant);
      color: var(--bg-primary);
    }

    .source-badge.claude { background: var(--badge-claude); }
    .source-badge.codex { background: var(--badge-codex); }
    .source-badge.gemini { background: var(--badge-gemini); }

    /* Filter bar */
    .filter-bar {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 12px 20px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 20px;
      flex-wrap: wrap;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .filter-bar.stuck {
      border-top-left-radius: 0;
      border-top-right-radius: 0;
    }

    .filter-bar::before {
      content: '';
      position: absolute;
      top: -20px;
      left: -20px;
      right: -20px;
      height: 20px;
      background: var(--bg-primary);
    }

    .filter-toggles {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .filter-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 0.85rem;
      user-select: none;
    }

    .filter-toggle:hover {
      border-color: var(--text-secondary);
    }

    .filter-toggle.active {
      background: var(--accent-assistant);
      color: var(--bg-primary);
      border-color: var(--accent-assistant);
    }

    .filter-toggle.active.user-toggle {
      background: var(--accent-user);
      border-color: var(--accent-user);
    }

    .filter-toggle.active.assistant-toggle {
      background: var(--accent-assistant);
      border-color: var(--accent-assistant);
    }

    .filter-toggle.active.tool-call-toggle {
      background: var(--accent-tool);
      border-color: var(--accent-tool);
    }

    .filter-toggle.active.tool-result-toggle {
      background: var(--accent-tool-result);
      border-color: var(--accent-tool-result);
    }

    .filter-toggle.active.harness-toggle {
      background: var(--text-secondary);
      border-color: var(--text-secondary);
    }

    .filter-toggle.active.thinking-toggle {
      background: var(--accent-thinking);
      border-color: var(--accent-thinking);
    }

    .filter-toggle input {
      display: none;
    }

    .filter-toggle i {
      font-size: 1rem;
    }

    .search-group {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }

    /* Hidden states for filtering */
    .message.hidden {
      display: none;
    }

    .tool-call.hidden,
    .tool-result-container.hidden {
      display: none;
    }

    /* Search box */
    .search-box {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 6px 12px;
      flex: 1;
      max-width: 300px;
    }

    .search-box i {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .search-box input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: var(--text-primary);
      font-size: 0.85rem;
      min-width: 0;
    }

    .search-box input::placeholder {
      color: var(--text-secondary);
    }

    .search-clear {
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 2px;
      border-radius: 4px;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .search-box:focus-within .search-clear,
    .search-box.has-value .search-clear {
      opacity: 1;
    }

    .search-clear:hover {
      color: var(--text-primary);
      background: var(--bg-overlay-dark);
    }

    .mode-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      cursor: pointer;
      color: var(--text-secondary);
      transition: all 0.2s ease;
    }

    .mode-btn:hover {
      background: var(--bg-overlay-dark);
      color: var(--text-primary);
    }

    .mode-btn.active {
      background: var(--accent-assistant);
      border-color: var(--accent-assistant);
      color: var(--bg-primary);
    }

    .mode-btn i {
      font-size: 1rem;
    }

    /* Navigation buttons */
    .nav-buttons {
      display: flex;
      gap: 6px;
    }

    .nav-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 1.1rem;
      color: var(--text-primary);
    }

    .nav-btn:hover {
      background: var(--accent-assistant);
      color: var(--bg-primary);
      border-color: var(--accent-assistant);
    }
  `;
}

export function generateHtml(session: ChatSession, theme?: ThemeConfig): string {
  const messagesHtml = flattenMessages(session.messages).map(msg => renderMessage(msg, session.source)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat Session - ${escapeHtml(session.sessionId)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <style>${getStyles(theme)}</style>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>
        <span class="source-badge ${session.source}">${session.source}</span>
        Chat Session
      </h1>
      <div class="session-info">
        <div class="info-item">
          <span class="label">Session ID</span>
          <span class="value">${escapeHtml(session.sessionId)}</span>
        </div>
        <div class="info-item">
          <span class="label">Harness</span>
          <span class="value">${escapeHtml(session.source)}</span>
        </div>
        <div class="info-item">
          <span class="label">Version</span>
          <span class="value">${session.version ? escapeHtml(session.version) : '-'}</span>
        </div>
        <div class="info-item">
          <span class="label">Working Directory</span>
          <span class="value">${session.cwd ? escapeHtml(session.cwd) : '-'}</span>
        </div>
        <div class="info-item">
          <span class="label">Messages</span>
          <span class="value">${session.messages.length}</span>
        </div>
        ${session.gitBranch ? `
        <div class="info-item">
          <span class="label">Git Branch</span>
          <span class="value">${escapeHtml(session.gitBranch)}</span>
        </div>
        ` : ''}
        ${session.model ? `
        <div class="info-item">
          <span class="label">Model</span>
          <span class="value">${escapeHtml(session.model)}</span>
        </div>
        ` : ''}
        ${session.agentId ? `
        <div class="info-item">
          <span class="label">Agent ID</span>
          <span class="value">${escapeHtml(session.agentId)}</span>
        </div>
        ` : ''}
      </div>
      <div class="token-summary">
        <strong>Total Tokens:</strong>
        ${renderTokenUsage(session.totalUsage, session.source)}
      </div>
    </header>

    <div class="filter-bar">
      <div class="filter-toggles">
        <label class="filter-toggle user-toggle active" data-filter="user">
          <input type="checkbox" checked>
          <i class="bi bi-person"></i>
          <span>User</span>
        </label>
        <label class="filter-toggle assistant-toggle active" data-filter="assistant">
          <input type="checkbox" checked>
          <i class="bi bi-robot"></i>
          <span>Assistant</span>
        </label>
        <label class="filter-toggle tool-call-toggle active" data-filter="tool-call">
          <input type="checkbox" checked>
          <i class="bi bi-wrench"></i>
          <span>Tool Calls</span>
        </label>
        <label class="filter-toggle tool-result-toggle active" data-filter="tool-result">
          <input type="checkbox" checked>
          <i class="bi bi-box-arrow-right"></i>
          <span>Tool Results</span>
        </label>
        <label class="filter-toggle harness-toggle" data-filter="harness">
          <input type="checkbox">
          <i class="bi bi-gear"></i>
          <span>Harness</span>
        </label>
        <label class="filter-toggle thinking-toggle" data-filter="thinking">
          <input type="checkbox">
          <i class="bi bi-lightbulb"></i>
          <span>Thinking</span>
        </label>
      </div>
      <div class="search-group">
        <button class="mode-btn active" id="markdown-toggle" title="Toggle Markdown view">
          <i class="bi bi-markdown"></i>
        </button>
        <div class="search-box">
          <i class="bi bi-search"></i>
          <input type="text" id="search-input" placeholder="Filter messages..." />
          <button id="search-clear" class="search-clear" title="Clear search"><i class="bi bi-x"></i></button>
        </div>
        <div class="nav-buttons">
          <button class="nav-btn" id="scroll-top" title="Scroll to top"><i class="bi bi-chevron-up"></i></button>
          <button class="nav-btn" id="scroll-bottom" title="Scroll to bottom"><i class="bi bi-chevron-down"></i></button>
        </div>
      </div>
    </div>

    <main class="messages">
      ${messagesHtml}
    </main>
  </div>

  <script>
    (function() {
      const filters = {
        user: true,
        assistant: true,
        'tool-call': true,
        'tool-result': true,
        harness: false,
        thinking: false
      };
      let searchTerm = '';

      const filterBar = document.querySelector('.filter-bar');
      const searchInput = document.getElementById('search-input');
      const searchClear = document.getElementById('search-clear');
      const searchBox = searchInput.parentElement;
      let markdownEnabled = true;

      function updateStickyState() {
        if (!filterBar) return;
        const rect = filterBar.getBoundingClientRect();
        const stuck = rect.top <= 0;
        filterBar.classList.toggle('stuck', stuck);
      }

      function applyFilters() {
        const term = searchTerm.toLowerCase();

        document.querySelectorAll('.message').forEach(function(el) {
          // Determine message type
          const isUser = el.classList.contains('user');
          const isAssistant = el.classList.contains('assistant');
          const isHarness = el.classList.contains('harness');
          const isThinking = el.classList.contains('thinking');
          const isToolCallMessage = el.classList.contains('tool-call-message');
          const isToolResultMessage = el.classList.contains('tool-result-message');

          // Check type filter
          let typeVisible = true;
          if (isToolCallMessage) {
            typeVisible = filters['tool-call'];
          } else if (isToolResultMessage) {
            typeVisible = filters['tool-result'];
          } else if (isThinking) {
            typeVisible = filters.thinking;
          } else if (isHarness) {
            typeVisible = filters.harness;
          } else if (isUser) {
            typeVisible = filters.user;
          } else if (isAssistant) {
            typeVisible = filters.assistant;
          }

          // Check search filter
          let searchVisible = true;
          if (term) {
            const text = el.textContent.toLowerCase();
            searchVisible = text.includes(term);
          }

          el.classList.toggle('hidden', !typeVisible || !searchVisible);
        });

        // Filter tool calls and results within visible messages
        document.querySelectorAll('.tool-call').forEach(function(el) {
          const container = el.closest('.message');
          const isTopLevelToolMessage = container && (container.classList.contains('tool-call-message') || container.classList.contains('tool-result-message'));
          if (isTopLevelToolMessage) return;
          el.classList.toggle('hidden', !filters['tool-call']);
        });

        document.querySelectorAll('.tool-result-container').forEach(function(el) {
          const container = el.closest('.message');
          const isTopLevelToolMessage = container && (container.classList.contains('tool-call-message') || container.classList.contains('tool-result-message'));
          if (isTopLevelToolMessage) return;
          el.classList.toggle('hidden', !filters['tool-result']);
        });
      }

      document.querySelectorAll('.filter-toggle[data-filter]').forEach(function(toggle) {
        toggle.addEventListener('click', function(e) {
          e.preventDefault();
          var filterType = this.getAttribute('data-filter');
          filters[filterType] = !filters[filterType];
          this.classList.toggle('active', filters[filterType]);
          applyFilters();
        });
      });

      function applyMarkdownMode() {
        document.querySelectorAll('.message-text').forEach(function(container) {
          var markdownView = container.querySelector('.markdown-view');
          var plainView = container.querySelector('.plain-view');
          if (!markdownView || !plainView) return;

          if (markdownEnabled) {
            markdownView.style.display = 'block';
            plainView.style.display = 'none';
          } else {
            markdownView.style.display = 'none';
            plainView.style.display = 'block';
          }
        });
      }

      var markdownToggle = document.getElementById('markdown-toggle');
      if (markdownToggle) {
        markdownToggle.addEventListener('click', function(e) {
          e.preventDefault();
          markdownEnabled = !markdownEnabled;
          markdownToggle.classList.toggle('active', markdownEnabled);
          applyMarkdownMode();
        });
      }

      // Search input
      searchInput.addEventListener('input', function() {
        searchTerm = this.value;
        searchBox.classList.toggle('has-value', searchTerm.length > 0);
        applyFilters();
      });

      searchClear.addEventListener('click', function() {
        searchInput.value = '';
        searchTerm = '';
        searchBox.classList.remove('has-value');
        applyFilters();
        searchInput.focus();
      });

      // Escape key clears search
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && searchTerm) {
          searchInput.value = '';
          searchTerm = '';
          searchBox.classList.remove('has-value');
          applyFilters();
        }
      });

      // Update sticky state on scroll
      window.addEventListener('scroll', updateStickyState);

      // Scroll buttons
      document.getElementById('scroll-top').addEventListener('click', function() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      document.getElementById('scroll-bottom').addEventListener('click', function() {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      });

      // Tool expand/collapse
      function setupExpandToggles() {
        document.querySelectorAll('.tool-expand-toggle').forEach(function(btn) {
          var container = btn.closest('.tool-call, .tool-result-container');
          if (!container) return;

          var content = container.querySelector('.tool-input, .tool-result');
          if (!content) {
            btn.style.display = 'none';
            return;
          }

          // Only show expand button when content actually overflows
          var needsExpand = content.scrollHeight > content.clientHeight + 1;
          if (!needsExpand) {
            btn.style.display = 'none';
            return;
          }

          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var expanded = container.classList.toggle('expanded');
            btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');

            var icon = btn.querySelector('i');
            var label = btn.querySelector('.tool-expand-label');
            if (icon) {
              icon.classList.toggle('bi-chevron-down', !expanded);
              icon.classList.toggle('bi-chevron-up', expanded);
            }
            if (label) {
              label.textContent = expanded ? 'Collapse' : 'Expand';
            }
          });
        });
      }

      if (document.readyState === 'complete') {
        setupExpandToggles();
        updateStickyState();
      } else {
        window.addEventListener('load', function() {
          setupExpandToggles();
          updateStickyState();
        });
      }

      applyMarkdownMode();
    })();
  </script>
</body>
</html>`;
}
