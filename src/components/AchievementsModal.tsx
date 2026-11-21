import { useEffect, useState } from 'react';
import { Award, CheckCircle2, Flame, Sparkles, Trophy, X } from 'lucide-react';
import { apiFetch } from '../client/api.ts';
import { STREAK_MILESTONES } from '../shared/badges.ts';
import type { AchievementItem, StreakInfo } from '../shared/types.ts';
import { FlameEmblem } from './BotBadge.tsx';

interface AchievementsPayload {
  xp: number;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPct: number;
  streak: StreakInfo;
  achievements: AchievementItem[];
}

export function AchievementsModal({
  onClose,
  onOpenBadgeCatalog,
}: {
  onClose: () => void;
  onOpenBadgeCatalog?: () => void;
}) {
  const [data, setData] = useState<AchievementsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch<AchievementsPayload>('/achievements/me')
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const streakDays = data?.streak.currentStreak || 0;
  const hasFlame = Boolean(data?.streak.hasFlameBadge || streakDays >= 7);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[88dvh] rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-2xl flex flex-col overflow-hidden animate-orbit-enter"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-[#29293D] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#F59E0B]/15 border border-[#F59E0B]/30 flex items-center justify-center text-[#F59E0B]">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold font-display">Başarılar & Günlük Seri</h3>
              <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                1–7 günlük serini tamamla, Ateşli Seri rozetini ve XP seviyelerini aç
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onOpenBadgeCatalog && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenBadgeCatalog();
                }}
                className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-[#29293D] hover:bg-slate-100 dark:hover:bg-[#19192A] text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                <Award className="w-3.5 h-3.5 text-[#C084FC]" />
                Rozet Kataloğu
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Kapat"
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#19192A] text-slate-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading || !data ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-[#A1A1B5]">Başarı verileri yükleniyor...</div>
          ) : (
            <>
              {/* XP & Level Card */}
              <div className="rounded-2xl border border-[#A855F7]/30 bg-gradient-to-r from-[#7C3AED]/15 via-[#A855F7]/10 to-transparent p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#C084FC]">ORBIT Seviyesi</p>
                    <p className="text-2xl font-bold font-display tabular-nums">
                      Seviye {data.level}{' '}
                      <span className="text-xs font-mono font-normal text-slate-500 dark:text-[#A1A1B5]">({data.xp} XP)</span>
                    </p>
                  </div>
                  <div className="text-right text-xs font-mono text-slate-500 dark:text-[#A1A1B5] tabular-nums">
                    <p>Sonraki seviye</p>
                    <p className="text-[#C084FC] font-semibold">
                      {data.currentLevelXp} / {data.nextLevelXp} XP
                    </p>
                  </div>
                </div>
                <div className="h-2.5 rounded-full bg-slate-200 dark:bg-[#10111B] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#A855F7] transition-all duration-500"
                    style={{ width: `${data.progressPct}%` }}
                  />
                </div>
              </div>

              {/* 1–7 Day Streak Progression */}
              <div className="rounded-2xl border border-[#F59E0B]/30 bg-slate-50 dark:bg-[#10111B] p-4 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 ${
                        hasFlame
                          ? 'bg-[#F59E0B]/20 border-[#F59E0B]/50 shadow-[0_0_20px_rgba(245,158,11,0.3)]'
                          : 'bg-slate-200/70 dark:bg-[#19192A] border-slate-300 dark:border-[#29293D]'
                      }`}
                    >
                      {hasFlame ? <FlameEmblem active size={26} /> : <Flame className="w-5 h-5 text-[#F59E0B]" />}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold font-display flex items-center gap-2">
                        <span>1–7 Günlük Seri</span>
                        {hasFlame && (
                          <span className="px-2 py-0.5 rounded-md bg-[#F59E0B]/20 text-[#F59E0B] text-[11px] font-bold">
                            Ateşli Seri Açıldı!
                          </span>
                        )}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                        Mevcut seri: <strong className="text-[#F59E0B]">{streakDays} gün</strong> · En uzun:{' '}
                        <strong>{data.streak.longestStreak} gün</strong>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                  {STREAK_MILESTONES.map((step) => {
                    const reached = streakDays >= step.day || (step.isFlame && hasFlame);
                    return (
                      <div
                        key={step.day}
                        title={step.title}
                        className={`rounded-xl border p-2 flex flex-col items-center justify-center gap-1 text-center transition-all ${
                          reached
                            ? step.isFlame
                              ? 'bg-gradient-to-b from-[#F59E0B]/25 to-[#EF4444]/15 border-[#F59E0B] shadow-[0_0_16px_-4px_rgba(245,158,11,0.55)]'
                              : 'bg-[#7C3AED]/15 border-[#A855F7]/45'
                            : 'bg-white dark:bg-[#19192A] border-slate-200 dark:border-[#29293D] opacity-60'
                        }`}
                      >
                        {step.isFlame ? (
                          <FlameEmblem active={reached} size={22} />
                        ) : (
                          <span
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-mono font-bold text-white"
                            style={{ backgroundColor: reached ? step.color : '#29293D' }}
                          >
                            {step.day}
                          </span>
                        )}
                        <span className="text-[10px] font-semibold truncate w-full">
                          {step.isFlame ? 'Ateş!' : `${step.day}. Gün`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Clean Achievements Grid */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                  Başarılar ({data.achievements.filter((a) => Boolean(a.unlockedAt)).length} / {data.achievements.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {data.achievements.map((ach) => {
                    const pct = Math.min(100, Math.round((ach.progress / Math.max(1, ach.target)) * 100));
                    const unlocked = Boolean(ach.unlockedAt);
                    return (
                      <div
                        key={ach.key}
                        className={`rounded-xl border p-3.5 space-y-2 ${
                          unlocked
                            ? 'bg-[#22C55E]/[0.06] border-[#22C55E]/35'
                            : 'bg-slate-50 dark:bg-[#19192A]/70 border-slate-200 dark:border-[#29293D]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold flex items-center gap-1.5">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: ach.color }}
                              />
                              <span className="truncate">{ach.title}</span>
                            </p>
                            <p className="text-xs text-slate-500 dark:text-[#A1A1B5] mt-0.5">{ach.description}</p>
                          </div>
                          {unlocked ? (
                            <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0 mt-0.5" />
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-[#7C3AED]/15 text-[#C084FC] font-mono text-[10px] font-semibold shrink-0">
                              +{ach.xpReward} XP
                            </span>
                          )}
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-[#A1A1B5] tabular-nums">
                            <span>İlerleme</span>
                            <span>
                              {ach.progress} / {ach.target}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-200 dark:bg-[#10111B] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: unlocked ? '#22C55E' : ach.color,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50/70 dark:bg-[#10111B] p-3 text-xs text-slate-500 dark:text-[#A1A1B5] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#A855F7] shrink-0" />
                <span>
                  Mesaj göndererek, sesli odalara katılarak ve günlük giriş serini koruyarak otomatik XP ve başarı kazanırsın.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
