#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [[ "$node_major" != "24" ]]; then
  echo "Expected Node 24.x; found $(node -v 2>/dev/null || echo missing)." >&2
  exit 1
fi

command -v corepack >/dev/null || { echo "corepack is required" >&2; exit 1; }
corepack enable

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example; replace placeholder secrets for non-local environments."
fi

pnpm install
pnpm infra:up
pnpm db:validate
pnpm db:generate

echo "Bootstrap complete. Run: pnpm dev"
