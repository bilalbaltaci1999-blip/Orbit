import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { VoiceParticipant } from '../shared/types.ts';
import { apiFetch, ApiError, getStoredToken } from './api.ts';
import { useAuth } from './AuthContext.tsx';
import {
  playMicToggleSound,
  playSoundboardEffect,
  playVoiceJoinSound,
  playVoiceLeaveSound,
  type SoundboardEffectKey,
} from './soundEffects.ts';
import { useToast } from './ToastContext.tsx';
import { WebRtcRoomManager, type PeerStreamInfo } from './webrtc.ts';
import { wsClient } from './wsClient.ts';

export interface ActiveVoiceRoom {
  mode: 'channel' | 'dm_call';
  roomId: string;
  roomTitle: string;
  serverId?: string;
  serverName?: string;
  joinedAtMs: number;
  canSpeak: boolean;
  canScreenShare: boolean;
  isStage?: boolean;
}

export interface VoiceFloatingReaction {
  id: string;
  emoji: string;
  displayName: string;
  leftPct: number;
}

export type PttKeyOption = 'Space' | 'KeyV' | 'AltLeft';

export function formatVoiceDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatIsoElapsed(joinedAtIso?: string): string {
  if (!joinedAtIso) return '00:00';
  const normalized = joinedAtIso.endsWith('Z') || joinedAtIso.includes('+') ? joinedAtIso : `${joinedAtIso.replace(' ', 'T')}Z`;
  const ms = new Date(normalized).getTime();
  if (Number.isNaN(ms)) return '00:00';
  return formatVoiceDuration(Math.max(0, (Date.now() - ms) / 1000));
}

interface JoinVoiceParams {
  mode: 'channel' | 'dm_call';
  roomId: string;
  roomTitle: string;
  serverId?: string;
  serverName?: string;
  participants: VoiceParticipant[];
  canSpeak?: boolean;
  canScreenShare?: boolean;
  initialWithVideo?: boolean;
  isStage?: boolean;
}

interface VoiceContextValue {
  activeRoom: ActiveVoiceRoom | null;
  joining: boolean;
  elapsedSeconds: number;
  pingMs: number | null;
  muted: boolean;
  deafened: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  speaking: boolean;
  micLevel: number;
  noiseSuppression: boolean;
  turnConfigured: boolean;
  mediaError: string | null;
  remoteStreams: PeerStreamInfo[];
  localStream: MediaStream | null;
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  selectedAudioDevice: string;
  selectedAudioOutput: string;
  audioPlaybackBlocked: boolean;
  speakingMap: Record<string, boolean>;
  voiceReactions: VoiceFloatingReaction[];
  pttEnabled: boolean;
  pttKey: PttKeyOption;
  pttActive: boolean;
  peerVolumes: Record<string, number>;
  lastSoundboardBanner: { displayName: string; effect: string } | null;
  setPttEnabled: (enabled: boolean) => void;
  setPttKey: (key: PttKeyOption) => void;
  setPeerVolume: (userId: string, volume: number) => void;
  joinRoom: (params: JoinVoiceParams) => Promise<void>;
  leaveRoom: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  changeAudioDevice: (deviceId: string) => Promise<void>;
  changeAudioOutput: (deviceId: string) => void;
  unlockAudioPlayback: () => void;
  toggleNoiseSuppression: () => Promise<void>;
  syncParticipants: (roomId: string, participants: VoiceParticipant[]) => void;
  enforceServerMute: (isServerMuted: boolean) => void;
  sendVoiceReaction: (emoji: string) => void;
  sendSoundboard: (effect: SoundboardEffectKey) => void;
  raiseHand: (raised: boolean) => void;
  setSpeaker: (targetUserId: string, isSpeaker: boolean) => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

function loadPeerVolumes(): Record<string, number> {
  try {
    const raw = localStorage.getItem('orbit_peer_volumes');
    if (raw) return JSON.parse(raw) as Record<string, number>;
  } catch {
    // ignore storage errors
  }
  return {};
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { profile: me, settings } = useAuth();
  const { showToast } = useToast();

  const rtcRef = useRef<WebRtcRoomManager | null>(null);

  const [activeRoom, setActiveRoom] = useState<ActiveVoiceRoom | null>(null);
  const [joining, setJoining] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [turnConfigured, setTurnConfigured] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<PeerStreamInfo[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState('');
  const [selectedAudioOutput, setSelectedAudioOutput] = useState('');
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [audioUnlockCounter, setAudioUnlockCounter] = useState(0);
  const [speakingMap, setSpeakingMap] = useState<Record<string, boolean>>({});
  const [voiceReactions, setVoiceReactions] = useState<VoiceFloatingReaction[]>([]);

  const [pttEnabled, setPttEnabledState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('orbit_ptt_enabled') === '1';
    } catch {
      return false;
    }
  });
  const [pttKey, setPttKeyState] = useState<PttKeyOption>(() => {
    try {
      const k = localStorage.getItem('orbit_ptt_key');
      if (k === 'KeyV' || k === 'AltLeft' || k === 'Space') return k;
    } catch {
      // ignore
    }
    return 'Space';
  });
  const [pttActive, setPttActive] = useState(false);
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>(loadPeerVolumes);
  const [lastSoundboardBanner, setLastSoundboardBanner] = useState<{ displayName: string; effect: string } | null>(null);

  const soundOn = settings?.soundEnabled ?? true;
  const serverMutedRef = useRef(false);
  const activeRoomRef = useRef<ActiveVoiceRoom | null>(null);
  const mutedRef = useRef(false);
  const deafenedRef = useRef(false);
  const mutedBeforeDeafenRef = useRef(false);

  useEffect(() => {
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    deafenedRef.current = deafened;
  }, [deafened]);

  const setPttEnabled = useCallback(
    (enabled: boolean) => {
      setPttEnabledState(enabled);
      setPttActive(false);
      try {
        localStorage.setItem('orbit_ptt_enabled', enabled ? '1' : '0');
      } catch {
        // ignore
      }
      if (activeRoom && rtcRef.current) {
        if (enabled) {
          rtcRef.current.setMicMuted(true);
          setMuted(true);
        } else if (activeRoom.canSpeak && !deafened && !serverMutedRef.current) {
          rtcRef.current.setMicMuted(false);
          setMuted(false);
        }
      }
    },
    [activeRoom, deafened]
  );

  const setPttKey = useCallback((key: PttKeyOption) => {
    setPttKeyState(key);
    try {
      localStorage.setItem('orbit_ptt_key', key);
    } catch {
      // ignore
    }
  }, []);

  const setPeerVolume = useCallback((userId: string, volume: number) => {
    const clamped = Math.max(0, Math.min(200, Math.round(volume)));
    setPeerVolumes((prev) => {
      const next = { ...prev, [userId]: clamped };
      try {
        localStorage.setItem('orbit_peer_volumes', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const pushReactionOverlay = useCallback((emoji: string, displayName: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const leftPct = 15 + Math.floor(Math.random() * 70);
    setVoiceReactions((prev) => [...prev.slice(-14), { id, emoji, displayName, leftPct }]);
    window.setTimeout(() => {
      setVoiceReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2600);
  }, []);

  // Push-to-Talk global keyboard listener
  useEffect(() => {
    if (!pttEnabled || !activeRoom) return;

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== pttKey || e.repeat) return;
      if (isEditableTarget(e.target)) return;
      if (!activeRoom.canSpeak || deafened || serverMutedRef.current) return;
      if (e.code === 'Space') e.preventDefault();
      setPttActive(true);
      setMuted(false);
      rtcRef.current?.setMicMuted(false);
    };

    const releasePtt = () => {
      setPttActive(false);
      setMuted(true);
      rtcRef.current?.setMicMuted(true);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== pttKey) return;
      releasePtt();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releasePtt);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releasePtt);
    };
  }, [pttEnabled, pttKey, activeRoom, deafened]);

  // Enumerate microphones and speakers & react to device changes
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const refreshDevices = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devs) => {
          const mics = devs.filter((d) => d.kind === 'audioinput');
          const speakers = devs.filter((d) => d.kind === 'audiooutput');
          setAudioInputs(mics);
          setAudioOutputs(speakers);
          setSelectedAudioDevice((cur) => cur || mics[0]?.deviceId || '');
          setSelectedAudioOutput((cur) => cur || speakers[0]?.deviceId || '');
        })
        .catch(() => {});
    };
    refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices);
    };
  }, []);

  // Live voice duration timer + WebRTC RTT ping sampler
  useEffect(() => {
    if (!activeRoom) {
      setElapsedSeconds(0);
      setPingMs(null);
      return;
    }
    const tick = () => {
      setElapsedSeconds(Math.floor((Date.now() - activeRoom.joinedAtMs) / 1000));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    const pingTimer = window.setInterval(async () => {
      if (rtcRef.current) {
        const ms = await rtcRef.current.getConnectionRttMs();
        setPingMs(ms);
      }
    }, 3500);
    return () => {
      clearInterval(timer);
      clearInterval(pingTimer);
    };
  }, [activeRoom]);

  // WebSocket signaling, voice participant auto-sync, speaking indicator, reactions & soundboard listener
  useEffect(() => {
    return wsClient.onEvent((ev) => {
      const curRoom = activeRoomRef.current;
      if (ev.type === 'voice:signal' && rtcRef.current) {
        const p = ev.payload;
        void rtcRef.current.handleSignal(
          String(p.fromUserId),
          String(p.roomKey),
          p.signal as Record<string, unknown>
        );
      } else if (ev.type === 'voice:participants' && rtcRef.current && curRoom?.mode === 'channel') {
        const chId = String(ev.payload.channelId || '');
        if (chId === curRoom.roomId && Array.isArray(ev.payload.participants)) {
          const list = ev.payload.participants as VoiceParticipant[];
          rtcRef.current.syncPeers(list.map((part) => part.userId));
          // Sync stage speaker promotion/demotion dynamically
          const selfRow = list.find((part) => part.userId === me?.userId);
          if (selfRow && curRoom.isStage) {
            const nowCanSpeak = Boolean(selfRow.isSpeaker);
            setActiveRoom((prev) => (prev ? { ...prev, canSpeak: nowCanSpeak } : prev));
            if (!nowCanSpeak) {
              rtcRef.current.setMicMuted(true);
              setMuted(true);
            }
          }
        }
      } else if (ev.type === 'voice:speaking') {
        const chId = String(ev.payload.channelId || '');
        if (curRoom && chId === curRoom.roomId) {
          setSpeakingMap((prev) => ({
            ...prev,
            [String(ev.payload.userId)]: Boolean(ev.payload.speaking),
          }));
        }
      } else if (ev.type === 'voice:reaction') {
        const chId = String(ev.payload.channelId || '');
        if (curRoom && chId === curRoom.roomId && ev.payload.userId !== me?.userId) {
          pushReactionOverlay(String(ev.payload.emoji || '🔥'), String(ev.payload.displayName || 'Üye'));
        }
      } else if (ev.type === 'voice:soundboard') {
        const chId = String(ev.payload.channelId || '');
        if (curRoom && chId === curRoom.roomId) {
          const effect = String(ev.payload.effect || '');
          const displayName = String(ev.payload.displayName || 'Üye');
          if (!deafenedRef.current) {
            playSoundboardEffect(effect, soundOn);
          }
          setLastSoundboardBanner({ displayName, effect });
          window.setTimeout(() => setLastSoundboardBanner(null), 2400);
        }
      }
    });
  }, [me?.userId, pushReactionOverlay, soundOn]);

  const cleanupRtc = useCallback(() => {
    if (rtcRef.current) {
      rtcRef.current.leave();
      rtcRef.current = null;
    }
    serverMutedRef.current = false;
    setLocalStream(null);
    setRemoteStreams([]);
    setScreenSharing(false);
    setVideoEnabled(false);
    setSpeaking(false);
    setMicLevel(0);
    setSpeakingMap({});
    setVoiceReactions([]);
    setAudioPlaybackBlocked(false);
    setPttActive(false);
    setLastSoundboardBanner(null);
  }, []);

  const leaveRoom = useCallback(async () => {
    const current = activeRoom;
    cleanupRtc();
    setActiveRoom(null);
    if (!current) return;

    playVoiceLeaveSound(soundOn);
    wsClient.unsubscribe(`voice:${current.roomId}`);
    if (current.mode === 'channel') {
      await apiFetch(`/channels/${current.roomId}/voice/leave`, { method: 'POST' }).catch(() => {});
    }
  }, [activeRoom, cleanupRtc, soundOn]);

  // Cleanup when user logs out
  useEffect(() => {
    if (!me && activeRoom) {
      void leaveRoom();
    }
  }, [me, activeRoom, leaveRoom]);

  // Leave active voice channel reliably on tab close / pagehide
  useEffect(() => {
    const handleUnload = () => {
      const cur = activeRoomRef.current;
      if (!cur || cur.mode !== 'channel') return;
      const token = getStoredToken();
      void fetch(`/api/channels/${cur.roomId}/voice/leave`, {
        method: 'POST',
        keepalive: true,
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }).catch(() => {});
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, []);

  const joinRoom = useCallback(
    async (params: JoinVoiceParams) => {
      if (!me) return;
      if (activeRoom?.roomId === params.roomId && activeRoom.mode === params.mode) return;

      if (activeRoom) {
        await leaveRoom();
      }

      setJoining(true);
      setMediaError(null);
      const canSpeak = params.canSpeak ?? true;
      const canScreenShare = params.canScreenShare ?? true;
      const startMuted = !canSpeak || params.isStage === true || pttEnabled;
      const startVideo = Boolean(params.initialWithVideo);

      const manager = new WebRtcRoomManager();
      rtcRef.current = manager;

      try {
        const cfg = await manager.loadConfig();
        setTurnConfigured(cfg.turnConfigured);

        manager.onStreamsChange = (streams) => setRemoteStreams(streams);
        manager.onError = (msg) => setMediaError(msg);
        manager.onAudioLevelChange = (lvl) => setMicLevel(lvl);
        manager.onSpeakingChange = (isSpk) => {
          setSpeaking(isSpk);
          wsClient.send('voice:speaking', { channelId: params.roomId, speaking: isSpk });
        };

        const stream = await manager.startLocalMedia({
          audio: true,
          video: startVideo,
          audioDeviceId: selectedAudioDevice || undefined,
          noiseSuppression,
        });
        manager.setMicMuted(startMuted);
        setLocalStream(stream);
        setMuted(startMuted);
        setDeafened(false);
        setVideoEnabled(startVideo);

        wsClient.subscribe(`voice:${params.roomId}`);
        let initialPeerIds = params.participants.map((p) => p.userId);
        if (params.mode === 'channel') {
          const joinRes = await apiFetch<{ participants?: VoiceParticipant[] }>(`/channels/${params.roomId}/voice/join`, {
            method: 'POST',
            body: JSON.stringify({ muted: startMuted, deafened: false, videoEnabled: startVideo }),
          });
          if (Array.isArray(joinRes.participants) && joinRes.participants.length > 0) {
            initialPeerIds = joinRes.participants.map((p) => p.userId);
          }
          const selfState = joinRes.participants?.find((p) => p.userId === me.userId);
          const stageCanSpeak = params.isStage ? Boolean(selfState?.isSpeaker) : canSpeak;
          const finalMuted = !stageCanSpeak || pttEnabled || startMuted;
          manager.setMicMuted(finalMuted);
          setMuted(finalMuted);
          mutedBeforeDeafenRef.current = finalMuted;
          const nextRoom: ActiveVoiceRoom = {
            mode: params.mode,
            roomId: params.roomId,
            roomTitle: params.roomTitle,
            serverId: params.serverId,
            serverName: params.serverName,
            joinedAtMs: Date.now(),
            canSpeak: stageCanSpeak,
            canScreenShare,
            isStage: params.isStage,
          };
          activeRoomRef.current = nextRoom;
          setActiveRoom(nextRoom);
        } else {
          mutedBeforeDeafenRef.current = startMuted;
          const nextRoom: ActiveVoiceRoom = {
            mode: params.mode,
            roomId: params.roomId,
            roomTitle: params.roomTitle,
            serverId: params.serverId,
            serverName: params.serverName,
            joinedAtMs: Date.now(),
            canSpeak,
            canScreenShare,
            isStage: params.isStage,
          };
          activeRoomRef.current = nextRoom;
          setActiveRoom(nextRoom);
        }

        manager.joinRoom(`${params.mode}:${params.roomId}`, me.userId, initialPeerIds);

        playVoiceJoinSound(soundOn);
      } catch (err) {
        cleanupRtc();
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Mikrofon veya kamera izni alınamadı.';
        setMediaError(msg);
        showToast(msg, 'error');
      } finally {
        setJoining(false);
      }
    },
    [me, activeRoom, leaveRoom, selectedAudioDevice, noiseSuppression, pttEnabled, soundOn, cleanupRtc, showToast]
  );

  const toggleMute = useCallback(async () => {
    if (!activeRoom) return;
    if (!activeRoom.canSpeak) {
      showToast(
        activeRoom.isStage
          ? 'Sahne modunda konuşmak için el kaldırıp moderatörden söz isteyin.'
          : 'Bu odada konuşma izniniz kısıtlı.',
        'error'
      );
      return;
    }
    if (pttEnabled) {
      showToast('Bas-Konuş modu aktif. Konuşmak için atanan tuşa basılı tutun veya PTT modunu kapatın.', 'info');
      return;
    }
    const next = !muted;
    setMuted(next);
    rtcRef.current?.setMicMuted(next);
    playMicToggleSound(next, soundOn);
    if (activeRoom.mode === 'channel') {
      await apiFetch(`/channels/${activeRoom.roomId}/voice/state`, {
        method: 'PATCH',
        body: JSON.stringify({ muted: next }),
      }).catch(() => {});
    }
  }, [activeRoom, muted, pttEnabled, soundOn, showToast]);

  const toggleDeafen = useCallback(async () => {
    if (!activeRoom) return;
    const next = !deafened;
    setDeafened(next);
    let nextMuted = muted;
    if (next) {
      mutedBeforeDeafenRef.current = muted;
      nextMuted = true;
      setMuted(true);
      rtcRef.current?.setMicMuted(true);
    } else if (activeRoom.canSpeak && !serverMutedRef.current && !pttEnabled) {
      nextMuted = mutedBeforeDeafenRef.current;
      setMuted(nextMuted);
      rtcRef.current?.setMicMuted(nextMuted);
    }
    playMicToggleSound(next, soundOn);
    if (activeRoom.mode === 'channel') {
      await apiFetch(`/channels/${activeRoom.roomId}/voice/state`, {
        method: 'PATCH',
        body: JSON.stringify({ deafened: next, muted: nextMuted }),
      }).catch(() => {});
    }
  }, [activeRoom, deafened, muted, pttEnabled, soundOn]);

  const toggleCamera = useCallback(async () => {
    if (!activeRoom) return;
    if (!activeRoom.canScreenShare) {
      showToast('Kamera veya ekran paylaşımı izniniz yok.', 'error');
      return;
    }
    const next = !videoEnabled;
    try {
      const stream = await rtcRef.current?.toggleVideo(next);
      setVideoEnabled(next);
      if (stream) setLocalStream(new MediaStream(stream.getTracks()));
      if (activeRoom.mode === 'channel') {
        await apiFetch(`/channels/${activeRoom.roomId}/voice/state`, {
          method: 'PATCH',
          body: JSON.stringify({ videoEnabled: next }),
        }).catch(() => {});
      }
    } catch {
      showToast('Kamera açılamadı. Cihaz izinlerini kontrol edin.', 'error');
    }
  }, [activeRoom, videoEnabled, showToast]);

  const toggleScreenShare = useCallback(async () => {
    if (!activeRoom) return;
    if (!activeRoom.canScreenShare) {
      showToast('Ekran paylaşımı izniniz yok.', 'error');
      return;
    }
    if (!WebRtcRoomManager.isScreenShareSupported()) {
      showToast('Bu tarayıcıda ekran paylaşımı desteklenmiyor.', 'error');
      return;
    }
    try {
      const nextSharing = !screenSharing;
      if (screenSharing) {
        await rtcRef.current?.stopScreenShare();
        setScreenSharing(false);
      } else {
        const stream = await rtcRef.current?.startScreenShare();
        setScreenSharing(true);
        if (stream) {
          stream.getVideoTracks()[0]?.addEventListener('ended', () => {
            setScreenSharing(false);
            void rtcRef.current?.stopScreenShare();
          });
        }
      }
      if (activeRoom.mode === 'channel') {
        await apiFetch(`/channels/${activeRoom.roomId}/voice/state`, {
          method: 'PATCH',
          body: JSON.stringify({ screenSharing: nextSharing }),
        }).catch(() => {});
      }
    } catch {
      showToast('Ekran paylaşımı başlatılamadı veya iptal edildi.', 'error');
    }
  }, [activeRoom, screenSharing, showToast]);

  const changeAudioDevice = useCallback(
    async (deviceId: string) => {
      setSelectedAudioDevice(deviceId);
      if (activeRoom && rtcRef.current) {
        try {
          await rtcRef.current.switchAudioDevice(deviceId, noiseSuppression, muted);
          showToast('Mikrofon cihazı değiştirildi.', 'success');
        } catch {
          showToast('Seçilen mikrofon cihazına geçilemedi.', 'error');
        }
      }
    },
    [activeRoom, noiseSuppression, muted, showToast]
  );

  const changeAudioOutput = useCallback(
    (deviceId: string) => {
      setSelectedAudioOutput(deviceId);
      showToast('Ses çıkış cihazı güncellendi.', 'success');
    },
    [showToast]
  );

  const unlockAudioPlayback = useCallback(() => {
    setAudioPlaybackBlocked(false);
    setAudioUnlockCounter((c) => c + 1);
  }, []);

  const toggleNoiseSuppression = useCallback(async () => {
    const next = !noiseSuppression;
    setNoiseSuppression(next);
    if (activeRoom && rtcRef.current) {
      await rtcRef.current.switchAudioDevice(selectedAudioDevice, next, muted).catch(() => {});
    }
    showToast(next ? 'Gürültü bastırma açıldı.' : 'Gürültü bastırma kapatıldı.', 'info');
  }, [noiseSuppression, activeRoom, selectedAudioDevice, muted, showToast]);

  const syncParticipants = useCallback(
    (roomId: string, participants: VoiceParticipant[]) => {
      if (activeRoom?.roomId === roomId && rtcRef.current) {
        rtcRef.current.syncPeers(participants.map((p) => p.userId));
      }
    },
    [activeRoom?.roomId]
  );

  const enforceServerMute = useCallback((isServerMuted: boolean) => {
    serverMutedRef.current = isServerMuted;
    if (isServerMuted && rtcRef.current) {
      rtcRef.current.setMicMuted(true);
      setMuted(true);
    }
  }, []);

  const sendVoiceReaction = useCallback(
    (emoji: string) => {
      if (!activeRoom || !me) return;
      pushReactionOverlay(emoji, me.displayName);
      wsClient.send('voice:reaction', {
        channelId: activeRoom.roomId,
        emoji,
      });
    },
    [activeRoom, me, pushReactionOverlay]
  );

  const sendSoundboard = useCallback(
    (effect: SoundboardEffectKey) => {
      if (!activeRoom) return;
      wsClient.send('voice:soundboard', {
        channelId: activeRoom.roomId,
        effect,
      });
    },
    [activeRoom]
  );

  const raiseHand = useCallback(
    (raised: boolean) => {
      if (!activeRoom || activeRoom.mode !== 'channel') return;
      wsClient.send('voice:hand_raise', {
        channelId: activeRoom.roomId,
        raised,
      });
    },
    [activeRoom]
  );

  const setSpeaker = useCallback(
    (targetUserId: string, isSpeaker: boolean) => {
      if (!activeRoom || activeRoom.mode !== 'channel') return;
      wsClient.send('voice:set_speaker', {
        channelId: activeRoom.roomId,
        targetUserId,
        isSpeaker,
      });
    },
    [activeRoom]
  );

  const value = useMemo<VoiceContextValue>(
    () => ({
      activeRoom,
      joining,
      elapsedSeconds,
      pingMs,
      muted,
      deafened,
      videoEnabled,
      screenSharing,
      speaking,
      micLevel,
      noiseSuppression,
      turnConfigured,
      mediaError,
      remoteStreams,
      localStream,
      audioInputs,
      audioOutputs,
      selectedAudioDevice,
      selectedAudioOutput,
      audioPlaybackBlocked,
      speakingMap,
      voiceReactions,
      pttEnabled,
      pttKey,
      pttActive,
      peerVolumes,
      lastSoundboardBanner,
      setPttEnabled,
      setPttKey,
      setPeerVolume,
      joinRoom,
      leaveRoom,
      toggleMute,
      toggleDeafen,
      toggleCamera,
      toggleScreenShare,
      changeAudioDevice,
      changeAudioOutput,
      unlockAudioPlayback,
      toggleNoiseSuppression,
      syncParticipants,
      enforceServerMute,
      sendVoiceReaction,
      sendSoundboard,
      raiseHand,
      setSpeaker,
    }),
    [
      activeRoom,
      joining,
      elapsedSeconds,
      pingMs,
      muted,
      deafened,
      videoEnabled,
      screenSharing,
      speaking,
      micLevel,
      noiseSuppression,
      turnConfigured,
      mediaError,
      remoteStreams,
      localStream,
      audioInputs,
      audioOutputs,
      selectedAudioDevice,
      selectedAudioOutput,
      audioPlaybackBlocked,
      speakingMap,
      voiceReactions,
      pttEnabled,
      pttKey,
      pttActive,
      peerVolumes,
      lastSoundboardBanner,
      setPttEnabled,
      setPttKey,
      setPeerVolume,
      joinRoom,
      leaveRoom,
      toggleMute,
      toggleDeafen,
      toggleCamera,
      toggleScreenShare,
      changeAudioDevice,
      changeAudioOutput,
      unlockAudioPlayback,
      toggleNoiseSuppression,
      syncParticipants,
      enforceServerMute,
      sendVoiceReaction,
      sendSoundboard,
      raiseHand,
      setSpeaker,
    ]
  );

  return (
    <VoiceContext.Provider value={value}>
      {children}
      {/* Persistent audio elements stay mounted across channel navigation & remain non-hidden so Safari/iOS keeps playback alive */}
      <div
        className="fixed -left-[9999px] top-0 w-px h-px overflow-hidden opacity-0 pointer-events-none"
        aria-hidden="true"
      >
        {remoteStreams.map((info) => (
          <PersistentRemoteAudio
            key={info.userId}
            stream={info.stream}
            deafened={deafened}
            volumePct={peerVolumes[info.userId] ?? 100}
            sinkId={selectedAudioOutput}
            unlockTrigger={audioUnlockCounter}
            onBlocked={() => setAudioPlaybackBlocked(true)}
            onPlaying={() => setAudioPlaybackBlocked(false)}
          />
        ))}
      </div>
    </VoiceContext.Provider>
  );
}

function PersistentRemoteAudio({
  stream,
  deafened,
  volumePct,
  sinkId,
  unlockTrigger,
  onBlocked,
  onPlaying,
}: {
  stream: MediaStream;
  deafened: boolean;
  volumePct: number;
  sinkId: string;
  unlockTrigger: number;
  onBlocked: () => void;
  onPlaying: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    const el = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!el) return;

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const useWebAudioBoost = Boolean(AudioCtx && volumePct > 100);

    // Keep the HTMLAudioElement pulling WebRTC stream frames reliably in Chromium
    el.srcObject = stream;
    if (sinkId && typeof el.setSinkId === 'function') {
      void el.setSinkId(sinkId).catch(() => {});
    }

    if (useWebAudioBoost && AudioCtx) {
      el.muted = true;
      void el.play().catch(() => {});
      try {
        if (!ctxRef.current || ctxRef.current.state === 'closed') {
          const ctx = new AudioCtx();
          const source = ctx.createMediaStreamSource(stream);
          const gainNode = ctx.createGain();
          source.connect(gainNode);
          gainNode.connect(ctx.destination);
          ctxRef.current = ctx;
          gainRef.current = gainNode;
        }
        const ctx = ctxRef.current as AudioContext & { setSinkId?: (id: string) => Promise<void> };
        if (sinkId && typeof ctx.setSinkId === 'function') {
          void ctx.setSinkId(sinkId).catch(() => {});
        }
        if (gainRef.current) {
          gainRef.current.gain.value = deafened ? 0 : Math.max(0, Math.min(2, volumePct / 100));
        }
        void ctxRef.current.resume().then(() => onPlaying()).catch(() => onBlocked());
        return;
      } catch {
        // Fallback to native <audio> element below
      }
    }

    // Close WebAudio boost context if volume <= 100%
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
      gainRef.current = null;
    }

    el.muted = deafened;
    el.volume = Math.max(0, Math.min(1, volumePct / 100));
    el.play()
      .then(() => onPlaying())
      .catch(() => onBlocked());
  }, [stream, deafened, volumePct, sinkId, unlockTrigger, onBlocked, onPlaying]);

  useEffect(() => {
    return () => {
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
        gainRef.current = null;
      }
    };
  }, []);

  return <audio ref={audioRef} autoPlay playsInline />;
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice must be used inside VoiceProvider');
  return ctx;
}
