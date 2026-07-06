import { useState } from "react";
import Icon from "@/components/ui/icon";
import { fetchRemoteVersion, isNewerVersion, downloadAndInstall } from "@/lib/updater";

interface Props {
  /** Текущая версия установленной программы (например "2.3.24") */
  currentVersion: string;
}

type Status = "idle" | "checking" | "latest" | "available" | "error";

/**
 * Кнопка «Проверить обновления» для окна «О программе».
 * Использует ЕДИНУЮ логику обновления (src/lib/updater.ts) — ту же, что и
 * верхний баннер: качает установщик по ?file=exe (браузер) или отдаёт команду
 * в C#-оболочку (десктоп).
 */
export default function UpdateCheckButton({ currentVersion }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [newVersion, setNewVersion] = useState("");
  const [notes, setNotes] = useState("");

  const check = async () => {
    setStatus("checking");
    try {
      const d = await fetchRemoteVersion();
      if (d.version && isNewerVersion(d.version, currentVersion)) {
        setNewVersion(d.version);
        setNotes(d.notes);
        setStatus("available");
      } else {
        setStatus("latest");
      }
    } catch {
      setStatus("error");
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
          onClick={downloadAndInstall}
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
