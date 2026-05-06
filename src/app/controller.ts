import type { StateStore } from "../state.js";
import type { QQMessages } from "../qq/messages.js";
import type { QQPrivateMessage } from "../qq/gateway.js";
import type { CodexRunner } from "../codex/runner.js";
import type { Config } from "../config.js";
import { findNewOutputImages, saveInputImages } from "./images.js";

export class BotController {
  private lastStatusAt = 0;
  private lastStatus = "";
  private runId = 0;

  constructor(
    private readonly config: Config,
    private readonly stateStore: StateStore,
    private readonly messages: QQMessages,
    private readonly codex: CodexRunner
  ) {}

  async handlePrivateMessage(message: QQPrivateMessage): Promise<void> {
    const text = message.content.trim();
    const hasImages = message.attachments.some((attachment) =>
      attachment.contentType.startsWith("image/")
    );
    if (!text && !hasImages) return;

    if (text === "/new") {
      this.codex.stop();
      this.stateStore.resetThread();
      await this.messages.sendText(message, "已重置 Codex 会话。workspace 文件未清空。");
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

    await this.startCodexTask(message, text || "请分析这张图片。");
  }

  private async startCodexTask(message: QQPrivateMessage, text: string): Promise<void> {
    const currentRun = ++this.runId;
    if (this.codex.isRunning()) {
      this.codex.stop();
      await this.messages.sendText(message, "已中止上一任务，开始处理新消息。");
    } else {
      await this.messages.sendText(message, "已收到，Codex 正在处理。");
    }

    const state = this.stateStore.load();
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
        onThreadStarted: (threadId) => {
          this.stateStore.patch({ threadId });
        },
        onStatus: async (status) => {
          if (!this.shouldSendStatus(status)) return;
          await this.messages.sendText(message, status);
        },
        onMessageDelta: (delta) => {
          buffered += delta;
          if (buffered.length >= this.config.replyChunkSize) {
            void flush().catch((error) => console.error("flush message failed", error));
            return;
          }
          scheduleFlush();
        }
      });

      if (flushTimer) clearTimeout(flushTimer);
      await flush();

      if (result.threadId) this.stateStore.patch({ threadId: result.threadId });
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
