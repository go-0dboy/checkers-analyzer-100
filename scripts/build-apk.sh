#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MODE=debug
case "${1:-}" in
  '') ;;
  --release) MODE=release ;;
  *) echo 'Использование: bash scripts/build-apk.sh [--release]'; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo 'Слишком много аргументов'; exit 2; }
[ -x node_modules/.bin/cap ] || { echo 'Сначала выполните npm ci'; exit 1; }
command -v java >/dev/null || { echo 'Требуется JDK 21'; exit 1; }
JAVA_MAJOR="$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)"
[ "${JAVA_MAJOR:-0}" -ge 21 ] || { echo 'Capacitor 8 требует JDK 21 или новее'; exit 1; }
[ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || { echo 'Укажите ANDROID_HOME (Android SDK 36)'; exit 1; }
SIGN_ARGS=()
KEYSTORE_TEMP=''
trap '[ -z "$KEYSTORE_TEMP" ] || rm -f "$KEYSTORE_TEMP"' EXIT
if [ "$MODE" = release ]; then
  : "${ANDROID_KEYSTORE_BASE64:?Для release нужен ANDROID_KEYSTORE_BASE64}"
  : "${ANDROID_KEYSTORE_PASSWORD:?Для release нужен ANDROID_KEYSTORE_PASSWORD}"
  : "${ANDROID_KEY_ALIAS:?Для release нужен ANDROID_KEY_ALIAS}"
  : "${ANDROID_KEY_PASSWORD:?Для release нужен ANDROID_KEY_PASSWORD}"
  umask 077
  KEYSTORE_TEMP="$(mktemp)"
  export KEYSTORE_FILE="$KEYSTORE_TEMP" KEYSTORE_PASSWORD="$ANDROID_KEYSTORE_PASSWORD" KEY_ALIAS="$ANDROID_KEY_ALIAS" KEY_PASSWORD="$ANDROID_KEY_PASSWORD"
  python3 - <<'PY'
import base64, os
from pathlib import Path
Path(os.environ['KEYSTORE_FILE']).write_bytes(base64.b64decode(os.environ['ANDROID_KEYSTORE_BASE64'],validate=True))
PY
  SIGN_ARGS=(-I "$ROOT/.github/ci/signing.init.gradle")
fi
npm run typecheck
npm test
node scripts/apply-icons.mjs
npm run build
[ -d android ] || node_modules/.bin/cap add android
node_modules/.bin/cap sync android
node scripts/apply-icons.mjs
# Match web/package versions in the APK and generate a monotonic CI versionCode.
python3 - <<'PY'
import json, os, re
from pathlib import Path
p=Path('android/app/build.gradle');s=p.read_text()
version=json.loads(Path('package.json').read_text())['version']
code=int(os.environ.get('GITHUB_RUN_NUMBER','1'))
s=re.sub(r'versionCode \d+',f'versionCode {code}',s)
s=re.sub(r'versionName "[^"]+"',f'versionName "{version}"',s)
p.write_text(s)
PY
TASK=assembleDebug
[ "$MODE" != release ] || TASK=assembleRelease
(cd android && ./gradlew "${SIGN_ARGS[@]}" "$TASK" --no-daemon)
echo "APK: android/app/build/outputs/apk/$MODE/"
