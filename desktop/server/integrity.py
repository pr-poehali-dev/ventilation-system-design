"""
Проверка целостности и защита от взлома.
Используется Python-сервером при старте.

Уровни защиты:
  1. HMAC-SHA256 подпись лицензионного кэша — ручная правка файла не поможет
  2. SHA256 подпись бинарника — модифицированный exe не запустится
  3. Привязка кэша к железу — копирование папки на другую машину не поможет
"""
import os
import sys
import json
import hashlib
import hmac
import time

from machine_id import get_hardware_fingerprint

# ─── HMAC-секрет ─────────────────────────────────────────────────────────────
# Не хранится в открытом виде — восстанавливается через XOR при старте
_KEY_PARTS = [0x50, 0x56, 0x53, 0x2d, 0x49, 0x4e, 0x54, 0x47]  # "PVS-INTG"
SECRET = bytes(b ^ 0x1F for b in _KEY_PARTS).decode()


# ─── Внутренние функции ───────────────────────────────────────────────────────

def _sign(data: dict) -> str:
    """HMAC-SHA256 подпись словаря."""
    payload = json.dumps(data, sort_keys=True, ensure_ascii=True)
    return hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _machine_fp() -> str:
    """Кэшируем отпечаток машины в рамках процесса."""
    if not hasattr(_machine_fp, "_cache"):
        _machine_fp._cache = get_hardware_fingerprint()
    return _machine_fp._cache


# ─── Подписанный кэш с привязкой к железу ────────────────────────────────────

def save_cache_signed(path: str, data: dict):
    """
    Сохраняет кэш с двойной защитой:
    - HMAC-SHA256 подпись данных (ручная правка → подпись не совпадёт)
    - Аппаратный отпечаток машины вшит в подпись (копирование на другой ПК → подпись не совпадёт)
    """
    machine = _machine_fp()
    # Смешиваем данные с отпечатком машины перед подписью
    payload_with_machine = {**data, "__hw__": machine}
    sig = _sign(payload_with_machine)
    envelope = {
        "data": data,
        "sig": sig,
        "ts": int(time.time()),
        # Сохраняем первые 8 символов отпечатка для диагностики (не секрет)
        "hw_hint": machine[:8],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(envelope, f, ensure_ascii=False)


def load_cache_signed(path: str) -> dict | None:
    """
    Загружает и проверяет кэш.
    Возвращает None если:
    - файл подделан (HMAC не совпадает)
    - файл скопирован с другой машины (железо не совпадает)
    - файл отсутствует или повреждён
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            envelope = json.load(f)

        data = envelope.get("data", {})
        stored_sig = envelope.get("sig", "")

        # Воспроизводим подпись с текущим железом
        machine = _machine_fp()
        payload_with_machine = {**data, "__hw__": machine}
        expected_sig = _sign(payload_with_machine)

        # Сравнение через hmac.compare_digest — защита от timing-атак
        if not hmac.compare_digest(expected_sig, stored_sig):
            # Подпись не совпала — файл подделан или это другая машина
            _log_tamper_attempt(path, envelope.get("hw_hint", "?"), machine[:8])
            return None

        return data

    except Exception:
        return None


def _log_tamper_attempt(path: str, expected_hint: str, actual_hint: str):
    """Логирует попытку использования чужого/подделанного кэша."""
    try:
        log_path = os.path.join(os.path.dirname(path), "security.log")
        entry = {
            "ts": int(time.time()),
            "event": "cache_tamper_or_machine_mismatch",
            "cache_file": os.path.basename(path),
            "expected_hw_hint": expected_hint,
            "actual_hw_hint": actual_hint,
        }
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


# ─── Целостность бинарника ────────────────────────────────────────────────────

def check_exe_integrity() -> bool:
    """
    Проверяет что python-server.exe не модифицирован после первого запуска.
    SHA256 бинарника сравнивается с подписанным эталоном из .sig файла.
    """
    if not getattr(sys, "frozen", False):
        return True  # В dev-режиме пропускаем

    exe_path = sys.executable
    sig_path = exe_path + ".sig"

    if not os.path.exists(sig_path):
        return True  # Первый запуск — подпись запишется в write_exe_signature()

    try:
        with open(exe_path, "rb") as f:
            actual_hash = hashlib.sha256(f.read()).hexdigest()

        with open(sig_path, "r") as f:
            expected = json.load(f)

        stored_hash = expected.get("hash", "")
        stored_sig  = expected.get("sig", "")

        # Проверяем что сам .sig файл не подделан
        check_payload = {"hash": stored_hash}
        if not hmac.compare_digest(_sign(check_payload), stored_sig):
            return False

        # Проверяем хеш бинарника
        return hmac.compare_digest(actual_hash, stored_hash)

    except Exception:
        return False


def write_exe_signature():
    """Записывает SHA256 текущего exe при первом запуске."""
    if not getattr(sys, "frozen", False):
        return

    exe_path = sys.executable
    sig_path = exe_path + ".sig"

    if os.path.exists(sig_path):
        return  # Уже записана

    try:
        with open(exe_path, "rb") as f:
            h = hashlib.sha256(f.read()).hexdigest()
        payload = {"hash": h}
        sig = _sign(payload)
        with open(sig_path, "w") as f:
            json.dump({"hash": h, "sig": sig}, f)
    except Exception:
        pass


# ─── Диагностика (для логов, не для UI) ──────────────────────────────────────

def get_machine_info_for_log() -> dict:
    """Возвращает безопасные данные о машине для логирования."""
    fp = _machine_fp()
    return {
        "hw_fingerprint_prefix": fp[:16],
        "platform": sys.platform,
    }
