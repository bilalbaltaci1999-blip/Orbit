import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  BarChart3,
  Bell,
  Check,
  Clock,
  Copy,
  CornerUpLeft,
  Crown,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Flag,
  Forward,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pause,
  Pin,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Smile,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, ApiError, resolveMediaUrl, uploadFilesWithProgress } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { useToast } from '../client/ToastContext.tsx';
import { wsClient } from '../client/wsClient.ts';
import type { ActivityTypeKey, AvatarFrameKey, BadgeKey, OrbitBadge } from '../shared/badges.ts';
import { SLASH_COMMANDS } from '../shared/templates.ts';
import type { ChatMessage, PollData, ServerEmoji, UserProfile } from '../shared/types.ts';
import { FeaturedBadgeIcon } from './BadgeStrip.tsx';
import { BotBadge, NitroBadge } from './BotBadge.tsx';
import { UserAvatar } from './UserAvatar.tsx';

const QUICK_EMOJIS = ['👍', '❤️', '🔥', '😂', '🎉', '👀', '🚀', '✅', '👏', '😮', '🤔', '💯', '🙏', '⚡', '💜', '💎'];

interface UploadedAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

interface LinkPreviewData {
  url: string;
  domain: string;
  title: string;
  description: string;
}

interface Props {
  mode: 'channel' | 'dm';
  targetId: string;
  serverId?: string;
  channelName?: string;
  canSend?: boolean;
  canAttachFiles?: boolean;
  canPin?: boolean;
  canDeleteOthers?: boolean;
  canEditOthers?: boolean;
  mentionCandidates?: UserProfile[];
  memberRoleColors?: Record<string, string>;
  serverEmojis?: ServerEmoji[];
  serverOwnerId?: string;
  onOpenProfile: (userId: string) => void;
  onOpenThread?: (threadId: string) => void;
  onForwardMessage?: (message: ChatMessage) => void;
}

function parseUtcMs(iso: string): number {
  const normalized = iso.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`;
  const t = new Date(normalized).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function formatTime(iso: string): string {
  const ms = parseUtcMs(iso);
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function isSameCalendarDay(aIso: string, bIso: string): boolean {
  const aMs = parseUtcMs(aIso);
  const bMs = parseUtcMs(bIso);
  if (!aMs || !bMs) return true;
  const a = new Date(aMs);
  const b = new Date(bMs);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDateDivider(iso: string): string {
  const ms = parseUtcMs(iso);
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return 'Bugün';
  }
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return 'Dün';
  }
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0] : null;
}

function highlightCodeLine(line: string, lineIdx: number): React.ReactNode {
  const tokenRegex = /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|import|export|from|type|interface|async|await|try|catch|class|new|true|false|null|undefined|def|elif|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN)\b|\b\d+(?:\.\d+)?\b)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = tokenRegex.exec(line)) !== null) {
    if (m.index > last) nodes.push(line.slice(last, m.index));
    const tok = m[0];
    let cls = 'text-slate-100';
    if (tok.startsWith('//') || tok.startsWith('#')) {
      cls = 'text-slate-500 italic';
    } else if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith('`')) {
      cls = 'text-emerald-300';
    } else if (/^\d/.test(tok)) {
      cls = 'text-amber-300';
    } else {
      cls = 'text-fuchsia-300 font-medium';
    }
    nodes.push(
      <span key={`${lineIdx}-${k++}`} className={cls}>
        {tok}
      </span>
    );
    last = tokenRegex.lastIndex;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes.length > 0 ? nodes : '\u00A0';
}

function CodeBlockCard({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const lines = code.split('\n');

  const handleCopy = () => {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-[#29293D] bg-[#0B0B12] text-[#F8FAFC] max-w-2xl">
      <div className="px-3 py-1.5 bg-[#151522] border-b border-[#29293D] flex items-center justify-between text-[11px]">
        <span className="font-mono text-[#C084FC] uppercase tracking-wider">{lang || 'kod'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-[#A1A1B5] hover:text-white transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-[#22C55E]" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
        </button>
      </div>
      <pre className="p-3 font-mono text-xs overflow-x-auto leading-relaxed">
        <code>
          {lines.map((line, i) => (
            <div key={i}>{highlightCodeLine(line, i)}</div>
          ))}
        </code>
      </pre>
    </div>
  );
}

function VoiceNotePlayer({ url, fileName }: { url: string; fileName: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<1 | 1.5 | 2>(1);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.playbackRate = rate;
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const fmt = (sec: number) => {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#151522] w-72 max-w-full">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
      />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Duraklat' : 'Oynat'}
        className="w-8 h-8 rounded-full bg-[#7C3AED] hover:bg-[#6D28D9] text-white flex items-center justify-center shrink-0 transition-colors"
      >
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium truncate text-slate-700 dark:text-[#F8FAFC]">
            {fileName || 'Sesli Not'}
          </span>
          <span className="text-[10px] font-mono text-slate-400 dark:text-[#A1A1B5] tabular-nums shrink-0">
            {fmt(currentTime)} / {fmt(duration)}
          </span>
        </div>
        <div
          onClick={(e) => {
            const el = audioRef.current;
            if (!el || !duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            el.currentTime = ratio * duration;
          }}
          className="h-1.5 rounded-full bg-slate-200 dark:bg-[#19192A] cursor-pointer overflow-hidden"
        >
          <div className="h-full bg-[#A855F7] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <button
        type="button"
        onClick={cycleRate}
        className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#19192A] text-[10px] font-mono font-bold text-[#C084FC] shrink-0"
      >
        {rate}x
      </button>
    </div>
  );
}

function renderInlineTokens(
  segment: string,
  mentionMap: Map<string, UserProfile>,
  emojiMap: Map<string, ServerEmoji>,
  onOpenProfile: (userId: string) => void,
  keyPrefix: string
): React.ReactNode[] {
  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|@[a-zA-Z0-9_.-]{2,32}|:[a-z0-9_]{2,24}:|https?:\/\/[^\s<>"']+)/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let partIdx = 0;

  while ((match = tokenRegex.exec(segment)) !== null) {
    if (match.index > lastIdx) {
      parts.push(segment.slice(lastIdx, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${partIdx++}`;

    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      parts.push(
        <strong key={key} className="font-semibold text-slate-900 dark:text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
      parts.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      parts.push(
        <code
          key={key}
          className="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-[#19192A] font-mono text-[12px] text-[#7C3AED] dark:text-[#C084FC]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith(':') && token.endsWith(':')) {
      const emojiName = token.slice(1, -1);
      const customEmoji = emojiMap.get(emojiName);
      if (customEmoji) {
        parts.push(
          <img
            key={key}
            src={resolveMediaUrl(customEmoji.url) || customEmoji.url}
            alt={`:${customEmoji.name}:`}
            title={`:${customEmoji.name}:`}
            className="inline-block w-5 h-5 object-contain align-text-bottom mx-0.5"
          />
        );
      } else {
        parts.push(token);
      }
    } else if (token.startsWith('@')) {
      const uname = token.slice(1).toLowerCase();
      const user = mentionMap.get(uname);
      if (user) {
        parts.push(
          <button
            key={key}
            type="button"
            onClick={() => onOpenProfile(user.userId)}
            className="px-1 rounded bg-[#7C3AED]/15 text-[#7C3AED] dark:text-[#C084FC] hover:bg-[#7C3AED]/25 font-medium"
          >
            @{user.username}
          </button>
        );
      } else {
        parts.push(
          <span key={key} className="px-1 rounded bg-[#7C3AED]/10 text-[#C084FC] font-medium">
            {token}
          </span>
        );
      }
    } else if (token.startsWith('http://') || token.startsWith('https://')) {
      parts.push(
        <a
          key={key}
          href={token}
          target="_blank"
          rel="noreferrer"
          className="text-[#7C3AED] dark:text-[#38BDF8] hover:underline break-all"
        >
          {token}
        </a>
      );
    } else {
      parts.push(token);
    }

    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < segment.length) {
    parts.push(segment.slice(lastIdx));
  }
  return parts;
}

function FormattedMessageContent({
  content,
  mentionMap,
  emojiMap,
  onOpenProfile,
  edited,
  dimmed,
}: {
  content: string;
  mentionMap: Map<string, UserProfile>;
  emojiMap: Map<string, ServerEmoji>;
  onOpenProfile: (userId: string) => void;
  edited: boolean;
  dimmed: boolean;
}) {
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  const blocks: Array<{ type: 'text' | 'code'; lang?: string; value: string }> = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = codeBlockRegex.exec(content)) !== null) {
    if (m.index > lastIndex) {
      blocks.push({ type: 'text', value: content.slice(lastIndex, m.index) });
    }
    blocks.push({ type: 'code', lang: m[1] || '', value: m[2].replace(/^\n+|\n+$/g, '') });
    lastIndex = codeBlockRegex.lastIndex;
  }
  if (lastIndex < content.length) {
    blocks.push({ type: 'text', value: content.slice(lastIndex) });
  }

  return (
    <div className={`text-sm leading-relaxed break-words text-slate-800 dark:text-[#F8FAFC] ${dimmed ? 'opacity-65' : ''}`}>
      {blocks.map((b, i) =>
        b.type === 'code' ? (
          <CodeBlockCard key={i} lang={b.lang || ''} code={b.value} />
        ) : (
          <span key={i} className="whitespace-pre-wrap">
            {renderInlineTokens(b.value, mentionMap, emojiMap, onOpenProfile, `seg-${i}`)}
          </span>
        )
      )}
      {edited && <span className="ml-1.5 text-[10px] text-slate-400 dark:text-[#A1A1B5]">(düzenlendi)</span>}
    </div>
  );
}

function PollCard({
  poll,
  onVote,
}: {
  poll: PollData;
  onVote: (pollId: string, optionId: string) => void;
}) {
  return (
    <div className="mt-2 max-w-md rounded-2xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#151522] p-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#A855F7] shrink-0" />
          <p className="text-sm font-bold text-slate-900 dark:text-[#F8FAFC]">{poll.question}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        {poll.options.map((opt) => {
          const pct = poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onVote(poll.id, opt.id)}
              className={`relative w-full text-left rounded-xl border px-3 py-2 overflow-hidden transition-colors ${
                opt.votedByMe
                  ? 'border-[#A855F7] bg-[#7C3AED]/15'
                  : 'border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A] hover:border-[#A855F7]/60'
              }`}
            >
              <div
                className={`absolute inset-y-0 left-0 transition-all duration-300 ${
                  opt.votedByMe ? 'bg-[#7C3AED]/20' : 'bg-slate-200/60 dark:bg-[#29293D]/60'
                }`}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-800 dark:text-[#F8FAFC] flex items-center gap-1.5">
                  {opt.votedByMe && <Check className="w-3.5 h-3.5 text-[#C084FC] shrink-0" />}
                  <span>{opt.label}</span>
                </span>
                <span className="font-mono text-[11px] text-slate-500 dark:text-[#A1A1B5] tabular-nums shrink-0">
                  {opt.votes} · %{pct}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] tabular-nums">
        Toplam {poll.totalVotes} oy · {poll.allowMultiple ? 'Çoklu seçime açık' : 'Tekli seçim'}
      </p>
    </div>
  );
}

export function MessageTimeline({
  mode,
  targetId,
  serverId,
  channelName,
  canSend = true,
  canAttachFiles = true,
  canPin = false,
  canDeleteOthers = false,
  canEditOthers = false,
  mentionCandidates = [],
  memberRoleColors = {},
  serverEmojis = [],
  serverOwnerId,
  onOpenProfile,
  onOpenThread,
  onForwardMessage,
}: Props) {
  const { profile: me, settings } = useAuth();
  const { showToast } = useToast();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const [draft, setDraft] = useState('');
  const [composerError, setComposerError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const [pendingAttachments, setPendingAttachments] = useState<UploadedAttachment[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const [pollBuilderOpen, setPollBuilderOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollAllowMultiple, setPollAllowMultiple] = useState(false);
  const [pollErrors, setPollErrors] = useState<{ question?: string; options?: string }>({});

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [reminderMenuMsgId, setReminderMenuMsgId] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordCancelRef = useRef(false);

  const [pickerTab, setPickerTab] = useState<'none' | 'emoji' | 'gif'>('none');
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState<Array<{ id: string; title: string; previewUrl: string; url: string }>>([]);
  const [gifConfigured, setGifConfigured] = useState<boolean | null>(null);
  const [gifLoading, setGifLoading] = useState(false);

  const [reactingMessageId, setReactingMessageId] = useState<string | null>(null);
  const [mobileActiveMsgId, setMobileActiveMsgId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [linkPreviews, setLinkPreviews] = useState<Record<string, LinkPreviewData | null>>({});
  const [nitroEmojis, setNitroEmojis] = useState<Array<ServerEmoji & { serverName?: string }>>([]);
  const [aiSummary, setAiSummary] = useState<{ summary: string; messageCount: number; model: string } | null>(null);
  const [aiSummarizing, setAiSummarizing] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const roomName = `${mode}:${targetId}`;
  const messagesEndpoint = mode === 'channel' ? `/channels/${targetId}/messages` : `/dm/conversations/${targetId}/messages`;

  // Load cross-server emojis for ORBIT Nitro subscribers
  useEffect(() => {
    if (me?.nitroTier !== 'nitro') {
      setNitroEmojis([]);
      return;
    }
    apiFetch<{ emojis: Array<ServerEmoji & { serverName?: string }> }>('/nitro/emojis')
      .then((res) => setNitroEmojis(res.emojis || []))
      .catch(() => setNitroEmojis([]));
  }, [me?.nitroTier]);

  // Auto-resize composer textarea cleanly
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [draft]);

  // Reset composer and transient UI states whenever switching channels/DMs
  useEffect(() => {
    setDraft('');
    setComposerError(null);
    setReplyTo(null);
    setEditingId(null);
    setEditDraft('');
    setPendingAttachments([]);
    setPickerTab('none');
    setReactingMessageId(null);
    setMobileActiveMsgId(null);
    setReminderMenuMsgId(null);
    setScheduleOpen(false);
    setFilterOpen(false);
    setFilterQuery('');
    setAiSummary(null);
    setPollBuilderOpen(false);
    setPollQuestion('');
    setPollOptions(['', '']);
    setPollAllowMultiple(false);
    setPollErrors({});
    setShowScrollBottom(false);
    setDragOver(false);
  }, [mode, targetId]);

  const loadInitialMessages = useCallback(async () => {
    setLoading(true);
    setMessages([]);
    try {
      const res = await apiFetch<{ messages: ChatMessage[]; hasMore: boolean }>(`${messagesEndpoint}?limit=40`);
      setMessages(res.messages);
      setHasMore(res.hasMore);
      await apiFetch(mode === 'channel' ? `/channels/${targetId}/read` : `/dm/conversations/${targetId}/read`, {
        method: 'POST',
      }).catch(() => {});
      window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 40);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Mesajlar yüklenemedi.', 'error');
    } finally {
      setLoading(false);
    }
  }, [messagesEndpoint, mode, targetId, showToast]);

  useEffect(() => {
    void loadInitialMessages();
    wsClient.subscribe(roomName);
    return () => {
      wsClient.unsubscribe(roomName);
      setTypingUsers({});
    };
  }, [loadInitialMessages, roomName]);

  // Listen to WebSocket events for this room
  useEffect(() => {
    return wsClient.onEvent((ev) => {
      const p = ev.payload;
      if (mode === 'channel' && p.channelId !== targetId) {
        if (ev.type !== 'presence:update' && ev.type !== 'typing:start' && ev.type !== 'typing:stop') return;
      }
      if (mode === 'dm' && p.conversationId !== targetId) {
        if (ev.type !== 'presence:update' && ev.type !== 'typing:start' && ev.type !== 'typing:stop') return;
      }

      if (ev.type === 'message:new' || ev.type === 'dm:new') {
        const incoming = p.message as ChatMessage;
        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev;
          if (incoming.clientNonce) {
            const idx = prev.findIndex((m) => m.clientNonce === incoming.clientNonce);
            if (idx !== -1) {
              const copy = [...prev];
              copy[idx] = incoming;
              return copy;
            }
          }
          return [...prev, incoming];
        });
        window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
        void apiFetch(mode === 'channel' ? `/channels/${targetId}/read` : `/dm/conversations/${targetId}/read`, {
          method: 'POST',
        }).catch(() => {});
      } else if (ev.type === 'message:updated' || ev.type === 'dm:updated') {
        const updated = p.message as ChatMessage;
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      } else if (ev.type === 'message:deleted' || ev.type === 'dm:deleted') {
        const deletedId = String(p.messageId || p.dmId || '');
        setMessages((prev) =>
          prev.map((m) => (m.id === deletedId ? { ...m, deletedAt: new Date().toISOString(), content: '', attachments: [], poll: null } : m))
        );
      } else if (ev.type === 'typing:start' && p.targetType === mode && p.targetId === targetId) {
        const uid = String(p.userId);
        const name = String(p.displayName);
        if (uid !== me?.userId) {
          setTypingUsers((prev) => ({ ...prev, [uid]: name }));
          window.setTimeout(() => {
            setTypingUsers((prev) => {
              const next = { ...prev };
              delete next[uid];
              return next;
            });
          }, 4000);
        }
      } else if (ev.type === 'typing:stop' && p.targetType === mode && p.targetId === targetId) {
        const uid = String(p.userId);
        setTypingUsers((prev) => {
          const next = { ...prev };
          delete next[uid];
          return next;
        });
      } else if (ev.type === 'presence:update') {
        const uid = String(p.userId);
        const patch: Partial<UserProfile> = {
          status: p.status as UserProfile['status'],
          isOnline: Boolean(p.isOnline),
          ...(p.customStatus !== undefined ? { customStatus: String(p.customStatus || '') } : {}),
          ...(p.displayName !== undefined ? { displayName: String(p.displayName) } : {}),
          ...(p.discriminator !== undefined ? { discriminator: String(p.discriminator) } : {}),
          ...(p.avatarUrl !== undefined ? { avatarUrl: (p.avatarUrl as string | null) ?? null } : {}),
          ...(p.bannerColor !== undefined ? { bannerColor: String(p.bannerColor) } : {}),
          ...(p.avatarFrame !== undefined ? { avatarFrame: p.avatarFrame as AvatarFrameKey } : {}),
          ...(p.activityType !== undefined ? { activityType: p.activityType as ActivityTypeKey } : {}),
          ...(p.activityText !== undefined ? { activityText: String(p.activityText || '') } : {}),
          ...(p.featuredBadge !== undefined ? { featuredBadge: (p.featuredBadge as BadgeKey | null) ?? null } : {}),
          ...(Array.isArray(p.badges) ? { badges: p.badges as OrbitBadge[] } : {}),
        };
        setMessages((prev) =>
          prev.map((m) => (m.authorId === uid ? { ...m, author: { ...m.author, ...patch } } : m))
        );
      }
    });
  }, [mode, targetId, me?.userId]);

  // Fetch link previews for visible messages with URLs
  useEffect(() => {
    for (const m of messages) {
      if (m.deletedAt) continue;
      const url = extractFirstUrl(m.content);
      if (url && linkPreviews[url] === undefined) {
        setLinkPreviews((prev) => ({ ...prev, [url]: null }));
        apiFetch<{ preview: LinkPreviewData | null }>(`/link-preview?url=${encodeURIComponent(url)}`)
          .then((res) => {
            if (res.preview) {
              setLinkPreviews((prev) => ({ ...prev, [url]: res.preview }));
            }
          })
          .catch(() => {});
      }
    }
  }, [messages, linkPreviews]);

  const emojiLookupMap = useMemo(() => {
    const map = new Map<string, ServerEmoji>();
    for (const em of nitroEmojis) map.set(em.name, em);
    for (const em of serverEmojis) map.set(em.name, em);
    return map;
  }, [serverEmojis, nitroEmojis]);

  const mentionLookupMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const u of mentionCandidates) {
      map.set(u.username.toLowerCase(), u);
    }
    for (const m of messages) {
      if (m.author?.username && !map.has(m.author.username.toLowerCase())) {
        map.set(m.author.username.toLowerCase(), m.author);
      }
    }
    return map;
  }, [mentionCandidates, messages]);

  const loadOlderMessages = async () => {
    if (!messages.length || loadingMore) return;
    setLoadingMore(true);
    const oldest = messages[0].createdAt;
    const prevHeight = scrollContainerRef.current?.scrollHeight || 0;
    try {
      const res = await apiFetch<{ messages: ChatMessage[]; hasMore: boolean }>(
        `${messagesEndpoint}?limit=40&before=${encodeURIComponent(oldest)}`
      );
      setMessages((prev) => [...res.messages, ...prev]);
      setHasMore(res.hasMore);
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight - prevHeight;
        }
      });
    } catch {
      showToast('Eski mesajlar yüklenemedi.', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const emitTyping = () => {
    wsClient.send('typing:start', { targetType: mode, targetId });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      wsClient.send('typing:stop', { targetType: mode, targetId });
    }, 2500);
  };

  const sendPayload = async (
    contentText: string,
    attachmentsToSend: UploadedAttachment[],
    nonce: string,
    replyObj: ChatMessage | null,
    pollInput?: { question: string; options: string[]; allowMultiple: boolean }
  ) => {
    try {
      const res = await apiFetch<{ message: ChatMessage }>(messagesEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          content: contentText,
          replyToId: replyObj?.id || null,
          clientNonce: nonce,
          attachmentIds: attachmentsToSend.map((a) => a.id),
          poll: pollInput,
        }),
      });
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.clientNonce === nonce);
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = res.message;
          return next;
        }
        if (prev.some((m) => m.id === res.message.id)) return prev;
        return [...prev, res.message];
      });
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.clientNonce === nonce ? { ...m, status: 'failed' } : m)));
      showToast(err instanceof ApiError ? err.message : 'Mesaj gönderilemedi.', 'error');
    }
  };

  const executeSlashCommand = async (raw: string): Promise<boolean> => {
    const parts = raw.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === '/zar') {
      const max = Math.max(2, Math.min(10000, parseInt(parts[1] || '100', 10) || 100));
      const roll = Math.floor(Math.random() * max) + 1;
      await sendPayload(`🎲 **${me?.displayName || 'Kullanıcı'}** 1-${max} arası zar attı: **${roll}**`, [], crypto.randomUUID(), null);
      setDraft('');
      return true;
    }

    if (cmd === '/yazi-tura') {
      const side = Math.random() < 0.5 ? 'Yazı' : 'Tura';
      await sendPayload(`🪙 **${me?.displayName || 'Kullanıcı'}** para attı: **${side}**`, [], crypto.randomUUID(), null);
      setDraft('');
      return true;
    }

    if (cmd === '/anket') {
      if (mode !== 'channel') {
        showToast('Anket komutu yalnızca sunucu kanallarında kullanılabilir.', 'error');
        return true;
      }
      const body = raw.slice(cmd.length).trim();
      const segs = body.split('|').map((s) => s.trim()).filter(Boolean);
      if (segs.length < 3) {
        showToast('Kullanım: /anket Soru | Seçenek 1 | Seçenek 2', 'error');
        return true;
      }
      const [question, ...options] = segs;
      await sendPayload(`📊 Anket: ${question}`, [], crypto.randomUUID(), null, {
        question: question.slice(0, 140),
        options: options.slice(0, 6),
        allowMultiple: false,
      });
      setDraft('');
      return true;
    }

    if (cmd === '/hatirlat') {
      const mins = Math.max(1, Math.min(10080, parseInt(parts[1] || '15', 10) || 15));
      const note = parts.slice(2).join(' ').trim() || 'ORBIT Hatırlatma';
      try {
        await apiFetch('/reminders', {
          method: 'POST',
          body: JSON.stringify({
            channelId: mode === 'channel' ? targetId : null,
            conversationId: mode === 'dm' ? targetId : null,
            note,
            remindAt: new Date(Date.now() + mins * 60_000).toISOString(),
          }),
        });
        showToast(`${mins} dakika sonrası için hatırlatıcı kuruldu.`, 'success');
        setDraft('');
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Hatırlatıcı kurulamadı.', 'error');
      }
      return true;
    }

    if (cmd === '/temizle') {
      if (mode !== 'channel') {
        showToast('Bu komut yalnızca sunucu kanallarında kullanılabilir.', 'error');
        return true;
      }
      const count = Math.max(1, Math.min(50, parseInt(parts[1] || '10', 10) || 10));
      try {
        const res = await apiFetch<{ deletedCount: number }>(`/channels/${targetId}/purge`, {
          method: 'POST',
          body: JSON.stringify({ count }),
        });
        showToast(`${res.deletedCount} mesaj kanaldan temizlendi.`, 'success');
        setDraft('');
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Kanal temizlenemedi.', 'error');
      }
      return true;
    }

    if (cmd === '/sustur') {
      if (mode !== 'channel' || !serverId) {
        showToast('Bu komut yalnızca sunucu kanallarında kullanılabilir.', 'error');
        return true;
      }
      const targetHandle = (parts[1] || '').replace(/^@/, '').toLowerCase();
      const targetUser = mentionCandidates.find((u) => u.username.toLowerCase() === targetHandle);
      if (!targetUser) {
        showToast('Kullanım: /sustur @kullanici [dakika]', 'error');
        return true;
      }
      const mins = Math.max(1, Math.min(10080, parseInt(parts[2] || '10', 10) || 10));
      try {
        await apiFetch(`/servers/${serverId}/members/${targetUser.userId}/mute`, {
          method: 'POST',
          body: JSON.stringify({ minutes: mins }),
        });
        showToast(`${targetUser.displayName} ${mins} dakika susturuldu.`, 'success');
        setDraft('');
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Üye susturulamadı.', 'error');
      }
      return true;
    }

    return false;
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!me) return;
    if (!draft.trim() && pendingAttachments.length === 0) {
      setComposerError('Boş mesaj gönderilemez. Metin yazın veya dosya ekleyin.');
      composerRef.current?.focus();
      return;
    }
    setComposerError(null);
    const contentText = draft.trim();
    if (contentText.startsWith('/') && pendingAttachments.length === 0) {
      const handled = await executeSlashCommand(contentText);
      if (handled) return;
    }
    const attachmentsToSend = [...pendingAttachments];
    const currentReply = replyTo;
    const nonce = crypto.randomUUID();

    const optimistic: ChatMessage = {
      id: `temp-${nonce}`,
      channelId: mode === 'channel' ? targetId : undefined,
      conversationId: mode === 'dm' ? targetId : undefined,
      authorId: me.userId,
      author: me,
      content: contentText,
      replyToId: currentReply?.id || null,
      replyTo: currentReply
        ? {
            id: currentReply.id,
            authorId: currentReply.authorId,
            authorName: currentReply.author.displayName,
            content: currentReply.content.slice(0, 140),
          }
        : null,
      clientNonce: nonce,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      attachments: attachmentsToSend.map((a) => ({ ...a, messageId: null, dmId: null, uploaderId: me.userId, createdAt: '' })),
      reactions: [],
      status: 'sending',
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    setPendingAttachments([]);
    setReplyTo(null);
    setPickerTab('none');
    wsClient.send('typing:stop', { targetType: mode, targetId });
    window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);

    await sendPayload(contentText, attachmentsToSend, nonce, currentReply);
  };

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
    const errs: { question?: string; options?: string } = {};
    if (!pollQuestion.trim()) {
      errs.question = 'Anket sorusu boş bırakılamaz.';
    }
    if (cleanedOptions.length < 2) {
      errs.options = 'En az 2 dolu anket seçeneği girmelisiniz.';
    }
    if (Object.keys(errs).length > 0) {
      setPollErrors(errs);
      return;
    }
    setPollErrors({});
    const nonce = crypto.randomUUID();
    await sendPayload(draft.trim() || `📊 Anket: ${pollQuestion.trim()}`, [], nonce, null, {
      question: pollQuestion.trim(),
      options: cleanedOptions,
      allowMultiple: pollAllowMultiple,
    });
    setPollBuilderOpen(false);
    setPollQuestion('');
    setPollOptions(['', '']);
    setPollAllowMultiple(false);
    setDraft('');
    window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const handlePollVote = async (pollId: string, optionId: string) => {
    if (mode !== 'channel') return;
    try {
      const res = await apiFetch<{ message: ChatMessage }>(`/channels/${targetId}/polls/${pollId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ optionId }),
      });
      setMessages((prev) => prev.map((m) => (m.id === res.message.id ? res.message : m)));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Oy kaydedilemedi.', 'error');
    }
  };

  const handleRetryFailed = async (failedMsg: ChatMessage) => {
    if (!failedMsg.clientNonce) return;
    setMessages((prev) => prev.map((m) => (m.id === failedMsg.id ? { ...m, status: 'sending' } : m)));
    await sendPayload(
      failedMsg.content,
      failedMsg.attachments.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, url: a.url })),
      failedMsg.clientNonce,
      null
    );
  };

  const uploadFileList = async (files: File[]) => {
    if (!files.length || !canSend) return;
    if (!canAttachFiles) {
      showToast('Bu kanalda dosya ekleme izniniz bulunmuyor.', 'error');
      return;
    }
    const formData = new FormData();
    for (const f of files.slice(0, 4)) {
      formData.append('files', f);
    }
    setUploadProgress(0);
    try {
      const res = await uploadFilesWithProgress('/files/upload', formData, (pct) => setUploadProgress(pct));
      setPendingAttachments((prev) => [...prev, ...res.files].slice(0, 4));
      setComposerError(null);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Dosya yüklenemedi.', 'error');
    } finally {
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await uploadFileList(Array.from(files));
  };

  const startVoiceNote = async () => {
    if (!canSend || !canAttachFiles || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showToast('Tarayıcınız ses kaydını desteklemiyor.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recordChunksRef.current = [];
      recordCancelRef.current = false;
      mediaRecorderRef.current = rec;
      setRecordSeconds(0);
      setRecording(true);

      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 119) {
            rec.stop();
            return 120;
          }
          return s + 1;
        });
      }, 1000);

      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };

      rec.onstop = async () => {
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setRecordSeconds(0);
        if (recordCancelRef.current || recordChunksRef.current.length === 0) return;

        const blob = new Blob(recordChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `ses-notu-${Date.now()}.${ext}`, { type: blob.type || 'audio/webm' });
        const fd = new FormData();
        fd.append('files', file);
        setUploadProgress(0);
        try {
          const uploaded = await uploadFilesWithProgress('/files/upload', fd, (pct) => setUploadProgress(pct));
          if (uploaded.files.length > 0) {
            await sendPayload('', uploaded.files, crypto.randomUUID(), replyTo);
            setReplyTo(null);
          }
        } catch (err) {
          showToast(err instanceof ApiError ? err.message : 'Ses notu yüklenemedi.', 'error');
        } finally {
          setUploadProgress(null);
        }
      };

      rec.start(250);
    } catch {
      showToast('Mikrofon izni alınamadı.', 'error');
      setRecording(false);
    }
  };

  const stopVoiceNote = (cancel: boolean) => {
    recordCancelRef.current = cancel;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleScheduleMessage = async (sendDateIso: string) => {
    if (!draft.trim()) {
      showToast('Zamanlamak için önce mesaj metni yazın.', 'error');
      return;
    }
    try {
      await apiFetch('/scheduled-messages', {
        method: 'POST',
        body: JSON.stringify({
          channelId: mode === 'channel' ? targetId : null,
          conversationId: mode === 'dm' ? targetId : null,
          content: draft.trim(),
          sendAt: sendDateIso,
        }),
      });
      setDraft('');
      setScheduleOpen(false);
      showToast('Mesaj zamanlandı! Ayarlar > Zamanlanmış Mesajlar bölümünden yönetebilirsiniz.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Mesaj zamanlanamadı.', 'error');
    }
  };

  const handleOpenOrCreateThread = async (msg: ChatMessage) => {
    if (msg.threadSummary?.id) {
      onOpenThread?.(msg.threadSummary.id);
      return;
    }
    try {
      const res = await apiFetch<{ thread: { id: string } }>(`/messages/${msg.id}/threads`, {
        method: 'POST',
        body: JSON.stringify({ title: msg.content.slice(0, 60) || 'Alt Konu' }),
      });
      onOpenThread?.(res.thread.id);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Alt konu açılamadı.', 'error');
    }
  };

  const handleQuickReminder = async (msg: ChatMessage, minutes: number) => {
    setReminderMenuMsgId(null);
    setMobileActiveMsgId(null);
    try {
      await apiFetch('/reminders', {
        method: 'POST',
        body: JSON.stringify({
          messageId: msg.id,
          channelId: mode === 'channel' ? targetId : null,
          conversationId: mode === 'dm' ? targetId : null,
          note: `${msg.author.displayName}: "${(msg.content || '[Ek]').slice(0, 100)}"`,
          remindAt: new Date(Date.now() + minutes * 60_000).toISOString(),
        }),
      });
      showToast(`${minutes >= 60 ? '1 saat' : `${minutes} dakika`} sonra hatırlatılacak.`, 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Hatırlatıcı eklenemedi.', 'error');
    }
  };

  const handleEditSave = async (messageId: string) => {
    if (!editDraft.trim()) {
      showToast('Düzenlenen mesaj boş bırakılamaz.', 'error');
      return;
    }
    const url = mode === 'channel' ? `/messages/${messageId}` : `/dm/messages/${messageId}`;
    try {
      const res = await apiFetch<{ message: ChatMessage }>(url, {
        method: 'PATCH',
        body: JSON.stringify({ content: editDraft.trim() }),
      });
      setMessages((prev) => prev.map((m) => (m.id === messageId ? res.message : m)));
      setEditingId(null);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Mesaj düzenlenemedi.', 'error');
    }
  };

  const handleDelete = async (messageId: string) => {
    const url = mode === 'channel' ? `/messages/${messageId}` : `/dm/messages/${messageId}`;
    try {
      await apiFetch(url, { method: 'DELETE' });
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Mesaj silinemedi.', 'error');
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    const url = mode === 'channel' ? `/messages/${messageId}/reactions` : `/dm/messages/${messageId}/reactions`;
    setReactingMessageId(null);
    try {
      const res = await apiFetch<{ message: ChatMessage }>(url, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      setMessages((prev) => prev.map((m) => (m.id === messageId ? res.message : m)));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Tepki eklenemedi.', 'error');
    }
  };

  const handlePin = async (messageId: string) => {
    const url = mode === 'channel' ? `/messages/${messageId}/pin` : `/dm/messages/${messageId}/pin`;
    try {
      const res = await apiFetch<{ message: ChatMessage }>(url, { method: 'POST' });
      setMessages((prev) => prev.map((m) => (m.id === messageId ? res.message : m)));
      showToast(res.message.isPinned ? 'Mesaj sabitlendi.' : 'Mesaj sabitlemesi kaldırıldı.', 'info');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Sabitleme başarısız.', 'error');
    }
  };

  const handleReportMessage = async (msg: ChatMessage) => {
    try {
      await apiFetch('/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType: 'message',
          targetId: msg.id,
          serverId: serverId || null,
          reason: `Uygunsuz mesaj bildirimi: "${msg.content.slice(0, 80)}"`,
        }),
      });
      showToast('Mesaj moderasyona bildirildi.', 'success');
    } catch {
      showToast('Şikâyet gönderilemedi.', 'error');
    }
  };

  const loadGifs = useCallback(async (q: string) => {
    setGifLoading(true);
    try {
      const res = await apiFetch<{
        configured: boolean;
        results: Array<{ id: string; title: string; previewUrl: string; url: string }>;
      }>(`/gifs/search?q=${encodeURIComponent(q || 'trending')}`);
      setGifConfigured(res.configured);
      setGifResults(res.results);
    } catch {
      setGifConfigured(false);
    } finally {
      setGifLoading(false);
    }
  }, []);

  useEffect(() => {
    if (pickerTab === 'gif') {
      const timer = window.setTimeout(() => void loadGifs(gifQuery), 250);
      return () => clearTimeout(timer);
    }
  }, [pickerTab, gifQuery, loadGifs]);

  // Mention autocomplete
  const mentionQuery = useMemo(() => {
    const match = draft.match(/(?:^|\s)@([a-zA-Z0-9_.-]{1,20})$/);
    return match ? match[1].toLowerCase() : null;
  }, [draft]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    return mentionCandidates
      .filter(
        (u) =>
          u.username.toLowerCase().includes(mentionQuery) ||
          u.displayName.toLowerCase().includes(mentionQuery)
      )
      .slice(0, 5);
  }, [mentionQuery, mentionCandidates]);

  const insertMention = (username: string) => {
    setDraft((prev) => prev.replace(/@([a-zA-Z0-9_.-]{1,20})$/, `@${username} `));
  };

  const slashMatches = useMemo(() => {
    if (!draft.startsWith('/') || draft.includes('\n') || draft.includes(' ')) return [];
    const q = draft.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.command.startsWith(q));
  }, [draft]);

  const isCompact = settings?.messageDensity === 'compact';
  const typingNames = Object.values(typingUsers);

  const visibleMessages = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.author.displayName.toLowerCase().includes(q) ||
        m.author.username.toLowerCase().includes(q)
    );
  }, [messages, filterQuery]);

  return (
    <div
      className="relative flex flex-col h-full min-h-0"
      onDragOver={(e) => {
        if (!canSend || !canAttachFiles) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!canSend || !canAttachFiles) return;
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) {
          void uploadFileList(Array.from(e.dataTransfer.files));
        }
      }}
    >
      {dragOver && (
        <div className="absolute inset-3 z-30 rounded-2xl border-2 border-dashed border-[#A855F7] bg-[#7C3AED]/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="text-center space-y-1">
            <Paperclip className="w-7 h-7 text-[#C084FC] mx-auto" />
            <p className="text-sm font-semibold text-[#C084FC]">Dosyaları yüklemek için bırakın</p>
          </div>
        </div>
      )}

      {/* Subtle Floating In-Chat Filter & AI Summary Bar */}
      {messages.length > 0 && (
        <div className="absolute top-2 right-4 z-20 flex items-center gap-1.5">
          {mode === 'channel' && !filterOpen && (
            <button
              type="button"
              disabled={aiSummarizing}
              onClick={async () => {
                setAiSummarizing(true);
                try {
                  const res = await apiFetch<{ summary: string; messageCount: number; model: string }>('/ai/summarize', {
                    method: 'POST',
                    body: JSON.stringify({ channelId: targetId, limit: 50 }),
                  });
                  setAiSummary(res);
                } catch (err) {
                  showToast(err instanceof ApiError ? err.message : 'Sohbet özetlenemedi.', 'error');
                } finally {
                  setAiSummarizing(false);
                }
              }}
              title="Kanaldaki son mesajları yapay zekâ ile özetle"
              className="h-7 px-2.5 rounded-lg bg-white/85 dark:bg-[#151522]/90 border border-[#7C3AED]/35 hover:border-[#A855F7] text-[11px] font-medium text-[#7C3AED] dark:text-[#C084FC] flex items-center gap-1 backdrop-blur-sm shadow-sm transition-colors disabled:opacity-50"
            >
              {aiSummarizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              <span className="hidden sm:inline">{aiSummarizing ? 'Özetleniyor...' : 'AI Özetle'}</span>
            </button>
          )}

          {filterOpen ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/95 dark:bg-[#151522]/95 border border-slate-200 dark:border-[#29293D] shadow-lg backdrop-blur-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 dark:text-[#A1A1B5] shrink-0" />
              <input
                type="text"
                autoFocus
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Sohbette filtrele..."
                className="w-36 sm:w-48 bg-transparent text-xs focus:outline-none text-slate-800 dark:text-[#F8FAFC]"
              />
              {filterQuery && (
                <span className="text-[10px] font-mono text-[#C084FC] tabular-nums">
                  {visibleMessages.length}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setFilterQuery('');
                  setFilterOpen(false);
                }}
                aria-label="Filtreyi kapat"
                className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setFilterOpen(true)}
              title="Yüklü mesajlarda filtrele"
              className="h-7 px-2.5 rounded-lg bg-white/80 dark:bg-[#151522]/85 border border-slate-200/80 dark:border-[#29293D] hover:border-[#A855F7]/50 text-[11px] text-slate-500 dark:text-[#A1A1B5] hover:text-[#7C3AED] dark:hover:text-[#C084FC] flex items-center gap-1 backdrop-blur-sm shadow-sm transition-colors"
            >
              <Search className="w-3 h-3" />
              <span className="hidden sm:inline">Filtrele</span>
            </button>
          )}
        </div>
      )}

      {aiSummary && (
        <div className="mx-3 sm:mx-4 mt-3 p-3.5 rounded-2xl border border-[#7C3AED]/35 bg-[#7C3AED]/10 text-xs space-y-1.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-[#C084FC] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Yapay Zekâ Kanal Özeti ({aiSummary.messageCount} mesaj)
            </span>
            <button
              type="button"
              onClick={() => setAiSummary(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-white"
              aria-label="Özeti kapat"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-slate-700 dark:text-[#F8FAFC] whitespace-pre-wrap leading-relaxed">{aiSummary.summary}</p>
        </div>
      )}

      {/* Message List */}
      <div
        ref={scrollContainerRef}
        onScroll={() => {
          const el = scrollContainerRef.current;
          if (!el) return;
          const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
          setShowScrollBottom(dist > 260);
        }}
        className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-1"
      >
        {hasMore && (
          <div className="flex justify-center pb-4">
            <button
              type="button"
              onClick={loadOlderMessages}
              disabled={loadingMore}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-slate-200/70 dark:bg-[#19192A] hover:bg-slate-200 dark:hover:bg-[#222238] text-slate-700 dark:text-[#F8FAFC] flex items-center gap-2 border dark:border-[#29293D]"
            >
              {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Eski mesajları yükle
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-4 py-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-[#19192A] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-36 bg-slate-200 dark:bg-[#19192A] rounded" />
                  <div className="h-4 w-3/4 bg-slate-200 dark:bg-[#19192A] rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-16 px-4">
            <div className="w-12 h-12 rounded-2xl bg-[#7C3AED]/15 border border-[#7C3AED]/30 flex items-center justify-center text-[#C084FC] mb-3 font-display font-bold text-lg">
              {filterQuery.trim() ? <Search className="w-5 h-5" /> : mode === 'channel' ? '#' : '@'}
            </div>
            <h3 className="text-base font-semibold font-display">
              {filterQuery.trim()
                ? 'Eşleşen mesaj bulunamadı'
                : channelName
                ? `${channelName} başlangıcı`
                : 'Sohbet başlangıcı'}
            </h3>
            <p className="text-sm text-slate-500 dark:text-[#A1A1B5] max-w-sm mt-1">
              {filterQuery.trim()
                ? 'Farklı bir anahtar kelime deneyin veya filtreyi temizleyin.'
                : 'Burada henüz mesaj yok. İlk mesajı göndererek sohbeti başlatın.'}
            </p>
          </div>
        ) : (
          visibleMessages.map((msg, idx) => {
            const prev = visibleMessages[idx - 1];
            const showDateDivider = !prev || !isSameCalendarDay(prev.createdAt, msg.createdAt);
            const grouped =
              !isCompact &&
              prev &&
              !showDateDivider &&
              prev.authorId === msg.authorId &&
              !msg.replyTo &&
              !msg.poll &&
              !prev.deletedAt &&
              !msg.deletedAt &&
              parseUtcMs(msg.createdAt) - parseUtcMs(prev.createdAt) < 5 * 60 * 1000;

            const isOwn = msg.authorId === me?.userId;
            const mentionsMe = Boolean(
              me &&
                !isOwn &&
                !msg.deletedAt &&
                msg.content.toLowerCase().includes(`@${me.username.toLowerCase()}`)
            );
            const urlInText = !msg.deletedAt ? extractFirstUrl(msg.content) : null;
            const preview = urlInText ? linkPreviews[urlInText] : null;
            const isGifDirectUrl = urlInText && /\.(gif|webp)(\?.*)?$/i.test(urlInText);
            const mobileBarOpen = mobileActiveMsgId === msg.id;

            return (
              <React.Fragment key={msg.id}>
                {showDateDivider && (
                  <div className="flex items-center gap-3 py-2.5 select-none">
                    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800/80" />
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {formatDateDivider(msg.createdAt)}
                    </span>
                    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800/80" />
                  </div>
                )}

                <div
                  className={`group relative rounded-xl px-2.5 transition-colors hover:bg-slate-200/50 dark:hover:bg-white/[0.03] ${
                    grouped ? 'py-0.5' : isCompact ? 'py-1 mt-1' : 'py-1.5 mt-2'
                  } ${msg.isPinned ? 'bg-indigo-500/[0.04]' : ''} ${
                    mentionsMe ? 'border-l-2 border-amber-400 bg-amber-500/[0.06] pl-2' : ''
                  }`}
                >
                  {/* Reply reference */}
                  {msg.replyTo && !msg.deletedAt && (
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 pl-11 mb-1">
                      <CornerUpLeft className="w-3 h-3 shrink-0" />
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{msg.replyTo.authorName}</span>
                      <span className="truncate max-w-md">{msg.replyTo.content}</span>
                    </div>
                  )}

                  <div className="flex items-start gap-3">
                    {grouped ? (
                      <span className="w-9 text-[10px] font-mono text-slate-500 dark:text-slate-400 opacity-0 group-hover:opacity-100 text-right pt-1 select-none shrink-0 tabular-nums">
                        {formatTime(msg.createdAt)}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenProfile(msg.authorId)}
                        className="shrink-0 mt-0.5 focus:outline-none"
                      >
                        <UserAvatar
                          src={msg.author.avatarUrl}
                          name={msg.author.displayName}
                          status={msg.author.status}
                          frame={msg.author.avatarFrame}
                          size="md"
                          showStatus={false}
                        />
                      </button>
                    )}

                    <div className="flex-1 min-w-0">
                      {!grouped && (
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => onOpenProfile(msg.authorId)}
                            style={!msg.webhookName && memberRoleColors[msg.authorId] ? { color: memberRoleColors[msg.authorId] } : undefined}
                            className="text-sm font-semibold hover:underline text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5"
                          >
                            <span>{msg.webhookName || msg.author.displayName}</span>
                            {(msg.webhookName || msg.author.isBot) && (
                              <BotBadge verified={Boolean(msg.author.isVerifiedBot)} />
                            )}
                            {!msg.webhookName && !msg.author.isBot && msg.author.nitroTier === 'nitro' && <NitroBadge />}
                            {!msg.webhookName && serverOwnerId && msg.authorId === serverOwnerId && (
                              <Crown className="w-3.5 h-3.5 text-amber-400 inline shrink-0" aria-label="Sunucu Sahibi" />
                            )}
                          </button>
                          {!msg.webhookName && !msg.author.isBot && msg.author.featuredBadge && (
                            <FeaturedBadgeIcon
                              badgeKey={msg.author.featuredBadge}
                              size={14}
                              onClick={() => onOpenProfile(msg.authorId)}
                            />
                          )}
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                            {formatTime(msg.createdAt)}
                          </span>
                          {msg.isAnnouncement && (
                            <span className="text-[11px] font-medium text-[#7C3AED] dark:text-[#C084FC]">· Duyuru</span>
                          )}
                          {msg.isPinned && (
                            <span className="text-[11px] font-medium text-[#F59E0B] flex items-center gap-0.5">
                              · <Pin className="w-3 h-3" /> Sabitlendi
                            </span>
                          )}
                          {!msg.deletedAt && !msg.id.startsWith('temp-') && (
                            <button
                              type="button"
                              onClick={() => setMobileActiveMsgId(mobileBarOpen ? null : msg.id)}
                              aria-label="Mesaj işlemleri"
                              className="sm:hidden ml-auto p-1 rounded-lg text-slate-500 dark:text-[#A1A1B5] hover:bg-slate-200 dark:hover:bg-[#19192A]"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}

                      {msg.deletedAt ? (
                        <p className="text-xs italic text-slate-500 dark:text-[#A1A1B5] py-0.5">Bu mesaj silindi.</p>
                      ) : editingId === msg.id ? (
                        <div className="mt-1 flex items-center gap-2">
                          <input
                            type="text"
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleEditSave(msg.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            autoFocus
                            className="flex-1 h-9 px-3 rounded-lg bg-white dark:bg-[#19192A] border border-[#A855F7]/60 text-sm focus:outline-none focus:ring-2 focus:ring-[#A855F7]"
                          />
                          <button
                            type="button"
                            onClick={() => void handleEditSave(msg.id)}
                            className="h-9 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-medium flex items-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Kaydet
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="h-9 px-2.5 rounded-lg text-xs text-slate-500 dark:text-[#A1A1B5] hover:text-slate-900 dark:hover:text-white"
                          >
                            İptal
                          </button>
                        </div>
                      ) : (
                        <>
                          {msg.content && (
                            <FormattedMessageContent
                              content={msg.content}
                              mentionMap={mentionLookupMap}
                              emojiMap={emojiLookupMap}
                              onOpenProfile={onOpenProfile}
                              edited={Boolean(msg.editedAt)}
                              dimmed={msg.status === 'sending'}
                            />
                          )}

                          {msg.forwardedFrom && (
                            <div className="mt-2 max-w-lg rounded-xl border-l-2 border-[#7C3AED] bg-slate-100/80 dark:bg-[#151522] p-2.5 space-y-1">
                              <div className="flex items-center gap-1.5 text-[11px] text-[#C084FC] font-semibold">
                                <Forward className="w-3 h-3" />
                                <span>İletilen Mesaj · {msg.forwardedFrom.authorName}</span>
                                {msg.forwardedFrom.channelName && (
                                  <span className="text-slate-400 dark:text-[#A1A1B5] font-normal">(#{msg.forwardedFrom.channelName})</span>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 dark:text-[#F8FAFC] whitespace-pre-wrap break-words">
                                {msg.forwardedFrom.content}
                              </p>
                            </div>
                          )}

                          {msg.poll && <PollCard poll={msg.poll} onVote={(pid, oid) => void handlePollVote(pid, oid)} />}

                          {msg.status === 'failed' && (
                            <button
                              type="button"
                              onClick={() => void handleRetryFailed(msg)}
                              className="mt-1 inline-flex items-center gap-1.5 text-xs text-[#EF4444] hover:text-red-300 font-medium"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Gönderilemedi — Tekrar dene
                            </button>
                          )}

                          {isGifDirectUrl && urlInText && (
                            <img
                              src={urlInText}
                              alt="GIF"
                              referrerPolicy="no-referrer"
                              className="mt-2 max-h-60 rounded-xl border border-slate-200 dark:border-[#29293D] object-contain"
                            />
                          )}

                          {preview && !isGifDirectUrl && (
                            <a
                              href={preview.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 block max-w-md rounded-xl border border-slate-200 dark:border-[#29293D] bg-white/70 dark:bg-[#151522] p-3 hover:border-[#A855F7]/50 transition-colors"
                            >
                              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-[#A1A1B5]">
                                <span>{preview.domain}</span>
                                <ExternalLink className="w-3 h-3" />
                              </div>
                              <p className="text-sm font-semibold mt-0.5 line-clamp-1">{preview.title}</p>
                              {preview.description && (
                                <p className="text-xs text-slate-500 dark:text-[#A1A1B5] mt-0.5 line-clamp-2">
                                  {preview.description}
                                </p>
                              )}
                            </a>
                          )}

                          {/* Attachments */}
                          {msg.attachments.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {msg.attachments.map((att) => {
                                const resolvedUrl = resolveMediaUrl(att.url) || att.url;
                                if (att.mimeType.startsWith('image/')) {
                                  return (
                                    <a
                                      key={att.id}
                                      href={resolvedUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block rounded-xl overflow-hidden border border-slate-200 dark:border-[#29293D] max-w-xs"
                                    >
                                      <img
                                        src={resolvedUrl}
                                        alt={att.fileName}
                                        referrerPolicy="no-referrer"
                                        className="max-h-64 object-cover"
                                      />
                                    </a>
                                  );
                                }
                                if (att.mimeType.startsWith('video/')) {
                                  return (
                                    <video
                                      key={att.id}
                                      src={resolvedUrl}
                                      controls
                                      className="max-h-64 max-w-sm rounded-xl border border-slate-200 dark:border-[#29293D]"
                                    />
                                  );
                                }
                                if (att.mimeType.startsWith('audio/')) {
                                  return <VoiceNotePlayer key={att.id} url={resolvedUrl} fileName={att.fileName} />;
                                }
                                return (
                                  <a
                                    key={att.id}
                                    href={resolvedUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#151522] hover:border-[#A855F7]/50 max-w-xs"
                                  >
                                    <FileText className="w-5 h-5 text-[#A855F7] shrink-0" />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-medium truncate">{att.fileName}</p>
                                      <p className="text-[11px] font-mono text-slate-500 dark:text-[#A1A1B5]">
                                        {formatBytes(att.sizeBytes)}
                                      </p>
                                    </div>
                                    <Download className="w-4 h-4 text-slate-400 shrink-0" />
                                  </a>
                                );
                              })}
                            </div>
                          )}

                          {/* Thread Summary Pill */}
                          {mode === 'channel' && msg.threadSummary && (
                            <button
                              type="button"
                              onClick={() => onOpenThread?.(msg.threadSummary!.id)}
                              className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#7C3AED]/10 border border-[#7C3AED]/30 hover:bg-[#7C3AED]/20 text-xs text-[#C084FC] font-medium transition-colors"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              <span className="truncate max-w-[200px]">{msg.threadSummary.title}</span>
                              <span className="font-mono text-[11px] text-[#A855F7]">
                                · {msg.threadSummary.replyCount} yanıt · Alt Konuyu Aç
                              </span>
                            </button>
                          )}

                          {/* Reactions */}
                          {msg.reactions.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {msg.reactions.map((r) => (
                                <button
                                  key={r.emoji}
                                  type="button"
                                  onClick={() => void handleReaction(msg.id, r.emoji)}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-mono border transition-colors tabular-nums ${
                                    r.reactedByMe
                                      ? 'bg-[#7C3AED]/20 border-[#A855F7]/50 text-[#7C3AED] dark:text-[#C084FC]'
                                      : 'bg-slate-100 dark:bg-[#19192A] border-slate-200 dark:border-[#29293D] text-slate-600 dark:text-[#F8FAFC]'
                                  }`}
                                >
                                  <span>{r.emoji}</span>
                                  <span>{r.count}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Hover / Mobile-Tap Action Bar */}
                  {!msg.deletedAt && !msg.id.startsWith('temp-') && (
                    <div
                      className={`transition-opacity absolute -top-3 right-3 flex items-center gap-0.5 rounded-xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-lg p-0.5 z-10 ${
                        mobileBarOpen
                          ? 'opacity-100 pointer-events-auto'
                          : 'opacity-0 pointer-events-none sm:group-hover:opacity-100 sm:group-hover:pointer-events-auto sm:focus-within:opacity-100 sm:focus-within:pointer-events-auto'
                      }`}
                    >
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setReactingMessageId(reactingMessageId === msg.id ? null : msg.id)}
                          title="Tepki ekle"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#19192A] text-slate-500 dark:text-[#A1A1B5]"
                        >
                          <Smile className="w-3.5 h-3.5" />
                        </button>
                        {reactingMessageId === msg.id && (
                          <div className="absolute right-0 top-8 z-30 bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] rounded-xl p-2 shadow-xl grid grid-cols-4 gap-1 w-40">
                            {QUICK_EMOJIS.slice(0, 8).map((em) => (
                              <button
                                key={em}
                                type="button"
                                onClick={() => void handleReaction(msg.id, em)}
                                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#19192A] text-base"
                              >
                                {em}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setReplyTo(msg);
                          setMobileActiveMsgId(null);
                        }}
                        title="Yanıtla"
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-300"
                      >
                        <CornerUpLeft className="w-3.5 h-3.5" />
                      </button>
                      {mode === 'channel' && onOpenThread && (
                        <button
                          type="button"
                          onClick={() => {
                            void handleOpenOrCreateThread(msg);
                            setMobileActiveMsgId(null);
                          }}
                          title="Alt Konu Aç"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-300"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onForwardMessage && (
                        <button
                          type="button"
                          onClick={() => {
                            onForwardMessage(msg);
                            setMobileActiveMsgId(null);
                          }}
                          title="Mesajı İlet"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-300"
                        >
                          <Forward className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setReminderMenuMsgId(reminderMenuMsgId === msg.id ? null : msg.id)}
                          title="Hatırlatıcı Kur"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-300"
                        >
                          <Bell className="w-3.5 h-3.5" />
                        </button>
                        {reminderMenuMsgId === msg.id && (
                          <div className="absolute right-0 top-8 z-30 w-36 rounded-xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-xl p-1 text-xs space-y-0.5">
                            <button
                              type="button"
                              onClick={() => void handleQuickReminder(msg, 15)}
                              className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              15 dakika sonra
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleQuickReminder(msg, 60)}
                              className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              1 saat sonra
                            </button>
                          </div>
                        )}
                      </div>
                      {msg.content && (
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(msg.content);
                            showToast('Mesaj kopyalandı.', 'info');
                            setMobileActiveMsgId(null);
                          }}
                          title="Metni Kopyala"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-300"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {(canPin || mode === 'dm') && (
                        <button
                          type="button"
                          onClick={() => {
                            void handlePin(msg.id);
                            setMobileActiveMsgId(null);
                          }}
                          title={msg.isPinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-300"
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {(isOwn || canEditOthers) && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(msg.id);
                            setEditDraft(msg.content);
                            setMobileActiveMsgId(null);
                          }}
                          title="Düzenle"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-300"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {(isOwn || canDeleteOthers) && (
                        <button
                          type="button"
                          onClick={() => {
                            void handleDelete(msg.id);
                            setMobileActiveMsgId(null);
                          }}
                          title="Sil"
                          className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-500 hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!isOwn && (
                        <button
                          type="button"
                          onClick={() => {
                            void handleReportMessage(msg);
                            setMobileActiveMsgId(null);
                          }}
                          title="Şikâyet et"
                          className="p-1.5 rounded-lg hover:bg-amber-500/15 text-slate-500 hover:text-amber-400"
                        >
                          <Flag className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Scroll to Bottom button */}
      {showScrollBottom && (
        <button
          type="button"
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="absolute bottom-20 right-5 z-20 h-9 px-3 rounded-full bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold shadow-lg flex items-center gap-1.5 transition-colors"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          En Alta İn
        </button>
      )}

      {/* Typing indicator */}
      {typingNames.length > 0 && (
        <div className="px-5 py-1 text-xs text-slate-500 dark:text-[#A1A1B5]">
          {typingNames.join(', ')} yazıyor...
        </div>
      )}

      {/* Composer */}
      <div className="px-4 pb-safe pt-2 border-t border-slate-200 dark:border-[#29293D] bg-[#F7F8FC] dark:bg-[#10111B] relative">
        {/* Live Poll Builder Popover */}
        {pollBuilderOpen && mode === 'channel' && (
          <form
            noValidate
            onSubmit={handleCreatePoll}
            className="mb-2.5 p-4 rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold font-display flex items-center gap-1.5 text-[#C084FC]">
                <BarChart3 className="w-4 h-4" />
                Canlı Kanal Anketi Oluştur
              </span>
              <button
                type="button"
                onClick={() => {
                  setPollBuilderOpen(false);
                  setPollErrors({});
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1">
              <input
                type="text"
                maxLength={140}
                value={pollQuestion}
                onChange={(e) => {
                  setPollQuestion(e.target.value);
                  if (pollErrors.question) setPollErrors((prev) => ({ ...prev, question: undefined }));
                }}
                placeholder="Anket sorusu nedir?"
                className={`w-full h-9 px-3 rounded-xl bg-slate-100 dark:bg-[#19192A] border text-xs focus:outline-none focus:ring-2 focus:ring-[#A855F7] ${
                  pollErrors.question ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                }`}
              />
              {pollErrors.question && (
                <p role="alert" className="text-[11px] text-[#EF4444]">
                  {pollErrors.question}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              {pollOptions.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={80}
                    value={opt}
                    onChange={(e) => {
                      const next = [...pollOptions];
                      next[idx] = e.target.value;
                      setPollOptions(next);
                      if (pollErrors.options) setPollErrors((prev) => ({ ...prev, options: undefined }));
                    }}
                    placeholder={`Seçenek ${idx + 1}`}
                    className={`flex-1 h-8 px-3 rounded-lg bg-slate-100 dark:bg-[#19192A] border text-xs focus:outline-none focus:ring-2 focus:ring-[#A855F7] ${
                      pollErrors.options ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                    }`}
                  />
                  {pollOptions.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))}
                      className="p-1 text-slate-400 hover:text-[#EF4444]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {pollErrors.options && (
                <p role="alert" className="text-[11px] text-[#EF4444]">
                  {pollErrors.options}
                </p>
              )}
              {pollOptions.length < 6 && (
                <button
                  type="button"
                  onClick={() => setPollOptions([...pollOptions, ''])}
                  className="text-xs text-[#C084FC] hover:underline flex items-center gap-1 pt-0.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Seçenek Ekle
                </button>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-[#A1A1B5] cursor-pointer">
                <input
                  type="checkbox"
                  checked={pollAllowMultiple}
                  onChange={(e) => setPollAllowMultiple(e.target.checked)}
                />
                Çoklu oya izin ver
              </label>
              <button
                type="submit"
                className="h-8 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors"
              >
                Anketi Yayınla
              </button>
            </div>
          </form>
        )}

        {/* Slash command autocomplete popup */}
        {slashMatches.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 sm:right-auto mb-2 sm:w-96 rounded-xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-xl overflow-hidden z-30">
            <div className="px-3 py-1.5 border-b border-slate-200 dark:border-[#29293D] flex items-center gap-1.5 text-[11px] font-bold text-[#C084FC]">
              <Terminal className="w-3.5 h-3.5" />
              <span>Hızlı Slash Komutları</span>
            </div>
            {slashMatches.map((sc) => (
              <button
                key={sc.command}
                type="button"
                onClick={() => {
                  setDraft(`${sc.command} `);
                  setComposerError(null);
                  composerRef.current?.focus();
                }}
                className="w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-[#19192A] space-y-0.5"
              >
                <p className="text-xs font-mono font-semibold text-[#C084FC]">{sc.usage}</p>
                <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">{sc.description}</p>
              </button>
            ))}
          </div>
        )}

        {/* Schedule Message Popover */}
        {scheduleOpen && (
          <div className="mb-2.5 p-3.5 rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold flex items-center gap-1.5 text-[#C084FC]">
                <Clock className="w-4 h-4" />
                Mesajı Zamanla
              </span>
              <button type="button" onClick={() => setScheduleOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleScheduleMessage(new Date(Date.now() + 15 * 60_000).toISOString())}
                className="h-8 px-3 rounded-lg bg-slate-100 dark:bg-[#19192A] hover:bg-[#7C3AED] hover:text-white text-xs font-medium transition-colors"
              >
                +15 Dakika
              </button>
              <button
                type="button"
                onClick={() => void handleScheduleMessage(new Date(Date.now() + 60 * 60_000).toISOString())}
                className="h-8 px-3 rounded-lg bg-slate-100 dark:bg-[#19192A] hover:bg-[#7C3AED] hover:text-white text-xs font-medium transition-colors"
              >
                +1 Saat
              </button>
              <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                <input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className="flex-1 h-8 px-2 rounded-lg bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs"
                />
                <button
                  type="button"
                  disabled={!scheduleAt}
                  onClick={() => {
                    if (scheduleAt) void handleScheduleMessage(new Date(scheduleAt).toISOString());
                  }}
                  className="h-8 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold disabled:opacity-40"
                >
                  Kur
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mention autocomplete popup */}
        {mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-4 mb-2 w-64 rounded-xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-xl overflow-hidden z-30">
            {mentionMatches.map((u) => (
              <button
                key={u.userId}
                type="button"
                onClick={() => insertMention(u.username)}
                className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-slate-100 dark:hover:bg-[#19192A] text-xs"
              >
                <UserAvatar src={u.avatarUrl} name={u.displayName} frame={u.avatarFrame} size="xs" showStatus={false} />
                <span className="font-medium truncate">{u.displayName}</span>
                <span className="font-mono text-slate-400 dark:text-[#A1A1B5] ml-auto">@{u.username}</span>
              </button>
            ))}
          </div>
        )}

        {/* Emoji / GIF Picker Popover */}
        {pickerTab !== 'none' && (
          <div className="absolute bottom-full right-4 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-2xl overflow-hidden z-30">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#29293D] px-3 py-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPickerTab('emoji')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium ${
                    pickerTab === 'emoji' ? 'bg-[#7C3AED] text-white' : 'text-slate-500 dark:text-[#A1A1B5] hover:text-slate-200'
                  }`}
                >
                  Emoji
                </button>
                <button
                  type="button"
                  onClick={() => setPickerTab('gif')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium ${
                    pickerTab === 'gif' ? 'bg-[#7C3AED] text-white' : 'text-slate-500 dark:text-[#A1A1B5] hover:text-slate-200'
                  }`}
                >
                  GIF
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPickerTab('none')}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {pickerTab === 'emoji' ? (
              <div className="p-3 space-y-2.5 max-h-64 overflow-y-auto">
                <div className="grid grid-cols-8 gap-1">
                  {QUICK_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => {
                        setDraft((prev) => prev + em);
                        setComposerError(null);
                      }}
                      className="h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-[#19192A] text-lg flex items-center justify-center"
                    >
                      {em}
                    </button>
                  ))}
                </div>
                {(serverEmojis.length > 0 || nitroEmojis.length > 0) && (
                  <div className="border-t border-slate-200 dark:border-[#29293D] pt-2 space-y-2">
                    {serverEmojis.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-[#A1A1B5]">
                          Sunucu Emojileri
                        </p>
                        <div className="grid grid-cols-6 gap-1.5">
                          {serverEmojis.map((em) => (
                            <button
                              key={em.id}
                              type="button"
                              title={`:${em.name}:`}
                              onClick={() => {
                                setDraft((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}:${em.name}: `);
                                setComposerError(null);
                              }}
                              className="h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-[#19192A] flex items-center justify-center p-1"
                            >
                              <img src={resolveMediaUrl(em.url) || em.url} alt={em.name} className="w-6 h-6 object-contain" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {me?.nitroTier === 'nitro' && nitroEmojis.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-[#C084FC]">
                          Nitro Tüm Sunucu Emojileri
                        </p>
                        <div className="grid grid-cols-6 gap-1.5">
                          {nitroEmojis
                            .filter((ne) => !serverEmojis.some((se) => se.id === ne.id))
                            .slice(0, 24)
                            .map((em) => (
                              <button
                                key={em.id}
                                type="button"
                                title={`:${em.name}: (${em.serverName || 'Diğer Sunucu'})`}
                                onClick={() => {
                                  setDraft((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}:${em.name}: `);
                                  setComposerError(null);
                                }}
                                className="h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-[#19192A] flex items-center justify-center p-1"
                              >
                                <img src={resolveMediaUrl(em.url) || em.url} alt={em.name} className="w-6 h-6 object-contain" />
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 space-y-2">
                <input
                  type="text"
                  value={gifQuery}
                  onChange={(e) => setGifQuery(e.target.value)}
                  placeholder="GIF ara..."
                  className="w-full h-8 px-2.5 rounded-lg bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] text-xs"
                />
                {gifLoading ? (
                  <div className="py-6 text-center text-xs text-slate-400 dark:text-[#A1A1B5]">Aranıyor...</div>
                ) : gifConfigured === false ? (
                  <div className="py-5 px-2 text-center text-xs text-slate-400 dark:text-[#A1A1B5] space-y-1">
                    <p className="font-medium text-slate-300">GIF yüklenemedi</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {gifResults.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          setDraft((prev) => (prev ? `${prev} ${g.url}` : g.url));
                          setComposerError(null);
                          setPickerTab('none');
                        }}
                        title={g.title}
                        className="rounded-lg overflow-hidden border border-[#29293D] hover:border-[#A855F7] bg-[#0B0B12]"
                      >
                        <img src={g.previewUrl} alt={g.title} referrerPolicy="no-referrer" className="w-full h-24 object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Reply Banner */}
        {replyTo && (
          <div className="mb-2 px-3 py-1.5 rounded-xl bg-slate-200/70 dark:bg-[#19192A] flex items-center justify-between text-xs">
            <span className="truncate">
              <strong className="text-[#C084FC]">{replyTo.author.displayName}</strong> kullanıcısına yanıt veriliyor
            </span>
            <button type="button" onClick={() => setReplyTo(null)} className="text-slate-400 hover:text-white p-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Pending attachments & Upload Progress */}
        {(pendingAttachments.length > 0 || uploadProgress !== null) && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {pendingAttachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-200 dark:bg-[#19192A] text-xs"
              >
                <ImageIcon className="w-3.5 h-3.5 text-[#A855F7]" />
                <span className="max-w-[140px] truncate">{att.fileName}</span>
                <button
                  type="button"
                  onClick={() => setPendingAttachments((prev) => prev.filter((p) => p.id !== att.id))}
                  className="text-slate-400 hover:text-[#EF4444]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {uploadProgress !== null && (
              <div className="flex items-center gap-2 text-xs text-[#C084FC] font-mono">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Yükleniyor %{uploadProgress}</span>
              </div>
            )}
          </div>
        )}

        {/* Active Voice Note Recorder Bar */}
        {recording ? (
          <div className="flex items-center justify-between gap-2 pb-2 pt-1">
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/30 flex-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444] animate-pulse" />
              <span className="text-xs font-semibold text-[#EF4444]">Ses Notu Kaydediliyor</span>
              <span className="font-mono text-xs text-rose-300 tabular-nums ml-auto">
                {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => stopVoiceNote(true)}
              className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-[#29293D] text-xs font-medium text-slate-400 hover:text-[#EF4444]"
            >
              İptal
            </button>
            <button
              type="button"
              onClick={() => stopVoiceNote(false)}
              className="min-h-[44px] px-4 rounded-xl bg-[#22C55E] hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Gönder
            </button>
          </div>
        ) : (
          <div className="pb-2 space-y-1.5">
            {composerError && (
              <p role="alert" className="text-xs text-[#EF4444]">
                {composerError}
              </p>
            )}
            <form noValidate onSubmit={handleSend} className="flex items-end gap-1.5 sm:gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/mp4,video/webm,audio/*,.pdf,.txt,.md,.json,.zip"
                className="hidden"
                onChange={(e) => void handleFileSelect(e.target.files)}
              />
              <button
                type="button"
                disabled={!canSend || !canAttachFiles}
                onClick={() => fileInputRef.current?.click()}
                title={
                  canAttachFiles
                    ? `Dosya veya görsel ekle (Maks ${me?.nitroTier === 'nitro' ? '50 MB · Nitro' : '10 MB'})`
                    : 'Dosya ekleme izniniz yok'
                }
                className="min-h-[44px] min-w-[44px] rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] hover:border-[#A855F7]/50 flex items-center justify-center text-slate-500 dark:text-[#A1A1B5] disabled:opacity-40 shrink-0"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <button
                type="button"
                disabled={!canSend || !canAttachFiles}
                onClick={() => void startVoiceNote()}
                title={canAttachFiles ? 'Sesli Not Kaydet' : 'Ses notu için dosya ekleme izni gerekir'}
                className="min-h-[44px] min-w-[44px] rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] hover:border-[#EF4444]/50 flex items-center justify-center text-slate-500 dark:text-[#A1A1B5] hover:text-[#EF4444] disabled:opacity-40 shrink-0"
              >
                <Mic className="w-4 h-4" />
              </button>

              {mode === 'channel' && (
                <button
                  type="button"
                  disabled={!canSend}
                  onClick={() => {
                    setPollBuilderOpen(!pollBuilderOpen);
                    setPollErrors({});
                  }}
                  title="Canlı Anket Oluştur"
                  className={`hidden sm:flex min-h-[44px] min-w-[44px] rounded-xl border items-center justify-center disabled:opacity-40 shrink-0 ${
                    pollBuilderOpen
                      ? 'bg-[#7C3AED] border-[#A855F7] text-white'
                      : 'bg-white dark:bg-[#19192A] border-slate-200 dark:border-[#29293D] hover:border-[#A855F7]/50 text-slate-500 dark:text-[#A1A1B5]'
                  }`}
                >
                  <BarChart3 className="w-4 h-4" />
                </button>
              )}

              <textarea
                ref={composerRef}
                rows={1}
                disabled={!canSend}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (composerError) setComposerError(null);
                  emitTyping();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                onPaste={(e) => {
                  const items = e.clipboardData?.files;
                  if (items && items.length > 0) {
                    e.preventDefault();
                    void uploadFileList(Array.from(items));
                  }
                }}
                placeholder={
                  canSend
                    ? channelName
                      ? `#${channelName} kanalına mesaj yaz... (/ komutları veya Shift+Enter)`
                      : 'Mesaj yazın... (/ komutları, **kalın**, `kod`, @etiket)'
                    : 'Bu kanalda yazma izniniz bulunmuyor.'
                }
                className={`flex-1 min-h-[44px] max-h-36 py-2.5 px-3.5 sm:px-4 rounded-xl bg-white dark:bg-[#19192A] border focus:outline-none focus:ring-2 focus:ring-[#A855F7] text-sm resize-none leading-5 disabled:opacity-50 ${
                  composerError ? 'border-[#EF4444]' : 'border-slate-200 dark:border-[#29293D]'
                }`}
              />

              <button
                type="button"
                disabled={!canSend}
                onClick={() => setScheduleOpen(!scheduleOpen)}
                title="Mesajı Zamanla"
                className={`min-h-[44px] min-w-[44px] rounded-xl border flex items-center justify-center disabled:opacity-40 shrink-0 ${
                  scheduleOpen
                    ? 'bg-[#7C3AED] border-[#A855F7] text-white'
                    : 'bg-white dark:bg-[#19192A] border-slate-200 dark:border-[#29293D] hover:border-[#A855F7]/50 text-slate-500 dark:text-[#A1A1B5]'
                }`}
              >
                <Clock className="w-4 h-4" />
              </button>

              <button
                type="button"
                disabled={!canSend}
                onClick={() => setPickerTab(pickerTab === 'none' ? 'emoji' : 'none')}
                title="Emoji ve GIF"
                className="min-h-[44px] min-w-[44px] rounded-xl bg-white dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] hover:border-[#A855F7]/50 flex items-center justify-center text-slate-500 dark:text-[#A1A1B5] disabled:opacity-40 shrink-0"
              >
                <Smile className="w-4 h-4" />
              </button>

              <button
                type="submit"
                disabled={!canSend}
                aria-label="Mesaj gönder"
                className="min-h-[44px] px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-40 text-white text-sm font-medium flex items-center gap-1.5 transition-colors"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">Gönder</span>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
