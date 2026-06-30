# Сборка PV-Sistema (Electron)

## Что нужно установить заранее (один раз)

1. **Node.js** — https://nodejs.org (LTS версия)
2. **Bun** — в командной строке:
   ```
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```
3. **Python** — https://python.org (нужен для сборки python-server)

---

## Шаг 1 — Подготовить Python-сервер

Если `desktop/server/dist/python-server.exe` уже есть — пропусти этот шаг.

Если нет — запусти:
```
cd desktop/server
pip install pyinstaller
pyinstaller --onefile main.py -n python-server
```
Файл появится в `desktop/server/dist/python-server.exe`

---

## Шаг 2 — Подготовить иконку

Положи файл `icon.ico` в папку `desktop/electron/icons/`

Если иконки нет — скопируй из Tauri:
```
copy desktop\tauri\icons\icon.ico desktop\electron\icons\icon.ico
```

---

## Шаг 3 — Установить зависимости (один раз)

```
bun install
```

---

## Шаг 4 — Собрать установщик

Просто запусти двойным кликом:
```
desktop\electron\build.bat
```

Или вручную из корня проекта:
```
bunx vite build --config vite.config.electron.ts
bunx electron-builder --config desktop/electron/electron-builder.yml --win --x64
```

Готовый установщик: `dist-installer/PV-Sistema Setup 1.0.0.exe`

---

## Автообновления

Чтобы работали автообновления:
1. Залей на свой сервер файлы из `dist-installer/`:
   - `PV-Sistema Setup 1.0.0.exe`
   - `latest.yml`
2. В `electron-builder.yml` укажи URL своего сервера:
   ```yaml
   publish:
     provider: generic
     url: https://твой-сайт.ru/releases/
   ```

Программа сама проверяет обновления при каждом запуске.

---

## Структура итогового установщика

```
PV-Sistema Setup 1.0.0.exe
  └── resources/
       ├── app/
       │   ├── dist-electron/       ← React фронтенд
       │   └── desktop/electron/    ← main.js, preload.js
       └── python-server.exe        ← Python бэкенд
```
