import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Config {
  qqAppId: string;
  qqAppSecret: string;
  qqApiBase: string;
  workspaceDir: string;
  dataDir: string;
  stateFile: string;
  runtimeEnvFile: string;
  logsDir: string;
  codexTimeoutMs: number;
  codexModel?: string;
  codexHome?: string;
  codexSandboxMode: "workspace-write" | "danger-full-access";
  statusThrottleMs: number;
  receivedMessage?: string;
  replyChunkSize: number;
  maxInputImages: number;
  maxOutputImages: number;
  maxImageBytes: number;
  enableMarkdown: boolean;
  codexEnableSearch: boolean;
  codexMemoryDir: string;
  codexMemoryFile: string;
  memoryMaxChars: number;
}

function loadDotEnv(filePath: string): void {
  let content = "";
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive number env var: ${name}`);
  }
  return parsed;
}

function optionalSandboxMode(): "workspace-write" | "danger-full-access" {
  const value = process.env.CODEX_SANDBOX_MODE?.trim() || "workspace-write";
  if (value !== "workspace-write" && value !== "danger-full-access") {
    throw new Error(
      "Invalid CODEX_SANDBOX_MODE. Expected workspace-write or danger-full-access"
    );
  }
  return value;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`Invalid boolean env var: ${name}`);
}

export function loadConfig(): Config {
  loadDotEnv(path.resolve(process.cwd(), ".env"));

  const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
  const workspaceDir = path.resolve(process.env.WORKSPACE_DIR ?? "./workspace");
  const codexHome = process.env.CODEX_HOME?.trim()
    ? path.resolve(process.env.CODEX_HOME)
    : undefined;

  mkdirSync(dataDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(path.join(dataDir, "logs"), { recursive: true });
  if (codexHome) mkdirSync(codexHome, { recursive: true });
  const codexMemoryDir = codexHome
    ? path.join(codexHome, "memories")
    : path.join(dataDir, "codex-memories");
  mkdirSync(codexMemoryDir, { recursive: true });

  return {
    qqAppId: required("QQ_APP_ID"),
    qqAppSecret: required("QQ_APP_SECRET"),
    qqApiBase: process.env.QQ_API_BASE?.trim() || "https://api.sgroup.qq.com",
    workspaceDir,
    dataDir,
    stateFile: path.join(dataDir, "state.json"),
    runtimeEnvFile: path.join(dataDir, "qqbot.env"),
    logsDir: path.join(dataDir, "logs"),
    codexTimeoutMs: optionalNumber("CODEX_TIMEOUT_MS", 180_000),
    codexModel: process.env.CODEX_MODEL?.trim() || undefined,
    codexHome,
    codexSandboxMode: optionalSandboxMode(),
    statusThrottleMs: optionalNumber("STATUS_THROTTLE_MS", 2_500),
    receivedMessage: optionalText("RECEIVED_MESSAGE", "已收到，Codex 正在处理。"),
    replyChunkSize: optionalNumber("REPLY_CHUNK_SIZE", 1_500),
    maxInputImages: optionalNumber("MAX_INPUT_IMAGES", 4),
    maxOutputImages: optionalNumber("MAX_OUTPUT_IMAGES", 4),
    maxImageBytes: optionalNumber("MAX_IMAGE_BYTES", 10 * 1024 * 1024),
    enableMarkdown: optionalBoolean("QQ_ENABLE_MARKDOWN", true),
    codexEnableSearch: optionalBoolean("CODEX_ENABLE_SEARCH", false),
    codexMemoryDir,
    codexMemoryFile: path.join(codexMemoryDir, "qqbot.md"),
    memoryMaxChars: optionalNumber("MEMORY_MAX_CHARS", 4_000)
  };
}

function optionalText(name: string, fallback: string): string | undefined {
  if (!(name in process.env)) return fallback;
  const value = process.env[name] ?? "";
  return value.trim() || undefined;
}
