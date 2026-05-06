# codex-qqbot

> 警告：本项目主要由 AI 生成，代码质量、安全性和适用性需要使用者自行审查和判断。项目会连接 QQ Bot、运行 Codex CLI、访问网络、读取环境变量，并在 Docker 容器内执行命令。部署前请认真检查源码、Docker 配置、挂载目录、密钥注入方式和运行权限，风险自负。

通过 QQ 单聊与 Codex CLI 交互的机器人。

推荐使用 Docker 部署：QQBot 和 Codex 运行在同一个容器里，Codex 使用容器专用的 `CODEX_HOME`，持久化在当前项目的 `./codex-home`。这样容器里的 Codex 配置、会话和认证状态都和宿主机的 `~/.codex` 分开。

## 功能

- 只支持 QQ 单聊。
- 不做 openid 白名单过滤，任何单聊发送者都可以使用。
- `/new` 之前共享同一个 Codex 会话。
- 支持给 Codex 会话命名、创建、恢复和删除命名；删除命名不会删除 Codex 实际 session 记录。
- 如果 Codex 正在执行任务，新的普通消息会立即中止当前任务，并把新消息作为纠偏继续执行。
- 支持接收 QQ 单聊图片，下载到 `workspace/qq-images` 后传给 Codex。
- 支持发送 Codex 在 `workspace` 中新生成或修改的图片文件。
- 支持用 QQ Markdown 消息发送 Codex 的回答；发送失败会自动回退为普通文本。
- 支持 Codex 官方 memories，通过 `/memory` 管理容器内 Codex 记忆；`/new` 后的下一次任务会把当前记忆作为一次性系统提示传入。
- 提供容器内 `qq-memory` CLI 和 Codex skill，Codex 可在用户要求“记住/忘记/查看记忆”时自行调用同一套记忆工具。
- 提供容器内 `qq-notify` CLI 和 Codex skill，用于按需发送孤立 QQ 通知；普通回复不应使用。
- Docker 模式下 Codex 在容器内拥有完整权限，宿主机边界由 Docker 挂载目录控制。
- 容器内 HTTP/HTTPS 流量可以走宿主机代理。

支持的 QQ 命令：

```text
/new      重置 Codex 会话，不清空 workspace 文件
/stop     中止当前 Codex 进程
/status   查看当前是否空闲或正在执行
/run      让 Codex 运行一条 bash 命令
/memory   查看和管理容器内 Codex 记忆
/session  查看和管理命名 Codex 会话
```

`/run` 示例：

```text
/run ./gradlew assembleDebug
/run npm test
```

`/run` 不由 QQBot 直接执行命令，而是交给容器内 Codex CLI 执行并汇报结果，因此仍会走现有的中断、状态、超时和日志机制。

`/session` 支持的命令：

```text
/session                 查看当前和已命名 session
/session list            查看当前和已命名 session
/session name <name>     给当前 Codex 会话命名
/session new <name>      创建新的命名 session
/session resume <name>   恢复命名 session
/session rm <name>       删除 session 名称，不删除实际 Codex session 记录
```

如果当前 session 已经建立 Codex thread 但还没有命名，执行 `/session new <name>` 或 `/session resume <name>` 会先提醒你命名，避免误丢上下文。确认不要保留当前未命名 session 时，可以追加 `--discard`：

```text
/session new <name> --discard
/session resume <name> --discard
```

命名 session 只保存在 `data/state.json` 中，用来记录名称到 Codex `threadId` 的映射。`/session rm <name>` 只删除这个映射，不会删除 `codex-home` 中的 Codex 实际 session 文件。`/new` 仍然可用，会清空当前 `threadId` 和当前 session 名称，但不会删除已命名 session 列表。

## 目录结构

```text
.
├── codex-config/config.toml  # 构建进镜像的默认 Codex 配置
├── codex-home/               # 容器 Codex 的持久化 HOME，git 忽略
├── data/                     # bot 状态和日志，git 忽略
├── workspace/                # Codex 工作目录，git 忽略
├── Dockerfile
├── docker-compose.yml
└── src/
```

Docker 挂载关系：

```text
./workspace  -> /workspace
./data       -> /data
./codex-home -> /codex-home
```

不要挂载宿主机敏感路径，例如 `/`、`~/.codex`、`~/.ssh`、`/var/run/docker.sock`。

## 配置

创建 `.env`：

```bash
cp .env.example .env
```

填写 QQ 机器人信息：

```env
QQ_APP_ID=你的 AppID
QQ_APP_SECRET=你的 AppSecret
```

模型 API key 和 endpoint 可以从宿主机 shell 环境继承：

```bash
export V_API_KEY=你的 API key
export V_API_BASE_URL=你的BASE URL
```

也可以写进 `.env`：

```env
V_API_KEY=你的 API key
V_API_BASE_URL=你的BASE URL
```

如果宿主机代理不是 `127.0.0.1:18899`，修改 `.env` 中的代理配置：

```env
HOST_PROXY_PORT=8899
HOST_HTTP_PROXY=
HOST_HTTPS_PROXY=
HOST_ALL_PROXY=
HOST_NO_PROXY=localhost,127.0.0.1,::1
```

默认会用 `HOST_PROXY_PORT` 生成 `http://host.docker.internal:<port>`。如果你的代理需要完整 URL，可以填写 `HOST_HTTP_PROXY`、`HOST_HTTPS_PROXY`、`HOST_ALL_PROXY` 覆盖默认值。

注意：容器里访问宿主机代理要用 `host.docker.internal`，不要用 `127.0.0.1`。容器内的 `127.0.0.1` 指向容器自己。

图片相关限制可以通过 `.env` 调整：

```env
MAX_INPUT_IMAGES=4
MAX_OUTPUT_IMAGES=4
MAX_IMAGE_BYTES=10485760
```

Markdown 发送默认开启：

```env
QQ_ENABLE_MARKDOWN=true
```

如果 QQ Bot 后台没有 Markdown 权限，发送失败会自动回退为普通文本。想完全关闭 Markdown 可以设置：

```env
QQ_ENABLE_MARKDOWN=false
```

开启 Codex 内置 web search：

```env
CODEX_ENABLE_SEARCH=true
```

Codex 单次任务超时时间，单位是毫秒：

```env
CODEX_TIMEOUT_MS=180000
```

超过该时间后，QQBot 会中止当前 Codex 进程并返回超时状态。长时间构建、联网搜索或生成任务可以适当调大这个值。

收到普通消息后、启动 Codex 前发送的提示文案：

```env
RECEIVED_MESSAGE=已收到，Codex 正在处理。
```

如果不想发送这条提示，可以设为空：

```env
RECEIVED_MESSAGE=
```

单个 QQBot 记忆文件长度提醒阈值：

```env
MEMORY_MAX_CHARS=4000
```

## 构建

构建镜像：

```bash
docker compose build
```

镜像会安装 Node.js 依赖和 Codex CLI，并把 `codex-config/config.toml` 作为默认 Codex 配置打包进去。

## 第一次启动

容器第一次启动时，`docker-entrypoint.sh` 会把镜像内置配置：

```text
/opt/codex-config/config.toml
```

复制到：

```text
./codex-home/config.toml
```

前提是 `./codex-home/config.toml` 还不存在。如果已经存在，不会覆盖。生成配置时会把 `V_API_BASE_URL` 写入模型供应商 endpoint。

启动 bot：

```bash
docker compose up -d
```

查看日志：

```bash
docker compose logs -f qqbot
```

看到类似输出表示启动成功：

```text
HTTP(S) proxy enabled: http://host.docker.internal:8899/
codex-qqbot starting
workspace: /workspace
data: /data
QQ gateway connected
```

之后就可以给 QQ 机器人发送单聊消息。

## 图片收发

接收图片时，bot 会把 QQ 单聊事件中的图片附件下载到：

```text
/workspace/qq-images/<message-id>/
```

然后通过 Codex CLI 的 `--image` 参数传给 Codex。只有图片附件会被传入，默认每条消息最多 4 张，每张最多 10 MiB。

发送图片时，bot 会在 Codex 任务结束后扫描 `/workspace` 中新生成或新修改的图片文件，并发送给 QQ。输入目录 `/workspace/qq-images` 会被排除，避免把用户刚发来的图片原样回传。

支持的图片扩展名：

```text
.png .jpg .jpeg .gif .webp
```

当前图片发送依赖 QQ 单聊富媒体接口：先上传图片文件，再发送 `msg_type: 7` 的富媒体消息。

## 记忆

记忆保存在：

```text
./codex-home/memories/qqbot.md
```

这是容器内 Codex 的官方 memories 目录，对应容器路径：

```text
/codex-home/memories/qqbot.md
```

Docker 入口脚本会确保容器内 Codex 配置启用：

```toml
[features]
memories = true
```

由于容器使用独立的 `CODEX_HOME=/codex-home`，这些记忆不会影响宿主机的 `~/.codex`。

执行 `/new` 时，bot 会重置当前 Codex thread，并标记下一次任务需要读取 `qqbot.md`。下一条普通消息启动新会话时，bot 会把当时的完整记忆作为一次性系统提示传入 Codex；之后同一会话继续 `resume`，不再重复传入。再次执行 `/new` 会重新触发这个流程。

每次通过 `/memory set`、`/memory del`、`/memory clear` 修改记忆时，bot 会在 `data/state.json` 中累计一段待注入的记忆变更 diff。下一次 `/new` 后的新会话会同时收到完整记忆和这段 diff；成功建立 Codex thread 后，待注入 diff 会自动清空。

支持的命令：

```text
/memory              查看当前记忆和用法
/memory show         查看当前记忆
/memory get <key>    查看某个 key
/memory set <key> <value>
/memory set <key>=<value>
/memory add <key> <value>   set 的兼容别名
/memory del <key>    删除某个 key
/memory clear        清空记忆
```

容器内也提供独立 CLI，QQBot 和 Codex skill 使用同一套实现：

```bash
qq-memory show
qq-memory get <key>
qq-memory set <key> <value>
qq-memory set <key>=<value>
qq-memory del <key>
qq-memory clear
```

镜像会安装内置 skill 到：

```text
/codex-home/skills/qq-memory
```

当你通过 QQ 对 Codex 说“记住……”“忘记……”“你的记忆里有什么”这类需求时，Codex 可以按 skill 指令调用 `qq-memory`，而不是依赖 QQBot 对消息做关键词命中。

## QQ 通知

容器内提供独立 CLI：

```bash
qq-notify "消息内容"
qq-notify --text "消息内容"
qq-notify --markdown "**提醒：** 该起床了"
qq-notify --format markdown "**提醒：** 该起床了"
```

它会发送一条孤立的 QQ 单聊消息，不携带上下文。默认使用纯文本；可以通过 `--markdown` 或 `--format markdown` 发送 QQ Markdown，发送失败时会按 bot 配置回退为普通文本。也可以设置默认格式：

```bash
QQ_NOTIFY_FORMAT=markdown qq-notify "**提醒：** 该起床了"
```

默认目标是 bot 最近收到的单聊 `openid`，该值保存在：

```text
./data/state.json
```

也可以用环境变量覆盖目标：

```bash
QQ_NOTIFY_OPENID=<openid> qq-notify "消息内容"
```

镜像会安装内置 skill 到：

```text
/codex-home/skills/qq-notify
```

这个 skill 只用于创建通知或定时提醒，例如“完成后通知我一声”“每天早上 8 点提醒我该起床了”。普通问答、任务结果、状态更新和一般性回复不应调用 `qq-notify`。

容器会启动 cron。Codex 可以创建 `/etc/cron.d/*` 文件来定时调用 `qq-notify`，例如：

```cron
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CODEX_HOME=/codex-home
DATA_DIR=/data
WORKSPACE_DIR=/workspace
QQ_API_BASE=https://api.sgroup.qq.com

0 8 * * * root qq-notify --text "该起床了"
```

不要把 QQ 密钥写进 cron 命令或 cron 文件。bot 启动时会生成权限为 `0600` 的运行时环境文件：

```text
./data/qqbot.env
```

容器内路径：

```text
/data/qqbot.env
```

`qq-notify` 会自动加载该文件中的 QQ 密钥、代理和目录配置，所以 cron 中只需要调用 `qq-notify`。如果你把运行时环境文件移动到其他路径，只需要在 cron 中设置非敏感的路径变量：

```cron
QQBOT_RUNTIME_ENV_FILE=/path/to/qqbot.env
```

写在容器内部 `/etc/cron.d` 的任务在容器重建后可能需要重新创建。

记忆文件使用 key-value Markdown 格式：

```text
- language: 中文
- style: 简洁直接
- project: codex-qqbot
```

如果 `qqbot.md` 超过 `MEMORY_MAX_CHARS`，bot 会在更新记忆后提醒你手动精简；不会自动删除任何 key-value 项。

## 容器 Profile

容器启动时，`docker-entrypoint.sh` 会在启动 QQBot 前依次加载：

```text
/etc/profile
/root/.profile
```

启动脚本会确保 `/root/.profile` 和 `/root/.bash_profile` 自动加载 `/codex-home/.profile`。因此 QQBot 主进程以及 Codex 后续执行的 `bash -lc` 命令都会继承同一份持久化 profile。

其中 `/codex-home` 挂载到当前项目的 `./codex-home`，因此可以创建：

```bash
mkdir -p codex-home
touch codex-home/.profile
```

在这个文件里持久化容器内 QQBot 和 Codex 都需要继承的环境变量，例如：

```sh
export PATH="/workspace/bin:$PATH"
export MY_TOOL_HOME="/workspace/tools"
```

只有 `export` 出来的环境变量会被 QQBot 主进程继承，并继续传给它启动的 Codex CLI。`alias`、shell function、未 `export` 的变量通常不会对 QQBot 调用 Codex 生效。cron 任务也不应依赖 profile，建议在 cron 文件或 wrapper 脚本里显式设置 `PATH` 和必要环境变量。

## 进入容器

打开容器内 bash：

```bash
docker compose run --rm -it qqbot bash
```

常用检查命令：

```bash
echo "$V_API_KEY"
echo "$V_API_BASE_URL"
cat /codex-home/config.toml
codex --version
```

手动测试容器内 Codex，无 Codex 沙箱：

```bash
codex -C /workspace --dangerously-bypass-approvals-and-sandbox exec --skip-git-repo-check "只回复 OK"
```

## 日常运维

修改 `.env` 或宿主机环境变量后，重启容器：

```bash
docker compose up -d --force-recreate
```

修改源码、`Dockerfile`、`codex-config/config.toml` 或 `docker-entrypoint.sh` 后，重新构建并重启：

```bash
docker compose build
docker compose up -d --force-recreate
```

停止：

```bash
docker compose down
```

查看日志：

```bash
docker compose logs -f qqbot
```

## 本地开发

仍然可以在宿主机本地运行：

```bash
npm install
npm run build
npm run dev
```

本地模式默认使用 Codex 的 `workspace-write` 沙箱。实际部署推荐使用 Docker 模式。

## 说明

- QQBot 使用 QQ 官方 OpenAPI 和 WebSocket Gateway。
- QQ 机器人后台需要开启单聊消息事件权限。
- `.env`、`data/`、`workspace/`、`codex-home/`、`dist/`、`node_modules/` 已被 git 忽略。

## 许可证

本项目使用 MIT License，见 [LICENSE](./LICENSE)。
