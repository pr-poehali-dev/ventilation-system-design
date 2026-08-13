// ─────────────────────────────────────────────────────────────────────────────
// EmergencyTab.tsx — вкладка «Аварийный ключ» панели администратора: выпуск
// оффлайн-ключей (работают без интернета до истечения срока) и реестр ранее
// выпущенных ключей с правкой, отключением и удалением.
//
// Вынесено из Admin.tsx БЕЗ изменений разметки, текстов и обработчиков.
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";

interface OfflineKey {
  id: number;
  org: string;
  key: string;
  seats: number;
  expires_at: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  expired: boolean;
}

interface EmergencyTabProps {
  emgOrg: string;
  setEmgOrg: (v: string) => void;
  emgExpires: string;
  setEmgExpires: (v: string) => void;
  emgKey: string;
  emgErr: string;
  setEmgErr: (v: string) => void;
  emgLoading: boolean;
  generateEmergencyKey: () => void;
  offlineKeys: OfflineKey[];
  okLoading: boolean;
  okEditId: number | null;
  setOkEditId: (v: number | null) => void;
  okEditOrg: string;
  setOkEditOrg: (v: string) => void;
  okEditExp: string;
  setOkEditExp: (v: string) => void;
  okEditSeats: string;
  setOkEditSeats: (v: string) => void;
  okEditNotes: string;
  setOkEditNotes: (v: string) => void;
  okShowKeyId: number | null;
  setOkShowKeyId: (v: number | null) => void;
  saveEditOffline: () => void;
  toggleOffline: (k: OfflineKey) => void;
  deleteOffline: (k: OfflineKey) => void;
  startEditOffline: (k: OfflineKey) => void;
  loadOfflineKeys: (pwd: string) => void;
  password: string;
}

export default function EmergencyTab({
  emgOrg, setEmgOrg, emgExpires, setEmgExpires, emgKey, emgErr, setEmgErr,
  emgLoading, generateEmergencyKey, offlineKeys, okLoading,
  okEditId, setOkEditId, okEditOrg, setOkEditOrg, okEditExp, setOkEditExp,
  okEditSeats, setOkEditSeats, okEditNotes, setOkEditNotes,
  okShowKeyId, setOkShowKeyId, saveEditOffline, toggleOffline, deleteOffline,
  startEditOffline, loadOfflineKeys, password,
}: EmergencyTabProps) {
  return (
  <div className="max-w-xl mx-auto">
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="LifeBuoy" size={16} className="text-amber-500" />
        <span className="font-semibold text-[13px]" style={{ color: "#1a3a6b" }}>Аварийный оффлайн-ключ</span>
      </div>
      <p className="text-[11px] text-gray-400 mb-4">
        Для расчётов без интернета (рудник / ВГСЧ). Ключ подписан криптографически
        и проверяется программой локально, без связи с сервером. Работает на любом ПК
        организации до истечения срока. Выдавайте заранее как аварийный запас.
      </p>

      <div className="space-y-4">
        <div>
          <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Организация</div>
          <input value={emgOrg} onChange={e => { setEmgOrg(e.target.value); setEmgErr(""); }}
            placeholder="ВГСЧ / рудник — название"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[12px] focus:outline-none focus:border-amber-400" />
        </div>

        <div>
          <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Действует до</div>
          <input type="date" value={emgExpires} onChange={e => setEmgExpires(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[12px] focus:outline-none focus:border-amber-400" />
          <div className="text-[10px] text-gray-400 mt-1">
            Если не указано — 1 год со дня выдачи. Для продления просто выпустите новый ключ с новой датой.
          </div>
        </div>

        {emgErr && <div className="text-[12px] text-red-500">{emgErr}</div>}

        <button onClick={generateEmergencyKey} disabled={emgLoading || !emgOrg.trim()}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
          style={{ background: "#d97706" }}>
          {emgLoading ? <><Icon name="Loader" size={14} className="animate-spin" />Генерация...</> : <><Icon name="Key" size={14} />Сгенерировать аварийный ключ</>}
        </button>

        {emgKey && (
          <div className="p-3 rounded-lg border border-amber-200 bg-amber-50">
            <div className="text-[11px] font-semibold text-amber-800 mb-1">Аварийный ключ (передайте организации):</div>
            <textarea readOnly value={emgKey} rows={4}
              className="w-full px-2 py-1.5 border border-amber-300 rounded text-[10px] font-mono break-all resize-none bg-white"
              onFocus={e => e.currentTarget.select()} />
            <button onClick={() => navigator.clipboard?.writeText(emgKey)}
              className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold text-amber-800 border border-amber-300 hover:bg-amber-100">
              <Icon name="Copy" size={12} />Скопировать
            </button>
          </div>
        )}
      </div>
    </div>

    {/* Реестр выпущенных аварийных ключей */}
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon name="ListChecks" size={16} className="text-amber-500" />
          <span className="font-semibold text-[13px]" style={{ color: "#1a3a6b" }}>
            Выданные ключи ({offlineKeys.length})
          </span>
        </div>
        <button onClick={() => loadOfflineKeys(password)}
          className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600">
          <Icon name="RefreshCw" size={12} className={okLoading ? "animate-spin" : ""} />Обновить
        </button>
      </div>

      {offlineKeys.length === 0 && !okLoading && (
        <div className="text-[12px] text-gray-400 py-6 text-center">Пока не выдано ни одного ключа</div>
      )}

      <div className="space-y-2">
        {offlineKeys.map(k => (
          <div key={k.id} className={`rounded-lg border p-3 ${k.is_active && !k.expired ? "border-gray-200" : "border-gray-200 bg-gray-50 opacity-70"}`}>
            {okEditId === k.id ? (
              <div className="space-y-2">
                <input value={okEditOrg} onChange={e => setOkEditOrg(e.target.value)}
                  placeholder="Организация"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-[12px] focus:outline-none focus:border-amber-400" />
                <div className="flex gap-2">
                  <div className="flex-1">
                    <div className="text-[10px] text-gray-400 mb-0.5">Действует до</div>
                    <input type="date" value={okEditExp} onChange={e => setOkEditExp(e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-[12px] focus:outline-none focus:border-amber-400" />
                  </div>
                  <div className="w-24">
                    <div className="text-[10px] text-gray-400 mb-0.5">Мест</div>
                    <input type="number" value={okEditSeats} onChange={e => setOkEditSeats(e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-[12px] focus:outline-none focus:border-amber-400" />
                  </div>
                </div>
                <input value={okEditNotes} onChange={e => setOkEditNotes(e.target.value)}
                  placeholder="Заметка (необязательно)"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-[12px] focus:outline-none focus:border-amber-400" />
                <div className="text-[10px] text-amber-600">
                  Изменение срока в реестре не меняет уже выданный ключ. Для нового срока выпустите новый ключ.
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEditOffline} disabled={!okEditOrg.trim()}
                    className="px-3 py-1 rounded text-[11px] font-semibold text-white disabled:opacity-50" style={{ background: "#16a34a" }}>
                    Сохранить
                  </button>
                  <button onClick={() => setOkEditId(null)}
                    className="px-3 py-1 rounded text-[11px] font-semibold text-gray-500 border border-gray-300">
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[13px] text-gray-800 truncate">{k.org}</span>
                      {k.expired
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-semibold">Просрочен</span>
                        : !k.is_active
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-semibold">Отозван</span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold">Активен</span>}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      Действует до: {k.expires_at ? k.expires_at.slice(0, 10) : "—"} · Мест: {k.seats} · Выдан: {k.created_at.slice(0, 10)}
                    </div>
                    {k.notes && <div className="text-[11px] text-gray-500 mt-0.5">{k.notes}</div>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setOkShowKeyId(okShowKeyId === k.id ? null : k.id)} title="Показать ключ"
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><Icon name="Eye" size={14} /></button>
                    <button onClick={() => startEditOffline(k)} title="Редактировать"
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><Icon name="Pencil" size={14} /></button>
                    <button onClick={() => toggleOffline(k)} title={k.is_active ? "Отозвать" : "Активировать"}
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><Icon name={k.is_active ? "Ban" : "CircleCheck"} size={14} /></button>
                    <button onClick={() => deleteOffline(k)} title="Удалить"
                      className="p-1.5 rounded hover:bg-red-50 text-red-400"><Icon name="Trash2" size={14} /></button>
                  </div>
                </div>
                {okShowKeyId === k.id && (
                  <div className="mt-2 p-2 rounded border border-amber-200 bg-amber-50">
                    <textarea readOnly value={k.key} rows={3}
                      className="w-full px-2 py-1.5 border border-amber-300 rounded text-[10px] font-mono break-all resize-none bg-white"
                      onFocus={e => e.currentTarget.select()} />
                    <button onClick={() => navigator.clipboard?.writeText(k.key)}
                      className="mt-1.5 flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold text-amber-800 border border-amber-300 hover:bg-amber-100">
                      <Icon name="Copy" size={12} />Скопировать ключ
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  </div>
  );
}
