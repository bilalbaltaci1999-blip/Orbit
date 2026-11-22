import { useEffect, useState } from 'react';
import { apiFetch } from '../client/api.ts';
import { BADGE_CATALOG, type BadgeKey, type OrbitBadge } from '../shared/badges.ts';
import type { BadgeStatsResponse } from '../shared/types.ts';

let cachedBadgeStats: BadgeStatsResponse | null = null;
let cachedAt = 0;
let pendingPromise: Promise<BadgeStatsResponse> | null = null;

export async function fetchBadgeStats(force = false): Promise<BadgeStatsResponse | null> {
  const now = Date.now();
  if (!force && cachedBadgeStats && now - cachedAt < 30_000) {
    return cachedBadgeStats;
  }
  if (!pendingPromise || force) {
    pendingPromise = apiFetch<BadgeStatsResponse>('/badges/stats')
      .then((res) => {
        cachedBadgeStats = res;
        cachedAt = Date.now();
        return res;
      })
      .finally(() => {
        pendingPromise = null;
      });
  }
  try {
    return await pendingPromise;
  } catch {
    return cachedBadgeStats;
  }
}

export function useBadgeStats(forceRefresh = false): BadgeStatsResponse | null {
  const [stats, setStats] = useState<BadgeStatsResponse | null>(cachedBadgeStats);

  useEffect(() => {
    let active = true;
    void fetchBadgeStats(forceRefresh).then((data) => {
      if (active && data) setStats(data);
    });
    return () => {
      active = false;
    };
  }, [forceRefresh]);

  return stats;
}

export function BadgeGlyph({ badgeKey, color, sizePx = 16 }: { badgeKey: BadgeKey; color: string; sizePx?: number }) {
  switch (badgeKey) {
    case 'platform_founder':
      // Discord Founder Crest: faceted shield + inner radiant star
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2L19.5 5.2V11.3C19.5 16.4 16.2 20.5 12 22C7.8 20.5 4.5 16.4 4.5 11.3V5.2L12 2Z"
            fill={color}
            fillOpacity="0.24"
            stroke={color}
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <path
            d="M12 6.8L13.5 10L17 10.5L14.5 12.9L15.1 16.4L12 14.7L8.9 16.4L9.5 12.9L7 10.5L10.5 10L12 6.8Z"
            fill={color}
          />
        </svg>
      );
    case 'orbit_staff':
      // Discord Staff Wrench + Hammer Emblem
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.8" />
          <path
            d="M15.4 6.6C14 6.1 12.3 6.5 11.3 7.7C10.5 8.6 10.3 9.9 10.7 11L6.8 14.9C6.2 15.5 6.2 16.4 6.8 17C7.4 17.6 8.3 17.6 8.9 17L12.8 13.1C13.9 13.5 15.2 13.3 16.1 12.5C17.3 11.5 17.7 9.8 17.2 8.4L15 10.6L13.2 8.8L15.4 6.6Z"
            fill={color}
          />
        </svg>
      );
    case 'orbit_nitro':
      // ORBIT Nitro Boost Winged Comet Emblem
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M13 2.5L20 9.5L11 21.5L4 14.5L13 2.5Z"
            fill={color}
            fillOpacity="0.24"
            stroke={color}
            strokeWidth="1.85"
            strokeLinejoin="round"
          />
          <path
            d="M12.5 7.2L15.8 10.5L11.2 16.5L8.2 13.5L12.5 7.2Z"
            fill={color}
          />
          <path d="M5 7L7.5 9.5M16.5 16.5L19 19" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'server_booster':
      // Server Booster Sparkling Pink Gem Emblem
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2.4L19.2 8.2L16.5 20.2H7.5L4.8 8.2L12 2.4Z"
            fill={color}
            fillOpacity="0.25"
            stroke={color}
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <path d="M12 6.8L15.5 11L12 16.2L8.5 11L12 6.8Z" fill={color} />
        </svg>
      );
    case 'bug_hunter_gold':
      // Golden Bug Hunter Shield + Crown Spark
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2.2L19.4 5.4V11.8C19.4 16.8 16.1 20.7 12 22C7.9 20.7 4.6 16.8 4.6 11.8V5.4L12 2.2Z"
            fill={color}
            fillOpacity="0.26"
            stroke={color}
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <ellipse cx="12" cy="13.2" rx="3.1" ry="3.8" fill={color} />
          <path d="M9.8 9.6L8.4 7.8M14.2 9.6L15.6 7.8M7.6 13H9M15 13H16.4M8.4 16.2L9.8 15.2M15.6 16.2L14.2 15.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'bug_hunter_silver':
      // Silver Bug Hunter Emblem
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.8" />
          <ellipse cx="12" cy="13" rx="3.4" ry="4" fill={color} fillOpacity="0.38" stroke={color} strokeWidth="1.8" />
          <path d="M10.2 8.8L8.8 7M13.8 8.8L15.2 7M7.2 12H8.5M15.5 12H16.8M7.6 15.5L9 14.5M16.4 15.5L15 14.5M12 9V17" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'orbit_partner':
      // Discord Partner Infinity Server Owner Emblem
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.8" />
          <path
            d="M8.5 9.2C6.8 9.2 5.6 10.5 5.6 12C5.6 13.5 6.8 14.8 8.5 14.8C10.2 14.8 11.4 13.1 12 12C12.6 10.9 13.8 9.2 15.5 9.2C17.2 9.2 18.4 10.5 18.4 12C18.4 13.5 17.2 14.8 15.5 14.8C13.8 14.8 12.6 13.1 12 12C11.4 10.9 10.2 9.2 8.5 9.2Z"
            stroke={color}
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'orbit_moderator':
      // Discord Moderator Certified Shield Emblem
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2.6L19 5.6V11.4C19 16.2 15.9 20.1 12 21.5C8.1 20.1 5 16.2 5 11.4V5.6L12 2.6Z"
            fill={color}
            fillOpacity="0.22"
            stroke={color}
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <path
            d="M8.8 12L11.1 14.3L15.6 9.6"
            stroke={color}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'bot_developer':
      // Discord Early Verified Bot Developer Gear + Brackets
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2.8L20 7.4V16.6L12 21.2L4 16.6V7.4L12 2.8Z"
            fill={color}
            fillOpacity="0.22"
            stroke={color}
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <rect x="7.4" y="8.8" width="9.2" height="6.8" rx="2.2" fill={color} fillOpacity="0.3" stroke={color} strokeWidth="1.6" />
          <circle cx="10.2" cy="12.2" r="1.1" fill={color} />
          <circle cx="13.8" cy="12.2" r="1.1" fill={color} />
          <path d="M12 6.8V8.8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'bug_hunter':
      // Legacy Bug Hunter Magnifying Bug Shield
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.8" />
          <ellipse cx="12" cy="13" rx="3.5" ry="4.2" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.8" />
          <path d="M10.2 8.8L8.8 7M13.8 8.8L15.2 7M7.2 12H8.5M15.5 12H16.8M7.6 15.5L9 14.5M16.4 15.5L15 14.5M12 9V17" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'orbit_member':
      // Discord Nitro / Orbit First-100 Jewel: tilted planetary ring + radiant gem
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 4.5L18.5 9.2L16 17.5H8L5.5 9.2L12 4.5Z"
            fill={color}
            fillOpacity="0.26"
            stroke={color}
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <ellipse
            cx="12"
            cy="12"
            rx="10"
            ry="3.6"
            transform="rotate(-22 12 12)"
            stroke={color}
            strokeWidth="1.7"
          />
          <circle cx="12" cy="11.5" r="2.2" fill={color} />
        </svg>
      );
    case 'verified_account':
      // Discord Verified Hex Seal with crisp check
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2.4L15.1 4.2L18.7 4.3L19.7 7.8L21.8 10.8L20.3 14.1L20.8 17.7L17.5 19.3L15.1 21.8L11.9 20.6L8.7 21.8L6.4 19.3L3.1 17.7L3.6 14.1L2.1 10.8L4.2 7.8L5.2 4.3L8.8 4.2L12 2.4Z"
            fill={color}
            fillOpacity="0.22"
            stroke={color}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M8.6 12.2L10.9 14.5L15.6 9.6" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'early_pioneer':
      // Discord Early Supporter Twin-Diamond emblem
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3.2L19.2 12L12 20.8L4.8 12L12 3.2Z"
            fill={color}
            fillOpacity="0.22"
            stroke={color}
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <path d="M12 7.2L15.5 12L12 16.8L8.5 12L12 7.2Z" fill={color} />
        </svg>
      );
    case 'community_founder':
      // Discord Owner Infinity Crown
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M3.8 16.8L5.4 7.4L9.8 11.2L12 5.2L14.2 11.2L18.6 7.4L20.2 16.8H3.8Z"
            fill={color}
            fillOpacity="0.26"
            stroke={color}
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <rect x="4.5" y="18.8" width="15" height="2.2" rx="1.1" fill={color} />
        </svg>
      );
    case 'active_communicator':
      // Discord Active Developer crisp faceted hex + brackets
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2.8L20 7.4V16.6L12 21.2L4 16.6V7.4L12 2.8Z"
            fill={color}
            fillOpacity="0.22"
            stroke={color}
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <path d="M9.5 9.5L6.8 12L9.5 14.5M14.5 9.5L17.2 12L14.5 14.5M13 8.5L11 15.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'forum_contributor':
      // Forum Scholar emblem
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="4.5" fill={color} fillOpacity="0.22" stroke={color} strokeWidth="1.9" />
          <path d="M8 9H16M8 12.5H14M8 16H11.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <circle cx="15.5" cy="16" r="1.5" fill={color} />
        </svg>
      );
    case 'voice_pioneer':
      // Voice Quest Wave emblem
      return (
        <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.9" />
          <path d="M8 10V14M12 7.5V16.5M16 10V14" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
  }
}

export function FeaturedBadgeIcon({
  badgeKey,
  size = 14,
  onClick,
}: {
  badgeKey?: BadgeKey | null;
  size?: number;
  onClick?: () => void;
}) {
  const [popping, setPopping] = useState(false);
  if (!badgeKey || !BADGE_CATALOG[badgeKey]) return null;
  const meta = BADGE_CATALOG[badgeKey];
  return (
    <button
      type="button"
      onClick={(e) => {
        setPopping(true);
        window.setTimeout(() => setPopping(false), 550);
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
      title={`${meta.label} — ${meta.rarity}`}
      aria-label={meta.label}
      className={`inline-flex items-center justify-center shrink-0 hover:scale-110 transition-transform ${
        popping ? 'animate-orbit-badge-pop' : ''
      }`}
    >
      <BadgeGlyph badgeKey={badgeKey} color={meta.color} sizePx={size} />
    </button>
  );
}

interface Props {
  badges: OrbitBadge[];
  size?: 'sm' | 'md';
  showEmpty?: boolean;
  onOpenCatalog?: () => void;
}

function formatShortDate(iso?: string): string {
  if (!iso) return '';
  const normalized = iso.endsWith('Z') || iso.includes('+') ? iso : `${iso.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function BadgeStrip({ badges, size = 'md', showEmpty = false, onOpenCatalog }: Props) {
  const [selectedKey, setSelectedKey] = useState<BadgeKey | null>(null);
  const [burstTick, setBurstTick] = useState<{ key: BadgeKey; tick: number } | null>(null);
  const stats = useBadgeStats();

  if (!badges || badges.length === 0) {
    if (!showEmpty) return null;
    return <p className="text-xs text-slate-500">Henüz kazanılmış rozet yok.</p>;
  }

  const sizePx = size === 'sm' ? 15 : 17;
  const boxClass = size === 'sm' ? 'w-6 h-6 rounded-md' : 'w-7 h-7 rounded-lg';
  const activeBadge = badges.find((b) => b.key === selectedKey) || null;
  const activeCatalog = activeBadge ? BADGE_CATALOG[activeBadge.key] : null;
  const activeStat = activeBadge && stats ? stats.badges[activeBadge.key] : null;

  return (
    <div className="space-y-2">
      <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D]">
        {badges.map((badge) => {
          const isSelected = selectedKey === badge.key;
          const isBursting = burstTick?.key === badge.key;
          return (
            <button
              key={badge.key}
              type="button"
              title={`${badge.label} — Ayrıntılar ve kaç kişide olduğu için tıklayın`}
              aria-label={badge.label}
              onClick={() => {
                setSelectedKey((prev) => (prev === badge.key ? null : badge.key));
                setBurstTick({ key: badge.key, tick: Date.now() });
              }}
              className={`relative ${boxClass} flex items-center justify-center transition-transform hover:scale-110 active:scale-90 focus:outline-none ${
                isSelected ? 'bg-indigo-500/20 ring-1 ring-indigo-400' : 'hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              {isBursting && (
                <span
                  key={burstTick?.tick}
                  className="pointer-events-none absolute inset-0 rounded-lg border-2 animate-orbit-sparkle-burst"
                  style={{ borderColor: badge.color }}
                />
              )}
              <span key={isBursting ? `pop-${burstTick?.tick}` : 'idle'} className={isBursting ? 'animate-orbit-badge-pop' : ''}>
                <BadgeGlyph badgeKey={badge.key} color={badge.color} sizePx={sizePx} />
              </span>
            </button>
          );
        })}
      </div>

      {activeBadge && activeCatalog && (
        <div
          key={`${activeBadge.key}-${burstTick?.tick || 0}`}
          className="relative overflow-hidden p-3 rounded-xl bg-slate-100 dark:bg-[#161B28] border border-slate-200 dark:border-slate-700/80 text-xs space-y-2 transition-all"
        >
          <span
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-orbit-card-shimmer"
          />
          <div className="relative flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5 min-w-0">
              <span
                className="mt-0.5 shrink-0 p-1.5 rounded-lg bg-white dark:bg-[#10141E] border border-slate-200 dark:border-slate-800 animate-orbit-badge-pop"
                style={{ boxShadow: `0 0 18px -4px ${activeBadge.color}55` }}
              >
                <BadgeGlyph badgeKey={activeBadge.key} color={activeBadge.color} sizePx={19} />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 flex-wrap">
                  <span>{activeBadge.label}</span>
                  <span className="text-[11px] font-medium" style={{ color: activeBadge.color }}>
                    · {activeBadge.rarity || activeCatalog.rarity}
                  </span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                  {activeBadge.description}
                </p>
              </div>
            </div>
          </div>

          <div className="relative pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-1 text-[11px]">
            <p className="text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-200">Basitlik: </span>
              {activeBadge.simplicity || activeCatalog.simplicity}
            </p>
            <div className="flex items-center justify-between gap-2 flex-wrap text-slate-500 dark:text-slate-400">
              <span className="tabular-nums">
                <strong className="text-slate-800 dark:text-slate-200">
                  {activeStat ? `${activeStat.count} kişide` : 'Hesaplanıyor...'}
                </strong>
                {activeStat && stats ? ` · kullanıcıların %${activeStat.percentage}'i` : ''}
                {activeCatalog.cap && activeStat ? ` (${activeStat.count}/${activeCatalog.cap} kontenjan)` : ''}
              </span>
              {activeBadge.grantedAt && (
                <span>Kazanım: {formatShortDate(activeBadge.grantedAt)}</span>
              )}
            </div>

            {activeCatalog.cap && activeStat && (
              <div className="pt-1 space-y-1">
                <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, Math.round((activeStat.count / activeCatalog.cap) * 100))}%`,
                      backgroundColor: activeBadge.color,
                    }}
                  />
                </div>
              </div>
            )}

            {onOpenCatalog && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={onOpenCatalog}
                  className="text-indigo-500 dark:text-indigo-400 hover:underline font-medium"
                >
                  Tüm ORBIT rozetlerini ve İlk 100 listesini gör →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
