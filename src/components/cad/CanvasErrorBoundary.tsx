import React from "react";

interface State { error: Error | null }

export class CanvasErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[CanvasErrorBoundary] Ошибка рендера схемы:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", background: "#1a1a2e", color: "#fff",
          fontFamily: "Arial, sans-serif", gap: 12,
        }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Ошибка рендера схемы</div>
          <div style={{ fontSize: 12, color: "#aaa", maxWidth: 400, textAlign: "center" }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 8, padding: "6px 18px", borderRadius: 6, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer", fontSize: 13 }}
          >
            Попробовать снова
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
