// Tiny HTTP toolkit: router (hash-map for exact routes + compiled regex for params),
// body parsing with limits, cookies, compressed JSON responses, token-bucket rate limiter.
import zlib from 'node:zlib';

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

export class Router {
  constructor() { this.exact = new Map(); this.dynamic = []; }
  on(method, path, handler) {
    if (!path.includes(':')) { this.exact.set(method + ' ' + path, handler); return this; }
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.dynamic.push({ method, re, keys, handler });
    return this;
  }
  get(p, h) { return this.on('GET', p, h); }
  post(p, h) { return this.on('POST', p, h); }
  put(p, h) { return this.on('PUT', p, h); }
  patch(p, h) { return this.on('PATCH', p, h); }
  delete(p, h) { return this.on('DELETE', p, h); }
  match(method, path) {
    const h = this.exact.get(method + ' ' + path);
    if (h) return { handler: h, params: {} };
    for (const r of this.dynamic) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}

export function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > limit) { reject(new HttpError(413, 'That file or request is too large.')); req.resume(); return; }
    const chunks = []; let size = 0; let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > limit) { failed = true; reject(new HttpError(413, 'That file or request is too large.')); req.resume(); }
      else chunks.push(c);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

/** JSON bodies only. Requiring application/json also blocks classic cross-site form CSRF. */
export async function readJson(req, limit = 1_000_000) {
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'Expected JSON body.');
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    const v = JSON.parse(buf.toString('utf8'));
    if (v === null || typeof v !== 'object') throw new Error('not an object');
    return v;
  } catch { throw new HttpError(400, 'Invalid JSON body.'); }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}

export function cookie(name, value, { maxAge, httpOnly = true, secure = false, sameSite = 'Lax', path = '/' } = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (maxAge != null) s += `; Max-Age=${maxAge}`;
  if (httpOnly) s += '; HttpOnly';
  if (secure) s += '; Secure';
  return s;
}

/** Sends JSON, compressed with brotli/gzip when it is worth it. */
export function sendJson(req, res, status, data, headers = {}) {
  const body = Buffer.from(JSON.stringify(data));
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers };
  sendBuffer(req, res, status, body, h);
}

export function sendBuffer(req, res, status, body, headers) {
  const ae = req.headers['accept-encoding'] || '';
  let out = body;
  if (body.length > 1400) {
    if (/\bbr\b/.test(ae)) { out = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }); headers['Content-Encoding'] = 'br'; }
    else if (/\bgzip\b/.test(ae)) { out = zlib.gzipSync(body, { level: 6 }); headers['Content-Encoding'] = 'gzip'; }
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = out.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : out);
}

/** Token bucket: `capacity` burst, refilled continuously at `perMinute`. */
export class RateLimiter {
  constructor(capacity, perMinute) {
    this.cap = capacity; this.rate = perMinute / 60000; this.buckets = new Map();
    setInterval(() => this.sweep(), 300_000).unref();
  }
  take(key, cost = 1) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) { b = { t: this.cap, ts: now }; this.buckets.set(key, b); }
    b.t = Math.min(this.cap, b.t + (now - b.ts) * this.rate); b.ts = now;
    if (b.t < cost) return false;
    b.t -= cost; return true;
  }
  sweep() { const now = Date.now(); for (const [k, b] of this.buckets) if (now - b.ts > 900_000) this.buckets.delete(k); }
}

const trustProxy = () => process.env.TRUST_PROXY || process.env.VERCEL;
export function clientIp(req) {
  if (trustProxy()) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function isSecure(req) {
  return !!(req.socket?.encrypted || (trustProxy() && req.headers['x-forwarded-proto'] === 'https'));
}
