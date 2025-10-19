/* =========================================================================
   FILE: frontend/src/components/ErrorBoundary.tsx
   ========================================================================= */
import React from "react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error?: any };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, info: any) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", background: "#0b0b0b", color: "#fff", padding: 24 }}>
          <h1 style={{ margin: 0 }}>Something went wrong.</h1>
          <p style={{ opacity: 0.8, marginTop: 8 }}>
            If you’re developing, check the browser console for details.
          </p>
          <pre style={{ marginTop: 16, whiteSpace: "pre-wrap" }}>
            {String(this.state.error ?? "")}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
