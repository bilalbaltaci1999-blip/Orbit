let sharedCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new Ctx();
  }
  if (sharedCtx.state === 'suspended') {
    void sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
}

function playTone(
  freq: number,
  durationSec: number,
  gainVal = 0.06,
  delaySec = 0,
  type: OscillatorType = 'sine',
  endFreq?: number
): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + durationSec);
    }
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  } catch {
    // Ignore audio context autoplay blocks
  }
}

export function playVoiceJoinSound(enabled = true): void {
  if (!enabled) return;
  playTone(523.25, 0.11, 0.055, 0, 'triangle');
  playTone(659.25, 0.14, 0.055, 0.08, 'triangle');
}

export function playVoiceLeaveSound(enabled = true): void {
  if (!enabled) return;
  playTone(523.25, 0.1, 0.05, 0, 'triangle');
  playTone(392.0, 0.14, 0.05, 0.07, 'triangle');
}

export function playMicToggleSound(muted: boolean, enabled = true): void {
  if (!enabled) return;
  playTone(muted ? 330 : 587.33, 0.07, 0.04, 0, 'sine');
}

export function playNotificationSound(enabled = true): void {
  if (!enabled) return;
  playTone(698.46, 0.09, 0.045, 0, 'sine');
  playTone(880.0, 0.13, 0.04, 0.075, 'sine');
}

export type SoundboardEffectKey = 'alkis' | 'davul' | 'basari' | 'lazer' | 'bildirim' | 'kahkaha';

export const SOUNDBOARD_EFFECTS: Array<{ key: SoundboardEffectKey; emoji: string; label: string }> = [
  { key: 'alkis', emoji: '👏', label: 'Alkış' },
  { key: 'davul', emoji: '🥁', label: 'Davul' },
  { key: 'basari', emoji: '🎉', label: 'Başarı' },
  { key: 'lazer', emoji: '⚡', label: 'Lazer' },
  { key: 'bildirim', emoji: '🔔', label: 'Zil' },
  { key: 'kahkaha', emoji: '😄', label: 'Neşe' },
];

export function playSoundboardEffect(effectKey: string, enabled = true): void {
  if (!enabled) return;
  switch (effectKey) {
    case 'alkis': {
      // Rhythmic triple clap burst
      [0, 0.09, 0.18, 0.28, 0.37].forEach((delay, idx) => {
        playTone(1200 + idx * 90, 0.045, 0.055, delay, 'square', 380);
      });
      break;
    }
    case 'davul': {
      // Ba-dum-tss style drum roll
      playTone(150, 0.12, 0.09, 0, 'triangle', 60);
      playTone(135, 0.12, 0.09, 0.14, 'triangle', 55);
      playTone(900, 0.18, 0.045, 0.28, 'sawtooth', 1800);
      break;
    }
    case 'basari': {
      // Major triad fanfare
      playTone(523.25, 0.12, 0.06, 0, 'triangle');
      playTone(659.25, 0.12, 0.06, 0.09, 'triangle');
      playTone(783.99, 0.14, 0.06, 0.18, 'triangle');
      playTone(1046.5, 0.28, 0.07, 0.27, 'triangle');
      break;
    }
    case 'lazer': {
      playTone(1320, 0.22, 0.06, 0, 'sawtooth', 160);
      playTone(880, 0.18, 0.04, 0.08, 'sine', 140);
      break;
    }
    case 'bildirim': {
      playTone(987.77, 0.15, 0.06, 0, 'sine');
      playTone(1318.5, 0.26, 0.065, 0.1, 'sine');
      break;
    }
    case 'kahkaha': {
      [0, 0.1, 0.2, 0.3].forEach((d, i) => {
        playTone(540 + (i % 2) * 140, 0.08, 0.055, d, 'triangle', 460 + i * 60);
      });
      break;
    }
    default:
      playNotificationSound(true);
  }
}
