import { useEffect, useMemo, useState } from 'react';
import {
  Award,
  Compass,
  Hash,
  MessageSquare,
  Mic,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  User,
  Volume2,
  X,
} from 'lucide-react';
import { useAuth } from '../client/AuthContext.tsx';
import { useVoice } from '../client/VoiceContext.tsx';
import type { Channel, DirectConversation, ServerSummary } from '../shared/types.ts';

interface PaletteItem {
  id: string;
  title: string;
  subtitle: string;
  kind: 'channel' | 'server' | 'dm' | 'action';
  icon: 'hash' | 'voice' | 'server' | 'dm' | 'action' | 'badge' | 'theme' | 'settings' | 'profile';
  action: () => void;
}

interface Props {
  servers: ServerSummary[];
  channels: Channel[];
  activeServer: ServerSummary | null;
  conversations: DirectConversation[];
  onClose: () => void;
  onNavigate: (path: string) => void;
  onOpenSettings: () => void;
  onOpenMyProfile: () => void;
  onOpenBadgeCatalog: () => void;
  onOpenCreateServer: () => void;
  onToggleTheme: () => void;
}

export function CommandPaletteModal({
  servers,
  channels,
  activeServer,
  conversations,
  onClose,
  onNavigate,
  onOpenSettings,
  onOpenMyProfile,
  onOpenBadgeCatalog,
  onOpenCreateServer,
  onToggleTheme,
}: Props) {
  const { profile: me, settings } = useAuth();
  const voice = useVoice();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];

    // Channels of current server first
    if (activeServer) {
      for (const ch of channels) {
        if (ch.type === 'category') continue;
        list.push({
          id: `ch-${ch.id}`,
          title: `#${ch.name}`,
          subtitle: `${activeServer.name} · ${ch.type === 'voice' ? 'Ses Kanalı' : ch.type === 'forum' ? 'Forum' : 'Kanal'}`,
          kind: 'channel',
          icon: ch.type === 'voice' ? 'voice' : 'hash',
          action: () => onNavigate(`/channels/${activeServer.id}/${ch.id}`),
        });
      }
    }

    // DMs
    for (const conv of conversations) {
      const peer = !conv.isGroup ? conv.members.find((m) => m.userId !== me?.userId) : null;
      const title = conv.isGroup ? conv.name || 'Grup Sohbeti' : peer?.displayName || 'Sohbet';
      list.push({
        id: `dm-${conv.id}`,
        title,
        subtitle: peer ? `@${peer.username} · Özel Mesaj` : 'Grup Sohbeti',
        kind: 'dm',
        icon: 'dm',
        action: () => onNavigate(`/channels/@me/${conv.id}`),
      });
    }

    // Servers
    for (const s of servers) {
      list.push({
        id: `srv-${s.id}`,
        title: s.name,
        subtitle: `${s.memberCount} üye · Sunucuya Git`,
        kind: 'server',
        icon: 'server',
        action: () => onNavigate(`/channels/${s.id}`),
      });
    }

    // Quick Actions
    list.push(
      {
        id: 'act-profile',
        title: 'Profilimi Aç & Düzenle',
        subtitle: 'Profil kartı, biyografi, çerçeve ve rozetler',
        kind: 'action',
        icon: 'profile',
        action: onOpenMyProfile,
      },
      {
        id: 'act-badges',
        title: 'Rozet Kataloğu (İlk 100 Orbit Üyesi)',
        subtitle: 'Rozet basitliği ve kaç kişide olduğunu gör',
        kind: 'action',
        icon: 'badge',
        action: onOpenBadgeCatalog,
      },
      {
        id: 'act-settings',
        title: 'Kullanıcı Ayarları',
        subtitle: 'Hesap, görünüm, bildirimler ve gizlilik',
        kind: 'action',
        icon: 'settings',
        action: onOpenSettings,
      },
      {
        id: 'act-theme',
        title: settings?.theme === 'light' ? 'Koyu Temaya Geç' : 'Açık Temaya Geç',
        subtitle: 'Görünüm temasını tek tıkla değiştir',
        kind: 'action',
        icon: 'theme',
        action: onToggleTheme,
      },
      {
        id: 'act-new-server',
        title: 'Yeni Sunucu Kur',
        subtitle: 'Kendi topluluğunu oluştur',
        kind: 'action',
        icon: 'action',
        action: onOpenCreateServer,
      },
      {
        id: 'act-discover',
        title: 'Toplulukları Keşfet',
        subtitle: 'Herkese açık ORBIT sunucularına katıl',
        kind: 'action',
        icon: 'action',
        action: () => onNavigate('/discover'),
      }
    );

    if (voice.activeRoom) {
      list.unshift({
        id: 'act-voice-mute',
        title: voice.muted ? 'Mikrofonu Aç' : 'Mikrofonu Sustur',
        subtitle: `${voice.activeRoom.roomTitle} · Ses Kontrolü`,
        kind: 'action',
        icon: 'voice',
        action: () => void voice.toggleMute(),
      });
    }

    const q = query.trim().toLowerCase();
    if (!q) return list.slice(0, 14);
    return list.filter((it) => `${it.title} ${it.subtitle}`.toLowerCase().includes(q)).slice(0, 14);
  }, [
    activeServer,
    channels,
    conversations,
    servers,
    me?.userId,
    settings?.theme,
    voice,
    query,
    onNavigate,
    onOpenMyProfile,
    onOpenBadgeCatalog,
    onOpenSettings,
    onToggleTheme,
    onOpenCreateServer,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const execute = (item: PaletteItem) => {
    onClose();
    item.action();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 backdrop-blur-sm p-4 pt-16 sm:pt-24" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-2xl overflow-hidden animate-orbit-enter"
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-[#29293D] flex items-center gap-2.5">
          <Search className="w-4 h-4 text-[#A855F7] shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((i) => Math.max(0, i - 1));
              }
              if (e.key === 'Enter' && items[selectedIndex]) {
                e.preventDefault();
                execute(items[selectedIndex]);
              }
            }}
            placeholder="Sunucu, kanal, kişi veya komut ara..."
            className="flex-1 bg-transparent text-sm focus:outline-none text-slate-900 dark:text-[#F8FAFC]"
          />
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-[#F8FAFC] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2 space-y-0.5">
          {items.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-[#A1A1B5]">Eşleşen sonuç bulunamadı.</p>
          ) : (
            items.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => execute(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full px-3 py-2.5 rounded-xl flex items-center gap-3 text-left transition-colors ${
                  idx === selectedIndex
                    ? 'bg-[#7C3AED]/20 text-[#7C3AED] dark:text-[#F8FAFC]'
                    : 'hover:bg-slate-100 dark:hover:bg-[#19192A]'
                }`}
              >
                <span className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] flex items-center justify-center shrink-0 text-[#A855F7]">
                  {item.icon === 'hash' && <Hash className="w-4 h-4" />}
                  {item.icon === 'voice' && (item.id === 'act-voice-mute' ? <Mic className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />)}
                  {item.icon === 'dm' && <MessageSquare className="w-4 h-4" />}
                  {item.icon === 'server' && <Compass className="w-4 h-4" />}
                  {item.icon === 'badge' && <Award className="w-4 h-4 text-[#C084FC]" />}
                  {item.icon === 'settings' && <Settings className="w-4 h-4" />}
                  {item.icon === 'profile' && <User className="w-4 h-4" />}
                  {item.icon === 'theme' && (settings?.theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />)}
                  {item.icon === 'action' && <Plus className="w-4 h-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{item.title}</p>
                  <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] truncate">{item.subtitle}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
