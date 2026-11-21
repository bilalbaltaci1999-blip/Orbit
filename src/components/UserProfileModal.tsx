import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Ban,
  Calendar,
  Check,
  Copy,
  Crown,
  Edit3,
  ExternalLink,
  Flag,
  Globe,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react';
import { apiFetch, ApiError } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { useToast } from '../client/ToastContext.tsx';
import {
  ACTIVITY_LABELS,
  ALL_BADGE_KEYS,
  BADGE_CATALOG,
  calculateLevelFromXp,
  type BadgeKey,
} from '../shared/badges.ts';
import type { Role, UserProfile } from '../shared/types.ts';
import { BadgeGlyph, BadgeStrip, fetchBadgeStats } from './BadgeStrip.tsx';
import { BotBadge, FlameStreakBadge, NitroBadge } from './BotBadge.tsx';
import { getStatusLabel, ProfileBannerSurface, UserAvatar } from './UserAvatar.tsx';

export interface ProfileServerContext {
  serverId?: string;
  serverName: string;
  isOwner: boolean;
  roles: Role[];
  memberRoleIds: string[];
  joinedAt?: string;
}

const REPORT_CATEGORIES = [
  'Spam / Reklam',
  'Taciz / Hakaret',
  'Uygunsuz İçerik',
  'Dolandırıcılık / Güvenlik',
  'Diğer',
] as const;

interface Props {
  userId: string;
  serverContext?: ProfileServerContext;
  onClose: () => void;
  onOpenDm: (conversationId: string) => void;
  onEditProfile?: () => void;
  onOpenBadges?: () => void;
}

function formatTurkishDate(iso?: string): string {
  if (!iso) return '';
  const normalized = iso.endsWith('Z') || iso.includes('+') ? iso : `${iso.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function sanitizeHttpUrl(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {
    return null;
  }
  return null;
}

export function UserProfileModal({
  userId,
  serverContext,
  onClose,
  onOpenDm,
  onEditProfile,
  onOpenBadges,
}: Props) {
  const { profile: me, updateProfileState } = useAuth();
  const { showToast } = useToast();
  const [target, setTarget] = useState<UserProfile | null>(null);
  const [mutualServers, setMutualServers] = useState<Array<{ id: string; name: string; iconUrl: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState<string>(REPORT_CATEGORIES[0]);
  const [reportReason, setReportReason] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [copiedTag, setCopiedTag] = useState(false);
  const [quickCustomStatus, setQuickCustomStatus] = useState('');
  const [savingQuickStatus, setSavingQuickStatus] = useState(false);
  const [badgeActionKey, setBadgeActionKey] = useState<BadgeKey | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch<{
          profile: UserProfile;
          mutualServers: Array<{ id: string; name: string; iconUrl: string | null }>;
        }>(`/users/${userId}/profile`);
        if (active) {
          setTarget(res.profile);
          setQuickCustomStatus(res.profile.customStatus || '');
          setMutualServers(res.mutualServers);
        }
      } catch {
        if (active) showToast('Profil yüklenemedi.', 'error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, showToast]);

  const handleCopyTag = async () => {
    if (!target) return;
    const fullTag = `${target.username}#${target.discriminator || '0000'}`;
    await navigator.clipboard?.writeText(fullTag).catch(() => {});
    setCopiedTag(true);
    showToast(`Etiket kopyalandı: ${fullTag}`, 'success');
    window.setTimeout(() => setCopiedTag(false), 1800);
  };

  const handleSaveQuickStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingQuickStatus(true);
    try {
      const res = await apiFetch<{ profile: UserProfile }>('/users/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ customStatus: quickCustomStatus.trim() }),
      });
      setTarget(res.profile);
      updateProfileState(res.profile);
      showToast('Durum notunuz güncellendi.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Durum güncellenemedi.', 'error');
    } finally {
      setSavingQuickStatus(false);
    }
  };

  const handleFounderToggleBadge = async (key: BadgeKey, owned: boolean) => {
    if (!target || !me?.isFounder) return;
    setBadgeActionKey(key);
    try {
      const res = await apiFetch<{ profile: UserProfile }>('/badges/assign', {
        method: owned ? 'DELETE' : 'POST',
        body: JSON.stringify({ userId: target.userId, badgeKey: key }),
      });
      setTarget(res.profile);
      if (target.userId === me.userId) {
        updateProfileState(res.profile);
      }
      await fetchBadgeStats(true);
      showToast(
        owned ? `${BADGE_CATALOG[key].label} rozeti kaldırıldı.` : `${BADGE_CATALOG[key].label} rozeti verildi.`,
        owned ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Rozet işlemi başarısız.', 'error');
    } finally {
      setBadgeActionKey(null);
    }
  };

  const handleStartDm = async () => {
    try {
      const res = await apiFetch<{ conversation: { id: string } }>('/dm/conversations', {
        method: 'POST',
        body: JSON.stringify({ participantIds: [userId] }),
      });
      onOpenDm(res.conversation.id);
      onClose();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Sohbet başlatılamadı.', 'error');
    }
  };

  const handleAddFriend = async () => {
    if (!target) return;
    try {
      await apiFetch('/friends/request', {
        method: 'POST',
        body: JSON.stringify({ usernameOrId: `${target.username}#${target.discriminator || '0000'}` }),
      });
      showToast('Arkadaşlık isteği gönderildi.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'İstek gönderilemedi.', 'error');
    }
  };

  const handleToggleBlock = async () => {
    if (!target || blockBusy) return;
    setBlockBusy(true);
    try {
      if (target.isBlockedByMe) {
        await apiFetch(`/blocks/${userId}`, { method: 'DELETE' });
        setTarget((prev) => (prev ? { ...prev, isBlockedByMe: false } : prev));
        showToast(`${target.displayName} engeli kaldırıldı.`, 'success');
      } else {
        await apiFetch('/blocks', { method: 'POST', body: JSON.stringify({ userId }) });
        setTarget((prev) => (prev ? { ...prev, isBlockedByMe: true } : prev));
        showToast(`${target.displayName} engellendi. İstediğiniz zaman buradan açabilirsiniz.`, 'info');
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Engelleme durumu güncellenemedi.', 'error');
    } finally {
      setBlockBusy(false);
    }
  };

  const handleReport = async () => {
    if (reportSubmitting) return;
    const trimmed = reportReason.trim();
    if (!trimmed) {
      setReportError('Şikâyet nedeni boş bırakılamaz.');
      return;
    }
    if (trimmed.length < 3) {
      setReportError('Şikâyet nedeni en az 3 karakter olmalıdır.');
      return;
    }
    setReportError(null);
    setReportSubmitting(true);
    try {
      await apiFetch('/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType: 'user',
          targetId: userId,
          category: reportCategory,
          reason: trimmed,
          serverId: serverContext?.serverId,
        }),
      });
      showToast('Şikâyetiniz moderasyon ekibine iletildi.', 'success');
      setReportOpen(false);
      setReportReason('');
      setReportError(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Şikâyet gönderilemedi.';
      setReportError(msg);
      showToast(msg, 'error');
    } finally {
      setReportSubmitting(false);
    }
  };

  const memberRoles = serverContext
    ? serverContext.roles
        .filter((r) => serverContext.memberRoleIds.includes(r.id) && !r.isDefault)
        .sort((a, b) => b.position - a.position)
    : [];

  const highestColor = memberRoles.find((r) => r.color && r.color !== '#64748B')?.color;
  const safeWebsite = sanitizeHttpUrl(target?.websiteUrl);
  const isSelf = me?.userId === target?.userId;
  const ownedBadgeKeys = new Set((target?.badges || []).map((b) => b.key));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <ProfileBannerSurface
          bannerUrl={target?.bannerUrl}
          bannerPreset={target?.bannerPreset}
          bannerColor={target?.bannerColor}
          profileEffect={target?.profileEffect}
          className="h-28"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Profili kapat"
            className="absolute top-3 right-3 z-10 p-1.5 rounded-lg bg-black/45 text-white hover:bg-black/65 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </ProfileBannerSurface>

        <div className="px-6 pb-6 -mt-9 relative z-[2] space-y-4">
          {loading || !target ? (
            <div className="py-14 text-center text-sm text-slate-400 dark:text-[#A1A1B5]">Yükleniyor...</div>
          ) : (
            <>
              <div className="flex items-end justify-between gap-3">
                <div className="ring-4 ring-white dark:ring-[#151522] rounded-full">
                  <UserAvatar
                    src={target.avatarUrl}
                    name={target.displayName}
                    status={target.status}
                    frame={target.avatarFrame}
                    size="xl"
                  />
                </div>
                {isSelf ? (
                  onEditProfile && (
                    <button
                      type="button"
                      onClick={onEditProfile}
                      className="h-9 px-3.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Tam Ayarlar
                    </button>
                  )
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <button
                      type="button"
                      onClick={handleStartDm}
                      disabled={Boolean(target.isBlockedByMe)}
                      title={target.isBlockedByMe ? 'Mesaj göndermek için önce engeli kaldırın' : 'Mesaj Gönder'}
                      className="h-9 px-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Mesaj
                    </button>
                    <button
                      type="button"
                      onClick={handleAddFriend}
                      disabled={Boolean(target.isBlockedByMe)}
                      title="Arkadaş Ekle"
                      className="h-9 w-9 rounded-xl border border-slate-200 dark:border-[#29293D] hover:bg-slate-100 dark:hover:bg-[#19192A] disabled:opacity-50 flex items-center justify-center"
                    >
                      <UserPlus className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleBlock()}
                      disabled={blockBusy}
                      title={target.isBlockedByMe ? 'Engeli Kaldır' : 'Kullanıcıyı Engelle'}
                      className={`h-9 px-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                        target.isBlockedByMe
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                          : 'border-slate-200 dark:border-[#29293D] hover:bg-[#EF4444]/10 hover:text-[#EF4444]'
                      }`}
                    >
                      {target.isBlockedByMe ? (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          <span>Engeli Kaldır</span>
                        </>
                      ) : (
                        <Ban className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReportOpen(!reportOpen);
                        setReportError(null);
                      }}
                      title="Şikâyet Et"
                      className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-colors ${
                        reportOpen
                          ? 'border-[#F59E0B]/50 bg-[#F59E0B]/15 text-[#F59E0B]'
                          : 'border-slate-200 dark:border-[#29293D] hover:bg-[#F59E0B]/10 hover:text-[#F59E0B]'
                      }`}
                    >
                      <Flag className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-2.5">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3
                      className="text-xl font-bold font-display"
                      style={highestColor ? { color: highestColor } : undefined}
                    >
                      {target.displayName}
                    </h3>
                    {target.isBot && <BotBadge verified={target.isVerifiedBot} />}
                    {!target.isBot && target.nitroTier === 'nitro' && <NitroBadge />}
                    {!target.isBot && target.streak && target.streak.currentStreak > 0 && (
                      <FlameStreakBadge streak={target.streak} />
                    )}
                    {serverContext?.isOwner && (
                      <span
                        title={`${serverContext.serverName} Sahibi`}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#F59E0B]"
                      >
                        <Crown className="w-4 h-4 fill-[#F59E0B]/20" />
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-[#A1A1B5] mt-0.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => void handleCopyTag()}
                      title="Kalıcı ORBIT etiketini kopyala"
                      className="inline-flex items-center gap-1 font-mono px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-[#19192A] hover:bg-[#7C3AED]/15 hover:text-[#C084FC] transition-colors"
                    >
                      <span>{target.username}</span>
                      <span className="text-[#7C3AED] dark:text-[#C084FC] font-semibold">
                        #{target.discriminator || '0000'}
                      </span>
                      {copiedTag ? <Check className="w-3 h-3 text-[#22C55E]" /> : <Copy className="w-3 h-3 opacity-70" />}
                    </button>
                    {target.pronouns && (
                      <>
                        <span>·</span>
                        <span>{target.pronouns}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{getStatusLabel(target.status)}</span>
                  </div>
                  {target.customStatus && (
                    <p className="text-xs text-[#7C3AED] dark:text-[#C084FC] mt-1.5">{target.customStatus}</p>
                  )}
                </div>

                {isSelf && (
                  <form onSubmit={handleSaveQuickStatus} className="flex gap-1.5 pt-1">
                    <input
                      type="text"
                      maxLength={80}
                      value={quickCustomStatus}
                      onChange={(e) => setQuickCustomStatus(e.target.value)}
                      placeholder="Hızlı durum notu ekle..."
                      className="flex-1 h-8 px-2.5 rounded-lg bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs"
                    />
                    <button
                      type="submit"
                      disabled={savingQuickStatus}
                      className="h-8 px-2.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-medium shrink-0 transition-colors"
                    >
                      {savingQuickStatus ? '...' : 'Güncelle'}
                    </button>
                  </form>
                )}

                {target.activityType && target.activityText && (
                  <div className="rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] px-3 py-2 flex items-center gap-2.5 text-xs">
                    <Sparkles className="w-4 h-4 text-[#A855F7] shrink-0" />
                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-[#A1A1B5]">
                        {ACTIVITY_LABELS[target.activityType]}:{' '}
                      </span>
                      <span className="font-medium text-slate-800 dark:text-[#F8FAFC]">{target.activityText}</span>
                    </div>
                  </div>
                )}

                {!target.isBot && (typeof target.xp === 'number' || target.streak) && (
                  <div className="rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] px-3 py-2.5 flex items-center justify-between gap-3 text-xs">
                    {(() => {
                      const lvl = calculateLevelFromXp(target.xp || 0);
                      return (
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-[#7C3AED] dark:text-[#C084FC]">
                              Seviye {lvl.level}
                            </span>
                            <span className="font-mono text-slate-400 dark:text-[#A1A1B5] tabular-nums">{target.xp || 0} XP</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-200 dark:bg-[#0B0B12] overflow-hidden">
                            <div className="h-full bg-[#A855F7] rounded-full" style={{ width: `${lvl.progressPct}%` }} />
                          </div>
                        </div>
                      );
                    })()}
                    {target.streak && (
                      <div className="shrink-0 text-right pl-2 border-l border-slate-200 dark:border-[#29293D]">
                        <p className="text-[10px] text-slate-400 dark:text-[#A1A1B5]">Günlük Seri</p>
                        <p className="text-xs font-bold font-mono text-orange-400">
                          {target.streak.currentStreak}/7 Gün
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {target.badges && target.badges.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-slate-400">Öne Çıkan Rozetler</p>
                    <BadgeStrip
                      badges={target.badges.slice(0, 6)}
                      onOpenCatalog={
                        onOpenBadges
                          ? () => {
                              onClose();
                              onOpenBadges();
                            }
                          : undefined
                      }
                    />
                  </div>
                )}
              </div>

              {(target.bio || safeWebsite) && (
                <div className="space-y-2 border-t border-slate-200 dark:border-[#29293D] pt-3.5">
                  {target.bio && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-500 dark:text-[#A1A1B5]">Hakkında</p>
                      <p className="text-sm text-slate-700 dark:text-[#F8FAFC] whitespace-pre-wrap">{target.bio}</p>
                    </div>
                  )}
                  {safeWebsite && (
                    <a
                      href={safeWebsite}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7C3AED] dark:text-[#C084FC] hover:underline"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span className="truncate max-w-[280px]">{safeWebsite.replace(/^https?:\/\//i, '')}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

              {serverContext && (memberRoles.length > 0 || serverContext.isOwner) && (
                <div className="space-y-2 border-t border-slate-200 dark:border-[#29293D] pt-3.5">
                  <p className="text-xs font-semibold text-slate-500 dark:text-[#A1A1B5]">
                    {serverContext.serverName} Rolleri
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {serverContext.isOwner && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] text-xs font-medium">
                        <Crown className="w-3 h-3" />
                        Sunucu Sahibi
                      </span>
                    )}
                    {memberRoles.map((role) => (
                      <span
                        key={role.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs font-medium"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: role.color || '#64748B' }}
                        />
                        <span>{role.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {me?.isFounder && (
                <div className="space-y-2 border-t border-slate-200 dark:border-[#29293D] pt-3.5">
                  <p className="text-xs font-semibold text-[#F59E0B] flex items-center gap-1.5">
                    <Crown className="w-3.5 h-3.5" />
                    Kurucu Rozet Yönetimi (1-Tık Ver / Kaldır)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_BADGE_KEYS.filter((k) => k !== 'platform_founder').map((key) => {
                      const meta = BADGE_CATALOG[key];
                      const owned = ownedBadgeKeys.has(key);
                      const busy = badgeActionKey === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={busy}
                          onClick={() => void handleFounderToggleBadge(key, owned)}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                            owned
                              ? 'bg-[#7C3AED]/15 border-[#A855F7]/50 text-[#C084FC] hover:bg-[#EF4444]/15 hover:border-[#EF4444]/40 hover:text-[#EF4444]'
                              : 'bg-slate-100 dark:bg-[#19192A] border-slate-200 dark:border-[#29293D] text-slate-500 dark:text-[#A1A1B5] hover:border-[#A855F7]'
                          }`}
                        >
                          <BadgeGlyph badgeKey={key} color={meta.color} sizePx={13} />
                          <span>{meta.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(target.createdAt || serverContext?.joinedAt) && (
                <div className="grid grid-cols-2 gap-3 border-t border-slate-200 dark:border-[#29293D] pt-3.5 text-xs">
                  {target.createdAt && (
                    <div>
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-[#A1A1B5] flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        ORBIT Üyeliği
                      </p>
                      <p className="mt-0.5 text-slate-700 dark:text-[#F8FAFC]">{formatTurkishDate(target.createdAt)}</p>
                    </div>
                  )}
                  {serverContext?.joinedAt && (
                    <div>
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-[#A1A1B5]">Sunucuya Katılım</p>
                      <p className="mt-0.5 text-slate-700 dark:text-[#F8FAFC]">{formatTurkishDate(serverContext.joinedAt)}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2 border-t border-slate-200 dark:border-[#29293D] pt-3.5">
                <p className="text-xs font-semibold text-slate-500 dark:text-[#A1A1B5]">
                  Ortak Sunucular ({mutualServers.length})
                </p>
                {mutualServers.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Ortak sunucu bulunmuyor.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {mutualServers.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#19192A] text-xs font-medium"
                      >
                        <span className="w-5 h-5 rounded-md bg-[#7C3AED]/20 text-[#C084FC] flex items-center justify-center font-bold text-[10px]">
                          {s.name[0]?.toUpperCase()}
                        </span>
                        <span>{s.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {reportOpen && (
                <div className="space-y-2.5 border-t border-slate-200 dark:border-[#29293D] pt-4">
                  <p className="text-xs font-semibold text-[#F59E0B] flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Kullanıcıyı Şikâyet Et
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {REPORT_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setReportCategory(cat)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                          reportCategory === cat
                            ? 'bg-[#F59E0B]/15 border-[#F59E0B]/50 text-[#F59E0B]'
                            : 'bg-slate-100 dark:bg-[#19192A] border-slate-200 dark:border-[#29293D] text-slate-500 dark:text-[#A1A1B5]'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={2}
                    maxLength={400}
                    value={reportReason}
                    onChange={(e) => {
                      setReportReason(e.target.value);
                      if (reportError) setReportError(null);
                    }}
                    placeholder="Şikâyet nedeninizi kısaca açıklayın..."
                    className={`w-full rounded-xl bg-slate-100 dark:bg-[#19192A] border p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#A855F7] ${
                      reportError ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                    }`}
                  />
                  {reportError && (
                    <p role="alert" className="text-xs text-[#EF4444]">
                      {reportError}
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setReportOpen(false);
                        setReportError(null);
                      }}
                      className="px-3 py-1.5 text-xs rounded-lg text-slate-400 hover:text-slate-200"
                    >
                      İptal
                    </button>
                    <button
                      type="button"
                      disabled={reportSubmitting}
                      onClick={() => void handleReport()}
                      className="px-3 py-1.5 text-xs rounded-lg bg-[#F59E0B] hover:bg-amber-500 disabled:opacity-50 text-slate-950 font-semibold"
                    >
                      {reportSubmitting ? 'Gönderiliyor...' : 'Şikâyeti Gönder'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
