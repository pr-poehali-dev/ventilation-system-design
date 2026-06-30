import { useEffect, useState } from "react";

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

type UpdateState =
  | { phase: "idle" }
  | { phase: "available"; info: UpdateInfo }
  | { phase: "downloading"; percent: number }
  | { phase: "ready" };

export default function UpdateNotification() {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI;
    if (!api) return;

    api.onUpdateAvailable?.((info: UpdateInfo) => {
      setState({ phase: "available", info });
      setVisible(true);
    });

    api.onUpdateProgress?.((p: { percent: number }) => {
      setState({ phase: "downloading", percent: Math.round(p.percent) });
    });

    api.onUpdateDownloaded?.(() => {
      setState({ phase: "ready" });
    });

    // Проверяем при старте (с задержкой чтобы не мешать загрузке)
    const t = setTimeout(() => api.checkForUpdates?.().catch(() => {}), 5000);
    return () => clearTimeout(t);
  }, []);

  if (!visible || state.phase === "idle") return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        background: "#1e293b",
        color: "#f1f5f9",
        borderRadius: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        padding: "16px 20px",
        minWidth: 300,
        maxWidth: 380,
        fontFamily: "sans-serif",
        fontSize: 14,
        border: "1px solid #334155",
      }}
    >
      {/* Закрыть */}
      {state.phase !== "downloading" && (
        <button
          onClick={() => setVisible(false)}
          style={{
            position: "absolute", top: 10, right: 12,
            background: "none", border: "none", color: "#94a3b8",
            fontSize: 18, cursor: "pointer", lineHeight: 1,
          }}
        >
          ×
        </button>
      )}

      {state.phase === "available" && (
        <>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            Доступна новая версия {state.info.version}
          </div>
          <div style={{ color: "#94a3b8", marginBottom: 14, fontSize: 13 }}>
            Обновление установится автоматически после перезапуска
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).electronAPI?.downloadUpdate();
                setState({ phase: "downloading", percent: 0 });
              }}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 8,
                background: "#3b82f6", color: "#fff",
                border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
              }}
            >
              Обновить сейчас
            </button>
            <button
              onClick={() => setVisible(false)}
              style={{
                padding: "8px 16px", borderRadius: 8,
                background: "#334155", color: "#cbd5e1",
                border: "none", cursor: "pointer", fontSize: 13,
              }}
            >
              Позже
            </button>
          </div>
        </>
      )}

      {state.phase === "downloading" && (
        <>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>
            Скачивание обновления... {state.percent}%
          </div>
          <div style={{ background: "#334155", borderRadius: 4, height: 6, overflow: "hidden" }}>
            <div
              style={{
                width: `${state.percent}%`,
                height: "100%",
                background: "#3b82f6",
                transition: "width 0.3s",
              }}
            />
          </div>
        </>
      )}

      {state.phase === "ready" && (
        <>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            Обновление готово к установке
          </div>
          <div style={{ color: "#94a3b8", marginBottom: 14, fontSize: 13 }}>
            Программа перезапустится и установит обновление
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).electronAPI?.installUpdate();
              }}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 8,
                background: "#22c55e", color: "#fff",
                border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
              }}
            >
              Перезапустить и установить
            </button>
            <button
              onClick={() => setVisible(false)}
              style={{
                padding: "8px 16px", borderRadius: 8,
                background: "#334155", color: "#cbd5e1",
                border: "none", cursor: "pointer", fontSize: 13,
              }}
            >
              Позже
            </button>
          </div>
        </>
      )}
    </div>
  );
}
