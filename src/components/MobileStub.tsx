import { useState } from "react";
import { Monitor, Copy, Check } from "lucide-react";

export default function MobileStub() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ background: "hsl(220, 20%, 8%)", color: "hsl(210, 20%, 90%)" }}>

      <div className="mb-8 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-white text-lg"
          style={{ background: "hsl(210, 100%, 56%)" }}>
          В
        </div>
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

      <button
        onClick={handleCopy}
        className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-base transition-all active:scale-95"
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

      <p className="mt-10 text-sm" style={{ color: "hsl(215, 15%, 40%)", fontFamily: "'IBM Plex Mono', monospace" }}>
        ventilation-cad.ru
      </p>
    </div>
  );
}
