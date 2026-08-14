import Icon from "@/components/ui/icon";
import type { MonitoringData } from "@/pages/Admin";
import { APP_VERSION } from "@/lib/appVersion";

interface Props {
  data: MonitoringData | null;
  loading: boolean;
}

// Тип клиента по имени компьютера: десктоп-приложение помечает hostname
// строкой "(десктоп)", всё остальное — веб-браузер.
function isDesktopClient(hostname: string | null): boolean {
  return !!hostname && hostname.includes("(десктоп)");
}

// Сравнение версий вида "2.74.206" → -1 / 0 / 1
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(x => parseInt(x, 10) || 0);
  const pb = b.split(".").map(x => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Версия клиента устарела, если она валидна и ниже актуальной сборки
function isOutdatedVersion(v: string | null): boolean {
  if (!v || !/^\d+\.\d+/.test(v)) return false;
  return compareVersions(v, APP_VERSION) < 0;
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
  const totalViolations = (v.seats_exhausted || 0) + (v.disabled_attempt || 0)
    + (v.expired_attempt || 0) + (v.clock_rollback || 0);

  return (
    <div className="space-y-5">
      {/* Верхние метрики */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: "Онлайн сейчас", value: data.sessions.online, sub: `из ${data.sessions.total} мест`, icon: "Wifi", color: "#16a34a" },
          { label: "Обращений за месяц", value: (data.usage?.month ?? 0).toLocaleString("ru"), sub: "к серверу", icon: "Gauge", color: "#7c3aed" },
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
                  <th className="pb-2 pr-3 font-medium">Клиент</th>
                  <th className="pb-2 pr-3 font-medium">Платформа</th>
                  <th className="pb-2 pr-3 font-medium">Версия</th>
                  <th className="pb-2 pr-3 font-medium">Ядро</th>
                  <th className="pb-2 pr-3 font-medium">IP</th>
                  <th className="pb-2 pr-3 font-medium">Активность</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.list.map(s => {
                  const desktop = isDesktopClient(s.hostname);
                  const outdated = isOutdatedVersion(s.app_version);
                  return (
                  <tr key={s.seat_id} className="border-b border-gray-50">
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                        <span className="font-medium text-gray-700">{s.owner}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-gray-600">{s.hostname || "—"}</td>
                    <td className="py-2 pr-3">
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={desktop
                          ? { background: "#eef2ff", color: "#4338ca" }
                          : { background: "#f1f5f9", color: "#475569" }}>
                        <Icon name={desktop ? "Monitor" : "Globe"} size={11} />
                        {desktop ? "Десктоп" : "Браузер"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{s.platform || "—"}</td>
                    <td className="py-2 pr-3">
                      {outdated ? (
                        <span
                          className="inline-flex items-center gap-1 font-mono font-medium"
                          style={{ color: "#b45309" }}
                          title={`Устаревшая версия — актуальная ${APP_VERSION}. Клиенту нужно обновиться (десктоп) или сбросить кеш браузера (Ctrl+Shift+R).`}>
                          <Icon name="TriangleAlert" size={11} />
                          {s.app_version}
                        </span>
                      ) : (
                        <span className="text-gray-500 font-mono">{s.app_version || "—"}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono" style={{ color: desktop ? "#7c3aed" : "#94a3b8" }}>
                      {s.core_version || "—"}
                    </td>
                    <td className="py-2 pr-3 text-gray-500 font-mono">{s.ip || "—"}</td>
                    <td className="py-2 pr-3 text-gray-500">{fmtDateTime(s.last_seen_at)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 2. Расход вычислительного времени — сколько обращений к лицензионной
             службе пришло за месяц. Нужен, чтобы видеть расход по тарифу и
             замечать всплески. */}
      {data.usage && (() => {
        const u = data.usage;
        const days = u.daily.length || 1;
        const perDay = Math.round(u.month / Math.min(days, 30));
        // Прогноз на месяц по темпу последней недели — сколько выйдет,
        // если нагрузка останется такой же.
        const forecast = Math.round((u.week / 7) * 30);
        const maxDay = Math.max(1, ...u.daily.map(d => d.count));
        const ACTION_LABELS: Record<string, string> = {
          check: "Проверка лицензии",
          heartbeat: "Сигнал «на связи»",
          activate: "Активация ключа",
          transfer: "Перенос лицензии",
          unknown: "Прочее",
        };
        return (
          <Card title="Расход обращений к серверу" icon="Gauge" color="#7c3aed">
            <div className="grid grid-cols-4 gap-4 mb-4">
              {[
                { label: "За месяц", value: u.month.toLocaleString("ru"), sub: "обращений" },
                { label: "За неделю", value: u.week.toLocaleString("ru"), sub: "обращений" },
                { label: "Сегодня", value: u.today.toLocaleString("ru"), sub: "обращений" },
                { label: "В среднем", value: perDay.toLocaleString("ru"), sub: "в сутки" },
              ].map(s => (
                <div key={s.label} className="rounded-lg p-3" style={{ background: "#faf5ff" }}>
                  <div className="text-[10px] text-gray-500 mb-1">{s.label}</div>
                  <div className="text-[20px] font-bold leading-none" style={{ color: "#7c3aed" }}>{s.value}</div>
                  <div className="text-[10px] text-gray-400 mt-1">{s.sub}</div>
                </div>
              ))}
            </div>

            {/* График по дням */}
            {u.daily.length > 0 && (
              <div className="mb-4">
                <div className="text-[11px] text-gray-400 mb-2">По дням (за 30 суток), максимум {maxDay}:</div>
                <div className="flex items-end gap-[3px]" style={{ height: 56 }}>
                  {u.daily.map(d => (
                    <div key={d.day} className="flex-1 rounded-t"
                      style={{
                        height: `${Math.max(3, (d.count / maxDay) * 100)}%`,
                        background: "#a78bfa",
                        minWidth: 4,
                      }}
                      title={`${new Date(d.day).toLocaleDateString("ru-RU")} — ${d.count} обращений`} />
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-5">
              <div>
                <div className="text-[11px] text-gray-400 mb-1.5">Из чего складывается (за месяц):</div>
                {u.by_action.length === 0 ? (
                  <div className="text-[11px] text-gray-300">Нет данных</div>
                ) : u.by_action.map(a => (
                  <div key={a.action} className="flex items-center justify-between text-[12px] py-0.5">
                    <span className="text-gray-600">{ACTION_LABELS[a.action] ?? a.action}</span>
                    <span className="font-semibold text-gray-700">{a.count.toLocaleString("ru")}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[11px] text-gray-400 mb-1.5">Прогноз</div>
                <div className="text-[12px] text-gray-600">
                  При нынешнем темпе за месяц выйдет около{" "}
                  <span className="font-semibold" style={{ color: "#7c3aed" }}>
                    {forecast.toLocaleString("ru")}
                  </span>{" "}
                  обращений.
                </div>
                <div className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                  Считается по темпу последней недели. Проверка лицензии уходит
                  раз в неделю на рабочее место, сигнал «на связи» — раз в 30 минут,
                  пока программа открыта.
                </div>
              </div>
            </div>
          </Card>
        );
      })()}

      <div className="grid grid-cols-2 gap-5">
        {/* 3. Нарушения */}
        <Card title="Контроль лимитов и нарушений" icon="ShieldAlert" color="#dc2626">
          <div className="space-y-2 text-[12px]">
            {[
              { k: "seats_exhausted", label: "Превышение числа мест", icon: "Users" },
              { k: "disabled_attempt", label: "Вход по отозванной лицензии", icon: "Ban" },
              { k: "expired_attempt", label: "Вход по просроченной лицензии", icon: "TimerOff" },
              { k: "clock_rollback", label: "Перевод даты назад", icon: "CalendarX" },
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
            {/* Перевод даты назад — поимённо: нужно знать, с кем разбираться */}
            {(data.violations.clock_rollbacks?.length ?? 0) > 0 && (
              <div className="border-t border-gray-100 pt-2 mt-2">
                <div className="text-[11px] text-gray-400 mb-1.5">Переводили дату назад (обход срока лицензии):</div>
                {data.violations.clock_rollbacks!.map((c, i) => (
                  <div key={`${c.hostname}-${c.key}-${i}`} className="py-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-600">{c.hostname}</span>
                      <span className="text-red-600 font-semibold">
                        {c.count > 1 ? `${c.count} раз` : "1 раз"}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {c.key !== "—" ? `${c.key} · ` : ""}
                      {new Date(c.last_at).toLocaleString("ru-RU")}
                      {c.detail ? ` · ${c.detail}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {data.versions.map(row => (
                <div key={row.version}>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-gray-700 font-mono">{row.version}</span>
                    <span className="text-gray-500">{row.count} <span className="text-gray-300">мест</span></span>
                  </div>
                  {row.orgs && row.orgs.length > 0 && (
                    <div className="mt-0.5 pl-2 border-l-2 border-blue-100 space-y-0.5">
                      {row.orgs.map(o => (
                        <div key={o.owner} className="flex items-center justify-between text-[11px] text-gray-400">
                          <span className="truncate mr-2">{o.owner}</span>
                          <span className="shrink-0">{o.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 5a2. Версии расчётного ядра (server.exe, только десктоп) */}
        <Card title="Версии ядра (десктоп)" icon="Cpu" color="#7c3aed">
          {!data.core_versions || data.core_versions.length === 0 ? (
            <div className="text-[12px] text-gray-400">Нет данных о версии ядра.</div>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {data.core_versions.map(row => (
                <div key={row.version}>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-purple-700 font-mono">{row.version}</span>
                    <span className="text-gray-500">{row.count} <span className="text-gray-300">мест</span></span>
                  </div>
                  {row.orgs && row.orgs.length > 0 && (
                    <div className="mt-0.5 pl-2 border-l-2 border-purple-100 space-y-0.5">
                      {row.orgs.map(o => (
                        <div key={o.owner} className="flex items-center justify-between text-[11px] text-gray-400">
                          <span className="truncate mr-2">{o.owner}</span>
                          <span className="shrink-0">{o.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
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