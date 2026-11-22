import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  createAuthMiddleware,
  extractFileTokenFromRequest,
  getProfileByUserId,
  getUserIdBySessionToken,
  grantBadge,
  rateLimit,
  type AuthenticatedRequest,
} from '../auth.ts';
import { handleOfficialBotMessage } from '../bot.ts';
import { awardActivityXp } from '../gamification.ts';
import { checkMessageModeration, createNotification, hydrateChannelMessage } from '../helpers.ts';
import {
  addModerationLog,
  canSendInChannel,
  canViewChannel,
  hasChannelPermission,
  hasServerPermission,
  isServerMember,
} from '../permissions.ts';
import { enforceUserUploadLimit, getUploadDir, sanitizeFileName, uploadMiddleware } from '../upload.ts';
import type { OrbitRealtimeHub } from '../ws.ts';

const forwardedFromSchema = z
  .object({
    originalMessageId: z.string(),
    authorName: z.string().max(80),
    channelName: z.string().max(80).optional(),
    content: z.string().max(4000),
    createdAt: z.string().max(80),
  })
  .nullable()
  .optional();

const sendMessageSchema = z.object({
  content: z.string().max(4000).default(''),
  replyToId: z.string().nullable().optional(),
  forwardedFrom: forwardedFromSchema,
  clientNonce: z.string().max(80).nullable().optional(),
  attachmentIds: z.array(z.string()).max(4).optional(),
  poll: z
    .object({
      question: z.string().trim().min(2, 'Anket sorusu en az 2 karakter olmalı.').max(160),
      options: z
        .array(z.string().trim().min(1, 'Seçenek boş olamaz.').max(80))
        .min(2, 'En az 2 seçenek ekleyin.')
        .max(6, 'En fazla 6 seçenek ekleyebilirsiniz.'),
      allowMultiple: z.boolean().optional().default(false),
    })
    .nullable()
    .optional(),
});

const SAFE_INLINE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/x-png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
]);

const BUILTIN_GIFS = [
  { id: 'orbit-selam', title: 'Selam / Merhaba', previewUrl: '/gifs/selam.gif', url: '/gifs/selam.gif', tags: ['selam', 'merhaba', 'hi', 'hello', 'hey', 'el'] },
  { id: 'orbit-alkis', title: 'Alkış / Tebrik', previewUrl: '/gifs/alkis.gif', url: '/gifs/alkis.gif', tags: ['alkis', 'alkış', 'clap', 'bravo', 'tebrik', 'gg'] },
  { id: 'orbit-kalp', title: 'Kalp / Sevgi', previewUrl: '/gifs/kalp.gif', url: '/gifs/kalp.gif', tags: ['kalp', 'love', 'heart', 'sevgi', 'ask', 'aşk', 'mor'] },
  { id: 'orbit-ates', title: 'Ateş / Efsane', previewUrl: '/gifs/ates.gif', url: '/gifs/ates.gif', tags: ['ates', 'ateş', 'fire', 'hype', 'efsane', 'hot'] },
  { id: 'orbit-roket', title: 'Roket / Fırlat', previewUrl: '/gifs/roket.gif', url: '/gifs/roket.gif', tags: ['roket', 'rocket', 'orbit', 'uzay', 'space', 'launch'] },
  { id: 'orbit-gulme', title: 'Kahkaha / LOL', previewUrl: '/gifs/gulme.gif', url: '/gifs/gulme.gif', tags: ['gulme', 'gülme', 'haha', 'lol', 'komik', 'laugh'] },
  { id: 'orbit-onay', title: 'Onay / Harika', previewUrl: '/gifs/onay.gif', url: '/gifs/onay.gif', tags: ['onay', 'tamam', 'ok', 'yes', 'evet', 'check', 'super'] },
  { id: 'orbit-parti', title: 'Parti / Kutlama', previewUrl: '/gifs/parti.gif', url: '/gifs/parti.gif', tags: ['parti', 'party', 'kutlama', 'celebrate', 'konfeti'] },
  { id: 'orbit-yildiz', title: 'Yıldız / Parla', previewUrl: '/gifs/yildiz.gif', url: '/gifs/yildiz.gif', tags: ['yildiz', 'yıldız', 'star', 'sparkle', 'parla', 'pro'] },
  { id: 'orbit-saskin', title: 'Şaşkın / OMG', previewUrl: '/gifs/saskin.gif', url: '/gifs/saskin.gif', tags: ['saskin', 'şaşkın', 'wow', 'omg', 'shock', 'ne'] },
  { id: 'orbit-uyku', title: 'Uyku / İyi Geceler', previewUrl: '/gifs/uyku.gif', url: '/gifs/uyku.gif', tags: ['uyku', 'zzz', 'sleep', 'gece', 'yoruldum'] },
  { id: 'orbit-kahve', title: 'Kahve / Mola', previewUrl: '/gifs/kahve.gif', url: '/gifs/kahve.gif', tags: ['kahve', 'coffee', 'cay', 'çay', 'mola', 'pomodoro'] },
  { id: 'orbit-oyun', title: 'Oyun / GG WP', previewUrl: '/gifs/oyun.gif', url: '/gifs/oyun.gif', tags: ['oyun', 'game', 'gaming', 'gg', 'wp', 'play'] },
  { id: 'orbit-muzik', title: 'Müzik / Vibe', previewUrl: '/gifs/muzik.gif', url: '/gifs/muzik.gif', tags: ['muzik', 'müzik', 'music', 'vibe', 'dans', 'beat'] },
  { id: 'orbit-kupa', title: 'Kupa / Şampiyon', previewUrl: '/gifs/kupa.gif', url: '/gifs/kupa.gif', tags: ['kupa', 'trophy', 'win', 'kazandik', 'sampiyon', 'şampiyon'] },
  { id: 'orbit-uzgun', title: 'Üzgün / RIP', previewUrl: '/gifs/uzgun.gif', url: '/gifs/uzgun.gif', tags: ['uzgun', 'üzgün', 'sad', 'rip', 'ah', 'tüh'] },
];

function isPrivateOrReservedIp(ip: string): boolean {
  const cleaned = ip.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(cleaned)) {
    const parts = cleaned.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }
  if (net.isIPv6(cleaned)) {
    if (cleaned === '::' || cleaned === '::1') return true;
    if (cleaned.startsWith('fc') || cleaned.startsWith('fd') || cleaned.startsWith('fe80:')) return true;
    if (cleaned.startsWith('::ffff:')) {
      return isPrivateOrReservedIp(cleaned.slice(7));
    }
    return false;
  }
  return true;
}

export function createMessageRoutes(db: Database.Database, hub: OrbitRealtimeHub): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(db);

  // --- CHANNEL MESSAGES ---
  router.get('/channels/:channelId/messages', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const userId = req.userId!;
    if (!canViewChannel(db, channelId, userId)) {
      res.status(403).json({ error: 'Bu kanaldaki mesajları görüntüleme izniniz yok.' });
      return;
    }

    const before = req.query.before ? String(req.query.before) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);

    const rows = before
      ? (db
          .prepare(
            `SELECT id FROM messages WHERE channel_id = ? AND thread_id IS NULL AND created_at < ? ORDER BY created_at DESC LIMIT ?`
          )
          .all(channelId, before, limit) as { id: string }[])
      : (db
          .prepare(`SELECT id FROM messages WHERE channel_id = ? AND thread_id IS NULL ORDER BY created_at DESC LIMIT ?`)
          .all(channelId, limit) as { id: string }[]);

    const messages = rows
      .reverse()
      .map((r) => hydrateChannelMessage(db, r.id, userId, hub.isUserOnline))
      .filter(Boolean);

    res.json({ messages, hasMore: rows.length === limit });
  });

  router.post(
    '/channels/:channelId/messages',
    requireAuth,
    rateLimit('send-channel-msg', 25, 15_000),
    (req: AuthenticatedRequest, res) => {
      const channelId = String(req.params.channelId);
      const userId = req.userId!;

      const permCheck = canSendInChannel(db, channelId, userId);
      if (!permCheck.allowed) {
        res.status(403).json({ error: permCheck.reason || 'Mesaj gönderme izniniz yok.' });
        return;
      }

      const parsed = sendMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Geçersiz mesaj formatı.' });
        return;
      }
      const { content, replyToId, forwardedFrom, clientNonce, attachmentIds, poll } = parsed.data;
      if (!content.trim() && (!attachmentIds || attachmentIds.length === 0) && !poll && !forwardedFrom) {
        res.status(400).json({ error: 'Boş mesaj gönderilemez.' });
        return;
      }

      if (attachmentIds?.length && !hasChannelPermission(db, channelId, userId, 'ATTACH_FILES')) {
        res.status(403).json({ error: 'Bu kanalda dosya veya medya ekleme izniniz kapatılmış.' });
        return;
      }

      const ch = db.prepare(`SELECT server_id, type, name FROM channels WHERE id = ?`).get(channelId) as {
        server_id: string;
        type: string;
        name: string;
      };

      const isPrivileged = hasServerPermission(db, ch.server_id, userId, 'MANAGE_SERVER');
      const modCheck = checkMessageModeration(db, {
        serverId: ch.server_id,
        channelId,
        userId,
        content,
        isPrivileged,
      });
      if (!modCheck.allowed) {
        res.status(400).json({ error: modCheck.reason });
        return;
      }

      // Idempotency guard via clientNonce
      if (clientNonce) {
        const existing = db
          .prepare(`SELECT id FROM messages WHERE channel_id = ? AND author_id = ? AND client_nonce = ?`)
          .get(channelId, userId, clientNonce) as { id: string } | undefined;
        if (existing) {
          const message = hydrateChannelMessage(db, existing.id, userId, hub.isUserOnline);
          res.json({ message });
          return;
        }
      }

      let safeReplyToId: string | null = null;
      if (replyToId) {
        const targetReply = db
          .prepare(`SELECT id FROM messages WHERE id = ? AND channel_id = ?`)
          .get(replyToId, channelId) as { id: string } | undefined;
        if (targetReply) safeReplyToId = targetReply.id;
      }

      const messageId = crypto.randomUUID();
      const isAnnouncement = ch.type === 'announcement' ? 1 : 0;
      const forwardedJson = forwardedFrom ? JSON.stringify(forwardedFrom) : null;

      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, forwarded_from_json, client_nonce, is_announcement)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          messageId,
          channelId,
          userId,
          content.trim(),
          safeReplyToId,
          forwardedJson,
          clientNonce || null,
          isAnnouncement
        );

        if (attachmentIds?.length) {
          const stmt = db.prepare(
            `UPDATE message_attachments SET message_id = ? WHERE id = ? AND uploader_id = ? AND message_id IS NULL AND dm_id IS NULL`
          );
          for (const aid of attachmentIds) {
            stmt.run(messageId, aid, userId);
          }
        }

        if (poll) {
          const pollId = crypto.randomUUID();
          db.prepare(
            `INSERT INTO message_polls (id, message_id, question, allow_multiple) VALUES (?, ?, ?, ?)`
          ).run(pollId, messageId, poll.question.trim(), poll.allowMultiple ? 1 : 0);
          const optStmt = db.prepare(
            `INSERT INTO message_poll_options (id, poll_id, label, position) VALUES (?, ?, ?, ?)`
          );
          poll.options.forEach((optLabel, idx) => {
            optStmt.run(crypto.randomUUID(), pollId, optLabel.trim(), idx);
          });
        }
      });
      tx();

      const msgCount = db.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE author_id = ?`).get(userId) as {
        cnt: number;
      };
      if (msgCount.cnt >= 3) {
        grantBadge(db, userId, 'active_communicator');
      }

      const message = hydrateChannelMessage(db, messageId, userId, hub.isUserOnline);
      hub.sendToRoom(`channel:${channelId}`, { type: 'message:new', payload: { channelId, message } });

      // Cross-post announcements to subscribed channels
      if (isAnnouncement === 1) {
        const subs = db
          .prepare(`SELECT target_channel_id FROM announcement_subscriptions WHERE source_channel_id = ?`)
          .all(channelId) as { target_channel_id: string }[];
        for (const sub of subs) {
          const crossId = crypto.randomUUID();
          db.prepare(
            `INSERT INTO messages (id, channel_id, author_id, content, is_announcement) VALUES (?, ?, ?, ?, 1)`
          ).run(crossId, sub.target_channel_id, userId, `[Duyuru · #${ch.name}]\n${content.trim()}`);
          const crossMsg = hydrateChannelMessage(db, crossId, userId, hub.isUserOnline);
          hub.sendToRoom(`channel:${sub.target_channel_id}`, {
            type: 'message:new',
            payload: { channelId: sub.target_channel_id, message: crossMsg },
          });
        }
      }

      // Mention & reply notifications
      const sender = getProfileByUserId(db, userId, hub.isUserOnline);
      const notifiedUserIds = new Set<string>();
      const mentionedUsernames = Array.from(
        new Set(Array.from(content.matchAll(/@([a-zA-Z0-9_.-]{3,24})/g)).map((m) => m[1]))
      );
      for (const uname of mentionedUsernames) {
        const target = db.prepare(`SELECT user_id FROM profiles WHERE username = ?`).get(uname) as
          | { user_id: string }
          | undefined;
        if (target && target.user_id !== userId && canViewChannel(db, channelId, target.user_id)) {
          notifiedUserIds.add(target.user_id);
          createNotification(db, hub, {
            userId: target.user_id,
            type: 'mention',
            title: `#${ch.name} kanalında etiketlendiniz`,
            body: `${sender?.displayName || 'Bir üye'}: ${content.trim().slice(0, 100)}`,
            actorId: userId,
            link: `/channels/${ch.server_id}/${channelId}`,
          });
        }
      }

      // Mentionable server roles (@RolAdı)
      const mentionableRoles = db
        .prepare(`SELECT id, name FROM roles WHERE server_id = ? AND mentionable = 1 AND is_default = 0`)
        .all(ch.server_id) as { id: string; name: string }[];
      const lowerContent = content.toLowerCase();
      for (const role of mentionableRoles) {
        const needle = `@${role.name.toLowerCase()}`;
        const idx = lowerContent.indexOf(needle);
        if (idx === -1) continue;
        const afterChar = lowerContent[idx + needle.length];
        if (afterChar && /[a-z0-9_ğüşöçı]/i.test(afterChar)) continue;
        const roleMembers = db
          .prepare(`SELECT user_id FROM member_roles WHERE server_id = ? AND role_id = ?`)
          .all(ch.server_id, role.id) as { user_id: string }[];
        for (const rm of roleMembers) {
          if (rm.user_id === userId || notifiedUserIds.has(rm.user_id)) continue;
          if (!canViewChannel(db, channelId, rm.user_id)) continue;
          notifiedUserIds.add(rm.user_id);
          createNotification(db, hub, {
            userId: rm.user_id,
            type: 'mention',
            title: `#${ch.name} · @${role.name} etiketi`,
            body: `${sender?.displayName || 'Bir üye'}: ${content.trim().slice(0, 100)}`,
            actorId: userId,
            link: `/channels/${ch.server_id}/${channelId}`,
          });
        }
      }

      if (replyToId) {
        const replied = db.prepare(`SELECT author_id FROM messages WHERE id = ?`).get(replyToId) as
          | { author_id: string }
          | undefined;
        if (replied && replied.author_id !== userId) {
          createNotification(db, hub, {
            userId: replied.author_id,
            type: 'reply',
            title: `#${ch.name} kanalında mesajınıza yanıt`,
            body: `${sender?.displayName || 'Bir üye'}: ${content.trim().slice(0, 100)}`,
            actorId: userId,
            link: `/channels/${ch.server_id}/${channelId}`,
          });
        }
      }

      awardActivityXp(db, userId, 'message');

      res.status(201).json({ message });

      // Trigger Official ORBIT Bot command/AI response asynchronously
      void handleOfficialBotMessage(db, hub, {
        serverId: ch.server_id,
        channelId,
        authorId: userId,
        content,
      }).catch(() => {});
    }
  );

  router.post('/channels/:channelId/polls/:pollId/vote', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const pollId = String(req.params.pollId);
    const optionId = String(req.body?.optionId || '').trim();
    const userId = req.userId!;

    if (!canViewChannel(db, channelId, userId)) {
      res.status(403).json({ error: 'Bu kanaldaki ankete oy verme izniniz yok.' });
      return;
    }

    const poll = db
      .prepare(
        `SELECT mp.id, mp.message_id, mp.allow_multiple, m.channel_id
         FROM message_polls mp
         JOIN messages m ON m.id = mp.message_id
         WHERE mp.id = ? AND m.channel_id = ? AND m.deleted_at IS NULL`
      )
      .get(pollId, channelId) as
      | { id: string; message_id: string; allow_multiple: number; channel_id: string }
      | undefined;

    if (!poll) {
      res.status(404).json({ error: 'Anket bulunamadı.' });
      return;
    }

    const validOpt = db
      .prepare(`SELECT id FROM message_poll_options WHERE id = ? AND poll_id = ?`)
      .get(optionId, pollId);
    if (!validOpt) {
      res.status(400).json({ error: 'Geçersiz anket seçeneği.' });
      return;
    }

    const tx = db.transaction(() => {
      const existing = db
        .prepare(`SELECT 1 FROM message_poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?`)
        .get(pollId, optionId, userId);

      if (existing) {
        db.prepare(`DELETE FROM message_poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?`).run(
          pollId,
          optionId,
          userId
        );
      } else {
        if (poll.allow_multiple === 0) {
          db.prepare(`DELETE FROM message_poll_votes WHERE poll_id = ? AND user_id = ?`).run(pollId, userId);
        }
        db.prepare(`INSERT INTO message_poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)`).run(
          pollId,
          optionId,
          userId
        );
      }
    });
    tx();

    const message = hydrateChannelMessage(db, poll.message_id, userId, hub.isUserOnline);
    hub.sendToRoom(`channel:${channelId}`, {
      type: 'message:updated',
      payload: { channelId, message },
    });
    res.json({ message });
  });

  router.patch('/messages/:messageId', requireAuth, (req: AuthenticatedRequest, res) => {
    const messageId = String(req.params.messageId);
    const content = String(req.body?.content || '').trim();
    if (!content) {
      res.status(400).json({ error: 'Mesaj içeriği boş olamaz.' });
      return;
    }

    const row = db
      .prepare(
        `SELECT m.*, c.server_id FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.id = ?`
      )
      .get(messageId) as
      | { id: string; channel_id: string; server_id: string; author_id: string; deleted_at: string | null }
      | undefined;

    if (!row || row.deleted_at) {
      res.status(404).json({ error: 'Mesaj bulunamadı.' });
      return;
    }
    const canEdit =
      row.author_id === req.userId! || hasServerPermission(db, row.server_id, req.userId!, 'EDIT_MESSAGES');
    if (!canEdit) {
      res.status(403).json({ error: 'Bu mesajı düzenleme izniniz yok.' });
      return;
    }

    db.prepare(`UPDATE messages SET content = ?, edited_at = datetime('now') WHERE id = ?`).run(content, messageId);
    const message = hydrateChannelMessage(db, messageId, req.userId!, hub.isUserOnline);
    hub.sendToRoom(`channel:${row.channel_id}`, {
      type: 'message:updated',
      payload: { channelId: row.channel_id, message },
    });
    res.json({ message });
  });

  router.delete('/messages/:messageId', requireAuth, (req: AuthenticatedRequest, res) => {
    const messageId = String(req.params.messageId);
    const row = db
      .prepare(
        `SELECT m.*, c.server_id FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.id = ?`
      )
      .get(messageId) as
      | { id: string; channel_id: string; server_id: string; author_id: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Mesaj bulunamadı.' });
      return;
    }
    const isAuthor = row.author_id === req.userId!;
    const canDelete = isAuthor || hasServerPermission(db, row.server_id, req.userId!, 'DELETE_MESSAGES');
    if (!canDelete) {
      res.status(403).json({ error: 'Bu mesajı silme izniniz yok.' });
      return;
    }

    db.prepare(`UPDATE messages SET deleted_at = datetime('now'), content = '' WHERE id = ?`).run(messageId);
    db.prepare(`DELETE FROM pinned_messages WHERE message_id = ?`).run(messageId);
    if (!isAuthor) {
      addModerationLog(db, row.server_id, req.userId!, 'MESAJ_SİLİNDİ', row.author_id, `Mesaj ID: ${messageId}`);
    }
    hub.sendToRoom(`channel:${row.channel_id}`, {
      type: 'message:deleted',
      payload: { channelId: row.channel_id, messageId },
    });
    res.json({ ok: true });
  });

  router.post('/messages/:messageId/reactions', requireAuth, (req: AuthenticatedRequest, res) => {
    const messageId = String(req.params.messageId);
    const emoji = String(req.body?.emoji || '').trim().slice(0, 16);
    if (!emoji) {
      res.status(400).json({ error: 'Geçerli bir emoji seçin.' });
      return;
    }
    const msg = db.prepare(`SELECT channel_id FROM messages WHERE id = ?`).get(messageId) as
      | { channel_id: string }
      | undefined;
    if (!msg || !canViewChannel(db, msg.channel_id, req.userId!)) {
      res.status(403).json({ error: 'Bu kanala erişiminiz yok.' });
      return;
    }

    const existing = db
      .prepare(`SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`)
      .get(messageId, req.userId!, emoji) as { id: string } | undefined;

    if (existing) {
      db.prepare(`DELETE FROM message_reactions WHERE id = ?`).run(existing.id);
    } else {
      db.prepare(`INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)`).run(
        crypto.randomUUID(),
        messageId,
        req.userId!,
        emoji
      );
    }

    const message = hydrateChannelMessage(db, messageId, req.userId!, hub.isUserOnline);
    hub.sendToRoom(`channel:${msg.channel_id}`, {
      type: 'message:updated',
      payload: { channelId: msg.channel_id, message },
    });
    res.json({ message });
  });

  router.post('/messages/:messageId/pin', requireAuth, (req: AuthenticatedRequest, res) => {
    const messageId = String(req.params.messageId);
    const msg = db
      .prepare(`SELECT m.channel_id, c.server_id FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.id = ?`)
      .get(messageId) as { channel_id: string; server_id: string } | undefined;
    if (!msg) {
      res.status(404).json({ error: 'Mesaj bulunamadı.' });
      return;
    }
    if (!hasServerPermission(db, msg.server_id, req.userId!, 'PIN_MESSAGES')) {
      res.status(403).json({ error: 'Mesaj sabitleme yetkiniz yok.' });
      return;
    }

    const pinned = db.prepare(`SELECT 1 FROM pinned_messages WHERE message_id = ?`).get(messageId);
    if (pinned) {
      db.prepare(`DELETE FROM pinned_messages WHERE message_id = ?`).run(messageId);
    } else {
      db.prepare(`INSERT INTO pinned_messages (channel_id, message_id, pinned_by) VALUES (?, ?, ?)`).run(
        msg.channel_id,
        messageId,
        req.userId!
      );
    }

    const message = hydrateChannelMessage(db, messageId, req.userId!, hub.isUserOnline);
    hub.sendToRoom(`channel:${msg.channel_id}`, {
      type: 'message:updated',
      payload: { channelId: msg.channel_id, message },
    });
    res.json({ message });
  });

  router.get('/channels/:channelId/pins', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    if (!canViewChannel(db, channelId, req.userId!)) {
      res.status(403).json({ error: 'Bu kanala erişiminiz yok.' });
      return;
    }
    const rows = db
      .prepare(`SELECT message_id FROM pinned_messages WHERE channel_id = ? ORDER BY pinned_at DESC`)
      .all(channelId) as { message_id: string }[];
    const messages = rows
      .map((r) => hydrateChannelMessage(db, r.message_id, req.userId!, hub.isUserOnline))
      .filter(Boolean);
    res.json({ messages });
  });

  router.post('/channels/:channelId/read', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const userId = req.userId!;
    if (!canViewChannel(db, channelId, userId)) {
      res.status(403).json({ error: 'Bu kanala erişiminiz yok.' });
      return;
    }

    const recentUnread = db
      .prepare(
        `SELECT id, created_at FROM messages
         WHERE channel_id = ? AND author_id != ? AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 40`
      )
      .all(channelId, userId) as Array<{ id: string; created_at: string }>;

    const readAt = new Date().toISOString();
    const newlyMarked: string[] = [];
    const insertReceipt = db.prepare(
      `INSERT OR IGNORE INTO message_read_receipts (message_id, target_type, target_id, user_id, read_at)
       VALUES (?, 'channel', ?, ?, ?)`
    );

    const tx = db.transaction(() => {
      for (const m of recentUnread) {
        const info = insertReceipt.run(m.id, channelId, userId, readAt);
        if (info.changes > 0) newlyMarked.push(m.id);
      }
      const latestMsgId = recentUnread[0]?.id || null;
      db.prepare(
        `INSERT INTO read_receipts (user_id, target_type, target_id, last_read_at, last_read_message_id)
         VALUES (?, 'channel', ?, datetime('now'), ?)
         ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET
           last_read_at = datetime('now'),
           last_read_message_id = COALESCE(excluded.last_read_message_id, read_receipts.last_read_message_id)`
      ).run(userId, channelId, latestMsgId);
    });
    tx();

    if (newlyMarked.length > 0) {
      const reader = getProfileByUserId(db, userId, hub.isUserOnline);
      if (reader) {
        hub.sendToRoom(`channel:${channelId}`, {
          type: 'message:read_receipt',
          payload: {
            channelId,
            messageIds: newlyMarked,
            reader: {
              userId,
              displayName: reader.displayName,
              avatarUrl: reader.avatarUrl,
              readAt,
            },
          },
        });
      }
    }
    res.json({ ok: true, markedIds: newlyMarked });
  });

  router.post('/channels/:channelId/messages/read', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const userId = req.userId!;
    if (!canViewChannel(db, channelId, userId)) {
      res.status(403).json({ error: 'Bu kanala erişiminiz yok.' });
      return;
    }

    const rawIds: string[] = [];
    if (typeof req.body?.messageId === 'string' && req.body.messageId.trim()) {
      rawIds.push(req.body.messageId.trim());
    }
    if (Array.isArray(req.body?.messageIds)) {
      for (const item of req.body.messageIds) {
        if (typeof item === 'string' && item.trim()) rawIds.push(item.trim());
      }
    }
    const candidateIds = Array.from(new Set(rawIds)).slice(0, 50);
    if (candidateIds.length === 0) {
      res.json({ ok: true, markedIds: [] });
      return;
    }

    const placeholders = candidateIds.map(() => '?').join(',');
    const validMsgs = db
      .prepare(
        `SELECT id, author_id, created_at FROM messages
         WHERE channel_id = ? AND deleted_at IS NULL AND id IN (${placeholders})
         ORDER BY created_at DESC`
      )
      .all(channelId, ...candidateIds) as Array<{ id: string; author_id: string; created_at: string }>;

    if (validMsgs.length === 0) {
      res.json({ ok: true, markedIds: [] });
      return;
    }

    const readAt = new Date().toISOString();
    const newlyMarked: string[] = [];
    const insertReceipt = db.prepare(
      `INSERT OR IGNORE INTO message_read_receipts (message_id, target_type, target_id, user_id, read_at)
       VALUES (?, 'channel', ?, ?, ?)`
    );

    const tx = db.transaction(() => {
      for (const m of validMsgs) {
        if (m.author_id === userId) continue;
        const info = insertReceipt.run(m.id, channelId, userId, readAt);
        if (info.changes > 0) newlyMarked.push(m.id);
      }

      const newest = validMsgs[0];
      const existingReceipt = db
        .prepare(`SELECT last_read_at, last_read_message_id FROM read_receipts WHERE user_id = ? AND target_type = 'channel' AND target_id = ?`)
        .get(userId, channelId) as { last_read_at: string; last_read_message_id: string | null } | undefined;

      const shouldAdvance = !existingReceipt || newest.created_at >= existingReceipt.last_read_at;
      db.prepare(
        `INSERT INTO read_receipts (user_id, target_type, target_id, last_read_at, last_read_message_id)
         VALUES (?, 'channel', ?, ?, ?)
         ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET
           last_read_at = CASE WHEN excluded.last_read_at >= read_receipts.last_read_at THEN excluded.last_read_at ELSE read_receipts.last_read_at END,
           last_read_message_id = CASE WHEN excluded.last_read_at >= read_receipts.last_read_at THEN excluded.last_read_message_id ELSE read_receipts.last_read_message_id END`
      ).run(userId, channelId, shouldAdvance ? newest.created_at : existingReceipt.last_read_at, newest.id);
    });
    tx();

    if (newlyMarked.length > 0) {
      const reader = getProfileByUserId(db, userId, hub.isUserOnline);
      if (reader) {
        hub.sendToRoom(`channel:${channelId}`, {
          type: 'message:read_receipt',
          payload: {
            channelId,
            messageIds: newlyMarked,
            reader: {
              userId,
              displayName: reader.displayName,
              avatarUrl: reader.avatarUrl,
              readAt,
            },
          },
        });
      }
    }

    res.json({ ok: true, markedIds: newlyMarked });
  });

  // --- FORUM CHANNELS ---
  router.get('/channels/:channelId/forum', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    if (!canViewChannel(db, channelId, req.userId!)) {
      res.status(403).json({ error: 'Foruma erişim izniniz yok.' });
      return;
    }
    const q = String(req.query.q || '').trim();
    const tag = String(req.query.tag || '').trim();

    const rows = db
      .prepare(
        `SELECT fp.*,
                (SELECT COUNT(*) FROM forum_replies WHERE post_id = fp.id) as reply_count,
                CASE WHEN ff.user_id IS NOT NULL THEN 1 ELSE 0 END as is_following
         FROM forum_posts fp
         LEFT JOIN forum_follows ff ON ff.post_id = fp.id AND ff.user_id = ?
         WHERE fp.channel_id = ?
           ${q ? 'AND (fp.title LIKE ? OR fp.content LIKE ?)' : ''}
         ORDER BY fp.is_pinned DESC, fp.updated_at DESC`
      )
      .all(...(q ? [req.userId!, channelId, `%${q}%`, `%${q}%`] : [req.userId!, channelId])) as Array<{
      id: string;
      channel_id: string;
      author_id: string;
      title: string;
      content: string;
      tags_json: string;
      is_pinned: number;
      is_locked: number;
      reply_count: number;
      is_following: number;
      created_at: string;
      updated_at: string;
    }>;

    const posts = rows
      .map((r) => {
        const tags = JSON.parse(r.tags_json || '[]') as string[];
        if (tag && !tags.includes(tag)) return null;
        const author = getProfileByUserId(db, r.author_id, hub.isUserOnline);
        if (!author) return null;
        return {
          id: r.id,
          channelId: r.channel_id,
          authorId: r.author_id,
          author,
          title: r.title,
          content: r.content,
          tags,
          isPinned: r.is_pinned === 1,
          isLocked: r.is_locked === 1,
          isFollowing: r.is_following === 1,
          replyCount: r.reply_count,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };
      })
      .filter(Boolean);

    res.json({ posts });
  });

  router.post('/channels/:channelId/forum', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const perm = canSendInChannel(db, channelId, req.userId!);
    if (!perm.allowed) {
      res.status(403).json({ error: perm.reason });
      return;
    }

    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '').trim();
    const tags = Array.isArray(req.body?.tags)
      ? (req.body.tags as string[]).map((t) => String(t).trim().slice(0, 24)).filter(Boolean).slice(0, 5)
      : [];

    if (title.length < 3 || content.length < 2) {
      res.status(400).json({ error: 'Konu başlığı en az 3 karakter ve içerik dolu olmalıdır.' });
      return;
    }

    const postId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO forum_posts (id, channel_id, author_id, title, content, tags_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(postId, channelId, req.userId!, title.slice(0, 120), content.slice(0, 5000), JSON.stringify(tags));
    db.prepare(`INSERT OR IGNORE INTO forum_follows (post_id, user_id) VALUES (?, ?)`).run(postId, req.userId!);
    grantBadge(db, req.userId!, 'forum_contributor');

    res.status(201).json({ postId });
  });

  router.get('/forum/posts/:postId', requireAuth, (req: AuthenticatedRequest, res) => {
    const postId = String(req.params.postId);
    const post = db.prepare(`SELECT * FROM forum_posts WHERE id = ?`).get(postId) as
      | {
          id: string;
          channel_id: string;
          author_id: string;
          title: string;
          content: string;
          tags_json: string;
          is_pinned: number;
          is_locked: number;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!post || !canViewChannel(db, post.channel_id, req.userId!)) {
      res.status(403).json({ error: 'Bu konuya erişim izniniz yok.' });
      return;
    }

    const repliesRows = db
      .prepare(`SELECT * FROM forum_replies WHERE post_id = ? ORDER BY created_at ASC`)
      .all(postId) as Array<{
      id: string;
      post_id: string;
      author_id: string;
      content: string;
      created_at: string;
      edited_at: string | null;
    }>;

    const replies = repliesRows
      .map((r) => {
        const author = getProfileByUserId(db, r.author_id, hub.isUserOnline);
        if (!author) return null;
        return {
          id: r.id,
          postId: r.post_id,
          authorId: r.author_id,
          author,
          content: r.content,
          createdAt: r.created_at,
          editedAt: r.edited_at,
        };
      })
      .filter(Boolean);

    const following = Boolean(
      db.prepare(`SELECT 1 FROM forum_follows WHERE post_id = ? AND user_id = ?`).get(postId, req.userId!)
    );

    res.json({
      post: {
        id: post.id,
        channelId: post.channel_id,
        authorId: post.author_id,
        author: getProfileByUserId(db, post.author_id, hub.isUserOnline),
        title: post.title,
        content: post.content,
        tags: JSON.parse(post.tags_json || '[]'),
        isPinned: post.is_pinned === 1,
        isLocked: post.is_locked === 1,
        isFollowing: following,
        replyCount: replies.length,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
      },
      replies,
    });
  });

  router.post('/forum/posts/:postId/replies', requireAuth, (req: AuthenticatedRequest, res) => {
    const postId = String(req.params.postId);
    const post = db.prepare(`SELECT channel_id, is_locked, title FROM forum_posts WHERE id = ?`).get(postId) as
      | { channel_id: string; is_locked: number; title: string }
      | undefined;
    if (!post) {
      res.status(404).json({ error: 'Konu bulunamadı.' });
      return;
    }
    if (post.is_locked === 1) {
      res.status(403).json({ error: 'Bu konu kilitlenmiştir.' });
      return;
    }
    const perm = canSendInChannel(db, post.channel_id, req.userId!);
    if (!perm.allowed) {
      res.status(403).json({ error: perm.reason });
      return;
    }
    const content = String(req.body?.content || '').trim();
    if (!content) {
      res.status(400).json({ error: 'Yanıt boş olamaz.' });
      return;
    }
    const replyId = crypto.randomUUID();
    db.prepare(`INSERT INTO forum_replies (id, post_id, author_id, content) VALUES (?, ?, ?, ?)`).run(
      replyId,
      postId,
      req.userId!,
      content.slice(0, 4000)
    );
    db.prepare(`UPDATE forum_posts SET updated_at = datetime('now') WHERE id = ?`).run(postId);

    const followers = db
      .prepare(`SELECT user_id FROM forum_follows WHERE post_id = ? AND user_id != ?`)
      .all(postId, req.userId!) as { user_id: string }[];
    const sender = getProfileByUserId(db, req.userId!, hub.isUserOnline);
    for (const f of followers) {
      createNotification(db, hub, {
        userId: f.user_id,
        type: 'reply',
        title: `Takip ettiğiniz konuda yeni yanıt`,
        body: `${sender?.displayName || 'Üye'} "${post.title}" konusuna yanıt verdi.`,
        actorId: req.userId!,
      });
    }

    res.status(201).json({ replyId });
  });

  router.patch('/forum/posts/:postId', requireAuth, (req: AuthenticatedRequest, res) => {
    const postId = String(req.params.postId);
    const post = db
      .prepare(`SELECT fp.channel_id, c.server_id FROM forum_posts fp JOIN channels c ON c.id = fp.channel_id WHERE fp.id = ?`)
      .get(postId) as { channel_id: string; server_id: string } | undefined;
    if (!post) {
      res.status(404).json({ error: 'Konu bulunamadı.' });
      return;
    }
    if (!hasServerPermission(db, post.server_id, req.userId!, 'PIN_MESSAGES')) {
      res.status(403).json({ error: 'Konu sabitleme veya kilitleme yetkiniz yok.' });
      return;
    }
    if (typeof req.body?.isPinned === 'boolean') {
      db.prepare(`UPDATE forum_posts SET is_pinned = ? WHERE id = ?`).run(req.body.isPinned ? 1 : 0, postId);
    }
    if (typeof req.body?.isLocked === 'boolean') {
      db.prepare(`UPDATE forum_posts SET is_locked = ? WHERE id = ?`).run(req.body.isLocked ? 1 : 0, postId);
    }
    res.json({ ok: true });
  });

  router.post('/forum/posts/:postId/follow', requireAuth, (req: AuthenticatedRequest, res) => {
    const postId = String(req.params.postId);
    const existing = db
      .prepare(`SELECT 1 FROM forum_follows WHERE post_id = ? AND user_id = ?`)
      .get(postId, req.userId!);
    if (existing) {
      db.prepare(`DELETE FROM forum_follows WHERE post_id = ? AND user_id = ?`).run(postId, req.userId!);
    } else {
      db.prepare(`INSERT OR IGNORE INTO forum_follows (post_id, user_id) VALUES (?, ?)`).run(postId, req.userId!);
    }
    res.json({ isFollowing: !existing });
  });

  // --- VOICE SESSIONS ---
  router.post('/channels/:channelId/voice/join', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const userId = req.userId!;
    const ch = db.prepare(`SELECT server_id, type, is_stage FROM channels WHERE id = ?`).get(channelId) as
      | { server_id: string; type: string; is_stage: number }
      | undefined;
    if (!ch || ch.type !== 'voice') {
      res.status(404).json({ error: 'Ses kanalı bulunamadı.' });
      return;
    }
    if (!canViewChannel(db, channelId, userId) || !hasChannelPermission(db, channelId, userId, 'CONNECT_VOICE')) {
      res.status(403).json({ error: 'Bu ses kanalına katılma izniniz yok.' });
      return;
    }

    const prev = db.prepare(`SELECT channel_id FROM voice_sessions WHERE user_id = ?`).get(userId) as
      | { channel_id: string }
      | undefined;

    const isStageMod = hasServerPermission(db, ch.server_id, userId, 'MUTE_MEMBERS');
    const isSpeaker = ch.is_stage === 1 ? (isStageMod ? 1 : 0) : 1;
    const initialMuted = isSpeaker === 0 ? 1 : req.body?.muted ? 1 : 0;

    db.prepare(`DELETE FROM voice_sessions WHERE user_id = ?`).run(userId);
    db.prepare(
      `INSERT INTO voice_sessions (id, channel_id, user_id, muted, deafened, video_enabled, screen_sharing, hand_raised, is_speaker)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      crypto.randomUUID(),
      channelId,
      userId,
      initialMuted,
      req.body?.deafened ? 1 : 0,
      req.body?.videoEnabled ? 1 : 0,
      0,
      isSpeaker
    );

    if (prev && prev.channel_id !== channelId) {
      hub.broadcastVoiceParticipants(prev.channel_id);
    }
    grantBadge(db, userId, 'voice_pioneer');
    awardActivityXp(db, userId, 'voice');
    hub.broadcastVoiceParticipants(channelId);
    res.json({
      ok: true,
      isSpeaker: isSpeaker === 1,
      participants: hub.getVoiceParticipants(channelId),
    });
  });

  router.post('/channels/:channelId/voice/leave', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    db.prepare(`DELETE FROM voice_sessions WHERE user_id = ? AND channel_id = ?`).run(req.userId!, channelId);
    hub.broadcastVoiceParticipants(channelId);
    res.json({ ok: true });
  });

  router.patch('/channels/:channelId/voice/state', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const row = db
      .prepare(`SELECT * FROM voice_sessions WHERE user_id = ? AND channel_id = ?`)
      .get(req.userId!, channelId) as
      | { muted: number; deafened: number; video_enabled: number; screen_sharing: number }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Aktif ses oturumu bulunamadı.' });
      return;
    }
    db.prepare(
      `UPDATE voice_sessions SET muted = ?, deafened = ?, video_enabled = ?, screen_sharing = ? WHERE user_id = ? AND channel_id = ?`
    ).run(
      typeof req.body?.muted === 'boolean' ? (req.body.muted ? 1 : 0) : row.muted,
      typeof req.body?.deafened === 'boolean' ? (req.body.deafened ? 1 : 0) : row.deafened,
      typeof req.body?.videoEnabled === 'boolean' ? (req.body.videoEnabled ? 1 : 0) : row.video_enabled,
      typeof req.body?.screenSharing === 'boolean' ? (req.body.screenSharing ? 1 : 0) : row.screen_sharing,
      req.userId!,
      channelId
    );
    hub.broadcastVoiceParticipants(channelId);
    res.json({ ok: true });
  });

  router.post('/channels/:channelId/voice/server-mute/:targetUserId', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = String(req.params.channelId);
    const targetUserId = String(req.params.targetUserId);
    const ch = db.prepare(`SELECT server_id FROM channels WHERE id = ?`).get(channelId) as
      | { server_id: string }
      | undefined;
    if (!ch || !hasServerPermission(db, ch.server_id, req.userId!, 'MUTE_MEMBERS')) {
      res.status(403).json({ error: 'Sesli kanalda susturma yetkiniz yok.' });
      return;
    }
    const serverMuted = req.body?.serverMuted ? 1 : 0;
    db.prepare(`UPDATE voice_sessions SET server_muted = ?, muted = CASE WHEN ? = 1 THEN 1 ELSE muted END WHERE channel_id = ? AND user_id = ?`).run(
      serverMuted,
      serverMuted,
      channelId,
      targetUserId
    );
    addModerationLog(
      db,
      ch.server_id,
      req.userId!,
      serverMuted ? 'SES_SUSTURMA' : 'SES_SUSTURMA_KALDIRILDI',
      targetUserId,
      `Kanal: ${channelId}`
    );
    grantBadge(db, req.userId!, 'orbit_moderator');
    hub.broadcastPresence(req.userId!);
    hub.broadcastVoiceParticipants(channelId);
    res.json({ ok: true });
  });

  // --- SEARCH (STRICTLY RESPECTS ACCESS CONTROL!) ---
  router.get('/search', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const q = String(req.query.q || '').trim();
    const serverId = req.query.serverId ? String(req.query.serverId) : null;
    const authorId = req.query.authorId ? String(req.query.authorId) : null;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    if (!q && !authorId && !from && !to) {
      res.json({ messages: [], channels: [], servers: [], users: [] });
      return;
    }

    // 1. Search messages only in channels the user can actually view!
    const joinedServers = serverId
      ? isServerMember(db, serverId, userId)
        ? [serverId]
        : []
      : (
          db.prepare(`SELECT server_id FROM server_members WHERE user_id = ?`).all(userId) as { server_id: string }[]
        ).map((r) => r.server_id);

    const visibleChannelIds: string[] = [];
    for (const sid of joinedServers) {
      const chs = db.prepare(`SELECT id FROM channels WHERE server_id = ? AND type != 'category'`).all(sid) as {
        id: string;
      }[];
      for (const ch of chs) {
        if (canViewChannel(db, ch.id, userId)) {
          visibleChannelIds.push(ch.id);
        }
      }
    }

    let messageResults: unknown[] = [];
    if (visibleChannelIds.length > 0) {
      const placeholders = visibleChannelIds.map(() => '?').join(',');
      const conditions = [`m.channel_id IN (${placeholders})`, `m.deleted_at IS NULL`];
      const params: unknown[] = [...visibleChannelIds];

      if (q) {
        conditions.push(`m.content LIKE ?`);
        params.push(`%${q}%`);
      }
      if (authorId) {
        conditions.push(`m.author_id = ?`);
        params.push(authorId);
      }
      if (from) {
        conditions.push(`m.created_at >= ?`);
        params.push(from);
      }
      if (to) {
        conditions.push(`m.created_at <= ?`);
        params.push(to + 'T23:59:59Z');
      }

      const rows = db
        .prepare(
          `SELECT m.id, c.name as channel_name, c.server_id
           FROM messages m
           JOIN channels c ON c.id = m.channel_id
           WHERE ${conditions.join(' AND ')}
           ORDER BY m.created_at DESC
           LIMIT 30`
        )
        .all(...params) as { id: string; channel_name: string; server_id: string }[];

      messageResults = rows
        .map((r) => {
          const msg = hydrateChannelMessage(db, r.id, userId, hub.isUserOnline);
          if (!msg) return null;
          return { ...msg, channelName: r.channel_name, serverId: r.server_id };
        })
        .filter(Boolean);
    }

    // 2. Channels matching query (visible only)
    const channelResults =
      q && visibleChannelIds.length > 0
        ? (db
            .prepare(
              `SELECT id, server_id, name, type FROM channels WHERE id IN (${visibleChannelIds
                .map(() => '?')
                .join(',')}) AND name LIKE ? LIMIT 15`
            )
            .all(...visibleChannelIds, `%${q}%`) as unknown[])
        : [];

    // 3. Users matching query (supports username#tag)
    const cleanTag = q.startsWith('#') ? q.slice(1) : q;
    const userRows = q
      ? (db
          .prepare(
            `SELECT user_id FROM profiles
             WHERE username LIKE ? OR display_name LIKE ? OR (username || '#' || discriminator) LIKE ? OR discriminator = ?
             LIMIT 15`
          )
          .all(`%${q}%`, `%${q}%`, `%${q}%`, cleanTag) as { user_id: string }[])
      : [];
    const users = userRows.map((u) => getProfileByUserId(db, u.user_id, hub.isUserOnline)).filter(Boolean);

    // 4. Discoverable/joined servers matching query
    const servers = q
      ? db
          .prepare(
            `SELECT DISTINCT s.id, s.name, s.description, s.icon_url
             FROM servers s
             LEFT JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = ?
             WHERE (s.is_discoverable = 1 OR sm.user_id IS NOT NULL) AND s.name LIKE ?
             LIMIT 15`
          )
          .all(userId, `%${q}%`)
      : [];

    res.json({ messages: messageResults, channels: channelResults, users, servers });
  });

  // --- SECURE FILE ATTACHMENTS ---
  router.post(
    '/files/upload',
    requireAuth,
    uploadMiddleware.array('files', 4),
    (req: AuthenticatedRequest, res) => {
      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) {
        res.status(400).json({ error: 'Yüklenecek dosya seçilmedi.' });
        return;
      }

      const sizeCheck = enforceUserUploadLimit(db, req.userId!, files);
      if (sizeCheck.ok === false) {
        res.status(413).json({
          error: `Dosya boyutu sınırı (${sizeCheck.maxMb} MB) aşıldı. ORBIT Nitro ile 50 MB’a kadar yükleyebilirsiniz.`,
        });
        return;
      }

      const stmt = db.prepare(
        `INSERT INTO message_attachments (id, uploader_id, file_name, mime_type, size_bytes, storage_path)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const uploaded = files.map((file) => {
        const id = crypto.randomUUID();
        const fileName = sanitizeFileName(file.originalname);
        const cleanMime = file.mimetype.split(';')[0].trim().toLowerCase();
        stmt.run(id, req.userId!, fileName, cleanMime, file.size, file.filename);
        return {
          id,
          fileName,
          mimeType: cleanMime,
          sizeBytes: file.size,
          url: `/api/files/${id}`,
        };
      });

      res.status(201).json({ files: uploaded });
    }
  );

  // Serve files with proper authorization & iFrame-safe image loading for verified avatars/icons/emojis + ?token= for private media
  router.get('/files/:fileId', (req, res) => {
    const fileId = String(req.params.fileId);

    const file = db.prepare(`SELECT * FROM message_attachments WHERE id = ?`).get(fileId) as
      | {
          id: string;
          message_id: string | null;
          dm_id: string | null;
          uploader_id: string;
          file_name: string;
          mime_type: string;
          storage_path: string;
        }
      | undefined;

    if (!file) {
      res.status(404).json({ error: 'Dosya bulunamadı.' });
      return;
    }

    let authorized = false;
    let isPublicAvatarOrIcon = false;

    if (!file.message_id && !file.dm_id) {
      const publicRef =
        db.prepare(`SELECT 1 FROM profiles WHERE avatar_url = ?`).get(`/api/files/${file.id}`) ||
        db.prepare(`SELECT 1 FROM servers WHERE icon_url = ?`).get(`/api/files/${file.id}`) ||
        db.prepare(`SELECT 1 FROM direct_conversations WHERE avatar_url = ?`).get(`/api/files/${file.id}`) ||
        db.prepare(`SELECT 1 FROM server_emojis WHERE url = ?`).get(`/api/files/${file.id}`);
      if (publicRef) {
        authorized = true;
        isPublicAvatarOrIcon = true;
      }
    }

    if (!authorized) {
      const token = extractFileTokenFromRequest(req);
      const userId = token ? getUserIdBySessionToken(db, token) : null;
      if (!userId) {
        res.status(401).json({ error: 'Bu dosyayı görüntülemek için oturum açmalısınız.' });
        return;
      }

      if (file.uploader_id === userId) {
        authorized = true;
      } else if (file.message_id) {
        const msg = db.prepare(`SELECT channel_id FROM messages WHERE id = ?`).get(file.message_id) as
          | { channel_id: string }
          | undefined;
        if (msg && canViewChannel(db, msg.channel_id, userId)) {
          authorized = true;
        }
      } else if (file.dm_id) {
        const dm = db.prepare(`SELECT conversation_id FROM direct_messages WHERE id = ?`).get(file.dm_id) as
          | { conversation_id: string }
          | undefined;
        if (dm) {
          const member = db
            .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
            .get(dm.conversation_id, userId);
          if (member) authorized = true;
        }
      }

      if (!authorized) {
        res.status(403).json({ error: 'Bu dosyaya erişim izniniz yok.' });
        return;
      }
    }

    const uploadDir = getUploadDir();
    const fullPath = path.resolve(uploadDir, path.basename(file.storage_path));
    if (!fullPath.startsWith(uploadDir + path.sep) || !fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Dosya diskte bulunamadı.' });
      return;
    }

    const safeName = sanitizeFileName(file.file_name).replace(/["\r\n]/g, '_');
    const disposition = SAFE_INLINE_MEDIA_TYPES.has(file.mime_type) ? 'inline' : 'attachment';
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', isPublicAvatarOrIcon ? 'public, max-age=86400' : 'private, max-age=86400');
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
    res.sendFile(fullPath);
  });

  // --- WEBRTC ICE SERVERS CONFIG ---
  router.get('/webrtc/config', requireAuth, (_req, res) => {
    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
      { urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' },
    ];
    const turnConfigured = Boolean(process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL);
    if (turnConfigured) {
      iceServers.push({
        urls: process.env.TURN_URL!,
        username: process.env.TURN_USERNAME!,
        credential: process.env.TURN_CREDENTIAL!,
      });
    }
    res.json({ iceServers, turnConfigured });
  });

  // --- GIF SEARCH (BUILT-IN ANIMATED ORBIT GIF CATALOG + OPTIONAL TENOR API v2) ---
  router.get('/gifs/search', requireAuth, async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const localMatches =
      !q || q === 'trending'
        ? BUILTIN_GIFS
        : BUILTIN_GIFS.filter(
            (g) => g.title.toLowerCase().includes(q) || g.tags.some((t) => t.includes(q) || q.includes(t))
          );

    const key = process.env.TENOR_API_KEY;
    if (!key) {
      res.json({
        configured: true,
        results: (localMatches.length > 0 ? localMatches : BUILTIN_GIFS).map(({ id, title, previewUrl, url }) => ({
          id,
          title,
          previewUrl,
          url,
        })),
      });
      return;
    }

    try {
      const searchQ = q || 'trending';
      const endpoint =
        searchQ === 'trending'
          ? `https://tenor.googleapis.com/v2/featured?key=${encodeURIComponent(key)}&limit=16&media_filter=gif,tinygif`
          : `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(searchQ)}&key=${encodeURIComponent(key)}&limit=16&media_filter=gif,tinygif`;
      const resp = await fetch(endpoint);
      if (!resp.ok) {
        res.json({ configured: true, results: localMatches });
        return;
      }
      const data = (await resp.json()) as {
        results?: Array<{
          id: string;
          content_description: string;
          media_formats?: { tinygif?: { url: string }; gif?: { url: string } };
        }>;
      };
      const tenorResults = (data.results || []).map((r) => ({
        id: r.id,
        title: r.content_description,
        previewUrl: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url || '',
        url: r.media_formats?.gif?.url || r.media_formats?.tinygif?.url || '',
      }));
      res.json({
        configured: true,
        results: [...localMatches, ...tenorResults],
      });
    } catch {
      res.json({ configured: true, results: localMatches });
    }
  });

  // --- LINK PREVIEW ---
  router.get('/link-preview', requireAuth, async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        res.status(400).json({ error: 'Geçersiz protokol.' });
        return;
      }
      // Strict SSRF protection against private hosts, IPv6 loopback/ULA, and DNS rebinding
      const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
        res.status(400).json({ error: 'İç ağ adresleri önizlenemez.' });
        return;
      }
      if (net.isIP(host)) {
        if (isPrivateOrReservedIp(host)) {
          res.status(400).json({ error: 'İç ağ adresleri önizlenemez.' });
          return;
        }
      } else {
        const resolved = await dns.lookup(host, { all: true }).catch(() => []);
        if (resolved.length === 0 || resolved.some((entry) => isPrivateOrReservedIp(entry.address))) {
          res.status(400).json({ error: 'İç ağ adresleri önizlenemez.' });
          return;
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': 'ORBIT-LinkPreview/1.0' },
      });
      clearTimeout(timeout);

      if (resp.status >= 300 && resp.status < 400) {
        res.json({ preview: null });
        return;
      }

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        res.json({ preview: null });
        return;
      }
      const html = (await resp.text()).slice(0, 60_000);
      const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || html.match(/<title>([^<]+)<\/title>/i);
      const descMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      res.json({
        preview: titleMatch
          ? {
              url: parsed.toString(),
              domain: parsed.hostname,
              title: titleMatch[1].trim().slice(0, 120),
              description: descMatch ? descMatch[1].trim().slice(0, 200) : '',
            }
          : null,
      });
    } catch {
      res.json({ preview: null });
    }
  });

  return router;
}
