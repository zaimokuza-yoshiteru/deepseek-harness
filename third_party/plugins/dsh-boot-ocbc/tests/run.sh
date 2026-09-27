#!/bin/sh
set -eu
PLUGIN_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
exec node "$PLUGIN_ROOT/tests/run-integration.mjs" "$@"
