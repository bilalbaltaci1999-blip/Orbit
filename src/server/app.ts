import crypto from 'node:crypto';
import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { getDb } from '../db/database.ts';
import { createNotification, hydrateChannelMessage, hydrateDirectMessage } from './helpers.ts';
import { canSendInChannel } from './permissions.ts';
import { OrbitRealtimeHub } from './ws.ts';
import { createAuthRoutes } from './routes/authRoutes.ts';
import { createSocialRoutes } from './routes/socialRoutes.ts';
import { createServerRoutes } from './routes/serverRoutes.ts';
import { createMessageRoutes } from './routes/messageRoutes.ts';
import { createProRoutes } from './routes/proRoutes.ts';
import { createNitroAndBotRoutes, createStripeWebhookHandler } from './routes/nitroRoutes.ts';

export interface OrbitServerContext {
  app: express.Express;
  httpServer: http.Server;
  db: Database.Database;
  hub: OrbitRealtimeHub;
}

export function processDueSchedulesAndReminders(db: Database.Database, hub: OrbitRealtimeHub): void {
  try {
    // 1. Due scheduled messages
    const dueMessages = db
      .prepare(
        `SELECT * FROM scheduled_messages
         WHERE status = 'pending' AND send_at <= datetime('now')
         ORDER BY send_at ASC LIMIT 25`
      )
      .all() as Array<{
      id: string;
      user_id: string;
      channel_id: string | null;
      conversation_id: string | null;
      content: string;
    }>;

    for (const item of dueMessages) {
      if (item.channel_id) {
        const perm = canSendInChannel(db, item.channel_id, item.user_id);
        if (!perm.allowed) {
          db.prepare(`UPDATE scheduled_messages SET status = 'failed' WHERE id = ?`).run(item.id);
          continue;
        }
        const msgId = crypto.randomUUID();
        db.prepare(`INSERT INTO messages (id, channel_id, author_id, content) VALUES (?, ?, ?, ?)`).run(
          msgId,
          item.channel_id,
          item.user_id,
          item.content
        );
        db.prepare(`UPDATE scheduled_messages SET status = 'sent', sent_at = datetime('now') WHERE id = ?`).run(item.id);
        const msg = hydrateChannelMessage(db, msgId, item.user_id, hub.isUserOnline);
        if (msg) {
          hub.sendToRoom(`channel:${item.channel_id}`, {
            type: 'message:new',
            payload: { channelId: item.channel_id, message: msg },
          });
        }
      } else if (item.conversation_id) {
        const isMember = db
          .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
          .get(item.conversation_id, item.user_id);
        if (!isMember) {
          db.prepare(`UPDATE scheduled_messages SET status = 'failed' WHERE id = ?`).run(item.id);
          continue;
        }
        const dmId = crypto.randomUUID();
        db.prepare(`INSERT INTO direct_messages (id, conversation_id, author_id, content) VALUES (?, ?, ?, ?)`).run(
          dmId,
          item.conversation_id,
          item.user_id,
          item.content
        );
        db.prepare(`UPDATE direct_conversations SET updated_at = datetime('now') WHERE id = ?`).run(item.conversation_id);
        db.prepare(`UPDATE scheduled_messages SET status = 'sent', sent_at = datetime('now') WHERE id = ?`).run(item.id);
        const dmMsg = hydrateDirectMessage(db, dmId, item.user_id, hub.isUserOnline);
        if (dmMsg) {
          hub.sendToRoom(`dm:${item.conversation_id}`, {
            type: 'dm:new',
            payload: { conversationId: item.conversation_id, message: dmMsg },
          });
        }
      }
    }

    // 2. Due message reminders
    const dueReminders = db
      .prepare(
        `SELECT * FROM message_reminders
         WHERE notified = 0 AND remind_at <= datetime('now')
         ORDER BY remind_at ASC LIMIT 25`
      )
      .all() as Array<{
      id: string;
      user_id: string;
      channel_id: string | null;
      conversation_id: string | null;
      note: string;
    }>;

    for (const rem of dueReminders) {
      db.prepare(`UPDATE message_reminders SET notified = 1 WHERE id = ?`).run(rem.id);
      let link: string | null = null;
      if (rem.channel_id) {
        const ch = db.prepare(`SELECT server_id FROM channels WHERE id = ?`).get(rem.channel_id) as
          | { server_id: string }
          | undefined;
        if (ch) link = `/channels/${ch.server_id}/${rem.channel_id}`;
      } else if (rem.conversation_id) {
        link = `/channels/@me/${rem.conversation_id}`;
      }
      createNotification(db, hub, {
        userId: rem.user_id,
        type: 'reminder',
        title: 'Zamanlanmış Hatırlatma',
        body: rem.note,
        link,
      });
    }
  } catch {
    // Ignore transient errors if DB closes during shutdown
  }
}

export function createOrbitServer(customDbPath?: string): OrbitServerContext {
  const db = getDb(customDbPath);
  const app = express();
  const httpServer = http.createServer(app);
  const hub = new OrbitRealtimeHub(httpServer, db);

  app.set('trust proxy', 1);
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), createStripeWebhookHandler(db, hub));
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'ORBIT' });
  });

  app.get('/api/push/config', (_req, res) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY || null;
    const configured = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    res.json({ configured, publicKey });
  });

  app.use('/api', createAuthRoutes(db, hub));
  app.use('/api', createSocialRoutes(db, hub));
  app.use('/api', createServerRoutes(db, hub));
  app.use('/api', createMessageRoutes(db, hub));
  app.use('/api', createProRoutes(db, hub));
  app.use('/api', createNitroAndBotRoutes(db, hub));

  const schedulerTimer = setInterval(() => {
    processDueSchedulesAndReminders(db, hub);
  }, 10_000);
  schedulerTimer.unref();
  httpServer.once('close', () => clearInterval(schedulerTimer));

  // Global error handler (handles multer & unexpected errors cleanly without leaking stack traces)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Beklenmeyen bir sunucu hatası oluştu.';
    const status = message.includes('File too large') ? 413 : 400;
    res.status(status).json({ error: message });
  });

  return { app, httpServer, db, hub };
}
