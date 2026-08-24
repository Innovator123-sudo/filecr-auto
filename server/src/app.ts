import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { musicRouter } from './music/routes.js';

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const allowedOrigins = CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (origin.endsWith('.vercel.app')) return true;
  if (origin.endsWith('.onrender.com')) return true;
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true;
  return false;
}

export const app = express();

app.use(cors({
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) cb(null, origin || true);
    else cb(null, false);
  },
  credentials: true,
}));
app.use(express.json());

// health used by Render + Vercel
app.get('/health', (_req, res) => res.json({ ok: true, version: '1.0.0', uptime: process.uptime() }));
app.get('/api/health', (_req, res) => res.json({ ok: true, version: '1.0.0', uptime: process.uptime() }));

app.get('/', (_req, res) => {
  const appUrl = (process.env.CLIENT_ORIGIN || '').split(',')[0];
  if (appUrl && !appUrl.includes('localhost') && !process.env.VERCEL) return res.redirect(302, appUrl);
  res.json({ ok: true, service: 'pushup-pro-game-server', hint: 'This is the API. Open the web app URL.' });
});

app.post('/api/turn-credentials', (_req, res) => {
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:openrelay.metered.ca:80' },
      ...(process.env.TURN_URL ? [{ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS }] : []),
    ],
  });
});
app.get('/api/leaderboard', (_req, res) => res.json([]));

// JioSaavn + YouTube music – this is what must work on Vercel
app.use('/api/music', musicRouter);

// Also expose without /api prefix for backwards compat when called via serverless rewrite
app.use('/music', musicRouter);

// Production single-service mode (Render or local) – serve built client if STATIC_DIR set
const STATIC_DIR = process.env.STATIC_DIR;
if (STATIC_DIR) {
  const staticAbs = path.resolve(STATIC_DIR);
  app.use(express.static(staticAbs));
  app.get('*', (_req, res) => res.sendFile(path.join(staticAbs, 'index.html')));
}

export default app;
