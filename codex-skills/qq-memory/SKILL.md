---
name: qq-memory
description: Use when the user asks Codex to remember, forget, update, or inspect persistent QQBot memory. This skill provides the qq-memory CLI for deterministic key-value memory operations shared with the QQ bot.
---

# QQ Memory

Use the `qq-memory` command when the user asks to remember, update, forget, delete, or inspect persistent preferences or facts.

Memory is stored as key-value Markdown in the container Codex home:

```text
/codex-home/memories/qqbot.md
```

Commands:

```bash
qq-memory show
qq-memory get <key>
qq-memory set <key> <value>
qq-memory set <key>=<value>
qq-memory del <key>
qq-memory clear
```

Guidelines:

- Use stable, concise keys such as `name`, `role`, `style`, `language`, `research_direction`.
- Prefer updating an existing key over creating duplicates.
- If the user asks what is remembered, call `qq-memory show`.
- If the user asks to forget something, call `qq-memory del <key>` when the key is clear; otherwise inspect with `qq-memory show` first.
- After changing memory, briefly tell the user what changed.

Confirmation workflow for remembering or updating facts:

- When the user asks you to remember something, infer an appropriate key and value. You may normalize wording, split a sentence into a concise key-value pair, or merge it with an existing key, but the meaning must remain exactly unchanged.
- Before calling `qq-memory set`, show the proposed change to the user and ask for confirmation. Include whether it is an add or update.
- Do not write memory until the user explicitly agrees.
- If the user gives corrections, revise the proposed key/value and ask for confirmation again.
- Repeat revision and confirmation until the user fully agrees.
- Only after confirmation, run `qq-memory set <key> <value>` or `qq-memory set <key>=<value>`.
- For deletion or clearing memory, also confirm before running `qq-memory del <key>` or `qq-memory clear`, unless the user already gave an explicit direct command to delete/clear.

Example confirmation:

```text
我准备这样写入记忆，请确认：
操作：新增
key: language
value: 用户希望默认使用中文回答

确认后我再写入。
```
