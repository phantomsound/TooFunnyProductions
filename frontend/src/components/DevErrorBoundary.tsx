// frontend/src/components/DevErrorBoundary.tsx
import React from "react";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export default class DevErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("DevErrorBoundary caught:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{ padding: 24, color: "#fff", background: "#111", minHeight: "100vh" }}>
        <h1 style={{ marginBottom: 12 }}>Boot failed.</h1>
        <p style={{ opacity: 0.85, marginBottom: 16 }}>
          See the details below and the browser console.
        </p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#1c1c1c",
            padding: 16,
            borderRadius: 8,
            border: "1px solid #333",
            overflowX: "auto",
          }}
        >
{String(this.state.error?.message || this.state.error)}
        </pre>
      </div>
    );
  }
}
