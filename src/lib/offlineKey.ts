/**
 * Аварийный оффлайн-ключ для расчётов без интернета (рудник / ВГСЧ).
 *
 * Ключ — криптографически подписанный токен формата:
 *   PVSO.<payload_b64url>.<sig_b64url>
 * payload — JSON {org, exp (ISO), seats, iat}. Подпись Ed25519 создаётся
 * приватным ключом на сервере, а здесь проверяется ПУБЛИЧНЫМ ключом
 * локально, без обращения к серверу. Подделать нельзя, работает офлайн.
 *
 * Приоритет: обычная (онлайн) лицензия важнее. Аварийный ключ — страховка
 * на случай отсутствия связи, ограничен сроком действия (по умолчанию 1 год
 * с возможностью продления через выпуск нового ключа).
 */
import { verify as ed25519Verify, etc as edEtc } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

// @noble/ed25519 v2 требует задать функцию SHA-512 для синхронного verify.
edEtc.sha512Sync = (...m) => sha512(edEtc.concatBytes(...m));

// Публичный ключ проверки (base64url, Ed25519, 32 байта). НЕ секретный.
// Пара к секрету OFFLINE_KEY_PRIVATE на сервере.
const PUBLIC_KEY_B64 = "MsyBGg0UlSyEns_shvQD_Ob82SJ-9Klds-naVhQl9hc";

const OFFLINE_PREFIX = "PVSO.";
const STORAGE_KEY = "pvs_offline_key";

export interface OfflineKeyInfo {
  valid: boolean;
  org?: string;
  expiresAt?: string;   // ISO
  daysLeft?: number;
  seats?: number;
  expired?: boolean;
  reason?: string;      // причина невалидности
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Похоже ли значение на аварийный оффлайн-ключ (по префиксу). */
export function isOfflineKey(key: string): boolean {
  return key.trim().startsWith(OFFLINE_PREFIX);
}

/**
 * Проверяет оффлайн-ключ ЛОКАЛЬНО (подпись + срок). Интернет не нужен.
 */
export function verifyOfflineKey(key: string): OfflineKeyInfo {
  const raw = key.trim();
  if (!raw.startsWith(OFFLINE_PREFIX)) {
    return { valid: false, reason: "not_offline_key" };
  }
  const parts = raw.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "bad_format" };
  }
  const [, payloadB64, sigB64] = parts;
  try {
    const payloadBytes = b64urlToBytes(payloadB64);
    const sig = b64urlToBytes(sigB64);
    const pub = b64urlToBytes(PUBLIC_KEY_B64);

    const ok = ed25519Verify(sig, payloadBytes, pub);
    if (!ok) return { valid: false, reason: "bad_signature" };

    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      org?: string; exp?: string; seats?: number;
    };
    const exp = payload.exp ? new Date(payload.exp).getTime() : 0;
    if (!exp) return { valid: false, reason: "no_expiry" };

    const now = Date.now();
    const daysLeft = Math.floor((exp - now) / (24 * 3600 * 1000));
    if (exp < now) {
      return {
        valid: false, expired: true, reason: "expired",
        org: payload.org, expiresAt: payload.exp, daysLeft: 0,
      };
    }
    return {
      valid: true,
      org: payload.org,
      expiresAt: payload.exp,
      daysLeft,
      seats: payload.seats,
    };
  } catch {
    return { valid: false, reason: "verify_error" };
  }
}

/** Сохранить аварийный ключ на устройстве (для повторных запусков без сети). */
export function saveOfflineKey(key: string): void {
  try { localStorage.setItem(STORAGE_KEY, key.trim()); } catch { /* ignore */ }
}

/** Загрузить сохранённый аварийный ключ, если он ещё валиден. */
export function loadOfflineKey(): { key: string; info: OfflineKeyInfo } | null {
  try {
    const key = localStorage.getItem(STORAGE_KEY);
    if (!key) return null;
    return { key, info: verifyOfflineKey(key) };
  } catch { return null; }
}

export function clearOfflineKey(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}