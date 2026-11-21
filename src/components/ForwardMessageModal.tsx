import { useState } from 'react';
import { Forward, Hash, MessageCircle, Send, X } from 'lucide-react';
import { apiFetch, ApiError } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { useToast } from '../client/ToastContext.tsx';
import type { Channel, ChatMessage, DirectConversation } from '../shared/types.ts';

interface Props {
  message: ChatMessage;
  channels: Channel[];
  conversations: DirectConversation[];
  sourceChannelName?: string;
  onClose: () => void;
}

export function ForwardMessageModal({
  message,
  channels,
  conversations,
  sourceChannelName,
  onClose,
}: Props) {
  const { profile: me } = useAuth();
  const { showToast } = useToast();
  const [note, setNote] = useState('');
  const [sendingTarget, setSendingTarget] = useState<string | null>(null);

  const textChannels = channels.filter((c) => c.type === 'text' || c.type === 'announcement');

  const forwardPayload = {
    originalMessageId: message.id,
    authorName: message.webhookName || message.author.displayName,
    channelName: sourceChannelName,
    content: message.content || (message.attachments.length > 0 ? '[Ekli Dosya]' : ''),
    createdAt: message.createdAt,
  };

  const handleForwardToChannel = async (channelId: string, label: string) => {
    setSendingTarget(channelId);
    try {
      await apiFetch(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: note.trim(),
          forwardedFrom: forwardPayload,
        }),
      });
      showToast(`Mesaj #${label} kanalına iletildi.`, 'success');
      onClose();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Mesaj iletilemedi.', 'error');
    } finally {
      setSendingTarget(null);
    }
  };

  const handleForwardToDm = async (conversationId: string, label: string) => {
    setSendingTarget(conversationId);
    try {
      await apiFetch(`/dm/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: note.trim(),
          forwardedFrom: forwardPayload,
        }),
      });
      showToast(`Mesaj ${label} sohbetine iletildi.`, 'success');
      onClose();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Mesaj iletilemedi.', 'error');
    } finally {
      setSendingTarget(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] p-5 space-y-4 shadow-2xl max-h-[85dvh] flex flex-col animate-orbit-enter"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Forward className="w-4 h-4 text-[#A855F7]" />
            <h3 className="text-base font-bold font-display">Mesajı İlet</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-[#F8FAFC] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded-xl border-l-2 border-[#7C3AED] bg-slate-100 dark:bg-[#19192A] text-xs space-y-1">
          <p className="font-semibold text-[#C084FC]">{forwardPayload.authorName}</p>
          <p className="text-slate-600 dark:text-[#F8FAFC] line-clamp-3">{forwardPayload.content}</p>
        </div>

        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="İletirken not ekle (opsiyonel)..."
          className="w-full h-9 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
        />

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {textChannels.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">Sunucu Kanalları</p>
              {textChannels.map((ch) => (
                <div
                  key={ch.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B]"
                >
                  <span className="text-xs font-medium flex items-center gap-1.5 truncate">
                    <Hash className="w-3.5 h-3.5 text-slate-500 dark:text-[#A1A1B5] shrink-0" />
                    <span className="truncate">{ch.name}</span>
                  </span>
                  <button
                    type="button"
                    disabled={sendingTarget !== null}
                    onClick={() => void handleForwardToChannel(ch.id, ch.name)}
                    className="h-8 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1 shrink-0 transition-colors"
                  >
                    <Send className="w-3 h-3" />
                    İlet
                  </button>
                </div>
              ))}
            </div>
          )}

          {conversations.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">Doğrudan Mesajlar</p>
              {conversations.map((conv) => {
                const peer = !conv.isGroup ? conv.members.find((m) => m.userId !== me?.userId) : null;
                const title = conv.isGroup ? conv.name || 'Grup Sohbeti' : peer?.displayName || 'Sohbet';
                return (
                  <div
                    key={conv.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B]"
                  >
                    <span className="text-xs font-medium flex items-center gap-1.5 truncate">
                      <MessageCircle className="w-3.5 h-3.5 text-slate-500 dark:text-[#A1A1B5] shrink-0" />
                      <span className="truncate">{title}</span>
                    </span>
                    <button
                      type="button"
                      disabled={sendingTarget !== null}
                      onClick={() => void handleForwardToDm(conv.id, title)}
                      className="h-8 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1 shrink-0 transition-colors"
                    >
                      <Send className="w-3 h-3" />
                      İlet
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
