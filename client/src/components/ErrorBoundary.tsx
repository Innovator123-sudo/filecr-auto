import React from 'react';

interface Props { children: React.ReactNode; fallback?: React.ReactNode; label?: string }
interface State { hasError: boolean; error: any }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  componentDidCatch(error: any, info: any) { console.error(`[ErrorBoundary ${this.props.label || ''}]`, error, info); }
  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen bg-ink flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md w-full glass rounded-2xl p-6 border border-white/10">
            <div className="text-2xl">😅 Oops</div>
            <div className="mt-2 text-sm text-zinc-400">Something broke in {this.props.label || 'this view'}.</div>
            <div className="mt-2 text-xs mono text-red-400 break-all">{String(this.state.error?.message || this.state.error || '').slice(0, 300)}</div>
            <button onClick={() => window.location.reload()} className="mt-4 px-5 py-2 bg-white text-black rounded-full font-bold text-sm">Reload</button>
            <a href="/" className="ml-2 inline-block mt-4 px-5 py-2 border border-white/15 rounded-full text-sm">Home</a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
