import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// Regression: a malformed URL path (e.g. "/%") used to throw an uncaught
// URIError and kill the whole server process.
test('standalone server survives malformed request paths', { skip: !existsSync(new URL('../dist/index.html', import.meta.url)) && 'run `npm run build` first' }, async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('server did not start')), 8000);
      child.stdout.on('data', (d) => { if (String(d).includes('running at')) { clearTimeout(t); resolve(); } });
      child.on('exit', () => reject(new Error('server exited early')));
    });
    const raw = (path) => new Promise((resolve, reject) => {
      import('node:net').then(({ createConnection }) => {
        const sock = createConnection(port, '127.0.0.1', () => sock.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
        let buf = '';
        sock.on('data', (d) => (buf += d));
        sock.on('end', () => resolve(buf.split(' ')[1]));
        sock.on('error', reject);
      });
    });
    assert.equal(await raw('/%'), '400');
    assert.equal(await raw('/%E0%A4%A'), '400');
    assert.equal(child.exitCode, null, 'server is still running');
    assert.equal(await raw('/'), '200');
    assert.equal(await raw('/api/health'), '200');
  } finally {
    child.kill();
  }
});
