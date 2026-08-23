# Deploy — Pushup Pro

Everything needed to put the app online lives here. Two supported paths:

---

## Option 1 — ONE service on Render (recommended, zero config)

The server can serve the built web app itself (`STATIC_DIR`), so the site,
music API, and multiplayer sockets all share one URL. Same-origin = no CORS,
no baked API URLs, works on every device including iOS camera.

### Steps

1. Push this repo to GitHub.
2. On [render.com](https://render.com) → **New → Blueprint** → pick the repo.
   Render reads `deploy/render.yaml`... actually it must sit at the repo root
   to be detected — either copy it to the root or use manual settings below.
3. Manual settings (if not using the blueprint):

| Setting       | Value |
|---------------|-------|
| Environment   | Node |
| Build command | `npm install && npm run build --workspace=client && npm run build --workspace=server` |
| Start command | `node server/dist/index.js` |
| Health check  | `/health` |

4. Env vars:
   - `STATIC_DIR = client/dist`
   - `CLIENT_ORIGIN = https://your-app.onrender.com` (informational; same-origin needs none)

Done — `https://your-app.onrender.com` is the whole app. Open it on any phone;
camera + music + battles work over its valid HTTPS certificate.

> Free Render services sleep after 15 min idle; first request takes ~30s to wake.

---

## Option 2 — Split hosting (Vercel client + Render API)

Use only if you want the frontend on Vercel/Netlify.

1. **API on Render:** deploy the `server/` workspace
   (build `npm install && npm run build`, start `npm start`, port from `PORT`).
   Set `CLIENT_ORIGIN=https://your-client.vercel.app`.
2. **Client on Vercel:** import repo, set root directory `client`,
   build `npm run build`, output `dist`. Before building set env var:
   - `VITE_SERVER_URL = https://your-api.onrender.com`
   
   (In split mode the client bakes this URL in at build time — it will NOT
   use relative `/api` paths unless the API is behind the same domain.)
3. Copy `vercel.client.json` into `client/` (it's already there) for SPA rewrites.

---

## Local staging (what gets uploaded)

Run from the repo root:

```powershell
powershell -File deploy\prepare.ps1
```

Produces:

```
deploy/
  client/dist     ← static web app (upload anywhere)
  server/         ← dist + package.json (npm install && npm start)
```

## Files in this folder

| File | Purpose |
|------|---------|
| `render.yaml` | Render Blueprint for Option 1 |
| `prepare.ps1` | Builds and stages deployable artifacts locally |
| `vercel.client.json` | SPA rewrite rules if hosting client separately |
| `client.env.example` / `server.env.example` | Required env vars per service |

## Notes

- Camera requires HTTPS — all options above give valid HTTPS automatically.
- WebSockets: Render supports them natively; Vercel does NOT proxy Socket.IO —
  another reason Option 1 is recommended for battles.
- TURN credentials (optional, better P2P behind strict NATs):
  `TURN_URL` / `TURN_USER` / `TURN_PASS` on the server env.
