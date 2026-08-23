import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Same-origin proxy so any host works: localhost, PC LAN IP or Cloudflare tunnel.
// The client calls relative /api + /socket.io paths; Vite forwards them to :3001.
const proxy = {
  '/api': { target: 'http://localhost:3001', changeOrigin: true },
  '/socket.io': { target: 'http://localhost:3001', changeOrigin: true, ws: true },
};

export default defineConfig({
  // HTTPS everywhere (self-signed auto cert): getUserMedia/camera only works
  // on secure origins, so LAN phones at https://<PC-IP>:5173 get the camera
  // too — accept the browser's one-time certificate warning.
  plugins: [react(), basicSsl()],
  server: {
    port: 5173,
    host: true,
    hmr: { overlay: false },
    proxy,
    // allow access through Cloudflare quick-tunnel (*.trycloudflare.com) from run.bat
    allowedHosts: true,
  },
  preview: {
    port: 5174,
    host: true,
    proxy,
  },
  build: { outDir: 'dist', target: 'esnext' },
  worker: { format: 'es' },
});
