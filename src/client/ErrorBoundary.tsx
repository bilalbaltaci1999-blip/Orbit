import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Beklenmeyen bir arayüz hatası oluştu.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0B0B12] text-[#F8FAFC] p-6">
          <div className="max-w-md w-full rounded-2xl border border-[#29293D] bg-[#151522] p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/30 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6 text-[#EF4444]" />
            </div>
            <h1 className="text-lg font-semibold font-display">ORBIT bir hatayla karşılaştı</h1>
            <p className="text-sm text-[#A1A1B5]">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-medium transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Sayfayı Yenile
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
