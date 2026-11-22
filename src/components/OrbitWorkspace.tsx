import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Archive,
  Award,
  Bell,
  ChevronDown,
  ChevronRight,
  Command,
  Compass,
  Crown,
  Flame,
  Hash,
  Headphones,
  FolderKanban,
  Home,
  Link2,
  Lock,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  MessageSquareText,
  Mic,
  MicOff,
  Moon,
  Phone,
  PhoneOff,
  Pin,
  Plus,
  Radio,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Signal,
  Star,
  Sun,
  User,
  Users,
  Video,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { apiFetch, ApiError, resolveMediaUrl } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { useToast } from '../client/ToastContext.tsx';
import { formatIsoElapsed, formatVoiceDuration, useVoice } from '../client/VoiceContext.tsx';
import { playNotificationSound } from '../client/soundEffects.ts';
import { wsClient, type WsConnectionState } from '../client/wsClient.ts';
import type { ActivityTypeKey, AvatarFrameKey, BadgeKey, BannerPresetKey, OrbitBadge, ProfileEffectKey } from '../shared/badges.ts';
import type { Permission } from '../shared/permissions.ts';
import { SERVER_TEMPLATES, type ServerTemplateId } from '../shared/templates.ts';
import type {
  Channel,
  ChatMessage,
  DirectConversation,
  NitroTier,
  NotificationItem,
  OnboardingState,
  Role,
  ServerEmoji,
  ServerMember,
  ServerSummary,
  UserProfile,
  UserSettings,
  VoiceParticipant,
} from '../shared/types.ts';
import { AchievementsModal } from './AchievementsModal.tsx';
import { EmailVerificationBanner } from './AuthPages.tsx';
import { BadgeCatalogModal } from './BadgeCatalogModal.tsx';
import { FeaturedBadgeIcon } from './BadgeStrip.tsx';
import { BotBadge, FlameStreakBadge, NitroBadge } from './BotBadge.tsx';
import { CommandPaletteModal } from './CommandPaletteModal.tsx';
import { ForwardMessageModal } from './ForwardMessageModal.tsx';
import { ForumView } from './ForumView.tsx';
import { DiscoverServersView, FriendsView } from './FriendsAndDiscoverView.tsx';
import { GroupDmModal } from './GroupDmModal.tsx';
import { MessageTimeline } from './MessageTimeline.tsx';
import { NitroModal } from './NitroModal.tsx';
import { OnboardingModal } from './OnboardingModal.tsx';
import { OrbitLogo } from './OrbitLogo.tsx';
import { OfflineIndicator, PWAInstallButton } from './PWAInstallBanner.tsx';
import { SearchModal } from './SearchModal.tsx';
import { ServerSettingsModal, type ServerSettingsTabId } from './ServerSettingsModal.tsx';
import { SettingsModal } from './SettingsModal.tsx';
import { ThreadDrawer } from './ThreadDrawer.tsx';
import { getStatusLabel, UserAvatar } from './UserAvatar.tsx';
import { UserProfileModal } from './UserProfileModal.tsx';
import { VoiceStageView } from './VoiceStageView.tsx';

export function OrbitWorkspace({ viewMode }: { viewMode: 'home' | 'server' | 'discover' }) {
  const { serverId, channelId, conversationId } = useParams();
  const navigate = useNavigate();
  const { profile: me, settings, updateProfileState, updateSettingsState, logout } = useAuth();
  const { showToast } = useToast();
  const voice = useVoice();

  const [wsState, setWsState] = useState<WsConnectionState>(wsClient.getState());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [showMembersDrawer, setShowMembersDrawer] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [showPinsDrawer, setShowPinsDrawer] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);

  // Core Data
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [showArchivedDms, setShowArchivedDms] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  // Active Server Detail
  const [activeServer, setActiveServer] = useState<ServerSummary | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [bans, setBans] = useState<Array<{ userId: string; reason: string; profile: { displayName: string; username: string } | null }>>([]);
  const [myPermissions, setMyPermissions] = useState<Permission[]>([]);
  const [voiceParticipants, setVoiceParticipants] = useState<Record<string, VoiceParticipant[]>>({});
  const [serverEmojis, setServerEmojis] = useState<ServerEmoji[]>([]);
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [onboardingShownServers, setOnboardingShownServers] = useState<Record<string, boolean>>({});

  // Pro Feature Drawers & Modals
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [groupDmModalOpen, setGroupDmModalOpen] = useState(false);
  const [managingGroupConv, setManagingGroupConv] = useState<DirectConversation | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  // Modals
  const [createServerOpen, setCreateServerOpen] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newServerDesc, setNewServerDesc] = useState('');
  const [newServerPublic, setNewServerPublic] = useState(false);
  const [newServerTemplate, setNewServerTemplate] = useState<ServerTemplateId>('blank');
  const [createServerError, setCreateServerError] = useState('');

  const [quickChannelOpen, setQuickChannelOpen] = useState(false);
  const [quickChannelName, setQuickChannelName] = useState('');
  const [quickChannelTopic, setQuickChannelTopic] = useState('');
  const [quickChannelType, setQuickChannelType] = useState<'category' | 'text' | 'voice' | 'announcement' | 'forum'>('text');
  const [quickChannelParentId, setQuickChannelParentId] = useState('');
  const [quickChannelIsStage, setQuickChannelIsStage] = useState(false);
  const [quickChannelIsPrivate, setQuickChannelIsPrivate] = useState(false);
  const [quickChannelRoleIds, setQuickChannelRoleIds] = useState<string[]>([]);
  const [quickChannelError, setQuickChannelError] = useState('');

  const [mobileNotifSheetOpen, setMobileNotifSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [serverSettingsInitialTab, setServerSettingsInitialTab] = useState<ServerSettingsTabId | undefined>(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [badgeCatalogOpen, setBadgeCatalogOpen] = useState(false);
  const [achievementsModalOpen, setAchievementsModalOpen] = useState(false);
  const [nitroModalOpen, setNitroModalOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  // Direct 1-to-1 Call state
  const [activeDmCall, setActiveDmCall] = useState<{
    conversationId: string;
    peerName: string;
    participants: VoiceParticipant[];
    withVideo: boolean;
  } | null>(null);
  const [incomingCall, setIncomingCall] = useState<{
    conversationId: string;
    fromUserId: string;
    fromName: string;
    withVideo: boolean;
  } | null>(null);

  useEffect(() => {
    return wsClient.onStateChange(setWsState);
  }, []);

  // Global Ctrl+K / Cmd+K Command Palette shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadGlobalData = useCallback(async () => {
    try {
      const [srvRes, dmRes, notifRes] = await Promise.all([
        apiFetch<{ servers: ServerSummary[] }>('/servers'),
        apiFetch<{ conversations: DirectConversation[] }>(`/dm/conversations?archived=${showArchivedDms ? '1' : '0'}`),
        apiFetch<{ notifications: NotificationItem[] }>('/notifications'),
      ]);
      setServers(srvRes.servers);
      setConversations(dmRes.conversations);
      setNotifications(notifRes.notifications);
    } catch {
      // Handled by auth context
    }
  }, [showArchivedDms]);

  useEffect(() => {
    void loadGlobalData();
  }, [loadGlobalData]);

  // Verify Stripe Nitro Checkout return query (?nitro=success&session_id=... or ?nitro=cancelled)
  useEffect(() => {
    if (!me?.userId) return;
    const params = new URLSearchParams(window.location.search);
    const nitroParam = params.get('nitro');
    const sessionId = params.get('session_id');
    if (!nitroParam) return;

    const cleanUrl = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, '', cleanUrl);

    if (nitroParam === 'cancelled') {
      showToast('ORBIT Nitro ödeme işlemi iptal edildi.', 'info');
      return;
    }

    if (nitroParam === 'success' && sessionId) {
      apiFetch<{ ok: boolean; profile: UserProfile }>('/nitro/verify-session', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      })
        .then((res) => {
          if (res.profile) {
            updateProfileState(res.profile);
          }
          showToast('ORBIT Nitro aboneliğiniz aktifleştirildi!', 'success');
        })
        .catch((err) => {
          showToast(
            err instanceof ApiError ? err.message : 'Nitro ödeme doğrulaması tamamlanamadı.',
            'error'
          );
        });
    }
  }, [me?.userId, showToast, updateProfileState]);

  const loadServerDetail = useCallback(
    async (sid: string) => {
      try {
        const [res, emojiRes, onbRes] = await Promise.all([
          apiFetch<{
            server: ServerSummary;
            channels: Channel[];
            roles: Role[];
            members: ServerMember[];
            bans: typeof bans;
            myPermissions: Permission[];
            voiceParticipantsByChannel: Record<string, VoiceParticipant[]>;
          }>(`/servers/${sid}`),
          apiFetch<{ emojis: ServerEmoji[] }>(`/servers/${sid}/emojis`).catch(() => ({ emojis: [] })),
          apiFetch<{ onboarding: OnboardingState }>(`/servers/${sid}/onboarding`).catch(() => ({ onboarding: null })),
        ]);
        setActiveServer(res.server);
        setChannels(res.channels);
        setRoles(res.roles);
        setMembers(res.members);
        setBans(res.bans);
        setMyPermissions(res.myPermissions);
        setVoiceParticipants(res.voiceParticipantsByChannel || {});
        setServerEmojis(emojiRes.emojis);
        setOnboardingState(onbRes.onboarding);

        if (onbRes.onboarding?.enabled && !onbRes.onboarding.accepted && !onboardingShownServers[sid]) {
          setOnboardingShownServers((prev) => ({ ...prev, [sid]: true }));
          setOnboardingOpen(true);
        }

        if (!channelId) {
          const first = res.channels.find((c) => c.type !== 'category');
          if (first) {
            navigate(`/channels/${sid}/${first.id}`, { replace: true });
          }
        }
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Sunucu yüklenemedi.', 'error');
        navigate('/channels/@me');
      }
    },
    [channelId, navigate, onboardingShownServers, showToast]
  );

  useEffect(() => {
    if (viewMode === 'server' && serverId) {
      wsClient.subscribe(`server:${serverId}`);
      void loadServerDetail(serverId);
      return () => wsClient.unsubscribe(`server:${serverId}`);
    } else {
      setActiveServer(null);
      setChannels([]);
      setMembers([]);
      setServerEmojis([]);
      setOnboardingState(null);
      setActiveThreadId(null);
    }
  }, [viewMode, serverId, loadServerDetail]);

  // Clear unread indicator & close thread drawer when switching channels or conversations
  useEffect(() => {
    setActiveThreadId(null);
    if (channelId) {
      setChannels((prev) =>
        prev.map((c) => (c.id === channelId && c.unreadCount ? { ...c, unreadCount: 0 } : c))
      );
    }
    if (conversationId) {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId && c.unreadCount ? { ...c, unreadCount: 0 } : c))
      );
    }
  }, [channelId, conversationId]);

  // Listen to real-time global & server events
  useEffect(() => {
    const soundAllowed = Boolean(settings?.soundEnabled !== false && !settings?.dndMode);
    return wsClient.onEvent((ev) => {
      const p = ev.payload;
      if (ev.type === 'notification:new') {
        const item = p as unknown as NotificationItem;
        setNotifications((prev) => [item, ...prev]);
        showToast(`${item.title}: ${item.body}`, 'info');
        playNotificationSound(soundAllowed);
      } else if (ev.type === 'dm:conversation_updated') {
        void loadGlobalData();
      } else if (ev.type === 'presence:update') {
        const uid = String(p.userId);
        const patch: Partial<UserProfile> = {
          status: p.status as UserProfile['status'],
          isOnline: Boolean(p.isOnline),
          ...(p.customStatus !== undefined ? { customStatus: String(p.customStatus || '') } : {}),
          ...(p.displayName !== undefined ? { displayName: String(p.displayName) } : {}),
          ...(p.discriminator !== undefined ? { discriminator: String(p.discriminator) } : {}),
          ...(p.avatarUrl !== undefined ? { avatarUrl: (p.avatarUrl as string | null) ?? null } : {}),
          ...(p.bannerUrl !== undefined ? { bannerUrl: (p.bannerUrl as string | null) ?? null } : {}),
          ...(p.bannerPreset !== undefined ? { bannerPreset: p.bannerPreset as BannerPresetKey } : {}),
          ...(p.bannerColor !== undefined ? { bannerColor: String(p.bannerColor) } : {}),
          ...(p.avatarFrame !== undefined ? { avatarFrame: p.avatarFrame as AvatarFrameKey } : {}),
          ...(p.profileEffect !== undefined ? { profileEffect: p.profileEffect as ProfileEffectKey } : {}),
          ...(p.nitroTier !== undefined ? { nitroTier: p.nitroTier as NitroTier } : {}),
          ...(p.activityType !== undefined ? { activityType: p.activityType as ActivityTypeKey } : {}),
          ...(p.activityText !== undefined ? { activityText: String(p.activityText || '') } : {}),
          ...(p.featuredBadge !== undefined ? { featuredBadge: (p.featuredBadge as BadgeKey | null) ?? null } : {}),
          ...(Array.isArray(p.badges) ? { badges: p.badges as OrbitBadge[] } : {}),
        };
        setMembers((prev) =>
          prev.map((m) => (m.userId === uid ? { ...m, profile: { ...m.profile, ...patch } } : m))
        );
        setConversations((prev) =>
          prev.map((c) => ({
            ...c,
            members: c.members.map((m) => (m.userId === uid ? { ...m, ...patch } : m)),
          }))
        );
        if (me && uid === me.userId) {
          updateProfileState({ ...me, ...patch });
        }
      } else if (ev.type === 'server:updated' || ev.type === 'channel:updated' || ev.type === 'member:updated') {
        if (serverId && p.serverId === serverId) {
          void loadServerDetail(serverId);
        }
        void loadGlobalData();
      } else if (ev.type === 'server:kicked' || ev.type === 'server:deleted') {
        if (serverId && p.serverId === serverId) {
          navigate('/channels/@me');
        }
        void loadGlobalData();
      } else if (ev.type === 'message:new') {
        const msg = p.message as ChatMessage | undefined;
        const targetChId = String(p.channelId || '');
        const targetSrvId = String(p.serverId || '');
        if (msg && msg.authorId !== me?.userId && targetChId !== channelId) {
          setChannels((prev) =>
            prev.map((c) => (c.id === targetChId ? { ...c, unreadCount: (c.unreadCount || 0) + 1 } : c))
          );
          if (targetSrvId && targetSrvId !== serverId) {
            setServers((prev) =>
              prev.map((s) => (s.id === targetSrvId ? { ...s, unreadCount: (s.unreadCount || 0) + 1 } : s))
            );
          }
        }
      } else if (ev.type === 'dm:new') {
        const msg = p.message as ChatMessage | undefined;
        const targetConvId = String(p.conversationId || '');
        if (msg && msg.authorId !== me?.userId && targetConvId !== conversationId) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === targetConvId
                ? {
                    ...c,
                    unreadCount: (c.unreadCount || 0) + 1,
                    lastMessage: {
                      content: msg.content || 'Ek paylaşıldı',
                      authorName: msg.author.displayName,
                      createdAt: msg.createdAt,
                    },
                  }
                : c
            )
          );
          playNotificationSound(soundAllowed);
        }
      } else if (ev.type === 'voice:participants') {
        const chId = String(p.channelId);
        const list = p.participants as VoiceParticipant[];
        setVoiceParticipants((prev) => ({ ...prev, [chId]: list }));
      } else if (ev.type === 'call:invite') {
        const from = p.fromProfile as ServerMember['profile'];
        playNotificationSound(soundAllowed);
        setIncomingCall({
          conversationId: String(p.conversationId),
          fromUserId: String(p.fromUserId),
          fromName: from?.displayName || 'Kullanıcı',
          withVideo: Boolean(p.withVideo),
        });
      } else if (ev.type === 'call:end' || ev.type === 'call:reject') {
        setIncomingCall(null);
        setActiveDmCall((prev) => (prev?.conversationId === p.conversationId ? null : prev));
        if (ev.type === 'call:reject') showToast('Arama reddedildi.', 'info');
      }
    });
  }, [
    serverId,
    channelId,
    conversationId,
    me,
    settings?.soundEnabled,
    settings?.dndMode,
    updateProfileState,
    loadGlobalData,
    loadServerDetail,
    navigate,
    showToast,
  ]);

  const roleById = useMemo(() => {
    const map = new Map<string, Role>();
    for (const r of roles) map.set(r.id, r);
    return map;
  }, [roles]);

  const memberRoleColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) {
      const assigned = m.roleIds
        .map((rid) => roleById.get(rid))
        .filter((r): r is Role => Boolean(r && !r.isDefault))
        .sort((a, b) => b.position - a.position);
      const colored = assigned.find((r) => r.color && r.color !== '#64748B');
      if (colored) {
        map[m.userId] = colored.color;
      }
    }
    return map;
  }, [members, roleById]);

  const groupedMemberSections = useMemo(() => {
    const onlineRoleGroups = new Map<
      string,
      { id: string; title: string; icon?: string; color?: string; position: number; members: ServerMember[] }
    >();
    const onlineNoRole: ServerMember[] = [];
    const offlineMembers: ServerMember[] = [];

    for (const m of members) {
      if (m.profile.status === 'offline') {
        offlineMembers.push(m);
        continue;
      }
      const hoistedRole = m.roleIds
        .map((rid) => roleById.get(rid))
        .filter((r): r is Role => Boolean(r && !r.isDefault && r.hoist))
        .sort((a, b) => b.position - a.position)[0];

      if (hoistedRole) {
        const existing = onlineRoleGroups.get(hoistedRole.id);
        if (existing) {
          existing.members.push(m);
        } else {
          onlineRoleGroups.set(hoistedRole.id, {
            id: hoistedRole.id,
            title: hoistedRole.name,
            icon: hoistedRole.icon || undefined,
            color: hoistedRole.color,
            position: hoistedRole.position,
            members: [m],
          });
        }
      } else {
        onlineNoRole.push(m);
      }
    }

    const sections = Array.from(onlineRoleGroups.values()).sort((a, b) => b.position - a.position);
    if (onlineNoRole.length > 0) {
      sections.push({ id: '__online', title: 'Çevrimiçi', position: 0, members: onlineNoRole });
    }
    if (offlineMembers.length > 0) {
      sections.push({ id: '__offline', title: 'Çevrimdışı', position: -1, members: offlineMembers });
    }
    return sections;
  }, [members, roleById]);

  const handleToggleTheme = async () => {
    if (!settings) return;
    const nextTheme = settings.theme === 'light' ? 'dark' : 'light';
    try {
      const res = await apiFetch<{ settings: UserSettings }>('/users/me/settings', {
        method: 'PATCH',
        body: JSON.stringify({ theme: nextTheme }),
      });
      updateSettingsState(res.settings);
      showToast(nextTheme === 'light' ? 'Açık tema aktif edildi.' : 'Koyu tema aktif edildi.', 'success');
    } catch {
      showToast('Tema değiştirilemedi.', 'error');
    }
  };

  const handleCreateServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newServerName.trim().length < 2) {
      setCreateServerError('Sunucu adı en az 2 karakter olmalıdır.');
      return;
    }
    setCreateServerError('');
    try {
      const res = await apiFetch<{ server: ServerSummary; defaultChannelId: string }>('/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: newServerName.trim(),
          description: newServerDesc,
          isDiscoverable: newServerPublic,
          template: newServerTemplate,
        }),
      });
      setCreateServerOpen(false);
      setNewServerName('');
      setNewServerDesc('');
      setNewServerTemplate('blank');
      showToast(`${res.server.name} sunucusu oluşturuldu.`, 'success');
      await loadGlobalData();
      navigate(`/channels/${res.server.id}/${res.defaultChannelId}`);
      setMobileNavOpen(false);
    } catch (err) {
      setCreateServerError(err instanceof ApiError ? err.message : 'Sunucu oluşturulamadı.');
    }
  };

  const handleQuickCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeServer) return;
    if (quickChannelName.trim().length < 2) {
      setQuickChannelError('Kanal veya kategori adı en az 2 karakter olmalıdır.');
      return;
    }
    setQuickChannelError('');
    try {
      const res = await apiFetch<{ channelId: string }>(`/servers/${activeServer.id}/channels`, {
        method: 'POST',
        body: JSON.stringify({
          name: quickChannelName.trim(),
          topic: quickChannelTopic.trim(),
          type: quickChannelType,
          parentId: quickChannelType === 'category' ? null : quickChannelParentId || null,
          isStage: quickChannelType === 'voice' ? quickChannelIsStage : false,
          isPrivate: quickChannelType === 'category' ? false : quickChannelIsPrivate,
          allowedRoleIds:
            quickChannelType === 'category' || !quickChannelIsPrivate ? [] : quickChannelRoleIds,
        }),
      });
      setQuickChannelOpen(false);
      setQuickChannelName('');
      setQuickChannelTopic('');
      setQuickChannelParentId('');
      setQuickChannelIsStage(false);
      setQuickChannelIsPrivate(false);
      setQuickChannelRoleIds([]);
      showToast(quickChannelType === 'category' ? 'Kategori oluşturuldu.' : 'Kanal oluşturuldu.', 'success');
      await loadServerDetail(activeServer.id);
      if (quickChannelType !== 'category') {
        navigate(`/channels/${activeServer.id}/${res.channelId}`);
        setMobileNavOpen(false);
      }
    } catch (err) {
      setQuickChannelError(err instanceof ApiError ? err.message : 'Kanal oluşturulamadı.');
    }
  };

  const handleCopyInvite = async () => {
    if (!activeServer) return;
    try {
      const res = await apiFetch<{ invite: { code: string } }>(`/servers/${activeServer.id}/invites`, {
        method: 'POST',
        body: JSON.stringify({ expiresInHours: 168 }),
      });
      const url = `${window.location.origin}/invite/${res.invite.code}`;
      await navigator.clipboard?.writeText(url);
      showToast('Sunucu davet bağlantısı kopyalandı.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Davet bağlantısı oluşturulamadı.', 'error');
    }
  };

  const activeChannel = channels.find((c) => c.id === channelId) || null;
  const activeConversation = conversations.find((c) => c.id === conversationId) || null;

  useEffect(() => {
    if (showPinsDrawer && activeChannel && (activeChannel.type === 'text' || activeChannel.type === 'announcement')) {
      apiFetch<{ messages: ChatMessage[] }>(`/channels/${activeChannel.id}/pins`)
        .then((res) => setPinnedMessages(res.messages))
        .catch(() => setPinnedMessages([]));
    }
  }, [showPinsDrawer, activeChannel]);

  const startDmCall = (withVideo: boolean) => {
    if (!activeConversation || !me) return;
    const peer = activeConversation.members.find((m) => m.userId !== me.userId);
    if (!peer) return;
    wsClient.send('call:invite', {
      conversationId: activeConversation.id,
      targetUserId: peer.userId,
      withVideo,
    });
    setActiveDmCall({
      conversationId: activeConversation.id,
      peerName: peer.displayName,
      withVideo,
      participants: [
        {
          userId: me.userId,
          channelId: activeConversation.id,
          profile: me,
          muted: false,
          deafened: false,
          serverMuted: false,
          videoEnabled: withVideo,
          screenSharing: false,
          speaking: false,
        },
        {
          userId: peer.userId,
          channelId: activeConversation.id,
          profile: peer,
          muted: false,
          deafened: false,
          serverMuted: false,
          videoEnabled: withVideo,
          screenSharing: false,
          speaking: false,
        },
      ],
    });
  };

  const unreadNotifCount = notifications.filter((n) => !n.isRead).length;

  const isOwner = Boolean(activeServer && me?.userId === activeServer.ownerId);
  const canManageChannels = Boolean(isOwner || myPermissions.includes('MANAGE_CHANNELS'));
  const canCreateInvites = Boolean(isOwner || myPermissions.includes('CREATE_INVITES'));
  const canSend =
    isOwner ||
    (activeChannel?.type === 'announcement'
      ? myPermissions.includes('SEND_ANNOUNCEMENTS') && myPermissions.includes('SEND_MESSAGES')
      : myPermissions.includes('SEND_MESSAGES'));
  const canAttachFiles = Boolean(isOwner || myPermissions.includes('ATTACH_FILES'));
  const canPin = Boolean(isOwner || myPermissions.includes('PIN_MESSAGES'));
  const canDeleteOthers = Boolean(isOwner || myPermissions.includes('DELETE_MESSAGES'));
  const canEditOthers = Boolean(isOwner || myPermissions.includes('EDIT_MESSAGES'));

  // Group channels by category
  const categories = channels.filter((c) => c.type === 'category');
  const uncategorized = channels.filter((c) => c.type !== 'category' && !c.parentId);

  const renderChannelIcon = (type: Channel['type'], isStage?: boolean) => {
    if (type === 'voice') {
      return isStage ? (
        <Radio className="w-4 h-4 shrink-0 text-fuchsia-400" />
      ) : (
        <Volume2 className="w-4 h-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
      );
    }
    if (type === 'announcement') return <Megaphone className="w-4 h-4 shrink-0 text-amber-500 dark:text-amber-400" />;
    if (type === 'forum') return <MessageSquareText className="w-4 h-4 shrink-0 text-sky-500 dark:text-sky-400" />;
    return <Hash className="w-4 h-4 shrink-0 text-indigo-400 dark:text-[#C084FC]" />;
  };

  const renderChannelRow = (ch: Channel) => {
    const isActive = ch.id === channelId;
    const vParticipants = voiceParticipants[ch.id] || [];
    return (
      <div key={ch.id}>
        <button
          type="button"
          onClick={() => {
            navigate(`/channels/${ch.serverId}/${ch.id}`);
            setMobileNavOpen(false);
          }}
          className={`w-full px-2.5 py-2 rounded-xl flex items-center gap-2 text-sm transition-colors ${
            isActive
              ? 'bg-[#7C3AED]/20 text-[#7C3AED] dark:text-[#F8FAFC] border border-[#7C3AED]/30 font-semibold'
              : 'text-slate-600 dark:text-[#A1A1B5] hover:text-slate-900 dark:hover:text-[#F8FAFC] hover:bg-slate-200/70 dark:hover:bg-[#19192A]'
          }`}
        >
          {renderChannelIcon(ch.type, ch.isStage)}
          <span className="truncate flex-1 text-left">{ch.name}</span>
          {ch.type === 'voice' && vParticipants.length > 0 && (
            <span className="text-[11px] font-mono text-[#22C55E] tabular-nums">{vParticipants.length}</span>
          )}
          {(ch.unreadCount || 0) > 0 && !isActive && (
            <span className="px-1.5 py-0.5 rounded-full bg-[#7C3AED] text-white text-[10px] font-mono tabular-nums">
              {ch.unreadCount}
            </span>
          )}
        </button>
        {ch.type === 'voice' && vParticipants.length > 0 && (
          <div className="pl-7 pr-2 py-1 space-y-1">
            {vParticipants.map((vp) => {
              const isSpk = Boolean(voice.speakingMap[vp.userId]) || (vp.userId === me?.userId && voice.speaking && !voice.muted);
              return (
                <div key={vp.userId} className="flex items-center gap-2 text-xs text-slate-400 dark:text-[#A1A1B5] py-0.5">
                  <span className={`rounded-full ${isSpk ? 'ring-2 ring-[#22C55E]' : ''}`}>
                    <UserAvatar
                      src={vp.profile.avatarUrl}
                      name={vp.profile.displayName}
                      frame={vp.profile.avatarFrame}
                      size="xs"
                      showStatus={false}
                    />
                  </span>
                  <span className={`truncate flex-1 ${isSpk ? 'text-[#22C55E] font-medium' : ''}`}>
                    {vp.profile.displayName}
                  </span>
                  {vp.joinedAt && (
                    <span className="text-[10px] font-mono text-slate-500 dark:text-[#A1A1B5]/70 shrink-0 tabular-nums">
                      {formatIsoElapsed(vp.joinedAt)}
                    </span>
                  )}
                  {(vp.muted || vp.serverMuted) && <MicOff className="w-3 h-3 text-[#EF4444] shrink-0" />}
                  {vp.deafened && <VolumeX className="w-3 h-3 text-slate-500 shrink-0" />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderNavigationColumns = () => (
    <>
      {/* Column 1: Server Rail (72px) */}
      <nav
        aria-label="Sunucular"
        className="w-[72px] shrink-0 bg-[#EAEDF5] dark:bg-[#10111B] border-r border-slate-200 dark:border-[#29293D] flex flex-col items-center py-3 gap-2.5 overflow-y-auto"
      >
        <div className="relative group flex items-center justify-center w-full">
          {viewMode === 'home' && <span className="absolute left-0 w-1 h-7 rounded-r-full bg-[#7C3AED]" />}
          <button
            type="button"
            onClick={() => {
              navigate('/channels/@me');
              setMobileNavOpen(false);
            }}
            title="Ana Sayfa ve Özel Mesajlar"
            className={`w-12 h-12 rounded-2xl overflow-hidden border flex items-center justify-center transition-all shrink-0 ${
              viewMode === 'home'
                ? 'border-[#A855F7] ring-2 ring-[#7C3AED]/35 shadow-md shadow-[#7C3AED]/20'
                : 'border-slate-300 dark:border-[#29293D] hover:border-[#A855F7]'
            }`}
          >
            <OrbitLogo size={46} />
          </button>
          <span className="pointer-events-none hidden md:group-hover:block fixed left-[78px] px-2.5 py-1 rounded-lg bg-[#151522] border border-[#29293D] text-xs font-semibold text-[#F8FAFC] whitespace-nowrap shadow-xl z-50">
            ORBIT Ana Sayfa
          </span>
        </div>

        <div className="w-8 h-px bg-slate-300 dark:bg-[#29293D]" />

        {servers.map((srv) => {
          const isCurrent = viewMode === 'server' && srv.id === serverId;
          const unread = srv.unreadCount || 0;
          return (
            <div key={srv.id} className="relative group flex items-center justify-center w-full">
              {isCurrent && <span className="absolute left-0 w-1 h-7 rounded-r-full bg-[#7C3AED]" />}
              <button
                type="button"
                onClick={() => {
                  navigate(`/channels/${srv.id}`);
                  setMobileNavOpen(false);
                }}
                title={srv.name}
                className={`w-12 h-12 rounded-2xl font-display font-bold text-sm flex items-center justify-center overflow-hidden transition-all border ${
                  isCurrent
                    ? 'bg-[#7C3AED] text-white border-[#A855F7] rounded-xl shadow-md shadow-[#7C3AED]/25'
                    : 'bg-white dark:bg-[#19192A] text-slate-700 dark:text-[#F8FAFC] border-slate-200 dark:border-[#29293D] hover:border-[#A855F7]/60'
                }`}
              >
                {srv.iconUrl ? (
                  <img
                    src={resolveMediaUrl(srv.iconUrl)}
                    alt={srv.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  srv.name.slice(0, 2).toUpperCase()
                )}
              </button>
              <span className="pointer-events-none hidden md:group-hover:block fixed left-[78px] px-2.5 py-1 rounded-lg bg-[#151522] border border-[#29293D] text-xs font-semibold text-[#F8FAFC] whitespace-nowrap shadow-xl z-50">
                {srv.name}
              </span>
              {srv.isFavorite && (
                <Star className="w-3 h-3 text-[#F59E0B] fill-[#F59E0B] absolute -top-0.5 right-2 pointer-events-none" />
              )}
              {unread > 0 && !isCurrent && (
                <span className="absolute -bottom-0.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-mono font-bold flex items-center justify-center ring-2 ring-[#EAEDF5] dark:ring-[#10111B] pointer-events-none tabular-nums">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => {
            setCreateServerError('');
            setCreateServerOpen(true);
          }}
          title="Yeni Sunucu Oluştur"
          className="w-12 h-12 rounded-2xl bg-white dark:bg-[#19192A] border border-dashed border-slate-300 dark:border-[#29293D] hover:border-[#22C55E] hover:text-[#22C55E] flex items-center justify-center text-slate-500 dark:text-[#A1A1B5] transition-colors shrink-0"
        >
          <Plus className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => {
            navigate('/discover');
            setMobileNavOpen(false);
          }}
          title="Sunucu Keşfet"
          className={`w-12 h-12 rounded-2xl border flex items-center justify-center transition-colors shrink-0 ${
            viewMode === 'discover'
              ? 'bg-[#7C3AED] text-white border-[#A855F7]'
              : 'bg-white dark:bg-[#19192A] border-slate-200 dark:border-[#29293D] text-slate-500 dark:text-[#A1A1B5] hover:text-[#C084FC] hover:border-[#A855F7]/50'
          }`}
        >
          <Compass className="w-5 h-5" />
        </button>
      </nav>

      {/* Column 2: Channel / DM Sidebar (256px) */}
      <aside className="w-64 shrink-0 bg-[#F2F4F9] dark:bg-[#151522] border-r border-slate-200 dark:border-[#29293D] flex flex-col min-h-0">
        {viewMode === 'server' && activeServer ? (
          <>
            <div className="relative h-14 px-3 border-b border-slate-200 dark:border-[#29293D] flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={() => setServerMenuOpen(!serverMenuOpen)}
                className="flex-1 min-w-0 text-left pl-1 group"
              >
                <p className="font-display font-bold text-sm truncate group-hover:text-[#C084FC] transition-colors">
                  {activeServer.name}
                </p>
                <p className="text-[11px] font-mono text-slate-500 dark:text-[#A1A1B5] leading-tight truncate">
                  {members.length} üye
                  {(activeServer.boostCount || 0) > 0 ? ` · 🚀 Sv.${activeServer.boostLevel || 0}` : ''}
                  {activeServer.serverBadges && activeServer.serverBadges.length > 0
                    ? ` · ${activeServer.serverBadges[0].label}`
                    : ''}
                </p>
              </button>
              {canCreateInvites && (
                <button
                  type="button"
                  onClick={() => void handleCopyInvite()}
                  title="Davet Bağlantısı Kopyala"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-[#C084FC] hover:bg-slate-200/50 dark:hover:bg-[#19192A]"
                >
                  <Link2 className="w-4 h-4" />
                </button>
              )}
              {canManageChannels && (
                <button
                  type="button"
                  onClick={() => {
                    setQuickChannelError('');
                    setQuickChannelParentId('');
                    setQuickChannelType('text');
                    setQuickChannelIsStage(false);
                    setQuickChannelIsPrivate(false);
                    setQuickChannelRoleIds([]);
                    setQuickChannelOpen(true);
                  }}
                  title="Kanal veya Kategori Oluştur"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-[#22C55E] hover:bg-slate-200/50 dark:hover:bg-[#19192A]"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setServerSettingsInitialTab(undefined);
                  setServerSettingsOpen(true);
                }}
                title="Sunucu Ayarları"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-[#F8FAFC] hover:bg-slate-200/50 dark:hover:bg-[#19192A]"
              >
                <Settings className="w-4 h-4" />
              </button>

              {serverMenuOpen && (
                <div className="absolute top-13 left-3 right-3 z-40 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] shadow-xl p-1.5 text-xs space-y-0.5">
                  {activeServer.serverBadges && activeServer.serverBadges.length > 0 && (
                    <div className="px-2.5 py-2 mb-1 rounded-lg bg-slate-50 dark:bg-[#10111B] border border-slate-200 dark:border-[#29293D] space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Sunucu Rozetleri
                      </p>
                      <div className="space-y-1">
                        {activeServer.serverBadges.map((sb) => (
                          <div key={sb.key} className="flex items-center gap-1.5 text-[11px] font-semibold">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: sb.color }}
                            />
                            <span className="truncate">{sb.label}</span>
                            <span className="text-[10px] font-normal text-slate-400 ml-auto shrink-0">
                              {sb.rarity}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setServerMenuOpen(false);
                      setOnboardingOpen(true);
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-emerald-500 dark:text-emerald-400 font-medium"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Topluluk Kuralları & Roller
                  </button>
                  {canCreateInvites && (
                    <button
                      type="button"
                      onClick={() => {
                        setServerMenuOpen(false);
                        void handleCopyInvite();
                      }}
                      className="w-full px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-indigo-400 font-medium"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Davet Bağlantısı Kopyala
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/servers/${activeServer.id}/favorite`, { method: 'POST' });
                      setServerMenuOpen(false);
                      void loadGlobalData();
                      void loadServerDetail(activeServer.id);
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                  >
                    <Star className="w-3.5 h-3.5 text-amber-400" />
                    {activeServer.isFavorite ? 'Favorilerden Çıkar' : 'Favorilere Ekle'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const order: Array<'all' | 'mentions' | 'muted'> = ['all', 'mentions', 'muted'];
                      const cur = activeServer.notificationLevel || 'all';
                      const next = order[(order.indexOf(cur) + 1) % order.length];
                      await apiFetch(`/servers/${activeServer.id}/notifications`, {
                        method: 'PATCH',
                        body: JSON.stringify({ level: next }),
                      });
                      setActiveServer((prev) => (prev ? { ...prev, notificationLevel: next } : prev));
                      showToast(
                        next === 'all'
                          ? 'Sunucu bildirimleri: Tüm Mesajlar'
                          : next === 'mentions'
                          ? 'Sunucu bildirimleri: Yalnızca Bahsetmeler'
                          : 'Sunucu bildirimleri: Sessiz',
                        'info'
                      );
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-2">
                      <Bell className="w-3.5 h-3.5 text-sky-400" />
                      Bildirim Düzeyi
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      {activeServer.notificationLevel === 'mentions'
                        ? 'Bahsetme'
                        : activeServer.notificationLevel === 'muted'
                        ? 'Sessiz'
                        : 'Tümü'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setServerMenuOpen(false);
                      setServerSettingsInitialTab('rockets');
                      setServerSettingsOpen(true);
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left hover:bg-fuchsia-500/10 flex items-center justify-between gap-2 text-fuchsia-400 font-medium"
                  >
                    <span className="flex items-center gap-2">
                      <Rocket className="w-3.5 h-3.5" />
                      Sunucu Roketleri & Takviye
                    </span>
                    <span className="text-[10px] font-mono">
                      Sv.{activeServer.boostLevel || 0} ({activeServer.boostCount || 0})
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setServerMenuOpen(false);
                      setServerSettingsInitialTab(undefined);
                      setServerSettingsOpen(true);
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    Sunucu Yönetimi
                  </button>
                  {activeServer.ownerId !== me?.userId && (
                    <button
                      type="button"
                      onClick={async () => {
                        setServerMenuOpen(false);
                        await apiFetch(`/servers/${activeServer.id}/leave`, { method: 'POST' });
                        showToast('Sunucudan ayrıldınız.', 'info');
                        await loadGlobalData();
                        navigate('/channels/@me');
                      }}
                      className="w-full px-3 py-2 rounded-lg text-left text-rose-400 hover:bg-rose-500/10"
                    >
                      Sunucudan Ayrıl
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-4">
              {uncategorized.length > 0 && <div className="space-y-0.5">{uncategorized.map(renderChannelRow)}</div>}
              {categories.map((cat) => {
                const kids = channels.filter((c) => c.parentId === cat.id);
                const collapsed = Boolean(collapsedCategories[cat.id]);
                return (
                  <div key={cat.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-1 px-1.5 py-0.5 group">
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedCategories((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))
                        }
                        className="flex-1 min-w-0 flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 tracking-wide text-left"
                      >
                        {collapsed ? (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span className="truncate">{cat.name}</span>
                      </button>
                      {canManageChannels && (
                        <button
                          type="button"
                          onClick={() => {
                            setQuickChannelError('');
                            setQuickChannelParentId(cat.id);
                            setQuickChannelType('text');
                            setQuickChannelIsStage(false);
                            setQuickChannelIsPrivate(false);
                            setQuickChannelRoleIds([]);
                            setQuickChannelOpen(true);
                          }}
                          title={`${cat.name} kategorisine kanal ekle`}
                          className="p-0.5 rounded text-slate-400 hover:text-[#22C55E] opacity-75 group-hover:opacity-100 transition-opacity"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {!collapsed && <div className="space-y-0.5">{kids.map(renderChannelRow)}</div>}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="h-14 px-4 border-b border-slate-200 dark:border-[#29293D] flex items-center justify-between">
              <span className="font-display font-bold text-sm">Doğrudan Mesajlar</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setManagingGroupConv(null);
                    setGroupDmModalOpen(true);
                  }}
                  title="Yeni Grup Sohbeti Oluştur"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-[#C084FC]"
                >
                  <Users className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigate('/channels/@me');
                    setMobileNavOpen(false);
                  }}
                  title="Yeni Sohbet Başlat"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-[#C084FC]"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowArchivedDms(!showArchivedDms)}
                  title={showArchivedDms ? 'Arşivi gizle' : 'Arşivlenen sohbetleri göster'}
                  className={`p-1.5 rounded-lg text-xs ${showArchivedDms ? 'text-[#C084FC] bg-[#7C3AED]/15' : 'text-slate-400'}`}
                >
                  <Archive className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
              <button
                type="button"
                onClick={() => {
                  navigate('/channels/@me');
                  setMobileNavOpen(false);
                }}
                className={`w-full px-3 py-2.5 rounded-xl flex items-center gap-2.5 text-sm font-medium transition-colors ${
                  viewMode === 'home' && !conversationId
                    ? 'bg-[#7C3AED]/20 text-[#7C3AED] dark:text-[#F8FAFC] border border-[#7C3AED]/30'
                    : 'text-slate-600 dark:text-[#A1A1B5] hover:text-slate-900 dark:hover:text-[#F8FAFC] hover:bg-slate-200/70 dark:hover:bg-[#19192A]'
                }`}
              >
                <Users className="w-4 h-4" />
                Arkadaşlar
              </button>

              <p className="px-2 pt-3 pb-1 text-[11px] font-semibold text-slate-500 dark:text-[#A1A1B5]">
                Sohbetler ({conversations.length})
              </p>

              {conversations.map((conv) => {
                const peer = !conv.isGroup ? conv.members.find((m) => m.userId !== me?.userId) : null;
                const title = conv.isGroup ? conv.name || 'Grup Sohbeti' : peer?.displayName || 'Sohbet';
                const active = conv.id === conversationId;
                return (
                  <div
                    key={conv.id}
                    className={`group flex items-center gap-2 px-2 py-2 rounded-xl transition-colors ${
                      active
                        ? 'bg-[#7C3AED]/20 text-[#7C3AED] dark:text-[#F8FAFC] border border-[#7C3AED]/30'
                        : 'text-slate-600 dark:text-[#A1A1B5] hover:text-slate-900 dark:hover:text-[#F8FAFC] hover:bg-slate-200/70 dark:hover:bg-[#19192A]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        navigate(`/channels/@me/${conv.id}`);
                        setMobileNavOpen(false);
                      }}
                      className="flex-1 flex items-center gap-2.5 min-w-0 text-left"
                    >
                      <UserAvatar
                        src={conv.isGroup ? conv.avatarUrl : peer?.avatarUrl}
                        name={title}
                        status={peer?.status}
                        frame={peer?.avatarFrame}
                        size="sm"
                        showStatus={!conv.isGroup}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate">{title}</p>
                        {conv.lastMessage && (
                          <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] truncate">
                            {conv.lastMessage.content}
                          </p>
                        )}
                      </div>
                      {conv.unreadCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-[#7C3AED] text-white text-[10px] font-mono tabular-nums">
                          {conv.unreadCount}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      title={conv.archived ? 'Arşivden Çıkar' : 'Sohbeti Arşivle'}
                      onClick={async () => {
                        await apiFetch(`/dm/conversations/${conv.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ archived: !conv.archived }),
                        });
                        void loadGlobalData();
                        if (active && !conv.archived) navigate('/channels/@me');
                      }}
                      className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 p-1.5 min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-500 dark:text-[#A1A1B5] hover:text-slate-900 dark:hover:text-[#F8FAFC]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Persistent Active Voice Connection Bar */}
        {voice.activeRoom && (
          <div className="px-2.5 py-2 border-t border-slate-200 dark:border-[#29293D] bg-[#DDE2F0] dark:bg-[#10111B] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  if (voice.activeRoom?.mode === 'channel' && voice.activeRoom.serverId) {
                    navigate(`/channels/${voice.activeRoom.serverId}/${voice.activeRoom.roomId}`);
                    setMobileNavOpen(false);
                  }
                }}
                className="min-w-0 text-left group"
              >
                <p className="text-[11px] font-semibold text-emerald-600 dark:text-[#22C55E] flex items-center gap-1.5 tabular-nums">
                  <Signal className="w-3.5 h-3.5 shrink-0" />
                  <span>Ses Bağlandı</span>
                  <span className="font-mono text-slate-500 dark:text-[#A1A1B5]">
                    · {formatVoiceDuration(voice.elapsedSeconds)}
                  </span>
                </p>
                <p className="text-[11px] text-slate-600 dark:text-[#F8FAFC]/85 truncate group-hover:underline">
                  {voice.activeRoom.roomTitle}
                  {voice.activeRoom.serverName ? ` / ${voice.activeRoom.serverName}` : ''}
                  {voice.pingMs !== null ? ` · ${voice.pingMs} ms` : ''}
                </p>
              </button>

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void voice.toggleMute()}
                  title={voice.muted ? 'Mikrofonu Aç' : 'Sustur'}
                  className={`p-1.5 rounded-lg transition-colors ${
                    voice.muted
                      ? 'bg-[#EF4444]/15 text-[#EF4444]'
                      : 'text-slate-500 hover:text-slate-900 dark:text-[#A1A1B5] dark:hover:text-[#F8FAFC]'
                  }`}
                >
                  {voice.muted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => void voice.toggleDeafen()}
                  title={voice.deafened ? 'Sesi Aç' : 'Sağırlaştır'}
                  className={`p-1.5 rounded-lg transition-colors ${
                    voice.deafened
                      ? 'bg-[#EF4444]/15 text-[#EF4444]'
                      : 'text-slate-500 hover:text-slate-900 dark:text-[#A1A1B5] dark:hover:text-[#F8FAFC]'
                  }`}
                >
                  {voice.deafened ? <VolumeX className="w-3.5 h-3.5" /> : <Headphones className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => void voice.leaveRoom()}
                  title="Sesten Ayrıl"
                  className="p-1.5 rounded-lg text-[#EF4444] hover:bg-[#EF4444]/15"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* User Dock */}
        {me && (
          <div className="p-2.5 border-t border-slate-200 dark:border-[#29293D] bg-[#E6E9F2] dark:bg-[#10111B] flex items-center gap-1.5 relative">
            <button
              type="button"
              onClick={() => {
                setQuickMenuOpen(!quickMenuOpen);
                setNotifOpen(false);
              }}
              className="flex items-center gap-2.5 flex-1 min-w-0 text-left rounded-xl p-1 hover:bg-black/5 dark:hover:bg-[#19192A]"
            >
              <UserAvatar src={me.avatarUrl} name={me.displayName} status={me.status} frame={me.avatarFrame} size="sm" />
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate flex items-center gap-1">
                  <span className="truncate">{me.displayName}</span>
                  {me.isFounder && <Crown className="w-3 h-3 text-[#F59E0B] shrink-0" />}
                  {me.nitroTier === 'nitro' && <NitroBadge />}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] truncate">
                  {me.customStatus || getStatusLabel(me.status)}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setNotifOpen(!notifOpen);
                setQuickMenuOpen(false);
              }}
              title="Bildirimler"
              className="relative p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-[#A1A1B5] dark:hover:text-[#F8FAFC]"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#EF4444]" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setQuickMenuOpen(false);
                setSettingsOpen(true);
              }}
              title="Kullanıcı Ayarları"
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-[#A1A1B5] dark:hover:text-[#F8FAFC]"
            >
              <Settings className="w-4 h-4" />
            </button>

            {quickMenuOpen && (
              <div className="absolute bottom-full left-2 right-2 mb-2 rounded-2xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] shadow-2xl p-2 space-y-1 z-40 text-xs">
                <div className="px-2.5 py-1.5 border-b border-slate-100 dark:border-[#29293D]">
                  <p className="font-semibold truncate">{me.displayName}</p>
                  <p className="text-[11px] font-mono text-slate-400 dark:text-[#A1A1B5]">
                    {me.username}
                    <span className="text-indigo-400 font-semibold">#{me.discriminator || '0000'}</span>
                  </p>
                </div>
                <p className="px-2.5 pt-1 text-[10px] font-semibold text-slate-400">Durum Değiştir</p>
                {[
                  { id: 'online', label: 'Çevrimiçi', dot: 'bg-emerald-500' },
                  { id: 'idle', label: 'Boşta', dot: 'bg-amber-400' },
                  { id: 'dnd', label: 'Rahatsız Etmeyin', dot: 'bg-rose-500' },
                  { id: 'offline', label: 'Görünmez', dot: 'bg-slate-400' },
                ].map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={async () => {
                      const res = await apiFetch<{ profile: typeof me }>('/users/me/profile', {
                        method: 'PATCH',
                        body: JSON.stringify({ preferredStatus: st.id }),
                      });
                      updateProfileState(res.profile);
                      setQuickMenuOpen(false);
                    }}
                    className={`w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${
                      me.preferredStatus === st.id ? 'bg-indigo-500/10 text-indigo-400 font-semibold' : ''
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />
                    <span>{st.label}</span>
                  </button>
                ))}
                <div className="border-t border-slate-100 dark:border-slate-800 pt-1 mt-1 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickMenuOpen(false);
                      setProfileModalUserId(me.userId);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Profil Kartım & Düzenle
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickMenuOpen(false);
                      setNitroModalOpen(true);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-fuchsia-500/10 flex items-center gap-2 text-fuchsia-400 font-semibold"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    ORBIT Nitro {me.nitroTier === 'nitro' ? '(Aktif)' : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickMenuOpen(false);
                      setAchievementsModalOpen(true);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-orange-500/10 flex items-center gap-2 text-orange-400"
                  >
                    <Flame className="w-3.5 h-3.5" />
                    Başarılar & Günlük Seri
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickMenuOpen(false);
                      setBadgeCatalogOpen(true);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-fuchsia-400"
                  >
                    <Award className="w-3.5 h-3.5" />
                    Rozet Kataloğu (İlk 100)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickMenuOpen(false);
                      void handleToggleTheme();
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                  >
                    {settings?.theme === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                    {settings?.theme === 'light' ? 'Koyu Temaya Geç' : 'Açık Temaya Geç'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickMenuOpen(false);
                      void logout();
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg text-left text-rose-400 hover:bg-rose-500/10 flex items-center gap-2"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Çıkış Yap
                  </button>
                </div>
              </div>
            )}

            {notifOpen && (
              <div className="absolute bottom-full left-2 right-2 mb-2 rounded-2xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] shadow-2xl overflow-hidden z-40">
                <div className="px-3 py-2.5 border-b border-slate-200 dark:border-[#29293D] flex items-center justify-between text-xs">
                  <span className="font-semibold">Bildirimler ({unreadNotifCount})</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch('/notifications/read-all', { method: 'POST' });
                        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
                      }}
                      className="text-[#C084FC] hover:underline"
                    >
                      Okundu
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch('/notifications', { method: 'DELETE' });
                        setNotifications([]);
                      }}
                      className="text-slate-400 hover:text-[#EF4444]"
                    >
                      Temizle
                    </button>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-[#29293D]">
                  {notifications.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-400 dark:text-[#A1A1B5]">Bildirim bulunmuyor.</p>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={async () => {
                          if (!n.isRead) {
                            await apiFetch(`/notifications/${n.id}/read`, { method: 'POST' });
                            setNotifications((prev) =>
                              prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item))
                            );
                          }
                          setNotifOpen(false);
                          if (n.link) navigate(n.link);
                        }}
                        className={`w-full p-3 text-left text-xs hover:bg-slate-50 dark:hover:bg-[#222238] ${
                          !n.isRead ? 'bg-[#7C3AED]/10' : ''
                        }`}
                      >
                        <p className="font-semibold">{n.title}</p>
                        <p className="text-slate-500 dark:text-[#A1A1B5] mt-0.5 line-clamp-2">{n.body}</p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );

  return (
    <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-[#F7F8FC] dark:bg-[#0B0B12] text-slate-900 dark:text-[#F8FAFC]">
      <EmailVerificationBanner />
      <OfflineIndicator />

      {wsState === 'disconnected' && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-1.5 text-xs text-amber-300 text-center">
          Gerçek zamanlı bağlantı yeniden kuruluyor...
        </div>
      )}

      {incomingCall && (
        <div className="bg-emerald-600/20 border-b border-emerald-500/40 px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
          <span className="font-semibold">
            {incomingCall.fromName} sizi {incomingCall.withVideo ? 'görüntülü' : 'sesli'} arıyor...
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                wsClient.send('call:accept', {
                  conversationId: incomingCall.conversationId,
                  targetUserId: incomingCall.fromUserId,
                });
                const conv = conversations.find((c) => c.id === incomingCall.conversationId);
                const peer = conv?.members.find((m) => m.userId === incomingCall.fromUserId);
                if (me && peer) {
                  setActiveDmCall({
                    conversationId: incomingCall.conversationId,
                    peerName: incomingCall.fromName,
                    withVideo: incomingCall.withVideo,
                    participants: [
                      {
                        userId: me.userId,
                        channelId: incomingCall.conversationId,
                        profile: me,
                        muted: false,
                        deafened: false,
                        serverMuted: false,
                        videoEnabled: incomingCall.withVideo,
                        screenSharing: false,
                        speaking: false,
                      },
                      {
                        userId: peer.userId,
                        channelId: incomingCall.conversationId,
                        profile: peer,
                        muted: false,
                        deafened: false,
                        serverMuted: false,
                        videoEnabled: incomingCall.withVideo,
                        screenSharing: false,
                        speaking: false,
                      },
                    ],
                  });
                }
                setIncomingCall(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold"
            >
              Kabul Et
            </button>
            <button
              type="button"
              onClick={() => {
                wsClient.send('call:reject', {
                  conversationId: incomingCall.conversationId,
                  targetUserId: incomingCall.fromUserId,
                });
                setIncomingCall(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-semibold"
            >
              Reddet
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0 relative">
        {/* Desktop Navigation Columns */}
        <div className="hidden md:flex min-h-0">{renderNavigationColumns()}</div>

        {/* Mobile Drawer Overlay */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div className="flex h-full shadow-2xl">{renderNavigationColumns()}</div>
            <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
          </div>
        )}

        {/* Column 3: Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-white dark:bg-[#0B0B12]">
          {/* Header Bar */}
          <header className="h-14 px-3 sm:px-4 border-b border-slate-200 dark:border-[#29293D] flex items-center justify-between gap-3 shrink-0 bg-white/80 dark:bg-[#10111B]/80 backdrop-blur-md">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Menüyü aç"
                className="md:hidden min-h-[44px] min-w-[44px] -ml-1 rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300"
              >
                <Menu className="w-5 h-5" />
              </button>

              {viewMode === 'server' && activeChannel && (
                <div className="flex items-center gap-2 min-w-0">
                  {renderChannelIcon(activeChannel.type, activeChannel.isStage)}
                  <h1 className="text-sm font-bold font-display truncate">{activeChannel.name}</h1>
                  {activeChannel.isStage && (
                    <span className="px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-400 text-[10px] font-bold uppercase tracking-wider shrink-0">
                      Sahne
                    </span>
                  )}
                  {activeChannel.topic && (
                    <span className="hidden sm:inline text-xs text-slate-400 truncate max-w-md">
                      · {activeChannel.topic}
                    </span>
                  )}
                </div>
              )}

              {viewMode === 'home' && activeConversation && (
                <div className="flex items-center gap-2 min-w-0">
                  <h1 className="text-sm font-bold font-display truncate">
                    {activeConversation.isGroup
                      ? activeConversation.name || 'Grup Sohbeti'
                      : activeConversation.members.find((m) => m.userId !== me?.userId)?.displayName || 'Sohbet'}
                  </h1>
                  {activeConversation.isGroup && (
                    <span className="text-[11px] font-mono text-slate-400 shrink-0">
                      · {activeConversation.members.length} üye
                    </span>
                  )}
                </div>
              )}

              {viewMode === 'home' && !activeConversation && (
                <h1 className="text-sm font-bold font-display">Arkadaşlar</h1>
              )}

              {viewMode === 'discover' && <h1 className="text-sm font-bold font-display">Toplulukları Keşfet</h1>}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {viewMode === 'home' && activeConversation && !activeConversation.isGroup && (
                <>
                  <button
                    type="button"
                    onClick={() => startDmCall(false)}
                    title="Sesli Arama"
                    className="min-h-[42px] min-w-[42px] sm:min-h-[40px] sm:min-w-[40px] rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300"
                  >
                    <Phone className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => startDmCall(true)}
                    title="Görüntülü Arama"
                    className="min-h-[42px] min-w-[42px] sm:min-h-[40px] sm:min-w-[40px] rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300"
                  >
                    <Video className="w-4 h-4" />
                  </button>
                </>
              )}

              {viewMode === 'home' && activeConversation?.isGroup && (
                <button
                  type="button"
                  onClick={() => {
                    setManagingGroupConv(activeConversation);
                    setGroupDmModalOpen(true);
                  }}
                  title="Grup Sohbetini Yönet"
                  className="min-h-[42px] min-w-[42px] sm:min-h-[40px] sm:min-w-[40px] rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-indigo-400"
                >
                  <Users className="w-4 h-4" />
                </button>
              )}

              {viewMode === 'server' && activeServer && (
                <button
                  type="button"
                  onClick={() => setOnboardingOpen(true)}
                  title="Topluluk Kuralları & Kendine Rol Seç"
                  className="min-h-[42px] min-w-[42px] sm:min-h-[40px] sm:min-w-[40px] sm:px-2.5 rounded-xl hover:bg-emerald-500/10 flex items-center justify-center gap-1.5 text-emerald-500 dark:text-emerald-400 text-xs font-medium whitespace-nowrap"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span className="hidden lg:inline">Topluluk Kuralları</span>
                </button>
              )}

              <PWAInstallButton compact />

              <button
                type="button"
                onClick={() => setNitroModalOpen(true)}
                title="ORBIT Nitro & Sunucu Takviyesi"
                className="min-h-[42px] min-w-[42px] sm:min-h-[40px] sm:min-w-[40px] sm:px-2.5 rounded-xl hover:bg-fuchsia-500/10 flex items-center justify-center gap-1.5 text-fuchsia-500 dark:text-fuchsia-300 text-xs font-semibold"
              >
                <Zap className="w-4 h-4" />
                <span className="hidden lg:inline">Nitro</span>
              </button>

              <button
                type="button"
                onClick={() => setAchievementsModalOpen(true)}
                title="Başarılar ve 1-7 Gün Ateşli Seri"
                className="min-h-[42px] min-w-[42px] sm:min-h-[40px] sm:min-w-[40px] sm:px-2.5 rounded-xl hover:bg-orange-500/10 flex items-center justify-center gap-1.5 text-orange-500 dark:text-orange-300 text-xs font-medium"
              >
                <Flame className="w-4 h-4" />
                <span className="hidden lg:inline">Seri</span>
              </button>

              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                title="Hızlı Geçiş ve Komutlar (Ctrl+K)"
                className="min-h-[42px] min-w-[42px] sm:min-h-[40px] sm:min-w-[40px] sm:px-2.5 rounded-xl hover:bg-violet-500/10 flex items-center justify-center gap-1.5 text-slate-600 dark:text-slate-300 hover:text-[#7C3AED] dark:hover:text-[#C084FC] text-xs transition-colors"
              >
                <Command className="w-4 h-4 text-[#A855F7]" />
                <span className="hidden lg:inline font-mono text-[11px] text-slate-500 dark:text-slate-400">Ctrl+K</span>
              </button>

              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                title="Mesajlarda Ara"
                className="min-h-[42px] min-w-[42px] sm:min-h-[40px] sm:min-w-[40px] rounded-xl hover:bg-cyan-500/10 flex items-center justify-center text-cyan-600 dark:text-cyan-400 transition-colors"
              >
                <Search className="w-4 h-4" />
              </button>

              {viewMode === 'server' && activeChannel && (activeChannel.type === 'text' || activeChannel.type === 'announcement') && (
                <button
                  type="button"
                  onClick={() => setShowPinsDrawer(!showPinsDrawer)}
                  title="Sabitlenmiş Mesajlar"
                  className={`min-h-[42px] min-w-[42px] sm:min-h-[40px] sm:min-w-[40px] rounded-xl flex items-center justify-center transition-colors ${
                    showPinsDrawer
                      ? 'bg-amber-500/15 text-amber-500 dark:text-amber-400'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-amber-500/10 hover:text-amber-500'
                  }`}
                >
                  <Pin className="w-4 h-4" />
                </button>
              )}

              {viewMode === 'server' && (
                <button
                  type="button"
                  onClick={() => setShowMembersDrawer(!showMembersDrawer)}
                  title="Üye Listesi"
                  className={`min-h-[42px] min-w-[42px] sm:min-h-[40px] sm:min-w-[40px] rounded-xl flex items-center justify-center transition-colors ${
                    showMembersDrawer
                      ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-sky-500/10 hover:text-sky-500'
                  }`}
                >
                  <Users className="w-4 h-4" />
                </button>
              )}
            </div>
          </header>

          {/* Body Content + Responsive Right Drawers */}
          <div className="flex-1 flex min-h-0 relative">
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              {activeDmCall && (
                <div className="h-[55%] border-b border-slate-800">
                  <VoiceStageView
                    mode="dm_call"
                    roomId={activeDmCall.conversationId}
                    roomTitle={`${activeDmCall.peerName} ile Görüşme`}
                    participants={activeDmCall.participants}
                    initialWithVideo={activeDmCall.withVideo}
                    onLeft={() => setActiveDmCall(null)}
                  />
                </div>
              )}

              <motion.div
                key={viewMode === 'server' ? `srv-${channelId || serverId || 'none'}` : `${viewMode}-${conversationId || 'home'}`}
                initial={{ opacity: 0.92, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.14 }}
                className="flex-1 min-h-0"
              >
                {viewMode === 'discover' && (
                  <DiscoverServersView
                    onJoined={(sid) => {
                      void loadGlobalData();
                      navigate(`/channels/${sid}`);
                    }}
                  />
                )}

                {viewMode === 'home' && !conversationId && (
                  <div className="h-full flex flex-col min-h-0">
                    <div className="px-4 sm:px-6 pt-3.5 pb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-[#29293D]/60 bg-gradient-to-r from-[#7C3AED]/8 via-transparent to-transparent shrink-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <OrbitLogo size={28} />
                        <div className="min-w-0">
                          <p className="text-xs font-bold font-display tracking-tight text-slate-900 dark:text-[#F8FAFC] truncate">
                            ORBIT Evreni
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] truncate">
                            Sınırsız Sohbet, Sonsuz Bağlantı.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate('/discover')}
                        className="h-8 px-3 rounded-xl border border-[#7C3AED]/30 bg-[#7C3AED]/10 hover:bg-[#7C3AED]/20 text-xs font-semibold text-[#7C3AED] dark:text-[#C084FC] flex items-center gap-1.5 transition-colors shrink-0"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        Toplulukları Keşfet
                      </button>
                    </div>

                    {servers.length === 0 && (
                      <div className="mx-4 sm:mx-6 mt-3 p-4 rounded-2xl border border-[#7C3AED]/30 bg-gradient-to-r from-[#7C3AED]/12 via-[#A855F7]/5 to-transparent flex flex-wrap items-center justify-between gap-3 shrink-0">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold font-display text-slate-900 dark:text-[#F8FAFC]">
                            Henüz bir topluluğa katılmadınız
                          </h3>
                          <p className="text-xs text-slate-600 dark:text-[#A1A1B5] mt-0.5">
                            Kendi sunucunuzu kurun veya herkese açık toplulukları keşfedip sohbete başlayın.
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setCreateServerError('');
                              setCreateServerOpen(true);
                            }}
                            className="h-9 px-3.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors"
                          >
                            Topluluk Oluştur
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate('/discover')}
                            className="h-9 px-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A] text-xs font-semibold hover:border-[#A855F7]/60 transition-colors"
                          >
                            Keşfet
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex-1 min-h-0">
                      <FriendsView
                        onOpenDm={(cid) => {
                          void loadGlobalData();
                          navigate(`/channels/@me/${cid}`);
                        }}
                        onOpenProfile={(uid) => setProfileModalUserId(uid)}
                      />
                    </div>
                  </div>
                )}

                {viewMode === 'home' && conversationId && (
                  <MessageTimeline
                    mode="dm"
                    targetId={conversationId}
                    channelName={activeConversation?.name || undefined}
                    canAttachFiles
                    mentionCandidates={activeConversation?.members || []}
                    onOpenProfile={(uid) => setProfileModalUserId(uid)}
                    onForwardMessage={(msg) => setForwardingMessage(msg)}
                  />
                )}

                {viewMode === 'server' && activeChannel && (activeChannel.type === 'text' || activeChannel.type === 'announcement') && (
                  <MessageTimeline
                    mode="channel"
                    targetId={activeChannel.id}
                    serverId={activeChannel.serverId}
                    channelName={activeChannel.name}
                    canSend={Boolean(canSend)}
                    canAttachFiles={canAttachFiles}
                    canPin={canPin}
                    canDeleteOthers={canDeleteOthers}
                    canEditOthers={canEditOthers}
                    mentionCandidates={members.map((m) => m.profile)}
                    mentionableRoles={roles.filter((r) => r.mentionable && !r.isDefault)}
                    memberRoleColors={memberRoleColorMap}
                    serverEmojis={serverEmojis}
                    serverOwnerId={activeServer?.ownerId}
                    onOpenProfile={(uid) => setProfileModalUserId(uid)}
                    onOpenThread={(tid) => setActiveThreadId(tid)}
                    onForwardMessage={(msg) => setForwardingMessage(msg)}
                  />
                )}

                {viewMode === 'server' && activeChannel && activeChannel.type === 'forum' && (
                  <ForumView
                    channelId={activeChannel.id}
                    channelName={activeChannel.name}
                    canSend={Boolean(canSend)}
                    canModerate={canPin}
                    onOpenProfile={(uid) => setProfileModalUserId(uid)}
                  />
                )}

                {viewMode === 'server' && activeChannel && activeChannel.type === 'voice' && (
                  <VoiceStageView
                    mode="channel"
                    roomId={activeChannel.id}
                    roomTitle={activeChannel.name}
                    serverId={activeServer?.id}
                    serverName={activeServer?.name}
                    isStage={Boolean(activeChannel.isStage)}
                    participants={voiceParticipants[activeChannel.id] || []}
                    canSpeak={Boolean(isOwner || myPermissions.includes('SPEAK_VOICE'))}
                    canScreenShare={Boolean(isOwner || myPermissions.includes('SCREEN_SHARE'))}
                    canMuteOthers={Boolean(isOwner || myPermissions.includes('MUTE_MEMBERS'))}
                    onLeft={() => {}}
                  />
                )}

                {viewMode === 'server' && !activeChannel && (
                  <div className="h-full flex items-center justify-center text-sm text-slate-400 p-6">
                    Görüntülenecek bir kanal seçin veya yeni bir kanal oluşturun.
                  </div>
                )}
              </motion.div>
            </div>

            {viewMode === 'server' && activeThreadId && (
              <ThreadDrawer
                threadId={activeThreadId}
                canPin={canPin}
                onClose={() => setActiveThreadId(null)}
                onOpenProfile={(uid) => setProfileModalUserId(uid)}
              />
            )}

            {/* Pinned Messages Drawer (Overlay on < lg, Docked on lg+) */}
            {showPinsDrawer && (
              <>
                <div
                  onClick={() => setShowPinsDrawer(false)}
                  className="fixed inset-0 z-30 bg-black/40 lg:hidden"
                />
                <aside className="fixed right-0 top-14 bottom-0 z-40 w-72 lg:static lg:z-auto border-l border-slate-200 dark:border-[#29293D] bg-[#F2F4F9] dark:bg-[#151522] p-3 overflow-y-auto shrink-0 shadow-2xl lg:shadow-none">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#29293D] mb-3">
                    <span className="text-xs font-bold">Sabitlenmiş Mesajlar</span>
                    <button type="button" onClick={() => setShowPinsDrawer(false)} className="text-slate-400 hover:text-white">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {pinnedMessages.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-[#A1A1B5] text-center py-8">Sabitlenmiş mesaj yok.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {pinnedMessages.map((pm) => (
                        <div key={pm.id} className="p-2.5 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs space-y-1">
                          <p className="font-semibold">{pm.author.displayName}</p>
                          <p className="text-slate-500 dark:text-[#A1A1B5] break-words">{pm.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </aside>
              </>
            )}

            {/* Members Drawer (Responsive: Overlay on < lg, Docked on lg+) */}
            {viewMode === 'server' && showMembersDrawer && (
              <>
                <div
                  onClick={() => setShowMembersDrawer(false)}
                  className="fixed inset-0 z-30 bg-black/40 lg:hidden"
                />
                <aside className="fixed right-0 top-14 bottom-0 z-40 w-64 lg:static lg:z-auto lg:w-60 border-l border-slate-200 dark:border-[#29293D] bg-[#F2F4F9] dark:bg-[#151522] p-3 overflow-y-auto shrink-0 space-y-4 shadow-2xl lg:shadow-none">
                  <div className="flex items-center justify-between lg:hidden pb-2 border-b border-slate-200 dark:border-[#29293D]">
                    <span className="text-xs font-bold">Sunucu Üyeleri ({members.length})</span>
                    <button type="button" onClick={() => setShowMembersDrawer(false)} className="text-slate-400">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {groupedMemberSections.map((section) => (
                    <div key={section.id} className="space-y-1">
                      <p
                        className="px-2 text-[11px] font-semibold tracking-wide flex items-center gap-1.5"
                        style={section.color ? { color: section.color } : undefined}
                      >
                        {section.icon && <span>{section.icon}</span>}
                        <span className={section.color ? '' : 'text-slate-500 dark:text-slate-400'}>
                          {section.title} — {section.members.length}
                        </span>
                      </p>
                      <div className="space-y-0.5">
                        {section.members.map((m) => {
                          const isOffline = m.profile.status === 'offline';
                          const nameColor = memberRoleColorMap[m.userId];
                          const topIconRole = m.roleIds
                            .map((rid) => roleById.get(rid))
                            .filter((r): r is Role => Boolean(r && !r.isDefault && r.icon))
                            .sort((a, b) => b.position - a.position)[0];
                          return (
                            <button
                              key={m.userId}
                              type="button"
                              onClick={() => setProfileModalUserId(m.userId)}
                              className={`w-full px-2 py-1.5 rounded-xl hover:bg-slate-200/70 dark:hover:bg-[#19192A] flex items-center gap-2.5 text-left transition-colors ${
                                isOffline ? 'opacity-55 hover:opacity-100' : ''
                              }`}
                            >
                              <UserAvatar
                                src={m.profile.avatarUrl}
                                name={m.profile.displayName}
                                status={m.profile.status}
                                frame={m.profile.avatarFrame}
                                size="sm"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  {topIconRole?.icon && (
                                    <span title={topIconRole.name} className="text-[11px] shrink-0">
                                      {topIconRole.icon}
                                    </span>
                                  )}
                                  <p
                                    className="text-xs font-medium truncate"
                                    style={nameColor ? { color: nameColor } : undefined}
                                  >
                                    {m.nickname || m.profile.displayName}
                                  </p>
                                  {m.profile.isBot && <BotBadge verified={m.profile.isVerifiedBot} />}
                                  {activeServer?.ownerId === m.userId && (
                                    <Crown className="w-3 h-3 text-amber-400 shrink-0" aria-label="Sunucu Sahibi" />
                                  )}
                                  {!m.profile.isBot && m.profile.streak && m.profile.streak.currentStreak >= 7 && (
                                    <FlameStreakBadge streak={m.profile.streak} />
                                  )}
                                  {!m.profile.isBot && m.profile.featuredBadge && (
                                    <FeaturedBadgeIcon badgeKey={m.profile.featuredBadge} size={13} />
                                  )}
                                </div>
                                {m.profile.customStatus && (
                                  <p className="text-[10px] text-slate-400 truncate">{m.profile.customStatus}</p>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </aside>
              </>
            )}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (only when not inside an active DM/channel room so composer stays clear) */}
      {!conversationId && !channelId && (
        <nav
          aria-label="Mobil alt gezinme"
          className="md:hidden shrink-0 bg-white/95 dark:bg-[#10111B]/95 backdrop-blur-md border-t border-slate-200 dark:border-[#29293D] px-2 pt-1 pb-safe grid grid-cols-5 gap-1 z-30"
        >
          <button
            type="button"
            onClick={() => {
              setMobileNavOpen(false);
              navigate('/channels/@me');
            }}
            className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              viewMode === 'home' ? 'text-[#7C3AED] dark:text-[#C084FC]' : 'text-slate-500 dark:text-[#A1A1B5]'
            }`}
          >
            <Home className="w-5 h-5" />
            <span>Ana Sayfa</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (viewMode !== 'home') navigate('/channels/@me');
              setMobileNavOpen(true);
            }}
            className="min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-500 dark:text-[#A1A1B5] hover:text-[#C084FC] transition-colors"
          >
            <MessageSquare className="w-5 h-5" />
            <span>Mesajlar</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              viewMode === 'server' || viewMode === 'discover'
                ? 'text-[#7C3AED] dark:text-[#C084FC]'
                : 'text-slate-500 dark:text-[#A1A1B5]'
            }`}
          >
            <Compass className="w-5 h-5" />
            <span>Sunucular</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileNotifSheetOpen(true)}
            className="relative min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-500 dark:text-[#A1A1B5] hover:text-[#C084FC] transition-colors"
          >
            <div className="relative">
              <Bell className="w-5 h-5" />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#EF4444] ring-2 ring-white dark:ring-[#10111B]" />
              )}
            </div>
            <span>Bildirimler</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-500 dark:text-[#A1A1B5] hover:text-[#C084FC] transition-colors"
          >
            <User className="w-5 h-5" />
            <span>Profil</span>
          </button>
        </nav>
      )}

      {/* Mobile Notifications Sheet */}
      {mobileNotifSheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-sm p-0 sm:p-4 md:hidden"
          onClick={() => setMobileNotifSheetOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#151522] border-t sm:border border-slate-200 dark:border-[#29293D] p-5 pb-safe space-y-3 shadow-2xl max-h-[75dvh] flex flex-col"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#29293D] pb-3">
              <span className="font-display font-bold text-sm">Bildirimler ({unreadNotifCount})</span>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/notifications/read-all', { method: 'POST' });
                    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
                  }}
                  className="text-[#7C3AED] dark:text-[#C084FC] font-medium"
                >
                  Tümünü Okundu Yap
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/notifications', { method: 'DELETE' });
                    setNotifications([]);
                  }}
                  className="text-slate-400 hover:text-[#EF4444]"
                >
                  Temizle
                </button>
                <button type="button" onClick={() => setMobileNotifSheetOpen(false)} className="text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-[#29293D]">
              {notifications.length === 0 ? (
                <p className="py-10 text-center text-xs text-slate-400 dark:text-[#A1A1B5]">
                  Henüz bildirim bulunmuyor.
                </p>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={async () => {
                      if (!n.isRead) {
                        await apiFetch(`/notifications/${n.id}/read`, { method: 'POST' });
                        setNotifications((prev) =>
                          prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item))
                        );
                      }
                      setMobileNotifSheetOpen(false);
                      if (n.link) navigate(n.link);
                    }}
                    className={`w-full p-3 text-left text-xs rounded-xl hover:bg-slate-50 dark:hover:bg-[#19192A] ${
                      !n.isRead ? 'bg-[#7C3AED]/10' : ''
                    }`}
                  >
                    <p className="font-semibold">{n.title}</p>
                    <p className="text-slate-500 dark:text-[#A1A1B5] mt-0.5">{n.body}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Server Modal */}
      {createServerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
          onClick={() => {
            setCreateServerError('');
            setCreateServerOpen(false);
          }}
        >
          <form
            noValidate
            onSubmit={handleCreateServer}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] p-6 space-y-4 shadow-2xl max-h-[90dvh] overflow-y-auto animate-orbit-enter"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold font-display">Yeni Sunucu Oluştur</h3>
              <button
                type="button"
                onClick={() => {
                  setCreateServerError('');
                  setCreateServerOpen(false);
                }}
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Hazır Şablon Seç</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(SERVER_TEMPLATES) as ServerTemplateId[]).map((tid) => {
                  const tpl = SERVER_TEMPLATES[tid];
                  const active = newServerTemplate === tid;
                  return (
                    <button
                      key={tid}
                      type="button"
                      onClick={() => setNewServerTemplate(tid)}
                      className={`p-2.5 rounded-xl border text-left transition-colors ${
                        active
                          ? 'border-[#A855F7] bg-[#7C3AED]/15'
                          : 'border-slate-200 dark:border-[#29293D] hover:border-[#A855F7]/50'
                      }`}
                    >
                      <p className="text-xs font-bold text-slate-900 dark:text-[#F8FAFC]">{tpl.title}</p>
                      <p className="text-[10px] text-slate-500 dark:text-[#A1A1B5] line-clamp-2 mt-0.5">{tpl.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Sunucu Adı</label>
              <input
                type="text"
                value={newServerName}
                onChange={(e) => {
                  setNewServerName(e.target.value);
                  if (createServerError) setCreateServerError('');
                }}
                placeholder="ör. Tasarım Topluluğu"
                aria-invalid={Boolean(createServerError)}
                className={`w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border ${
                  createServerError ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                } text-sm`}
              />
              {createServerError && (
                <p role="alert" className="text-xs text-[#EF4444]">
                  {createServerError}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Açıklama</label>
              <textarea
                rows={2}
                value={newServerDesc}
                onChange={(e) => setNewServerDesc(e.target.value)}
                placeholder="Bu topluluk ne hakkında?"
                className="w-full p-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={newServerPublic} onChange={(e) => setNewServerPublic(e.target.checked)} />
              <span>Sunucu Keşfinde herkese açık listelensin</span>
            </label>
            <button
              type="submit"
              className="w-full h-10 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold transition-colors"
            >
              Sunucuyu Kur
            </button>
          </form>
        </div>
      )}

      {/* Discord-style Create Channel / Category Modal */}
      {quickChannelOpen && activeServer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
          onClick={() => {
            setQuickChannelError('');
            setQuickChannelOpen(false);
          }}
        >
          <motion.form
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.16 }}
            noValidate
            onSubmit={handleQuickCreateChannel}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold font-display">Kanal veya Kategori Oluştur</h3>
                <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">{activeServer.name}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setQuickChannelError('');
                  setQuickChannelOpen(false);
                }}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#19192A]"
              >
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                Kanal Türü
              </label>
              <div className="space-y-1.5">
                {[
                  {
                    id: 'text',
                    label: 'Metin Kanalı',
                    desc: 'Mesaj, görsel, GIF, anket ve alt başlık paylaşın.',
                    icon: Hash,
                  },
                  {
                    id: 'voice',
                    label: 'Ses / Sahne Kanalı',
                    desc: 'Sesli sohbet, ekran yayını, mini oyun ve beyaz tahta.',
                    icon: Volume2,
                  },
                  {
                    id: 'forum',
                    label: 'Forum Kanalı',
                    desc: 'Düzenli konular, sorular ve tartışma başlıkları açın.',
                    icon: MessageSquare,
                  },
                  {
                    id: 'announcement',
                    label: 'Duyuru Kanalı',
                    desc: 'Topluluğa önemli haber ve güncellemeleri duyurun.',
                    icon: Megaphone,
                  },
                  {
                    id: 'category',
                    label: 'Kategori',
                    desc: 'Kanalları gruplamak için yeni bir bölüm başlığı oluşturun.',
                    icon: FolderKanban,
                  },
                ].map((opt) => {
                  const Icon = opt.icon;
                  const active = quickChannelType === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setQuickChannelType(opt.id as typeof quickChannelType)}
                      className={`w-full p-2.5 rounded-xl border text-left flex items-center gap-3 transition-colors ${
                        active
                          ? 'border-[#A855F7] bg-[#7C3AED]/15 text-slate-900 dark:text-white'
                          : 'border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] text-slate-600 dark:text-[#A1A1B5] hover:border-[#A855F7]/40'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#C084FC]' : 'text-slate-400'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold">{opt.label}</p>
                        <p className="text-[11px] opacity-80 truncate">{opt.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {quickChannelType !== 'category' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Kategori</label>
                <select
                  value={quickChannelParentId}
                  onChange={(e) => setQuickChannelParentId(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
                >
                  <option value="">Kategorisiz</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">
                {quickChannelType === 'category' ? 'Kategori Adı' : 'Kanal Adı'}
              </label>
              <input
                type="text"
                value={quickChannelName}
                onChange={(e) => {
                  setQuickChannelName(e.target.value);
                  if (quickChannelError) setQuickChannelError('');
                }}
                placeholder={quickChannelType === 'category' ? 'ör. OYUN ODALARI' : 'ör. genel-sohbet'}
                aria-invalid={Boolean(quickChannelError)}
                className={`w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border outline-none ${
                  quickChannelError
                    ? 'border-[#EF4444]'
                    : 'border-slate-200 dark:border-[#29293D] focus:border-[#A855F7]'
                } text-sm`}
              />
              {quickChannelError && (
                <p role="alert" className="text-xs text-[#EF4444]">
                  {quickChannelError}
                </p>
              )}
            </div>

            {quickChannelType !== 'category' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">
                  Kanal Konusu (Opsiyonel)
                </label>
                <input
                  type="text"
                  value={quickChannelTopic}
                  onChange={(e) => setQuickChannelTopic(e.target.value)}
                  placeholder="Üyelerin kanal hakkında bilmesi gerekenler..."
                  className="w-full h-9 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
                />
              </div>
            )}

            {quickChannelType === 'voice' && (
              <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] cursor-pointer text-xs">
                <span className="flex items-center gap-2 font-medium text-[#C084FC]">
                  <Radio className="w-4 h-4" />
                  Sahne Modu (Konuşmacılar & El Kaldırma)
                </span>
                <input
                  type="checkbox"
                  checked={quickChannelIsStage}
                  onChange={(e) => setQuickChannelIsStage(e.target.checked)}
                />
              </label>
            )}

            {quickChannelType !== 'category' && (
              <div className="space-y-2">
                <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] cursor-pointer text-xs">
                  <span className="flex items-center gap-2 font-medium">
                    <Lock className="w-4 h-4 text-slate-400" />
                    Özel Kanal (Yalnızca seçili roller)
                  </span>
                  <input
                    type="checkbox"
                    checked={quickChannelIsPrivate}
                    onChange={(e) => setQuickChannelIsPrivate(e.target.checked)}
                  />
                </label>
                {quickChannelIsPrivate && roles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl bg-slate-50 dark:bg-[#10111B] border border-slate-200 dark:border-[#29293D]">
                    {roles.map((r) => {
                      const checked = quickChannelRoleIds.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() =>
                            setQuickChannelRoleIds((prev) =>
                              checked ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                            )
                          }
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition-colors ${
                            checked
                              ? 'border-[#A855F7] bg-[#7C3AED]/20 text-[#C084FC]'
                              : 'border-slate-200 dark:border-[#29293D] text-slate-500 dark:text-[#A1A1B5]'
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                          {r.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              className="w-full h-10 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold transition-colors"
            >
              {quickChannelType === 'category' ? 'Kategoriyi Oluştur' : 'Kanalı Oluştur'}
            </button>
          </motion.form>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onOpenBadges={() => setBadgeCatalogOpen(true)}
          onOpenAchievements={() => setAchievementsModalOpen(true)}
          onOpenNitro={() => setNitroModalOpen(true)}
        />
      )}

      {achievementsModalOpen && (
        <AchievementsModal
          onClose={() => setAchievementsModalOpen(false)}
          onOpenBadgeCatalog={() => setBadgeCatalogOpen(true)}
        />
      )}

      {nitroModalOpen && (
        <NitroModal
          activeServerId={activeServer?.id}
          activeServerName={activeServer?.name}
          onClose={() => setNitroModalOpen(false)}
          onServerUpdated={() => {
            if (activeServer?.id) {
              void loadServerDetail(activeServer.id);
            }
            void loadGlobalData();
          }}
        />
      )}

      {badgeCatalogOpen && <BadgeCatalogModal onClose={() => setBadgeCatalogOpen(false)} />}

      {commandPaletteOpen && (
        <CommandPaletteModal
          servers={servers}
          channels={channels}
          activeServer={activeServer}
          conversations={conversations}
          onClose={() => setCommandPaletteOpen(false)}
          onNavigate={(p) => navigate(p)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenMyProfile={() => me && setProfileModalUserId(me.userId)}
          onOpenBadgeCatalog={() => setBadgeCatalogOpen(true)}
          onOpenCreateServer={() => setCreateServerOpen(true)}
          onToggleTheme={() => void handleToggleTheme()}
        />
      )}

      {serverSettingsOpen && activeServer && (
        <ServerSettingsModal
          server={activeServer}
          channels={channels}
          roles={roles}
          members={members}
          bans={bans}
          myPermissions={myPermissions}
          initialTab={serverSettingsInitialTab}
          onOpenNitroModal={() => setNitroModalOpen(true)}
          onClose={() => {
            setServerSettingsOpen(false);
            setServerSettingsInitialTab(undefined);
          }}
          onRefresh={() => {
            void loadGlobalData();
            void loadServerDetail(activeServer.id);
          }}
          onServerDeleted={() => {
            void loadGlobalData();
            navigate('/channels/@me');
          }}
        />
      )}

      {searchOpen && (
        <SearchModal
          activeServerId={viewMode === 'server' ? serverId : undefined}
          onClose={() => setSearchOpen(false)}
          onNavigateChannel={(sid, cid) => navigate(`/channels/${sid}/${cid}`)}
          onOpenProfile={(uid) => setProfileModalUserId(uid)}
        />
      )}

      {forwardingMessage && (
        <ForwardMessageModal
          message={forwardingMessage}
          channels={channels}
          conversations={conversations}
          sourceChannelName={activeChannel?.name}
          onClose={() => setForwardingMessage(null)}
        />
      )}

      {groupDmModalOpen && (
        <GroupDmModal
          conversation={managingGroupConv}
          onClose={() => {
            setGroupDmModalOpen(false);
            setManagingGroupConv(null);
          }}
          onCreated={(cid) => {
            void loadGlobalData();
            navigate(`/channels/@me/${cid}`);
          }}
          onUpdated={() => {
            void loadGlobalData();
          }}
        />
      )}

      {onboardingOpen && activeServer && (
        <OnboardingModal
          serverName={activeServer.name}
          onboarding={
            onboardingState?.enabled
              ? onboardingState
              : {
                  serverId: activeServer.id,
                  enabled: true,
                  promptTitle: 'Topluluk Kuralları & Bilgilendirme',
                  rulesText:
                    onboardingState?.rulesText ||
                    '1. Tüm üyelere karşı saygılı ve nazik olun.\n2. Spam, flood ve izinsiz reklam paylaşmayın.\n3. Kanal konularına ve moderasyon uyarılarına uyun.\n4. Kişisel veri paylaşmayın, hesap güvenliğini koruyun.',
                  roles: onboardingState?.roles || [],
                  accepted: true,
                  myRoleIds: onboardingState?.myRoleIds || [],
                }
          }
          onClose={() => setOnboardingOpen(false)}
          onCompleted={() => void loadServerDetail(activeServer.id)}
        />
      )}

      {profileModalUserId && (() => {
        const targetMember = activeServer ? members.find((m) => m.userId === profileModalUserId) : undefined;
        return (
          <UserProfileModal
            userId={profileModalUserId}
            serverContext={
              activeServer && targetMember
                ? {
                    serverId: activeServer.id,
                    serverName: activeServer.name,
                    isOwner: activeServer.ownerId === targetMember.userId,
                    roles,
                    memberRoleIds: targetMember.roleIds,
                    joinedAt: targetMember.joinedAt,
                  }
                : undefined
            }
            onClose={() => setProfileModalUserId(null)}
            onEditProfile={() => {
              setProfileModalUserId(null);
              setSettingsOpen(true);
            }}
            onOpenBadges={() => setBadgeCatalogOpen(true)}
            onOpenDm={(cid) => {
              void loadGlobalData();
              navigate(`/channels/@me/${cid}`);
            }}
          />
        );
      })()}
    </div>
  );
}
