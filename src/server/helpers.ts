import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ChatMessage, DirectConversation, NotificationItem, ReactionSummary, Attachment } from '../shared/types.ts';
import { getProfileByUserId, parseUtcMs, type OnlineChecker } from './auth.ts';
import type { OrbitRealtimeHub } from './ws.ts';

export function createNotification(
  db: Database.Database,
  hub: OrbitRealtimeHub,
  params: {
    userId: string;
    type: NotificationItem['type'];
    title: string;
    body: string;
    actorId?: string | null;
    link?: string | null;
  }
): void {
  const settings = db
    .prepare(`SELECT in_app_notifications, dnd_mode FROM user_settings WHERE user_id = ?`)
    .get(params.userId) as { in_app_notifications: number; dnd_mode: number } | undefined;

  if (settings && (settings.in_app_notifications === 0 || settings.dnd_mode === 1)) {
    return;
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, actor_id, link)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, params.userId, params.type, params.title, params.body, params.actorId || null, params.link || null);

  const row = db.prepare(`SELECT * FROM notifications WHERE id = ?`).get(id) as {
    id: string;
    type: NotificationItem['type'];
    title: string;
    body: string;
    actor_id: string | null;
    link: string | null;
    is_read: number;
    created_at: string;
  };

  hub.sendToUser(params.userId, {
    type: 'notification:new',
    payload: {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      actorId: row.actor_id,
      link: row.link,
      isRead: row.is_read === 1,
      createdAt: row.created_at,
    },
  });
}

export function hydrateChannelMessage(
  db: Database.Database,
  messageId: string,
  viewerUserId: string,
  isUserOnline: OnlineChecker
): ChatMessage | null {
  const row = db
    .prepare(
      `SELECT m.*,
              CASE WHEN p.message_id IS NOT NULL THEN 1 ELSE 0 END as is_pinned
       FROM messages m
       LEFT JOIN pinned_messages p ON p.message_id = m.id
       WHERE m.id = ?`
    )
    .get(messageId) as
    | {
        id: string;
        channel_id: string;
        thread_id?: string | null;
        author_id: string;
        content: string;
        reply_to_id: string | null;
        forwarded_from_json?: string | null;
        client_nonce: string | null;
        is_announcement: number;
        is_pinned: number;
        webhook_name?: string | null;
        edited_at: string | null;
        deleted_at: string | null;
        created_at: string;
      }
    | undefined;

  if (!row) return null;

  const author = getProfileByUserId(db, row.author_id, isUserOnline);
  if (!author) return null;

  let replyTo: ChatMessage['replyTo'] = null;
  if (row.reply_to_id) {
    const replyRow = db
      .prepare(
        `SELECT m.id, m.author_id, m.content, m.deleted_at, p.display_name
         FROM messages m
         JOIN profiles p ON p.user_id = m.author_id
         WHERE m.id = ?`
      )
      .get(row.reply_to_id) as
      | { id: string; author_id: string; content: string; deleted_at: string | null; display_name: string }
      | undefined;
    if (replyRow) {
      replyTo = {
        id: replyRow.id,
        authorId: replyRow.author_id,
        authorName: replyRow.display_name,
        content: replyRow.deleted_at ? 'Silinmiş mesaj' : replyRow.content.slice(0, 140),
      };
    }
  }

  const attachmentsRows = db
    .prepare(`SELECT * FROM message_attachments WHERE message_id = ?`)
    .all(row.id) as Array<{
    id: string;
    message_id: string | null;
    dm_id: string | null;
    uploader_id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
  }>;

  const attachments: Attachment[] = attachmentsRows.map((a) => ({
    id: a.id,
    messageId: a.message_id,
    dmId: a.dm_id,
    uploaderId: a.uploader_id,
    fileName: a.file_name,
    mimeType: a.mime_type,
    sizeBytes: a.size_bytes,
    url: `/api/files/${a.id}`,
    createdAt: a.created_at,
  }));

  const reactionRows = db
    .prepare(`SELECT emoji, user_id FROM message_reactions WHERE message_id = ?`)
    .all(row.id) as { emoji: string; user_id: string }[];

  const reactionMap = new Map<string, string[]>();
  for (const r of reactionRows) {
    const list = reactionMap.get(r.emoji) || [];
    list.push(r.user_id);
    reactionMap.set(r.emoji, list);
  }
  const reactions: ReactionSummary[] = Array.from(reactionMap.entries()).map(([emoji, userIds]) => ({
    emoji,
    count: userIds.length,
    reactedByMe: userIds.includes(viewerUserId),
    userIds,
  }));

  let poll: ChatMessage['poll'] = null;
  if (!row.deleted_at) {
    const pollRow = db
      .prepare(`SELECT id, question, allow_multiple FROM message_polls WHERE message_id = ?`)
      .get(row.id) as { id: string; question: string; allow_multiple: number } | undefined;
    if (pollRow) {
      const optRows = db
        .prepare(`SELECT id, label FROM message_poll_options WHERE poll_id = ? ORDER BY position ASC`)
        .all(pollRow.id) as Array<{ id: string; label: string }>;
      const voteRows = db
        .prepare(`SELECT option_id, user_id FROM message_poll_votes WHERE poll_id = ?`)
        .all(pollRow.id) as Array<{ option_id: string; user_id: string }>;
      const voterSet = new Set<string>();
      const optCounts = new Map<string, { votes: number; votedByMe: boolean }>();
      for (const v of voteRows) {
        voterSet.add(v.user_id);
        const cur = optCounts.get(v.option_id) || { votes: 0, votedByMe: false };
        cur.votes += 1;
        if (v.user_id === viewerUserId) cur.votedByMe = true;
        optCounts.set(v.option_id, cur);
      }
      poll = {
        id: pollRow.id,
        question: pollRow.question,
        allowMultiple: pollRow.allow_multiple === 1,
        totalVotes: voterSet.size,
        options: optRows.map((o) => {
          const st = optCounts.get(o.id) || { votes: 0, votedByMe: false };
          return {
            id: o.id,
            label: o.label,
            votes: st.votes,
            votedByMe: st.votedByMe,
          };
        }),
      };
    }
  }

  let forwardedFrom: ChatMessage['forwardedFrom'] = null;
  if (!row.deleted_at && row.forwarded_from_json) {
    try {
      forwardedFrom = JSON.parse(row.forwarded_from_json);
    } catch {
      forwardedFrom = null;
    }
  }

  let threadSummary: ChatMessage['threadSummary'] = null;
  if (!row.deleted_at && !row.thread_id) {
    const th = db
      .prepare(
        `SELECT mt.id, mt.title, mt.is_locked,
                (SELECT COUNT(*) FROM messages WHERE thread_id = mt.id AND deleted_at IS NULL) as reply_count
         FROM message_threads mt
         WHERE mt.parent_message_id = ?`
      )
      .get(row.id) as { id: string; title: string; is_locked: number; reply_count: number } | undefined;
    if (th) {
      threadSummary = {
        id: th.id,
        title: th.title,
        replyCount: th.reply_count,
        isLocked: th.is_locked === 1,
      };
    }
  }

  return {
    id: row.id,
    channelId: row.channel_id,
    threadId: row.thread_id ?? null,
    authorId: row.author_id,
    author,
    content: row.deleted_at ? '' : row.content,
    replyToId: row.reply_to_id,
    replyTo,
    forwardedFrom,
    threadSummary,
    clientNonce: row.client_nonce,
    isAnnouncement: row.is_announcement === 1,
    isPinned: row.is_pinned === 1,
    webhookName: row.webhook_name ?? null,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    attachments: row.deleted_at ? [] : attachments,
    reactions,
    poll,
    status: 'sent',
  };
}

export function hydrateDirectMessage(
  db: Database.Database,
  dmId: string,
  viewerUserId: string,
  isUserOnline: OnlineChecker
): ChatMessage | null {
  const row = db
    .prepare(`SELECT * FROM direct_messages WHERE id = ?`)
    .get(dmId) as
    | {
        id: string;
        conversation_id: string;
        author_id: string;
        content: string;
        reply_to_id: string | null;
        forwarded_from_json?: string | null;
        client_nonce: string | null;
        pinned: number;
        edited_at: string | null;
        deleted_at: string | null;
        created_at: string;
      }
    | undefined;

  if (!row) return null;
  const author = getProfileByUserId(db, row.author_id, isUserOnline);
  if (!author) return null;

  let replyTo: ChatMessage['replyTo'] = null;
  if (row.reply_to_id) {
    const replyRow = db
      .prepare(
        `SELECT m.id, m.author_id, m.content, m.deleted_at, p.display_name
         FROM direct_messages m
         JOIN profiles p ON p.user_id = m.author_id
         WHERE m.id = ?`
      )
      .get(row.reply_to_id) as
      | { id: string; author_id: string; content: string; deleted_at: string | null; display_name: string }
      | undefined;
    if (replyRow) {
      replyTo = {
        id: replyRow.id,
        authorId: replyRow.author_id,
        authorName: replyRow.display_name,
        content: replyRow.deleted_at ? 'Silinmiş mesaj' : replyRow.content.slice(0, 140),
      };
    }
  }

  const attachmentsRows = db
    .prepare(`SELECT * FROM message_attachments WHERE dm_id = ?`)
    .all(row.id) as Array<{
    id: string;
    message_id: string | null;
    dm_id: string | null;
    uploader_id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
  }>;

  const attachments: Attachment[] = attachmentsRows.map((a) => ({
    id: a.id,
    messageId: a.message_id,
    dmId: a.dm_id,
    uploaderId: a.uploader_id,
    fileName: a.file_name,
    mimeType: a.mime_type,
    sizeBytes: a.size_bytes,
    url: `/api/files/${a.id}`,
    createdAt: a.created_at,
  }));

  const reactionRows = db
    .prepare(`SELECT emoji, user_id FROM direct_message_reactions WHERE dm_id = ?`)
    .all(row.id) as { emoji: string; user_id: string }[];

  const reactionMap = new Map<string, string[]>();
  for (const r of reactionRows) {
    const list = reactionMap.get(r.emoji) || [];
    list.push(r.user_id);
    reactionMap.set(r.emoji, list);
  }
  const reactions: ReactionSummary[] = Array.from(reactionMap.entries()).map(([emoji, userIds]) => ({
    emoji,
    count: userIds.length,
    reactedByMe: userIds.includes(viewerUserId),
    userIds,
  }));

  let forwardedFrom: ChatMessage['forwardedFrom'] = null;
  if (!row.deleted_at && row.forwarded_from_json) {
    try {
      forwardedFrom = JSON.parse(row.forwarded_from_json);
    } catch {
      forwardedFrom = null;
    }
  }

  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorId: row.author_id,
    author,
    content: row.deleted_at ? '' : row.content,
    replyToId: row.reply_to_id,
    replyTo,
    forwardedFrom,
    clientNonce: row.client_nonce,
    isPinned: row.pinned === 1,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    attachments: row.deleted_at ? [] : attachments,
    reactions,
    status: 'sent',
  };
}

export function hydrateDirectConversation(
  db: Database.Database,
  conversationId: string,
  viewerUserId: string,
  isUserOnline: OnlineChecker
): DirectConversation | null {
  const conv = db
    .prepare(
      `SELECT dc.*, dcm.archived
       FROM direct_conversations dc
       JOIN direct_conversation_members dcm ON dcm.conversation_id = dc.id
       WHERE dc.id = ? AND dcm.user_id = ?`
    )
    .get(conversationId, viewerUserId) as
    | {
        id: string;
        is_group: number;
        name: string | null;
        avatar_url: string | null;
        owner_id: string | null;
        archived: number;
        updated_at: string;
      }
    | undefined;

  if (!conv) return null;

  const memberRows = db
    .prepare(`SELECT user_id FROM direct_conversation_members WHERE conversation_id = ?`)
    .all(conversationId) as { user_id: string }[];

  const members = memberRows
    .map((m) => getProfileByUserId(db, m.user_id, isUserOnline))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const lastMsg = db
    .prepare(
      `SELECT dm.content, dm.created_at, dm.deleted_at, p.display_name
       FROM direct_messages dm
       JOIN profiles p ON p.user_id = dm.author_id
       WHERE dm.conversation_id = ?
       ORDER BY dm.created_at DESC
       LIMIT 1`
    )
    .get(conversationId) as
    | { content: string; created_at: string; deleted_at: string | null; display_name: string }
    | undefined;

  const receipt = db
    .prepare(`SELECT last_read_at FROM read_receipts WHERE user_id = ? AND target_type = 'dm' AND target_id = ?`)
    .get(viewerUserId, conversationId) as { last_read_at: string } | undefined;

  const unreadRow = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM direct_messages
       WHERE conversation_id = ? AND author_id != ? AND deleted_at IS NULL AND created_at > ?`
    )
    .get(conversationId, viewerUserId, receipt?.last_read_at || '1970-01-01') as { cnt: number };

  return {
    id: conv.id,
    isGroup: conv.is_group === 1,
    name: conv.name,
    avatarUrl: conv.avatar_url,
    ownerId: conv.owner_id,
    archived: conv.archived === 1,
    unreadCount: unreadRow.cnt,
    updatedAt: conv.updated_at,
    lastMessage: lastMsg
      ? {
          content: lastMsg.deleted_at ? 'Mesaj silindi' : lastMsg.content || 'Ek dosya',
          authorName: lastMsg.display_name,
          createdAt: lastMsg.created_at,
        }
      : null,
    members,
  };
}

// Anti-spam and server AutoMod checks
export function checkMessageModeration(
  db: Database.Database,
  params: {
    serverId: string;
    channelId: string;
    userId: string;
    content: string;
    isPrivileged: boolean;
  }
): { allowed: boolean; reason?: string } {
  const server = db
    .prepare(`SELECT moderation_level, blocked_words, block_links, slowmode_seconds FROM servers WHERE id = ?`)
    .get(params.serverId) as
    | {
        moderation_level: 'low' | 'medium' | 'high';
        blocked_words: string;
        block_links: number;
        slowmode_seconds: number;
      }
    | undefined;

  if (!server) return { allowed: false, reason: 'Sunucu bulunamadı.' };

  const text = params.content.trim();
  const automod = db
    .prepare(`SELECT * FROM server_automod_rules WHERE server_id = ?`)
    .get(params.serverId) as
    | {
        enabled: number;
        block_bad_words: number;
        bad_words: string;
        block_invites: number;
        anti_spam: number;
        max_mentions: number;
        timeout_minutes: number;
      }
    | undefined;

  const applyAutoTimeout = (reason: string) => {
    if (automod && automod.enabled === 1 && automod.timeout_minutes > 0) {
      const until = new Date(Date.now() + automod.timeout_minutes * 60 * 1000).toISOString();
      db.prepare(`UPDATE server_members SET muted_until = ? WHERE server_id = ? AND user_id = ?`).run(
        until,
        params.serverId,
        params.userId
      );
      db.prepare(
        `INSERT INTO moderation_logs (id, server_id, actor_id, action, target_user_id, details)
         VALUES (?, ?, ?, 'AUTOMOD_SUSTURMA', ?, ?)`
      ).run(crypto.randomUUID(), params.serverId, params.userId, params.userId, `${reason} (${automod.timeout_minutes} dk)`);
    }
  };

  // Blocked words check (classic server list + AutoMod list)
  if (!params.isPrivileged && text.length > 0) {
    const combinedRaw = [
      server.blocked_words,
      automod?.enabled === 1 && automod.block_bad_words === 1 ? automod.bad_words : '',
    ]
      .filter(Boolean)
      .join(',');
    if (combinedRaw.trim()) {
      const words = combinedRaw
        .split(',')
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);
      const lower = text.toLowerCase();
      for (const w of words) {
        if (lower.includes(w)) {
          applyAutoTimeout('Yasaklı kelime');
          return { allowed: false, reason: 'Mesajınız sunucunun yasaklı kelime (AutoMod) kuralını ihlal ediyor.' };
        }
      }
    }
  }

  // Invite link blocking via AutoMod
  if (automod?.enabled === 1 && automod.block_invites === 1 && !params.isPrivileged) {
    if (/(?:discord\.gg|discord\.com\/invite|\/invite\/[A-Za-z0-9_-]{4,})/i.test(text)) {
      applyAutoTimeout('Davet bağlantısı engellendi');
      return { allowed: false, reason: 'AutoMod kuralı gereği davet bağlantısı paylaşımı engellendi.' };
    }
  }

  // Max mentions cap via AutoMod
  if (automod?.enabled === 1 && automod.max_mentions > 0 && !params.isPrivileged) {
    const mentionCount = (text.match(/@[a-zA-Z0-9_.-]{2,32}/g) || []).length;
    if (mentionCount > automod.max_mentions) {
      applyAutoTimeout('Aşırı etiketleme');
      return {
        allowed: false,
        reason: `AutoMod kuralı: Tek mesajda en fazla ${automod.max_mentions} kullanıcı etiketlenebilir.`,
      };
    }
  }

  // Suspicious/blocked links check
  if ((server.block_links === 1 || server.moderation_level === 'high') && !params.isPrivileged) {
    if (/https?:\/\/[^\s]+/i.test(text)) {
      return { allowed: false, reason: 'Bu sunucuda bağlantı paylaşımı moderasyon kuralları gereği kısıtlanmıştır.' };
    }
  }

  // Anti-spam burst + duplicate + slowmode check
  if (text.length > 0 && !params.isPrivileged) {
    const recent = db
      .prepare(
        `SELECT content, created_at FROM messages
         WHERE channel_id = ? AND author_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(params.channelId, params.userId) as { content: string; created_at: string } | undefined;

    if (recent) {
      const elapsedSec = (Date.now() - parseUtcMs(recent.created_at)) / 1000;
      if (server.slowmode_seconds > 0 && elapsedSec < server.slowmode_seconds) {
        const wait = Math.ceil(server.slowmode_seconds - elapsedSec);
        return { allowed: false, reason: `Yavaş mod aktif. Lütfen ${wait} saniye bekleyin.` };
      }
      if (recent.content.trim() === text && elapsedSec < 12) {
        return { allowed: false, reason: 'Aynı mesajı art arda tekrarlayamazsınız.' };
      }
    }

    if (automod?.enabled === 1 && automod.anti_spam === 1) {
      const tenSecAgo = new Date(Date.now() - 10_000).toISOString().replace('T', ' ').slice(0, 19);
      const burst = db
        .prepare(
          `SELECT COUNT(*) as cnt FROM messages
           WHERE channel_id = ? AND author_id = ? AND deleted_at IS NULL AND created_at >= ?`
        )
        .get(params.channelId, params.userId, tenSecAgo) as { cnt: number };
      if (burst.cnt >= 5) {
        applyAutoTimeout('Spam koruması');
        return { allowed: false, reason: 'AutoMod spam koruması tetiklendi. Lütfen biraz bekleyin.' };
      }
    }
  }

  return { allowed: true };
}

export function sendWelcomeMessageIfEnabled(
  db: Database.Database,
  hub: OrbitRealtimeHub,
  serverId: string,
  joinedUserId: string
): void {
  const rule = db
    .prepare(`SELECT welcome_enabled, welcome_channel_id, welcome_message FROM server_automod_rules WHERE server_id = ?`)
    .get(serverId) as
    | { welcome_enabled: number; welcome_channel_id: string | null; welcome_message: string }
    | undefined;

  if (!rule || rule.welcome_enabled !== 1) return;

  let targetChannelId = rule.welcome_channel_id;
  if (!targetChannelId) {
    const firstText = db
      .prepare(`SELECT id FROM channels WHERE server_id = ? AND type = 'text' ORDER BY position ASC LIMIT 1`)
      .get(serverId) as { id: string } | undefined;
    targetChannelId = firstText?.id || null;
  }
  if (!targetChannelId) return;

  const srv = db.prepare(`SELECT name, owner_id FROM servers WHERE id = ?`).get(serverId) as
    | { name: string; owner_id: string }
    | undefined;
  const userProfile = db.prepare(`SELECT username, display_name FROM profiles WHERE user_id = ?`).get(joinedUserId) as
    | { username: string; display_name: string }
    | undefined;
  if (!srv || !userProfile) return;

  const content = (rule.welcome_message || 'Hoş geldin {user}! {server} topluluğuna katıldın.')
    .replace(/\{user\}/g, `@${userProfile.username}`)
    .replace(/\{displayName\}/g, userProfile.display_name)
    .replace(/\{server\}/g, srv.name)
    .slice(0, 1000);

  const msgId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO messages (id, channel_id, author_id, content, webhook_name)
     VALUES (?, ?, ?, ?, 'ORBIT Karşılama')`
  ).run(msgId, targetChannelId, srv.owner_id, content);

  const hydrated = hydrateChannelMessage(db, msgId, srv.owner_id, hub.isUserOnline);
  if (hydrated) {
    hub.sendToRoom(`channel:${targetChannelId}`, {
      type: 'message:new',
      payload: { channelId: targetChannelId, serverId, message: hydrated },
    });
  }
}
