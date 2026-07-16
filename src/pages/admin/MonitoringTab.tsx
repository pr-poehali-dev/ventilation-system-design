import Icon from "@/components/ui/icon";
import type { MonitoringData } from "@/pages/Admin";

interface Props {
  data: MonitoringData | null;
  loading: boolean;
}

function fmtDateTime(s: string | null) {
  if (!s || s === "None") return "—";
  try {
    return new Date(s).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return s; }
}

function fmtDate(s: string | null) {
  if (!s || s === "None") return "—";
  try { return new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return s; }
}

function Card({ title, icon, color, children }: { title: string; icon: string; color: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
        <Icon name={icon} size={15} style={{ color }} />
        <span className="font-semibold text-[13px]" style={{ color: "#1a3a6b" }}>{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function MonitoringTab({ data, loading }: Props) {
  if (loading && !data) {
    return (
      <div className="py-16 text-center text-gray-400 text-[13px]">
        <Icon name="Loader" size={28} className="mx-auto mb-3 animate-spin text-gray-300" />
        Загрузка данных мониторинга...
      </div>
    );
  }
  if (!data) {
    return <div className="py-16 text-center text-gray-400 text-[13px]">Нет данных мониторинга.</div>;
  }

  const v = data.violations.counts;
  const totalViolations = (v.seats_exhausted || 0) + (v.disabled_attempt || 0) + (v.expired_attempt || 0);

  return (
    <div className="space-y-5">
      {/* Верхние метрики */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Онлайн сейчас", value: data.sessions.online, sub: `из ${data.sessions.total} мест`, icon: "Wifi", color: "#16a34a" },
          { label: "Входов за 24 ч", value: data.logins_24h, sub: "активность", icon: "LogIn", color: "#2563eb" },
          { label: "Нарушения (30 дн)", value: totalViolations, sub: "попыток", icon: "ShieldAlert", color: totalViolations ? "#dc2626" : "#94a3b8" },
          { label: "Скоро истекают", value: data.expiring.length, sub: "лицензий", icon: "CalendarClock", color: data.expiring.length ? "#d97706" : "#94a3b8" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Icon name={s.icon} size={15} style={{ color: s.color }} />
              <span className="text-[11px] text-gray-500">{s.label}</span>
            </div>
            <div className="text-[26px] font-bold leading-none" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] text-gray-400 mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* 1. Живые сессии */}
      <Card title="Активные сессии (онлайн)" icon="MonitorSmartphone" color="#16a34a">
        {data.sessions.list.length === 0 ? (
          <div className="text-[12px] text-gray-400">Сейчас никто не в сети.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-gray-400 text-left border-b border-gray-100">
                  <th className="pb-2 pr-3 font-medium">Организация</th>
                  <th className="pb-2 pr-3 font-medium">Компьютер</th>
                  <th className="pb-2 pr-3 font-medium">Платформа</th>
                  <th className="pb-2 pr-3 font-medium">Версия</th>
                  <th className="pb-2 pr-3 font-medium">IP</th>
                  <th className="pb-2 pr-3 font-medium">Активность</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.list.map(s => (
                  <tr key={s.seat_id} className="border-b border-gray-50">
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                        <span className="font-medium text-gray-700">{s.owner}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-gray-600">{s.hostname || "—"}</td>
                    <td className="py-2 pr-3 text-gray-500">{s.platform || "—"}</td>
                    <td className="py-2 pr-3 text-gray-500">{s.app_version || "—"}</td>
                    <td className="py-2 pr-3 text-gray-500 font-mono">{s.ip || "—"}</td>
                    <td className="py-2 pr-3 text-gray-500">{fmtDateTime(s.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-5">
        {/* 3. Нарушения */}
        <Card title="Контроль лимитов и нарушений" icon="ShieldAlert" color="#dc2626">
          <div className="space-y-2 text-[12px]">
            {[
              { k: "seats_exhausted", label: "Превышение числа мест", icon: "Users" },
              { k: "disabled_attempt", label: "Вход по отозванной лицензии", icon: "Ban" },
              { k: "expired_attempt", label: "Вход по просроченной лицензии", icon: "TimerOff" },
            ].map(row => (
              <div key={row.k} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-gray-600">
                  <Icon name={row.icon} size={13} className="text-gray-400" />{row.label}
                </span>
                <span className={`font-semibold ${v[row.k] ? "text-red-600" : "text-gray-300"}`}>{v[row.k] || 0}</span>
              </div>
            ))}
            <div className="border-t border-gray-100 pt-2 mt-2">
              <div className="text-[11px] text-gray-400 mb-1.5">Один ключ с разных IP (риск передачи ключа):</div>
              {data.violations.multi_ip.length === 0 ? (
                <div className="text-[11px] text-gray-300">Подозрений нет</div>
              ) : data.violations.multi_ip.map(m => (
                <div key={m.key} className="flex items-center justify-between text-[11px] py-0.5">
                  <span className="text-gray-600">{m.owner}</span>
                  <span className="text-amber-600 font-semibold">{m.ip_count} IP</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* 4. Сроки лицензий */}
        <Card title="Сроки лицензий" icon="CalendarClock" color="#d97706">
          {data.expiring.length === 0 ? (
            <div className="text-[12px] text-gray-400">Нет лицензий, истекающих в ближайшие 30 дней.</div>
          ) : (
            <div className="space-y-1.5">
              {data.expiring.map(l => {
                const expired = l.days_left !== null && l.days_left < 0;
                return (
                  <div key={l.id} className="flex items-center justify-between text-[12px]">
                    <span className="text-gray-700 truncate mr-2">{l.owner}</span>
                    <span className={`shrink-0 font-semibold ${expired ? "text-red-600" : l.days_left !== null && l.days_left <= 7 ? "text-amber-600" : "text-gray-500"}`}>
                      {expired ? "просрочена" : `${l.days_left} дн.`}
                      <span className="text-gray-300 font-normal ml-1.5">{fmtDate(l.expires_at)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* 5a. Версии */}
        <Card title="Версии программы у клиентов" icon="GitBranch" color="#2563eb">
          {data.versions.length === 0 ? (
            <div className="text-[12px] text-gray-400">Нет данных.</div>
          ) : (
            <div className="space-y-1.5">
              {data.versions.map(row => (
                <div key={row.version} className="flex items-center justify-between text-[12px]">
                  <span className="text-gray-700 font-mono">{row.version}</span>
                  <span className="text-gray-500">{row.count} <span className="text-gray-300">мест</span></span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 5b. Использование модулей */}
        <Card title="Использование функций (7 дней)" icon="LayoutGrid" color="#7c3aed">
          {data.modules_usage.length === 0 ? (
            <div className="text-[12px] text-gray-400">Нет данных за период.</div>
          ) : (
            <div className="space-y-1.5">
              {data.modules_usage.map(row => (
                <div key={row.modules} className="flex items-center justify-between text-[12px]">
                  <span className="text-gray-700">{row.modules}</span>
                  <span className="text-gray-500">{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
