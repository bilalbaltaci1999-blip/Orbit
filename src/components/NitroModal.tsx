import { useEffect, useState } from 'react';
import { Check, Crown, Flame, Info, Rocket, SmilePlus, Sparkles, Upload, X, Zap } from 'lucide-react';
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

  const handleActivate = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ profile: UserProfile }>('/nitro/activate', {
        method: 'POST',
        body: JSON.stringify({ tier: 'nitro' }),
      });
      updateProfileState(res.profile);
      await loadOverview();
      showToast('ORBIT Nitro hesabınızda aktifleştirildi!', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Nitro aktifleştirilemedi.', 'error');
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90dvh] rounded-2xl bg-white dark:bg-[#151522] border border-[#A855F7]/30 shadow-2xl flex flex-col overflow-hidden animate-orbit-enter"
      >
        {/* Hero Header */}
        <div className="relative px-6 py-5 bg-gradient-to-r from-[#7C3AED] via-[#A855F7] to-[#C084FC] text-white flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur-sm text-[11px] font-bold tracking-wider uppercase">
              <Sparkles className="w-3.5 h-3.5" />
              ORBIT Nitro
            </div>
            <h3 className="text-xl font-bold font-display">Topluluk Deneyimini Zirveye Taşı</h3>
            <p className="text-xs text-white/90">
              Daha büyük dosya yüklemeleri, tüm sunucularda özel emojiler, profil efektleri ve sunucu takviyeleri.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-1.5 rounded-lg bg-black/25 hover:bg-black/40 text-white shrink-0 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading || !overview ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-[#A1A1B5]">ORBIT Nitro bilgileri yükleniyor...</div>
          ) : (
            <>
              {/* Active Status Banner */}
              <div
                className={`rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
                  overview.isNitro
                    ? 'border-[#A855F7]/45 bg-[#7C3AED]/15'
                    : 'border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B]'
                }`}
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-bold flex items-center gap-2">
                    <Crown className={`w-4 h-4 ${overview.isNitro ? 'text-[#C084FC]' : 'text-slate-400'}`} />
                    {overview.isNitro ? 'ORBIT Nitro Aktif' : 'Standart ORBIT Hesabı'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                    Dosya yükleme limitiniz: <strong className="text-[#C084FC]">{overview.maxUploadMb} MB</strong> ·{' '}
                    Takviyeli Sunucu: <strong>{overview.boostedServerIds.length}</strong>
                  </p>
                </div>

                {overview.isNitro ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleCancel()}
                    className="h-9 px-4 rounded-xl border border-[#EF4444]/40 text-[#EF4444] hover:bg-[#EF4444]/10 text-xs font-semibold transition-colors"
                  >
                    Nitro&apos;yu İptal Et
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleActivate()}
                    className="h-10 px-5 rounded-xl bg-gradient-to-r from-[#7C3AED] to-[#A855F7] hover:opacity-95 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-lg transition-opacity"
                  >
                    <Zap className="w-4 h-4" />
                    ORBIT Nitro&apos;yu Etkinleştir
                  </button>
                )}
              </div>

              {/* Perks Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
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
                    title: 'Özel Profil Efektleri & Çerçeveler',
                    desc: 'Aurora, Prisma ve Ateş Halesi avatar çerçeveleri ile dinamik profil kartı efektleri.',
                  },
                  {
                    icon: Rocket,
                    color: 'text-[#C084FC]',
                    title: 'Sunucu Takviyesi (Boost)',
                    desc: 'Sevdiğin sunuculara takviye basarak Seviye 1–3 topluluk ayrıcalıklarını aç.',
                  },
                ].map((perk) => {
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

              {/* Active Server Boost Action */}
              {activeServerId && (
                <div className="rounded-2xl border border-[#A855F7]/30 bg-slate-50 dark:bg-[#10111B] p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs font-bold flex items-center gap-1.5">
                      <Rocket className="w-4 h-4 text-[#C084FC]" />
                      {activeServerName || 'Bu Sunucu'} Takviyesi
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] mt-0.5">
                      {!overview.isNitro
                        ? 'Sunucu takviyesi yapabilmek için önce ORBIT Nitro’yu etkinleştirin.'
                        : isBoostedThisServer
                        ? 'Bu sunucuyu aktif olarak takviye ediyorsunuz.'
                        : 'Nitro takviyenizi bu sunucuya aktarabilirsiniz.'}
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

              {/* Honest Billing Notice */}
              {!overview.stripeConfigured && (
                <div className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-3 text-xs text-amber-800 dark:text-[#F59E0B] flex items-start gap-2">
                  <Info className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
                  <span>
                    Gerçek ödeme altyapısı (Stripe anahtarları) henüz tanımlanmadığı için ORBIT Nitro şu an önizleme/topluluk erişim modunda ücretsiz etkinleştirilebilir. Ücretli abonelik tahsilatı yapılmamaktadır.
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
