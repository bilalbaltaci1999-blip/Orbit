-- 009_orbit_next_upgrade.sql
-- Google OAuth linking, animated/custom profile banners, voice multiplayer mini-games & paid ORBIT Nitro billing records

ALTER TABLE users ADD COLUMN google_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;

ALTER TABLE profiles ADD COLUMN banner_url TEXT;
ALTER TABLE profiles ADD COLUMN banner_preset TEXT NOT NULL DEFAULT 'none';
ALTER TABLE profiles ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE profiles ADD COLUMN stripe_subscription_id TEXT;

CREATE TABLE IF NOT EXISTS voice_room_games (
  room_id TEXT PRIMARY KEY,
  game_type TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nitro_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE,
  amount_kurus INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'try',
  plan TEXT NOT NULL DEFAULT 'monthly',
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
