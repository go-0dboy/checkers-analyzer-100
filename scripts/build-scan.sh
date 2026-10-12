#!/usr/bin/env bash
# Pinned Scan Hub/WASM build, Emscripten 4.0.20.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/public/scan"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
command -v em++ >/dev/null || { echo 'em++ не найден: активируйте Emscripten 4.0.20'; exit 1; }
em++ --version | head -1 | grep -q '4.0.20' || { echo 'Требуется Emscripten 4.0.20'; exit 1; }
REV=cbb251eff7051252ad0617fc03089bb51ce1be10
git init --quiet "$WORK/source"
git -C "$WORK/source" remote add origin https://github.com/RoepStoep/scan-wasm
git -C "$WORK/source" fetch --quiet --depth 1 origin "$REV"
git -C "$WORK/source" checkout --quiet --detach FETCH_HEAD
mkdir -p "$OUT"
EVAL=pattern
EXTRA=()
if [ "${SCAN_PST_ONLY:-0}" != 1 ] && [ -z "${SCAN_EVAL_FILE:-}" ]; then
  git init --quiet "$WORK/original"
  git -C "$WORK/original" remote add origin https://github.com/rhalbersma/scan
  git -C "$WORK/original" fetch --quiet --depth 1 origin 7aae17e7b7bfc47744601afb1ee7655e18983ce5
  git -C "$WORK/original" checkout --quiet --detach FETCH_HEAD
  SCAN_EVAL_FILE="$WORK/original/data/eval"
  python3 - "$SCAN_EVAL_FILE" <<'PYHASH'
from pathlib import Path
import hashlib, sys
assert hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest() == '0e7161c38af605f5e367f3f8fe17525d1c40db722714c68921971b386e58abba', 'Scan eval checksum mismatch'
PYHASH
fi
if [ "${SCAN_PST_ONLY:-0}" = 1 ]; then EVAL=pst; fi
if [ -n "${SCAN_EVAL_FILE:-}" ] && [ "$EVAL" = pattern ]; then
  [ -f "$SCAN_EVAL_FILE" ] || { echo 'SCAN_EVAL_FILE не найден'; exit 1; }
  [ "$(wc -c < "$SCAN_EVAL_FILE")" -eq 8503280 ] || { echo 'Неверный размер Scan 3.1 eval: ожидается 8503280 байт'; exit 1; }
  EXTRA=(--embed-file "$SCAN_EVAL_FILE@/data/eval")
fi
# PST is an explicit lightweight mode. Never load absent pattern weights.
python3 - "$WORK/source/main.cpp" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text().replace('   eval_init();','   if (var::Eval == var::Pattern) eval_init();');p.write_text(s)
p=Path(sys.argv[1]).with_name('search.cpp');s=p.read_text()
s=s.replace('      g_so.new_best_move(mv, sc);\n      return;', '      g_so.new_best_move(mv, sc);\n      after_search(g_so);\n      return;')
s=s.replace('   bool abort = g_sg.poll();', '   bool abort = g_sg.poll() || (int(d) > 1 && g_so.time() >= g_si.time);')
p.write_text(s)
PY
cp "$WORK/source/LICENSE" "$OUT/LICENSE-Scan.txt"
cd "$WORK/source"
em++ ./*.cpp -O3 -std=c++17 -o "$OUT/scan.js" \
  -s WASM=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=ScanModule \
  -s EXPORTED_FUNCTIONS='["_main","_scan_command"]' -s EXPORTED_RUNTIME_METHODS='["ccall"]' \
  -s ALLOW_MEMORY_GROWTH=1 -s ENVIRONMENT=worker -s STACK_SIZE=8388608 \
  -s INITIAL_MEMORY=67108864 -s EXIT_RUNTIME=0 "${EXTRA[@]}"
printf '{"protocol":"hub","version":"3.1","eval":"%s","source":"%s","emscripten":"4.0.20"}\n' "$EVAL" "$REV" > "$OUT/manifest.json"
python3 - "$OUT" <<'PYCHECK'
from pathlib import Path
import hashlib, json, sys
root=Path(sys.argv[1]);names=['scan.js','scan.wasm','manifest.json','LICENSE-Scan.txt']
(root/'checksums.json').write_text(json.dumps({name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in names},indent=2)+'\n')
PYCHECK
echo "Scan 3.1 ($EVAL): public/scan/scan.js + scan.wasm. GPLv3 source: RoepStoep/scan-wasm@$REV"
