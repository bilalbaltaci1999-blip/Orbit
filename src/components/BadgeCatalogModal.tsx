import { useState } from 'react';
import { Award, CheckCircle2, Crown, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { apiFetch, ApiError } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { useToast } from '../client/ToastContext.tsx';
import { ALL_BADGE_KEYS, BADGE_CATALOG, ORBIT_MEMBER_CAP, type BadgeKey } from '../shared/badges.ts';
import type { UserProfile } from '../shared/types.ts';
import { BadgeGlyph, fetchBadgeStats, useBadgeStats } from './BadgeStrip.tsx';

export function BadgeCatalogModal({ onClose }: { onClose: () => void }) {
  const { profile, updateProfileState } = useAuth();
  const { showToast } = useToast();
  const [refreshKey, setRefreshKey] = useState(0);
  const stats = useBadgeStats(true);
  const [selectedKey, setSelectedKey] = useState<BadgeKey>('platform_founder');
  const [animTick, setAnimTick] = useState<number>(0);
  const [mutatingKey, setMutatingKey] = useState<BadgeKey | null>(null);

  const ownedKeys = new Set((profile?.badges || []).map((b) => b.key));
  const orbitCount = stats?.orbitMemberCount ?? 0;
  const orbitRemaining = stats?.orbitMemberRemaining ?? ORBIT_MEMBER_CAP;
  const orbitPct = Math.min(100, Math.round((orbitCount / ORBIT_MEMBER_CAP) * 100));

  const selectedBadge = BADGE_CATALOG[selectedKey];
  const selectedStat = stats?.badges[selectedKey];

  const handleToggleSelfBadge = async (key: BadgeKey, grant: boolean) => {
    if (!profile?.isFounder) return;
    setMutatingKey(key);
    try {
      const res = await apiFetch<{ profile: UserProfile }>('/badges/assign', {
        method: grant ? 'POST' : 'DELETE',
        body: JSON.stringify({ userId: profile.userId, badgeKey: key }),
      });
      updateProfileState(res.profile);
      await fetchBadgeStats(true);
      setRefreshKey((k) => k + 1);
      setAnimTick(Date.now());
      showToast(
        grant ? `${BADGE_CATALOG[key].label} rozeti profilinize eklendi.` : `${BADGE_CATALOG[key].label} rozeti kaldırıldı.`,
        grant ? 'success' : 'info'
      );
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Rozet işlemi başarısız.', 'error');
    } finally {
      setMutatingKey(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 sm:p-6" onClick={onClose}>
      <div
        key={refreshKey}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[88dvh] rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-2xl flex flex-col overflow-hidden animate-orbit-enter"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-[#29293D] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#7C3AED]/20 border border-[#A855F7]/30 flex items-center justify-center text-[#C084FC]">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold font-display">ORBIT Rozet Kataloğu ({ALL_BADGE_KEYS.length} Rozet)</h3>
              <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                Rozetlere tıklayarak animasyonunu, basitliğini ve gerçek kullanıcı dağılımını inceleyin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#19192A] text-slate-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Special First 100 Orbit Member Banner */}
          <div className="rounded-2xl border border-[#A855F7]/35 bg-gradient-to-br from-[#A855F7]/12 via-[#7C3AED]/10 to-transparent p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-[#A855F7]/20 border border-[#A855F7]/30 flex items-center justify-center shrink-0">
                  <BadgeGlyph badgeKey="orbit_member" color="#C084FC" sizePx={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-bold font-display text-slate-900 dark:text-[#F8FAFC]">
                      İlk 100 Orbit Üyesi Kampanyası
                    </h4>
                    {ownedKeys.has('orbit_member') && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#22C55E]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sizde Mevcut
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-[#A1A1B5] mt-0.5">
                    Uygulamaya kayıt olan ilk {ORBIT_MEMBER_CAP} kullanıcıya sınırlı <strong className="text-[#C084FC]">Orbit Üyesi</strong> rozeti otomatik tanımlanır.
                  </p>
                </div>
              </div>
              <div className="text-right tabular-nums">
                <p className="text-lg font-bold font-mono text-[#A855F7] dark:text-[#C084FC]">
                  {orbitCount} / {ORBIT_MEMBER_CAP}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">
                  {orbitRemaining > 0 ? `${orbitRemaining} kontenjan kaldı` : 'Kontenjan doldu'}
                </p>
              </div>
            </div>
            <div className="h-2 rounded-full bg-slate-200 dark:bg-[#10111B] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#A855F7] transition-all duration-500"
                style={{ width: `${orbitPct}%` }}
              />
            </div>
          </div>

          {/* Interactive Selected Badge Spotlight */}
          <div
            key={`${selectedKey}-${animTick}`}
            className="relative overflow-hidden rounded-2xl border p-4 bg-slate-50 dark:bg-[#19192A] space-y-2.5"
            style={{ borderColor: `${selectedBadge.color}55` }}
          >
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-orbit-card-shimmer" />
            <div className="relative flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3.5">
                <div
                  className="relative w-12 h-12 rounded-2xl bg-white dark:bg-[#10111B] border flex items-center justify-center shrink-0 animate-orbit-badge-pop"
                  style={{ borderColor: `${selectedBadge.color}66`, boxShadow: `0 0 24px -6px ${selectedBadge.color}88` }}
                >
                  <span
                    className="pointer-events-none absolute inset-0 rounded-2xl border-2 animate-orbit-sparkle-burst"
                    style={{ borderColor: selectedBadge.color }}
                  />
                  <BadgeGlyph badgeKey={selectedKey} color={selectedBadge.color} sizePx={26} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-base font-bold font-display">{selectedBadge.label}</h4>
                    <span className="text-xs font-semibold" style={{ color: selectedBadge.color }}>
                      · {selectedBadge.rarity}
                    </span>
                    {ownedKeys.has(selectedKey) && (
                      <span className="text-[11px] font-semibold text-[#22C55E] inline-flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> Açık
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-[#A1A1B5] mt-0.5">{selectedBadge.description}</p>
                </div>
              </div>

              {profile?.isFounder && selectedKey !== 'platform_founder' && (
                <button
                  type="button"
                  disabled={mutatingKey === selectedKey}
                  onClick={() => void handleToggleSelfBadge(selectedKey, !ownedKeys.has(selectedKey))}
                  className={`h-8 px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                    ownedKeys.has(selectedKey)
                      ? 'border-[#EF4444]/40 text-[#EF4444] hover:bg-[#EF4444]/10'
                      : 'border-[#A855F7]/40 bg-[#7C3AED] text-white hover:bg-[#6D28D9]'
                  }`}
                >
                  {ownedKeys.has(selectedKey) ? (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      Benden Kaldır
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      Kendime Ekle
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-200/80 dark:border-[#29293D] text-xs">
              <p className="text-slate-600 dark:text-[#A1A1B5]">
                <strong className="text-slate-900 dark:text-[#F8FAFC]">Basitlik: </strong>
                {selectedBadge.simplicity}
              </p>
              <p className="text-slate-500 dark:text-[#A1A1B5] sm:text-right tabular-nums">
                <strong className="text-slate-900 dark:text-[#F8FAFC]">
                  {selectedStat ? `${selectedStat.count} kişide` : '—'}
                </strong>
                {selectedStat && stats ? ` · kullanıcıların %${selectedStat.percentage}'i (${stats.totalUsers} toplam)` : ''}
              </p>
            </div>
          </div>

          {/* All Interactive Badges Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ALL_BADGE_KEYS.map((key) => {
              const badge = BADGE_CATALOG[key];
              const stat = stats?.badges[key];
              const owned = ownedKeys.has(key);
              const isSelected = selectedKey === key;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSelectedKey(key);
                    setAnimTick(Date.now());
                  }}
                  className={`relative overflow-hidden text-left rounded-xl border p-3.5 space-y-2 transition-all active:scale-[0.98] ${
                    isSelected
                      ? 'bg-[#7C3AED]/[0.1] ring-2 ring-[#A855F7]/60 border-[#A855F7]/50'
                      : owned
                      ? 'bg-[#7C3AED]/[0.05] border-[#7C3AED]/35 hover:border-[#A855F7]'
                      : 'bg-slate-50 dark:bg-[#19192A]/70 border-slate-200 dark:border-[#29293D] hover:border-slate-400 dark:hover:border-[#A855F7]/50'
                  }`}
                >
                  {isSelected && (
                    <span
                      key={animTick}
                      className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-orbit-card-shimmer"
                    />
                  )}
                  <div className="relative flex items-start gap-3">
                    <div
                      key={isSelected ? `glyph-${animTick}` : key}
                      className={`relative w-10 h-10 rounded-xl bg-white dark:bg-[#10111B] border border-slate-200 dark:border-[#29293D] flex items-center justify-center shrink-0 ${
                        isSelected ? 'animate-orbit-badge-pop' : ''
                      }`}
                    >
                      {isSelected && (
                        <span
                          key={`ring-${animTick}`}
                          className="pointer-events-none absolute inset-0 rounded-xl border-2 animate-orbit-sparkle-burst"
                          style={{ borderColor: badge.color }}
                        />
                      )}
                      <BadgeGlyph badgeKey={key} color={badge.color} sizePx={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-slate-900 dark:text-[#F8FAFC] truncate">{badge.label}</p>
                        {owned && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#22C55E] shrink-0">
                            <Sparkles className="w-3 h-3" />
                            Açık
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-medium" style={{ color: badge.color }}>
                        {badge.rarity}
                      </p>
                    </div>
                  </div>

                  <p className="relative text-xs text-slate-600 dark:text-[#A1A1B5] leading-relaxed">{badge.description}</p>

                  <div className="relative pt-2 border-t border-slate-200/80 dark:border-[#29293D] space-y-1 text-[11px]">
                    <p className="text-slate-600 dark:text-[#A1A1B5]">
                      <span className="font-semibold text-slate-900 dark:text-[#F8FAFC]">Basitlik:</span> {badge.simplicity}
                    </p>
                    <p className="text-slate-500 dark:text-[#A1A1B5] tabular-nums flex items-center justify-between">
                      <span>
                        <strong>{stat ? `${stat.count} kişide` : '—'}</strong>
                        {stat && stats ? ` · %${stat.percentage}` : ''}
                      </span>
                      {profile?.isFounder && (
                        <span className="inline-flex items-center gap-1 text-[#F59E0B] text-[10px]">
                          <Crown className="w-3 h-3" /> Kurucu Kontrolü
                        </span>
                      )}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
