# Сборка ПВС-Система (pywebview + PyInstaller)

## Требования

- Windows 10/11
- Python 3.11: https://python.org/downloads
  - ✅ Обязательно: "Add Python to PATH"
- Node.js 20+: https://nodejs.org

---

## Пошаговая сборка

### Шаг 1 — Проверь что Python установлен
```cmd
python --version
```
Должно показать: `Python 3.11.x`

### Шаг 2 — Перейди в папку проекта
```cmd
cd C:\PVS
```

### Шаг 3 — Запусти сборку
```cmd
desktop\pywebview\build.bat
```

Скрипт автоматически:
1. Соберёт React-интерфейс (`npm run build`)
2. Установит Python-зависимости
3. Скопирует билд внутрь пакета
4. Соберёт `PVS.exe`

### Шаг 4 — Готовый файл
```
C:\PVS\desktop\pywebview\dist\PVS.exe
```

---

## Тест без сборки (для разработки)

```cmd
cd C:\PVS
npm run build
cd desktop\pywebview
pip install -r pvs-core\requirements.txt
xcopy /E /I ..\..\dist pvs-core\dist
python desktop_app.py
```

---

## Структура

```
desktop/pywebview/
├── desktop_app.py        ← точка входа (pywebview окно)
├── build.bat             ← скрипт сборки
├── pvs-core/
│   ├── server.py         ← Flask API сервер
│   ├── calc_aerodynamics.py
│   ├── calc_explosion.py
│   ├── requirements.txt
│   └── dist/             ← React-билд (копируется при сборке)
└── dist/
    └── PVS.exe           ← готовый файл
```

---

## Как работает

```
PVS.exe запускается
  └─► Flask-сервер на localhost:5173
        ├── /            → React-интерфейс (офлайн)
        ├── /api/aerodynamics    → расчёт локально
        ├── /api/airflow         → расчёт локально
        ├── /api/explosion-calculator → расчёт локально
        ├── /api/water-hydraulics     → расчёт локально
        ├── /api/rescue-calculator    → расчёт локально
        └── /api/license         → проверка ключа (облако, нужен интернет)
  └─► pywebview открывает нативное окно
```

Интернет нужен только для активации лицензии (один раз).
Все расчёты работают полностью офлайн.
