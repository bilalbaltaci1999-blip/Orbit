import crypto from 'node:crypto';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { createAuthMiddleware, rateLimit, type AuthenticatedRequest } from '../auth.ts';
import { checkMessageModeration, hydrateChannelMessage } from '../helpers.ts';
import {
  addModerationLog,
  canSendInChannel,
  canViewChannel,
  hasChannelPermission,
  hasServerPermission,
  isServerMember,
} from '../permissions.ts';
import { DEFAULT_MEMBER_PERMISSIONS } from '../../shared/permissions.ts';
import { SERVER_TEMPLATES, type ServerTemplateId } from '../../shared/templates.ts';
import { sanitizeFileName, uploadMiddleware } from '../upload.ts';
import type { OrbitRealtimeHub } from '../ws.ts';

const VALID_OVERRIDE_PERMS = new Set(['VIEW_CHANNEL', 'SEND_MESSAGES', 'ATTACH_FILES', 'CONNECT_VOICE']);

const scheduledSchema = z.object({
  channelId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  content: z.string().trim().min(1, 'Mesaj boş olamaz.').max(4000),
  sendAt: z.string().min(1),
});

const reminderSchema = z.object({
  messageId: z.string().nullable().optional(),
  channelId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  note: z.string().trim().min(1, 'Hatırlatma notu boş olamaz.').max(300),
  remindAt: z.string().min(1),
});

function toSqliteUtc(isoOrDate: Date): string {
  return isoOrDate.toISOString().replace('T', ' ').slice(0, 19);
}

export function createProRoutes(db: Database.Database, hub: OrbitRealtimeHub): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(db);

  // --- THREADS ---
  router.get('/channels/:channelId/threads', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    if (!canViewChannel(db, channelId, req.userId!)) {
      res.status(403).json({ error: 'Bu kanala erişim izniniz yok.' });
      return;
    }
    const rows = db
      .prepare(
        `SELECT mt.*,
                (SELECT COUNT(*) FROM messages m WHERE m.thread_id = mt.id AND m.deleted_at IS NULL) as reply_count
         FROM message_threads mt
         WHERE mt.channel_id = ?
         ORDER BY mt.created_at DESC`
      )
      .all(channelId) as Array<{
      id: string;
      channel_id: string;
      parent_message_id: string;
      title: string;
      created_by: string;
      is_locked: number;
      reply_count: number;
      created_at: string;
    }>;

    res.json({
      threads: rows.map((r) => ({
        id: r.id,
        channelId: r.channel_id,
        parentMessageId: r.parent_message_id,
        title: r.title,
        createdBy: r.created_by,
        isLocked: r.is_locked === 1,
        replyCount: r.reply_count,
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/messages/:messageId/threads', requireAuth, (req: AuthenticatedRequest, res) => {
    const messageId = String(req.params.messageId);
    const userId = req.userId!;
    const msg = db
      .prepare(`SELECT id, channel_id, content, deleted_at, thread_id FROM messages WHERE id = ?`)
      .get(messageId) as
      | { id: string; channel_id: string; content: string; deleted_at: string | null; thread_id: string | null }
      | undefined;

    if (!msg || msg.deleted_at || msg.thread_id) {
      res.status(404).json({ error: 'Alt konu açılabilecek geçerli mesaj bulunamadı.' });
      return;
    }

    const perm = canSendInChannel(db, msg.channel_id, userId);
    if (!perm.allowed) {
      res.status(403).json({ error: perm.reason || 'Alt konu oluşturma izniniz yok.' });
      return;
    }

    const existing = db
      .prepare(`SELECT * FROM message_threads WHERE parent_message_id = ?`)
      .get(messageId) as
      | { id: string; channel_id: string; parent_message_id: string; title: string; created_by: string; is_locked: number; created_at: string }
      | undefined;

    if (existing) {
      const cnt = db
        .prepare(`SELECT COUNT(*) as cnt FROM messages WHERE thread_id = ? AND deleted_at IS NULL`)
        .get(existing.id) as { cnt: number };
      res.json({
        thread: {
          id: existing.id,
          channelId: existing.channel_id,
          parentMessageId: existing.parent_message_id,
          title: existing.title,
          createdBy: existing.created_by,
          isLocked: existing.is_locked === 1,
          replyCount: cnt.cnt,
          createdAt: existing.created_at,
        },
      });
      return;
    }

    const title = String(req.body?.title || msg.content.slice(0, 60) || 'Alt Konu').trim().slice(0, 80) || 'Alt Konu';
    const threadId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO message_threads (id, channel_id, parent_message_id, title, created_by)
       VALUES (?, ?, ?, ?, ?)`
    ).run(threadId, msg.channel_id, messageId, title, userId);

    const parentHydrated = hydrateChannelMessage(db, messageId, userId, hub.isUserOnline);
    if (parentHydrated) {
      hub.sendToRoom(`channel:${msg.channel_id}`, {
        type: 'message:updated',
        payload: { channelId: msg.channel_id, message: parentHydrated },
      });
    }

    res.status(201).json({
      thread: {
        id: threadId,
        channelId: msg.channel_id,
        parentMessageId: messageId,
        title,
        createdBy: userId,
        isLocked: false,
        replyCount: 0,
        createdAt: new Date().toISOString(),
      },
    });
  });

  router.get('/threads/:threadId/messages', requireAuth, (req: AuthenticatedRequest, res) => {
    const threadId = String(req.params.threadId);
    const userId = req.userId!;
    const thread = db.prepare(`SELECT * FROM message_threads WHERE id = ?`).get(threadId) as
      | { id: string; channel_id: string; parent_message_id: string; title: string; created_by: string; is_locked: number; created_at: string }
      | undefined;

    if (!thread || !canViewChannel(db, thread.channel_id, userId)) {
      res.status(403).json({ error: 'Bu alt konuya erişim izniniz yok.' });
      return;
    }

    const parentMessage = hydrateChannelMessage(db, thread.parent_message_id, userId, hub.isUserOnline);
    const rows = db
      .prepare(`SELECT id FROM messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 200`)
      .all(threadId) as { id: string }[];

    const messages = rows.map((r) => hydrateChannelMessage(db, r.id, userId, hub.isUserOnline)).filter(Boolean);

    res.json({
      thread: {
        id: thread.id,
        channelId: thread.channel_id,
        parentMessageId: thread.parent_message_id,
        title: thread.title,
        createdBy: thread.created_by,
        isLocked: thread.is_locked === 1,
        replyCount: messages.filter((m) => m && !m.deletedAt).length,
        createdAt: thread.created_at,
      },
      parentMessage,
      messages,
    });
  });

  router.post(
    '/threads/:threadId/messages',
    requireAuth,
    rateLimit('send-thread-msg', 25, 15_000),
    (req: AuthenticatedRequest, res) => {
      const threadId = String(req.params.threadId);
      const userId = req.userId!;
      const thread = db.prepare(`SELECT * FROM message_threads WHERE id = ?`).get(threadId) as
        | { id: string; channel_id: string; parent_message_id: string; is_locked: number }
        | undefined;
      if (!thread) {
        res.status(404).json({ error: 'Alt konu bulunamadı.' });
        return;
      }

      const perm = canSendInChannel(db, thread.channel_id, userId);
      if (!perm.allowed) {
        res.status(403).json({ error: perm.reason || 'Mesaj gönderme izniniz yok.' });
        return;
      }

      const ch = db.prepare(`SELECT server_id FROM channels WHERE id = ?`).get(thread.channel_id) as { server_id: string };
      const isMod = hasServerPermission(db, ch.server_id, userId, 'PIN_MESSAGES');
      if (thread.is_locked === 1 && !isMod) {
        res.status(403).json({ error: 'Bu alt konu kilitlenmiştir.' });
        return;
      }

      const content = String(req.body?.content || '').trim().slice(0, 4000);
      const attachmentIds = Array.isArray(req.body?.attachmentIds)
        ? (req.body.attachmentIds as string[]).slice(0, 4)
        : [];
      if (!content && attachmentIds.length === 0) {
        res.status(400).json({ error: 'Boş mesaj gönderilemez.' });
        return;
      }

      if (attachmentIds.length > 0 && !hasChannelPermission(db, thread.channel_id, userId, 'ATTACH_FILES')) {
        res.status(403).json({ error: 'Bu kanalda dosya ekleme izniniz yok.' });
        return;
      }

      const isPrivileged = hasServerPermission(db, ch.server_id, userId, 'MANAGE_SERVER');
      const modCheck = checkMessageModeration(db, {
        serverId: ch.server_id,
        channelId: thread.channel_id,
        userId,
        content,
        isPrivileged,
      });
      if (!modCheck.allowed) {
        res.status(400).json({ error: modCheck.reason });
        return;
      }

      const msgId = crypto.randomUUID();
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO messages (id, channel_id, thread_id, author_id, content)
           VALUES (?, ?, ?, ?, ?)`
        ).run(msgId, thread.channel_id, threadId, userId, content);

        if (attachmentIds.length > 0) {
          const stmt = db.prepare(
            `UPDATE message_attachments SET message_id = ? WHERE id = ? AND uploader_id = ? AND message_id IS NULL AND dm_id IS NULL`
          );
          for (const aid of attachmentIds) stmt.run(msgId, aid, userId);
        }
      });
      tx();

      const message = hydrateChannelMessage(db, msgId, userId, hub.isUserOnline);
      hub.sendToRoom(`channel:${thread.channel_id}`, {
        type: 'thread:message_new',
        payload: { channelId: thread.channel_id, threadId, message },
      });

      const parentHydrated = hydrateChannelMessage(db, thread.parent_message_id, userId, hub.isUserOnline);
      if (parentHydrated) {
        hub.sendToRoom(`channel:${thread.channel_id}`, {
          type: 'message:updated',
          payload: { channelId: thread.channel_id, message: parentHydrated },
        });
      }

      res.status(201).json({ message });
    }
  );

  router.patch('/threads/:threadId', requireAuth, (req: AuthenticatedRequest, res) => {
    const threadId = String(req.params.threadId);
    const thread = db
      .prepare(`SELECT mt.*, c.server_id FROM message_threads mt JOIN channels c ON c.id = mt.channel_id WHERE mt.id = ?`)
      .get(threadId) as { id: string; channel_id: string; server_id: string; created_by: string; title: string; is_locked: number } | undefined;

    if (!thread) {
      res.status(404).json({ error: 'Alt konu bulunamadı.' });
      return;
    }

    const canEdit =
      thread.created_by === req.userId! || hasServerPermission(db, thread.server_id, req.userId!, 'PIN_MESSAGES');
    if (!canEdit) {
      res.status(403).json({ error: 'Alt konuyu yönetme yetkiniz yok.' });
      return;
    }

    const isLocked = typeof req.body?.isLocked === 'boolean' ? (req.body.isLocked ? 1 : 0) : thread.is_locked;
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 80) : thread.title;
    db.prepare(`UPDATE message_threads SET is_locked = ?, title = ? WHERE id = ?`).run(isLocked, title, threadId);
    res.json({ ok: true, isLocked: isLocked === 1, title });
  });

  // --- SCHEDULED MESSAGES ---
  router.get('/scheduled-messages', requireAuth, (req: AuthenticatedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT sm.*, c.name as channel_name
         FROM scheduled_messages sm
         LEFT JOIN channels c ON c.id = sm.channel_id
         WHERE sm.user_id = ? AND sm.status != 'cancelled'
         ORDER BY sm.send_at ASC
         LIMIT 50`
      )
      .all(req.userId!) as Array<{
      id: string;
      user_id: string;
      channel_id: string | null;
      conversation_id: string | null;
      channel_name: string | null;
      content: string;
      send_at: string;
      status: 'pending' | 'sent' | 'cancelled' | 'failed';
      sent_at: string | null;
      created_at: string;
    }>;

    res.json({
      scheduled: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        channelId: r.channel_id,
        conversationId: r.conversation_id,
        channelName: r.channel_name || undefined,
        content: r.content,
        sendAt: r.send_at,
        status: r.status,
        sentAt: r.sent_at,
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/scheduled-messages', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = scheduledSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Geçersiz zamanlama verisi.' });
      return;
    }

    const { channelId, conversationId, content, sendAt } = parsed.data;
    if (!channelId && !conversationId) {
      res.status(400).json({ error: 'Hedef kanal veya DM sohbeti seçilmelidir.' });
      return;
    }

    const targetDate = new Date(sendAt);
    if (Number.isNaN(targetDate.getTime()) || targetDate.getTime() < Date.now() + 10_000) {
      res.status(400).json({ error: 'Gönderim zamanı en az 10 saniye ileride olmalıdır.' });
      return;
    }
    if (targetDate.getTime() > Date.now() + 30 * 24 * 3600 * 1000) {
      res.status(400).json({ error: 'En fazla 30 gün sonraya mesaj zamanlayabilirsiniz.' });
      return;
    }

    if (channelId) {
      const perm = canSendInChannel(db, channelId, req.userId!);
      if (!perm.allowed) {
        res.status(403).json({ error: perm.reason || 'Bu kanala mesaj zamanlama izniniz yok.' });
        return;
      }
    } else if (conversationId) {
      const isMember = db
        .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
        .get(conversationId, req.userId!);
      if (!isMember) {
        res.status(403).json({ error: 'Bu sohbete erişiminiz yok.' });
        return;
      }
    }

    const id = crypto.randomUUID();
    const sqliteTime = toSqliteUtc(targetDate);
    db.prepare(
      `INSERT INTO scheduled_messages (id, user_id, channel_id, conversation_id, content, send_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, req.userId!, channelId || null, conversationId || null, content, sqliteTime);

    res.status(201).json({
      scheduled: {
        id,
        userId: req.userId!,
        channelId: channelId || null,
        conversationId: conversationId || null,
        content,
        sendAt: sqliteTime,
        status: 'pending',
        sentAt: null,
        createdAt: new Date().toISOString(),
      },
    });
  });

  router.delete('/scheduled-messages/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare(`DELETE FROM scheduled_messages WHERE id = ? AND user_id = ?`).run(req.params.id, req.userId!);
    res.json({ ok: true });
  });

  // --- MESSAGE REMINDERS ---
  router.get('/reminders', requireAuth, (req: AuthenticatedRequest, res) => {
    const rows = db
      .prepare(`SELECT * FROM message_reminders WHERE user_id = ? ORDER BY remind_at ASC LIMIT 60`)
      .all(req.userId!) as Array<{
      id: string;
      user_id: string;
      message_id: string | null;
      channel_id: string | null;
      conversation_id: string | null;
      note: string;
      remind_at: string;
      notified: number;
      created_at: string;
    }>;

    res.json({
      reminders: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        messageId: r.message_id,
        channelId: r.channel_id,
        conversationId: r.conversation_id,
        note: r.note,
        remindAt: r.remind_at,
        notified: r.notified === 1,
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/reminders', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = reminderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Geçersiz hatırlatıcı verisi.' });
      return;
    }

    const d = new Date(parsed.data.remindAt);
    if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() + 5_000) {
      res.status(400).json({ error: 'Hatırlatma zamanı gelecekte olmalıdır.' });
      return;
    }

    const id = crypto.randomUUID();
    const sqliteTime = toSqliteUtc(d);
    db.prepare(
      `INSERT INTO message_reminders (id, user_id, message_id, channel_id, conversation_id, note, remind_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.userId!,
      parsed.data.messageId || null,
      parsed.data.channelId || null,
      parsed.data.conversationId || null,
      parsed.data.note,
      sqliteTime
    );

    res.status(201).json({
      reminder: {
        id,
        userId: req.userId!,
        messageId: parsed.data.messageId || null,
        channelId: parsed.data.channelId || null,
        conversationId: parsed.data.conversationId || null,
        note: parsed.data.note,
        remindAt: sqliteTime,
        notified: false,
        createdAt: new Date().toISOString(),
      },
    });
  });

  router.delete('/reminders/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare(`DELETE FROM message_reminders WHERE id = ? AND user_id = ?`).run(req.params.id, req.userId!);
    res.json({ ok: true });
  });

  // --- CHANNEL PERMISSION OVERRIDES ---
  router.get('/channels/:channelId/overrides', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const ch = db.prepare(`SELECT server_id FROM channels WHERE id = ?`).get(channelId) as
      | { server_id: string }
      | undefined;
    if (!ch) {
      res.status(404).json({ error: 'Kanal bulunamadı.' });
      return;
    }
    if (
      !hasServerPermission(db, ch.server_id, req.userId!, 'MANAGE_CHANNELS') &&
      !hasServerPermission(db, ch.server_id, req.userId!, 'MANAGE_ROLES')
    ) {
      res.status(403).json({ error: 'Kanal izin matrisini görüntüleme yetkiniz yok.' });
      return;
    }

    const rows = db
      .prepare(`SELECT channel_id, role_id, allow_perms, deny_perms FROM channel_permission_overrides WHERE channel_id = ?`)
      .all(channelId) as Array<{ channel_id: string; role_id: string; allow_perms: string; deny_perms: string }>;

    res.json({
      overrides: rows.map((r) => ({
        channelId: r.channel_id,
        roleId: r.role_id,
        allowPerms: r.allow_perms ? r.allow_perms.split(',').filter(Boolean) : [],
        denyPerms: r.deny_perms ? r.deny_perms.split(',').filter(Boolean) : [],
      })),
    });
  });

  router.put('/channels/:channelId/overrides', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const ch = db.prepare(`SELECT server_id, name FROM channels WHERE id = ?`).get(channelId) as
      | { server_id: string; name: string }
      | undefined;
    if (!ch) {
      res.status(404).json({ error: 'Kanal bulunamadı.' });
      return;
    }
    if (
      !hasServerPermission(db, ch.server_id, req.userId!, 'MANAGE_CHANNELS') &&
      !hasServerPermission(db, ch.server_id, req.userId!, 'MANAGE_ROLES')
    ) {
      res.status(403).json({ error: 'Kanal izinlerini değiştirme yetkiniz yok.' });
      return;
    }

    const rawOverrides = Array.isArray(req.body?.overrides) ? req.body.overrides : [];
    const validRoles = new Set(
      (db.prepare(`SELECT id FROM roles WHERE server_id = ?`).all(ch.server_id) as { id: string }[]).map((r) => r.id)
    );

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM channel_permission_overrides WHERE channel_id = ?`).run(channelId);
      const stmt = db.prepare(
        `INSERT INTO channel_permission_overrides (channel_id, role_id, allow_perms, deny_perms) VALUES (?, ?, ?, ?)`
      );
      for (const item of rawOverrides as Array<{ roleId?: string; allowPerms?: string[]; denyPerms?: string[] }>) {
        if (!item?.roleId || !validRoles.has(item.roleId)) continue;
        const allow = (Array.isArray(item.allowPerms) ? item.allowPerms : []).filter((p) => VALID_OVERRIDE_PERMS.has(p));
        const deny = (Array.isArray(item.denyPerms) ? item.denyPerms : []).filter(
          (p) => VALID_OVERRIDE_PERMS.has(p) && !allow.includes(p)
        );
        if (allow.length === 0 && deny.length === 0) continue;
        stmt.run(channelId, item.roleId, allow.join(','), deny.join(','));
      }
    });
    tx();

    addModerationLog(db, ch.server_id, req.userId!, 'KANAL_İZİN_GÜNCELLENDİ', null, `#${ch.name}`);
    hub.sendToRoom(`server:${ch.server_id}`, { type: 'channel:updated', payload: { serverId: ch.server_id, channelId } });
    res.json({ ok: true });
  });

  // --- AUTOMOD & WELCOME AUTOMATION ---
  router.get('/servers/:serverId/automod', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!hasServerPermission(db, serverId, req.userId!, 'MANAGE_SERVER')) {
      res.status(403).json({ error: 'AutoMod ayarlarını görme yetkiniz yok.' });
      return;
    }

    const row = db.prepare(`SELECT * FROM server_automod_rules WHERE server_id = ?`).get(serverId) as
      | {
          server_id: string;
          enabled: number;
          block_bad_words: number;
          bad_words: string;
          block_invites: number;
          anti_spam: number;
          max_mentions: number;
          timeout_minutes: number;
          welcome_enabled: number;
          welcome_channel_id: string | null;
          welcome_message: string;
        }
      | undefined;

    res.json({
      automod: row
        ? {
            serverId: row.server_id,
            enabled: row.enabled === 1,
            blockBadWords: row.block_bad_words === 1,
            badWords: row.bad_words,
            blockInvites: row.block_invites === 1,
            antiSpam: row.anti_spam === 1,
            maxMentions: row.max_mentions,
            timeoutMinutes: row.timeout_minutes,
            welcomeEnabled: row.welcome_enabled === 1,
            welcomeChannelId: row.welcome_channel_id,
            welcomeMessage: row.welcome_message,
          }
        : {
            serverId,
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
          },
    });
  });

  router.put('/servers/:serverId/automod', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!hasServerPermission(db, serverId, req.userId!, 'MANAGE_SERVER')) {
      res.status(403).json({ error: 'AutoMod ayarlarını değiştirme yetkiniz yok.' });
      return;
    }

    const enabled = req.body?.enabled ? 1 : 0;
    const blockBadWords = req.body?.blockBadWords ? 1 : 0;
    const badWords = String(req.body?.badWords || '').slice(0, 1000);
    const blockInvites = req.body?.blockInvites ? 1 : 0;
    const antiSpam = req.body?.antiSpam ? 1 : 0;
    const maxMentions = Math.max(0, Math.min(20, Math.floor(Number(req.body?.maxMentions ?? 5))));
    const timeoutMinutes = Math.max(0, Math.min(1440, Math.floor(Number(req.body?.timeoutMinutes ?? 5))));
    const welcomeEnabled = req.body?.welcomeEnabled ? 1 : 0;
    const welcomeChannelId = req.body?.welcomeChannelId ? String(req.body.welcomeChannelId) : null;
    const welcomeMessage =
      String(req.body?.welcomeMessage || 'Hoş geldin {user}! {server} topluluğuna katıldın.').trim().slice(0, 400) ||
      'Hoş geldin {user}! {server} topluluğuna katıldın.';

    db.prepare(
      `INSERT INTO server_automod_rules
         (server_id, enabled, block_bad_words, bad_words, block_invites, anti_spam, max_mentions, timeout_minutes, welcome_enabled, welcome_channel_id, welcome_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET
         enabled = ?, block_bad_words = ?, bad_words = ?, block_invites = ?, anti_spam = ?,
         max_mentions = ?, timeout_minutes = ?, welcome_enabled = ?, welcome_channel_id = ?, welcome_message = ?`
    ).run(
      serverId,
      enabled,
      blockBadWords,
      badWords,
      blockInvites,
      antiSpam,
      maxMentions,
      timeoutMinutes,
      welcomeEnabled,
      welcomeChannelId,
      welcomeMessage,
      enabled,
      blockBadWords,
      badWords,
      blockInvites,
      antiSpam,
      maxMentions,
      timeoutMinutes,
      welcomeEnabled,
      welcomeChannelId,
      welcomeMessage
    );

    addModerationLog(db, serverId, req.userId!, 'AUTOMOD_GÜNCELLENDİ', null, enabled ? 'AutoMod Aktif' : 'AutoMod Pasif');
    hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
    res.json({ ok: true });
  });

  // --- ONBOARDING & SELF-ASSIGNABLE ROLES ---
  router.get('/servers/:serverId/onboarding', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;
    if (!isServerMember(db, serverId, userId)) {
      res.status(403).json({ error: 'Bu sunucunun üyesi değilsiniz.' });
      return;
    }

    const cfg = db.prepare(`SELECT * FROM server_onboarding_config WHERE server_id = ?`).get(serverId) as
      | { server_id: string; enabled: number; prompt_title: string; rules_text: string }
      | undefined;

    const rolesRows = db
      .prepare(
        `SELECT sor.*, r.name as role_name, r.color as role_color
         FROM server_onboarding_roles sor
         JOIN roles r ON r.id = sor.role_id
         WHERE sor.server_id = ?
         ORDER BY r.position DESC`
      )
      .all(serverId) as Array<{
      server_id: string;
      role_id: string;
      role_name: string;
      role_color: string;
      emoji: string;
      label: string;
      description: string;
    }>;

    const acc = db
      .prepare(`SELECT 1 FROM server_onboarding_acceptances WHERE server_id = ? AND user_id = ?`)
      .get(serverId, userId);

    const myRoles = (
      db
        .prepare(`SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?`)
        .all(serverId, userId) as { role_id: string }[]
    ).map((r) => r.role_id);

    res.json({
      onboarding: {
        serverId,
        enabled: cfg?.enabled === 1,
        promptTitle: cfg?.prompt_title || 'Topluluğa Hoş Geldiniz',
        rulesText: cfg?.rules_text || '1. Saygılı olun ve topluluk kurallarına uyun.\n2. Spam yapmayın.',
        roles: rolesRows.map((r) => ({
          serverId: r.server_id,
          roleId: r.role_id,
          roleName: r.role_name,
          roleColor: r.role_color,
          emoji: r.emoji,
          label: r.label,
          description: r.description,
        })),
        accepted: Boolean(acc),
        myRoleIds: myRoles,
      },
    });
  });

  router.put('/servers/:serverId/onboarding', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;
    if (
      !hasServerPermission(db, serverId, userId, 'MANAGE_SERVER') &&
      !hasServerPermission(db, serverId, userId, 'MANAGE_ROLES')
    ) {
      res.status(403).json({ error: 'Karşılama ayarlarını yönetme yetkiniz yok.' });
      return;
    }

    const enabled = req.body?.enabled ? 1 : 0;
    const promptTitle = String(req.body?.promptTitle || 'Topluluğa Hoş Geldiniz').trim().slice(0, 80);
    const rulesText = String(req.body?.rulesText || '').trim().slice(0, 2000);
    const inputRoles = Array.isArray(req.body?.roles) ? req.body.roles : [];

    // Security: ONLY non-default, non-admin roles can be self-assigned!
    const allowedRoleIds = new Set(
      (
        db
          .prepare(`SELECT id FROM roles WHERE server_id = ? AND is_default = 0 AND is_admin = 0`)
          .all(serverId) as { id: string }[]
      ).map((r) => r.id)
    );

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO server_onboarding_config (server_id, enabled, prompt_title, rules_text)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(server_id) DO UPDATE SET enabled = ?, prompt_title = ?, rules_text = ?`
      ).run(serverId, enabled, promptTitle, rulesText, enabled, promptTitle, rulesText);

      db.prepare(`DELETE FROM server_onboarding_roles WHERE server_id = ?`).run(serverId);
      const stmt = db.prepare(
        `INSERT INTO server_onboarding_roles (server_id, role_id, emoji, label, description) VALUES (?, ?, ?, ?, ?)`
      );
      for (const item of inputRoles as Array<{ roleId?: string; emoji?: string; label?: string; description?: string }>) {
        if (!item?.roleId || !allowedRoleIds.has(item.roleId)) continue;
        stmt.run(
          serverId,
          item.roleId,
          String(item.emoji || '✨').slice(0, 8),
          String(item.label || 'Rol').trim().slice(0, 40),
          String(item.description || '').trim().slice(0, 120)
        );
      }
    });
    tx();

    hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
    res.json({ ok: true });
  });

  router.post('/servers/:serverId/onboarding/accept', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;
    if (!isServerMember(db, serverId, userId)) {
      res.status(403).json({ error: 'Üye değilsiniz.' });
      return;
    }

    const chosenRoleIds = Array.isArray(req.body?.roleIds) ? (req.body.roleIds as string[]) : [];
    const selfRoles = new Set(
      (
        db
          .prepare(
            `SELECT sor.role_id FROM server_onboarding_roles sor
             JOIN roles r ON r.id = sor.role_id
             WHERE sor.server_id = ? AND r.is_admin = 0 AND r.is_default = 0`
          )
          .all(serverId) as { role_id: string }[]
      ).map((r) => r.role_id)
    );

    const tx = db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO server_onboarding_acceptances (server_id, user_id) VALUES (?, ?)`).run(
        serverId,
        userId
      );
      const addStmt = db.prepare(`INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)`);
      for (const rid of chosenRoleIds) {
        if (selfRoles.has(rid)) addStmt.run(serverId, userId, rid);
      }
    });
    tx();

    hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
    res.json({ ok: true });
  });

  router.post('/servers/:serverId/onboarding/toggle-role', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;
    const roleId = String(req.body?.roleId || '');
    if (!isServerMember(db, serverId, userId)) {
      res.status(403).json({ error: 'Üye değilsiniz.' });
      return;
    }

    const validSelfRole = db
      .prepare(
        `SELECT sor.role_id FROM server_onboarding_roles sor
         JOIN roles r ON r.id = sor.role_id
         WHERE sor.server_id = ? AND sor.role_id = ? AND r.is_admin = 0 AND r.is_default = 0`
      )
      .get(serverId, roleId);

    if (!validSelfRole) {
      res.status(403).json({ error: 'Bu rol kendi kendine seçilebilir roller arasında değil.' });
      return;
    }

    const has = db
      .prepare(`SELECT 1 FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?`)
      .get(serverId, userId, roleId);

    if (has) {
      db.prepare(`DELETE FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?`).run(
        serverId,
        userId,
        roleId
      );
    } else {
      db.prepare(`INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)`).run(
        serverId,
        userId,
        roleId
      );
    }

    hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
    res.json({ assigned: !has });
  });

  // --- CUSTOM SERVER EMOJIS ---
  router.get('/servers/:serverId/emojis', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!isServerMember(db, serverId, req.userId!)) {
      res.status(403).json({ error: 'Üye değilsiniz.' });
      return;
    }
    const rows = db
      .prepare(`SELECT * FROM server_emojis WHERE server_id = ? ORDER BY created_at ASC`)
      .all(serverId) as Array<{
      id: string;
      server_id: string;
      name: string;
      url: string;
      created_by: string;
      created_at: string;
    }>;

    res.json({
      emojis: rows.map((r) => ({
        id: r.id,
        serverId: r.server_id,
        name: r.name,
        url: r.url,
        createdBy: r.created_by,
        createdAt: r.created_at,
      })),
    });
  });

  router.post(
    '/servers/:serverId/emojis',
    requireAuth,
    uploadMiddleware.single('emoji'),
    (req: AuthenticatedRequest, res) => {
      const serverId = String(req.params.serverId);
      const userId = req.userId!;
      if (
        !hasServerPermission(db, serverId, userId, 'MANAGE_SERVER') &&
        !hasServerPermission(db, serverId, userId, 'MANAGE_CHANNELS')
      ) {
        res.status(403).json({ error: 'Özel emoji ekleme yetkiniz yok.' });
        return;
      }

      const rawName = String(req.body?.name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 24);
      if (rawName.length < 2) {
        res.status(400).json({ error: 'Emoji adı en az 2 alfanümerik karakter olmalıdır.' });
        return;
      }

      const file = req.file;
      if (!file || !file.mimetype.startsWith('image/')) {
        res.status(400).json({ error: 'Geçerli bir görsel dosyası seçin.' });
        return;
      }

      const attachmentId = crypto.randomUUID();
      const emojiId = crypto.randomUUID();
      const url = `/api/files/${attachmentId}`;

      try {
        const tx = db.transaction(() => {
          db.prepare(
            `INSERT INTO message_attachments (id, uploader_id, file_name, mime_type, size_bytes, storage_path)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(attachmentId, userId, sanitizeFileName(file.originalname), file.mimetype.split(';')[0], file.size, file.filename);

          db.prepare(
            `INSERT INTO server_emojis (id, server_id, name, url, created_by)
             VALUES (?, ?, ?, ?, ?)`
          ).run(emojiId, serverId, rawName, url, userId);
        });
        tx();
      } catch {
        res.status(409).json({ error: `:${rawName}: adlı emoji zaten mevcut.` });
        return;
      }

      hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
      res.status(201).json({
        emoji: {
          id: emojiId,
          serverId,
          name: rawName,
          url,
          createdBy: userId,
          createdAt: new Date().toISOString(),
        },
      });
    }
  );

  router.delete('/servers/:serverId/emojis/:emojiId', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const emojiId = String(req.params.emojiId);
    if (
      !hasServerPermission(db, serverId, req.userId!, 'MANAGE_SERVER') &&
      !hasServerPermission(db, serverId, req.userId!, 'MANAGE_CHANNELS')
    ) {
      res.status(403).json({ error: 'Emoji silme yetkiniz yok.' });
      return;
    }
    db.prepare(`DELETE FROM server_emojis WHERE id = ? AND server_id = ?`).run(emojiId, serverId);
    hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
    res.json({ ok: true });
  });

  // --- SERVER ANALYTICS ---
  router.get('/servers/:serverId/analytics', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!isServerMember(db, serverId, req.userId!)) {
      res.status(403).json({ error: 'Üye değilsiniz.' });
      return;
    }

    const memberRows = db
      .prepare(`SELECT user_id FROM server_members WHERE server_id = ?`)
      .all(serverId) as { user_id: string }[];
    const onlineCount = memberRows.filter((m) => hub.isUserOnline(m.user_id)).length;

    const voiceRow = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM voice_sessions vs
         JOIN channels c ON c.id = vs.channel_id
         WHERE c.server_id = ?`
      )
      .get(serverId) as { cnt: number };

    const totalMsgRow = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM messages m
         JOIN channels c ON c.id = m.channel_id
         WHERE c.server_id = ? AND m.deleted_at IS NULL`
      )
      .get(serverId) as { cnt: number };

    const dailyRows = db
      .prepare(
        `SELECT substr(m.created_at, 1, 10) as d, COUNT(*) as cnt
         FROM messages m
         JOIN channels c ON c.id = m.channel_id
         WHERE c.server_id = ? AND m.deleted_at IS NULL AND m.created_at >= datetime('now', '-6 days')
         GROUP BY substr(m.created_at, 1, 10)`
      )
      .all(serverId) as { d: string; cnt: number }[];
    const dailyMap = new Map(dailyRows.map((r) => [r.d, r.cnt]));

    const messagesLast7Days: Array<{ date: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      messagesLast7Days.push({ date: dt, count: dailyMap.get(dt) || 0 });
    }

    const topChannels = db
      .prepare(
        `SELECT c.id, c.name, COUNT(m.id) as count
         FROM channels c
         LEFT JOIN messages m ON m.channel_id = c.id AND m.deleted_at IS NULL
         WHERE c.server_id = ? AND c.type IN ('text', 'announcement', 'forum')
         GROUP BY c.id
         ORDER BY count DESC
         LIMIT 5`
      )
      .all(serverId) as Array<{ id: string; name: string; count: number }>;

    const topInvites = db
      .prepare(
        `SELECT i.code, p.display_name as creatorName, i.uses
         FROM invitations i
         JOIN profiles p ON p.user_id = i.creator_id
         WHERE i.server_id = ?
         ORDER BY i.uses DESC
         LIMIT 5`
      )
      .all(serverId) as Array<{ code: string; creatorName: string; uses: number }>;

    res.json({
      analytics: {
        memberCount: memberRows.length,
        onlineCount,
        activeVoiceCount: voiceRow.cnt,
        totalMessages: totalMsgRow.cnt,
        messagesLast7Days,
        topChannels,
        topInvites,
      },
    });
  });

  // --- APPLY SERVER TEMPLATE ---
  router.post('/servers/:serverId/apply-template', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    const userId = req.userId!;
    if (
      !hasServerPermission(db, serverId, userId, 'MANAGE_SERVER') ||
      !hasServerPermission(db, serverId, userId, 'MANAGE_CHANNELS')
    ) {
      res.status(403).json({ error: 'Şablon uygulamak için sunucu ve kanal yönetim yetkisi gereklidir.' });
      return;
    }

    const templateId = String(req.body?.templateId || '') as ServerTemplateId;
    const tpl = SERVER_TEMPLATES[templateId];
    if (!tpl) {
      res.status(400).json({ error: 'Geçersiz sunucu şablonu.' });
      return;
    }

    const tx = db.transaction(() => {
      const existingRoleNames = new Set(
        (db.prepare(`SELECT lower(name) as n FROM roles WHERE server_id = ?`).all(serverId) as { n: string }[]).map(
          (r) => r.n
        )
      );
      const roleInsert = db.prepare(
        `INSERT INTO roles (id, server_id, name, color, position, is_default, is_admin) VALUES (?, ?, ?, ?, ?, 0, 0)`
      );
      const permInsert = db.prepare(`INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)`);

      for (const r of tpl.defaultRoles) {
        if (existingRoleNames.has(r.name.toLowerCase())) continue;
        const rid = crypto.randomUUID();
        roleInsert.run(rid, serverId, r.name, r.color, r.position);
        for (const p of DEFAULT_MEMBER_PERMISSIONS) permInsert.run(rid, p);
      }

      const maxPosRow = db
        .prepare(`SELECT COALESCE(MAX(position), 0) as mp FROM channels WHERE server_id = ?`)
        .get(serverId) as { mp: number };
      let pos = maxPosRow.mp + 1;

      const existingChNames = new Set(
        (db.prepare(`SELECT lower(name) as n FROM channels WHERE server_id = ?`).all(serverId) as { n: string }[]).map(
          (c) => c.n
        )
      );

      for (const cat of tpl.categories) {
        const catId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO channels (id, server_id, parent_id, name, topic, type, position) VALUES (?, ?, NULL, ?, '', 'category', ?)`
        ).run(catId, serverId, cat.name, pos++);

        for (const ch of cat.channels) {
          if (existingChNames.has(ch.name.toLowerCase())) continue;
          db.prepare(
            `INSERT INTO channels (id, server_id, parent_id, name, topic, type, position, is_stage)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(crypto.randomUUID(), serverId, catId, ch.name, ch.topic, ch.type, pos++, ch.isStage ? 1 : 0);
          existingChNames.add(ch.name.toLowerCase());
        }
      }
    });
    tx();

    addModerationLog(db, serverId, userId, 'ŞABLON_UYGULANDI', null, tpl.title);
    hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
    res.json({ ok: true, templateTitle: tpl.title });
  });

  // --- CHANNEL MESSAGE PURGE (/temizle) ---
  router.post('/channels/:channelId/purge', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const userId = req.userId!;
    const ch = db.prepare(`SELECT server_id, name FROM channels WHERE id = ?`).get(channelId) as
      | { server_id: string; name: string }
      | undefined;
    if (!ch) {
      res.status(404).json({ error: 'Kanal bulunamadı.' });
      return;
    }
    if (!hasServerPermission(db, ch.server_id, userId, 'DELETE_MESSAGES')) {
      res.status(403).json({ error: 'Toplu mesaj silme yetkiniz yok.' });
      return;
    }

    const count = Math.max(1, Math.min(50, Math.floor(Number(req.body?.count ?? 10))));
    const targets = db
      .prepare(
        `SELECT id FROM messages
         WHERE channel_id = ? AND deleted_at IS NULL AND thread_id IS NULL
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(channelId, count) as { id: string }[];

    const tx = db.transaction(() => {
      const delStmt = db.prepare(`UPDATE messages SET deleted_at = datetime('now'), content = '' WHERE id = ?`);
      const unpinStmt = db.prepare(`DELETE FROM pinned_messages WHERE message_id = ?`);
      for (const t of targets) {
        delStmt.run(t.id);
        unpinStmt.run(t.id);
      }
    });
    tx();

    for (const t of targets) {
      hub.sendToRoom(`channel:${channelId}`, {
        type: 'message:deleted',
        payload: { channelId, messageId: t.id },
      });
    }
    addModerationLog(db, ch.server_id, userId, 'KANAL_TEMİZLENDİ', null, `#${ch.name} (${targets.length} mesaj)`);
    res.json({ deletedCount: targets.length });
  });

  // --- VOICE COLLABORATION SNAPSHOT (WHITEBOARD + POMODORO) ---
  router.get('/voice-rooms/:roomId/collab', requireAuth, (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const userId = req.userId!;
    const canChannel = canViewChannel(db, roomId, userId);
    const isDmMember = Boolean(
      db
        .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
        .get(roomId, userId)
    );
    if (!canChannel && !isDmMember) {
      res.status(403).json({ error: 'Bu odaya erişiminiz yok.' });
      return;
    }

    const strokeRows = db
      .prepare(`SELECT * FROM voice_whiteboard_strokes WHERE room_id = ? ORDER BY created_at ASC LIMIT 400`)
      .all(roomId) as Array<{
      id: string;
      room_id: string;
      user_id: string;
      color: string;
      size: number;
      points_json: string;
    }>;

    const pomo = db.prepare(`SELECT * FROM voice_pomodoro_state WHERE room_id = ?`).get(roomId) as
      | {
          room_id: string;
          phase: 'focus' | 'break';
          duration_seconds: number;
          remaining_seconds: number;
          running: number;
          updated_at: string;
        }
      | undefined;

    const gameRow = db.prepare(`SELECT state_json FROM voice_room_games WHERE room_id = ?`).get(roomId) as
      | { state_json: string }
      | undefined;
    let gameState: unknown = null;
    if (gameRow) {
      try {
        gameState = JSON.parse(gameRow.state_json);
      } catch {
        gameState = null;
      }
    }

    res.json({
      strokes: strokeRows.map((s) => ({
        id: s.id,
        roomId: s.room_id,
        userId: s.user_id,
        color: s.color,
        size: s.size,
        points: JSON.parse(s.points_json || '[]'),
      })),
      pomodoro: pomo
        ? {
            roomId: pomo.room_id,
            phase: pomo.phase,
            durationSeconds: pomo.duration_seconds,
            remainingSeconds: pomo.remaining_seconds,
            running: pomo.running === 1,
            updatedAt: pomo.updated_at,
          }
        : {
            roomId,
            phase: 'focus',
            durationSeconds: 1500,
            remainingSeconds: 1500,
            running: false,
            updatedAt: new Date().toISOString(),
          },
      gameState,
    });
  });

  return router;
}
