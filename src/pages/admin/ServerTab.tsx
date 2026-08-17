// ─────────────────────────────────────────────────────────────────────────────
// ServerTab.tsx — вкладка «Сервер расчёта» панели администратора: выбор
// активного расчётного сервера (основной / аварийный резерв), адрес резерва
// и автоматическое переключение при исчерпании лимита.
//
// Вынесено из Admin.tsx БЕЗ изменений разметки, текстов и обработчиков.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import Icon from "@/components/ui/icon";

interface ServerTabProps {
  srvActive: "primary" | "backup";
  setSrvActive: (v: "primary" | "backup") => void;
  srvBackupUrl: string;
  setSrvBackupUrl: (v: string) => void;
  srvAutofail: boolean;
  setSrvAutofail: (v: boolean) => void;
  srvCfgLoading: boolean;
  srvCfgSaving: boolean;
  srvCfgOk: boolean;
  srvCfgErr: string;
  saveServerCfg: () => void;
  switchServer: (target: "primary" | "backup") => void;
}

export default function ServerTab({
  srvActive, setSrvActive, srvBackupUrl, setSrvBackupUrl,
  srvAutofail, setSrvAutofail, srvCfgLoading, srvCfgSaving,
  srvCfgOk, srvCfgErr, saveServerCfg, switchServer,
}: ServerTabProps) {
  const [pingState, setPingState] = useState<"idle" | "run" | "ok" | "fail">("idle");
  const [pingMsg, setPingMsg] = useState("");

  const pingBackup = async () => {
    const base = srvBackupUrl.trim().replace(/\/+$/, "");
    if (!base) return;
    setPingState("run");
    setPingMsg("");
    try {
      const res = await fetch(`${base}/health`, { method: "GET" });
      const j = await res.json();
      if (res.ok && j?.ok) {
        setPingState("ok");
        setPingMsg("Резервный сервер отвечает, все расчёты загружены");
      } else {
        setPingState("fail");
        const miss = Object.entries(j?.functions ?? {})
          .filter(([, v]) => !v).map(([k]) => k).join(", ");
        setPingMsg(miss
          ? `Сервер отвечает, но не найдены расчёты: ${miss}`
          : "Сервер ответил ошибкой");
      }
    } catch {
      setPingState("fail");
      setPingMsg("Нет ответа. Проверьте адрес, питание ПК и порт в брандмауэре");
    }
  };

  const onBackup = srvActive === "backup";

  return (
  <div className="max-w-xl mx-auto">
    {/* Текущий сервер + мгновенное ручное переключение */}
    <div className={`rounded-xl shadow-sm border p-4 mb-5 ${onBackup ? "bg-amber-50 border-amber-300" : "bg-green-50 border-green-300"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full ${onBackup ? "bg-amber-500" : "bg-green-500"} animate-pulse`} />
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase">Расчёты идут через</div>
            <div className={`text-[14px] font-bold ${onBackup ? "text-amber-700" : "text-green-700"}`}>
              {onBackup ? "Аварийный резервный сервер" : "Основной сервер"}
            </div>
          </div>
        </div>
        <button
          onClick={() => switchServer(onBackup ? "primary" : "backup")}
          disabled={srvCfgSaving || srvCfgLoading || (!onBackup && !srvBackupUrl.trim())}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-bold text-white shadow-sm disabled:opacity-50 transition-colors ${onBackup ? "bg-green-600 hover:bg-green-700" : "bg-amber-500 hover:bg-amber-600"}`}>
          {srvCfgSaving
            ? <><Icon name="Loader" size={14} className="animate-spin" />Переключаю...</>
            : <><Icon name="RefreshCw" size={14} />
                {onBackup ? "Вернуть на основной" : "Переключить на резерв"}</>}
        </button>
      </div>
      <div className="text-[10.5px] text-gray-500 mt-2">
        Переключение применяется сразу — все рабочие места подхватят его автоматически.
      </div>
    </div>

    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="Server" size={16} className="text-blue-500" />
        <span className="font-semibold text-[13px]" style={{ color: "#1a3a6b" }}>Расчётный сервер</span>
      </div>
      <p className="text-[11px] text-gray-400 mb-4">
        На случай, когда на основном сервере закончилось вычислительное время —
        переключите расчёты на аварийный резервный сервер. Все рабочие места
        подхватят изменение автоматически.
      </p>

      {srvCfgLoading ? (
        <span className="text-[12px] text-gray-400">Загрузка...</span>
      ) : (
        <div className="space-y-4">
          {/* Выбор активного сервера */}
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-2">Активный сервер</div>
            <div className="flex gap-2">
              <button onClick={() => setSrvActive("primary")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border transition-colors ${srvActive === "primary" ? "bg-green-600 text-white border-green-600" : "bg-white text-gray-600 border-gray-300 hover:border-green-400"}`}>
                <Icon name="CheckCircle2" size={14} />Основной
              </button>
              <button onClick={() => setSrvActive("backup")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border transition-colors ${srvActive === "backup" ? "bg-amber-500 text-white border-amber-500" : "bg-white text-gray-600 border-gray-300 hover:border-amber-400"}`}>
                <Icon name="LifeBuoy" size={14} />Аварийный резерв
              </button>
            </div>
            {srvActive === "backup" && !srvBackupUrl.trim() && (
              <div className="text-[11px] text-red-500 mt-1">Укажите адрес резервного сервера ниже</div>
            )}
          </div>

          {/* Адрес резервного сервера */}
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Адрес аварийного сервера (URL)</div>
            <input value={srvBackupUrl} onChange={e => setSrvBackupUrl(e.target.value)}
              placeholder="http://192.168.1.50:8800/"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[12px] font-mono focus:outline-none focus:border-blue-400" />
            <div className="text-[10px] text-gray-500 mt-1.5 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-2">
              Точный адрес показывает сам резервный сервер: в его окне после запуска
              есть строка <span className="font-mono">АДРЕС ДЛЯ АДМИН-ПАНЕЛИ</span> —
              скопируйте её сюда целиком (например <span className="font-mono">http://192.168.1.50:8800/</span>).
            </div>

            <div className="flex items-center gap-2 mt-2">
              <button onClick={pingBackup} disabled={!srvBackupUrl.trim() || pingState === "run"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-gray-300 text-gray-600 hover:border-blue-400 disabled:opacity-50">
                {pingState === "run"
                  ? <><Icon name="Loader" size={13} className="animate-spin" />Проверка...</>
                  : <><Icon name="Activity" size={13} />Проверить связь</>}
              </button>
              {pingState === "ok" && (
                <span className="text-[11px] text-green-600 flex items-center gap-1">
                  <Icon name="Check" size={13} />{pingMsg}
                </span>
              )}
              {pingState === "fail" && (
                <span className="text-[11px] text-red-500 flex items-center gap-1">
                  <Icon name="CircleAlert" size={13} />{pingMsg}
                </span>
              )}
            </div>
          </div>

          {/* Автопереключение */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={srvAutofail}
              onChange={e => setSrvAutofail(e.target.checked)}
              className="mt-0.5" />
            <span className="text-[12px] text-gray-700">
              Автоматически переходить на резерв
              <span className="block text-[10px] text-gray-400">
                Если основной сервер ответит ошибкой лимита или будет недоступен,
                программа сама повторит расчёт на резервном сервере.
              </span>
            </span>
          </label>

          {srvCfgErr && <div className="text-[12px] text-red-500">{srvCfgErr}</div>}
          {srvCfgOk && <div className="text-[12px] text-green-600 flex items-center gap-1"><Icon name="Check" size={14} />Сохранено</div>}

          <button onClick={saveServerCfg} disabled={srvCfgSaving || (srvActive === "backup" && !srvBackupUrl.trim())}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
            style={{ background: "#1a3a6b" }}>
            {srvCfgSaving ? <><Icon name="Loader" size={14} className="animate-spin" />Сохранение...</> : <><Icon name="Save" size={14} />Сохранить</>}
          </button>
        </div>
      )}
    </div>

    {/* Инструкция по развёртыванию резерва на своём ПК */}
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="BookOpen" size={16} className="text-blue-500" />
        <span className="font-semibold text-[13px]" style={{ color: "#1a3a6b" }}>
          Как поднять резерв на своём втором ПК
        </span>
      </div>
      <ol className="text-[11.5px] text-gray-600 space-y-2 list-decimal pl-4">
        <li>Скопируйте на второй ПК папку <span className="font-mono">backup-server</span> из
          комплекта программы (в ней уже лежат все расчётные модули).</li>
        <li>Установите Python 3.11 с python.org, отметив галочку
          «Add python.exe to PATH».</li>
        <li>Запустите <span className="font-mono">start.bat</span> — окно само поставит
          всё нужное и покажет список расчётов со статусом OK. Окно не закрывать.</li>
        <li>Откройте порт 8800 в брандмауэре Windows
          (Правила для входящих → Порт → TCP 8800 → Разрешить).</li>
        <li>Впишите сюда адрес <span className="font-mono">http://IP-второго-ПК:8800/</span> и
          нажмите «Проверить связь», затем «Сохранить».</li>
      </ol>
      <div className="text-[11px] text-gray-600 mt-3 space-y-1 border-t border-gray-100 pt-3">
        <div className="font-semibold text-[11.5px]" style={{ color: "#1a3a6b" }}>Управление сервером на втором ПК</div>
        <div><span className="font-mono">run.bat</span> — обычный запуск (после первой установки)</div>
        <div><span className="font-mono">stop.bat</span> — остановить сервер</div>
        <div><span className="font-mono">autostart.bat</span> — включить/выключить автозапуск вместе с Windows</div>
      </div>
      <div className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
        Если программа открыта по защищённому адресу (https), браузер не пустит запрос
        на обычный http-сервер. В этом случае используйте резерв из десктопной версии
        или поставьте перед сервером https-прокси.
      </div>
    </div>
  </div>
  );
}