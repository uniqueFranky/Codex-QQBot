import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config.js";
import type { QQAttachment } from "../qq/gateway.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export async function saveInputImages(
  config: Config,
  attachments: QQAttachment[],
  messageId: string | undefined
): Promise<string[]> {
  const images = attachments.filter(isImageAttachment).slice(0, config.maxInputImages);
  if (images.length === 0) return [];

  const dir = path.join(config.workspaceDir, "qq-images", safeSegment(messageId ?? String(Date.now())));
  await mkdir(dir, { recursive: true });

  const saved: string[] = [];
  for (let index = 0; index < images.length; index++) {
    const attachment = images[index];
    if (!attachment.url) continue;
    if (attachment.size && attachment.size > config.maxImageBytes) continue;

    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`下载 QQ 图片失败：${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > config.maxImageBytes) continue;

    const ext = imageExtension(attachment, response.headers.get("content-type"));
    const filename = `${String(index + 1).padStart(2, "0")}${ext}`;
    const filePath = path.join(dir, filename);
    await writeFile(filePath, bytes);
    saved.push(filePath);
  }

  return saved;
}

export async function findNewOutputImages(
  config: Config,
  startedAtMs: number
): Promise<string[]> {
  const candidates: string[] = [];
  await walk(config.workspaceDir, async (filePath) => {
    if (isInside(filePath, path.join(config.workspaceDir, "qq-images"))) return;
    if (!IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;

    const info = await stat(filePath);
    if (!info.isFile()) return;
    if (info.size > config.maxImageBytes) return;
    if (info.mtimeMs + 1000 < startedAtMs) return;
    candidates.push(filePath);
  });

  candidates.sort();
  return candidates.slice(0, config.maxOutputImages);
}

function isImageAttachment(attachment: QQAttachment): boolean {
  if (attachment.contentType.startsWith("image/")) return true;
  const ext = path.extname(attachment.filename).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function imageExtension(attachment: QQAttachment, responseContentType: string | null): string {
  const fromFilename = path.extname(attachment.filename).toLowerCase();
  if (IMAGE_EXTENSIONS.has(fromFilename)) return fromFilename;

  const contentType = responseContentType || attachment.contentType;
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

async function walk(dir: string, onFile: (filePath: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, onFile);
    } else if (entry.isFile()) {
      await onFile(fullPath);
    }
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80) || "message";
}

function isInside(filePath: string, dir: string): boolean {
  const relative = path.relative(dir, filePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
