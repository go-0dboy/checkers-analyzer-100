#!/usr/bin/env bash
# ============================================================
# Сборка Scan 3.1 в WebAssembly и подключение к «СтоКлетке».
#
# Scan — сильнейший открытый движок международных шашек
# (Fabien Letouzey). Приложение подхватит его автоматически,
# как только scan.js + scan.wasm появятся в public/scan/.
#
# Два пути:
#  1) ГОТОВАЯ СБОРКА (рекомендуется): RoepStoep/scan-wasm —
#     Scan 3.1, адаптированный для клиентского анализа lidraughts
#     (WASM/asm.js). Склонировать и скопировать артефакты:
#       git clone https://github.com/RoepStoep/scan-wasm
#       cp scan-wasm/scan.js scan-wasm/scan.wasm public/scan/
#  2) СКОМПИЛИРОВАТЬ ИЗ ИСХОДНИКОВ через Emscripten (ниже).
#
# Требования: emsdk (https://emscripten.org), git.
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/public/scan"
WORK="$(mktemp -d)"
mkdir -p "$OUT"

echo "→ Рабочая директория: $WORK"

# --- 1) пробуем готовую WASM-сборку scan-wasm ---
if git clone --depth 1 https://github.com/RoepStoep/scan-wasm "$WORK/scan-wasm" 2>/dev/null; then
  FOUND=0
  # ищем артефакты сборки в любом месте репозитория
  for f in $(find "$WORK/scan-wasm" -name 'scan.js' -o -name 'scan.wasm'); do
    cp "$f" "$OUT/"; FOUND=1
  done
  if [ "$FOUND" = "1" ] && [ -f "$OUT/scan.js" ]; then
    echo "✓ Готовая сборка скопирована в public/scan/"
    exit 0
  fi
  echo "· В scan-wasm нет предсобранной пары scan.js/scan.wasm — компилирую сам"
fi

# --- 2) компиляция Draughts64/scan-3.1 через Emscripten ---
if ! command -v emcc >/dev/null 2>&1; then
  echo "✗ emcc не найден. Установите emsdk:"
  echo "    git clone https://github.com/emscripten-core/emsdk && cd emsdk"
  echo "    ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh"
  exit 1
fi

git clone --depth 1 https://github.com/Draughts64/scan-3.1 "$WORK/scan-3.1"
cd "$WORK/scan-3.1"

# Собираем все источники движка. Интерактивный stdin эмулируется
# пайпом (см. src/engine/scan.ts), блокирующие чтения разворачивает Asyncify.
SRCS=$(find . -name '*.cpp' -not -path './test*' | tr '\n' ' ')

em++ $SRCS \
  -O3 -std=c++17 \
  -o "$OUT/scan.js" \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=ScanModule \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s ASYNCIFY=1 \
  -s FORCE_FILESYSTEM=1 \
  -s ENVIRONMENT=web,worker \
  -s TOTAL_STACK=8MB \
  -s INITIAL_MEMORY=64MB \
  --no-entry || {
    echo "✗ Автоматическая сборка не удалась (структура исходников могла измениться)."
    echo "  Соберите вручную по документации scan-3.1, положив результат в public/scan/:"
    echo "    scan.js (эмулятор) + scan.wasm"
    exit 1
  }

echo "✓ Скомпилировано: $OUT/scan.js + scan.wasm"
echo "  Приложение подхватит Scan 3.1 автоматически при следующем запуске."
