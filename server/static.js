// Static files are read ONCE at startup, pre-compressed with brotli + gzip and kept in a Map,
// so serving an asset is a hash lookup + socket write (no disk I/O, no per-request compression).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = /^(text\/|application\/(json|xml|manifest)|image\/svg)/;

export function compress(raw, quality = 11) {
  return {
    br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }),
    gz: zlib.gzipSync(raw, { level: 9 }),
  };
}

export function makeEntry(raw, type, quality = 11, lazy = false) {
  const hash = crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 12);
  const e = { type, raw, hash, etag: `W/"${hash}"` };
  if (COMPRESSIBLE.test(type) && raw.length > 600) { if (lazy) e.lazyQ = quality; else Object.assign(e, compress(raw, quality)); }
  return e;
}

/** Writes an entry honouring If-None-Match and Accept-Encoding. */
export function sendEntry(req, res, e, cacheControl) {
  const h = { 'Content-Type': e.type, ETag: e.etag, 'Cache-Control': cacheControl, Vary: 'Accept-Encoding' };
  const inm = req.headers['if-none-match'];
  if (inm && inm.split(',').some((t) => t.trim() === e.etag)) { res.writeHead(304, h); res.end(); return; }
  const ae = req.headers['accept-encoding'] || '';
  if (e.lazyQ && !e.br) { Object.assign(e, compress(e.raw, e.lazyQ)); e.lazyQ = 0; } // compress on first use (serverless)
  let body = e.raw;
  if (e.br && /\bbr\b/.test(ae)) { body = e.br; h['Content-Encoding'] = 'br'; }
  else if (e.gz && /\bgzip\b/.test(ae)) { body = e.gz; h['Content-Encoding'] = 'gzip'; }
  h['Content-Length'] = body.length;
  res.writeHead(200, h);
  res.end(req.method === 'HEAD' ? undefined : body);
}

export class StaticFiles {
  constructor(root, { watch = false, exclude = [], lazy = false } = {}) {
    this.root = root; this.exclude = new Set(exclude); this.files = new Map(); this.rev = 0; this.lazy = lazy;
    if (fs.existsSync(root)) this.walk(root); // on serverless hosts a CDN may serve these instead
    if (watch) this.watch();
  }
  rel(abs) { return '/' + path.relative(this.root, abs).split(path.sep).join('/'); }
  walk(dir) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) this.walk(abs); else this.add(abs);
    }
  }
  add(abs) {
    try {
      const raw = fs.readFileSync(abs);
      const type = TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream';
      this.files.set(this.rel(abs), makeEntry(raw, type, this.lazy ? 5 : 11, this.lazy));
    } catch { this.files.delete(this.rel(abs)); }
    this.rev++;
  }
  /** Raw text of a file (used for HTML templates). */
  text(rel) { const e = this.files.get(rel); return e ? e.raw.toString('utf8') : ''; }
  /** Cache-busting URL: /assets/app.js?v=<content-hash> */
  url(rel) { const e = this.files.get(rel); return e ? `${rel}?v=${e.hash}` : rel; }
  serve(req, res, rel, query) {
    if (this.exclude.has(rel)) return false;
    const e = this.files.get(rel);
    if (!e) return false;
    const v = query.get('v');
    let cc = 'public, max-age=86400';
    if ((v && v === e.hash) || rel.startsWith('/assets/fonts/')) cc = 'public, max-age=31536000, immutable';
    else if (rel.startsWith('/assets/')) cc = 'public, max-age=300, must-revalidate';
    sendEntry(req, res, e, cc);
    return true;
  }
  watch() {
    let timer = null; const pending = new Set();
    try {
      fs.watch(this.root, { recursive: true }, (_evt, file) => {
        if (!file) return;
        pending.add(path.join(this.root, file));
        clearTimeout(timer);
        timer = setTimeout(() => {
          for (const abs of pending) {
            try { if (fs.statSync(abs).isFile()) this.add(abs); } catch { this.files.delete(this.rel(abs)); this.rev++; }
          }
          pending.clear();
        }, 80);
      });
    } catch { /* recursive watch unsupported: restart to pick up changes */ }
  }
}

/** Uploaded images: content-hashed names, served from disk through a byte-bounded LRU. */
export class UploadCache {
  constructor(dir, maxBytes = 64 * 1024 * 1024) { this.dir = dir; this.max = maxBytes; this.map = new Map(); this.bytes = 0; }
  get(name) {
    if (!/^[a-f0-9]{16,64}\.(webp|jpe?g|png|gif|avif)$/.test(name)) return null;
    let e = this.map.get(name);
    if (e) { this.map.delete(name); this.map.set(name, e); return e; }
    let raw;
    try { raw = fs.readFileSync(path.join(this.dir, name)); } catch { return null; }
    e = makeEntry(raw, TYPES[path.extname(name)] || 'application/octet-stream');
    this.map.set(name, e); this.bytes += raw.length;
    while (this.bytes > this.max && this.map.size > 1) {
      const [k, old] = this.map.entries().next().value;
      this.map.delete(k); this.bytes -= old.raw.length;
    }
    return e;
  }
}
