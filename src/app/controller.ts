import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StateStore } from "../state.js";
import type { QQMessages } from "../qq/messages.js";
import type { QQPrivateMessage } from "../qq/gateway.js";
import type { CodexRunner } from "../codex/runner.js";
import type { Config } from "../config.js";
import type { MemoryTool } from "../memory-tool.js";
import { findNewOutputImages, saveInputImages } from "./images.js";
import {
  buildInputFilesPrompt,
  formatFileList,
  listReceivedFiles,
  resolveWorkspaceFile,
  saveInputFiles
} from "./files.js";

const execFileAsync = promisify(execFile);

export class BotController {
  private lastStatusAt = 0;
  private lastStatus = "";
  private runId = 0;
  private processingQueue = false;

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
    if (!text && message.attachments.length === 0) return;

    if (text === "/new") {
      this.codex.stop();
      this.stateStore.resetThread();
      await this.messages.sendText(
        message,
        "已重置 Codex 会话。下次任务会把当前 memory 作为一次性系统提示传入。workspace 文件未清空。"
      );
      return;
    }

    if (text === "/stop" || text.startsWith("/stop ")) {
      const pid = text.slice("/stop".length).trim();
      if (pid) {
        await this.handleStopProcessCommand(message, pid);
        return;
      }

      if (this.codex.isRunning()) {
        this.codex.stop();
        await this.messages.sendText(message, "已中止当前任务。");
      } else {
        await this.messages.sendText(message, "当前没有正在运行的任务。");
      }
      return;
    }

    if (text === "/ps") {
      await this.handlePsCommand(message);
      return;
    }

    if (text === "/status") {
      const state = this.stateStore.load();
      const session = state.currentSessionName ? `，session: ${state.currentSessionName}` : "";
      const model = `，model: ${displayModel(state, this.config)}`;
      const queue = `，queue: ${state.messageQueue?.length ?? 0}`;
      await this.messages.sendText(
        message,
        this.codex.isRunning()
          ? `正在运行。threadId: ${state.threadId ?? "未建立"}${session}${model}${queue}`
          : `空闲。threadId: ${state.threadId ?? "未建立"}${session}${model}${queue}`
      );
      return;
    }

    if (text === "/queue" || text.startsWith("/queue ")) {
      await this.handleQueueCommand(message, text);
      return;
    }

    if (text === "/file" || text.startsWith("/file ")) {
      await this.handleFileCommand(message, text);
      return;
    }

    if (text === "/interrupt" || text.startsWith("/interrupt ")) {
      await this.handleInterruptCommand(message, text);
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

    if (text === "/model" || text.startsWith("/model ")) {
      await this.handleModelCommand(message, text);
      return;
    }

    if (this.codex.isRunning()) {
      const savedFiles = await saveInputFiles(this.config, message.attachments);
      const filePrompt = buildInputFilesPrompt(savedFiles);
      if (!text && !filePrompt) {
        await this.messages.sendText(message, "当前 Codex 正在运行。图片消息不能入队，请稍后重发。");
        return;
      }
      const length = this.enqueueMessage(appendFilePrompt(text || "请查看我发送的文件。", filePrompt));
      await this.messages.sendText(message, `当前 Codex 正在运行，已加入队列。队列长度：${length}`);
      return;
    }

    await this.startCodexTask(
      message,
      text || (hasImages ? "请分析这张图片。" : "请查看我发送的文件。")
    );
  }

  private async handleFileCommand(message: QQPrivateMessage, text: string): Promise<void> {
    const rest = text.slice("/file".length).trim();
    if (!rest || rest === "list" || rest === "recent") {
      const files = await listReceivedFiles(this.config);
      await this.messages.sendMarkdown(
        message,
        ["最近接收的文件：", "", "```text", formatFileList(files), "```"].join("\n")
      );
      return;
    }

    if (rest.startsWith("send ")) {
      const inputPath = rest.slice(5).trim();
      if (!inputPath) {
        await this.messages.sendText(message, "用法：/file send <workspace内文件路径>");
        return;
      }

      try {
        const file = await resolveWorkspaceFile(this.config, inputPath);
        await this.messages.sendFile(message, file.path);
        await this.messages.sendText(message, `已发送文件：${file.relativePath}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await this.messages.sendText(message, `发送文件失败：${detail}`);
      }
      return;
    }

    await this.messages.sendText(message, fileUsage());
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

  private async handleQueueCommand(message: QQPrivateMessage, text: string): Promise<void> {
    const rest = text.slice("/queue".length).trim();
    if (!rest || rest === "list") {
      await this.showQueue(message);
      return;
    }

    if (rest.startsWith("add ")) {
      const queuedMessage = rest.slice(4).trim();
      if (!queuedMessage) {
        await this.messages.sendText(message, "用法：/queue add <消息>");
        return;
      }
      const length = this.enqueueMessage(queuedMessage);
      await this.messages.sendText(message, `已加入队列。队列长度：${length}`);
      return;
    }

    if (rest.startsWith("jump ")) {
      const queuedMessage = rest.slice(5).trim();
      if (!queuedMessage) {
        await this.messages.sendText(message, "用法：/queue jump <消息>");
        return;
      }
      const length = this.enqueueMessageAtFront(queuedMessage);
      await this.messages.sendText(message, `已插入队首。队列长度：${length}`);
      return;
    }

    if (rest === "popback") {
      const state = this.stateStore.load();
      const queue = [...(state.messageQueue ?? [])];
      const removed = queue.pop();
      this.stateStore.patch({ messageQueue: queue });
      await this.messages.sendText(
        message,
        removed ? `已删除最后一条队列消息：${removed}` : "队列为空。"
      );
      return;
    }

    if (rest === "clear") {
      this.stateStore.patch({ messageQueue: [] });
      await this.messages.sendText(message, "已清空队列。");
      return;
    }

    await this.messages.sendText(message, queueUsage());
  }

  private async handleInterruptCommand(message: QQPrivateMessage, text: string): Promise<void> {
    const prompt = text.slice("/interrupt".length).trim();
    if (!prompt) {
      await this.messages.sendText(message, "用法：/interrupt <纠偏消息>");
      return;
    }

    if (this.codex.isRunning()) {
      this.codex.stop();
      await this.messages.sendText(message, "已中断当前 Codex 任务，开始处理纠偏消息。");
    }
    await this.startCodexTask(message, prompt);
  }

  private async showQueue(message: QQPrivateMessage): Promise<void> {
    const queue = this.stateStore.load().messageQueue ?? [];
    if (queue.length === 0) {
      await this.messages.sendText(message, `队列为空。\n${queueUsage()}`);
      return;
    }

    const lines = queue.map((queuedMessage, index) => `${index + 1}. ${queuedMessage}`);
    await this.messages.sendMarkdown(message, ["当前队列：", "", ...lines].join("\n"));
  }

  private enqueueMessage(message: string): number {
    const state = this.stateStore.load();
    const queue = [...(state.messageQueue ?? []), message];
    this.stateStore.patch({ messageQueue: queue });
    return queue.length;
  }

  private enqueueMessageAtFront(message: string): number {
    const state = this.stateStore.load();
    const queue = [message, ...(state.messageQueue ?? [])];
    this.stateStore.patch({ messageQueue: queue });
    return queue.length;
  }

  private popQueuedMessage(): string | undefined {
    const state = this.stateStore.load();
    const queue = [...(state.messageQueue ?? [])];
    const next = queue.shift();
    this.stateStore.patch({ messageQueue: queue });
    return next;
  }

  private async processQueue(context: QQPrivateMessage): Promise<void> {
    if (this.processingQueue || this.codex.isRunning()) return;
    this.processingQueue = true;
    try {
      while (!this.codex.isRunning()) {
        const queuedMessage = this.popQueuedMessage();
        if (!queuedMessage) return;
        const remaining = this.stateStore.load().messageQueue?.length ?? 0;
        await this.messages.sendText(context, `开始处理队列消息。剩余：${remaining}`);
        await this.startCodexTask(context, queuedMessage, { drainQueue: false });
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private async handlePsCommand(message: QQPrivateMessage): Promise<void> {
    try {
      const processes = await listProcesses();
      if (processes.length === 0) {
        await this.messages.sendText(message, "没有发现可管理的后台进程。");
        return;
      }

      const lines = processes.slice(0, 20).map((processInfo) =>
        [
          `PID ${processInfo.pid}`,
          `PPID ${processInfo.ppid}`,
          processInfo.stat,
          processInfo.etime,
          truncate(processInfo.args || processInfo.command, 120)
        ].join(" | ")
      );
      const suffix = processes.length > lines.length ? `\n... 还有 ${processes.length - lines.length} 个进程` : "";
      await this.messages.sendMarkdown(
        message,
        ["后台进程：", "", "```text", ...lines, "```", "", "用 /stop <pid> 结束指定进程。"].join(
          "\n"
        ) + suffix
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.messages.sendText(message, `查看进程失败：${detail}`);
    }
  }

  private async handleStopProcessCommand(message: QQPrivateMessage, input: string): Promise<void> {
    const pid = Number(input);
    if (!Number.isInteger(pid) || pid <= 1) {
      await this.messages.sendText(message, "用法：/stop <pid>。不能结束 PID 1。");
      return;
    }

    try {
      process.kill(pid, "SIGTERM");
      await this.messages.sendText(message, `已向 PID ${pid} 发送 SIGTERM。`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.messages.sendText(message, `结束进程失败：${detail}`);
    }
  }

  private async handleModelCommand(message: QQPrivateMessage, text: string): Promise<void> {
    const model = text.slice("/model".length).trim();
    if (!model || model === "show" || model === "current") {
      const state = this.stateStore.load();
      await this.messages.sendText(message, `当前模型：${displayModel(state, this.config)}`);
      return;
    }

    if (model === "reset" || model === "default") {
      this.stateStore.patch({ codexModel: undefined });
      await this.messages.sendText(
        message,
        `已恢复默认模型：${this.config.codexModel ?? "Codex CLI 默认模型"}`
      );
      return;
    }

    if (/\s/.test(model)) {
      await this.messages.sendText(message, "模型名称不能包含空白字符。用法：/model <model>");
      return;
    }

    this.stateStore.patch({ codexModel: model });
    await this.messages.sendText(message, `已切换模型：${model}。下一次 Codex 任务生效。`);
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

  private async startCodexTask(
    message: QQPrivateMessage,
    text: string,
    options: { drainQueue?: boolean } = {}
  ): Promise<void> {
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
    const savedFiles = await saveInputFiles(this.config, message.attachments);
    if (imagePaths.length > 0) {
      await this.messages.sendText(message, `已收到 ${imagePaths.length} 张图片，正在交给 Codex。`);
    }
    if (savedFiles.length > 0) {
      await this.messages.sendMarkdown(
        message,
        [
          `已收到 ${savedFiles.length} 个文件，保存路径：`,
          "",
          "```text",
          ...savedFiles.map((file) => file.path),
          "```"
        ].join("\n")
      );
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
        prompt: appendFilePrompt(text, buildInputFilesPrompt(savedFiles)),
        threadId: state.threadId,
        imagePaths,
        systemPrompt: buildMemorySystemPrompt(memory, memoryDiff),
        model: currentModel(state, this.config),
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
        if (options.drainQueue !== false) await this.processQueue(message);
        return;
      }
      if (result.interrupted) return;
      if (!result.finalText.trim()) {
        await this.messages.sendText(message, "Codex 已结束，但没有返回文本结果。");
      }
      await this.sendOutputImages(message, startedAtMs);
      await this.sendTaskCompletionSummary(message);
      if (options.drainQueue !== false) await this.processQueue(message);
    } catch (error) {
      if (flushTimer) clearTimeout(flushTimer);
      if (currentRun !== this.runId) return;
      const detail = error instanceof Error ? error.message : String(error);
      await this.messages.sendText(message, `Codex 执行失败：${detail}`);
      if (options.drainQueue !== false) await this.processQueue(message);
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

  private async sendTaskCompletionSummary(message: QQPrivateMessage): Promise<void> {
    const queue = this.stateStore.load().messageQueue ?? [];
    if (queue.length === 0) {
      if (this.config.queueEmptyMessage) {
        await this.messages.sendText(message, this.config.queueEmptyMessage);
      }
      return;
    }

    if (this.config.taskCompleteMessage) {
      await this.messages.sendText(message, this.config.taskCompleteMessage);
    }

    const lines = queue.map((queuedMessage, index) => `${index + 1}. ${queuedMessage}`);
    await this.messages.sendMarkdown(
      message,
      ["当前队列：", "", ...lines, "", `下一条将处理：${queue[0]}`].join("\n")
    );
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

function currentModel(state: { codexModel?: string }, config: Config): string | undefined {
  return state.codexModel?.trim() || config.codexModel;
}

function displayModel(state: { codexModel?: string }, config: Config): string {
  return currentModel(state, config) ?? "Codex CLI 默认模型";
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

function queueUsage(): string {
  return [
    "用法：",
    "/queue list",
    "/queue add <消息>",
    "/queue jump <消息>",
    "/queue popback",
    "/queue clear",
    "/interrupt <纠偏消息>"
  ].join("\n");
}

function fileUsage(): string {
  return ["用法：", "/file list", "/file recent", "/file send <workspace内文件路径>"].join(
    "\n"
  );
}

function appendFilePrompt(text: string, filePrompt: string): string {
  const trimmedFilePrompt = filePrompt.trim();
  if (!trimmedFilePrompt) return text;
  const trimmedText = text.trim() || "请查看我发送的文件。";
  return `${trimmedText}\n\n${trimmedFilePrompt}`;
}

interface ProcessInfo {
  pid: number;
  ppid: number;
  stat: string;
  etime: string;
  command: string;
  args: string;
}

async function listProcesses(): Promise<ProcessInfo[]> {
  const { stdout } = await execFileAsync("ps", [
    "-eo",
    "pid=,ppid=,stat=,etime=,comm=,args="
  ]);

  return stdout
    .split(/\r?\n/)
    .map(parseProcessLine)
    .filter((processInfo): processInfo is ProcessInfo => Boolean(processInfo))
    .filter(isManageableProcess)
    .sort((left, right) => left.pid - right.pid);
}

function parseProcessLine(line: string): ProcessInfo | undefined {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+([\s\S]*)$/);
  if (!match) return undefined;
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    stat: match[3],
    etime: match[4],
    command: match[5],
    args: match[6].trim()
  };
}

function isManageableProcess(processInfo: ProcessInfo): boolean {
  if (processInfo.pid <= 1 || processInfo.pid === process.pid) return false;
  if (["ps", "cron"].includes(processInfo.command)) return false;
  if (processInfo.args.includes("/app/dist/index.js")) return false;
  return true;
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}
