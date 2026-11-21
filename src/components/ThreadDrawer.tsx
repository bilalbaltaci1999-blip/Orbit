import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, MessageSquare, Send, Unlock, X } from 'lucide-react';
import { apiFetch, ApiError } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { useToast } from '../client/ToastContext.tsx';
import { wsClient } from '../client/wsClient.ts';
import type { ChatMessage, MessageThreadSummary } from '../shared/types.ts';
import { UserAvatar } from './UserAvatar.tsx';

interface Props {
  threadId: string;
  canPin?: boolean;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
}

export function ThreadDrawer({ threadId, canPin = false, onClose, onOpenProfile }: Props) {
  const { profile: me } = useAuth();
  const { showToast } = useToast();

  const [thread, setThread] = useState<MessageThreadSummary | null>(null);
  const [parentMessage, setParentMessage] = useState<ChatMessage | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  const loadThread = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        thread: MessageThreadSummary;
        parentMessage: ChatMessage | null;
        messages: ChatMessage[];
      }>(`/threads/${threadId}/messages`);
      setThread(res.thread);
      setParentMessage(res.parentMessage);
      setMessages(res.messages);
      setDraftError(null);
      window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 40);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Alt konu yüklenemedi.', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [threadId, showToast, onClose]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  useEffect(() => {
    return wsClient.onEvent((ev) => {
      if (ev.type === 'thread:message_new') {
        const p = ev.payload;
        if (String(p.threadId) !== threadId) return;
        const msg = p.message as ChatMessage | undefined;
        if (!msg) return;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
      }
    });
  }, [threadId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (!draft.trim()) {
      setDraftError('Yanıt metni boş bırakılamaz.');
      return;
    }
    setDraftError(null);
    setSending(true);
    try {
      const res = await apiFetch<{ message: ChatMessage }>(`/threads/${threadId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: draft.trim() }),
      });
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      setDraft('');
      window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Alt konu yanıtı gönderilemedi.', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleToggleLock = async () => {
    if (!thread) return;
    try {
      const res = await apiFetch<{ isLocked: boolean }>(`/threads/${thread.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isLocked: !thread.isLocked }),
      });
      setThread({ ...thread, isLocked: res.isLocked });
      showToast(res.isLocked ? 'Alt konu kilitlendi.' : 'Alt konu kilidi açıldı.', 'info');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Güncellenemedi.', 'error');
    }
  };

  const canManageLock = Boolean(canPin || (me && thread && thread.createdBy === me.userId));

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-30 bg-black/55 lg:hidden" />
      <aside className="fixed right-0 top-14 bottom-0 z-40 w-full max-w-sm lg:static lg:z-auto lg:w-80 xl:w-96 border-l border-slate-200 dark:border-[#29293D] bg-[#F2F4F9] dark:bg-[#10111B] flex flex-col min-h-0 shadow-2xl lg:shadow-none">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-[#29293D] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-4 h-4 text-[#A855F7] shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold font-display truncate">{thread?.title || 'Alt Konu'}</p>
              <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] tabular-nums">
                {messages.length} yanıt {thread?.isLocked ? '· Kilitli' : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {canManageLock && thread && (
              <button
                type="button"
                onClick={() => void handleToggleLock()}
                title={thread.isLocked ? 'Kilidi Aç' : 'Alt Konuyu Kilitle'}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-[#19192A] text-slate-500 dark:text-[#A1A1B5]"
              >
                {thread.isLocked ? <Unlock className="w-4 h-4 text-[#F59E0B]" /> : <Lock className="w-4 h-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Alt konuyu kapat"
              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-[#19192A] text-slate-400 dark:text-[#A1A1B5]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {parentMessage && (
            <div className="p-3 rounded-xl bg-white dark:bg-[#151522] border border-[#7C3AED]/30 space-y-1.5">
              <button
                type="button"
                onClick={() => onOpenProfile(parentMessage.authorId)}
                className="flex items-center gap-2 text-left"
              >
                <UserAvatar
                  src={parentMessage.author.avatarUrl}
                  name={parentMessage.author.displayName}
                  frame={parentMessage.author.avatarFrame}
                  size="xs"
                  showStatus={false}
                />
                <span className="text-xs font-bold hover:underline">{parentMessage.author.displayName}</span>
                <span className="text-[10px] font-mono text-[#C084FC]">Ana Mesaj</span>
              </button>
              <p className="text-xs text-slate-700 dark:text-[#F8FAFC] break-words whitespace-pre-wrap">
                {parentMessage.content}
              </p>
            </div>
          )}

          {loading ? (
            <div className="py-8 text-center text-xs text-slate-400 dark:text-[#A1A1B5]">Alt konu yükleniyor...</div>
          ) : messages.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 dark:text-[#A1A1B5]">
              Henüz yanıt yok. İlk yanıtı yazarak tartışmayı başlatın.
            </div>
          ) : (
            <div className="space-y-2.5">
              {messages.map((m) => (
                <div key={m.id} className="flex items-start gap-2.5">
                  <button type="button" onClick={() => onOpenProfile(m.authorId)} className="shrink-0 mt-0.5">
                    <UserAvatar
                      src={m.author.avatarUrl}
                      name={m.author.displayName}
                      frame={m.author.avatarFrame}
                      size="xs"
                      showStatus={false}
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenProfile(m.authorId)}
                        className="text-xs font-semibold hover:underline truncate"
                      >
                        {m.author.displayName}
                      </button>
                      <span className="text-[10px] font-mono text-slate-400 dark:text-[#A1A1B5] tabular-nums">
                        {new Date(
                          m.createdAt.endsWith('Z') ? m.createdAt : `${m.createdAt.replace(' ', 'T')}Z`
                        ).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-[#F8FAFC] break-words whitespace-pre-wrap mt-0.5">
                      {m.deletedAt ? <span className="italic text-slate-400 dark:text-[#A1A1B5]">Mesaj silindi.</span> : m.content}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form noValidate onSubmit={handleSend} className="p-3 border-t border-slate-200 dark:border-[#29293D] space-y-1.5 shrink-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              disabled={Boolean(thread?.isLocked && !canPin)}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (draftError) setDraftError(null);
              }}
              placeholder={thread?.isLocked && !canPin ? 'Bu alt konu kilitlenmiştir.' : 'Alt konuya yanıt yaz...'}
              className={`flex-1 h-10 px-3 rounded-xl bg-white dark:bg-[#19192A] border text-xs focus:outline-none focus:ring-2 focus:ring-[#A855F7] disabled:opacity-50 ${
                draftError ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
              }`}
            />
            <button
              type="submit"
              disabled={sending || Boolean(thread?.isLocked && !canPin)}
              aria-label="Alt konuya gönder"
              className="h-10 px-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
          {draftError && (
            <p role="alert" className="text-[11px] text-[#EF4444]">
              {draftError}
            </p>
          )}
        </form>
      </aside>
    </>
  );
}
