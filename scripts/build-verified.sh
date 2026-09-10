#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

export NEXT_PUBLIC_BUILD_SHA="${NEXT_PUBLIC_BUILD_SHA:-$(git -C "${SITES_PROJECT_ROOT}" rev-parse HEAD)}"
export NEXT_PUBLIC_BUILD_BRANCH="${NEXT_PUBLIC_BUILD_BRANCH:-$(git -C "${SITES_PROJECT_ROOT}" branch --show-current)}"
export NEXT_PUBLIC_BUILD_TIME="${NEXT_PUBLIC_BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
export NEXT_PUBLIC_APP_ENV="${NEXT_PUBLIC_APP_ENV:-beta}"

echo "Removing the previous generated build to prevent stale public assets..."
rm -rf "${SITES_PROJECT_ROOT}/dist"

echo "Running bounded vinext build..."
if command -v timeout >/dev/null 2>&1; then
  timeout \
    --signal=TERM \
    --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
    "${SITES_BUILD_TIMEOUT:-3m}" \
    "${vinext}" build
else
  "${vinext}" build
fi
