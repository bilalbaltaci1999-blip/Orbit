import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ban, Check, Compass, MessageSquare, Search, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { apiFetch, ApiError, resolveMediaUrl } from '../client/api.ts';
import { useToast } from '../client/ToastContext.tsx';
import { wsClient } from '../client/wsClient.ts';
import type { FriendshipRecord, ServerSummary, UserProfile } from '../shared/types.ts';
import { getStatusLabel, UserAvatar } from './UserAvatar.tsx';

export function FriendsView({
  onOpenDm,
  onOpenProfile,
}: {
  onOpenDm: (conversationId: string) => void;
  onOpenProfile: (userId: string) => void;
}) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<'online' | 'all' | 'pending' | 'blocked' | 'add'>('all');
  const [friends, setFriends] = useState<FriendshipRecord[]>([]);
  const [blocked, setBlocked] = useState<Array<{ createdAt: string; user: UserProfile }>>([]);
  const [addInput, setAddInput] = useState('');
  const [addError, setAddError] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedForGroup, setSelectedForGroup] = useState<string[]>([]);
  const [groupError, setGroupError] = useState('');

  const loadFriends = useCallback(async () => {
    try {
      const [fr, bl] = await Promise.all([
        apiFetch<{ friends: FriendshipRecord[] }>('/friends'),
        apiFetch<{ blocked: Array<{ createdAt: string; user: UserProfile }> }>('/blocks'),
      ]);
      setFriends(fr.friends);
      setBlocked(bl.blocked);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  useEffect(() => {
    return wsClient.onEvent((ev) => {
      if (ev.type === 'friends:updated' || ev.type === 'presence:update') {
        void loadFriends();
      }
    });
  }, [loadFriends]);

  useEffect(() => {
    if (tab !== 'add' || addInput.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiFetch<{ users: UserProfile[] }>(`/users/search?q=${encodeURIComponent(addInput.trim())}`);
        setSearchResults(res.users);
      } catch {
        setSearchResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [addInput, tab]);

  const sendRequest = async (usernameOrId: string) => {
    try {
      await apiFetch('/friends/request', { method: 'POST', body: JSON.stringify({ usernameOrId }) });
      showToast('Arkadaşlık isteği gönderildi.', 'success');
      setAddInput('');
      void loadFriends();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'İstek gönderilemedi.', 'error');
    }
  };

  const startDm = async (peerId: string) => {
    try {
      const res = await apiFetch<{ conversation: { id: string } }>('/dm/conversations', {
        method: 'POST',
        body: JSON.stringify({ participantIds: [peerId] }),
      });
      onOpenDm(res.conversation.id);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Sohbet başlatılamadı.', 'error');
    }
  };

  const createGroupDm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedForGroup.length < 2) {
      setGroupError('Grup sohbeti başlatmak için en az 2 arkadaş seçmelisiniz.');
      return;
    }
    setGroupError('');
    try {
      const res = await apiFetch<{ conversation: { id: string } }>('/dm/conversations', {
        method: 'POST',
        body: JSON.stringify({ participantIds: selectedForGroup, name: groupName.trim() || 'Grup Sohbeti' }),
      });
      setGroupModalOpen(false);
      setGroupName('');
      setSelectedForGroup([]);
      onOpenDm(res.conversation.id);
    } catch (err) {
      setGroupError(err instanceof ApiError ? err.message : 'Grup oluşturulamadı.');
    }
  };

  const accepted = friends.filter((f) => f.status === 'accepted');
  const onlineFriends = accepted.filter((f) => f.friend.isOnline);
  const pending = friends.filter((f) => f.status === 'pending');

  const visibleList = tab === 'online' ? onlineFriends : tab === 'all' ? accepted : [];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-[#29293D] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setTab('online')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              tab === 'online' ? 'bg-[#7C3AED] text-white' : 'text-slate-600 dark:text-[#A1A1B5] hover:bg-slate-200/60 dark:hover:bg-[#19192A]'
            }`}
          >
            Çevrimiçi ({onlineFriends.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              tab === 'all' ? 'bg-[#7C3AED] text-white' : 'text-slate-600 dark:text-[#A1A1B5] hover:bg-slate-200/60 dark:hover:bg-[#19192A]'
            }`}
          >
            Tümü ({accepted.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('pending')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              tab === 'pending' ? 'bg-[#7C3AED] text-white' : 'text-slate-600 dark:text-[#A1A1B5] hover:bg-slate-200/60 dark:hover:bg-[#19192A]'
            }`}
          >
            Bekleyenler ({pending.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('blocked')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              tab === 'blocked' ? 'bg-[#7C3AED] text-white' : 'text-slate-600 dark:text-[#A1A1B5] hover:bg-slate-200/60 dark:hover:bg-[#19192A]'
            }`}
          >
            Engellenenler ({blocked.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('add')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === 'add' ? 'bg-[#22C55E] text-slate-950' : 'bg-[#22C55E]/15 text-emerald-600 dark:text-[#22C55E] hover:bg-[#22C55E]/25'
            }`}
          >
            Arkadaş Ekle
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            setGroupError('');
            setGroupModalOpen(true);
          }}
          className="h-8 px-3 rounded-lg border border-slate-200 dark:border-[#29293D] dark:bg-[#19192A] text-xs font-medium flex items-center gap-1.5 whitespace-nowrap hover:border-[#A855F7]/60"
        >
          <Users className="w-3.5 h-3.5 text-[#C084FC]" />
          Grup DM
        </button>
      </div>

      {/* Compact status summary strip */}
      <div className="px-4 sm:px-6 py-2 border-b border-slate-100 dark:border-[#29293D]/60 bg-slate-50/70 dark:bg-[#10111B]/50 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-slate-500 dark:text-[#A1A1B5] tabular-nums">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
          Çevrimiçi Arkadaş: <strong className="text-slate-900 dark:text-[#F8FAFC] font-mono">{onlineFriends.length}</strong>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
          Bekleyen İstek: <strong className="text-slate-900 dark:text-[#F8FAFC] font-mono">{pending.length}</strong>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
          Engelli: <strong className="text-slate-900 dark:text-[#F8FAFC] font-mono">{blocked.length}</strong>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {tab === 'add' && (
          <div className="max-w-xl space-y-5">
            <div>
              <h3 className="text-base font-bold font-display">Arkadaş Ekle</h3>
              <p className="text-xs text-slate-500 dark:text-[#A1A1B5] mt-1">
                Kullanıcı adıyla arama yapın veya tam kullanıcı adını girerek istek gönderin.
              </p>
            </div>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (!addInput.trim()) {
                  setAddError('Lütfen arkadaşlık isteği göndermek için kullanıcı adı girin.');
                  return;
                }
                setAddError('');
                void sendRequest(addInput.trim());
              }}
              className="space-y-2"
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={addInput}
                  onChange={(e) => {
                    setAddInput(e.target.value);
                    if (addError) setAddError('');
                  }}
                  placeholder="kullanici_adi#1234"
                  aria-invalid={Boolean(addError)}
                  className={`flex-1 h-11 px-4 rounded-xl bg-white dark:bg-[#19192A] border ${
                    addError ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                  } text-sm focus:outline-none focus:ring-2 focus:ring-[#A855F7]`}
                />
                <button
                  type="submit"
                  className="h-11 px-5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold whitespace-nowrap transition-colors"
                >
                  İstek Gönder
                </button>
              </div>
              {addError && (
                <p role="alert" className="text-xs text-[#EF4444]">
                  {addError}
                </p>
              )}
            </form>

            {searchResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-400 dark:text-[#A1A1B5]">Eşleşen Kullanıcılar</p>
                {searchResults.map((u) => (
                  <div
                    key={u.userId}
                    className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#151522]"
                  >
                    <button type="button" onClick={() => onOpenProfile(u.userId)} className="flex items-center gap-3 text-left">
                      <UserAvatar src={u.avatarUrl} name={u.displayName} status={u.status} />
                      <div>
                        <p className="text-sm font-semibold">{u.displayName}</p>
                        <p className="text-xs font-mono text-slate-400 dark:text-[#A1A1B5]">
                          {u.username}
                          <span className="text-[#C084FC]">#{u.discriminator || '0000'}</span>
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendRequest(`${u.username}#${u.discriminator || '0000'}`)}
                      className="h-9 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-medium flex items-center gap-1.5"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Ekle
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {(tab === 'all' || tab === 'online') && (
          <div className="space-y-2 max-w-3xl">
            {visibleList.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">
                {tab === 'online' ? 'Şu anda çevrimiçi arkadaşınız yok.' : 'Henüz arkadaş listeniz boş.'}
              </div>
            ) : (
              visibleList.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A] hover:border-slate-300 dark:hover:border-[#A855F7]/40 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onOpenProfile(item.friend.userId)}
                    className="flex items-center gap-3 text-left min-w-0"
                  >
                    <UserAvatar src={item.friend.avatarUrl} name={item.friend.displayName} status={item.friend.status} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{item.friend.displayName}</p>
                      <p className="text-xs text-slate-400 truncate">
                        <span className="font-mono">
                          {item.friend.username}
                          <span className="text-indigo-400">#{item.friend.discriminator || '0000'}</span>
                        </span>{' '}
                        · {getStatusLabel(item.friend.status)}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void startDm(item.friend.userId)}
                      title="Mesaj Gönder"
                      className="h-9 w-9 rounded-lg bg-slate-100 dark:bg-[#1E2333] hover:bg-indigo-600 hover:text-white flex items-center justify-center"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/friends/${item.id}`, { method: 'DELETE' });
                        void loadFriends();
                      }}
                      title="Arkadaşlıktan Çıkar"
                      className="h-9 w-9 rounded-lg bg-slate-100 dark:bg-[#1E2333] hover:bg-red-500/20 hover:text-red-400 flex items-center justify-center"
                    >
                      <UserMinus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'pending' && (
          <div className="space-y-2 max-w-3xl">
            {pending.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">Bekleyen arkadaşlık isteği yok.</div>
            ) : (
              pending.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]"
                >
                  <div className="flex items-center gap-3">
                    <UserAvatar src={item.friend.avatarUrl} name={item.friend.displayName} status={item.friend.status} />
                    <div>
                      <p className="text-sm font-semibold">{item.friend.displayName}</p>
                      <p className="text-xs text-slate-400">
                        {item.direction === 'incoming' ? 'Gelen istek' : 'Gönderilen istek'} · {item.friend.username}#{item.friend.discriminator || '0000'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.direction === 'incoming' && (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/friends/${item.id}/accept`, { method: 'POST' });
                            showToast('Arkadaşlık kabul edildi.', 'success');
                            void loadFriends();
                          }}
                          className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-xs font-medium flex items-center gap-1"
                        >
                          <Check className="w-4 h-4" />
                          Kabul Et
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/friends/${item.id}/decline`, { method: 'POST' });
                            void loadFriends();
                          }}
                          className="h-9 px-3 rounded-lg bg-slate-200 dark:bg-slate-800 text-xs font-medium"
                        >
                          Reddet
                        </button>
                      </>
                    )}
                    {item.direction === 'outgoing' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/friends/${item.id}`, { method: 'DELETE' });
                          void loadFriends();
                        }}
                        className="h-9 px-3 rounded-lg bg-slate-200 dark:bg-slate-800 text-xs font-medium flex items-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" />
                        İptal Et
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'blocked' && (
          <div className="space-y-2 max-w-3xl">
            {blocked.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">Engellenmiş kullanıcı yok.</div>
            ) : (
              blocked.map((b) => (
                <div
                  key={b.user.userId}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]"
                >
                  <div className="flex items-center gap-3">
                    <Ban className="w-5 h-5 text-rose-400" />
                    <div>
                      <p className="text-sm font-semibold">{b.user.displayName}</p>
                      <p className="text-xs font-mono text-slate-400">
                        {b.user.username}
                        <span className="text-indigo-400">#{b.user.discriminator || '0000'}</span>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/blocks/${b.user.userId}`, { method: 'DELETE' });
                      showToast('Engel kaldırıldı.', 'info');
                      void loadFriends();
                    }}
                    className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                  >
                    Engeli Kaldır
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Group DM Modal */}
      {groupModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => {
            setGroupError('');
            setGroupModalOpen(false);
          }}
        >
          <form
            noValidate
            onSubmit={createGroupDm}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] p-6 space-y-4 shadow-2xl animate-orbit-enter"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold font-display">Grup Sohbeti Oluştur</h3>
              <button
                type="button"
                onClick={() => {
                  setGroupError('');
                  setGroupModalOpen(false);
                }}
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Grup adı (ör. Proje Ekibi)"
              className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm"
            />
            <div className="max-h-52 overflow-y-auto space-y-1.5">
              {accepted.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-[#A1A1B5] py-4 text-center">Önce arkadaş eklemelisiniz.</p>
              ) : (
                accepted.map((f) => {
                  const checked = selectedForGroup.includes(f.friend.userId);
                  return (
                    <label
                      key={f.friend.userId}
                      className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-[#19192A] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setGroupError('');
                          setSelectedForGroup((prev) =>
                            checked ? prev.filter((id) => id !== f.friend.userId) : [...prev, f.friend.userId]
                          );
                        }}
                      />
                      <UserAvatar src={f.friend.avatarUrl} name={f.friend.displayName} size="xs" showStatus={false} />
                      <span className="text-sm font-medium">{f.friend.displayName}</span>
                    </label>
                  );
                })
              )}
            </div>
            {groupError && (
              <p role="alert" className="text-xs text-[#EF4444]">
                {groupError}
              </p>
            )}
            <button
              type="submit"
              className="w-full h-10 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold transition-colors"
            >
              Grubu Başlat ({selectedForGroup.length} kişi)
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function DiscoverServersView({ onJoined }: { onJoined: (serverId: string) => void }) {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [servers, setServers] = useState<Array<ServerSummary & { isJoined: boolean }>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ servers: Array<ServerSummary & { isJoined: boolean }> }>(
        `/servers/discover?q=${encodeURIComponent(query.trim())}`
      );
      setServers(res.servers);
    } catch {
      showToast('Topluluklar yüklenemedi.', 'error');
    } finally {
      setLoading(false);
    }
  }, [query, showToast]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const handleJoin = async (serverId: string) => {
    try {
      await apiFetch(`/servers/${serverId}/join`, { method: 'POST' });
      showToast('Sunucuya katıldınız.', 'success');
      onJoined(serverId);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Katılınamadı.', 'error');
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-[#29293D] h-44 sm:h-52 flex items-end p-6">
        <img
          src="/src/assets/images/orbit_discover_banner_1795144633289.jpg"
          alt="Toplulukları Keşfet"
          className="absolute inset-0 w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B12]/90 via-[#0B0B12]/50 to-[#7C3AED]/15" />
        <div className="relative z-10 w-full max-w-xl space-y-3">
          <div className="flex items-center gap-2 text-white">
            <Compass className="w-5 h-5 text-[#C084FC]" />
            <h2 className="text-xl font-bold font-display">ORBIT Topluluklarını Keşfet</h2>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-[#A1A1B5] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Herkese açık sunucularda ara..."
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#0B0B12]/70 backdrop-blur-md border border-[#29293D] text-sm text-[#F8FAFC] placeholder:text-[#A1A1B5]"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-[#A1A1B5]">Sunucular yükleniyor...</div>
      ) : servers.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-[#A1A1B5]">
          Keşfe açık sunucu bulunamadı. Yeni bir sunucu kurup ayarlarından herkese açık hale getirebilirsiniz.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {servers.map((s) => (
            <div
              key={s.id}
              className="rounded-2xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A] p-5 flex flex-col justify-between gap-4 hover:border-[#A855F7]/50 transition-colors"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  {s.iconUrl ? (
                    <img src={resolveMediaUrl(s.iconUrl) || s.iconUrl} alt={s.name} className="w-11 h-11 rounded-xl object-cover" />
                  ) : (
                    <div className="w-11 h-11 rounded-xl bg-[#7C3AED]/20 text-[#C084FC] font-bold flex items-center justify-center">
                      {s.name[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="text-base font-bold font-display truncate">{s.name}</h3>
                    <p className="text-xs font-mono text-slate-400 dark:text-[#A1A1B5]">{s.memberCount} üye</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 dark:text-[#A1A1B5] line-clamp-2">
                  {s.description || 'Açıklama eklenmemiş.'}
                </p>
              </div>
              {s.isJoined ? (
                <button
                  type="button"
                  onClick={() => onJoined(s.id)}
                  className="h-9 rounded-xl border border-slate-200 dark:border-[#29293D] text-xs font-medium hover:bg-slate-100 dark:hover:bg-[#151522]"
                >
                  Sunucuyu Aç
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleJoin(s.id)}
                  className="h-9 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors"
                >
                  Topluluğa Katıl
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function InviteAcceptView({ onJoined }: { onJoined: (serverId: string) => void }) {
  const { code } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [info, setInfo] = useState<{
    code: string;
    serverId: string;
    serverName: string;
    serverDescription: string;
    iconUrl: string | null;
    memberCount: number;
  } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!code) return;
    apiFetch<{ invite: typeof info }>(`/invites/${code}`)
      .then((res) => setInfo(res.invite))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Davet geçersiz.'));
  }, [code]);

  const handleJoin = async () => {
    if (!code) return;
    try {
      const res = await apiFetch<{ server: { id: string } }>(`/invites/${code}/join`, { method: 'POST' });
      showToast('Sunucuya katıldınız.', 'success');
      onJoined(res.server.id);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Katılınamadı.', 'error');
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[#0B0B12] text-[#F8FAFC] p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#29293D] bg-[#151522] p-6 text-center space-y-4 shadow-2xl">
        {error ? (
          <>
            <p className="text-sm text-[#EF4444]">{error}</p>
            <button
              type="button"
              onClick={() => navigate('/channels/@me')}
              className="h-10 px-4 rounded-xl bg-[#19192A] border border-[#29293D] text-sm font-medium"
            >
              Ana Sayfaya Dön
            </button>
          </>
        ) : !info ? (
          <p className="text-sm text-[#A1A1B5]">Davet kontrol ediliyor...</p>
        ) : (
          <>
            <div className="w-16 h-16 rounded-2xl bg-[#7C3AED]/20 text-[#C084FC] font-bold text-2xl flex items-center justify-center mx-auto">
              {info.iconUrl ? (
                <img src={resolveMediaUrl(info.iconUrl) || info.iconUrl} alt={info.serverName} className="w-full h-full rounded-2xl object-cover" />
              ) : (
                info.serverName[0]?.toUpperCase()
              )}
            </div>
            <div>
              <p className="text-xs text-[#A1A1B5]">Sunucu Daveti</p>
              <h2 className="text-xl font-bold font-display mt-1">{info.serverName}</h2>
              {info.serverDescription && <p className="text-xs text-[#A1A1B5] mt-1">{info.serverDescription}</p>}
              <p className="text-xs font-mono text-[#A1A1B5] mt-2">{info.memberCount} üye</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigate('/channels/@me')}
                className="flex-1 h-10 rounded-xl border border-[#29293D] bg-[#19192A] text-sm"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => void handleJoin()}
                className="flex-1 h-10 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold transition-colors"
              >
                Katıl
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
