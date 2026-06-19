import { useState, useCallback } from "react";

export interface RecentFile {
  name: string;
  openedAt: number;
  nodeCount?: number;
  branchCount?: number;
}

const STORAGE_KEY = "vnt_recent_files";
const DATA_PREFIX  = "vnt_recent_data__";
const MAX_RECENT   = 10;

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
    // ignore — quota exceeded
  }
}

/** Сохраняем JSON проекта под отдельным ключом, чтобы потом открыть по клику */
export function saveRecentData(name: string, data: Record<string, unknown>) {
  try {
    const key = DATA_PREFIX + name;
    // Ограничиваем размер — если > 5 МБ, не сохраняем (защита от quota exceeded)
    const json = JSON.stringify(data);
    if (json.length < 5 * 1024 * 1024) {
      localStorage.setItem(key, json);
    }
  } catch (_e) {
    // ignore
  }
}

/** Загружаем JSON проекта по имени. Возвращает null если не найден. */
export function loadRecentData(name: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(DATA_PREFIX + name);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Удаляем данные проекта из localStorage */
function removeRecentData(name: string) {
  try {
    localStorage.removeItem(DATA_PREFIX + name);
  } catch (_e) {
    // ignore
  }
}

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

  const removeRecentFile = useCallback((name: string) => {
    removeRecentData(name);
    setRecentFiles((prev) => {
      const updated = prev.filter((f) => f.name !== name);
      saveRecent(updated);
      return updated;
    });
  }, []);

  const clearRecentFiles = useCallback(() => {
    setRecentFiles((prev) => {
      prev.forEach((f) => removeRecentData(f.name));
      return [];
    });
    saveRecent([]);
  }, []);

  return { recentFiles, addRecentFile, removeRecentFile, clearRecentFiles };
}
