import type { StateStore } from "../state.js";
import type { QQMessages } from "../qq/messages.js";
import type { QQPrivateMessage } from "../qq/gateway.js";
import type { CodexRunner } from "../codex/runner.js";
import type { Config } from "../config.js";
import type { MemoryTool } from "../memory-tool.js";
import { findNewOutputImages, saveInputImages } from "./images.js";

export class BotController {
  private lastStatusAt = 0;
  private lastStatus = "";
  private runId = 0;

  constructor(
    private readonly config: Config,
    private readonly stateStore: StateStore,
    private readonly memoryTool: MemoryTool,
    private readonly messages: QQMessages,
    private readonly codex: CodexRunner
  ) {}

  async handlePrivateMessage(message: QQPrivateMessage): Promise<void> {
    this.stateStore.patch({ lastOpenid: message.openid });

    const text = message.content.trim();
    const hasImages = message.attachments.some((attachment) =>
      attachment.contentType.startsWith("image/")
    );
    if (!text && !hasImages) return;

    if (text === "/new") {
      this.codex.stop();
      this.stateStore.resetThread();
      await this.messages.sendText(
        message,
        "已重置 Codex 会话。下次任务会把当前 memory 作为一次性系统提示传入。workspace 文件未清空。"
      );
      return;
    }

    if (text === "/stop") {
      if (this.codex.isRunning()) {
        this.codex.stop();
        await this.messages.sendText(message, "已中止当前任务。");
      } else {
        await this.messages.sendText(message, "当前没有正在运行的任务。");
      }
      return;
    }

    if (text === "/status") {
      const state = this.stateStore.load();
      const session = state.currentSessionName ? `，session: ${state.currentSessionName}` : "";
      await this.messages.sendText(
        message,
        this.codex.isRunning()
          ? `正在运行。threadId: ${state.threadId ?? "未建立"}${session}`
          : `空闲。threadId: ${state.threadId ?? "未建立"}${session}`
      );
      return;
    }

    if (text === "/run" || text.startsWith("/run ")) {
      await this.handleRunCommand(message, text);
      return;
    }

    if (text === "/memory" || text.startsWith("/memory ")) {
      await this.handleMemoryCommand(message, text);
      return;
    }

    if (text === "/session" || text.startsWith("/session ")) {
      await this.handleSessionCommand(message, text);
      return;
    }

    await this.startCodexTask(message, text || "请分析这张图片。");
  }

  private async handleRunCommand(message: QQPrivateMessage, text: string): Promise<void> {
    const command = text.slice("/run".length).trim();
    if (!command) {
      await this.messages.sendText(message, "用法：/run <bash命令>，例如 /run ./gradlew assembleDebug");
      return;
    }

    await this.startCodexTask(
      message,
      [
        "请运行下面这条 bash 命令，并把关键输出、退出状态和需要注意的问题简洁汇报给用户。",
        "不要改写命令含义；如果命令失败，请根据输出做简短诊断。",
        "",
        "```bash",
        command,
        "```"
      ].join("\n")
    );
  }

  private async handleMemoryCommand(message: QQPrivateMessage, text: string): Promise<void> {
    const rest = text.slice("/memory".length).trim();
    if (!rest || rest === "show") {
      const memory = this.memoryTool.load();
      await this.messages.sendMarkdown(
        message,
        memory
          ? `当前记忆：\n\n${memory}`
          : [
              "当前没有记忆。",
              "",
              "用法：",
              "/memory set <key> <value>",
              "/memory get <key>",
              "/memory del <key>",
              "/memory clear"
            ].join("\n")
      );
      return;
    }

    if (rest === "clear") {
      this.memoryTool.clear();
      await this.messages.sendText(message, "已清空容器内 Codex 记忆。");
      return;
    }

    if (rest.startsWith("get ")) {
      const key = rest.slice(4).trim();
      const entry = this.memoryTool.get(key);
      await this.messages.sendMarkdown(
        message,
        entry ? `${entry.key}: ${entry.value}` : `没有找到记忆：${key}`
      );
      return;
    }

    if (rest.startsWith("set ")) {
      await this.setMemoryEntry(message, rest.slice(4));
      return;
    }

    if (rest.startsWith("add ")) {
      await this.setMemoryEntry(message, rest.slice(4));
      return;
    }

    if (rest.startsWith("del ") || rest.startsWith("delete ") || rest.startsWith("remove ")) {
      const key = rest.replace(/^(del|delete|remove)\s+/, "").trim();
      const deleted = this.memoryTool.delete(key);
      await this.messages.sendText(
        message,
        deleted ? `已删除记忆：${key}` : `没有找到记忆：${key}`
      );
      return;
    }

    await this.messages.sendText(
      message,
      "未知 /memory 命令。用法：/memory、/memory set <key> <value>、/memory get <key>、/memory del <key>、/memory clear"
    );
  }

  private async setMemoryEntry(message: QQPrivateMessage, input: string): Promise<void> {
    const parsed = parseMemorySetInput(input);
    if (!parsed) {
      await this.messages.sendText(
        message,
        "格式错误。用法：/memory set <key> <value>，也支持 /memory set <key>=<value>"
      );
      return;
    }

    try {
      const result = this.memoryTool.set(parsed.key, parsed.value);
      const memory = this.memoryTool.format(result.entries);
      const warning = result.warning ? `\n\n注意：${result.warning}` : "";
      await this.messages.sendMarkdown(
        message,
        `已设置记忆：${result.key}\n\n当前记忆：\n\n${memory}${warning}`
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.messages.sendText(message, `设置记忆失败：${detail}`);
    }
  }

  private async handleSessionCommand(message: QQPrivateMessage, text: string): Promise<void> {
    const rest = text.slice("/session".length).trim();
    if (!rest || rest === "list" || rest === "show") {
      await this.showSessions(message);
      return;
    }

    if (rest.startsWith("name ")) {
      await this.nameCurrentSession(message, rest.slice(5));
      return;
    }

    if (rest.startsWith("new ")) {
      await this.createNamedSession(message, rest.slice(4));
      return;
    }

    if (rest.startsWith("resume ")) {
      await this.resumeNamedSession(message, rest.slice(7));
      return;
    }

    if (rest.startsWith("rm ") || rest.startsWith("delete ") || rest.startsWith("remove ")) {
      const name = rest.replace(/^(rm|delete|remove)\s+/, "").trim();
      await this.removeNamedSession(message, name);
      return;
    }

    await this.messages.sendText(message, sessionUsage());
  }

  private async showSessions(message: QQPrivateMessage): Promise<void> {
    const state = this.stateStore.load();
    const sessions = state.sessions ?? {};
    const names = Object.keys(sessions).sort();
    const current = state.currentSessionName ?? "(未命名)";

    if (names.length === 0) {
      await this.messages.sendText(
        message,
        `当前 session: ${current}\n还没有命名 session。\n${sessionUsage()}`
      );
      return;
    }

    const lines = names.map((name) => {
      const marker = name === state.currentSessionName ? "* " : "- ";
      const thread = sessions[name]?.threadId ?? "未建立";
      return `${marker}${name}: ${thread}`;
    });
    await this.messages.sendMarkdown(
      message,
      [`当前 session: ${current}`, "", "命名 session:", ...lines].join("\n")
    );
  }

  private async nameCurrentSession(message: QQPrivateMessage, rawName: string): Promise<void> {
    const parsed = parseSessionName(rawName);
    if (!parsed.ok) {
      await this.messages.sendText(message, parsed.error);
      return;
    }

    const state = this.stateStore.load();
    if (!state.threadId) {
      await this.messages.sendText(message, "当前还没有 Codex thread。请先发送一条普通消息建立会话。");
      return;
    }

    const now = new Date().toISOString();
    const sessions = { ...(state.sessions ?? {}) };
    sessions[parsed.name] = {
      threadId: state.threadId,
      createdAt: sessions[parsed.name]?.createdAt ?? now,
      updatedAt: now
    };
    this.stateStore.patch({ sessions, currentSessionName: parsed.name });
    await this.messages.sendText(message, `已将当前 session 命名为：${parsed.name}`);
  }

  private async createNamedSession(message: QQPrivateMessage, input: string): Promise<void> {
    const { name, discard } = parseSessionNameAndFlags(input);
    const parsed = parseSessionName(name);
    if (!parsed.ok) {
      await this.messages.sendText(message, parsed.error);
      return;
    }

    const state = this.stateStore.load();
    if (hasUnnamedActiveSession(state) && !discard) {
      await this.messages.sendText(
        message,
        [
          "当前 session 已有 thread 但未命名。",
          `请先用 /session name <名字> 保存它，或用 /session new ${parsed.name} --discard 丢弃当前未命名 session。`
        ].join("\n")
      );
      return;
    }

    if (state.sessions?.[parsed.name]) {
      await this.messages.sendText(message, `命名 session 已存在：${parsed.name}`);
      return;
    }

    this.codex.stop();
    const now = new Date().toISOString();
    const sessions = { ...(state.sessions ?? {}) };
    sessions[parsed.name] = { createdAt: now, updatedAt: now };
    this.stateStore.patch({
      threadId: undefined,
      currentSessionName: parsed.name,
      sessions,
      injectMemoryOnNextRun: true
    });
    await this.messages.sendText(
      message,
      `已创建新 session：${parsed.name}。下一条普通消息会建立新的 Codex thread。`
    );
  }

  private async resumeNamedSession(message: QQPrivateMessage, input: string): Promise<void> {
    const { name, discard } = parseSessionNameAndFlags(input);
    const parsed = parseSessionName(name);
    if (!parsed.ok) {
      await this.messages.sendText(message, parsed.error);
      return;
    }

    const state = this.stateStore.load();
    if (hasUnnamedActiveSession(state) && !discard) {
      await this.messages.sendText(
        message,
        [
          "当前 session 已有 thread 但未命名。",
          `请先用 /session name <名字> 保存它，或用 /session resume ${parsed.name} --discard 丢弃当前未命名 session。`
        ].join("\n")
      );
      return;
    }

    const session = state.sessions?.[parsed.name];
    if (!session) {
      await this.messages.sendText(message, `没有找到命名 session：${parsed.name}`);
      return;
    }

    this.codex.stop();
    this.stateStore.patch({
      threadId: session.threadId,
      currentSessionName: parsed.name,
      injectMemoryOnNextRun: !session.threadId
    });
    await this.messages.sendText(
      message,
      session.threadId
        ? `已恢复 session：${parsed.name}`
        : `已恢复 session：${parsed.name}。它还没有 thread，下一条普通消息会建立新的 Codex thread。`
    );
  }

  private async removeNamedSession(message: QQPrivateMessage, name: string): Promise<void> {
    const parsed = parseSessionName(name);
    if (!parsed.ok) {
      await this.messages.sendText(message, parsed.error);
      return;
    }

    const state = this.stateStore.load();
    const sessions = { ...(state.sessions ?? {}) };
    if (!sessions[parsed.name]) {
      await this.messages.sendText(message, `没有找到命名 session：${parsed.name}`);
      return;
    }

    delete sessions[parsed.name];
    this.stateStore.patch({
      sessions,
      currentSessionName:
        state.currentSessionName === parsed.name ? undefined : state.currentSessionName
    });
    await this.messages.sendText(
      message,
      `已删除 session 名称：${parsed.name}。实际 Codex session 记录未删除。`
    );
  }

  private async startCodexTask(message: QQPrivateMessage, text: string): Promise<void> {
    const currentRun = ++this.runId;
    if (this.codex.isRunning()) {
      this.codex.stop();
      await this.messages.sendText(message, "已中止上一任务，开始处理新消息。");
    } else if (this.config.receivedMessage) {
      await this.messages.sendText(message, this.config.receivedMessage);
    }

    const state = this.stateStore.load();
    const memory = state.injectMemoryOnNextRun && !state.threadId ? this.memoryTool.load() : "";
    const memoryDiff =
      state.injectMemoryOnNextRun && !state.threadId ? state.pendingMemoryDiff?.trim() ?? "" : "";
    const startedAtMs = Date.now();
    const imagePaths = await saveInputImages(this.config, message.attachments, message.id);
    if (imagePaths.length > 0) {
      await this.messages.sendText(message, `已收到 ${imagePaths.length} 张图片，正在交给 Codex。`);
    }
    let buffered = "";
    let flushTimer: NodeJS.Timeout | undefined;

    const flush = async (): Promise<void> => {
      if (!buffered.trim() || currentRun !== this.runId) return;
      const textToSend = buffered;
      buffered = "";
      await this.messages.sendMarkdown(message, textToSend);
    };

    const scheduleFlush = (): void => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        void flush().catch((error) => console.error("flush message failed", error));
      }, 1200);
    };

    try {
      const result = await this.codex.run({
        prompt: text,
        threadId: state.threadId,
        imagePaths,
        systemPrompt: buildMemorySystemPrompt(memory, memoryDiff),
        onThreadStarted: (threadId) => {
          const currentState = this.stateStore.load();
          this.stateStore.patch({
            threadId,
            sessions: updateCurrentNamedSession(currentState, threadId),
            injectMemoryOnNextRun: false,
            pendingMemoryDiff: undefined
          });
        },
        onStatus: async (status) => {
          if (currentRun !== this.runId) return;
          if (!this.shouldSendStatus(status)) return;
          await this.messages.sendText(message, status);
        },
        onMessageDelta: (delta) => {
          if (currentRun !== this.runId) return;
          buffered += delta;
          if (buffered.length >= this.config.replyChunkSize) {
            void flush().catch((error) => console.error("flush message failed", error));
            return;
          }
          scheduleFlush();
        }
      });

      if (flushTimer) clearTimeout(flushTimer);
      if (currentRun !== this.runId) return;
      await flush();

      if (result.threadId) {
        const currentState = this.stateStore.load();
        this.stateStore.patch({
          threadId: result.threadId,
          sessions: updateCurrentNamedSession(currentState, result.threadId),
          injectMemoryOnNextRun: false,
          pendingMemoryDiff: undefined
        });
      }
      if (result.timedOut) {
        await this.messages.sendText(message, "Codex 执行超时，已中止当前任务。");
        return;
      }
      if (result.interrupted) return;
      if (!result.finalText.trim()) {
        await this.messages.sendText(message, "Codex 已结束，但没有返回文本结果。");
      }
      await this.sendOutputImages(message, startedAtMs);
    } catch (error) {
      if (flushTimer) clearTimeout(flushTimer);
      if (currentRun !== this.runId) return;
      const detail = error instanceof Error ? error.message : String(error);
      await this.messages.sendText(message, `Codex 执行失败：${detail}`);
    }
  }

  private shouldSendStatus(status: string): boolean {
    const now = Date.now();
    if (status === this.lastStatus) return false;
    if (now - this.lastStatusAt < this.config.statusThrottleMs) return false;
    this.lastStatus = status;
    this.lastStatusAt = now;
    return true;
  }

  private async sendOutputImages(message: QQPrivateMessage, startedAtMs: number): Promise<void> {
    const imagePaths = await findNewOutputImages(this.config, startedAtMs);
    if (imagePaths.length === 0) return;

    await this.messages.sendText(message, `检测到 ${imagePaths.length} 张输出图片，正在发送。`);
    for (const imagePath of imagePaths) {
      try {
        await this.messages.sendImage(message, imagePath);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await this.messages.sendText(message, `图片发送失败：${detail}`);
      }
    }
  }
}

function parseMemorySetInput(input: string): { key: string; value: string } | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex > 0) {
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    return key && value ? { key, value } : undefined;
  }

  const match = trimmed.match(/^(\S+)\s+([\s\S]+)$/);
  if (!match) return undefined;
  return { key: match[1], value: match[2].trim() };
}

function buildMemorySystemPrompt(memory: string, memoryDiff: string): string | undefined {
  const parts: string[] = [];
  if (memory) parts.push(`以下是当前用户记忆：\n${memory}`);
  if (memoryDiff) parts.push(`以下是上次注入后发生的记忆变更 diff：\n${memoryDiff}`);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

interface SessionNameResult {
  ok: true;
  name: string;
}

interface SessionNameError {
  ok: false;
  error: string;
}

function parseSessionName(input: string): SessionNameResult | SessionNameError {
  const name = input.trim();
  if (!name) return { ok: false, error: "缺少 session 名称。" };
  if (/\s/.test(name)) return { ok: false, error: "session 名称不能包含空白字符。" };
  if (name.length > 80) return { ok: false, error: "session 名称太长，最多 80 个字符。" };
  return { ok: true, name };
}

function parseSessionNameAndFlags(input: string): { name: string; discard: boolean } {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  const discard = parts.includes("--discard");
  return { name: parts.filter((part) => part !== "--discard").join(" "), discard };
}

function hasUnnamedActiveSession(state: { threadId?: string; currentSessionName?: string }): boolean {
  return Boolean(state.threadId && !state.currentSessionName);
}

function updateCurrentNamedSession(
  state: { currentSessionName?: string; sessions?: Record<string, { createdAt: string; updatedAt: string; threadId?: string }> },
  threadId: string
): Record<string, { createdAt: string; updatedAt: string; threadId?: string }> | undefined {
  const name = state.currentSessionName;
  if (!name) return state.sessions;

  const now = new Date().toISOString();
  const sessions = { ...(state.sessions ?? {}) };
  sessions[name] = {
    threadId,
    createdAt: sessions[name]?.createdAt ?? now,
    updatedAt: now
  };
  return sessions;
}

function sessionUsage(): string {
  return [
    "用法：",
    "/session list",
    "/session name <名字>",
    "/session new <名字>",
    "/session resume <名字>",
    "/session rm <名字>",
    "切换时若当前 session 未命名，可追加 --discard 明确丢弃。"
  ].join("\n");
}
