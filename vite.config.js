import { defineConfig } from 'vite';

// SerpAPI does not reliably allow direct browser (CORS) calls, so the dev and
// preview servers forward /serpapi/* to serpapi.com. The API key is still
// entered in the UI and sent per request.
const serpapiProxy = {
  '/serpapi': {
    target: 'https://serpapi.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/serpapi/, ''),
  },
};

export default defineConfig({
  server: { proxy: serpapiProxy },
  preview: { proxy: serpapiProxy },
});
