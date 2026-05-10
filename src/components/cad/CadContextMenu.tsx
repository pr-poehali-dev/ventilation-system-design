import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/ui/icon";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}

interface CadContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function CadContextMenu({ x, y, items, onSelect, onClose }: CadContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) menuRef.current.style.left = `${x - rect.width}px`;
    if (rect.bottom > vh) menuRef.current.style.top = `${y - rect.height}px`;
  }, [x, y]);

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 99999,
        minWidth: 210,
        background: "#f0f0f0",
        border: "1px solid #888",
        boxShadow: "2px 3px 8px rgba(0,0,0,0.28)",
        borderRadius: 2,
        padding: "2px 0",
        userSelect: "none",
      }}
    >
      {items.map((item) =>
        item.divider ? (
          <div key={item.id} style={{ height: 1, background: "#b8b8b8", margin: "2px 0" }} />
        ) : (
          <div
            key={item.id}
            onClick={() => {
              if (!item.disabled) {
                onSelect(item.id);
                onClose();
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 14px 3px 8px",
              fontSize: 12,
              cursor: item.disabled ? "default" : "pointer",
              color: item.danger ? "#c00" : item.disabled ? "#aaa" : "#111",
              background: "transparent",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              if (!item.disabled)
                (e.currentTarget as HTMLDivElement).style.background = "#0078d4";
              if (!item.disabled)
                (e.currentTarget as HTMLDivElement).style.color = item.danger ? "#ffaaaa" : "#fff";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "transparent";
              (e.currentTarget as HTMLDivElement).style.color = item.danger ? "#c00" : item.disabled ? "#aaa" : "#111";
            }}
          >
            <span style={{ width: 16, display: "flex", alignItems: "center", flexShrink: 0 }}>
              {item.icon && <Icon name={item.icon as Parameters<typeof Icon>[0]["name"]} size={13} />}
            </span>
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.shortcut && (
              <span style={{ fontSize: 11, color: "#888", marginLeft: 12 }}>{item.shortcut}</span>
            )}
          </div>
        )
      )}
    </div>,
    document.body
  );
}
