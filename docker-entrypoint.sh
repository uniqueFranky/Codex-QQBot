#!/bin/sh
set -eu

mkdir -p "${CODEX_HOME:-/codex-home}" /workspace /data

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

if command -v cron >/dev/null 2>&1; then
  service cron start >/dev/null 2>&1 || cron
fi

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

ensure_bash_loads_codex_profile
load_profile /etc/profile
load_profile /root/.profile

exec "$@"
