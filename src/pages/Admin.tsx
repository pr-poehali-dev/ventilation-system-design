import { useState, useEffect, useCallback } from "react";
import Icon from "@/components/ui/icon";
import MonitoringTab from "@/pages/admin/MonitoringTab";
// Вкладки панели вынесены в отдельные файлы (перенос 1:1, без правок логики)
import UpdateTab from "@/pages/admin/UpdateTab";
import ServerTab from "@/pages/admin/ServerTab";
import EmergencyTab from "@/pages/admin/EmergencyTab";
// Разделы, вынесенные из этого файла (перенос 1:1):
//   adminTypes      — типы данных, обращение к серверу, формат дат
//   AdminLogin      — экран входа по паролю
//   LicensesTab     — вкладка «Лицензии» со списком рабочих мест
//   LicenseDialogs  — диалоги создания и редактирования лицензии
import {
  type License, type OfflineKey, type Seat, type LicenseForm, type MonitoringData,
  adminApi, fmtDate, toInputDate, emptyForm,
} from "@/pages/admin/adminTypes";
import AdminLogin from "@/pages/admin/AdminLogin";
import LicensesTab from "@/pages/admin/LicensesTab";
import LicenseDialogs from "@/pages/admin/LicenseDialogs";

// MonitoringData используют вкладки мониторинга — реэкспортируем, чтобы
// внешние импорты «@/pages/Admin» продолжали работать без правок.
export type { MonitoringData } from "@/pages/admin/adminTypes";


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
  const [activeTab, setActiveTab]       = useState<"licenses" | "monitoring" | "update" | "server" | "emergency">("licenses");

  // Аварийный оффлайн-ключ
  const [emgOrg, setEmgOrg]             = useState("");
  const [emgExpires, setEmgExpires]     = useState("");
  const [emgKey, setEmgKey]             = useState("");
  const [emgErr, setEmgErr]             = useState("");
  const [emgLoading, setEmgLoading]     = useState(false);

  // Реестр выпущенных аварийных ключей
  const [offlineKeys, setOfflineKeys]   = useState<OfflineKey[]>([]);
  const [okLoading, setOkLoading]       = useState(false);
  const [okEditId, setOkEditId]         = useState<number | null>(null);
  const [okEditOrg, setOkEditOrg]       = useState("");
  const [okEditExp, setOkEditExp]       = useState("");
  const [okEditSeats, setOkEditSeats]   = useState("999");
  const [okEditNotes, setOkEditNotes]   = useState("");
  const [okShowKeyId, setOkShowKeyId]   = useState<number | null>(null);

  // Расчётный сервер (основной / аварийный резерв)
  const [srvActive, setSrvActive]       = useState<"primary" | "backup">("primary");
  const [srvBackupUrl, setSrvBackupUrl] = useState("");
  const [srvAutofail, setSrvAutofail]   = useState(true);
  const [srvCfgLoading, setSrvCfgLoading] = useState(false);
  const [srvCfgSaving, setSrvCfgSaving] = useState(false);
  const [srvCfgOk, setSrvCfgOk]         = useState(false);
  const [srvCfgErr, setSrvCfgErr]       = useState("");

  // Мониторинг
  const [monitoring, setMonitoring]     = useState<MonitoringData | null>(null);
  const [monLoading, setMonLoading]     = useState(false);

  // Обновление PVS.exe (установщик)
  const [currentVersion, setCurrentVersion] = useState<{version: string; notes: string; server_version?: string} | null>(null);
  const [updVersion, setUpdVersion]     = useState("");
  const [updNotes, setUpdNotes]         = useState("");
  const [updStatus, setUpdStatus]       = useState<"idle"|"uploading"|"ok"|"err">("idle");
  const [updErr, setUpdErr]             = useState("");
  const [updUrl, setUpdUrl]             = useState("");

  // Обновление server.exe (расчётное ядро)
  const [srvVersion, setSrvVersion]     = useState("");
  const [srvStatus, setSrvStatus]       = useState<"idle"|"uploading"|"ok"|"err">("idle");
  const [srvErr, setSrvErr]             = useState("");
  const [srvUrl, setSrvUrl]             = useState("");
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

  const loadMonitoring = useCallback(async (pwd: string) => {
    setMonLoading(true);
    try {
      const data = await adminApi(pwd, { action: "monitoring_overview" });
      setMonitoring(data);
    } catch { /* ignore */ }
    finally { setMonLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === "monitoring" && authed) loadMonitoring(password);
  }, [activeTab, authed, password, loadMonitoring]);

  const loadServerCfg = useCallback(async (pwd: string) => {
    setSrvCfgLoading(true);
    setSrvCfgErr("");
    try {
      const data = await adminApi(pwd, { action: "get_compute_config" });
      setSrvActive(data.active === "backup" ? "backup" : "primary");
      setSrvBackupUrl(data.backup_url || "");
      setSrvAutofail(data.autofailover !== false);
    } catch (e: unknown) {
      setSrvCfgErr(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setSrvCfgLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "server" && authed) loadServerCfg(password);
  }, [activeTab, authed, password, loadServerCfg]);

  const saveServerCfg = async () => {
    setSrvCfgSaving(true);
    setSrvCfgErr("");
    setSrvCfgOk(false);
    try {
      await adminApi(password, {
        action: "set_compute_config",
        active: srvActive,
        backup_url: srvBackupUrl.trim(),
        autofailover: srvAutofail,
      });
      setSrvCfgOk(true);
      setTimeout(() => setSrvCfgOk(false), 2000);
    } catch (e: unknown) {
      setSrvCfgErr(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSrvCfgSaving(false);
    }
  };

  const loadOfflineKeys = useCallback(async (pwd: string) => {
    setOkLoading(true);
    try {
      const data = await adminApi(pwd, { action: "list_offline_keys" });
      setOfflineKeys(data.keys || []);
    } catch { /* ignore */ }
    finally { setOkLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === "emergency" && authed) loadOfflineKeys(password);
  }, [activeTab, authed, password, loadOfflineKeys]);

  const generateEmergencyKey = async () => {
    if (!emgOrg.trim()) { setEmgErr("Укажите организацию"); return; }
    setEmgLoading(true);
    setEmgErr("");
    setEmgKey("");
    try {
      const data = await adminApi(password, {
        action: "create_offline_key",
        org: emgOrg.trim(),
        days: 365,
        expires_at: emgExpires || undefined,
      });
      setEmgKey(data.key);
      loadOfflineKeys(password);
    } catch (e: unknown) {
      setEmgErr(e instanceof Error ? e.message : "Ошибка генерации");
    } finally {
      setEmgLoading(false);
    }
  };

  const startEditOffline = (k: OfflineKey) => {
    setOkEditId(k.id);
    setOkEditOrg(k.org);
    setOkEditExp(k.expires_at ? k.expires_at.slice(0, 10) : "");
    setOkEditSeats(String(k.seats));
    setOkEditNotes(k.notes || "");
  };

  const saveEditOffline = async () => {
    if (okEditId == null) return;
    if (!okEditOrg.trim()) return;
    try {
      await adminApi(password, {
        action: "update_offline_key",
        offline_key_id: okEditId,
        org: okEditOrg.trim(),
        seats: parseInt(okEditSeats) || 999,
        expires_at: okEditExp || undefined,
        notes: okEditNotes.trim(),
      });
      setOkEditId(null);
      loadOfflineKeys(password);
    } catch { /* ignore */ }
  };

  const toggleOffline = async (k: OfflineKey) => {
    await adminApi(password, { action: "toggle_offline_key", offline_key_id: k.id, is_active: !k.is_active });
    loadOfflineKeys(password);
  };

  const deleteOffline = async (k: OfflineKey) => {
    if (!confirm(`Удалить аварийный ключ «${k.org}» из реестра?`)) return;
    await adminApi(password, { action: "delete_offline_key", offline_key_id: k.id });
    loadOfflineKeys(password);
  };

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

  // ── Опубликовать установщик: сохранить публичную ссылку Я.Диска ──
  const handleUploadExeFromUrl = async () => {
    if (!updUrl.trim() || !updVersion) return;
    setUpdStatus("uploading");
    setUpdErr("");
    try {
      const res = await fetch(VERSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Password": password },
        body: JSON.stringify({ action: "set_url", file_type: "exe", url: updUrl.trim(), version: updVersion, notes: updNotes }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text.startsWith("{") ? (JSON.parse(text).error || "Ошибка") : `HTTP ${res.status}`);
      setUpdStatus("ok");
      setCurrentVersion(prev => ({ version: updVersion, notes: updNotes, server_version: prev?.server_version }));
      setUpdVersion("");
      setUpdNotes("");
    } catch (err: unknown) {
      setUpdStatus("err");
      setUpdErr(err instanceof Error ? err.message : "Ошибка публикации");
    }
  };

  // ── Опубликовать расчётное ядро: сохранить публичную ссылку Я.Диска ──
  const handleUploadServerFromUrl = async () => {
    if (!srvUrl.trim() || !srvVersion) return;
    setSrvStatus("uploading");
    setSrvErr("");
    try {
      const res = await fetch(VERSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Password": password },
        body: JSON.stringify({ action: "set_url", file_type: "server", url: srvUrl.trim(), server_version: srvVersion }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text.startsWith("{") ? (JSON.parse(text).error || "Ошибка") : `HTTP ${res.status}`);
      setSrvStatus("ok");
      setCurrentVersion(prev => prev ? { ...prev, server_version: srvVersion } : null);
      setSrvVersion("");
    } catch (err: unknown) {
      setSrvStatus("err");
      setSrvErr(err instanceof Error ? err.message : "Ошибка загрузки по ссылке");
    }
  };

  // Общие стили полей формы
  const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-[12px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300";

  // ── Экран входа ──
  // ── Экран входа ──
  if (!authed) {
    return (
      <AdminLogin
        password={password} setPassword={setPassword}
        authErr={authErr} setAuthErr={setAuthErr}
        loading={loading} handleLogin={handleLogin}
      />
    );
  }

  // ── Основная панель ──
  return (
    // Прокрутка задана здесь, а не на всей странице: у приложения со схемой
    // прокрутка окна намеренно отключена (холст занимает весь экран). Поэтому
    // админка листается внутри себя — иначе длинные вкладки вроде мониторинга
    // не помещались на экран и нижняя часть была недоступна.
    <div className="h-screen overflow-y-auto" style={{ background: "#f1f5f9" }}>
      {/* Шапка. sticky — остаётся на виду при прокрутке длинных вкладок,
          чтобы переключение разделов и кнопка «Обновить» были всегда под рукой. */}
      <div className="h-14 flex items-center justify-between px-6 shadow-sm sticky top-0 z-20"
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
            <button onClick={() => setActiveTab("monitoring")}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${activeTab === "monitoring" ? "bg-white text-[#1a3a6b]" : "text-blue-200 hover:text-white"}`}>
              <Icon name="Activity" size={12} className="inline mr-1" />Мониторинг
            </button>
            <button onClick={() => setActiveTab("update")}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${activeTab === "update" ? "bg-white text-[#1a3a6b]" : "text-blue-200 hover:text-white"}`}>
              <Icon name="Upload" size={12} className="inline mr-1" />Обновление
            </button>
            <button onClick={() => setActiveTab("server")}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${activeTab === "server" ? "bg-white text-[#1a3a6b]" : "text-blue-200 hover:text-white"}`}>
              <Icon name="Server" size={12} className="inline mr-1" />Сервер расчёта
            </button>
            <button onClick={() => setActiveTab("emergency")}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${activeTab === "emergency" ? "bg-white text-[#1a3a6b]" : "text-blue-200 hover:text-white"}`}>
              <Icon name="LifeBuoy" size={12} className="inline mr-1" />Аварийный ключ
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
          {activeTab === "monitoring" && (
            <button onClick={() => loadMonitoring(password)}
              className="flex items-center gap-1.5 text-[12px] text-blue-200 hover:text-white transition-colors">
              <Icon name="RefreshCw" size={14} className={monLoading ? "animate-spin" : ""} />Обновить
            </button>
          )}
          <a href="/"
            className="flex items-center gap-1.5 text-[12px] text-blue-300 hover:text-white transition-colors">
            <Icon name="ArrowLeft" size={14} />В приложение
          </a>
        </div>
      </div>

      {/* pb-10 — запас снизу, чтобы последний блок не упирался в край окна */}
      <div className="max-w-5xl mx-auto p-6 pb-10">

        {/* ── Вкладка: Мониторинг ── */}
        {activeTab === "monitoring" && (
          <MonitoringTab data={monitoring} loading={monLoading} />
        )}

        {/* ── Вкладка: Обновление версии ── */}
        {activeTab === "update" && (
          <UpdateTab
            currentVersion={currentVersion}
            updVersion={updVersion} setUpdVersion={setUpdVersion}
            updNotes={updNotes} setUpdNotes={setUpdNotes}
            updUrl={updUrl} setUpdUrl={setUpdUrl}
            updStatus={updStatus} setUpdStatus={setUpdStatus} updErr={updErr}
            srvVersion={srvVersion} setSrvVersion={setSrvVersion}
            srvUrl={srvUrl} setSrvUrl={setSrvUrl}
            srvStatus={srvStatus} setSrvStatus={setSrvStatus} srvErr={srvErr}
            handleUploadExeFromUrl={handleUploadExeFromUrl}
            handleUploadServerFromUrl={handleUploadServerFromUrl}
            inputCls={inputCls}
          />
        )}

        {/* ── Вкладка: Сервер расчёта ── */}
        {activeTab === "server" && (
          <ServerTab
            srvActive={srvActive} setSrvActive={setSrvActive}
            srvBackupUrl={srvBackupUrl} setSrvBackupUrl={setSrvBackupUrl}
            srvAutofail={srvAutofail} setSrvAutofail={setSrvAutofail}
            srvCfgLoading={srvCfgLoading} srvCfgSaving={srvCfgSaving}
            srvCfgOk={srvCfgOk} srvCfgErr={srvCfgErr}
            saveServerCfg={saveServerCfg}
          />
        )}

        {/* ── Вкладка: Аварийный оффлайн-ключ ── */}
        {activeTab === "emergency" && (
          <EmergencyTab
            emgOrg={emgOrg} setEmgOrg={setEmgOrg}
            emgExpires={emgExpires} setEmgExpires={setEmgExpires}
            emgKey={emgKey} emgErr={emgErr} setEmgErr={setEmgErr}
            emgLoading={emgLoading} generateEmergencyKey={generateEmergencyKey}
            offlineKeys={offlineKeys} okLoading={okLoading}
            okEditId={okEditId} setOkEditId={setOkEditId}
            okEditOrg={okEditOrg} setOkEditOrg={setOkEditOrg}
            okEditExp={okEditExp} setOkEditExp={setOkEditExp}
            okEditSeats={okEditSeats} setOkEditSeats={setOkEditSeats}
            okEditNotes={okEditNotes} setOkEditNotes={setOkEditNotes}
            okShowKeyId={okShowKeyId} setOkShowKeyId={setOkShowKeyId}
            saveEditOffline={saveEditOffline}
            toggleOffline={toggleOffline} deleteOffline={deleteOffline}
            startEditOffline={startEditOffline}
            loadOfflineKeys={loadOfflineKeys} password={password}
          />
        )}

        {/* ── Вкладка: Лицензии ── */}
        {activeTab === "licenses" && (
          <LicensesTab
            licenses={licenses} seats={seats} seatsForId={seatsForId}
            loadSeats={loadSeats} openEdit={openEdit}
            toggleLicense={toggleLicense} deleteLicense={deleteLicense}
            revokeSeat={revokeSeat}
          />
        )}

      </div>

      {/* Диалоги создания и редактирования лицензии */}
      <LicenseDialogs
        showCreate={showCreate} setShowCreate={setShowCreate}
        form={form} setForm={setForm}
        createErr={createErr} setCreateErr={setCreateErr} createOk={createOk}
        generatedKey={generatedKey} setGeneratedKey={setGeneratedKey}
        generateKey={generateKey} handleCreate={handleCreate}
        editingLic={editingLic} editForm={editForm} setEditForm={setEditForm}
        editErr={editErr} editOk={editOk} editSaving={editSaving}
        handleUpdate={handleUpdate} closeEdit={closeEdit}
        inputCls={inputCls}
      />
    </div>
  );
}