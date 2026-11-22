import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  Clock,
  Eraser,
  Gamepad2,
  Hand,
  Headphones,
  Keyboard,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  MonitorOff,
  Pause,
  PenTool,
  PhoneOff,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  Signal,
  SmilePlus,
  Sparkles,
  Timer,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { apiFetch, ApiError } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { SOUNDBOARD_EFFECTS } from '../client/soundEffects.ts';
import { useToast } from '../client/ToastContext.tsx';
import { formatIsoElapsed, formatVoiceDuration, useVoice } from '../client/VoiceContext.tsx';
import type { PeerStreamInfo } from '../client/webrtc.ts';
import { wsClient } from '../client/wsClient.ts';
import type { PomodoroState, VoiceParticipant, WhiteboardStroke } from '../shared/types.ts';
import { SingleColorPickerButton } from './SingleColorPickerButton.tsx';
import { UserAvatar } from './UserAvatar.tsx';
import { VoiceGamesPanel } from './VoiceGamesPanel.tsx';

const VOICE_REACTION_EMOJIS = ['👏', '🔥', '😂', '🚀', '💜', '⚡'];

interface Props {
  mode: 'channel' | 'dm_call';
  roomId: string;
  roomTitle: string;
  serverId?: string;
  serverName?: string;
  participants: VoiceParticipant[];
  isStage?: boolean;
  canSpeak?: boolean;
  canScreenShare?: boolean;
  canMuteOthers?: boolean;
  initialWithVideo?: boolean;
  onLeft: () => void;
}

function RemoteMediaTile({
  participant,
  streamInfo,
  canMuteOthers,
  isStage,
  volumePct,
  onVolumeChange,
  focused,
  onToggleFocus,
  onServerMute,
  onSetSpeaker,
}: {
  participant: VoiceParticipant;
  streamInfo?: PeerStreamInfo;
  canMuteOthers: boolean;
  isStage: boolean;
  volumePct: number;
  onVolumeChange: (val: number) => void;
  focused: boolean;
  onToggleFocus: () => void;
  onServerMute: (userId: string, mute: boolean) => void;
  onSetSpeaker: (userId: string, isSpeaker: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [volOpen, setVolOpen] = useState(false);

  const hasVideo = Boolean(
    (participant.videoEnabled || participant.screenSharing) &&
      streamInfo?.stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live' && !t.muted)
  );

  useEffect(() => {
    if (videoRef.current && streamInfo) {
      videoRef.current.srcObject = streamInfo.stream;
    }
  }, [streamInfo]);

  return (
    <div
      className={`relative rounded-2xl border overflow-hidden bg-[#151522] flex flex-col items-center justify-center p-4 transition-colors ${
        focused ? 'col-span-full min-h-[340px]' : 'min-h-[210px]'
      } ${participant.speaking ? 'border-[#22C55E] ring-2 ring-[#22C55E]/30' : 'border-[#29293D]'}`}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-contain rounded-xl bg-black ${focused ? 'max-h-[420px]' : 'max-h-64'}`}
        />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <UserAvatar
            src={participant.profile.avatarUrl}
            name={participant.profile.displayName}
            status={participant.profile.status}
            frame={participant.profile.avatarFrame}
            size="xl"
          />
          <div className="text-center space-y-0.5">
            <p className="text-sm font-semibold text-[#F8FAFC] flex items-center justify-center gap-1.5">
              <span>{participant.profile.displayName}</span>
              {participant.handRaised && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F59E0B]/20 text-[#F59E0B] text-[10px] font-semibold">
                  <Hand className="w-3 h-3" /> Söz İstiyor
                </span>
              )}
            </p>
            <p className="text-xs text-[#A1A1B5] tabular-nums">
              {streamInfo ? (streamInfo.connectionState === 'connected' ? 'Bağlandı' : 'Bağlanıyor...') : 'Ses hazır'}
              {participant.joinedAt ? ` · ${formatIsoElapsed(participant.joinedAt)}` : ''}
            </p>
          </div>
        </div>
      )}

      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setVolOpen(!volOpen)}
          title="Kullanıcı Ses Düzeyi (%0-%200)"
          className={`px-2 py-1 rounded-lg text-[11px] font-mono tabular-nums flex items-center gap-1 transition-colors ${
            volOpen || volumePct !== 100
              ? 'bg-[#7C3AED] text-white'
              : 'bg-black/60 hover:bg-black/80 text-[#F8FAFC]'
          }`}
        >
          <Volume2 className="w-3 h-3" />
          %{volumePct}
        </button>

        {hasVideo && (
          <button
            type="button"
            onClick={onToggleFocus}
            title={focused ? 'Küçült' : 'Odakla'}
            className="p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white"
          >
            {focused ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {volOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-12 right-3 z-20 w-44 rounded-xl bg-[#10111B]/95 border border-[#29293D] p-2.5 shadow-xl space-y-1.5"
        >
          <div className="flex items-center justify-between text-[11px] text-[#F8FAFC]">
            <span>Ses Düzeyi</span>
            <span className="font-mono text-[#C084FC] tabular-nums">%{volumePct}</span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            step={5}
            value={volumePct}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="w-full accent-[#A855F7] cursor-pointer"
          />
        </div>
      )}

      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
        <span className="px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md text-xs font-medium text-[#F8FAFC] truncate">
          {participant.profile.displayName}
          {participant.screenSharing ? ' · Ekran' : ''}
        </span>
        <div className="flex items-center gap-1.5">
          {isStage && canMuteOthers && (
            <button
              type="button"
              onClick={() => onSetSpeaker(participant.userId, participant.isSpeaker === false)}
              title={participant.isSpeaker === false ? 'Sahneye Konuşmacı Al' : 'Dinleyiciye Al'}
              className="px-2 py-1 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-[10px] font-semibold transition-colors"
            >
              {participant.isSpeaker === false ? 'Söz Ver' : 'İndir'}
            </button>
          )}
          {(participant.muted || participant.serverMuted) && (
            <span className="p-1.5 rounded-lg bg-[#EF4444]/20 text-[#EF4444]" title="Mikrofon kapalı">
              <MicOff className="w-3.5 h-3.5" />
            </span>
          )}
          {participant.deafened && (
            <span className="p-1.5 rounded-lg bg-[#19192A] text-[#A1A1B5]" title="Sağırlaştırıldı">
              <VolumeX className="w-3.5 h-3.5" />
            </span>
          )}
          {canMuteOthers && (
            <button
              type="button"
              onClick={() => onServerMute(participant.userId, !participant.serverMuted)}
              title={participant.serverMuted ? 'Sunucu susturmasını kaldır' : 'Sunucuda sustur'}
              className="p-1.5 rounded-lg bg-black/60 hover:bg-[#EF4444]/80 text-white text-xs transition-colors"
            >
              {participant.serverMuted ? <Volume2 className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function VoiceStageView({
  mode,
  roomId,
  roomTitle,
  serverId,
  serverName,
  participants,
  isStage = false,
  canSpeak = true,
  canScreenShare = true,
  canMuteOthers = false,
  initialWithVideo = false,
  onLeft,
}: Props) {
  const { profile: me } = useAuth();
  const { showToast } = useToast();
  const voice = useVoice();
  const { syncParticipants, enforceServerMute } = voice;

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const isDrawingRef = useRef(false);

  const [showDevices, setShowDevices] = useState(false);
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  const [spotlightDismissed, setSpotlightDismissed] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [stageTab, setStageTab] = useState<'participants' | 'games' | 'whiteboard' | 'pomodoro'>('participants');
  const spotlightContainerRef = useRef<HTMLDivElement>(null);
  const spotlightVideoRef = useRef<HTMLVideoElement>(null);

  // Whiteboard & stage accent state
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([]);
  const [brushColor, setBrushColor] = useState('#A855F7');
  const [brushSize, setBrushSize] = useState(3);
  const [stageAccentColor, setStageAccentColor] = useState('#7C3AED');

  // Pomodoro state
  const [pomodoro, setPomodoro] = useState<PomodoroState>({
    roomId,
    phase: 'focus',
    durationSeconds: 1500,
    remainingSeconds: 1500,
    running: false,
    updatedAt: new Date().toISOString(),
  });
  const [pomoDisplaySec, setPomoDisplaySec] = useState(1500);

  const isJoinedThisRoom = voice.activeRoom?.roomId === roomId && voice.activeRoom?.mode === mode;

  useEffect(() => {
    if (isJoinedThisRoom) {
      syncParticipants(roomId, participants);
    }
  }, [isJoinedThisRoom, roomId, participants, syncParticipants]);

  // Attach local video stream when enabled
  useEffect(() => {
    if (localVideoRef.current && voice.localStream && isJoinedThisRoom && voice.videoEnabled) {
      localVideoRef.current.srcObject = voice.localStream;
    }
  }, [voice.localStream, voice.videoEnabled, isJoinedThisRoom]);

  // Reset spotlight dismissal when screen share toggles or focus changes
  useEffect(() => {
    setSpotlightDismissed(false);
  }, [voice.screenSharing, focusedUserId]);

  // Enforce server mute
  const myParticipant = participants.find((p) => p.userId === me?.userId);
  useEffect(() => {
    if (isJoinedThisRoom && myParticipant?.serverMuted) {
      enforceServerMute(true);
    }
  }, [isJoinedThisRoom, myParticipant?.serverMuted, enforceServerMute]);

  // Load whiteboard + pomodoro snapshot when entering room
  useEffect(() => {
    if (!roomId) return;
    apiFetch<{ strokes: WhiteboardStroke[]; pomodoro: PomodoroState }>(`/voice-rooms/${roomId}/collab`)
      .then((res) => {
        setStrokes(res.strokes || []);
        if (res.pomodoro) setPomodoro(res.pomodoro);
      })
      .catch(() => {});
  }, [roomId]);

  // Listen to WS whiteboard + pomodoro updates
  useEffect(() => {
    return wsClient.onEvent((ev) => {
      const p = ev.payload;
      if (String(p.roomId || '') !== roomId) return;
      if (ev.type === 'voice:whiteboard_stroke') {
        const stroke = p as unknown as WhiteboardStroke;
        setStrokes((prev) => (prev.some((s) => s.id === stroke.id) ? prev : [...prev, stroke]));
      } else if (ev.type === 'voice:whiteboard_clear') {
        setStrokes([]);
      } else if (ev.type === 'voice:pomodoro') {
        setPomodoro(p as unknown as PomodoroState);
      }
    });
  }, [roomId]);

  // Compute live Pomodoro countdown
  useEffect(() => {
    const computeRemaining = () => {
      if (!pomodoro.running) return pomodoro.remainingSeconds;
      const elapsed = Math.floor((Date.now() - Date.parse(pomodoro.updatedAt)) / 1000);
      return Math.max(0, pomodoro.remainingSeconds - Math.max(0, elapsed));
    };
    setPomoDisplaySec(computeRemaining());
    if (!pomodoro.running) return;
    const t = window.setInterval(() => {
      setPomoDisplaySec(computeRemaining());
    }, 1000);
    return () => clearInterval(t);
  }, [pomodoro]);

  // Render whiteboard strokes cleanly
  const redrawCanvas = useCallback(
    (extraPoints?: Array<{ x: number; y: number }>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const drawStroke = (pts: Array<{ x: number; y: number }>, color: string, size: number) => {
        if (pts.length < 2) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x * w, pts[0].y * h);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x * w, pts[i].y * h);
        }
        ctx.stroke();
      };

      for (const s of strokes) {
        drawStroke(s.points, s.color, s.size);
      }
      if (extraPoints && extraPoints.length >= 2) {
        drawStroke(extraPoints, brushColor, brushSize);
      }
    },
    [strokes, brushColor, brushSize]
  );

  useEffect(() => {
    if (stageTab === 'whiteboard') {
      redrawCanvas();
    }
  }, [stageTab, strokes, redrawCanvas]);

  const handleJoin = async () => {
    await voice.joinRoom({
      mode,
      roomId,
      roomTitle,
      serverId,
      serverName,
      participants,
      canSpeak,
      canScreenShare,
      initialWithVideo,
      isStage,
    });
  };

  const handleLeave = async () => {
    await voice.leaveRoom();
    if (mode === 'dm_call') {
      const peer = participants.find((p) => p.userId !== me?.userId);
      if (peer) {
        wsClient.send('call:end', { conversationId: roomId, targetUserId: peer.userId });
      }
    }
    onLeft();
  };

  const handleServerMute = async (targetUserId: string, serverMuted: boolean) => {
    try {
      await apiFetch(`/channels/${roomId}/voice/server-mute/${targetUserId}`, {
        method: 'POST',
        body: JSON.stringify({ serverMuted }),
      });
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'İşlem başarısız.', 'error');
    }
  };

  const getNormPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height))),
    };
  };

  const emitPomodoro = (next: Partial<PomodoroState>) => {
    const payload = {
      roomId,
      phase: next.phase ?? pomodoro.phase,
      durationSeconds: next.durationSeconds ?? pomodoro.durationSeconds,
      remainingSeconds: next.remainingSeconds ?? pomoDisplaySec,
      running: next.running ?? pomodoro.running,
    };
    wsClient.send('voice:pomodoro', payload);
  };

  const stageSpeakers = useMemo(
    () => (isStage ? participants.filter((p) => p.isSpeaker !== false) : participants),
    [isStage, participants]
  );
  const stageListeners = useMemo(
    () => (isStage ? participants.filter((p) => p.isSpeaker === false) : []),
    [isStage, participants]
  );

  const remoteStageSpeakers = stageSpeakers.filter((p) => p.userId !== me?.userId);
  const amIStageSpeaker = !isStage || myParticipant?.isSpeaker !== false;

  const activeBroadcast = useMemo(() => {
    if (!isJoinedThisRoom) return null;

    if (focusedUserId) {
      if (me && focusedUserId === me.userId) {
        if (voice.screenSharing && voice.localScreenStream) {
          return {
            key: `local-screen-${me.userId}`,
            title: `${me.displayName} · Ekran Yayını`,
            stream: voice.localScreenStream,
            isScreenShare: true,
            isLocal: true,
          };
        }
        if (voice.videoEnabled && voice.localStream) {
          return {
            key: `local-cam-${me.userId}`,
            title: `${me.displayName} · Kamera`,
            stream: voice.localStream,
            isScreenShare: false,
            isLocal: true,
          };
        }
      }
      const remoteFocused = remoteStageSpeakers.find((p) => p.userId === focusedUserId);
      const remoteFocusedStream = voice.remoteStreams.find((s) => s.userId === focusedUserId);
      if (
        remoteFocused &&
        remoteFocusedStream?.stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live' && !t.muted)
      ) {
        return {
          key: `remote-${remoteFocused.userId}`,
          title: `${remoteFocused.profile.displayName}${remoteFocused.screenSharing ? ' · Ekran Yayını' : ' · Kamera'}`,
          stream: remoteFocusedStream.stream,
          isScreenShare: remoteFocused.screenSharing,
          isLocal: false,
        };
      }
    }

    if (spotlightDismissed) return null;

    if (voice.screenSharing && voice.localScreenStream) {
      return {
        key: `auto-local-screen`,
        title: `${me?.displayName || 'Siz'} · Canlı Ekran Yayını`,
        stream: voice.localScreenStream,
        isScreenShare: true,
        isLocal: true,
      };
    }

    const remoteSharer = remoteStageSpeakers.find((p) => {
      if (!p.screenSharing) return false;
      const si = voice.remoteStreams.find((s) => s.userId === p.userId);
      return Boolean(si?.stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live' && !t.muted));
    });
    if (remoteSharer) {
      const si = voice.remoteStreams.find((s) => s.userId === remoteSharer.userId);
      if (si) {
        return {
          key: `auto-remote-screen-${remoteSharer.userId}`,
          title: `${remoteSharer.profile.displayName} · Canlı Ekran Yayını`,
          stream: si.stream,
          isScreenShare: true,
          isLocal: false,
        };
      }
    }
    return null;
  }, [
    isJoinedThisRoom,
    focusedUserId,
    spotlightDismissed,
    me,
    voice.screenSharing,
    voice.localScreenStream,
    voice.videoEnabled,
    voice.localStream,
    voice.remoteStreams,
    remoteStageSpeakers,
  ]);

  useEffect(() => {
    if (spotlightVideoRef.current && activeBroadcast?.stream) {
      spotlightVideoRef.current.srcObject = activeBroadcast.stream;
    }
  }, [activeBroadcast]);

  const handleToggleFullscreenSpotlight = () => {
    const el = spotlightContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void el.requestFullscreen?.().catch(() => {});
    }
  };

  return (
    <div
      className="relative flex flex-col h-full bg-[#0B0B12] text-[#F8FAFC] p-4 sm:p-6 overflow-hidden"
      style={{
        backgroundImage: `radial-gradient(circle at 50% 0%, ${stageAccentColor}1f, transparent 60%)`,
      }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#29293D]">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0"
            style={{
              backgroundColor: `${stageAccentColor}25`,
              borderColor: `${stageAccentColor}55`,
              color: stageAccentColor,
            }}
          >
            {isStage ? <Radio className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold font-display truncate">{roomTitle}</h2>
              {isStage && (
                <span className="px-2 py-0.5 rounded-md bg-[#A855F7]/15 border border-[#A855F7]/30 text-[#C084FC] text-[10px] font-bold uppercase tracking-wider">
                  Sahne Modu
                </span>
              )}
              {isJoinedThisRoom && (
                <span className="inline-flex items-center gap-1.5 text-[#22C55E] text-xs font-mono tabular-nums">
                  <Clock className="w-3.5 h-3.5" />
                  {formatVoiceDuration(voice.elapsedSeconds)}
                </span>
              )}
            </div>
            <p className="text-xs text-[#A1A1B5] flex items-center gap-2 flex-wrap mt-0.5 tabular-nums">
              <span>{isJoinedThisRoom ? 'Ses bağlantısı aktif' : 'Katılmak için hazır'}</span>
              <span>·</span>
              <span className="font-mono">{participants.length} katılımcı</span>
              {isJoinedThisRoom && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 text-[#22C55E] font-mono">
                    <Signal className="w-3 h-3" />
                    {voice.pingMs !== null ? `${voice.pingMs} ms` : 'Bağlı'}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isJoinedThisRoom && (
            <div className="inline-flex rounded-xl bg-[#151522] border border-[#29293D] p-0.5">
              {[
                { id: 'participants', label: 'Katılımcılar', icon: Users },
                { id: 'games', label: 'Oyun Salonu', icon: Gamepad2 },
                { id: 'whiteboard', label: 'Çizim Tahtası', icon: PenTool },
                { id: 'pomodoro', label: 'Pomodoro', icon: Timer },
              ].map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setStageTab(t.id as typeof stageTab)}
                    className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      stageTab === t.id ? 'bg-[#7C3AED] text-white' : 'text-[#A1A1B5] hover:text-[#F8FAFC]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <SingleColorPickerButton
            compact
            align="right"
            label="Kanal Rengi"
            value={stageAccentColor}
            onChange={setStageAccentColor}
          />

          <button
            type="button"
            onClick={() => setShowDevices(!showDevices)}
            className={`h-9 px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors ${
              showDevices
                ? 'border-[#A855F7] bg-[#7C3AED]/15 text-[#C084FC]'
                : 'border-[#29293D] bg-[#151522] hover:bg-[#19192A]'
            }`}
          >
            <Settings2 className="w-4 h-4" />
            Ses Ayarları
          </button>
        </div>
      </div>

      {/* Notices */}
      {!voice.turnConfigured && isJoinedThisRoom && (
        <div className="mt-3 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-4 py-2 text-xs text-[#F59E0B] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-[#F59E0B]" />
          <span>
            Yalnızca STUN yapılandırılmış. Kısıtlı kurumsal ağlar veya çift NAT arkasında bağlantı kurulamazsa sunucuda
            TURN yapılandırması gerekir.
          </span>
        </div>
      )}

      {voice.audioPlaybackBlocked && isJoinedThisRoom && (
        <div className="mt-3 rounded-xl border border-[#A855F7]/40 bg-[#7C3AED]/15 px-4 py-2 text-xs text-[#F8FAFC] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 shrink-0 text-[#C084FC]" />
            <span>Tarayıcı otomatik ses oynatmayı engelledi. Karşı tarafı duymak için sesi etkinleştirin.</span>
          </div>
          <button
            type="button"
            onClick={() => voice.unlockAudioPlayback()}
            className="h-8 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold shrink-0 transition-colors"
          >
            Sesi Etkinleştir
          </button>
        </div>
      )}

      {voice.lastSoundboardBanner && isJoinedThisRoom && (
        <div className="mt-2 rounded-xl border border-[#A855F7]/30 bg-[#A855F7]/10 px-3 py-1.5 text-xs text-[#C084FC] flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-[#A855F7]" />
          <span>
            <strong>{voice.lastSoundboardBanner.displayName}</strong> ses efekti çaldı:{' '}
            {SOUNDBOARD_EFFECTS.find((e) => e.key === voice.lastSoundboardBanner?.effect)?.label ||
              voice.lastSoundboardBanner.effect}
          </span>
        </div>
      )}

      {voice.mediaError && (
        <div className="mt-3 rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/10 px-4 py-2 text-xs text-[#EF4444] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-[#EF4444]" />
          <span>{voice.mediaError}</span>
        </div>
      )}

      {showDevices && (
        <div className="mt-3 rounded-2xl border border-[#29293D] bg-[#151522] p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#A1A1B5]">Mikrofon Giriş Cihazı</label>
              <select
                value={voice.selectedAudioDevice}
                onChange={(e) => void voice.changeAudioDevice(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[#19192A] border border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
              >
                {voice.audioInputs.length === 0 ? (
                  <option value="">Varsayılan Mikrofon</option>
                ) : (
                  voice.audioInputs.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Mikrofon ${i + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#A1A1B5]">Hoparlör / Çıkış Cihazı</label>
              <select
                value={voice.selectedAudioOutput}
                onChange={(e) => voice.changeAudioOutput(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[#19192A] border border-[#29293D] text-xs outline-none focus:border-[#A855F7]"
              >
                {voice.audioOutputs.length === 0 ? (
                  <option value="">Varsayılan Çıkış</option>
                ) : (
                  voice.audioOutputs.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Çıkış ${i + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#A1A1B5]">Ses İşleme</label>
              <button
                type="button"
                onClick={() => void voice.toggleNoiseSuppression()}
                className={`w-full h-10 px-3 rounded-xl border text-xs font-medium flex items-center justify-between transition-colors ${
                  voice.noiseSuppression
                    ? 'border-[#22C55E]/40 bg-[#22C55E]/10 text-[#22C55E]'
                    : 'border-[#29293D] bg-[#19192A] text-[#A1A1B5]'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Gürültü Bastırma
                </span>
                <span>{voice.noiseSuppression ? 'Açık' : 'Kapalı'}</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#A1A1B5]">Bas-Konuş (Push-to-Talk)</label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => voice.setPttEnabled(!voice.pttEnabled)}
                  className={`flex-1 h-10 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                    voice.pttEnabled
                      ? 'border-[#A855F7] bg-[#7C3AED]/15 text-[#C084FC]'
                      : 'border-[#29293D] bg-[#19192A] text-[#A1A1B5]'
                  }`}
                >
                  <Keyboard className="w-3.5 h-3.5" />
                  {voice.pttEnabled ? 'Aktif' : 'Kapalı'}
                </button>
                {voice.pttEnabled && (
                  <select
                    value={voice.pttKey}
                    onChange={(e) => voice.setPttKey(e.target.value as 'Space' | 'KeyV' | 'AltLeft')}
                    className="h-10 px-2 rounded-xl bg-[#19192A] border border-[#29293D] text-xs font-mono outline-none"
                  >
                    <option value="Space">Space</option>
                    <option value="KeyV">V</option>
                    <option value="AltLeft">Sol Alt</option>
                  </select>
                )}
              </div>
            </div>
          </div>

          {isJoinedThisRoom && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[#A1A1B5]">
                <span>Canlı Mikrofon Seviyesi</span>
                <span className="font-mono tabular-nums">%{voice.muted ? 0 : voice.micLevel}</span>
              </div>
              <div className="h-2 rounded-full bg-[#10111B] overflow-hidden">
                <div
                  className="h-full bg-[#22C55E] transition-all duration-100"
                  style={{ width: `${voice.muted ? 0 : voice.micLevel}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stage Body */}
      <div className="relative flex-1 overflow-y-auto py-5">
        {!isJoinedThisRoom ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-[#7C3AED]/15 border border-[#A855F7]/30 flex items-center justify-center text-[#C084FC]">
              {isStage ? <Radio className="w-8 h-8" /> : <Headphones className="w-8 h-8" />}
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold font-display">{roomTitle}</h3>
              <p className="text-sm text-[#A1A1B5]">
                {participants.length > 0
                  ? `Şu anda ${participants.length} kişi odada. Katılarak sohbete dahil olun.`
                  : isStage
                  ? 'Sahne kanalı hazır. Moderatörler konuşmacı olarak başlar, diğer üyeler el kaldırıp söz alabilir.'
                  : 'Oda şu an boş. İlk katılan siz olun ve diğer kanallara geçseniz bile bağlantınız sürsün.'}
              </p>
            </div>

            {participants.length > 0 && (
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {participants.slice(0, 6).map((p) => (
                  <div
                    key={p.userId}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[#151522] border border-[#29293D] text-xs"
                  >
                    <UserAvatar
                      src={p.profile.avatarUrl}
                      name={p.profile.displayName}
                      frame={p.profile.avatarFrame}
                      size="xs"
                      showStatus={false}
                    />
                    <span>{p.profile.displayName}</span>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={voice.joining}
              onClick={() => void handleJoin()}
              className="h-11 px-6 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-60 text-white font-semibold text-sm transition-colors"
            >
              {voice.joining ? 'Bağlanıyor...' : isStage ? 'Sahneye Dinleyici Olarak Katıl' : 'Sesli Odaya Katıl'}
            </button>
          </div>
        ) : stageTab === 'games' ? (
          <VoiceGamesPanel roomId={roomId} />
        ) : stageTab === 'whiteboard' ? (
          <div className="h-full flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-[#151522] border border-[#29293D]">
              <div className="flex items-center gap-2 flex-wrap">
                <SingleColorPickerButton
                  compact
                  label="Kalem Rengi"
                  value={brushColor}
                  onChange={setBrushColor}
                />
                <div className="w-px h-5 bg-[#29293D] mx-1" />
                {[2, 4, 8].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setBrushSize(sz)}
                    className={`px-2 py-1 rounded-lg text-xs font-mono transition-colors ${
                      brushSize === sz ? 'bg-[#7C3AED] text-white' : 'bg-[#19192A] text-[#A1A1B5]'
                    }`}
                  >
                    {sz}px
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => wsClient.send('voice:whiteboard_clear', { roomId })}
                className="h-8 px-3 rounded-lg bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-[#EF4444] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <Eraser className="w-3.5 h-3.5" />
                Tahtayı Temizle
              </button>
            </div>

            <div className="flex-1 min-h-[260px] rounded-2xl border border-[#29293D] bg-[#10111B] overflow-hidden relative">
              <canvas
                ref={canvasRef}
                width={1200}
                height={700}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  isDrawingRef.current = true;
                  drawingPointsRef.current = [getNormPoint(e)];
                }}
                onPointerMove={(e) => {
                  if (!isDrawingRef.current) return;
                  drawingPointsRef.current.push(getNormPoint(e));
                  redrawCanvas(drawingPointsRef.current);
                }}
                onPointerUp={() => {
                  if (!isDrawingRef.current) return;
                  isDrawingRef.current = false;
                  const pts = drawingPointsRef.current;
                  drawingPointsRef.current = [];
                  if (pts.length >= 2) {
                    wsClient.send('voice:whiteboard_stroke', {
                      roomId,
                      color: brushColor,
                      size: brushSize,
                      points: pts,
                    });
                  }
                }}
                className="w-full h-full touch-none cursor-crosshair"
              />
            </div>
          </div>
        ) : stageTab === 'pomodoro' ? (
          <div className="h-full flex flex-col items-center justify-center max-w-md mx-auto text-center space-y-6">
            <div className="inline-flex rounded-xl bg-[#151522] border border-[#29293D] p-1">
              <button
                type="button"
                onClick={() =>
                  emitPomodoro({ phase: 'focus', durationSeconds: 1500, remainingSeconds: 1500, running: false })
                }
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  pomodoro.phase === 'focus' ? 'bg-[#7C3AED] text-white' : 'text-[#A1A1B5]'
                }`}
              >
                Odak (25 dk)
              </button>
              <button
                type="button"
                onClick={() =>
                  emitPomodoro({ phase: 'break', durationSeconds: 300, remainingSeconds: 300, running: false })
                }
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  pomodoro.phase === 'break' ? 'bg-[#22C55E] text-white' : 'text-[#A1A1B5]'
                }`}
              >
                Mola (5 dk)
              </button>
            </div>

            <div className="w-56 h-56 rounded-full border-4 border-[#A855F7]/40 bg-[#151522] flex flex-col items-center justify-center shadow-2xl">
              <span className="text-xs font-bold uppercase tracking-widest text-[#C084FC]">
                {pomodoro.phase === 'focus' ? 'Odaklan' : 'Kısa Mola'}
              </span>
              <span className="text-5xl font-bold font-mono tabular-nums mt-1">
                {formatVoiceDuration(pomoDisplaySec)}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => emitPomodoro({ running: !pomodoro.running, remainingSeconds: pomoDisplaySec })}
                className={`h-11 px-6 rounded-xl font-semibold text-xs inline-flex items-center gap-2 transition-colors ${
                  pomodoro.running
                    ? 'bg-[#F59E0B] hover:bg-[#D97706] text-white'
                    : 'bg-[#7C3AED] hover:bg-[#6D28D9] text-white'
                }`}
              >
                {pomodoro.running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {pomodoro.running ? 'Duraklat' : 'Ortak Sayacı Başlat'}
              </button>
              <button
                type="button"
                onClick={() =>
                  emitPomodoro({
                    running: false,
                    remainingSeconds: pomodoro.phase === 'focus' ? 1500 : 300,
                    durationSeconds: pomodoro.phase === 'focus' ? 1500 : 300,
                  })
                }
                className="h-11 px-4 rounded-xl bg-[#19192A] hover:bg-[#222238] border border-[#29293D] text-[#F8FAFC] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Sıfırla
              </button>
            </div>
            <p className="text-xs text-[#A1A1B5]">
              Bu zamanlayıcı odadaki tüm katılımcılar için gerçek zamanlı senkronize edilir.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {activeBroadcast && (
              <motion.div
                ref={spotlightContainerRef}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl border border-[#A855F7]/40 bg-black overflow-hidden shadow-2xl"
              >
                <div className="px-3.5 py-2.5 bg-[#151522]/95 border-b border-[#29293D] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#EF4444] text-white text-[10px] font-bold tracking-wider uppercase shrink-0">
                      <Radio className="w-3 h-3" />
                      CANLI YAYIN
                    </span>
                    <span className="text-xs font-semibold text-[#F8FAFC] truncate">{activeBroadcast.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleToggleFullscreenSpotlight}
                      title="Tam Ekran"
                      className="h-8 px-2.5 rounded-lg bg-[#19192A] hover:bg-[#222238] border border-[#29293D] text-xs text-[#F8FAFC] inline-flex items-center gap-1 transition-colors"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Tam Ekran</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFocusedUserId(null);
                        setSpotlightDismissed(true);
                      }}
                      title="Yayını Küçült"
                      className="h-8 px-2.5 rounded-lg bg-[#19192A] hover:bg-[#222238] border border-[#29293D] text-xs text-[#A1A1B5] hover:text-white inline-flex items-center gap-1 transition-colors"
                    >
                      <Minimize2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Küçült</span>
                    </button>
                  </div>
                </div>
                <div className="relative w-full bg-black flex items-center justify-center">
                  <video
                    ref={spotlightVideoRef}
                    autoPlay
                    playsInline
                    muted={activeBroadcast.isLocal}
                    className={`w-full max-h-[55dvh] object-contain ${
                      activeBroadcast.isLocal && !activeBroadcast.isScreenShare ? 'scale-x-[-1]' : ''
                    }`}
                  />
                </div>
              </motion.div>
            )}
            {isStage && (
              <div className="flex items-center justify-between gap-2 px-1">
                <p className="text-xs font-bold uppercase tracking-wider text-[#C084FC]">
                  Sahnedeki Konuşmacılar ({stageSpeakers.length})
                </p>
                {amIStageSpeaker && me && (
                  <button
                    type="button"
                    onClick={() => voice.setSpeaker(me.userId, false)}
                    className="h-7 px-2.5 rounded-lg bg-[#19192A] hover:bg-[#222238] border border-[#29293D] text-xs text-[#F8FAFC] transition-colors"
                  >
                    Dinleyiciye Geç
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {/* Local User Tile (if speaker or regular room) */}
              {me && (!isStage || amIStageSpeaker) && (
                <div
                  className={`relative rounded-2xl border overflow-hidden bg-[#151522] flex flex-col items-center justify-center p-4 transition-colors ${
                    focusedUserId === me.userId ? 'col-span-full min-h-[340px]' : 'min-h-[210px]'
                  } ${voice.speaking && !voice.muted ? 'border-[#22C55E] ring-2 ring-[#22C55E]/30' : 'border-[#29293D]'}`}
                >
                  {voice.videoEnabled ? (
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-cover rounded-xl scale-x-[-1] ${
                        focusedUserId === me.userId ? 'max-h-[420px]' : 'max-h-64'
                      }`}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <UserAvatar
                        src={me.avatarUrl}
                        name={me.displayName}
                        status={me.status}
                        frame={me.avatarFrame}
                        size="xl"
                      />
                      <div className="text-center space-y-0.5">
                        <p className="text-sm font-semibold text-[#F8FAFC]">{me.displayName} (Siz)</p>
                        <p className="text-xs text-[#22C55E] font-mono tabular-nums">
                          {voice.muted
                            ? voice.pttEnabled
                              ? `Bas-Konuş (${voice.pttKey})`
                              : 'Mikrofon Kapalı'
                            : voice.speaking
                            ? 'Konuşuyor'
                            : 'Bağlı'}{' '}
                          · {formatVoiceDuration(voice.elapsedSeconds)}
                        </p>
                      </div>
                    </div>
                  )}

                  {voice.videoEnabled && (
                    <button
                      type="button"
                      onClick={() => setFocusedUserId(focusedUserId === me.userId ? null : me.userId)}
                      title={focusedUserId === me.userId ? 'Küçült' : 'Odakla'}
                      className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white"
                    >
                      {focusedUserId === me.userId ? (
                        <Minimize2 className="w-3.5 h-3.5" />
                      ) : (
                        <Maximize2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-black/60 text-xs font-medium truncate">
                      {me.displayName} {voice.screenSharing ? '· Ekran Paylaşılıyor' : ''}
                    </span>
                    {voice.muted && (
                      <span className="p-1.5 rounded-lg bg-[#EF4444]/20 text-[#EF4444]" title="Mikrofon kapalı">
                        <MicOff className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Remote Speakers */}
              {remoteStageSpeakers.map((p) => {
                const streamInfo = voice.remoteStreams.find((s) => s.userId === p.userId);
                return (
                  <RemoteMediaTile
                    key={p.userId}
                    participant={{ ...p, speaking: Boolean(voice.speakingMap[p.userId]) }}
                    streamInfo={streamInfo}
                    canMuteOthers={canMuteOthers}
                    isStage={isStage}
                    volumePct={voice.peerVolumes[p.userId] ?? 100}
                    onVolumeChange={(val) => voice.setPeerVolume(p.userId, val)}
                    focused={focusedUserId === p.userId}
                    onToggleFocus={() => setFocusedUserId(focusedUserId === p.userId ? null : p.userId)}
                    onServerMute={handleServerMute}
                    onSetSpeaker={(uid, spk) => voice.setSpeaker(uid, spk)}
                  />
                );
              })}
            </div>

            {/* Stage Audience Section */}
            {isStage && stageListeners.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-[#29293D]">
                <p className="text-xs font-bold uppercase tracking-wider text-[#A1A1B5]">
                  Dinleyiciler ({stageListeners.length})
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {stageListeners.map((listener) => (
                    <div
                      key={listener.userId}
                      className={`px-3 py-2 rounded-xl border flex items-center gap-2.5 bg-[#151522] ${
                        listener.handRaised ? 'border-[#F59E0B]/50 bg-[#F59E0B]/10' : 'border-[#29293D]'
                      }`}
                    >
                      <UserAvatar
                        src={listener.profile.avatarUrl}
                        name={listener.profile.displayName}
                        frame={listener.profile.avatarFrame}
                        size="xs"
                        showStatus={false}
                      />
                      <span className="text-xs font-medium">{listener.profile.displayName}</span>
                      {listener.handRaised && (
                        <span className="text-[#F59E0B] inline-flex items-center gap-1 text-[11px] font-semibold">
                          <Hand className="w-3.5 h-3.5" />
                          El Kaldırdı
                        </span>
                      )}
                      {canMuteOthers && (
                        <button
                          type="button"
                          onClick={() => voice.setSpeaker(listener.userId, true)}
                          className="ml-1 px-2 py-1 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-[10px] font-semibold transition-colors"
                        >
                          Sahneye Al
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Floating Live Emoji Reactions */}
        {isJoinedThisRoom && voice.voiceReactions.length > 0 && (
          <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 overflow-hidden h-48">
            {voice.voiceReactions.map((r) => (
              <div
                key={r.id}
                style={{ left: `${r.leftPct}%` }}
                className="absolute bottom-0 animate-orbit-float flex flex-col items-center gap-0.5"
              >
                <span className="text-3xl drop-shadow-lg">{r.emoji}</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-black/70 text-[#F8FAFC] whitespace-nowrap">
                  {r.displayName}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      {isJoinedThisRoom && (
        <div className="relative pt-3 border-t border-[#29293D] pb-safe">
          <AnimatePresence>
            {reactionsOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.96 }}
                transition={{ duration: 0.14 }}
                className="mb-3 mx-auto max-w-md rounded-2xl border border-[#29293D] bg-[#151522]/95 backdrop-blur-md p-2.5 shadow-2xl flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  {VOICE_REACTION_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => {
                        voice.sendVoiceReaction(em);
                        setReactionsOpen(false);
                      }}
                      title={`Sahneye ${em} tepkisi gönder`}
                      className="h-9 w-9 rounded-xl bg-[#19192A] hover:bg-[#222238] border border-[#29293D] text-base flex items-center justify-center transition-transform active:scale-125"
                    >
                      {em}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setReactionsOpen(false)}
                  aria-label="Tepkileri kapat"
                  className="p-1.5 rounded-lg text-[#A1A1B5] hover:text-white hover:bg-[#222238]"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {soundboardOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.96 }}
                transition={{ duration: 0.14 }}
                className="mb-3 mx-auto max-w-xl rounded-2xl border border-[#A855F7]/30 bg-[#151522]/95 backdrop-blur-md p-2.5 shadow-2xl flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  {SOUNDBOARD_EFFECTS.map((sb) => (
                    <button
                      key={sb.key}
                      type="button"
                      onClick={() => {
                        voice.sendSoundboard(sb.key);
                        setSoundboardOpen(false);
                      }}
                      className="h-9 px-3 rounded-xl bg-[#A855F7]/10 hover:bg-[#A855F7]/20 border border-[#A855F7]/25 text-xs text-[#C084FC] inline-flex items-center gap-1.5 transition-colors"
                    >
                      <span>{sb.emoji}</span>
                      <span>{sb.label}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setSoundboardOpen(false)}
                  aria-label="Ses efektlerini kapat"
                  className="p-1.5 rounded-lg text-[#A1A1B5] hover:text-white hover:bg-[#222238] shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-center gap-2 flex-wrap">
            {isStage && !amIStageSpeaker && (
              <button
                type="button"
                onClick={() => voice.raiseHand(!myParticipant?.handRaised)}
                className={`h-11 px-4 rounded-xl font-medium text-xs flex items-center gap-2 transition-colors whitespace-nowrap ${
                  myParticipant?.handRaised
                    ? 'bg-[#F59E0B] text-white'
                    : 'bg-[#19192A] hover:bg-[#222238] text-[#F59E0B] border border-[#F59E0B]/30'
                }`}
              >
                <Hand className="w-4 h-4" />
                {myParticipant?.handRaised ? 'Eli İndir' : 'Söz İste'}
              </button>
            )}

            <button
              type="button"
              onClick={() => void voice.toggleMute()}
              className={`h-11 px-3.5 sm:px-4 rounded-xl font-medium text-xs flex items-center gap-2 transition-colors whitespace-nowrap ${
                voice.muted
                  ? 'bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/40'
                  : 'bg-[#19192A] hover:bg-[#222238] border border-[#29293D] text-[#F8FAFC]'
              }`}
            >
              {voice.muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span className="hidden sm:inline">
                {voice.pttEnabled
                  ? voice.pttActive
                    ? 'Konuşuluyor (PTT)'
                    : `Bas-Konuş (${voice.pttKey})`
                  : voice.muted
                  ? 'Mikrofonu Aç'
                  : 'Sustur'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void voice.toggleDeafen()}
              className={`h-11 px-3.5 sm:px-4 rounded-xl font-medium text-xs flex items-center gap-2 transition-colors whitespace-nowrap ${
                voice.deafened
                  ? 'bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/40'
                  : 'bg-[#19192A] hover:bg-[#222238] border border-[#29293D] text-[#F8FAFC]'
              }`}
            >
              {voice.deafened ? <VolumeX className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
              <span className="hidden sm:inline">{voice.deafened ? 'Sesi Aç' : 'Sağırlaştır'}</span>
            </button>

            <button
              type="button"
              onClick={() => void voice.toggleCamera()}
              className={`h-11 px-3.5 sm:px-4 rounded-xl font-medium text-xs flex items-center gap-2 transition-colors whitespace-nowrap ${
                voice.videoEnabled ? 'bg-[#7C3AED] hover:bg-[#6D28D9] text-white' : 'bg-[#19192A] hover:bg-[#222238] border border-[#29293D] text-[#F8FAFC]'
              }`}
            >
              {voice.videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
              <span className="hidden sm:inline">{voice.videoEnabled ? 'Kamerayı Kapat' : 'Kamera'}</span>
            </button>

            <button
              type="button"
              onClick={() => void voice.toggleScreenShare()}
              className={`h-11 px-3.5 sm:px-4 rounded-xl font-medium text-xs flex items-center gap-2 transition-colors whitespace-nowrap ${
                voice.screenSharing ? 'bg-[#EF4444] hover:bg-[#DC2626] text-white' : 'bg-[#19192A] hover:bg-[#222238] border border-[#29293D] text-[#F8FAFC]'
              }`}
            >
              {voice.screenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
              <span>{voice.screenSharing ? 'Yayını Durdur' : 'Yayın Yap'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setReactionsOpen((prev) => !prev);
                setSoundboardOpen(false);
              }}
              title="Canlı Tepkiler"
              className={`h-11 px-3 rounded-xl font-medium text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                reactionsOpen
                  ? 'bg-[#7C3AED] text-white'
                  : 'bg-[#19192A] hover:bg-[#222238] border border-[#29293D] text-[#F8FAFC]'
              }`}
            >
              <SmilePlus className="w-4 h-4" />
              <span className="hidden md:inline">Tepkiler</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSoundboardOpen((prev) => !prev);
                setReactionsOpen(false);
              }}
              title="Ses Efektleri"
              className={`h-11 px-3 rounded-xl font-medium text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                soundboardOpen
                  ? 'bg-[#7C3AED] text-white'
                  : 'bg-[#19192A] hover:bg-[#222238] border border-[#29293D] text-[#C084FC]'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden md:inline">Ses Efektleri</span>
            </button>

            <button
              type="button"
              onClick={() => void handleLeave()}
              className="h-11 px-4 sm:px-5 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] text-white font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <PhoneOff className="w-4 h-4" />
              Ayrıl
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
