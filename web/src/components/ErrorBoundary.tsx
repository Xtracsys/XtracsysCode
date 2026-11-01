import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Last-resort render guard: a crash anywhere in the React tree (e.g. a restored
 *  chat record with unexpected shapes) must degrade to a recoverable message, not
 *  unmount the whole app or crash-loop it on launch. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty" style={{ padding: "4rem 2rem" }}>
          <p className="empty-title">The interface hit an unexpected error</p>
          <p className="hint" style={{ maxWidth: "60ch" }}>{this.state.error.message}</p>
          <button type="button" className="btn primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button type="button" className="btn ghost" style={{ marginLeft: 8 }} onClick={() => window.location.reload()}>
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
