import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Dices, Gamepad2, Grid3x3, RotateCcw, Scissors, Trophy, Users, X } from 'lucide-react';
import { apiFetch } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { wsClient } from '../client/wsClient.ts';
import type {
  DiceDuelGameState,
  RpsChoice,
  RpsGameState,
  TicTacToeGameState,
  VoiceGameState,
  VoiceGameType,
} from '../shared/types.ts';

const GAME_CARDS: Array<{
  type: VoiceGameType;
  title: string;
  subtitle: string;
  playersLabel: string;
  icon: typeof Grid3x3;
  accent: string;
}> = [
  {
    type: 'tic_tac_toe',
    title: 'XOX · Strateji Düellosu',
    subtitle: '3×3 ızgarada sırayla hamle yap, üçlüyü ilk tamamlayan kazanır.',
    playersLabel: '2 Oyuncu',
    icon: Grid3x3,
    accent: 'text-[#C084FC] border-[#A855F7]/30 bg-[#7C3AED]/10',
  },
  {
    type: 'rps',
    title: 'Taş · Kağıt · Makas',
    subtitle: 'Gizli seçimini yap, iki taraf da seçtiğinde tur otomatik açılır.',
    playersLabel: '2 Oyuncu',
    icon: Scissors,
    accent: 'text-[#38BDF8] border-[#38BDF8]/30 bg-[#38BDF8]/10',
  },
  {
    type: 'dice_duel',
    title: 'Zar Düellosu (1–100)',
    subtitle: 'Odadaki herkes şansını dener, en yüksek zarı atan lider olur.',
    playersLabel: 'Çok Oyunculu',
    icon: Dices,
    accent: 'text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/10',
  },
];

const RPS_OPTIONS: Array<{ key: RpsChoice; label: string; emoji: string }> = [
  { key: 'rock', label: 'Taş', emoji: '🪨' },
  { key: 'paper', label: 'Kağıt', emoji: '📄' },
  { key: 'scissors', label: 'Makas', emoji: '✂️' },
];

export function VoiceGamesPanel({ roomId }: { roomId: string }) {
  const { profile: me } = useAuth();
  const [gameState, setGameState] = useState<VoiceGameState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{ gameState?: VoiceGameState | null }>(`/voice-rooms/${roomId}/collab`)
      .then((res) => {
        if (!cancelled) {
          setGameState(res.gameState ?? null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    return wsClient.onEvent((ev) => {
      if (ev.type === 'voice:game_state' && String(ev.payload.roomId || '') === roomId) {
        setGameState((ev.payload.gameState as VoiceGameState | null) ?? null);
      }
    });
  }, [roomId]);

  const startGame = (gameType: VoiceGameType) => {
    wsClient.send('voice:game_start', { roomId, gameType });
  };

  const resetGame = () => {
    wsClient.send('voice:game_reset', { roomId });
  };

  const closeGame = () => {
    wsClient.send('voice:game_close', { roomId });
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center py-12 text-xs text-[#A1A1B5]">
        Oyun salonu hazırlanıyor...
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="max-w-3xl mx-auto space-y-5 py-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <h3 className="text-base font-bold font-display flex items-center gap-2 text-[#F8FAFC]">
              <Gamepad2 className="w-5 h-5 text-[#A855F7]" />
              Sesli Oda Oyun Salonu
            </h3>
            <p className="text-xs text-[#A1A1B5]">
              Sohbet ederken odadaki arkadaşlarınla gerçek zamanlı mini oyun başlat.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {GAME_CARDS.map((card, idx) => {
            const Icon = card.icon;
            return (
              <motion.button
                key={card.type}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: idx * 0.05 }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => startGame(card.type)}
                className="text-left p-4 rounded-2xl border border-[#29293D] bg-[#151522] hover:border-[#A855F7]/50 hover:bg-[#19192A] transition-colors flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className={`w-11 h-11 rounded-xl border flex items-center justify-center ${card.accent}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-[#F8FAFC]">{card.title}</h4>
                    <p className="text-xs text-[#A1A1B5] leading-relaxed">{card.subtitle}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#29293D]/80 text-[11px]">
                  <span className="text-[#A1A1B5] inline-flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {card.playersLabel}
                  </span>
                  <span className="font-semibold text-[#C084FC]">Oyunu Başlat →</span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      key={gameState.gameType}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className="max-w-2xl mx-auto rounded-2xl border border-[#29293D] bg-[#151522] p-4 sm:p-5 space-y-5"
    >
      {/* Game Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-[#29293D]">
        <div className="flex items-center gap-2.5">
          <Gamepad2 className="w-5 h-5 text-[#A855F7]" />
          <div>
            <h4 className="text-sm font-bold text-[#F8FAFC]">
              {gameState.gameType === 'tic_tac_toe'
                ? 'XOX · Strateji Düellosu'
                : gameState.gameType === 'rps'
                ? 'Taş · Kağıt · Makas'
                : 'Zar Düellosu'}
            </h4>
            <p className="text-[11px] text-[#A1A1B5]">Odadaki tüm katılımcılarla canlı senkronize</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetGame}
            className="h-8 px-3 rounded-lg bg-[#19192A] hover:bg-[#222238] border border-[#29293D] text-xs font-medium text-[#F8FAFC] inline-flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Yeniden Başlat
          </button>
          <button
            type="button"
            onClick={closeGame}
            className="h-8 px-3 rounded-lg bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-xs font-medium text-[#EF4444] inline-flex items-center gap-1.5 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Oyunu Kapat
          </button>
        </div>
      </div>

      {/* Tic-Tac-Toe */}
      {gameState.gameType === 'tic_tac_toe' && (
        <TicTacToeView state={gameState} myUserId={me?.userId} roomId={roomId} />
      )}

      {/* Rock Paper Scissors */}
      {gameState.gameType === 'rps' && (
        <RpsView state={gameState} myUserId={me?.userId} roomId={roomId} />
      )}

      {/* Dice Duel */}
      {gameState.gameType === 'dice_duel' && (
        <DiceDuelView state={gameState} myUserId={me?.userId} roomId={roomId} />
      )}
    </motion.div>
  );
}

function TicTacToeView({
  state,
  myUserId,
  roomId,
}: {
  state: TicTacToeGameState;
  myUserId?: string;
  roomId: string;
}) {
  const mySide =
    state.players.X?.userId === myUserId ? 'X' : state.players.O?.userId === myUserId ? 'O' : null;
  const canJoinSeat = !mySide && (!state.players.X || !state.players.O);
  const isMyTurn = !state.winner && mySide === state.turn;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div
          className={`p-3 rounded-xl border ${
            state.turn === 'X' && !state.winner
              ? 'border-[#A855F7] bg-[#7C3AED]/15'
              : 'border-[#29293D] bg-[#10111B]'
          }`}
        >
          <p className="text-[11px] text-[#A1A1B5]">Oyuncu X</p>
          <p className="font-bold text-[#F8FAFC] truncate mt-0.5">
            {state.players.X?.displayName || 'Bekleniyor (İlk hamlede atanır)'}
          </p>
        </div>
        <div
          className={`p-3 rounded-xl border ${
            state.turn === 'O' && !state.winner
              ? 'border-[#38BDF8] bg-[#38BDF8]/15'
              : 'border-[#29293D] bg-[#10111B]'
          }`}
        >
          <p className="text-[11px] text-[#A1A1B5]">Oyuncu O</p>
          <p className="font-bold text-[#F8FAFC] truncate mt-0.5">
            {state.players.O?.displayName || 'Bekleniyor'}
          </p>
        </div>
      </div>

      {canJoinSeat && !state.winner && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => wsClient.send('voice:game_move', { roomId, action: 'join_side' })}
            className="h-9 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors"
          >
            Oyuna Katıl ({!state.players.X ? 'X' : 'O'} Tarafı)
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5 max-w-[280px] mx-auto">
        {state.board.map((cell, idx) => {
          const isWinCell = state.winningLine?.includes(idx);
          const clickable = !cell && !state.winner && (isMyTurn || (!mySide && canJoinSeat));
          return (
            <motion.button
              key={idx}
              type="button"
              whileTap={clickable ? { scale: 0.94 } : undefined}
              disabled={!clickable}
              onClick={() => wsClient.send('voice:game_move', { roomId, cellIndex: idx })}
              className={`aspect-square rounded-xl border text-2xl font-bold font-display flex items-center justify-center transition-colors ${
                isWinCell
                  ? 'border-[#22C55E] bg-[#22C55E]/20 text-[#22C55E]'
                  : cell === 'X'
                  ? 'border-[#A855F7]/50 bg-[#7C3AED]/15 text-[#C084FC]'
                  : cell === 'O'
                  ? 'border-[#38BDF8]/50 bg-[#38BDF8]/15 text-[#38BDF8]'
                  : clickable
                  ? 'border-[#29293D] bg-[#10111B] hover:border-[#A855F7]/60 hover:bg-[#19192A]'
                  : 'border-[#29293D] bg-[#10111B]/60 opacity-80'
              }`}
            >
              {cell}
            </motion.button>
          );
        })}
      </div>

      <p className="text-center text-xs font-medium text-[#A1A1B5]">
        {state.winner === 'draw' ? (
          <span className="text-[#F59E0B] font-bold">Berabere bitti!</span>
        ) : state.winner ? (
          <span className="text-[#22C55E] font-bold inline-flex items-center gap-1.5">
            <Trophy className="w-4 h-4" />
            {state.players[state.winner]?.displayName || state.winner} kazandı!
          </span>
        ) : isMyTurn ? (
          <span className="text-[#C084FC] font-semibold">Hamle sırası sizde ({mySide})</span>
        ) : (
          <span>Sıra {state.players[state.turn]?.displayName || `${state.turn} oyuncusunda`}</span>
        )}
      </p>
    </div>
  );
}

function RpsView({
  state,
  myUserId,
  roomId,
}: {
  state: RpsGameState;
  myUserId?: string;
  roomId: string;
}) {
  const p0 = state.players[0];
  const p1 = state.players[1];
  const amIPlayer = (myUserId && p0?.userId === myUserId) || (myUserId && p1?.userId === myUserId);
  const canPick = !state.revealed && (amIPlayer || !p0 || !p1);
  const myPick = myUserId ? state.picks[myUserId] : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-[#A1A1B5]">
        <span className="font-mono tabular-nums">Tur #{state.round}</span>
        <span>Skor tablosu canlı güncellenir</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        {[p0, p1].map((player, idx) => {
          const pick = player ? state.picks[player.userId] : null;
          const pickMeta = RPS_OPTIONS.find((o) => o.key === pick);
          const showPick = state.revealed || (player?.userId === myUserId && pick);
          return (
            <div key={idx} className="p-3 rounded-xl border border-[#29293D] bg-[#10111B] space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-[#F8FAFC] truncate">
                  {player?.displayName || `Oyuncu ${idx + 1} Bekleniyor`}
                </span>
                {player && (
                  <span className="font-mono font-bold text-[#C084FC] tabular-nums">
                    {state.scores[player.userId] || 0} puan
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#A1A1B5]">
                {!player
                  ? 'Seçim yapınca katılır'
                  : showPick && pickMeta
                  ? `Seçim: ${pickMeta.emoji} ${pickMeta.label}`
                  : pick
                  ? 'Seçimini yaptı (Gizli)'
                  : 'Seçim bekleniyor...'}
              </p>
            </div>
          );
        })}
      </div>

      {canPick && (
        <div className="grid grid-cols-3 gap-2.5">
          {RPS_OPTIONS.map((opt) => {
            const selected = myPick === opt.key;
            return (
              <motion.button
                key={opt.key}
                type="button"
                whileTap={{ scale: 0.95 }}
                onClick={() => wsClient.send('voice:game_move', { roomId, choice: opt.key })}
                className={`py-3.5 px-2 rounded-xl border flex flex-col items-center gap-1.5 text-xs font-semibold transition-colors ${
                  selected
                    ? 'border-[#A855F7] bg-[#7C3AED]/20 text-white'
                    : 'border-[#29293D] bg-[#10111B] hover:border-[#A855F7]/50 text-[#F8FAFC]'
                }`}
              >
                <span className="text-2xl">{opt.emoji}</span>
                <span>{opt.label}</span>
              </motion.button>
            );
          })}
        </div>
      )}

      {state.revealed && (
        <div className="p-3.5 rounded-xl border border-[#22C55E]/35 bg-[#22C55E]/10 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-bold text-[#22C55E]">
            <Trophy className="w-4 h-4 shrink-0" />
            <span>{state.lastResult || 'Tur tamamlandı!'}</span>
          </div>
          <button
            type="button"
            onClick={() => wsClient.send('voice:game_move', { roomId, action: 'next_round' })}
            className="h-8 px-3.5 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-white text-xs font-semibold transition-colors"
          >
            Sonraki Tur →
          </button>
        </div>
      )}
    </div>
  );
}

function DiceDuelView({
  state,
  myUserId,
  roomId,
}: {
  state: DiceDuelGameState;
  myUserId?: string;
  roomId: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => wsClient.send('voice:game_move', { roomId, action: 'roll' })}
          className="h-10 px-5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
        >
          <Dices className="w-4 h-4" />
          Zar At (1–100)
        </button>

        {state.rolls.length > 0 && (
          <button
            type="button"
            onClick={() => wsClient.send('voice:game_move', { roomId, action: 'clear_rolls' })}
            className="h-9 px-3 rounded-xl bg-[#10111B] hover:bg-[#19192A] border border-[#29293D] text-xs text-[#A1A1B5] transition-colors"
          >
            Skorları Temizle
          </button>
        )}
      </div>

      {state.rolls.length === 0 ? (
        <div className="py-8 text-center text-xs text-[#A1A1B5] border border-dashed border-[#29293D] rounded-xl">
          Henüz kimse zar atmadı. İlk zarı sen at!
        </div>
      ) : (
        <div className="space-y-2">
          {state.rolls.map((entry, idx) => (
            <div
              key={entry.userId}
              className={`px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                idx === 0
                  ? 'border-[#22C55E]/40 bg-[#22C55E]/10'
                  : entry.userId === myUserId
                  ? 'border-[#A855F7]/40 bg-[#7C3AED]/10'
                  : 'border-[#29293D] bg-[#10111B]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-5 text-center font-mono font-bold text-[#A1A1B5] tabular-nums">#{idx + 1}</span>
                <span className="font-semibold text-[#F8FAFC] truncate">{entry.displayName}</span>
                <span className="text-[11px] text-[#A1A1B5] hidden sm:inline">· {entry.bonus}</span>
              </div>
              <span className="font-mono text-base font-bold text-[#C084FC] tabular-nums">{entry.roll}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
