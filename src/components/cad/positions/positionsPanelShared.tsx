const btnStyle: React.CSSProperties = {
  border: "1px solid #b8b8b8", background: "#f5f5f5",
  cursor: "pointer", fontSize: 11, color: "#374151",
};

const inputStyle: React.CSSProperties = {
  fontSize: 11, border: "1px solid #c8c8c8",
  borderRadius: 2, padding: "1px 4px",
  background: "#fff", outline: "none", height: 18,
};

function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "3px 8px 2px", background: "#f0f0f0", borderTop: "1px solid #d8d8d8", borderBottom: "1px solid #d8d8d8", fontSize: 11, fontWeight: 600, color: "#333" }}>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 px-2 py-0.5">
      <span style={{ color: "#555", fontSize: 11, width: 130, flexShrink: 0 }}>{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export { btnStyle, inputStyle, GroupHeader, Row };
