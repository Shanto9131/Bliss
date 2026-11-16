// Password hashing (scrypt, async so logins never block other shoppers) + HMAC-signed session tokens.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCRYPT = { N: 16384, r: 8, p: 1 };
const scrypt = (pw, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(String(pw).normalize('NFKC'), salt, 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt);
  return `s1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  try {
    const [v, s, h] = String(stored).split('$');
    if (v !== 's1') return false;
    const hash = await scrypt(pw, Buffer.from(s, 'base64'));
    const expected = Buffer.from(h, 'base64');
    return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
  } catch { return false; }
}

/** Secret used to sign cookies. Env var wins; otherwise generated once and stored in data/. */
export function loadSecret(dataDir) {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, 'secret.key');
  try { const s = fs.readFileSync(file, 'utf8').trim(); if (s.length >= 32) return s; } catch { /* first run */ }
  const s = crypto.randomBytes(48).toString('base64url');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

export function makeTokens(secret) {
  const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return {
    issue(payload, ttlSec) {
      const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
      return body + '.' + sign(body);
    },
    verify(token) {
      if (!token || typeof token !== 'string') return null;
      const i = token.lastIndexOf('.');
      if (i < 1) return null;
      const body = token.slice(0, i), sig = Buffer.from(token.slice(i + 1)), exp = Buffer.from(sign(body));
      if (sig.length !== exp.length || !crypto.timingSafeEqual(sig, exp)) return null;
      try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        return p.exp > Date.now() / 1000 ? p : null;
      } catch { return null; }
    },
  };
}
