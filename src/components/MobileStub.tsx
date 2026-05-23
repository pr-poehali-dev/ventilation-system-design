import { useState } from "react";
import { Monitor, Copy, Check } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface Props {
  onForceDesktop: () => void;
}

export default function MobileStub({ onForceDesktop }: Props) {
  const [copied, setCopied] = useState(false);
  const url = window.location.href;

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ background: "hsl(220, 20%, 8%)", color: "hsl(210, 20%, 90%)" }}>

      <div className="mb-8 flex items-center gap-3">
        <img src="https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/icons/app-icon-128.png" alt="ПВ-Система" className="w-10 h-10 object-contain" draggable={false} />
        <span className="text-xl font-semibold" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
          Вентиляция-CAD
        </span>
      </div>

      <div className="mb-6 w-20 h-20 rounded-2xl flex items-center justify-center"
        style={{ background: "hsl(220, 18%, 11%)", border: "1px solid hsl(220, 15%, 18%)" }}>
        <Monitor size={40} style={{ color: "hsl(210, 100%, 56%)" }} />
      </div>

      <h1 className="text-2xl font-semibold mb-3" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
        Откройте на компьютере
      </h1>

      <p className="text-base leading-relaxed mb-8 max-w-xs"
        style={{ color: "hsl(215, 15%, 55%)", fontFamily: "'IBM Plex Sans', sans-serif" }}>
        Вентиляция-CAD — профессиональный инструмент для проектирования вентиляции шахт.
        Для комфортной работы требуется экран компьютера.
      </p>

      <div className="mb-6 p-4 rounded-2xl"
        style={{ background: "hsl(220, 18%, 11%)", border: "1px solid hsl(220, 15%, 18%)" }}>
        <p className="text-xs mb-3" style={{ color: "hsl(215, 15%, 55%)", fontFamily: "'IBM Plex Sans', sans-serif" }}>
          Отсканируйте с компьютера или планшета
        </p>
        <QRCodeSVG
          value={url}
          size={160}
          bgColor="hsl(220, 18%, 11%)"
          fgColor="hsl(210, 20%, 90%)"
          level="M"
        />
      </div>

      <button
        onClick={handleCopy}
        className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-base transition-all active:scale-95 mb-3"
        style={{
          background: copied ? "hsl(140, 60%, 35%)" : "hsl(210, 100%, 56%)",
          color: "hsl(220, 20%, 8%)",
          fontFamily: "'IBM Plex Sans', sans-serif",
        }}>
        {copied
          ? <><Check size={18} /> Ссылка скопирована</>
          : <><Copy size={18} /> Скопировать ссылку</>
        }
      </button>

      <button
        onClick={onForceDesktop}
        className="text-sm px-4 py-2 rounded-lg transition-all active:scale-95"
        style={{
          color: "hsl(215, 15%, 50%)",
          fontFamily: "'IBM Plex Sans', sans-serif",
          border: "1px solid hsl(220, 15%, 22%)",
        }}>
        Всё равно открыть на этом устройстве
      </button>

      <p className="mt-8 text-sm" style={{ color: "hsl(215, 15%, 40%)", fontFamily: "'IBM Plex Mono', monospace" }}>
        ventilation-cad.ru
      </p>
    </div>
  );
}