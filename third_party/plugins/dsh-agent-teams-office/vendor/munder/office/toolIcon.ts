// Tool icon mapping retained from Munder ToolBubble (MIT / upstream port attribution).
const TOOL_ICONS: Record<string, string> = {
  Read: '<',
  Edit: '>',
  Write: '>',
  Bash: '$',
  Grep: '?',
  Glob: '?',
  WebFetch: '@',
  WebSearch: '@',
  TodoWrite: '=',
  MCP: '*',
};

export function toolIcon(toolName: string): string { return TOOL_ICONS[toolName] ?? '*'; }
