import crypto from 'node:crypto';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { createAuthMiddleware, getProfileByUserId, getUserSettings, rateLimit, type AuthenticatedRequest } from '../auth.ts';
import { createNotification, hydrateDirectConversation, hydrateDirectMessage } from '../helpers.ts';
import { isUserBlockedBetween } from '../permissions.ts';
import { getUploadDir, sanitizeFileName, uploadMiddleware, enforceUserUploadLimit } from '../upload.ts';
import { awardActivityXp } from '../gamification.ts';
import type { OrbitRealtimeHub } from '../ws.ts';

const createDmSchema = z.object({
  participantIds: z.array(z.string()).min(1).max(20),
  name: z.string().trim().max(60).optional(),
});

const sendDmSchema = z.object({
  content: z.string().max(4000).default(''),
  replyToId: z.string().nullable().optional(),
  forwardedFrom: z
    .object({
      originalMessageId: z.string(),
      authorName: z.string().max(80),
      channelName: z.string().max(80).optional(),
      content: z.string().max(4000),
      createdAt: z.string().max(80),
    })
    .nullable()
    .optional(),
  clientNonce: z.string().max(80).nullable().optional(),
  attachmentIds: z.array(z.string()).max(4).optional(),
});

export function createSocialRoutes(db: Database.Database, hub: OrbitRealtimeHub): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(db);

  // --- FRIENDSHIP SYSTEM ---
  router.get('/friends', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const rows = db
      .prepare(
        `SELECT * FROM friendships
         WHERE (requester_id = ? OR addressee_id = ?) AND status != 'declined'
         ORDER BY updated_at DESC`
      )
      .all(userId, userId) as Array<{
      id: string;
      requester_id: string;
      addressee_id: string;
      status: 'pending' | 'accepted';
      created_at: string;
    }>;

    const friends = rows
      .map((r) => {
        const peerId = r.requester_id === userId ? r.addressee_id : r.requester_id;
        const friend = getProfileByUserId(db, peerId, hub.isUserOnline);
        if (!friend) return null;
        return {
          id: r.id,
          status: r.status,
          direction: r.status === 'accepted' ? 'accepted' : r.requester_id === userId ? 'outgoing' : 'incoming',
          friend,
          createdAt: r.created_at,
        };
      })
      .filter(Boolean);

    res.json({ friends });
  });

  router.post('/friends/request', requireAuth, rateLimit('friend-req', 15, 60_000), (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const targetInput = String(req.body?.usernameOrId || '').trim();
    if (!targetInput) {
      res.status(400).json({ error: 'Kullanıcı adı veya Kullanıcı#Etiket girin.' });
      return;
    }

    let target: { user_id: string } | undefined;
    const hashIdx = targetInput.lastIndexOf('#');
    if (hashIdx > 0 && hashIdx < targetInput.length - 1) {
      const uname = targetInput.slice(0, hashIdx).replace(/^@/, '').trim();
      const tag = targetInput.slice(hashIdx + 1).trim();
      target = db
        .prepare(`SELECT user_id FROM profiles WHERE lower(username) = lower(?) AND discriminator = ?`)
        .get(uname, tag) as { user_id: string } | undefined;
    } else {
      const cleanName = targetInput.replace(/^@/, '').trim();
      target = db
        .prepare(`SELECT user_id FROM profiles WHERE user_id = ? OR lower(username) = lower(?)`)
        .get(targetInput, cleanName) as { user_id: string } | undefined;
    }

    if (!target) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }

    if (target.user_id === userId) {
      res.status(400).json({ error: 'Kendinize arkadaşlık isteği gönderemezsiniz.' });
      return;
    }

    if (isUserBlockedBetween(db, userId, target.user_id)) {
      res.status(403).json({ error: 'Engellenmiş kullanıcıya arkadaşlık isteği gönderilemez.' });
      return;
    }

    const targetSettings = getUserSettings(db, target.user_id);
    if (!targetSettings.friendRequestsAllowed) {
      res.status(403).json({ error: 'Bu kullanıcı arkadaşlık isteklerini kapatmış.' });
      return;
    }

    const existing = db
      .prepare(
        `SELECT * FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
      )
      .get(userId, target.user_id, target.user_id, userId) as
      | { id: string; requester_id: string; addressee_id: string; status: string }
      | undefined;

    if (existing) {
      if (existing.status === 'accepted') {
        res.status(409).json({ error: 'Zaten arkadaşsınız.' });
        return;
      }
      if (existing.status === 'pending') {
        if (existing.requester_id === target.user_id) {
          // Mutual request -> auto accept!
          db.prepare(`UPDATE friendships SET status = 'accepted', updated_at = datetime('now') WHERE id = ?`).run(
            existing.id
          );
          res.json({ status: 'accepted', id: existing.id });
          return;
        }
        res.status(409).json({ error: 'Zaten bekleyen bir istek var.' });
        return;
      }
      // Previously declined -> allow re-request
      db.prepare(
        `UPDATE friendships SET requester_id = ?, addressee_id = ?, status = 'pending', updated_at = datetime('now') WHERE id = ?`
      ).run(userId, target.user_id, existing.id);
    } else {
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO friendships (id, requester_id, addressee_id, status) VALUES (?, ?, ?, 'pending')`).run(
        id,
        userId,
        target.user_id
      );
    }

    const sender = getProfileByUserId(db, userId, hub.isUserOnline);
    createNotification(db, hub, {
      userId: target.user_id,
      type: 'friend_request',
      title: 'Yeni Arkadaşlık İsteği',
      body: `${sender?.displayName || 'Bir kullanıcı'} size arkadaşlık isteği gönderdi.`,
      actorId: userId,
      link: '/channels/@me',
    });

    hub.sendToUser(target.user_id, { type: 'friends:updated', payload: {} });
    res.status(201).json({ ok: true });
  });

  router.post('/friends/:id/accept', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const row = db.prepare(`SELECT * FROM friendships WHERE id = ?`).get(req.params.id) as
      | { id: string; requester_id: string; addressee_id: string; status: string }
      | undefined;

    if (!row || row.addressee_id !== userId || row.status !== 'pending') {
      res.status(404).json({ error: 'Kabul edilecek istek bulunamadı.' });
      return;
    }

    db.prepare(`UPDATE friendships SET status = 'accepted', updated_at = datetime('now') WHERE id = ?`).run(row.id);

    const accepter = getProfileByUserId(db, userId, hub.isUserOnline);
    createNotification(db, hub, {
      userId: row.requester_id,
      type: 'friend_request',
      title: 'Arkadaşlık İsteği Kabul Edildi',
      body: `${accepter?.displayName || 'Kullanıcı'} arkadaşlık isteğinizi kabul etti.`,
      actorId: userId,
      link: '/channels/@me',
    });

    hub.sendToUser(row.requester_id, { type: 'friends:updated', payload: {} });
    hub.sendToUser(userId, { type: 'friends:updated', payload: {} });
    res.json({ ok: true });
  });

  router.post('/friends/:id/decline', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const row = db.prepare(`SELECT * FROM friendships WHERE id = ?`).get(req.params.id) as
      | { id: string; requester_id: string; addressee_id: string }
      | undefined;
    if (!row || row.addressee_id !== userId) {
      res.status(404).json({ error: 'İstek bulunamadı.' });
      return;
    }
    db.prepare(`UPDATE friendships SET status = 'declined', updated_at = datetime('now') WHERE id = ?`).run(row.id);
    hub.sendToUser(row.requester_id, { type: 'friends:updated', payload: {} });
    res.json({ ok: true });
  });

  router.delete('/friends/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const row = db.prepare(`SELECT * FROM friendships WHERE id = ?`).get(req.params.id) as
      | { id: string; requester_id: string; addressee_id: string }
      | undefined;
    if (!row || (row.requester_id !== userId && row.addressee_id !== userId)) {
      res.status(404).json({ error: 'Arkadaşlık kaydı bulunamadı.' });
      return;
    }
    db.prepare(`DELETE FROM friendships WHERE id = ?`).run(row.id);
    const peerId = row.requester_id === userId ? row.addressee_id : row.requester_id;
    hub.sendToUser(peerId, { type: 'friends:updated', payload: {} });
    res.json({ ok: true });
  });

  // --- BLOCKED USERS ---
  router.get('/blocks', requireAuth, (req: AuthenticatedRequest, res) => {
    const rows = db
      .prepare(`SELECT blocked_id, created_at FROM blocked_users WHERE blocker_id = ? ORDER BY created_at DESC`)
      .all(req.userId!) as { blocked_id: string; created_at: string }[];

    const blocked = rows
      .map((r) => ({
        createdAt: r.created_at,
        user: getProfileByUserId(db, r.blocked_id, hub.isUserOnline),
      }))
      .filter((item) => item.user);

    res.json({ blocked });
  });

  router.post('/blocks', requireAuth, (req: AuthenticatedRequest, res) => {
    const blockerId = req.userId!;
    const blockedId = String(req.body?.userId || '').trim();
    if (!blockedId || blockedId === blockerId) {
      res.status(400).json({ error: 'Geçerli bir kullanıcı seçin.' });
      return;
    }

    const tx = db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)`).run(
        blockerId,
        blockedId
      );
      db.prepare(
        `DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
      ).run(blockerId, blockedId, blockedId, blockerId);
    });
    tx();

    hub.sendToUser(blockedId, { type: 'friends:updated', payload: {} });
    res.json({ ok: true });
  });

  router.delete('/blocks/:blockedId', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare(`DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?`).run(
      req.userId!,
      req.params.blockedId
    );
    res.json({ ok: true });
  });

  // --- NOTIFICATIONS ---
  router.get('/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
    const rows = db
      .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60`)
      .all(req.userId!) as Array<{
      id: string;
      type: string;
      title: string;
      body: string;
      actor_id: string | null;
      link: string | null;
      is_read: number;
      created_at: string;
    }>;

    res.json({
      notifications: rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        actorId: r.actor_id,
        link: r.link,
        isRead: r.is_read === 1,
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(
      req.params.id,
      req.userId!
    );
    res.json({ ok: true });
  });

  router.post('/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.userId!);
    res.json({ ok: true });
  });

  router.delete('/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare(`DELETE FROM notifications WHERE user_id = ?`).run(req.userId!);
    res.json({ ok: true });
  });

  // --- DIRECT MESSAGES & GROUP DMS ---
  router.get('/dm/conversations', requireAuth, (req: AuthenticatedRequest, res) => {
    const includeArchived = req.query.archived === '1';
    const rows = db
      .prepare(
        `SELECT dc.id
         FROM direct_conversations dc
         JOIN direct_conversation_members dcm ON dcm.conversation_id = dc.id
         WHERE dcm.user_id = ? ${includeArchived ? '' : 'AND dcm.archived = 0'}
         ORDER BY dc.updated_at DESC`
      )
      .all(req.userId!) as { id: string }[];

    const conversations = rows
      .map((r) => hydrateDirectConversation(db, r.id, req.userId!, hub.isUserOnline))
      .filter(Boolean);

    res.json({ conversations });
  });

  router.post('/dm/conversations', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = createDmSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Geçersiz sohbet katılımcısı.' });
      return;
    }

    const userId = req.userId!;
    const uniqueParticipants = Array.from(new Set([userId, ...parsed.data.participantIds]));
    if (uniqueParticipants.length < 2) {
      res.status(400).json({ error: 'En az bir alıcı seçmelisiniz.' });
      return;
    }

    const isGroup = uniqueParticipants.length > 2 || Boolean(parsed.data.name);

    // Check blocks & DM privacy for 1-to-1
    for (const peerId of uniqueParticipants) {
      if (peerId === userId) continue;
      if (isUserBlockedBetween(db, userId, peerId)) {
        res.status(403).json({ error: 'Engellenmiş bir kullanıcıyla sohbet başlatılamaz.' });
        return;
      }
      const peerSettings = getUserSettings(db, peerId);
      if (peerSettings.dmPermission === 'friends') {
        const isFriend = db
          .prepare(
            `SELECT 1 FROM friendships
             WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`
          )
          .get(userId, peerId, peerId, userId);
        if (!isFriend) {
          res.status(403).json({ error: 'Bu kullanıcı yalnızca arkadaşlarından özel mesaj kabul ediyor.' });
          return;
        }
      } else if (peerSettings.dmPermission === 'server_members') {
        const mutual = db
          .prepare(
            `SELECT 1 FROM server_members m1
             JOIN server_members m2 ON m1.server_id = m2.server_id
             WHERE m1.user_id = ? AND m2.user_id = ?`
          )
          .get(userId, peerId);
        if (!mutual) {
          res.status(403).json({ error: 'Bu kullanıcı yalnızca ortak sunuculardaki üyelerden mesaj kabul ediyor.' });
          return;
        }
      }
    }

    // Return existing 1-to-1 conversation if one exists
    if (!isGroup && uniqueParticipants.length === 2) {
      const peerId = uniqueParticipants.find((id) => id !== userId)!;
      const existing = db
        .prepare(
          `SELECT dc.id
           FROM direct_conversations dc
           JOIN direct_conversation_members m1 ON m1.conversation_id = dc.id AND m1.user_id = ?
           JOIN direct_conversation_members m2 ON m2.conversation_id = dc.id AND m2.user_id = ?
           WHERE dc.is_group = 0`
        )
        .get(userId, peerId) as { id: string } | undefined;

      if (existing) {
        db.prepare(`UPDATE direct_conversation_members SET archived = 0 WHERE conversation_id = ? AND user_id = ?`).run(
          existing.id,
          userId
        );
        const conversation = hydrateDirectConversation(db, existing.id, userId, hub.isUserOnline);
        res.json({ conversation });
        return;
      }
    }

    const convId = crypto.randomUUID();
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO direct_conversations (id, is_group, name, owner_id) VALUES (?, ?, ?, ?)`
      ).run(convId, isGroup ? 1 : 0, isGroup ? parsed.data.name || 'Grup Sohbeti' : null, isGroup ? userId : null);

      const insertMember = db.prepare(
        `INSERT INTO direct_conversation_members (conversation_id, user_id) VALUES (?, ?)`
      );
      for (const pid of uniqueParticipants) {
        insertMember.run(convId, pid);
      }
    });
    tx();

    const conversation = hydrateDirectConversation(db, convId, userId, hub.isUserOnline);
    for (const pid of uniqueParticipants) {
      hub.sendToUser(pid, { type: 'dm:conversation_updated', payload: { conversationId: convId } });
    }
    res.status(201).json({ conversation });
  });

  router.patch('/dm/conversations/:convId', requireAuth, (req: AuthenticatedRequest, res) => {
    const convId = String(req.params.convId);
    const userId = req.userId!;
    const member = db
      .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
      .get(convId, userId);
    if (!member) {
      res.status(403).json({ error: 'Bu sohbete erişiminiz yok.' });
      return;
    }

    if (typeof req.body?.archived === 'boolean') {
      db.prepare(`UPDATE direct_conversation_members SET archived = ? WHERE conversation_id = ? AND user_id = ?`).run(
        req.body.archived ? 1 : 0,
        convId,
        userId
      );
    }

    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      db.prepare(`UPDATE direct_conversations SET name = ? WHERE id = ? AND is_group = 1`).run(
        req.body.name.trim().slice(0, 60),
        convId
      );
    }

    const conversation = hydrateDirectConversation(db, convId, userId, hub.isUserOnline);
    const allMembers = db
      .prepare(`SELECT user_id FROM direct_conversation_members WHERE conversation_id = ?`)
      .all(convId) as { user_id: string }[];
    for (const m of allMembers) {
      hub.sendToUser(m.user_id, { type: 'dm:conversation_updated', payload: { conversationId: convId } });
    }
    res.json({ conversation });
  });

  // Group DM add member
  router.post('/dm/conversations/:convId/members', requireAuth, (req: AuthenticatedRequest, res) => {
    const convId = String(req.params.convId);
    const userId = req.userId!;
    const targetUserId = String(req.body?.userId || '').trim();
    const conv = db.prepare(`SELECT is_group FROM direct_conversations WHERE id = ?`).get(convId) as
      | { is_group: number }
      | undefined;
    if (!conv || conv.is_group !== 1) {
      res.status(400).json({ error: 'Yalnızca grup sohbetlerine üye eklenebilir.' });
      return;
    }
    const isMember = db
      .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
      .get(convId, userId);
    if (!isMember) {
      res.status(403).json({ error: 'Bu sohbetin üyesi değilsiniz.' });
      return;
    }
    if (!targetUserId || isUserBlockedBetween(db, userId, targetUserId)) {
      res.status(403).json({ error: 'Bu kullanıcı gruba eklenemez.' });
      return;
    }
    const targetProfile = getProfileByUserId(db, targetUserId, hub.isUserOnline);
    if (!targetProfile) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }

    db.prepare(`INSERT OR IGNORE INTO direct_conversation_members (conversation_id, user_id) VALUES (?, ?)`).run(
      convId,
      targetUserId
    );
    db.prepare(`UPDATE direct_conversations SET updated_at = datetime('now') WHERE id = ?`).run(convId);

    const allMembers = db
      .prepare(`SELECT user_id FROM direct_conversation_members WHERE conversation_id = ?`)
      .all(convId) as { user_id: string }[];
    for (const m of allMembers) {
      hub.sendToUser(m.user_id, { type: 'dm:conversation_updated', payload: { conversationId: convId } });
    }
    const conversation = hydrateDirectConversation(db, convId, userId, hub.isUserOnline);
    res.json({ conversation });
  });

  // Group DM leave or remove member (owner can remove anyone, anyone can remove self)
  router.delete('/dm/conversations/:convId/members/:targetUserId', requireAuth, (req: AuthenticatedRequest, res) => {
    const convId = String(req.params.convId);
    const targetUserId = String(req.params.targetUserId);
    const userId = req.userId!;

    const conv = db.prepare(`SELECT is_group, owner_id FROM direct_conversations WHERE id = ?`).get(convId) as
      | { is_group: number; owner_id: string | null }
      | undefined;
    if (!conv || conv.is_group !== 1) {
      res.status(400).json({ error: 'Yalnızca grup sohbetlerinden ayrılabilir veya üye çıkarılabilir.' });
      return;
    }
    if (targetUserId !== userId && conv.owner_id !== userId) {
      res.status(403).json({ error: 'Başka bir üyeyi yalnızca grup kurucusu çıkarabilir.' });
      return;
    }

    db.prepare(`DELETE FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`).run(
      convId,
      targetUserId
    );
    hub.sendToUser(targetUserId, { type: 'dm:conversation_updated', payload: { conversationId: convId } });
    const remaining = db
      .prepare(`SELECT user_id FROM direct_conversation_members WHERE conversation_id = ?`)
      .all(convId) as { user_id: string }[];
    for (const m of remaining) {
      hub.sendToUser(m.user_id, { type: 'dm:conversation_updated', payload: { conversationId: convId } });
    }
    const conversation =
      targetUserId === userId ? null : hydrateDirectConversation(db, convId, userId, hub.isUserOnline);
    res.json({ ok: true, conversation });
  });

  router.post(
    '/dm/conversations/:convId/avatar',
    requireAuth,
    uploadMiddleware.single('avatar'),
    (req: AuthenticatedRequest, res) => {
      const convId = String(req.params.convId);
      const userId = req.userId!;
      const member = db
        .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
        .get(convId, userId);
      if (!member) {
        res.status(403).json({ error: 'Erişim izniniz yok.' });
        return;
      }
      const file = req.file;
      if (!file || !file.mimetype.startsWith('image/')) {
        res.status(400).json({ error: 'Geçerli bir görsel seçin.' });
        return;
      }
      const sizeCheck = enforceUserUploadLimit(db, userId, [file]);
      if (sizeCheck.ok === false) {
        res.status(413).json({ error: `Dosya boyutu sınırı (${sizeCheck.maxMb} MB) aşıldı.` });
        return;
      }
      const attachmentId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO message_attachments (id, uploader_id, file_name, mime_type, size_bytes, storage_path)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(attachmentId, userId, sanitizeFileName(file.originalname), file.mimetype, file.size, file.filename);
      const avatarUrl = `/api/files/${attachmentId}`;
      db.prepare(`UPDATE direct_conversations SET avatar_url = ? WHERE id = ? AND is_group = 1`).run(avatarUrl, convId);
      const conversation = hydrateDirectConversation(db, convId, userId, hub.isUserOnline);
      res.json({ conversation });
    }
  );

  router.get('/dm/conversations/:convId/messages', requireAuth, (req: AuthenticatedRequest, res) => {
    const convId = String(req.params.convId);
    const userId = req.userId!;
    const member = db
      .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
      .get(convId, userId);
    if (!member) {
      res.status(403).json({ error: 'Bu sohbete erişim izniniz yok.' });
      return;
    }

    const before = req.query.before ? String(req.query.before) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);

    const rows = before
      ? (db
          .prepare(
            `SELECT id FROM direct_messages
             WHERE conversation_id = ? AND created_at < ?
             ORDER BY created_at DESC LIMIT ?`
          )
          .all(convId, before, limit) as { id: string }[])
      : (db
          .prepare(
            `SELECT id FROM direct_messages
             WHERE conversation_id = ?
             ORDER BY created_at DESC LIMIT ?`
          )
          .all(convId, limit) as { id: string }[]);

    const messages = rows
      .reverse()
      .map((r) => hydrateDirectMessage(db, r.id, userId, hub.isUserOnline))
      .filter(Boolean);

    res.json({ messages, hasMore: rows.length === limit });
  });

  router.post(
    '/dm/conversations/:convId/messages',
    requireAuth,
    rateLimit('send-dm', 30, 15_000),
    (req: AuthenticatedRequest, res) => {
      const convId = String(req.params.convId);
      const userId = req.userId!;
      const member = db
        .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
        .get(convId, userId);
      if (!member) {
        res.status(403).json({ error: 'Bu sohbete erişim izniniz yok.' });
        return;
      }

      const parsed = sendDmSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Geçersiz mesaj içeriği.' });
        return;
      }
      const { content, replyToId, forwardedFrom, clientNonce, attachmentIds } = parsed.data;
      if (!content.trim() && (!attachmentIds || attachmentIds.length === 0) && !forwardedFrom) {
        res.status(400).json({ error: 'Boş mesaj gönderilemez.' });
        return;
      }

      // Check blocks for 1-to-1
      const conv = db.prepare(`SELECT is_group FROM direct_conversations WHERE id = ?`).get(convId) as {
        is_group: number;
      };
      const peers = db
        .prepare(`SELECT user_id FROM direct_conversation_members WHERE conversation_id = ? AND user_id != ?`)
        .all(convId, userId) as { user_id: string }[];

      if (conv.is_group === 0 && peers[0] && isUserBlockedBetween(db, userId, peers[0].user_id)) {
        res.status(403).json({ error: 'Engelleme nedeniyle bu kullanıcıya mesaj gönderemezsiniz.' });
        return;
      }

      // Idempotency guard via clientNonce
      if (clientNonce) {
        const existing = db
          .prepare(`SELECT id FROM direct_messages WHERE conversation_id = ? AND author_id = ? AND client_nonce = ?`)
          .get(convId, userId, clientNonce) as { id: string } | undefined;
        if (existing) {
          const message = hydrateDirectMessage(db, existing.id, userId, hub.isUserOnline);
          res.json({ message });
          return;
        }
      }

      let safeReplyToId: string | null = null;
      if (replyToId) {
        const targetReply = db
          .prepare(`SELECT id FROM direct_messages WHERE id = ? AND conversation_id = ?`)
          .get(replyToId, convId) as { id: string } | undefined;
        if (targetReply) safeReplyToId = targetReply.id;
      }

      const dmId = crypto.randomUUID();
      const forwardedJson = forwardedFrom ? JSON.stringify(forwardedFrom) : null;
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO direct_messages (id, conversation_id, author_id, content, reply_to_id, forwarded_from_json, client_nonce)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(dmId, convId, userId, content.trim(), safeReplyToId, forwardedJson, clientNonce || null);

        if (attachmentIds?.length) {
          const attachStmt = db.prepare(
            `UPDATE message_attachments SET dm_id = ? WHERE id = ? AND uploader_id = ? AND message_id IS NULL AND dm_id IS NULL`
          );
          for (const aid of attachmentIds) {
            attachStmt.run(dmId, aid, userId);
          }
        }

        db.prepare(`UPDATE direct_conversations SET updated_at = datetime('now') WHERE id = ?`).run(convId);
        db.prepare(`UPDATE direct_conversation_members SET archived = 0 WHERE conversation_id = ?`).run(convId);
      });
      tx();

      awardActivityXp(db, userId, 'message');
      const message = hydrateDirectMessage(db, dmId, userId, hub.isUserOnline);
      hub.sendToRoom(`dm:${convId}`, { type: 'dm:new', payload: { conversationId: convId, message } });

      const sender = getProfileByUserId(db, userId, hub.isUserOnline);
      for (const p of peers) {
        hub.sendToUser(p.user_id, { type: 'dm:conversation_updated', payload: { conversationId: convId } });
        createNotification(db, hub, {
          userId: p.user_id,
          type: 'dm',
          title: sender?.displayName || 'Yeni Özel Mesaj',
          body: content.trim().slice(0, 120) || 'Bir dosya gönderdi',
          actorId: userId,
          link: `/channels/@me/${convId}`,
        });
      }

      res.status(201).json({ message });
    }
  );

  router.patch('/dm/messages/:dmId', requireAuth, (req: AuthenticatedRequest, res) => {
    const dmId = String(req.params.dmId);
    const content = String(req.body?.content || '').trim();
    if (!content) {
      res.status(400).json({ error: 'Mesaj boş olamaz.' });
      return;
    }

    const row = db.prepare(`SELECT * FROM direct_messages WHERE id = ?`).get(dmId) as
      | { id: string; conversation_id: string; author_id: string; deleted_at: string | null }
      | undefined;

    if (!row || row.deleted_at) {
      res.status(404).json({ error: 'Mesaj bulunamadı.' });
      return;
    }
    if (row.author_id !== req.userId!) {
      res.status(403).json({ error: 'Yalnızca kendi mesajlarınızı düzenleyebilirsiniz.' });
      return;
    }

    db.prepare(`UPDATE direct_messages SET content = ?, edited_at = datetime('now') WHERE id = ?`).run(content, dmId);
    const message = hydrateDirectMessage(db, dmId, req.userId!, hub.isUserOnline);
    hub.sendToRoom(`dm:${row.conversation_id}`, {
      type: 'dm:updated',
      payload: { conversationId: row.conversation_id, message },
    });
    res.json({ message });
  });

  router.delete('/dm/messages/:dmId', requireAuth, (req: AuthenticatedRequest, res) => {
    const dmId = String(req.params.dmId);
    const row = db.prepare(`SELECT * FROM direct_messages WHERE id = ?`).get(dmId) as
      | { id: string; conversation_id: string; author_id: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Mesaj bulunamadı.' });
      return;
    }
    if (row.author_id !== req.userId!) {
      res.status(403).json({ error: 'Yalnızca kendi mesajlarınızı silebilirsiniz.' });
      return;
    }

    db.prepare(`UPDATE direct_messages SET deleted_at = datetime('now'), content = '', pinned = 0 WHERE id = ?`).run(
      dmId
    );
    hub.sendToRoom(`dm:${row.conversation_id}`, {
      type: 'dm:deleted',
      payload: { conversationId: row.conversation_id, dmId },
    });
    res.json({ ok: true });
  });

  router.post('/dm/messages/:dmId/reactions', requireAuth, (req: AuthenticatedRequest, res) => {
    const dmId = String(req.params.dmId);
    const emoji = String(req.body?.emoji || '').trim().slice(0, 16);
    if (!emoji) {
      res.status(400).json({ error: 'Geçerli emoji seçin.' });
      return;
    }
    const dm = db.prepare(`SELECT conversation_id FROM direct_messages WHERE id = ?`).get(dmId) as
      | { conversation_id: string }
      | undefined;
    if (!dm) {
      res.status(404).json({ error: 'Mesaj bulunamadı.' });
      return;
    }
    const isMember = db
      .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
      .get(dm.conversation_id, req.userId!);
    if (!isMember) {
      res.status(403).json({ error: 'Erişim izniniz yok.' });
      return;
    }

    const existing = db
      .prepare(`SELECT id FROM direct_message_reactions WHERE dm_id = ? AND user_id = ? AND emoji = ?`)
      .get(dmId, req.userId!, emoji) as { id: string } | undefined;

    if (existing) {
      db.prepare(`DELETE FROM direct_message_reactions WHERE id = ?`).run(existing.id);
    } else {
      db.prepare(`INSERT INTO direct_message_reactions (id, dm_id, user_id, emoji) VALUES (?, ?, ?, ?)`).run(
        crypto.randomUUID(),
        dmId,
        req.userId!,
        emoji
      );
    }

    const message = hydrateDirectMessage(db, dmId, req.userId!, hub.isUserOnline);
    hub.sendToRoom(`dm:${dm.conversation_id}`, {
      type: 'dm:updated',
      payload: { conversationId: dm.conversation_id, message },
    });
    res.json({ message });
  });

  router.post('/dm/messages/:dmId/pin', requireAuth, (req: AuthenticatedRequest, res) => {
    const dmId = String(req.params.dmId);
    const dm = db.prepare(`SELECT conversation_id, pinned FROM direct_messages WHERE id = ?`).get(dmId) as
      | { conversation_id: string; pinned: number }
      | undefined;
    if (!dm) {
      res.status(404).json({ error: 'Mesaj bulunamadı.' });
      return;
    }
    const isMember = db
      .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
      .get(dm.conversation_id, req.userId!);
    if (!isMember) {
      res.status(403).json({ error: 'Erişim izniniz yok.' });
      return;
    }

    db.prepare(`UPDATE direct_messages SET pinned = ? WHERE id = ?`).run(dm.pinned === 1 ? 0 : 1, dmId);
    const message = hydrateDirectMessage(db, dmId, req.userId!, hub.isUserOnline);
    hub.sendToRoom(`dm:${dm.conversation_id}`, {
      type: 'dm:updated',
      payload: { conversationId: dm.conversation_id, message },
    });
    res.json({ message });
  });

  router.post('/dm/conversations/:convId/read', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare(
      `INSERT INTO read_receipts (user_id, target_type, target_id, last_read_at)
       VALUES (?, 'dm', ?, datetime('now'))
       ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET last_read_at = datetime('now')`
    ).run(req.userId!, req.params.convId);
    res.json({ ok: true });
  });

  return router;
}
