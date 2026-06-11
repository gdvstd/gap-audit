#!/usr/bin/env bash
# Vertex AI Agent Engine custom installation script.
#
# The Phoenix and MongoDB MCP servers are launched via `npx` (Node), but the Agent
# Engine runtime is Python-only by default. This script installs Node.js so the stdio
# MCP servers can start. Reference it as the custom install script at deploy time.
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Warm the MCP server packages so first agent run doesn't pay the npx download.
npx -y @arizeai/phoenix-mcp@latest --help >/dev/null 2>&1 || true
npx -y mongodb-mcp-server --help >/dev/null 2>&1 || true

node --version
