#!/usr/bin/env bash
# check-i18n-parity.sh — Assert all locale files have identical key sets.
# Usage: bash dashboard/src/i18n/scripts/check-i18n-parity.sh
set -euo pipefail

DASHBOARD_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
LOCALES_DIR="$DASHBOARD_DIR/src/i18n/locales"
REFERENCE="en.json"

node -e '
const fs = require("fs");
const dir = process.argv[1];
const locales = ["en", "de", "es", "fr"];
const ref = JSON.parse(fs.readFileSync(`${dir}/en.json`, "utf8"));
const refKeys = Object.keys(ref).sort();
let failed = false;

for (const loc of locales) {
  const data = JSON.parse(fs.readFileSync(`${dir}/${loc}.json`, "utf8"));
  const keys = Object.keys(data).sort();
  const missing = refKeys.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !refKeys.includes(k));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`[${loc}.json] missing=${missing.length} extra=${extra.length}`);
    if (missing.length) console.error(`  missing: ${missing.join(", ")}`);
    if (extra.length) console.error(`  extra: ${extra.join(", ")}`);
  }
}

if (failed) {
  console.error("i18n parity FAILED");
  process.exit(1);
}
console.log("i18n parity OK — all locales share", refKeys.length, "keys");
' "$LOCALES_DIR"
