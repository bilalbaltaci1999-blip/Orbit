import crypto from 'node:crypto';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { createAuthMiddleware, getProfileByUserId, grantBadge, rateLimit, type AuthenticatedRequest } from '../auth.ts';
import { hydrateChannelMessage, sendWelcomeMessageIfEnabled } from '../helpers.ts';
import { SERVER_TEMPLATES, type ServerTemplateId } from '../../shared/templates.ts';
import {
  ALL_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_MEMBER_PERMISSIONS,
  DEFAULT_MODERATOR_PERMISSIONS,
  type Permission,
} from '../../shared/permissions.ts';
import {
  addModerationLog,
  canViewChannel,
  getMemberHighestRolePosition,
  getMemberPermissions,
  hasServerPermission,
  isServerBanned,
  isServerMember,
  isServerOwner,
} from '../permissions.ts';
import { sanitizeFileName, uploadMiddleware } from '../upload.ts';
import { awardActivityXp } from '../gamification.ts';
import type { OrbitRealtimeHub } from '../ws.ts';

const createServerSchema = z.object({
  name: z.string().trim().min(2, 'Sunucu adı en az 2 karakter olmalı.').max(50),
  description: z.string().trim().max(240).optional().default(''),
  isDiscoverable: z.boolean().optional().default(false),
  template: z.enum(['blank', 'gaming', 'tech', 'study']).optional().default('blank'),
});

const createChannelSchema = z.object({
  name: z.string().trim().min(1, 'Kanal adı gerekli.').max(40),
  topic: z.string().trim().max(200).optional().default(''),
  type: z.enum(['category', 'text', 'voice', 'announcement', 'forum']),
  parentId: z.string().nullable().optional(),
  isPrivate: z.boolean().optional().default(false),
  isStage: z.boolean().optional().default(false),
  allowedRoleIds: z.array(z.string()).optional(),
  allowedUserIds: z.array(z.string()).optional(),
});

function buildServerSummary(db: Database.Database, serverId: string, userId: string) {
  const row = db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count,
              CASE WHEN sf.user_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
              COALESCE(snp.level, 'all') as notification_level
       FROM servers s
       LEFT JOIN server_favorites sf ON sf.server_id = s.id AND sf.user_id = ?
       LEFT JOIN server_notification_prefs snp ON snp.server_id = s.id AND snp.user_id = ?
       WHERE s.id = ?`
    )
    .get(userId, userId, serverId) as
    | {
        id: string;
        name: string;
        description: string;
        icon_url: string | null;
        owner_id: string;
        is_discoverable: number;
        moderation_level: 'low' | 'medium' | 'high';
        blocked_words: string;
        block_links: number;
        slowmode_seconds: number;
        created_at: string;
        member_count: number;
        is_favorite: number;
        notification_level: 'all' | 'mentions' | 'muted';
      }
    | undefined;

  if (!row) return null;

  const chRows = db
    .prepare(`SELECT id FROM channels WHERE server_id = ? AND type IN ('text', 'announcement')`)
    .all(serverId) as { id: string }[];
  let unreadCount = 0;
  for (const ch of chRows) {
    if (!canViewChannel(db, ch.id, userId)) continue;
    const receipt = db
      .prepare(`SELECT last_read_at FROM read_receipts WHERE user_id = ? AND target_type = 'channel' AND target_id = ?`)
      .get(userId, ch.id) as { last_read_at: string } | undefined;
    const cntRow = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM messages WHERE channel_id = ? AND author_id != ? AND deleted_at IS NULL AND created_at > ?`
      )
      .get(ch.id, userId, receipt?.last_read_at || '1970-01-01') as { cnt: number };
    unreadCount += cntRow.cnt;
  }

  const boostCount = (
    db.prepare(`SELECT COUNT(*) as cnt FROM server_boosts WHERE server_id = ?`).get(serverId) as { cnt: number }
  ).cnt;
  const boostLevel = boostCount >= 10 ? 3 : boostCount >= 5 ? 2 : boostCount >= 2 ? 1 : 0;
  const myBoosted = Boolean(
    db.prepare(`SELECT 1 FROM server_boosts WHERE server_id = ? AND user_id = ?`).get(serverId, userId)
  );
  const hasOfficialBot = Boolean(
    db
      .prepare(`SELECT 1 FROM server_bots WHERE server_id = ? AND bot_id = 'bot-orbit-official' AND enabled = 1`)
      .get(serverId)
  );

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    iconUrl: row.icon_url,
    ownerId: row.owner_id,
    isDiscoverable: row.is_discoverable === 1,
    moderationLevel: row.moderation_level,
    blockedWords: row.blocked_words,
    blockLinks: row.block_links === 1,
    slowmodeSeconds: row.slowmode_seconds,
    isFavorite: row.is_favorite === 1,
    notificationLevel: row.notification_level,
    memberCount: row.member_count,
    unreadCount,
    boostCount,
    boostLevel,
    myBoosted,
    hasOfficialBot,
    createdAt: row.created_at,
  };
}

export function createServerRoutes(db: Database.Database, hub: OrbitRealtimeHub): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(db);

  // List user's joined servers
  router.get('/servers', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const rows = db
      .prepare(
        `SELECT s.id
         FROM servers s
         JOIN server_members sm ON sm.server_id = s.id
         LEFT JOIN server_favorites sf ON sf.server_id = s.id AND sf.user_id = ?
         WHERE sm.user_id = ?
         ORDER BY sf.created_at DESC, s.created_at ASC`
      )
      .all(userId, userId) as { id: string }[];

    const servers = rows.map((r) => buildServerSummary(db, r.id, userId)).filter(Boolean);
    res.json({ servers });
  });

  // Discover public servers
  router.get('/servers/discover', requireAuth, (req: AuthenticatedRequest, res) => {
    const q = String(req.query.q || '').trim();
    const userId = req.userId!;
    const rows = q
      ? (db
          .prepare(
            `SELECT id FROM servers WHERE is_discoverable = 1 AND (name LIKE ? OR description LIKE ?) ORDER BY created_at DESC LIMIT 40`
          )
          .all(`%${q}%`, `%${q}%`) as { id: string }[])
      : (db
          .prepare(`SELECT id FROM servers WHERE is_discoverable = 1 ORDER BY created_at DESC LIMIT 40`)
          .all() as { id: string }[]);

    const joinedSet = new Set(
      (db.prepare(`SELECT server_id FROM server_members WHERE user_id = ?`).all(userId) as { server_id: string }[]).map(
        (r) => r.server_id
      )
    );

    const servers = rows
      .map((r) => {
        const s = buildServerSummary(db, r.id, userId);
        if (!s) return null;
        return { ...s, isJoined: joinedSet.has(s.id) };
      })
      .filter(Boolean);

    res.json({ servers });
  });

  // Create server with default roles & channels
  router.post('/servers', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = createServerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Geçersiz sunucu verisi.' });
      return;
    }

    const userId = req.userId!;
    const serverId = crypto.randomUUID();
    const everyoneRoleId = crypto.randomUUID();
    const modRoleId = crypto.randomUUID();
    const adminRoleId = crypto.randomUUID();
    const tpl = SERVER_TEMPLATES[parsed.data.template as ServerTemplateId] || SERVER_TEMPLATES.blank;
    let firstTextChannelId = '';

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO servers (id, name, description, owner_id, is_discoverable)
         VALUES (?, ?, ?, ?, ?)`
      ).run(serverId, parsed.data.name, parsed.data.description, userId, parsed.data.isDiscoverable ? 1 : 0);

      db.prepare(`INSERT INTO server_members (server_id, user_id) VALUES (?, ?)`).run(serverId, userId);

      // Roles
      db.prepare(
        `INSERT INTO roles (id, server_id, name, color, position, is_default, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(everyoneRoleId, serverId, '@herkes', '#94A3B8', 0, 1, 0);
      db.prepare(
        `INSERT INTO roles (id, server_id, name, color, position, is_default, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(modRoleId, serverId, 'Moderatör', '#3B82F6', 10, 0, 0);
      db.prepare(
        `INSERT INTO roles (id, server_id, name, color, position, is_default, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(adminRoleId, serverId, 'Yönetici', '#8B5CF6', 20, 0, 1);

      const permStmt = db.prepare(`INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)`);
      for (const p of DEFAULT_MEMBER_PERMISSIONS) permStmt.run(everyoneRoleId, p);
      for (const p of DEFAULT_MODERATOR_PERMISSIONS) permStmt.run(modRoleId, p);
      for (const p of DEFAULT_ADMIN_PERMISSIONS) permStmt.run(adminRoleId, p);

      for (const extraRole of tpl.defaultRoles) {
        const erId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO roles (id, server_id, name, color, position, is_default, is_admin) VALUES (?, ?, ?, ?, ?, 0, 0)`
        ).run(erId, serverId, extraRole.name, extraRole.color, extraRole.position);
        for (const p of DEFAULT_MEMBER_PERMISSIONS) permStmt.run(erId, p);
      }

      db.prepare(`INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)`).run(
        serverId,
        userId,
        adminRoleId
      );

      // Template categories & channels
      let pos = 0;
      let fallbackChannelId = '';
      for (const cat of tpl.categories) {
        const catId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO channels (id, server_id, parent_id, name, topic, type, position) VALUES (?, ?, NULL, ?, '', 'category', ?)`
        ).run(catId, serverId, cat.name, pos++);
        for (const ch of cat.channels) {
          const cid = crypto.randomUUID();
          if (!firstTextChannelId && ch.type === 'text') {
            firstTextChannelId = cid;
          } else if (!fallbackChannelId && ch.type === 'announcement') {
            fallbackChannelId = cid;
          }
          db.prepare(
            `INSERT INTO channels (id, server_id, parent_id, name, topic, type, position, is_stage)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(cid, serverId, catId, ch.name, ch.topic, ch.type, pos++, ch.isStage ? 1 : 0);
        }
      }
      if (!firstTextChannelId) firstTextChannelId = fallbackChannelId;

      grantBadge(db, userId, 'community_founder');
    });
    tx();

    awardActivityXp(db, userId, 'server');
    const server = buildServerSummary(db, serverId, userId);
    res.status(201).json({ server, defaultChannelId: firstTextChannelId });
  });

  // Get full server details (channels filtered strictly by user permission!)
  router.get('/servers/:serverId', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;

    if (!isServerMember(db, serverId, userId)) {
      res.status(403).json({ error: 'Bu sunucunun üyesi değilsiniz.' });
      return;
    }

    const server = buildServerSummary(db, serverId, userId);
    if (!server) {
      res.status(404).json({ error: 'Sunucu bulunamadı.' });
      return;
    }

    const myPermissions = Array.from(getMemberPermissions(db, serverId, userId));

    const allChannels = db
      .prepare(`SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC`)
      .all(serverId) as Array<{
      id: string;
      server_id: string;
      parent_id: string | null;
      name: string;
      topic: string;
      type: 'category' | 'text' | 'voice' | 'announcement' | 'forum';
      position: number;
      is_private: number;
      is_stage?: number;
      created_at: string;
    }>;

    const voiceCounts = new Map<string, number>();
    const vcRows = db
      .prepare(`SELECT channel_id, COUNT(*) as cnt FROM voice_sessions GROUP BY channel_id`)
      .all() as { channel_id: string; cnt: number }[];
    for (const r of vcRows) voiceCounts.set(r.channel_id, r.cnt);

    const visibleChannels = allChannels
      .filter((ch) => ch.type === 'category' || canViewChannel(db, ch.id, userId))
      .map((ch) => {
        const receipt = db
          .prepare(`SELECT last_read_at FROM read_receipts WHERE user_id = ? AND target_type = 'channel' AND target_id = ?`)
          .get(userId, ch.id) as { last_read_at: string } | undefined;
        let unreadCount = 0;
        if (ch.type === 'text' || ch.type === 'announcement') {
          const unreadRow = db
            .prepare(
              `SELECT COUNT(*) as cnt FROM messages WHERE channel_id = ? AND author_id != ? AND deleted_at IS NULL AND thread_id IS NULL AND created_at > ?`
            )
            .get(ch.id, userId, receipt?.last_read_at || '1970-01-01') as { cnt: number };
          unreadCount = unreadRow.cnt;
        }
        return {
          id: ch.id,
          serverId: ch.server_id,
          parentId: ch.parent_id,
          name: ch.name,
          topic: ch.topic,
          type: ch.type,
          position: ch.position,
          isPrivate: ch.is_private === 1,
          isStage: ch.is_stage === 1,
          unreadCount,
          voiceParticipantCount: voiceCounts.get(ch.id) || 0,
          createdAt: ch.created_at,
        };
      });

    const roleRows = db
      .prepare(`SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC`)
      .all(serverId) as Array<{
      id: string;
      server_id: string;
      name: string;
      color: string;
      position: number;
      is_default: number;
      is_admin: number;
    }>;

    const roles = roleRows.map((r) => {
      const perms = db
        .prepare(`SELECT permission FROM role_permissions WHERE role_id = ?`)
        .all(r.id) as { permission: Permission }[];
      return {
        id: r.id,
        serverId: r.server_id,
        name: r.name,
        color: r.color,
        position: r.position,
        isDefault: r.is_default === 1,
        isAdmin: r.is_admin === 1,
        permissions: perms.map((p) => p.permission),
      };
    });

    const memberRows = db
      .prepare(`SELECT * FROM server_members WHERE server_id = ? ORDER BY joined_at ASC`)
      .all(serverId) as Array<{
      server_id: string;
      user_id: string;
      nickname: string | null;
      muted_until: string | null;
      joined_at: string;
    }>;

    const members = memberRows
      .map((m) => {
        const profile = getProfileByUserId(db, m.user_id, hub.isUserOnline);
        if (!profile) return null;
        const mRoles = db
          .prepare(`SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?`)
          .all(serverId, m.user_id) as { role_id: string }[];
        return {
          serverId: m.server_id,
          userId: m.user_id,
          nickname: m.nickname,
          mutedUntil: m.muted_until,
          joinedAt: m.joined_at,
          profile,
          roleIds: mRoles.map((r) => r.role_id),
          highestRolePosition: getMemberHighestRolePosition(db, serverId, m.user_id),
        };
      })
      .filter(Boolean);

    const bans = myPermissions.includes('BAN_MEMBERS')
      ? (
          db
            .prepare(`SELECT user_id, reason, created_at FROM server_bans WHERE server_id = ?`)
            .all(serverId) as { user_id: string; reason: string; created_at: string }[]
        ).map((b) => ({
          userId: b.user_id,
          reason: b.reason,
          createdAt: b.created_at,
          profile: getProfileByUserId(db, b.user_id, hub.isUserOnline),
        }))
      : [];

    // Also include active voice sessions for visible voice channels
    const voiceParticipantsByChannel: Record<string, unknown[]> = {};
    for (const ch of visibleChannels) {
      if (ch.type !== 'voice') continue;
      const vsRows = db
        .prepare(`SELECT * FROM voice_sessions WHERE channel_id = ? ORDER BY joined_at ASC`)
        .all(ch.id) as Array<{
        user_id: string;
        channel_id: string;
        muted: number;
        deafened: number;
        server_muted: number;
        video_enabled: number;
        screen_sharing: number;
        hand_raised?: number;
        is_speaker?: number;
        joined_at: string;
      }>;
      voiceParticipantsByChannel[ch.id] = vsRows
        .map((r) => {
          const profile = getProfileByUserId(db, r.user_id, hub.isUserOnline);
          if (!profile) return null;
          return {
            userId: r.user_id,
            channelId: r.channel_id,
            profile,
            muted: r.muted === 1,
            deafened: r.deafened === 1,
            serverMuted: r.server_muted === 1,
            videoEnabled: r.video_enabled === 1,
            screenSharing: r.screen_sharing === 1,
            handRaised: r.hand_raised === 1,
            isSpeaker: r.is_speaker !== 0,
            speaking: false,
            joinedAt: r.joined_at,
          };
        })
        .filter(Boolean);
    }

    res.json({
      server,
      channels: visibleChannels,
      roles,
      members,
      myPermissions,
      bans,
      voiceParticipantsByChannel,
    });
  });

  // Update server settings
  router.patch('/servers/:serverId', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;

    if (!hasServerPermission(db, serverId, userId, 'MANAGE_SERVER')) {
      res.status(403).json({ error: 'Sunucu ayarlarını düzenleme yetkiniz yok.' });
      return;
    }

    const current = db.prepare(`SELECT * FROM servers WHERE id = ?`).get(serverId) as {
      name: string;
      description: string;
      is_discoverable: number;
      moderation_level: string;
      blocked_words: string;
      block_links: number;
      slowmode_seconds: number;
    };

    const name = typeof req.body?.name === 'string' && req.body.name.trim().length >= 2 ? req.body.name.trim().slice(0, 50) : current.name;
    const description = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 240) : current.description;
    const isDiscoverable = typeof req.body?.isDiscoverable === 'boolean' ? (req.body.isDiscoverable ? 1 : 0) : current.is_discoverable;
    const moderationLevel = ['low', 'medium', 'high'].includes(req.body?.moderationLevel) ? req.body.moderationLevel : current.moderation_level;
    const blockedWords = typeof req.body?.blockedWords === 'string' ? req.body.blockedWords.slice(0, 500) : current.blocked_words;
    const blockLinks = typeof req.body?.blockLinks === 'boolean' ? (req.body.blockLinks ? 1 : 0) : current.block_links;
    const slowmodeSeconds = typeof req.body?.slowmodeSeconds === 'number' ? Math.max(0, Math.min(120, Math.floor(req.body.slowmodeSeconds))) : current.slowmode_seconds;

    db.prepare(
      `UPDATE servers SET name = ?, description = ?, is_discoverable = ?, moderation_level = ?, blocked_words = ?, block_links = ?, slowmode_seconds = ? WHERE id = ?`
    ).run(name, description, isDiscoverable, moderationLevel, blockedWords, blockLinks, slowmodeSeconds, serverId);

    if (isDiscoverable === 1) {
      const chCount = db
        .prepare(`SELECT COUNT(*) as cnt FROM channels WHERE server_id = ? AND type != 'category'`)
        .get(serverId) as { cnt: number };
      const srvRow = db.prepare(`SELECT owner_id FROM servers WHERE id = ?`).get(serverId) as
        | { owner_id: string }
        | undefined;
      if (chCount.cnt >= 2 && srvRow) {
        grantBadge(db, srvRow.owner_id, 'orbit_partner');
        hub.broadcastPresence(srvRow.owner_id);
      }
    }

    addModerationLog(db, serverId, userId, 'SUNUCU_GÜNCELLENDİ', null, `Sunucu ayarları güncellendi: ${name}`);
    hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
    res.json({ server: buildServerSummary(db, serverId, userId) });
  });

  // Upload server icon
  router.post(
    '/servers/:serverId/icon',
    requireAuth,
    uploadMiddleware.single('icon'),
    (req: AuthenticatedRequest, res) => {
      const serverId = String(req.params.serverId);
      if (!hasServerPermission(db, serverId, req.userId!, 'MANAGE_SERVER')) {
        res.status(403).json({ error: 'Sunucu simgesini değiştirme yetkiniz yok.' });
        return;
      }
      const file = req.file;
      if (!file || !file.mimetype.startsWith('image/')) {
        res.status(400).json({ error: 'Geçerli bir görsel seçin.' });
        return;
      }
      const attachmentId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO message_attachments (id, uploader_id, file_name, mime_type, size_bytes, storage_path)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(attachmentId, req.userId!, sanitizeFileName(file.originalname), file.mimetype, file.size, file.filename);
      const iconUrl = `/api/files/${attachmentId}`;
      db.prepare(`UPDATE servers SET icon_url = ? WHERE id = ?`).run(iconUrl, serverId);
      hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
      res.json({ iconUrl, server: buildServerSummary(db, serverId, req.userId!) });
    }
  );

  // Favorite & notification preferences
  router.post('/servers/:serverId/favorite', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;
    if (!isServerMember(db, serverId, userId)) {
      res.status(403).json({ error: 'Üye değilsiniz.' });
      return;
    }
    const existing = db
      .prepare(`SELECT 1 FROM server_favorites WHERE user_id = ? AND server_id = ?`)
      .get(userId, serverId);
    if (existing) {
      db.prepare(`DELETE FROM server_favorites WHERE user_id = ? AND server_id = ?`).run(userId, serverId);
    } else {
      db.prepare(`INSERT INTO server_favorites (user_id, server_id) VALUES (?, ?)`).run(userId, serverId);
    }
    res.json({ isFavorite: !existing });
  });

  router.patch('/servers/:serverId/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const level = req.body?.level;
    if (!['all', 'mentions', 'muted'].includes(level)) {
      res.status(400).json({ error: 'Geçersiz bildirim düzeyi.' });
      return;
    }
    db.prepare(
      `INSERT INTO server_notification_prefs (user_id, server_id, level) VALUES (?, ?, ?)
       ON CONFLICT(user_id, server_id) DO UPDATE SET level = ?`
    ).run(req.userId!, serverId, level, level);
    res.json({ level });
  });

  // Join discoverable server
  router.post('/servers/:serverId/join', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;
    const srv = db.prepare(`SELECT is_discoverable FROM servers WHERE id = ?`).get(serverId) as
      | { is_discoverable: number }
      | undefined;
    if (!srv || srv.is_discoverable !== 1) {
      res.status(403).json({ error: 'Bu sunucu herkese açık keşfe kapalı. Davet bağlantısı ile katılabilirsiniz.' });
      return;
    }
    if (isServerBanned(db, serverId, userId)) {
      res.status(403).json({ error: 'Bu sunucudan yasaklandınız.' });
      return;
    }
    const already = isServerMember(db, serverId, userId);
    db.prepare(`INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)`).run(serverId, userId);
    if (!already) {
      sendWelcomeMessageIfEnabled(db, hub, serverId, userId);
    }
    hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
    res.json({ server: buildServerSummary(db, serverId, userId) });
  });

  // Leave server
  router.post('/servers/:serverId/leave', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;
    if (isServerOwner(db, serverId, userId)) {
      res.status(400).json({ error: 'Sunucu sahibi ayrılmadan önce sahipliği devretmeli veya sunucuyu silmelidir.' });
      return;
    }
    db.prepare(`DELETE FROM member_roles WHERE server_id = ? AND user_id = ?`).run(serverId, userId);
    db.prepare(`DELETE FROM server_members WHERE server_id = ? AND user_id = ?`).run(serverId, userId);
    hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
    res.json({ ok: true });
  });

  // Transfer ownership
  router.post('/servers/:serverId/transfer-ownership', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;
    const newOwnerId = String(req.body?.newOwnerId || '');
    if (!isServerOwner(db, serverId, userId)) {
      res.status(403).json({ error: 'Yalnızca sunucu sahibi sahipliği devredebilir.' });
      return;
    }
    if (!isServerMember(db, serverId, newOwnerId) || newOwnerId === userId) {
      res.status(400).json({ error: 'Hedef kullanıcı sunucu üyesi olmalıdır.' });
      return;
    }
    db.prepare(`UPDATE servers SET owner_id = ? WHERE id = ?`).run(newOwnerId, serverId);
    addModerationLog(db, serverId, userId, 'SAHİPLİK_DEVREDİLDİ', newOwnerId, 'Sunucu sahipliği devredildi.');
    hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
    res.json({ ok: true });
  });

  // Delete server
  router.delete('/servers/:serverId', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!isServerOwner(db, serverId, req.userId!)) {
      res.status(403).json({ error: 'Yalnızca sunucu sahibi sunucuyu silebilir.' });
      return;
    }
    db.prepare(`DELETE FROM servers WHERE id = ?`).run(serverId);
    hub.sendToRoom(`server:${serverId}`, { type: 'server:deleted', payload: { serverId } });
    res.json({ ok: true });
  });

  // --- INVITATIONS ---
  router.get('/servers/:serverId/invites', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!hasServerPermission(db, serverId, req.userId!, 'CREATE_INVITES')) {
      res.status(403).json({ error: 'Davetleri görüntüleme yetkiniz yok.' });
      return;
    }
    const rows = db
      .prepare(
        `SELECT i.*, p.display_name as creator_name
         FROM invitations i
         JOIN profiles p ON p.user_id = i.creator_id
         WHERE i.server_id = ?
         ORDER BY i.created_at DESC`
      )
      .all(serverId) as Array<{
      code: string;
      server_id: string;
      creator_id: string;
      creator_name: string;
      max_uses: number | null;
      uses: number;
      expires_at: string | null;
      created_at: string;
    }>;

    res.json({
      invites: rows.map((r) => ({
        code: r.code,
        serverId: r.server_id,
        creatorId: r.creator_id,
        creatorName: r.creator_name,
        maxUses: r.max_uses,
        uses: r.uses,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/servers/:serverId/invites', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!hasServerPermission(db, serverId, req.userId!, 'CREATE_INVITES')) {
      res.status(403).json({ error: 'Davet oluşturma yetkiniz yok.' });
      return;
    }
    // Cryptographically unpredictable invite code
    const code = crypto.randomBytes(6).toString('base64url');
    const maxUses = typeof req.body?.maxUses === 'number' && req.body.maxUses > 0 ? Math.floor(req.body.maxUses) : null;
    const expiresHours =
      typeof req.body?.expiresInHours === 'number' && req.body.expiresInHours > 0
        ? req.body.expiresInHours
        : null;
    const expiresAt = expiresHours ? new Date(Date.now() + expiresHours * 3600 * 1000).toISOString() : null;

    db.prepare(
      `INSERT INTO invitations (code, server_id, creator_id, max_uses, expires_at) VALUES (?, ?, ?, ?, ?)`
    ).run(code, serverId, req.userId!, maxUses, expiresAt);

    res.status(201).json({
      invite: {
        code,
        serverId,
        creatorId: req.userId!,
        maxUses,
        uses: 0,
        expiresAt,
        createdAt: new Date().toISOString(),
      },
    });
  });

  router.delete('/invites/:code', requireAuth, (req: AuthenticatedRequest, res) => {
    const invite = db.prepare(`SELECT server_id, creator_id FROM invitations WHERE code = ?`).get(req.params.code) as
      | { server_id: string; creator_id: string }
      | undefined;
    if (!invite) {
      res.status(404).json({ error: 'Davet bulunamadı.' });
      return;
    }
    if (invite.creator_id !== req.userId! && !hasServerPermission(db, invite.server_id, req.userId!, 'MANAGE_SERVER')) {
      res.status(403).json({ error: 'Bu daveti silme yetkiniz yok.' });
      return;
    }
    db.prepare(`DELETE FROM invitations WHERE code = ?`).run(req.params.code);
    res.json({ ok: true });
  });

  router.get('/invites/:code', requireAuth, (req: AuthenticatedRequest, res) => {
    const invite = db
      .prepare(
        `SELECT i.*, s.name as server_name, s.description as server_description, s.icon_url,
                (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count
         FROM invitations i
         JOIN servers s ON s.id = i.server_id
         WHERE i.code = ?`
      )
      .get(req.params.code) as
      | {
          code: string;
          server_id: string;
          max_uses: number | null;
          uses: number;
          expires_at: string | null;
          server_name: string;
          server_description: string;
          icon_url: string | null;
          member_count: number;
        }
      | undefined;

    if (!invite) {
      res.status(404).json({ error: 'Davet bağlantısı geçersiz.' });
      return;
    }
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
      res.status(410).json({ error: 'Bu davet bağlantısının süresi dolmuş.' });
      return;
    }
    if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
      res.status(410).json({ error: 'Bu davet bağlantısı maksimum kullanım sınırına ulaşmış.' });
      return;
    }

    res.json({
      invite: {
        code: invite.code,
        serverId: invite.server_id,
        serverName: invite.server_name,
        serverDescription: invite.server_description,
        iconUrl: invite.icon_url,
        memberCount: invite.member_count,
      },
    });
  });

  router.post('/invites/:code/join', requireAuth, (req: AuthenticatedRequest, res) => {
    const code = String(req.params.code).trim();
    const userId = req.userId!;

    const result = db.transaction(() => {
      const invite = db.prepare(`SELECT * FROM invitations WHERE code = ?`).get(code) as
        | { code: string; server_id: string; max_uses: number | null; uses: number; expires_at: string | null }
        | undefined;
      if (!invite) return { error: 'Geçersiz davet kodu.', status: 404 };
      if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
        return { error: 'Bu davetin süresi dolmuş.', status: 410 };
      }
      if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
        return { error: 'Bu davetin kullanım limiti dolmuş.', status: 410 };
      }
      if (isServerBanned(db, invite.server_id, userId)) {
        return { error: 'Bu sunucudan yasaklandınız.', status: 403 };
      }

      const alreadyMember = isServerMember(db, invite.server_id, userId);
      if (!alreadyMember) {
        db.prepare(`INSERT INTO server_members (server_id, user_id) VALUES (?, ?)`).run(invite.server_id, userId);
        db.prepare(`UPDATE invitations SET uses = uses + 1 WHERE code = ?`).run(code);
      }

      return { serverId: invite.server_id, status: 200, newlyJoined: !alreadyMember };
    })();

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    if (result.newlyJoined) {
      sendWelcomeMessageIfEnabled(db, hub, result.serverId, userId);
    }
    hub.sendToRoom(`server:${result.serverId}`, { type: 'member:updated', payload: { serverId: result.serverId } });
    res.json({ server: buildServerSummary(db, result.serverId, userId) });
  });

  // --- CHANNELS ---
  router.post('/servers/:serverId/channels', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;
    if (!hasServerPermission(db, serverId, userId, 'MANAGE_CHANNELS')) {
      res.status(403).json({ error: 'Kanal oluşturma yetkiniz yok.' });
      return;
    }

    const parsed = createChannelSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Geçersiz kanal bilgisi.' });
      return;
    }

    const maxPos = db
      .prepare(`SELECT COALESCE(MAX(position), 0) as max_pos FROM channels WHERE server_id = ?`)
      .get(serverId) as { max_pos: number };

    const channelId = crypto.randomUUID();
    const { name, topic, type, parentId, isPrivate, isStage, allowedRoleIds, allowedUserIds } = parsed.data;
    const cleanName = type === 'category' ? name : name.toLowerCase().replace(/\s+/g, '-').slice(0, 40);

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO channels (id, server_id, parent_id, name, topic, type, position, is_private, is_stage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        channelId,
        serverId,
        parentId || null,
        cleanName,
        topic,
        type,
        maxPos.max_pos + 1,
        isPrivate ? 1 : 0,
        type === 'voice' && isStage ? 1 : 0
      );

      if (isPrivate) {
        db.prepare(`INSERT OR IGNORE INTO channel_members (channel_id, user_id, can_view, can_send) VALUES (?, ?, 1, 1)`).run(
          channelId,
          userId
        );
        if (allowedRoleIds?.length) {
          const stmt = db.prepare(
            `INSERT OR IGNORE INTO channel_role_access (channel_id, role_id, can_view, can_send) VALUES (?, ?, 1, 1)`
          );
          for (const rid of allowedRoleIds) stmt.run(channelId, rid);
        }
        if (allowedUserIds?.length) {
          const stmt = db.prepare(
            `INSERT OR IGNORE INTO channel_members (channel_id, user_id, can_view, can_send) VALUES (?, ?, 1, 1)`
          );
          for (const uid of allowedUserIds) stmt.run(channelId, uid);
        }
      }
    });
    tx();

    addModerationLog(db, serverId, userId, 'KANAL_OLUŞTURULDU', null, `#${cleanName} (${type})`);
    hub.sendToRoom(`server:${serverId}`, { type: 'channel:updated', payload: { serverId, channelId } });
    res.status(201).json({ channelId });
  });

  router.patch('/channels/:channelId', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const ch = db.prepare(`SELECT * FROM channels WHERE id = ?`).get(channelId) as
      | { id: string; server_id: string; name: string; topic: string; type: string; parent_id: string | null; is_private: number; is_stage?: number }
      | undefined;
    if (!ch) {
      res.status(404).json({ error: 'Kanal bulunamadı.' });
      return;
    }
    if (!hasServerPermission(db, ch.server_id, req.userId!, 'MANAGE_CHANNELS')) {
      res.status(403).json({ error: 'Kanalı düzenleme yetkiniz yok.' });
      return;
    }

    const name =
      typeof req.body?.name === 'string' && req.body.name.trim()
        ? ch.type === 'category'
          ? req.body.name.trim().slice(0, 40)
          : req.body.name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40)
        : ch.name;
    const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim().slice(0, 200) : ch.topic;
    const isPrivate = typeof req.body?.isPrivate === 'boolean' ? (req.body.isPrivate ? 1 : 0) : ch.is_private;
    const isStage =
      ch.type === 'voice' && typeof req.body?.isStage === 'boolean'
        ? req.body.isStage
          ? 1
          : 0
        : ch.is_stage || 0;
    const parentId = req.body?.parentId !== undefined ? req.body.parentId : ch.parent_id;

    const tx = db.transaction(() => {
      db.prepare(`UPDATE channels SET name = ?, topic = ?, is_private = ?, is_stage = ?, parent_id = ? WHERE id = ?`).run(
        name,
        topic,
        isPrivate,
        isStage,
        parentId,
        channelId
      );

      if (Array.isArray(req.body?.allowedRoleIds)) {
        db.prepare(`DELETE FROM channel_role_access WHERE channel_id = ?`).run(channelId);
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO channel_role_access (channel_id, role_id, can_view, can_send) VALUES (?, ?, 1, 1)`
        );
        for (const rid of req.body.allowedRoleIds as string[]) stmt.run(channelId, rid);
      }

      if (Array.isArray(req.body?.allowedUserIds)) {
        db.prepare(`DELETE FROM channel_members WHERE channel_id = ?`).run(channelId);
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO channel_members (channel_id, user_id, can_view, can_send) VALUES (?, ?, 1, 1)`
        );
        stmt.run(channelId, req.userId!);
        for (const uid of req.body.allowedUserIds as string[]) stmt.run(channelId, uid);
      }
    });
    tx();

    hub.sendToRoom(`server:${ch.server_id}`, { type: 'channel:updated', payload: { serverId: ch.server_id, channelId } });
    res.json({ ok: true });
  });

  router.post('/servers/:serverId/channels/reorder', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!hasServerPermission(db, serverId, req.userId!, 'MANAGE_CHANNELS')) {
      res.status(403).json({ error: 'Kanal sıralamasını değiştirme yetkiniz yok.' });
      return;
    }
    const items = Array.isArray(req.body?.orderedIds) ? (req.body.orderedIds as string[]) : [];
    const stmt = db.prepare(`UPDATE channels SET position = ? WHERE id = ? AND server_id = ?`);
    const tx = db.transaction(() => {
      items.forEach((cid, idx) => stmt.run(idx, cid, serverId));
    });
    tx();
    hub.sendToRoom(`server:${serverId}`, { type: 'channel:updated', payload: { serverId } });
    res.json({ ok: true });
  });

  router.delete('/channels/:channelId', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const ch = db.prepare(`SELECT server_id, name FROM channels WHERE id = ?`).get(channelId) as
      | { server_id: string; name: string }
      | undefined;
    if (!ch) {
      res.status(404).json({ error: 'Kanal bulunamadı.' });
      return;
    }
    if (!hasServerPermission(db, ch.server_id, req.userId!, 'MANAGE_CHANNELS')) {
      res.status(403).json({ error: 'Kanal silme yetkiniz yok.' });
      return;
    }
    db.prepare(`DELETE FROM channels WHERE id = ?`).run(channelId);
    addModerationLog(db, ch.server_id, req.userId!, 'KANAL_SİLİNDİ', null, `#${ch.name}`);
    hub.sendToRoom(`server:${ch.server_id}`, { type: 'channel:updated', payload: { serverId: ch.server_id } });
    res.json({ ok: true });
  });

  // Follow announcement channel into target text channel
  router.post('/channels/:channelId/follow-announcements', requireAuth, (req: AuthenticatedRequest, res) => {
    const sourceChannelId = String(req.params.channelId);
    const targetChannelId = String(req.body?.targetChannelId || '');
    const source = db.prepare(`SELECT type FROM channels WHERE id = ?`).get(sourceChannelId) as { type: string } | undefined;
    const target = db.prepare(`SELECT server_id, type FROM channels WHERE id = ?`).get(targetChannelId) as
      | { server_id: string; type: string }
      | undefined;

    if (!source || source.type !== 'announcement' || !target || target.type !== 'text') {
      res.status(400).json({ error: 'Geçerli bir duyuru kanalı ve hedef metin kanalı seçin.' });
      return;
    }
    if (!canViewChannel(db, sourceChannelId, req.userId!)) {
      res.status(403).json({ error: 'Kaynak duyuru kanalını görme izniniz yok.' });
      return;
    }
    if (!hasServerPermission(db, target.server_id, req.userId!, 'MANAGE_CHANNELS')) {
      res.status(403).json({ error: 'Hedef kanalda bu entegrasyonu yönetme yetkiniz yok.' });
      return;
    }

    db.prepare(
      `INSERT OR IGNORE INTO announcement_subscriptions (source_channel_id, target_channel_id, created_by)
       VALUES (?, ?, ?)`
    ).run(sourceChannelId, targetChannelId, req.userId!);
    res.json({ ok: true });
  });

  // --- ROLES & PERMISSIONS (WITH ROLE HIERARCHY!) ---
  router.post('/servers/:serverId/roles', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;
    if (!hasServerPermission(db, serverId, userId, 'MANAGE_ROLES')) {
      res.status(403).json({ error: 'Rol oluşturma yetkiniz yok.' });
      return;
    }

    const myTopPos = getMemberHighestRolePosition(db, serverId, userId);
    const name = String(req.body?.name || 'Yeni Rol').trim().slice(0, 32);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(req.body?.color || '')) ? String(req.body.color) : '#6366F1';
    const requestedPos = Number(req.body?.position ?? 1);
    const position = isServerOwner(db, serverId, userId) ? requestedPos : Math.min(requestedPos, Math.max(1, myTopPos - 1));
    const permissions = Array.isArray(req.body?.permissions)
      ? (req.body.permissions as Permission[]).filter((p) => ALL_PERMISSIONS.includes(p))
      : DEFAULT_MEMBER_PERMISSIONS;

    const roleId = crypto.randomUUID();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO roles (id, server_id, name, color, position, is_default, is_admin) VALUES (?, ?, ?, ?, ?, 0, ?)`).run(
        roleId,
        serverId,
        name,
        color,
        position,
        req.body?.isAdmin && isServerOwner(db, serverId, userId) ? 1 : 0
      );
      const stmt = db.prepare(`INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)`);
      for (const p of permissions) stmt.run(roleId, p);
    });
    tx();

    addModerationLog(db, serverId, userId, 'ROL_OLUŞTURULDU', null, name);
    hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
    res.status(201).json({ roleId });
  });

  router.patch('/roles/:roleId', requireAuth, (req: AuthenticatedRequest, res) => {
    const roleId = String(req.params.roleId);
    const userId = req.userId!;
    const role = db.prepare(`SELECT * FROM roles WHERE id = ?`).get(roleId) as
      | { id: string; server_id: string; name: string; color: string; position: number; is_default: number; is_admin: number }
      | undefined;
    if (!role) {
      res.status(404).json({ error: 'Rol bulunamadı.' });
      return;
    }
    if (!hasServerPermission(db, role.server_id, userId, 'MANAGE_ROLES')) {
      res.status(403).json({ error: 'Rol düzenleme yetkiniz yok.' });
      return;
    }

    const myTopPos = getMemberHighestRolePosition(db, role.server_id, userId);
    if (!isServerOwner(db, role.server_id, userId) && role.position >= myTopPos) {
      res.status(403).json({ error: 'Kendi yetkinizin üzerindeki veya eşit seviyedeki rolleri düzenleyemezsiniz.' });
      return;
    }

    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 32) : role.name;
    const color = /^#[0-9a-fA-F]{6}$/.test(String(req.body?.color || '')) ? String(req.body.color) : role.color;

    const tx = db.transaction(() => {
      db.prepare(`UPDATE roles SET name = ?, color = ? WHERE id = ?`).run(name, color, roleId);
      if (Array.isArray(req.body?.permissions)) {
        db.prepare(`DELETE FROM role_permissions WHERE role_id = ?`).run(roleId);
        const stmt = db.prepare(`INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)`);
        for (const p of req.body.permissions as Permission[]) {
          if (ALL_PERMISSIONS.includes(p)) stmt.run(roleId, p);
        }
      }
    });
    tx();

    addModerationLog(db, role.server_id, userId, 'ROL_GÜNCELLENDİ', null, name);
    hub.sendToRoom(`server:${role.server_id}`, { type: 'server:updated', payload: { serverId: role.server_id } });
    res.json({ ok: true });
  });

  router.delete('/roles/:roleId', requireAuth, (req: AuthenticatedRequest, res) => {
    const roleId = String(req.params.roleId);
    const userId = req.userId!;
    const role = db.prepare(`SELECT * FROM roles WHERE id = ?`).get(roleId) as
      | { id: string; server_id: string; name: string; position: number; is_default: number }
      | undefined;
    if (!role || role.is_default === 1) {
      res.status(400).json({ error: 'Varsayılan rol silinemez.' });
      return;
    }
    if (!hasServerPermission(db, role.server_id, userId, 'MANAGE_ROLES')) {
      res.status(403).json({ error: 'Rol silme yetkiniz yok.' });
      return;
    }
    const myTopPos = getMemberHighestRolePosition(db, role.server_id, userId);
    if (!isServerOwner(db, role.server_id, userId) && role.position >= myTopPos) {
      res.status(403).json({ error: 'Kendi yetkinizin üzerindeki rolleri silemezsiniz.' });
      return;
    }
    db.prepare(`DELETE FROM roles WHERE id = ?`).run(roleId);
    addModerationLog(db, role.server_id, userId, 'ROL_SİLİNDİ', null, role.name);
    hub.sendToRoom(`server:${role.server_id}`, { type: 'server:updated', payload: { serverId: role.server_id } });
    res.json({ ok: true });
  });

  router.put('/servers/:serverId/members/:targetUserId/roles', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const targetUserId = String(req.params.targetUserId);
    const userId = req.userId!;

    if (!hasServerPermission(db, serverId, userId, 'MANAGE_MEMBERS')) {
      res.status(403).json({ error: 'Üye rollerini yönetme yetkiniz yok.' });
      return;
    }

    const myTopPos = getMemberHighestRolePosition(db, serverId, userId);
    const targetTopPos = getMemberHighestRolePosition(db, serverId, targetUserId);
    if (!isServerOwner(db, serverId, userId) && targetTopPos >= myTopPos && targetUserId !== userId) {
      res.status(403).json({ error: 'Sizden yüksek veya eşit role sahip bir üyenin rollerini değiştiremezsiniz.' });
      return;
    }

    const roleIds = Array.isArray(req.body?.roleIds) ? (req.body.roleIds as string[]) : [];
    const validRoles = db
      .prepare(`SELECT id, position FROM roles WHERE server_id = ? AND is_default = 0`)
      .all(serverId) as { id: string; position: number }[];
    const validRoleMap = new Map(validRoles.map((r) => [r.id, r.position]));

    for (const rid of roleIds) {
      const pos = validRoleMap.get(rid);
      if (pos === undefined) {
        res.status(400).json({ error: 'Geçersiz rol ID.' });
        return;
      }
      if (!isServerOwner(db, serverId, userId) && pos >= myTopPos) {
        res.status(403).json({ error: 'Kendi rolünüzden yüksek veya eşit bir rolü atayamazsınız.' });
        return;
      }
    }

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM member_roles WHERE server_id = ? AND user_id = ?`).run(serverId, targetUserId);
      const stmt = db.prepare(`INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)`);
      for (const rid of roleIds) stmt.run(serverId, targetUserId, rid);
    });
    tx();

    addModerationLog(db, serverId, userId, 'ÜYE_ROLLERİ_GÜNCELLENDİ', targetUserId, `Rol sayısı: ${roleIds.length}`);
    hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
    res.json({ ok: true });
  });

  // --- MODERATION: MUTE, KICK, BAN, UNBAN, LOGS, REPORTS ---
  router.post('/servers/:serverId/members/:targetUserId/mute', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const targetUserId = String(req.params.targetUserId);
    const userId = req.userId!;

    if (!hasServerPermission(db, serverId, userId, 'MUTE_MEMBERS')) {
      res.status(403).json({ error: 'Üye susturma yetkiniz yok.' });
      return;
    }
    const myPos = getMemberHighestRolePosition(db, serverId, userId);
    const targetPos = getMemberHighestRolePosition(db, serverId, targetUserId);
    if (!isServerOwner(db, serverId, userId) && targetPos >= myPos) {
      res.status(403).json({ error: 'Bu üyeyi susturmak için rolünüz yetersiz.' });
      return;
    }

    const minutes = Number(req.body?.minutes ?? 10);
    const mutedUntil = minutes > 0 ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : null;
    db.prepare(`UPDATE server_members SET muted_until = ? WHERE server_id = ? AND user_id = ?`).run(
      mutedUntil,
      serverId,
      targetUserId
    );
    addModerationLog(
      db,
      serverId,
      userId,
      mutedUntil ? 'ÜYE_SUSTURULDU' : 'SUSTURMA_KALDIRILDI',
      targetUserId,
      mutedUntil ? `${minutes} dakika` : 'Susturma kaldırıldı'
    );
    grantBadge(db, userId, 'orbit_moderator');
    hub.broadcastPresence(userId);
    hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
    res.json({ mutedUntil });
  });

  router.patch('/servers/:serverId/members/:targetUserId/nickname', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const targetUserId = String(req.params.targetUserId);
    const userId = req.userId!;

    if (!isServerMember(db, serverId, targetUserId)) {
      res.status(404).json({ error: 'Üye bulunamadı.' });
      return;
    }
    if (targetUserId !== userId && !hasServerPermission(db, serverId, userId, 'MANAGE_MEMBERS')) {
      res.status(403).json({ error: 'Diğer üyelerin sunucu takma adını değiştirme yetkiniz yok.' });
      return;
    }
    const rawNick = typeof req.body?.nickname === 'string' ? req.body.nickname.trim().slice(0, 36) : '';
    const nickname = rawNick.length > 0 ? rawNick : null;
    db.prepare(`UPDATE server_members SET nickname = ? WHERE server_id = ? AND user_id = ?`).run(
      nickname,
      serverId,
      targetUserId
    );
    hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
    res.json({ nickname });
  });

  router.post('/servers/:serverId/members/:targetUserId/kick', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const targetUserId = String(req.params.targetUserId);
    const userId = req.userId!;

    if (!hasServerPermission(db, serverId, userId, 'KICK_MEMBERS')) {
      res.status(403).json({ error: 'Üye çıkarma yetkiniz yok.' });
      return;
    }
    if (isServerOwner(db, serverId, targetUserId)) {
      res.status(403).json({ error: 'Sunucu sahibi çıkarılamaz.' });
      return;
    }
    const myPos = getMemberHighestRolePosition(db, serverId, userId);
    const targetPos = getMemberHighestRolePosition(db, serverId, targetUserId);
    if (!isServerOwner(db, serverId, userId) && targetPos >= myPos) {
      res.status(403).json({ error: 'Bu üyeyi çıkarmak için rolünüz yetersiz.' });
      return;
    }

    db.prepare(`DELETE FROM member_roles WHERE server_id = ? AND user_id = ?`).run(serverId, targetUserId);
    db.prepare(`DELETE FROM server_members WHERE server_id = ? AND user_id = ?`).run(serverId, targetUserId);
    addModerationLog(db, serverId, userId, 'ÜYE_ÇIKARILDI', targetUserId, String(req.body?.reason || ''));
    grantBadge(db, userId, 'orbit_moderator');
    hub.broadcastPresence(userId);
    hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
    hub.sendToUser(targetUserId, { type: 'server:kicked', payload: { serverId } });
    res.json({ ok: true });
  });

  router.post('/servers/:serverId/members/:targetUserId/ban', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const targetUserId = String(req.params.targetUserId);
    const userId = req.userId!;

    if (!hasServerPermission(db, serverId, userId, 'BAN_MEMBERS')) {
      res.status(403).json({ error: 'Üye yasaklama yetkiniz yok.' });
      return;
    }
    if (isServerOwner(db, serverId, targetUserId)) {
      res.status(403).json({ error: 'Sunucu sahibi yasaklanamaz.' });
      return;
    }
    const myPos = getMemberHighestRolePosition(db, serverId, userId);
    const targetPos = getMemberHighestRolePosition(db, serverId, targetUserId);
    if (!isServerOwner(db, serverId, userId) && targetPos >= myPos) {
      res.status(403).json({ error: 'Bu üyeyi yasaklamak için rolünüz yetersiz.' });
      return;
    }

    const reason = String(req.body?.reason || '').trim().slice(0, 200);
    const tx = db.transaction(() => {
      db.prepare(`INSERT OR REPLACE INTO server_bans (server_id, user_id, banned_by, reason) VALUES (?, ?, ?, ?)`).run(
        serverId,
        targetUserId,
        userId,
        reason
      );
      db.prepare(`DELETE FROM member_roles WHERE server_id = ? AND user_id = ?`).run(serverId, targetUserId);
      db.prepare(`DELETE FROM server_members WHERE server_id = ? AND user_id = ?`).run(serverId, targetUserId);
    });
    tx();

    addModerationLog(db, serverId, userId, 'ÜYE_YASAKLANDI', targetUserId, reason);
    grantBadge(db, userId, 'orbit_moderator');
    hub.broadcastPresence(userId);
    hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
    hub.sendToUser(targetUserId, { type: 'server:kicked', payload: { serverId } });
    res.json({ ok: true });
  });

  router.delete('/servers/:serverId/bans/:targetUserId', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const targetUserId = String(req.params.targetUserId);
    if (!hasServerPermission(db, serverId, req.userId!, 'BAN_MEMBERS')) {
      res.status(403).json({ error: 'Yasak kaldırma yetkiniz yok.' });
      return;
    }
    db.prepare(`DELETE FROM server_bans WHERE server_id = ? AND user_id = ?`).run(serverId, targetUserId);
    addModerationLog(db, serverId, req.userId!, 'YASAK_KALDIRILDI', targetUserId, '');
    res.json({ ok: true });
  });

  router.get('/servers/:serverId/moderation-logs', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (
      !hasServerPermission(db, serverId, req.userId!, 'MANAGE_SERVER') &&
      !hasServerPermission(db, serverId, req.userId!, 'KICK_MEMBERS')
    ) {
      res.status(403).json({ error: 'Moderasyon kayıtlarını görme yetkiniz yok.' });
      return;
    }

    const rows = db
      .prepare(
        `SELECT ml.*, ap.display_name as actor_name, tp.display_name as target_name
         FROM moderation_logs ml
         JOIN profiles ap ON ap.user_id = ml.actor_id
         LEFT JOIN profiles tp ON tp.user_id = ml.target_user_id
         WHERE ml.server_id = ?
         ORDER BY ml.created_at DESC
         LIMIT 100`
      )
      .all(serverId) as Array<{
      id: string;
      server_id: string;
      actor_id: string;
      actor_name: string;
      action: string;
      target_user_id: string | null;
      target_name: string | null;
      details: string;
      created_at: string;
    }>;

    res.json({
      logs: rows.map((r) => ({
        id: r.id,
        serverId: r.server_id,
        actorId: r.actor_id,
        actorName: r.actor_name,
        action: r.action,
        targetUserId: r.target_user_id,
        targetName: r.target_name,
        details: r.details,
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/reports', requireAuth, rateLimit('reports', 8, 60_000), (req: AuthenticatedRequest, res) => {
    const targetType = req.body?.targetType;
    const targetId = String(req.body?.targetId || '').trim();
    const category = req.body?.category ? String(req.body.category).trim().slice(0, 40) : '';
    let serverId = req.body?.serverId ? String(req.body.serverId).trim() : null;
    const rawReason = String(req.body?.reason || '').trim().slice(0, 400);

    if (!['user', 'message', 'server'].includes(targetType) || !targetId || rawReason.length < 3) {
      res.status(400).json({ error: 'Şikâyet türü, hedefi ve en az 3 karakterlik açıklama gerekli.' });
      return;
    }

    if (targetType === 'user' && targetId === req.userId!) {
      res.status(400).json({ error: 'Kendi hesabınızı şikâyet edemezsiniz.' });
      return;
    }

    if (targetType === 'message' && !serverId) {
      const msgServer = db
        .prepare(
          `SELECT c.server_id
           FROM messages m
           JOIN channels c ON c.id = m.channel_id
           WHERE m.id = ?`
        )
        .get(targetId) as { server_id: string } | undefined;
      if (msgServer?.server_id) {
        serverId = msgServer.server_id;
      }
    }

    if (targetType === 'server' && !serverId) {
      serverId = targetId;
    }

    if (serverId) {
      const serverExists = db.prepare(`SELECT 1 FROM servers WHERE id = ?`).get(serverId);
      if (!serverExists) serverId = null;
    }

    const recentDup = db
      .prepare(
        `SELECT id FROM user_reports
         WHERE reporter_id = ? AND target_type = ? AND target_id = ?
           AND created_at >= datetime('now', '-60 seconds')
         LIMIT 1`
      )
      .get(req.userId!, targetType, targetId) as { id: string } | undefined;

    if (recentDup) {
      res.status(429).json({ error: 'Bu içerik için kısa süre önce zaten bir şikâyet gönderdiniz.' });
      return;
    }

    const reason = category ? `[${category}] ${rawReason}` : rawReason;
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO user_reports (id, reporter_id, target_type, target_id, server_id, reason)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, req.userId!, targetType, targetId, serverId, reason.slice(0, 450));

    if (serverId) {
      addModerationLog(db, serverId, req.userId!, 'ŞİKÂYET_OLUŞTURULDU', null, `${targetType}: ${reason.slice(0, 80)}`);
    }
    grantBadge(db, req.userId!, 'bug_hunter');
    hub.broadcastPresence(req.userId!);

    res.status(201).json({ id });
  });

  router.get('/servers/:serverId/reports', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!hasServerPermission(db, serverId, req.userId!, 'MANAGE_SERVER')) {
      res.status(403).json({ error: 'Şikâyetleri görüntüleme yetkiniz yok.' });
      return;
    }
    const rows = db
      .prepare(
        `SELECT r.*, p.display_name as reporter_name
         FROM user_reports r
         JOIN profiles p ON p.user_id = r.reporter_id
         WHERE r.server_id = ?
         ORDER BY r.created_at DESC LIMIT 50`
      )
      .all(serverId);
    res.json({ reports: rows });
  });

  // --- SERVER WEBHOOKS & BOT INTEGRATIONS ---
  router.get('/servers/:serverId/webhooks', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (
      !hasServerPermission(db, serverId, req.userId!, 'MANAGE_SERVER') &&
      !hasServerPermission(db, serverId, req.userId!, 'MANAGE_CHANNELS')
    ) {
      res.status(403).json({ error: 'Webhook ve bot entegrasyonlarını görme yetkiniz yok.' });
      return;
    }
    const rows = db
      .prepare(
        `SELECT w.*, c.name as channel_name, p.display_name as created_by_name
         FROM server_webhooks w
         JOIN channels c ON c.id = w.channel_id
         JOIN profiles p ON p.user_id = w.created_by
         WHERE w.server_id = ?
         ORDER BY w.created_at DESC`
      )
      .all(serverId) as Array<{
      id: string;
      server_id: string;
      channel_id: string;
      channel_name: string;
      name: string;
      token: string;
      created_by: string;
      created_by_name: string;
      created_at: string;
    }>;

    res.json({
      webhooks: rows.map((w) => ({
        id: w.id,
        serverId: w.server_id,
        channelId: w.channel_id,
        channelName: w.channel_name,
        name: w.name,
        token: w.token,
        createdBy: w.created_by,
        createdByName: w.created_by_name,
        createdAt: w.created_at,
      })),
    });
  });

  router.post('/servers/:serverId/webhooks', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;
    if (
      !hasServerPermission(db, serverId, userId, 'MANAGE_SERVER') &&
      !hasServerPermission(db, serverId, userId, 'MANAGE_CHANNELS')
    ) {
      res.status(403).json({ error: 'Webhook / Bot oluşturma yetkiniz yok.' });
      return;
    }

    const name = String(req.body?.name || '').trim().slice(0, 40);
    const channelId = String(req.body?.channelId || '').trim();
    if (name.length < 2 || !channelId) {
      res.status(400).json({ error: 'Bot adı (en az 2 karakter) ve hedef metin kanalı seçin.' });
      return;
    }

    const ch = db
      .prepare(`SELECT id, name, type FROM channels WHERE id = ? AND server_id = ?`)
      .get(channelId, serverId) as { id: string; name: string; type: string } | undefined;
    if (!ch || !['text', 'announcement'].includes(ch.type)) {
      res.status(400).json({ error: 'Geçerli bir metin veya duyuru kanalı seçin.' });
      return;
    }

    const webhookId = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare(
      `INSERT INTO server_webhooks (id, server_id, channel_id, name, token, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(webhookId, serverId, channelId, name, token, userId);

    grantBadge(db, userId, 'bot_developer');
    hub.broadcastPresence(userId);
    addModerationLog(db, serverId, userId, 'WEBHOOK_OLUŞTURULDU', null, `${name} → #${ch.name}`);

    const creator = getProfileByUserId(db, userId, hub.isUserOnline);
    res.status(201).json({
      webhook: {
        id: webhookId,
        serverId,
        channelId,
        channelName: ch.name,
        name,
        token,
        createdBy: userId,
        createdByName: creator?.displayName || 'Üye',
        createdAt: new Date().toISOString(),
      },
    });
  });

  router.delete('/webhooks/:webhookId', requireAuth, (req: AuthenticatedRequest, res) => {
    const webhookId = String(req.params.webhookId);
    const wh = db.prepare(`SELECT server_id, created_by, name FROM server_webhooks WHERE id = ?`).get(webhookId) as
      | { server_id: string; created_by: string; name: string }
      | undefined;
    if (!wh) {
      res.status(404).json({ error: 'Webhook bulunamadı.' });
      return;
    }
    if (
      wh.created_by !== req.userId! &&
      !hasServerPermission(db, wh.server_id, req.userId!, 'MANAGE_SERVER') &&
      !hasServerPermission(db, wh.server_id, req.userId!, 'MANAGE_CHANNELS')
    ) {
      res.status(403).json({ error: 'Bu webhooku silme yetkiniz yok.' });
      return;
    }
    db.prepare(`DELETE FROM server_webhooks WHERE id = ?`).run(webhookId);
    addModerationLog(db, wh.server_id, req.userId!, 'WEBHOOK_SİLİNDİ', null, wh.name);
    res.json({ ok: true });
  });

  // Incoming webhook execution (real Discord-style bot message delivery!)
  router.post('/webhooks/:webhookId/:token', (req, res) => {
    const webhookId = String(req.params.webhookId);
    const token = String(req.params.token);
    const wh = db
      .prepare(`SELECT * FROM server_webhooks WHERE id = ? AND token = ?`)
      .get(webhookId, token) as
      | { id: string; server_id: string; channel_id: string; name: string; created_by: string }
      | undefined;

    if (!wh) {
      res.status(401).json({ error: 'Geçersiz webhook kimliği veya belirteci.' });
      return;
    }

    const content = String(req.body?.content || '').trim().slice(0, 2000);
    if (!content) {
      res.status(400).json({ error: 'Mesaj içeriği boş olamaz.' });
      return;
    }

    const botLabel = String(req.body?.username || wh.name).trim().slice(0, 40) || wh.name;
    const messageId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO messages (id, channel_id, author_id, content, webhook_name)
       VALUES (?, ?, ?, ?, ?)`
    ).run(messageId, wh.channel_id, wh.created_by, content, botLabel);

    const message = hydrateChannelMessage(db, messageId, wh.created_by, hub.isUserOnline);
    if (message) {
      hub.sendToRoom(`channel:${wh.channel_id}`, {
        type: 'message:new',
        payload: { channelId: wh.channel_id, message },
      });
    }
    res.status(201).json({ message });
  });

  return router;
}
