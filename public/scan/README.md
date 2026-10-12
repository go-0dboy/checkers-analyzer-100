# Scan 3.1 Hub / WebAssembly

Сборка включает `scan.js`, `scan.wasm`, `manifest.json`, GPLv3-лицензию.
`manifest.json` описывает протокол, режим оценки, исходный commit и Emscripten.
Она запускается адаптером в Worker и подтверждает готовность ответом `ready`.
Команды Hub: `hub`, `set-param`, `init`, `pos`, `level`, `go think`.
Ответы: `info depth=... score=... pv="..."` и `done move=...`.
Суффикс Hub-взятия перечисляет снятые фигуры, а не поля приземления.

Исходники Scan 3.1 (Fabien Letouzey), адаптация для WASM:
https://github.com/RoepStoep/scan-wasm/tree/cbb251eff7051252ad0617fc03089bb51ce1be10

Pattern-веса и GPLv3:
https://github.com/rhalbersma/scan/tree/7aae17e7b7bfc47744601afb1ee7655e18983ce5

SHA-256 `data/eval`:
`0e7161c38af605f5e367f3f8fe17525d1c40db722714c68921971b386e58abba`

Полный рецепт: `scripts/build-scan.sh`, Emscripten 4.0.20.
Изменения C++ в скрипте: `eval_init()` вызывается только при pattern-оценке;
PST-сборка не пытается читать отсутствующие веса; единственный легальный ход завершает Hub-запрос через `after_search`; между итерациями проверяется лимит времени, удалённый в исходной WASM-адаптации.
Исходный GPLv3-текст: `LICENSE-Scan.txt`. Эта сборка Scan распространяется по GPLv3.
Скрипт получает точные исходники и позволяет воспроизвести артефакты.

По умолчанию используется pattern. `SCAN_PST_ONLY=1` создаёт облегченную,
более слабую PST-сборку. Базы окончаний в обоих режимах отключены.
При ошибке или отсутствии модулей приложение переключается на встроенный поиск.
