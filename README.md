# СтоКлетка — анализатор международных шашек

Веб-приложение (основа для iOS/Android) для анализа партий в международные шашки
на 100-клеточной доске по правилам ФМЖД:

- **Доска 10×10** с нумерацией полей 1–50 и координатами a–j / 1–10
- **Строгие правила ФМЖД**: обязательное взятие (вперёд и назад), правило
  большинства, летающие дамки, превращение в дамку только при остановке на
  последней горизонтали
- **Компьютерный анализ**: встроенный офлайн-движок (альфа-бета, итеративное
  углубление, хеш-таблица) — оценка позиции, глубина, лучший ход, главная
  линия, варианты-кандидаты
- **Навигация по партии**: в начало / назад / автопроигрывание / вперёд /
  в конец, ветвление с середины партии, стрелка лучшего хода
- **Форматы**: FEN (100-клеточный) и PDN — загрузка, копирование, скачивание;
  автосохранение в localStorage
- **Нативная сборка APK** через git (Capacitor + GitHub Actions, Node ≥ 22)

## Стек

Vite 6 · React 18 · TypeScript 5 · Tailwind CSS 4 · Capacitor 7 (Android)

## Требования

| Компонент   | Версия                |
|-------------|-----------------------|
| **Node.js** | **≥ 22** (см. `.nvmrc`) |
| JDK         | **21** (требование Capacitor 7; только для сборки APK) |
| Android SDK | любой современный (только для локальной сборки APK) |

## Быстрый старт

```bash
nvm use            # подхватит Node 22 из .nvmrc
npm install
npm run dev        # локальная разработка
npm run build      # продакшен-сборка в dist/
npm run typecheck  # проверка типов
```

## Подготовка git-репозитория

Проект полностью готов к git: `.gitignore` (зависимости, артефакты, ключи),
`.gitattributes` (LF для gradlew/shell, бинарники), `.nvmrc`, `.editorconfig`.

```bash
git init
git add .
git commit -m "feat: MVP анализатора международных шашек + сборка APK через CI"

git branch -M main
git remote add origin git@github.com:USER/stokeletka.git
git push -u origin main        # первый пуш запустит сборку APK
```

## Сборка APK

### Через git (GitHub Actions) — основной способ

Workflow `.github/workflows/build-apk.yml` собирает нативный Android-APK:

| Событие                    | Результат |
|----------------------------|-----------|
| пуш в `main` / `master`    | debug-APK в артефактах прогона (Actions → Run → Artifacts) |
| пуш тега `v*` (например `v1.0.0`) | debug + подписанный release-APK, прикрепляются к **GitHub Release** |
| ручной запуск              | вкладка Actions → «Android APK» → Run workflow |

Конвейер: Node **22** (`setup-node`) → `npm ci` → `typecheck` → `vite build` →
`npx cap add/sync android` → JDK 21 → Gradle `assembleDebug`/`assembleRelease`.

Папку `android/` коммитить **не обязательно** — при её отсутствии CI создаёт
нативный шаблон командой `npx cap add android`. Если хотите управлять
нативными настройками (иконки, разрешения, версия SDK) — выполните
`npx cap add android` локально, настройте и закоммитьте папку: CI использует
её как есть.

### Релизная подпись (секреты репозитория)

Без секретов собирается только debug-APK. Для подписанного release добавьте
в Settings → Secrets and variables → Actions:

| Секрет                     | Содержание |
|----------------------------|------------|
| `ANDROID_KEYSTORE_BASE64`  | `base64 -w0 release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD`| пароль хранилища |
| `ANDROID_KEY_ALIAS`        | алиас ключа |
| `ANDROID_KEY_PASSWORD`     | пароль ключа |

Генерация ключа:

```bash
keytool -genkeypair -v -keystore release.keystore -alias stokeletka \
  -keyalg RSA -keysize 2048 -validity 10000
```

### Локально

```bash
bash scripts/build-apk.sh              # debug-APK
bash scripts/build-apk.sh --release    # подписанный release (нужны KEYSTORE_*)
npx cap run android                    # сразу на устройство/эмулятор
```

Скрипт проверяет Node ≥ 22, собирает веб-бандл, синхронизирует его с
нативным проектом и запускает Gradle.

## Структура проекта

```
src/engine/core.ts            правила ФМЖД: генерация ходов, взятия большинства,
                              летающие дамки, FEN, нотация 1-50
src/engine/search.ts          движок: альфа-бета, итеративное углубление, ТТ
src/engine/pdn.ts             разбор и генерация PDN, пример партии
src/state/useGame.ts          состояние партии, навигация, ввод, движок, персист
src/components/BoardView.tsx  доска, шашки, стрелки, шкала оценки
src/components/AnalysisPanel  вывод анализа, кандидаты, настройки глубины
src/components/MovePanel      навигация и лента ходов
src/components/FormatsPanel   FEN/PDN: загрузка, копирование, скачивание
src/components/IntegrationDocs справочник по Scan / KingsRow / Liens
.github/workflows/build-apk.yml  CI: нативная сборка APK (Node 22)
.github/ci/signing.init.gradle   релизная подпись в CI
scripts/build-apk.sh          локальная сборка APK
capacitor.config.json         конфигурация нативной обёртки
```

## Дорожная карта

- Замена встроенного α-β на **Scan** (WASM в Web Worker, рецепт lidraughts/scan.js)
- Эндшпильные базы **Liens** через облако
- Дамочное правило «25 ходов» в турнирном слое
