import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Config } from "../config.js";
import type { QQAttachment } from "../qq/gateway.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const QQ_FILES_DIR = "qq-files";

export interface SavedInputFile {
  originalName: string;
  path: string;
  size?: number;
  contentType: string;
}

export interface WorkspaceFileInfo {
  path: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
}

export async function saveInputFiles(
  config: Config,
  attachments: QQAttachment[]
): Promise<SavedInputFile[]> {
  const files = attachments.filter((attachment) => !isImageAttachment(attachment));
  if (files.length === 0) return [];

  const dir = path.join(config.workspaceDir, QQ_FILES_DIR, isoDate());
  await mkdir(dir, { recursive: true });

  const saved: SavedInputFile[] = [];
  for (const attachment of files) {
    const url = attachment.url ?? attachment.voiceWavUrl;
    if (!url) continue;

    const filename = safeFilename(attachment.filename || "attachment");
    const filePath = await uniqueFilePath(dir, filename);
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`下载 QQ 文件失败：${response.status}`);
    }

    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream),
      createWriteStream(filePath)
    );
    saved.push({
      originalName: attachment.filename || filename,
      path: filePath,
      size: attachment.size,
      contentType: attachment.contentType
    });
  }

  return saved;
}

export async function listReceivedFiles(
  config: Config,
  limit = 20
): Promise<WorkspaceFileInfo[]> {
  const root = path.join(config.workspaceDir, QQ_FILES_DIR);
  const files: WorkspaceFileInfo[] = [];
  await walk(root, async (filePath) => {
    const info = await stat(filePath);
    if (!info.isFile()) return;
    files.push({
      path: filePath,
      relativePath: path.relative(config.workspaceDir, filePath),
      size: info.size,
      mtimeMs: info.mtimeMs
    });
  });

  files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.relativePath.localeCompare(b.relativePath));
  return files.slice(0, limit);
}

export async function resolveWorkspaceFile(
  config: Config,
  input: string
): Promise<WorkspaceFileInfo> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("缺少文件路径。");

  const resolved = path.resolve(
    path.isAbsolute(trimmed) ? trimmed : path.join(config.workspaceDir, trimmed)
  );
  if (!isInsideOrEqual(resolved, config.workspaceDir)) {
    throw new Error("只能发送 workspace 内的文件。");
  }

  const info = await stat(resolved);
  if (!info.isFile()) {
    throw new Error("路径不是普通文件。");
  }

  return {
    path: resolved,
    relativePath: path.relative(config.workspaceDir, resolved),
    size: info.size,
    mtimeMs: info.mtimeMs
  };
}

export function buildInputFilesPrompt(files: SavedInputFile[]): string {
  if (files.length === 0) return "";
  const lines = files.map((file) => {
    const size = typeof file.size === "number" ? `, size=${file.size}` : "";
    const type = file.contentType ? `, type=${file.contentType}` : "";
    return `- ${file.path} (原文件名: ${file.originalName}${type}${size})`;
  });
  return ["用户发送了以下文件，已经保存到本地。需要时请直接读取这些路径：", ...lines].join("\n");
}

export function formatFileList(files: WorkspaceFileInfo[]): string {
  if (files.length === 0) return "没有找到已接收的文件。";
  return files
    .map((file, index) => {
      const modified = new Date(file.mtimeMs).toISOString();
      return `${index + 1}. ${file.relativePath} (${file.size} bytes, ${modified})`;
    })
    .join("\n");
}

function isImageAttachment(attachment: QQAttachment): boolean {
  if (attachment.contentType.startsWith("image/")) return true;
  const ext = path.extname(attachment.filename).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

async function uniqueFilePath(dir: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  for (let index = 0; ; index += 1) {
    const candidate = path.join(dir, index === 0 ? filename : `${base}-${index}${ext}`);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
  }
}

function safeFilename(value: string): string {
  const normalized = path.basename(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return normalized.slice(0, 180) || "attachment";
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
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

function isInsideOrEqual(filePath: string, dir: string): boolean {
  const relative = path.relative(dir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
