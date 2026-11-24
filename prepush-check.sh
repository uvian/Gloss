#!/usr/bin/env bash
# IFLL pre-push verification script
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

fail=0
check() {
  if ! eval "$1"; then
    echo "  FAIL: $2"
    fail=1
  else
    echo "  PASS: $2"
  fi
}

echo "=== IFLL v0.4 pre-push check ==="

# 1. JS syntax validation across all modules
for f in src/shared/*.js src/background/*.js src/content/*.js src/popup/*.js src/dashboard/*.js; do
  if node --check "$f" 2>/dev/null; then
    echo "  PASS: syntax $f"
  else
    echo "  FAIL: syntax $f"
    fail=1
  fi
done
check "python3 -m py_compile scripts/clean_wordbank.py tests/e2e.py" "python scripts syntax"

# 2. JSON validity
check "node -e 'JSON.parse(require(\"fs\").readFileSync(\"manifest.json\",\"utf8\"))'" "manifest.json valid JSON"
check "node -e 'JSON.parse(require(\"fs\").readFileSync(\"src/data/wordbank.json\",\"utf8\"))'" "wordbank.json valid JSON"
check "node -e 'JSON.parse(require(\"fs\").readFileSync(\"src/data/wordbank-meta.json\",\"utf8\"))'" "wordbank-meta.json valid JSON"

# 3. Manifest references exist
check "node -e '
const fs = require(\"fs\");
const m = JSON.parse(fs.readFileSync(\"manifest.json\", \"utf8\"));
const files = [
  m.action.default_popup,
  m.background.service_worker,
  ...m.content_scripts.flatMap(cs => [...(cs.js || []), ...(cs.css || [])]),
  ...m.web_accessible_resources.flatMap(r => r.resources || [])
];
for (const f of files) {
  if (!fs.existsSync(f)) { console.error(\"Missing:\", f); process.exit(1); }
}
'" "manifest.json referenced files exist"

# 4. Run full automated unit & integrity test suite
echo ""
echo "=== Running automated tests ==="
if node --test tests/*.test.mjs; then
  echo "  PASS: unit tests"
else
  echo "  FAIL: unit tests"
  fail=1
fi

echo ""
if [ $fail -eq 0 ]; then
  echo "All checks passed."
  exit 0
else
  echo "$fail check(s) failed."
  exit 1
fi
