import { useState } from "react";
import Icon from "@/components/ui/icon";

const VERSION_URL = "https://functions.poehali.dev/0ddfea8a-386f-4cb2-9fe0-37274caf2e16";

interface Props {
  /** Текущая версия установленной программы (например "2.0.17") */
  currentVersion: string;
}

interface DesktopApi {
  installUpdate?: () => void;
}

type Status = "idle" | "checking" | "latest" | "available" | "error";

/** Сравнение версий вида "2.0.17" — true если remote новее local */
function isNewer(remote: string, local: string): boolean {
  const r = remote.split(".").map(n => parseInt(n, 10) || 0);
  const l = local.split(".").map(n => parseInt(n, 10) || 0);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const a = r[i] ?? 0, b = l[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

/**
 * Кнопка «Проверить обновления» для окна «О программе».
 * Запрашивает сервер версий, сравнивает с текущей и предлагает скачать.
 * В десктопе скачивание идёт через C# (electronAPI.installUpdate),
 * в браузере — открывает прямую ссылку на установщик.
 */
export default function UpdateCheckButton({ currentVersion }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [newVersion, setNewVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  const check = async () => {
    setStatus("checking");
    try {
      const res = await fetch(VERSION_URL, { cache: "no-store" });
      const text = await res.text();
      if (!text.trim().startsWith("{")) throw new Error("bad response");
      const d = JSON.parse(text);
      const remote = String(d.version || "");
      if (remote && isNewer(remote, currentVersion)) {
        setNewVersion(remote);
        setNotes(String(d.notes || ""));
        setDownloadUrl(String(d.download_url || ""));
        setStatus("available");
      } else {
        setStatus("latest");
      }
    } catch {
      setStatus("error");
    }
  };

  const install = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI as DesktopApi | undefined;
    if (api?.installUpdate) {
      api.installUpdate();
    } else if (downloadUrl) {
      window.open(downloadUrl, "_blank");
    }
  };

  if (status === "available") {
    return (
      <div className="w-full flex flex-col items-start gap-2 px-1">
        <div className="flex items-center gap-1.5 text-[12px] text-green-700">
          <Icon name="Sparkles" size={14} />
          Доступна новая версия <b>v{newVersion}</b>
        </div>
        {notes && <div className="text-[11px] text-gray-500">{notes}</div>}
        <button
          onClick={install}
          className="h-7 px-3 text-[12px] rounded text-white font-medium flex items-center gap-1.5"
          style={{ background: "#16a34a" }}>
          <Icon name="Download" size={13} />
          Скачать и обновить
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={check}
      disabled={status === "checking"}
      className="h-7 px-3 text-[12px] rounded font-medium flex items-center gap-1.5 border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
      title="Проверить наличие обновлений">
      {status === "checking" ? (
        <><Icon name="Loader" size={13} className="animate-spin" />Проверка…</>
      ) : status === "latest" ? (
        <><Icon name="CheckCircle" size={13} className="text-green-600" />Установлена последняя версия</>
      ) : status === "error" ? (
        <><Icon name="AlertCircle" size={13} className="text-amber-600" />Не удалось проверить</>
      ) : (
        <><Icon name="RefreshCw" size={13} />Проверить обновления</>
      )}
    </button>
  );
}
