#!/bin/bash
# Preserve the runner's Aqua session while removing administrator membership for the build.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != true || "${RUNNER_OS:-}" != macOS ]]; then
  echo 'Account provisioning is restricted to a macOS GitHub Actions runner' >&2
  exit 1
fi
user=$(id -un)
if [[ "$(stat -f %Su /dev/console)" != "$user" ]]; then
  echo 'The build account must own the active desktop login session' >&2
  exit 1
fi
# The privileged parent only provisions/restores membership; the child refreshes its groups.
sudo /bin/bash -c '
  set -euo pipefail
  user=$1
  shift
  trap '\''dseditgroup -o edit -a "$user" -t user admin'\'' EXIT
  dseditgroup -o edit -d "$user" -t user admin
  sudo -u "$user" "$@"
' _ "$user" env HOME="$HOME" PATH="$PATH" \
  DSH_DESKTOP_DISTRIBUTION_VERSION="$DSH_DESKTOP_DISTRIBUTION_VERSION" \
  CI=true DSH_TELEMETRY_MODE=DISABLED CSC_IDENTITY_AUTO_DISCOVERY=false \
  node apps/desktop/scripts/ci-portable-build.mjs mac-arm64
