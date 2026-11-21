import React, { useState } from 'react';
import { Hash, Search, Server, User, X } from 'lucide-react';
import { apiFetch } from '../client/api.ts';
import type { ChatMessage, UserProfile } from '../shared/types.ts';
import { UserAvatar } from './UserAvatar.tsx';

interface Props {
  activeServerId?: string;
  onClose: () => void;
  onNavigateChannel: (serverId: string, channelId: string) => void;
  onOpenProfile: (userId: string) => void;
}

export function SearchModal({ activeServerId, onClose, onNavigateChannel, onOpenProfile }: Props) {
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  const [results, setResults] = useState<{
    messages: Array<ChatMessage & { channelName: string; serverId: string }>;
    channels: Array<{ id: string; server_id: string; name: string; type: string }>;
    users: UserProfile[];
    servers: Array<{ id: string; name: string; description: string }>;
  }>({ messages: [], channels: [], users: [], servers: [] });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() && !fromDate && !toDate) {
      setSearchError('Arama yapmak için bir kelime yazın veya tarih aralığı seçin.');
      return;
    }
    setSearchError('');
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (activeServerId) params.set('serverId', activeServerId);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const res = await apiFetch<typeof results>(`/search?${params.toString()}`);
      setResults(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 backdrop-blur-sm p-4 pt-16" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-2xl overflow-hidden flex flex-col max-h-[80dvh] animate-orbit-enter"
      >
        <form noValidate onSubmit={handleSearch} className="p-4 border-b border-slate-200 dark:border-[#29293D] space-y-3">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-[#C084FC] shrink-0" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (searchError) setSearchError('');
              }}
              placeholder="Mesajlarda, kanallarda, kullanıcılarda veya sunucularda ara..."
              aria-invalid={Boolean(searchError)}
              className="flex-1 bg-transparent text-sm focus:outline-none"
            />
            <button type="submit" className="h-8 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors">
              Ara
            </button>
            <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          {searchError && (
            <p role="alert" className="text-xs text-[#EF4444]">
              {searchError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-[#A1A1B5]">
            <span>Tarih aralığı:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                if (searchError) setSearchError('');
              }}
              className="h-7 px-2 rounded-lg bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D]"
            />
            <span>—</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                if (searchError) setSearchError('');
              }}
              className="h-7 px-2 rounded-lg bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D]"
            />
          </div>
        </form>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {loading && <p className="text-center text-xs text-slate-400 py-8">Aranıyor...</p>}

          {!loading &&
            results.messages.length === 0 &&
            results.channels.length === 0 &&
            results.users.length === 0 &&
            results.servers.length === 0 && (
              <p className="text-center text-xs text-slate-400 py-8">
                Yalnızca erişim izninizin bulunduğu kanal ve mesajlar arasında arama yapılır.
              </p>
            )}

          {results.messages.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">Mesajlar ({results.messages.length})</p>
              {results.messages.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onNavigateChannel(m.serverId, m.channelId!);
                    onClose();
                  }}
                  className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500/40 space-y-1"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{m.author.displayName}</span>
                    <span>#{m.channelName}</span>
                  </div>
                  <p className="text-sm line-clamp-2">{m.content}</p>
                </button>
              ))}
            </div>
          )}

          {results.channels.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">Kanallar ({results.channels.length})</p>
              {results.channels.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => {
                    onNavigateChannel(ch.server_id, ch.id);
                    onClose();
                  }}
                  className="w-full text-left p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-[#19192A] flex items-center gap-2 text-sm transition-colors"
                >
                  <Hash className="w-4 h-4 text-slate-400" />
                  <span>{ch.name}</span>
                </button>
              ))}
            </div>
          )}

          {results.users.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">Kullanıcılar ({results.users.length})</p>
              {results.users.map((u) => (
                <button
                  key={u.userId}
                  type="button"
                  onClick={() => {
                    onOpenProfile(u.userId);
                    onClose();
                  }}
                  className="w-full text-left p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-[#19192A] flex items-center gap-2.5 text-sm transition-colors"
                >
                  <UserAvatar src={u.avatarUrl} name={u.displayName} status={u.status} size="sm" />
                  <div>
                    <p className="font-medium">{u.displayName}</p>
                    <p className="text-xs font-mono text-slate-400">
                      {u.username}
                      <span className="text-indigo-400">#{u.discriminator || '0000'}</span>
                    </p>
                  </div>
                  <User className="w-3.5 h-3.5 text-slate-400 ml-auto" />
                </button>
              ))}
            </div>
          )}

          {results.servers.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">Sunucular ({results.servers.length})</p>
              {results.servers.map((s) => (
                <div key={s.id} className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-2 text-sm">
                  <Server className="w-4 h-4 text-indigo-400" />
                  <span className="font-medium">{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
