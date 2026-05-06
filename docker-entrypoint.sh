#!/bin/sh
set -eu

mkdir -p "${CODEX_HOME:-/codex-home}" /workspace /data

if [ ! -f "${CODEX_HOME:-/codex-home}/config.toml" ]; then
  sed "s#__V_API_BASE_URL__#${V_API_BASE_URL:-https://lanxiu.eu.cc/v1}#g" \
    /opt/codex-config/config.toml > "${CODEX_HOME:-/codex-home}/config.toml"
fi

exec "$@"
