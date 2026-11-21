import { Download, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { useState } from 'react';
import { usePWAInstall } from '../client/usePWAInstall.ts';

export function OfflineIndicator() {
  const { isOffline } = usePWAInstall();
  if (!isOffline) return null;

  return (
    <div
      role="status"
      className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-300 flex items-center justify-center gap-2 shrink-0"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Çevrimdışısınız — İnternet bağlantısı geri geldiğinde mesajlar senkronize edilecek.</span>
    </div>
  );
}

export function IOSInstallGuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] p-5 space-y-4 shadow-2xl animate-orbit-enter"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-[#A855F7]" />
            <h3 className="text-sm font-bold font-display">iPhone / iPad Ana Ekrana Ekle</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 dark:text-[#A1A1B5] hover:text-slate-900 dark:hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <ol className="space-y-2.5 text-xs text-slate-600 dark:text-[#F8FAFC]/80 list-decimal pl-4">
          <li>
            Safari alt çubuğundaki <strong className="inline-flex items-center gap-1 text-[#A855F7]"><Share className="w-3.5 h-3.5" /> Paylaş</strong> simgesine dokunun.
          </li>
          <li>Açılan menüde aşağı kaydırıp <strong>&quot;Ana Ekrana Ekle&quot;</strong> seçeneğine dokunun.</li>
          <li>Sağ üstten <strong>&quot;Ekle&quot;</strong> dediğinizde ORBIT tam ekran mobil uygulama olarak açılır.</li>
        </ol>

        <button
          type="button"
          onClick={onClose}
          className="w-full h-10 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors"
        >
          Anladım
        </button>
      </div>
    </div>
  );
}

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const { canInstall, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [iosGuideOpen, setIosGuideOpen] = useState(false);

  if (isInstalled) return null;
  if (!canInstall && !isIOS) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (canInstall) {
            void promptInstall();
          } else if (isIOS) {
            setIosGuideOpen(true);
          }
        }}
        title="ORBIT Uygulamasını Kur"
        className={
          compact
            ? 'min-h-[40px] px-2.5 rounded-xl bg-[#7C3AED]/15 hover:bg-[#7C3AED]/25 border border-[#A855F7]/30 text-[#7C3AED] dark:text-[#C084FC] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors'
            : 'h-10 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors'
        }
      >
        <Download className="w-4 h-4 shrink-0" />
        <span className={compact ? 'hidden sm:inline' : ''}>Uygulamayı Kur</span>
      </button>

      {iosGuideOpen && <IOSInstallGuideModal onClose={() => setIosGuideOpen(false)} />}
    </>
  );
}
