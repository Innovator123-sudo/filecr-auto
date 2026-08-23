import express from 'express';
import http from 'http';
import path from 'node:path';
import cors from 'cors';
import { Server } from 'socket.io';
import { RoomManager } from './rooms/RoomManager.js';
import { registerSignaling } from './signaling/relay.js';
import { musicRouter } from './music/routes.js';

const PORT = Number(process.env.PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const allowedOrigins = CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true; // curl / health checks / same-origin
  if (allowedOrigins.includes(origin)) return true;
  if (origin.endsWith('.vercel.app')) return true;
  if (origin.endsWith('.onrender.com')) return true;
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true;
  return false;
}

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) cb(null, origin || true);
    else cb(null, false);
  },
  credentials: true,
}));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, version: '1.0.0', uptime: process.uptime() }));
// If someone opens the SERVER tunnel URL by mistake, send them to the web app instead
// of showing Express's "Cannot GET /"
app.get('/', (_req, res) => {
  const appUrl = (process.env.CLIENT_ORIGIN || '').split(',')[0];
  if (appUrl && !appUrl.includes('localhost')) return res.redirect(302, appUrl);
  res.json({ ok: true, service: 'pushup-pro-game-server', hint: 'This is the API. Open the web app URL from run-tunnel.bat.' });
});
app.get('/rooms/:code', (req, res) => {
  const room = roomManager.getRoom(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ code: room.code, mode: room.mode, phase: room.phase, players: room.players.map(p=>({ nickname:p.nickname, ready:p.ready, repCount:p.repCount })) });
});
app.post('/api/turn-credentials', (_req, res) => {
  // Issue short-lived TURN creds (metered.ca Open Relay uses static creds; this is a placeholder for HMAC mode)
  // For free tier, clients use public STUN + metered.ca static TURN; server just returns config
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:openrelay.metered.ca:80' },
      // Add TURN when env TURN_URL/TURN_USER/TURN_PASS set
      ...(process.env.TURN_URL ? [{ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS }] : []),
    ],
  });
});
app.get('/api/leaderboard', (_req, res) => res.json([])); // Supabase stub

// JioSaavn music (search / song / album / playlist / lyrics / stream proxy)
app.use('/api/music', musicRouter);

// ── Production single-service mode (optional) ──────────────────────────────
// Set STATIC_DIR to a built client folder (client/dist) and this one service
// serves BOTH the web app and the API — same origin, zero CORS, zero baked
// URLs. Local dev is unaffected (STATIC_DIR unset).
const STATIC_DIR = process.env.STATIC_DIR;
if (STATIC_DIR) {
  const staticAbs = path.resolve(STATIC_DIR);
  app.use(express.static(staticAbs));
  // SPA fallback: react-router paths like /bot/arena must serve index.html
  app.get('*', (_req, res) => res.sendFile(path.join(staticAbs, 'index.html')));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin: string | undefined, cb: (err: Error | null, ok: boolean) => void) => cb(null, isAllowedOrigin(origin)),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 20000,
});

const roomManager = new RoomManager(io);

io.on('connection', (socket) => {
  // Rate limit per socket
  let eventCount = 0;
  const windowStart = Date.now();
  const allow = () => {
    eventCount += 1;
    // 30 events/sec cap
    if (eventCount > 60 && Date.now() - windowStart < 1000) return false;
    if (Date.now() - windowStart > 1000) { eventCount = 0; }
    return true;
  };

  socket.on('create_room', (payload, cb) => {
    if (!allow()) return cb?.({ error: 'Rate limited' });
    try {
      const room = roomManager.createRoom(socket.id, payload);
      socket.join(room.code);
      cb?.({ room: roomManager.toClientRoom(room) });
      io.to(room.code).emit('room_state', roomManager.toClientRoom(room));
    } catch (e: any) { cb?.({ error: e.message }); }
  });

  socket.on('join_room', (payload, cb) => {
    if (!allow()) return cb?.({ error: 'Rate limited' });
    const { code, nickname } = payload || {};
    if (!code || !nickname) return cb?.({ error: 'Missing code/nickname' });
    const res = roomManager.joinRoom(socket.id, code, nickname);
    if ('error' in res) return cb?.({ error: res.error });
    socket.join(res.room.code);
    cb?.({ room: roomManager.toClientRoom(res.room) });
    io.to(res.room.code).emit('room_state', roomManager.toClientRoom(res.room));
  });

  socket.on('participant_ready', ({ code }) => {
    if (!allow()) return;
    const room = roomManager.setReady(socket.id, code);
    if (room) io.to(room.code).emit('room_state', roomManager.toClientRoom(room));
  });

  socket.on('rep_scored', (payload) => {
    if (!allow()) return;
    const { code, repCount, formScore, ts } = payload || {};
    const result = roomManager.scoreRep(socket.id, code, repCount, formScore, ts);
    if (!result) return;
    if ('flag' in result && result.flag) {
      io.to(code).emit('cheat_flag', result);
    }
    const room = roomManager.getRoom(code);
    if (room) {
      io.to(code).emit('room_state', roomManager.toClientRoom(room));
      socket.to(code).emit('opponent_rep', { repCount, formScore });
    }
  });

  socket.on('landmarks', ({ code, landmarks }) => {
    // P2P ghost is primary; server relay as fallback throttled
    if (!allow()) return;
    socket.to(code).emit('opponent_landmarks', landmarks);
  });

  socket.on('forfeit', ({ code }) => {
    const room = roomManager.forfeit(socket.id, code);
    if (room) io.to(room.code).emit('room_state', roomManager.toClientRoom(room));
  });

  // WebRTC signaling relay
  registerSignaling(socket, io);

  socket.on('disconnect', () => {
    const affected = roomManager.handleDisconnect(socket.id);
    for (const r of affected) io.to(r.code).emit('room_state', roomManager.toClientRoom(r));
  });
});

server.listen(PORT, () => console.log(`[server] listening on :${PORT}, CORS origin=${CLIENT_ORIGIN}`));
