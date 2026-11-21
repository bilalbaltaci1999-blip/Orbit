import type Database from 'better-sqlite3';
import { ACHIEVEMENT_CATALOG, calculateLevelFromXp } from '../shared/badges.ts';
import type { AchievementItem, StreakInfo } from '../shared/types.ts';

const xpCooldownMap = new Map<string, number>();

function getUtcDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function getPreviousDateKey(dateKey: string): string {
  const dt = new Date(`${dateKey}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export function isUserNitroActive(db: Database.Database, userId: string): {
  isNitro: boolean;
  nitroTier: 'none' | 'nitro';
  nitroExpiresAt: string | null;
} {
  const row = db
    .prepare(`SELECT nitro_tier, nitro_expires_at FROM profiles WHERE user_id = ?`)
    .get(userId) as { nitro_tier: string; nitro_expires_at: string | null } | undefined;

  if (!row || row.nitro_tier !== 'nitro') {
    return { isNitro: false, nitroTier: 'none', nitroExpiresAt: null };
  }

  if (row.nitro_expires_at) {
    const expMs = new Date(row.nitro_expires_at).getTime();
    if (Number.isFinite(expMs) && expMs <= Date.now()) {
      db.prepare(`UPDATE profiles SET nitro_tier = 'none', nitro_expires_at = NULL WHERE user_id = ?`).run(userId);
      return { isNitro: false, nitroTier: 'none', nitroExpiresAt: null };
    }
  }

  return { isNitro: true, nitroTier: 'nitro', nitroExpiresAt: row.nitro_expires_at };
}

export function upsertAchievementProgress(
  db: Database.Database,
  userId: string,
  achievementKey: string,
  progressValue: number
): boolean {
  const def = ACHIEVEMENT_CATALOG.find((a) => a.key === achievementKey);
  if (!def) return false;

  const existing = db
    .prepare(`SELECT progress, unlocked_at FROM user_achievements WHERE user_id = ? AND achievement_key = ?`)
    .get(userId, achievementKey) as { progress: number; unlocked_at: string | null } | undefined;

  const nextProgress = Math.min(def.target, Math.max(existing?.progress || 0, progressValue));
  const newlyUnlocked = !existing?.unlocked_at && nextProgress >= def.target;

  if (!existing) {
    db.prepare(
      `INSERT INTO user_achievements (user_id, achievement_key, progress, unlocked_at)
       VALUES (?, ?, ?, ?)`
    ).run(userId, achievementKey, nextProgress, newlyUnlocked ? new Date().toISOString() : null);
  } else {
    db.prepare(
      `UPDATE user_achievements
       SET progress = ?, unlocked_at = COALESCE(unlocked_at, ?)
       WHERE user_id = ? AND achievement_key = ?`
    ).run(nextProgress, newlyUnlocked ? new Date().toISOString() : null, userId, achievementKey);
  }

  if (newlyUnlocked && def.xpReward > 0) {
    db.prepare(`UPDATE profiles SET xp = COALESCE(xp, 0) + ? WHERE user_id = ?`).run(def.xpReward, userId);
  }
  return newlyUnlocked;
}

export function recordDailyStreak(db: Database.Database, userId: string): StreakInfo {
  const botCheck = db.prepare(`SELECT is_bot FROM profiles WHERE user_id = ?`).get(userId) as
    | { is_bot?: number }
    | undefined;
  if (botCheck?.is_bot === 1) {
    return { currentStreak: 7, longestStreak: 7, lastActiveDate: getUtcDateKey(), hasFlameBadge: true };
  }

  const today = getUtcDateKey();
  const yesterday = getPreviousDateKey(today);

  const row = db
    .prepare(`SELECT current_streak, longest_streak, last_active_date FROM user_streaks WHERE user_id = ?`)
    .get(userId) as
    | { current_streak: number; longest_streak: number; last_active_date: string | null }
    | undefined;

  let currentStreak = 1;
  let longestStreak = 1;

  if (row) {
    if (row.last_active_date === today) {
      currentStreak = Math.max(1, row.current_streak);
      longestStreak = Math.max(currentStreak, row.longest_streak);
    } else if (row.last_active_date === yesterday) {
      currentStreak = row.current_streak + 1;
      longestStreak = Math.max(currentStreak, row.longest_streak);
      db.prepare(
        `UPDATE user_streaks
         SET current_streak = ?, longest_streak = ?, last_active_date = ?, updated_at = datetime('now')
         WHERE user_id = ?`
      ).run(currentStreak, longestStreak, today, userId);
      db.prepare(`UPDATE profiles SET xp = COALESCE(xp, 0) + 25 WHERE user_id = ?`).run(userId);
    } else {
      currentStreak = 1;
      longestStreak = Math.max(1, row.longest_streak);
      db.prepare(
        `UPDATE user_streaks
         SET current_streak = 1, longest_streak = ?, last_active_date = ?, updated_at = datetime('now')
         WHERE user_id = ?`
      ).run(longestStreak, today, userId);
      db.prepare(`UPDATE profiles SET xp = COALESCE(xp, 0) + 15 WHERE user_id = ?`).run(userId);
    }
  } else {
    db.prepare(
      `INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_active_date)
       VALUES (?, 1, 1, ?)`
    ).run(userId, today);
    db.prepare(`UPDATE profiles SET xp = COALESCE(xp, 0) + 15 WHERE user_id = ?`).run(userId);
  }

  upsertAchievementProgress(db, userId, 'streak_3', Math.min(3, longestStreak));
  upsertAchievementProgress(db, userId, 'streak_7', Math.min(7, longestStreak));

  return {
    currentStreak,
    longestStreak,
    lastActiveDate: today,
    hasFlameBadge: currentStreak >= 7 || longestStreak >= 7,
  };
}

export function awardActivityXp(
  db: Database.Database,
  userId: string,
  action: 'message' | 'voice' | 'server' | 'boost'
): void {
  const botCheck = db.prepare(`SELECT is_bot FROM profiles WHERE user_id = ?`).get(userId) as
    | { is_bot?: number }
    | undefined;
  if (botCheck?.is_bot === 1) return;

  recordDailyStreak(db, userId);

  if (action === 'message') {
    const now = Date.now();
    const lastTs = xpCooldownMap.get(userId) || 0;
    if (now - lastTs >= 12_000) {
      xpCooldownMap.set(userId, now);
      db.prepare(`UPDATE profiles SET xp = COALESCE(xp, 0) + 10 WHERE user_id = ?`).run(userId);
    }
    const chCount = (db.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE author_id = ?`).get(userId) as { cnt: number })
      .cnt;
    const dmCount = (
      db.prepare(`SELECT COUNT(*) as cnt FROM direct_messages WHERE author_id = ?`).get(userId) as { cnt: number }
    ).cnt;
    upsertAchievementProgress(db, userId, 'first_messages', Math.min(10, chCount + dmCount));
  } else if (action === 'voice') {
    db.prepare(`UPDATE profiles SET xp = COALESCE(xp, 0) + 15 WHERE user_id = ?`).run(userId);
    upsertAchievementProgress(db, userId, 'voice_explorer', 1);
  } else if (action === 'server') {
    db.prepare(`UPDATE profiles SET xp = COALESCE(xp, 0) + 25 WHERE user_id = ?`).run(userId);
    upsertAchievementProgress(db, userId, 'community_builder', 1);
  } else if (action === 'boost') {
    db.prepare(`UPDATE profiles SET xp = COALESCE(xp, 0) + 40 WHERE user_id = ?`).run(userId);
    upsertAchievementProgress(db, userId, 'server_booster', 1);
  }
}

export function getUserStreakInfo(db: Database.Database, userId: string): StreakInfo {
  const row = db
    .prepare(`SELECT current_streak, longest_streak, last_active_date FROM user_streaks WHERE user_id = ?`)
    .get(userId) as
    | { current_streak: number; longest_streak: number; last_active_date: string | null }
    | undefined;

  if (!row) {
    return { currentStreak: 0, longestStreak: 0, lastActiveDate: null, hasFlameBadge: false };
  }

  const today = getUtcDateKey();
  const yesterday = getPreviousDateKey(today);
  const activeCurrent =
    row.last_active_date === today || row.last_active_date === yesterday ? row.current_streak : 0;

  return {
    currentStreak: activeCurrent,
    longestStreak: row.longest_streak,
    lastActiveDate: row.last_active_date,
    hasFlameBadge: activeCurrent >= 7 || row.longest_streak >= 7,
  };
}

export function getUserAchievementsPayload(db: Database.Database, userId: string): {
  xp: number;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPct: number;
  streak: StreakInfo;
  achievements: AchievementItem[];
} {
  const prof = db.prepare(`SELECT COALESCE(xp, 0) as xp FROM profiles WHERE user_id = ?`).get(userId) as
    | { xp: number }
    | undefined;
  const xp = prof?.xp || 0;
  const levelInfo = calculateLevelFromXp(xp);
  const streak = getUserStreakInfo(db, userId);

  const rows = db
    .prepare(`SELECT achievement_key, progress, unlocked_at FROM user_achievements WHERE user_id = ?`)
    .all(userId) as Array<{ achievement_key: string; progress: number; unlocked_at: string | null }>;
  const map = new Map(rows.map((r) => [r.achievement_key, r]));

  const achievements: AchievementItem[] = ACHIEVEMENT_CATALOG.map((def) => {
    const saved = map.get(def.key);
    return {
      key: def.key,
      title: def.title,
      description: def.description,
      category: def.category,
      target: def.target,
      progress: saved ? Math.min(def.target, saved.progress) : 0,
      xpReward: def.xpReward,
      color: def.color,
      unlockedAt: saved?.unlocked_at || null,
    };
  });

  return {
    xp,
    ...levelInfo,
    streak,
    achievements,
  };
}
