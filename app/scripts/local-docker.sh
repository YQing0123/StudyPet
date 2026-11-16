#!/bin/sh
# Always target the local Colima context and the isolated test Compose project.
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec docker --context colima compose \
  --env-file /dev/null \
  -p banxue-island-local \
  -f "$app_dir/compose.local.yaml" "$@"
