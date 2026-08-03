import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const ReactComponent = React.Component as any;

export class ErrorBoundary extends ReactComponent {
  state: State = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught React Error:', error, errorInfo);
  }

  render() {
    if ((this.state as State).hasError) {
      return (
        <div className="fixed inset-0 bg-[#07080A] text-white flex flex-col items-center justify-center p-6 font-mono text-center z-50">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-red-500 animate-pulse" />
          </div>
          <h1 className="text-lg font-bold uppercase tracking-wider text-red-400 mb-2">Application Interface Recovered</h1>
          <p className="text-xs text-gray-400 max-w-md mb-6 leading-relaxed">
            {(this.state as State).error?.message || 'An unexpected client runtime error occurred.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-colors shadow-lg shadow-indigo-900/40"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Reload Platform</span>
          </button>
        </div>
      );
    }

    return (this.props as Props).children;
  }
}
