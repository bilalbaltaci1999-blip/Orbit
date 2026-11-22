import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  Copy,
  Edit3,
  Eye,
  FolderKanban,
  Hash,
  LayoutTemplate,
  Link2,
  Lock,
  Plus,
  Rocket,
  Send,
  Shield,
  ShieldAlert,
  SmilePlus,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { apiFetch, ApiError, resolveMediaUrl } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { useToast } from '../client/ToastContext.tsx';
import {
  ALL_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_MEMBER_PERMISSIONS,
  DEFAULT_MODERATOR_PERMISSIONS,
  PERMISSION_LABELS,
  type Permission,
} from '../shared/permissions.ts';
import { SERVER_TEMPLATES, type ServerTemplateId } from '../shared/templates.ts';
import type {
  AutoModConfig,
  Channel,
  ChannelOverridePermission,
  ChannelPermissionOverride,
  Invitation,
  ModerationLog,
  OnboardingState,
  Role,
  ServerAnalytics,
  ServerBoostDetails,
  ServerBotConfig,
  ServerEmoji,
  ServerMember,
  ServerSummary,
  ServerWebhook,
} from '../shared/types.ts';
import { BotBadge } from './BotBadge.tsx';
import { SingleColorPickerButton } from './SingleColorPickerButton.tsx';
import { UserAvatar } from './UserAvatar.tsx';

export type ServerSettingsTabId =
  | 'general'
  | 'analytics'
  | 'rockets'
  | 'templates'
  | 'channels'
  | 'roles'
  | 'overrides'
  | 'emojis'
  | 'automod'
  | 'onboarding'
  | 'members'
  | 'invites'
  | 'webhooks'
  | 'logs';

interface Props {
  server: ServerSummary;
  channels: Channel[];
  roles: Role[];
  members: ServerMember[];
  bans: Array<{ userId: string; reason: string; profile: { displayName: string; username: string } | null }>;
  myPermissions: Permission[];
  initialTab?: ServerSettingsTabId;
  onOpenNitroModal?: () => void;
  onClose: () => void;
  onRefresh: () => void;
  onServerDeleted: () => void;
}

const OVERRIDE_PERM_META: Array<{ key: ChannelOverridePermission; label: string }> = [
  { key: 'VIEW_CHANNEL', label: 'Kanalı Görüntüle' },
  { key: 'SEND_MESSAGES', label: 'Mesaj Gönder' },
  { key: 'ATTACH_FILES', label: 'Dosya & Ses Ekle' },
  { key: 'CONNECT_VOICE', label: 'Ses Odasına Bağlan' },
];

export function ServerSettingsModal({
  server,
  channels,
  roles,
  members,
  bans,
  myPermissions,
  initialTab,
  onOpenNitroModal,
  onClose,
  onRefresh,
  onServerDeleted,
}: Props) {
  const { profile: me } = useAuth();
  const { showToast } = useToast();
  const isOwner = me?.userId === server.ownerId;
  const canManageServer = isOwner || myPermissions.includes('MANAGE_SERVER');
  const canManageChannels = isOwner || myPermissions.includes('MANAGE_CHANNELS');
  const canManageRoles = isOwner || myPermissions.includes('MANAGE_ROLES');
  const canManageMembers = isOwner || myPermissions.includes('MANAGE_MEMBERS');
  const canInvites = isOwner || myPermissions.includes('CREATE_INVITES');

  const [tab, setTab] = useState<ServerSettingsTabId>(
    initialTab || (canManageServer ? 'general' : canManageChannels ? 'channels' : canManageRoles ? 'roles' : 'rockets')
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(!initialTab);

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
      setMobileMenuOpen(false);
    }
  }, [initialTab]);

  // General state
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description);
  const [isDiscoverable, setIsDiscoverable] = useState(server.isDiscoverable);
  const [moderationLevel, setModerationLevel] = useState(server.moderationLevel);
  const [blockedWords, setBlockedWords] = useState(server.blockedWords);
  const [blockLinks, setBlockLinks] = useState(server.blockLinks);
  const [slowmodeSeconds, setSlowmodeSeconds] = useState(server.slowmodeSeconds);

  // Channel state
  const [newChName, setNewChName] = useState('');
  const [newChTopic, setNewChTopic] = useState('');
  const [newChType, setNewChType] = useState<'category' | 'text' | 'voice' | 'announcement' | 'forum'>('text');
  const [newChParent, setNewChParent] = useState<string>('');
  const [newChPrivate, setNewChPrivate] = useState(false);
  const [newChStage, setNewChStage] = useState(false);
  const [newChRoles, setNewChRoles] = useState<string[]>([]);

  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [editChName, setEditChName] = useState('');
  const [editChTopic, setEditChTopic] = useState('');
  const [editChPrivate, setEditChPrivate] = useState(false);
  const [editChStage, setEditChStage] = useState(false);

  // Validation error states
  const [generalNameError, setGeneralNameError] = useState<string | null>(null);
  const [newChannelError, setNewChannelError] = useState<string | null>(null);
  const [editChannelError, setEditChannelError] = useState<string | null>(null);
  const [roleNameError, setRoleNameError] = useState<string | null>(null);
  const [emojiErrors, setEmojiErrors] = useState<{ name?: string; file?: string }>({});
  const [webhookErrors, setWebhookErrors] = useState<{ name?: string; channel?: string }>({});

  // Roles state
  const [selectedRoleId, setSelectedRoleId] = useState<string>(roles[0]?.id || '');
  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const [roleName, setRoleName] = useState(selectedRole?.name || '');
  const [roleColor, setRoleColor] = useState(selectedRole?.color || '#7C3AED');
  const [rolePerms, setRolePerms] = useState<Permission[]>(selectedRole?.permissions || []);
  const [roleHoist, setRoleHoist] = useState(Boolean(selectedRole?.hoist));
  const [roleMentionable, setRoleMentionable] = useState(Boolean(selectedRole?.mentionable));
  const [roleIcon, setRoleIcon] = useState(selectedRole?.icon || '');
  const [roleDescription, setRoleDescription] = useState(selectedRole?.description || '');
  const [rolePreviewOpen, setRolePreviewOpen] = useState(false);
  const [rolePreviewLoading, setRolePreviewLoading] = useState(false);
  const [rolePreviewChannels, setRolePreviewChannels] = useState<
    Array<{ channelId: string; name: string; type: string; isPrivate: boolean; canView: boolean; canSend: boolean; canConnect: boolean }>
  >([]);

  useEffect(() => {
    if (selectedRole) {
      setRoleName(selectedRole.name);
      setRoleColor(selectedRole.color);
      setRolePerms(selectedRole.permissions);
      setRoleHoist(Boolean(selectedRole.hoist));
      setRoleMentionable(Boolean(selectedRole.mentionable));
      setRoleIcon(selectedRole.icon || '');
      setRoleDescription(selectedRole.description || '');
      setRolePreviewOpen(false);
      setRolePreviewChannels([]);
    }
  }, [selectedRole]);

  // Channel Overrides state
  const nonCatChannels = channels.filter((c) => c.type !== 'category');
  const [overrideChannelId, setOverrideChannelId] = useState<string>(nonCatChannels[0]?.id || '');
  const [overridesMap, setOverridesMap] = useState<Record<string, ChannelPermissionOverride>>({});

  // Custom Server Emojis state
  const [emojis, setEmojis] = useState<ServerEmoji[]>([]);
  const [emojiName, setEmojiName] = useState('');
  const [emojiFile, setEmojiFile] = useState<File | null>(null);
  const [emojiUploading, setEmojiUploading] = useState(false);

  // AutoMod & Welcome state
  const [automod, setAutomod] = useState<AutoModConfig>({
    serverId: server.id,
    enabled: false,
    blockBadWords: true,
    badWords: '',
    blockInvites: true,
    antiSpam: true,
    maxMentions: 5,
    timeoutMinutes: 5,
    welcomeEnabled: false,
    welcomeChannelId: null,
    welcomeMessage: 'Hoş geldin {user}! {server} topluluğuna katıldın.',
  });

  // Onboarding state
  const [onboarding, setOnboarding] = useState<OnboardingState>({
    serverId: server.id,
    enabled: false,
    promptTitle: 'Topluluğa Hoş Geldiniz',
    rulesText: '1. Saygılı olun ve topluluk kurallarına uyun.\n2. Spam yapmayın.',
    roles: [],
    accepted: false,
    myRoleIds: [],
  });

  // Analytics & Rockets state
  const [analytics, setAnalytics] = useState<ServerAnalytics | null>(null);
  const [boostDetails, setBoostDetails] = useState<ServerBoostDetails | null>(null);
  const [boostLoading, setBoostLoading] = useState(false);
  const [boostBusy, setBoostBusy] = useState(false);

  // Members filter & nicknames
  const [memberSearch, setMemberSearch] = useState('');
  const [banSearch, setBanSearch] = useState('');
  const [editingNickUserId, setEditingNickUserId] = useState<string | null>(null);
  const [nickDraft, setNickDraft] = useState('');

  // Invites
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [inviteMaxUses, setInviteMaxUses] = useState<string>('');
  const [inviteExpiryHours, setInviteExpiryHours] = useState<string>('24');

  // Webhooks & Bots
  const textChannels = channels.filter((c) => c.type === 'text' || c.type === 'announcement');
  const [webhooks, setWebhooks] = useState<ServerWebhook[]>([]);
  const [webhookName, setWebhookName] = useState('');
  const [webhookChannelId, setWebhookChannelId] = useState(textChannels[0]?.id || '');
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [officialBot, setOfficialBot] = useState<ServerBotConfig | null>(null);
  const [botWelcomeChId, setBotWelcomeChId] = useState('');
  const [botPrefix, setBotPrefix] = useState('/');
  const [botBusy, setBotBusy] = useState(false);

  // Logs & Reports
  const [logs, setLogs] = useState<ModerationLog[]>([]);
  const [reports, setReports] = useState<
    Array<{ id: string; target_type: string; reason: string; reporter_name: string; created_at: string }>
  >([]);

  useEffect(() => {
    if (!webhookChannelId && textChannels[0]?.id) {
      setWebhookChannelId(textChannels[0].id);
    }
    if (!overrideChannelId && nonCatChannels[0]?.id) {
      setOverrideChannelId(nonCatChannels[0].id);
    }
  }, [textChannels, webhookChannelId, nonCatChannels, overrideChannelId]);

  useEffect(() => {
    if (tab === 'invites' && canInvites) {
      apiFetch<{ invites: Invitation[] }>(`/servers/${server.id}/invites`)
        .then((res) => setInvites(res.invites))
        .catch(() => {});
    } else if (tab === 'webhooks' && (canManageServer || canManageChannels)) {
      Promise.all([
        apiFetch<{ webhooks: ServerWebhook[] }>(`/servers/${server.id}/webhooks`),
        apiFetch<{ officialBot: ServerBotConfig | null }>(`/servers/${server.id}/bots`),
      ])
        .then(([wRes, bRes]) => {
          setWebhooks(wRes.webhooks);
          setOfficialBot(bRes.officialBot);
          if (bRes.officialBot) {
            setBotWelcomeChId(bRes.officialBot.welcomeChannelId || '');
            setBotPrefix(bRes.officialBot.prefix || '/');
          }
        })
        .catch(() => {});
    } else if (tab === 'logs' && canManageServer) {
      Promise.all([
        apiFetch<{ logs: ModerationLog[] }>(`/servers/${server.id}/moderation-logs`),
        apiFetch<{ reports: typeof reports }>(`/servers/${server.id}/reports`),
      ])
        .then(([l, r]) => {
          setLogs(l.logs);
          setReports(r.reports);
        })
        .catch(() => {});
    } else if (tab === 'analytics') {
      apiFetch<{ analytics: ServerAnalytics }>(`/servers/${server.id}/analytics`)
        .then((res) => setAnalytics(res.analytics))
        .catch(() => {});
    } else if (tab === 'rockets') {
      setBoostLoading(true);
      apiFetch<ServerBoostDetails>(`/servers/${server.id}/boosts`)
        .then((res) => setBoostDetails(res))
        .catch(() => {})
        .finally(() => setBoostLoading(false));
    } else if (tab === 'emojis') {
      apiFetch<{ emojis: ServerEmoji[] }>(`/servers/${server.id}/emojis`)
        .then((res) => setEmojis(res.emojis))
        .catch(() => {});
    } else if (tab === 'automod' && canManageServer) {
      apiFetch<{ automod: AutoModConfig }>(`/servers/${server.id}/automod`)
        .then((res) => setAutomod(res.automod))
        .catch(() => {});
    } else if (tab === 'onboarding' && (canManageServer || canManageRoles)) {
      apiFetch<{ onboarding: OnboardingState }>(`/servers/${server.id}/onboarding`)
        .then((res) => setOnboarding(res.onboarding))
        .catch(() => {});
    }
  }, [tab, server.id, canInvites, canManageServer, canManageChannels, canManageRoles]);

  useEffect(() => {
    if (tab === 'overrides' && overrideChannelId && (canManageChannels || canManageRoles)) {
      apiFetch<{ overrides: ChannelPermissionOverride[] }>(`/channels/${overrideChannelId}/overrides`)
        .then((res) => {
          const map: Record<string, ChannelPermissionOverride> = {};
          for (const ov of res.overrides) {
            map[ov.roleId] = ov;
          }
          setOverridesMap(map);
        })
        .catch(() => setOverridesMap({}));
    }
  }, [tab, overrideChannelId, canManageChannels, canManageRoles]);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setGeneralNameError('Sunucu adı boş bırakılamaz.');
      return;
    }
    if (trimmedName.length < 2) {
      setGeneralNameError('Sunucu adı en az 2 karakter olmalıdır.');
      return;
    }
    setGeneralNameError(null);
    try {
      await apiFetch(`/servers/${server.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: trimmedName,
          description,
          isDiscoverable,
          moderationLevel,
          blockedWords,
          blockLinks,
          slowmodeSeconds: Number(slowmodeSeconds) || 0,
        }),
      });
      showToast('Sunucu ayarları kaydedildi.', 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Kaydedilemedi.', 'error');
    }
  };

  const handleIconUpload = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('icon', file);
    try {
      await apiFetch(`/servers/${server.id}/icon`, { method: 'POST', body: fd });
      showToast('Sunucu simgesi güncellendi.', 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Simge yüklenemedi.', 'error');
    }
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChName.trim()) {
      setNewChannelError('Kanal veya kategori adı boş bırakılamaz.');
      return;
    }
    setNewChannelError(null);
    try {
      await apiFetch(`/servers/${server.id}/channels`, {
        method: 'POST',
        body: JSON.stringify({
          name: newChName.trim(),
          topic: newChTopic,
          type: newChType,
          parentId: newChParent || null,
          isPrivate: newChPrivate,
          isStage: newChType === 'voice' ? newChStage : false,
          allowedRoleIds: newChPrivate ? newChRoles : undefined,
        }),
      });
      setNewChName('');
      setNewChTopic('');
      setNewChPrivate(false);
      setNewChStage(false);
      setNewChRoles([]);
      setNewChannelError(null);
      showToast('Kanal oluşturuldu.', 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Kanal oluşturulamadı.', 'error');
    }
  };

  const handleSaveChannelEdit = async (chId: string) => {
    if (!editChName.trim()) {
      setEditChannelError('Kanal adı boş bırakılamaz.');
      return;
    }
    setEditChannelError(null);
    try {
      await apiFetch(`/channels/${chId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editChName.trim(),
          topic: editChTopic.trim(),
          isPrivate: editChPrivate,
          isStage: editChStage,
        }),
      });
      setEditingChannelId(null);
      setEditChannelError(null);
      showToast('Kanal güncellendi.', 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Kanal güncellenemedi.', 'error');
    }
  };

  const handleMoveChannel = async (channelId: string, dir: -1 | 1) => {
    const idx = channels.findIndex((c) => c.id === channelId);
    if (idx === -1) return;
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= channels.length) return;
    const ordered = [...channels];
    const [moved] = ordered.splice(idx, 1);
    ordered.splice(targetIdx, 0, moved);
    await apiFetch(`/servers/${server.id}/channels/reorder`, {
      method: 'POST',
      body: JSON.stringify({ orderedIds: ordered.map((c) => c.id) }),
    });
    onRefresh();
  };

  const handleCreateRole = async () => {
    try {
      const res = await apiFetch<{ roleId: string }>(`/servers/${server.id}/roles`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Yeni Rol', color: '#7C3AED' }),
      });
      setSelectedRoleId(res.roleId);
      setRoleNameError(null);
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Rol oluşturulamadı.', 'error');
    }
  };

  const handleSaveRole = async () => {
    if (!selectedRole) return;
    if (!roleName.trim()) {
      setRoleNameError('Rol adı boş bırakılamaz.');
      return;
    }
    setRoleNameError(null);
    try {
      await apiFetch(`/roles/${selectedRole.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: roleName.trim(),
          color: roleColor,
          permissions: rolePerms,
          hoist: roleHoist,
          mentionable: roleMentionable,
          icon: roleIcon,
          description: roleDescription.trim(),
        }),
      });
      showToast('Rol güncellendi.', 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Rol kaydedilemedi.', 'error');
    }
  };

  const handleMoveRolePosition = async (role: Role, dir: 'up' | 'down') => {
    const nonDefault = [...roles].filter((r) => !r.isDefault).sort((a, b) => b.position - a.position);
    const idx = nonDefault.findIndex((r) => r.id === role.id);
    if (idx === -1) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= nonDefault.length) return;
    const target = nonDefault[swapIdx];
    const posA = role.position;
    const posB = target.position === posA ? (dir === 'up' ? posA + 1 : Math.max(1, posA - 1)) : target.position;
    try {
      await apiFetch(`/roles/${role.id}`, { method: 'PATCH', body: JSON.stringify({ position: posB }) });
      await apiFetch(`/roles/${target.id}`, { method: 'PATCH', body: JSON.stringify({ position: posA }) });
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Rol sırası güncellenemedi.', 'error');
    }
  };

  const handleToggleRolePreview = async (roleId: string) => {
    if (rolePreviewOpen) {
      setRolePreviewOpen(false);
      return;
    }
    setRolePreviewLoading(true);
    setRolePreviewOpen(true);
    try {
      const res = await apiFetch<{ channels: typeof rolePreviewChannels }>(`/servers/${server.id}/roles/${roleId}/preview`);
      setRolePreviewChannels(res.channels || []);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Kanal önizlemesi alınamadı.', 'error');
      setRolePreviewOpen(false);
    } finally {
      setRolePreviewLoading(false);
    }
  };

  const handleToggleRocketBoost = async () => {
    if (boostBusy) return;
    const currentlyBoosted = Boolean(boostDetails?.myBoosted);
    if (!currentlyBoosted && me?.nitroTier !== 'nitro' && onOpenNitroModal) {
      onClose();
      onOpenNitroModal();
      return;
    }
    setBoostBusy(true);
    try {
      await apiFetch(`/nitro/boost/${server.id}`, { method: currentlyBoosted ? 'DELETE' : 'POST' });
      const refreshed = await apiFetch<ServerBoostDetails>(`/servers/${server.id}/boosts`);
      setBoostDetails(refreshed);
      showToast(
        currentlyBoosted
          ? 'Roket takviyeniz sunucudan geri çekildi.'
          : '🚀 Roket fırlatıldı! Sunucu takviye edildi ve Roket Takviyecisi rolünüz tanımlandı.',
        'success'
      );
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Roket takviyesi güncellenemedi.', 'error');
    } finally {
      setBoostBusy(false);
    }
  };

  const handleSetOverrideState = (roleId: string, perm: ChannelOverridePermission, state: 'allow' | 'inherit' | 'deny') => {
    setOverridesMap((prev) => {
      const existing = prev[roleId] || { channelId: overrideChannelId, roleId, allowPerms: [], denyPerms: [] };
      const allow = existing.allowPerms.filter((p) => p !== perm);
      const deny = existing.denyPerms.filter((p) => p !== perm);
      if (state === 'allow') allow.push(perm);
      if (state === 'deny') deny.push(perm);
      return {
        ...prev,
        [roleId]: { ...existing, allowPerms: allow, denyPerms: deny },
      };
    });
  };

  const handleSaveOverrides = async () => {
    if (!overrideChannelId) return;
    try {
      await apiFetch(`/channels/${overrideChannelId}/overrides`, {
        method: 'PUT',
        body: JSON.stringify({ overrides: Object.values(overridesMap) }),
      });
      showToast('Kanal izin matrisi kaydedildi.', 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'İzin matrisi kaydedilemedi.', 'error');
    }
  };

  const handleUploadEmoji = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { name?: string; file?: string } = {};
    const trimmedEmoji = emojiName.trim();
    if (!trimmedEmoji) {
      errs.name = 'Emoji adı boş bırakılamaz.';
    } else if (trimmedEmoji.length < 2) {
      errs.name = 'En az 2 karakter olmalıdır.';
    }
    if (!emojiFile) {
      errs.file = 'Lütfen bir emoji görseli seçin.';
    }
    setEmojiErrors(errs);
    if (Object.keys(errs).length > 0 || !emojiFile) return;

    setEmojiUploading(true);
    try {
      const fd = new FormData();
      fd.append('name', trimmedEmoji);
      fd.append('emoji', emojiFile);
      const res = await apiFetch<{ emoji: ServerEmoji }>(`/servers/${server.id}/emojis`, {
        method: 'POST',
        body: fd,
      });
      setEmojis((prev) => [...prev, res.emoji]);
      setEmojiName('');
      setEmojiFile(null);
      setEmojiErrors({});
      showToast(`:${res.emoji.name}: emojisi eklendi.`, 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Emoji eklenemedi.', 'error');
    } finally {
      setEmojiUploading(false);
    }
  };

  const handleSaveAutoMod = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch(`/servers/${server.id}/automod`, {
        method: 'PUT',
        body: JSON.stringify(automod),
      });
      showToast('AutoMod ve karşılama kuralları kaydedildi.', 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Kaydedilemedi.', 'error');
    }
  };

  const handleSaveOnboarding = async () => {
    try {
      await apiFetch(`/servers/${server.id}/onboarding`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: onboarding.enabled,
          promptTitle: onboarding.promptTitle,
          rulesText: onboarding.rulesText,
          roles: onboarding.roles,
        }),
      });
      showToast('Karşılama & Kendin Seç ayarları kaydedildi.', 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Kaydedilemedi.', 'error');
    }
  };

  const handleApplyTemplate = async (templateId: ServerTemplateId) => {
    try {
      const res = await apiFetch<{ templateTitle: string }>(`/servers/${server.id}/apply-template`, {
        method: 'POST',
        body: JSON.stringify({ templateId }),
      });
      showToast(`${res.templateTitle} şablonu kanalları sunucuya eklendi.`, 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Şablon uygulanamadı.', 'error');
    }
  };

  const handleSaveNickname = async (targetUserId: string) => {
    try {
      await apiFetch(`/servers/${server.id}/members/${targetUserId}/nickname`, {
        method: 'PATCH',
        body: JSON.stringify({ nickname: nickDraft }),
      });
      setEditingNickUserId(null);
      showToast('Sunucu takma adı güncellendi.', 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Takma ad güncellenemedi.', 'error');
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ invite: Invitation }>(`/servers/${server.id}/invites`, {
        method: 'POST',
        body: JSON.stringify({
          maxUses: inviteMaxUses ? Number(inviteMaxUses) : null,
          expiresInHours: inviteExpiryHours ? Number(inviteExpiryHours) : null,
        }),
      });
      setInvites((prev) => [res.invite, ...prev]);
      showToast('Davet bağlantısı oluşturuldu.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Davet oluşturulamadı.', 'error');
    }
  };

  const copyInviteUrl = async (code: string) => {
    const url = `${window.location.origin}/invite/${code}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    showToast('Davet bağlantısı kopyalandı.', 'success');
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { name?: string; channel?: string } = {};
    const trimmedWh = webhookName.trim();
    if (!trimmedWh) {
      errs.name = 'Bot / webhook adı boş bırakılamaz.';
    } else if (trimmedWh.length < 2) {
      errs.name = 'En az 2 karakter olmalıdır.';
    }
    if (!webhookChannelId) {
      errs.channel = 'Lütfen hedef bir metin kanalı seçin.';
    }
    setWebhookErrors(errs);
    if (Object.keys(errs).length > 0) return;

    try {
      const res = await apiFetch<{ webhook: ServerWebhook }>(`/servers/${server.id}/webhooks`, {
        method: 'POST',
        body: JSON.stringify({ name: trimmedWh, channelId: webhookChannelId }),
      });
      setWebhooks((prev) => [res.webhook, ...prev]);
      setWebhookName('');
      setWebhookErrors({});
      showToast('Bot / Webhook entegrasyonu oluşturuldu!', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Webhook oluşturulamadı.', 'error');
    }
  };

  const handleCopyWebhookUrl = async (wh: ServerWebhook) => {
    const url = `${window.location.origin}/api/webhooks/${wh.id}/${wh.token}`;
    await navigator.clipboard?.writeText(url).catch(() => {});
    showToast('Webhook API bağlantısı kopyalandı.', 'success');
  };

  const handleTestWebhook = async (wh: ServerWebhook) => {
    setTestingWebhookId(wh.id);
    try {
      const resp = await fetch(`/api/webhooks/${wh.id}/${wh.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `🤖 **${wh.name}** bot bağlantısı doğrulandı! Otomatik bildirimler artık #${wh.channelName} kanalına düşecek.`,
        }),
      });
      if (!resp.ok) throw new Error('Webhook gönderimi başarısız.');
      showToast(`#${wh.channelName} kanalına test bot mesajı gönderildi.`, 'success');
      onRefresh();
    } catch {
      showToast('Test mesajı gönderilemedi.', 'error');
    } finally {
      setTestingWebhookId(null);
    }
  };

  const categories = channels.filter((c) => c.type === 'category');
  const filteredBans = bans.filter(
    (b) =>
      (b.profile?.displayName || b.userId).toLowerCase().includes(banSearch.toLowerCase()) ||
      b.reason.toLowerCase().includes(banSearch.toLowerCase())
  );

  const assignableRoles = roles.filter((r) => !r.isDefault && !r.isAdmin);

  const serverCategories: Array<{
    title: string;
    items: Array<{ id: ServerSettingsTabId; label: string; icon: React.ComponentType<{ className?: string }>; show: boolean }>;
  }> = [
    {
      title: 'GENEL YÖNETİM',
      items: [
        { id: 'general', label: 'Genel & Güvenlik', icon: Shield, show: canManageServer },
        { id: 'analytics', label: 'Sunucu İstatistikleri', icon: BarChart3, show: true },
        { id: 'rockets', label: 'Roketler & Takviye', icon: Rocket, show: true },
        { id: 'templates', label: 'Şablon Uygula', icon: LayoutTemplate, show: canManageServer && canManageChannels },
      ],
    },
    {
      title: 'KANAL & İZİNLER',
      items: [
        { id: 'channels', label: 'Kanallar & Sahne', icon: FolderKanban, show: canManageChannels },
        { id: 'roles', label: 'Roller & İzinler', icon: Lock, show: canManageRoles },
        { id: 'overrides', label: 'Kanal İzin Matrisi', icon: Hash, show: canManageChannels || canManageRoles },
      ],
    },
    {
      title: 'TOPLULUK & OTOMASYON',
      items: [
        { id: 'emojis', label: 'Özel Emojiler', icon: SmilePlus, show: canManageServer || canManageChannels },
        { id: 'automod', label: 'AutoMod & Hoş Geldin', icon: ShieldAlert, show: canManageServer },
        { id: 'onboarding', label: 'Karşılama & Kendin Seç', icon: Sparkles, show: canManageServer || canManageRoles },
        {
          id: 'members',
          label: 'Üyeler & Moderasyon',
          icon: Users,
          show: canManageMembers || myPermissions.includes('KICK_MEMBERS') || myPermissions.includes('BAN_MEMBERS'),
        },
        { id: 'invites', label: 'Davet Bağlantıları', icon: Link2, show: canInvites },
        { id: 'webhooks', label: 'Botlar & Webhooklar', icon: Bot, show: canManageServer || canManageChannels },
        { id: 'logs', label: 'Denetim Kayıtları', icon: Shield, show: canManageServer },
      ],
    },
  ];

  const activeTabLabel =
    serverCategories.flatMap((c) => c.items).find((i) => i.id === tab)?.label || 'Sunucu Yönetimi';

  const selectTab = (id: ServerSettingsTabId) => {
    setTab(id);
    setMobileMenuOpen(false);
    setGeneralNameError(null);
    setNewChannelError(null);
    setEditChannelError(null);
    setRoleNameError(null);
    setEmojiErrors({});
    setWebhookErrors({});
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl h-[92dvh] sm:h-[88dvh] rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-2xl flex flex-col md:flex-row overflow-hidden animate-orbit-enter"
      >
        {/* ORBIT Vertical Categorized Navigation */}
        <aside
          className={`${
            mobileMenuOpen ? 'flex flex-1 md:flex-none' : 'hidden md:flex'
          } md:w-64 md:border-r border-slate-200 dark:border-[#29293D] shrink-0 bg-slate-50 dark:bg-[#10111B] flex-col min-h-0`}
        >
          <div className="px-4 py-3.5 border-b border-slate-200 dark:border-[#29293D] flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#A855F7]">Sunucu Ayarları</p>
              <p className="text-sm font-bold font-display truncate">{server.name}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="md:hidden p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-[#19192A] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-5">
            {serverCategories.map((cat) => {
              const visibleItems = cat.items.filter((i) => i.show);
              if (visibleItems.length === 0) return null;
              return (
                <div key={cat.title} className="space-y-1">
                  <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                    {cat.title}
                  </p>
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const active = tab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectTab(item.id)}
                        className={`w-full px-3 py-2.5 md:py-2 rounded-xl text-xs font-medium flex items-center justify-between gap-2 transition-colors min-h-[42px] md:min-h-[36px] ${
                          active
                            ? 'md:bg-[#7C3AED] md:text-white bg-[#7C3AED]/15 text-[#7C3AED] dark:text-[#C084FC]'
                            : 'text-slate-700 dark:text-[#F8FAFC]/80 hover:bg-slate-200/70 dark:hover:bg-[#19192A]'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </span>
                        <ChevronRight className="w-4 h-4 opacity-50 md:hidden shrink-0" />
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {isOwner && (
              <div className="pt-2 border-t border-slate-200 dark:border-[#29293D]">
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('Bu sunucuyu kalıcı olarak silmek istediğinize emin misiniz?')) return;
                    await apiFetch(`/servers/${server.id}`, { method: 'DELETE' });
                    showToast('Sunucu silindi.', 'info');
                    onServerDeleted();
                    onClose();
                  }}
                  className="w-full px-3 py-2.5 md:py-2 rounded-xl text-xs font-semibold text-[#EF4444] hover:bg-[#EF4444]/10 flex items-center gap-2.5 min-h-[42px] md:min-h-[36px] transition-colors"
                >
                  <Trash2 className="w-4 h-4 shrink-0" />
                  Sunucuyu Sil
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Content */}
        <div className={`${mobileMenuOpen ? 'hidden md:flex' : 'flex'} flex-1 flex-col min-h-0 min-w-0`}>
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-[#29293D] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="md:hidden px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#19192A] border border-transparent dark:border-[#29293D] text-xs font-semibold inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Sunucu Ayarları
              </button>
              <h3 className="text-base font-bold font-display truncate">{activeTabLabel}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#19192A] shrink-0 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6">
            {tab === 'general' && (
              <form noValidate onSubmit={handleSaveGeneral} className="space-y-5 max-w-xl">
                <div className="p-3.5 rounded-xl border border-[#A855F7]/30 bg-[#7C3AED]/10 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5 text-xs">
                    <Rocket className="w-4 h-4 text-[#A855F7] shrink-0" />
                    <div>
                      <p className="font-bold text-[#C084FC]">
                        Sunucu Roketleri · Seviye {server.boostLevel || 0}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">
                        Bu sunucuda aktif {server.boostCount || 0} Roket takviyesi bulunuyor.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => selectTab('rockets')}
                    className="h-8 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    Roketleri Yönet
                  </button>
                </div>

                {server.serverBadges && server.serverBadges.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">
                      Sunucuya Özel Rozetler ({server.serverBadges.length})
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {server.serverBadges.map((sb) => (
                        <div
                          key={sb.key}
                          className="p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] flex items-start gap-2.5 text-xs"
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full mt-1 shrink-0"
                            style={{ backgroundColor: sb.color }}
                          />
                          <div className="min-w-0 space-y-0.5">
                            <p className="font-bold text-slate-900 dark:text-[#F8FAFC] truncate">
                              {sb.label}{' '}
                              <span className="font-normal text-[11px] text-slate-500 dark:text-[#A1A1B5]">
                                · {sb.rarity}
                              </span>
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] leading-snug">
                              {sb.description}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-4">
                  {server.iconUrl ? (
                    <img
                      src={resolveMediaUrl(server.iconUrl)}
                      alt={server.name}
                      className="w-16 h-16 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-[#7C3AED]/20 border border-[#A855F7]/30 text-[#C084FC] font-bold text-2xl flex items-center justify-center">
                      {server.name[0]?.toUpperCase()}
                    </div>
                  )}
                  <label className="h-9 px-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A] text-xs font-medium flex items-center gap-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-[#222238] transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    Simge Yükle
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => void handleIconUpload(e.target.files?.[0])} />
                  </label>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Sunucu Adı</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (generalNameError) setGeneralNameError(null);
                    }}
                    aria-invalid={Boolean(generalNameError)}
                    className={`w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border text-sm outline-none transition-colors ${
                      generalNameError
                        ? 'border-[#EF4444] focus:border-[#EF4444]'
                        : 'border-slate-200 dark:border-[#29293D] focus:border-[#A855F7]'
                    }`}
                  />
                  {generalNameError && (
                    <p role="alert" className="text-xs text-[#EF4444]">
                      {generalNameError}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Açıklama</label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full p-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm outline-none focus:border-[#A855F7]"
                  />
                </div>

                <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#10111B] cursor-pointer">
                  <div>
                    <p className="text-sm font-medium">Sunucu Keşfinde Göster</p>
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                      Herkese açık keşif dizininde listelenir (en az 2 kanallı ise Doğrulanmış Topluluk rozeti açılır).
                    </p>
                  </div>
                  <input type="checkbox" checked={isDiscoverable} onChange={(e) => setIsDiscoverable(e.target.checked)} />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Moderasyon Düzeyi</label>
                    <select
                      value={moderationLevel}
                      onChange={(e) => setModerationLevel(e.target.value as 'low' | 'medium' | 'high')}
                      className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm outline-none"
                    >
                      <option value="low">Düşük</option>
                      <option value="medium">Orta (Spam koruması)</option>
                      <option value="high">Yüksek (Bağlantı engelli)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Yavaş Mod (saniye)</label>
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={slowmodeSeconds}
                      onChange={(e) => setSlowmodeSeconds(Number(e.target.value))}
                      className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm font-mono outline-none focus:border-[#A855F7]"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Yasaklı Kelimeler (virgülle ayırın)</label>
                  <input
                    type="text"
                    value={blockedWords}
                    onChange={(e) => setBlockedWords(e.target.value)}
                    placeholder="kelime1, kelime2"
                    className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm outline-none focus:border-[#A855F7]"
                  />
                </div>

                <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#10111B] cursor-pointer">
                  <span className="text-sm font-medium">Üyelerin harici bağlantı paylaşmasını engelle</span>
                  <input type="checkbox" checked={blockLinks} onChange={(e) => setBlockLinks(e.target.checked)} />
                </label>

                <button
                  type="submit"
                  className="h-10 px-5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold transition-colors"
                >
                  Değişiklikleri Kaydet
                </button>
              </form>
            )}

            {tab === 'analytics' && (
              <div className="space-y-6 max-w-3xl">
                {!analytics ? (
                  <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Sunucu istatistikleri hesaplanıyor...</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: 'Toplam Üye', value: analytics.memberCount, color: 'text-[#C084FC]' },
                        { label: 'Çevrimiçi', value: analytics.onlineCount, color: 'text-[#22C55E]' },
                        { label: 'Sesli Odalarda', value: analytics.activeVoiceCount, color: 'text-[#A855F7]' },
                        { label: 'Toplam Mesaj', value: analytics.totalMessages, color: 'text-[#38BDF8]' },
                      ].map((kpi) => (
                        <div
                          key={kpi.label}
                          className="p-3.5 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#19192A]"
                        >
                          <p className="text-[11px] font-medium text-slate-500 dark:text-[#A1A1B5]">{kpi.label}</p>
                          <p className={`text-2xl font-bold font-mono tabular-nums mt-1 ${kpi.color}`}>{kpi.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#19192A] space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">Son 7 Gün Mesaj Trafiği</h4>
                      <div className="grid grid-cols-7 gap-2 items-end h-32 pt-2">
                        {(() => {
                          const maxVal = Math.max(1, ...analytics.messagesLast7Days.map((d) => d.count));
                          return analytics.messagesLast7Days.map((day) => {
                            const hPct = Math.max(6, Math.round((day.count / maxVal) * 100));
                            return (
                              <div key={day.date} className="flex flex-col items-center justify-end h-full gap-1">
                                <span className="text-[10px] font-mono text-slate-500 dark:text-[#A1A1B5] tabular-nums">{day.count}</span>
                                <div className="w-full max-w-[32px] bg-[#7C3AED]/20 rounded-t-lg flex items-end h-20 overflow-hidden">
                                  <div className="w-full bg-[#A855F7] rounded-t-lg" style={{ height: `${hPct}%` }} />
                                </div>
                                <span className="text-[10px] font-mono text-slate-500 dark:text-[#A1A1B5]">{day.date.slice(5)}</span>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] space-y-2.5">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">En Aktif Kanallar</h4>
                        {analytics.topChannels.length === 0 ? (
                          <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Veri yok.</p>
                        ) : (
                          analytics.topChannels.map((ch) => (
                            <div key={ch.id} className="flex items-center justify-between text-xs">
                              <span className="font-medium truncate">#{ch.name}</span>
                              <span className="font-mono text-[#C084FC] tabular-nums">{ch.count} mesaj</span>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] space-y-2.5">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">En Çok Kullanılan Davetler</h4>
                        {analytics.topInvites.length === 0 ? (
                          <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Davet kaydı yok.</p>
                        ) : (
                          analytics.topInvites.map((inv) => (
                            <div key={inv.code} className="flex items-center justify-between text-xs">
                              <span className="font-mono truncate">
                                /{inv.code} <span className="text-slate-500 dark:text-[#A1A1B5]">({inv.creatorName})</span>
                              </span>
                              <span className="font-mono text-[#22C55E] tabular-nums">{inv.uses} katılım</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'templates' && (
              <div className="space-y-4 max-w-2xl">
                <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                  Mevcut sunucunuza hazır topluluk kategorileri, sahne/forum kanalları ve başlangıç rolleri tek tıkla ekleyebilirsiniz (mevcut kanallar silinmez).
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(Object.keys(SERVER_TEMPLATES) as ServerTemplateId[]).map((tid) => {
                    const tpl = SERVER_TEMPLATES[tid];
                    return (
                      <div
                        key={tid}
                        className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#19192A] flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold font-display">{tpl.title}</h4>
                          <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">{tpl.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleApplyTemplate(tid)}
                          className="h-9 px-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors"
                        >
                          Bu Şablonu Ekle
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === 'channels' && (
              <div className="space-y-6">
                <form noValidate onSubmit={handleCreateChannel} className="rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] p-4 space-y-3">
                  <h4 className="text-sm font-semibold">Yeni Kanal veya Kategori</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={newChName}
                        onChange={(e) => {
                          setNewChName(e.target.value);
                          if (newChannelError) setNewChannelError(null);
                        }}
                        placeholder="kanal-adi"
                        aria-invalid={Boolean(newChannelError)}
                        className={`w-full h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border text-xs outline-none transition-colors ${
                          newChannelError
                            ? 'border-[#EF4444] focus:border-[#EF4444]'
                            : 'border-slate-200 dark:border-[#29293D] focus:border-[#A855F7]'
                        }`}
                      />
                      {newChannelError && (
                        <p role="alert" className="text-xs text-[#EF4444]">
                          {newChannelError}
                        </p>
                      )}
                    </div>
                    <select
                      value={newChType}
                      onChange={(e) => setNewChType(e.target.value as typeof newChType)}
                      className="h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none"
                    >
                      <option value="text">Metin Kanalı</option>
                      <option value="voice">Ses / Sahne Kanalı</option>
                      <option value="announcement">Duyuru Kanalı</option>
                      <option value="forum">Forum Kanalı</option>
                      <option value="category">Kategori</option>
                    </select>
                    <select
                      value={newChParent}
                      onChange={(e) => setNewChParent(e.target.value)}
                      disabled={newChType === 'category'}
                      className="h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs disabled:opacity-40 outline-none"
                    >
                      <option value="">Kategorisiz</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    value={newChTopic}
                    onChange={(e) => setNewChTopic(e.target.value)}
                    placeholder="Kanal konusu (opsiyonel)"
                    className="w-full h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
                  />
                  {newChType === 'voice' && (
                    <label className="flex items-center gap-2 text-xs font-medium cursor-pointer text-[#C084FC]">
                      <input type="checkbox" checked={newChStage} onChange={(e) => setNewChStage(e.target.checked)} />
                      Sahne Modu (Konuşmacılar ve El Kaldıran Dinleyiciler)
                    </label>
                  )}
                  {newChType !== 'category' && (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                        <input type="checkbox" checked={newChPrivate} onChange={(e) => setNewChPrivate(e.target.checked)} />
                        Özel Kanal (yalnızca seçili roller görebilir)
                      </label>
                      {newChPrivate && (
                        <div className="flex flex-wrap gap-2">
                          {roles.map((r) => (
                            <label key={r.id} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-slate-100 dark:bg-[#19192A] border border-transparent dark:border-[#29293D]">
                              <input
                                type="checkbox"
                                checked={newChRoles.includes(r.id)}
                                onChange={() =>
                                  setNewChRoles((prev) =>
                                    prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                                  )
                                }
                              />
                              <span>{r.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <button type="submit" className="h-9 px-4 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                    Oluştur
                  </button>
                </form>

                <div className="space-y-2">
                  {channels.map((ch, idx) => {
                    const isEditing = editingChannelId === ch.id;
                    return (
                      <div
                        key={ch.id}
                        className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs min-w-0">
                            <span className="font-semibold">{ch.name}</span>
                            <span className="ml-2 text-slate-500 dark:text-[#A1A1B5]">
                              {ch.type} {ch.isStage ? '· Sahne' : ''} {ch.isPrivate ? '· Özel' : ''}
                            </span>
                            {ch.topic && !isEditing && (
                              <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] truncate mt-0.5">{ch.topic}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                if (isEditing) {
                                  setEditingChannelId(null);
                                  setEditChannelError(null);
                                } else {
                                  setEditingChannelId(ch.id);
                                  setEditChName(ch.name);
                                  setEditChTopic(ch.topic || '');
                                  setEditChPrivate(ch.isPrivate);
                                  setEditChStage(Boolean(ch.isStage));
                                  setEditChannelError(null);
                                }
                              }}
                              title="Kanalı Düzenle"
                              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-[#222238] text-slate-500 dark:text-[#A1A1B5] hover:text-[#C084FC] transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => void handleMoveChannel(ch.id, -1)}
                              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-[#222238] disabled:opacity-30 transition-colors"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === channels.length - 1}
                              onClick={() => void handleMoveChannel(ch.id, 1)}
                              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-[#222238] disabled:opacity-30 transition-colors"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await apiFetch(`/channels/${ch.id}`, { method: 'DELETE' });
                                onRefresh();
                              }}
                              className="p-1.5 rounded-lg hover:bg-[#EF4444]/15 text-[#EF4444] transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {isEditing && (
                          <div className="pt-2 border-t border-slate-200 dark:border-[#29293D] grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={editChName}
                                onChange={(e) => {
                                  setEditChName(e.target.value);
                                  if (editChannelError) setEditChannelError(null);
                                }}
                                placeholder="Kanal adı"
                                aria-invalid={Boolean(editChannelError)}
                                className={`w-full h-8 px-2.5 rounded-lg bg-white dark:bg-[#19192A] border outline-none transition-colors ${
                                  editChannelError
                                    ? 'border-[#EF4444] focus:border-[#EF4444]'
                                    : 'border-slate-200 dark:border-[#29293D] focus:border-[#A855F7]'
                                }`}
                              />
                              {editChannelError && (
                                <p role="alert" className="text-[11px] text-[#EF4444]">
                                  {editChannelError}
                                </p>
                              )}
                            </div>
                            <input
                              type="text"
                              value={editChTopic}
                              onChange={(e) => setEditChTopic(e.target.value)}
                              placeholder="Kanal konusu"
                              className="h-8 px-2.5 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] outline-none focus:border-[#A855F7]"
                            />
                            <div className="sm:col-span-2 flex items-center justify-between gap-3 flex-wrap">
                              <div className="flex items-center gap-3 flex-wrap">
                                {ch.type !== 'category' && (
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={editChPrivate}
                                      onChange={(e) => setEditChPrivate(e.target.checked)}
                                    />
                                    <span>Özel Kanal</span>
                                  </label>
                                )}
                                {ch.type === 'voice' && (
                                  <label className="flex items-center gap-1.5 cursor-pointer text-[#C084FC]">
                                    <input
                                      type="checkbox"
                                      checked={editChStage}
                                      onChange={(e) => setEditChStage(e.target.checked)}
                                    />
                                    <span>Sahne Modu</span>
                                  </label>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 ml-auto">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingChannelId(null);
                                    setEditChannelError(null);
                                  }}
                                  className="h-7 px-2.5 rounded-lg border border-slate-200 dark:border-[#29293D] hover:bg-slate-100 dark:hover:bg-[#222238] transition-colors"
                                >
                                  İptal
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveChannelEdit(ch.id)}
                                  className="h-7 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold inline-flex items-center gap-1 transition-colors"
                                >
                                  <Check className="w-3 h-3" />
                                  Kaydet
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === 'rockets' && (
              <div className="space-y-6 max-w-3xl">
                {boostLoading && !boostDetails ? (
                  <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Roket durumu yükleniyor...</p>
                ) : (
                  <>
                    <div className="relative overflow-hidden rounded-2xl border border-fuchsia-500/35 bg-gradient-to-br from-[#7C3AED]/20 via-[#151522] to-fuchsia-500/15 p-5 space-y-4">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3.5">
                          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#7C3AED] to-fuchsia-500 flex items-center justify-center text-white shadow-lg shadow-fuchsia-500/25 shrink-0">
                            <Rocket className="w-6 h-6" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-base font-bold font-display text-white">
                                Sunucu Roket Seviyesi {boostDetails?.boostLevel ?? (server.boostLevel || 0)}
                              </h4>
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-400/30">
                                {boostDetails?.boostCount ?? (server.boostCount || 0)} Roket
                              </span>
                            </div>
                            <p className="text-xs text-[#A1A1B5] mt-0.5">
                              {boostDetails?.nextLevelTarget
                                ? `Bir sonraki roket seviyesine ulaşmak için ${Math.max(
                                    0,
                                    boostDetails.nextLevelTarget - boostDetails.boostCount
                                  )} roket takviyesi daha gerekiyor.`
                                : 'Maksimum Roket Seviye 3 kilidi açıldı! Topluluk zirvede.'}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={boostBusy}
                          onClick={() => void handleToggleRocketBoost()}
                          className={`h-10 px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-all shrink-0 ${
                            boostDetails?.myBoosted
                              ? 'border border-rose-400/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                              : 'bg-gradient-to-r from-[#7C3AED] to-fuchsia-600 hover:from-[#6D28D9] hover:to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20'
                          }`}
                        >
                          <Rocket className="w-4 h-4" />
                          {boostBusy
                            ? 'İşleniyor...'
                            : boostDetails?.myBoosted
                            ? 'Roket Takviyesini Çek'
                            : me?.nitroTier === 'nitro'
                            ? 'Roket Fırlat (Takviye Et)'
                            : 'Nitro ile Roket Fırlat'}
                        </button>
                      </div>

                      {(() => {
                        const cnt = boostDetails?.boostCount ?? 0;
                        const maxTarget = 10;
                        const pct = Math.min(100, Math.round((cnt / maxTarget) * 100));
                        return (
                          <div className="space-y-1.5">
                            <div className="h-2.5 rounded-full bg-[#0B0B12]/80 border border-[#29293D] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] via-fuchsia-500 to-amber-400 transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-[10px] font-mono text-[#A1A1B5]">
                              <span>Seviye 0 (0)</span>
                              <span className={cnt >= 2 ? 'text-emerald-400 font-bold' : ''}>Sv.1 (2 🚀)</span>
                              <span className={cnt >= 5 ? 'text-emerald-400 font-bold' : ''}>Sv.2 (5 🚀)</span>
                              <span className={cnt >= 10 ? 'text-amber-300 font-bold' : ''}>Sv.3 (10 🚀)</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Rocket Level Perks */}
                    <div className="space-y-2.5">
                      <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                        Roket Seviye Avantajları
                      </h5>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {(boostDetails?.perks || []).map((perk) => (
                          <div
                            key={perk.level}
                            className={`p-4 rounded-2xl border space-y-2 transition-colors ${
                              perk.unlocked
                                ? 'border-emerald-500/40 bg-emerald-500/10'
                                : 'border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold font-mono text-[#C084FC]">
                                {perk.requiredBoosts} 🚀 Gerekli
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                  perk.unlocked
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-slate-200 dark:bg-[#19192A] text-slate-500 dark:text-[#A1A1B5]'
                                }`}
                              >
                                {perk.unlocked ? 'Açık ✓' : 'Kilitli'}
                              </span>
                            </div>
                            <p className="text-xs font-bold text-slate-900 dark:text-[#F8FAFC]">{perk.title}</p>
                            <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] leading-relaxed">
                              {perk.description}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Active Boosters */}
                    <div className="space-y-2.5">
                      <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
                        Aktif Roket Takviyecileri ({boostDetails?.boosters.length || 0})
                      </h5>
                      {!boostDetails || boostDetails.boosters.length === 0 ? (
                        <div className="p-5 rounded-2xl border border-dashed border-slate-200 dark:border-[#29293D] text-center space-y-1">
                          <Rocket className="w-6 h-6 text-[#A855F7] mx-auto opacity-80" />
                          <p className="text-xs font-medium text-slate-700 dark:text-[#F8FAFC]">
                            Henüz bu sunucuya roket takviyesi yapılmamış.
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">
                            İlk roketi fırlatan üyeler otomatik olarak <strong className="text-fuchsia-400">🚀 Roket Takviyecisi</strong> rolü kazanır!
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {boostDetails.boosters.map((b) => (
                            <div
                              key={b.userId}
                              className="p-3 rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/5 flex items-center justify-between gap-2.5"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <UserAvatar
                                  src={b.profile.avatarUrl}
                                  name={b.profile.displayName}
                                  status={b.profile.status}
                                  frame={b.profile.avatarFrame}
                                  size="sm"
                                />
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold truncate">{b.profile.displayName}</p>
                                  <p className="text-[11px] font-mono text-slate-500 dark:text-[#A1A1B5] truncate">
                                    @{b.profile.username}
                                  </p>
                                </div>
                              </div>
                              <span className="text-[10px] font-mono text-fuchsia-300 shrink-0">
                                🚀 {new Date(b.boostedAt.replace(' ', 'T') + (b.boostedAt.endsWith('Z') ? '' : 'Z')).toLocaleDateString('tr-TR')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'roles' && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-4 space-y-2">
                  <button
                    type="button"
                    onClick={() => void handleCreateRole()}
                    className="w-full h-9 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Yeni Rol
                  </button>
                  <div className="space-y-1">
                    {roles.map((r) => (
                      <div
                        key={r.id}
                        className={`w-full px-2.5 py-2 rounded-xl text-left text-xs font-medium flex items-center gap-2 transition-colors ${
                          selectedRoleId === r.id
                            ? 'bg-[#7C3AED]/20 border border-[#A855F7]/40 text-slate-900 dark:text-[#F8FAFC]'
                            : 'hover:bg-slate-100 dark:hover:bg-[#19192A]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRoleId(r.id);
                            setRoleNameError(null);
                          }}
                          className="flex-1 min-w-0 flex items-center gap-2 text-left"
                        >
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                          {r.icon && <span className="shrink-0 text-xs">{r.icon}</span>}
                          <span className="truncate flex-1">{r.name}</span>
                          {r.hoist && (
                            <span title="Üye listesinde ayrı başlıkta gösterilir" className="text-[10px] text-[#C084FC] shrink-0">
                              ★
                            </span>
                          )}
                          {typeof r.memberCount === 'number' && !r.isDefault && (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-[#10111B] text-slate-600 dark:text-[#A1A1B5] shrink-0">
                              {r.memberCount}
                            </span>
                          )}
                        </button>
                        {!r.isDefault && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              title="Rolü yukarı taşı"
                              onClick={() => void handleMoveRolePosition(r, 'up')}
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#222238] text-slate-400 hover:text-white"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              title="Rolü aşağı taşı"
                              onClick={() => void handleMoveRolePosition(r, 'down')}
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#222238] text-slate-400 hover:text-white"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {selectedRole && (
                  <div className="md:col-span-8 space-y-4 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/50 p-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <input
                          type="text"
                          value={roleName}
                          disabled={selectedRole.isDefault}
                          onChange={(e) => {
                            setRoleName(e.target.value);
                            if (roleNameError) setRoleNameError(null);
                          }}
                          aria-invalid={Boolean(roleNameError)}
                          className={`flex-1 min-w-[140px] h-9 px-3 rounded-lg bg-slate-100 dark:bg-[#19192A] border text-sm outline-none transition-colors disabled:opacity-60 ${
                            roleNameError
                              ? 'border-[#EF4444] focus:border-[#EF4444]'
                              : 'border-slate-200 dark:border-[#29293D] focus:border-[#A855F7]'
                          }`}
                        />
                        <SingleColorPickerButton
                          compact
                          align="right"
                          label="Rol Rengi"
                          value={roleColor}
                          onChange={setRoleColor}
                        />
                        <button
                          type="button"
                          onClick={() => void handleToggleRolePreview(selectedRole.id)}
                          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-[#29293D] bg-slate-100 dark:bg-[#10111B] hover:border-[#A855F7] text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5 text-[#C084FC]" />
                          Kanal Önizlemesi
                        </button>
                      </div>
                      {roleNameError && (
                        <p role="alert" className="text-xs text-[#EF4444]">
                          {roleNameError}
                        </p>
                      )}

                      {/* Icon Picker & Description */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                        <div className="space-y-1">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-[#A1A1B5]">Rol Simgesi</span>
                          <div className="flex items-center gap-1 flex-wrap">
                            {['', '🚀', '🛡️', '👑', '⚡', '💎', '⭐', '🎮', '🔥'].map((ic) => (
                              <button
                                key={ic || 'none'}
                                type="button"
                                onClick={() => setRoleIcon(ic)}
                                className={`h-7 px-2 rounded-lg text-xs border transition-colors ${
                                  roleIcon === ic
                                    ? 'border-[#A855F7] bg-[#7C3AED]/20 text-white'
                                    : 'border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] text-slate-500'
                                }`}
                              >
                                {ic || 'Yok'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-[#A1A1B5]">Kısa Rol Açıklaması</span>
                          <input
                            type="text"
                            maxLength={140}
                            value={roleDescription}
                            onChange={(e) => setRoleDescription(e.target.value)}
                            placeholder="Bu rolün amacı veya sorumluluğu..."
                            className="w-full h-8 px-2.5 rounded-lg bg-slate-100 dark:bg-[#10111B] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
                          />
                        </div>
                      </div>

                      {/* Discord-style Hoist & Mentionable toggles */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        <label
                          className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] text-xs ${
                            selectedRole.isDefault ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                          }`}
                        >
                          <span>Üye listesinde ayrı başlıkta göster</span>
                          <input
                            type="checkbox"
                            disabled={selectedRole.isDefault}
                            checked={roleHoist}
                            onChange={(e) => setRoleHoist(e.target.checked)}
                          />
                        </label>
                        <label className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] text-xs cursor-pointer">
                          <span>@Rol olarak etiketlenebilir yap</span>
                          <input
                            type="checkbox"
                            checked={roleMentionable}
                            onChange={(e) => setRoleMentionable(e.target.checked)}
                          />
                        </label>
                      </div>
                    </div>

                    {rolePreviewOpen && (
                      <div className="p-3 rounded-xl border border-[#A855F7]/30 bg-[#7C3AED]/10 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#C084FC]">
                            {selectedRole.name} · Kanal Erişim Önizlemesi
                          </span>
                          <button
                            type="button"
                            onClick={() => setRolePreviewOpen(false)}
                            className="text-[11px] text-slate-400 hover:text-white"
                          >
                            Kapat
                          </button>
                        </div>
                        {rolePreviewLoading ? (
                          <p className="text-[11px] text-[#A1A1B5]">Kanallar kontrol ediliyor...</p>
                        ) : rolePreviewChannels.length === 0 ? (
                          <p className="text-[11px] text-[#A1A1B5]">Kanal bulunamadı.</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                            {rolePreviewChannels.map((ch) => (
                              <div
                                key={ch.channelId}
                                className="px-2.5 py-1.5 rounded-lg bg-[#10111B]/80 border border-[#29293D] flex items-center justify-between gap-2 text-[11px]"
                              >
                                <span className="truncate font-medium">
                                  #{ch.name}
                                  {ch.isPrivate && ' 🔒'}
                                </span>
                                <span className="flex items-center gap-1 shrink-0 font-mono text-[10px]">
                                  <span className={ch.canView ? 'text-emerald-400' : 'text-rose-400'}>
                                    {ch.canView ? 'Gör' : 'Gizli'}
                                  </span>
                                  {ch.type !== 'voice' && (
                                    <span className={ch.canSend ? 'text-sky-400' : 'text-slate-500'}>
                                      · {ch.canSend ? 'Yaz' : 'Salt'}
                                    </span>
                                  )}
                                  {ch.type === 'voice' && (
                                    <span className={ch.canConnect ? 'text-fuchsia-400' : 'text-slate-500'}>
                                      · {ch.canConnect ? 'Ses' : 'Kilit'}
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-[#A1A1B5] mr-1">Hızlı Şablonlar:</span>
                      <button
                        type="button"
                        onClick={() => setRolePerms([...DEFAULT_ADMIN_PERMISSIONS])}
                        className="px-2.5 py-1 rounded-lg bg-[#7C3AED]/15 text-[#C084FC] hover:bg-[#7C3AED]/25 text-[11px] font-medium transition-colors"
                      >
                        Yönetici (Tümü)
                      </button>
                      <button
                        type="button"
                        onClick={() => setRolePerms([...DEFAULT_MODERATOR_PERMISSIONS])}
                        className="px-2.5 py-1 rounded-lg bg-[#22C55E]/15 text-[#22C55E] hover:bg-[#22C55E]/25 text-[11px] font-medium transition-colors"
                      >
                        Moderatör
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRoleColor('#EC4899');
                          setRoleIcon('🚀');
                          setRoleHoist(true);
                          setRoleMentionable(true);
                          setRolePerms(Array.from(new Set([...DEFAULT_MEMBER_PERMISSIONS, 'ATTACH_FILES', 'CREATE_INVITES'])));
                        }}
                        className="px-2.5 py-1 rounded-lg bg-fuchsia-500/15 text-fuchsia-300 hover:bg-fuchsia-500/25 text-[11px] font-medium transition-colors"
                      >
                        🚀 Roket VIP
                      </button>
                      <button
                        type="button"
                        onClick={() => setRolePerms([...DEFAULT_MEMBER_PERMISSIONS])}
                        className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-[#10111B] border border-transparent dark:border-[#29293D] text-slate-600 dark:text-[#A1A1B5] text-[11px] font-medium transition-colors"
                      >
                        Standart Üye
                      </button>
                    </div>

                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {ALL_PERMISSIONS.map((perm) => {
                        const checked = rolePerms.includes(perm);
                        const meta = PERMISSION_LABELS[perm];
                        return (
                          <label
                            key={perm}
                            className="flex items-start justify-between gap-3 p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-[#222238]/60 cursor-pointer transition-colors"
                          >
                            <div>
                              <p className="text-xs font-semibold">{meta.label}</p>
                              <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">{meta.description}</p>
                            </div>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setRolePerms((prev) =>
                                  checked ? prev.filter((p) => p !== perm) : [...prev, perm]
                                )
                              }
                            />
                          </label>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-[#29293D]">
                      {!selectedRole.isDefault && !selectedRole.isBoosterRole && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await apiFetch(`/roles/${selectedRole.id}`, { method: 'DELETE' });
                              onRefresh();
                            } catch (err) {
                              showToast(err instanceof ApiError ? err.message : 'Silinemedi.', 'error');
                            }
                          }}
                          className="text-xs text-[#EF4444] hover:underline"
                        >
                          Rolü Sil
                        </button>
                      )}
                      {selectedRole.isBoosterRole && (
                        <span className="text-[11px] text-fuchsia-400 font-medium">
                          🚀 Otomatik Roket Takviye Rolü
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleSaveRole()}
                        className="ml-auto h-9 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors"
                      >
                        Rolü Kaydet
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'overrides' && (
              <div className="space-y-4 max-w-3xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-[200px]">
                    <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">İzinleri Düzenlenecek Kanal</label>
                    <select
                      value={overrideChannelId}
                      onChange={(e) => setOverrideChannelId(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs font-medium outline-none focus:border-[#A855F7]"
                    >
                      {nonCatChannels.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          #{ch.name} ({ch.type})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveOverrides()}
                    className="h-10 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold self-end transition-colors"
                  >
                    Matrisi Kaydet
                  </button>
                </div>

                <div className="space-y-3">
                  {roles
                    .filter((r) => !r.isAdmin)
                    .map((role) => {
                      const ov = overridesMap[role.id];
                      return (
                        <div
                          key={role.id}
                          className="p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] space-y-2.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: role.color }} />
                            <span className="text-xs font-bold">{role.name}</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {OVERRIDE_PERM_META.map((perm) => {
                              const state = ov?.allowPerms.includes(perm.key)
                                ? 'allow'
                                : ov?.denyPerms.includes(perm.key)
                                ? 'deny'
                                : 'inherit';
                              return (
                                <div
                                  key={perm.key}
                                  className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs"
                                >
                                  <span>{perm.label}</span>
                                  <div className="inline-flex rounded-lg border border-slate-200 dark:border-[#29293D] overflow-hidden">
                                    {[
                                      { s: 'deny', label: '✕', activeCls: 'bg-[#EF4444] text-white' },
                                      { s: 'inherit', label: '/', activeCls: 'bg-slate-600 text-white' },
                                      { s: 'allow', label: '✓', activeCls: 'bg-[#22C55E] text-white' },
                                    ].map((opt) => (
                                      <button
                                        key={opt.s}
                                        type="button"
                                        onClick={() =>
                                          handleSetOverrideState(
                                            role.id,
                                            perm.key,
                                            opt.s as 'allow' | 'inherit' | 'deny'
                                          )
                                        }
                                        className={`px-2 py-1 text-[11px] font-bold transition-colors ${
                                          state === opt.s ? opt.activeCls : 'text-slate-400 hover:bg-[#222238]/60'
                                        }`}
                                      >
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {tab === 'emojis' && (
              <div className="space-y-5 max-w-2xl">
                <form
                  noValidate
                  onSubmit={handleUploadEmoji}
                  className="p-4 rounded-xl border border-slate-200 dark:border-[#29293D] space-y-3 bg-slate-50 dark:bg-[#10111B]"
                >
                  <h4 className="text-sm font-semibold">Özel Sunucu Emojisi Yükle</h4>
                  <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                    Sohbette <code className="text-[#C084FC] font-mono">:emoji_adi:</code> şeklinde kullanabileceğiniz
                    özel emojiler ekleyin.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <input
                        type="text"
                        maxLength={24}
                        value={emojiName}
                        onChange={(e) => {
                          setEmojiName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                          if (emojiErrors.name) setEmojiErrors((prev) => ({ ...prev, name: undefined }));
                        }}
                        placeholder="emoji_adi (sadece harf/rakam/_)"
                        aria-invalid={Boolean(emojiErrors.name)}
                        className={`w-full h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border text-xs font-mono outline-none transition-colors ${
                          emojiErrors.name
                            ? 'border-[#EF4444] focus:border-[#EF4444]'
                            : 'border-slate-200 dark:border-[#29293D] focus:border-[#A855F7]'
                        }`}
                      />
                      {emojiErrors.name && (
                        <p role="alert" className="text-xs text-[#EF4444]">
                          {emojiErrors.name}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp"
                        onChange={(e) => {
                          setEmojiFile(e.target.files?.[0] || null);
                          if (emojiErrors.file) setEmojiErrors((prev) => ({ ...prev, file: undefined }));
                        }}
                        aria-invalid={Boolean(emojiErrors.file)}
                        className={`w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#7C3AED] hover:file:bg-[#6D28D9] file:text-white file:text-xs rounded-lg p-1 border ${
                          emojiErrors.file ? 'border-[#EF4444]' : 'border-transparent'
                        }`}
                      />
                      {emojiErrors.file && (
                        <p role="alert" className="text-xs text-[#EF4444]">
                          {emojiErrors.file}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={emojiUploading}
                    className="h-9 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {emojiUploading ? 'Yükleniyor...' : 'Emoji Yükle'}
                  </button>
                </form>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {emojis.map((em) => (
                    <div
                      key={em.id}
                      className="p-2.5 rounded-xl border border-slate-200 dark:border-[#29293D] flex items-center justify-between gap-2 bg-white dark:bg-[#19192A]/70"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <img src={resolveMediaUrl(em.url)} alt={em.name} className="w-7 h-7 object-contain shrink-0" />
                        <span className="text-xs font-mono truncate">:{em.name}:</span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/servers/${server.id}/emojis/${em.id}`, { method: 'DELETE' });
                          setEmojis((prev) => prev.filter((x) => x.id !== em.id));
                          onRefresh();
                        }}
                        className="p-1 text-[#EF4444] hover:bg-[#EF4444]/15 rounded-lg shrink-0 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'automod' && (
              <form onSubmit={handleSaveAutoMod} className="space-y-5 max-w-xl">
                <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 cursor-pointer">
                  <div>
                    <p className="text-sm font-semibold">AutoMod Motorunu Etkinleştir</p>
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                      Küfür, davet bağlantısı, aşırı etiketleme ve spam mesajlarını otomatik engeller.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={automod.enabled}
                    onChange={(e) => setAutomod({ ...automod, enabled: e.target.checked })}
                  />
                </label>

                <div className="space-y-3 p-4 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B]">
                  <label className="flex items-center justify-between text-xs font-medium cursor-pointer">
                    <span>Yasaklı Kelime Filtresi</span>
                    <input
                      type="checkbox"
                      checked={automod.blockBadWords}
                      onChange={(e) => setAutomod({ ...automod, blockBadWords: e.target.checked })}
                    />
                  </label>
                  <input
                    type="text"
                    value={automod.badWords}
                    onChange={(e) => setAutomod({ ...automod, badWords: e.target.value })}
                    placeholder="yasak1, yasak2, reklam..."
                    className="w-full h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
                  />

                  <label className="flex items-center justify-between text-xs font-medium cursor-pointer">
                    <span>Harici Sunucu Davet Linklerini Engelle (/invite/)</span>
                    <input
                      type="checkbox"
                      checked={automod.blockInvites}
                      onChange={(e) => setAutomod({ ...automod, blockInvites: e.target.checked })}
                    />
                  </label>

                  <label className="flex items-center justify-between text-xs font-medium cursor-pointer">
                    <span>Anti-Spam (10 sn içinde 5+ mesaj engeli ve otomatik susturma)</span>
                    <input
                      type="checkbox"
                      checked={automod.antiSpam}
                      onChange={(e) => setAutomod({ ...automod, antiSpam: e.target.checked })}
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 dark:text-[#A1A1B5]">Maks. @Etiket Limiti (0 = sınırsız)</label>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={automod.maxMentions}
                        onChange={(e) => setAutomod({ ...automod, maxMentions: Number(e.target.value) })}
                        className="w-full h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs font-mono outline-none focus:border-[#A855F7]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 dark:text-[#A1A1B5]">Spam Susturma Süresi (dk)</label>
                      <input
                        type="number"
                        min={0}
                        max={1440}
                        value={automod.timeoutMinutes}
                        onChange={(e) => setAutomod({ ...automod, timeoutMinutes: Number(e.target.value) })}
                        className="w-full h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs font-mono outline-none focus:border-[#A855F7]"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3 p-4 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B]">
                  <label className="flex items-center justify-between text-sm font-semibold cursor-pointer">
                    <span>Otomatik Hoş Geldin Mesajı</span>
                    <input
                      type="checkbox"
                      checked={automod.welcomeEnabled}
                      onChange={(e) => setAutomod({ ...automod, welcomeEnabled: e.target.checked })}
                    />
                  </label>
                  <select
                    value={automod.welcomeChannelId || ''}
                    onChange={(e) => setAutomod({ ...automod, welcomeChannelId: e.target.value || null })}
                    className="w-full h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none"
                  >
                    <option value="">Varsayılan ilk metin kanalı</option>
                    {textChannels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        #{ch.name}
                      </option>
                    ))}
                  </select>
                  <textarea
                    rows={2}
                    value={automod.welcomeMessage}
                    onChange={(e) => setAutomod({ ...automod, welcomeMessage: e.target.value })}
                    placeholder="Hoş geldin {user}! {server} topluluğuna katıldın."
                    className="w-full p-2.5 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">
                    Değişkenler: <code className="font-mono text-[#C084FC]">{'{user}'}</code>,{' '}
                    <code className="font-mono text-[#C084FC]">{'{displayName}'}</code>,{' '}
                    <code className="font-mono text-[#C084FC]">{'{server}'}</code>
                  </p>
                </div>

                <button type="submit" className="h-10 px-5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors">
                  AutoMod & Hoş Geldin Ayarlarını Kaydet
                </button>
              </form>
            )}

            {tab === 'onboarding' && (
              <div className="space-y-5 max-w-xl">
                <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 cursor-pointer">
                  <div>
                    <p className="text-sm font-semibold">Yeni Üye Karşılama & Kural Onayı</p>
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                      Katılan üyelere kuralları gösterir ve seçilebilir roller sunar.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={onboarding.enabled}
                    onChange={(e) => setOnboarding({ ...onboarding, enabled: e.target.checked })}
                  />
                </label>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Karşılama Başlığı</label>
                  <input
                    type="text"
                    value={onboarding.promptTitle}
                    onChange={(e) => setOnboarding({ ...onboarding, promptTitle: e.target.value })}
                    className="w-full h-9 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Sunucu Kuralları Metni</label>
                  <textarea
                    rows={4}
                    value={onboarding.rulesText}
                    onChange={(e) => setOnboarding({ ...onboarding, rulesText: e.target.value })}
                    className="w-full p-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">
                    Üyelerin Kendilerinin Seçebileceği Roller (Yalnızca yönetici olmayan roller)
                  </label>
                  {assignableRoles.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Önce Roller sekmesinden standart alt roller oluşturun.</p>
                  ) : (
                    <div className="space-y-2">
                      {assignableRoles.map((r) => {
                        const existing = onboarding.roles.find((x) => x.roleId === r.id);
                        return (
                          <div
                            key={r.id}
                            className="p-3 rounded-xl border border-slate-200 dark:border-[#29293D] space-y-2 bg-slate-50 dark:bg-[#10111B]"
                          >
                            <label className="flex items-center justify-between text-xs font-semibold cursor-pointer">
                              <span className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: r.color }} />
                                {r.name}
                              </span>
                              <input
                                type="checkbox"
                                checked={Boolean(existing)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setOnboarding({
                                      ...onboarding,
                                      roles: [
                                        ...onboarding.roles,
                                        {
                                          serverId: server.id,
                                          roleId: r.id,
                                          emoji: '✨',
                                          label: r.name,
                                          description: '',
                                        },
                                      ],
                                    });
                                  } else {
                                    setOnboarding({
                                      ...onboarding,
                                      roles: onboarding.roles.filter((x) => x.roleId !== r.id),
                                    });
                                  }
                                }}
                              />
                            </label>
                            {existing && (
                              <div className="grid grid-cols-4 gap-2">
                                <input
                                  type="text"
                                  maxLength={4}
                                  value={existing.emoji}
                                  onChange={(e) =>
                                    setOnboarding({
                                      ...onboarding,
                                      roles: onboarding.roles.map((x) =>
                                        x.roleId === r.id ? { ...x, emoji: e.target.value } : x
                                      ),
                                    })
                                  }
                                  placeholder="Emoji"
                                  className="h-8 px-2 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs text-center outline-none focus:border-[#A855F7]"
                                />
                                <input
                                  type="text"
                                  value={existing.description}
                                  onChange={(e) =>
                                    setOnboarding({
                                      ...onboarding,
                                      roles: onboarding.roles.map((x) =>
                                        x.roleId === r.id ? { ...x, description: e.target.value } : x
                                      ),
                                    })
                                  }
                                  placeholder="Kısa açıklama..."
                                  className="col-span-3 h-8 px-2.5 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void handleSaveOnboarding()}
                  className="h-10 px-5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors"
                >
                  Karşılama Ayarlarını Kaydet
                </button>
              </div>
            )}

            {tab === 'members' && (
              <div className="space-y-5">
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Üye adı, kullanıcı adı veya #etiket ara..."
                  className="w-full h-9 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
                />

                <div className="space-y-2">
                  {members
                    .filter((m) => {
                      const q = memberSearch.toLowerCase();
                      return (
                        m.profile.displayName.toLowerCase().includes(q) ||
                        m.profile.username.toLowerCase().includes(q) ||
                        `#${m.profile.discriminator || ''}`.includes(q) ||
                        (m.nickname || '').toLowerCase().includes(q)
                      );
                    })
                    .map((m) => (
                      <div
                        key={m.userId}
                        className="p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2.5">
                            <UserAvatar src={m.profile.avatarUrl} name={m.profile.displayName} status={m.profile.status} size="sm" />
                            <div>
                              <p className="text-sm font-semibold">
                                {m.nickname || m.profile.displayName}
                                {m.nickname && (
                                  <span className="ml-1.5 text-[11px] font-normal text-slate-500 dark:text-[#A1A1B5]">
                                    ({m.profile.displayName})
                                  </span>
                                )}
                                {m.userId === server.ownerId && (
                                  <span className="ml-1.5 text-[11px] text-[#F59E0B]">· Sahip</span>
                                )}
                              </p>
                              <p className="text-xs font-mono text-slate-500 dark:text-[#A1A1B5]">
                                {m.profile.username}
                                <span className="text-[#C084FC]">#{m.profile.discriminator || '0000'}</span>
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap">
                            {(canManageMembers || m.userId === me?.userId) && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (editingNickUserId === m.userId) {
                                    setEditingNickUserId(null);
                                  } else {
                                    setEditingNickUserId(m.userId);
                                    setNickDraft(m.nickname || '');
                                  }
                                }}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#10111B] border border-transparent dark:border-[#29293D] text-xs font-medium inline-flex items-center gap-1 hover:bg-slate-200 dark:hover:bg-[#222238] transition-colors"
                              >
                                <Edit3 className="w-3 h-3" />
                                Takma Ad
                              </button>
                            )}

                            {m.userId !== server.ownerId && m.userId !== me?.userId && (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await apiFetch(`/servers/${server.id}/members/${m.userId}/mute`, {
                                      method: 'POST',
                                      body: JSON.stringify({ minutes: m.mutedUntil ? 0 : 10 }),
                                    });
                                    onRefresh();
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-[#F59E0B]/15 text-[#F59E0B] text-xs font-medium hover:bg-[#F59E0B]/25 transition-colors"
                                >
                                  {m.mutedUntil ? 'Susturmayı Kaldır' : '10dk Sustur'}
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await apiFetch(`/servers/${server.id}/members/${m.userId}/kick`, { method: 'POST' });
                                    onRefresh();
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-[#10111B] border border-transparent dark:border-[#29293D] text-xs font-medium hover:bg-slate-300 dark:hover:bg-[#222238] transition-colors"
                                >
                                  Çıkar
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await apiFetch(`/servers/${server.id}/members/${m.userId}/ban`, {
                                      method: 'POST',
                                      body: JSON.stringify({ reason: 'Sunucu kural ihlali' }),
                                    });
                                    onRefresh();
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-[#EF4444]/15 text-[#EF4444] text-xs font-medium hover:bg-[#EF4444]/25 transition-colors"
                                >
                                  Yasakla
                                </button>
                                {isOwner && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (
                                        !window.confirm(
                                          `${m.profile.displayName} üyesine sunucu sahipliğini devretmek istiyor musunuz?`
                                        )
                                      )
                                        return;
                                      await apiFetch(`/servers/${server.id}/transfer-ownership`, {
                                        method: 'POST',
                                        body: JSON.stringify({ newOwnerId: m.userId }),
                                      });
                                      onRefresh();
                                    }}
                                    className="px-2.5 py-1 rounded-lg border border-[#F59E0B]/35 text-[#F59E0B] text-xs hover:bg-[#F59E0B]/10 transition-colors"
                                  >
                                    Sahipliği Devret
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {editingNickUserId === m.userId && (
                          <div className="flex items-center gap-2 pt-1">
                            <input
                              type="text"
                              maxLength={36}
                              value={nickDraft}
                              onChange={(e) => setNickDraft(e.target.value)}
                              placeholder="Sunucu içi takma ad (boş bırakılırsa sıfırlanır)"
                              className="flex-1 h-8 px-2.5 rounded-lg bg-slate-100 dark:bg-[#10111B] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
                            />
                            <button
                              type="button"
                              onClick={() => void handleSaveNickname(m.userId)}
                              className="h-8 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors"
                            >
                              Kaydet
                            </button>
                          </div>
                        )}

                        {canManageMembers && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {roles
                              .filter((r) => !r.isDefault)
                              .map((r) => {
                                const has = m.roleIds.includes(r.id);
                                return (
                                  <button
                                    key={r.id}
                                    type="button"
                                    onClick={async () => {
                                      const next = has
                                        ? m.roleIds.filter((id) => id !== r.id)
                                        : [...m.roleIds, r.id];
                                      try {
                                        await apiFetch(`/servers/${server.id}/members/${m.userId}/roles`, {
                                          method: 'PUT',
                                          body: JSON.stringify({ roleIds: next }),
                                        });
                                        onRefresh();
                                      } catch (err) {
                                        showToast(err instanceof ApiError ? err.message : 'Rol atanamadı.', 'error');
                                      }
                                    }}
                                    className={`px-2 py-0.5 rounded-lg text-[11px] font-medium border transition-colors ${
                                      has
                                        ? 'border-[#A855F7] bg-[#7C3AED]/20 text-[#C084FC]'
                                        : 'border-slate-300 dark:border-[#29293D] text-slate-500 dark:text-[#A1A1B5]'
                                    }`}
                                  >
                                    {has ? '✓ ' : '+ '}
                                    {r.name}
                                  </button>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    ))}
                </div>

                {bans.length > 0 && (
                  <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-[#29293D]">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h4 className="text-xs font-semibold text-[#EF4444]">Yasaklı Kullanıcılar ({bans.length})</h4>
                      <input
                        type="text"
                        value={banSearch}
                        onChange={(e) => setBanSearch(e.target.value)}
                        placeholder="Yasaklılarda ara..."
                        className="h-7 px-2.5 rounded-lg bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
                      />
                    </div>
                    {filteredBans.map((b) => (
                      <div
                        key={b.userId}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/25 text-xs"
                      >
                        <span>
                          {b.profile?.displayName || b.userId} · {b.reason}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/servers/${server.id}/bans/${b.userId}`, { method: 'DELETE' });
                            onRefresh();
                          }}
                          className="px-2.5 py-1 rounded-lg bg-[#19192A] border border-[#29293D] text-[#F8FAFC] hover:bg-[#222238] transition-colors"
                        >
                          Yasağı Kaldır
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'invites' && (
              <div className="space-y-5">
                <form onSubmit={handleCreateInvite} className="rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] p-4 space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-[#A855F7]" />
                    Yeni Davet Bağlantısı Oluştur
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 dark:text-[#A1A1B5]">Süre (saat, boş = süresiz)</label>
                      <input
                        type="number"
                        min={1}
                        value={inviteExpiryHours}
                        onChange={(e) => setInviteExpiryHours(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs font-mono outline-none focus:border-[#A855F7]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 dark:text-[#A1A1B5]">Kullanım Limiti (boş = sınırsız)</label>
                      <input
                        type="number"
                        min={1}
                        value={inviteMaxUses}
                        onChange={(e) => setInviteMaxUses(e.target.value)}
                        placeholder="Sınırsız"
                        className="w-full h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs font-mono outline-none focus:border-[#A855F7]"
                      />
                    </div>
                  </div>
                  <button type="submit" className="h-9 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors">
                    Davet Oluştur
                  </button>
                </form>

                <div className="space-y-2">
                  {invites.map((inv) => (
                    <div
                      key={inv.code}
                      className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 text-xs"
                    >
                      <div>
                        <p className="font-mono font-semibold text-[#C084FC]">/invite/{inv.code}</p>
                        <p className="text-slate-500 dark:text-[#A1A1B5] mt-0.5">
                          Kullanım: {inv.uses}
                          {inv.maxUses ? `/${inv.maxUses}` : ''} · Oluşturan: {inv.creatorName || 'Üye'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void copyInviteUrl(inv.code)}
                          className="h-8 px-3 rounded-lg bg-slate-100 dark:bg-[#10111B] border border-transparent dark:border-[#29293D] hover:bg-slate-200 dark:hover:bg-[#222238] flex items-center gap-1 transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Kopyala
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/invites/${inv.code}`, { method: 'DELETE' });
                            setInvites((prev) => prev.filter((i) => i.code !== inv.code));
                          }}
                          className="p-1.5 text-[#EF4444] hover:bg-[#EF4444]/15 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'webhooks' && (
              <div className="space-y-5">
                {/* Official Verified ORBIT Bot Card */}
                <div className="rounded-2xl border border-[#A855F7]/35 bg-[#7C3AED]/10 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-[#7C3AED]/25 border border-[#A855F7]/40 flex items-center justify-center text-[#C084FC] shrink-0">
                        <Bot className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-sm font-bold">ORBIT Resmî Bot</h4>
                          <BotBadge verified />
                        </div>
                        <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                          Komutlar: <code className="font-mono text-[#C084FC]">/yardim</code>,{' '}
                          <code className="font-mono text-[#C084FC]">/sunucu</code>,{' '}
                          <code className="font-mono text-[#C084FC]">/ozet</code>,{' '}
                          <code className="font-mono text-[#C084FC]">/ai</code>,{' '}
                          <code className="font-mono text-[#C084FC]">/anket</code>,{' '}
                          <code className="font-mono text-[#C084FC]">/temizle</code>
                        </p>
                      </div>
                    </div>

                    {officialBot ? (
                      <button
                        type="button"
                        disabled={botBusy}
                        onClick={async () => {
                          setBotBusy(true);
                          try {
                            await apiFetch(`/servers/${server.id}/bots/orbit`, { method: 'DELETE' });
                            setOfficialBot(null);
                            onRefresh();
                            showToast('ORBIT Resmî Bot sunucudan kaldırıldı.', 'info');
                          } catch (err) {
                            showToast(err instanceof ApiError ? err.message : 'İşlem başarısız.', 'error');
                          } finally {
                            setBotBusy(false);
                          }
                        }}
                        className="h-9 px-3.5 rounded-xl border border-[#EF4444]/40 text-[#EF4444] hover:bg-[#EF4444]/10 text-xs font-semibold shrink-0 transition-colors"
                      >
                        Botu Kaldır
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={botBusy}
                        onClick={async () => {
                          setBotBusy(true);
                          try {
                            const res = await apiFetch<{ officialBot: ServerBotConfig }>(`/servers/${server.id}/bots/orbit`, {
                              method: 'POST',
                            });
                            setOfficialBot(res.officialBot);
                            setBotWelcomeChId(res.officialBot.welcomeChannelId || '');
                            setBotPrefix(res.officialBot.prefix || '/');
                            onRefresh();
                            showToast('ORBIT Resmî Bot sunucuya eklendi!', 'success');
                          } catch (err) {
                            showToast(err instanceof ApiError ? err.message : 'Bot eklenemedi.', 'error');
                          } finally {
                            setBotBusy(false);
                          }
                        }}
                        className="h-9 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold shrink-0 transition-colors"
                      >
                        Sunucuya Ekle
                      </button>
                    )}
                  </div>

                  {officialBot && (
                    <div className="pt-3 border-t border-[#A855F7]/20 space-y-3 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="flex items-center justify-between p-2.5 rounded-xl bg-white/70 dark:bg-[#10111B] border border-slate-200 dark:border-[#29293D] cursor-pointer">
                          <span>Yeni üyelere hoş geldin mesajı</span>
                          <input
                            type="checkbox"
                            checked={officialBot.welcomeEnabled}
                            onChange={(e) => setOfficialBot({ ...officialBot, welcomeEnabled: e.target.checked })}
                          />
                        </label>
                        <label className="flex items-center justify-between p-2.5 rounded-xl bg-white/70 dark:bg-[#10111B] border border-slate-200 dark:border-[#29293D] cursor-pointer">
                          <span>AI Soru-Cevap (/ai, @ORBIT)</span>
                          <input
                            type="checkbox"
                            checked={officialBot.aiEnabled}
                            onChange={(e) => setOfficialBot({ ...officialBot, aiEnabled: e.target.checked })}
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <select
                          value={botWelcomeChId}
                          onChange={(e) => setBotWelcomeChId(e.target.value)}
                          className="h-9 px-2.5 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] outline-none"
                        >
                          <option value="">Hoş Geldin Kanalı Seçin</option>
                          {textChannels.map((ch) => (
                            <option key={ch.id} value={ch.id}>
                              #{ch.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={botPrefix}
                          maxLength={3}
                          onChange={(e) => setBotPrefix(e.target.value)}
                          placeholder="Önek (/)"
                          className="h-9 px-2.5 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] font-mono outline-none focus:border-[#A855F7]"
                        />
                        <button
                          type="button"
                          disabled={botBusy}
                          onClick={async () => {
                            setBotBusy(true);
                            try {
                              const res = await apiFetch<{ officialBot: ServerBotConfig }>(
                                `/servers/${server.id}/bots/orbit`,
                                {
                                  method: 'PATCH',
                                  body: JSON.stringify({
                                    welcomeEnabled: officialBot.welcomeEnabled,
                                    welcomeChannelId: botWelcomeChId || null,
                                    aiEnabled: officialBot.aiEnabled,
                                    prefix: botPrefix || '/',
                                  }),
                                }
                              );
                              setOfficialBot(res.officialBot);
                              showToast('ORBIT Bot ayarları kaydedildi.', 'success');
                            } catch (err) {
                              showToast(err instanceof ApiError ? err.message : 'Kaydedilemedi.', 'error');
                            } finally {
                              setBotBusy(false);
                            }
                          }}
                          className="h-9 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold transition-colors"
                        >
                          Bot Ayarlarını Kaydet
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <form noValidate onSubmit={handleCreateWebhook} className="rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-[#38BDF8]" />
                    <h4 className="text-sm font-semibold">Harici Webhook Entegrasyonu Oluştur</h4>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">
                    Webhook oluşturarak harici servislerden veya botlardan doğrudan seçili kanala{' '}
                    <strong>BOT</strong> etiketli gerçek zamanlı mesajlar gönderebilirsiniz. İlk webhook
                    oluşturduğunuzda <strong>Orbit Bot Geliştiricisi</strong> rozeti tanımlanır.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 dark:text-[#A1A1B5]">Bot / Webhook Adı</label>
                      <input
                        type="text"
                        maxLength={40}
                        value={webhookName}
                        onChange={(e) => {
                          setWebhookName(e.target.value);
                          if (webhookErrors.name) setWebhookErrors((prev) => ({ ...prev, name: undefined }));
                        }}
                        placeholder="ör. ORBIT Duyuru Botu"
                        aria-invalid={Boolean(webhookErrors.name)}
                        className={`w-full h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border text-xs outline-none transition-colors ${
                          webhookErrors.name
                            ? 'border-[#EF4444] focus:border-[#EF4444]'
                            : 'border-slate-200 dark:border-[#29293D] focus:border-[#A855F7]'
                        }`}
                      />
                      {webhookErrors.name && (
                        <p role="alert" className="text-xs text-[#EF4444]">
                          {webhookErrors.name}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 dark:text-[#A1A1B5]">Hedef Kanal</label>
                      <select
                        value={webhookChannelId}
                        onChange={(e) => {
                          setWebhookChannelId(e.target.value);
                          if (webhookErrors.channel) setWebhookErrors((prev) => ({ ...prev, channel: undefined }));
                        }}
                        aria-invalid={Boolean(webhookErrors.channel)}
                        className={`w-full h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border text-xs outline-none transition-colors ${
                          webhookErrors.channel
                            ? 'border-[#EF4444] focus:border-[#EF4444]'
                            : 'border-slate-200 dark:border-[#29293D] focus:border-[#A855F7]'
                        }`}
                      >
                        {textChannels.length === 0 ? (
                          <option value="">Metin kanalı bulunamadı</option>
                        ) : (
                          textChannels.map((ch) => (
                            <option key={ch.id} value={ch.id}>
                              #{ch.name}
                            </option>
                          ))
                        )}
                      </select>
                      {webhookErrors.channel && (
                        <p role="alert" className="text-xs text-[#EF4444]">
                          {webhookErrors.channel}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="h-9 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Webhook Oluştur
                  </button>
                </form>

                <div className="space-y-2.5">
                  {webhooks.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5] py-4 text-center">Henüz bot / webhook entegrasyonu eklenmemiş.</p>
                  ) : (
                    webhooks.map((wh) => (
                      <div
                        key={wh.id}
                        className="p-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Bot className="w-4 h-4 text-[#38BDF8] shrink-0" />
                            <span className="font-bold text-sm">{wh.name}</span>
                            <span className="px-1.5 py-0.5 rounded bg-[#7C3AED]/20 text-[#C084FC] font-mono text-[10px] font-bold">
                              BOT
                            </span>
                            <span className="text-slate-500 dark:text-[#A1A1B5]">→ #{wh.channelName}</span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              disabled={testingWebhookId === wh.id}
                              onClick={() => void handleTestWebhook(wh)}
                              className="h-8 px-2.5 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-white font-medium inline-flex items-center gap-1 transition-colors"
                            >
                              <Send className="w-3 h-3" />
                              {testingWebhookId === wh.id ? 'Gönderiliyor...' : 'Test Bot Mesajı Gönder'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleCopyWebhookUrl(wh)}
                              className="h-8 px-2.5 rounded-lg bg-slate-200 dark:bg-[#19192A] border border-transparent dark:border-[#29293D] inline-flex items-center gap-1 transition-colors"
                            >
                              <Copy className="w-3 h-3" />
                              URL Kopyala
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await apiFetch(`/webhooks/${wh.id}`, { method: 'DELETE' });
                                setWebhooks((prev) => prev.filter((item) => item.id !== wh.id));
                                showToast('Webhook kaldırıldı.', 'info');
                              }}
                              className="p-1.5 text-[#EF4444] hover:bg-[#EF4444]/15 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="font-mono text-[11px] text-slate-500 dark:text-[#A1A1B5] truncate">
                          POST /api/webhooks/{wh.id}/{wh.token}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {tab === 'logs' && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#A855F7]" />
                    Moderasyon Denetim Kayıtları
                  </h4>
                  {logs.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Henüz kayıt yok.</p>
                  ) : (
                    logs.map((l) => (
                      <div key={l.id} className="p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 text-xs flex justify-between gap-2">
                        <div>
                          <span className="font-semibold">{l.actorName}</span> ·{' '}
                          <span className="font-mono text-[#C084FC]">{l.action}</span>
                          {l.targetName && <span> → {l.targetName}</span>}
                          {l.details && <p className="text-slate-500 dark:text-[#A1A1B5] mt-0.5">{l.details}</p>}
                        </div>
                        <span className="font-mono text-[11px] text-slate-500 dark:text-[#A1A1B5] shrink-0">
                          {new Date(l.createdAt.replace(' ', 'T') + 'Z').toLocaleString('tr-TR')}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Şikâyetler ({reports.length})</h4>
                  {reports.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Henüz şikâyet kaydı yok.</p>
                  ) : (
                    reports.map((r) => {
                      const match = /^\[([^\]]+)\]\s*(.*)$/s.exec(r.reason || '');
                      const category = match ? match[1] : null;
                      const detail = match ? match[2] : r.reason;
                      const targetLabel =
                        r.target_type === 'message'
                          ? 'Mesaj'
                          : r.target_type === 'user'
                          ? 'Kullanıcı'
                          : r.target_type;
                      return (
                        <div
                          key={r.id}
                          className="p-3 rounded-xl border border-[#F59E0B]/25 bg-[#F59E0B]/10 text-xs flex items-start justify-between gap-2"
                        >
                          <div className="space-y-0.5 min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-[#F8FAFC]">
                              {r.reporter_name}{' '}
                              <span className="font-normal text-slate-500 dark:text-[#A1A1B5]">
                                · {targetLabel}
                                {category ? ` · ${category}` : ''}
                              </span>
                            </p>
                            {detail && <p className="text-slate-700 dark:text-[#E2E8F0] break-words">{detail}</p>}
                          </div>
                          {r.created_at && (
                            <span className="font-mono text-[11px] text-slate-500 dark:text-[#A1A1B5] shrink-0 tabular-nums">
                              {new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleString('tr-TR')}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
