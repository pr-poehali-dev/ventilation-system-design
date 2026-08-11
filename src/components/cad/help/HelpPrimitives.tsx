// ─────────────────────────────────────────────────────────────────────────────
// HelpPrimitives — вспомогательные мини-компоненты руководства пользователя.
// Вынесены из HelpDialog.tsx без изменений разметки и стилей.
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";

// Общий тип секции руководства (используется во всех частях).
export interface Section {
  id: string;
  icon: string;
  title: string;
  content: React.ReactNode;
}

export function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-bold text-gray-800 text-[13px] mt-3 mb-1.5 pb-1"
      style={{ borderBottom: "1px solid #e5e7eb" }}>
      {children}
    </h3>
  );
}

export function Li({ children, icon, color }: { children: React.ReactNode; icon: string; color: string }) {
  return (
    <li className="flex items-start gap-2 text-[12px] text-gray-700">
      <Icon name={icon as Parameters<typeof Icon>[0]["name"]} size={14}
        style={{ color, flexShrink: 0, marginTop: 2 }} />
      <span>{children}</span>
    </li>
  );
}

export function Block({ title, children, color }: { title: string; children: React.ReactNode; color: string }) {
  return (
    <div className="p-3 rounded-lg text-[12px] text-gray-700 leading-relaxed"
      style={{ background: color, border: "1px solid rgba(0,0,0,0.06)" }}>
      <div className="font-semibold text-gray-800 mb-1">{title}</div>
      {children}
    </div>
  );
}

export function KBD({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold"
      style={{ background: "#f3f4f6", border: "1px solid #d1d5db", color: "#374151", boxShadow: "0 1px 0 #9ca3af" }}>
      {children}
    </kbd>
  );
}

export function QStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold text-white"
        style={{ background: "#2563eb" }}>
        {n}
      </div>
      <div className="text-[12px] text-gray-700 leading-relaxed pt-0.5">
        <div className="font-semibold text-gray-800">{title}</div>
        <div>{children}</div>
      </div>
    </li>
  );
}
