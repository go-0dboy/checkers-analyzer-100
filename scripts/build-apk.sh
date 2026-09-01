#!/usr/bin/env bash
# ============================================================
# Локальная сборка Android-APK «СтоКлетки» через Capacitor.
#
# Требования: Node >= 22, JDK 21 (Capacitor 7), Android SDK (ANDROID_HOME).
# Запуск: bash scripts/build-apk.sh [--release]
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- проверка Node >= 22 ---
MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 22 ]; then
  echo "✗ Требуется Node >= 22 (сейчас $(node -v))."
  echo "  nvm install 22 && nvm use 22   (или см. .nvmrc)"
  exit 1
fi
echo "✓ Node $(node -v)"

# --- проверка JDK >= 21 (Capacitor 7 требует source/target 21) ---
if command -v java >/dev/null 2>&1; then
  JMAJOR="$(java -version 2>&1 | head -n1 | sed -E 's/.*version "([0-9]+).*/\1/')"
  if [ -n "$JMAJOR" ] && [ "$JMAJOR" -lt 21 ]; then
    echo "⚠ Java $JMAJOR найдена, но Capacitor 7 требует JDK 21."
    echo "  Ubuntu: sudo apt install openjdk-21-jdk && export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64"
    exit 1
  fi
fi

echo "→ npm ci"
npm ci

echo "→ Проверка типов"
npm run typecheck

echo "→ Веб-сборка (dist/)"
npm run build

if [ ! -d android ]; then
  echo "→ android/ отсутствует — создаю нативный шаблон"
  npx cap add android
fi

echo "→ Синхронизация веб-ассетов с нативным проектом"
npx cap sync android

cd android
chmod +x gradlew

if [ "${1:-}" = "--release" ]; then
  if [ -z "${KEYSTORE_FILE:-}" ]; then
    echo "✗ Для --release задайте KEYSTORE_FILE, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD"
    exit 1
  fi
  echo "→ Gradle: assembleRelease (подписанная)"
  KEYSTORE_FILE="$KEYSTORE_FILE" ./gradlew --no-daemon \
    -I ../.github/ci/signing.init.gradle assembleRelease
  echo "✓ APK: android/app/build/outputs/apk/release/app-release.apk"
else
  echo "→ Gradle: assembleDebug"
  ./gradlew --no-daemon assembleDebug
  echo "✓ APK: android/app/build/outputs/apk/debug/app-debug.apk"
  echo "  Установка: npx cap run android   (или adb install …)"
fi
