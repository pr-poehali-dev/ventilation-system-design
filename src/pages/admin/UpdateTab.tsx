// ─────────────────────────────────────────────────────────────────────────────
// UpdateTab.tsx — вкладка «Обновление» панели администратора: публикация
// установщика PVS.exe и расчётного ядра server.exe по публичной ссылке.
//
// Вынесено из Admin.tsx БЕЗ изменений разметки, текстов и обработчиков.
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";

interface UpdateTabProps {
  currentVersion: { version: string; notes: string; server_version?: string } | null;
  updVersion: string;
  setUpdVersion: (v: string) => void;
  updNotes: string;
  setUpdNotes: (v: string) => void;
  updUrl: string;
  setUpdUrl: (v: string) => void;
  updStatus: "idle" | "uploading" | "ok" | "err";
  setUpdStatus: (v: "idle" | "uploading" | "ok" | "err") => void;
  updErr: string;
  srvVersion: string;
  setSrvVersion: (v: string) => void;
  srvUrl: string;
  setSrvUrl: (v: string) => void;
  srvStatus: "idle" | "uploading" | "ok" | "err";
  setSrvStatus: (v: "idle" | "uploading" | "ok" | "err") => void;
  srvErr: string;
  handleUploadExeFromUrl: () => void;
  handleUploadServerFromUrl: () => void;
  inputCls: string;
}

export default function UpdateTab({
  currentVersion, updVersion, setUpdVersion, updNotes, setUpdNotes,
  updUrl, setUpdUrl, updStatus, setUpdStatus, updErr,
  srvVersion, setSrvVersion, srvUrl, setSrvUrl, srvStatus, setSrvStatus, srvErr,
  handleUploadExeFromUrl, handleUploadServerFromUrl, inputCls,
}: UpdateTabProps) {
  return (
  <div className="max-w-xl mx-auto">
    {/* Текущие версии */}
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="Info" size={16} className="text-blue-500" />
        <span className="font-semibold text-[13px]" style={{ color: "#1a3a6b" }}>Опубликованные версии</span>
      </div>
      {currentVersion ? (
        <div className="flex gap-8">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Установщик PVS.exe</div>
            <span className="text-[24px] font-bold text-green-600">{currentVersion.version}</span>
            {currentVersion.notes && <div className="text-[11px] text-gray-400 mt-0.5">{currentVersion.notes}</div>}
          </div>
          <div className="w-px bg-gray-200" />
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Расчётное ядро server.exe</div>
            <span className="text-[24px] font-bold text-blue-600">{currentVersion.server_version || "—"}</span>
            <div className="text-[11px] text-gray-400 mt-0.5">обновляется без переустановки</div>
          </div>
        </div>
      ) : (
        <span className="text-[12px] text-gray-400">Загрузка...</span>
      )}
    </div>

    {/* Форма загрузки установщика */}
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="Package" size={16} className="text-blue-500" />
        <span className="font-semibold text-[13px]" style={{ color: "#1a3a6b" }}>Новый установщик PVS-Setup.exe</span>
        <span className="text-[10px] text-gray-400 ml-1">— пользователи переустанавливают программу</span>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Номер версии</label>
            <input type="text" value={updVersion} onChange={e => { setUpdVersion(e.target.value); setUpdStatus("idle"); }}
              className={inputCls} placeholder="1.2.0" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Что нового</label>
            <input type="text" value={updNotes} onChange={e => setUpdNotes(e.target.value)}
              className={inputCls} placeholder="Новые функции..." />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Ссылка на файл</label>
          <input type="url" value={updUrl} onChange={e => { setUpdUrl(e.target.value); setUpdStatus("idle"); }}
            className={inputCls} placeholder="https://cdn.poehali.dev/.../PVS-Setup.exe" />
          <div className="text-[10px] text-gray-400 mt-1">Загрузите PVS-Setup.exe в Хранилище проекта (Ядро → Хранилище → Загрузить), скопируйте ссылку на файл и вставьте сюда. Также подойдёт публичная ссылка с Яндекс.Диска.</div>
        </div>
        {updStatus === "ok" && <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg px-4 py-3 text-[12px]"><Icon name="CheckCircle" size={16} />Версия опубликована! Пользователи получат обновление.</div>}
        {updStatus === "err" && <div className="flex items-start gap-2 text-red-700 bg-red-50 rounded-lg px-4 py-3 text-[12px]"><Icon name="AlertCircle" size={16} className="shrink-0 mt-0.5" />{updErr}</div>}
        <button type="button" onClick={handleUploadExeFromUrl} disabled={!updUrl.trim() || !updVersion || updStatus === "uploading"}
          className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2"
          style={{ background: "#1a3a6b" }}>
          {updStatus === "uploading" ? <><Icon name="Loader" size={14} className="animate-spin" />Публикация...</> : <><Icon name="Upload" size={14} />Опубликовать установщик</>}
        </button>
      </div>
    </div>

    {/* Форма загрузки server.exe */}
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="Cpu" size={16} className="text-purple-500" />
        <span className="font-semibold text-[13px]" style={{ color: "#1a3a6b" }}>Обновить расчётное ядро server.exe</span>
        <span className="text-[10px] text-gray-400 ml-1">— без переустановки у пользователей</span>
      </div>
      <div className="space-y-4">
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Версия ядра</label>
          <input type="text" value={srvVersion} onChange={e => { setSrvVersion(e.target.value); setSrvStatus("idle"); }}
            className={inputCls} placeholder="1.2.0" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Ссылка на файл</label>
          <input type="url" value={srvUrl} onChange={e => { setSrvUrl(e.target.value); setSrvStatus("idle"); }}
            className={inputCls} placeholder="https://cdn.poehali.dev/.../server.exe" />
          <div className="text-[10px] text-gray-400 mt-1">Загрузите server.exe в Хранилище проекта (Ядро → Хранилище → Загрузить), скопируйте ссылку на файл и вставьте сюда. Также подойдёт публичная ссылка с Яндекс.Диска.</div>
        </div>
        {srvStatus === "ok" && <div className="flex items-center gap-2 text-purple-700 bg-purple-50 rounded-lg px-4 py-3 text-[12px]"><Icon name="CheckCircle" size={16} />Ядро опубликовано! При следующем запуске пользователи получат обновление автоматически.</div>}
        {srvStatus === "err" && <div className="flex items-start gap-2 text-red-700 bg-red-50 rounded-lg px-4 py-3 text-[12px]"><Icon name="AlertCircle" size={16} className="shrink-0 mt-0.5" />{srvErr}</div>}
        <button type="button" onClick={handleUploadServerFromUrl} disabled={!srvUrl.trim() || !srvVersion || srvStatus === "uploading"}
          className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2"
          style={{ background: "#7c3aed" }}>
          {srvStatus === "uploading" ? <><Icon name="Loader" size={14} className="animate-spin" />Публикация...</> : <><Icon name="Cpu" size={14} />Обновить расчётное ядро</>}
        </button>
      </div>
    </div>
  </div>
  );
}
