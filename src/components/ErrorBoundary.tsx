import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** The boundary tries again when this changes (the page the user moved to). */
  resetKey?: string;
}

interface State {
  error: Error | null;
  resetKey?: string;
}

/** Keeps a crash in one screen from blanking the whole app: shows the reason and lets the user retry or reload. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("화면 오류:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page" role="alert">
        <h2>이 화면에서 오류가 발생했습니다.</h2>
        <p className="muted" style={{ margin: "8px 0 16px" }}>
          {this.state.error.message}
        </p>
        <div className="btn-row">
          <button className="btn primary" type="button" onClick={() => this.setState({ error: null })}>
            다시 시도
          </button>
          <button className="btn" type="button" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      </div>
    );
  }
}
