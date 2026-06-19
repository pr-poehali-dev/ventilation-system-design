import { useState, useCallback } from "react";

export interface RecentFile {
  name: string;
  openedAt: number; // timestamp
  nodeCount?: number;
  branchCount?: number;
}

const STORAGE_KEY = "vnt_recent_files";
const MAX_RECENT = 10;

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
    setRecentFiles((prev) => {
      const updated = prev.filter((f) => f.name !== name);
      saveRecent(updated);
      return updated;
    });
  }, []);

  const clearRecentFiles = useCallback(() => {
    saveRecent([]);
    setRecentFiles([]);
  }, []);

  return { recentFiles, addRecentFile, removeRecentFile, clearRecentFiles };
}