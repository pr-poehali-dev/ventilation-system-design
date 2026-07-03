import { useState } from "react";
import { Monitor, Copy, Check } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import AppLogo from "@/components/AppLogo";

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
        <AppLogo className="w-10 h-10 object-contain" />
        <span className="text-xl font-semibold" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
          ПВ-Система
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
        ПВ-Система — профессиональный инструмент для проектирования вентиляции и водоснабжения.
        Для комфортной работы требуется экран компьютера.
      </p>

      <div className="mb-6 p-4 rounded-2xl flex flex-col items-center"
        style={{ background: "hsl(220, 18%, 11%)", border: "1px solid hsl(220, 15%, 18%)" }}>
        <p className="text-xs mb-3 text-center w-full" style={{ color: "hsl(215, 15%, 55%)", fontFamily: "'IBM Plex Sans', sans-serif" }}>
          Отсканируйте с компьютера или планшета
        </p>
        <QRCodeSVG
          value={url}
          size={200}
          bgColor="hsl(220, 18%, 11%)"
          fgColor="hsl(210, 20%, 90%)"
          level="M"
        />
      </div>

      {/* Главная кнопка: открыть в полной (десктопной) версии */}
      <button
        onClick={onForceDesktop}
        className="flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-base transition-all active:scale-95 mb-3"
        style={{
          background: "hsl(210, 100%, 56%)",
          color: "white",
          fontFamily: "'IBM Plex Sans', sans-serif",
          boxShadow: "0 4px 14px rgba(33, 150, 243, 0.35)",
        }}>
        <Monitor size={18} /> Открыть в полной версии
      </button>

      {/* Второстепенная кнопка: скопировать ссылку для отправки на ПК */}
      <button
        onClick={handleCopy}
        className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all active:scale-95 text-sm"
        style={{
          color: "hsl(210, 50%, 75%)",
          fontFamily: "'IBM Plex Sans', sans-serif",
          border: "1px solid hsl(220, 15%, 22%)",
        }}>
        {copied
          ? <><Check size={14} /> Ссылка скопирована</>
          : <><Copy size={14} /> Скопировать ссылку для ПК</>
        }
      </button>

      <p className="mt-8 text-xs" style={{ color: "hsl(215, 15%, 40%)", fontFamily: "'IBM Plex Sans', sans-serif" }}>
        ПВ-Система · версия 1.0.0
      </p>
    </div>
  );
}