import type { ChannelType } from './types.ts';

export type ServerTemplateId = 'blank' | 'gaming' | 'tech' | 'study';

export interface ServerTemplateDefinition {
  id: ServerTemplateId;
  title: string;
  description: string;
  categories: Array<{
    name: string;
    channels: Array<{
      name: string;
      type: Exclude<ChannelType, 'category'>;
      topic: string;
      isStage?: boolean;
    }>;
  }>;
  defaultRoles: Array<{
    name: string;
    color: string;
    position: number;
  }>;
}

export const SERVER_TEMPLATES: Record<ServerTemplateId, ServerTemplateDefinition> = {
  blank: {
    id: 'blank',
    title: 'Boş Sunucu',
    description: 'Temel genel sohbet, duyuru ve ses odası ile sade başlangıç.',
    categories: [
      {
        name: 'Genel Alan',
        channels: [
          { name: 'genel-sohbet', type: 'text', topic: 'Topluluk genel sohbet kanalı.' },
          { name: 'duyurular', type: 'announcement', topic: 'Önemli topluluk duyuruları.' },
          { name: 'Ses Odası', type: 'voice', topic: 'Genel sesli iletişim odası.' },
        ],
      },
    ],
    defaultRoles: [],
  },
  gaming: {
    id: 'gaming',
    title: 'Oyun Topluluğu',
    description: 'Takım arama, strateji forumu, lobi ve turnuva sahnesi kanalları.',
    categories: [
      {
        name: 'Bilgi & Duyuru',
        channels: [
          { name: 'duyurular', type: 'announcement', topic: 'Etkinlik ve turnuva duyuruları.' },
          { name: 'hos-geldiniz', type: 'text', topic: 'Yeni katılan oyuncular buraya!' },
        ],
      },
      {
        name: 'Oyun Alanı',
        channels: [
          { name: 'genel-sohbet', type: 'text', topic: 'Oyun sohbetleri ve paylaşımlar.' },
          { name: 'takim-arama', type: 'forum', topic: 'Oyun arkadaşı ve takım ilanları.' },
          { name: 'Lobi 1', type: 'voice', topic: 'Genel oyun ses odası.' },
          { name: 'Turnuva Sahnesi', type: 'voice', topic: 'Yayın ve sahne konuşmaları.', isStage: true },
        ],
      },
    ],
    defaultRoles: [
      { name: 'Takım Kaptanı', color: '#F59E0B', position: 6 },
      { name: 'Oyuncu', color: '#10B981', position: 3 },
    ],
  },
  tech: {
    id: 'tech',
    title: 'Yazılım & Teknoloji',
    description: 'Kod yardımı, proje vitrini, teknik tartışma ve eşli çalışma odaları.',
    categories: [
      {
        name: 'Topluluk',
        channels: [
          { name: 'duyurular', type: 'announcement', topic: 'Sürüm notları ve topluluk haberleri.' },
          { name: 'genel-sohbet', type: 'text', topic: 'Teknoloji ve geliştirme sohbetleri.' },
        ],
      },
      {
        name: 'Geliştirme',
        channels: [
          { name: 'kod-yardim', type: 'forum', topic: 'Hata ayıklama ve mimari sorular.' },
          { name: 'proje-vitrini', type: 'text', topic: 'Geliştirdiğiniz projeleri paylaşın.' },
          { name: 'Pair Programming', type: 'voice', topic: 'Çizim tahtası ve sesli eşli çalışma.' },
          { name: 'Tech Talk Sahnesi', type: 'voice', topic: 'Sunumlar ve konuşmacı sahnesi.', isStage: true },
        ],
      },
    ],
    defaultRoles: [
      { name: 'Çekirdek Geliştirici', color: '#6366F1', position: 6 },
      { name: 'Katkıcı', color: '#06B6D4', position: 3 },
    ],
  },
  study: {
    id: 'study',
    title: 'Ders & Çalışma Grubu',
    description: 'Not paylaşımı, soru-cevap forumu ve ortak Pomodoro çalışma odası.',
    categories: [
      {
        name: 'Çalışma Alanı',
        channels: [
          { name: 'duyurular', type: 'announcement', topic: 'Program ve ders takvimi.' },
          { name: 'genel-sohbet', type: 'text', topic: 'Günlük motivasyon ve sohbet.' },
          { name: 'soru-cevap', type: 'forum', topic: 'Takıldığınız soruları burada tartışın.' },
          { name: 'Pomodoro Odası', type: 'voice', topic: '25dk odak + 5dk mola ortak çalışma.' },
        ],
      },
    ],
    defaultRoles: [
      { name: 'Mentor', color: '#EC4899', position: 6 },
      { name: 'Öğrenci', color: '#38BDF8', position: 3 },
    ],
  },
};

export interface SlashCommandDef {
  command: string;
  usage: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { command: '/yardim', usage: '/yardim', description: 'Resmî ORBIT Bot komut listesini kanalda gösterir.' },
  { command: '/sunucu', usage: '/sunucu', description: 'Sunucu üye, kanal ve takviye özetini paylaşır.' },
  { command: '/ozet', usage: '/ozet', description: 'Kanaldaki son mesajları yapay zekâ ile özetler.' },
  { command: '/ai', usage: '/ai [soru]', description: 'Resmî ORBIT Bot ile yapay zekâ destekli soru-cevap başlatır.' },
  { command: '/zar', usage: '/zar [yüz]', description: '1-100 veya belirtilen yüz sayısında rastgele zar atar.' },
  { command: '/yazi-tura', usage: '/yazi-tura', description: 'Yazı mı Tura mı? Hızlı çekiliş yapar.' },
  { command: '/anket', usage: '/anket Soru | Seçenek 1 | Seçenek 2', description: 'Tek satırda canlı kanal anketi başlatır.' },
  { command: '/hatirlat', usage: '/hatirlat [dakika] [not]', description: 'Belirtilen dakika sonra size uygulama içi hatırlatıcı yollar.' },
  { command: '/temizle', usage: '/temizle [adet]', description: 'Yetkiliyseniz son N mesajı kanaldan temizler (en fazla 50).' },
  { command: '/sustur', usage: '/sustur @kullanici [dakika]', description: 'Yetkiliyseniz üyeyi geçici olarak susturur.' },
];
