import crypto from 'node:crypto';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  ALL_BADGE_KEYS,
  AVATAR_FRAMES,
  BANNER_PRESETS,
  PROFILE_EFFECTS,
  type BadgeKey,
  type BannerPresetKey,
} from '../../shared/badges.ts';
import {
  clearSessionCookie,
  createAuthMiddleware,
  createSession,
  FOUNDER_EMAIL,
  FOUNDER_UNCLAIMED_HASH,
  generateDiscriminator,
  generateOpaqueToken,
  getBadgeStats,
  getProfileByUserId,
  getUserSettings,
  GOOGLE_OAUTH_SENTINEL,
  grantBadge,
  grantOrbitMemberIfEligible,
  hashPassword,
  hashToken,
  parseUtcMs,
  rateLimit,
  revokeBadge,
  setSessionCookie,
  signStateToken,
  verifyPassword,
  verifyStateToken,
  type AuthenticatedRequest,
} from '../auth.ts';
import {
  getUserAchievementsPayload,
  isUserNitroActive,
  recordDailyStreak,
} from '../gamification.ts';
import {
  buildOtpAuthUri,
  createTwoFactorChallengeToken,
  generateBackupCodes,
  generateBase32Secret,
  hashBackupCode,
  verifyTotpCode,
  verifyTwoFactorChallengeToken,
} from '../totp.ts';
import { enforceUserUploadLimit, sanitizeFileName, uploadMiddleware } from '../upload.ts';
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

function renderGooglePopupHtml(payload: Record<string, unknown>, messageText: string, isError = false): string {
  const safePayload = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const safeMsg = messageText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>ORBIT · Google Doğrulama</title>
  <style>
    body { margin:0; font-family: system-ui, -apple-system, sans-serif; background:#0B0B12; color:#F8FAFC; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; text-align:center; }
    .card { background:#151522; border:1px solid #29293D; border-radius:16px; padding:28px; max-width:400px; box-shadow: 0 20px 50px rgba(0,0,0,0.45); }
    .badge { display:inline-block; padding:4px 10px; border-radius:8px; font-size:12px; font-weight:700; margin-bottom:12px; background:${isError ? 'rgba(239,68,68,0.18)' : 'rgba(124,58,237,0.22)'}; color:${isError ? '#FCA5A5' : '#C084FC'}; }
    p { color:#A1A1B5; font-size:14px; line-height:1.5; margin:8px 0 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">ORBIT</div>
    <h2 style="margin:0;font-size:18px;">${isError ? 'Doğrulama Tamamlanamadı' : 'Google Doğrulama Başarılı'}</h2>
    <p>${safeMsg}</p>
  </div>
  <script>
    (function () {
      var data = ${safePayload};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(data, '*');
          setTimeout(function () { window.close(); }, 350);
          return;
        }
      } catch (e) {}
      if (data && data.type === 'ORBIT_GOOGLE_AUTH_SUCCESS' && data.token) {
        try { localStorage.setItem('orbit_session_token', data.token); } catch (e) {}
        setTimeout(function () { window.location.href = '/'; }, 600);
      }
    })();
  </script>
</body>
</html>`;
}

const registerSchema = z.object({
  email: z.string().trim().email('Geçerli bir e-posta adresi girin.').max(180, 'E-posta adresi çok uzun.'),
  username: z
    .string()
    .trim()
    .min(3, 'Kullanıcı adı en az 3 karakter olmalı.')
    .max(24, 'Kullanıcı adı en fazla 24 karakter olmalı.')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Kullanıcı adı yalnızca harf, rakam, _, . ve - içerebilir.'),
  displayName: z
    .string()
    .trim()
    .min(2, 'Görünen ad en az 2 karakter olmalı.')
    .max(40, 'Görünen ad en fazla 40 karakter olmalı.'),
  password: z
    .string()
    .min(8, 'Şifre en az 8 karakter olmalı.')
    .max(128, 'Şifre en fazla 128 karakter olmalı.'),
});

const loginSchema = z.object({
  email: z.string().trim().email('Geçerli bir e-posta adresi girin.'),
  password: z.string().min(1, 'Şifre boş bırakılamaz.'),
});

const activateFounderSchema = z.object({
  email: z.string().trim().email('Geçerli bir e-posta adresi girin.'),
  password: z.string().min(8, 'Şifre en az 8 karakter olmalı.').max(128, 'Şifre en fazla 128 karakter olmalı.'),
  displayName: z.string().trim().min(2, 'Görünen ad en az 2 karakter olmalı.').max(40).optional(),
});

const updateProfileSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Kullanıcı adı en az 3 karakter olmalı.')
    .max(24, 'Kullanıcı adı en fazla 24 karakter olmalı.')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Kullanıcı adı yalnızca harf, rakam, _, . ve - içerebilir.')
    .optional(),
  displayName: z
    .string()
    .trim()
    .min(2, 'Görünen ad en az 2 karakter olmalı.')
    .max(40, 'Görünen ad en fazla 40 karakter olmalı.')
    .optional(),
  bio: z.string().max(300, 'Biyografi en fazla 300 karakter olabilir.').optional(),
  preferredStatus: z.enum(['online', 'idle', 'dnd', 'offline']).optional(),
  customStatus: z.string().max(80, 'Özel durum en fazla 80 karakter olabilir.').optional(),
  bannerColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Geçerli bir renk kodu seçin.').optional(),
  bannerPreset: z
    .enum(['none', 'nebula', 'aurora_wave', 'supernova', 'cyber_grid', 'eclipse'])
    .optional(),
  avatarFrame: z
    .enum([
      'none',
      'orbit',
      'emerald',
      'amber',
      'crimson',
      'violet',
      'aurora',
      'cyber',
      'flame_halo',
      'galaxy_ring',
      'stardust_crown',
    ])
    .optional(),
  profileEffect: z.enum(['none', 'aurora', 'embers', 'stardust', 'nebula_pulse']).optional(),
  pronouns: z.string().trim().max(30, 'Ünvan en fazla 30 karakter olabilir.').optional(),
  websiteUrl: z
    .string()
    .trim()
    .max(180, 'Bağlantı adresi çok uzun.')
    .refine((v) => v === '' || /^https?:\/\//i.test(v), 'Bağlantı http:// veya https:// ile başlamalıdır.')
    .optional(),
  activityType: z.enum(['', 'playing', 'listening', 'coding', 'watching']).optional(),
  activityText: z.string().trim().max(60, 'Aktivite metni en fazla 60 karakter olabilir.').optional(),
  featuredBadge: z
    .enum(ALL_BADGE_KEYS as [BadgeKey, ...BadgeKey[]])
    .nullable()
    .optional(),
});

const updateSettingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).optional(),
  fontSize: z.enum(['sm', 'md', 'lg']).optional(),
  messageDensity: z.enum(['compact', 'cozy']).optional(),
  inAppNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
  dndMode: z.boolean().optional(),
  showOnlineStatus: z.boolean().optional(),
  dmPermission: z.enum(['everyone', 'friends', 'server_members']).optional(),
  friendRequestsAllowed: z.boolean().optional(),
  reducedMotion: z.boolean().optional(),
  keyboardNavHints: z.boolean().optional(),
});

export function createAuthRoutes(db: Database.Database, hub: OrbitRealtimeHub): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(db);

  router.get('/users/check-username', (req, res) => {
    const username = String(req.query.username || '').trim();
    if (username.length < 3) {
      res.json({ available: false, reason: 'En az 3 karakter olmalı.' });
      return;
    }
    const existing = db.prepare(`SELECT 1 FROM profiles WHERE username = ?`).get(username);
    res.json({ available: !existing });
  });

  router.get('/badges/stats', (_req, res) => {
    res.json(getBadgeStats(db));
  });

  router.get('/auth/founder-status', (_req, res) => {
    const row = db
      .prepare(`SELECT password_hash FROM users WHERE lower(email) = ?`)
      .get(FOUNDER_EMAIL) as { password_hash: string } | undefined;
    res.json({
      emailHint: FOUNDER_EMAIL,
      needsActivation: Boolean(row && row.password_hash === FOUNDER_UNCLAIMED_HASH),
    });
  });

  // --- GOOGLE OAUTH (POPUP FLOW) ---
  router.get('/auth/google/status', (_req, res) => {
    const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    res.json({ configured });
  });

  router.get('/auth/google/url', rateLimit('google-url', 20, 60_000), (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      res.status(503).json({
        error:
          'Google ile giriş henüz yapılandırılmadı. Yönetici .env dosyasına GOOGLE_CLIENT_ID ve GOOGLE_CLIENT_SECRET değişkenlerini eklemelidir.',
        missingEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
      });
      return;
    }

    const baseUrl = getAppBaseUrl(req);
    const redirectUri = `${baseUrl}/api/auth/google/callback`;
    const state = signStateToken({
      nonce: generateOpaqueToken(12),
      origin: typeof req.query.origin === 'string' ? req.query.origin.slice(0, 200) : baseUrl,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      access_type: 'online',
    });

    res.json({
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      redirectUri,
    });
  });

  router.get(['/auth/google/callback', '/auth/google/callback/'], async (req, res) => {
    const errParam = typeof req.query.error === 'string' ? req.query.error : '';
    if (errParam) {
      res
        .status(400)
        .send(
          renderGooglePopupHtml(
            { type: 'ORBIT_GOOGLE_AUTH_ERROR', error: 'Google yetkilendirmesi iptal edildi.' },
            'Google yetkilendirmesi iptal edildi veya reddedildi.',
            true
          )
        );
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

    if (!code || !state || !clientId || !clientSecret) {
      res
        .status(400)
        .send(
          renderGooglePopupHtml(
            { type: 'ORBIT_GOOGLE_AUTH_ERROR', error: 'Eksik Google OAuth parametresi veya yapılandırması.' },
            'Google OAuth parametreleri eksik veya sunucu yapılandırması tamamlanmamış.',
            true
          )
        );
      return;
    }

    const verifiedState = verifyStateToken<{ nonce: string; origin?: string }>(state);
    if (!verifiedState) {
      res
        .status(400)
        .send(
          renderGooglePopupHtml(
            { type: 'ORBIT_GOOGLE_AUTH_ERROR', error: 'Güvenlik doğrulaması başarısız veya süresi dolmuş.' },
            'Oturum doğrulama anahtarının süresi doldu. Lütfen tekrar deneyin.',
            true
          )
        );
      return;
    }

    try {
      const baseUrl = getAppBaseUrl(req);
      const redirectUri = `${baseUrl}/api/auth/google/callback`;

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text().catch(() => '');
        res
          .status(401)
          .send(
            renderGooglePopupHtml(
              { type: 'ORBIT_GOOGLE_AUTH_ERROR', error: 'Google token değişimi başarısız oldu.', detail: errText.slice(0, 120) },
              'Google erişim anahtarı alınamadı. Redirect URI ayarlarınızı kontrol edin.',
              true
            )
          );
        return;
      }

      const tokenData = (await tokenRes.json()) as { access_token?: string };
      if (!tokenData.access_token) {
        res
          .status(401)
          .send(
            renderGooglePopupHtml(
              { type: 'ORBIT_GOOGLE_AUTH_ERROR', error: 'Google erişim belirteci eksik.' },
              'Google erişim belirteci döndürmedi.',
              true
            )
          );
        return;
      }

      const userInfoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!userInfoRes.ok) {
        res
          .status(401)
          .send(
            renderGooglePopupHtml(
              { type: 'ORBIT_GOOGLE_AUTH_ERROR', error: 'Google kullanıcı profili alınamadı.' },
              'Google hesap bilgileriniz okunamadı.',
              true
            )
          );
        return;
      }

      const googleUser = (await userInfoRes.json()) as {
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
        picture?: string;
      };

      const googleSub = String(googleUser.sub || '').trim();
      const emailLower = String(googleUser.email || '').trim().toLowerCase();
      if (!googleSub || !emailLower) {
        res
          .status(400)
          .send(
            renderGooglePopupHtml(
              { type: 'ORBIT_GOOGLE_AUTH_ERROR', error: 'Google hesabında doğrulanmış e-posta bulunamadı.' },
              'Google hesabınızdan e-posta bilgisi alınamadı.',
              true
            )
          );
        return;
      }

      let targetUserId: string | null = null;
      const byGoogle = db
        .prepare(`SELECT id FROM users WHERE google_id = ?`)
        .get(googleSub) as { id: string } | undefined;

      if (byGoogle) {
        targetUserId = byGoogle.id;
        db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(targetUserId);
      } else {
        const byEmail = db
          .prepare(`SELECT id, password_hash FROM users WHERE lower(email) = ?`)
          .get(emailLower) as { id: string; password_hash: string } | undefined;

        if (byEmail) {
          targetUserId = byEmail.id;
          const nextHash =
            byEmail.password_hash === FOUNDER_UNCLAIMED_HASH ? GOOGLE_OAUTH_SENTINEL : byEmail.password_hash;
          const tx = db.transaction(() => {
            db.prepare(
              `UPDATE users SET google_id = ?, password_hash = ?, email_verified = 1, verification_token = NULL WHERE id = ?`
            ).run(googleSub, nextHash, byEmail.id);
            if (emailLower === FOUNDER_EMAIL) {
              grantBadge(db, byEmail.id, 'platform_founder');
              grantBadge(db, byEmail.id, 'orbit_staff');
              grantBadge(db, byEmail.id, 'orbit_partner');
              grantBadge(db, byEmail.id, 'orbit_moderator');
              grantBadge(db, byEmail.id, 'verified_account');
              grantBadge(db, byEmail.id, 'early_pioneer');
              grantBadge(db, byEmail.id, 'community_founder');
              db.prepare(`UPDATE profiles SET discriminator = '0001' WHERE user_id = ?`).run(byEmail.id);
            } else if (googleUser.email_verified) {
              grantBadge(db, byEmail.id, 'verified_account');
            }
          });
          tx();
        } else {
          const newUserId = crypto.randomUUID();
          const isFounderEmail = emailLower === FOUNDER_EMAIL;
          const discriminator = generateDiscriminator(db, isFounderEmail);
          const rawHandle = (emailLower.split('@')[0] || 'orbit_user')
            .replace(/[^a-zA-Z0-9_.-]/g, '')
            .slice(0, 18);
          let username = rawHandle.length >= 3 ? rawHandle : `orbit_${crypto.randomInt(1000, 9999)}`;
          const conflict = db.prepare(`SELECT 1 FROM profiles WHERE username = ?`).get(username);
          if (conflict) {
            username = `${username.slice(0, 18)}_${crypto.randomInt(100, 999)}`;
          }
          const displayName = (googleUser.name || username).trim().slice(0, 40) || username;
          const avatarUrl =
            googleUser.picture && /^https:\/\//i.test(googleUser.picture) ? googleUser.picture : null;

          const tx = db.transaction(() => {
            db.prepare(
              `INSERT INTO users (id, email, password_hash, email_verified, google_id)
               VALUES (?, ?, ?, 1, ?)`
            ).run(newUserId, emailLower, GOOGLE_OAUTH_SENTINEL, googleSub);

            db.prepare(
              `INSERT INTO profiles (user_id, username, discriminator, display_name, avatar_url, banner_color)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).run(newUserId, username, discriminator, displayName, avatarUrl, isFounderEmail ? '#D97706' : '#4F46E5');

            db.prepare(`INSERT INTO user_settings (user_id) VALUES (?)`).run(newUserId);
            grantBadge(db, newUserId, 'early_pioneer');
            if (googleUser.email_verified) {
              grantBadge(db, newUserId, 'verified_account');
            }
            grantOrbitMemberIfEligible(db, newUserId);
            if (isFounderEmail) {
              grantBadge(db, newUserId, 'platform_founder');
              grantBadge(db, newUserId, 'orbit_staff');
              grantBadge(db, newUserId, 'orbit_partner');
              grantBadge(db, newUserId, 'orbit_moderator');
              grantBadge(db, newUserId, 'verified_account');
            }
          });
          tx();
          targetUserId = newUserId;
        }
      }

      if (!targetUserId) {
        res
          .status(500)
          .send(
            renderGooglePopupHtml(
              { type: 'ORBIT_GOOGLE_AUTH_ERROR', error: 'Kullanıcı hesabı oluşturulamadı.' },
              'Google oturumu açılamadı.',
              true
            )
          );
        return;
      }

      recordDailyStreak(db, targetUserId);
      const sessionToken = createSession(db, targetUserId, req.headers['user-agent'] || '');
      setSessionCookie(res, sessionToken, req);

      res.send(
        renderGooglePopupHtml(
          { type: 'ORBIT_GOOGLE_AUTH_SUCCESS', token: sessionToken },
          'Giriş tamamlandı! Bu pencere otomatik olarak kapanacaktır.'
        )
      );
    } catch {
      res
        .status(500)
        .send(
          renderGooglePopupHtml(
            { type: 'ORBIT_GOOGLE_AUTH_ERROR', error: 'Google ile bağlantı sırasında sunucu hatası oluştu.' },
            'Google sunucularıyla iletişim kurulurken beklenmeyen bir hata oluştu.',
            true
          )
        );
    }
  });

  router.post('/auth/activate-founder', rateLimit('auth-founder', 10, 60_000), (req, res) => {
    const parsed = activateFounderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Geçersiz aktivasyon bilgisi.' });
      return;
    }

    const emailLower = parsed.data.email.toLowerCase();
    if (emailLower !== FOUNDER_EMAIL) {
      res.status(403).json({ error: 'Bu işlem yalnızca yetkili kurucu e-postası için geçerlidir.' });
      return;
    }

    const founder = db
      .prepare(`SELECT id, password_hash FROM users WHERE lower(email) = ?`)
      .get(FOUNDER_EMAIL) as { id: string; password_hash: string } | undefined;

    if (!founder) {
      res.status(404).json({ error: 'Kurucu hesabı bulunamadı.' });
      return;
    }

    if (founder.password_hash !== FOUNDER_UNCLAIMED_HASH) {
      res.status(409).json({ error: 'Kurucu hesabı zaten aktif edilmiş. Lütfen şifrenizle giriş yapın.' });
      return;
    }

    const passwordHash = hashPassword(parsed.data.password);
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE users SET password_hash = ?, email_verified = 1, verification_token = NULL WHERE id = ?`
      ).run(passwordHash, founder.id);
      if (parsed.data.displayName) {
        db.prepare(`UPDATE profiles SET display_name = ? WHERE user_id = ?`).run(
          parsed.data.displayName,
          founder.id
        );
      }
      grantBadge(db, founder.id, 'platform_founder');
      grantBadge(db, founder.id, 'orbit_staff');
      grantBadge(db, founder.id, 'orbit_partner');
      grantBadge(db, founder.id, 'orbit_moderator');
      grantBadge(db, founder.id, 'verified_account');
      grantBadge(db, founder.id, 'early_pioneer');
      grantBadge(db, founder.id, 'community_founder');
      grantOrbitMemberIfEligible(db, founder.id);
      db.prepare(`UPDATE profiles SET discriminator = '0001' WHERE user_id = ?`).run(founder.id);
    });
    tx();

    recordDailyStreak(db, founder.id);
    const sessionToken = createSession(db, founder.id, req.headers['user-agent'] || '');
    setSessionCookie(res, sessionToken, req);

    const profile = getProfileByUserId(db, founder.id, hub.isUserOnline, true);
    const settings = getUserSettings(db, founder.id);
    res.json({ token: sessionToken, profile, settings });
  });

  router.post('/auth/register', rateLimit('auth-register', 10, 60_000), (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Geçersiz kayıt bilgisi.' });
      return;
    }

    const { email, username, displayName, password } = parsed.data;
    const emailLower = email.toLowerCase();
    const existingEmail = db
      .prepare(`SELECT id, password_hash FROM users WHERE lower(email) = ?`)
      .get(emailLower) as { id: string; password_hash: string } | undefined;

    if (existingEmail) {
      // Allow claiming the pre-created unclaimed founder account directly via Register
      if (emailLower === FOUNDER_EMAIL && existingEmail.password_hash === FOUNDER_UNCLAIMED_HASH) {
        const conflictUsername = db
          .prepare(`SELECT 1 FROM profiles WHERE username = ? AND user_id != ?`)
          .get(username, existingEmail.id);
        if (conflictUsername) {
          res.status(409).json({ error: 'Bu kullanıcı adı başka bir üyede kayıtlı.' });
          return;
        }
        const passwordHash = hashPassword(password);
        const tx = db.transaction(() => {
          db.prepare(
            `UPDATE users SET password_hash = ?, email_verified = 1, verification_token = NULL WHERE id = ?`
          ).run(passwordHash, existingEmail.id);
          db.prepare(`UPDATE profiles SET username = ?, display_name = ? WHERE user_id = ?`).run(
            username,
            displayName,
            existingEmail.id
          );
          grantBadge(db, existingEmail.id, 'platform_founder');
          grantBadge(db, existingEmail.id, 'verified_account');
          grantBadge(db, existingEmail.id, 'early_pioneer');
          grantOrbitMemberIfEligible(db, existingEmail.id);
        });
        tx();

        recordDailyStreak(db, existingEmail.id);
        const sessionToken = createSession(db, existingEmail.id, req.headers['user-agent'] || '');
        setSessionCookie(res, sessionToken, req);
        const profile = getProfileByUserId(db, existingEmail.id, hub.isUserOnline, true);
        const settings = getUserSettings(db, existingEmail.id);
        res.status(201).json({ token: sessionToken, profile, settings, verificationToken: null, smtpConfigured: false });
        return;
      }

      res.status(409).json({ error: 'Bu e-posta adresi zaten kayıtlı. Giriş yapmayı deneyin.' });
      return;
    }

    const existingUsername = db.prepare(`SELECT 1 FROM profiles WHERE username = ?`).get(username);
    if (existingUsername) {
      res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış. Farklı bir kullanıcı adı seçin.' });
      return;
    }

    const userId = crypto.randomUUID();
    const passwordHash = hashPassword(password);
    const isFounderEmail = emailLower === FOUNDER_EMAIL;
    const verificationToken = isFounderEmail ? null : generateOpaqueToken(16);
    const discriminator = generateDiscriminator(db, isFounderEmail);

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, email_verified, verification_token)
         VALUES (?, ?, ?, ?, ?)`
      ).run(userId, emailLower, passwordHash, isFounderEmail ? 1 : 0, verificationToken);

      db.prepare(
        `INSERT INTO profiles (user_id, username, discriminator, display_name, banner_color)
         VALUES (?, ?, ?, ?, ?)`
      ).run(userId, username, discriminator, displayName, isFounderEmail ? '#D97706' : '#4F46E5');

      db.prepare(`INSERT INTO user_settings (user_id) VALUES (?)`).run(userId);
      grantBadge(db, userId, 'early_pioneer');
      grantOrbitMemberIfEligible(db, userId);
      if (isFounderEmail) {
        grantBadge(db, userId, 'platform_founder');
        grantBadge(db, userId, 'orbit_staff');
        grantBadge(db, userId, 'orbit_partner');
        grantBadge(db, userId, 'orbit_moderator');
        grantBadge(db, userId, 'verified_account');
      }
    });
    tx();

    recordDailyStreak(db, userId);
    const sessionToken = createSession(db, userId, req.headers['user-agent'] || '');
    setSessionCookie(res, sessionToken, req);

    const profile = getProfileByUserId(db, userId, hub.isUserOnline, true);
    const settings = getUserSettings(db, userId);

    res.status(201).json({
      token: sessionToken,
      profile,
      settings,
      verificationToken,
      smtpConfigured: false,
    });
  });

  router.post('/auth/login', rateLimit('auth-login', 15, 60_000), (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Geçersiz giriş bilgisi.' });
      return;
    }

    const { email, password } = parsed.data;
    const user = db
      .prepare(
        `SELECT id, password_hash, COALESCE(two_factor_enabled, 0) as two_factor_enabled, two_factor_secret
         FROM users WHERE lower(email) = ?`
      )
      .get(email.toLowerCase()) as
      | { id: string; password_hash: string; two_factor_enabled: number; two_factor_secret: string | null }
      | undefined;

    if (user && user.password_hash === FOUNDER_UNCLAIMED_HASH) {
      res.status(409).json({
        error: 'Kurucu hesabınız hazır! İlk giriş için şifrenizi belirleyin.',
        needsFounderActivation: true,
      });
      return;
    }

    if (user && user.password_hash === GOOGLE_OAUTH_SENTINEL) {
      res.status(401).json({
        error: 'Bu hesap Google ile bağlı. Lütfen "Google ile Devam Et" butonunu kullanın veya güvenlik ayarlarından bir şifre belirleyin.',
      });
      return;
    }

    if (!user || user.password_hash === '__BOT_ACCOUNT__' || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'E-posta adresi veya şifre hatalı.' });
      return;
    }

    if (user.two_factor_enabled === 1 && user.two_factor_secret) {
      res.json({
        requiresTwoFactor: true,
        challengeToken: createTwoFactorChallengeToken(user.id),
      });
      return;
    }

    recordDailyStreak(db, user.id);
    const sessionToken = createSession(db, user.id, req.headers['user-agent'] || '');
    setSessionCookie(res, sessionToken, req);

    const profile = getProfileByUserId(db, user.id, hub.isUserOnline, true);
    const settings = getUserSettings(db, user.id);

    res.json({ token: sessionToken, profile, settings });
  });

  router.post('/auth/login/2fa', rateLimit('auth-login-2fa', 15, 60_000), (req, res) => {
    const challengeToken = String(req.body?.challengeToken || '').trim();
    const code = String(req.body?.code || '').trim();
    const userId = verifyTwoFactorChallengeToken(challengeToken);
    if (!userId) {
      res.status(401).json({ error: 'İki adımlı doğrulama oturumunun süresi dolmuş. Lütfen tekrar giriş yapın.' });
      return;
    }

    const user = db
      .prepare(`SELECT two_factor_enabled, two_factor_secret, two_factor_backup_codes_json FROM users WHERE id = ?`)
      .get(userId) as
      | { two_factor_enabled: number; two_factor_secret: string | null; two_factor_backup_codes_json: string | null }
      | undefined;

    if (!user || user.two_factor_enabled !== 1 || !user.two_factor_secret) {
      res.status(400).json({ error: 'Bu hesap için iki adımlı doğrulama etkin değil.' });
      return;
    }

    let verified = verifyTotpCode(user.two_factor_secret, code);
    if (!verified && user.two_factor_backup_codes_json) {
      try {
        const storedHashes = JSON.parse(user.two_factor_backup_codes_json) as string[];
        const candHash = hashBackupCode(code);
        const matchIdx = storedHashes.findIndex((h) => h === candHash);
        if (matchIdx !== -1) {
          verified = true;
          storedHashes.splice(matchIdx, 1);
          db.prepare(`UPDATE users SET two_factor_backup_codes_json = ? WHERE id = ?`).run(
            JSON.stringify(storedHashes),
            userId
          );
        }
      } catch {
        verified = false;
      }
    }

    if (!verified) {
      res.status(401).json({ error: 'Doğrulama kodu veya yedek kurtarma kodu hatalı.' });
      return;
    }

    recordDailyStreak(db, userId);
    const sessionToken = createSession(db, userId, req.headers['user-agent'] || '');
    setSessionCookie(res, sessionToken, req);

    const profile = getProfileByUserId(db, userId, hub.isUserOnline, true);
    const settings = getUserSettings(db, userId);
    res.json({ token: sessionToken, profile, settings });
  });

  router.post('/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    if (req.sessionToken) {
      db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(req.sessionToken));
    }
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });

  router.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    recordDailyStreak(db, userId);
    const profile = getProfileByUserId(db, userId, hub.isUserOnline, true);
    if (!profile) {
      res.status(404).json({ error: 'Kullanıcı profili bulunamadı.' });
      return;
    }
    const settings = getUserSettings(db, userId);
    const userRow = db
      .prepare(`SELECT verification_token, email_verified, pending_email FROM users WHERE id = ?`)
      .get(userId) as
      | { verification_token: string | null; email_verified: number; pending_email: string | null }
      | undefined;

    res.json({
      profile,
      settings,
      pendingVerificationToken: userRow?.email_verified === 0 ? userRow.verification_token : null,
      pendingEmailChange: userRow?.pending_email || null,
    });
  });

  router.post('/auth/verify-email', rateLimit('verify-email', 10, 60_000), (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      res.status(400).json({ error: 'Doğrulama kodu gerekli.' });
      return;
    }
    const user = db
      .prepare(`SELECT id FROM users WHERE verification_token = ?`)
      .get(token) as { id: string } | undefined;
    if (!user) {
      res.status(400).json({ error: 'Doğrulama kodu geçersiz veya süresi dolmuş.' });
      return;
    }
    db.prepare(`UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?`).run(user.id);
    grantBadge(db, user.id, 'verified_account');
    res.json({ ok: true });
  });

  router.post('/auth/resend-verification', requireAuth, rateLimit('resend-verify', 5, 60_000), (req: AuthenticatedRequest, res) => {
    const token = generateOpaqueToken(16);
    db.prepare(`UPDATE users SET verification_token = ? WHERE id = ? AND email_verified = 0`).run(
      token,
      req.userId!
    );
    res.json({ verificationToken: token, smtpConfigured: false });
  });

  router.get('/auth/sessions', requireAuth, (req: AuthenticatedRequest, res) => {
    const currentHash = req.sessionToken ? hashToken(req.sessionToken) : '';
    const rows = db
      .prepare(
        `SELECT id, token_hash, user_agent, created_at, expires_at
         FROM sessions
         WHERE user_id = ?
         ORDER BY created_at DESC`
      )
      .all(req.userId!) as Array<{
      id: string;
      token_hash: string;
      user_agent: string;
      created_at: string;
      expires_at: string;
    }>;

    const now = Date.now();
    const sessions = rows
      .filter((r) => parseUtcMs(r.expires_at) > now)
      .map((r) => ({
        id: r.id,
        userAgent: r.user_agent || 'Bilinmeyen Cihaz',
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        isCurrent: r.token_hash === currentHash,
      }));

    res.json({ sessions });
  });

  router.delete('/auth/sessions/:sessionId', requireAuth, (req: AuthenticatedRequest, res) => {
    const sessionId = String(req.params.sessionId);
    const row = db
      .prepare(`SELECT id, token_hash FROM sessions WHERE id = ? AND user_id = ?`)
      .get(sessionId, req.userId!) as { id: string; token_hash: string } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Oturum bulunamadı.' });
      return;
    }
    const currentHash = req.sessionToken ? hashToken(req.sessionToken) : '';
    if (row.token_hash === currentHash) {
      res.status(400).json({ error: 'Aktif mevcut oturumunuzu bu alandan sonlandıramazsınız; çıkış yapmayı kullanın.' });
      return;
    }
    db.prepare(`DELETE FROM sessions WHERE id = ? AND user_id = ?`).run(sessionId, req.userId!);
    res.json({ ok: true });
  });

  router.delete('/auth/sessions', requireAuth, (req: AuthenticatedRequest, res) => {
    const currentHash = req.sessionToken ? hashToken(req.sessionToken) : '';
    const result = db
      .prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`)
      .run(req.userId!, currentHash);
    res.json({ ok: true, revokedCount: result.changes });
  });

  router.post('/auth/change-password', requireAuth, rateLimit('change-pass', 8, 60_000), (req: AuthenticatedRequest, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const revokeOthers = Boolean(req.body?.revokeOthers);

    if (newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({ error: 'Yeni şifreniz en az 8, en fazla 128 karakter olmalıdır.' });
      return;
    }

    const user = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(req.userId!) as
      | { password_hash: string }
      | undefined;
    if (!user) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }

    if (user.password_hash !== GOOGLE_OAUTH_SENTINEL) {
      if (!currentPassword || !verifyPassword(currentPassword, user.password_hash)) {
        res.status(403).json({ error: 'Mevcut şifreniz hatalı.' });
        return;
      }
    }

    const newHash = hashPassword(newPassword);
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(newHash, req.userId!);

    if (revokeOthers && req.sessionToken) {
      const currentHash = hashToken(req.sessionToken);
      db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`).run(req.userId!, currentHash);
    }

    const profile = getProfileByUserId(db, req.userId!, hub.isUserOnline, true);
    res.json({ ok: true, profile });
  });

  // --- TWO-FACTOR AUTHENTICATION (2FA TOTP) ---
  router.post('/auth/2fa/setup', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const user = db
      .prepare(`SELECT email, two_factor_enabled FROM users WHERE id = ?`)
      .get(userId) as { email: string; two_factor_enabled: number } | undefined;
    if (!user) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }
    if (user.two_factor_enabled === 1) {
      res.status(409).json({ error: 'İki adımlı doğrulama zaten etkin.' });
      return;
    }
    const secret = generateBase32Secret(20);
    db.prepare(`UPDATE users SET two_factor_secret = ? WHERE id = ?`).run(secret, userId);
    const otpAuthUri = buildOtpAuthUri(user.email, secret);
    res.json({ secret, otpAuthUri });
  });

  router.post('/auth/2fa/enable', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const code = String(req.body?.code || '').trim();
    const user = db
      .prepare(`SELECT two_factor_secret FROM users WHERE id = ?`)
      .get(userId) as { two_factor_secret: string | null } | undefined;

    if (!user?.two_factor_secret) {
      res.status(400).json({ error: 'Önce 2FA kurulumunu başlatın.' });
      return;
    }
    if (!verifyTotpCode(user.two_factor_secret, code)) {
      res.status(400).json({ error: 'Girilen 6 haneli doğrulama kodu geçersiz.' });
      return;
    }

    const backupCodes = generateBackupCodes(8);
    const hashedCodes = backupCodes.map((c) => hashBackupCode(c));
    db.prepare(
      `UPDATE users SET two_factor_enabled = 1, two_factor_backup_codes_json = ? WHERE id = ?`
    ).run(JSON.stringify(hashedCodes), userId);

    const profile = getProfileByUserId(db, userId, hub.isUserOnline, true);
    res.json({ ok: true, backupCodes, profile });
  });

  router.post('/auth/2fa/disable', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const password = String(req.body?.password || '');
    const code = String(req.body?.code || '').trim();
    const user = db
      .prepare(`SELECT password_hash, two_factor_secret FROM users WHERE id = ?`)
      .get(userId) as { password_hash: string; two_factor_secret: string | null } | undefined;

    if (!user) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }

    if (user.password_hash === GOOGLE_OAUTH_SENTINEL) {
      if (!user.two_factor_secret || !verifyTotpCode(user.two_factor_secret, code || password)) {
        res.status(403).json({ error: '2FA korumasını kapatmak için geçerli doğrulama kodunu girin.' });
        return;
      }
    } else if (!verifyPassword(password, user.password_hash)) {
      res.status(403).json({ error: '2FA korumasını kapatmak için mevcut şifrenizi doğrulayın.' });
      return;
    }

    db.prepare(
      `UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, two_factor_backup_codes_json = NULL WHERE id = ?`
    ).run(userId);
    const profile = getProfileByUserId(db, userId, hub.isUserOnline, true);
    res.json({ ok: true, profile });
  });

  // --- EMAIL CHANGE ---
  router.post('/auth/change-email/request', requireAuth, rateLimit('change-email', 5, 60_000), (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const password = String(req.body?.password || '');
    const newEmailRaw = String(req.body?.newEmail || '').trim().toLowerCase();

    const parsedEmail = z.string().email().max(180).safeParse(newEmailRaw);
    if (!parsedEmail.success) {
      res.status(400).json({ error: 'Geçerli bir yeni e-posta adresi girin.' });
      return;
    }

    const user = db
      .prepare(`SELECT email, password_hash FROM users WHERE id = ?`)
      .get(userId) as { email: string; password_hash: string } | undefined;
    if (!user) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }
    if (user.password_hash === GOOGLE_OAUTH_SENTINEL) {
      res.status(400).json({ error: 'E-posta değişikliği için önce Güvenlik sekmesinden bir hesap şifresi belirleyin.' });
      return;
    }
    if (!verifyPassword(password, user.password_hash)) {
      res.status(403).json({ error: 'Mevcut şifreniz hatalı.' });
      return;
    }
    if (user.email.toLowerCase() === newEmailRaw) {
      res.status(400).json({ error: 'Yeni e-posta adresi mevcut adresinizle aynı olamaz.' });
      return;
    }

    const conflict = db.prepare(`SELECT 1 FROM users WHERE lower(email) = ? AND id != ?`).get(newEmailRaw, userId);
    if (conflict) {
      res.status(409).json({ error: 'Bu e-posta adresi başka bir hesap tarafından kullanılıyor.' });
      return;
    }

    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare(
      `UPDATE users SET pending_email = ?, email_change_code = ?, email_change_expires_at = ? WHERE id = ?`
    ).run(newEmailRaw, code, expiresAt, userId);

    res.json({
      ok: true,
      pendingEmail: newEmailRaw,
      verificationCode: code,
      smtpConfigured: false,
    });
  });

  router.post('/auth/change-email/confirm', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const code = String(req.body?.code || '').trim().toUpperCase();
    const row = db
      .prepare(`SELECT pending_email, email_change_code, email_change_expires_at FROM users WHERE id = ?`)
      .get(userId) as
      | { pending_email: string | null; email_change_code: string | null; email_change_expires_at: string | null }
      | undefined;

    if (!row?.pending_email || !row.email_change_code || row.email_change_code !== code) {
      res.status(400).json({ error: 'Doğrulama kodu geçersiz.' });
      return;
    }
    if (!row.email_change_expires_at || new Date(row.email_change_expires_at).getTime() < Date.now()) {
      res.status(400).json({ error: 'Doğrulama kodunun süresi dolmuş. Lütfen yeni kod talep edin.' });
      return;
    }

    db.prepare(
      `UPDATE users
       SET email = ?, email_verified = 1, pending_email = NULL, email_change_code = NULL, email_change_expires_at = NULL
       WHERE id = ?`
    ).run(row.pending_email, userId);

    const profile = getProfileByUserId(db, userId, hub.isUserOnline, true);
    res.json({ ok: true, profile });
  });

  router.post('/auth/forgot-password', rateLimit('auth-reset', 5, 60_000), (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      res.status(400).json({ error: 'E-posta adresi gerekli.' });
      return;
    }
    const user = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as { id: string } | undefined;
    let resetToken: string | null = null;
    if (user) {
      resetToken = generateOpaqueToken(16);
      const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
      db.prepare(`UPDATE users SET reset_token = ?, reset_expires_at = ? WHERE id = ?`).run(
        resetToken,
        expiresAt,
        user.id
      );
    }
    res.json({
      ok: true,
      message: 'Hesap mevcutsa şifre sıfırlama kodu oluşturuldu.',
      resetToken,
      smtpConfigured: false,
    });
  });

  router.post('/auth/reset-password', (req, res) => {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    if (!token || newPassword.length < 8) {
      res.status(400).json({ error: 'Geçerli kod ve en az 8 karakterlik yeni şifre girin.' });
      return;
    }
    const user = db
      .prepare(`SELECT id, reset_expires_at FROM users WHERE reset_token = ?`)
      .get(token) as { id: string; reset_expires_at: string | null } | undefined;

    if (!user || !user.reset_expires_at || new Date(user.reset_expires_at).getTime() < Date.now()) {
      res.status(400).json({ error: 'Şifre sıfırlama kodu geçersiz veya süresi dolmuş.' });
      return;
    }
    const passwordHash = hashPassword(newPassword);
    db.prepare(
      `UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires_at = NULL WHERE id = ?`
    ).run(passwordHash, user.id);
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id);
    res.json({ ok: true });
  });

  router.post('/badges/assign', requireAuth, (req: AuthenticatedRequest, res) => {
    const actor = getProfileByUserId(db, req.userId!, hub.isUserOnline, true);
    if (!actor?.isFounder) {
      res.status(403).json({ error: 'Yalnızca ORBIT kurucusu kullanıcılara resmi rozet tanımlayabilir.' });
      return;
    }
    const targetUserId = String(req.body?.userId || '').trim();
    const badgeKey = String(req.body?.badgeKey || '').trim() as BadgeKey;
    if (!targetUserId || !ALL_BADGE_KEYS.includes(badgeKey)) {
      res.status(400).json({ error: 'Geçersiz kullanıcı veya rozet anahtarı.' });
      return;
    }
    const targetExists = db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(targetUserId);
    if (!targetExists) {
      res.status(404).json({ error: 'Hedef kullanıcı bulunamadı.' });
      return;
    }
    grantBadge(db, targetUserId, badgeKey);
    hub.broadcastPresence(targetUserId);
    const updated = getProfileByUserId(db, targetUserId, hub.isUserOnline, targetUserId === req.userId);
    res.json({ profile: updated, stats: getBadgeStats(db) });
  });

  router.delete('/badges/assign', requireAuth, (req: AuthenticatedRequest, res) => {
    const actor = getProfileByUserId(db, req.userId!, hub.isUserOnline, true);
    if (!actor?.isFounder) {
      res.status(403).json({ error: 'Yalnızca ORBIT kurucusu rozet kaldırabilir.' });
      return;
    }
    const targetUserId = String(req.body?.userId || '').trim();
    const badgeKey = String(req.body?.badgeKey || '').trim() as BadgeKey;
    if (!targetUserId || !ALL_BADGE_KEYS.includes(badgeKey)) {
      res.status(400).json({ error: 'Geçersiz kullanıcı veya rozet anahtarı.' });
      return;
    }
    if (badgeKey === 'platform_founder' && targetUserId === req.userId) {
      res.status(400).json({ error: 'Kurucu rozeti kendinizden kaldırılamaz.' });
      return;
    }
    revokeBadge(db, targetUserId, badgeKey);
    hub.broadcastPresence(targetUserId);
    const updated = getProfileByUserId(db, targetUserId, hub.isUserOnline, targetUserId === req.userId);
    res.json({ profile: updated, stats: getBadgeStats(db) });
  });

  router.get('/users/search', requireAuth, (req: AuthenticatedRequest, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.json({ users: [] });
      return;
    }
    const cleanTag = q.startsWith('#') ? q.slice(1) : q;
    const rows = db
      .prepare(
        `SELECT user_id FROM profiles
         WHERE user_id != ?
           AND (username LIKE ? OR display_name LIKE ? OR (username || '#' || discriminator) LIKE ? OR discriminator = ?)
         LIMIT 20`
      )
      .all(req.userId!, `%${q}%`, `%${q}%`, `%${q}%`, cleanTag) as { user_id: string }[];

    const users = rows
      .map((r) => getProfileByUserId(db, r.user_id, hub.isUserOnline))
      .filter(Boolean);

    res.json({ users });
  });

  router.get('/users/:userId/profile', requireAuth, (req: AuthenticatedRequest, res) => {
    const targetId = String(req.params.userId);
    const profile = getProfileByUserId(db, targetId, hub.isUserOnline, targetId === req.userId);
    if (!profile) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }

    const isBlockedByMe = Boolean(
      db
        .prepare(`SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?`)
        .get(req.userId!, targetId)
    );
    const hasBlockedMe = Boolean(
      db
        .prepare(`SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?`)
        .get(targetId, req.userId!)
    );

    const mutualServers = db
      .prepare(
        `SELECT s.id, s.name, s.icon_url
         FROM servers s
         JOIN server_members m1 ON m1.server_id = s.id AND m1.user_id = ?
         JOIN server_members m2 ON m2.server_id = s.id AND m2.user_id = ?`
      )
      .all(req.userId!, targetId) as Array<{ id: string; name: string; icon_url: string | null }>;

    res.json({
      profile: {
        ...profile,
        isBlockedByMe,
        hasBlockedMe,
      },
      mutualServers: mutualServers.map((s) => ({
        id: s.id,
        name: s.name,
        iconUrl: s.icon_url,
      })),
    });
  });

  router.patch('/users/me/profile', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Geçersiz profil verisi.' });
      return;
    }

    const userId = req.userId!;
    const data = parsed.data;

    if (data.username) {
      const conflict = db
        .prepare(`SELECT 1 FROM profiles WHERE username = ? AND user_id != ?`)
        .get(data.username, userId);
      if (conflict) {
        res.status(409).json({ error: 'Bu kullanıcı adı başka bir kullanıcı tarafından kullanılıyor.' });
        return;
      }
    }

    const current = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`).get(userId) as {
      username: string;
      display_name: string;
      bio: string;
      preferred_status: string;
      custom_status: string;
      banner_color: string;
      banner_preset: string | null;
      avatar_frame: string;
      profile_effect: string | null;
      pronouns: string;
      website_url: string;
      activity_type: string;
      activity_text: string;
      featured_badge: string | null;
    };

    // Enforce ORBIT Nitro gating for exclusive avatar frames, banner presets & profile effects
    const nitroState = isUserNitroActive(db, userId);
    if (data.avatarFrame) {
      const frameMeta = AVATAR_FRAMES.find((f) => f.key === data.avatarFrame);
      if (frameMeta?.nitroOnly && !nitroState.isNitro) {
        res.status(403).json({ error: 'Bu özel avatar çerçevesi ORBIT Nitro gerektirir.' });
        return;
      }
    }
    if (data.bannerPreset) {
      const presetMeta = BANNER_PRESETS.find((b) => b.key === data.bannerPreset);
      if (presetMeta?.nitroOnly && !nitroState.isNitro) {
        res.status(403).json({ error: 'Bu hareketli banner teması ORBIT Nitro gerektirir.' });
        return;
      }
    }
    if (data.profileEffect && data.profileEffect !== 'none') {
      const effMeta = PROFILE_EFFECTS.find((e) => e.key === data.profileEffect);
      if (effMeta?.nitroOnly && !nitroState.isNitro) {
        res.status(403).json({ error: 'Özel profil efektleri ORBIT Nitro gerektirir.' });
        return;
      }
    }

    let nextFeatured = current.featured_badge;
    if (data.featuredBadge !== undefined) {
      if (data.featuredBadge === null) {
        nextFeatured = null;
      } else {
        const ownsBadge = db
          .prepare(`SELECT 1 FROM user_badges WHERE user_id = ? AND badge_key = ?`)
          .get(userId, data.featuredBadge);
        nextFeatured = ownsBadge ? data.featuredBadge : current.featured_badge;
      }
    }

    db.prepare(
      `UPDATE profiles
       SET username = ?, display_name = ?, bio = ?, preferred_status = ?, custom_status = ?, banner_color = ?, banner_preset = ?,
           avatar_frame = ?, profile_effect = ?, pronouns = ?, website_url = ?, activity_type = ?, activity_text = ?, featured_badge = ?,
           updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(
      data.username ?? current.username,
      data.displayName ?? current.display_name,
      data.bio ?? current.bio,
      data.preferredStatus ?? current.preferred_status,
      data.customStatus ?? current.custom_status,
      data.bannerColor ?? current.banner_color ?? '#4F46E5',
      data.bannerPreset ?? (current.banner_preset as BannerPresetKey) ?? 'none',
      data.avatarFrame ?? current.avatar_frame ?? 'none',
      data.profileEffect ?? current.profile_effect ?? 'none',
      data.pronouns ?? current.pronouns ?? '',
      data.websiteUrl ?? current.website_url ?? '',
      data.activityType ?? current.activity_type ?? '',
      data.activityText ?? current.activity_text ?? '',
      nextFeatured,
      userId
    );

    hub.broadcastPresence(userId);
    const profile = getProfileByUserId(db, userId, hub.isUserOnline, true);
    res.json({ profile });
  });

  router.post(
    '/users/me/avatar',
    requireAuth,
    uploadMiddleware.single('avatar'),
    (req: AuthenticatedRequest, res) => {
      const file = req.file;
      if (!file || !file.mimetype.startsWith('image/')) {
        res.status(400).json({ error: 'Lütfen geçerli bir görsel dosyası seçin.' });
        return;
      }
      const sizeCheck = enforceUserUploadLimit(db, req.userId!, [file]);
      if (sizeCheck.ok === false) {
        res.status(413).json({
          error: `Profil fotoğrafı boyut sınırı (${sizeCheck.maxMb} MB) aşıldı. ORBIT Nitro ile 50 MB’a kadar yükleyebilirsiniz.`,
        });
        return;
      }
      const attachmentId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO message_attachments (id, uploader_id, file_name, mime_type, size_bytes, storage_path)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        attachmentId,
        req.userId!,
        sanitizeFileName(file.originalname),
        file.mimetype.split(';')[0].trim().toLowerCase(),
        file.size,
        file.filename
      );

      const avatarUrl = `/api/files/${attachmentId}`;
      db.prepare(`UPDATE profiles SET avatar_url = ?, updated_at = datetime('now') WHERE user_id = ?`).run(
        avatarUrl,
        req.userId!
      );

      hub.broadcastPresence(req.userId!);
      const profile = getProfileByUserId(db, req.userId!, hub.isUserOnline, true);
      res.json({ profile, avatarUrl });
    }
  );

  router.delete('/users/me/avatar', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare(`UPDATE profiles SET avatar_url = NULL, updated_at = datetime('now') WHERE user_id = ?`).run(req.userId!);
    hub.broadcastPresence(req.userId!);
    const profile = getProfileByUserId(db, req.userId!, hub.isUserOnline, true);
    res.json({ profile });
  });

  router.post(
    '/users/me/banner',
    requireAuth,
    uploadMiddleware.single('banner'),
    (req: AuthenticatedRequest, res) => {
      const file = req.file;
      if (!file || !file.mimetype.startsWith('image/')) {
        res.status(400).json({ error: 'Lütfen geçerli bir görsel dosyası seçin.' });
        return;
      }
      const sizeCheck = enforceUserUploadLimit(db, req.userId!, [file]);
      if (sizeCheck.ok === false) {
        res.status(413).json({
          error: `Banner boyut sınırı (${sizeCheck.maxMb} MB) aşıldı. ORBIT Nitro ile 50 MB’a kadar yükleyebilirsiniz.`,
        });
        return;
      }
      const attachmentId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO message_attachments (id, uploader_id, file_name, mime_type, size_bytes, storage_path)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        attachmentId,
        req.userId!,
        sanitizeFileName(file.originalname),
        file.mimetype.split(';')[0].trim().toLowerCase(),
        file.size,
        file.filename
      );

      const bannerUrl = `/api/files/${attachmentId}`;
      db.prepare(`UPDATE profiles SET banner_url = ?, updated_at = datetime('now') WHERE user_id = ?`).run(
        bannerUrl,
        req.userId!
      );

      hub.broadcastPresence(req.userId!);
      const profile = getProfileByUserId(db, req.userId!, hub.isUserOnline, true);
      res.json({ profile, bannerUrl });
    }
  );

  router.delete('/users/me/banner', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare(`UPDATE profiles SET banner_url = NULL, updated_at = datetime('now') WHERE user_id = ?`).run(req.userId!);
    hub.broadcastPresence(req.userId!);
    const profile = getProfileByUserId(db, req.userId!, hub.isUserOnline, true);
    res.json({ profile });
  });

  router.get('/users/me/export', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const profile = getProfileByUserId(db, userId, hub.isUserOnline, true);
    const settings = getUserSettings(db, userId);
    const achievements = getUserAchievementsPayload(db, userId);
    const servers = db
      .prepare(
        `SELECT s.id, s.name, sm.joined_at
         FROM server_members sm
         JOIN servers s ON s.id = sm.server_id
         WHERE sm.user_id = ?`
      )
      .all(userId);
    const messageCount = (
      db.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE author_id = ?`).get(userId) as { cnt: number }
    ).cnt;

    res.setHeader('Content-Disposition', 'attachment; filename="orbit-hesap-verileri.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      profile,
      settings,
      achievements,
      servers,
      messageCount,
    });
  });

  router.patch('/users/me/settings', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Geçersiz ayar verisi.' });
      return;
    }

    const userId = req.userId!;
    const current = getUserSettings(db, userId);
    const next = { ...current, ...parsed.data };

    db.prepare(
      `UPDATE user_settings SET
        theme = ?, font_size = ?, message_density = ?,
        in_app_notifications = ?, push_notifications = ?, sound_enabled = ?, dnd_mode = ?,
        show_online_status = ?, dm_permission = ?, friend_requests_allowed = ?,
        reduced_motion = ?, keyboard_nav_hints = ?
       WHERE user_id = ?`
    ).run(
      next.theme,
      next.fontSize,
      next.messageDensity,
      next.inAppNotifications ? 1 : 0,
      next.pushNotifications ? 1 : 0,
      next.soundEnabled ? 1 : 0,
      next.dndMode ? 1 : 0,
      next.showOnlineStatus ? 1 : 0,
      next.dmPermission,
      next.friendRequestsAllowed ? 1 : 0,
      next.reducedMotion ? 1 : 0,
      next.keyboardNavHints ? 1 : 0,
      userId
    );

    hub.broadcastPresence(userId);
    res.json({ settings: next });
  });

  router.delete('/users/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const password = String(req.body?.password || '');
    const confirmText = String(req.body?.confirmText || '').trim().toUpperCase();
    const user = db
      .prepare(`SELECT password_hash FROM users WHERE id = ?`)
      .get(req.userId!) as { password_hash: string } | undefined;

    if (!user) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }

    if (user.password_hash === GOOGLE_OAUTH_SENTINEL) {
      if (confirmText !== 'HESABI SIL') {
        res.status(403).json({ error: 'Google ile bağlı hesabı silmek için onay alanına HESABI SIL yazın.' });
        return;
      }
    } else if (!verifyPassword(password, user.password_hash)) {
      res.status(403).json({ error: 'Hesabı silmek için mevcut şifrenizi doğrulayın.' });
      return;
    }

    db.prepare(`DELETE FROM users WHERE id = ?`).run(req.userId!);
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });

  return router;
}
