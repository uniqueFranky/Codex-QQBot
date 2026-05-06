export type CodexEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "turn.completed"; usage?: unknown }
  | { type: "turn.failed"; error?: { message?: string } }
  | { type: "error"; message?: string }
  | CodexItemEvent
  | { type: string; [key: string]: unknown };

export interface CodexItemEvent {
  type: "item.started" | "item.updated" | "item.completed";
  item?: CodexItem;
}

export interface CodexItem {
  type?: string;
  text?: string;
  message?: string;
  command?: string | string[];
  path?: string;
  files?: string[];
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export function parseCodexLine(line: string): CodexEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return undefined;
  try {
    return JSON.parse(trimmed) as CodexEvent;
  } catch {
    return undefined;
  }
}

export function itemText(item: CodexItem | undefined): string {
  if (!item) return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.message === "string") return item.message;
  return "";
}

export function describeStatus(event: CodexEvent): string | undefined {
  if (!isItemEvent(event)) return undefined;
  if (event.type !== "item.started" && event.type !== "item.updated") return undefined;
  const item = event.item;
  if (!item?.type) return undefined;

  if (item.type === "command_execution") {
    const command = Array.isArray(item.command) ? item.command.join(" ") : item.command;
    return command ? `正在运行：${command}` : "正在运行命令";
  }

  if (item.type === "file_change") {
    if (item.path) return `正在修改：${item.path}`;
    if (Array.isArray(item.files) && item.files.length > 0) {
      return `正在修改：${item.files.slice(0, 3).join(", ")}`;
    }
    return "正在修改文件";
  }

  if (item.type === "mcp_tool_call") {
    return item.name ? `正在调用工具：${item.name}` : "正在调用工具";
  }

  if (item.type === "web_search") {
    return "正在联网搜索";
  }

  return undefined;
}

export function isItemEvent(event: CodexEvent): event is CodexItemEvent {
  return (
    event.type === "item.started" ||
    event.type === "item.updated" ||
    event.type === "item.completed"
  );
}
