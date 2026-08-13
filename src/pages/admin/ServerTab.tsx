// ─────────────────────────────────────────────────────────────────────────────
// ServerTab.tsx — вкладка «Сервер расчёта» панели администратора: выбор
// активного расчётного сервера (основной / аварийный резерв), адрес резерва
// и автоматическое переключение при исчерпании лимита.
//
// Вынесено из Admin.tsx БЕЗ изменений разметки, текстов и обработчиков.
// ─────────────────────────────────────────────────────────────────────────────
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
}

export default function ServerTab({
  srvActive, setSrvActive, srvBackupUrl, setSrvBackupUrl,
  srvAutofail, setSrvAutofail, srvCfgLoading, srvCfgSaving,
  srvCfgOk, srvCfgErr, saveServerCfg,
}: ServerTabProps) {
  return (
  <div className="max-w-xl mx-auto">
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
              placeholder="https://functions.poehali.dev/..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[12px] font-mono focus:outline-none focus:border-blue-400" />
            <div className="text-[10px] text-gray-400 mt-1">
              Резервная функция расчёта на втором аккаунте/сервере.
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
  </div>
  );
}
