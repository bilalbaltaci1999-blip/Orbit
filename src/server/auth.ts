import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import {
  BADGE_CATALOG,
  calculateLevelFromXp,
  ORBIT_MEMBER_CAP,
  type ActivityTypeKey,
  type AvatarFrameKey,
  type BadgeKey,
  type BannerPresetKey,
  type OrbitBadge,
  type ProfileEffectKey,
} from '../shared/badges.ts';
import type { BadgeStatEntry, BadgeStatsResponse, PresenceStatus, UserProfile, UserSettings } from '../shared/types.ts';
import { getUserStreakInfo, isUserNitroActive } from './gamification.ts';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  sessionToken?: string;
}

const SESSION_COOKIE_NAME = 'orbit_session';
const SESSION_TTL_DAYS = 14;
export const FOUNDER_EMAIL = 'bilalbaltaci1999@gmail.com';
export const FOUNDER_UNCLAIMED_HASH = '__FOUNDER_UNCLAIMED__';
export const GOOGLE_OAUTH_SENTINEL = '__GOOGLE_OAUTH__';

export function signStateToken(payload: Record<string, unknown>, ttlMs = 10 * 60_000): string {
  const secret = process.env.SESSION_SECRET || 'orbit-dev-fallback-secret-key';
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + ttlMs }),
    'utf-8'
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyStateToken<T extends Record<string, unknown>>(token: string): (T & { exp: number }) | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const secret = process.env.SESSION_SECRET || 'orbit-dev-fallback-secret-key';
  const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as T & { exp: number };
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function hashToken(token: string): string {
  const secret = process.env.SESSION_SECRET || 'orbit-dev-fallback-secret-key';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    if (key) result[key] = val;
  }
  return result;
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }
  return null;
}

export function extractFileTokenFromRequest(req: Request): string | null {
  const headerOrCookie = extractTokenFromRequest(req);
  if (headerOrCookie) return headerOrCookie;
  const queryToken = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
  return queryToken || null;
}

export function createSession(db: Database.Database, userId: string, userAgent = ''): string {
  const rawToken = generateOpaqueToken(32);
  const tokenHash = hashToken(rawToken);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000).toISOString();

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)`
  ).run(id, userId, tokenHash, expiresAt, userAgent.slice(0, 250));

  return rawToken;
}

export function setSessionCookie(res: Response, token: string, req?: Request): void {
  const isProd = process.env.NODE_ENV === 'production';
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = isProd || Boolean(req?.secure) || forwardedProto.includes('https');

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: SESSION_TTL_DAYS * 86400 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response, req?: Request): void {
  const isProd = process.env.NODE_ENV === 'production';
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = isProd || Boolean(req?.secure) || forwardedProto.includes('https');
  res.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
  });
}

export function parseUtcMs(ts?: string | null): number {
  if (!ts) return NaN;
  const trimmed = ts.trim();
  if (!trimmed) return NaN;
  const normalized =
    trimmed.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(trimmed)
      ? trimmed
      : `${trimmed.replace(' ', 'T')}Z`;
  return new Date(normalized).getTime();
}

export function getUserIdBySessionToken(db: Database.Database, rawToken: string): string | null {
  const tokenHash = hashToken(rawToken);
  const row = db
    .prepare(`SELECT user_id, expires_at FROM sessions WHERE token_hash = ?`)
    .get(tokenHash) as { user_id: string; expires_at: string } | undefined;

  if (!row) return null;
  if (parseUtcMs(row.expires_at) <= Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
    return null;
  }
  return row.user_id;
}

export function createAuthMiddleware(db: Database.Database) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = extractTokenFromRequest(req);
    if (!token) {
      res.status(401).json({ error: 'Oturum gerekli. Lütfen giriş yapın.' });
      return;
    }
    const userId = getUserIdBySessionToken(db, token);
    if (!userId) {
      res.status(401).json({ error: 'Oturum geçersiz veya süresi dolmuş.' });
      return;
    }
    req.userId = userId;
    req.sessionToken = token;
    next();
  };
}

const rateBuckets = new Map<string, number[]>();

export function rateLimit(keyPrefix: string, maxRequests: number, windowMs: number) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const identity = req.userId || req.ip || 'anon';
    const key = `${keyPrefix}:${identity}`;
    const now = Date.now();
    const timestamps = (rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (timestamps.length >= maxRequests) {
      res.status(429).json({
        error: 'Çok fazla istek gönderildi. Lütfen birkaç saniye bekleyip tekrar deneyin.',
      });
      return;
    }
    timestamps.push(now);
    rateBuckets.set(key, timestamps);
    next();
  };
}

export type OnlineChecker = (userId: string) => boolean;

export function grantBadge(db: Database.Database, userId: string, badgeKey: BadgeKey): void {
  db.prepare(`INSERT OR IGNORE INTO user_badges (user_id, badge_key) VALUES (?, ?)`).run(userId, badgeKey);
}

export function revokeBadge(db: Database.Database, userId: string, badgeKey: BadgeKey): void {
  db.prepare(`DELETE FROM user_badges WHERE user_id = ? AND badge_key = ?`).run(userId, badgeKey);
  db.prepare(`UPDATE profiles SET featured_badge = NULL WHERE user_id = ? AND featured_badge = ?`).run(userId, badgeKey);
}

export function generateDiscriminator(db: Database.Database, isFounder = false): string {
  if (isFounder) return '0001';
  for (let i = 0; i < 12; i++) {
    const candidate = String(1000 + crypto.randomInt(0, 9000));
    if (candidate === '0001') continue;
    const exists = db.prepare(`SELECT 1 FROM profiles WHERE discriminator = ?`).get(candidate);
    if (!exists) return candidate;
  }
  return String(1000 + crypto.randomInt(0, 9000));
}

export function grantOrbitMemberIfEligible(db: Database.Database, userId: string): boolean {
  const already = db
    .prepare(`SELECT 1 FROM user_badges WHERE user_id = ? AND badge_key = 'orbit_member'`)
    .get(userId);
  if (already) return true;
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM user_badges ub
       LEFT JOIN profiles p ON p.user_id = ub.user_id
       WHERE ub.badge_key = 'orbit_member' AND COALESCE(p.is_bot, 0) = 0`
    )
    .get() as { cnt: number };
  if (row.cnt < ORBIT_MEMBER_CAP) {
    grantBadge(db, userId, 'orbit_member');
    return true;
  }
  return false;
}

export function getBadgeStats(db: Database.Database): BadgeStatsResponse {
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE COALESCE(p.is_bot, 0) = 0`
    )
    .get() as { cnt: number };
  const totalUsers = Math.max(totalRow.cnt, 1);

  const grouped = db
    .prepare(
      `SELECT ub.badge_key, COUNT(*) as cnt
       FROM user_badges ub
       LEFT JOIN profiles p ON p.user_id = ub.user_id
       WHERE COALESCE(p.is_bot, 0) = 0
       GROUP BY ub.badge_key`
    )
    .all() as Array<{ badge_key: BadgeKey; cnt: number }>;

  const countMap = new Map<BadgeKey, number>();
  for (const r of grouped) countMap.set(r.badge_key, r.cnt);

  const badges = {} as Record<BadgeKey, BadgeStatEntry>;
  for (const key of Object.keys(BADGE_CATALOG) as BadgeKey[]) {
    const def = BADGE_CATALOG[key];
    const count = countMap.get(key) || 0;
    badges[key] = {
      key,
      count,
      percentage: totalRow.cnt > 0 ? Math.round((count / totalUsers) * 100) : 0,
      ...(def.cap ? { cap: def.cap } : {}),
    };
  }

  const orbitMemberCount = countMap.get('orbit_member') || 0;
  return {
    totalUsers: totalRow.cnt,
    orbitMemberCap: ORBIT_MEMBER_CAP,
    orbitMemberCount,
    orbitMemberRemaining: Math.max(0, ORBIT_MEMBER_CAP - orbitMemberCount),
    badges,
  };
}

export function getProfileByUserId(
  db: Database.Database,
  userId: string,
  isUserSocketOnline: OnlineChecker,
  includePrivate = false
): UserProfile | null {
  const row = db
    .prepare(
      `SELECT u.id as user_id, u.email, u.email_verified, COALESCE(u.two_factor_enabled, 0) as two_factor_enabled,
              u.google_id, u.password_hash, u.created_at,
              p.username, COALESCE(p.discriminator, '0000') as discriminator, p.display_name, p.avatar_url,
              p.banner_url,
              COALESCE(p.banner_color, '#4F46E5') as banner_color,
              COALESCE(p.banner_preset, 'none') as banner_preset,
              COALESCE(p.avatar_frame, 'none') as avatar_frame,
              COALESCE(p.profile_effect, 'none') as profile_effect,
              COALESCE(p.is_bot, 0) as is_bot,
              COALESCE(p.is_verified_bot, 0) as is_verified_bot,
              COALESCE(p.xp, 0) as xp,
              COALESCE(p.pronouns, '') as pronouns,
              COALESCE(p.website_url, '') as website_url,
              COALESCE(p.activity_type, '') as activity_type,
              COALESCE(p.activity_text, '') as activity_text,
              p.featured_badge,
              p.bio, p.preferred_status, p.custom_status, p.last_seen_at,
              s.show_online_status
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       LEFT JOIN user_settings s ON s.user_id = u.id
       WHERE u.id = ?`
    )
    .get(userId) as
    | {
        user_id: string;
        email: string;
        email_verified: number;
        two_factor_enabled: number;
        google_id: string | null;
        password_hash: string;
        created_at: string;
        username: string;
        discriminator: string;
        display_name: string;
        avatar_url: string | null;
        banner_url: string | null;
        banner_color: string;
        banner_preset: BannerPresetKey;
        avatar_frame: AvatarFrameKey;
        profile_effect: ProfileEffectKey;
        is_bot: number;
        is_verified_bot: number;
        xp: number;
        pronouns: string;
        website_url: string;
        activity_type: ActivityTypeKey;
        activity_text: string;
        featured_badge: BadgeKey | null;
        bio: string;
        preferred_status: PresenceStatus;
        custom_status: string;
        last_seen_at: string;
        show_online_status: number | null;
      }
    | undefined;

  if (!row) return null;

  const isBot = row.is_bot === 1;
  const connected = isBot || isUserSocketOnline(row.user_id);
  const canShowOnline = isBot || row.show_online_status !== 0 || includePrivate;

  let effectiveStatus: PresenceStatus = 'offline';
  if (connected && canShowOnline) {
    effectiveStatus = isBot ? 'online' : row.preferred_status === 'offline' ? 'offline' : row.preferred_status;
  }

  const badgeRows = db
    .prepare(`SELECT badge_key, granted_at FROM user_badges WHERE user_id = ? ORDER BY granted_at ASC`)
    .all(row.user_id) as { badge_key: BadgeKey; granted_at: string }[];

  const badges: OrbitBadge[] = [];
  for (const b of badgeRows) {
    const def = BADGE_CATALOG[b.badge_key];
    if (def) {
      badges.push({ ...def, grantedAt: b.granted_at });
    }
  }

  const isFounder =
    row.email.toLowerCase() === FOUNDER_EMAIL || badges.some((b) => b.key === 'platform_founder');

  const validFeatured =
    row.featured_badge && badges.some((b) => b.key === row.featured_badge) ? row.featured_badge : null;

  const nitroState = isUserNitroActive(db, row.user_id);
  const streak = getUserStreakInfo(db, row.user_id);
  const levelInfo = calculateLevelFromXp(row.xp || 0);

  const profile: UserProfile = {
    userId: row.user_id,
    username: row.username,
    discriminator: row.discriminator || '0000',
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bannerUrl: row.banner_url || null,
    bannerColor: row.banner_color || '#4F46E5',
    bannerPreset: row.banner_preset || 'none',
    avatarFrame: row.avatar_frame || 'none',
    profileEffect: row.profile_effect || 'none',
    pronouns: row.pronouns || '',
    websiteUrl: row.website_url || '',
    activityType: row.activity_type || '',
    activityText: row.activity_text || '',
    featuredBadge: validFeatured,
    bio: row.bio,
    status: effectiveStatus,
    preferredStatus: row.preferred_status,
    customStatus: row.custom_status,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    isOnline: effectiveStatus !== 'offline',
    isFounder,
    isBot,
    isVerifiedBot: row.is_verified_bot === 1,
    nitroTier: nitroState.nitroTier,
    nitroExpiresAt: nitroState.nitroExpiresAt,
    xp: row.xp || 0,
    level: levelInfo.level,
    streak,
    badges,
  };

  if (includePrivate) {
    profile.email = row.email;
    profile.emailVerified = row.email_verified === 1;
    profile.twoFactorEnabled = row.two_factor_enabled === 1;
    profile.isGoogleLinked = Boolean(row.google_id);
    profile.hasPassword = Boolean(
      row.password_hash &&
        row.password_hash !== GOOGLE_OAUTH_SENTINEL &&
        row.password_hash !== FOUNDER_UNCLAIMED_HASH &&
        row.password_hash !== '__BOT_ACCOUNT__'
    );
  }

  return profile;
}

export function getUserSettings(db: Database.Database, userId: string): UserSettings {
  const row = db
    .prepare(`SELECT * FROM user_settings WHERE user_id = ?`)
    .get(userId) as
    | {
        user_id: string;
        theme: 'dark' | 'light' | 'system';
        font_size: 'sm' | 'md' | 'lg';
        message_density: 'compact' | 'cozy';
        in_app_notifications: number;
        push_notifications: number;
        sound_enabled: number;
        dnd_mode: number;
        show_online_status: number;
        dm_permission: 'everyone' | 'friends' | 'server_members';
        friend_requests_allowed: number;
        reduced_motion: number;
        keyboard_nav_hints: number;
      }
    | undefined;

  if (!row) {
    db.prepare(`INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)`).run(userId);
    return getUserSettings(db, userId);
  }

  return {
    userId: row.user_id,
    theme: row.theme,
    fontSize: row.font_size,
    messageDensity: row.message_density,
    inAppNotifications: row.in_app_notifications === 1,
    pushNotifications: row.push_notifications === 1,
    soundEnabled: row.sound_enabled === 1,
    dndMode: row.dnd_mode === 1,
    showOnlineStatus: row.show_online_status === 1,
    dmPermission: row.dm_permission,
    friendRequestsAllowed: row.friend_requests_allowed === 1,
    reducedMotion: row.reduced_motion === 1,
    keyboardNavHints: row.keyboard_nav_hints === 1,
  };
}
