"""
Аппаратный отпечаток машины для привязки лицензии.
Работает на Windows и Linux без сторонних пакетов.

Собирает: MAC-адрес, hostname, CPU-счётчик, серийник диска (Windows),
          machine-id (Linux), кол-во ядер, платформу.
Результат — SHA256-хеш из нескольких источников.
"""
import os
import sys
import uuid
import socket
import hashlib
import platform
import subprocess


# ─── Сбор компонентов отпечатка ───────────────────────────────────────────────

def _get_mac() -> str:
    """MAC первого сетевого интерфейса (не меняется при переустановке ОС)."""
    try:
        raw = uuid.getnode()
        if raw >> 40 & 0x01:  # multicast-бит = сгенерированный, ненадёжный
            return "nomac"
        return ":".join(f"{(raw >> (8*i)) & 0xff:02x}" for i in range(5, -1, -1))
    except Exception:
        return "nomac"


def _get_hostname() -> str:
    try:
        return socket.gethostname().lower().strip()
    except Exception:
        return "nohost"


def _get_cpu_count() -> str:
    try:
        return str(os.cpu_count() or 0)
    except Exception:
        return "0"


def _get_platform() -> str:
    try:
        return platform.system().lower()  # "windows" / "linux" / "darwin"
    except Exception:
        return "unknown"


def _get_machine_id_linux() -> str:
    """
    /etc/machine-id — уникальный ID машины, генерируется при установке ОС.
    Стабилен, не зависит от сети. Не меняется при обновлении ОС.
    """
    for path in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            with open(path, "r") as f:
                val = f.read().strip()
                if val and len(val) >= 8:
                    return val
        except Exception:
            continue
    return "no-machine-id"


def _get_disk_serial_windows() -> str:
    """
    Серийный номер системного диска (Windows).
    Получается через wmic — не требует прав администратора.
    """
    try:
        result = subprocess.check_output(
            ["wmic", "diskdrive", "get", "SerialNumber"],
            timeout=5,
            stderr=subprocess.DEVNULL,
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        ).decode(errors="ignore")
        lines = [l.strip() for l in result.splitlines() if l.strip() and l.strip() != "SerialNumber"]
        if lines:
            return lines[0]
    except Exception:
        pass

    # Запасной вариант — серийник тома C:
    try:
        result = subprocess.check_output(
            ["vol", "C:"],
            shell=True,
            timeout=5,
            stderr=subprocess.DEVNULL,
        ).decode(errors="ignore")
        for line in result.splitlines():
            if "Serial" in line or "серийн" in line.lower():
                parts = line.strip().split()
                if parts:
                    return parts[-1]
    except Exception:
        pass

    return "no-disk-serial"


def _get_cpu_id_windows() -> str:
    """ProcessorId из WMI — стабилен между переустановками ОС."""
    try:
        result = subprocess.check_output(
            ["wmic", "cpu", "get", "ProcessorId"],
            timeout=5,
            stderr=subprocess.DEVNULL,
            creationflags=0x08000000,
        ).decode(errors="ignore")
        lines = [l.strip() for l in result.splitlines() if l.strip() and l.strip() != "ProcessorId"]
        if lines:
            return lines[0]
    except Exception:
        pass
    return "no-cpu-id"


def _get_motherboard_windows() -> str:
    """Серийник материнской платы."""
    try:
        result = subprocess.check_output(
            ["wmic", "baseboard", "get", "SerialNumber"],
            timeout=5,
            stderr=subprocess.DEVNULL,
            creationflags=0x08000000,
        ).decode(errors="ignore")
        lines = [l.strip() for l in result.splitlines() if l.strip() and l.strip() != "SerialNumber"]
        if lines and lines[0] not in ("To Be Filled By O.E.M.", "Default string", ""):
            return lines[0]
    except Exception:
        pass
    return "no-mb-serial"


def _get_cpu_id_linux() -> str:
    """/proc/cpuinfo — serial (Raspberry Pi) или собираем из model name."""
    try:
        with open("/proc/cpuinfo", "r") as f:
            content = f.read()
        for line in content.splitlines():
            if "Serial" in line and ":" in line:
                val = line.split(":")[1].strip()
                if val and val != "0000000000000000":
                    return val
        # Берём model name первого ядра
        for line in content.splitlines():
            if "model name" in line.lower() and ":" in line:
                return line.split(":")[1].strip()[:64]
    except Exception:
        pass
    return "no-cpu-id-linux"


# ─── Сборка итогового отпечатка ───────────────────────────────────────────────

def get_hardware_fingerprint() -> str:
    """
    Возвращает SHA256-хеш аппаратных характеристик машины.
    Стабилен между перезапусками приложения.
    Меняется при замене материнской платы, жёсткого диска или MAC-адреса.
    """
    components = [
        _get_mac(),
        _get_hostname(),
        _get_cpu_count(),
        _get_platform(),
    ]

    system = platform.system().lower()

    if system == "windows":
        components += [
            _get_disk_serial_windows(),
            _get_cpu_id_windows(),
            _get_motherboard_windows(),
        ]
    elif system == "linux":
        components += [
            _get_machine_id_linux(),
            _get_cpu_id_linux(),
        ]
    else:
        # macOS и другие — MAC + hostname достаточно
        pass

    raw = "||".join(components)
    return hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()


def get_machine_summary() -> dict:
    """Краткое описание машины для логов (без секретных данных)."""
    return {
        "hostname": _get_hostname(),
        "platform": _get_platform(),
        "cpu_count": _get_cpu_count(),
        "mac_prefix": _get_mac()[:8] if _get_mac() != "nomac" else "n/a",
    }
