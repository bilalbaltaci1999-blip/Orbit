-- 010_read_receipts_and_server_features.sql
-- Granular per-message read receipts + Discord-style server roles (hoist, mentionable, icon, description, booster role)

CREATE TABLE IF NOT EXISTS message_read_receipts (
  message_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('channel','dm')),
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (target_type, message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_msg_read_target ON message_read_receipts(target_type, target_id, message_id);

ALTER TABLE read_receipts ADD COLUMN last_read_message_id TEXT;

ALTER TABLE roles ADD COLUMN hoist INTEGER NOT NULL DEFAULT 0;
ALTER TABLE roles ADD COLUMN mentionable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE roles ADD COLUMN icon TEXT NOT NULL DEFAULT '';
ALTER TABLE roles ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE roles ADD COLUMN is_booster_role INTEGER NOT NULL DEFAULT 0;

UPDATE roles SET hoist = 1, icon = '👑' WHERE is_admin = 1;
UPDATE roles SET hoist = 1, mentionable = 1, icon = '🛡️' WHERE name = 'Moderatör';
