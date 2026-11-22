import type {
  ActivityTypeKey,
  AvatarFrameKey,
  BadgeKey,
  BannerPresetKey,
  OrbitBadge,
  ProfileEffectKey,
} from './badges.ts';
import type { Permission } from './permissions.ts';

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';
export type ThemePreference = 'dark' | 'light' | 'system';
export type ChannelType = 'category' | 'text' | 'voice' | 'announcement' | 'forum';
export type FriendshipStatus = 'pending' | 'accepted' | 'declined';
export type NitroTier = 'none' | 'nitro';

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  hasFlameBadge: boolean;
}

export interface AchievementItem {
  key: string;
  title: string;
  description: string;
  category: 'streak' | 'social' | 'community' | 'nitro';
  target: number;
  progress: number;
  xpReward: number;
  color: string;
  unlockedAt: string | null;
}

export interface ServerBotConfig {
  serverId: string;
  botId: string;
  enabled: boolean;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  aiEnabled: boolean;
  prefix: string;
  botProfile: UserProfile | null;
}

export interface NitroOverview {
  isNitro: boolean;
  nitroTier: NitroTier;
  nitroExpiresAt: string | null;
  maxUploadMb: number;
  boostedServerIds: string[];
  stripeConfigured: boolean;
  priceConfigured: boolean;
  monthlyPriceLabel: string;
  yearlyPriceLabel: string;
  hasActiveStripeSubscription: boolean;
}

export interface UserProfile {
  userId: string;
  email?: string;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
  isGoogleLinked?: boolean;
  hasPassword?: boolean;
  isBlockedByMe?: boolean;
  hasBlockedMe?: boolean;
  username: string;
  discriminator: string;
  displayName: string;
  avatarUrl: string | null;
  bannerUrl?: string | null;
  bannerColor: string;
  bannerPreset?: BannerPresetKey;
  avatarFrame: AvatarFrameKey;
  profileEffect?: ProfileEffectKey;
  pronouns: string;
  websiteUrl: string;
  activityType: ActivityTypeKey;
  activityText: string;
  featuredBadge: BadgeKey | null;
  bio: string;
  status: PresenceStatus;
  preferredStatus: PresenceStatus;
  customStatus: string;
  lastSeenAt: string;
  createdAt?: string;
  isOnline: boolean;
  isFounder?: boolean;
  isBot?: boolean;
  isVerifiedBot?: boolean;
  nitroTier?: NitroTier;
  nitroExpiresAt?: string | null;
  xp?: number;
  level?: number;
  streak?: StreakInfo;
  badges: OrbitBadge[];
}

export interface BadgeStatEntry {
  key: BadgeKey;
  count: number;
  percentage: number;
  cap?: number;
}

export interface BadgeStatsResponse {
  totalUsers: number;
  orbitMemberCap: number;
  orbitMemberCount: number;
  orbitMemberRemaining: number;
  badges: Record<BadgeKey, BadgeStatEntry>;
}

export interface UserSettings {
  userId: string;
  theme: ThemePreference;
  fontSize: 'sm' | 'md' | 'lg';
  messageDensity: 'compact' | 'cozy';
  inAppNotifications: boolean;
  pushNotifications: boolean;
  soundEnabled: boolean;
  dndMode: boolean;
  showOnlineStatus: boolean;
  dmPermission: 'everyone' | 'friends' | 'server_members';
  friendRequestsAllowed: boolean;
  reducedMotion: boolean;
  keyboardNavHints: boolean;
}

export interface Role {
  id: string;
  serverId: string;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
  isAdmin: boolean;
  hoist?: boolean;
  mentionable?: boolean;
  icon?: string;
  description?: string;
  isBoosterRole?: boolean;
  memberCount?: number;
  permissions: Permission[];
}

export interface ServerBoostDetails {
  serverId: string;
  boostCount: number;
  boostLevel: number;
  nextLevelTarget: number | null;
  myBoosted: boolean;
  boosters: Array<{
    userId: string;
    boostedAt: string;
    profile: UserProfile;
  }>;
  perks: Array<{
    level: number;
    requiredBoosts: number;
    title: string;
    description: string;
    unlocked: boolean;
  }>;
}

export interface ServerBadgeItem {
  key: string;
  label: string;
  description: string;
  color: string;
  rarity: string;
}

export interface ServerSummary {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  ownerId: string;
  isDiscoverable: boolean;
  moderationLevel: 'low' | 'medium' | 'high';
  blockedWords: string;
  blockLinks: boolean;
  slowmodeSeconds: number;
  isFavorite: boolean;
  notificationLevel: 'all' | 'mentions' | 'muted';
  memberCount: number;
  unreadCount?: number;
  boostCount?: number;
  boostLevel?: number;
  myBoosted?: boolean;
  hasOfficialBot?: boolean;
  serverBadges?: ServerBadgeItem[];
  createdAt: string;
}

export interface ServerMember {
  serverId: string;
  userId: string;
  nickname: string | null;
  mutedUntil: string | null;
  joinedAt: string;
  profile: UserProfile;
  roleIds: string[];
  highestRolePosition: number;
}

export interface Channel {
  id: string;
  serverId: string;
  parentId: string | null;
  name: string;
  topic: string;
  type: ChannelType;
  position: number;
  isPrivate: boolean;
  isStage?: boolean;
  unreadCount?: number;
  voiceParticipantCount?: number;
  createdAt: string;
}

export interface Attachment {
  id: string;
  messageId: string | null;
  dmId: string | null;
  uploaderId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  userIds: string[];
}

export interface PollOption {
  id: string;
  label: string;
  votes: number;
  votedByMe: boolean;
}

export interface PollData {
  id: string;
  question: string;
  allowMultiple: boolean;
  totalVotes: number;
  options: PollOption[];
}

export interface MessageReplyPreview {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
}

export interface ForwardedMessagePreview {
  originalMessageId: string;
  authorName: string;
  channelName?: string;
  content: string;
  createdAt: string;
}

export interface MessageThreadSummary {
  id: string;
  channelId: string;
  parentMessageId: string;
  title: string;
  createdBy: string;
  isLocked: boolean;
  replyCount: number;
  createdAt: string;
}

export interface MessageReadReceipt {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  readAt: string;
}

export interface ChatMessage {
  id: string;
  channelId?: string;
  conversationId?: string;
  threadId?: string | null;
  authorId: string;
  author: UserProfile;
  content: string;
  replyToId: string | null;
  replyTo: MessageReplyPreview | null;
  forwardedFrom?: ForwardedMessagePreview | null;
  threadSummary?: {
    id: string;
    title: string;
    replyCount: number;
    isLocked: boolean;
  } | null;
  clientNonce: string | null;
  isAnnouncement?: boolean;
  isPinned?: boolean;
  webhookName?: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  attachments: Attachment[];
  reactions: ReactionSummary[];
  poll?: PollData | null;
  readBy?: MessageReadReceipt[];
  readCount?: number;
  status?: 'sending' | 'sent' | 'failed';
}

export interface ServerWebhook {
  id: string;
  serverId: string;
  channelId: string;
  channelName?: string;
  name: string;
  token: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

export interface DirectConversation {
  id: string;
  isGroup: boolean;
  name: string | null;
  avatarUrl: string | null;
  ownerId: string | null;
  archived: boolean;
  unreadCount: number;
  updatedAt: string;
  lastMessage: {
    content: string;
    authorName: string;
    createdAt: string;
  } | null;
  members: UserProfile[];
}

export interface FriendshipRecord {
  id: string;
  status: FriendshipStatus;
  direction: 'incoming' | 'outgoing' | 'accepted';
  friend: UserProfile;
  createdAt: string;
}

export interface Invitation {
  code: string;
  serverId: string;
  creatorId: string;
  creatorName?: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  type: 'dm' | 'friend_request' | 'server_invite' | 'mention' | 'reply' | 'announcement' | 'voice_call' | 'reminder';
  title: string;
  body: string;
  actorId: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface ForumPost {
  id: string;
  channelId: string;
  authorId: string;
  author: UserProfile;
  title: string;
  content: string;
  tags: string[];
  isPinned: boolean;
  isLocked: boolean;
  isFollowing: boolean;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ForumReply {
  id: string;
  postId: string;
  authorId: string;
  author: UserProfile;
  content: string;
  createdAt: string;
  editedAt: string | null;
}

export interface ModerationLog {
  id: string;
  serverId: string;
  actorId: string;
  actorName: string;
  action: string;
  targetUserId: string | null;
  targetName: string | null;
  details: string;
  createdAt: string;
}

export interface VoiceParticipant {
  userId: string;
  channelId: string;
  profile: UserProfile;
  muted: boolean;
  deafened: boolean;
  serverMuted: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  handRaised?: boolean;
  isSpeaker?: boolean;
  speaking: boolean;
  joinedAt?: string;
}

export interface UserSessionInfo {
  id: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export interface ScheduledMessageItem {
  id: string;
  userId: string;
  channelId: string | null;
  conversationId: string | null;
  channelName?: string;
  content: string;
  sendAt: string;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  sentAt: string | null;
  createdAt: string;
}

export interface ReminderItem {
  id: string;
  userId: string;
  messageId: string | null;
  channelId: string | null;
  conversationId: string | null;
  note: string;
  remindAt: string;
  notified: boolean;
  createdAt: string;
}

export type ChannelOverridePermission = 'VIEW_CHANNEL' | 'SEND_MESSAGES' | 'ATTACH_FILES' | 'CONNECT_VOICE';

export interface ChannelPermissionOverride {
  channelId: string;
  roleId: string;
  allowPerms: ChannelOverridePermission[];
  denyPerms: ChannelOverridePermission[];
}

export interface AutoModConfig {
  serverId: string;
  enabled: boolean;
  blockBadWords: boolean;
  badWords: string;
  blockInvites: boolean;
  antiSpam: boolean;
  maxMentions: number;
  timeoutMinutes: number;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeMessage: string;
}

export interface OnboardingRoleItem {
  serverId: string;
  roleId: string;
  roleName?: string;
  roleColor?: string;
  emoji: string;
  label: string;
  description: string;
}

export interface OnboardingState {
  serverId: string;
  enabled: boolean;
  promptTitle: string;
  rulesText: string;
  roles: OnboardingRoleItem[];
  accepted: boolean;
  myRoleIds: string[];
}

export interface ServerEmoji {
  id: string;
  serverId: string;
  name: string;
  url: string;
  createdBy: string;
  createdAt: string;
}

export interface ServerAnalytics {
  memberCount: number;
  onlineCount: number;
  activeVoiceCount: number;
  totalMessages: number;
  messagesLast7Days: Array<{ date: string; count: number }>;
  topChannels: Array<{ id: string; name: string; count: number }>;
  topInvites: Array<{ code: string; creatorName: string; uses: number }>;
}

export interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
  tags?: string[];
}

export interface WhiteboardStroke {
  id: string;
  roomId: string;
  userId: string;
  color: string;
  size: number;
  points: Array<{ x: number; y: number }>;
}

export interface PomodoroState {
  roomId: string;
  phase: 'focus' | 'break';
  durationSeconds: number;
  remainingSeconds: number;
  running: boolean;
  updatedAt: string;
}

export type VoiceGameType = 'tic_tac_toe' | 'rps' | 'dice_duel';

export interface VoiceGamePlayer {
  userId: string;
  displayName: string;
}

export interface TicTacToeGameState {
  roomId: string;
  gameType: 'tic_tac_toe';
  board: Array<'X' | 'O' | null>;
  turn: 'X' | 'O';
  players: { X: VoiceGamePlayer | null; O: VoiceGamePlayer | null };
  winner: 'X' | 'O' | 'draw' | null;
  winningLine: number[] | null;
  updatedAt: string;
}

export type RpsChoice = 'rock' | 'paper' | 'scissors';

export interface RpsGameState {
  roomId: string;
  gameType: 'rps';
  round: number;
  players: [VoiceGamePlayer | null, VoiceGamePlayer | null];
  picks: Record<string, RpsChoice | null>;
  scores: Record<string, number>;
  lastResult: string | null;
  revealed: boolean;
  updatedAt: string;
}

export interface DiceDuelGameState {
  roomId: string;
  gameType: 'dice_duel';
  rolls: Array<{ userId: string; displayName: string; roll: number; bonus: string }>;
  winnerName: string | null;
  updatedAt: string;
}

export type VoiceGameState = TicTacToeGameState | RpsGameState | DiceDuelGameState;
