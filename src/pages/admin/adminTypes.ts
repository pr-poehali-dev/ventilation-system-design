// ─────────────────────────────────────────────────────────────────────────────
// Типы данных и вспомогательные функции панели администратора.
// Вынесено из Admin.tsx — перенос 1:1, без изменений логики.
// ─────────────────────────────────────────────────────────────────────────────
import { API_URLS } from "@/lib/api-urls";

const ADMIN_URL = API_URLS.adminLicenses;

export interface License {
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

export interface OfflineKey {
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

export interface Seat {
  id: number;
  fingerprint: string;
  activated_at: string;
  last_seen_at: string;
  user_agent: string | null;
  hostname: string | null;
  platform: string | null;
  screen_info: string | null;
  app_version?: string | null;
  last_ip?: string | null;
  last_modules?: string | null;
  online?: boolean;
  core_version?: string | null;
  /** Сколько разных адресов в интернете обращалось под этим местом за 30 дней */
  ip_count?: number;
}

export interface MonitoringData {
  sessions: {
    online: number;
    total: number;
    list: { seat_id: number; owner: string; key: string; hostname: string | null; platform: string | null; app_version: string | null; ip: string | null; last_seen_at: string; modules: string | null; core_version?: string | null }[];
  };
  violations: {
    counts: Record<string, number>;
    multi_ip: { owner: string; key: string; ip_count: number }[];
    /** Рабочие места, где переводили дату назад (обход срока лицензии) */
    clock_rollbacks?: { hostname: string; key: string; count: number; last_at: string; detail: string | null }[];
  };
  expiring: { id: number; owner: string; key: string; expires_at: string; days_left: number | null }[];
  versions: { version: string; count: number; orgs?: { owner: string; count: number }[] }[];
  core_versions?: { version: string; count: number; orgs?: { owner: string; count: number }[] }[];
  modules_usage: { modules: string; count: number }[];
  logins_24h: number;
  /** Расход вычислительного времени — обращения к лицензионной службе */
  usage?: {
    month: number;
    week: number;
    today: number;
    by_action: { action: string; count: number }[];
    daily: { day: string; count: number }[];
  };
}

export interface LicenseForm {
  owner_name: string;
  owner_email: string;
  max_seats: string;
  expires_at: string;
  notes: string;
  key: string;
}

export async function adminApi(password: string, body: object) {
  const res = await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

export function fmtDate(s: string | null) {
  if (!s || s === "None") return "—";
  try { return new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return s; }
}

export function toInputDate(s: string | null): string {
  if (!s || s === "None") return "";
  try {
    const d = new Date(s);
    return d.toISOString().slice(0, 10);
  } catch { return ""; }
}

export const emptyForm: LicenseForm = { owner_name: "", owner_email: "", max_seats: "5", expires_at: "", notes: "", key: "" };