"""
Проверка целостности и защита от взлома.
Используется Python-сервером при старте.
"""
import os
import sys
import json
import hashlib
import hmac
import time

# Секрет для подписи лицензионного кэша (не хранится в открытом виде — XOR)
_KEY_PARTS = [0x50, 0x56, 0x53, 0x2d, 0x49, 0x4e, 0x54, 0x47]  # "PVS-INTG"
SECRET = bytes(b ^ 0x1F for b in _KEY_PARTS).decode()


def _sign(data: dict) -> str:
    """HMAC-SHA256 подпись словаря."""
    payload = json.dumps(data, sort_keys=True, ensure_ascii=True)
    return hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def save_cache_signed(path: str, data: dict):
    """Сохраняет кэш с подписью."""
    sig = _sign(data)
    envelope = {"data": data, "sig": sig, "ts": int(time.time())}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(envelope, f, ensure_ascii=False)


def load_cache_signed(path: str) -> dict | None:
    """
    Загружает и проверяет подпись кэша.
    Возвращает None если файл подделан или отсутствует.
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            envelope = json.load(f)
        data = envelope.get("data", {})
        expected_sig = _sign(data)
        actual_sig = envelope.get("sig", "")
        # Сравнение через hmac.compare_digest — защита от timing-атак
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        return data
    except Exception:
        return None


def check_exe_integrity() -> bool:
    """
    Проверяет что бинарник python-server не модифицирован.
    Сравнивает SHA256 текущего exe с эталонным значением из .sig файла.
    """
    if getattr(sys, "frozen", False):
        exe_path = sys.executable
        sig_path = exe_path + ".sig"
        if not os.path.exists(sig_path):
            return True  # Первый запуск — сохраняем подпись
        try:
            with open(exe_path, "rb") as f:
                actual_hash = hashlib.sha256(f.read()).hexdigest()
            with open(sig_path, "r") as f:
                expected = json.load(f)
            stored_hash = expected.get("hash", "")
            stored_sig = expected.get("sig", "")
            # Проверяем что .sig не подделан
            check = {"hash": stored_hash}
            if not hmac.compare_digest(_sign(check), stored_sig):
                return False
            return hmac.compare_digest(actual_hash, stored_hash)
        except Exception:
            return False
    return True


def write_exe_signature():
    """Записывает SHA256 текущего exe при первом запуске."""
    if getattr(sys, "frozen", False):
        exe_path = sys.executable
        sig_path = exe_path + ".sig"
        if not os.path.exists(sig_path):
            try:
                with open(exe_path, "rb") as f:
                    h = hashlib.sha256(f.read()).hexdigest()
                payload = {"hash": h}
                sig = _sign(payload)
                with open(sig_path, "w") as f:
                    json.dump({"hash": h, "sig": sig}, f)
            except Exception:
                pass
