export const PERMISSIONS = {
  VIEW_CHANNEL: 'VIEW_CHANNEL',
  SEND_MESSAGES: 'SEND_MESSAGES',
  ATTACH_FILES: 'ATTACH_FILES',
  EDIT_MESSAGES: 'EDIT_MESSAGES',
  DELETE_MESSAGES: 'DELETE_MESSAGES',
  MANAGE_MEMBERS: 'MANAGE_MEMBERS',
  CREATE_INVITES: 'CREATE_INVITES',
  MANAGE_CHANNELS: 'MANAGE_CHANNELS',
  MANAGE_ROLES: 'MANAGE_ROLES',
  MUTE_MEMBERS: 'MUTE_MEMBERS',
  KICK_MEMBERS: 'KICK_MEMBERS',
  BAN_MEMBERS: 'BAN_MEMBERS',
  MANAGE_SERVER: 'MANAGE_SERVER',
  SEND_ANNOUNCEMENTS: 'SEND_ANNOUNCEMENTS',
  PIN_MESSAGES: 'PIN_MESSAGES',
  CONNECT_VOICE: 'CONNECT_VOICE',
  SPEAK_VOICE: 'SPEAK_VOICE',
  SCREEN_SHARE: 'SCREEN_SHARE',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const PERMISSION_LABELS: Record<Permission, { label: string; description: string }> = {
  VIEW_CHANNEL: { label: 'Kanalı Görüntüle', description: 'Kanalları ve mesaj geçmişini görme izni.' },
  SEND_MESSAGES: { label: 'Mesaj Gönder', description: 'Metin ve forum kanallarına mesaj yazma izni.' },
  ATTACH_FILES: { label: 'Dosya ve Medya Ekle', description: 'Görsel, ses kaydı ve dosya ekleme izni.' },
  EDIT_MESSAGES: { label: 'Başkalarının Mesajlarını Düzenle', description: 'Yönetim amaçlı mesaj içeriğini düzenleme.' },
  DELETE_MESSAGES: { label: 'Mesajları Sil', description: 'Diğer üyelerin mesajlarını silebilme izni.' },
  MANAGE_MEMBERS: { label: 'Üyeleri Yönet', description: 'Üyelere rol atama ve üye ayarlarını yönetme.' },
  CREATE_INVITES: { label: 'Davet Oluştur', description: 'Sunucuya yeni davet bağlantıları üretme.' },
  MANAGE_CHANNELS: { label: 'Kanalları Yönet', description: 'Kanal oluşturma, düzenleme, sıralama ve silme.' },
  MANAGE_ROLES: { label: 'Rolleri Yönet', description: 'Kendi rolünün altındaki rolleri oluşturma ve düzenleme.' },
  MUTE_MEMBERS: { label: 'Üyeleri Sustur', description: 'Üyeleri geçici olarak metin/ses kanallarında susturma.' },
  KICK_MEMBERS: { label: 'Üyeleri Çıkar', description: 'Üyeleri sunucudan atma izni.' },
  BAN_MEMBERS: { label: 'Üyeleri Yasakla', description: 'Üyeleri yasaklama ve yasağını kaldırma.' },
  MANAGE_SERVER: { label: 'Sunucu Ayarları', description: 'Sunucu adı, simgesi ve moderasyon kurallarını değiştirme.' },
  SEND_ANNOUNCEMENTS: { label: 'Duyuru Yayınla', description: 'Duyuru kanallarına resmi duyuru gönderme.' },
  PIN_MESSAGES: { label: 'Mesaj Sabitle', description: 'Kanal ve forum mesajlarını sabitleme veya kilitleme.' },
  CONNECT_VOICE: { label: 'Ses Kanalına Katıl', description: 'Sesli odalara bağlanma izni.' },
  SPEAK_VOICE: { label: 'Sesli Konuşma', description: 'Sesli odalarda mikrofon kullanma izni.' },
  SCREEN_SHARE: { label: 'Ekran Paylaşımı ve Video', description: 'Kamera açma ve ekran paylaşımı yapma izni.' },
};

export const DEFAULT_MEMBER_PERMISSIONS: Permission[] = [
  PERMISSIONS.VIEW_CHANNEL,
  PERMISSIONS.SEND_MESSAGES,
  PERMISSIONS.ATTACH_FILES,
  PERMISSIONS.CREATE_INVITES,
  PERMISSIONS.CONNECT_VOICE,
  PERMISSIONS.SPEAK_VOICE,
  PERMISSIONS.SCREEN_SHARE,
];

export const DEFAULT_MODERATOR_PERMISSIONS: Permission[] = [
  ...DEFAULT_MEMBER_PERMISSIONS,
  PERMISSIONS.DELETE_MESSAGES,
  PERMISSIONS.MUTE_MEMBERS,
  PERMISSIONS.KICK_MEMBERS,
  PERMISSIONS.PIN_MESSAGES,
  PERMISSIONS.SEND_ANNOUNCEMENTS,
];

export const DEFAULT_ADMIN_PERMISSIONS: Permission[] = [...ALL_PERMISSIONS];
