#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SOURCE_VM="$ROOT_DIR/docs/reference/grimoire-vm.md"
SOURCE_CONFORMANCE="$ROOT_DIR/docs/reference/grimoire-vm-conformance.md"
TARGET_DIR="$ROOT_DIR/skills/grimoire-vm/references"

if [[ ! -f "$SOURCE_VM" ]]; then
  echo "Missing source VM spec: $SOURCE_VM" >&2
  exit 1
fi

if [[ ! -f "$SOURCE_CONFORMANCE" ]]; then
  echo "Missing source conformance doc: $SOURCE_CONFORMANCE" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"

cat <<'HEADER' > "$TARGET_DIR/VM.md"
<!--
This file is generated from docs/reference/grimoire-vm.md.
Run scripts/sync-references.sh to update.
-->

HEADER
sed "s|docs/reference/grimoire-vm-conformance.md|references/CONFORMANCE.md|g" \
  "$SOURCE_VM" >> "$TARGET_DIR/VM.md"

cat <<'HEADER' > "$TARGET_DIR/CONFORMANCE.md"
<!--
This file is generated from docs/reference/grimoire-vm-conformance.md.
Run scripts/sync-references.sh to update.
-->

HEADER
sed \
  -e "s|docs/reference/grimoire-vm.md|references/VM.md|g" \
  -e "s|docs/reference/grimoire-vm-conformance.md|references/CONFORMANCE.md|g" \
  "$SOURCE_CONFORMANCE" >> "$TARGET_DIR/CONFORMANCE.md"

echo "Synced Grimoire VM references into skills/grimoire-vm/references/"
