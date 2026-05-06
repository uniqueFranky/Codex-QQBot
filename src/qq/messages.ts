import type { Config } from "../config.js";
import type { QQAuth } from "./auth.js";

export interface C2CReplyContext {
  openid: string;
  msgId?: string;
  eventId?: string;
}

export class QQMessages {
  private seq = 1;

  constructor(
    private readonly config: Config,
    private readonly auth: QQAuth
  ) {}

  async sendText(context: C2CReplyContext, text: string): Promise<void> {
    const chunks = splitText(text, this.config.replyChunkSize);
    for (const chunk of chunks) {
      await this.sendTextChunk(context, chunk);
    }
  }

  private async sendTextChunk(context: C2CReplyContext, content: string): Promise<void> {
    const token = await this.auth.getAccessToken();
    const url = `${this.config.qqApiBase}/v2/users/${encodeURIComponent(
      context.openid
    )}/messages`;

    const body: Record<string, unknown> = {
      msg_type: 0,
      content,
      msg_seq: this.seq++
    };

    if (context.msgId) body.msg_id = context.msgId;
    if (context.eventId) body.event_id = context.eventId;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `QQBot ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`QQ send message failed: ${response.status} ${responseText}`);
    }
  }
}

function splitText(text: string, maxLength: number): string[] {
  const normalized = text.trim() || "(empty)";
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);
    if (cut < maxLength * 0.5) cut = maxLength;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  chunks.push(remaining);
  return chunks;
}

