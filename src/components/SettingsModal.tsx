import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Award,
  Bell,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Crown,
  Download,
  Eye,
  FileText,
  Flame,
  Image as ImageIcon,
  Info,
  Key,
  KeyRound,
  Keyboard,
  Laptop,
  Lock,
  LogOut,
  Mail,
  Mic,
  Monitor,
  Moon,
  Palette,
  Plus,
  Scale,
  Share,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  User,
  Volume2,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { apiFetch, ApiError, getStoredToken } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { useToast } from '../client/ToastContext.tsx';
import { usePWAInstall } from '../client/usePWAInstall.ts';
import { useVoice, type PttKeyOption } from '../client/VoiceContext.tsx';
import {
  ACTIVITY_LABELS,
  AVATAR_FRAMES,
  BANNER_PRESETS,
  PROFILE_EFFECTS,
  type ActivityTypeKey,
  type AvatarFrameKey,
  type BadgeKey,
  type BannerPresetKey,
  type ProfileEffectKey,
} from '../shared/badges.ts';
import type {
  PresenceStatus,
  ReminderItem,
  ScheduledMessageItem,
  UserProfile,
  UserSessionInfo,
  UserSettings,
} from '../shared/types.ts';
import { BadgeStrip, FeaturedBadgeIcon } from './BadgeStrip.tsx';
import { NitroBadge } from './BotBadge.tsx';
import { OrbitDocsSection, type OrbitDocTabId } from './OrbitDocsSection.tsx';
import { SingleColorPickerButton } from './SingleColorPickerButton.tsx';
import { ProfileBannerSurface, UserAvatar } from './UserAvatar.tsx';

const STATUS_PILLS: Array<{ id: PresenceStatus; label: string; dot: string }> = [
  { id: 'online', label: 'Çevrimiçi', dot: 'bg-emerald-500' },
  { id: 'idle', label: 'Boşta', dot: 'bg-amber-400' },
  { id: 'dnd', label: 'Rahatsız Etme', dot: 'bg-rose-500' },
  { id: 'offline', label: 'Görünmez', dot: 'bg-slate-400' },
];

type SettingsTabId =
  | 'account'
  | 'security'
  | 'privacy'
  | 'appearance'
  | 'voice'
  | 'notifications'
  | 'accessibility'
  | 'scheduled'
  | 'install'
  | OrbitDocTabId;

const SETTINGS_CATEGORIES: Array<{
  title: string;
  items: Array<{ id: SettingsTabId; label: string; icon: React.ComponentType<{ className?: string }>; iconColor: string }>;
}> = [
  {
    title: 'KULLANICI AYARLARI',
    items: [
      { id: 'account', label: 'Hesabım & Profil', icon: User, iconColor: 'text-[#A855F7]' },
      { id: 'security', label: 'Güvenlik & Oturum', icon: Lock, iconColor: 'text-cyan-500' },
      { id: 'privacy', label: 'Gizlilik & Engeller', icon: Shield, iconColor: 'text-emerald-500' },
    ],
  },
  {
    title: 'UYGULAMA AYARLARI',
    items: [
      { id: 'appearance', label: 'Görünüm', icon: Palette, iconColor: 'text-fuchsia-500' },
      { id: 'voice', label: 'Ses, Video & Bas-Konuş', icon: Mic, iconColor: 'text-emerald-500' },
      { id: 'notifications', label: 'Bildirimler', icon: Bell, iconColor: 'text-amber-500' },
      { id: 'accessibility', label: 'Erişilebilirlik', icon: Eye, iconColor: 'text-sky-500' },
      { id: 'scheduled', label: 'Zamanlanmış & Hatırlatıcılar', icon: CalendarClock, iconColor: 'text-violet-500' },
      { id: 'install', label: 'Uygulamayı Kur (PWA)', icon: Download, iconColor: 'text-cyan-500' },
    ],
  },
  {
    title: 'BİLGİ, REHBER & POLİTİKALAR',
    items: [
      { id: 'about', label: 'ORBIT Tanıtım & Hakkında', icon: Info, iconColor: 'text-[#A855F7]' },
      { id: 'guide', label: 'Kullanım Kılavuzu', icon: BookOpen, iconColor: 'text-emerald-500' },
      { id: 'terms', label: 'Hizmet Şartları & Kurallar', icon: Scale, iconColor: 'text-amber-500' },
      { id: 'policies', label: 'Gizlilik & Çerez Politikası', icon: FileText, iconColor: 'text-cyan-500' },
    ],
  },
];

function formatSessionDate(iso: string): string {
  const normalized = iso.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function summarizeUserAgent(ua: string): string {
  if (!ua) return 'Bilinmeyen İstemci';
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : ua.includes('Chrome/')
    ? 'Chrome'
    : ua.includes('Firefox/')
    ? 'Firefox'
    : ua.includes('Safari/')
    ? 'Safari'
    : 'İstemci';
  const os =
    ua.includes('iPhone') || ua.includes('iPad')
      ? 'iOS'
      : ua.includes('Android')
      ? 'Android'
      : ua.includes('Windows')
      ? 'Windows'
      : ua.includes('Mac OS')
      ? 'macOS'
      : ua.includes('Linux')
      ? 'Linux'
      : 'Cihaz';
  return `${browser} · ${os}`;
}

export function SettingsModal({
  onClose,
  onOpenBadges,
  onOpenAchievements,
  onOpenNitro,
}: {
  onClose: () => void;
  onOpenBadges?: () => void;
  onOpenAchievements?: () => void;
  onOpenNitro?: () => void;
}) {
  const { profile, settings, updateProfileState, updateSettingsState, refreshMe, logout } = useAuth();
  const { showToast } = useToast();
  const voice = useVoice();
  const pwa = usePWAInstall();

  const [tab, setTab] = useState<SettingsTabId>('account');
  const [accountSubTab, setAccountSubTab] = useState<'basic' | 'appearance' | 'status' | 'danger'>('basic');
  // Mobile Discord-like vertical category list -> detail drilldown
  const [mobileMenuOpen, setMobileMenuOpen] = useState(true);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [username, setUsername] = useState(profile?.username || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [bannerColor, setBannerColor] = useState(profile?.bannerColor || '#7C3AED');
  const [bannerPreset, setBannerPreset] = useState<BannerPresetKey>(profile?.bannerPreset || 'none');
  const [bannerUploading, setBannerUploading] = useState(false);
  const [preferredStatus, setPreferredStatus] = useState<PresenceStatus>(profile?.preferredStatus || 'online');
  const [customStatus, setCustomStatus] = useState(profile?.customStatus || '');
  const [avatarFrame, setAvatarFrame] = useState<AvatarFrameKey>(profile?.avatarFrame || 'none');
  const [profileEffect, setProfileEffect] = useState<ProfileEffectKey>(profile?.profileEffect || 'none');
  const [pronouns, setPronouns] = useState(profile?.pronouns || '');
  const [websiteUrl, setWebsiteUrl] = useState(profile?.websiteUrl || '');
  const [activityType, setActivityType] = useState<ActivityTypeKey>(profile?.activityType || '');
  const [activityText, setActivityText] = useState(profile?.activityText || '');
  const [featuredBadge, setFeaturedBadge] = useState<BadgeKey | ''>(profile?.featuredBadge || '');
  const [saving, setSaving] = useState(false);
  const [copiedTag, setCopiedTag] = useState(false);

  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Voice & WebRTC readiness + Mic test
  const [turnConfigured, setTurnConfigured] = useState<boolean | null>(null);
  const [micTesting, setMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const micTestCleanupRef = useRef<(() => void) | null>(null);

  // Security & Sessions
  const [sessions, setSessions] = useState<UserSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [revokeOthersOnPass, setRevokeOthersOnPass] = useState(true);
  const [changingPassword, setChangingPassword] = useState(false);

  // 2FA, Email Change & Data Export state
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [twoFactorCodeInput, setTwoFactorCodeInput] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [twoFactorDisablePass, setTwoFactorDisablePass] = useState('');
  const [twoFactorDisableCode, setTwoFactorDisableCode] = useState('');
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);

  const [newEmailInput, setNewEmailInput] = useState('');
  const [emailChangePass, setEmailChangePass] = useState('');
  const [emailChangeConfirmToken, setEmailChangeConfirmToken] = useState('');
  const [emailChangeStep, setEmailChangeStep] = useState<'idle' | 'confirm'>('idle');
  const [emailChangeBusy, setEmailChangeBusy] = useState(false);
  const [exportingData, setExportingData] = useState(false);

  // Blocked users
  const [blockedUsers, setBlockedUsers] = useState<UserProfile[]>([]);

  // Scheduled Messages & Reminders
  const [scheduledList, setScheduledList] = useState<ScheduledMessageItem[]>([]);
  const [remindersList, setRemindersList] = useState<ReminderItem[]>([]);
  const [newRemNote, setNewRemNote] = useState('');
  const [newRemMinutes, setNewRemMinutes] = useState('15');

  // Form validation states
  const [profileErrors, setProfileErrors] = useState<{ displayName?: string; username?: string }>({});
  const [deletePassError, setDeletePassError] = useState('');
  const [twoFaEnableError, setTwoFaEnableError] = useState('');
  const [twoFaDisableErrors, setTwoFaDisableErrors] = useState<{ password?: string; code?: string }>({});
  const [emailReqErrors, setEmailReqErrors] = useState<{ email?: string; password?: string }>({});
  const [emailConfirmError, setEmailConfirmError] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [reminderError, setReminderError] = useState('');

  const [pushSupported, setPushSupported] = useState(false);
  const [pushVapidConfigured, setPushVapidConfigured] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName || '');
    setUsername(profile.username || '');
    setBio(profile.bio || '');
    setBannerColor(profile.bannerColor || '#7C3AED');
    setBannerPreset(profile.bannerPreset || 'none');
    setPreferredStatus(profile.preferredStatus || 'online');
    setCustomStatus(profile.customStatus || '');
    setAvatarFrame(profile.avatarFrame || 'none');
    setProfileEffect(profile.profileEffect || 'none');
    setPronouns(profile.pronouns || '');
    setWebsiteUrl(profile.websiteUrl || '');
    setActivityType(profile.activityType || '');
    setActivityText(profile.activityText || '');
    setFeaturedBadge(profile.featuredBadge || '');
  }, [profile]);

  useEffect(() => {
    setPushSupported('Notification' in window && 'serviceWorker' in navigator);
    apiFetch<{ configured: boolean }>('/push/config')
      .then((res) => setPushVapidConfigured(res.configured))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'voice') {
      apiFetch<{ turnConfigured: boolean }>('/webrtc/config')
        .then((res) => setTurnConfigured(res.turnConfigured))
        .catch(() => setTurnConfigured(false));
    } else {
      micTestCleanupRef.current?.();
      micTestCleanupRef.current = null;
      setMicTesting(false);
      setMicLevel(0);
    }

    if (tab === 'security') {
      setSessionsLoading(true);
      apiFetch<{ sessions: UserSessionInfo[] }>('/auth/sessions')
        .then((res) => setSessions(res.sessions))
        .catch(() => {})
        .finally(() => setSessionsLoading(false));
    }

    if (tab === 'privacy') {
      apiFetch<{ blocked: Array<UserProfile | { userId: string; user?: UserProfile }> }>('/blocks')
        .then((res) => {
          const list = (res.blocked || [])
            .map((entry) => ('user' in entry && entry.user ? entry.user : (entry as UserProfile)))
            .filter((u): u is UserProfile => Boolean(u && u.userId));
          setBlockedUsers(list);
        })
        .catch(() => {});
    }

    if (tab === 'scheduled') {
      Promise.all([
        apiFetch<{ scheduled: ScheduledMessageItem[] }>('/scheduled-messages'),
        apiFetch<{ reminders: ReminderItem[] }>('/reminders'),
      ])
        .then(([sRes, rRes]) => {
          setScheduledList(sRes.scheduled);
          setRemindersList(rRes.reminders);
        })
        .catch(() => {});
    }
  }, [tab]);

  useEffect(() => {
    return () => {
      micTestCleanupRef.current?.();
      micTestCleanupRef.current = null;
    };
  }, []);

  if (!profile || !settings) return null;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { displayName?: string; username?: string } = {};
    if (!displayName.trim()) {
      errs.displayName = 'Görünen ad boş bırakılamaz.';
    } else if (displayName.trim().length < 2) {
      errs.displayName = 'Görünen ad en az 2 karakter olmalıdır.';
    }
    if (!username.trim()) {
      errs.username = 'Kullanıcı adı boş bırakılamaz.';
    } else if (username.trim().length < 3) {
      errs.username = 'Kullanıcı adı en az 3 karakter olmalıdır.';
    }
    setProfileErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const res = await apiFetch<{ profile: UserProfile }>('/users/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName,
          username,
          bio,
          bannerColor,
          bannerPreset,
          preferredStatus,
          customStatus,
          avatarFrame,
          profileEffect,
          pronouns,
          websiteUrl,
          activityType,
          activityText,
          featuredBadge: featuredBadge || null,
        }),
      });
      updateProfileState(res.profile);
      showToast('Profiliniz güncellendi.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Profil güncellenemedi.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      const res = await apiFetch<{ profile: UserProfile }>('/users/me/avatar', { method: 'POST', body: fd });
      updateProfileState(res.profile);
      showToast('Profil fotoğrafı güncellendi.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Fotoğraf yüklenemedi.', 'error');
    } finally {
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const removeAvatar = async () => {
    try {
      const res = await apiFetch<{ profile: UserProfile }>('/users/me/avatar', { method: 'DELETE' });
      updateProfileState(res.profile);
      showToast('Profil fotoğrafı kaldırıldı.', 'info');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Fotoğraf kaldırılamadı.', 'error');
    }
  };

  const uploadBanner = async (file: File | undefined) => {
    if (!file) return;
    setBannerUploading(true);
    const fd = new FormData();
    fd.append('banner', file);
    try {
      const res = await apiFetch<{ profile: UserProfile }>('/users/me/banner', { method: 'POST', body: fd });
      updateProfileState(res.profile);
      showToast('Profil banner görseli güncellendi.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Banner yüklenemedi.', 'error');
    } finally {
      setBannerUploading(false);
      if (bannerInputRef.current) bannerInputRef.current.value = '';
    }
  };

  const removeBanner = async () => {
    setBannerUploading(true);
    try {
      const res = await apiFetch<{ profile: UserProfile }>('/users/me/banner', { method: 'DELETE' });
      updateProfileState(res.profile);
      showToast('Profil banner görseli kaldırıldı.', 'info');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Banner kaldırılamadı.', 'error');
    } finally {
      setBannerUploading(false);
    }
  };

  const patchSettings = async (patch: Partial<UserSettings>) => {
    try {
      const res = await apiFetch<{ settings: UserSettings }>('/users/me/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      updateSettingsState(res.settings);
      showToast('Ayar kaydedildi.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Ayar güncellenemedi.', 'error');
    }
  };

  const handleEnablePush = async () => {
    if (!pushSupported) {
      showToast('Bu tarayıcı Web Push bildirimlerini desteklemiyor.', 'error');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      showToast('Tarayıcı bildirim izni verilmedi.', 'error');
      return;
    }
    if (!pushVapidConfigured) {
      showToast('Tarayıcı izni alındı; arka plan Web Push için sunucuda VAPID anahtarları gereklidir.', 'info');
      return;
    }
    await patchSettings({ pushNotifications: !settings.pushNotifications });
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const isPasswordless = profile.hasPassword === false;
    if (isPasswordless) {
      if (deleteConfirmText.trim().toUpperCase() !== 'HESABI SIL') {
        setDeletePassError('Onaylamak için büyük harflerle HESABI SIL yazmalısınız.');
        return;
      }
    } else if (!deletePassword.trim()) {
      setDeletePassError('Hesabı silmek için mevcut şifrenizi girmelisiniz.');
      return;
    }
    setDeletePassError('');
    try {
      await apiFetch('/users/me', {
        method: 'DELETE',
        body: JSON.stringify(
          isPasswordless ? { confirmText: deleteConfirmText.trim().toUpperCase() } : { password: deletePassword }
        ),
      });
      showToast('Hesabınız kalıcı olarak silindi.', 'info');
      await logout();
      onClose();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Hesap silinemedi.', 'error');
    }
  };

  const handleToggleMicTest = async () => {
    if (micTesting) {
      micTestCleanupRef.current?.();
      micTestCleanupRef.current = null;
      setMicTesting(false);
      setMicLevel(0);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: voice.selectedAudioDevice
          ? { deviceId: { exact: voice.selectedAudioDevice }, noiseSuppression: voice.noiseSuppression }
          : { noiseSuppression: voice.noiseSuppression },
      });
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let rafId = 0;
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / Math.max(1, data.length);
        setMicLevel(Math.min(100, Math.round((avg / 90) * 100)));
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      micTestCleanupRef.current = () => {
        cancelAnimationFrame(rafId);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => {});
      };
      setMicTesting(true);
    } catch {
      showToast('Mikrofon testi için tarayıcı izni veya çalışan bir cihaz gerekiyor.', 'error');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const isSettingFirstPassword = profile.hasPassword === false;
    const errs: { current?: string; next?: string; confirm?: string } = {};
    if (!isSettingFirstPassword && !currentPassword) {
      errs.current = 'Mevcut şifreniz boş bırakılamaz.';
    }
    if (!newPassword) {
      errs.next = 'Yeni şifre alanı boş bırakılamaz.';
    } else if (newPassword.length < 8) {
      errs.next = 'Yeni şifre en az 8 karakter olmalıdır.';
    }
    if (!confirmPassword) {
      errs.confirm = 'Yeni şifre tekrarı boş bırakılamaz.';
    } else if (newPassword && newPassword !== confirmPassword) {
      errs.confirm = 'Yeni şifre ve tekrarı eşleşmiyor.';
    }
    setPasswordErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setChangingPassword(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: isSettingFirstPassword ? '' : currentPassword,
          newPassword,
          revokeOthers: revokeOthersOnPass,
        }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refreshMe();
      showToast(isSettingFirstPassword ? 'Hesap şifreniz oluşturuldu.' : 'Şifreniz başarıyla güncellendi.', 'success');
      const res = await apiFetch<{ sessions: UserSessionInfo[] }>('/auth/sessions');
      setSessions(res.sessions);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Şifre değiştirilemedi.', 'error');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleStart2FASetup = async () => {
    setTwoFactorBusy(true);
    try {
      const res = await apiFetch<{ secret: string; otpauthUri: string }>('/auth/2fa/setup', { method: 'POST' });
      setTwoFactorSetup(res);
      setTwoFactorCodeInput('');
      setTwoFaEnableError('');
      setBackupCodes(null);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '2FA başlatılamadı.', 'error');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleEnable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorCodeInput.trim()) {
      setTwoFaEnableError('Lütfen doğrulayıcı uygulamanızdaki kodu girin.');
      return;
    }
    setTwoFaEnableError('');
    setTwoFactorBusy(true);
    try {
      const res = await apiFetch<{ backupCodes: string[] }>('/auth/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ code: twoFactorCodeInput.trim() }),
      });
      setBackupCodes(res.backupCodes);
      setTwoFactorSetup(null);
      await refreshMe();
      showToast('İki adımlı doğrulama (2FA) etkinleştirildi!', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Doğrulama kodu geçersiz.', 'error');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { password?: string; code?: string } = {};
    if (!twoFactorDisablePass) errs.password = 'Mevcut şifreniz boş bırakılamaz.';
    if (!twoFactorDisableCode.trim()) errs.code = '6 haneli kod veya yedek kod gereklidir.';
    setTwoFaDisableErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setTwoFactorBusy(true);
    try {
      await apiFetch('/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({
          password: twoFactorDisablePass,
          code: twoFactorDisableCode.trim(),
        }),
      });
      setTwoFactorDisablePass('');
      setTwoFactorDisableCode('');
      setBackupCodes(null);
      await refreshMe();
      showToast('İki adımlı doğrulama kapatıldı.', 'info');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '2FA kapatılamadı.', 'error');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleRequestEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { email?: string; password?: string } = {};
    const trimmedEmail = newEmailInput.trim();
    if (!trimmedEmail) {
      errs.email = 'Yeni e-posta adresi boş bırakılamaz.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errs.email = 'Geçerli bir e-posta adresi girin.';
    }
    if (!emailChangePass) errs.password = 'Mevcut şifreniz boş bırakılamaz.';
    setEmailReqErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setEmailChangeBusy(true);
    try {
      const res = await apiFetch<{ verificationCode?: string | null; confirmationCode?: string | null; smtpConfigured: boolean }>(
        '/auth/change-email/request',
        {
          method: 'POST',
          body: JSON.stringify({ newEmail: trimmedEmail, password: emailChangePass }),
        }
      );
      setEmailChangeStep('confirm');
      const code = res.verificationCode || res.confirmationCode;
      if (code) setEmailChangeConfirmToken(code);
      showToast(
        res.smtpConfigured
          ? 'Onay kodu yeni e-posta adresinize gönderildi.'
          : 'SMTP olmadığı için onay kodu oluşturuldu.',
        'info'
      );
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'E-posta değişikliği başlatılamadı.', 'error');
    } finally {
      setEmailChangeBusy(false);
    }
  };

  const handleConfirmEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailChangeConfirmToken.trim()) {
      setEmailConfirmError('Onay kodu alanı boş bırakılamaz.');
      return;
    }
    setEmailConfirmError('');
    setEmailChangeBusy(true);
    try {
      const res = await apiFetch<{ email: string }>('/auth/change-email/confirm', {
        method: 'POST',
        body: JSON.stringify({ code: emailChangeConfirmToken.trim() }),
      });
      setEmailChangeStep('idle');
      setNewEmailInput('');
      setEmailChangePass('');
      setEmailChangeConfirmToken('');
      await refreshMe();
      showToast(`E-posta adresiniz ${res.email} olarak güncellendi.`, 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'E-posta doğrulanamadı.', 'error');
    } finally {
      setEmailChangeBusy(false);
    }
  };

  const handleExportAccountData = async () => {
    setExportingData(true);
    try {
      const token = getStoredToken();
      const resp = await fetch('/api/users/me/export', {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error('Veri indirilemedi.');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orbit-hesap-verileri-${profile.username}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Hesap verileriniz JSON olarak indirildi.', 'success');
    } catch {
      showToast('Veri dışa aktarılamadı.', 'error');
    } finally {
      setExportingData(false);
    }
  };

  const handleAddReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRemNote.trim()) {
      setReminderError('Hatırlatma notu boş bırakılamaz.');
      return;
    }
    setReminderError('');
    const mins = Math.max(1, Math.min(43200, Number(newRemMinutes) || 15));
    try {
      const res = await apiFetch<{ reminder: ReminderItem }>('/reminders', {
        method: 'POST',
        body: JSON.stringify({
          note: newRemNote.trim(),
          remindAt: new Date(Date.now() + mins * 60_000).toISOString(),
        }),
      });
      setRemindersList((prev) => [...prev, res.reminder]);
      setNewRemNote('');
      showToast(`${mins} dakika sonrası için hatırlatıcı eklendi.`, 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Hatırlatıcı eklenemedi.', 'error');
    }
  };

  const fullTag = `${username || profile.username}#${profile.discriminator || '0000'}`;
  const activeTabLabel =
    SETTINGS_CATEGORIES.flatMap((c) => c.items).find((i) => i.id === tab)?.label || 'Kullanıcı Ayarları';

  const selectCategoryTab = (id: SettingsTabId) => {
    setTab(id);
    setMobileMenuOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0B12]/80 backdrop-blur-md p-2 sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl h-[92dvh] sm:h-[88dvh] rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-2xl flex flex-col md:flex-row overflow-hidden animate-orbit-enter"
      >
        {/* Discord-style Vertical Categorized Sidebar (Full-width menu on mobile when mobileMenuOpen, left rail on desktop) */}
        <aside
          className={`${
            mobileMenuOpen ? 'flex flex-1 md:flex-none' : 'hidden md:flex'
          } md:w-64 md:border-r border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] flex-col shrink-0 min-h-0`}
        >
          <div className="px-4 py-3.5 border-b border-slate-200 dark:border-[#29293D] flex items-center justify-between md:hidden">
            <h3 className="text-base font-bold font-display">Kullanıcı Ayarları</h3>
            <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-[#222238]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-5">
            {SETTINGS_CATEGORIES.map((cat) => (
              <div key={cat.title} className="space-y-1">
                <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                  {cat.title}
                </p>
                {cat.items.map((item) => {
                  const Icon = item.icon;
                  const active = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectCategoryTab(item.id)}
                      className={`w-full px-3 py-2.5 md:py-2 rounded-xl text-xs font-medium flex items-center justify-between gap-2 transition-colors min-h-[42px] md:min-h-[36px] ${
                        active
                          ? 'md:bg-[#7C3AED] md:text-white bg-[#7C3AED]/15 text-[#7C3AED] dark:text-[#C084FC]'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-[#222238]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${active ? 'md:text-white ' + item.iconColor : item.iconColor}`} />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 opacity-50 md:hidden shrink-0" />
                    </button>
                  );
                })}
              </div>
            ))}

            <div className="space-y-1 pt-2 border-t border-slate-200 dark:border-[#29293D]">
              <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                TOPLULUK & OTURUM
              </p>
              {onOpenNitro && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenNitro();
                  }}
                  className="w-full px-3 py-2.5 md:py-2 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 text-[#7C3AED] dark:text-[#C084FC] hover:bg-[#7C3AED]/10 min-h-[42px] md:min-h-[36px]"
                >
                  <span className="flex items-center gap-2.5">
                    <Crown className="w-4 h-4 shrink-0 text-[#A855F7]" />
                    ORBIT Nitro
                  </span>
                  <ChevronRight className="w-4 h-4 opacity-50 md:hidden shrink-0" />
                </button>
              )}
              {onOpenAchievements && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAchievements();
                  }}
                  className="w-full px-3 py-2.5 md:py-2 rounded-xl text-xs font-medium flex items-center justify-between gap-2 text-amber-600 dark:text-amber-300 hover:bg-amber-500/10 min-h-[42px] md:min-h-[36px]"
                >
                  <span className="flex items-center gap-2.5">
                    <Flame className="w-4 h-4 shrink-0 text-orange-400" />
                    Başarılar & Seri
                  </span>
                  <ChevronRight className="w-4 h-4 opacity-50 md:hidden shrink-0" />
                </button>
              )}
              {onOpenBadges && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenBadges();
                  }}
                  className="w-full px-3 py-2.5 md:py-2 rounded-xl text-xs font-medium flex items-center justify-between gap-2 text-[#A855F7] dark:text-[#C084FC] hover:bg-[#A855F7]/10 min-h-[42px] md:min-h-[36px]"
                >
                  <span className="flex items-center gap-2.5">
                    <Award className="w-4 h-4 shrink-0" />
                    Rozet Kataloğu
                  </span>
                  <ChevronRight className="w-4 h-4 opacity-50 md:hidden shrink-0" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  void logout();
                  onClose();
                }}
                className="w-full px-3 py-2.5 md:py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 text-[#EF4444] hover:bg-[#EF4444]/10 min-h-[42px] md:min-h-[36px]"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                Çıkış Yap
              </button>
            </div>
          </div>
        </aside>

        {/* Detail Content Area */}
        <div className={`${mobileMenuOpen ? 'hidden md:flex' : 'flex'} flex-1 flex-col min-h-0 min-w-0`}>
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-[#29293D] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="md:hidden px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#19192A] text-xs font-semibold inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Menü
              </button>
              <h3 className="text-base font-bold font-display truncate">{activeTabLabel}</h3>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#222238] shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6">
            {tab === 'account' && (
              <div className="space-y-5 max-w-2xl">
                {/* Live Preview Card */}
                <div className="rounded-2xl border border-slate-200 dark:border-[#29293D] overflow-hidden bg-slate-50 dark:bg-[#10111B]">
                  <ProfileBannerSurface
                    bannerUrl={profile.bannerUrl}
                    bannerPreset={bannerPreset}
                    bannerColor={bannerColor}
                    profileEffect={profileEffect}
                    className="h-24"
                  >
                    <span className="relative z-10 float-right m-2.5 px-2 py-0.5 rounded-md bg-black/50 backdrop-blur-sm text-[10px] font-medium text-white/95">
                      Canlı Önizleme
                    </span>
                  </ProfileBannerSurface>
                  <div className="px-4 pb-4 -mt-8 flex flex-wrap items-end justify-between gap-3 relative z-10">
                    <div className="flex items-end gap-3.5">
                      <div className="ring-4 ring-slate-50 dark:ring-[#10111B] rounded-full">
                        <UserAvatar
                          src={profile.avatarUrl}
                          name={displayName || profile.displayName}
                          status={preferredStatus}
                          frame={avatarFrame}
                          size="xl"
                        />
                      </div>
                      <div className="pb-1 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-base font-bold font-display">{displayName || profile.displayName}</p>
                          {profile.nitroTier === 'nitro' && <NitroBadge />}
                          {featuredBadge && <FeaturedBadgeIcon badgeKey={featuredBadge} size={15} />}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard?.writeText(fullTag);
                              setCopiedTag(true);
                              showToast(`Etiket kopyalandı: ${fullTag}`, 'success');
                              window.setTimeout(() => setCopiedTag(false), 1600);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-mono text-slate-500 dark:text-[#A1A1B5] hover:text-[#C084FC]"
                          >
                            <span>{username || profile.username}</span>
                            <span className="text-[#C084FC] font-semibold">#{profile.discriminator || '0000'}</span>
                            {copiedTag ? <Check className="w-3 h-3 text-[#22C55E]" /> : <Copy className="w-3 h-3 opacity-70" />}
                          </button>
                          {pronouns && <span className="text-xs text-slate-500 dark:text-[#A1A1B5]">· {pronouns}</span>}
                        </div>
                        {customStatus && <p className="text-[11px] text-[#C084FC] truncate max-w-xs">{customStatus}</p>}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="h-8 px-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A] text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-[#222238]">
                        <Upload className="w-3.5 h-3.5" />
                        Avatar Seç
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => void uploadAvatar(e.target.files?.[0])}
                        />
                      </label>
                      {profile.avatarUrl && (
                        <button
                          type="button"
                          onClick={() => void removeAvatar()}
                          className="h-8 px-2.5 rounded-xl border border-[#EF4444]/35 text-[#EF4444] hover:bg-[#EF4444]/10 text-xs font-medium"
                        >
                          Kaldır
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="px-4 pb-4 space-y-2 border-t border-slate-200 dark:border-[#29293D] pt-3">
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5] flex items-center justify-between flex-wrap gap-2">
                      <span>
                        E-posta: <span className="font-mono">{profile.email}</span> ·{' '}
                        {profile.emailVerified ? 'Doğrulandı' : 'Doğrulanmadı'}
                        {profile.isGoogleLinked && (
                          <span className="ml-2 text-[#22C55E] font-medium">· Google Bağlı</span>
                        )}
                      </span>
                      {activityType && activityText && (
                        <span className="text-[#C084FC] font-medium">
                          {ACTIVITY_LABELS[activityType]}: {activityText}
                        </span>
                      )}
                    </p>
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-[#A1A1B5]">
                        Kazanılan Rozetler (tıklayarak nadirlik ve kazanım tarihini görün)
                      </p>
                      <BadgeStrip badges={profile.badges || []} showEmpty onOpenCatalog={onOpenBadges} />
                    </div>
                  </div>
                </div>

                {/* Clean 4-Section Sub-Menu Navigation */}
                <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-slate-100 dark:bg-[#10111B] border border-slate-200 dark:border-[#29293D] overflow-x-auto">
                  {[
                    { id: 'basic' as const, label: 'Temel Bilgiler' },
                    { id: 'appearance' as const, label: 'Banner & Dekorasyon' },
                    { id: 'status' as const, label: 'Durum & Etkinlik' },
                    { id: 'danger' as const, label: 'Hesap İşlemleri' },
                  ].map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setAccountSubTab(sub.id)}
                      className={`h-9 px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                        accountSubTab === sub.id
                          ? sub.id === 'danger'
                            ? 'bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/35'
                            : 'bg-[#7C3AED] text-white shadow-sm shadow-[#7C3AED]/25'
                          : 'text-slate-600 dark:text-[#A1A1B5] hover:bg-white/70 dark:hover:bg-[#19192A]'
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>

                {/* Organized Profile Sub-Panels */}
                {accountSubTab !== 'danger' ? (
                  <motion.form
                    key={accountSubTab}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    noValidate
                    onSubmit={saveProfile}
                    className="space-y-4"
                  >
                    {accountSubTab === 'basic' && (
                      <div className="rounded-2xl border border-slate-200 dark:border-[#29293D] p-4 space-y-3.5 bg-slate-50/60 dark:bg-[#10111B]">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                          Kimlik & Hakkında Bilgileri
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Görünen Ad</label>
                            <input
                              type="text"
                              value={displayName}
                              onChange={(e) => {
                                setDisplayName(e.target.value);
                                if (profileErrors.displayName) setProfileErrors((p) => ({ ...p, displayName: undefined }));
                              }}
                              className={`w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-sm ${
                                profileErrors.displayName ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                              }`}
                            />
                            {profileErrors.displayName && (
                              <p role="alert" className="text-[11px] font-medium text-[#EF4444]">
                                {profileErrors.displayName}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">
                              Kullanıcı Adı ve Kalıcı Etiket
                            </label>
                            <div
                              className={`flex items-center h-9 rounded-xl bg-white dark:bg-[#19192A] border overflow-hidden ${
                                profileErrors.username ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                              }`}
                            >
                              <input
                                type="text"
                                value={username}
                                onChange={(e) => {
                                  setUsername(e.target.value);
                                  if (profileErrors.username) setProfileErrors((p) => ({ ...p, username: undefined }));
                                }}
                                className="flex-1 h-full px-3 bg-transparent text-sm font-mono focus:outline-none min-w-0"
                              />
                              <span className="px-2.5 h-full flex items-center bg-slate-100 dark:bg-[#151522] border-l border-slate-200 dark:border-[#29293D] font-mono text-xs font-semibold text-[#7C3AED] dark:text-[#C084FC] shrink-0">
                                #{profile.discriminator || '0000'}
                              </span>
                            </div>
                            {profileErrors.username && (
                              <p role="alert" className="text-[11px] font-medium text-[#EF4444]">
                                {profileErrors.username}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Hitap / Zamirler</label>
                            <input
                              type="text"
                              maxLength={32}
                              value={pronouns}
                              onChange={(e) => setPronouns(e.target.value)}
                              placeholder="ör. o / geliştirici"
                              className="w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Web Sitesi / Bağlantı</label>
                            <input
                              type="text"
                              maxLength={160}
                              value={websiteUrl}
                              onChange={(e) => setWebsiteUrl(e.target.value)}
                              placeholder="https://orbit.chat"
                              className="w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Biyografi</label>
                          <textarea
                            rows={3}
                            value={bio}
                            onChange={(e) => setBio(e.target.value)}
                            placeholder="Kendinizden kısaca bahsedin..."
                            className="w-full p-3 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm"
                          />
                        </div>
                      </div>
                    )}

                    {accountSubTab === 'appearance' && (
                      <div className="rounded-2xl border border-slate-200 dark:border-[#29293D] p-4 space-y-4 bg-slate-50/60 dark:bg-[#10111B]">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                          Banner, Hareketli Şablon & Avatar Dekorasyonu
                        </h4>

                        {/* Custom Banner Image Upload */}
                        <div className="p-3 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold flex items-center gap-1.5">
                              <ImageIcon className="w-3.5 h-3.5 text-[#A855F7]" />
                              Özel Banner Görseli
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">
                              Profil kartının üstüne kendi görselinizi veya GIF banner’ınızı yükleyin.
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="h-8 px-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                              <Upload className="w-3.5 h-3.5" />
                              {bannerUploading ? 'Yükleniyor...' : 'Banner Yükle'}
                              <input
                                ref={bannerInputRef}
                                type="file"
                                accept="image/*"
                                disabled={bannerUploading}
                                className="hidden"
                                onChange={(e) => void uploadBanner(e.target.files?.[0])}
                              />
                            </label>
                            {profile.bannerUrl && (
                              <button
                                type="button"
                                disabled={bannerUploading}
                                onClick={() => void removeBanner()}
                                className="h-8 px-2.5 rounded-xl border border-[#EF4444]/40 text-[#EF4444] hover:bg-[#EF4444]/10 text-xs font-medium"
                              >
                                Görseli Kaldır
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Animated Banner Presets */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">
                            Hareketli Banner Şablonu
                          </label>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {BANNER_PRESETS.map((preset) => {
                              const locked = Boolean(preset.nitroOnly && profile.nitroTier !== 'nitro');
                              return (
                                <button
                                  key={preset.key}
                                  type="button"
                                  onClick={() => {
                                    if (locked) {
                                      showToast('Bu hareketli banner şablonu ORBIT Nitro üyelerine özeldir.', 'info');
                                      onOpenNitro?.();
                                      return;
                                    }
                                    setBannerPreset(preset.key);
                                  }}
                                  className={`p-2 rounded-xl border text-left transition-all ${
                                    bannerPreset === preset.key
                                      ? 'border-[#A855F7] ring-1 ring-[#A855F7]/50 bg-[#7C3AED]/10'
                                      : 'border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]'
                                  } ${locked ? 'opacity-70' : ''}`}
                                >
                                  <div
                                    className={`h-7 rounded-lg mb-1.5 ${preset.previewClass}`}
                                    style={
                                      preset.key === 'none'
                                        ? { background: `linear-gradient(135deg, ${bannerColor}, #10111B)` }
                                        : undefined
                                    }
                                  />
                                  <div className="flex items-center justify-between gap-1 text-[11px] font-medium">
                                    <span className="truncate">{preset.label}</span>
                                    {preset.nitroOnly && (
                                      <span className="text-[9px] font-bold text-[#C084FC] shrink-0">NITRO</span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5] flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-[#A855F7]" />
                              Hareketli Avatar Dekorasyonu
                            </label>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {AVATAR_FRAMES.map((fr) => {
                                const locked = Boolean(fr.nitroOnly && profile.nitroTier !== 'nitro');
                                return (
                                  <button
                                    key={fr.key}
                                    type="button"
                                    onClick={() => {
                                      if (locked) {
                                        showToast('Bu dekorasyon ORBIT Nitro üyelerine özeldir.', 'info');
                                        onOpenNitro?.();
                                        return;
                                      }
                                      setAvatarFrame(fr.key);
                                    }}
                                    className={`h-8 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${
                                      avatarFrame === fr.key
                                        ? 'border-[#A855F7] bg-[#7C3AED]/15 text-[#7C3AED] dark:text-[#C084FC]'
                                        : 'border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A] hover:border-[#7C3AED]/50'
                                    } ${locked ? 'opacity-70' : ''}`}
                                  >
                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fr.swatch }} />
                                    <span>{fr.label}</span>
                                    {fr.nitroOnly && (
                                      <span className="text-[9px] font-bold uppercase text-[#C084FC]">NITRO</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Profil Afiş Efekti</label>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {PROFILE_EFFECTS.map((ef) => {
                                  const locked = Boolean(ef.nitroOnly && profile.nitroTier !== 'nitro');
                                  return (
                                    <button
                                      key={ef.key}
                                      type="button"
                                      onClick={() => {
                                        if (locked) {
                                          showToast('Bu profil efekti ORBIT Nitro üyelerine özeldir.', 'info');
                                          onOpenNitro?.();
                                          return;
                                        }
                                        setProfileEffect(ef.key);
                                      }}
                                      className={`h-8 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${
                                        profileEffect === ef.key
                                          ? 'border-[#A855F7] bg-[#A855F7]/15 text-[#A855F7] dark:text-[#C084FC]'
                                          : 'border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A] hover:border-[#7C3AED]/50'
                                      } ${locked ? 'opacity-70' : ''}`}
                                    >
                                      <span>{ef.label}</span>
                                      {ef.nitroOnly && (
                                        <span className="text-[9px] font-bold uppercase text-[#C084FC]">NITRO</span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">
                                İsim Yanı Öne Çıkan Rozet
                              </label>
                              <select
                                value={featuredBadge}
                                onChange={(e) => setFeaturedBadge(e.target.value as BadgeKey | '')}
                                className="w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs"
                              >
                                <option value="">Gösterme</option>
                                {(profile.badges || []).map((b) => (
                                  <option key={b.key} value={b.key}>
                                    {b.label} ({b.rarity})
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5] block">
                                Düz Afiş Rengi
                              </label>
                              <SingleColorPickerButton
                                label="Afiş Rengi Seç"
                                value={bannerColor}
                                onChange={setBannerColor}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {accountSubTab === 'status' && (
                      <div className="rounded-2xl border border-slate-200 dark:border-[#29293D] p-4 space-y-4 bg-slate-50/60 dark:bg-[#10111B]">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                          Durum & Canlı Etkinlik
                        </h4>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Hızlı Durum Seçimi</label>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {STATUS_PILLS.map((st) => (
                              <button
                                key={st.id}
                                type="button"
                                onClick={() => setPreferredStatus(st.id)}
                                className={`h-9 px-2.5 rounded-xl border text-xs font-medium flex items-center gap-2 transition-colors ${
                                  preferredStatus === st.id
                                    ? 'border-[#A855F7] bg-[#7C3AED]/15 text-[#7C3AED] dark:text-[#C084FC]'
                                    : 'border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A] text-slate-600 dark:text-[#A1A1B5]'
                                }`}
                              >
                                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} />
                                <span className="truncate">{st.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Özel Durum Mesajı</label>
                          <input
                            type="text"
                            value={customStatus}
                            onChange={(e) => setCustomStatus(e.target.value)}
                            placeholder="Şu an ne yapıyorsunuz?"
                            className="w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Etkinlik Türü</label>
                            <select
                              value={activityType}
                              onChange={(e) => setActivityType(e.target.value as ActivityTypeKey)}
                              className="w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm"
                            >
                              {(Object.keys(ACTIVITY_LABELS) as ActivityTypeKey[]).map((k) => (
                                <option key={k || 'none'} value={k}>
                                  {ACTIVITY_LABELS[k]}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="sm:col-span-2 space-y-1">
                            <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Etkinlik Açıklaması</label>
                            <input
                              type="text"
                              maxLength={80}
                              disabled={!activityType}
                              value={activityText}
                              onChange={(e) => setActivityText(e.target.value)}
                              placeholder={activityType ? 'ör. TypeScript & WebRTC...' : 'Önce etkinlik türü seçin'}
                              className="w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm disabled:opacity-50"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-end">
                      <button
                        type="submit"
                        disabled={saving}
                        className="h-10 px-6 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 text-white text-sm font-semibold shadow-sm shadow-[#7C3AED]/25 transition-colors"
                      >
                        {saving ? 'Kaydediliyor...' : 'Profili Kaydet'}
                      </button>
                    </div>
                  </motion.form>
                ) : (
                  <motion.div
                    key="danger"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className="rounded-2xl border border-[#EF4444]/30 p-4 space-y-4 bg-[#EF4444]/[0.04]"
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold text-[#EF4444]">Hesabı Kalıcı Olarak Sil</p>
                        <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                          Tüm mesajlarınız, sunucu üyelikleriniz ve profil verileriniz kalıcı olarak kaldırılır. Bu işlem geri alınamaz.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteOpen(!deleteOpen);
                          setDeletePassError('');
                        }}
                        className="h-9 px-3.5 rounded-xl border border-[#EF4444]/40 text-[#EF4444] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#EF4444]/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {deleteOpen ? 'Vazgeç' : 'Hesabı Sil'}
                      </button>
                    </div>

                    {deleteOpen && (
                      <form noValidate onSubmit={handleDeleteAccount} className="space-y-2 pt-2 border-t border-[#EF4444]/20">
                        {profile.hasPassword === false ? (
                          <div className="space-y-1.5">
                            <p className="text-xs text-slate-600 dark:text-[#A1A1B5]">
                              Google ile oturum açtığınız için onay olarak <strong className="font-mono text-[#EF4444]">HESABI SIL</strong> yazın:
                            </p>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={deleteConfirmText}
                                onChange={(e) => {
                                  setDeleteConfirmText(e.target.value);
                                  if (deletePassError) setDeletePassError('');
                                }}
                                placeholder="HESABI SIL"
                                className={`flex-1 h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-xs font-mono ${
                                  deletePassError ? 'border-[#EF4444]' : 'border-[#EF4444]/40'
                                }`}
                              />
                              <button
                                type="submit"
                                className="h-9 px-4 rounded-xl bg-[#EF4444] hover:bg-red-600 text-white text-xs font-semibold flex items-center gap-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Kalıcı Sil
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <input
                              type="password"
                              value={deletePassword}
                              onChange={(e) => {
                                setDeletePassword(e.target.value);
                                if (deletePassError) setDeletePassError('');
                              }}
                              placeholder="Onaylamak için şifrenizi girin"
                              className={`flex-1 h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-xs ${
                                deletePassError ? 'border-[#EF4444]' : 'border-[#EF4444]/40'
                              }`}
                            />
                            <button
                              type="submit"
                              className="h-9 px-4 rounded-xl bg-[#EF4444] hover:bg-red-600 text-white text-xs font-semibold flex items-center gap-1"
                            >
                              <Key className="w-3.5 h-3.5" />
                              Onayla
                            </button>
                          </div>
                        )}
                        {deletePassError && (
                          <p role="alert" className="text-[11px] font-medium text-[#EF4444]">
                            {deletePassError}
                          </p>
                        )}
                      </form>
                    )}
                  </motion.div>
                )}
              </div>
            )}

            {tab === 'appearance' && (
              <div className="space-y-5 max-w-lg">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500 dark:text-[#A1A1B5]">Tema</label>
                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      {
                        id: 'dark',
                        label: 'Koyu',
                        icon: Moon,
                        swatch: 'bg-[#0F101B] border-[#2C2D46]',
                        barTop: 'bg-[#7C3AED]',
                        barSub: 'bg-slate-600/60',
                      },
                      {
                        id: 'light',
                        label: 'Açık',
                        icon: Sun,
                        swatch: 'bg-[#F8FAFC] border-slate-200',
                        barTop: 'bg-[#7C3AED]',
                        barSub: 'bg-slate-300',
                      },
                      {
                        id: 'system',
                        label: 'Sistem',
                        icon: Monitor,
                        swatch: 'bg-gradient-to-br from-[#0F101B] via-[#1C1E33] to-[#F8FAFC] border-cyan-500/40',
                        barTop: 'bg-cyan-500',
                        barSub: 'bg-slate-400/60',
                      },
                    ].map((opt) => {
                      const ThemeIcon = opt.icon;
                      const selected = settings.theme === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => void patchSettings({ theme: opt.id as UserSettings['theme'] })}
                          className={`p-2.5 rounded-2xl border text-left transition-all ${
                            selected
                              ? 'border-[#A855F7] bg-[#7C3AED]/10 text-[#7C3AED] dark:text-[#C084FC] ring-2 ring-[#A855F7]/20'
                              : 'border-slate-200 dark:border-[#29293D] hover:bg-slate-50 dark:hover:bg-[#19192A]'
                          }`}
                        >
                          <div className={`h-10 rounded-xl border p-2 mb-2 flex flex-col justify-between ${opt.swatch}`}>
                            <div className={`w-6 h-1.5 rounded-full ${opt.barTop}`} />
                            <div className={`w-10 h-1.5 rounded-full ${opt.barSub}`} />
                          </div>
                          <span className="text-xs font-semibold inline-flex items-center gap-1.5">
                            <ThemeIcon className="w-3.5 h-3.5" />
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500 dark:text-[#A1A1B5]">Yazı Boyutu</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'sm', label: 'Küçük' },
                      { id: 'md', label: 'Normal' },
                      { id: 'lg', label: 'Büyük' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => void patchSettings({ fontSize: opt.id as UserSettings['fontSize'] })}
                        className={`h-10 rounded-xl border text-xs font-semibold ${
                          settings.fontSize === opt.id
                            ? 'border-[#A855F7] bg-[#7C3AED]/15 text-[#7C3AED] dark:text-[#C084FC]'
                            : 'border-slate-200 dark:border-[#29293D]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500 dark:text-[#A1A1B5]">Mesaj Yoğunluğu</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'cozy', label: 'Rahat (Varsayılan)' },
                      { id: 'compact', label: 'Sıkışık' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => void patchSettings({ messageDensity: opt.id as UserSettings['messageDensity'] })}
                        className={`h-10 rounded-xl border text-xs font-semibold ${
                          settings.messageDensity === opt.id
                            ? 'border-[#A855F7] bg-[#7C3AED]/15 text-[#7C3AED] dark:text-[#C084FC]'
                            : 'border-slate-200 dark:border-[#29293D]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'voice' && (
              <div className="space-y-5 max-w-lg">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500 dark:text-[#A1A1B5] flex items-center gap-1.5">
                    <Mic className="w-3.5 h-3.5 text-[#A855F7]" /> Giriş Cihazı (Mikrofon)
                  </label>
                  <select
                    value={voice.selectedAudioDevice}
                    onChange={(e) => void voice.changeAudioDevice(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm"
                  >
                    {voice.audioInputs.length === 0 ? (
                      <option value="">Varsayılan Mikrofon</option>
                    ) : (
                      voice.audioInputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Mikrofon (${d.deviceId.slice(0, 6)})`}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500 dark:text-[#A1A1B5] flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-[#22C55E]" /> Çıkış Cihazı (Hoparlör / Kulaklık)
                  </label>
                  <select
                    value={voice.selectedAudioOutput}
                    onChange={(e) => voice.changeAudioOutput(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm"
                  >
                    {voice.audioOutputs.length === 0 ? (
                      <option value="">Sistem Varsayılan Çıkışı</option>
                    ) : (
                      voice.audioOutputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Hoparlör (${d.deviceId.slice(0, 6)})`}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] cursor-pointer">
                  <div>
                    <p className="text-sm font-medium">Gürültü Engelleme & Yankı İptali</p>
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                      Arka plan klavye ve ortam gürültüsünü filtreler.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={voice.noiseSuppression}
                    onChange={() => void voice.toggleNoiseSuppression()}
                  />
                </label>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-[#29293D] space-y-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <Keyboard className="w-4 h-4 text-[#A855F7]" />
                        Bas-Konuş (Push-to-Talk) Modu
                      </p>
                      <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                        Aktif olduğunda yalnızca seçili tuşa basılı tuttuğunuzda sesiniz iletilir.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={voice.pttEnabled}
                      onChange={(e) => voice.setPttEnabled(e.target.checked)}
                    />
                  </label>
                  {voice.pttEnabled && (
                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-[#29293D]">
                      <span className="text-xs text-slate-500 dark:text-[#A1A1B5]">Bas-Konuş Tuşu</span>
                      <select
                        value={voice.pttKey}
                        onChange={(e) => voice.setPttKey(e.target.value as PttKeyOption)}
                        className="h-9 px-3 rounded-lg bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs font-mono"
                      >
                        <option value="Space">Space (Boşluk)</option>
                        <option value="KeyV">V Tuşu</option>
                        <option value="AltLeft">Sol Alt Tuşu</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50/70 dark:bg-[#10111B] space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Mikrofon Giriş Testi</p>
                      <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                        Sesinizin karşıya ulaşıp ulaşmadığını canlı ölçümle doğrulayın.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggleMicTest()}
                      className={`h-9 px-3.5 rounded-xl text-xs font-semibold shrink-0 ${
                        micTesting ? 'bg-[#EF4444] text-white' : 'bg-[#7C3AED] hover:bg-[#6D28D9] text-white'
                      }`}
                    >
                      {micTesting ? 'Testi Durdur' : 'Mikrofonu Test Et'}
                    </button>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-200 dark:bg-[#0B0B12] overflow-hidden">
                    <div className="h-full bg-[#22C55E] transition-all duration-75" style={{ width: `${micLevel}%` }} />
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] text-xs space-y-1">
                  <p className="font-semibold text-slate-700 dark:text-[#F8FAFC]">WebRTC Ağ / TURN Durumu</p>
                  <p className="text-slate-500 dark:text-[#A1A1B5]">
                    {turnConfigured === null
                      ? 'Kontrol ediliyor...'
                      : turnConfigured
                      ? 'STUN ve özel TURN aktarıcısı yapılandırılmış (kısıtlı NAT ağlarında tam geçiş aktif).'
                      : 'Genel STUN etkin; sıkı kurumsal/mobil NAT arkasındaki görüşmeler için sunucuda TURN_URL tanımlanabilir.'}
                  </p>
                </div>
              </div>
            )}

            {tab === 'security' && (
              <div className="space-y-6 max-w-xl">
                {/* 2FA (İki Adımlı Doğrulama) */}
                <div className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50/70 dark:bg-[#10111B] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className={`w-4 h-4 ${profile.twoFactorEnabled ? 'text-[#22C55E]' : 'text-[#A855F7]'}`} />
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#F8FAFC]">
                          İki Adımlı Doğrulama (2FA / Authenticator)
                        </h4>
                        <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">
                          {profile.twoFactorEnabled
                            ? 'Hesabınız TOTP 6 haneli doğrulama ile korunuyor.'
                            : 'Google Authenticator, 1Password veya Authy ile ek giriş güvenliği ekleyin.'}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                        profile.twoFactorEnabled
                          ? 'bg-[#22C55E]/15 text-[#22C55E]'
                          : 'bg-slate-200 dark:bg-[#19192A] text-slate-500 dark:text-[#A1A1B5]'
                      }`}
                    >
                      {profile.twoFactorEnabled ? 'Aktif' : 'Kapalı'}
                    </span>
                  </div>

                  {!profile.twoFactorEnabled && !twoFactorSetup && (
                    <button
                      type="button"
                      disabled={twoFactorBusy}
                      onClick={() => void handleStart2FASetup()}
                      className="h-9 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      2FA Kurulumunu Başlat
                    </button>
                  )}

                  {twoFactorSetup && (
                    <form noValidate onSubmit={handleEnable2FA} className="space-y-3 pt-2 border-t border-slate-200 dark:border-[#29293D]">
                      <div className="p-3 rounded-xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] space-y-2 text-xs">
                        <p className="text-slate-500 dark:text-[#A1A1B5]">
                          1. Doğrulayıcı uygulamanıza aşağıdaki gizli anahtarı manuel ekleyin:
                        </p>
                        <div className="flex items-center justify-between gap-2 bg-slate-100 dark:bg-[#19192A] px-2.5 py-1.5 rounded-lg">
                          <code className="font-mono text-[#C084FC] select-all break-all">{twoFactorSetup.secret}</code>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard?.writeText(twoFactorSetup.secret);
                              showToast('2FA gizli anahtarı kopyalandı.', 'success');
                            }}
                            className="p-1 text-slate-400 hover:text-white shrink-0"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(twoFactorSetup.otpauthUri);
                            showToast('otpauth:// bağlantısı kopyalandı.', 'info');
                          }}
                          className="text-[11px] text-[#C084FC] hover:underline"
                        >
                          otpauth:// bağlantısını kopyala
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            maxLength={8}
                            value={twoFactorCodeInput}
                            onChange={(e) => {
                              setTwoFactorCodeInput(e.target.value);
                              if (twoFaEnableError) setTwoFaEnableError('');
                            }}
                            placeholder="6 haneli doğrulama kodu"
                            className={`flex-1 h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-sm font-mono tracking-widest ${
                              twoFaEnableError ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                            }`}
                          />
                          <button
                            type="submit"
                            disabled={twoFactorBusy}
                            className="h-9 px-4 rounded-xl bg-[#22C55E] hover:bg-emerald-600 text-white text-xs font-semibold"
                          >
                            Onayla
                          </button>
                          <button
                            type="button"
                            onClick={() => setTwoFactorSetup(null)}
                            className="h-9 px-3 rounded-xl border border-slate-200 dark:border-[#29293D] text-xs"
                          >
                            İptal
                          </button>
                        </div>
                        {twoFaEnableError && (
                          <p role="alert" className="text-[11px] font-medium text-[#EF4444]">
                            {twoFaEnableError}
                          </p>
                        )}
                      </div>
                    </form>
                  )}

                  {backupCodes && backupCodes.length > 0 && (
                    <div className="p-3 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 space-y-2 text-xs">
                      <p className="font-bold text-[#F59E0B]">Tek Kullanımlık Yedek Kurtarma Kodlarınız:</p>
                      <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">
                        Telefonunuza erişemezseniz giriş yapmak için bunları güvenli bir yerde saklayın.
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 font-mono text-[11px]">
                        {backupCodes.map((c) => (
                          <span key={c} className="px-2 py-1 rounded bg-black/30 text-center select-all">
                            {c}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(backupCodes.join('\n'));
                          showToast('Kurtarma kodları kopyalandı.', 'success');
                        }}
                        className="text-[11px] text-[#F59E0B] hover:underline inline-flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" /> Tüm Kodları Kopyala
                      </button>
                    </div>
                  )}

                  {profile.twoFactorEnabled && (
                    <form noValidate onSubmit={handleDisable2FA} className="pt-2 border-t border-slate-200 dark:border-[#29293D] space-y-2">
                      <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">2FA&apos;yı kapatmak için şifreniz ve güncel 2FA kodunu girin:</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-start">
                        <div className="space-y-1">
                          <input
                            type="password"
                            value={twoFactorDisablePass}
                            onChange={(e) => {
                              setTwoFactorDisablePass(e.target.value);
                              if (twoFaDisableErrors.password) setTwoFaDisableErrors((p) => ({ ...p, password: undefined }));
                            }}
                            placeholder="Mevcut şifreniz"
                            className={`w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-xs ${
                              twoFaDisableErrors.password ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                            }`}
                          />
                          {twoFaDisableErrors.password && (
                            <p role="alert" className="text-[11px] font-medium text-[#EF4444]">
                              {twoFaDisableErrors.password}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={twoFactorDisableCode}
                            onChange={(e) => {
                              setTwoFactorDisableCode(e.target.value);
                              if (twoFaDisableErrors.code) setTwoFaDisableErrors((p) => ({ ...p, code: undefined }));
                            }}
                            placeholder="6 haneli kod / yedek kod"
                            className={`w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-xs font-mono ${
                              twoFaDisableErrors.code ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                            }`}
                          />
                          {twoFaDisableErrors.code && (
                            <p role="alert" className="text-[11px] font-medium text-[#EF4444]">
                              {twoFaDisableErrors.code}
                            </p>
                          )}
                        </div>
                        <button
                          type="submit"
                          disabled={twoFactorBusy}
                          className="h-9 px-3 rounded-xl border border-[#EF4444]/40 text-[#EF4444] hover:bg-[#EF4444]/10 text-xs font-semibold"
                        >
                          2FA Kapat
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* E-posta Değiştir */}
                <div className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50/70 dark:bg-[#10111B] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5] flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-[#A855F7]" />
                      E-posta Adresini Değiştir
                    </h4>
                    <span className="text-[11px] font-mono text-slate-500 dark:text-[#A1A1B5] truncate max-w-[200px]">{profile.email}</span>
                  </div>
                  {emailChangeStep === 'idle' ? (
                    <form noValidate onSubmit={handleRequestEmailChange} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-start">
                      <div className="space-y-1">
                        <input
                          type="email"
                          value={newEmailInput}
                          onChange={(e) => {
                            setNewEmailInput(e.target.value);
                            if (emailReqErrors.email) setEmailReqErrors((p) => ({ ...p, email: undefined }));
                          }}
                          placeholder="Yeni e-posta adresi"
                          className={`w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-xs ${
                            emailReqErrors.email ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                          }`}
                        />
                        {emailReqErrors.email && (
                          <p role="alert" className="text-[11px] font-medium text-[#EF4444]">
                            {emailReqErrors.email}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <input
                          type="password"
                          value={emailChangePass}
                          onChange={(e) => {
                            setEmailChangePass(e.target.value);
                            if (emailReqErrors.password) setEmailReqErrors((p) => ({ ...p, password: undefined }));
                          }}
                          placeholder="Mevcut şifreniz"
                          className={`w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-xs ${
                            emailReqErrors.password ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                          }`}
                        />
                        {emailReqErrors.password && (
                          <p role="alert" className="text-[11px] font-medium text-[#EF4444]">
                            {emailReqErrors.password}
                          </p>
                        )}
                      </div>
                      <button
                        type="submit"
                        disabled={emailChangeBusy}
                        className="h-9 px-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold"
                      >
                        Doğrulama Kodu Gönder
                      </button>
                    </form>
                  ) : (
                    <form noValidate onSubmit={handleConfirmEmailChange} className="space-y-1.5">
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          value={emailChangeConfirmToken}
                          onChange={(e) => {
                            setEmailChangeConfirmToken(e.target.value);
                            if (emailConfirmError) setEmailConfirmError('');
                          }}
                          placeholder="Onay kodunu girin"
                          className={`flex-1 min-w-[160px] h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-xs font-mono ${
                            emailConfirmError ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                          }`}
                        />
                        <button
                          type="submit"
                          disabled={emailChangeBusy}
                          className="h-9 px-4 rounded-xl bg-[#22C55E] hover:bg-emerald-600 text-white text-xs font-semibold"
                        >
                          E-postayı Güncelle
                        </button>
                        <button
                          type="button"
                          onClick={() => setEmailChangeStep('idle')}
                          className="h-9 px-3 rounded-xl border border-slate-200 dark:border-[#29293D] text-xs"
                        >
                          İptal
                        </button>
                      </div>
                      {emailConfirmError && (
                        <p role="alert" className="text-[11px] font-medium text-[#EF4444]">
                          {emailConfirmError}
                        </p>
                      )}
                    </form>
                  )}
                </div>

                <form
                  noValidate
                  onSubmit={handleChangePassword}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50/70 dark:bg-[#10111B] space-y-3"
                >
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                      {profile.hasPassword === false ? 'Hesap Şifresi Oluştur (Google Hesabı)' : 'Şifre Değiştir'}
                    </h4>
                    {profile.hasPassword === false && (
                      <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] mt-0.5">
                        Google ile kayıt olduğunuz için henüz şifreniz yok. Buradan belirleyerek e-posta değişikliği ve klasik girişte kullanabilirsiniz.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    {profile.hasPassword !== false && (
                      <div className="space-y-1">
                        <input
                          type="password"
                          value={currentPassword}
                          onChange={(e) => {
                            setCurrentPassword(e.target.value);
                            if (passwordErrors.current) setPasswordErrors((p) => ({ ...p, current: undefined }));
                          }}
                          placeholder="Mevcut şifreniz"
                          className={`w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-sm ${
                            passwordErrors.current ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                          }`}
                        />
                        {passwordErrors.current && (
                          <p role="alert" className="text-[11px] font-medium text-[#EF4444]">
                            {passwordErrors.current}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => {
                            setNewPassword(e.target.value);
                            if (passwordErrors.next) setPasswordErrors((p) => ({ ...p, next: undefined }));
                          }}
                          placeholder="Yeni şifre (en az 8 karakter)"
                          className={`w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-sm ${
                            passwordErrors.next ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                          }`}
                        />
                        {passwordErrors.next && (
                          <p role="alert" className="text-[11px] font-medium text-[#EF4444]">
                            {passwordErrors.next}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            if (passwordErrors.confirm) setPasswordErrors((p) => ({ ...p, confirm: undefined }));
                          }}
                          placeholder="Yeni şifre (tekrar)"
                          className={`w-full h-9 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-sm ${
                            passwordErrors.confirm ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                          }`}
                        />
                        {passwordErrors.confirm && (
                          <p role="alert" className="text-[11px] font-medium text-[#EF4444]">
                            {passwordErrors.confirm}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                    <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-[#A1A1B5] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={revokeOthersOnPass}
                        onChange={(e) => setRevokeOthersOnPass(e.target.checked)}
                      />
                      Diğer açık oturumları kapat
                    </label>
                    <button
                      type="submit"
                      disabled={changingPassword}
                      className="h-9 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold disabled:opacity-50"
                    >
                      {changingPassword ? 'Güncelleniyor...' : 'Şifreyi Güncelle'}
                    </button>
                  </div>
                </form>

                {/* Veri Dışa Aktarma */}
                <div className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50/70 dark:bg-[#10111B] flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                      Verilerimi İndir (JSON)
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] mt-0.5">
                      Profilinizi, rozetlerinizi, seri istatistiklerinizi ve son mesajlarınızı yedekleyin.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={exportingData}
                    onClick={() => void handleExportAccountData()}
                    className="h-9 px-4 rounded-xl border border-slate-200 dark:border-[#29293D] hover:bg-slate-200/60 dark:hover:bg-[#222238] text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {exportingData ? 'Hazırlanıyor...' : 'Verileri İndir'}
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold">Aktif Oturumlar ({sessions.length})</h4>
                      <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                        Hesabınıza bağlı geçerli cihaz ve tarayıcı oturumları.
                      </p>
                    </div>
                    {sessions.filter((s) => !s.isCurrent).length > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch('/auth/sessions', { method: 'DELETE' });
                          setSessions((prev) => prev.filter((s) => s.isCurrent));
                          showToast('Diğer tüm oturumlar kapatıldı.', 'success');
                        }}
                        className="h-8 px-3 rounded-xl border border-[#EF4444]/40 text-[#EF4444] hover:bg-[#EF4444]/10 text-xs font-semibold"
                      >
                        Diğerlerini Kapat
                      </button>
                    )}
                  </div>

                  {sessionsLoading ? (
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Oturumlar yükleniyor...</p>
                  ) : (
                    <div className="space-y-2">
                      {sessions.map((s) => (
                        <div
                          key={s.id}
                          className="p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/50 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Laptop className="w-4 h-4 text-[#A855F7] shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold flex items-center gap-2">
                                <span className="truncate">{summarizeUserAgent(s.userAgent)}</span>
                                {s.isCurrent && (
                                  <span className="text-[10px] font-mono text-[#22C55E]">
                                    · Bu Cihaz
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] font-mono text-slate-500 dark:text-[#A1A1B5] tabular-nums">
                                Açılış: {formatSessionDate(s.createdAt)}
                              </p>
                            </div>
                          </div>
                          {!s.isCurrent && (
                            <button
                              type="button"
                              onClick={async () => {
                                await apiFetch(`/auth/sessions/${s.id}`, { method: 'DELETE' });
                                setSessions((prev) => prev.filter((x) => x.id !== s.id));
                                showToast('Oturum sonlandırıldı.', 'info');
                              }}
                              className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-[#29293D] text-xs text-[#EF4444] hover:bg-[#EF4444]/10 shrink-0"
                            >
                              Sonlandır
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'notifications' && (
              <div className="space-y-3 max-w-lg">
                <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium">Uygulama İçi Bildirimler</p>
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                      Bahsetmeler, yanıtlar ve özel mesajlar için bildirim kutusu.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.inAppNotifications}
                    onChange={(e) => void patchSettings({ inAppNotifications: e.target.checked })}
                  />
                </label>

                <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium">Bildirim Sesleri</p>
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Yeni bildirimlerde sesli uyarı çal.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.soundEnabled}
                    onChange={(e) => void patchSettings({ soundEnabled: e.target.checked })}
                  />
                </label>

                <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium">Rahatsız Etmeyin Modu</p>
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Tüm bildirimleri geçici olarak susturur.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.dndMode}
                    onChange={(e) => void patchSettings({ dndMode: e.target.checked })}
                  />
                </label>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Tarayıcı Push Bildirimleri</p>
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                      {!pushSupported
                        ? 'Tarayıcınız Web Push desteklemiyor.'
                        : !pushVapidConfigured
                        ? 'VAPID anahtarları yapılandırılmadı (uygulama içi bildirimler aktiftir).'
                        : 'Arka plan bildirimleri etkinleştirilebilir.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleEnablePush()}
                    className="h-9 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold shrink-0 transition-colors"
                  >
                    İzin İste
                  </button>
                </div>
              </div>
            )}

            {tab === 'privacy' && (
              <div className="space-y-5 max-w-lg">
                <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium">Çevrimiçi Durumumu Göster</p>
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                      Kapatıldığında diğer kullanıcılara çevrimdışı görünürsünüz.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.showOnlineStatus}
                    onChange={(e) => void patchSettings({ showOnlineStatus: e.target.checked })}
                  />
                </label>

                <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium">Arkadaşlık İsteklerine İzin Ver</p>
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                      Diğer kullanıcıların size arkadaşlık isteği göndermesine izin verir.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.friendRequestsAllowed}
                    onChange={(e) => void patchSettings({ friendRequestsAllowed: e.target.checked })}
                  />
                </label>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500 dark:text-[#A1A1B5]">
                    Kimler Özel Mesaj Gönderebilir?
                  </label>
                  <select
                    value={settings.dmPermission}
                    onChange={(e) => void patchSettings({ dmPermission: e.target.value as UserSettings['dmPermission'] })}
                    className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm focus:border-[#A855F7] outline-none"
                  >
                    <option value="everyone">Herkes</option>
                    <option value="server_members">Yalnızca Ortak Sunucu Üyeleri</option>
                    <option value="friends">Yalnızca Arkadaşlarım</option>
                  </select>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-[#29293D]">
                  <p className="text-xs font-semibold text-slate-500 dark:text-[#A1A1B5]">
                    Engellenen Kullanıcılar ({blockedUsers.length})
                  </p>
                  {blockedUsers.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Engellediğiniz kimse bulunmuyor.</p>
                  ) : (
                    <div className="space-y-2">
                      {blockedUsers.map((bu) => (
                        <div
                          key={bu.userId}
                          className="p-2.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <UserAvatar src={bu.avatarUrl} name={bu.displayName} size="xs" showStatus={false} />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate">{bu.displayName}</p>
                              <p className="text-[11px] font-mono text-slate-500 dark:text-[#A1A1B5] truncate">
                                @{bu.username}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/blocks/${bu.userId}`, { method: 'DELETE' });
                              setBlockedUsers((prev) => prev.filter((u) => u.userId !== bu.userId));
                              showToast('Kullanıcının engeli kaldırıldı.', 'info');
                            }}
                            className="h-8 px-3 rounded-lg border border-slate-200 dark:border-[#29293D] text-xs hover:bg-slate-100 dark:hover:bg-[#222238] shrink-0 transition-colors"
                          >
                            Engeli Kaldır
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'accessibility' && (
              <div className="space-y-3 max-w-lg">
                <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium">Hareketi Azalt</p>
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Geçiş animasyonlarını ve görsel hareketleri en aza indirir.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.reducedMotion}
                    onChange={(e) => void patchSettings({ reducedMotion: e.target.checked })}
                  />
                </label>

                <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium">Klavye Erişim İpuçları</p>
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Odak göstergeleri ve kısayol ipuçlarını vurgular.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.keyboardNavHints}
                    onChange={(e) => void patchSettings({ keyboardNavHints: e.target.checked })}
                  />
                </label>
              </div>
            )}

            {tab === 'scheduled' && (
              <div className="space-y-6 max-w-2xl">
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                    Zamanlanmış Mesajlar ({scheduledList.length})
                  </h4>
                  {scheduledList.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5] p-4 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] text-center">
                      Henüz zamanlanmış bir mesaj yok. Mesaj yazma alanındaki saat simgesiyle mesaj zamanlayabilirsiniz.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {scheduledList.map((item) => (
                        <div
                          key={item.id}
                          className="p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] flex items-start justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0 space-y-1">
                            <p className="font-semibold flex items-center gap-2">
                              <Clock className="w-3.5 h-3.5 text-[#A855F7] shrink-0" />
                              <span>{item.channelName ? `#${item.channelName}` : 'Özel Sohbet'}</span>
                              <span className="font-mono text-[10px] text-slate-500 dark:text-[#A1A1B5] tabular-nums">
                                · {formatSessionDate(item.sendAt)}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  item.status === 'sent'
                                    ? 'bg-[#22C55E]/15 text-[#22C55E]'
                                    : item.status === 'failed'
                                    ? 'bg-[#EF4444]/15 text-[#EF4444]'
                                    : 'bg-[#7C3AED]/15 text-[#C084FC]'
                                }`}
                              >
                                {item.status === 'sent' ? 'Gönderildi' : item.status === 'failed' ? 'Hata' : 'Bekliyor'}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-[#F8FAFC] break-words">{item.content}</p>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/scheduled-messages/${item.id}`, { method: 'DELETE' });
                              setScheduledList((prev) => prev.filter((x) => x.id !== item.id));
                              showToast('Zamanlanmış mesaj silindi.', 'info');
                            }}
                            className="p-1.5 rounded-lg text-[#EF4444] hover:bg-[#EF4444]/15 shrink-0 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-[#29293D]">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                    Kişisel Hatırlatıcılar ({remindersList.length})
                  </h4>

                  <form noValidate onSubmit={handleAddReminder} className="space-y-1.5">
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={newRemNote}
                        onChange={(e) => {
                          setNewRemNote(e.target.value);
                          if (reminderError) setReminderError('');
                        }}
                        placeholder="Hatırlatma notu..."
                        aria-invalid={Boolean(reminderError)}
                        className={`flex-1 min-w-[180px] h-9 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border text-xs outline-none transition-colors ${
                          reminderError
                            ? 'border-[#EF4444] focus:border-[#EF4444]'
                            : 'border-slate-200 dark:border-[#29293D] focus:border-[#A855F7]'
                        }`}
                      />
                      <select
                        value={newRemMinutes}
                        onChange={(e) => setNewRemMinutes(e.target.value)}
                        className="h-9 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none"
                      >
                        <option value="5">5 dk sonra</option>
                        <option value="15">15 dk sonra</option>
                        <option value="60">1 saat sonra</option>
                        <option value="180">3 saat sonra</option>
                      </select>
                      <button
                        type="submit"
                        className="h-9 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Ekle
                      </button>
                    </div>
                    {reminderError && (
                      <p role="alert" className="text-xs text-[#EF4444]">
                        {reminderError}
                      </p>
                    )}
                  </form>

                  {remindersList.length > 0 && (
                    <div className="space-y-2">
                      {remindersList.map((rem) => (
                        <div
                          key={rem.id}
                          className="p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-medium truncate">{rem.note}</p>
                            <p className="text-[11px] font-mono text-slate-500 dark:text-[#A1A1B5] tabular-nums mt-0.5">
                              {formatSessionDate(rem.remindAt)} · {rem.notified ? 'Bildirildi' : 'Bekleniyor'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/reminders/${rem.id}`, { method: 'DELETE' });
                              setRemindersList((prev) => prev.filter((x) => x.id !== rem.id));
                            }}
                            className="p-1.5 rounded-lg text-[#EF4444] hover:bg-[#EF4444]/15 shrink-0 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'install' && (
              <div className="space-y-4 max-w-lg">
                <div className="p-5 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#7C3AED]/20 border border-[#A855F7]/30 flex items-center justify-center text-[#C084FC]">
                      <Smartphone className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold font-display">ORBIT Mobil & Masaüstü Uygulaması</h4>
                      <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                        Tarayıcı çubukları olmadan tam ekran, hızlı ve çevrimdışı önbellek destekli deneyim.
                      </p>
                    </div>
                  </div>

                  {pwa.isInstalled ? (
                    <div className="p-3 rounded-xl bg-[#22C55E]/15 border border-[#22C55E]/30 text-xs text-[#22C55E] font-medium flex items-center gap-2">
                      <Check className="w-4 h-4 shrink-0" />
                      ORBIT bu cihazda uygulama (PWA) modunda çalışıyor.
                    </div>
                  ) : pwa.canInstall ? (
                    <button
                      type="button"
                      onClick={() => void pwa.promptInstall()}
                      className="w-full h-10 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Cihazıma Uygulama Olarak Kur
                    </button>
                  ) : pwa.isIOS ? (
                    <div className="p-3.5 rounded-xl bg-[#7C3AED]/10 border border-[#A855F7]/25 text-xs space-y-2 text-slate-600 dark:text-[#F8FAFC]">
                      <p className="font-semibold text-[#C084FC]">iPhone / iPad Kurulum Adımları:</p>
                      <ol className="list-decimal pl-4 space-y-1">
                        <li>
                          Safari&apos;de <Share className="w-3.5 h-3.5 inline text-[#A855F7]" /> <strong>Paylaş</strong>{' '}
                          butonuna basın.
                        </li>
                        <li>
                          <strong>&quot;Ana Ekrana Ekle&quot;</strong> seçeneğine dokunun ve onaylayın.
                        </li>
                      </ol>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                      Tarayıcınızın adres çubuğundaki &quot;Yükle / Uygulama Ekle&quot; simgesinden ORBIT&apos;i
                      kurabilirsiniz.
                    </p>
                  )}
                </div>
              </div>
            )}

            {(tab === 'about' || tab === 'guide' || tab === 'terms' || tab === 'policies') && (
              <OrbitDocsSection
                tab={tab}
                onNavigateTab={(target) => selectCategoryTab(target)}
                onOpenNitro={onOpenNitro}
                onOpenBadges={onOpenBadges}
                onOpenAchievements={onOpenAchievements}
                onExportData={() => void handleExportAccountData()}
                exportingData={exportingData}
                onCloseModal={onClose}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
