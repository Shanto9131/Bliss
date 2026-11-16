// Builds the BLISS request handler. Used by server.js (normal server) and api/index.js (Vercel).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './db.js';
import { seedData, writeArt } from './seed.js';
import { StaticFiles, UploadCache, sendEntry } from './static.js';
import { loadSecret, makeTokens } from './auth.js';
import { buildApi } from './api.js';
import { Renderer } from './render.js';
import { isSecure } from './http.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

export async function createApp({ reset = false } = {}) {
  const serverless = !!process.env.VERCEL;
  const PUBLIC = path.join(ROOT, 'public');
  // Serverless hosts only allow writing to /tmp (data there is temporary).
  const DATA = process.env.DATA_DIR || (serverless ? '/tmp/bliss-data' : path.join(ROOT, 'data'));
  const UPLOADS = process.env.UPLOADS_DIR || (serverless ? '/tmp/bliss-uploads' : path.join(ROOT, 'uploads'));
  const PROD = process.env.NODE_ENV === 'production';

  fs.mkdirSync(UPLOADS, { recursive: true });
  if (!serverless) { try { writeArt(PUBLIC); } catch (e) { console.warn('Could not write demo art:', e.message); } }
  const store = new Store(DATA);
  await store.load(seedData, { reset });
  const files = new StaticFiles(PUBLIC, { watch: !PROD && !serverless, lazy: serverless });
  const uploads = new UploadCache(UPLOADS);
  const tokens = makeTokens(loadSecret(DATA));
  const renderer = new Renderer({ store, files, watch: !PROD && !serverless });
  const api = buildApi({ store, tokens, renderer, uploadsDir: UPLOADS });
  const origin = (req) => process.env.PUBLIC_URL?.replace(/\/$/, '') || `${isSecure(req) ? 'https' : 'http'}://${req.headers.host || 'localhost'}`;

  async function handler(req, res) {
    for (const k in SECURITY_HEADERS) res.setHeader(k, SECURITY_HEADERS[k]);
    if (PROD && isSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    let url, pathname;
    try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
    catch { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Bad request'); return; }
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    try {
      if (pathname.startsWith('/api/')) { await api.handle(req, res, method, pathname, url.searchParams); return; }
      if (method !== 'GET') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
      if (pathname.startsWith('/uploads/')) {
        const e = uploads.get(pathname.slice('/uploads/'.length));
        if (e) { sendEntry(req, res, e, 'public, max-age=31536000, immutable'); return; }
        res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
      }
      if (files.serve(req, res, pathname, url.searchParams)) return;
      if (pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        res.end(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /checkout\nSitemap: ${origin(req)}/sitemap.xml\n`); return;
      }
      if (pathname === '/sitemap.xml') { renderer.sitemap(req, res, origin(req)); return; }
      if (pathname === '/admin' || pathname.startsWith('/admin/')) { renderer.admin(req, res); return; }
      if (/\.[a-z0-9]{2,5}$/i.test(pathname)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
      renderer.page(req, res, pathname, origin(req));
    } catch (e) {
      console.error('Request failed', req.method, req.url, e);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Server error'); }
    }
  }
  return { handler, store, files, serverless, dataDir: DATA };
}
