import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Config {
  qqAppId: string;
  qqAppSecret: string;
  qqApiBase: string;
  workspaceDir: string;
  dataDir: string;
  stateFile: string;
  logsDir: string;
  codexTimeoutMs: number;
  codexModel?: string;
  codexHome?: string;
  codexSandboxMode: "workspace-write" | "danger-full-access";
  statusThrottleMs: number;
  replyChunkSize: number;
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

  return {
    qqAppId: required("QQ_APP_ID"),
    qqAppSecret: required("QQ_APP_SECRET"),
    qqApiBase: process.env.QQ_API_BASE?.trim() || "https://api.sgroup.qq.com",
    workspaceDir,
    dataDir,
    stateFile: path.join(dataDir, "state.json"),
    logsDir: path.join(dataDir, "logs"),
    codexTimeoutMs: optionalNumber("CODEX_TIMEOUT_MS", 180_000),
    codexModel: process.env.CODEX_MODEL?.trim() || undefined,
    codexHome,
    codexSandboxMode: optionalSandboxMode(),
    statusThrottleMs: optionalNumber("STATUS_THROTTLE_MS", 2_500),
    replyChunkSize: optionalNumber("REPLY_CHUNK_SIZE", 1_500)
  };
}
