FROM node:22-bookworm-slim AS build

WORKDIR /app

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG ALL_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=${HTTP_PROXY} \
  HTTPS_PROXY=${HTTPS_PROXY} \
  ALL_PROXY=${ALL_PROXY} \
  NO_PROXY=${NO_PROXY} \
  http_proxy=${HTTP_PROXY} \
  https_proxy=${HTTPS_PROXY} \
  all_proxy=${ALL_PROXY} \
  no_proxy=${NO_PROXY}

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git ripgrep python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG ALL_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=${HTTP_PROXY} \
  HTTPS_PROXY=${HTTPS_PROXY} \
  ALL_PROXY=${ALL_PROXY} \
  NO_PROXY=${NO_PROXY} \
  http_proxy=${HTTP_PROXY} \
  https_proxy=${HTTPS_PROXY} \
  all_proxy=${ALL_PROXY} \
  no_proxy=${NO_PROXY}

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates cron git ripgrep python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @openai/codex

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

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
  && chmod +x /usr/local/bin/qq-memory /usr/local/bin/qq-notify

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
