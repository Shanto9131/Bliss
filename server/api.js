// REST API: public storefront endpoints + protected admin endpoints.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router, HttpError, readJson, readBody, parseCookies, cookie, sendJson, RateLimiter, clientIp, isSecure } from './http.js';
import { sendEntry } from './static.js';
import { CatalogIndex, ORDER_STATUSES, CHANNELS } from '../public/assets/js/engine.js';
import { dhakaDate, normPhone, EXPENSE_CATEGORIES } from './db.js';
import * as R from './reports.js';

const ADMIN_COOKIE = 'bliss_admin', USER_COOKIE = 'bliss_user';
const IMAGE_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/avif': 'avif' };
const STATUS_KEYS = new Set(ORDER_STATUSES.map(([k]) => k));

function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (b.toString('ascii', 4, 12) === 'ftypavif' || b.toString('ascii', 4, 12) === 'ftypavis') return 'avif';
  return null;
}
// Cells starting with = + - @ are prefixed so spreadsheet apps never run them as formulas.
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function sendCsv(ctx, name, head, rows) {
  const csv = '﻿' + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-${dhakaDate(Date.now())}.csv"`, 'Cache-Control': 'no-store' });
  ctx.res.end(csv);
}
const pct = (n) => (n == null ? '' : `${Math.round(n * 1000) / 10}%`);

export function buildApi({ store, tokens, renderer, uploadsDir }) {
  const r = new Router();
  const loginLimit = new RateLimiter(8, 6);     // 8 burst, 6/min
  const writeLimit = new RateLimiter(12, 20);   // forms & orders
  const uploadLimit = new RateLimiter(40, 60);
  const beaconLimit = new RateLimiter(60, 240); // analytics beacons & checkout drafts

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
  const q = (ctx) => Object.fromEntries(ctx.query);

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
    const qq = Object.fromEntries(['q', 'cat', 'tag', 'g', 's', 'min', 'max', 'sort', 'page', 'size'].map((k) => [k, ctx.query.get(k) || undefined]));
    const res = catalogIndex().query(qq);
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
    return { order: store.publicOrder(order), offer: store.upsellOffer(order) };
  });
  r.post('/api/orders/:id/upsell', async (ctx) => {
    limit(writeLimit, ctx);
    const b = await readJson(ctx.req);
    return { order: store.publicOrder(store.acceptUpsell(ctx.params.id, b.phone)) };
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
  // Offer popup: email or phone in exchange for the popup coupon.
  r.post('/api/lead', async (ctx) => {
    limit(writeLimit, ctx);
    const b = await readJson(ctx.req);
    const pop = store.settings.boosters.popup;
    return { ok: true, coupon: store.addLead(b, { coupon: pop.enabled ? pop.coupon : '' }) };
  });

  // Funnels (landing pages)
  r.get('/api/funnels/:slug', (ctx) => {
    const f = store.publicFunnel(ctx.params.slug);
    if (!f) throw new HttpError(404, 'This offer has ended.');
    return { funnel: f };
  });
  r.post('/api/funnels/:slug/lead', async (ctx) => {
    limit(writeLimit, ctx);
    const f = store.funnelSlugs.get(ctx.params.slug);
    if (!f || !f.active || f.type !== 'lead') throw new HttpError(404, 'This offer has ended.');
    return { ok: true, coupon: store.addLead(await readJson(ctx.req), { funnel: f, coupon: f.coupon }) };
  });

  // Analytics beacon (navigator.sendBeacon) and abandoned-checkout capture.
  r.post('/api/t', async (ctx) => {
    if (!beaconLimit.take(ctx.ip)) { ctx.res.writeHead(204); ctx.res.end(); return; }
    const b = await readJson(ctx.req, 4000);
    const ua = String(ctx.req.headers['user-agent'] || '');
    if (!/bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse/i.test(ua)) store.track(b);
    ctx.res.writeHead(204); ctx.res.end();
  });
  r.post('/api/checkout/draft', async (ctx) => {
    limit(beaconLimit, ctx);
    store.saveDraft(await readJson(ctx.req, 50_000));
    return { ok: true };
  });
  r.get('/api/checkout/restore/:token', (ctx) => {
    limit(writeLimit, ctx);
    const d = store.restoreDraft(ctx.params.token);
    if (!d) throw new HttpError(404, 'This link has expired.');
    return d;
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
  r.get('/api/admin/counts', (ctx) => { admin(ctx); return store.counts(); });
  r.get('/api/admin/overview', (ctx) => { admin(ctx); return R.overview(store, q(ctx)); });
  r.get('/api/admin/analytics', (ctx) => { admin(ctx); return R.analytics(store, q(ctx)); });

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

  // Inventory
  r.get('/api/admin/inventory', (ctx) => { admin(ctx); return { ...R.inventory(store), categories: store.data.categories }; });
  r.post('/api/admin/inventory/:id/receive', async (ctx) => { admin(ctx); store.receiveStock(ctx.params.id, await readJson(ctx.req)); return R.inventory(store); });
  r.post('/api/admin/inventory/:id/adjust', async (ctx) => { admin(ctx); store.adjustStock(ctx.params.id, await readJson(ctx.req)); return R.inventory(store); });
  r.get('/api/admin/stock-log', (ctx) => {
    admin(ctx);
    const pid = ctx.query.get('pid') || '';
    const log = store.data.stockLog;
    const out = [];
    for (let i = log.length - 1; i >= 0 && out.length < 300; i--) if (!pid || log[i].pid === pid) out.push(log[i]);
    return { log: out };
  });
  r.get('/api/admin/inventory.csv', (ctx) => {
    admin(ctx);
    const { rows } = R.inventory(store);
    sendCsv(ctx, 'bliss-inventory', ['SKU', 'Product', 'Category', 'Status', 'On hand', 'Cost (৳)', 'Price (৳)', 'Stock value at cost', 'Stock value at price', 'Sold 30 days', 'Sold 90 days', 'Days of stock left', 'Suggested reorder', 'Supplier', 'Visible'],
      rows.map((x) => [x.sku, x.name, store.categories.get(x.cat)?.name || '', x.status, x.qty ?? 'not tracked', x.cost ?? '', x.price, x.valueCost ?? '', x.valueRetail ?? '', x.sold30, x.sold90, x.cover ?? '', x.reorder || '', x.supplier, x.active ? 'yes' : 'no']));
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
  const filterOrders = (ctx) => {
    const status = ctx.query.get('status') || '', s = (ctx.query.get('q') || '').trim().toLowerCase();
    const pay = ctx.query.get('pay') || '', ch = ctx.query.get('channel') || '', from = ctx.query.get('from') || '', to = ctx.query.get('to') || '';
    const counts = Object.fromEntries([['all', 0], ...ORDER_STATUSES.map(([k]) => [k, 0])]);
    const rows = [];
    const all = store.data.orders;
    for (let i = all.length - 1; i >= 0; i--) {
      const o = all[i];
      if (s && !(o.id.toLowerCase().includes(s) || o.customer.name.toLowerCase().includes(s) || o.customer.phone.includes(s) || (o.courier?.tracking || '').toLowerCase().includes(s))) continue;
      if (pay === 'paid' && o.payment.status !== 'paid') continue;
      if (pay === 'unpaid' && o.payment.status === 'paid') continue;
      if (ch && (o.source?.channel || 'direct') !== ch && o.funnel !== ch) continue;
      if (from || to) { const d = dhakaDate(o.created); if ((from && d < from) || (to && d > to)) continue; }
      counts.all++; counts[o.status]++;
      if (status && o.status !== status) continue;
      rows.push(o);
    }
    return { rows, counts };
  };
  r.get('/api/admin/orders', (ctx) => {
    admin(ctx);
    const { rows, counts } = filterOrders(ctx);
    const page = Math.max(1, Number(ctx.query.get('page')) || 1), size = 25;
    const slice = rows.slice((page - 1) * size, page * size).map((o) => {
      const h = R.history(store, o.customer.phone, o.id);
      return {
        id: o.id, created: o.created, name: o.customer.name, phone: o.customer.phone, city: o.address.city,
        items: o.items.reduce((s, l) => s + l.qty, 0), total: o.totals.total, status: o.status,
        payment: o.payment.method, paid: o.payment.status, method: o.delivery.method, date: o.delivery.date,
        channel: o.source?.channel || 'direct', funnel: o.funnel ? store.funnels.get(o.funnel)?.name || 'Funnel' : null, manual: !!o.manual,
        tracking: o.courier?.tracking || '', risk: h.blocked || (h.success != null && h.success < 0.5 && h.delivered + h.returned + h.cancelled >= 2), repeat: h.delivered > 0,
      };
    });
    return { orders: slice, total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / size)), counts };
  });
  r.post('/api/admin/orders', async (ctx) => {
    admin(ctx);
    const o = store.placeOrder(await readJson(ctx.req, 200_000), null, { admin: true });
    return { order: o };
  });
  r.post('/api/admin/orders/bulk', async (ctx) => {
    admin(ctx);
    const b = await readJson(ctx.req);
    if (!Array.isArray(b.ids) || !b.ids.length) throw new HttpError(400, 'Select at least one order.');
    const patch = {};
    if (STATUS_KEYS.has(b.status)) patch.status = b.status;
    if (['paid', 'unpaid'].includes(b.paymentStatus)) patch.paymentStatus = b.paymentStatus;
    if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to change.');
    let n = 0;
    for (const id of b.ids.map(String).slice(0, 500)) if (store.orders.has(id)) { store.updateOrder(id, patch); n++; }
    return { count: n };
  });
  r.get('/api/admin/orders.csv', (ctx) => {
    admin(ctx);
    const { rows } = filterOrders(ctx);
    const head = ['Order ID', 'Date (Dhaka)', 'Status', 'Customer', 'Phone', 'Email', 'Recipient', 'Recipient phone', 'Address', 'Area', 'City', 'Delivery', 'Delivery date', 'Items', 'Subtotal', 'Discount', 'Delivery fee', 'Gift wrap', 'Total', 'Payment', 'TrxID', 'Payment status', 'Source', 'Campaign', 'Funnel', 'Courier', 'Tracking', 'Product cost', 'Courier cost', 'Est. profit', 'Gift message', 'Customer note'];
    sendCsv(ctx, 'bliss-orders', head, rows.map((o) => {
      const e = R.economics(store, o);
      return [
        o.id, dhakaDate(o.created), o.status, o.customer.name, o.customer.phone, o.customer.email, o.recipient?.name, o.recipient?.phone,
        o.address.line, o.address.area, o.address.city, o.delivery.method, o.delivery.date,
        o.items.map((l) => `${l.qty}x ${l.name}${Object.keys(l.options || {}).length ? ' (' + Object.entries(l.options).map(([k, v]) => `${k}: ${v}`).join(', ') + ')' : ''}`).join('; '),
        o.totals.subtotal, o.totals.discount, o.totals.delivery, o.totals.wrap, o.totals.total, o.payment.method, o.payment.trxId, o.payment.status,
        CHANNELS[o.source?.channel] || o.source?.channel || 'Direct', o.source?.campaign || '', o.funnel ? store.funnels.get(o.funnel)?.name || '' : '',
        o.courier?.name || '', o.courier?.tracking || '', e.known ? e.cogs : '', e.ship, R.isSale(o) && e.known ? Math.round(e.profit) : '', o.gift.message, o.note,
      ];
    }));
  });
  r.get('/api/admin/orders/:id', (ctx) => {
    admin(ctx);
    const o = store.orders.get(ctx.params.id);
    if (!o) throw new HttpError(404, 'Order not found.');
    return { order: o, history: R.history(store, o.customer.phone, o.id), economics: R.economics(store, o), funnel: o.funnel ? store.funnels.get(o.funnel)?.name || null : null };
  });
  r.patch('/api/admin/orders/:id', async (ctx) => { admin(ctx); return { order: store.updateOrder(ctx.params.id, await readJson(ctx.req)) }; });
  r.delete('/api/admin/orders/:id', (ctx) => { admin(ctx); store.deleteOrder(ctx.params.id); return { ok: true }; });

  // Customers
  r.get('/api/admin/customers', (ctx) => { admin(ctx); return { customers: R.customers(store), vipSpend: store.settings.vipSpend }; });
  r.get('/api/admin/customers.csv', (ctx) => {
    admin(ctx);
    sendCsv(ctx, 'bliss-customers', ['Name', 'Phone', 'Email', 'City', 'Segment', 'Orders', 'Delivered', 'Returned', 'Cancelled', 'Success rate', 'Total spent', 'Average order', 'First order', 'Last order', 'Tags', 'Blocked', 'Account'],
      R.customers(store).map((c) => [c.name, c.phone, c.email, c.city, c.segment, c.orders, c.delivered, c.returned, c.cancelled, pct(c.success), c.spent, c.aov, c.orders ? dhakaDate(c.first) : '', c.orders ? dhakaDate(c.last) : '', c.tags.join(' '), c.blocked ? 'yes' : '', c.registered ? 'yes' : '']));
  });
  r.get('/api/admin/customers/:phone', (ctx) => {
    admin(ctx);
    const c = R.customer(store, normPhone(ctx.params.phone));
    if (!c) throw new HttpError(404, 'Customer not found.');
    return { customer: c };
  });
  r.put('/api/admin/customers/:phone', async (ctx) => { admin(ctx); return { notes: store.setCustomer(ctx.params.phone, await readJson(ctx.req)) }; });

  // Reviews, coupons, messages, subscribers, leads
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

  r.get('/api/admin/subscribers', (ctx) => {
    admin(ctx);
    const names = new Map(store.data.funnels.map((f) => [f.id, f.name]));
    return { subscribers: store.data.subscribers.slice().reverse(), leads: store.data.leads.slice().reverse().slice(0, 2000).map((l) => ({ ...l, funnelName: l.funnel ? names.get(l.funnel) || 'Deleted funnel' : 'Offer popup' })) };
  });
  r.get('/api/admin/subscribers.csv', (ctx) => {
    admin(ctx);
    sendCsv(ctx, 'bliss-subscribers', ['Email', 'Subscribed (Dhaka)'], store.data.subscribers.map((s) => [s.email, dhakaDate(s.created)]));
  });
  r.get('/api/admin/leads.csv', (ctx) => {
    admin(ctx);
    const fid = ctx.query.get('funnel') || '';
    const names = new Map(store.data.funnels.map((f) => [f.id, f.name]));
    sendCsv(ctx, 'bliss-leads', ['Name', 'Phone', 'Email', 'From', 'Date (Dhaka)'],
      store.data.leads.filter((l) => !fid || l.funnel === fid).map((l) => [l.name, l.phone, l.email, l.funnel ? names.get(l.funnel) || 'Deleted funnel' : 'Offer popup', dhakaDate(l.created)]));
  });
  r.delete('/api/admin/subscribers/:email', (ctx) => {
    admin(ctx);
    store.data.subscribers = store.data.subscribers.filter((s) => s.email !== ctx.params.email.toLowerCase()); store.save();
    return { ok: true };
  });
  r.delete('/api/admin/leads/:id', (ctx) => {
    admin(ctx);
    store.data.leads = store.data.leads.filter((l) => l.id !== ctx.params.id); store.save();
    return { ok: true };
  });

  // Funnels
  const dayRange = (n) => { const to = dhakaDate(Date.now()); return { from: dhakaDate(Date.now() - (n - 1) * 86_400_000), to }; };
  r.get('/api/admin/funnels', (ctx) => {
    admin(ctx);
    const { from, to } = dayRange(30);
    const stats = R.funnelStats(store, from, to);
    return { funnels: store.data.funnels.map((f) => ({ ...f, stats: stats[f.id] })), products: store.data.products.map((p) => ({ id: p.id, name: p.name, price: store.live(p).price, img: p.images[0] || '', options: (p.options || []).length, active: p.active, status: p.status })) };
  });
  r.post('/api/admin/funnels', async (ctx) => { admin(ctx); return { funnel: store.saveFunnel(await readJson(ctx.req)) }; });
  r.put('/api/admin/funnels/:id', async (ctx) => { admin(ctx); return { funnel: store.saveFunnel(await readJson(ctx.req), ctx.params.id) }; });
  r.post('/api/admin/funnels/:id/duplicate', (ctx) => { admin(ctx); return { funnel: store.duplicateFunnel(ctx.params.id) }; });
  r.delete('/api/admin/funnels/:id', (ctx) => { admin(ctx); store.deleteFunnel(ctx.params.id); return { ok: true }; });

  // Abandoned checkouts
  r.get('/api/admin/abandoned', (ctx) => {
    admin(ctx);
    const now = Date.now(), list = store.data.abandoned;
    const name = (it) => (it.kind === 'box' ? 'Custom gift box' : store.products.get(it.pid)?.name || 'Removed product');
    const stat = { open: 0, contacted: 0, recovered: 0, converted: 0, dismissed: 0, recoveredValue: 0 };
    for (const d of list) { stat[d.status] = (stat[d.status] || 0) + 1; if (d.status === 'recovered') stat.recoveredValue += store.orders.get(d.orderId)?.totals.total || 0; }
    return {
      stats: stat,
      items: list.slice().reverse().slice(0, 500).map((d) => ({ ...d, sid: undefined, age: now - d.updated, lines: d.items.map((it) => ({ name: name(it), qty: it.qty })), funnelName: d.funnel ? store.funnels.get(d.funnel)?.name || null : null })),
      coupon: store.settings.newsletterCoupon,
    };
  });
  r.patch('/api/admin/abandoned/:id', async (ctx) => { admin(ctx); return { item: store.updateDraft(ctx.params.id, await readJson(ctx.req)) }; });

  // Finance: profit & loss, expenses
  r.get('/api/admin/reports/pl', (ctx) => { admin(ctx); return { ...R.profitLoss(store, q(ctx)), categories: EXPENSE_CATEGORIES }; });
  r.get('/api/admin/reports/products.csv', (ctx) => {
    admin(ctx);
    const pl = R.profitLoss(store, q(ctx));
    sendCsv(ctx, `bliss-product-sales-${pl.range.from}-to-${pl.range.to}`, ['Product', 'SKU', 'Units sold', 'Sales (before discounts)', 'Product cost', 'Profit', 'Margin'],
      pl.products.map((x) => [x.name, x.sku, x.units, x.sales, x.known ? x.cogs : '', x.profit ?? '', pct(x.margin)]));
  });
  r.post('/api/admin/expenses', async (ctx) => { admin(ctx); return { expense: store.saveExpense(await readJson(ctx.req)) }; });
  r.put('/api/admin/expenses/:id', async (ctx) => { admin(ctx); return { expense: store.saveExpense(await readJson(ctx.req), ctx.params.id) }; });
  r.delete('/api/admin/expenses/:id', (ctx) => { admin(ctx); store.deleteExpense(ctx.params.id); return { ok: true }; });

  // Settings
  const adminSettings = () => { const { admin: a, ...rest } = store.settings; return { ...rest, admin: { username: a.username, isDefault: !!a.isDefault } }; };
  r.get('/api/admin/settings', (ctx) => {
    admin(ctx);
    return { settings: adminSettings(), products: store.data.products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, price: store.live(p).price, options: (p.options || []).length, status: p.status })), coupons: store.data.coupons.map((c) => c.code) };
  });
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
