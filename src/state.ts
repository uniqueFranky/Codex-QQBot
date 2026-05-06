import { readFileSync, writeFileSync } from "node:fs";

export interface BotState {
  threadId?: string;
  qqSessionId?: string;
  qqSeq?: number;
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

  resetThread(): BotState {
    const current = this.load();
    delete current.threadId;
    this.save(current);
    return current;
  }
}

