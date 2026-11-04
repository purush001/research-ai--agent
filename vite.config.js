import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiHandler } from './server/api.js';

// In development and `vite preview` the same API handler that `npm start` uses
// is mounted as middleware, so one command runs the UI and the backend. API
// keys are entered in the UI, held in server memory, and never read by Vite
// (there are no VITE_* credentials), so they cannot end up in the bundle.
function apiPlugin() {
  const mount = (server) => {
    const api = createApiHandler();
    server.middlewares.use((req, res, next) => {
      api(req, res).then((handled) => handled || next(), next);
    });
  };
  return { name: 'content-agents-api', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig({
  plugins: [react(), apiPlugin()],
});
