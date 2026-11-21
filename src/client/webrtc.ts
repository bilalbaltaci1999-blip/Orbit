import { apiFetch } from './api.ts';
import { wsClient } from './wsClient.ts';

export interface PeerStreamInfo {
  userId: string;
  stream: MediaStream;
  connectionState: RTCPeerConnectionState;
}

export class WebRtcRoomManager {
  private peers = new Map<string, RTCPeerConnection>();
  private remoteStreams = new Map<string, MediaStream>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private makingOffer = new Map<string, boolean>();
  private ignoreOffer = new Map<string, boolean>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  public turnConfigured = false;
  private roomKey: string | null = null;
  private myUserId: string | null = null;
  private audioContext: AudioContext | null = null;
  private speakingInterval: number | null = null;
  private isSpeaking = false;

  public onStreamsChange?: (streams: PeerStreamInfo[]) => void;
  public onSpeakingChange?: (speaking: boolean) => void;
  public onAudioLevelChange?: (level: number) => void;
  public onError?: (message: string) => void;

  public async loadConfig(): Promise<{ turnConfigured: boolean }> {
    try {
      const res = await apiFetch<{ iceServers: RTCIceServer[]; turnConfigured: boolean }>('/webrtc/config');
      if (Array.isArray(res.iceServers) && res.iceServers.length > 0) {
        this.iceServers = res.iceServers;
      }
      this.turnConfigured = res.turnConfigured;
      return { turnConfigured: res.turnConfigured };
    } catch {
      return { turnConfigured: false };
    }
  }

  public static isScreenShareSupported(): boolean {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
  }

  public async startLocalMedia(options: {
    audio: boolean;
    video: boolean;
    audioDeviceId?: string;
    videoDeviceId?: string;
    noiseSuppression?: boolean;
  }): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      if (options.audio && !options.video) {
        const emptyStream = new MediaStream();
        this.localStream = emptyStream;
        this.onError?.('Tarayıcı mikrofon erişimi sunamadı; dinleyici modunda katıldınız.');
        return emptyStream;
      }
      throw new Error('Tarayıcınız mikrofon veya kamera erişimini desteklemiyor (HTTPS gerekli olabilir).');
    }
    const ns = options.noiseSuppression ?? true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: options.audio
          ? options.audioDeviceId
            ? { deviceId: { exact: options.audioDeviceId }, echoCancellation: true, noiseSuppression: ns, autoGainControl: true }
            : { echoCancellation: true, noiseSuppression: ns, autoGainControl: true }
          : false,
        video: options.video
          ? options.videoDeviceId
            ? { deviceId: { exact: options.videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { width: { ideal: 1280 }, height: { ideal: 720 } }
          : false,
      });
      this.localStream = stream;
      this.setupSpeakingDetector(stream);
      return stream;
    } catch (err) {
      if (options.audio && !options.video) {
        const emptyStream = new MediaStream();
        this.localStream = emptyStream;
        this.onError?.('Mikrofon erişilemedi; dinleyici modunda katıldınız.');
        return emptyStream;
      }
      throw err;
    }
  }

  public async switchAudioDevice(audioDeviceId: string, noiseSuppression = true, keepMuted = false): Promise<void> {
    if (!this.localStream) return;
    const newAudio = await navigator.mediaDevices.getUserMedia({
      audio: audioDeviceId
        ? { deviceId: { exact: audioDeviceId }, echoCancellation: true, noiseSuppression, autoGainControl: true }
        : { echoCancellation: true, noiseSuppression, autoGainControl: true },
    });
    const newTrack = newAudio.getAudioTracks()[0];
    if (!newTrack) return;
    newTrack.enabled = !keepMuted;

    for (const oldTrack of this.localStream.getAudioTracks()) {
      oldTrack.stop();
      this.localStream.removeTrack(oldTrack);
    }
    this.localStream.addTrack(newTrack);

    for (const [peerId, pc] of this.peers.entries()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
      if (sender) {
        await sender.replaceTrack(newTrack).catch(() => {});
      } else {
        pc.addTrack(newTrack, this.localStream);
        await this.renegotiatePeer(peerId);
      }
    }
    this.setupSpeakingDetector(this.localStream);
  }

  public async getConnectionRttMs(): Promise<number | null> {
    for (const pc of this.peers.values()) {
      if (pc.connectionState !== 'connected') continue;
      try {
        const stats = await pc.getStats();
        for (const report of stats.values()) {
          if (
            report.type === 'candidate-pair' &&
            (report as RTCStats & { state?: string; nominated?: boolean; currentRoundTripTime?: number }).state === 'succeeded' &&
            typeof (report as RTCStats & { currentRoundTripTime?: number }).currentRoundTripTime === 'number'
          ) {
            return Math.round(((report as RTCStats & { currentRoundTripTime: number }).currentRoundTripTime || 0) * 1000);
          }
        }
      } catch {
        // Ignore stats error
      }
    }
    return null;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  public setMicMuted(muted: boolean): void {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  public async toggleVideo(enable: boolean, deviceId?: string): Promise<MediaStream | null> {
    if (!this.localStream) return null;
    if (!enable) {
      for (const track of this.localStream.getVideoTracks()) {
        track.stop();
        this.localStream.removeTrack(track);
      }
      await this.replaceVideoTracksOnPeers(null);
      return this.localStream;
    }

    const camStream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const videoTrack = camStream.getVideoTracks()[0];
    if (videoTrack) {
      for (const old of this.localStream.getVideoTracks()) {
        old.stop();
        this.localStream.removeTrack(old);
      }
      this.localStream.addTrack(videoTrack);
      await this.replaceVideoTracksOnPeers(videoTrack, this.localStream);
    }
    return this.localStream;
  }

  public async startScreenShare(): Promise<MediaStream> {
    if (!WebRtcRoomManager.isScreenShareSupported()) {
      throw new Error('Bu tarayıcıda (ör. Mobil Safari) ekran paylaşımı desteklenmiyor.');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    this.screenStream = stream;
    const screenTrack = stream.getVideoTracks()[0];
    if (screenTrack) {
      await this.replaceVideoTracksOnPeers(screenTrack, stream);
    }
    return stream;
  }

  public async stopScreenShare(): Promise<void> {
    if (this.screenStream) {
      for (const t of this.screenStream.getTracks()) t.stop();
      this.screenStream = null;
    }
    const camTrack = this.localStream?.getVideoTracks()[0] || null;
    await this.replaceVideoTracksOnPeers(camTrack, this.localStream || undefined);
  }

  private async replaceVideoTracksOnPeers(track: MediaStreamTrack | null, owningStream?: MediaStream): Promise<void> {
    const stream = owningStream || this.localStream;
    for (const [peerId, pc] of this.peers.entries()) {
      const videoTransceiver = pc.getTransceivers().find((t) => t.receiver.track?.kind === 'video' || t.sender.track?.kind === 'video');
      const sender = videoTransceiver?.sender || pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(track).catch(() => {});
      } else if (track && stream) {
        pc.addTrack(track, stream);
        await this.renegotiatePeer(peerId);
      }
    }
  }

  public joinRoom(roomKey: string, myUserId: string, existingPeerIds: string[]): void {
    this.roomKey = roomKey;
    this.myUserId = myUserId;
    this.syncPeers(existingPeerIds);
  }

  public syncPeers(peerIds: string[]): void {
    if (!this.roomKey || !this.myUserId) return;
    const activeSet = new Set(peerIds);

    for (const [peerId, pc] of this.peers.entries()) {
      if (!activeSet.has(peerId)) {
        pc.close();
        this.peers.delete(peerId);
        this.remoteStreams.delete(peerId);
        this.pendingCandidates.delete(peerId);
        this.makingOffer.delete(peerId);
        this.ignoreOffer.delete(peerId);
      }
    }

    for (const peerId of peerIds) {
      if (peerId !== this.myUserId && !this.peers.has(peerId)) {
        // Pre-create RTCPeerConnection so incoming offers or ICE arrive cleanly;
        // Deterministic initiator creates the initial SDP offer to avoid glare.
        this.createPeerConnection(peerId);
        if (this.myUserId > peerId) {
          void this.renegotiatePeer(peerId);
        }
      }
    }
    this.emitStreams();
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(peerId, pc);
    this.pendingCandidates.set(peerId, []);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.roomKey) {
        wsClient.send('voice:signal', {
          targetUserId: peerId,
          roomKey: this.roomKey,
          signal: { type: 'candidate', candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate },
        });
      }
    };

    pc.onnegotiationneeded = () => {
      // Only trigger automatic renegotiation once signaling is stable and we already have an established peer or are the initiator
      if (pc.signalingState === 'stable' && (pc.currentRemoteDescription || (this.myUserId && this.myUserId > peerId))) {
        void this.renegotiatePeer(peerId);
      }
    };

    pc.ontrack = (ev) => {
      let peerStream = this.remoteStreams.get(peerId);
      if (!peerStream) {
        peerStream = new MediaStream();
        this.remoteStreams.set(peerId, peerStream);
      }
      const incoming = ev.streams?.[0];
      if (incoming) {
        for (const t of incoming.getTracks()) {
          if (!peerStream.getTracks().some((existingTrack) => existingTrack.id === t.id)) {
            peerStream.addTrack(t);
          }
        }
      }
      if (!peerStream.getTracks().some((existingTrack) => existingTrack.id === ev.track.id)) {
        peerStream.addTrack(ev.track);
      }
      ev.track.onmute = () => this.emitStreams();
      ev.track.onunmute = () => this.emitStreams();
      ev.track.onended = () => {
        peerStream?.removeTrack(ev.track);
        this.emitStreams();
      };
      this.emitStreams();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        pc.restartIce?.();
        this.onError?.(
          this.turnConfigured
            ? 'Eşler arası bağlantı kesildi, yeniden bağlanmaya çalışılıyor.'
            : 'NAT/güvenlik duvarı nedeniyle bağlantı kurulamadı. TURN sunucusu yapılandırılması gerekebilir.'
        );
      }
      this.emitStreams();
    };

    return pc;
  }

  private async renegotiatePeer(peerId: string): Promise<void> {
    if (!this.roomKey) return;
    const pc = this.createPeerConnection(peerId);
    if (this.makingOffer.get(peerId) || pc.signalingState !== 'stable') return;
    try {
      this.makingOffer.set(peerId, true);
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      wsClient.send('voice:signal', {
        targetUserId: peerId,
        roomKey: this.roomKey,
        signal: { type: 'offer', sdp: pc.localDescription },
      });
    } catch {
      // Ignore transient negotiation race
    } finally {
      this.makingOffer.set(peerId, false);
    }
  }

  private async flushPendingCandidates(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const queue = this.pendingCandidates.get(peerId);
    if (!queue || queue.length === 0 || !pc.remoteDescription) return;
    this.pendingCandidates.set(peerId, []);
    for (const candidate of queue) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    }
  }

  public async handleSignal(fromUserId: string, roomKey: string, signal: Record<string, unknown>): Promise<void> {
    if (!this.roomKey || roomKey !== this.roomKey) return;
    const pc = this.createPeerConnection(fromUserId);
    const polite = Boolean(this.myUserId && this.myUserId < fromUserId);

    try {
      if (signal.type === 'offer' && signal.sdp) {
        const offerCollision = Boolean(this.makingOffer.get(fromUserId)) || pc.signalingState !== 'stable';
        const ignore = !polite && offerCollision;
        this.ignoreOffer.set(fromUserId, ignore);
        if (ignore) return;

        if (offerCollision && pc.signalingState === 'have-local-offer') {
          await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
        }
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp as RTCSessionDescriptionInit));
        await this.flushPendingCandidates(fromUserId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsClient.send('voice:signal', {
          targetUserId: fromUserId,
          roomKey: this.roomKey,
          signal: { type: 'answer', sdp: pc.localDescription },
        });
      } else if (signal.type === 'answer' && signal.sdp) {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp as RTCSessionDescriptionInit));
          await this.flushPendingCandidates(fromUserId, pc);
        }
      } else if (signal.type === 'candidate' && signal.candidate) {
        if (this.ignoreOffer.get(fromUserId)) return;
        const candInit = signal.candidate as RTCIceCandidateInit;
        if (!pc.remoteDescription || !pc.remoteDescription.type) {
          const queue = this.pendingCandidates.get(fromUserId) || [];
          queue.push(candInit);
          this.pendingCandidates.set(fromUserId, queue);
        } else {
          await pc.addIceCandidate(new RTCIceCandidate(candInit)).catch(() => {});
        }
      }
    } catch {
      // Ignore malformed/stale signal frames
    }
  }

  private setupSpeakingDetector(stream: MediaStream): void {
    try {
      if (this.speakingInterval) clearInterval(this.speakingInterval);
      if (this.audioContext) void this.audioContext.close();
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      const ctx = new AudioContext();
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      this.audioContext = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      this.speakingInterval = window.setInterval(() => {
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => {});
        }
        if (!audioTrack.enabled || audioTrack.readyState !== 'live') {
          this.onAudioLevelChange?.(0);
          if (this.isSpeaking) {
            this.isSpeaking = false;
            this.onSpeakingChange?.(false);
          }
          return;
        }
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const normalizedLevel = Math.min(100, Math.round((avg / 64) * 100));
        this.onAudioLevelChange?.(normalizedLevel);
        const speakingNow = avg > 10;
        if (speakingNow !== this.isSpeaking) {
          this.isSpeaking = speakingNow;
          this.onSpeakingChange?.(speakingNow);
        }
      }, 150);
    } catch {
      // Ignore AudioContext blocks
    }
  }

  private emitStreams(): void {
    const list: PeerStreamInfo[] = [];
    for (const [userId, stream] of this.remoteStreams.entries()) {
      const pc = this.peers.get(userId);
      list.push({
        userId,
        stream: new MediaStream(stream.getTracks()),
        connectionState: pc?.connectionState || 'connecting',
      });
    }
    this.onStreamsChange?.(list);
  }

  public leave(): void {
    if (this.speakingInterval) {
      clearInterval(this.speakingInterval);
      this.speakingInterval = null;
    }
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
    for (const pc of this.peers.values()) {
      pc.close();
    }
    this.peers.clear();
    this.remoteStreams.clear();
    this.pendingCandidates.clear();
    this.makingOffer.clear();
    this.ignoreOffer.clear();
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
    if (this.screenStream) {
      for (const t of this.screenStream.getTracks()) t.stop();
      this.screenStream = null;
    }
    this.roomKey = null;
    this.emitStreams();
  }
}
