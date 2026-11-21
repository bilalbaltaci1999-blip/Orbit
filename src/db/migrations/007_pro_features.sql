-- Pro features migration: threads, scheduled messages, reminders, channel overrides,
-- automod/welcome automation, onboarding self-roles, custom emojis, voice stage & whiteboard/pomodoro

ALTER TABLE channels ADD COLUMN is_stage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE voice_sessions ADD COLUMN hand_raised INTEGER NOT NULL DEFAULT 0;
ALTER TABLE voice_sessions ADD COLUMN is_speaker INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS message_threads (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  parent_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(parent_message_id)
);

CREATE INDEX IF NOT EXISTS idx_message_threads_channel ON message_threads(channel_id, created_at DESC);

ALTER TABLE messages ADD COLUMN thread_id TEXT REFERENCES message_threads(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN forwarded_from_json TEXT;
ALTER TABLE direct_messages ADD COLUMN forwarded_from_json TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(thread_id, created_at ASC);

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES direct_conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  send_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_pending ON scheduled_messages(status, send_at);

CREATE TABLE IF NOT EXISTS message_reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT,
  channel_id TEXT,
  conversation_id TEXT,
  note TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON message_reminders(notified, remind_at);

CREATE TABLE IF NOT EXISTS channel_permission_overrides (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  allow_perms TEXT NOT NULL DEFAULT '',
  deny_perms TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (channel_id, role_id)
);

CREATE TABLE IF NOT EXISTS server_automod_rules (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  block_bad_words INTEGER NOT NULL DEFAULT 1,
  bad_words TEXT NOT NULL DEFAULT '',
  block_invites INTEGER NOT NULL DEFAULT 0,
  anti_spam INTEGER NOT NULL DEFAULT 1,
  max_mentions INTEGER NOT NULL DEFAULT 5,
  timeout_minutes INTEGER NOT NULL DEFAULT 5,
  welcome_enabled INTEGER NOT NULL DEFAULT 0,
  welcome_channel_id TEXT,
  welcome_message TEXT NOT NULL DEFAULT 'Hoş geldin {user}! {server} topluluğuna katıldın.'
);

CREATE TABLE IF NOT EXISTS server_onboarding_config (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  prompt_title TEXT NOT NULL DEFAULT 'Topluluk Kuralları ve Rol Seçimi',
  rules_text TEXT NOT NULL DEFAULT '1. Saygılı olun.\n2. Spam ve reklam yapmayın.\n3. Kanal konularına uyun.'
);

CREATE TABLE IF NOT EXISTS server_onboarding_roles (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL DEFAULT '✨',
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (server_id, role_id)
);

CREATE TABLE IF NOT EXISTS server_onboarding_acceptances (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS server_emojis (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(server_id, name)
);

CREATE INDEX IF NOT EXISTS idx_server_emojis_server ON server_emojis(server_id);

CREATE TABLE IF NOT EXISTS voice_whiteboard_strokes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  color TEXT NOT NULL,
  size INTEGER NOT NULL,
  points_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_whiteboard_room ON voice_whiteboard_strokes(room_id, created_at);

CREATE TABLE IF NOT EXISTS voice_pomodoro_state (
  room_id TEXT PRIMARY KEY,
  phase TEXT NOT NULL DEFAULT 'focus',
  duration_seconds INTEGER NOT NULL DEFAULT 1500,
  remaining_seconds INTEGER NOT NULL DEFAULT 1500,
  running INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
