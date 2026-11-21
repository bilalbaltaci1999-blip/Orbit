import { Check, Flame, Sparkles } from 'lucide-react';
import type { StreakInfo } from '../shared/types.ts';

export function BotBadge({ verified = false }: { verified?: boolean }) {
  return (
    <span
      title={verified ? 'Doğrulanmış Resmî Bot' : 'Bot Hesabı'}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#5865F2] text-white font-mono text-[10px] font-bold tracking-wide uppercase leading-none shrink-0"
    >
      {verified && <Check className="w-2.5 h-2.5 stroke-[3]" />}
      <span>BOT</span>
    </span>
  );
}

export function NitroBadge() {
  return (
    <span
      title="ORBIT Nitro Abonesi"
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-white text-[10px] font-bold tracking-wide leading-none shrink-0"
    >
      <Sparkles className="w-2.5 h-2.5" />
      <span>NITRO</span>
    </span>
  );
}

export function FlameEmblem({
  active = true,
  size = 22,
}: {
  active?: boolean;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Ateşli Seri Simgesi"
      className={active ? 'drop-shadow-[0_0_8px_rgba(249,115,22,0.7)]' : 'opacity-40 grayscale'}
    >
      <defs>
        <linearGradient id="orbitFlameOuter" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="45%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#DC2626" />
        </linearGradient>
        <linearGradient id="orbitFlameInner" x1="12" y1="9" x2="12" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FEF08A" />
          <stop offset="100%" stopColor="#FB923C" />
        </linearGradient>
      </defs>
      <path
        d="M12.6 2.2c.4 3-1.4 4.8-2.9 6.6-1.4 1.7-2.7 3.2-2.7 5.7 0 3.2 2.4 5.8 5.4 6.2 3.4.5 6.6-2.2 6.6-5.9 0-2.7-1.4-4.9-2.8-6.7-.5 1.3-1.3 2.1-2.2 2.4.7-2.8.2-5.9-1.4-8.3Z"
        fill="url(#orbitFlameOuter)"
      />
      <path
        d="M12.2 11.4c.1 1.4-.7 2.2-1.4 3-.6.7-1.2 1.4-1.2 2.5 0 1.4 1.1 2.6 2.5 2.7 1.6.2 3-1.1 3-2.7 0-1.9-1.3-3.5-2.9-5.5Z"
        fill="url(#orbitFlameInner)"
      />
    </svg>
  );
}

export function FlameStreakBadge({ streak }: { streak?: StreakInfo }) {
  if (!streak || streak.currentStreak < 1) return null;
  const isFlame = streak.hasFlameBadge || streak.currentStreak >= 7;
  return (
    <span
      title={
        isFlame
          ? `${streak.currentStreak} günlük Ateşli Seri!`
          : `${streak.currentStreak} günlük seri (7. günde Ateşli Seri)`
      }
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold tabular-nums shrink-0 ${
        isFlame
          ? 'bg-orange-500/20 border border-orange-500/40 text-orange-400'
          : 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-400'
      }`}
    >
      {isFlame ? <FlameEmblem active size={13} /> : <Flame className="w-3 h-3" />}
      <span>{streak.currentStreak} Gün</span>
    </span>
  );
}
