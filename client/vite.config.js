import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Where the dev proxy sends /api and /socket.io. Override to run a second, isolated
// copy (e.g. browser tests): API_PROXY_TARGET=http://localhost:4100 vite --port 5174
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Dev proxy: lets the client call /api and /socket.io on the same origin.
    proxy: {
      '/api': apiTarget,
      '/socket.io': { target: apiTarget, ws: true },
    },
  },
});
