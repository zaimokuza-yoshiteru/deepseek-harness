#!/bin/bash
# Provisioning alone uses sudo. Build and runtime checks run under a standard account.
set -euo pipefail
user=dshbuilder
uid=550
while dscl . -search /Users UniqueID "$uid" | /usr/bin/grep -q .; do uid=$((uid + 1)); done
sudo dscl . -create "/Users/$user"
sudo dscl . -create "/Users/$user" UserShell /bin/bash
sudo dscl . -create "/Users/$user" UniqueID "$uid"
sudo dscl . -create "/Users/$user" PrimaryGroupID 20
sudo dscl . -create "/Users/$user" NFSHomeDirectory "/Users/$user"
sudo mkdir -p "/Users/$user"
sudo chown -R "$user:staff" "/Users/$user" "$GITHUB_WORKSPACE"
sudo -u "$user" env HOME="/Users/$user" PATH="$PATH" \
  DSH_DESKTOP_DISTRIBUTION_VERSION="$DSH_DESKTOP_DISTRIBUTION_VERSION" \
  CI=true DSH_TELEMETRY_MODE=DISABLED CSC_IDENTITY_AUTO_DISCOVERY=false \
  node apps/desktop/scripts/ci-portable-build.mjs mac-arm64
