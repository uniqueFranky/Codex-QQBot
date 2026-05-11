# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN --mount=type=secret,id=dotenv,required=false \
  set -e; \
  unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy; \
  if [ -f /run/secrets/dotenv ]; then set -a; . /run/secrets/dotenv; set +a; fi; \
  DEFAULT_PROXY="http://host.docker.internal:${HOST_PROXY_PORT:-18899}"; \
  export HTTP_PROXY="${HOST_HTTP_PROXY:-$DEFAULT_PROXY}" \
    HTTPS_PROXY="${HOST_HTTPS_PROXY:-$DEFAULT_PROXY}" \
    ALL_PROXY="${HOST_ALL_PROXY:-$DEFAULT_PROXY}" \
    NO_PROXY="${HOST_NO_PROXY:-localhost,127.0.0.1,::1}" \
    http_proxy="${HOST_HTTP_PROXY:-$DEFAULT_PROXY}" \
    https_proxy="${HOST_HTTPS_PROXY:-$DEFAULT_PROXY}" \
    all_proxy="${HOST_ALL_PROXY:-$DEFAULT_PROXY}" \
    no_proxy="${HOST_NO_PROXY:-localhost,127.0.0.1,::1}"; \
  apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git ripgrep python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN --mount=type=secret,id=dotenv,required=false \
  unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy; \
  if [ -f /run/secrets/dotenv ]; then set -a; . /run/secrets/dotenv; set +a; fi; \
  DEFAULT_PROXY="http://host.docker.internal:${HOST_PROXY_PORT:-18899}"; \
  export HTTP_PROXY="${HOST_HTTP_PROXY:-$DEFAULT_PROXY}" \
    HTTPS_PROXY="${HOST_HTTPS_PROXY:-$DEFAULT_PROXY}" \
    ALL_PROXY="${HOST_ALL_PROXY:-$DEFAULT_PROXY}" \
    NO_PROXY="${HOST_NO_PROXY:-localhost,127.0.0.1,::1}" \
    http_proxy="${HOST_HTTP_PROXY:-$DEFAULT_PROXY}" \
    https_proxy="${HOST_HTTPS_PROXY:-$DEFAULT_PROXY}" \
    all_proxy="${HOST_ALL_PROXY:-$DEFAULT_PROXY}" \
    no_proxy="${HOST_NO_PROXY:-localhost,127.0.0.1,::1}"; \
  npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ARG TARGETARCH

RUN --mount=type=secret,id=dotenv,required=false \
  unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy; \
  if [ -f /run/secrets/dotenv ]; then set -a; . /run/secrets/dotenv; set +a; fi; \
  DEFAULT_PROXY="http://host.docker.internal:${HOST_PROXY_PORT:-18899}"; \
  export HTTP_PROXY="${HOST_HTTP_PROXY:-$DEFAULT_PROXY}" \
    HTTPS_PROXY="${HOST_HTTPS_PROXY:-$DEFAULT_PROXY}" \
    ALL_PROXY="${HOST_ALL_PROXY:-$DEFAULT_PROXY}" \
    NO_PROXY="${HOST_NO_PROXY:-localhost,127.0.0.1,::1}" \
    http_proxy="${HOST_HTTP_PROXY:-$DEFAULT_PROXY}" \
    https_proxy="${HOST_HTTPS_PROXY:-$DEFAULT_PROXY}" \
    all_proxy="${HOST_ALL_PROXY:-$DEFAULT_PROXY}" \
    no_proxy="${HOST_NO_PROXY:-localhost,127.0.0.1,::1}"; \
  apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    cron \
    curl \
    dnsutils \
    file \
    g++ \
    git \
    iproute2 \
    iputils-ping \
    jq \
    less \
    lsof \
    make \
    nano \
    netcat-openbsd \
    openssh-client \
    pkg-config \
    procps \
    ripgrep \
    rsync \
    sqlite3 \
    tree \
    unzip \
    vim-tiny \
    wget \
    zip \
  && rm -rf /var/lib/apt/lists/*

RUN --mount=type=secret,id=dotenv,required=false \
  unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy; \
  if [ -f /run/secrets/dotenv ]; then set -a; . /run/secrets/dotenv; set +a; fi; \
  DEFAULT_PROXY="http://host.docker.internal:${HOST_PROXY_PORT:-18899}"; \
  export HTTP_PROXY="${HOST_HTTP_PROXY:-$DEFAULT_PROXY}" \
    HTTPS_PROXY="${HOST_HTTPS_PROXY:-$DEFAULT_PROXY}" \
    ALL_PROXY="${HOST_ALL_PROXY:-$DEFAULT_PROXY}" \
    NO_PROXY="${HOST_NO_PROXY:-localhost,127.0.0.1,::1}" \
    http_proxy="${HOST_HTTP_PROXY:-$DEFAULT_PROXY}" \
    https_proxy="${HOST_HTTPS_PROXY:-$DEFAULT_PROXY}" \
    all_proxy="${HOST_ALL_PROXY:-$DEFAULT_PROXY}" \
    no_proxy="${HOST_NO_PROXY:-localhost,127.0.0.1,::1}"; \
  case "$TARGETARCH" in \
    amd64) CODEX_PLATFORM="linux-x64" ;; \
    arm64) CODEX_PLATFORM="linux-arm64" ;; \
    *) echo "Unsupported Codex native package architecture: $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  CODEX_VERSION="$(npm view @openai/codex version)"; \
  npm install -g \
    "@openai/codex@$CODEX_VERSION" \
    "@openai/codex-$CODEX_PLATFORM@npm:@openai/codex@$CODEX_VERSION-$CODEX_PLATFORM"; \
  codex --version

COPY package.json package-lock.json ./
RUN --mount=type=secret,id=dotenv,required=false \
  unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy; \
  if [ -f /run/secrets/dotenv ]; then set -a; . /run/secrets/dotenv; set +a; fi; \
  DEFAULT_PROXY="http://host.docker.internal:${HOST_PROXY_PORT:-18899}"; \
  export HTTP_PROXY="${HOST_HTTP_PROXY:-$DEFAULT_PROXY}" \
    HTTPS_PROXY="${HOST_HTTPS_PROXY:-$DEFAULT_PROXY}" \
    ALL_PROXY="${HOST_ALL_PROXY:-$DEFAULT_PROXY}" \
    NO_PROXY="${HOST_NO_PROXY:-localhost,127.0.0.1,::1}" \
    http_proxy="${HOST_HTTP_PROXY:-$DEFAULT_PROXY}" \
    https_proxy="${HOST_HTTPS_PROXY:-$DEFAULT_PROXY}" \
    all_proxy="${HOST_ALL_PROXY:-$DEFAULT_PROXY}" \
    no_proxy="${HOST_NO_PROXY:-localhost,127.0.0.1,::1}"; \
  npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY codex-config/config.toml /opt/codex-config/config.toml
COPY codex-skills ./codex-skills
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
  WORKSPACE_DIR=/workspace \
  DATA_DIR=/data \
  CODEX_HOME=/codex-home \
  CODEX_SANDBOX_MODE=danger-full-access

RUN mkdir -p /workspace /data /codex-home /opt/codex-config \
  && chmod +x /usr/local/bin/docker-entrypoint.sh \
  && printf '#!/bin/sh\nexec node /app/dist/memory-cli.js "$@"\n' > /usr/local/bin/qq-memory \
  && printf '#!/bin/sh\nexec node /app/dist/qq-notify-cli.js "$@"\n' > /usr/local/bin/qq-notify \
  && printf '#!/bin/sh\nexec node /app/dist/qq-file-cli.js "$@"\n' > /usr/local/bin/qq-file \
  && chmod +x /usr/local/bin/qq-memory /usr/local/bin/qq-notify /usr/local/bin/qq-file

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
