-- Migration 008: ORBIT Ultimate Features
-- Security (2FA TOTP, Email Change), ORBIT Nitro & Server Boosts,
-- Achievements & 1-7 Day Streaks (XP/Level), Official Verified ORBIT Bot

ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN two_factor_backup_codes_json TEXT;
ALTER TABLE users ADD COLUMN pending_email TEXT;
ALTER TABLE users ADD COLUMN email_change_code TEXT;
ALTER TABLE users ADD COLUMN email_change_expires_at TEXT;

ALTER TABLE profiles ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN is_verified_bot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN nitro_tier TEXT NOT NULL DEFAULT 'none';
ALTER TABLE profiles ADD COLUMN nitro_expires_at TEXT;
ALTER TABLE profiles ADD COLUMN profile_effect TEXT NOT NULL DEFAULT 'none';
ALTER TABLE profiles ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_streaks (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  unlocked_at TEXT,
  PRIMARY KEY (user_id, achievement_key)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);

CREATE TABLE IF NOT EXISTS server_boosts (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(server_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_server_boosts_server ON server_boosts(server_id);

CREATE TABLE IF NOT EXISTS server_bots (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  welcome_enabled INTEGER NOT NULL DEFAULT 1,
  welcome_channel_id TEXT,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  prefix TEXT NOT NULL DEFAULT '/',
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (server_id, bot_id)
);

-- Seed Official Verified ORBIT Bot account (non-login system bot)
INSERT OR IGNORE INTO users (id, email, password_hash, email_verified, verification_token)
VALUES ('bot-orbit-official', 'bot@orbit.local', '__BOT_ACCOUNT__', 1, NULL);

INSERT OR IGNORE INTO profiles (
  user_id, username, discriminator, display_name, banner_color, avatar_frame,
  bio, preferred_status, custom_status, is_bot, is_verified_bot, nitro_tier, profile_effect, xp
)
VALUES (
  'bot-orbit-official',
  'orbitbot',
  '0000',
  'ORBIT',
  '#4F46E5',
  'orbit',
  'ORBIT platformunun resmî topluluk, moderasyon, özet ve yardımcı botu. Komutlar için /yardim yazın.',
  'online',
  '/yardim · Resmî Bot',
  1,
  1,
  'nitro',
  'aurora',
  9999
);

INSERT OR IGNORE INTO user_settings (user_id)
VALUES ('bot-orbit-official');

INSERT OR IGNORE INTO user_badges (user_id, badge_key)
VALUES ('bot-orbit-official', 'orbit_staff'), ('bot-orbit-official', 'verified_account');

-- Pre-enable Official ORBIT Bot on the official server if present
INSERT OR IGNORE INTO server_members (server_id, user_id)
SELECT 'srv-orbit-official', 'bot-orbit-official'
WHERE EXISTS (SELECT 1 FROM servers WHERE id = 'srv-orbit-official');

INSERT OR IGNORE INTO server_bots (server_id, bot_id, enabled, welcome_enabled, ai_enabled, prefix)
SELECT 'srv-orbit-official', 'bot-orbit-official', 1, 1, 1, '/'
WHERE EXISTS (SELECT 1 FROM servers WHERE id = 'srv-orbit-official');
