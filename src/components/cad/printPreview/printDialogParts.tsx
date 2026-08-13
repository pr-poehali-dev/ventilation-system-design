// ─────────────────────────────────────────────────────────────────────────────
// printDialogParts.tsx — общие части диалога печати: печать через скрытый
// iframe, форматы бумаги, сворачиваемая секция настроек, строка параметра
// и общие классы полей ввода.
//
// Вынесено из PrintDialog.tsx БЕЗ изменений логики, стилей и размеров.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";

export function printViaIframe(html: string) {
  const existing = document.getElementById("__pvs_print_frame__");
  if (existing) existing.remove();
  const iframe = document.createElement("iframe");
  iframe.id = "__pvs_print_frame__";
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  iframe.contentWindow?.focus();

  // Ждём, пока браузер РЕАЛЬНО декодирует картинки листов, и только потом
  // вызываем печать. Раньше здесь стояла слепая пауза 500 мс: лист A3 при
  // 300 dpi весит десятки мегабайт и декодируется дольше — print() уходил
  // на неготовый документ, и окно печати зависало с пустой страницей.
  let done = false;
  const start = () => {
    if (done) return;
    done = true;
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2000);
  };

  const imgs = Array.from(doc.images);
  const waitAll = imgs.length === 0
    ? Promise.resolve()
    : Promise.all(imgs.map((img) => (
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((res) => {
              img.addEventListener("load",  () => res(), { once: true });
              img.addEventListener("error", () => res(), { once: true });
            })
      )));

  // Страховка: даже если какая-то картинка не отдала событие, печать всё
  // равно запустится — программа не должна «зависать» насовсем.
  const guard = setTimeout(start, 60000);
  void waitAll.then(() => {
    clearTimeout(guard);
    // Даём кадр на раскладку страниц, затем печатаем.
    requestAnimationFrame(() => setTimeout(start, 50));
  });
}

export type PaperFormat = "A4" | "A3" | "A2" | "A1" | "A0" | "custom";
export type Orientation = "portrait" | "landscape";

export const PAPER_SIZES: Record<Exclude<PaperFormat, "custom">, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
};

export function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid #d0d0d0" }}>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left"
        style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a", background: "#e4e4e4" }}>
        <span style={{ fontSize: 8, color: "#555" }}>{open ? "▼" : "►"}</span>
        {title}
      </button>
      {open && <div className="px-3 py-2 space-y-1.5">{children}</div>}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ width: 88, fontSize: 12, color: "#1a1a1a", flexShrink: 0, fontWeight: 500 }}>{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export const inp = "border border-gray-500 px-1.5 rounded text-[12px] text-gray-900 bg-white focus:outline-none focus:border-blue-500";
export const sel = inp + " cursor-pointer w-full";
export const ih = { height: 22 } as React.CSSProperties;