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
      await this.messages.sendText(
        message,
        this.codex.isRunning()
          ? `正在运行。threadId: ${state.threadId ?? "未建立"}`
          : `空闲。threadId: ${state.threadId ?? "未建立"}`
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
          this.stateStore.patch({
            threadId,
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
        this.stateStore.patch({
          threadId: result.threadId,
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
