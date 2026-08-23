import { nanoid } from 'nanoid';
import type { Server } from 'socket.io';

export type RoomMode = 'target' | 'timer' | 'free';
export type RoomPhase = 'lobby' | 'countdown' | 'live' | 'finished';

export interface Player {
  id: string;
  nickname: string;
  ready: boolean;
  repCount: number;
  repLog: { rep: number; ts: number; formScore: number }[];
  connected: boolean;
}

export interface Room {
  code: string;
  mode: RoomMode;
  targetReps?: number;
  timerSec?: number;
  phase: RoomPhase;
  players: Player[];
  countdownAt?: number;
  winner?: string;
  createdAt: number;
  expiresAt: number;
  timerHandle?: NodeJS.Timeout;
  countdownHandle?: NodeJS.Timeout;
}

function genCode(): string {
  // 6-char, PUSH-XXXX style collision-safe
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'PUSH-';
  for (let i=0;i<4;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private socketToCode = new Map<string, string>();

  constructor(private io: Server) {
    // expiry sweep every 60s — rooms live 10 min after creation, longer if live
    setInterval(() => this.sweep(), 60_000);
  }

  createRoom(socketId: string, opts: { nickname: string; mode: string; targetReps?: number; timerSec?: number }): Room {
    let code = genCode();
    while (this.rooms.has(code)) code = genCode();
    const mode = (['target','timer','free'].includes(opts.mode) ? opts.mode : 'target') as RoomMode;
    const room: Room = {
      code,
      mode,
      targetReps: mode==='target' ? Math.max(10, Math.min(500, Number(opts.targetReps)||50)) : undefined,
      timerSec: mode==='timer' ? Math.max(30, Math.min(1800, Number(opts.timerSec)||120)) : undefined,
      phase: 'lobby',
      players: [{ id: socketId, nickname: String(opts.nickname).slice(0,20), ready: false, repCount: 0, repLog: [], connected: true }],
      createdAt: Date.now(),
      expiresAt: Date.now() + 10*60*1000,
    };
    this.rooms.set(code, room);
    this.socketToCode.set(socketId, code);
    return room;
  }

  joinRoom(socketId: string, code: string, nickname: string): { room: Room } | { error: string } {
    const c = code.toUpperCase();
    const room = this.rooms.get(c);
    if (!room) return { error: 'Room not found' };
    if (room.players.length >= 2 && !room.players.some(p=>p.id===socketId)) return { error: 'Room full (max 2 players)' };
    if (room.phase === 'finished') return { error: 'Match already finished' };
    const existing = room.players.find(p=>p.id===socketId);
    if (existing) {
      existing.connected = true;
      existing.nickname = nickname.slice(0,20);
      this.socketToCode.set(socketId, c);
      return { room };
    }
    // rejoin by nickname if disconnected
    const ghost = room.players.find(p=>p.nickname===nickname && !p.connected);
    if (ghost) {
      ghost.id = socketId;
      ghost.connected = true;
      this.socketToCode.set(socketId, c);
      return { room };
    }
    if (room.players.length < 2) {
      room.players.push({ id: socketId, nickname: nickname.slice(0,20), ready: false, repCount: 0, repLog: [], connected: true });
      this.socketToCode.set(socketId, c);
      return { room };
    }
    return { error: 'Room full' };
  }

  setReady(socketId: string, code: string): Room | null {
    const room = this.rooms.get(code?.toUpperCase());
    if (!room) return null;
    const p = room.players.find(x=>x.id===socketId);
    if (!p) return null;
    p.ready = true;
    // both ready → synchronized countdown (server timestamps, spec §7.3)
    if (room.players.length===2 && room.players.every(x=>x.ready) && room.phase==='lobby') {
      room.phase = 'countdown';
      room.countdownAt = Date.now() + 3500; // 3-2-1-GO
      // auto-transition to live after countdown
      if (room.countdownHandle) clearTimeout(room.countdownHandle);
      const delay = room.countdownAt - Date.now();
      room.countdownHandle = setTimeout(() => {
        room.phase = 'live';
        room.expiresAt = Date.now() + 60*60*1000; // extend while live
        this.io.to(room.code).emit('room_state', this.toClientRoom(room));
        // timer mode: schedule finish
        if (room.mode==='timer' && room.timerSec) {
          if (room.timerHandle) clearTimeout(room.timerHandle);
          room.timerHandle = setTimeout(() => this.finishByTimer(room.code), room.timerSec! * 1000);
        }
      }, Math.max(0, delay));
    }
    return room;
  }

  // Anti-cheat: ≥600 ms between reps, sustained >2.5 rps over 5 reps flagged (spec §7.4)
  scoreRep(socketId: string, code: string, repCount: number, formScore: number, clientTs: number):
    { ok: true } | { ok: false; flag: string } | null {
    const room = this.rooms.get(code?.toUpperCase());
    if (!room || room.phase!=='live') return null;
    const p = room.players.find(x=>x.id===socketId);
    if (!p) return null;
    const now = Date.now();
    const last = p.repLog[p.repLog.length-1];
    if (last && now - last.ts < 600) {
      return { ok: false, flag: 'rejected: <600ms gap' };
    }
    // monotonic rep check
    if (repCount !== p.repCount + 1 && repCount !== p.repCount) {
      // allow late events with server timestamp ordering — accept if greater
      if (repCount <= p.repCount) return { ok: false, flag: 'duplicate/old rep' };
    }
    p.repLog.push({ rep: repCount, ts: now, formScore: Number(formScore)||0 });
    p.repCount = Math.max(p.repCount, repCount);

    // sustained pace check: last 5 reps
    if (p.repLog.length >= 5) {
      const window = p.repLog.slice(-5);
      const span = window[window.length-1].ts - window[0].ts;
      const rps = 4 / Math.max(0.001, span/1000); // 4 intervals over 5 reps
      if (rps > 2.5) return { ok: true, flag: `unrealistic pace: ${rps.toFixed(2)} rps` } as any;
    }

    // win by target
    if (room.mode==='target' && room.targetReps && p.repCount >= room.targetReps) {
      room.phase = 'finished';
      room.winner = p.nickname;
      if (room.timerHandle) clearTimeout(room.timerHandle);
    }
    return { ok: true };
  }

  private finishByTimer(code: string) {
    const room = this.rooms.get(code);
    if (!room || room.phase!=='live') return;
    room.phase = 'finished';
    if (room.players.length===2) {
      const [a,b] = room.players;
      room.winner = a.repCount===b.repCount ? 'Tie' : a.repCount>b.repCount ? a.nickname : b.nickname;
    } else if (room.players[0]) room.winner = room.players[0].nickname;
    this.io.to(room.code).emit('match_end', this.toClientRoom(room));
    this.io.to(room.code).emit('room_state', this.toClientRoom(room));
  }

  forfeit(socketId: string, code: string): Room | null {
    const room = this.rooms.get(code?.toUpperCase());
    if (!room) return null;
    room.phase = 'finished';
    const winner = room.players.find(p=>p.id!==socketId)?.nickname || '—';
    room.winner = winner;
    return room;
  }

  handleDisconnect(socketId: string): Room[] {
    const code = this.socketToCode.get(socketId);
    if (!code) return [];
    const room = this.rooms.get(code);
    if (!room) return [];
    const p = room.players.find(x=>x.id===socketId);
    if (p) p.connected = false;
    // keep room for 60s reconnect window; if both disconnected for 60s, expire sooner
    room.expiresAt = Date.now() + 60*1000;
    this.socketToCode.delete(socketId);
    return [room];
  }

  getRoom(code: string): Room | undefined { return this.rooms.get(code?.toUpperCase()); }

  toClientRoom(room: Room) {
    return {
      code: room.code,
      mode: room.mode,
      targetReps: room.targetReps,
      timerSec: room.timerSec,
      phase: room.phase,
      players: room.players.map(p=>({ id:p.id, nickname:p.nickname, ready:p.ready, repCount:p.repCount, connected:p.connected })),
      countdownAt: room.countdownAt,
      winner: room.winner,
    };
  }

  private sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now > room.expiresAt && room.phase!=='live') {
        if (room.countdownHandle) clearTimeout(room.countdownHandle);
        if (room.timerHandle) clearTimeout(room.timerHandle);
        this.rooms.delete(code);
      }
    }
  }
}
