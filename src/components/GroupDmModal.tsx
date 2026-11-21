import React, { useEffect, useState } from 'react';
import { LogOut, Plus, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { apiFetch, ApiError } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { useToast } from '../client/ToastContext.tsx';
import type { DirectConversation, FriendshipRecord, UserProfile } from '../shared/types.ts';
import { UserAvatar } from './UserAvatar.tsx';

interface Props {
  conversation?: DirectConversation | null;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
  onUpdated: () => void;
}

export function GroupDmModal({ conversation, onClose, onCreated, onUpdated }: Props) {
  const { profile: me } = useAuth();
  const { showToast } = useToast();
  const isEditing = Boolean(conversation);

  const [name, setName] = useState(conversation?.name || '');
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    apiFetch<{ friendships: FriendshipRecord[] }>('/friends')
      .then((res) => {
        const accepted = res.friendships.filter((f) => f.status === 'accepted').map((f) => f.friend);
        setFriends(accepted);
      })
      .catch(() => {});
  }, []);

  const toggleSelect = (uid: string) => {
    setFormError('');
    setSelectedIds((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.length < 2) {
      setFormError('Grup sohbeti için en az 2 arkadaş seçmelisiniz.');
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      const res = await apiFetch<{ conversation: { id: string } }>('/dm/conversations', {
        method: 'POST',
        body: JSON.stringify({
          participantIds: selectedIds,
          name: name.trim() || 'Grup Sohbeti',
        }),
      });
      showToast('Grup sohbeti oluşturuldu.', 'success');
      onCreated(res.conversation.id);
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Grup sohbeti oluşturulamadı.');
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async () => {
    if (!conversation) return;
    if (!name.trim()) {
      setFormError('Grup adı boş bırakılamaz.');
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      await apiFetch(`/dm/conversations/${conversation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim() }),
      });
      showToast('Grup adı güncellendi.', 'success');
      onUpdated();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Güncellenemedi.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = async (userId: string) => {
    if (!conversation) return;
    try {
      await apiFetch(`/dm/conversations/${conversation.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      showToast('Üye gruba eklendi.', 'success');
      onUpdated();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Üye eklenemedi.', 'error');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!conversation) return;
    try {
      await apiFetch(`/dm/conversations/${conversation.id}/members/${userId}`, {
        method: 'DELETE',
      });
      showToast(userId === me?.userId ? 'Gruptan ayrıldınız.' : 'Üye gruptan çıkarıldı.', 'info');
      onUpdated();
      if (userId === me?.userId) onClose();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'İşlem başarısız.', 'error');
    }
  };

  const existingIds = new Set((conversation?.members || []).map((m) => m.userId));
  const addableFriends = friends.filter((f) => !existingIds.has(f.userId));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] p-5 space-y-4 shadow-2xl max-h-[85dvh] flex flex-col animate-orbit-enter"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#C084FC]" />
            <h3 className="text-base font-bold font-display">
              {isEditing ? 'Grup Sohbetini Yönet' : 'Yeni Grup Sohbeti Oluştur'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!isEditing ? (
          <form noValidate onSubmit={handleCreate} className="space-y-4 flex-1 flex flex-col min-h-0">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Grup Adı</label>
              <input
                type="text"
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ör. Hafta Sonu Ekibi"
                className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm"
              />
            </div>

            <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
              <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">
                Arkadaşlarını Seç (En az 2 · Seçili: {selectedIds.length})
              </label>
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {friends.length === 0 ? (
                  <p className="text-xs text-slate-400 dark:text-[#A1A1B5] py-6 text-center">
                    Grup sohbeti açmak için önce arkadaş listenize kişi ekleyin.
                  </p>
                ) : (
                  friends.map((fr) => {
                    const checked = selectedIds.includes(fr.userId);
                    return (
                      <button
                        key={fr.userId}
                        type="button"
                        onClick={() => toggleSelect(fr.userId)}
                        className={`w-full p-2.5 rounded-xl border flex items-center justify-between text-left transition-colors ${
                          checked
                            ? 'border-[#A855F7] bg-[#7C3AED]/15'
                            : 'border-slate-200 dark:border-[#29293D] hover:bg-slate-100 dark:hover:bg-[#19192A]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <UserAvatar src={fr.avatarUrl} name={fr.displayName} status={fr.status} size="xs" />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">{fr.displayName}</p>
                            <p className="text-[11px] font-mono text-slate-400 dark:text-[#A1A1B5] truncate">
                              @{fr.username}#{fr.discriminator || '0000'}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs font-bold text-[#C084FC]">{checked ? '✓' : '+'}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {formError && (
              <p role="alert" className="text-xs text-[#EF4444]">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full h-10 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {saving ? 'Oluşturuluyor...' : 'Grup Sohbeti Başlat'}
            </button>
          </form>
        ) : (
          <div className="space-y-4 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (formError) setFormError('');
                  }}
                  placeholder="Grup adı"
                  aria-invalid={Boolean(formError)}
                  className={`flex-1 h-9 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border ${
                    formError ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                  } text-xs`}
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleRename()}
                  className="h-9 px-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold shrink-0"
                >
                  Kaydet
                </button>
              </div>
              {formError && (
                <p role="alert" className="text-xs text-[#EF4444]">
                  {formError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Üyeler ({conversation?.members.length || 0})
              </p>
              {conversation?.members.map((m) => (
                <div
                  key={m.userId}
                  className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <UserAvatar src={m.avatarUrl} name={m.displayName} status={m.status} size="xs" />
                    <span className="text-xs font-medium truncate">
                      {m.displayName}
                      {m.userId === conversation.ownerId && (
                        <span className="ml-1.5 text-[10px] text-amber-400">· Kurucu</span>
                      )}
                    </span>
                  </div>
                  {(conversation.ownerId === me?.userId || m.userId === me?.userId) && (
                    <button
                      type="button"
                      onClick={() => void handleRemoveMember(m.userId)}
                      title={m.userId === me?.userId ? 'Gruptan Ayrıl' : 'Çıkar'}
                      className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15"
                    >
                      {m.userId === me?.userId ? <LogOut className="w-3.5 h-3.5" /> : <UserMinus className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {addableFriends.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Arkadaş Ekle</p>
                {addableFriends.map((fr) => (
                  <div
                    key={fr.userId}
                    className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <UserAvatar src={fr.avatarUrl} name={fr.displayName} status={fr.status} size="xs" />
                      <span className="text-xs font-medium truncate">{fr.displayName}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAddMember(fr.userId)}
                      className="h-7 px-2.5 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <UserPlus className="w-3 h-3" />
                      Ekle
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
