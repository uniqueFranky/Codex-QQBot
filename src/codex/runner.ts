import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { Config } from "../config.js";
import { describeStatus, isItemEvent, itemText, parseCodexLine } from "./events.js";

export interface CodexRunOptions {
  prompt: string;
  threadId?: string;
  imagePaths?: string[];
  systemPrompt?: string;
  onThreadStarted?: (threadId: string) => void;
  onStatus?: (status: string) => void | Promise<void>;
  onMessageDelta?: (text: string) => void | Promise<void>;
}

export interface CodexRunResult {
  threadId?: string;
  finalText: string;
  interrupted: boolean;
  timedOut: boolean;
}

interface ActiveRun {
  child: ChildProcess;
  interrupted: boolean;
  timedOut: boolean;
  closed: boolean;
}

const WORKSPACE_RULES = `你正在通过 QQ 与用户交互。
当前工作目录是 workspace。允许读取外部信息和联网搜索。
项目相关的创建、修改、删除、安装依赖产生的写入、缓存写入、生成文件都应发生在当前 workspace 内。
如果运行在 Docker 中，容器内 Codex 与宿主机 Codex 是分离的；不要假设能访问宿主机未挂载目录。
如果任务需要修改 workspace 外的宿主机文件，只说明需要用户手动执行。
状态说明保持简短，最终回答适合在 QQ 中阅读。`;

export class CodexRunner {
  private activeRun?: ActiveRun;

  constructor(private readonly config: Config) {}

  isRunning(): boolean {
    return Boolean(this.activeRun && !this.activeRun.closed);
  }

  stop(): void {
    const run = this.activeRun;
    if (!run || run.closed) return;
    run.interrupted = true;
    run.child.kill("SIGTERM");
    setTimeout(() => {
      if (!run.closed) run.child.kill("SIGKILL");
    }, 2000);
  }

  async run(options: CodexRunOptions): Promise<CodexRunResult> {
    if (this.activeRun && !this.activeRun.closed) this.stop();

    const logFile = path.join(this.config.logsDir, `codex-${Date.now()}.jsonl`);
    const logStream = createWriteStream(logFile, { flags: "a" });
    const args = this.buildArgs(
      options.prompt,
      options.threadId,
      options.imagePaths ?? [],
      options.systemPrompt
    );

    const child = spawn("codex", args, {
      cwd: this.config.workspaceDir,
      env: {
        ...process.env,
        ...(this.config.codexHome ? { CODEX_HOME: this.config.codexHome } : {})
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const run: ActiveRun = {
      child,
      interrupted: false,
      timedOut: false,
      closed: false
    };
    this.activeRun = run;

    let threadId = options.threadId;
    let finalText = "";
    let lastAgentText = "";

    const timeout = setTimeout(() => {
      run.interrupted = true;
      run.timedOut = true;
      child.kill("SIGTERM");
    }, this.config.codexTimeoutMs);

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      logStream.write(`${line}\n`);
      const event = parseCodexLine(line);
      if (!event) return;

      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        threadId = event.thread_id;
        options.onThreadStarted?.(event.thread_id);
        return;
      }

      const status = describeStatus(event);
      if (status) void options.onStatus?.(status);

      if (
        isItemEvent(event) &&
        (event.type === "item.completed" || event.type === "item.updated") &&
        event.item?.type === "agent_message"
      ) {
        const text = itemText(event.item);
        if (text && text !== lastAgentText) {
          const delta = text.startsWith(lastAgentText)
            ? text.slice(lastAgentText.length)
            : text;
          lastAgentText = text;
          finalText = text;
          if (delta.trim()) void options.onMessageDelta?.(delta);
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      logStream.write(chunk.toString());
    });

    try {
      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("close", resolve);
      });
      clearTimeout(timeout);
      stdout.close();
      logStream.end();
      run.closed = true;
      if (this.activeRun === run) this.activeRun = undefined;

      if (run.interrupted) {
        return { threadId, finalText, interrupted: true, timedOut: run.timedOut };
      }
      if (exitCode !== 0) {
        throw new Error(`Codex exited with code ${exitCode}. Log: ${logFile}`);
      }
      return { threadId, finalText, interrupted: false, timedOut: false };
    } catch (error) {
      clearTimeout(timeout);
      run.closed = true;
      if (this.activeRun === run) this.activeRun = undefined;
      logStream.end();
      throw error;
    }
  }

  private buildArgs(
    prompt: string,
    threadId?: string,
    imagePaths: string[] = [],
    systemPrompt = ""
  ): string[] {
    const base = ["-C", this.config.workspaceDir];

    if (this.config.codexModel) {
      base.push("-m", this.config.codexModel);
    }

    if (this.config.codexEnableSearch) {
      base.push("--search");
    }

    if (this.config.codexSandboxMode === "danger-full-access") {
      base.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      base.unshift("-a", "never");
      base.push("-s", "workspace-write");
    }

    base.push("exec");

    const systemPromptBlock = systemPrompt.trim()
      ? `\n\n本轮新会话的一次性系统提示：\n${systemPrompt.trim()}`
      : "";
    const fullPrompt = `${WORKSPACE_RULES}${systemPromptBlock}\n\n用户消息：\n${prompt}`;

    if (threadId) {
      return [
        ...base,
        "resume",
        ...imageArgs(imagePaths),
        "--skip-git-repo-check",
        "--json",
        threadId,
        fullPrompt
      ];
    }

    return [...base, "--skip-git-repo-check", "--json", ...imageArgs(imagePaths), fullPrompt];
  }
}

function imageArgs(imagePaths: string[]): string[] {
  return imagePaths.flatMap((imagePath) => ["--image", imagePath]);
}
