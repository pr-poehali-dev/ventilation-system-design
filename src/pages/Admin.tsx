import { useState, useEffect, useCallback } from "react";
import Icon from "@/components/ui/icon";

const ADMIN_URL = "https://functions.poehali.dev/bd72524f-fb9c-4866-8bcd-69ced85263d4";

interface License {
  id: number;
  key: string;
  owner_name: string;
  owner_email: string | null;
  max_seats: number;
  used_seats: number;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
  notes: string | null;
  last_activity: string | null;
}

interface Seat {
  id: number;
  fingerprint: string;
  activated_at: string;
  last_seen_at: string;
  user_agent: string | null;
}

async function adminApi(password: string, body: object) {
  const res = await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

function fmtDate(s: string | null) {
  if (!s || s === "None") return "—";
  try { return new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return s; }
}

export default function Admin() {
  const [password, setPassword]         = useState("");
  const [authed, setAuthed]             = useState(false);
  const [authErr, setAuthErr]           = useState("");
  const [licenses, setLicenses]         = useState<License[]>([]);
  const [loading, setLoading]           = useState(false);
  const [seats, setSeats]               = useState<Seat[] | null>(null);
  const [seatsForId, setSeatsForId]     = useState<number | null>(null);
  const [showCreate, setShowCreate]     = useState(false);
  const [generatedKey, setGeneratedKey] = useState("");
  const [form, setForm]                 = useState({
    owner_name: "", owner_email: "", max_seats: "5", expires_at: "", notes: "", key: "",
  });
  const [createErr, setCreateErr]       = useState("");
  const [createOk, setCreateOk]         = useState(false);

  const loadLicenses = useCallback(async (pwd: string) => {
    setLoading(true);
    try {
      const data = await adminApi(pwd, { action: "list_licenses" });
      setLicenses(data.licenses);
      setAuthed(true);
    } catch (e: unknown) {
      setAuthErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    localStorage.removeItem("pvs_admin_pwd");
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr("");
    await loadLicenses(password);
  };

  const generateKey = async () => {
    const data = await adminApi(password, { action: "generate_key" });
    setGeneratedKey(data.key);
    setForm(f => ({ ...f, key: data.key }));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateErr("");
    setCreateOk(false);
    try {
      await adminApi(password, {
        action: "create_license",
        owner_name: form.owner_name,
        owner_email: form.owner_email || undefined,
        max_seats: parseInt(form.max_seats),
        expires_at: form.expires_at || undefined,
        notes: form.notes || undefined,
        key: form.key || undefined,
      });
      setCreateOk(true);
      setForm({ owner_name: "", owner_email: "", max_seats: "5", expires_at: "", notes: "", key: "" });
      setGeneratedKey("");
      await loadLicenses(password);
      setTimeout(() => { setShowCreate(false); setCreateOk(false); }, 1500);
    } catch (e: unknown) {
      setCreateErr(e instanceof Error ? e.message : "Ошибка создания");
    }
  };

  const toggleLicense = async (id: number, is_active: boolean) => {
    await adminApi(password, { action: "toggle_license", license_id: id, is_active });
    setLicenses(ls => ls.map(l => l.id === id ? { ...l, is_active } : l));
  };

  const deleteLicense = async (id: number, name: string) => {
    if (!confirm(`Удалить лицензию "${name}"? Все рабочие места будут сброшены.`)) return;
    await adminApi(password, { action: "delete_license", license_id: id });
    setLicenses(ls => ls.filter(l => l.id !== id));
  };

  const loadSeats = async (id: number) => {
    if (seatsForId === id) { setSeatsForId(null); setSeats(null); return; }
    const data = await adminApi(password, { action: "list_seats", license_id: id });
    setSeats(data.seats);
    setSeatsForId(id);
  };

  const revokeSeat = async (seatId: number) => {
    await adminApi(password, { action: "revoke_seat", seat_id: seatId });
    setSeats(s => s ? s.filter(x => x.id !== seatId) : null);
    setLicenses(ls => ls.map(l => l.id === seatsForId ? { ...l, used_seats: Math.max(0, l.used_seats - 1) } : l));
  };

  // ── Экран входа ──
  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(135deg,#0f172a,#1e3a5f)" }}>
        <form onSubmit={handleLogin}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "#1a3a6b" }}>
              <Icon name="ShieldCheck" size={22} className="text-white" />
            </div>
            <div>
              <div className="text-[16px] font-bold" style={{ color: "#1a3a6b" }}>Панель администратора</div>
              <div className="text-[11px] text-gray-400">ПВ-Система — Лицензии</div>
            </div>
          </div>
          <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Пароль администратора</label>
          <input type="password" value={password}
            onChange={e => { setPassword(e.target.value); setAuthErr(""); }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="Введите пароль" autoFocus />
          {authErr && <div className="mt-2 text-[12px] text-red-600">{authErr}</div>}
          <button type="submit" disabled={loading}
            className="mt-4 w-full py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: "#1a3a6b" }}>
            {loading ? "Вход..." : "Войти"}
          </button>
          <a href="/" className="mt-4 block text-center text-[11px] text-gray-400 hover:text-gray-600">
            ← Вернуться в приложение
          </a>
        </form>
      </div>
    );
  }

  // ── Основная панель ──
  return (
    <div className="min-h-screen" style={{ background: "#f1f5f9" }}>
      {/* Шапка */}
      <div className="h-14 flex items-center justify-between px-6 shadow-sm"
        style={{ background: "#1a3a6b" }}>
        <div className="flex items-center gap-3">
          <Icon name="ShieldCheck" size={20} className="text-blue-300" />
          <span className="text-white font-bold text-[14px]">Управление лицензиями</span>
          <span className="text-blue-300 text-[12px]">ПВ-Система</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => loadLicenses(password)}
            className="flex items-center gap-1.5 text-[12px] text-blue-200 hover:text-white transition-colors">
            <Icon name="RefreshCw" size={14} />Обновить
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white transition-colors"
            style={{ background: "#16a34a" }}>
            <Icon name="Plus" size={14} />Создать ключ
          </button>
          <a href="/"
            className="flex items-center gap-1.5 text-[12px] text-blue-300 hover:text-white transition-colors">
            <Icon name="ArrowLeft" size={14} />В приложение
          </a>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        {/* Статистика */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Всего лицензий", value: licenses.length, icon: "Key", color: "#2563eb" },
            { label: "Активных", value: licenses.filter(l => l.is_active).length, icon: "CheckCircle", color: "#16a34a" },
            { label: "Рабочих мест занято", value: licenses.reduce((s, l) => s + l.used_seats, 0), icon: "Monitor", color: "#d97706" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ background: s.color + "15" }}>
                  <Icon name={s.icon as "Key"} size={18} style={{ color: s.color }} />
                </div>
                <div>
                  <div className="text-[22px] font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[11px] text-gray-500">{s.label}</div>
                </div>
              </div>
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
            <div className="divide-y divide-gray-100">
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
                      <div className="text-[11px] font-semibold text-blue-700 mb-2 pt-3">
                        Активированные рабочие места
                      </div>
                      {seats.length === 0 ? (
                        <div className="text-[11px] text-gray-400">Нет активированных мест</div>
                      ) : (
                        <div className="space-y-2">
                          {seats.map(seat => (
                            <div key={seat.id} className="flex items-center gap-3 p-2.5 bg-white rounded-lg border border-blue-100">
                              <Icon name="Monitor" size={14} className="text-blue-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-mono text-gray-600">{seat.fingerprint}</div>
                                <div className="text-[10px] text-gray-400 mt-0.5">
                                  Активировано: {fmtDate(seat.activated_at)} · Активность: {fmtDate(seat.last_seen_at)}
                                </div>
                                {seat.user_agent && (
                                  <div className="text-[10px] text-gray-400 truncate max-w-xs">{seat.user_agent}</div>
                                )}
                              </div>
                              <button onClick={() => revokeSeat(seat.id)}
                                className="text-[11px] text-red-500 hover:text-red-700 flex items-center gap-1 flex-shrink-0">
                                <Icon name="X" size={12} />Освободить
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Модал: создание лицензии */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <form onSubmit={handleCreate}
            className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4"
              style={{ background: "#1a3a6b" }}>
              <div className="text-white font-bold text-[14px] flex items-center gap-2">
                <Icon name="Plus" size={16} />Создать лицензию
              </div>
              <button type="button" onClick={() => { setShowCreate(false); setCreateErr(""); setGeneratedKey(""); }}
                className="text-white/70 hover:text-white"><Icon name="X" size={16} /></button>
            </div>

            <div className="p-5 space-y-3">
              {/* Генератор ключа */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Лицензионный ключ</label>
                <div className="flex gap-2">
                  <input type="text" value={form.key}
                    onChange={e => setForm(f => ({ ...f, key: e.target.value.toUpperCase() }))}
                    placeholder="PVS-XXXX-XXXX-XXXX-XXXX"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  <button type="button" onClick={generateKey}
                    className="px-3 py-2 rounded-lg text-[11px] font-medium text-white flex-shrink-0"
                    style={{ background: "#2563eb" }}>
                    <Icon name="Shuffle" size={14} />
                  </button>
                </div>
                {generatedKey && (
                  <div className="mt-1 text-[11px] text-green-600 font-mono">✓ Сгенерирован: {generatedKey}</div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Организация *</label>
                <input required type="text" value={form.owner_name}
                  onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))}
                  placeholder="ООО Шахта Северная"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Email</label>
                <input type="email" value={form.owner_email}
                  onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))}
                  placeholder="info@example.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Рабочих мест</label>
                  <input type="number" min={1} max={100} value={form.max_seats}
                    onChange={e => setForm(f => ({ ...f, max_seats: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Действует до</label>
                  <input type="date" value={form.expires_at}
                    onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Примечание</label>
                <input type="text" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Договор №123..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>

              {createErr && <div className="text-[12px] text-red-600 flex items-center gap-1"><Icon name="AlertCircle" size={13} />{createErr}</div>}
              {createOk && <div className="text-[12px] text-green-600 flex items-center gap-1"><Icon name="CheckCircle2" size={13} />Лицензия создана!</div>}

              <button type="submit"
                className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white"
                style={{ background: "#16a34a" }}>
                Создать лицензию
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}