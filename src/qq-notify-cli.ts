#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { StateStore } from "./state.js";
import { QQAuth } from "./qq/auth.js";
import { QQMessages } from "./qq/messages.js";
import { configureGlobalProxy } from "./proxy.js";

async function main(): Promise<void> {
  loadRuntimeEnv();
  configureGlobalProxy();

  const { format, message } = parseArgs(process.argv.slice(2));
  if (!message) {
    usage("Missing notification message.");
  }

  const config = loadConfig();
  const stateStore = new StateStore(config.stateFile);
  const state = stateStore.load();
  const openid = process.env.QQ_NOTIFY_OPENID?.trim() || state.lastOpenid;
  if (!openid) {
    usage("Missing target openid. Send a QQ private message to the bot first, or set QQ_NOTIFY_OPENID.");
  }

  const auth = new QQAuth(config);
  const messages = new QQMessages(config, auth);
  if (format === "markdown") {
    await messages.sendMarkdown({ openid }, message);
  } else {
    await messages.sendText({ openid }, message);
  }
  console.log("sent");
}

function loadRuntimeEnv(): void {
  const filePath = process.env.QQBOT_RUNTIME_ENV_FILE || "/data/qqbot.env";
  try {
    const content = readFileSync(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index <= 0) continue;
      const key = line.slice(0, index).trim();
      const value = parseEnvValue(line.slice(index + 1).trim());
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    return;
  }
}

function parseEnvValue(value: string): string {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

type NotifyFormat = "text" | "markdown";

interface NotifyArgs {
  format: NotifyFormat;
  message: string;
}

function parseArgs(args: string[]): NotifyArgs {
  let format = parseFormat(process.env.QQ_NOTIFY_FORMAT) ?? "text";
  const messageParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--text" || arg === "--plain-text") {
      format = "text";
      continue;
    }
    if (arg === "--markdown") {
      format = "markdown";
      continue;
    }
    if (arg === "--format") {
      const next = args[index + 1];
      if (!next) usage("Missing value for --format.");
      const parsed = parseFormat(next);
      if (!parsed) usage("Invalid --format. Expected text or markdown.");
      format = parsed;
      index += 1;
      continue;
    }
    if (arg.startsWith("--format=")) {
      const parsed = parseFormat(arg.slice("--format=".length));
      if (!parsed) usage("Invalid --format. Expected text or markdown.");
      format = parsed;
      continue;
    }
    messageParts.push(arg);
  }

  return { format, message: messageParts.join(" ").trim() };
}

function parseFormat(value: string | undefined): NotifyFormat | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["text", "plain", "plain-text", "plaintext"].includes(normalized)) return "text";
  if (["markdown", "md"].includes(normalized)) return "markdown";
  return undefined;
}

function usage(message: string): never {
  console.error(message);
  console.error("Usage: qq-notify [--text|--markdown|--format text|markdown] <message>");
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
