-- Migration 003: Kişiye özel ORBIT Kurucu Hesabı ve Başlangıç Topluluğu (bilalbaltaci1999@gmail.com)

INSERT INTO users (id, email, password_hash, email_verified, verification_token)
SELECT 'founder-bilal-0001', 'bilalbaltaci1999@gmail.com', '__FOUNDER_UNCLAIMED__', 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = 'bilalbaltaci1999@gmail.com');

UPDATE users
SET email_verified = 1, verification_token = NULL
WHERE lower(email) = 'bilalbaltaci1999@gmail.com';

INSERT INTO profiles (user_id, username, display_name, banner_color, bio, preferred_status, custom_status)
SELECT u.id, 'bilal', 'Bilal (Kurucu)', '#D97706', 'ORBIT Platform Kurucusu', 'online', 'ORBIT Kurucusu'
FROM users u
WHERE lower(u.email) = 'bilalbaltaci1999@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = u.id);

INSERT OR IGNORE INTO user_settings (user_id)
SELECT id FROM users WHERE lower(email) = 'bilalbaltaci1999@gmail.com';

INSERT OR IGNORE INTO user_badges (user_id, badge_key)
SELECT id, 'platform_founder' FROM users WHERE lower(email) = 'bilalbaltaci1999@gmail.com';

INSERT OR IGNORE INTO user_badges (user_id, badge_key)
SELECT id, 'verified_account' FROM users WHERE lower(email) = 'bilalbaltaci1999@gmail.com';

INSERT OR IGNORE INTO user_badges (user_id, badge_key)
SELECT id, 'early_pioneer' FROM users WHERE lower(email) = 'bilalbaltaci1999@gmail.com';

INSERT OR IGNORE INTO user_badges (user_id, badge_key)
SELECT id, 'community_founder' FROM users WHERE lower(email) = 'bilalbaltaci1999@gmail.com';

-- Kurucu için başlangıç resmi ORBIT sunucusu (yalnızca hiç sunucusu yoksa oluşturulur)
INSERT INTO servers (id, name, description, owner_id, is_discoverable)
SELECT 'srv-orbit-official', 'ORBIT Resmi Topluluk', 'ORBIT kurucusu ve topluluk üyeleri için resmi merkez.', u.id, 1
FROM users u
WHERE lower(u.email) = 'bilalbaltaci1999@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM servers WHERE owner_id = u.id);

INSERT OR IGNORE INTO roles (id, server_id, name, color, position, is_default, is_admin)
SELECT 'role-orbit-everyone', 'srv-orbit-official', '@everyone', '#64748B', 0, 1, 0
WHERE EXISTS (SELECT 1 FROM servers WHERE id = 'srv-orbit-official');

INSERT OR IGNORE INTO roles (id, server_id, name, color, position, is_default, is_admin)
SELECT 'role-orbit-founder', 'srv-orbit-official', 'Kurucu & Yönetici', '#F59E0B', 100, 0, 1
WHERE EXISTS (SELECT 1 FROM servers WHERE id = 'srv-orbit-official');

INSERT OR IGNORE INTO role_permissions (role_id, permission)
SELECT 'role-orbit-everyone', perm FROM (
  SELECT 'VIEW_CHANNELS' AS perm UNION ALL
  SELECT 'SEND_MESSAGES' UNION ALL
  SELECT 'READ_HISTORY' UNION ALL
  SELECT 'CREATE_INVITES' UNION ALL
  SELECT 'CONNECT_VOICE' UNION ALL
  SELECT 'SPEAK_VOICE' UNION ALL
  SELECT 'SCREEN_SHARE'
) WHERE EXISTS (SELECT 1 FROM roles WHERE id = 'role-orbit-everyone');

INSERT OR IGNORE INTO role_permissions (role_id, permission)
SELECT 'role-orbit-founder', perm FROM (
  SELECT 'ADMINISTRATOR' AS perm UNION ALL
  SELECT 'MANAGE_SERVER' UNION ALL
  SELECT 'MANAGE_ROLES' UNION ALL
  SELECT 'MANAGE_CHANNELS' UNION ALL
  SELECT 'KICK_MEMBERS' UNION ALL
  SELECT 'BAN_MEMBERS' UNION ALL
  SELECT 'MUTE_MEMBERS' UNION ALL
  SELECT 'VIEW_AUDIT_LOG' UNION ALL
  SELECT 'VIEW_CHANNELS' UNION ALL
  SELECT 'SEND_MESSAGES' UNION ALL
  SELECT 'EDIT_MESSAGES' UNION ALL
  SELECT 'DELETE_MESSAGES' UNION ALL
  SELECT 'PIN_MESSAGES' UNION ALL
  SELECT 'SEND_ANNOUNCEMENTS' UNION ALL
  SELECT 'READ_HISTORY' UNION ALL
  SELECT 'CREATE_INVITES' UNION ALL
  SELECT 'CONNECT_VOICE' UNION ALL
  SELECT 'SPEAK_VOICE' UNION ALL
  SELECT 'SCREEN_SHARE'
) WHERE EXISTS (SELECT 1 FROM roles WHERE id = 'role-orbit-founder');

INSERT OR IGNORE INTO server_members (server_id, user_id)
SELECT 'srv-orbit-official', owner_id FROM servers WHERE id = 'srv-orbit-official';

INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id)
SELECT 'srv-orbit-official', owner_id, 'role-orbit-founder' FROM servers WHERE id = 'srv-orbit-official';

INSERT OR IGNORE INTO channels (id, server_id, parent_id, name, topic, type, position)
SELECT 'ch-orbit-cat-1', 'srv-orbit-official', NULL, 'Genel Alan', '', 'category', 0
WHERE EXISTS (SELECT 1 FROM servers WHERE id = 'srv-orbit-official');

INSERT OR IGNORE INTO channels (id, server_id, parent_id, name, topic, type, position)
SELECT 'ch-orbit-genel', 'srv-orbit-official', 'ch-orbit-cat-1', 'genel', 'ORBIT topluluk sohbet kanalı.', 'text', 1
WHERE EXISTS (SELECT 1 FROM servers WHERE id = 'srv-orbit-official');

INSERT OR IGNORE INTO channels (id, server_id, parent_id, name, topic, type, position)
SELECT 'ch-orbit-duyuru', 'srv-orbit-official', 'ch-orbit-cat-1', 'duyurular', 'Platform güncellemeleri ve kurucu duyuruları.', 'announcement', 2
WHERE EXISTS (SELECT 1 FROM servers WHERE id = 'srv-orbit-official');

INSERT OR IGNORE INTO channels (id, server_id, parent_id, name, topic, type, position)
SELECT 'ch-orbit-ses', 'srv-orbit-official', 'ch-orbit-cat-1', 'Sesli Sohbet', 'Gerçek zamanlı sesli ve görüntülü oda.', 'voice', 3
WHERE EXISTS (SELECT 1 FROM servers WHERE id = 'srv-orbit-official');
