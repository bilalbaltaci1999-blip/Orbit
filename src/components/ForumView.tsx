import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Lock, MessageSquare, Pin, Plus, Search, Unlock, X } from 'lucide-react';
import { apiFetch, ApiError } from '../client/api.ts';
import { useToast } from '../client/ToastContext.tsx';
import type { ForumPost, ForumReply } from '../shared/types.ts';
import { UserAvatar } from './UserAvatar.tsx';

interface Props {
  channelId: string;
  channelName: string;
  canSend: boolean;
  canModerate: boolean;
  onOpenProfile: (userId: string) => void;
}

export function ForumView({ channelId, channelName, canSend, canModerate, onOpenProfile }: Props) {
  const { showToast } = useToast();
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [postErrors, setPostErrors] = useState<{ title?: string; content?: string }>({});

  const [activePost, setActivePost] = useState<ForumPost | null>(null);
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyError, setReplyError] = useState('');

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (selectedTag) params.set('tag', selectedTag);
      const res = await apiFetch<{ posts: ForumPost[] }>(`/channels/${channelId}/forum?${params.toString()}`);
      setPosts(res.posts);
    } catch {
      showToast('Forum konuları yüklenemedi.', 'error');
    } finally {
      setLoading(false);
    }
  }, [channelId, query, selectedTag, showToast]);

  useEffect(() => {
    setActivePost(null);
    const t = window.setTimeout(() => void loadPosts(), 200);
    return () => clearTimeout(t);
  }, [loadPosts]);

  const openPostDetail = async (postId: string) => {
    try {
      const res = await apiFetch<{ post: ForumPost; replies: ForumReply[] }>(`/forum/posts/${postId}`);
      setActivePost(res.post);
      setReplies(res.replies);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Konu açılamadı.', 'error');
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { title?: string; content?: string } = {};
    if (newTitle.trim().length < 3) errs.title = 'Konu başlığı en az 3 karakter olmalıdır.';
    if (newContent.trim().length < 2) errs.content = 'Konu içeriği boş bırakılamaz.';
    if (Object.keys(errs).length > 0) {
      setPostErrors(errs);
      return;
    }
    setPostErrors({});
    try {
      const tags = newTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await apiFetch<{ postId: string }>(`/channels/${channelId}/forum`, {
        method: 'POST',
        body: JSON.stringify({ title: newTitle.trim(), content: newContent.trim(), tags }),
      });
      setCreateOpen(false);
      setNewTitle('');
      setNewContent('');
      setNewTags('');
      showToast('Konu açıldı.', 'success');
      await loadPosts();
      void openPostDetail(res.postId);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Konu oluşturulamadı.', 'error');
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePost) return;
    if (!replyDraft.trim()) {
      setReplyError('Yanıt göndermek için bir mesaj yazın.');
      return;
    }
    setReplyError('');
    try {
      await apiFetch(`/forum/posts/${activePost.id}/replies`, {
        method: 'POST',
        body: JSON.stringify({ content: replyDraft.trim() }),
      });
      setReplyDraft('');
      await openPostDetail(activePost.id);
      void loadPosts();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Yanıt gönderilemedi.', 'error');
    }
  };

  const handleToggleFollow = async (post: ForumPost) => {
    try {
      const res = await apiFetch<{ isFollowing: boolean }>(`/forum/posts/${post.id}/follow`, { method: 'POST' });
      setActivePost((prev) => (prev && prev.id === post.id ? { ...prev, isFollowing: res.isFollowing } : prev));
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, isFollowing: res.isFollowing } : p)));
    } catch {
      showToast('İşlem başarısız.', 'error');
    }
  };

  const handleModeratePost = async (post: ForumPost, patch: { isPinned?: boolean; isLocked?: boolean }) => {
    try {
      await apiFetch(`/forum/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await openPostDetail(post.id);
      void loadPosts();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Güncellenemedi.', 'error');
    }
  };

  const allTags = Array.from(new Set(posts.flatMap((p) => p.tags)));

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* Left: Post List */}
      <div className={`flex-1 flex flex-col min-h-0 ${activePost ? 'hidden lg:flex lg:max-w-md lg:border-r lg:border-slate-200 dark:lg:border-[#29293D]' : ''}`}>
        <div className="p-4 border-b border-slate-200 dark:border-[#29293D] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold font-display">#{channelName} Forumu</h2>
              <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">Konuları arayın, tartışın veya yeni başlık açın.</p>
            </div>
            {canSend && (
              <button
                type="button"
                onClick={() => {
                  setPostErrors({});
                  setCreateOpen(true);
                }}
                className="h-9 px-3.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Yeni Konu
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Konularda ara..."
                className="w-full h-9 pl-9 pr-3 rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs"
              />
            </div>
            {selectedTag && (
              <button
                type="button"
                onClick={() => setSelectedTag('')}
                className="h-9 px-2.5 rounded-xl bg-indigo-600/20 text-indigo-400 text-xs font-medium flex items-center gap-1"
              >
                {selectedTag}
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelectedTag(selectedTag === t ? '' : t)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    selectedTag === t
                      ? 'bg-[#7C3AED] text-white'
                      : 'bg-slate-200/70 dark:bg-[#19192A] text-slate-600 dark:text-[#A1A1B5] hover:bg-slate-300/60 dark:hover:bg-[#222238]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400 dark:text-[#A1A1B5]">Konular yükleniyor...</div>
          ) : posts.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400 dark:text-[#A1A1B5]">Bu forumda henüz konu yok.</div>
          ) : (
            posts.map((post) => (
              <button
                key={post.id}
                type="button"
                onClick={() => {
                  setReplyError('');
                  void openPostDetail(post.id);
                }}
                className={`w-full text-left rounded-xl border p-4 transition-colors ${
                  activePost?.id === post.id
                    ? 'border-[#A855F7]/70 bg-[#7C3AED]/15'
                    : 'border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#151522] hover:border-[#A855F7]/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-[#F8FAFC] line-clamp-1">{post.title}</h3>
                  <div className="flex items-center gap-1.5 shrink-0 text-slate-400">
                    {post.isPinned && <Pin className="w-3.5 h-3.5 text-[#F59E0B]" />}
                    {post.isLocked && <Lock className="w-3.5 h-3.5 text-[#EF4444]" />}
                  </div>
                </div>
                <p className="text-xs text-slate-500 dark:text-[#A1A1B5] mt-1 line-clamp-2">{post.content}</p>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-400 dark:text-[#A1A1B5]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate font-medium text-slate-600 dark:text-[#F8FAFC]/85">
                      {post.author.displayName}
                    </span>
                    {post.tags.length > 0 && (
                      <>
                        <span>·</span>
                        <span className="truncate text-[#C084FC]">{post.tags.join(', ')}</span>
                      </>
                    )}
                  </div>
                  <span className="flex items-center gap-1 font-mono shrink-0">
                    <MessageSquare className="w-3.5 h-3.5" />
                    {post.replyCount}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: Post Detail */}
      {activePost && (
        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#0B0B12]">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-[#29293D] flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setActivePost(null)}
              className="lg:hidden text-xs font-medium text-[#C084FC] hover:underline"
            >
              ← Konulara dön
            </button>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => void handleToggleFollow(activePost)}
                className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1.5"
              >
                {activePost.isFollowing ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                {activePost.isFollowing ? 'Takibi Bırak' : 'Takip Et'}
              </button>
              {canModerate && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleModeratePost(activePost, { isPinned: !activePost.isPinned })}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs flex items-center gap-1"
                  >
                    <Pin className="w-3.5 h-3.5" />
                    {activePost.isPinned ? 'Sabitlemeyi Kaldır' : 'Sabitle'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleModeratePost(activePost, { isLocked: !activePost.isLocked })}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs flex items-center gap-1"
                  >
                    {activePost.isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    {activePost.isLocked ? 'Kilidi Aç' : 'Kilitle'}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <div className="space-y-3 pb-5 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-xl font-bold font-display">{activePost.title}</h2>
              <div className="flex items-center gap-2.5 text-xs text-slate-400">
                <button type="button" onClick={() => onOpenProfile(activePost.authorId)} className="flex items-center gap-2">
                  <UserAvatar src={activePost.author.avatarUrl} name={activePost.author.displayName} size="xs" showStatus={false} />
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{activePost.author.displayName}</span>
                </button>
                {activePost.tags.length > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-indigo-400">{activePost.tags.join(' · ')}</span>
                  </>
                )}
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                {activePost.content}
              </p>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-slate-500">Yanıtlar ({replies.length})</h4>
              {replies.map((r) => (
                <div key={r.id} className="flex items-start gap-3">
                  <button type="button" onClick={() => onOpenProfile(r.authorId)}>
                    <UserAvatar src={r.author.avatarUrl} name={r.author.displayName} size="sm" showStatus={false} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold">{r.author.displayName}</span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {new Date(r.createdAt.replace(' ', 'T') + 'Z').toLocaleString('tr-TR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{r.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {!activePost.isLocked && canSend ? (
            <form noValidate onSubmit={handleSendReply} className="p-4 border-t border-slate-200 dark:border-[#29293D] space-y-1.5 pb-safe">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={replyDraft}
                  onChange={(e) => {
                    setReplyDraft(e.target.value);
                    if (replyError) setReplyError('');
                  }}
                  placeholder="Konuya yanıt yazın..."
                  aria-invalid={Boolean(replyError)}
                  className={`flex-1 h-10 px-3.5 rounded-xl bg-slate-100 dark:bg-[#19192A] border ${
                    replyError ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                  } text-sm`}
                />
                <button
                  type="submit"
                  className="h-10 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-medium transition-colors"
                >
                  Yanıtla
                </button>
              </div>
              {replyError && (
                <p role="alert" className="text-xs text-[#EF4444]">
                  {replyError}
                </p>
              )}
            </form>
          ) : (
            <div className="p-3 border-t border-slate-200 dark:border-[#29293D] text-center text-xs text-slate-400 dark:text-[#A1A1B5]">
              {activePost.isLocked ? 'Bu konu moderatör tarafından kilitlenmiştir.' : 'Yanıt yazma izniniz yok.'}
            </div>
          )}
        </div>
      )}

      {/* New Post Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setCreateOpen(false)}
        >
          <form
            noValidate
            onSubmit={handleCreatePost}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] p-6 space-y-4 shadow-2xl animate-orbit-enter"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold font-display">Yeni Forum Konusu</h3>
              <button type="button" onClick={() => setCreateOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Başlık</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => {
                  setNewTitle(e.target.value);
                  if (postErrors.title) setPostErrors((p) => ({ ...p, title: undefined }));
                }}
                placeholder="Konu başlığı"
                aria-invalid={Boolean(postErrors.title)}
                className={`w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border ${
                  postErrors.title ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                } text-sm`}
              />
              {postErrors.title && (
                <p role="alert" className="text-xs text-[#EF4444]">
                  {postErrors.title}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">Etiketler (virgülle ayırın)</label>
              <input
                type="text"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="ör. duyuru, soru, geri-bildirim"
                className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-[#A1A1B5]">İçerik</label>
              <textarea
                rows={4}
                value={newContent}
                onChange={(e) => {
                  setNewContent(e.target.value);
                  if (postErrors.content) setPostErrors((p) => ({ ...p, content: undefined }));
                }}
                placeholder="Detayları yazın..."
                aria-invalid={Boolean(postErrors.content)}
                className={`w-full p-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border ${
                  postErrors.content ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                } text-sm`}
              />
              {postErrors.content && (
                <p role="alert" className="text-xs text-[#EF4444]">
                  {postErrors.content}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 text-sm text-slate-400">
                İptal
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold">
                Yayınla
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
