export type BadgeKey =
  | 'platform_founder'
  | 'orbit_staff'
  | 'orbit_nitro'
  | 'server_booster'
  | 'bug_hunter_gold'
  | 'bug_hunter_silver'
  | 'orbit_partner'
  | 'orbit_moderator'
  | 'bot_developer'
  | 'bug_hunter'
  | 'orbit_member'
  | 'verified_account'
  | 'early_pioneer'
  | 'community_founder'
  | 'active_communicator'
  | 'forum_contributor'
  | 'voice_pioneer';

export const ALL_BADGE_KEYS: BadgeKey[] = [
  'platform_founder',
  'orbit_staff',
  'orbit_nitro',
  'server_booster',
  'bug_hunter_gold',
  'bug_hunter_silver',
  'orbit_partner',
  'orbit_moderator',
  'bot_developer',
  'bug_hunter',
  'orbit_member',
  'verified_account',
  'early_pioneer',
  'community_founder',
  'active_communicator',
  'forum_contributor',
  'voice_pioneer',
];

export const CURATED_BADGE_KEYS: BadgeKey[] = [
  'platform_founder',
  'orbit_staff',
  'orbit_nitro',
  'server_booster',
  'bug_hunter_gold',
  'bug_hunter_silver',
  'orbit_moderator',
  'bot_developer',
  'verified_account',
  'community_founder',
  'orbit_member',
];

export type ServerBadgeKey =
  | 'founder_official'
  | 'boost_tier_1'
  | 'boost_tier_2'
  | 'boost_tier_3'
  | 'verified_community'
  | 'orbit_bot_powered';

export interface ServerBadgeMeta {
  key: ServerBadgeKey;
  label: string;
  description: string;
  color: string;
  rarity: string;
}

export const SERVER_BADGE_CATALOG: Record<ServerBadgeKey, ServerBadgeMeta> = {
  founder_official: {
    key: 'founder_official',
    label: 'Resmî ORBIT Sunucusu',
    description: 'ORBIT platform kurucusuna ait doğrulanmış resmî topluluk.',
    color: '#6366F1',
    rarity: 'Eşsiz · Resmî',
  },
  boost_tier_3: {
    key: 'boost_tier_3',
    label: 'Takviye Seviye 3',
    description: '10 ve üzeri ORBIT Nitro takviyesi ile maksimum ayrıcalıklara ulaşan sunucu.',
    color: '#F472B6',
    rarity: 'Efsanevi · Seviye 3',
  },
  boost_tier_2: {
    key: 'boost_tier_2',
    label: 'Takviye Seviye 2',
    description: '5 ve üzeri ORBIT Nitro takviyesine sahip yüksek ses ve medya kaliteli sunucu.',
    color: '#EC4899',
    rarity: 'Çok Nadir · Seviye 2',
  },
  boost_tier_1: {
    key: 'boost_tier_1',
    label: 'Takviyeli Sunucu',
    description: 'En az 1 ORBIT Nitro takviyesi ile desteklenen topluluk sunucusu.',
    color: '#A855F7',
    rarity: 'Nadir · Takviyeli',
  },
  verified_community: {
    key: 'verified_community',
    label: 'Keşfe Açık Topluluk',
    description: 'ORBIT Keşfet vitrininde listelenen doğrulanmış topluluk sunucusu.',
    color: '#22C55E',
    rarity: 'Seçkin · Topluluk',
  },
  orbit_bot_powered: {
    key: 'orbit_bot_powered',
    label: 'ORBIT Bot Destekli',
    description: 'Resmî ORBIT akıllı bot ve otomasyon entegrasyonu etkin sunucu.',
    color: '#38BDF8',
    rarity: 'Teknoloji',
  },
};

export type AvatarFrameKey =
  | 'none'
  | 'orbit'
  | 'emerald'
  | 'amber'
  | 'crimson'
  | 'violet'
  | 'aurora'
  | 'cyber'
  | 'flame_halo'
  | 'galaxy_ring'
  | 'stardust_crown';

export type ProfileEffectKey = 'none' | 'aurora' | 'embers' | 'stardust' | 'nebula_pulse';
export type BannerPresetKey = 'none' | 'nebula' | 'aurora_wave' | 'supernova' | 'cyber_grid' | 'eclipse';
export type ActivityTypeKey = '' | 'playing' | 'listening' | 'coding' | 'watching';

export interface OrbitBadge {
  key: BadgeKey;
  label: string;
  description: string;
  color: string;
  rarity: string;
  simplicity: string;
  cap?: number;
  grantedAt?: string;
}

export const ORBIT_MEMBER_CAP = 100;

export const BADGE_CATALOG: Record<BadgeKey, Omit<OrbitBadge, 'grantedAt'>> = {
  platform_founder: {
    key: 'platform_founder',
    label: 'ORBIT Kurucusu',
    description: 'ORBIT iletişim platformunun kurucusu ve baş yöneticisi.',
    color: '#6366F1',
    rarity: 'Eşsiz · Kurucu',
    simplicity: 'Çok Özel — Yalnızca ORBIT kurucusuna özel tekil rozettir.',
  },
  orbit_staff: {
    key: 'orbit_staff',
    label: 'Orbit Ekibi',
    description: 'ORBIT platformunun resmî geliştirme, güvenlik ve operasyon ekibi üyesi.',
    color: '#5865F2',
    rarity: 'Eşsiz · Resmî Ekip',
    simplicity: 'Çok Özel — Yalnızca ORBIT resmî ekibine kurucu tarafından tanımlanır.',
  },
  orbit_nitro: {
    key: 'orbit_nitro',
    label: 'ORBIT Nitro',
    description: 'Aktif ORBIT Nitro abonesi; 50 MB yükleme, HD yayın ve hareketli profil ayrıcalıklarına sahip.',
    color: '#EC4899',
    rarity: 'Özel · Nitro Abonesi',
    simplicity: 'Abonelik — Aktif aylık veya yıllık ORBIT Nitro aboneliği ile kazanılır.',
  },
  server_booster: {
    key: 'server_booster',
    label: 'Sunucu Takviyecisi',
    description: 'ORBIT Nitro gücüyle bir topluluk sunucusuna aktif takviye desteği sağlayan üye.',
    color: '#F472B6',
    rarity: 'Çok Nadir · Takviye',
    simplicity: 'Destekçi — ORBIT Nitro ile bir sunucuya takviye yaparak kazanılır.',
  },
  bug_hunter_gold: {
    key: 'bug_hunter_gold',
    label: 'Hata Avcısı · Altın',
    description: '5 veya daha fazla kritik hata/güvenlik bildirimiyle ORBIT kalitesini zirveye taşıyan uzman.',
    color: '#F59E0B',
    rarity: 'Efsanevi · Altın Avcı',
    simplicity: 'Zor — 5 farklı geçerli hata veya moderasyon bildirimi yapmak gerekir.',
  },
  bug_hunter_silver: {
    key: 'bug_hunter_silver',
    label: 'Hata Avcısı · Gümüş',
    description: 'Platform hatalarını ve topluluk güvenlik ihlallerini raporlayarak ORBIT’i güçlendiren avcı.',
    color: '#94A3B8',
    rarity: 'Nadir · Gümüş Avcı',
    simplicity: 'Orta — Hata veya moderasyon raporu göndererek hemen kazanılır.',
  },
  orbit_partner: {
    key: 'orbit_partner',
    label: 'Orbit Partneri',
    description: 'Keşfe açık, örnek ve aktif bir topluluk sunucusu yöneten resmi partner.',
    color: '#4E7FFF',
    rarity: 'Seçkin · Partner',
    simplicity: 'Orta — Keşfe açık (en az 2 kanallı) bir sunucuyu yönetmek gerekir.',
  },
  orbit_moderator: {
    key: 'orbit_moderator',
    label: 'Orbit Moderatör',
    description: 'Topluluk düzenini ve güvenliğini aktif moderasyon ile koruyan yetkili.',
    color: '#3BA55C',
    rarity: 'Nadir · Muhafız',
    simplicity: 'Orta — Sunucularda susturma, çıkarma veya yasaklama moderasyonu yapmak gerekir.',
  },
  bot_developer: {
    key: 'bot_developer',
    label: 'Bot Geliştiricisi',
    description: 'Sunucular için Webhook ve otomatik bot entegrasyonu geliştiren üye.',
    color: '#00AFF4',
    rarity: 'Nadir · Geliştirici',
    simplicity: 'Basit — Sunucu ayarlarından bir Webhook / Bot entegrasyonu oluşturmak yeterlidir.',
  },
  bug_hunter: {
    key: 'bug_hunter',
    label: 'Hata Avcısı',
    description: 'Platform hatalarını ve güvenlik/moderasyon bildirimlerini raporlayan araştırmacı.',
    color: '#23A55A',
    rarity: 'Nadir · Katkıcı',
    simplicity: 'Orta — Hata veya geri bildirim raporu göndermek yeterlidir.',
  },
  orbit_member: {
    key: 'orbit_member',
    label: 'Orbit Üyesi · İlk 100',
    description: 'ORBIT platformunu kullanan ilk 100 üyeden biri.',
    color: '#F47FFF',
    rarity: 'Sınırlı · İlk 100',
    simplicity: 'Sınırlı Kontenjan — İlk 100 kayıtlı üyeye otomatik tanımlanır.',
    cap: ORBIT_MEMBER_CAP,
  },
  verified_account: {
    key: 'verified_account',
    label: 'Doğrulanmış Hesap',
    description: 'E-posta adresini doğrulamış güvenilir üye.',
    color: '#23A55A',
    rarity: 'Standart · Güvenilir',
    simplicity: 'Basit — E-posta doğrulamasını tamamlamak yeterlidir.',
  },
  early_pioneer: {
    key: 'early_pioneer',
    label: 'ORBIT Öncüsü',
    description: 'ORBIT platformunun ilk dönem topluluk üyelerinden biri.',
    color: '#80848E',
    rarity: 'Erken Dönem',
    simplicity: 'İlk dönem kayıt olan hesaplara verilir.',
  },
  community_founder: {
    key: 'community_founder',
    label: 'Topluluk Kurucusu',
    description: 'ORBIT üzerinde en az bir sunucu kurdu ve yönetiyor.',
    color: '#F0B232',
    rarity: 'Nadir · Kurucu',
    simplicity: 'Basit — Sol menüden yeni bir sunucu oluşturmak yeterlidir.',
  },
  active_communicator: {
    key: 'active_communicator',
    label: 'Aktif İletişimci',
    description: 'Kanallarda aktif mesajlaşmaya katıldı.',
    color: '#38BDF8',
    rarity: 'Yaygın',
    simplicity: 'Basit — Herhangi bir kanalda 3 mesaj göndermek yeterlidir.',
  },
  forum_contributor: {
    key: 'forum_contributor',
    label: 'Forum Katkıcısı',
    description: 'Topluluk forumlarında konu veya yanıt paylaştı.',
    color: '#A78BFA',
    rarity: 'Orta',
    simplicity: 'Basit — Bir forum kanalında konu açmak gerekir.',
  },
  voice_pioneer: {
    key: 'voice_pioneer',
    label: 'Ses Öncüsü',
    description: 'WebRTC sesli veya görüntülü odalara katıldı.',
    color: '#2DC770',
    rarity: 'Orta',
    simplicity: 'Basit — Bir sesli odaya ilk kez katılmak yeterlidir.',
  },
};

export const AVATAR_FRAMES: Array<{
  key: AvatarFrameKey;
  label: string;
  ringClass: string;
  swatch: string;
  nitroOnly?: boolean;
  isAnimated?: boolean;
  decorationKind?: 'orbit' | 'pulse' | 'prism' | 'flame' | 'galaxy' | 'crown';
}> = [
  { key: 'none', label: 'Çerçevesiz', ringClass: '', swatch: '#334155' },
  {
    key: 'orbit',
    label: 'Orbit Mavisi',
    ringClass: 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-[#12151E]',
    swatch: '#6366F1',
  },
  {
    key: 'emerald',
    label: 'Zümrüt Halka',
    ringClass: 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-white dark:ring-offset-[#12151E]',
    swatch: '#34D399',
  },
  {
    key: 'amber',
    label: 'Altın Kurucu',
    ringClass: 'ring-2 ring-amber-400 ring-offset-2 ring-offset-white dark:ring-offset-[#12151E]',
    swatch: '#FBBF24',
  },
  {
    key: 'crimson',
    label: 'Yakut Işık',
    ringClass: 'ring-2 ring-rose-500 ring-offset-2 ring-offset-white dark:ring-offset-[#12151E]',
    swatch: '#F43F5E',
  },
  {
    key: 'violet',
    label: 'Galaksi Moru',
    ringClass: 'ring-2 ring-fuchsia-400 ring-offset-2 ring-offset-white dark:ring-offset-[#12151E]',
    swatch: '#E879F9',
    isAnimated: true,
    decorationKind: 'orbit',
  },
  {
    key: 'aurora',
    label: 'Aurora Halo (Hareketli)',
    ringClass: 'ring-2 ring-cyan-400 shadow-[0_0_16px_rgba(34,211,238,0.55)] ring-offset-2 ring-offset-white dark:ring-offset-[#12151E]',
    swatch: '#22D3EE',
    nitroOnly: true,
    isAnimated: true,
    decorationKind: 'pulse',
  },
  {
    key: 'cyber',
    label: 'Prisma Siber (Hareketli)',
    ringClass: 'ring-2 ring-pink-500 shadow-[0_0_16px_rgba(236,72,153,0.55)] ring-offset-2 ring-offset-white dark:ring-offset-[#12151E]',
    swatch: '#EC4899',
    nitroOnly: true,
    isAnimated: true,
    decorationKind: 'prism',
  },
  {
    key: 'flame_halo',
    label: 'Ateş Halesi (Hareketli)',
    ringClass: 'ring-2 ring-orange-500 shadow-[0_0_18px_rgba(249,115,22,0.65)] ring-offset-2 ring-offset-white dark:ring-offset-[#12151E]',
    swatch: '#F97316',
    nitroOnly: true,
    isAnimated: true,
    decorationKind: 'flame',
  },
  {
    key: 'galaxy_ring',
    label: 'Yörünge Halkası (Hareketli)',
    ringClass: 'ring-2 ring-violet-400 shadow-[0_0_18px_rgba(168,85,247,0.6)] ring-offset-2 ring-offset-white dark:ring-offset-[#12151E]',
    swatch: '#A855F7',
    isAnimated: true,
    decorationKind: 'galaxy',
  },
  {
    key: 'stardust_crown',
    label: 'Yıldız Tacı (Nitro)',
    ringClass: 'ring-2 ring-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.65)] ring-offset-2 ring-offset-white dark:ring-offset-[#12151E]',
    swatch: '#FCD34D',
    nitroOnly: true,
    isAnimated: true,
    decorationKind: 'crown',
  },
];

export const PROFILE_EFFECTS: Array<{
  key: ProfileEffectKey;
  label: string;
  description: string;
  gradientClass: string;
  nitroOnly?: boolean;
}> = [
  { key: 'none', label: 'Efekt Yok', description: 'Sade klasik profil kartı.', gradientClass: '' },
  {
    key: 'aurora',
    label: 'Kuzey Işıkları',
    description: 'Kart başlığında yumuşak turkuaz-indigo ışık dalgası.',
    gradientClass: 'from-cyan-500/35 via-indigo-500/20 to-fuchsia-500/30',
    nitroOnly: true,
  },
  {
    key: 'embers',
    label: 'Ateş Kıvılcımı',
    description: 'Sıcak amber ve kor kızılı dinamik yansıma.',
    gradientClass: 'from-orange-500/40 via-rose-500/25 to-amber-400/30',
    nitroOnly: true,
  },
  {
    key: 'stardust',
    label: 'Yıldız Tozu',
    description: 'Derin mor ve elmas ışıltılı gece efekti.',
    gradientClass: 'from-violet-600/40 via-fuchsia-500/25 to-sky-400/30',
    nitroOnly: true,
  },
  {
    key: 'nebula_pulse',
    label: 'Galaksi Nabzı',
    description: 'Hareketli mor-mavi yıldız bulutsusu parıltısı.',
    gradientClass: 'from-purple-600/45 via-cyan-500/20 to-pink-500/30',
    nitroOnly: true,
  },
];

export const BANNER_PRESETS: Array<{
  key: BannerPresetKey;
  label: string;
  previewClass: string;
  animated?: boolean;
  nitroOnly?: boolean;
}> = [
  { key: 'none', label: 'Düz Renk', previewClass: '' },
  {
    key: 'nebula',
    label: 'Galaksi Bulutu',
    previewClass: 'bg-gradient-to-r from-[#4C1D95] via-[#7C3AED] to-[#0EA5E9] orbit-banner-shift',
    animated: true,
  },
  {
    key: 'aurora_wave',
    label: 'Kutup Dalgası',
    previewClass: 'bg-gradient-to-r from-[#0F766E] via-[#6366F1] to-[#A855F7] orbit-banner-shift',
    animated: true,
  },
  {
    key: 'supernova',
    label: 'Süpernova (Nitro)',
    previewClass: 'bg-gradient-to-r from-[#EA580C] via-[#DB2777] to-[#7C3AED] orbit-banner-shift',
    animated: true,
    nitroOnly: true,
  },
  {
    key: 'cyber_grid',
    label: 'Siber Yörünge (Nitro)',
    previewClass: 'bg-gradient-to-r from-[#0F172A] via-[#7C3AED] to-[#EC4899] orbit-banner-shift',
    animated: true,
    nitroOnly: true,
  },
  {
    key: 'eclipse',
    label: 'Güneş Tutulması',
    previewClass: 'bg-gradient-to-r from-[#1E1B4B] via-[#312E81] to-[#F59E0B]',
    animated: false,
  },
];

export const ACTIVITY_LABELS: Record<ActivityTypeKey, string> = {
  '': 'Yok',
  playing: 'Oynuyor',
  listening: 'Dinliyor',
  coding: 'Geliştiriyor',
  watching: 'İzliyor',
};

export interface StreakMilestoneDef {
  day: number;
  title: string;
  shortLabel: string;
  color: string;
  isFlame: boolean;
}

export const STREAK_MILESTONES: StreakMilestoneDef[] = [
  { day: 1, title: '1. Gün · Kıvılcım', shortLabel: '1G', color: '#94A3B8', isFlame: false },
  { day: 2, title: '2. Gün · Ritim', shortLabel: '2G', color: '#38BDF8', isFlame: false },
  { day: 3, title: '3. Gün · Odak', shortLabel: '3G', color: '#6366F1', isFlame: false },
  { day: 4, title: '4. Gün · İvme', shortLabel: '4G', color: '#A855F7', isFlame: false },
  { day: 5, title: '5. Gün · Yıldız', shortLabel: '5G', color: '#F59E0B', isFlame: false },
  { day: 6, title: '6. Gün · Süpernova', shortLabel: '6G', color: '#FB7185', isFlame: false },
  { day: 7, title: '7. Gün · Ateşli Seri', shortLabel: '7G', color: '#F97316', isFlame: true },
];

export interface AchievementDef {
  key: string;
  title: string;
  description: string;
  category: 'streak' | 'social' | 'community' | 'nitro';
  target: number;
  xpReward: number;
  color: string;
}

export const ACHIEVEMENT_CATALOG: AchievementDef[] = [
  {
    key: 'streak_3',
    title: '3 Günlük Ritim',
    description: 'Üst üste 3 gün ORBIT’e katıl ve etkileşimde kal.',
    category: 'streak',
    target: 3,
    xpReward: 75,
    color: '#6366F1',
  },
  {
    key: 'streak_7',
    title: 'Ateşli Seri · 7 Gün',
    description: 'Üst üste 7 gün serini koruyarak Ateşli Seri rozetini yak!',
    category: 'streak',
    target: 7,
    xpReward: 250,
    color: '#F97316',
  },
  {
    key: 'first_messages',
    title: 'Sohbet Başlatıcısı',
    description: 'Kanallarda veya sohbetlerde toplam 10 mesaj paylaş.',
    category: 'social',
    target: 10,
    xpReward: 50,
    color: '#38BDF8',
  },
  {
    key: 'community_builder',
    title: 'Topluluk Mimarı',
    description: 'En az 1 sunucu kur veya sunucuda aktif kanal oluştur.',
    category: 'community',
    target: 1,
    xpReward: 100,
    color: '#F0B232',
  },
  {
    key: 'voice_explorer',
    title: 'Sesli Sahne Kaşifi',
    description: 'Sesli kanala katılarak gerçek zamanlı görüşme başlat.',
    category: 'social',
    target: 1,
    xpReward: 60,
    color: '#2DC770',
  },
  {
    key: 'server_booster',
    title: 'Topluluk Destekçisi',
    description: 'ORBIT Nitro ile bir sunucuyu takviye ederek seviye atlat.',
    category: 'nitro',
    target: 1,
    xpReward: 150,
    color: '#EC4899',
  },
];

export function calculateLevelFromXp(xp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPct: number;
} {
  const safeXp = Math.max(0, Math.floor(xp || 0));
  const level = Math.floor(Math.sqrt(safeXp / 50)) + 1;
  const floorXp = Math.pow(level - 1, 2) * 50;
  const ceilXp = Math.pow(level, 2) * 50;
  const span = Math.max(1, ceilXp - floorXp);
  const progressPct = Math.min(100, Math.max(0, Math.round(((safeXp - floorXp) / span) * 100)));
  return {
    level,
    currentLevelXp: safeXp - floorXp,
    nextLevelXp: ceilXp - floorXp,
    progressPct,
  };
}
