import type { Config } from "../config.js";
import type { StateStore } from "../state.js";
import type { QQAuth } from "./auth.js";

export interface QQPrivateMessage {
  id?: string;
  eventId?: string;
  openid: string;
  content: string;
  attachments: QQAttachment[];
  raw: unknown;
}

export interface QQAttachment {
  contentType: string;
  filename: string;
  size?: number;
  url?: string;
  voiceWavUrl?: string;
  width?: number;
  height?: number;
}

interface GatewayPayload {
  op: number;
  s?: number;
  t?: string;
  d?: unknown;
}

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

const INTENT_GROUP_AND_C2C = 1 << 25;

export class QQGateway {
  private socket?: WebSocket;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private sessionId?: string;
  private seq?: number;

  constructor(
    private readonly config: Config,
    private readonly auth: QQAuth,
    private readonly stateStore: StateStore,
    private readonly onMessage: (message: QQPrivateMessage) => void | Promise<void>
  ) {
    const state = stateStore.load();
    this.sessionId = state.qqSessionId;
    this.seq = state.qqSeq;
  }

  async start(): Promise<void> {
    await this.connect();
  }

  private async connect(): Promise<void> {
    const token = await this.auth.getAccessToken();
    const response = await fetch(`${this.config.qqApiBase}/gateway/bot`, {
      headers: { authorization: `QQBot ${token}` }
    });
    const body = (await response.json()) as { url?: string };
    if (!response.ok || !body.url) {
      throw new Error(`QQ gateway request failed: ${response.status} ${JSON.stringify(body)}`);
    }

    this.socket = new WebSocket(body.url);
    this.socket.addEventListener("open", () => {
      console.log("QQ gateway connected");
    });
    this.socket.addEventListener("message", (event) => {
      void this.handlePacket(String(event.data)).catch((error) => {
        console.error("QQ gateway packet error", error);
      });
    });
    this.socket.addEventListener("close", () => {
      console.error("QQ gateway closed, reconnecting soon");
      this.cleanupHeartbeat();
      this.scheduleReconnect();
    });
    this.socket.addEventListener("error", (event) => {
      console.error("QQ gateway websocket error", event);
    });
  }

  private async handlePacket(data: string): Promise<void> {
    const payload = JSON.parse(data) as GatewayPayload;
    if (typeof payload.s === "number") {
      this.seq = payload.s;
      this.stateStore.patch({ qqSeq: payload.s });
    }

    switch (payload.op) {
      case OP_DISPATCH:
        await this.handleDispatch(payload);
        break;
      case OP_HELLO:
        this.startHeartbeat(payload.d);
        await this.identifyOrResume();
        break;
      case OP_RECONNECT:
        this.reconnectNow();
        break;
      case OP_INVALID_SESSION:
        this.sessionId = undefined;
        this.stateStore.patch({ qqSessionId: undefined });
        this.reconnectNow();
        break;
      case OP_HEARTBEAT_ACK:
        break;
      default:
        break;
    }
  }

  private async handleDispatch(payload: GatewayPayload): Promise<void> {
    if (payload.t === "READY") {
      const ready = payload.d as { session_id?: string };
      if (ready.session_id) {
        this.sessionId = ready.session_id;
        this.stateStore.patch({ qqSessionId: ready.session_id });
      }
      return;
    }

    if (payload.t !== "C2C_MESSAGE_CREATE") return;
    const message = extractPrivateMessage(payload.d, payload);
    if (!message) {
      console.warn("Could not extract C2C message", JSON.stringify(payload.d));
      return;
    }
    await this.onMessage(message);
  }

  private startHeartbeat(data: unknown): void {
    const hello = data as { heartbeat_interval?: number };
    const interval = hello.heartbeat_interval ?? 45_000;
    this.cleanupHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: OP_HEARTBEAT, d: this.seq ?? null });
    }, interval);
  }

  private async identifyOrResume(): Promise<void> {
    const token = await this.auth.getAccessToken();
    if (this.sessionId && typeof this.seq === "number") {
      this.send({
        op: OP_RESUME,
        d: {
          token: `QQBot ${token}`,
          session_id: this.sessionId,
          seq: this.seq
        }
      });
      return;
    }

    this.send({
      op: OP_IDENTIFY,
      d: {
        token: `QQBot ${token}`,
        intents: INTENT_GROUP_AND_C2C,
        shard: [0, 1],
        properties: {}
      }
    });
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private reconnectNow(): void {
    this.socket?.close();
    this.cleanupHeartbeat();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch((error) => {
        console.error("QQ gateway reconnect failed", error);
        this.scheduleReconnect();
      });
    }, 3000);
  }

  private cleanupHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }
}

function extractPrivateMessage(data: unknown, payload: GatewayPayload): QQPrivateMessage | undefined {
  const message = data as Record<string, unknown>;
  const author = message.author as Record<string, unknown> | undefined;
  const openid =
    stringField(message, "openid") ??
    stringField(message, "user_openid") ??
    stringField(author, "user_openid") ??
    stringField(author, "openid");
  if (!openid) return undefined;

  return {
    id: stringField(message, "id") ?? stringField(message, "msg_id"),
    eventId: stringField(message, "event_id"),
    openid,
    content: normalizeContent(stringField(message, "content") ?? ""),
    attachments: extractAttachments(message),
    raw: data
  };
}

function stringField(object: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = object?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeContent(content: string): string {
  return content.replace(/<@!?\d+>/g, "").trim();
}

function extractAttachments(message: Record<string, unknown>): QQAttachment[] {
  const attachments = message.attachments;
  if (!Array.isArray(attachments)) return [];

  return attachments
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      contentType: stringField(item, "content_type") ?? "",
      filename: stringField(item, "filename") ?? "attachment",
      size: numberField(item, "size"),
      url: stringField(item, "url"),
      voiceWavUrl: stringField(item, "voice_wav_url"),
      width: numberField(item, "width"),
      height: numberField(item, "height")
    }));
}

function numberField(object: Record<string, unknown>, key: string): number | undefined {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
