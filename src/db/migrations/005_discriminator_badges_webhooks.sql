-- Migration 005: Kalıcı Discord tarzı #0000 etiketler, resmi rozetler ve sunucu webhook/bot entegrasyonları

ALTER TABLE profiles ADD COLUMN discriminator TEXT NOT NULL DEFAULT '0000';
ALTER TABLE messages ADD COLUMN webhook_name TEXT;

-- Kurucu için kalıcı #0001 etiketi
UPDATE profiles
SET discriminator = '0001'
WHERE user_id IN (SELECT id FROM users WHERE lower(email) = 'bilalbaltaci1999@gmail.com');

-- Mevcut diğer kullanıcılar için 1000-9999 arası kalıcı 4 haneli etiket oluştur
UPDATE profiles
SET discriminator = printf('%04d', 1000 + ((rowid * 4871) % 8999))
WHERE discriminator = '0000';

-- Kurucuya resmi Orbit Personeli, Orbit Partneri ve Orbit Moderatör rozetlerini tanımla
INSERT OR IGNORE INTO user_badges (user_id, badge_key)
SELECT id, 'orbit_staff' FROM users WHERE lower(email) = 'bilalbaltaci1999@gmail.com';

INSERT OR IGNORE INTO user_badges (user_id, badge_key)
SELECT id, 'orbit_partner' FROM users WHERE lower(email) = 'bilalbaltaci1999@gmail.com';

INSERT OR IGNORE INTO user_badges (user_id, badge_key)
SELECT id, 'orbit_moderator' FROM users WHERE lower(email) = 'bilalbaltaci1999@gmail.com';

-- 003 migrasyonundaki VIEW_CHANNELS yazım farkını normalize et
UPDATE OR IGNORE role_permissions
SET permission = 'VIEW_CHANNEL'
WHERE permission = 'VIEW_CHANNELS';

DELETE FROM role_permissions WHERE permission = 'VIEW_CHANNELS';

-- Sunucu Bot / Webhook entegrasyon tablosu
CREATE TABLE IF NOT EXISTS server_webhooks (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token TEXT NOT NULL,
  avatar_url TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_server_webhooks_server ON server_webhooks(server_id);
