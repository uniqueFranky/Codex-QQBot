import { readFileSync, writeFileSync } from "node:fs";

export interface BotState {
  threadId?: string;
  currentSessionName?: string;
  sessions?: Record<string, NamedSession>;
  qqSessionId?: string;
  qqSeq?: number;
  lastOpenid?: string;
  injectMemoryOnNextRun?: boolean;
  pendingMemoryDiff?: string;
}

export interface NamedSession {
  threadId?: string;
  createdAt: string;
  updatedAt: string;
}

export class StateStore {
  constructor(private readonly filePath: string) {}

  load(): BotState {
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as BotState;
    } catch {
      return {};
    }
  }

  save(state: BotState): void {
    writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  patch(patch: Partial<BotState>): BotState {
    const next = { ...this.load(), ...patch };
    this.save(next);
    return next;
  }

  appendMemoryDiff(diff: string): BotState {
    const current = this.load();
    const previous = current.pendingMemoryDiff?.trim();
    current.pendingMemoryDiff = previous ? `${previous}\n${diff.trim()}` : diff.trim();
    this.save(current);
    return current;
  }

  resetThread(): BotState {
    const current = this.load();
    delete current.threadId;
    delete current.currentSessionName;
    current.injectMemoryOnNextRun = true;
    this.save(current);
    return current;
  }
}
