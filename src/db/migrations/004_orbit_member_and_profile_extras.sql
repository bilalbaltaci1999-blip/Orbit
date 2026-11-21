-- Migration 004: İlk 100 Orbit Üyesi rozeti, profil zenginleştirme alanları ve canlı sohbet anketleri

ALTER TABLE profiles ADD COLUMN avatar_frame TEXT NOT NULL DEFAULT 'none';
ALTER TABLE profiles ADD COLUMN pronouns TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN website_url TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN activity_type TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN activity_text TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN featured_badge TEXT;

-- Mevcut ilk 100 kullanıcıya otomatik Orbit Üyesi rozeti ver
INSERT OR IGNORE INTO user_badges (user_id, badge_key)
SELECT id, 'orbit_member'
FROM users
ORDER BY created_at ASC
LIMIT 100;

-- Kurucuya varsayılan altın çerçeve ve aktif vitrin rozeti tanımla
UPDATE profiles
SET avatar_frame = 'amber',
    featured_badge = 'platform_founder'
WHERE user_id IN (SELECT id FROM users WHERE lower(email) = 'bilalbaltaci1999@gmail.com')
  AND avatar_frame = 'none';

-- Kanal içi gerçek zamanlı anket tabloları
CREATE TABLE IF NOT EXISTS message_polls (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  allow_multiple INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_poll_options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES message_polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS message_poll_votes (
  poll_id TEXT NOT NULL REFERENCES message_polls(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES message_poll_options(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (poll_id, option_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON message_poll_votes(poll_id);
