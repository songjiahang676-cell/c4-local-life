#!/usr/bin/env bash
set -euo pipefail

check() {
  local name="$1" url="$2"
  if curl -fsS --max-time 5 "$url" >/dev/null; then
    printf 'OK   %s %s\n' "$name" "$url"
  else
    printf 'FAIL %s %s\n' "$name" "$url" >&2
    return 1
  fi
}

status=0
check web http://localhost:3000 || status=1
check admin http://localhost:3001 || status=1
check api http://localhost:4000/v1/health || status=1
check opensearch http://localhost:9200/_cluster/health || status=1
check mailpit http://localhost:8025 || status=1
exit "$status"
