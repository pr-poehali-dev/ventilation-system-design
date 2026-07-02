import { useState, useEffect, useCallback } from "react";
import Icon from "@/components/ui/icon";
import { API_URLS } from "@/lib/api-urls";

const ADMIN_URL = API_URLS.adminLicenses;

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
  hostname: string | null;
  platform: string | null;
  screen_info: string | null;
}

interface LicenseForm {
  owner_name: string;
  owner_email: string;
  max_seats: string;
  expires_at: string;
  notes: string;
  key: string;
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

function toInputDate(s: string | null): string {
  if (!s || s === "None") return "";
  try {
    const d = new Date(s);
    return d.toISOString().slice(0, 10);
  } catch { return ""; }
}

const emptyForm: LicenseForm = { owner_name: "", owner_email: "", max_seats: "5", expires_at: "", notes: "", key: "" };

export default function Admin() {
  const [password, setPassword]         = useState("");
  const [authed, setAuthed]             = useState(false);
  const [authErr, setAuthErr]           = useState("");
  const [licenses, setLicenses]         = useState<License[]>([]);
  const [loading, setLoading]           = useState(false);
  const [seats, setSeats]               = useState<Seat[] | null>(null);
  const [seatsForId, setSeatsForId]     = useState<number | null>(null);

  // Создание
  const [showCreate, setShowCreate]     = useState(false);
  const [generatedKey, setGeneratedKey] = useState("");
  const [form, setForm]                 = useState<LicenseForm>(emptyForm);
  const [createErr, setCreateErr]       = useState("");
  const [createOk, setCreateOk]         = useState(false);

  // Редактирование
  const [editingLic, setEditingLic]     = useState<License | null>(null);
  const [editForm, setEditForm]         = useState<LicenseForm>(emptyForm);
  const [editErr, setEditErr]           = useState("");
  const [editOk, setEditOk]             = useState(false);
  const [editSaving, setEditSaving]     = useState(false);

  // Вкладки
  const [activeTab, setActiveTab]       = useState<"licenses" | "update">("licenses");

  // Обновление PVS.exe (установщик)
  const [currentVersion, setCurrentVersion] = useState<{version: string; notes: string; server_version?: string} | null>(null);
  const [updFile, setUpdFile]           = useState<File | null>(null);
  const [updVersion, setUpdVersion]     = useState("");
  const [updNotes, setUpdNotes]         = useState("");
  const [updProgress, setUpdProgress]   = useState(0);
  const [updStatus, setUpdStatus]       = useState<"idle"|"uploading"|"ok"|"err">("idle");
  const [updErr, setUpdErr]             = useState("");

  // Обновление server.exe (расчётное ядро)
  const [srvFile, setSrvFile]           = useState<File | null>(null);
  const [srvVersion, setSrvVersion]     = useState("");
  const [srvProgress, setSrvProgress]   = useState(0);
  const [srvStatus, setSrvStatus]       = useState<"idle"|"uploading"|"ok"|"err">("idle");
  const [srvErr, setSrvErr]             = useState("");
  const VERSION_URL = "https://functions.poehali.dev/0ddfea8a-386f-4cb2-9fe0-37274caf2e16";

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
      setForm(emptyForm);
      setGeneratedKey("");
      await loadLicenses(password);
      setTimeout(() => { setShowCreate(false); setCreateOk(false); }, 1500);
    } catch (e: unknown) {
      setCreateErr(e instanceof Error ? e.message : "Ошибка создания");
    }
  };

  const openEdit = (lic: License) => {
    setEditingLic(lic);
    setEditForm({
      owner_name: lic.owner_name,
      owner_email: lic.owner_email ?? "",
      max_seats: String(lic.max_seats),
      expires_at: toInputDate(lic.expires_at),
      notes: lic.notes ?? "",
      key: lic.key,
    });
    setEditErr("");
    setEditOk(false);
  };

  const closeEdit = () => {
    setEditingLic(null);
    setEditErr("");
    setEditOk(false);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLic) return;
    setEditErr("");
    setEditOk(false);
    setEditSaving(true);
    try {
      await adminApi(password, {
        action: "update_license",
        license_id: editingLic.id,
        owner_name: editForm.owner_name,
        owner_email: editForm.owner_email || undefined,
        max_seats: parseInt(editForm.max_seats),
        expires_at: editForm.expires_at || undefined,
        notes: editForm.notes || undefined,
      });
      setEditOk(true);
      // Обновляем локальный список без перезагрузки
      setLicenses(ls => ls.map(l => l.id === editingLic.id ? {
        ...l,
        owner_name: editForm.owner_name,
        owner_email: editForm.owner_email || null,
        max_seats: parseInt(editForm.max_seats),
        expires_at: editForm.expires_at || null,
        notes: editForm.notes || null,
      } : l));
      setTimeout(() => closeEdit(), 1200);
    } catch (e: unknown) {
      setEditErr(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setEditSaving(false);
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

  const loadCurrentVersion = async () => {
    try {
      const r = await fetch(VERSION_URL);
      const text = await r.text();
      if (!text.trim().startsWith("{")) { setCurrentVersion(null); return; }
      const d = JSON.parse(text);
      setCurrentVersion({ version: d.version || "—", notes: d.notes || "", server_version: d.server_version || "—" });
    } catch { setCurrentVersion(null); }
  };

  useEffect(() => { if (activeTab === "update") loadCurrentVersion(); }, [activeTab]);

  const handleUploadExe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!updFile || !updVersion) return;
    setUpdStatus("uploading");
    setUpdErr("");
    setUpdProgress(0);
    try {
      const arrayBuf = await updFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        setUpdProgress(Math.round((i / bytes.length) * 80));
      }
      const b64 = btoa(binary);
      setUpdProgress(85);
      const res = await fetch(VERSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Password": password },
        body: JSON.stringify({ action: "upload_exe", exe_base64: b64, version: updVersion, notes: updNotes }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text.startsWith("{") ? (JSON.parse(text).error || "Ошибка") : `HTTP ${res.status}`);
      const data = text.startsWith("{") ? JSON.parse(text) : {};
      void data;
      setUpdProgress(100);
      setUpdStatus("ok");
      setCurrentVersion({ version: updVersion, notes: updNotes });
      setUpdFile(null);
      setUpdVersion("");
      setUpdNotes("");
    } catch (err: unknown) {
      setUpdStatus("err");
      setUpdErr(err instanceof Error ? err.message : "Ошибка загрузки");
    }
  };

  const handleUploadServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!srvFile || !srvVersion) return;
    setSrvStatus("uploading");
    setSrvErr("");
    setSrvProgress(0);
    try {
      const arrayBuf = await srvFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        setSrvProgress(Math.round((i / bytes.length) * 80));
      }
      const b64 = btoa(binary);
      setSrvProgress(85);
      const res = await fetch(VERSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Password": password },
        body: JSON.stringify({ action: "upload_server", exe_base64: b64, server_version: srvVersion }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text.startsWith("{") ? (JSON.parse(text).error || "Ошибка") : `HTTP ${res.status}`);
      const data = text.startsWith("{") ? JSON.parse(text) : {};
      void data;
      setSrvProgress(100);
      setSrvStatus("ok");
      setCurrentVersion(prev => prev ? { ...prev, server_version: srvVersion } : null);
      setSrvFile(null);
      setSrvVersion("");
    } catch (err: unknown) {
      setSrvStatus("err");
      setSrvErr(err instanceof Error ? err.message : "Ошибка загрузки");
    }
  };

  // Общие стили полей формы
  const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-300";

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
          <span className="text-white font-bold text-[14px]">Панель администратора</span>
          <span className="text-blue-300 text-[12px]">ПВ-Система</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-1">
            <button onClick={() => setActiveTab("licenses")}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${activeTab === "licenses" ? "bg-white text-[#1a3a6b]" : "text-blue-200 hover:text-white"}`}>
              <Icon name="Key" size={12} className="inline mr-1" />Лицензии
            </button>
            <button onClick={() => setActiveTab("update")}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${activeTab === "update" ? "bg-white text-[#1a3a6b]" : "text-blue-200 hover:text-white"}`}>
              <Icon name="Upload" size={12} className="inline mr-1" />Обновление
            </button>
          </div>
          {activeTab === "licenses" && <>
            <button onClick={() => loadLicenses(password)}
              className="flex items-center gap-1.5 text-[12px] text-blue-200 hover:text-white transition-colors">
              <Icon name="RefreshCw" size={14} />Обновить
            </button>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white transition-colors"
              style={{ background: "#16a34a" }}>
              <Icon name="Plus" size={14} />Создать ключ
            </button>
          </>}
          <a href="/"
            className="flex items-center gap-1.5 text-[12px] text-blue-300 hover:text-white transition-colors">
            <Icon name="ArrowLeft" size={14} />В приложение
          </a>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6">

        {/* ── Вкладка: Обновление версии ── */}
        {activeTab === "update" && (
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
              <form onSubmit={handleUploadExe} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">Номер версии</label>
                    <input type="text" value={updVersion} onChange={e => setUpdVersion(e.target.value)}
                      className={inputCls} placeholder="1.2.0" required />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">Что нового</label>
                    <input type="text" value={updNotes} onChange={e => setUpdNotes(e.target.value)}
                      className={inputCls} placeholder="Новые функции..." />
                  </div>
                </div>
                <label className={`flex items-center gap-3 border-2 border-dashed rounded-lg px-4 py-4 cursor-pointer transition-colors ${updFile ? "border-green-400 bg-green-50" : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"}`}>
                  <Icon name={updFile ? "CheckCircle" : "FileUp"} size={20} className={updFile ? "text-green-500" : "text-gray-400"} />
                  <div>
                    <div className="text-[12px] font-semibold text-gray-700">{updFile ? updFile.name : "Выбрать PVS-Setup.exe"}</div>
                    {updFile && <div className="text-[11px] text-gray-400">{(updFile.size / 1024 / 1024).toFixed(1)} МБ</div>}
                  </div>
                  <input type="file" accept=".exe" className="hidden"
                    onChange={e => { setUpdFile(e.target.files?.[0] || null); setUpdStatus("idle"); }} />
                </label>
                {updStatus === "uploading" && (
                  <div>
                    <div className="flex justify-between text-[11px] text-gray-500 mb-1"><span>Загрузка...</span><span>{updProgress}%</span></div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="h-2 rounded-full transition-all" style={{ width: `${updProgress}%`, background: "#2563eb" }} />
                    </div>
                  </div>
                )}
                {updStatus === "ok" && <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg px-4 py-3 text-[12px]"><Icon name="CheckCircle" size={16} />Версия {updVersion} опубликована!</div>}
                {updStatus === "err" && <div className="flex items-center gap-2 text-red-700 bg-red-50 rounded-lg px-4 py-3 text-[12px]"><Icon name="AlertCircle" size={16} />{updErr}</div>}
                <button type="submit" disabled={!updFile || !updVersion || updStatus === "uploading"}
                  className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ background: "#1a3a6b" }}>
                  {updStatus === "uploading" ? <><Icon name="Loader" size={14} className="animate-spin" />Загрузка...</> : <><Icon name="Upload" size={14} />Опубликовать установщик</>}
                </button>
              </form>
            </div>

            {/* Форма загрузки server.exe */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Icon name="Cpu" size={16} className="text-purple-500" />
                <span className="font-semibold text-[13px]" style={{ color: "#1a3a6b" }}>Обновить расчётное ядро server.exe</span>
                <span className="text-[10px] text-gray-400 ml-1">— без переустановки у пользователей</span>
              </div>
              <form onSubmit={handleUploadServer} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1">Версия ядра</label>
                  <input type="text" value={srvVersion} onChange={e => setSrvVersion(e.target.value)}
                    className={inputCls} placeholder="1.2.0" required />
                </div>
                <label className={`flex items-center gap-3 border-2 border-dashed rounded-lg px-4 py-4 cursor-pointer transition-colors ${srvFile ? "border-purple-400 bg-purple-50" : "border-gray-300 hover:border-purple-400 hover:bg-purple-50"}`}>
                  <Icon name={srvFile ? "CheckCircle" : "FileUp"} size={20} className={srvFile ? "text-purple-500" : "text-gray-400"} />
                  <div>
                    <div className="text-[12px] font-semibold text-gray-700">{srvFile ? srvFile.name : "Выбрать server.exe"}</div>
                    {srvFile && <div className="text-[11px] text-gray-400">{(srvFile.size / 1024 / 1024).toFixed(1)} МБ</div>}
                  </div>
                  <input type="file" accept=".exe" className="hidden"
                    onChange={e => { setSrvFile(e.target.files?.[0] || null); setSrvStatus("idle"); }} />
                </label>
                {srvStatus === "uploading" && (
                  <div>
                    <div className="flex justify-between text-[11px] text-gray-500 mb-1"><span>Загрузка...</span><span>{srvProgress}%</span></div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="h-2 rounded-full transition-all" style={{ width: `${srvProgress}%`, background: "#7c3aed" }} />
                    </div>
                  </div>
                )}
                {srvStatus === "ok" && <div className="flex items-center gap-2 text-purple-700 bg-purple-50 rounded-lg px-4 py-3 text-[12px]"><Icon name="CheckCircle" size={16} />Ядро v{srvVersion} загружено! При следующем запуске пользователи получат обновление автоматически.</div>}
                {srvStatus === "err" && <div className="flex items-center gap-2 text-red-700 bg-red-50 rounded-lg px-4 py-3 text-[12px]"><Icon name="AlertCircle" size={16} />{srvErr}</div>}
                <button type="submit" disabled={!srvFile || !srvVersion || srvStatus === "uploading"}
                  className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ background: "#7c3aed" }}>
                  {srvStatus === "uploading" ? <><Icon name="Loader" size={14} className="animate-spin" />Загрузка...</> : <><Icon name="Cpu" size={14} />Обновить расчётное ядро</>}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ── Вкладка: Лицензии ── */}
        {activeTab === "licenses" && <>
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
        </>}

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
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Лицензионный ключ</label>
                <div className="flex gap-2">
                  <input type="text" value={form.key}
                    onChange={e => setForm(f => ({ ...f, key: e.target.value.toUpperCase() }))}
                    placeholder="PVS-XXXX-XXXX-XXXX-XXXX"
                    className={`flex-1 border border-gray-300 rounded-lg px-3 py-2 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-300`} />
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
                  className={inputCls} />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Email</label>
                <input type="email" value={form.owner_email}
                  onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))}
                  placeholder="info@example.com"
                  className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Рабочих мест</label>
                  <input type="number" min={1} max={100} value={form.max_seats}
                    onChange={e => setForm(f => ({ ...f, max_seats: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Действует до</label>
                  <input type="date" value={form.expires_at}
                    onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                    className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Примечание</label>
                <input type="text" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Договор №123..."
                  className={inputCls} />
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

      {/* Модал: редактирование лицензии */}
      {editingLic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <form onSubmit={handleUpdate}
            className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4"
              style={{ background: "#92400e" }}>
              <div className="text-white font-bold text-[14px] flex items-center gap-2">
                <Icon name="Pencil" size={16} />Изменить лицензию
              </div>
              <button type="button" onClick={closeEdit}
                className="text-white/70 hover:text-white"><Icon name="X" size={16} /></button>
            </div>

            <div className="p-5 space-y-3">
              {/* Ключ — только для просмотра */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Лицензионный ключ</label>
                <div className="border border-gray-200 rounded-lg px-3 py-2 text-[12px] font-mono text-gray-500 bg-gray-50 select-all">
                  {editingLic.key}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">Ключ изменить нельзя</div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Организация *</label>
                <input required type="text" value={editForm.owner_name}
                  onChange={e => setEditForm(f => ({ ...f, owner_name: e.target.value }))}
                  placeholder="ООО Шахта Северная"
                  className={inputCls} />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Email</label>
                <input type="email" value={editForm.owner_email}
                  onChange={e => setEditForm(f => ({ ...f, owner_email: e.target.value }))}
                  placeholder="info@example.com"
                  className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Рабочих мест</label>
                  <input type="number" min={1} max={100} value={editForm.max_seats}
                    onChange={e => setEditForm(f => ({ ...f, max_seats: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Действует до</label>
                  <input type="date" value={editForm.expires_at}
                    onChange={e => setEditForm(f => ({ ...f, expires_at: e.target.value }))}
                    className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Примечание</label>
                <input type="text" value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Договор №123..."
                  className={inputCls} />
              </div>

              {editErr && <div className="text-[12px] text-red-600 flex items-center gap-1"><Icon name="AlertCircle" size={13} />{editErr}</div>}
              {editOk && <div className="text-[12px] text-green-600 flex items-center gap-1"><Icon name="CheckCircle2" size={13} />Изменения сохранены!</div>}

              <div className="flex gap-2">
                <button type="button" onClick={closeEdit}
                  className="flex-1 py-2.5 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50">
                  Отмена
                </button>
                <button type="submit" disabled={editSaving}
                  className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
                  style={{ background: "#b45309" }}>
                  {editSaving ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}