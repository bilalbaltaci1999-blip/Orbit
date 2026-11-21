import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { ALL_PERMISSIONS, type Permission } from '../shared/permissions.ts';
import { parseUtcMs } from './auth.ts';

export function isServerMember(db: Database.Database, serverId: string, userId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`)
    .get(serverId, userId);
  return Boolean(row);
}

export function isServerOwner(db: Database.Database, serverId: string, userId: string): boolean {
  const row = db
    .prepare(`SELECT owner_id FROM servers WHERE id = ?`)
    .get(serverId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

export function isServerBanned(db: Database.Database, serverId: string, userId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM server_bans WHERE server_id = ? AND user_id = ?`)
    .get(serverId, userId);
  return Boolean(row);
}

export function getMemberHighestRolePosition(
  db: Database.Database,
  serverId: string,
  userId: string
): number {
  if (isServerOwner(db, serverId, userId)) {
    return 1_000_000;
  }
  const row = db
    .prepare(
      `SELECT MAX(r.position) as max_pos
       FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       WHERE mr.server_id = ? AND mr.user_id = ?`
    )
    .get(serverId, userId) as { max_pos: number | null } | undefined;
  return row?.max_pos ?? 0;
}

export function getMemberPermissions(
  db: Database.Database,
  serverId: string,
  userId: string
): Set<Permission> {
  if (!isServerMember(db, serverId, userId)) {
    return new Set();
  }
  if (isServerOwner(db, serverId, userId)) {
    return new Set(ALL_PERMISSIONS);
  }

  const adminRow = db
    .prepare(
      `SELECT 1 FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       WHERE mr.server_id = ? AND mr.user_id = ? AND r.is_admin = 1`
    )
    .get(serverId, userId);

  if (adminRow) {
    return new Set(ALL_PERMISSIONS);
  }

  const rows = db
    .prepare(
      `SELECT DISTINCT rp.permission
       FROM roles r
       JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN member_roles mr ON mr.role_id = r.id AND mr.user_id = ?
       WHERE r.server_id = ? AND (r.is_default = 1 OR mr.user_id IS NOT NULL)`
    )
    .all(userId, serverId) as { permission: Permission }[];

  return new Set(rows.map((r) => r.permission));
}

export function hasServerPermission(
  db: Database.Database,
  serverId: string,
  userId: string,
  permission: Permission
): boolean {
  return getMemberPermissions(db, serverId, userId).has(permission);
}

export function resolveChannelOverride(
  db: Database.Database,
  serverId: string,
  channelId: string,
  userId: string,
  perm: string
): boolean | null {
  const rows = db
    .prepare(
      `SELECT cpo.allow_perms, cpo.deny_perms, r.is_default
       FROM channel_permission_overrides cpo
       JOIN roles r ON r.id = cpo.role_id
       LEFT JOIN member_roles mr ON mr.role_id = r.id AND mr.server_id = ? AND mr.user_id = ?
       WHERE cpo.channel_id = ? AND (r.is_default = 1 OR mr.user_id IS NOT NULL)`
    )
    .all(serverId, userId, channelId) as Array<{ allow_perms: string; deny_perms: string; is_default: number }>;

  if (rows.length === 0) return null;

  const assigned = rows.filter((r) => r.is_default === 0);
  const everyone = rows.filter((r) => r.is_default === 1);

  for (const r of assigned) {
    if (r.allow_perms.split(',').includes(perm)) return true;
  }
  for (const r of assigned) {
    if (r.deny_perms.split(',').includes(perm)) return false;
  }
  for (const r of everyone) {
    if (r.allow_perms.split(',').includes(perm)) return true;
  }
  for (const r of everyone) {
    if (r.deny_perms.split(',').includes(perm)) return false;
  }
  return null;
}

export function hasChannelPermission(
  db: Database.Database,
  channelId: string,
  userId: string,
  permission: Permission
): boolean {
  const channel = db
    .prepare(`SELECT server_id FROM channels WHERE id = ?`)
    .get(channelId) as { server_id: string } | undefined;
  if (!channel) return false;
  if (!isServerMember(db, channel.server_id, userId)) return false;
  if (isServerOwner(db, channel.server_id, userId)) return true;

  const perms = getMemberPermissions(db, channel.server_id, userId);
  if (perms.has('MANAGE_SERVER')) return true;

  const override = resolveChannelOverride(db, channel.server_id, channelId, userId, permission);
  if (override !== null) return override;
  return perms.has(permission);
}

export function canViewChannel(db: Database.Database, channelId: string, userId: string): boolean {
  const channel = db
    .prepare(`SELECT server_id, is_private FROM channels WHERE id = ?`)
    .get(channelId) as { server_id: string; is_private: number } | undefined;

  if (!channel) return false;
  if (!isServerMember(db, channel.server_id, userId)) return false;
  if (isServerOwner(db, channel.server_id, userId)) return true;

  const perms = getMemberPermissions(db, channel.server_id, userId);
  const overrideView = resolveChannelOverride(db, channel.server_id, channelId, userId, 'VIEW_CHANNEL');
  if (overrideView === false && !perms.has('MANAGE_SERVER')) return false;
  if (overrideView !== true && !perms.has('VIEW_CHANNEL')) return false;

  if (channel.is_private === 0) return true;

  // Private channel: user must have explicit member access or role access or MANAGE_CHANNELS/admin
  if (perms.has('MANAGE_CHANNELS')) return true;

  const memberAccess = db
    .prepare(`SELECT can_view FROM channel_members WHERE channel_id = ? AND user_id = ?`)
    .get(channelId, userId) as { can_view: number } | undefined;
  if (memberAccess) return memberAccess.can_view === 1;

  const roleAccess = db
    .prepare(
      `SELECT cra.can_view
       FROM channel_role_access cra
       JOIN member_roles mr ON mr.role_id = cra.role_id
       WHERE cra.channel_id = ? AND mr.user_id = ? AND cra.can_view = 1`
    )
    .get(channelId, userId);

  return Boolean(roleAccess) || overrideView === true;
}

export function canSendInChannel(
  db: Database.Database,
  channelId: string,
  userId: string
): { allowed: boolean; reason?: string } {
  const channel = db
    .prepare(`SELECT server_id, type, is_private FROM channels WHERE id = ?`)
    .get(channelId) as { server_id: string; type: string; is_private: number } | undefined;

  if (!channel) return { allowed: false, reason: 'Kanal bulunamadı.' };
  if (!canViewChannel(db, channelId, userId)) {
    return { allowed: false, reason: 'Bu kanala erişim izniniz yok.' };
  }

  const member = db
    .prepare(`SELECT muted_until FROM server_members WHERE server_id = ? AND user_id = ?`)
    .get(channel.server_id, userId) as { muted_until: string | null } | undefined;

  if (member?.muted_until && parseUtcMs(member.muted_until) > Date.now()) {
    return { allowed: false, reason: 'Bu sunucuda geçici olarak susturuldunuz.' };
  }

  const perms = getMemberPermissions(db, channel.server_id, userId);
  if (channel.type === 'announcement' && !perms.has('SEND_ANNOUNCEMENTS')) {
    return { allowed: false, reason: 'Duyuru kanallarına yalnızca yetkili üyeler mesaj gönderebilir.' };
  }

  if (!isServerOwner(db, channel.server_id, userId) && !perms.has('MANAGE_SERVER')) {
    const overrideSend = resolveChannelOverride(db, channel.server_id, channelId, userId, 'SEND_MESSAGES');
    if (overrideSend === false) {
      return { allowed: false, reason: 'Bu kanalda rol izni gereği yazma yetkiniz kapatılmış.' };
    }
    if (overrideSend !== true && !perms.has('SEND_MESSAGES')) {
      return { allowed: false, reason: 'Bu kanala mesaj gönderme izniniz yok.' };
    }
  } else if (!perms.has('SEND_MESSAGES')) {
    return { allowed: false, reason: 'Bu kanala mesaj gönderme izniniz yok.' };
  }

  if (channel.is_private === 1 && !isServerOwner(db, channel.server_id, userId) && !perms.has('MANAGE_CHANNELS')) {
    const memberAccess = db
      .prepare(`SELECT can_send FROM channel_members WHERE channel_id = ? AND user_id = ?`)
      .get(channelId, userId) as { can_send: number } | undefined;
    if (memberAccess && memberAccess.can_send === 0) {
      return { allowed: false, reason: 'Bu özel kanalda yazma izniniz kısıtlanmış.' };
    }
  }

  return { allowed: true };
}

export function isUserBlockedBetween(db: Database.Database, userA: string, userB: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM blocked_users
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`
    )
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

export function addModerationLog(
  db: Database.Database,
  serverId: string,
  actorId: string,
  action: string,
  targetUserId: string | null,
  details = ''
): void {
  db.prepare(
    `INSERT INTO moderation_logs (id, server_id, actor_id, action, target_user_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), serverId, actorId, action, targetUserId, details);
}
