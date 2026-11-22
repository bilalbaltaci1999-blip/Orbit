import React, { useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Cookie,
  Copy,
  Crown,
  Download,
  ExternalLink,
  FileText,
  Flame,
  Gamepad2,
  Info,
  Keyboard,
  Lock,
  MessageSquare,
  Mic,
  Scale,
  Search,
  Server,
  Shield,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { useToast } from '../client/ToastContext.tsx';

export type OrbitDocTabId = 'about' | 'guide' | 'terms' | 'policies';

interface OrbitDocsSectionProps {
  tab: OrbitDocTabId;
  onNavigateTab: (tabId: 'security' | 'privacy' | 'appearance' | 'voice' | 'scheduled' | OrbitDocTabId) => void;
  onOpenNitro?: () => void;
  onOpenBadges?: () => void;
  onOpenAchievements?: () => void;
  onExportData?: () => void;
  exportingData?: boolean;
  onCloseModal: () => void;
}

interface GuideTopic {
  id: string;
  title: string;
  summary: string;
  accent: 'violet' | 'emerald' | 'cyan' | 'amber' | 'rose';
  steps: string[];
  targetTab?: 'security' | 'privacy' | 'appearance' | 'voice' | 'scheduled';
  targetLabel?: string;
}

const GUIDE_TOPICS: GuideTopic[] = [
  {
    id: 'account-security',
    title: '1. Hesap Oluşturma, 2FA ve Şifre Sıfırlama',
    summary: 'Hesabınızı e-posta veya Google ile bağlayın, 2FA ile koruyun ve oturumlarınızı yönetin.',
    accent: 'cyan',
    steps: [
      'Hesabım & Profil sekmesinden görünen adınızı, benzersiz kullanıcı adınızı, avatar çerçevesini, banner görselini ve profil efektini özelleştirebilirsiniz.',
      'Güvenlik & Oturum sekmesinden TOTP tabanlı İki Adımlı Doğrulama (2FA) kurabilir, tek kullanımlık kurtarma kodlarınızı saklayabilirsiniz.',
      'Giriş ekranındaki "Şifremi Unuttum" adımıyla e-postanıza sıfırlama bağlantısı gönderilir; bağlantıya tıkladığınızda yeni şifrenizi tek adımda belirleyebilirsiniz.',
      'Aktif Oturumlar listesinden diğer cihazlardaki açık oturumları anında kapatabilir ve tüm verilerinizi JSON olarak yedekleyebilirsiniz.',
    ],
    targetTab: 'security',
    targetLabel: 'Güvenlik Ayarlarına Git',
  },
  {
    id: 'servers-rbac',
    title: '2. Sunucu Kurma, Kategoriler ve Rol İzinleri',
    summary: 'Topluluğunuzu metin, duyuru, forum, ses ve sahne kanallarıyla yapılandırın.',
    accent: 'violet',
    steps: [
      'Sol sunucu çubuğundaki "+" butonuyla kendi topluluğunuzu kurabilir veya davet bağlantısı / keşfet dizini üzerinden mevcut sunuculara katılabilirsiniz.',
      'Sunucu Ayarları içinden kategoriler oluşturabilir, kanalları sıralayabilir, özel rol hiyerarşisi tanımlayabilir ve kanal bazlı izin geçersiz kılmaları ayarlayabilirsiniz.',
      'Duyuru kanalları topluluk bildirimleri, Forum kanalları konu başlıkları halinde tartışmalar, Sahne kanalları ise konuşmacı kontrollü yayınlar içindir.',
      'Sunucu Takviyesi (Boost) ile ses kalitesini, emoji yuvalarını ve özel sunucu rozetlerini açabilirsiniz.',
    ],
  },
  {
    id: 'messaging-tools',
    title: '3. Mesajlaşma, /Komutlar, Anket ve Zamanlama',
    summary: 'Gerçek zamanlı sohbet, dosya paylaşımı, sesli not, anket ve bot komutları.',
    accent: 'emerald',
    steps: [
      'Mesaj yazarken yanıtla, düzenle, sabitle, ilet, emoji tepkisi ekle ve alt konu (thread) başlatma özelliklerini mesaj menüsünden kullanabilirsiniz.',
      'Sohbet çubuğundan fotoğraf/video/dosya yükleyebilir, anlık anket oluşturabilir, sesli not kaydedebilir veya ileri tarihli mesaj zamanlayabilirsiniz.',
      'Resmi ORBIT botu kurulu kanallarda /yardim, /sunucu, /zar, /yazi-tura gibi eğik çizgi komutlarını kullanabilirsiniz.',
      'Üst çubuktaki arama simgesi veya Ctrl+K kısayoluyla mesajlar, kanallar, sunucular ve kullanıcılar arasında hızlıca geçiş yapabilirsiniz.',
    ],
    targetTab: 'scheduled',
    targetLabel: 'Zamanlanmış Mesajları Aç',
  },
  {
    id: 'voice-stream-games',
    title: '4. Ses Kanalları, Canlı Yayın ve Mini Oyunlar',
    summary: 'WebRTC ses odaları, ekran paylaşımı, Bas-Konuş ve oda içi etkinlikler.',
    accent: 'amber',
    steps: [
      'Herhangi bir ses veya sahne kanalına tıkladığınızda WebRTC sesli odaya bağlanırsınız; mikrofon, kulaklık, ekran paylaşımı ve kamera kontrolleri alt panelde yer alır.',
      'Ses, Video & Bas-Konuş ayarlarından mikrofon/hoparlör seçimi yapabilir, gürültü engellemeyi açabilir ve canlı mikrofon seviye testi çalıştırabilirsiniz.',
      'Bas-Konuş (Push-to-Talk) modunu aktif ettiğinizde yalnızca seçtiğiniz tuşa (Space, V veya Sol Alt) basılı tutarken sesiniz iletilir.',
      'Ses kanalı içinde katılımcılarla gerçek zamanlı mini oyunlar başlatabilir ve ekran paylaşımıyla canlı yayın yapabilirsiniz.',
    ],
    targetTab: 'voice',
    targetLabel: 'Ses & Mikrofon Testine Git',
  },
  {
    id: 'friends-safety',
    title: '5. Arkadaşlar, Grup DM, Engelleme ve Şikâyet',
    summary: 'Özel mesaj gizliliği, kullanıcı engelleme ve çok seçenekli moderasyon bildirimleri.',
    accent: 'rose',
    steps: [
      'Ana Sayfa görünümünden kullanıcı adı#etiket ile arkadaşlık isteği gönderebilir, gelen istekleri onaylayabilir ve çok kişili Grup DM odaları açabilirsiniz.',
      'Gizlilik & Engeller sekmesinden çevrimiçi durum görünürlüğünü, arkadaşlık isteklerini ve kimlerin size özel mesaj atabileceğini sınırlayabilirsiniz.',
      'Bir kullanıcıyı engellediğinizde doğrudan mesajları gizlenir ve istediğiniz anda profil menüsünden ya da Gizlilik sekmesinden engelini kaldırabilirsiniz.',
      'Topluluk kurallarını ihlal eden mesaj, kullanıcı veya sunucuları çok seçenekli şikâyet formuyla bildirebilirsiniz; geçerli katkılar Hata Avcısı rozeti kazandırır.',
    ],
    targetTab: 'privacy',
    targetLabel: 'Gizlilik & Engellere Git',
  },
];

const SHORTCUT_ITEMS = [
  { keys: 'Ctrl + K / Cmd + K', desc: 'Hızlı Arama ve Komut Paletini açar' },
  { keys: 'Enter', desc: 'Mesajı gönderir (Shift + Enter ile yeni satır)' },
  { keys: 'Esc', desc: 'Açık pencereyi, aramayı veya yanıt önizlemesini kapatır' },
  { keys: 'Space / V / Sol Alt', desc: 'Bas-Konuş aktifken basılı tutarak konuşma' },
];

const TERMS_SECTIONS = [
  {
    id: 'eligibility',
    title: '1. Hesap Oluşturma ve Kullanım Koşulları',
    body: 'ORBIT platformunu kullanabilmek için en az 13 yaşında (veya bulunduğunuz ülkedeki yasal dijital rüşt yaşında) olmanız gerekir. Kayıt sırasında doğru e-posta ve kullanıcı bilgileri sağlamanız, hesabınızın ve oturum anahtarlarınızın güvenliğini korumanız kendi sorumluluğunuzdadır. Her kullanıcı, hesabında gerçekleşen tüm etkinliklerden sorumludur.',
  },
  {
    id: 'conduct',
    title: '2. Topluluk Davranış İlkeleri ve Sıfır Tolerans',
    body: 'ORBIT; saygılı, kapsayıcı ve güvenli topluluk alanları sunmayı amaçlar. Taciz, nefret söylemi, tehdit, kişisel verilerin izinsiz ifşası (doxxing), reşit olmayanlara yönelik her türlü istismar, şiddet teşviki ve kimlik taklidi kesinlikle yasaktır. Sunucu sahipleri kendi kanallarında ek yerel kurallar belirleyebilir; ancak hiçbir topluluk kuralı platform genel kurallarının önüne geçemez.',
  },
  {
    id: 'content-spam',
    title: '3. Yasaklı İçerik, Spam ve Güvenlik İhlalleri',
    body: 'Zararlı yazılım dağıtımı, kimlik avı (phishing) bağlantıları, otomatik spam, API hız sınırlarını aşmaya yönelik istismarlar, yetkisiz veri kazıma ve diğer kullanıcıların oturumlarını ele geçirmeye dönük girişimler tespit edildiğinde ilgili hesap ve sunucular uyarı yapılmaksızın askıya alınabilir veya kalıcı olarak sonlandırılabilir.',
  },
  {
    id: 'ip-rights',
    title: '4. Fikri Mülkiyet ve Kullanıcı İçeriği',
    body: 'ORBIT üzerinde paylaştığınız mesajlar, görseller, dosyalar ve sunucu varlıkları üzerindeki fikri mülkiyet hakları size aittir. Paylaşım yaparak ORBIT altyapısının bu içerikleri yalnızca seçtiğiniz alıcılara, sunuculara ve yedekleme/önizleme mekanizmalarına iletmek üzere işlemesine sınırlı ve devredilemez bir teknik lisans vermiş olursunuz.',
  },
  {
    id: 'nitro-billing',
    title: '5. ORBIT Nitro Abonelik, İptal ve İade Şartları',
    body: 'ORBIT Nitro abonelikleri seçtiğiniz aylık veya yıllık dönemler üzerinden faturalandırılır ve ödeme işlemleri güvenli ödeme sağlayıcıları aracılığıyla gerçekleştirilir. Aboneliğinizi mevcut fatura döneminin bitiminden önce istediğiniz zaman iptal edebilirsiniz; iptal durumunda dönem sonuna kadar tüm Nitro ayrıcalıklarınız korunur.',
  },
  {
    id: 'moderation',
    title: '6. Moderasyon, Şikâyet ve İtiraz Süreci',
    body: 'Kullanıcılar kural ihlali oluşturan mesajları, profilleri veya sunucuları uygulama içindeki çok seçenekli şikâyet arayüzüyle bildirebilir. İncelemeler sonucunda içerik kaldırma, geçici kısıtlama veya hesap askıya alma uygulanabilir. Haksız olduğunu düşündüğünüz yaptırımlar için destek/iletişim kanalları üzerinden yeniden değerlendirme talep edebilirsiniz.',
  },
  {
    id: 'service-liability',
    title: '7. Hizmet Sürekliliği ve Değişiklikler',
    body: 'ORBIT, kesintisiz ve yüksek performanslı iletişim altyapısı sağlamak için düzenli bakım ve güvenlik güncellemeleri uygular. Planlı bakım, üçüncü taraf ağ kesintileri veya mücbir sebepler kaynaklı geçici erişim aksamalarından doğan dolaylı zararlardan sorumluluk kabul edilmez. Hizmet Şartları güncellendiğinde uygulama içinden güncel sürüm tarihi paylaşılır.',
  },
];

const POLICY_SECTIONS = [
  {
    id: 'collected-data',
    title: '1. İşlenen Veriler ve Toplama Yöntemi',
    body: 'Hesap oluşturduğunuzda adınız, kullanıcı adınız, e-posta adresiniz, isteğe bağlı profil biyografiniz, avatar/banner görselleriniz ve tercih ayarlarınız kaydedilir. Sohbet sırasında gönderdiğiniz mesajlar, tepkiler, sunucu üyelikleri, sesli oda katılım durumları ve güvenlik/oturum günlükleri (tarayıcı bilgisi, oturum oluşturma zamanı) hizmetin çalışması için işlenir.',
  },
  {
    id: 'purpose-usage',
    title: '2. Verilerin İşlenme Amaçları',
    body: 'Kişisel verileriniz yalnızca gerçek zamanlı mesaj ve ses iletişimini yürütmek, kimlik doğrulama ve 2FA güvenliğini sağlamak, şifre sıfırlama ve e-posta onay bağlantılarını iletmek, bildirim/hatırlatıcı zamanlamalarını çalıştırmak ve platform güvenliğini ihlal eden suistimalleri önlemek amacıyla işlenir. Verileriniz üçüncü taraf reklam ağlarına satılmaz.',
  },
  {
    id: 'security-architecture',
    title: '3. Teknik Güvenlik Önlemleri',
    body: 'Şifreleriniz geri döndürülemez kriptografik özetleme (Scrypt + tuzlama) ile saklanır. Oturumlar imzalı belirteçler ve HttpOnly çerez korumasıyla doğrulanır. İki Adımlı Doğrulama (TOTP), tek kullanımlık yedek kodlar, Webhook HMAC-SHA256 imzaları ve WebRTC DTLS-SRTP şifreli medya kanalları standart güvenlik katmanları olarak uygulanır.',
  },
  {
    id: 'third-parties',
    title: '4. Üçüncü Taraf Entegrasyonlar',
    body: 'Yalnızca etkinleştirdiğiniz veya kullandığınız özelliklere bağlı olarak sınırlı teknik veri paylaşımı yapılır: Google ile Giriş için OAuth kimlik doğrulaması, Nitro ödemeleri için Stripe ödeme altyapısı, şifre sıfırlama/onay mailleri için yapılandırılmış SMTP sunucusu ve GIF aramaları için Tenor arama sorgusu.',
  },
  {
    id: 'retention-rights',
    title: '5. Veri Saklama, Dışa Aktarma ve Silme Hakları (KVKK/GDPR)',
    body: 'Hesap ayarlarınızdaki "Verilerimi İndir (JSON)" aracıyla profil, rozet, seri ve mesaj verilerinizin taşınabilir bir kopyasını tek tıkla indirebilirsiniz. Hesabınızı "Hesap İşlemleri" bölümünden kalıcı olarak sildiğinizde kişisel profiliniz ve aktif oturumlarınız sistemden kaldırılır.',
  },
  {
    id: 'cookies-storage',
    title: '6. Çerezler ve Yerel Depolama Politikası',
    body: 'ORBIT, güvenli oturum kimliğinizi doğrulamak için zorunlu oturum çerezleri kullanır. Buna ek olarak tema tercihi (koyu/açık), arayüz konfor ayarları ve belge onay durumunuz tarayıcınızın yerel depolama alanında (localStorage) tutulur. Reklam takip çerezi kullanılmaz.',
  },
];

const TERMS_ACK_KEY = 'orbit_terms_ack_v1';
const PREF_CONSENT_KEY = 'orbit_local_prefs_consent_v1';

export function OrbitDocsSection({
  tab,
  onNavigateTab,
  onOpenNitro,
  onOpenBadges,
  onOpenAchievements,
  onExportData,
  exportingData = false,
  onCloseModal,
}: OrbitDocsSectionProps) {
  const { showToast } = useToast();
  const [guideSearch, setGuideSearch] = useState('');
  const [openTopicIds, setOpenTopicIds] = useState<Record<string, boolean>>({
    'account-security': true,
    'servers-rbac': true,
  });
  const [policySearch, setPolicySearch] = useState('');
  const [termsAck, setTermsAck] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TERMS_ACK_KEY);
    } catch {
      return null;
    }
  });
  const [prefConsent, setPrefConsent] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PREF_CONSENT_KEY) !== 'disabled';
    } catch {
      return true;
    }
  });

  const filteredGuideTopics = useMemo(() => {
    const q = guideSearch.trim().toLocaleLowerCase('tr-TR');
    if (!q) return GUIDE_TOPICS;
    return GUIDE_TOPICS.filter(
      (topic) =>
        topic.title.toLocaleLowerCase('tr-TR').includes(q) ||
        topic.summary.toLocaleLowerCase('tr-TR').includes(q) ||
        topic.steps.some((s) => s.toLocaleLowerCase('tr-TR').includes(q))
    );
  }, [guideSearch]);

  const filteredTerms = useMemo(() => {
    const q = policySearch.trim().toLocaleLowerCase('tr-TR');
    if (!q) return TERMS_SECTIONS;
    return TERMS_SECTIONS.filter(
      (s) => s.title.toLocaleLowerCase('tr-TR').includes(q) || s.body.toLocaleLowerCase('tr-TR').includes(q)
    );
  }, [policySearch]);

  const filteredPolicies = useMemo(() => {
    const q = policySearch.trim().toLocaleLowerCase('tr-TR');
    if (!q) return POLICY_SECTIONS;
    return POLICY_SECTIONS.filter(
      (s) => s.title.toLocaleLowerCase('tr-TR').includes(q) || s.body.toLocaleLowerCase('tr-TR').includes(q)
    );
  }, [policySearch]);

  const toggleTopic = (id: string) => {
    setOpenTopicIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const buildPlainTextDocument = (kind: 'terms' | 'policies') => {
    const header =
      kind === 'terms'
        ? 'ORBIT — HİZMET ŞARTLARI VE TOPLULUK İLKELERİ\nSürüm: 2.4 · Güncelleme: Kasım 2026\n\n'
        : 'ORBIT — GİZLİLİK, GÜVENLİK VE ÇEREZ POLİTİKASI\nSürüm: 2.4 · Güncelleme: Kasım 2026\n\n';
    const rows = (kind === 'terms' ? TERMS_SECTIONS : POLICY_SECTIONS).map((s) => `${s.title}\n${s.body}`);
    return `${header}${rows.join('\n\n')}\n`;
  };

  const handleCopyDoc = async (kind: 'terms' | 'policies') => {
    const text = buildPlainTextDocument(kind);
    try {
      await navigator.clipboard?.writeText(text);
      showToast(kind === 'terms' ? 'Hizmet şartları metni kopyalandı.' : 'Gizlilik politikası metni kopyalandı.', 'success');
    } catch {
      showToast('Panoya kopyalanamadı.', 'error');
    }
  };

  const handleDownloadDoc = (kind: 'terms' | 'policies') => {
    const text = buildPlainTextDocument(kind);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = kind === 'terms' ? 'orbit-hizmet-sartlari.txt' : 'orbit-gizlilik-politikasi.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Belge cihazınıza indirildi.', 'success');
  };

  const handleToggleTermsAck = () => {
    try {
      if (termsAck) {
        localStorage.removeItem(TERMS_ACK_KEY);
        setTermsAck(null);
        showToast('Hizmet şartları onay kaydı temizlendi.', 'info');
      } else {
        const nowIso = new Date().toISOString();
        localStorage.setItem(TERMS_ACK_KEY, nowIso);
        setTermsAck(nowIso);
        showToast('Hizmet Şartları ve Topluluk Kuralları onaylandı.', 'success');
      }
    } catch {
      showToast('Tercih tarayıcıda saklanamadı.', 'error');
    }
  };

  const handleTogglePrefConsent = () => {
    const next = !prefConsent;
    setPrefConsent(next);
    try {
      localStorage.setItem(PREF_CONSENT_KEY, next ? 'enabled' : 'disabled');
      showToast(next ? 'Arayüz tercihleri yerel depolaması aktif.' : 'Yerel tercih depolaması devre dışı bırakıldı.', 'info');
    } catch {
      showToast('Tercih güncellenemedi.', 'error');
    }
  };

  if (tab === 'about') {
    const pillars = [
      {
        title: 'Çok Kanallı İletişim',
        desc: 'Metin, duyuru, forum ve alt konu (thread) kanallarıyla topluluk sohbetlerini düzenli tutun.',
        icon: MessageSquare,
        tone: 'border-[#7C3AED]/30 bg-[#7C3AED]/10 text-[#7C3AED] dark:text-[#C084FC]',
      },
      {
        title: 'WebRTC Ses, Yayın & Oyunlar',
        desc: 'Düşük gecikmeli ses ve sahne odaları, ekran paylaşımı, kamera ve oda içi mini oyunlar.',
        icon: Gamepad2,
        tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
      },
      {
        title: 'Rol Hiyerarşisi & Güvenlik',
        desc: 'Kanal bazlı izin geçersiz kılmaları, TOTP 2FA, aktif oturum kontrolü ve güvenli e-posta sıfırlama.',
        icon: ShieldCheck,
        tone: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300',
      },
      {
        title: 'ORBIT Nitro & Rozet Ekosistemi',
        desc: 'Avatar çerçeveleri, profil efektleri, sunucu takviyeleri, günlük seriler ve nadir rozetler.',
        icon: Crown,
        tone: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300',
      },
    ];

    return (
      <div className="space-y-5 max-w-2xl">
        <div className="relative overflow-hidden rounded-2xl border border-[#7C3AED]/30 bg-gradient-to-br from-[#7C3AED]/15 via-cyan-500/10 to-emerald-500/10 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2 max-w-xl">
              <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-300">
                <Sparkles className="w-3.5 h-3.5" />
                ORBIT İletişim Platformu · Sürüm 2.4
              </div>
              <h4 className="text-xl font-bold font-display text-slate-900 dark:text-white">
                Sınırsız Sohbet, Sonsuz Bağlantı
              </h4>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                ORBIT; oyun toplulukları, çalışma grupları ve arkadaş çevreleri için tasarlanmış hızlı, güvenli ve mobil uyumlu yeni nesil iletişim merkezidir. Yazılı kanallar, WebRTC ses odaları, canlı ekran paylaşımı, mini oyunlar ve detaylı rol izinleri tek çatı altında çalışır.
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#7C3AED] to-cyan-500 text-white flex items-center justify-center shadow-lg shadow-[#7C3AED]/25 shrink-0">
              <Info className="w-6 h-6" />
            </div>
          </div>

          <div className="mt-4 pt-3.5 border-t border-slate-200/70 dark:border-white/10 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigateTab('guide')}
              className="h-9 px-3.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Kullanım Kılavuzunu Aç
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('terms')}
              className="h-9 px-3.5 rounded-xl border border-slate-200 dark:border-[#2E2E48] bg-white/80 dark:bg-[#151525] hover:bg-white dark:hover:bg-[#1D1D32] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Scale className="w-3.5 h-3.5 text-amber-500" />
              Hizmet Şartları
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('policies')}
              className="h-9 px-3.5 rounded-xl border border-slate-200 dark:border-[#2E2E48] bg-white/80 dark:bg-[#151525] hover:bg-white dark:hover:bg-[#1D1D32] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Shield className="w-3.5 h-3.5 text-cyan-500" />
              Gizlilik Politikası
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {pillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.title}
                className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50/70 dark:bg-[#10111B] space-y-2"
              >
                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${pillar.tone}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <p className="text-sm font-bold font-display text-slate-900 dark:text-white">{pillar.title}</p>
                <p className="text-xs leading-relaxed text-slate-500 dark:text-[#A1A1B5]">{pillar.desc}</p>
              </div>
            );
          })}
        </div>

        <div className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#10111B] space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
            Hızlı Keşif Bağlantıları
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {onOpenNitro && (
              <button
                type="button"
                onClick={() => {
                  onCloseModal();
                  onOpenNitro();
                }}
                className="p-3 rounded-xl border border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/15 text-left flex items-center justify-between gap-2 transition-colors"
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-300">
                  <Crown className="w-4 h-4 shrink-0" />
                  ORBIT Nitro Avantajları
                </span>
                <ExternalLink className="w-3.5 h-3.5 opacity-60 shrink-0" />
              </button>
            )}
            {onOpenBadges && (
              <button
                type="button"
                onClick={() => {
                  onCloseModal();
                  onOpenBadges();
                }}
                className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15 text-left flex items-center justify-between gap-2 transition-colors"
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-300">
                  <Award className="w-4 h-4 shrink-0" />
                  Rozet Kataloğu & Nadirlikler
                </span>
                <ExternalLink className="w-3.5 h-3.5 opacity-60 shrink-0" />
              </button>
            )}
            {onOpenAchievements && (
              <button
                type="button"
                onClick={() => {
                  onCloseModal();
                  onOpenAchievements();
                }}
                className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15 text-left flex items-center justify-between gap-2 transition-colors"
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-300">
                  <Flame className="w-4 h-4 shrink-0" />
                  Başarılar & Günlük Seri
                </span>
                <ExternalLink className="w-3.5 h-3.5 opacity-60 shrink-0" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigateTab('privacy')}
              className="p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 hover:bg-cyan-500/15 text-left flex items-center justify-between gap-2 transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-cyan-600 dark:text-cyan-300">
                <Users className="w-4 h-4 shrink-0" />
                Gizlilik & Engellenenler
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-60 shrink-0" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'guide') {
    const accentMap: Record<GuideTopic['accent'], string> = {
      violet: 'text-[#7C3AED] dark:text-[#C084FC] bg-[#7C3AED]/10 border-[#7C3AED]/30',
      emerald: 'text-emerald-600 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
      cyan: 'text-cyan-600 dark:text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
      amber: 'text-amber-600 dark:text-amber-300 bg-amber-500/10 border-amber-500/30',
      rose: 'text-rose-600 dark:text-rose-300 bg-rose-500/10 border-rose-500/30',
    };

    return (
      <div className="space-y-4 max-w-2xl">
        <div className="p-4 rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-500/10 via-cyan-500/10 to-transparent flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h4 className="text-sm font-bold font-display text-slate-900 dark:text-white flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-emerald-500" />
              ORBIT İnteraktif Kullanım Kılavuzu
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Platformun tüm özelliklerini adım adım keşfedin veya doğrudan ilgili ayara atlayın.
            </p>
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={guideSearch}
              onChange={(e) => setGuideSearch(e.target.value)}
              placeholder="Kılavuzda ara..."
              className="w-full h-9 pl-8 pr-3 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        <div className="space-y-2.5">
          {filteredGuideTopics.length === 0 ? (
            <div className="p-6 rounded-2xl border border-slate-200 dark:border-[#29293D] text-center text-xs text-slate-500 dark:text-[#A1A1B5]">
              &ldquo;{guideSearch}&rdquo; aramasıyla eşleşen bir kılavuz başlığı bulunamadı.
            </div>
          ) : (
            filteredGuideTopics.map((topic) => {
              const isOpen = Boolean(guideSearch.trim()) || Boolean(openTopicIds[topic.id]);
              return (
                <div
                  key={topic.id}
                  className="rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50/70 dark:bg-[#10111B] overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleTopic(topic.id)}
                    className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-slate-100/70 dark:hover:bg-[#171828] transition-colors"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">{topic.title}</p>
                      <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">{topic.summary}</p>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 border-t border-slate-200/70 dark:border-[#29293D] space-y-3">
                      <ul className="space-y-2 pt-2">
                        {topic.steps.map((step, idx) => (
                          <li key={idx} className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                            <span
                              className={`mt-0.5 w-5 h-5 rounded-md border text-[10px] font-bold flex items-center justify-center shrink-0 ${accentMap[topic.accent]}`}
                            >
                              {idx + 1}
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                      {topic.targetTab && topic.targetLabel && (
                        <button
                          type="button"
                          onClick={() => onNavigateTab(topic.targetTab!)}
                          className={`h-8 px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${accentMap[topic.accent]}`}
                        >
                          {topic.targetLabel}
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Keyboard Shortcuts */}
        <div className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#10111B] space-y-3">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-cyan-500" />
            <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
              Klavye Kısayolları
            </h5>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SHORTCUT_ITEMS.map((item) => (
              <div
                key={item.keys}
                className="p-2.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50/60 dark:bg-[#161726] flex flex-col gap-1"
              >
                <code className="text-[11px] font-mono font-bold text-cyan-600 dark:text-cyan-300">{item.keys}</code>
                <span className="text-[11px] text-slate-600 dark:text-[#A1A1B5]">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'terms') {
    return (
      <div className="space-y-4 max-w-2xl">
        <div className="p-4 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-transparent space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-300">
                <Scale className="w-4 h-4" />
                <span>Hizmet Şartları & Topluluk İlkeleri</span>
                <span className="text-[11px] font-mono text-slate-500 dark:text-[#A1A1B5]">· Sürüm 2.4 · Kasım 2026</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                ORBIT platformunu kullanırken geçerli olan hukuki şartlar, topluluk kuralları ve abonelik koşulları.
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => void handleCopyDoc('terms')}
                className="h-8 px-2.5 rounded-xl border border-slate-200 dark:border-[#2E2E48] bg-white/80 dark:bg-[#19192A] text-xs font-medium inline-flex items-center gap-1.5 hover:bg-white dark:hover:bg-[#222238]"
              >
                <Copy className="w-3.5 h-3.5 text-amber-500" />
                Kopyala
              </button>
              <button
                type="button"
                onClick={() => handleDownloadDoc('terms')}
                className="h-8 px-2.5 rounded-xl border border-slate-200 dark:border-[#2E2E48] bg-white/80 dark:bg-[#19192A] text-xs font-medium inline-flex items-center gap-1.5 hover:bg-white dark:hover:bg-[#222238]"
              >
                <Download className="w-3.5 h-3.5 text-amber-500" />
                İndir (.txt)
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={policySearch}
              onChange={(e) => setPolicySearch(e.target.value)}
              placeholder="Maddelerde ara (ör. Nitro, moderasyon, fikri mülkiyet)..."
              className="w-full h-9 pl-8 pr-3 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-amber-500"
            />
          </div>
        </div>

        <div className="space-y-2.5">
          {filteredTerms.length === 0 ? (
            <div className="p-6 rounded-2xl border border-slate-200 dark:border-[#29293D] text-center text-xs text-slate-500 dark:text-[#A1A1B5]">
              Aradığınız ifadeyle eşleşen madde bulunamadı.
            </div>
          ) : (
            filteredTerms.map((sec) => (
              <div
                key={sec.id}
                className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50/70 dark:bg-[#10111B] space-y-1.5"
              >
                <h5 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">{sec.title}</h5>
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{sec.body}</p>
              </div>
            ))
          )}
        </div>

        <div className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#10111B] flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-slate-900 dark:text-white">
              Hizmet Şartları Okuma & Onay Durumu
            </p>
            <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">
              {termsAck
                ? `Onaylandı (${new Date(termsAck).toLocaleString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })})`
                : 'Henüz cihazınızda manuel onay kaydı işaretlenmedi.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggleTermsAck}
            className={`h-9 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
              termsAck
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/35'
                : 'bg-amber-500 hover:bg-amber-600 text-white'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            {termsAck ? 'Okundu ve Onaylandı' : 'Okudum, Onaylıyorum'}
          </button>
        </div>
      </div>
    );
  }

  // tab === 'policies'
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="p-4 rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 via-sky-500/5 to-transparent space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-600 dark:text-cyan-300">
              <FileText className="w-4 h-4" />
              <span>Gizlilik, Güvenlik & Çerez Politikası</span>
              <span className="text-[11px] font-mono text-slate-500 dark:text-[#A1A1B5]">· KVKK / GDPR Uyumlu</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Kişisel verilerinizin nasıl korunduğu, şifreleme mimarisi ve veri kontrol haklarınız.
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => void handleCopyDoc('policies')}
              className="h-8 px-2.5 rounded-xl border border-slate-200 dark:border-[#2E2E48] bg-white/80 dark:bg-[#19192A] text-xs font-medium inline-flex items-center gap-1.5 hover:bg-white dark:hover:bg-[#222238]"
            >
              <Copy className="w-3.5 h-3.5 text-cyan-500" />
              Kopyala
            </button>
            <button
              type="button"
              onClick={() => handleDownloadDoc('policies')}
              className="h-8 px-2.5 rounded-xl border border-slate-200 dark:border-[#2E2E48] bg-white/80 dark:bg-[#19192A] text-xs font-medium inline-flex items-center gap-1.5 hover:bg-white dark:hover:bg-[#222238]"
            >
              <Download className="w-3.5 h-3.5 text-cyan-500" />
              İndir (.txt)
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={policySearch}
            onChange={(e) => setPolicySearch(e.target.value)}
            placeholder="Politikalarda ara (ör. 2FA, çerez, veri indirme)..."
            className="w-full h-9 pl-8 pr-3 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      <div className="space-y-2.5">
        {filteredPolicies.length === 0 ? (
          <div className="p-6 rounded-2xl border border-slate-200 dark:border-[#29293D] text-center text-xs text-slate-500 dark:text-[#A1A1B5]">
            Aradığınız ifadeyle eşleşen politika bölümü bulunamadı.
          </div>
        ) : (
          filteredPolicies.map((sec) => (
            <div
              key={sec.id}
              className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50/70 dark:bg-[#10111B] space-y-1.5"
            >
              <h5 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">{sec.title}</h5>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{sec.body}</p>
            </div>
          ))
        )}
      </div>

      {/* Interactive Cookie & Data Controls */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#10111B] space-y-3">
        <div className="flex items-center gap-2">
          <Cookie className="w-4 h-4 text-cyan-500" />
          <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
            Çerez Tercihleri & Veri Hakları
          </h5>
        </div>

        <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50/60 dark:bg-[#161726]">
          <div>
            <p className="text-xs font-semibold text-slate-900 dark:text-white">Zorunlu Oturum & Güvenlik Çerezleri</p>
            <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">
              Giriş oturumu ve CSRF güvenliği için her zaman aktiftir.
            </p>
          </div>
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-300 shrink-0">Her Zaman Açık</span>
        </div>

        <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50/60 dark:bg-[#161726] cursor-pointer">
          <div>
            <p className="text-xs font-semibold text-slate-900 dark:text-white">Arayüz & Yerel Tercih Depolaması</p>
            <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">
              Tema, ses cihazı ve belge onay tercihlerini cihazınızda hatırlar.
            </p>
          </div>
          <input type="checkbox" checked={prefConsent} onChange={handleTogglePrefConsent} />
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {onExportData && (
            <button
              type="button"
              disabled={exportingData}
              onClick={onExportData}
              className="h-9 px-3.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              {exportingData ? 'Hazırlanıyor...' : 'Verilerimi JSON Olarak İndir'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigateTab('security')}
            className="h-9 px-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] hover:bg-slate-100 dark:hover:bg-[#1D1D32] text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Lock className="w-3.5 h-3.5 text-[#A855F7]" />
            Güvenlik & 2FA Ayarları
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('privacy')}
            className="h-9 px-3.5 rounded-xl border border-slate-200 dark:border-[#29293D] hover:bg-slate-100 dark:hover:bg-[#1D1D32] text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Server className="w-3.5 h-3.5 text-emerald-500" />
            Gizlilik & Engeller
          </button>
        </div>
      </div>
    </div>
  );
}
