import { readFileSync, writeFileSync } from "node:fs";

export interface MemoryEntry {
  key: string;
  value: string;
}

export class MemoryStore {
  constructor(
    private readonly filePath: string,
    private readonly maxChars: number
  ) {}

  load(): string {
    return this.format(this.loadEntries());
  }

  limit(): number {
    return this.maxChars;
  }

  loadEntries(): MemoryEntry[] {
    try {
      return parseMemory(readFileSync(this.filePath, "utf8"));
    } catch {
      return [];
    }
  }

  get(key: string): MemoryEntry | undefined {
    const normalizedKey = normalizeKey(key);
    return this.loadEntries().find((entry) => entry.key === normalizedKey);
  }

  set(key: string, value: string): MemoryEntry[] {
    const normalizedKey = normalizeKey(key);
    const normalizedValue = value.trim();
    if (!normalizedKey) throw new Error("memory key is empty");
    if (!normalizedValue) throw new Error("memory value is empty");

    const entries = this.loadEntries();
    const index = entries.findIndex((entry) => entry.key === normalizedKey);
    const next = { key: normalizedKey, value: normalizedValue };
    if (index >= 0) {
      entries[index] = next;
    } else {
      entries.push(next);
    }

    this.saveEntries(entries);
    return entries;
  }

  delete(key: string): boolean {
    const normalizedKey = normalizeKey(key);
    const entries = this.loadEntries();
    const next = entries.filter((entry) => entry.key !== normalizedKey);
    if (next.length === entries.length) return false;
    this.saveEntries(next);
    return true;
  }

  clear(): void {
    writeFileSync(this.filePath, "");
  }

  format(entries: MemoryEntry[]): string {
    if (entries.length === 0) return "";
    return entries.map((entry) => `- ${entry.key}: ${entry.value}`).join("\n");
  }

  private saveEntries(entries: MemoryEntry[]): void {
    const content = this.format(entries);
    writeFileSync(this.filePath, content ? `${content}\n` : "");
  }
}

function parseMemory(content: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const item = line.replace(/^[-*]\s+/, "");
    const colonIndex = item.indexOf(":");
    const fullWidthColonIndex = item.indexOf("：");
    const separator =
      colonIndex >= 0 && fullWidthColonIndex >= 0
        ? Math.min(colonIndex, fullWidthColonIndex)
        : Math.max(colonIndex, fullWidthColonIndex);
    if (separator <= 0) continue;

    const key = normalizeKey(item.slice(0, separator));
    const value = item.slice(separator + 1).trim();
    if (!key || !value) continue;
    entries.push({ key, value });
  }
  return entries;
}

function normalizeKey(key: string): string {
  return key
    .trim()
    .replace(/^(\*\*|__|\*|_)+/, "")
    .replace(/(\*\*|__|\*|_)+$/, "")
    .trim()
    .replace(/\s+/g, "_");
}
