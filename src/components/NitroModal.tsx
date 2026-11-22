import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Award,
  Check,
  CreditCard,
  Crown,
  Flame,
  Info,
  MonitorPlay,
  Rocket,
  SmilePlus,
  Sparkles,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { apiFetch, ApiError } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { useToast } from '../client/ToastContext.tsx';
import type { NitroOverview, UserProfile } from '../shared/types.ts';

export function NitroModal({
  activeServerId,
  activeServerName,
  onClose,
  onServerUpdated,
}: {
  activeServerId?: string;
  activeServerName?: string;
  onClose: () => void;
  onServerUpdated?: () => void;
}) {
  const { updateProfileState } = useAuth();
  const { showToast } = useToast();
  const [overview, setOverview] = useState<NitroOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>('yearly');
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<NitroOverview>('/nitro/status');
      setOverview(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, []);

  const handleCheckout = async () => {
    setBusy(true);
    setCheckoutNotice(null);
    try {
      const res = await apiFetch<{ url: string; sessionId: string }>('/nitro/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan: selectedPlan }),
      });
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      showToast('Ödeme sayfası URL adresi alınamadı.', 'error');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Stripe ödeme oturumu başlatılamadı.';
      setCheckoutNotice(msg);
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ profile: UserProfile }>('/nitro/cancel', { method: 'POST' });
      updateProfileState(res.profile);
      await loadOverview();
      onServerUpdated?.();
      showToast('ORBIT Nitro aboneliği sonlandırıldı.', 'info');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Nitro iptal edilemedi.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleBoost = async (boosted: boolean) => {
    if (!activeServerId) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ boostCount: number }>(`/nitro/boost/${activeServerId}`, {
        method: boosted ? 'DELETE' : 'POST',
      });
      await loadOverview();
      onServerUpdated?.();
      showToast(
        boosted
          ? 'Sunucu takviyesi geri çekildi.'
          : `${activeServerName || 'Sunucu'} takviye edildi! (${res.boostCount} takviye)`,
        boosted ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Takviye işlemi başarısız.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const isBoostedThisServer = Boolean(
    activeServerId && overview?.boostedServerIds.includes(activeServerId)
  );

  const perks = [
    {
      icon: Upload,
      color: 'text-[#A855F7]',
      title: '50 MB Dosya & Medya Yükleme',
      desc: 'Standart 10 MB sınırı yerine yüksek kaliteli video, görsel ve dosya paylaşımı.',
    },
    {
      icon: SmilePlus,
      color: 'text-[#22C55E]',
      title: 'Tüm Sunucu Emojileri Her Yerde',
      desc: 'Üyesi olduğun tüm sunuculardaki özel emojileri herhangi bir kanalda veya DM’de kullan.',
    },
    {
      icon: Flame,
      color: 'text-[#F59E0B]',
      title: 'Özel Banner, Efekt & Çerçeveler',
      desc: 'Özel banner görselleri, Supernova/CyberGrid temaları, animasyonlu çerçeveler ve profil efektleri.',
    },
    {
      icon: MonitorPlay,
      color: 'text-[#38BDF8]',
      title: 'HD Canlı Yayın & Ses Paylaşımı',
      desc: 'Sesli odalarda yüksek kare hızında ekran yayını, ses aktarımı ve öncelikli sahne deneyimi.',
    },
    {
      icon: Rocket,
      color: 'text-[#C084FC]',
      title: '2 Adet Sunucu Takviyesi & Rozeti',
      desc: 'Sevdiğin sunuculara takviye yaparak seviye atlat, Sunucu Takviyecisi rozetini kazan.',
    },
    {
      icon: Award,
      color: 'text-[#EC4899]',
      title: 'Özel ORBIT Nitro Profil Rozeti',
      desc: 'Profil kartında ve üye listelerinde parlayan resmi ORBIT Nitro rozeti.',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[92dvh] rounded-2xl bg-white dark:bg-[#151522] border border-[#A855F7]/30 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Hero Header */}
        <div className="relative px-6 py-5 bg-gradient-to-r from-[#6D28D9] via-[#9333EA] to-[#EC4899] text-white flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase text-white/90">
              <Sparkles className="w-3.5 h-3.5" />
              ORBIT Nitro Aboneliği
            </div>
            <h3 className="text-xl font-bold font-display">Topluluk Deneyimini Zirveye Taşı</h3>
            <p className="text-xs text-white/90 max-w-xl">
              Daha yüksek yükleme limiti, tüm sunucu emojileri, animasyonlu profil süslemeleri, HD yayın ve sunucu takviyeleri.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-2 rounded-lg bg-black/25 hover:bg-black/40 text-white shrink-0 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading || !overview ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-[#A1A1B5]">
              ORBIT Nitro bilgileri yükleniyor...
            </div>
          ) : (
            <>
              {/* Current Subscription Status */}
              <div
                className={`rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
                  overview.isNitro
                    ? 'border-[#A855F7]/45 bg-[#7C3AED]/15'
                    : 'border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B]'
                }`}
              >
                <div className="space-y-1">
                  <p className="text-sm font-bold flex items-center gap-2">
                    <Crown className={`w-4 h-4 ${overview.isNitro ? 'text-[#C084FC]' : 'text-slate-400'}`} />
                    {overview.isNitro ? 'ORBIT Nitro Aktif' : 'Standart ORBIT Hesabı'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-[#A1A1B5] tabular-nums">
                    Yükleme Limiti: <strong className="text-[#C084FC]">{overview.maxUploadMb} MB</strong>
                    <span className="mx-1.5">·</span>
                    Takviyeli Sunucu: <strong>{overview.boostedServerIds.length}</strong>
                    {overview.isNitro && overview.nitroExpiresAt && (
                      <>
                        <span className="mx-1.5">·</span>
                        Geçerlilik:{' '}
                        <strong>{new Date(overview.nitroExpiresAt).toLocaleDateString('tr-TR')}</strong>
                      </>
                    )}
                  </p>
                </div>

                {overview.isNitro && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleCancel()}
                    className="h-9 px-4 rounded-xl border border-[#EF4444]/40 text-[#EF4444] hover:bg-[#EF4444]/10 text-xs font-semibold transition-colors"
                  >
                    Nitro&apos;yu İptal Et
                  </button>
                )}
              </div>

              {/* Monthly / Yearly Paid Plan Selector */}
              {!overview.isNitro && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                      Üyelik Planı Seçin
                    </h4>
                    <span className="text-[11px] text-[#22C55E] font-semibold">
                      Yıllık planda %17 tasarruf
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedPlan('monthly')}
                      className={`text-left p-4 rounded-2xl border transition-all ${
                        selectedPlan === 'monthly'
                          ? 'border-[#A855F7] bg-[#7C3AED]/12 ring-2 ring-[#A855F7]/25'
                          : 'border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] hover:border-[#A855F7]/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-700 dark:text-[#F8FAFC]">Aylık Nitro</span>
                        <span className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">Esnek fatura</span>
                      </div>
                      <p className="text-2xl font-bold font-display font-mono tabular-nums mt-2 text-[#C084FC]">
                        {overview.monthlyPriceLabel}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] mt-1">
                        Her ay otomatik yenilenir, dilediğin an iptal edebilirsin.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedPlan('yearly')}
                      className={`text-left p-4 rounded-2xl border transition-all relative ${
                        selectedPlan === 'yearly'
                          ? 'border-[#A855F7] bg-[#7C3AED]/15 ring-2 ring-[#A855F7]/30'
                          : 'border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] hover:border-[#A855F7]/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-700 dark:text-[#F8FAFC]">Yıllık Nitro</span>
                        <span className="text-[11px] font-bold text-[#22C55E]">2 Ay Hediye</span>
                      </div>
                      <p className="text-2xl font-bold font-display font-mono tabular-nums mt-2 text-[#C084FC]">
                        {overview.yearlyPriceLabel}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] mt-1">
                        Yıllık tek ödeme ile kesintisiz Nitro ve tüm ayrıcalıklar.
                      </p>
                    </button>
                  </div>

                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleCheckout()}
                      className="w-full sm:w-auto h-11 px-6 rounded-xl bg-gradient-to-r from-[#7C3AED] to-[#EC4899] hover:opacity-95 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-lg transition-opacity"
                    >
                      <CreditCard className="w-4 h-4" />
                      {busy
                        ? 'Ödeme Sayfasına Yönlendiriliyor...'
                        : selectedPlan === 'yearly'
                        ? `Yıllık Aboneliği Başlat (${overview.yearlyPriceLabel})`
                        : `Aylık Aboneliği Başlat (${overview.monthlyPriceLabel})`}
                    </button>
                  </div>
                </div>
              )}

              {/* Stripe Configuration or Checkout Error Notice */}
              {(!overview.priceConfigured || checkoutNotice) && (
                <div className="rounded-xl border border-[#F59E0B]/35 bg-[#F59E0B]/10 p-3.5 text-xs text-amber-800 dark:text-[#F59E0B] flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold">
                      {checkoutNotice || 'Stripe ödeme anahtarları yapılandırması bekleniyor.'}
                    </p>
                    <p className="text-[11px] opacity-90">
                      Güvenli kart ödemeleri için sunucu <code className="font-mono">.env</code> dosyasında{' '}
                      <code className="font-mono">STRIPE_SECRET_KEY</code>,{' '}
                      <code className="font-mono">STRIPE_WEBHOOK_SECRET</code>,{' '}
                      <code className="font-mono">STRIPE_NITRO_PRICE_ID</code> ve{' '}
                      <code className="font-mono">STRIPE_NITRO_YEARLY_PRICE_ID</code> değişkenlerinin tanımlı olması gerekir.
                    </p>
                  </div>
                </div>
              )}

              {/* Perks Grid */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                  ORBIT Nitro Ayrıcalıkları
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {perks.map((perk) => {
                    const Icon = perk.icon;
                    return (
                      <div
                        key={perk.title}
                        className="rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#19192A]/70 p-3.5 flex items-start gap-3"
                      >
                        <div className="w-9 h-9 rounded-xl bg-white dark:bg-[#10111B] border border-slate-200 dark:border-[#29293D] flex items-center justify-center shrink-0">
                          <Icon className={`w-4 h-4 ${perk.color}`} />
                        </div>
                        <div className="space-y-0.5 min-w-0">
                          <p className="text-xs font-bold flex items-center gap-1.5">
                            <span>{perk.title}</span>
                            {overview.isNitro && <Check className="w-3.5 h-3.5 text-[#22C55E] shrink-0" />}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] leading-relaxed">{perk.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Active Server Boost Action */}
              {activeServerId && (
                <div className="rounded-2xl border border-[#A855F7]/30 bg-slate-50 dark:bg-[#10111B] p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs font-bold flex items-center gap-1.5">
                      <Zap className="w-4 h-4 text-[#C084FC]" />
                      {activeServerName || 'Bu Sunucu'} Takviyesi
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] mt-0.5">
                      {!overview.isNitro
                        ? 'Sunucu takviyesi yapabilmek için aktif ORBIT Nitro aboneliği gerekir.'
                        : isBoostedThisServer
                        ? 'Bu sunucuyu aktif olarak takviye ediyorsunuz.'
                        : 'Nitro takviyenizi bu sunucuya aktararak rozet ve seviye kazandırabilirsiniz.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy || !overview.isNitro}
                    onClick={() => void handleToggleBoost(isBoostedThisServer)}
                    className={`h-9 px-4 rounded-xl text-xs font-semibold disabled:opacity-45 transition-colors ${
                      isBoostedThisServer
                        ? 'border border-[#EF4444]/40 text-[#EF4444] hover:bg-[#EF4444]/10'
                        : 'bg-[#7C3AED] hover:bg-[#6D28D9] text-white'
                    }`}
                  >
                    {isBoostedThisServer ? 'Takviyeyi Çek' : 'Sunucuyu Takviye Et'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
