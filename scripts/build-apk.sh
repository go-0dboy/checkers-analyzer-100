#!/usr/bin/env bash
# ============================================================
# Локальная сборка Android-APK «СтоКлетки» через Capacitor.
#
# Требования: Node >= 22, JDK 21 (Capacitor 7), Android SDK.
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

if [ ! -x node_modules/.bin/cap ]; then
  echo "✗ @capacitor/cli не найден: npm i -S @capacitor/cli @capacitor/core @capacitor/android"
  exit 1
fi

if [ ! -d android ]; then
  echo "→ android/ отсутствует — создаю нативный шаблон"
  node_modules/.bin/cap add android
fi

echo "→ Синхронизация веб-ассетов с нативным проектом"
node_modules/.bin/cap sync android

echo "→ Фирменные иконки (resources/icon.svg)"
node scripts/apply-icons.mjs

# --- фирменные иконки (если есть ImageMagick) ---
ICON=assets/app-icon.svg
RES=android/app/src/main/res
if [ -f "$ICON" ] && command -v convert >/dev/null 2>&1; then
  echo "→ Установка фирменных иконок"
  convert -background none "$ICON" -resize 48x48   "$RES/mipmap-mdpi/ic_launcher.png"
  convert -background none "$ICON" -resize 72x72   "$RES/mipmap-hdpi/ic_launcher.png"
  convert -background none "$ICON" -resize 96x96   "$RES/mipmap-xhdpi/ic_launcher.png"
  convert -background none "$ICON" -resize 144x144 "$RES/mipmap-xxhdpi/ic_launcher.png"
  convert -background none "$ICON" -resize 192x192 "$RES/mipmap-xxxhdpi/ic_launcher.png"
  for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
    cp "$RES/mipmap-$d/ic_launcher.png" "$RES/mipmap-$d/ic_launcher_round.png"
  done
  rm -f "$RES/drawable/ic_launcher_foreground.xml"
  mkdir -p "$RES/drawable-xxxhdpi"
  convert -background none "$ICON" -resize 432x432 "$RES/drawable-xxxhdpi/ic_launcher_fg.png"
  cat > "$RES/mipmap-anydpi-v26/ic_launcher.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@drawable/ic_launcher_fg"/>
</adaptive-icon>
EOF
  cp "$RES/mipmap-anydpi-v26/ic_launcher.xml" "$RES/mipmap-anydpi-v26/ic_launcher_round.xml"
  cat > "$RES/values/ic_launcher_background.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#0B1416</color>
</resources>
EOF
else
  echo "⚠ ImageMagick (convert) не найден или нет assets/app-icon.svg — стандартные иконки"
fi

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
