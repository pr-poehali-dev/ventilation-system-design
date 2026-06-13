import { useState } from "react";
import type { UseLicenseReturn } from "@/hooks/useLicense";

interface Props {
  license: UseLicenseReturn;
  onClose: () => void;
}

export default function LicenseDialog({ license, onClose }: Props) {
  const [key, setKey]         = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const [done, setDone]       = useState(false);

  const handleActivate = async () => {
    const k = key.trim().toUpperCase();
    if (!k) return;
    setLoading(true);
    setErr(null);
    try {
      await license.activate(k);
      setDone(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка активации");
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (v: string) => {
    // Авто-форматирование PVS-XXXX-XXXX-XXXX-XXXX
    const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const parts: string[] = [];
    if (raw.startsWith("PVS")) {
      parts.push("PVS");
      const rest = raw.slice(3);
      for (let i = 0; i < rest.length && parts.length < 5; i += 4) {
        parts.push(rest.slice(i, i + 4));
      }
    } else {
      for (let i = 0; i < raw.length; i += 4) parts.push(raw.slice(i, i + 4));
    }
    setKey(parts.join("-"));
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6 mx-4">
        {/* Заголовок */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold" style={{ color: "#1a3a6b" }}>
              ПВ-Система — Лицензия
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {license.status === "licensed"
                ? "Лицензия активна"
                : "Демо-режим: до 20 узлов, без расчётов аварий"}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* Статус активной лицензии */}
        {license.status === "licensed" && license.info && (
          <div className="mb-4 p-3 rounded" style={{ background: "#f0fdf4", border: "1px solid #86efac" }}>
            <div className="text-sm font-semibold text-green-800">✓ Лицензия активирована</div>
            <div className="text-xs text-green-700 mt-1">Организация: <b>{license.info.owner}</b></div>
            <div className="text-xs text-green-700">Ключ: <code className="font-mono">{license.info.key}</code></div>
            {license.info.seats && (
              <div className="text-xs text-green-700">
                Рабочих мест: {license.info.seats.used} / {license.info.seats.max}
              </div>
            )}
            <button
              onClick={() => { license.deactivate(); setDone(false); setKey(""); }}
              className="mt-2 text-xs text-red-500 hover:text-red-700 underline"
            >
              Деактивировать на этом устройстве
            </button>
          </div>
        )}

        {/* Форма активации (только для демо или после успеха) */}
        {(license.status !== "licensed" || done) && !done && (
          <>
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Лицензионный ключ
              </label>
              <input
                type="text"
                value={key}
                onChange={e => handleKey(e.target.value)}
                placeholder="PVS-XXXX-XXXX-XXXX-XXXX"
                maxLength={23}
                className="w-full border rounded px-3 py-2 text-sm font-mono"
                style={{ borderColor: err ? "#dc2626" : "#d1d5db" }}
                onKeyDown={e => e.key === "Enter" && handleActivate()}
              />
              {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
            </div>
            <button
              onClick={handleActivate}
              disabled={loading || key.length < 19}
              className="w-full py-2 rounded text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "#1a3a6b" }}
            >
              {loading ? "Проверка..." : "Активировать"}
            </button>
          </>
        )}

        {done && (
          <div className="p-3 rounded text-center" style={{ background: "#f0fdf4", border: "1px solid #86efac" }}>
            <div className="text-green-700 font-semibold">✓ Лицензия успешно активирована!</div>
            <div className="text-xs text-green-600 mt-1">Все функции разблокированы.</div>
            <button
              onClick={onClose}
              className="mt-3 px-4 py-1.5 rounded text-sm text-white"
              style={{ background: "#16a34a" }}
            >
              Продолжить работу
            </button>
          </div>
        )}

        {/* Демо-режим: что ограничено */}
        {license.status !== "licensed" && !done && (
          <div className="mt-4 p-3 rounded text-xs text-gray-600" style={{ background: "#fef3c7", border: "1px solid #fcd34d" }}>
            <b className="text-yellow-800">Демо-режим включает:</b>
            <ul className="mt-1 space-y-0.5 list-disc list-inside text-yellow-900">
              <li>До 20 узлов в схеме</li>
              <li>Базовый расчёт воздухораспределения</li>
              <li>Без расчётов пожара и взрыва</li>
              <li>Водяной знак на схеме</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
