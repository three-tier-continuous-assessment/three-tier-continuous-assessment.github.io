#!/usr/bin/env node
// Development server: serves web/ and answers /api/* with the real handler on node:sqlite and
// fake Google, Paystack, model and NIN services. Data persists in .dev/dev.sqlite.
//   node tools/dev-server.mjs [port]      (default 8790; port 8765 belongs to other sessions)

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeApp } from './node-app.mjs';

const port = Number(process.argv[2] ?? process.env.PORT ?? 8790);
const root = fileURLToPath(new URL('../web/', import.meta.url));
const repo = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(repo, '.dev'), { recursive: true });
const origin = `http://localhost:${port}/`;
const { app } = nodeApp({
  dbPath: process.env.MEMORY ? ':memory:' : join(repo, '.dev', 'dev.sqlite'),
  siteOrigin: origin,
  adminEmails: process.env.ADMIN_EMAILS ?? 'admin@unn.edu.ng',
  ninRecords: { '12345678901': { firstName: 'Ada', middleName: 'Ngozi', lastName: 'Obi', dob: '1980-01-31' } },
});

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await app(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), { ip: req.socket.remoteAddress });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    if (url.pathname === '/__phone') {
      // Test harness (development only): the app in an iframe at an exact phone size, because
      // headless Firefox will not lay out a window narrower than 500 CSS pixels.
      const w = Number(url.searchParams.get('w')) || 390, ht = Number(url.searchParams.get('h')) || 844;
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      res.end(`<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><iframe id="phone" src="/#/" style="border:0;width:${w}px;height:${ht}px"></iframe>`);
      return;
    }
    if (url.pathname === '/config.js') {
      res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' });
      res.end(`window.TTCA_CONFIG = { mode: 'dev', api: '', googleClientId: null };\n`);
      return;
    }
    // Shared modules are served from the repository so the browser imports the same files.
    let file;
    if (/^\/(shared|worker|config)\//.test(url.pathname)) file = normalize(join(repo, url.pathname));
    else file = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(repo)) throw Object.assign(new Error('forbidden'), { code: 'EACCES' });
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : e.code === 'EACCES' ? 403 : 500, { 'content-type': 'text/plain' });
    res.end(e.code === 'ENOENT' ? 'not found' : 'error');
  }
}).listen(port, () => console.log(`Three-Tier CA development server: ${origin} (fake Google, Paystack, model and NIN)`));
