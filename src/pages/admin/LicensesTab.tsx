import Icon from "@/components/ui/icon";
import { type License, type Seat, fmtDate } from "@/pages/admin/adminTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «ЛИЦЕНЗИИ»: сводка, список лицензий и раскрываемые рабочие места.
// Вынесено из Admin.tsx — разметка и логика перенесены 1:1.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  licenses: License[];
  seats: Seat[] | null;
  seatsForId: number | null;
  loadSeats: (id: number) => void;
  openEdit: (lic: License) => void;
  toggleLicense: (id: number, is_active: boolean) => void;
  deleteLicense: (id: number, name: string) => void;
  revokeSeat: (seatId: number) => void;
}

export default function LicensesTab({
  licenses, seats, seatsForId, loadSeats, openEdit, toggleLicense, deleteLicense, revokeSeat,
}: Props) {
  return (
    <>
        {/* Статистика */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Всего лицензий", value: licenses.length, icon: "Key", color: "#2563eb" },
            { label: "Активных", value: licenses.filter(l => l.is_active).length, icon: "CheckCircle", color: "#16a34a" },
            { label: "Рабочих мест занято", value: licenses.reduce((s, l) => s + l.used_seats, 0), icon: "Monitor", color: "#d97706" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                <Icon name={s.icon as "Key"} size={16} style={{ color: s.color }} />
                <span className="text-[11px] text-gray-500">{s.label}</span>
              </div>
              <div className="text-[28px] font-bold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Таблица лицензий */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-semibold text-[13px]" style={{ color: "#1a3a6b" }}>Лицензии</span>
          </div>

          {licenses.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-[13px]">
              <Icon name="Key" size={32} className="mx-auto mb-3 text-gray-300" />
              Нет созданных лицензий. Нажмите «Создать ключ».
            </div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-[calc(100vh-360px)] overflow-y-auto">
              {licenses.map(lic => (
                <div key={lic.id}>
                  <div className="px-5 py-4 flex items-start gap-4">
                    {/* Статус */}
                    <div className="mt-0.5">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1 ${lic.is_active ? "bg-green-500" : "bg-gray-300"}`} />
                    </div>

                    {/* Основная инфо */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[13px]" style={{ color: "#1a3a6b" }}>{lic.owner_name}</span>
                        {lic.owner_email && <span className="text-[11px] text-gray-400">{lic.owner_email}</span>}
                        {!lic.is_active && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-600 font-medium">ОТОЗВАНА</span>
                        )}
                        {lic.expires_at && new Date(lic.expires_at) < new Date() && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-100 text-orange-600 font-medium">ИСТЕКЛА</span>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-blue-600 mt-0.5">{lic.key}</div>
                      <div className="mt-1 flex items-center gap-4 text-[11px] text-gray-500 flex-wrap">
                        <span>Мест: <b className={lic.used_seats >= lic.max_seats ? "text-red-600" : "text-green-600"}>{lic.used_seats}/{lic.max_seats}</b></span>
                        <span>Создана: {fmtDate(lic.created_at)}</span>
                        {lic.expires_at && <span>Действует до: {fmtDate(lic.expires_at)}</span>}
                        {lic.last_activity && <span>Активность: {fmtDate(lic.last_activity)}</span>}
                        {lic.notes && <span className="text-gray-400 italic">{lic.notes}</span>}
                      </div>
                    </div>

                    {/* Действия */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => loadSeats(lic.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-blue-50"
                        style={{ borderColor: "#93c5fd", color: "#2563eb" }}>
                        <Icon name="Monitor" size={12} />
                        {seatsForId === lic.id ? "Скрыть" : `Места (${lic.used_seats})`}
                      </button>
                      <button onClick={() => openEdit(lic)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-amber-50"
                        style={{ borderColor: "#fcd34d", color: "#b45309" }}>
                        <Icon name="Pencil" size={12} />
                        Изменить
                      </button>
                      <button
                        onClick={() => toggleLicense(lic.id, !lic.is_active)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors"
                        style={lic.is_active
                          ? { borderColor: "#fca5a5", color: "#dc2626", background: "#fff5f5" }
                          : { borderColor: "#86efac", color: "#16a34a", background: "#f0fdf4" }}>
                        <Icon name={lic.is_active ? "PauseCircle" : "PlayCircle"} size={12} />
                        {lic.is_active ? "Отозвать" : "Активировать"}
                      </button>
                      <button onClick={() => deleteLicense(lic.id, lic.owner_name)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors">
                        <Icon name="Trash2" size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Раскрытые рабочие места */}
                  {seatsForId === lic.id && seats && (
                    <div className="px-5 pb-4 bg-blue-50 border-t border-blue-100">
                      <div className="text-[11px] font-semibold text-blue-700 mb-2 pt-3 flex items-center justify-between">
                        <span>Активированные рабочие места</span>
                        <span className="font-normal text-blue-500">{seats.length} / {lic.max_seats}</span>
                      </div>
                      {seats.length === 0 ? (
                        <div className="text-[11px] text-gray-400">Нет активированных мест</div>
                      ) : (
                        <div className="space-y-2">
                          {seats.map((seat, idx) => {
                            // Определяем ОС и браузер — сначала из новых полей, иначе из user_agent
                            const plat = seat.platform || seat.hostname || seat.user_agent || "";
                            const ua   = seat.user_agent || "";

                            const os = seat.platform
                              ? seat.platform
                              : ua.includes("Windows") ? "Windows"
                              : ua.includes("Mac") ? "macOS"
                              : ua.includes("Linux") ? "Linux"
                              : ua.includes("Android") ? "Android"
                              : ua.includes("iPhone") || ua.includes("iPad") ? "iOS" : "—";

                            const browser = ua.includes("Chrome") && !ua.includes("Edg") ? "Chrome"
                              : ua.includes("Firefox") ? "Firefox"
                              : ua.includes("Safari") && !ua.includes("Chrome") ? "Safari"
                              : ua.includes("Edg") ? "Edge" : "—";

                            const osIcon = plat.includes("Win") ? "🖥️"
                              : plat.includes("mac") || plat.includes("Mac") ? "🍎"
                              : plat.includes("Linux") ? "🐧"
                              : plat.includes("Android") ? "📱"
                              : plat.includes("iOS") ? "📱" : "💻";

                            // Отображаемое имя рабочего места
                            const displayName = seat.hostname
                              ? seat.hostname
                              : `${os} / ${browser}`;

                            return (
                              <div key={seat.id} className="flex items-start gap-3 p-3 bg-white rounded-lg border border-blue-100">
                                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                                  style={{ background: "#eff6ff" }}>
                                  <span className="text-[17px]">{osIcon}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  {/* Заголовок места */}
                                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                    <span className="text-[12px] font-semibold text-gray-800">
                                      Место #{idx + 1}
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1 ${seat.online ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${seat.online ? "bg-green-500" : "bg-gray-400"}`} />
                                      {seat.online ? "онлайн" : "офлайн"}
                                    </span>
                                    {(seat.ip_count ?? 0) > 1 && (
                                      <span
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium inline-flex items-center gap-1"
                                        title="Под этим местом работали с разных адресов в интернете — возможно, им пользуются несколько компьютеров">
                                        <Icon name="TriangleAlert" size={11} />
                                        замечено с {seat.ip_count} адресов
                                      </span>
                                    )}
                                    {seat.app_version && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium font-mono">
                                        v{seat.app_version}
                                      </span>
                                    )}
                                    {seat.core_version && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium font-mono"
                                        title="Версия расчётного ядра (server.exe)">
                                        ядро {seat.core_version}
                                      </span>
                                    )}
                                    {seat.platform && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                                        {seat.platform}
                                      </span>
                                    )}
                                    {!seat.platform && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{os}</span>
                                    )}
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{browser}</span>
                                  </div>
                                  {/* Название рабочего места */}
                                  <div className="text-[12px] text-gray-700 font-medium truncate">
                                    {displayName}
                                  </div>
                                  {/* Разрешение экрана */}
                                  {seat.screen_info && (
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                      🖥 {seat.screen_info}
                                    </div>
                                  )}
                                  {/* Fingerprint и даты */}
                                  <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                                    ID: {seat.fingerprint}
                                  </div>
                                  <div className="text-[10px] text-gray-400 mt-0.5 flex gap-3 flex-wrap">
                                    <span>Активировано: {fmtDate(seat.activated_at)}</span>
                                    <span>Последняя активность: {fmtDate(seat.last_seen_at)}</span>
                                    {seat.last_ip && <span>IP: {seat.last_ip}</span>}
                                  </div>
                                </div>
                                <button onClick={() => revokeSeat(seat.id)}
                                  title="Освободить место — пользователь сможет активировать ключ заново"
                                  className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors mt-0.5">
                                  <Icon name="Trash2" size={11} />Сбросить
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
    </>
  );
}
