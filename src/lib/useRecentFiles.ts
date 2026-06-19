import { useState, useCallback } from "react";

export interface RecentFile {
  name: string;
  openedAt: number;
  nodeCount?: number;
  branchCount?: number;
  hasHandle?: boolean; // есть ли FileSystemFileHandle в IndexedDB
}

const STORAGE_KEY = "vnt_recent_files";
const DATA_PREFIX  = "vnt_recent_data__";
const MAX_RECENT   = 10;
const IDB_NAME     = "vnt_handles";
const IDB_STORE    = "handles";
const IDB_VERSION  = 1;

// ── IndexedDB helpers ────────────────────────────────────────────────────────

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Сохраняем FileSystemFileHandle в IndexedDB (переживает перезагрузку страницы) */
export async function saveHandleToIDB(name: string, handle: FileSystemFileHandle) {
  try {
    const db = await openIDB();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(handle, name);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
    db.close();
  } catch (_e) {
    // IndexedDB недоступен — игнорируем
  }
}

/** Загружаем FileSystemFileHandle из IndexedDB */
export async function loadHandleFromIDB(name: string): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openIDB();
    const handle = await new Promise<FileSystemFileHandle | null>((res, rej) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(name);
      req.onsuccess = () => res((req.result as FileSystemFileHandle) ?? null);
      req.onerror   = () => rej(req.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

async function removeHandleFromIDB(name: string) {
  try {
    const db = await openIDB();
    await new Promise<void>((res) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(name);
      tx.oncomplete = () => res();
    });
    db.close();
  } catch (_e) {
    // ignore
  }
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function loadRecent(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RecentFile[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(files: RecentFile[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
  } catch (_e) {
    // quota exceeded — ignore
  }
}

/** Сохраняем JSON проекта в localStorage (fallback если нет handle) */
export function saveRecentData(name: string, data: Record<string, unknown>) {
  try {
    const json = JSON.stringify(data);
    // Не сохраняем если > 5 МБ — защита от quota exceeded
    if (json.length < 5 * 1024 * 1024) {
      localStorage.setItem(DATA_PREFIX + name, json);
    }
  } catch (_e) {
    // ignore
  }
}

/** Загружаем JSON из localStorage */
export function loadRecentData(name: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(DATA_PREFIX + name);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function removeRecentData(name: string) {
  try {
    localStorage.removeItem(DATA_PREFIX + name);
  } catch (_e) {
    // ignore
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useRecentFiles() {
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(loadRecent);

  const addRecentFile = useCallback((file: RecentFile) => {
    setRecentFiles((prev) => {
      const filtered = prev.filter((f) => f.name !== file.name);
      const updated = [file, ...filtered].slice(0, MAX_RECENT);
      saveRecent(updated);
      return updated;
    });
  }, []);

  /** Обновляем флаг hasHandle после async сохранения в IDB */
  const updateHasHandle = useCallback((name: string, has: boolean) => {
    setRecentFiles((prev) => {
      const updated = prev.map((f) => f.name === name ? { ...f, hasHandle: has } : f);
      saveRecent(updated);
      return updated;
    });
  }, []);

  const removeRecentFile = useCallback((name: string) => {
    removeRecentData(name);
    void removeHandleFromIDB(name);
    setRecentFiles((prev) => {
      const updated = prev.filter((f) => f.name !== name);
      saveRecent(updated);
      return updated;
    });
  }, []);

  const clearRecentFiles = useCallback(() => {
    setRecentFiles((prev) => {
      prev.forEach((f) => {
        removeRecentData(f.name);
        void removeHandleFromIDB(f.name);
      });
      return [];
    });
    saveRecent([]);
  }, []);

  return { recentFiles, addRecentFile, updateHasHandle, removeRecentFile, clearRecentFiles };
}
