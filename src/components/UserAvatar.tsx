import { useEffect, useState, type ReactNode } from 'react';
import { Crown } from 'lucide-react';
import { resolveMediaUrl } from '../client/api.ts';
import {
  AVATAR_FRAMES,
  BANNER_PRESETS,
  PROFILE_EFFECTS,
  type AvatarFrameKey,
  type BannerPresetKey,
  type ProfileEffectKey,
} from '../shared/badges.ts';
import type { PresenceStatus } from '../shared/types.ts';

const STATUS_META: Record<PresenceStatus, { label: string; dotClass: string }> = {
  online: { label: 'Çevrimiçi', dotClass: 'bg-emerald-500' },
  idle: { label: 'Boşta', dotClass: 'bg-amber-400' },
  dnd: { label: 'Rahatsız Etmeyin', dotClass: 'bg-rose-500' },
  offline: { label: 'Çevrimdışı', dotClass: 'bg-slate-500' },
};

export function UserAvatar({
  src,
  name,
  status,
  frame = 'none',
  size = 'md',
  showStatus = true,
}: {
  src: string | null | undefined;
  name: string;
  status?: PresenceStatus;
  frame?: AvatarFrameKey;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showStatus?: boolean;
}) {
  const resolvedSrc = resolveMediaUrl(src);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [resolvedSrc]);

  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-9 h-9 text-xs',
    lg: 'w-11 h-11 text-sm',
    xl: 'w-16 h-16 text-lg',
  }[size];

  const dotSizeClasses = {
    xs: 'w-2 h-2 border',
    sm: 'w-2.5 h-2.5 border-2',
    md: 'w-3 h-3 border-2',
    lg: 'w-3.5 h-3.5 border-2',
    xl: 'w-4 h-4 border-2',
  }[size];

  const initials = (name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  const meta = status ? STATUS_META[status] : null;
  const frameMeta = AVATAR_FRAMES.find((f) => f.key === frame);
  const frameClass = frameMeta?.ringClass || '';
  const decorationKind = frameMeta?.decorationKind;
  const showDecor = Boolean(decorationKind && size !== 'xs');

  return (
    <div className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${sizeClasses} ${frameClass}`}>
      {showDecor && decorationKind === 'orbit' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-1 rounded-full orbit-spin-slow"
        >
          <span className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-fuchsia-400 shadow-[0_0_8px_#E879F9]" />
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-violet-300 opacity-80" />
        </span>
      )}

      {showDecor && decorationKind === 'pulse' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-1.5 rounded-full border border-cyan-400/55 orbit-pulse-glow"
        />
      )}

      {showDecor && decorationKind === 'prism' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-[3px] rounded-full orbit-spin-slow opacity-85"
          style={{
            background: 'conic-gradient(from 0deg, #EC4899, #8B5CF6, #22D3EE, #EC4899)',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px))',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px))',
          }}
        />
      )}

      {showDecor && decorationKind === 'flame' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-1 rounded-full border-2 border-orange-400/60 shadow-[0_0_12px_rgba(249,115,22,0.55)] orbit-flame-flicker"
        />
      )}

      {showDecor && decorationKind === 'galaxy' && (
        <svg
          aria-hidden="true"
          viewBox="0 0 64 64"
          className="pointer-events-none absolute -inset-1.5 w-[calc(100%+12px)] h-[calc(100%+12px)] orbit-spin-slow"
        >
          <circle
            cx="32"
            cy="32"
            r="30"
            fill="none"
            stroke="rgba(192,132,252,0.7)"
            strokeWidth="1.4"
            strokeDasharray="10 6 3 6"
          />
          <circle cx="32" cy="2" r="2.2" fill="#38BDF8" />
          <circle cx="62" cy="32" r="1.8" fill="#C084FC" />
        </svg>
      )}

      {showDecor && decorationKind === 'crown' && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-1 rounded-full border border-amber-300/75 orbit-pulse-glow"
          />
          {(size === 'lg' || size === 'xl') && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 text-amber-300 drop-shadow-[0_2px_6px_rgba(251,191,36,0.75)] orbit-crown-float"
            >
              <Crown className={size === 'xl' ? 'w-4 h-4 fill-amber-300/40' : 'w-3 h-3 fill-amber-300/40'} />
            </span>
          )}
        </>
      )}

      {resolvedSrc && !imgFailed ? (
        <img
          src={resolvedSrc}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full rounded-full object-cover bg-slate-800 relative z-[1]"
        />
      ) : (
        <div className="w-full h-full rounded-full bg-[#7C3AED]/25 border border-[#A855F7]/30 text-[#7C3AED] dark:text-[#C084FC] font-semibold flex items-center justify-center select-none relative z-[1]">
          {initials}
        </div>
      )}
      {showStatus && meta && (
        <span
          title={meta.label}
          aria-label={meta.label}
          className={`absolute -bottom-0.5 -right-0.5 z-[2] rounded-full border-white dark:border-[#151522] ${dotSizeClasses} ${meta.dotClass}`}
        />
      )}
    </div>
  );
}

export function ProfileBannerSurface({
  bannerUrl,
  bannerPreset = 'none',
  bannerColor = '#4F46E5',
  profileEffect = 'none',
  className = 'h-24',
  children,
}: {
  bannerUrl?: string | null;
  bannerPreset?: BannerPresetKey;
  bannerColor?: string;
  profileEffect?: ProfileEffectKey;
  className?: string;
  children?: ReactNode;
}) {
  const resolvedBanner = resolveMediaUrl(bannerUrl);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [resolvedBanner]);

  const presetMeta = BANNER_PRESETS.find((p) => p.key === bannerPreset);
  const effectMeta = PROFILE_EFFECTS.find((e) => e.key === profileEffect);
  const usePresetClass = (!resolvedBanner || imgFailed) && presetMeta && presetMeta.key !== 'none';

  return (
    <div
      className={`relative shrink-0 overflow-hidden ${usePresetClass ? presetMeta.previewClass : ''} ${className}`}
      style={
        !resolvedBanner || imgFailed
          ? usePresetClass
            ? undefined
            : {
                background: bannerColor
                  ? `linear-gradient(135deg, ${bannerColor}, #10111B)`
                  : 'linear-gradient(135deg, #7C3AED, #10111B)',
              }
          : undefined
      }
    >
      {resolvedBanner && !imgFailed && (
        <>
          <img
            src={resolvedBanner}
            alt="Profil Banner"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent pointer-events-none" />
        </>
      )}

      {profileEffect && profileEffect !== 'none' && effectMeta && (
        <div
          className={`absolute inset-0 pointer-events-none bg-gradient-to-br ${effectMeta.gradientClass}`}
        />
      )}

      {children}
    </div>
  );
}

export function getStatusLabel(status: PresenceStatus): string {
  return STATUS_META[status]?.label || 'Çevrimdışı';
}
