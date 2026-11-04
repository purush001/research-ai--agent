import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { createApiHandler } from './api.js';

const dist = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.map': 'application/json',
};
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = normalize(join(dist, pathname));
  if (file !== dist && !file.startsWith(dist + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Build the app first: npm run build');
    return;
  }
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME[extname(file)] || 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

const api = createApiHandler();
const server = createServer(async (req, res) => {
  if (await api(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

server.listen(config.port, config.host, () => {
  console.log(`AI content agents running at http://${config.host}:${config.port}  (model: ${config.model})`);
});
