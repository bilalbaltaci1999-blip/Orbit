-- Migration 006: Sorgu performansı için birleşik ve yabancı anahtar indeksleri

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id);
CREATE INDEX IF NOT EXISTS idx_member_roles_user ON member_roles(server_id, user_id);
CREATE INDEX IF NOT EXISTS idx_channels_server_pos ON channels(server_id, position);
CREATE INDEX IF NOT EXISTS idx_messages_author_created ON messages(channel_id, author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_members_user ON direct_conversation_members(user_id, archived);
CREATE INDEX IF NOT EXISTS idx_read_receipts_lookup ON read_receipts(user_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_channel ON voice_sessions(channel_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_forum_posts_channel ON forum_posts(channel_id, is_pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_badges_key ON user_badges(badge_key);
