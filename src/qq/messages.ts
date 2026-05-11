import { readFileSync } from "node:fs";
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

  async sendMarkdown(context: C2CReplyContext, markdown: string): Promise<void> {
    if (!this.config.enableMarkdown) {
      await this.sendText(context, markdown);
      return;
    }

    const chunks = splitText(markdown, this.config.replyChunkSize);
    for (const chunk of chunks) {
      try {
        await this.sendMarkdownChunk(context, chunk);
      } catch (error) {
        console.warn("QQ markdown send failed, falling back to text", error);
        await this.sendTextChunk(context, chunk);
      }
    }
  }

  async sendImage(context: C2CReplyContext, filePath: string): Promise<void> {
    const fileInfo = await this.uploadMedia(context.openid, filePath, 1);
    await this.sendMedia(context, fileInfo);
  }

  async sendFile(context: C2CReplyContext, filePath: string): Promise<void> {
    const fileInfo = await this.uploadMedia(context.openid, filePath, 4);
    await this.sendMedia(context, fileInfo);
  }

  private async uploadMedia(openid: string, filePath: string, fileType: number): Promise<string> {
    const token = await this.auth.getAccessToken();
    const url = `${this.config.qqApiBase}/v2/users/${encodeURIComponent(openid)}/files`;
    const fileData = readFileSync(filePath).toString("base64");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `QQBot ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        file_type: fileType,
        srv_send_msg: false,
        file_data: fileData
      })
    });

    const body = (await response.json()) as { file_info?: string };
    if (!response.ok || !body.file_info) {
      throw new Error(`QQ upload media failed: ${response.status} ${JSON.stringify(body)}`);
    }

    return body.file_info;
  }

  private async sendMedia(context: C2CReplyContext, fileInfo: string): Promise<void> {
    const token = await this.auth.getAccessToken();
    const url = `${this.config.qqApiBase}/v2/users/${encodeURIComponent(
      context.openid
    )}/messages`;

    const body: Record<string, unknown> = {
      msg_type: 7,
      media: { file_info: fileInfo },
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
      throw new Error(`QQ send media failed: ${response.status} ${responseText}`);
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

  private async sendMarkdownChunk(context: C2CReplyContext, content: string): Promise<void> {
    const token = await this.auth.getAccessToken();
    const url = `${this.config.qqApiBase}/v2/users/${encodeURIComponent(
      context.openid
    )}/messages`;

    const body: Record<string, unknown> = {
      msg_type: 2,
      markdown: { content },
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
      throw new Error(`QQ send markdown failed: ${response.status} ${responseText}`);
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
