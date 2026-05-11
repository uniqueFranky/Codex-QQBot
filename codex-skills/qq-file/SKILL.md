---
name: qq-file
description: Use when Codex needs to list files received from QQ or send a workspace file back to the QQ user. Use direct sending only when the user explicitly asks to send a file; if Codex decides on its own that a generated file should be sent, ask for confirmation first.
---

# QQ File

Use this skill to work with files exchanged through the QQ bot.

Commands:

```bash
qq-file list
qq-file recent
qq-file send /workspace/path/to/file
```

Behavior:

- `qq-file list` and `qq-file recent` show recently received QQ files under `/workspace/qq-files`.
- `qq-file send <path>` sends one file to the most recent QQ private chat.
- Only files inside `/workspace` can be sent.
- The command loads QQ credentials and proxy settings from `/data/qqbot.env`.
- It uses QQ Bot API v2 rich-media file sending. If QQ rejects the file type, size, or permission, report the command error to the user.

Rules:

- If the user explicitly says to send, upload, attach, or deliver a file, you may call `qq-file send` directly.
- If you independently decide that a generated file should be sent, ask the user for confirmation first. Do not call `qq-file send` until the user confirms.
- Do not use this skill for normal text replies.
- Do not send files outside `/workspace`.

Examples:

```bash
qq-file send /workspace/report.html
qq-file send output/result.zip
```
