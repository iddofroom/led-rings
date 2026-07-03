#!/usr/bin/env bash
# Convenience wrapper: pull the latest code and rebuild, then restart the host.
# Just calls led-rings-host.sh --update (which does fetch + reset + deps + build + restart).
#
#   bash led-rings-host-update.sh                          # pull the current branch
#   LED_RINGS_BRANCH=some-branch bash led-rings-host-update.sh   # switch branch, then pull
#
# Point at a different repo (e.g. a fork) with LED_RINGS_REPO.
set -euo pipefail
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$BASE/led-rings-host.sh" --update "$@"
