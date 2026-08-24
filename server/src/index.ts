import http from 'http';
import { Server } from 'socket.io';
import { app, isAllowedOrigin } from './app.js';
import { RoomManager } from './rooms/RoomManager.js';
import { registerSignaling } from './signaling/relay.js';

const PORT = Number(process.env.PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

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

// extra health for rooms
app.get('/rooms/:code', (req, res) => {
  const room = roomManager.getRoom(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ code: room.code, mode: room.mode, phase: room.phase, players: room.players.map(p=>({ nickname:p.nickname, ready:p.ready, repCount:p.repCount })) });
});

io.on('connection', (socket) => {
  let eventCount = 0;
  const windowStart = Date.now();
  const allow = () => {
    eventCount += 1;
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
    if (!allow()) return;
    socket.to(code).emit('opponent_landmarks', landmarks);
  });

  socket.on('forfeit', ({ code }) => {
    const room = roomManager.forfeit(socket.id, code);
    if (room) io.to(room.code).emit('room_state', roomManager.toClientRoom(room));
  });

  registerSignaling(socket, io);

  socket.on('disconnect', () => {
    const affected = roomManager.handleDisconnect(socket.id);
    for (const r of affected) io.to(r.code).emit('room_state', roomManager.toClientRoom(r));
  });
});

// Do not listen when running as Vercel serverless function
if (!process.env.VERCEL) {
  server.listen(PORT, () => console.log(`[server] listening on :${PORT}, CORS origin=${CLIENT_ORIGIN}`));
}

export { app, server, io };
export default app;
