-- Migration 002: Kullanici profil banner rengi ve kazanilan rozetler

ALTER TABLE profiles ADD COLUMN banner_color TEXT NOT NULL DEFAULT '#4F46E5';

CREATE TABLE IF NOT EXISTS user_badges (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, badge_key)
);

INSERT OR IGNORE INTO user_badges (user_id, badge_key)
SELECT id, 'early_pioneer' FROM users;

INSERT OR IGNORE INTO user_badges (user_id, badge_key)
SELECT id, 'verified_account' FROM users WHERE email_verified = 1;

INSERT OR IGNORE INTO user_badges (user_id, badge_key)
SELECT DISTINCT owner_id, 'community_founder' FROM servers;

