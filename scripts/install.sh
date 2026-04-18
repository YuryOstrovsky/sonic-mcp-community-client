#!/usr/bin/env bash
#
# One-shot installer for the SONiC MCP Community Client.
#
# Usage:
#
#     curl -fsSL https://raw.githubusercontent.com/YuryOstrovsky/sonic-mcp-community-client/main/scripts/install.sh | bash
#
# What it does:
#   1. Clones this repo (or pulls latest if already cloned).
#   2. Creates .env from backend/.env.example if missing.
#   3. Builds + starts the container.
#
# You must set MCP_BASE_URL in .env to point at your MCP server before
# the UI will render anything useful.

set -euo pipefail

REPO_URL="${SONIC_MCP_CLIENT_REPO:-https://github.com/YuryOstrovsky/sonic-mcp-community-client.git}"
TARGET_DIR="${SONIC_MCP_CLIENT_DIR:-$HOME/sonic-mcp-community-client}"

blue()  { printf "\033[1;34m%s\033[0m\n" "$1"; }
green() { printf "\033[1;32m%s\033[0m\n" "$1"; }
red()   { printf "\033[1;31m%s\033[0m\n" "$1" >&2; }

need() { command -v "$1" >/dev/null 2>&1 || { red "missing required command: $1"; exit 1; }; }
need git
need docker
if ! docker compose version >/dev/null 2>&1; then
  red "docker compose plugin not installed — see https://docs.docker.com/compose/install/"
  exit 1
fi

blue "→ clone / update repo at $TARGET_DIR"
if [ -d "$TARGET_DIR/.git" ]; then
  git -C "$TARGET_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$TARGET_DIR"
fi
cd "$TARGET_DIR"

if [ ! -f .env ]; then
  blue "→ creating .env from backend/.env.example"
  cp backend/.env.example .env
  green "edit $TARGET_DIR/.env and set MCP_BASE_URL to your server"
  green "then re-run: cd $TARGET_DIR && docker compose up -d --build"
  exit 0
fi

mkdir -p data

blue "→ docker compose up -d --build"
docker compose up -d --build

blue "→ waiting for /api/health"
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:5174/api/health >/dev/null 2>&1; then
    green "client healthy after ${i}s"
    green "open http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost):5174/"
    exit 0
  fi
  sleep 1
done
red "client did not become healthy within 30s — check: docker compose logs client"
exit 1
