#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { configureGlobalProxy } from "./proxy.js";
import { StateStore } from "./state.js";
import { formatFileList, listReceivedFiles, resolveWorkspaceFile } from "./app/files.js";
import { QQAuth } from "./qq/auth.js";
import { QQMessages } from "./qq/messages.js";

async function main(): Promise<void> {
  loadRuntimeEnv();
  configureGlobalProxy();

  const [command = "list", ...args] = process.argv.slice(2);
  const config = loadConfig();

  if (command === "list" || command === "recent") {
    const files = await listReceivedFiles(config);
    console.log(formatFileList(files));
    return;
  }

  if (command === "send") {
    const inputPath = args.join(" ").trim();
    if (!inputPath) usage("Missing file path.");

    const stateStore = new StateStore(config.stateFile);
    const state = stateStore.load();
    const openid = process.env.QQ_FILE_OPENID?.trim() || state.lastOpenid;
    if (!openid) {
      usage(
        "Missing target openid. Send a QQ private message to the bot first, or set QQ_FILE_OPENID."
      );
    }

    const file = await resolveWorkspaceFile(config, inputPath);
    const auth = new QQAuth(config);
    const messages = new QQMessages(config, auth);
    await messages.sendFile({ openid }, file.path);
    console.log(`sent ${file.relativePath}`);
    return;
  }

  usage(`Unknown command: ${command}`);
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

function usage(message: string): never {
  console.error(message);
  console.error("Commands: list, recent, send <workspace-file-path>");
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
