import crypto from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import type Database from 'better-sqlite3';
import { WebSocketServer, WebSocket } from 'ws';
import { getProfileByUserId, getUserIdBySessionToken, parseCookies } from './auth.ts';
import { canViewChannel, hasServerPermission, isServerMember } from './permissions.ts';
import type {
  DiceDuelGameState,
  RpsChoice,
  RpsGameState,
  TicTacToeGameState,
  VoiceGameState,
  VoiceGameType,
} from '../shared/types.ts';

const TTT_WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function createInitialGameState(
  roomId: string,
  gameType: VoiceGameType,
  userId: string,
  displayName: string
): VoiceGameState {
  const now = new Date().toISOString();
  if (gameType === 'tic_tac_toe') {
    return {
      roomId,
      gameType: 'tic_tac_toe',
      board: Array(9).fill(null),
      turn: 'X',
      players: { X: { userId, displayName }, O: null },
      winner: null,
      winningLine: null,
      updatedAt: now,
    };
  }
  if (gameType === 'rps') {
    return {
      roomId,
      gameType: 'rps',
      round: 1,
      players: [{ userId, displayName }, null],
      picks: {},
      scores: { [userId]: 0 },
      lastResult: null,
      revealed: false,
      updatedAt: now,
    };
  }
  return {
    roomId,
    gameType: 'dice_duel',
    rolls: [],
    winnerName: null,
    updatedAt: now,
  };
}

interface ClientSocket extends WebSocket {
  userId?: string;
  rooms: Set<string>;
  isAlive: boolean;
}

export class OrbitRealtimeHub {
  private wss: WebSocketServer;
  private userSockets = new Map<string, Set<ClientSocket>>();
  private roomSockets = new Map<string, Set<ClientSocket>>();
  private db: Database.Database;
  private heartbeatInterval: NodeJS.Timeout;
  private isClosing = false;

  constructor(httpServer: HttpServer, db: Database.Database) {
    this.db = db;
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req) => {
      const client = ws as ClientSocket;
      client.rooms = new Set();
      client.isAlive = true;

      const url = new URL(req.url || '/ws', 'http://localhost');
      const queryToken = url.searchParams.get('token');
      const cookies = parseCookies(req.headers.cookie);
      const token = queryToken || cookies['orbit_session'] || null;

      if (!token) {
        client.close(4001, 'Oturum gerekli');
        return;
      }

      const userId = getUserIdBySessionToken(this.db, token);
      if (!userId) {
        client.close(4001, 'Geçersiz oturum');
        return;
      }

      client.userId = userId;
      this.registerUserSocket(userId, client);

      // Update last_seen_at in DB
      this.db.prepare(`UPDATE profiles SET last_seen_at = datetime('now') WHERE user_id = ?`).run(userId);

      // Auto-subscribe to personal room and joined servers
      this.joinRoom(client, `user:${userId}`);
      const serverRows = this.db
        .prepare(`SELECT server_id FROM server_members WHERE user_id = ?`)
        .all(userId) as { server_id: string }[];
      for (const s of serverRows) {
        this.joinRoom(client, `server:${s.server_id}`);
      }

      this.broadcastPresence(userId);

      client.on('pong', () => {
        client.isAlive = true;
      });

      client.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as { type: string; payload?: Record<string, unknown> };
          this.handleClientMessage(client, msg);
        } catch {
          // Ignore malformed WS payloads
        }
      });

      client.on('close', () => {
        this.unregisterClient(client);
      });
    });

    this.heartbeatInterval = setInterval(() => {
      for (const ws of this.wss.clients) {
        const client = ws as ClientSocket;
        if (!client.isAlive) {
          client.terminate();
          continue;
        }
        client.isAlive = false;
        client.ping();
      }
    }, 25000);
  }

  public isUserOnline = (userId: string): boolean => {
    const sockets = this.userSockets.get(userId);
    return Boolean(sockets && sockets.size > 0);
  };

  public close(): void {
    this.isClosing = true;
    clearInterval(this.heartbeatInterval);
    for (const sock of this.wss.clients) {
      sock.terminate();
    }
    this.wss.close();
  }

  private registerUserSocket(userId: string, client: ClientSocket): void {
    let set = this.userSockets.get(userId);
    if (!set) {
      set = new Set();
      this.userSockets.set(userId, set);
    }
    set.add(client);
  }

  private unregisterClient(client: ClientSocket): void {
    for (const room of client.rooms) {
      const set = this.roomSockets.get(room);
      if (set) {
        set.delete(client);
        if (set.size === 0) {
          this.roomSockets.delete(room);
        }
      }
    }
    client.rooms.clear();

    if (client.userId) {
      const set = this.userSockets.get(client.userId);
      if (set) {
        set.delete(client);
        if (set.size === 0) {
          this.userSockets.delete(client.userId);
          if (!this.isClosing) {
            // Clean up any dangling voice sessions for disconnected user
            const voiceRow = this.db
              .prepare(`SELECT channel_id FROM voice_sessions WHERE user_id = ?`)
              .get(client.userId) as { channel_id: string } | undefined;
            if (voiceRow) {
              this.db.prepare(`DELETE FROM voice_sessions WHERE user_id = ?`).run(client.userId);
              this.broadcastVoiceParticipants(voiceRow.channel_id);
            }
            this.db
              .prepare(`UPDATE profiles SET last_seen_at = datetime('now') WHERE user_id = ?`)
              .run(client.userId);
            this.broadcastPresence(client.userId);
          }
        }
      }
    }
  }

  private joinRoom(client: ClientSocket, room: string): void {
    if (client.rooms.has(room)) return;
    client.rooms.add(room);
    let set = this.roomSockets.get(room);
    if (!set) {
      set = new Set();
      this.roomSockets.set(room, set);
    }
    set.add(client);
  }

  private leaveRoom(client: ClientSocket, room: string): void {
    client.rooms.delete(room);
    const set = this.roomSockets.get(room);
    if (set) {
      set.delete(client);
      if (set.size === 0) {
        this.roomSockets.delete(room);
      }
    }
  }

  private handleClientMessage(client: ClientSocket, msg: { type: string; payload?: Record<string, unknown> }): void {
    const userId = client.userId;
    if (!userId) return;
    const payload = msg.payload || {};

    switch (msg.type) {
      case 'room:subscribe': {
        const room = String(payload.room || '');
        if (!room) return;
        if (room.startsWith('channel:')) {
          const channelId = room.slice(8);
          if (canViewChannel(this.db, channelId, userId)) {
            this.joinRoom(client, room);
          }
        } else if (room.startsWith('dm:')) {
          const convId = room.slice(3);
          const isMember = this.db
            .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
            .get(convId, userId);
          if (isMember) {
            this.joinRoom(client, room);
          }
        } else if (room.startsWith('server:')) {
          const serverId = room.slice(7);
          if (isServerMember(this.db, serverId, userId)) {
            this.joinRoom(client, room);
          }
        } else if (room.startsWith('voice:')) {
          const roomId = room.slice(6);
          const canChannel = canViewChannel(this.db, roomId, userId);
          const isDmMember = Boolean(
            this.db
              .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
              .get(roomId, userId)
          );
          if (canChannel || isDmMember) {
            this.joinRoom(client, room);
          }
        }
        break;
      }

      case 'room:unsubscribe': {
        const room = String(payload.room || '');
        if (room) this.leaveRoom(client, room);
        break;
      }

      case 'typing:start':
      case 'typing:stop': {
        const targetType = payload.targetType === 'dm' ? 'dm' : 'channel';
        const targetId = String(payload.targetId || '');
        if (!targetId) return;
        const room = `${targetType}:${targetId}`;
        if (!client.rooms.has(room)) return;
        const profile = getProfileByUserId(this.db, userId, this.isUserOnline);
        if (!profile) return;
        this.sendToRoom(
          room,
          {
            type: msg.type,
            payload: {
              targetType,
              targetId,
              userId,
              displayName: profile.displayName,
            },
          },
          client
        );
        break;
      }

      case 'voice:speaking': {
        const channelId = String(payload.channelId || '');
        const speaking = Boolean(payload.speaking);
        if (!channelId) return;
        const canChannel = canViewChannel(this.db, channelId, userId);
        const isDmMember = Boolean(
          this.db
            .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
            .get(channelId, userId)
        );
        if (!canChannel && !isDmMember) return;
        this.sendToRoom(`voice:${channelId}`, {
          type: 'voice:speaking',
          payload: { channelId, userId, speaking },
        });
        break;
      }

      case 'voice:reaction': {
        const channelId = String(payload.channelId || '');
        const emoji = String(payload.emoji || '').trim().slice(0, 12);
        if (!channelId || !emoji) return;
        const canChannel = canViewChannel(this.db, channelId, userId);
        const isDmMember = Boolean(
          this.db
            .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
            .get(channelId, userId)
        );
        if (!canChannel && !isDmMember) return;
        const sender = getProfileByUserId(this.db, userId, this.isUserOnline);
        this.sendToRoom(`voice:${channelId}`, {
          type: 'voice:reaction',
          payload: {
            channelId,
            userId,
            displayName: sender?.displayName || 'Üye',
            emoji,
          },
        });
        break;
      }

      case 'voice:hand_raise': {
        const channelId = String(payload.channelId || '');
        const raised = Boolean(payload.raised);
        if (!channelId || !canViewChannel(this.db, channelId, userId)) return;
        this.db
          .prepare(`UPDATE voice_sessions SET hand_raised = ? WHERE channel_id = ? AND user_id = ?`)
          .run(raised ? 1 : 0, channelId, userId);
        this.broadcastVoiceParticipants(channelId);
        break;
      }

      case 'voice:set_speaker': {
        const channelId = String(payload.channelId || '');
        const targetUserId = String(payload.targetUserId || '');
        const isSpeaker = Boolean(payload.isSpeaker);
        if (!channelId || !targetUserId) return;
        const ch = this.db.prepare(`SELECT server_id FROM channels WHERE id = ?`).get(channelId) as
          | { server_id: string }
          | undefined;
        if (!ch) return;
        const allowed =
          targetUserId === userId
            ? !isSpeaker // anyone can step down to listener
            : hasServerPermission(this.db, ch.server_id, userId, 'MUTE_MEMBERS');
        if (!allowed) return;
        this.db
          .prepare(
            `UPDATE voice_sessions
             SET is_speaker = ?, hand_raised = 0, muted = CASE WHEN ? = 0 THEN 1 ELSE muted END
             WHERE channel_id = ? AND user_id = ?`
          )
          .run(isSpeaker ? 1 : 0, isSpeaker ? 1 : 0, channelId, targetUserId);
        this.broadcastVoiceParticipants(channelId);
        break;
      }

      case 'voice:soundboard': {
        const channelId = String(payload.channelId || '');
        const effect = String(payload.effect || '').trim().slice(0, 24);
        if (!channelId || !effect) return;
        const canChannel = canViewChannel(this.db, channelId, userId);
        const isDmMember = Boolean(
          this.db
            .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
            .get(channelId, userId)
        );
        if (!canChannel && !isDmMember) return;
        const sender = getProfileByUserId(this.db, userId, this.isUserOnline);
        this.sendToRoom(`voice:${channelId}`, {
          type: 'voice:soundboard',
          payload: { channelId, userId, displayName: sender?.displayName || 'Üye', effect },
        });
        break;
      }

      case 'voice:whiteboard_stroke': {
        const roomId = String(payload.roomId || '');
        const color = String(payload.color || '#6366F1').slice(0, 16);
        const size = Math.max(1, Math.min(24, Number(payload.size || 3)));
        const points = Array.isArray(payload.points) ? payload.points.slice(0, 500) : [];
        if (!roomId || points.length < 2) return;
        const canChannel = canViewChannel(this.db, roomId, userId);
        const isDmMember = Boolean(
          this.db
            .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
            .get(roomId, userId)
        );
        if (!canChannel && !isDmMember) return;
        const id = crypto.randomUUID();
        this.db
          .prepare(
            `INSERT INTO voice_whiteboard_strokes (id, room_id, user_id, color, size, points_json)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(id, roomId, userId, color, size, JSON.stringify(points));
        this.sendToRoom(`voice:${roomId}`, {
          type: 'voice:whiteboard_stroke',
          payload: { id, roomId, userId, color, size, points },
        });
        break;
      }

      case 'voice:whiteboard_clear': {
        const roomId = String(payload.roomId || '');
        if (!roomId) return;
        const canChannel = canViewChannel(this.db, roomId, userId);
        const isDmMember = Boolean(
          this.db
            .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
            .get(roomId, userId)
        );
        if (!canChannel && !isDmMember) return;
        this.db.prepare(`DELETE FROM voice_whiteboard_strokes WHERE room_id = ?`).run(roomId);
        this.sendToRoom(`voice:${roomId}`, {
          type: 'voice:whiteboard_clear',
          payload: { roomId, userId },
        });
        break;
      }

      case 'voice:pomodoro': {
        const roomId = String(payload.roomId || '');
        const phase = payload.phase === 'break' ? 'break' : 'focus';
        const durationSeconds = Math.max(60, Math.min(3600, Number(payload.durationSeconds || 1500)));
        const remainingSeconds = Math.max(0, Math.min(3600, Number(payload.remainingSeconds ?? durationSeconds)));
        const running = Boolean(payload.running);
        if (!roomId) return;
        const canChannel = canViewChannel(this.db, roomId, userId);
        const isDmMember = Boolean(
          this.db
            .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
            .get(roomId, userId)
        );
        if (!canChannel && !isDmMember) return;
        const updatedAt = new Date().toISOString();
        this.db
          .prepare(
            `INSERT INTO voice_pomodoro_state (room_id, phase, duration_seconds, remaining_seconds, running, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(room_id) DO UPDATE SET phase = ?, duration_seconds = ?, remaining_seconds = ?, running = ?, updated_at = ?`
          )
          .run(
            roomId,
            phase,
            durationSeconds,
            remainingSeconds,
            running ? 1 : 0,
            updatedAt,
            phase,
            durationSeconds,
            remainingSeconds,
            running ? 1 : 0,
            updatedAt
          );
        this.sendToRoom(`voice:${roomId}`, {
          type: 'voice:pomodoro',
          payload: { roomId, phase, durationSeconds, remainingSeconds, running, updatedAt },
        });
        break;
      }

      case 'voice:signal': {
        // Relay WebRTC SDP offer/answer or ICE candidate ONLY between authorized members of the same room
        const targetUserId = String(payload.targetUserId || '');
        const roomKey = String(payload.roomKey || '');
        if (!targetUserId || !roomKey || targetUserId === userId) return;

        let authorized = false;
        if (roomKey.startsWith('channel:')) {
          const chId = roomKey.slice(8);
          authorized = canViewChannel(this.db, chId, userId) && canViewChannel(this.db, chId, targetUserId);
        } else if (roomKey.startsWith('dm_call:')) {
          const convId = roomKey.slice(8);
          const senderInConv = this.db
            .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
            .get(convId, userId);
          const targetInConv = this.db
            .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
            .get(convId, targetUserId);
          authorized = Boolean(senderInConv && targetInConv);
        }
        if (!authorized) return;

        this.sendToUser(targetUserId, {
          type: 'voice:signal',
          payload: {
            fromUserId: userId,
            roomKey,
            signal: payload.signal,
          },
        });
        break;
      }

      case 'voice:game_start':
      case 'voice:game_reset': {
        const roomId = String(payload.roomId || '');
        const gameTypeRaw = String(payload.gameType || 'tic_tac_toe');
        const gameType: VoiceGameType =
          gameTypeRaw === 'rps' || gameTypeRaw === 'dice_duel' ? gameTypeRaw : 'tic_tac_toe';
        if (!roomId || !this.canAccessVoiceRoom(roomId, userId)) return;
        const sender = getProfileByUserId(this.db, userId, this.isUserOnline);
        const state = createInitialGameState(roomId, gameType, userId, sender?.displayName || 'Üye');
        this.saveAndBroadcastVoiceGame(roomId, state);
        break;
      }

      case 'voice:game_close': {
        const roomId = String(payload.roomId || '');
        if (!roomId || !this.canAccessVoiceRoom(roomId, userId)) return;
        this.db.prepare(`DELETE FROM voice_room_games WHERE room_id = ?`).run(roomId);
        this.sendToRoom(`voice:${roomId}`, {
          type: 'voice:game_state',
          payload: { roomId, gameState: null },
        });
        break;
      }

      case 'voice:game_move': {
        const roomId = String(payload.roomId || '');
        if (!roomId || !this.canAccessVoiceRoom(roomId, userId)) return;
        const row = this.db
          .prepare(`SELECT state_json FROM voice_room_games WHERE room_id = ?`)
          .get(roomId) as { state_json: string } | undefined;
        if (!row) return;
        let state: VoiceGameState;
        try {
          state = JSON.parse(row.state_json) as VoiceGameState;
        } catch {
          return;
        }
        const sender = getProfileByUserId(this.db, userId, this.isUserOnline);
        const displayName = sender?.displayName || 'Üye';
        const now = new Date().toISOString();

        if (state.gameType === 'tic_tac_toe') {
          const ttt = state as TicTacToeGameState;
          if (payload.action === 'join_side') {
            if (!ttt.players.X) {
              ttt.players.X = { userId, displayName };
            } else if (!ttt.players.O && ttt.players.X.userId !== userId) {
              ttt.players.O = { userId, displayName };
            }
            ttt.updatedAt = now;
            this.saveAndBroadcastVoiceGame(roomId, ttt);
            return;
          }
          const cellIndex = Number(payload.cellIndex);
          if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 8 || ttt.winner) return;
          if (ttt.board[cellIndex] !== null) return;
          // Auto-seat player O if empty and another player moves on O's turn
          if (!ttt.players.X) {
            ttt.players.X = { userId, displayName };
          } else if (!ttt.players.O && ttt.players.X.userId !== userId) {
            ttt.players.O = { userId, displayName };
          }
          const expectedPlayer = ttt.players[ttt.turn];
          if (!expectedPlayer || expectedPlayer.userId !== userId) return;

          ttt.board[cellIndex] = ttt.turn;
          let winLine: number[] | null = null;
          for (const line of TTT_WIN_LINES) {
            const [a, b, c] = line;
            if (ttt.board[a] && ttt.board[a] === ttt.board[b] && ttt.board[a] === ttt.board[c]) {
              winLine = line;
              break;
            }
          }
          if (winLine) {
            ttt.winner = ttt.turn;
            ttt.winningLine = winLine;
          } else if (ttt.board.every((cell) => cell !== null)) {
            ttt.winner = 'draw';
          } else {
            ttt.turn = ttt.turn === 'X' ? 'O' : 'X';
          }
          ttt.updatedAt = now;
          this.saveAndBroadcastVoiceGame(roomId, ttt);
        } else if (state.gameType === 'rps') {
          const rps = state as RpsGameState;
          if (payload.action === 'next_round') {
            rps.round += 1;
            rps.picks = {};
            rps.revealed = false;
            rps.lastResult = null;
            rps.updatedAt = now;
            this.saveAndBroadcastVoiceGame(roomId, rps);
            return;
          }
          const choice = String(payload.choice || '') as RpsChoice;
          if (!['rock', 'paper', 'scissors'].includes(choice)) return;
          if (!rps.players[0]) {
            rps.players[0] = { userId, displayName };
            rps.scores[userId] = rps.scores[userId] || 0;
          } else if (!rps.players[1] && rps.players[0].userId !== userId) {
            rps.players[1] = { userId, displayName };
            rps.scores[userId] = rps.scores[userId] || 0;
          }
          const p0 = rps.players[0];
          const p1 = rps.players[1];
          if (!p0 || (p0.userId !== userId && p1?.userId !== userId)) return;
          if (rps.revealed) return;
          rps.picks[userId] = choice;

          if (p0 && p1 && rps.picks[p0.userId] && rps.picks[p1.userId]) {
            const c0 = rps.picks[p0.userId]!;
            const c1 = rps.picks[p1.userId]!;
            rps.revealed = true;
            if (c0 === c1) {
              rps.lastResult = 'Berabere!';
            } else if (
              (c0 === 'rock' && c1 === 'scissors') ||
              (c0 === 'paper' && c1 === 'rock') ||
              (c0 === 'scissors' && c1 === 'paper')
            ) {
              rps.scores[p0.userId] = (rps.scores[p0.userId] || 0) + 1;
              rps.lastResult = `${p0.displayName} kazandı!`;
            } else {
              rps.scores[p1.userId] = (rps.scores[p1.userId] || 0) + 1;
              rps.lastResult = `${p1.displayName} kazandı!`;
            }
          }
          rps.updatedAt = now;
          this.saveAndBroadcastVoiceGame(roomId, rps);
        } else if (state.gameType === 'dice_duel') {
          const dice = state as DiceDuelGameState;
          if (payload.action === 'clear_rolls') {
            dice.rolls = [];
            dice.winnerName = null;
            dice.updatedAt = now;
            this.saveAndBroadcastVoiceGame(roomId, dice);
            return;
          }
          const roll = crypto.randomInt(1, 101);
          const bonus =
            roll >= 95
              ? 'Efsanevi Atış!'
              : roll >= 80
              ? 'Kritik Şans'
              : roll <= 15
              ? 'Kozmik Şanssızlık'
              : 'Temiz Atış';
          const filtered = dice.rolls.filter((r) => r.userId !== userId);
          filtered.push({ userId, displayName, roll, bonus });
          filtered.sort((a, b) => b.roll - a.roll);
          dice.rolls = filtered.slice(0, 12);
          dice.winnerName = dice.rolls[0]?.displayName || null;
          dice.updatedAt = now;
          this.saveAndBroadcastVoiceGame(roomId, dice);
        }
        break;
      }

      case 'call:invite':
      case 'call:accept':
      case 'call:reject':
      case 'call:end': {
        const targetUserId = String(payload.targetUserId || '');
        const conversationId = String(payload.conversationId || '');
        if (!targetUserId || !conversationId) return;
        const member = this.db
          .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
          .get(conversationId, userId);
        if (!member) return;
        const caller = getProfileByUserId(this.db, userId, this.isUserOnline);
        this.sendToUser(targetUserId, {
          type: msg.type,
          payload: {
            conversationId,
            fromUserId: userId,
            fromProfile: caller,
            withVideo: Boolean(payload.withVideo),
          },
        });
        break;
      }
    }
  }

  private canAccessVoiceRoom(roomId: string, userId: string): boolean {
    if (canViewChannel(this.db, roomId, userId)) return true;
    return Boolean(
      this.db
        .prepare(`SELECT 1 FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?`)
        .get(roomId, userId)
    );
  }

  private saveAndBroadcastVoiceGame(roomId: string, gameState: VoiceGameState): void {
    this.db
      .prepare(
        `INSERT INTO voice_room_games (room_id, game_type, state_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(room_id) DO UPDATE SET game_type = ?, state_json = ?, updated_at = ?`
      )
      .run(
        roomId,
        gameState.gameType,
        JSON.stringify(gameState),
        gameState.updatedAt,
        gameState.gameType,
        JSON.stringify(gameState),
        gameState.updatedAt
      );

    this.sendToRoom(`voice:${roomId}`, {
      type: 'voice:game_state',
      payload: { roomId, gameState },
    });
  }

  public sendToUser(userId: string, event: { type: string; payload: unknown }): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    const raw = JSON.stringify(event);
    for (const sock of sockets) {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send(raw);
      }
    }
  }

  public sendToRoom(room: string, event: { type: string; payload: unknown }, exclude?: ClientSocket): void {
    const sockets = this.roomSockets.get(room);
    if (!sockets) return;
    const raw = JSON.stringify(event);
    for (const sock of sockets) {
      if (sock !== exclude && sock.readyState === WebSocket.OPEN) {
        sock.send(raw);
      }
    }
  }

  public broadcastPresence(userId: string): void {
    const profile = getProfileByUserId(this.db, userId, this.isUserOnline);
    if (!profile) return;

    const presencePayload = {
      userId,
      status: profile.status,
      isOnline: profile.isOnline,
      customStatus: profile.customStatus,
      displayName: profile.displayName,
      username: profile.username,
      discriminator: profile.discriminator,
      avatarUrl: profile.avatarUrl,
      bannerUrl: profile.bannerUrl || null,
      bannerColor: profile.bannerColor,
      bannerPreset: profile.bannerPreset || 'none',
      avatarFrame: profile.avatarFrame,
      profileEffect: profile.profileEffect,
      nitroTier: profile.nitroTier,
      xp: profile.xp,
      level: profile.level,
      streak: profile.streak,
      activityType: profile.activityType,
      activityText: profile.activityText,
      featuredBadge: profile.featuredBadge,
      badges: profile.badges,
    };

    const servers = this.db
      .prepare(`SELECT server_id FROM server_members WHERE user_id = ?`)
      .all(userId) as { server_id: string }[];
    for (const s of servers) {
      this.sendToRoom(`server:${s.server_id}`, {
        type: 'presence:update',
        payload: presencePayload,
      });
    }

    const friends = this.db
      .prepare(
        `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END as peer_id
         FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`
      )
      .all(userId, userId, userId) as { peer_id: string }[];
    for (const f of friends) {
      this.sendToUser(f.peer_id, {
        type: 'presence:update',
        payload: presencePayload,
      });
    }
    this.sendToUser(userId, {
      type: 'presence:update',
      payload: presencePayload,
    });
  }

  public getVoiceParticipants(channelId: string) {
    const rows = this.db
      .prepare(`SELECT * FROM voice_sessions WHERE channel_id = ? ORDER BY joined_at ASC`)
      .all(channelId) as Array<{
      user_id: string;
      channel_id: string;
      muted: number;
      deafened: number;
      server_muted: number;
      video_enabled: number;
      screen_sharing: number;
      hand_raised?: number;
      is_speaker?: number;
      joined_at: string;
    }>;

    return rows
      .map((r) => {
        const profile = getProfileByUserId(this.db, r.user_id, this.isUserOnline);
        if (!profile) return null;
        return {
          userId: r.user_id,
          channelId: r.channel_id,
          profile,
          muted: r.muted === 1,
          deafened: r.deafened === 1,
          serverMuted: r.server_muted === 1,
          videoEnabled: r.video_enabled === 1,
          screenSharing: r.screen_sharing === 1,
          handRaised: r.hand_raised === 1,
          isSpeaker: r.is_speaker !== 0,
          speaking: false,
          joinedAt: r.joined_at,
        };
      })
      .filter(Boolean);
  }

  public broadcastVoiceParticipants(channelId: string): void {
    const channel = this.db
      .prepare(`SELECT server_id FROM channels WHERE id = ?`)
      .get(channelId) as { server_id: string } | undefined;
    if (!channel) return;

    const participants = this.getVoiceParticipants(channelId);

    this.sendToRoom(`server:${channel.server_id}`, {
      type: 'voice:participants',
      payload: { channelId, participants },
    });
    this.sendToRoom(`voice:${channelId}`, {
      type: 'voice:participants',
      payload: { channelId, participants },
    });
  }
}
