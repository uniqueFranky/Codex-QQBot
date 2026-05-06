# codex-qqbot

通过 QQ 单聊与 Codex CLI 交互的机器人。

推荐使用 Docker 部署：QQBot 和 Codex 运行在同一个容器里，Codex 使用容器专用的 `CODEX_HOME`，持久化在当前项目的 `./codex-home`。这样容器里的 Codex 配置、会话和认证状态都和宿主机的 `~/.codex` 分开。

## 功能

- 只支持 QQ 单聊。
- 不做 openid 白名单过滤，任何单聊发送者都可以使用。
- `/new` 之前共享同一个 Codex 会话。
- 如果 Codex 正在执行任务，新的普通消息会立即中止当前任务，并把新消息作为纠偏继续执行。
- Docker 模式下 Codex 在容器内拥有完整权限，宿主机边界由 Docker 挂载目录控制。
- 容器内 HTTP/HTTPS 流量可以走宿主机代理。

支持的 QQ 命令：

```text
/new      重置 Codex 会话，不清空 workspace 文件
/stop     中止当前 Codex 进程
/status   查看当前是否空闲或正在执行
```

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
export V_API_BASE_URL=https://lanxiu.eu.cc/v1
```

也可以写进 `.env`：

```env
V_API_KEY=你的 API key
V_API_BASE_URL=https://lanxiu.eu.cc/v1
```

如果宿主机代理不是 `127.0.0.1:8899`，修改 `.env` 中的代理配置：

```env
HOST_HTTP_PROXY=http://host.docker.internal:8899
HOST_HTTPS_PROXY=http://host.docker.internal:8899
HOST_ALL_PROXY=http://host.docker.internal:8899
HOST_NO_PROXY=localhost,127.0.0.1,::1
```

注意：容器里访问宿主机代理要用 `host.docker.internal`，不要用 `127.0.0.1`。容器内的 `127.0.0.1` 指向容器自己。

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
