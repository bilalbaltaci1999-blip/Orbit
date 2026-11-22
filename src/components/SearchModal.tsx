import React, { useEffect, useState } from 'react';
import { Calendar, Hash, Loader2, MessageSquare, Search, Server, User, X } from 'lucide-react';
import { apiFetch } from '../client/api.ts';
import type { ChatMessage, UserProfile } from '../shared/types.ts';
import { UserAvatar } from './UserAvatar.tsx';

interface Props {
  activeServerId?: string;
  onClose: () => void;
  onNavigateChannel: (serverId: string, channelId: string) => void;
  onOpenProfile: (userId: string) => void;
}

type SearchResults = {
  messages: Array<ChatMessage & { channelName: string; serverId: string }>;
  channels: Array<{ id: string; server_id: string; name: string; type: string }>;
  users: UserProfile[];
  servers: Array<{ id: string; name: string; description: string }>;
};

export function SearchModal({ activeServerId, onClose, onNavigateChannel, onOpenProfile }: Props) {
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  const [results, setResults] = useState<SearchResults>({
    messages: [],
    channels: [],
    users: [],
    servers: [],
  });

  const runSearch = async (qVal: string, fromVal: string, toVal: string) => {
    setSearchError('');
    setLoading(true);
    setHasSearched(true);
    try {
      const params = new URLSearchParams();
      if (qVal.trim()) params.set('q', qVal.trim());
      if (activeServerId) params.set('serverId', activeServerId);
      if (fromVal) params.set('from', fromVal);
      if (toVal) params.set('to', toVal);
      const res = await apiFetch<SearchResults>(`/search?${params.toString()}`);
      setResults(res);
    } finally {
      setLoading(false);
    }
  };

  // Debounced live search when query >= 2 chars or dates change
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 && !fromDate && !toDate) {
      if (trimmed.length === 0 && !fromDate && !toDate) {
        setResults({ messages: [], channels: [], users: [], servers: [] });
        setHasSearched(false);
      }
      return;
    }
    const timer = window.setTimeout(() => {
      void runSearch(trimmed, fromDate, toDate);
    }, 280);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, fromDate, toDate, activeServerId]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() && !fromDate && !toDate) {
      setSearchError('Aramak için bir kelime yazın veya tarih seçin.');
      return;
    }
    await runSearch(query, fromDate, toDate);
  };

  const totalCount =
    results.messages.length + results.channels.length + results.users.length + results.servers.length;
  const hasDateActive = Boolean(fromDate || toDate);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-3 pt-10 sm:pt-14"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#141522] border border-slate-200 dark:border-[#2C2D44] shadow-2xl overflow-hidden flex flex-col max-h-[58dvh] animate-orbit-enter"
      >
        <form
          noValidate
          onSubmit={handleSearch}
          className="px-3.5 py-2.5 border-b border-slate-200 dark:border-[#2C2D44] bg-slate-50/70 dark:bg-[#10111C] space-y-2"
        >
          <div className="flex items-center gap-2 h-10">
            <Search className="w-4 h-4 text-cyan-500 shrink-0" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (searchError) setSearchError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
              }}
              placeholder="Mesaj, kanal veya kullanıcı ara..."
              aria-invalid={Boolean(searchError)}
              className="flex-1 bg-transparent text-sm text-slate-900 dark:text-[#F8FAFC] placeholder:text-slate-400 dark:placeholder:text-[#A1A1B5]/80 focus:outline-none min-w-0"
            />
            <button
              type="button"
              onClick={() => setDateFilterOpen(!dateFilterOpen)}
              title="Tarih Filtresi"
              className={`h-7 px-2 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1 shrink-0 transition-colors ${
                dateFilterOpen || hasDateActive
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-600 dark:text-cyan-300'
                  : 'border-slate-200 dark:border-[#2C2D44] text-slate-500 dark:text-[#A1A1B5] hover:border-cyan-500/40'
              }`}
            >
              <Calendar className="w-3 h-3" />
              <span className="hidden sm:inline">Tarih</span>
            </button>
            <button
              type="submit"
              className="h-7 px-2.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold shrink-0 transition-colors"
            >
              Ara
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Aramayı kapat"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {searchError && (
            <p role="alert" className="text-[11px] text-[#EF4444]">
              {searchError}
            </p>
          )}

          {dateFilterOpen && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/70 dark:border-[#2C2D44]/70 text-[11px] text-slate-500 dark:text-[#A1A1B5]">
              <span>Tarih:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  if (searchError) setSearchError('');
                }}
                className="h-7 px-2 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#2C2D44] text-[11px]"
              />
              <span>—</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  if (searchError) setSearchError('');
                }}
                className="h-7 px-2 rounded-lg bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#2C2D44] text-[11px]"
              />
              {hasDateActive && (
                <button
                  type="button"
                  onClick={() => {
                    setFromDate('');
                    setToDate('');
                  }}
                  className="text-[11px] text-rose-500 hover:underline ml-auto"
                >
                  Temizle
                </button>
              )}
            </div>
          )}
        </form>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading ? (
            <div className="py-6 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-500" />
              <span>Aranıyor...</span>
            </div>
          ) : totalCount === 0 ? (
            <div className="py-5 text-center space-y-1">
              <p className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">
                {hasSearched ? 'Eşleşen sonuç bulunamadı.' : 'En az 2 karakter yazarak hızlı arama yapın.'}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-[#A1A1B5]/70">
                Yalnızca erişim izninizin bulunduğu kanal ve mesajlar listelenir.
              </p>
            </div>
          ) : (
            <>
              {results.messages.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600 dark:text-[#C084FC] flex items-center gap-1.5 px-1">
                    <MessageSquare className="w-3 h-3" />
                    Mesajlar ({results.messages.length})
                  </p>
                  {results.messages.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onNavigateChannel(m.serverId, m.channelId!);
                        onClose();
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl border border-slate-200 dark:border-[#2C2D44] bg-slate-50/70 dark:bg-[#19192A]/70 hover:border-violet-500/50 space-y-0.5 transition-colors"
                    >
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{m.author.displayName}</span>
                        <span className="font-mono text-violet-500 dark:text-[#C084FC]">#{m.channelName}</span>
                      </div>
                      <p className="text-xs text-slate-700 dark:text-[#F8FAFC] line-clamp-2">{m.content}</p>
                    </button>
                  ))}
                </div>
              )}

              {results.channels.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 px-1">
                    <Hash className="w-3 h-3" />
                    Kanallar ({results.channels.length})
                  </p>
                  {results.channels.map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => {
                        onNavigateChannel(ch.server_id, ch.id);
                        onClose();
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-emerald-500/10 flex items-center gap-2 text-xs font-medium transition-colors"
                    >
                      <Hash className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="truncate">{ch.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {results.users.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 flex items-center gap-1.5 px-1">
                    <User className="w-3 h-3" />
                    Kullanıcılar ({results.users.length})
                  </p>
                  {results.users.map((u) => (
                    <button
                      key={u.userId}
                      type="button"
                      onClick={() => {
                        onOpenProfile(u.userId);
                        onClose();
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-sky-500/10 flex items-center gap-2.5 text-xs transition-colors"
                    >
                      <UserAvatar src={u.avatarUrl} name={u.displayName} status={u.status} size="xs" />
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{u.displayName}</p>
                        <p className="text-[11px] font-mono text-slate-400 truncate">
                          {u.username}
                          <span className="text-sky-400">#{u.discriminator || '0000'}</span>
                        </p>
                      </div>
                      <User className="w-3.5 h-3.5 text-sky-400 ml-auto shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {results.servers.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5 px-1">
                    <Server className="w-3 h-3" />
                    Sunucular ({results.servers.length})
                  </p>
                  {results.servers.map((s) => (
                    <div
                      key={s.id}
                      className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-[#2C2D44] flex items-center gap-2 text-xs"
                    >
                      <Server className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="font-semibold truncate">{s.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
