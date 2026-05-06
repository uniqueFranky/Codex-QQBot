import path from "node:path";
import { mkdirSync } from "node:fs";
import type { Config } from "./config.js";
import { MemoryStore, type MemoryEntry } from "./memory.js";
import { StateStore } from "./state.js";

export interface MemorySetResult {
  entries: MemoryEntry[];
  key: string;
  warning?: string;
}

export class MemoryTool {
  constructor(
    private readonly memoryStore: MemoryStore,
    private readonly stateStore: StateStore
  ) {}

  load(): string {
    return this.memoryStore.load();
  }

  get(key: string): MemoryEntry | undefined {
    return this.memoryStore.get(key);
  }

  format(entries: MemoryEntry[]): string {
    return this.memoryStore.format(entries);
  }

  set(key: string, value: string): MemorySetResult {
    const previous = this.memoryStore.get(key);
    const entries = this.memoryStore.set(key, value);
    const current = this.memoryStore.get(key);
    if (current) {
      this.stateStore.appendMemoryDiff(
        previous
          ? `- updated ${current.key}: ${previous.value} -> ${current.value}`
          : `- added ${current.key}: ${current.value}`
      );
    }

    const memory = this.memoryStore.format(entries);
    const warning =
      memory.length > this.memoryStore.limit()
        ? `当前记忆长度 ${memory.length} 已超过 MEMORY_MAX_CHARS=${this.memoryStore.limit()}，不会自动删除，请手动精简。`
        : undefined;
    return { entries, key: current?.key ?? key, warning };
  }

  delete(key: string): boolean {
    const previous = this.memoryStore.get(key);
    const deleted = this.memoryStore.delete(key);
    if (deleted && previous) {
      this.stateStore.appendMemoryDiff(`- deleted ${previous.key}: ${previous.value}`);
    }
    return deleted;
  }

  clear(): boolean {
    const previous = this.memoryStore.load();
    this.memoryStore.clear();
    if (previous) {
      this.stateStore.appendMemoryDiff(`- cleared all memory. Previous memory:\n${previous}`);
      return true;
    }
    return false;
  }
}

export function createMemoryTool(config: Config, stateStore: StateStore): MemoryTool {
  return new MemoryTool(
    new MemoryStore(config.codexMemoryFile, config.memoryMaxChars),
    stateStore
  );
}

export function createMemoryToolFromEnv(): MemoryTool {
  const dataDir = path.resolve(process.env.DATA_DIR ?? "/data");
  const codexHome = path.resolve(process.env.CODEX_HOME ?? "/codex-home");
  const memoryMaxChars = parsePositiveInt(process.env.MEMORY_MAX_CHARS, 4_000);
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(path.join(codexHome, "memories"), { recursive: true });
  return new MemoryTool(
    new MemoryStore(path.join(codexHome, "memories", "qqbot.md"), memoryMaxChars),
    new StateStore(path.join(dataDir, "state.json"))
  );
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
