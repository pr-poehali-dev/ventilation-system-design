import { useState } from "react";
import type { UseLicenseReturn } from "@/hooks/useLicense";
import Icon from "@/components/ui/icon";

interface Props {
  license: UseLicenseReturn;
  onClose: () => void;
  /** true = нельзя закрыть без ввода ключа (при первом запуске) */
  required?: boolean;
}

export default function LicenseDialog({ license, onClose, required }: Props) {
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
      setTimeout(() => onClose(), 1800);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка активации");
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (v: string) => {
    const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const parts: string[] = [];
    if (raw.startsWith("PVS")) {
      parts.push("PVS");
      const rest = raw.slice(3);
      for (let i = 0; i < rest.length && parts.length < 5; i += 4) parts.push(rest.slice(i, i + 4));
    } else {
      for (let i = 0; i < raw.length; i += 4) parts.push(raw.slice(i, i + 4));
    }
    setKey(parts.join("-"));
  };

  const isLicensed       = license.status === "licensed";
  const isExpired        = license.status === "offline_expired";
  const daysLeft         = license.info?.daysLeft;
  const isOffline        = license.info?.offline;
  const warnDaysLeft     = isOffline && typeof daysLeft === "number" && daysLeft <= 3;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[420px] mx-4 overflow-hidden">

        {/* Шапка */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ background: "linear-gradient(135deg,#1a3a6b 0%,#2563eb 100%)" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
              <Icon name="KeyRound" size={20} className="text-white" />
            </div>
            <div>
              <div className="text-white font-bold text-[14px]">ПВ-Система — Лицензия</div>
              <div className="text-blue-200 text-[11px]">
                {isLicensed ? (isOffline ? "Оффлайн-режим" : "Полная версия активна")
                  : isExpired ? "Требуется интернет"
                  : "Демо-режим"}
              </div>
            </div>
          </div>
          {(!required || isLicensed) && (
            <button onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/20 transition-colors">
              <Icon name="X" size={15} />
            </button>
          )}
        </div>

        <div className="p-5">
          {/* Кэш просрочен — нужен интернет */}
          {isExpired && (
            <div className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50">
              <div className="flex items-center gap-2 text-red-800 font-semibold text-[13px]">
                <Icon name="WifiOff" size={16} className="text-red-600" />
                Требуется подключение к интернету
              </div>
              <div className="mt-1.5 text-[12px] text-red-700">
                Прошло более 14 дней без проверки лицензии. Подключитесь к сети и перезапустите приложение.
              </div>
            </div>
          )}

          {/* Предупреждение — осталось мало дней offline */}
          {warnDaysLeft && (
            <div className="mb-4 p-3 rounded-lg border border-amber-300 bg-amber-50">
              <div className="flex items-center gap-2 text-amber-800 font-semibold text-[13px]">
                <Icon name="Clock" size={16} className="text-amber-600" />
                {daysLeft === 0
                  ? "Последний день offline-режима"
                  : `Offline-режим истекает через ${daysLeft} ${daysLeft === 1 ? "день" : "дня"}`}
              </div>
              <div className="mt-1 text-[11px] text-amber-700">
                Подключитесь к интернету для продления. Без подключения через{" "}
                {daysLeft === 0 ? "сегодня" : `${daysLeft} ${daysLeft === 1 ? "день" : "дня"}`} приложение
                перейдёт в демо-режим.
              </div>
            </div>
          )}

          {/* Активная лицензия */}
          {isLicensed && license.info && (
            <div className="mb-4 p-3 rounded-lg border border-green-200 bg-green-50">
              <div className="flex items-center gap-2 text-green-800 font-semibold text-[13px]">
                <Icon name="CheckCircle2" size={16} className="text-green-600" />
                {isOffline ? "Лицензия (оффлайн-режим)" : "Лицензия активирована"}
              </div>
              <div className="mt-2 space-y-1">
                <div className="text-[12px] text-green-700">Организация: <b>{license.info.owner}</b></div>
                <div className="text-[11px] text-green-600 font-mono">{license.info.key}</div>
                {license.info.seats && (
                  <div className="text-[11px] text-green-600">
                    Рабочих мест: {license.info.seats.used} / {license.info.seats.max}
                  </div>
                )}
                {isOffline && typeof daysLeft === "number" && (
                  <div className="text-[11px] text-amber-600">
                    Оффлайн-режим: осталось {daysLeft} {daysLeft === 1 ? "день" : daysLeft < 5 ? "дня" : "дней"}
                  </div>
                )}
              </div>
              <button onClick={() => { license.deactivate(); setDone(false); setKey(""); }}
                className="mt-3 text-[11px] text-red-500 hover:text-red-700 underline">
                Деактивировать на этом устройстве
              </button>
            </div>
          )}

          {/* Успех активации */}
          {done && (
            <div className="py-4 flex flex-col items-center gap-2 text-green-700">
              <Icon name="CheckCircle2" size={40} className="text-green-500" />
              <div className="text-[14px] font-semibold">Лицензия успешно активирована!</div>
              <div className="text-[12px] text-green-600">Все функции разблокированы.</div>
            </div>
          )}

          {/* Форма ввода ключа */}
          {!isLicensed && !done && (
            <>
              {/* Что ограничено */}
              <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50">
                <div className="text-[12px] font-semibold text-amber-800 mb-1.5">В демо-режиме недоступно:</div>
                <div className="text-[11px] text-amber-700 space-y-1">
                  <div className="flex items-center gap-1.5"><Icon name="AlertCircle" size={11} />Более 20 узлов в схеме</div>
                  <div className="flex items-center gap-1.5"><Icon name="AlertCircle" size={11} />Сохранение и открытие файлов (.vproj)</div>
                  <div className="flex items-center gap-1.5"><Icon name="AlertCircle" size={11} />Расчёты пожара и аварийного режима</div>
                  <div className="flex items-center gap-1.5"><Icon name="AlertCircle" size={11} />Функция печати и экспорта</div>
                  <div className="flex items-center gap-1.5"><Icon name="AlertCircle" size={11} />Водяной знак ДЕМО на схеме</div>
                </div>
              </div>

              <label className="block text-[12px] font-semibold text-gray-700 mb-1.5">
                Лицензионный ключ
              </label>
              <input
                type="text"
                value={key}
                onChange={e => { handleKey(e.target.value); setErr(null); }}
                placeholder="PVS-XXXX-XXXX-XXXX-XXXX"
                maxLength={23}
                className="w-full border rounded-lg px-3 py-2.5 text-[13px] font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-300"
                style={{ borderColor: err ? "#dc2626" : "#d1d5db" }}
                onKeyDown={e => e.key === "Enter" && handleActivate()}
                autoFocus
              />
              {err && (
                <div className="mt-1.5 text-[12px] text-red-600 flex items-center gap-1">
                  <Icon name="AlertCircle" size={13} />{err}
                </div>
              )}

              <button
                onClick={handleActivate}
                disabled={loading || key.length < 19}
                className="mt-3 w-full py-2.5 rounded-lg text-[13px] font-semibold text-white transition-opacity disabled:opacity-40"
                style={{ background: "#1a3a6b" }}>
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Icon name="Loader2" size={14} className="animate-spin" />Проверка ключа...
                  </span>
                ) : "Активировать лицензию"}
              </button>
            </>
          )}

          <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
            {required && !isLicensed && !done && (
              <button onClick={onClose}
                className="text-[11px] text-gray-400 hover:text-gray-600 underline">
                Продолжить в демо-режиме
              </button>
            )}
            <div className="text-[10px] text-gray-400 ml-auto">
              Для приобретения: пв-система.рф
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}