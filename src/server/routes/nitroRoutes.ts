import crypto from 'node:crypto';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createAuthMiddleware, getProfileByUserId, grantBadge, rateLimit, revokeBadge, type AuthenticatedRequest } from '../auth.ts';
import {
  generateChannelSummary,
  getOfficialBotConfig,
  installOfficialBot,
  OFFICIAL_BOT_ID,
  uninstallOfficialBot,
} from '../bot.ts';
import {
  awardActivityXp,
  getUserAchievementsPayload,
  isUserNitroActive,
} from '../gamification.ts';
import { canViewChannel, hasServerPermission, isServerMember } from '../permissions.ts';
import { DEFAULT_MEMBER_PERMISSIONS } from '../../shared/permissions.ts';
import type { OrbitRealtimeHub } from '../ws.ts';

function getAppBaseUrl(req: import('express').Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

function grantPaidNitro(
  db: Database.Database,
  hub: OrbitRealtimeHub,
  userId: string,
  opts: {
    plan: 'monthly' | 'yearly';
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeSessionId?: string | null;
    amountCents?: number;
    currency?: string;
  }
): void {
  const days = opts.plan === 'yearly' ? 366 : 31;
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE profiles
       SET nitro_tier = 'nitro',
           nitro_expires_at = ?,
           stripe_customer_id = COALESCE(?, stripe_customer_id),
           stripe_subscription_id = COALESCE(?, stripe_subscription_id),
           updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(expiresAt, opts.stripeCustomerId || null, opts.stripeSubscriptionId || null, userId);

    if (opts.stripeSessionId) {
      db.prepare(
        `INSERT OR IGNORE INTO nitro_payments (id, user_id, stripe_session_id, plan, amount_kurus, currency, status)
         VALUES (?, ?, ?, ?, ?, ?, 'paid')`
      ).run(
        crypto.randomUUID(),
        userId,
        opts.stripeSessionId,
        opts.plan,
        opts.amountCents || (opts.plan === 'yearly' ? 99990 : 9990),
        (opts.currency || 'try').toLowerCase()
      );
    }
    grantBadge(db, userId, 'orbit_nitro');
  });
  tx();
  hub.broadcastPresence(userId);
}

function downgradeNitroUser(db: Database.Database, hub: OrbitRealtimeHub, userId: string): void {
  db.prepare(
    `UPDATE profiles
     SET nitro_tier = 'none',
         nitro_expires_at = NULL,
         stripe_subscription_id = NULL,
         profile_effect = 'none',
         banner_preset = CASE WHEN banner_preset IN ('supernova', 'cyber_grid') THEN 'none' ELSE banner_preset END,
         avatar_frame = CASE WHEN avatar_frame IN ('aurora', 'cyber', 'flame_halo', 'stardust_crown') THEN 'orbit' ELSE avatar_frame END,
         updated_at = datetime('now')
     WHERE user_id = ?`
  ).run(userId);
  revokeBadge(db, userId, 'orbit_nitro');
  hub.broadcastPresence(userId);
}

export function verifyStripeWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  webhookSecret: string
): boolean {
  if (!signatureHeader || !webhookSecret) return false;
  const parts = signatureHeader.split(',').map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const v1Signatures = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!timestamp || v1Signatures.length === 0) return false;

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 300) {
    return false;
  }

  const payloadString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  const signedPayload = `${timestamp}.${payloadString}`;
  const expected = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  return v1Signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

export function createStripeWebhookHandler(db: Database.Database, hub: OrbitRealtimeHub) {
  return (req: import('express').Request, res: import('express').Response) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      res.status(503).json({ error: 'STRIPE_WEBHOOK_SECRET yapılandırılmamış.' });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const sigHeader = typeof req.headers['stripe-signature'] === 'string' ? req.headers['stripe-signature'] : undefined;
    if (!verifyStripeWebhookSignature(rawBody, sigHeader, webhookSecret)) {
      res.status(400).json({ error: 'Geçersiz Stripe webhook imzası.' });
      return;
    }

    let event: { type?: string; data?: { object?: Record<string, unknown> } };
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Geçersiz webhook JSON verisi.' });
      return;
    }

    const obj = event.data?.object || {};

    if (event.type === 'checkout.session.completed') {
      const metadata = (obj.metadata as Record<string, string> | undefined) || {};
      const userId = String(obj.client_reference_id || metadata.userId || '').trim();
      const plan = metadata.plan === 'yearly' ? 'yearly' : 'monthly';
      if (userId) {
        const exists = db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(userId);
        if (exists) {
          grantPaidNitro(db, hub, userId, {
            plan,
            stripeCustomerId: typeof obj.customer === 'string' ? obj.customer : null,
            stripeSubscriptionId: typeof obj.subscription === 'string' ? obj.subscription : null,
            stripeSessionId: typeof obj.id === 'string' ? obj.id : null,
            amountCents: typeof obj.amount_total === 'number' ? obj.amount_total : undefined,
            currency: typeof obj.currency === 'string' ? obj.currency : 'try',
          });
        }
      }
    } else if (event.type === 'invoice.payment_succeeded') {
      const subscriptionId = typeof obj.subscription === 'string' ? obj.subscription : '';
      const customerId = typeof obj.customer === 'string' ? obj.customer : '';
      const row = db
        .prepare(
          `SELECT user_id FROM profiles WHERE (stripe_subscription_id = ? AND ? != '') OR (stripe_customer_id = ? AND ? != '') LIMIT 1`
        )
        .get(subscriptionId, subscriptionId, customerId, customerId) as { user_id: string } | undefined;
      if (row) {
        grantPaidNitro(db, hub, row.user_id, {
          plan: 'monthly',
          stripeCustomerId: customerId || null,
          stripeSubscriptionId: subscriptionId || null,
        });
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subscriptionId = typeof obj.id === 'string' ? obj.id : '';
      const customerId = typeof obj.customer === 'string' ? obj.customer : '';
      const row = db
        .prepare(
          `SELECT user_id FROM profiles WHERE (stripe_subscription_id = ? AND ? != '') OR (stripe_customer_id = ? AND ? != '') LIMIT 1`
        )
        .get(subscriptionId, subscriptionId, customerId, customerId) as { user_id: string } | undefined;
      if (row) {
        downgradeNitroUser(db, hub, row.user_id);
      }
    }

    res.json({ received: true });
  };
}

export function createNitroAndBotRoutes(db: Database.Database, hub: OrbitRealtimeHub): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(db);

  // --- ACHIEVEMENTS & 1-7 DAY STREAKS ---
  router.get('/achievements/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json(getUserAchievementsPayload(db, req.userId!));
  });

  router.get('/users/:userId/achievements', requireAuth, (req: AuthenticatedRequest, res) => {
    const targetId = String(req.params.userId);
    const exists = db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(targetId);
    if (!exists) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }
    res.json(getUserAchievementsPayload(db, targetId));
  });

  // --- ORBIT NITRO (PAID SUBSCRIPTION) ---
  router.get('/nitro/status', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const state = isUserNitroActive(db, userId);
    const boosts = db
      .prepare(`SELECT server_id FROM server_boosts WHERE user_id = ?`)
      .all(userId) as Array<{ server_id: string }>;
    const stripeRow = db
      .prepare(`SELECT stripe_subscription_id FROM profiles WHERE user_id = ?`)
      .get(userId) as { stripe_subscription_id: string | null } | undefined;

    const hasStripeKey = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
    const hasPriceId = Boolean(
      process.env.STRIPE_NITRO_PRICE_ID?.trim() || process.env.STRIPE_NITRO_YEARLY_PRICE_ID?.trim()
    );

    res.json({
      isNitro: state.isNitro,
      nitroTier: state.nitroTier,
      nitroExpiresAt: state.nitroExpiresAt,
      maxUploadMb: state.isNitro ? 50 : 10,
      boostedServerIds: boosts.map((b) => b.server_id),
      stripeConfigured: hasStripeKey,
      priceConfigured: hasStripeKey && hasPriceId,
      monthlyPriceLabel: '₺99,90 / ay',
      yearlyPriceLabel: '₺999,90 / yıl',
      hasActiveStripeSubscription: Boolean(stripeRow?.stripe_subscription_id),
    });
  });

  router.post('/nitro/activate', requireAuth, (_req: AuthenticatedRequest, res) => {
    res.status(402).json({
      error: 'ORBIT Nitro ücretli bir aboneliktir. Lütfen Stripe Checkout üzerinden ödeme yapın.',
      requiresPayment: true,
    });
  });

  router.post('/nitro/checkout', requireAuth, async (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const plan = req.body?.plan === 'yearly' ? 'yearly' : 'monthly';
    const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
    const priceId =
      plan === 'yearly'
        ? process.env.STRIPE_NITRO_YEARLY_PRICE_ID?.trim() || process.env.STRIPE_NITRO_PRICE_ID?.trim()
        : process.env.STRIPE_NITRO_PRICE_ID?.trim();

    const missingEnvVars: string[] = [];
    if (!stripeKey) missingEnvVars.push('STRIPE_SECRET_KEY');
    if (!priceId) {
      missingEnvVars.push(plan === 'yearly' ? 'STRIPE_NITRO_YEARLY_PRICE_ID' : 'STRIPE_NITRO_PRICE_ID');
    }

    if (missingEnvVars.length > 0 || !stripeKey || !priceId) {
      res.status(503).json({
        error:
          'Ödeme sistemi (Stripe) yapılandırması henüz tamamlanmamış. Yönetici .env dosyasına gerekli Stripe anahtarlarını eklemelidir.',
        missingEnvVars,
      });
      return;
    }

    const userRow = db
      .prepare(`SELECT u.email, p.stripe_customer_id FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`)
      .get(userId) as { email: string; stripe_customer_id: string | null } | undefined;

    const baseUrl = getAppBaseUrl(req);
    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: userId,
      'metadata[userId]': userId,
      'metadata[plan]': plan,
      success_url: `${baseUrl}/channels/@me?nitro=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/channels/@me?nitro=cancelled`,
    });

    if (userRow?.stripe_customer_id) {
      params.set('customer', userRow.stripe_customer_id);
    } else if (userRow?.email) {
      params.set('customer_email', userRow.email);
    }

    try {
      const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      const payload = (await stripeRes.json()) as { id?: string; url?: string; error?: { message?: string } };
      if (!stripeRes.ok || !payload.url) {
        res.status(502).json({
          error: payload.error?.message || 'Stripe ödeme oturumu başlatılamadı.',
        });
        return;
      }

      res.json({ url: payload.url, sessionId: payload.id });
    } catch {
      res.status(502).json({ error: 'Stripe sunucusuna bağlanırken hata oluştu.' });
    }
  });

  router.post('/nitro/verify-session', requireAuth, async (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const sessionId = String(req.body?.sessionId || '').trim();
    const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();

    if (!sessionId) {
      res.status(400).json({ error: 'Ödeme oturumu kimliği eksik.' });
      return;
    }
    if (!stripeKey) {
      res.status(503).json({ error: 'STRIPE_SECRET_KEY yapılandırılmamış.' });
      return;
    }

    try {
      const stripeRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
        {
          headers: { Authorization: `Bearer ${stripeKey}` },
        }
      );
      const session = (await stripeRes.json()) as {
        id?: string;
        payment_status?: string;
        client_reference_id?: string;
        customer?: string;
        subscription?: string;
        amount_total?: number;
        currency?: string;
        metadata?: Record<string, string>;
        error?: { message?: string };
      };

      if (!stripeRes.ok) {
        res.status(400).json({ error: session.error?.message || 'Ödeme oturumu doğrulanamadı.' });
        return;
      }

      const ownerId = session.client_reference_id || session.metadata?.userId;
      if (ownerId !== userId) {
        res.status(403).json({ error: 'Bu ödeme oturumu başka bir kullanıcıya ait.' });
        return;
      }

      if (session.payment_status !== 'paid') {
        res.status(402).json({ error: 'Ödeme henüz tamamlanmamış görünüyor.' });
        return;
      }

      const plan = session.metadata?.plan === 'yearly' ? 'yearly' : 'monthly';
      grantPaidNitro(db, hub, userId, {
        plan,
        stripeCustomerId: session.customer || null,
        stripeSubscriptionId: session.subscription || null,
        stripeSessionId: session.id || sessionId,
        amountCents: session.amount_total,
        currency: session.currency,
      });

      const profile = getProfileByUserId(db, userId, hub.isUserOnline, true);
      res.json({ ok: true, profile });
    } catch {
      res.status(502).json({ error: 'Ödeme durumu Stripe üzerinden doğrulanamadı.' });
    }
  });

  router.post('/nitro/cancel', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    downgradeNitroUser(db, hub, userId);
    const profile = getProfileByUserId(db, userId, hub.isUserOnline, true);
    res.json({ ok: true, profile });
  });

  // Cross-server custom emojis accessible with ORBIT Nitro
  router.get('/nitro/emojis', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const { isNitro } = isUserNitroActive(db, userId);
    if (!isNitro) {
      res.json({ emojis: [] });
      return;
    }
    const rows = db
      .prepare(
        `SELECT se.*, s.name as server_name
         FROM server_emojis se
         JOIN server_members sm ON sm.server_id = se.server_id
         JOIN servers s ON s.id = se.server_id
         WHERE sm.user_id = ?
         ORDER BY s.name ASC, se.name ASC`
      )
      .all(userId) as Array<{
      id: string;
      server_id: string;
      server_name: string;
      name: string;
      url: string;
      created_by: string;
      created_at: string;
    }>;

    res.json({
      emojis: rows.map((r) => ({
        id: r.id,
        serverId: r.server_id,
        serverName: r.server_name,
        name: r.name,
        url: r.url,
        createdBy: r.created_by,
        createdAt: r.created_at,
      })),
    });
  });

  // --- SERVER BOOSTING ---
  router.post('/nitro/boost/:serverId', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const serverId = String(req.params.serverId);

    if (!isServerMember(db, serverId, userId)) {
      res.status(403).json({ error: 'Takviye yapmak için bu sunucunun üyesi olmalısınız.' });
      return;
    }

    const { isNitro } = isUserNitroActive(db, userId);
    if (!isNitro) {
      res.status(403).json({ error: 'Sunucu takviyesi için aktif ORBIT Nitro gereklidir.' });
      return;
    }

    db.prepare(`INSERT OR IGNORE INTO server_boosts (id, server_id, user_id) VALUES (?, ?, ?)`).run(
      crypto.randomUUID(),
      serverId,
      userId
    );

    // Ensure a Discord-style hoisted 🚀 Roket Takviyecisi role exists & assign it
    let boosterRole = db
      .prepare(`SELECT id FROM roles WHERE server_id = ? AND is_booster_role = 1 LIMIT 1`)
      .get(serverId) as { id: string } | undefined;
    if (!boosterRole) {
      const boosterRoleId = crypto.randomUUID();
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO roles (id, server_id, name, color, position, is_default, is_admin, hoist, mentionable, icon, description, is_booster_role)
           VALUES (?, ?, 'Roket Takviyecisi', '#F472B6', 15, 0, 0, 1, 1, '🚀', 'Bu sunucuya ORBIT Nitro Roketi ile takviye sağlayan özel destekçiler.', 1)`
        ).run(boosterRoleId, serverId);
        const permStmt = db.prepare(`INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)`);
        for (const p of DEFAULT_MEMBER_PERMISSIONS) permStmt.run(boosterRoleId, p);
      });
      tx();
      boosterRole = { id: boosterRoleId };
    }
    db.prepare(`INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)`).run(
      serverId,
      userId,
      boosterRole.id
    );

    awardActivityXp(db, userId, 'boost');
    grantBadge(db, userId, 'server_booster');
    hub.broadcastPresence(userId);
    hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
    hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
    const countRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM server_boosts WHERE server_id = ?`)
      .get(serverId) as { cnt: number };

    res.json({ ok: true, boostCount: countRow.cnt, boosterRoleId: boosterRole.id });
  });

  router.delete('/nitro/boost/:serverId', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const serverId = String(req.params.serverId);
    db.prepare(`DELETE FROM server_boosts WHERE server_id = ? AND user_id = ?`).run(serverId, userId);
    const boosterRoles = db
      .prepare(`SELECT id FROM roles WHERE server_id = ? AND is_booster_role = 1`)
      .all(serverId) as { id: string }[];
    for (const r of boosterRoles) {
      db.prepare(`DELETE FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?`).run(
        serverId,
        userId,
        r.id
      );
    }
    hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
    hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
    const countRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM server_boosts WHERE server_id = ?`)
      .get(serverId) as { cnt: number };
    res.json({ ok: true, boostCount: countRow.cnt });
  });

  // --- OFFICIAL VERIFIED ORBIT BOT MANAGEMENT ---
  router.get('/servers/:serverId/bots', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!isServerMember(db, serverId, req.userId!)) {
      res.status(403).json({ error: 'Üye değilsiniz.' });
      return;
    }
    const officialBot = getOfficialBotConfig(db, serverId, hub.isUserOnline);
    const botProfile = getProfileByUserId(db, OFFICIAL_BOT_ID, hub.isUserOnline);
    res.json({ officialBot, botProfile });
  });

  router.post('/servers/:serverId/bots/orbit', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!hasServerPermission(db, serverId, req.userId!, 'MANAGE_SERVER')) {
      res.status(403).json({ error: 'Resmî ORBIT Botunu eklemek için Sunucuyu Yönet izni gereklidir.' });
      return;
    }
    const config = installOfficialBot(db, hub, serverId, req.userId!);
    res.status(201).json({ officialBot: config });
  });

  router.patch('/servers/:serverId/bots/orbit', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!hasServerPermission(db, serverId, req.userId!, 'MANAGE_SERVER')) {
      res.status(403).json({ error: 'Bot ayarlarını değiştirmek için Sunucuyu Yönet izni gereklidir.' });
      return;
    }
    const existing = db
      .prepare(`SELECT * FROM server_bots WHERE server_id = ? AND bot_id = ?`)
      .get(serverId, OFFICIAL_BOT_ID) as
      | { enabled: number; welcome_enabled: number; welcome_channel_id: string | null; ai_enabled: number; prefix: string }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Resmî ORBIT Bot bu sunucuda kurulu değil.' });
      return;
    }

    const enabled = typeof req.body?.enabled === 'boolean' ? (req.body.enabled ? 1 : 0) : existing.enabled;
    const welcomeEnabled =
      typeof req.body?.welcomeEnabled === 'boolean' ? (req.body.welcomeEnabled ? 1 : 0) : existing.welcome_enabled;
    const aiEnabled = typeof req.body?.aiEnabled === 'boolean' ? (req.body.aiEnabled ? 1 : 0) : existing.ai_enabled;
    const welcomeChannelId =
      req.body?.welcomeChannelId !== undefined
        ? req.body.welcomeChannelId
          ? String(req.body.welcomeChannelId)
          : null
        : existing.welcome_channel_id;
    const prefixRaw = typeof req.body?.prefix === 'string' ? req.body.prefix.trim().slice(0, 3) : existing.prefix;
    const prefix = prefixRaw || '/';

    db.prepare(
      `UPDATE server_bots
       SET enabled = ?, welcome_enabled = ?, welcome_channel_id = ?, ai_enabled = ?, prefix = ?
       WHERE server_id = ? AND bot_id = ?`
    ).run(enabled, welcomeEnabled, welcomeChannelId, aiEnabled, prefix, serverId, OFFICIAL_BOT_ID);

    hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
    res.json({ officialBot: getOfficialBotConfig(db, serverId, hub.isUserOnline) });
  });

  router.delete('/servers/:serverId/bots/orbit', requireAuth, (req: AuthenticatedRequest, res) => {
    const serverId = String(req.params.serverId);
    if (!hasServerPermission(db, serverId, req.userId!, 'MANAGE_SERVER')) {
      res.status(403).json({ error: 'Resmî ORBIT Botunu kaldırmak için Sunucuyu Yönet izni gereklidir.' });
      return;
    }
    uninstallOfficialBot(db, hub, serverId);
    res.json({ ok: true });
  });

  // --- AI CHANNEL SUMMARIZATION ---
  router.post(
    '/ai/summarize',
    requireAuth,
    rateLimit('ai-summarize', 6, 60_000),
    async (req: AuthenticatedRequest, res) => {
      const channelId = String(req.body?.channelId || '').trim();
      const limit = Number(req.body?.limit) || 25;
      if (!channelId) {
        res.status(400).json({ error: 'Kanal kimliği gerekli.' });
        return;
      }
      if (!canViewChannel(db, channelId, req.userId!)) {
        res.status(403).json({ error: 'Bu kanalı görüntüleme izniniz yok.' });
        return;
      }
      const result = await generateChannelSummary(db, channelId, limit);
      if (result.ok === false) {
        res.status(result.status).json({ error: result.reason });
        return;
      }
      res.json({ summary: result.summary });
    }
  );

  return router;
}
