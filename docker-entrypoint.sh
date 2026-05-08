#!/bin/sh
set -eu

mkdir -p "${CODEX_HOME:-/codex-home}" /workspace /data
mkdir -p /etc/cron.d

CODEX_CONFIG="${CODEX_HOME:-/codex-home}/config.toml"

if [ ! -f "$CODEX_CONFIG" ]; then
  sed "s#__V_API_BASE_URL__#${V_API_BASE_URL:-https://lanxiu.eu.cc/v1}#g" \
    /opt/codex-config/config.toml > "$CODEX_CONFIG"
fi

mkdir -p "${CODEX_HOME:-/codex-home}/memories"
mkdir -p "${CODEX_HOME:-/codex-home}/skills"

if [ -d /app/codex-skills ]; then
  cp -R /app/codex-skills/. "${CODEX_HOME:-/codex-home}/skills/"
fi

if grep -q '^\[features\]' "$CODEX_CONFIG"; then
  awk '
    BEGIN { in_features = 0; saw_memory = 0 }
    /^\[/ {
      if (in_features && !saw_memory) print "memories = true"
      in_features = ($0 == "[features]")
      if (in_features) saw_memory = 0
    }
    in_features && /^memories[[:space:]]*=/ {
      print "memories = true"
      saw_memory = 1
      next
    }
    { print }
    END {
      if (in_features && !saw_memory) print "memories = true"
    }
  ' "$CODEX_CONFIG" > "$CODEX_CONFIG.tmp"
  mv "$CODEX_CONFIG.tmp" "$CODEX_CONFIG"
else
  printf '\n[features]\nmemories = true\n' >> "$CODEX_CONFIG"
fi

prepare_cron_dir() {
  # Debian cron ignores files in /etc/cron.d unless they are root-owned and not writable.
  for cron_file in /etc/cron.d/*; do
    if [ -f "$cron_file" ]; then
      chown root:root "$cron_file" 2>/dev/null || true
      chmod 0644 "$cron_file" 2>/dev/null || true
    fi
  done
}

configure_runtime_proxy() {
  default_proxy="http://host.docker.internal:${HOST_PROXY_PORT:-8899}"
  export HTTP_PROXY="${HOST_HTTP_PROXY:-$default_proxy}"
  export HTTPS_PROXY="${HOST_HTTPS_PROXY:-$default_proxy}"
  export ALL_PROXY="${HOST_ALL_PROXY:-$default_proxy}"
  export NO_PROXY="${HOST_NO_PROXY:-localhost,127.0.0.1,::1}"
  export http_proxy="${HOST_HTTP_PROXY:-$default_proxy}"
  export https_proxy="${HOST_HTTPS_PROXY:-$default_proxy}"
  export all_proxy="${HOST_ALL_PROXY:-$default_proxy}"
  export no_proxy="${HOST_NO_PROXY:-localhost,127.0.0.1,::1}"
}

ensure_bash_loads_codex_profile() {
  marker="# codex-qqbot: source persistent Codex profile"
  for profile_path in /root/.profile /root/.bash_profile; do
    touch "$profile_path"
    if ! grep -Fq "$marker" "$profile_path"; then
      cat >> "$profile_path" <<'EOF'

# codex-qqbot: source persistent Codex profile
if [ -f "${CODEX_HOME:-/codex-home}/.profile" ]; then
  . "${CODEX_HOME:-/codex-home}/.profile"
fi
EOF
    fi
  done
}

load_profile() {
  profile_path="$1"
  if [ -f "$profile_path" ]; then
    set +u
    . "$profile_path"
    set -u
  fi
}

configure_runtime_proxy
ensure_bash_loads_codex_profile
load_profile /etc/profile
load_profile /root/.profile

prepare_cron_dir
if command -v cron >/dev/null 2>&1; then
  service cron start >/dev/null 2>&1 || cron
fi

exec "$@"
