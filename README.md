# 💪 Pushup Pro — Real-Time AI Pushup Battle Arena

Browser-based fitness battle platform with AI camera pose tracking. No wearables, no tapping.

- **👥 Friend Battle**: Create room → share link → race globally with live AI counters
- **🤖 Bot Battle**: Adaptive AI that reads your rep speed and re-paces within one rep

Converted from Python `VNOpenAI/pushup-counter-app` (BlazePose) → JavaScript via **MediaPipe PoseLandmarker** 100% client-side.

## Architecture
```
Client (React + Vite, Vercel) ── rep events only ──> Backend (Node + Socket.io, Render)
  Camera → MediaPipe → State Machine → Counter          RoomManager · Anti-cheat · Signaling
  Canvas Skeleton Overlay                                WebRTC TURN issuer
```
Video frames **never leave the browser**. Only `{repCount, timestamp, formScore}` travels.

## Quick Start
```bash
# client
cd client && npm install && npm run dev   # http://localhost:5173

# server
cd server && npm install && npm run dev   # http://localhost:3001
```
Set `VITE_SERVER_URL=http://localhost:3001` in `client/.env`.

## Tech Stack
React 18 + Vite + TS + Tailwind + Framer Motion | MediaPipe Tasks Vision (BlazePose) | Socket.io | WebRTC | Node + Express | Supabase (optional) | Vercel + Render + metered.ca TURN

## Pose Engine
- Elbow angle `θ = arccos( (S-E)·(W-E) / |S-E||W-E| )`, averaged across both arms (visibility-weighted)
- Hysteresis: `UP ≥160°`, `DOWN ≤100°`, MID dead-band kills jitter
- Rep = `UP→DOWN→UP` + ≥600ms; back/leg form rules apply **only when hips/knees are in frame** — upper-body-only framing counts purely on elbow motion
- EMA smoothing α=0.25, form score 0-100 (renormalized over observable criteria)

## Bot Pacing (per spec §8.2)
```
T_target = k·T_user·(1 + γ(R_bot - R_user))
T_bot = (1-α)T_bot + αT_target, α=0.35, T_bot∈[0.5,4]s
```
Easy k=1.30 γ=0.02 | Medium k=1.00 γ=0.05 | Hard k=0.85 γ=0.10
