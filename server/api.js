// REST API: public storefront endpoints + protected admin endpoints.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router, HttpError, readJson, readBody, parseCookies, cookie, sendJson, RateLimiter, clientIp, isSecure } from './http.js';
import { sendEntry } from './static.js';
import { CatalogIndex, ORDER_STATUSES } from '../public/assets/js/engine.js';
import { dhakaDate } from './db.js';

const ADMIN_COOKIE = 'bliss_admin', USER_COOKIE = 'bliss_user';
const IMAGE_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/avif': 'avif' };

function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (b.toString('ascii', 4, 12) === 'ftypavif' || b.toString('ascii', 4, 12) === 'ftypavis') return 'avif';
  return null;
}
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function buildApi({ store, tokens, renderer, uploadsDir }) {
  const r = new Router();
  const loginLimit = new RateLimiter(8, 6);     // 8 burst, 6/min
  const writeLimit = new RateLimiter(12, 20);   // forms & orders
  const uploadLimit = new RateLimiter(40, 60);

  const limit = (lim, ctx) => { if (!lim.take(ctx.ip)) throw new HttpError(429, 'Too many attempts. Please wait a minute and try again.'); };
  const cookies = (req) => parseCookies(req.headers.cookie);
  const admin = (ctx) => {
    const t = tokens.verify(cookies(ctx.req)[ADMIN_COOKIE]);
    if (!t || t.role !== 'admin' || t.pv !== (store.settings.admin.pv || 1)) throw new HttpError(401, 'Please log in to the dashboard.');
    return t;
  };
  const user = (ctx) => {
    const t = tokens.verify(cookies(ctx.req)[USER_COOKIE]);
    return t && t.role === 'user' ? store.users.get(t.sub) || null : null;
  };
  const setUserCookie = (ctx, u) => ctx.res.setHeader('Set-Cookie', cookie(USER_COOKIE, tokens.issue({ role: 'user', sub: u.id }, 60 * 86400), { maxAge: 60 * 86400, secure: isSecure(ctx.req), path: '/api' }));

  let idx = null, idxV = -1;
  const catalogIndex = () => {
    if (idxV !== store.version) { const c = store.catalog(); idx = new CatalogIndex(c.products, c.categories); idxV = store.version; }
    return idx;
  };

  /* ================================================================ PUBLIC */
  r.get('/api/catalog', (ctx) => { sendEntry(ctx.req, ctx.res, renderer.catalogEntry(), 'no-cache'); });

  r.get('/api/products/:slug', (ctx) => {
    const p = store.productDetail(ctx.params.slug);
    if (!p) throw new HttpError(404, 'This product is no longer available.');
    return p;
  });

  r.get('/api/search', (ctx) => {
    const q = Object.fromEntries(['q', 'cat', 'tag', 'g', 's', 'min', 'max', 'sort', 'page', 'size'].map((k) => [k, ctx.query.get(k) || undefined]));
    const res = catalogIndex().query(q);
    return { total: res.total, page: res.page, pages: res.pages, suggestion: res.suggestion, items: res.items };
  });

  r.post('/api/products/:id/reviews', async (ctx) => {
    limit(writeLimit, ctx);
    const rv = store.addReview(ctx.params.id, await readJson(ctx.req));
    return { ok: true, approved: rv.approved };
  });

  r.post('/api/coupons/validate', async (ctx) => {
    limit(writeLimit, ctx);
    const { code } = await readJson(ctx.req);
    const v = store.checkCoupon(code);
    return v.ok ? { ok: true, coupon: store.publicCoupon(v.coupon) } : { ok: false, message: v.message };
  });

  r.post('/api/orders', async (ctx) => {
    limit(writeLimit, ctx);
    const u = user(ctx);
    const order = store.placeOrder(await readJson(ctx.req, 200_000), u?.id);
    return { order: store.publicOrder(order) };
  });

  r.get('/api/orders/track', (ctx) => {
    limit(writeLimit, ctx);
    const o = store.trackOrder(ctx.query.get('id') || '', ctx.query.get('phone') || '');
    if (!o) throw new HttpError(404, 'We could not find an order with that ID and mobile number. Please check and try again.');
    return { order: o };
  });

  r.post('/api/contact', async (ctx) => {
    limit(writeLimit, ctx);
    store.addMessage(await readJson(ctx.req));
    return { ok: true };
  });

  r.post('/api/subscribe', async (ctx) => {
    limit(writeLimit, ctx);
    const { email } = await readJson(ctx.req);
    return { ok: true, coupon: store.subscribe(email) };
  });

  r.post('/api/auth/register', async (ctx) => {
    limit(loginLimit, ctx);
    const u = await store.register(await readJson(ctx.req));
    setUserCookie(ctx, u);
    return { user: store.publicUser(u), orders: [] };
  });
  r.post('/api/auth/login', async (ctx) => {
    limit(loginLimit, ctx);
    const b = await readJson(ctx.req);
    const u = await store.login(b.login, b.password);
    setUserCookie(ctx, u);
    return { user: store.publicUser(u), orders: store.userOrders(u.id) };
  });
  r.post('/api/auth/logout', (ctx) => {
    ctx.res.setHeader('Set-Cookie', cookie(USER_COOKIE, '', { maxAge: 0, path: '/api' }));
    return { ok: true };
  });
  r.get('/api/me', (ctx) => {
    const u = user(ctx);
    return u ? { user: store.publicUser(u), orders: store.userOrders(u.id) } : { user: null, orders: [] };
  });
  r.put('/api/me', async (ctx) => {
    const u = user(ctx);
    if (!u) throw new HttpError(401, 'Please log in again.');
    return { user: store.publicUser(store.updateProfile(u.id, await readJson(ctx.req))) };
  });

  /* ================================================================= ADMIN */
  r.post('/api/admin/login', async (ctx) => {
    limit(loginLimit, ctx);
    const b = await readJson(ctx.req);
    const a = await store.adminLogin(b.username, b.password);
    const ttl = b.remember ? 30 * 86400 : 12 * 3600;
    ctx.res.setHeader('Set-Cookie', cookie(ADMIN_COOKIE, tokens.issue({ role: 'admin', pv: a.pv || 1 }, ttl), { maxAge: ttl, secure: isSecure(ctx.req), path: '/api/admin', sameSite: 'Strict' }));
    return { username: a.username, isDefault: !!a.isDefault };
  });
  r.post('/api/admin/logout', (ctx) => {
    ctx.res.setHeader('Set-Cookie', cookie(ADMIN_COOKIE, '', { maxAge: 0, path: '/api/admin', sameSite: 'Strict' }));
    return { ok: true };
  });
  r.get('/api/admin/me', (ctx) => { admin(ctx); const a = store.settings.admin; return { username: a.username, isDefault: !!a.isDefault, store: store.settings.store.name }; });
  r.get('/api/admin/stats', (ctx) => { admin(ctx); return store.stats(); });

  // Products
  r.get('/api/admin/products', (ctx) => {
    admin(ctx);
    return { products: store.data.products, categories: store.data.categories, lowStockDefault: store.settings.lowStockDefault };
  });
  r.post('/api/admin/products', async (ctx) => { admin(ctx); return { product: store.createProduct(await readJson(ctx.req)) }; });
  r.put('/api/admin/products/:id', async (ctx) => { admin(ctx); return { product: store.updateProduct(ctx.params.id, await readJson(ctx.req)) }; });
  r.post('/api/admin/products/:id/duplicate', (ctx) => { admin(ctx); return { product: store.duplicateProduct(ctx.params.id) }; });
  r.delete('/api/admin/products/:id', (ctx) => {
    admin(ctx);
    if (!store.products.has(ctx.params.id)) throw new HttpError(404, 'Product not found.');
    store.deleteProducts([ctx.params.id]);
    return { ok: true };
  });
  r.patch('/api/admin/products/:id/stock', async (ctx) => { admin(ctx); return { product: store.setStock(ctx.params.id, await readJson(ctx.req)) }; });
  r.post('/api/admin/products/bulk', async (ctx) => {
    admin(ctx);
    const b = await readJson(ctx.req);
    if (!Array.isArray(b.ids) || !b.ids.length) throw new HttpError(400, 'Select at least one product.');
    return { count: store.bulkProducts(b.ids.map(String).slice(0, 1000), b.action, b.value) };
  });

  // Categories
  r.get('/api/admin/categories', (ctx) => {
    admin(ctx);
    const counts = new Map();
    for (const p of store.data.products) counts.set(p.cat, (counts.get(p.cat) || 0) + 1);
    return { categories: [...store.data.categories].sort((a, b) => a.sort - b.sort).map((c) => ({ ...c, count: counts.get(c.id) || 0 })) };
  });
  r.post('/api/admin/categories', async (ctx) => { admin(ctx); return { category: store.saveCategory(await readJson(ctx.req)) }; });
  r.put('/api/admin/categories/:id', async (ctx) => { admin(ctx); return { category: store.saveCategory(await readJson(ctx.req), ctx.params.id) }; });
  r.delete('/api/admin/categories/:id', (ctx) => { admin(ctx); store.deleteCategory(ctx.params.id); return { ok: true }; });

  // Orders
  r.get('/api/admin/orders', (ctx) => {
    admin(ctx);
    const status = ctx.query.get('status') || '', q = (ctx.query.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, Number(ctx.query.get('page')) || 1), size = 25;
    const counts = Object.fromEntries([['all', 0], ...ORDER_STATUSES.map(([k]) => [k, 0])]);
    const rows = [];
    const all = store.data.orders;
    for (let i = all.length - 1; i >= 0; i--) {
      const o = all[i];
      if (q && !(o.id.toLowerCase().includes(q) || o.customer.name.toLowerCase().includes(q) || o.customer.phone.includes(q))) continue;
      counts.all++; counts[o.status]++;
      if (status && o.status !== status) continue;
      rows.push(o);
    }
    const slice = rows.slice((page - 1) * size, page * size).map((o) => ({
      id: o.id, created: o.created, name: o.customer.name, phone: o.customer.phone, city: o.address.city,
      items: o.items.reduce((s, l) => s + l.qty, 0), total: o.totals.total, status: o.status,
      payment: o.payment.method, paid: o.payment.status, method: o.delivery.method, date: o.delivery.date,
    }));
    return { orders: slice, total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / size)), counts };
  });
  r.get('/api/admin/orders.csv', (ctx) => {
    admin(ctx);
    const head = ['Order ID', 'Date (Dhaka)', 'Status', 'Customer', 'Phone', 'Email', 'Recipient', 'Recipient phone', 'Address', 'Area', 'City', 'Delivery', 'Delivery date', 'Items', 'Subtotal', 'Discount', 'Delivery fee', 'Gift wrap', 'Total', 'Payment', 'TrxID', 'Payment status', 'Gift message', 'Customer note'];
    const rows = store.data.orders.slice().reverse().map((o) => [
      o.id, dhakaDate(o.created), o.status, o.customer.name, o.customer.phone, o.customer.email, o.recipient?.name, o.recipient?.phone,
      o.address.line, o.address.area, o.address.city, o.delivery.method, o.delivery.date,
      o.items.map((l) => `${l.qty}x ${l.name}${Object.keys(l.options || {}).length ? ' (' + Object.entries(l.options).map(([k, v]) => `${k}: ${v}`).join(', ') + ')' : ''}`).join('; '),
      o.totals.subtotal, o.totals.discount, o.totals.delivery, o.totals.wrap, o.totals.total, o.payment.method, o.payment.trxId, o.payment.status, o.gift.message, o.note,
    ]);
    const csv = '﻿' + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="bliss-orders-${dhakaDate(Date.now())}.csv"`, 'Cache-Control': 'no-store' });
    ctx.res.end(csv);
  });
  r.get('/api/admin/orders/:id', (ctx) => {
    admin(ctx);
    const o = store.orders.get(ctx.params.id);
    if (!o) throw new HttpError(404, 'Order not found.');
    return { order: o };
  });
  r.patch('/api/admin/orders/:id', async (ctx) => { admin(ctx); return { order: store.updateOrder(ctx.params.id, await readJson(ctx.req)) }; });
  r.delete('/api/admin/orders/:id', (ctx) => { admin(ctx); store.deleteOrder(ctx.params.id); return { ok: true }; });

  // Customers, reviews, coupons, messages, subscribers
  r.get('/api/admin/customers', (ctx) => { admin(ctx); return { customers: store.customers() }; });
  r.get('/api/admin/reviews', (ctx) => {
    admin(ctx);
    const names = new Map(store.data.products.map((p) => [p.id, { name: p.name, img: p.images[0], slug: p.slug }]));
    return { reviews: store.data.reviews.slice().sort((a, b) => (a.approved - b.approved) || b.created - a.created).map((rv) => ({ ...rv, product: names.get(rv.pid) || null })) };
  });
  r.patch('/api/admin/reviews/:id', async (ctx) => { admin(ctx); const b = await readJson(ctx.req); return { review: store.moderateReview(ctx.params.id, b.approved) }; });
  r.delete('/api/admin/reviews/:id', (ctx) => { admin(ctx); store.deleteReview(ctx.params.id); return { ok: true }; });

  r.get('/api/admin/coupons', (ctx) => { admin(ctx); return { coupons: store.data.coupons }; });
  r.post('/api/admin/coupons', async (ctx) => { admin(ctx); return { coupon: store.saveCoupon(await readJson(ctx.req)) }; });
  r.put('/api/admin/coupons/:code', async (ctx) => { admin(ctx); return { coupon: store.saveCoupon(await readJson(ctx.req), ctx.params.code) }; });
  r.delete('/api/admin/coupons/:code', (ctx) => { admin(ctx); store.deleteCoupon(ctx.params.code); return { ok: true }; });

  r.get('/api/admin/messages', (ctx) => { admin(ctx); return { messages: store.data.messages.slice().reverse() }; });
  r.patch('/api/admin/messages/:id', async (ctx) => {
    admin(ctx);
    const m = store.data.messages.find((x) => x.id === ctx.params.id);
    if (!m) throw new HttpError(404, 'Message not found.');
    const b = await readJson(ctx.req); m.read = !!b.read; store.save();
    return { message: m };
  });
  r.delete('/api/admin/messages/:id', (ctx) => {
    admin(ctx);
    store.data.messages = store.data.messages.filter((x) => x.id !== ctx.params.id); store.save();
    return { ok: true };
  });

  r.get('/api/admin/subscribers', (ctx) => { admin(ctx); return { subscribers: store.data.subscribers.slice().reverse() }; });
  r.get('/api/admin/subscribers.csv', (ctx) => {
    admin(ctx);
    const csv = '﻿Email,Subscribed (Dhaka)\r\n' + store.data.subscribers.map((s) => `${csvCell(s.email)},${dhakaDate(s.created)}`).join('\r\n');
    ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bliss-subscribers.csv"', 'Cache-Control': 'no-store' });
    ctx.res.end(csv);
  });
  r.delete('/api/admin/subscribers/:email', (ctx) => {
    admin(ctx);
    store.data.subscribers = store.data.subscribers.filter((s) => s.email !== ctx.params.email.toLowerCase()); store.save();
    return { ok: true };
  });

  // Settings
  const adminSettings = () => { const { admin: a, ...rest } = store.settings; return { ...rest, admin: { username: a.username, isDefault: !!a.isDefault } }; };
  r.get('/api/admin/settings', (ctx) => { admin(ctx); return { settings: adminSettings() }; });
  r.put('/api/admin/settings', async (ctx) => { admin(ctx); store.updateSettings(await readJson(ctx.req)); return { settings: adminSettings() }; });
  r.post('/api/admin/password', async (ctx) => {
    admin(ctx); limit(loginLimit, ctx);
    const b = await readJson(ctx.req);
    const a = await store.setAdminPassword(b.current, b.next, b.username);
    ctx.res.setHeader('Set-Cookie', cookie(ADMIN_COOKIE, tokens.issue({ role: 'admin', pv: a.pv }, 12 * 3600), { maxAge: 12 * 3600, secure: isSecure(ctx.req), path: '/api/admin', sameSite: 'Strict' }));
    return { ok: true, username: a.username };
  });
  r.post('/api/admin/demo/clear', async (ctx) => {
    admin(ctx);
    const b = await readJson(ctx.req);
    return store.clearDemo(b.what === 'products' ? 'products' : 'activity');
  });

  // Image upload: raw body, custom header (blocks cross-site uploads), magic-byte check, content-hash name.
  r.post('/api/admin/upload', async (ctx) => {
    admin(ctx); limit(uploadLimit, ctx);
    if (ctx.req.headers['x-bliss-upload'] !== '1') throw new HttpError(403, 'Upload not allowed.');
    const declared = IMAGE_TYPES[(ctx.req.headers['content-type'] || '').split(';')[0].trim()];
    if (!declared) throw new HttpError(415, 'Please upload a JPG, PNG, WEBP, GIF or AVIF image.');
    const buf = await readBody(ctx.req, 8 * 1024 * 1024);
    const ext = sniffImage(buf);
    if (!ext) throw new HttpError(415, 'That file does not look like an image.');
    const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32) + '.' + ext;
    const file = path.join(uploadsDir, name);
    if (!fs.existsSync(file)) await fs.promises.writeFile(file, buf);
    return { url: '/uploads/' + name, bytes: buf.length };
  });

  return {
    async handle(req, res, method, pathname, query) {
      const m = r.match(method, pathname);
      if (!m) { sendJson(req, res, 404, { error: 'Not found.' }); return; }
      const ctx = { req, res, params: m.params, query, ip: clientIp(req) };
      try {
        const out = await m.handler(ctx);
        if (out !== undefined && !res.headersSent) sendJson(req, res, 200, out);
      } catch (e) {
        if (res.headersSent) { res.end(); return; }
        if (e instanceof HttpError) sendJson(req, res, e.status, { error: e.message, ...(e.extra || {}) });
        else { console.error('API error', method, pathname, e); sendJson(req, res, 500, { error: 'Something went wrong on our side. Please try again.' }); }
      }
    },
  };
}
