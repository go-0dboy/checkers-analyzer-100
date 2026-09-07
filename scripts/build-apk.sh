#!/usr/bin/env bash
set -e

# Проверка наличия Capacitor CLI
if [ ! -x node_modules/.bin/cap ]; then
  echo "Error: @capacitor/cli не установлен. Добавьте в зависимости:"
  echo "npm i -S @capacitor/cli @capacitor/core @capacitor/android"
  echo "и закоммитьте package.json + package-lock.json"
  exit 1
fi

# Проверка наличия capacitor.config.json
if [ ! -f capacitor.config.json ]; then
  echo "Error: capacitor.config.json не найден"
  exit 1
fi

# Сборка веб-приложения
echo "Building web app..."
npm run build

# Добавление Android платформы (если ещё не добавлена)
if [ ! -d android ]; then
  echo "Adding Android platform..."
  node_modules/.bin/cap add android
fi

# Синхронизация веб-ресурсов с нативным проектом
echo "Syncing web assets..."
node_modules/.bin/cap sync android

# Сборка APK
echo "Building APK..."
cd android
./gradlew assembleDebug

echo "APK built successfully: android/app/build/outputs/apk/debug/app-debug.apk"
