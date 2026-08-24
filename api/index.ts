import express from 'express';
import cors from 'cors';
import { musicRouter } from '../server/src/music/routes.js';

const app = express();
app.set('trust proxy', true);

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

const startedAt = Date.now();
function healthHandler(_req: express.Request, res: express.Response) {
  res.json({ ok: true, version: '1.0.0', uptime: process.uptime(), runtime: 'vercel' });
}

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

app.get('/api/turn-credentials', (_req, res) => {
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:openrelay.metered.ca:80' },
      ...(process.env.TURN_URL ? [{ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS }] : []),
    ],
  });
});

app.get('/api/leaderboard', (_req, res) => res.json([]));

app.use('/api/music', musicRouter);

export default app;
