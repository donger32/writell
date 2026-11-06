import { Component, type ReactNode } from 'react';

/** Keeps one broken screen from taking down the whole app (your writing stays safe in the database) */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  componentDidCatch(error: Error) { console.error('Screen crashed:', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="edetail-empty">
        <h3>This screen hit a problem</h3>
        <p className="muted">Your writing is safe — everything was already saved. Try another screen from the sidebar, or reload.</p>
        <code className="small" style={{ maxWidth: 520, whiteSpace: 'pre-wrap' }}>{this.state.error.message}</code>
        <div className="row gap-s"><button className="btn" onClick={() => this.setState({ error: null })}>Try again</button><button className="btn primary" onClick={() => location.reload()}>Reload app</button></div>
      </div>
    );
  }
}
