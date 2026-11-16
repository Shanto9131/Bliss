// In-memory database with hash-map indexes, persisted to data/db.json with atomic,
// coalesced writes (many changes within 150 ms become one disk write).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { slugify, topK, computeTotals, ORDER_STATUSES } from '../public/assets/js/engine.js';
import { HttpError } from './http.js';
import { hashPassword, verifyPassword } from './auth.js';
import { defaultSettings } from './seed.js';

const STATUS_KEYS = new Set(ORDER_STATUSES.map((s) => s[0]));
const PHONE_RE = /^01[3-9]\d{8}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const DAY = 86_400_000;
const dhakaFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dhakaDate = (ts) => dhakaFmt.format(new Date(ts));

const rid = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const int = (v, min, max, dflt) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
const num = (v, min, max, dflt) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : dflt; };
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
const pickBool = (v, ex, dflt) => (v !== undefined ? bool(v) : ex !== undefined ? ex : dflt);
const arr = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []);
const bad = (msg, field) => new HttpError(400, msg, field ? { field } : undefined);
export const normPhone = (p) => {
  let s = String(p ?? '').replace(/[\s\-()]/g, '');
  if (s.startsWith('+88')) s = s.slice(3); else if (s.startsWith('88') && s.length === 13) s = s.slice(2);
  return s;
};

function deepMerge(base, over) {
  if (over === undefined) return base;
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.version = Date.now(); // catalog version: bumps whenever shoppers would see a change
    this.timer = null; this.writing = false; this.dirty = false;
  }

  async load(seedFn, { reset = false } = {}) {
    fs.mkdirSync(this.dir, { recursive: true });
    let data = null;
    if (!reset && fs.existsSync(this.file)) {
      try { data = JSON.parse(fs.readFileSync(this.file, 'utf8')); fs.copyFileSync(this.file, this.file + '.bak'); }
      catch (e) {
        console.error('! data/db.json is unreadable, trying the backup:', e.message);
        data = JSON.parse(fs.readFileSync(this.file + '.bak', 'utf8'));
      }
    }
    if (!data) { data = await seedFn(); this.data = data; this.flushSync(); }
    for (const k of ['products', 'categories', 'orders', 'users', 'reviews', 'coupons', 'messages', 'subscribers']) data[k] ||= [];
    data.settings = deepMerge(defaultSettings(), data.settings || {});
    this.data = data;
    this.reindex();
  }

  reindex() {
    const d = this.data;
    this.products = new Map(d.products.map((p) => [p.id, p]));
    this.slugs = new Map(d.products.map((p) => [p.slug, p]));
    this.categories = new Map(d.categories.map((c) => [c.id, c]));
    this.orders = new Map(d.orders.map((o) => [o.id, o]));
    this.users = new Map(d.users.map((u) => [u.id, u]));
    this.usersByPhone = new Map(d.users.map((u) => [u.phone, u]));
    this.usersByEmail = new Map(d.users.filter((u) => u.email).map((u) => [u.email, u]));
    this.coupons = new Map(d.coupons.map((c) => [c.code, c]));
    this.reviewsByProduct = new Map();
    for (const r of d.reviews) {
      let list = this.reviewsByProduct.get(r.pid);
      if (!list) this.reviewsByProduct.set(r.pid, (list = []));
      list.push(r);
    }
    for (const p of d.products) this.recomputeRating(p.id);
  }

  /* --------------------------------------------------------- persistence */
  save(catalogChanged = false) {
    if (catalogChanged) this.version = Math.max(Date.now(), this.version + 1);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }
  async flush() {
    if (this.writing) { this.dirty = true; return; }
    this.writing = true;
    try {
      do {
        this.dirty = false;
        const tmp = this.file + '.tmp';
        await fsp.writeFile(tmp, JSON.stringify(this.data));
        try { await fsp.rename(tmp, this.file); }
        catch { await fsp.copyFile(tmp, this.file); await fsp.unlink(tmp).catch(() => {}); } // Windows file-lock fallback
      } while (this.dirty);
    } catch (e) { console.error('! Failed to save database:', e); }
    finally { this.writing = false; }
  }
  flushSync() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    try { fs.renameSync(tmp, this.file); } catch { fs.copyFileSync(tmp, this.file); fs.rmSync(tmp, { force: true }); }
  }

  /* ------------------------------------------------------ public shapes */
  get settings() { return this.data.settings; }
  publicSettings() {
    const s = this.data.settings;
    return {
      store: s.store, announcements: s.announcements, delivery: s.delivery, bundleTiers: s.bundleTiers,
      giftWrapPrice: s.giftWrapPrice, hero: s.hero, stats: s.stats, builder: s.builder,
      payments: { cod: s.payments.cod, bkash: s.payments.bkash, nagad: s.payments.nagad, bkashNumber: s.payments.bkashNumber, nagadNumber: s.payments.nagadNumber, note: s.payments.note },
    };
  }
  publicProduct(p) {
    return {
      id: p.id, slug: p.slug, name: p.name, cat: p.cat, price: p.price, compare: p.compare || 0,
      img: p.images[0] || '/img/placeholder.svg', img2: p.images[1] || null,
      stock: p.status, left: p.status === 'limited' && p.qty != null ? p.qty : null,
      tags: p.tags, gender: p.gender, rating: p.rating || 0, reviews: p.reviewCount || 0, sold: p.sold || 0,
      created: p.created, featured: !!p.featured, boxable: !!p.boxable, options: p.options || [],
      keywords: p.keywords || '',
    };
  }
  catalog() {
    return {
      v: this.version,
      settings: this.publicSettings(),
      categories: [...this.data.categories].sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99)),
      products: this.data.products.filter((p) => p.active).map((p) => this.publicProduct(p)),
      // Real, approved 5-star reviews for the homepage "loved by" section.
      reviews: this.data.reviews.filter((r) => r.approved && r.rating === 5 && r.text.length > 40 && this.products.get(r.pid)?.active)
        .sort((a, b) => b.created - a.created).slice(0, 6).map((r) => ({ name: r.name, text: r.text, rating: r.rating, pid: r.pid })),
    };
  }
  productDetail(slugOrId) {
    const p = this.slugs.get(slugOrId) || this.products.get(slugOrId);
    if (!p || !p.active) return null;
    const reviews = (this.reviewsByProduct.get(p.id) || []).filter((r) => r.approved).sort((a, b) => b.created - a.created);
    const hist = [0, 0, 0, 0, 0];
    for (const r of reviews) hist[5 - r.rating]++;
    return {
      ...this.publicProduct(p), images: p.images.length ? p.images : ['/img/placeholder.svg'],
      desc: p.desc || '', highlights: p.highlights || [], histogram: hist,
      reviewList: reviews.slice(0, 40).map((r) => ({ id: r.id, name: r.name, rating: r.rating, text: r.text, created: r.created })),
    };
  }
  publicOrder(o) {
    const { adminNote, userId, ...rest } = o;
    return rest;
  }
  publicUser(u) { return { id: u.id, name: u.name, phone: u.phone, email: u.email, address: u.address }; }

  /* ------------------------------------------------------------ products */
  _autoStatus(p) {
    if (p.qty == null) return;
    const low = p.lowStock ?? this.data.settings.lowStockDefault ?? 5;
    if (p.autoStock !== false) p.status = p.qty <= 0 ? 'out' : p.qty <= low ? 'limited' : 'in';
    else if (p.qty <= 0) p.status = 'out';
  }
  _uniqueSlug(base, selfId) {
    let slug = base, n = 2;
    while (this.slugs.has(slug) && this.slugs.get(slug).id !== selfId) slug = `${base}-${n++}`;
    return slug;
  }
  _normProduct(inp, ex = {}) {
    const name = str(inp.name ?? ex.name, 120);
    if (name.length < 2) throw bad('Please enter a product name.', 'name');
    const cat = str(inp.cat ?? ex.cat, 60);
    if (!this.categories.has(cat)) throw bad('Please choose a category.', 'cat');
    const price = num(inp.price ?? ex.price, 0, 10_000_000, NaN);
    if (!Number.isFinite(price)) throw bad('Please enter a valid price.', 'price');
    let compare = num(inp.compare ?? ex.compare, 0, 10_000_000, 0);
    if (compare <= price) compare = 0;
    const slug = this._uniqueSlug(slugify(str(inp.slug, 80) || ex.slug || name), ex.id);
    const images = (Array.isArray(inp.images) ? inp.images : ex.images || [])
      .map((x) => str(x, 600)).filter((u) => /^(\/uploads\/|\/img\/|https:\/\/)/.test(u)).slice(0, 10);
    const rawQty = inp.qty !== undefined ? inp.qty : ex.qty;
    const qty = rawQty === null || rawQty === '' || rawQty === undefined ? null : int(rawQty, 0, 1_000_000, null);
    const rawLow = inp.lowStock !== undefined ? inp.lowStock : ex.lowStock;
    const lowStock = rawLow === null || rawLow === '' || rawLow === undefined ? null : int(rawLow, 0, 100_000, null);
    const options = (Array.isArray(inp.options) ? inp.options : ex.options || []).slice(0, 3).map((o) => ({
      name: str(o.name, 30),
      values: [...new Set(arr(o.values).map((v) => str(v, 30)).filter(Boolean))].slice(0, 30),
    })).filter((o) => o.name && o.values.length);
    const highlights = (Array.isArray(inp.highlights) ? inp.highlights : typeof inp.highlights === 'string' ? inp.highlights.split('\n') : ex.highlights || [])
      .map((h) => str(h, 160)).filter(Boolean).slice(0, 10);
    const p = {
      ...ex, name, slug, cat, price, compare,
      desc: str(inp.desc ?? ex.desc, 6000), highlights, images,
      status: ['in', 'limited', 'out'].includes(inp.status) ? inp.status : ex.status || 'in',
      qty, lowStock, autoStock: pickBool(inp.autoStock, ex.autoStock, true),
      tags: [...new Set(arr(inp.tags ?? ex.tags).map((t) => slugify(t)).filter((t) => t && t !== 'item'))].slice(0, 20),
      gender: ['her', 'him', 'unisex', 'kids'].includes(inp.gender) ? inp.gender : ex.gender || 'unisex',
      options, featured: pickBool(inp.featured, ex.featured, false),
      boxable: pickBool(inp.boxable, ex.boxable, false), active: pickBool(inp.active, ex.active, true),
      keywords: str(inp.keywords ?? ex.keywords, 300), updated: Date.now(),
    };
    if (p.qty != null && (p.autoStock || p.qty === 0)) this._autoStatus(p);
    return p;
  }
  createProduct(inp) {
    const p = this._normProduct(inp);
    Object.assign(p, { id: rid('p'), created: Date.now(), sold: 0, rating: 0, reviewCount: 0 });
    this.data.products.push(p); this.products.set(p.id, p); this.slugs.set(p.slug, p);
    this.save(true);
    return p;
  }
  updateProduct(id, inp) {
    const ex = this.products.get(id);
    if (!ex) throw new HttpError(404, 'Product not found.');
    const oldSlug = ex.slug;
    const next = this._normProduct(inp, ex);
    Object.assign(ex, next);
    if (oldSlug !== ex.slug) { this.slugs.delete(oldSlug); this.slugs.set(ex.slug, ex); }
    this.save(true);
    return ex;
  }
  duplicateProduct(id) {
    const ex = this.products.get(id);
    if (!ex) throw new HttpError(404, 'Product not found.');
    return this.createProduct({ ...structuredClone(ex), name: ex.name + ' (copy)', slug: '', active: false });
  }
  deleteProducts(ids) {
    const set = new Set(ids);
    for (const id of set) { const p = this.products.get(id); if (p) { this.slugs.delete(p.slug); this.products.delete(id); this.reviewsByProduct.delete(id); } }
    this.data.products = this.data.products.filter((p) => !set.has(p.id));
    this.data.reviews = this.data.reviews.filter((r) => !set.has(r.pid));
    this.save(true);
  }
  /** One-click stock control from the dashboard. */
  setStock(id, { status, qty }) {
    const p = this.products.get(id);
    if (!p) throw new HttpError(404, 'Product not found.');
    if (qty !== undefined) {
      p.qty = qty === null || qty === '' ? null : int(qty, 0, 1_000_000, p.qty);
      if (p.qty != null) p.autoStock = true; // typing a quantity = "manage the status for me"
      this._autoStatus(p);
    }
    if (status !== undefined) {
      if (!['in', 'limited', 'out'].includes(status)) throw bad('Unknown stock status.');
      p.status = status;
      if (p.qty != null) { p.autoStock = false; if (status !== 'out' && p.qty === 0) p.qty = null; }
    }
    p.updated = Date.now();
    this.save(true);
    return p;
  }
  bulkProducts(ids, action, value) {
    const list = ids.map((id) => this.products.get(id)).filter(Boolean);
    if (action === 'delete') { this.deleteProducts(list.map((p) => p.id)); return list.length; }
    for (const p of list) {
      if (action === 'status') this.setStock(p.id, { status: value });
      else if (action === 'active') p.active = bool(value);
      else if (action === 'featured') p.featured = bool(value);
      else if (action === 'category' && this.categories.has(value)) p.cat = value;
      else throw bad('Unknown bulk action.');
      p.updated = Date.now();
    }
    this.save(true);
    return list.length;
  }

  /* ---------------------------------------------------------- categories */
  saveCategory(inp, id) {
    const ex = id ? this.categories.get(id) : null;
    if (id && !ex) throw new HttpError(404, 'Category not found.');
    const name = str(inp.name ?? ex?.name, 60);
    if (name.length < 2) throw bad('Please enter a category name.', 'name');
    let slug = slugify(str(inp.slug, 60) || ex?.slug || name);
    for (let n = 2; this.data.categories.some((c) => c.slug === slug && c.id !== id); n++) slug = `${slugify(name)}-${n}`;
    const c = {
      ...(ex || {}), name, slug,
      blurb: str(inp.blurb ?? ex?.blurb, 200),
      art: str(inp.art ?? ex?.art ?? 'giftbox', 30),
      image: str(inp.image ?? ex?.image, 600),
      color: /^#[0-9a-f]{6}$/i.test(inp.color) ? inp.color : ex?.color || '#FADDE5',
      sort: int(inp.sort ?? ex?.sort, 0, 999, this.data.categories.length + 1),
      showHome: pickBool(inp.showHome, ex?.showHome, true),
    };
    if (ex) Object.assign(ex, c);
    else { c.id = slugify(name).slice(0, 30) + '-' + crypto.randomBytes(2).toString('hex'); this.data.categories.push(c); this.categories.set(c.id, c); }
    this.save(true);
    return ex || c;
  }
  deleteCategory(id) {
    if (!this.categories.has(id)) throw new HttpError(404, 'Category not found.');
    const n = this.data.products.filter((p) => p.cat === id).length;
    if (n) throw new HttpError(409, `This category still has ${n} product${n > 1 ? 's' : ''}. Move or delete them first.`);
    this.data.categories = this.data.categories.filter((c) => c.id !== id);
    this.categories.delete(id);
    this.save(true);
  }

  /* --------------------------------------------------------------- orders */
  _orderId() {
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    for (;;) {
      let s = 'BL';
      for (const b of crypto.randomBytes(6)) s += A[b % A.length];
      if (!this.orders.has(s)) return s;
    }
  }
  _resolveBox(it, need) {
    const b = this.data.settings.builder;
    const box = b.boxes.find((x) => x.id === it.boxId);
    if (!box) throw new HttpError(409, 'That gift box style is no longer available.');
    const wrap = b.wraps.find((x) => x.id === it.wrapId) || b.wraps[0] || { name: 'Standard', price: 0 };
    const ribbon = b.ribbons.find((x) => x.id === it.ribbonId) || b.ribbons[0] || { name: 'Classic' };
    const ids = Array.isArray(it.items) ? it.items : [];
    if (!ids.length) throw bad('Your gift box is empty. Add at least one item.');
    if (ids.length > box.capacity) throw bad(`The ${box.name} holds up to ${box.capacity} items.`);
    const qty = int(it.qty, 1, 10, 1);
    const comps = []; let price = box.price + (wrap.price || 0);
    for (const pid of ids) {
      const p = this.products.get(String(pid));
      if (!p || !p.active || !p.boxable || (p.options || []).length) throw new HttpError(409, 'An item in your gift box is no longer available.');
      if (p.status === 'out') throw new HttpError(409, `Sorry, "${p.name}" in your gift box just sold out.`);
      need.set(p.id, (need.get(p.id) || 0) + qty);
      comps.push({ pid: p.id, name: p.name, price: p.price });
      price += p.price;
    }
    return {
      kind: 'box', pid: 'box:' + box.id, name: `Custom ${box.name}`, slug: '', img: '/img/box.svg', price, qty, options: {},
      box: { id: box.id, name: box.name, wrap: wrap.name, ribbon: ribbon.name, to: str(it.to, 60), from: str(it.from, 60), note: str(it.note, 300), items: comps },
    };
  }
  placeOrder(inp, userId) {
    const s = this.data.settings;
    const items = Array.isArray(inp.items) ? inp.items.slice(0, 40) : [];
    if (!items.length) throw bad('Your bag is empty.');
    const c = inp.customer || {};
    const name = str(c.name, 80);
    if (name.length < 2) throw bad('Please enter your full name.', 'name');
    const phone = normPhone(c.phone);
    if (!PHONE_RE.test(phone)) throw bad('Please enter a valid mobile number, e.g. 01712345678.', 'phone');
    const email = str(c.email, 120).toLowerCase();
    if (email && !EMAIL_RE.test(email)) throw bad('Please enter a valid email address.', 'email');
    const a = inp.address || {};
    const line = str(a.line, 300);
    if (line.length < 5) throw bad('Please enter the full delivery address.', 'line');
    const city = str(a.city, 60);
    if (city.length < 2) throw bad('Please enter the city / district.', 'city');
    const area = str(a.area, 80);
    const zone = a.zone === 'outside' ? 'outside' : 'inside';
    let recipient = null;
    if (inp.recipient && (inp.recipient.name || inp.recipient.phone)) {
      recipient = { name: str(inp.recipient.name, 80), phone: normPhone(inp.recipient.phone) };
      if (recipient.name.length < 2) throw bad("Please enter the recipient's name.", 'rname');
      if (!PHONE_RE.test(recipient.phone)) throw bad("Please enter the recipient's mobile number.", 'rphone');
    }
    const dlv = inp.delivery || {};
    const method = dlv.method === 'express' ? 'express' : 'standard';
    if (method === 'express' && zone !== 'inside') throw bad(`Express delivery is available in ${s.delivery.expressAreas} only.`, 'method');
    const today = dhakaDate(Date.now());
    let date = /^\d{4}-\d{2}-\d{2}$/.test(dlv.date || '') ? dlv.date : null;
    if (date && (date < today || date > dhakaDate(Date.now() + 60 * DAY))) throw bad('Please choose a delivery date within the next 60 days.', 'date');
    if (method === 'express') date = today;
    const slot = ['morning', 'afternoon', 'evening'].includes(dlv.slot) ? dlv.slot : null;
    const gift = { wrap: bool(inp.gift?.wrap), message: str(inp.gift?.message, 300), hidePrice: bool(inp.gift?.hidePrice) };
    const pm = ['cod', 'bkash', 'nagad'].includes(inp.payment?.method) ? inp.payment.method : 'cod';
    if (!s.payments[pm]) throw bad('That payment method is not available right now.', 'payment');
    const trxId = str(inp.payment?.trxId, 30).toUpperCase().replace(/\s/g, '');
    if (pm !== 'cod' && !/^[A-Z0-9]{6,30}$/.test(trxId)) throw bad('Please enter the Transaction ID from your payment.', 'trx');

    // Resolve every line from the database (never trust prices sent by the browser).
    const need = new Map(); const lines = [];
    for (const it of items) {
      if (it.kind === 'box') { lines.push(this._resolveBox(it, need)); continue; }
      const p = this.products.get(String(it.pid));
      if (!p || !p.active) throw new HttpError(409, 'An item in your bag is no longer available. Please remove it and try again.');
      if (p.status === 'out') throw new HttpError(409, `Sorry, "${p.name}" just sold out. Please remove it from your bag.`);
      const qty = int(it.qty, 1, 20, 1);
      const options = {};
      for (const o of p.options || []) {
        const v = it.options?.[o.name];
        if (!o.values.includes(v)) throw bad(`Please choose a ${o.name.toLowerCase()} for "${p.name}".`);
        options[o.name] = v;
      }
      need.set(p.id, (need.get(p.id) || 0) + qty);
      lines.push({ kind: 'product', pid: p.id, name: p.name, slug: p.slug, img: p.images[0] || '', price: p.price, qty, options });
    }
    for (const [pid, q] of need) {
      const p = this.products.get(pid);
      if (p.qty != null && q > p.qty) throw new HttpError(409, p.qty > 0 ? `Only ${p.qty} left of "${p.name}". Please reduce the quantity.` : `Sorry, "${p.name}" just sold out.`);
    }
    let coupon = null;
    const code = str(inp.coupon, 30).toUpperCase();
    if (code) {
      const v = this.checkCoupon(code);
      if (!v.ok) throw new HttpError(409, v.message, { field: 'coupon' });
      coupon = v.coupon;
    }
    const t = computeTotals(lines, { settings: s, coupon, zone, express: method === 'express', giftWrap: gift.wrap });
    if (inp.expectedTotal != null && !(Math.abs(Number(inp.expectedTotal) - t.total) <= 0.5)) {
      throw new HttpError(409, 'Some prices changed while you were shopping. Please check the updated total and place the order again.', { totals: t });
    }
    // Commit: reserve stock, count sales.
    for (const [pid, q] of need) {
      const p = this.products.get(pid);
      p.sold = (p.sold || 0) + q;
      if (p.qty != null) { p.qty = Math.max(0, p.qty - q); this._autoStatus(p); }
    }
    if (coupon && t.discountType === 'coupon') coupon.used = (coupon.used || 0) + 1;
    const now = Date.now();
    const order = {
      id: this._orderId(), created: now, updated: now, userId: userId || null,
      customer: { name, phone, email }, recipient, address: { line, area, city, zone },
      delivery: { method, date, slot }, gift, items: lines,
      totals: { count: t.count, subtotal: t.subtotal, discount: t.discount, discountLabel: t.discountLabel, delivery: t.delivery, wrap: t.wrap, total: t.total },
      coupon: t.discountType === 'coupon' ? coupon.code : null,
      payment: { method: pm, trxId: pm === 'cod' ? '' : trxId, status: 'unpaid' },
      status: 'pending', timeline: [{ status: 'pending', at: now, note: '' }],
      note: str(inp.note, 500), adminNote: '',
    };
    this.data.orders.push(order); this.orders.set(order.id, order);
    this.save(true);
    return order;
  }
  _restock(o, dir) { // dir = +1 returns stock (cancel), -1 reserves again (un-cancel)
    const adj = (pid, q) => {
      const p = this.products.get(pid); if (!p) return;
      p.sold = Math.max(0, (p.sold || 0) - dir * q);
      if (p.qty != null) { p.qty = Math.max(0, p.qty + dir * q); this._autoStatus(p); }
    };
    for (const l of o.items) {
      if (l.kind === 'box') for (const c of l.box.items) adj(c.pid, l.qty); else adj(l.pid, l.qty);
    }
  }
  updateOrder(id, patch) {
    const o = this.orders.get(id);
    if (!o) throw new HttpError(404, 'Order not found.');
    let stock = false;
    const note = str(patch.note, 300);
    if (patch.status && STATUS_KEYS.has(patch.status) && patch.status !== o.status) {
      if (patch.status === 'cancelled') { this._restock(o, +1); stock = true; }
      else if (o.status === 'cancelled') { this._restock(o, -1); stock = true; }
      o.status = patch.status;
      o.timeline.push({ status: o.status, at: Date.now(), note });
    } else if (note) o.timeline.push({ status: o.status, at: Date.now(), note });
    if (['paid', 'unpaid', 'refunded'].includes(patch.paymentStatus)) o.payment.status = patch.paymentStatus;
    if (patch.adminNote !== undefined) o.adminNote = str(patch.adminNote, 1000);
    o.updated = Date.now();
    this.save(stock);
    return o;
  }
  deleteOrder(id) {
    const o = this.orders.get(id);
    if (!o) throw new HttpError(404, 'Order not found.');
    if (o.status !== 'cancelled' && o.status !== 'delivered') this._restock(o, +1);
    this.orders.delete(id);
    this.data.orders = this.data.orders.filter((x) => x.id !== id);
    this.save(true);
  }
  trackOrder(id, phone) {
    const o = this.orders.get(str(id, 20).toUpperCase().replace(/[^A-Z0-9]/g, ''));
    const ph = normPhone(phone);
    if (!o || (ph !== o.customer.phone && ph !== o.recipient?.phone)) return null;
    return this.publicOrder(o);
  }

  /* -------------------------------------------------------------- coupons */
  checkCoupon(code) {
    const c = this.coupons.get(str(code, 30).toUpperCase());
    if (!c || !c.active) return { ok: false, message: 'This coupon code is not valid.' };
    if (c.expires && dhakaDate(Date.now()) > c.expires) return { ok: false, message: 'This coupon has expired.' };
    if (c.maxUses && (c.used || 0) >= c.maxUses) return { ok: false, message: 'This coupon has already been fully used.' };
    return { ok: true, coupon: c };
  }
  publicCoupon(c) { return { code: c.code, type: c.type, value: c.value, minSubtotal: c.minSubtotal || 0, maxDiscount: c.maxDiscount || 0 }; }
  saveCoupon(inp, code) {
    const ex = code ? this.coupons.get(code) : null;
    if (code && !ex) throw new HttpError(404, 'Coupon not found.');
    const newCode = str(inp.code ?? ex?.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (newCode.length < 3) throw bad('Coupon code must be at least 3 letters or numbers.', 'code');
    if (newCode !== code && this.coupons.has(newCode)) throw new HttpError(409, 'A coupon with this code already exists.');
    const type = inp.type === 'fixed' ? 'fixed' : 'percent';
    const value = num(inp.value, 0, type === 'percent' ? 100 : 1_000_000, NaN);
    if (!Number.isFinite(value) || value <= 0) throw bad('Please enter the discount amount.', 'value');
    const c = {
      ...(ex || { used: 0, created: Date.now() }), code: newCode, type, value,
      minSubtotal: num(inp.minSubtotal, 0, 10_000_000, 0), maxDiscount: num(inp.maxDiscount, 0, 10_000_000, 0),
      expires: /^\d{4}-\d{2}-\d{2}$/.test(inp.expires || '') ? inp.expires : null,
      maxUses: inp.maxUses ? int(inp.maxUses, 1, 1_000_000, null) : null,
      active: pickBool(inp.active, ex?.active, true),
    };
    if (ex) { Object.assign(ex, c); if (newCode !== code) { this.coupons.delete(code); this.coupons.set(newCode, ex); } }
    else { this.data.coupons.push(c); this.coupons.set(newCode, c); }
    this.save();
    return ex || c;
  }
  deleteCoupon(code) {
    if (!this.coupons.delete(code)) throw new HttpError(404, 'Coupon not found.');
    this.data.coupons = this.data.coupons.filter((c) => c.code !== code);
    this.save();
  }

  /* -------------------------------------------------------------- reviews */
  recomputeRating(pid) {
    const p = this.products.get(pid); if (!p) return;
    const list = (this.reviewsByProduct.get(pid) || []).filter((r) => r.approved);
    p.reviewCount = list.length;
    p.rating = list.length ? Math.round((list.reduce((s, r) => s + r.rating, 0) / list.length) * 10) / 10 : 0;
  }
  addReview(pid, inp) {
    const p = this.products.get(pid);
    if (!p || !p.active) throw new HttpError(404, 'Product not found.');
    const name = str(inp.name, 60), text = str(inp.text, 1500), rating = int(inp.rating, 1, 5, 0);
    if (name.length < 2) throw bad('Please enter your name.', 'name');
    if (!rating) throw bad('Please choose a star rating.', 'rating');
    if (text.length < 4) throw bad('Please write a few words about the product.', 'text');
    const r = { id: rid('r'), pid, name, rating, text, created: Date.now(), approved: !!this.data.settings.reviewsAutoApprove };
    this.data.reviews.push(r);
    let list = this.reviewsByProduct.get(pid);
    if (!list) this.reviewsByProduct.set(pid, (list = []));
    list.push(r);
    this.recomputeRating(pid);
    this.save(r.approved);
    return r;
  }
  moderateReview(id, approved) {
    const r = this.data.reviews.find((x) => x.id === id);
    if (!r) throw new HttpError(404, 'Review not found.');
    r.approved = bool(approved);
    this.recomputeRating(r.pid);
    this.save(true);
    return r;
  }
  deleteReview(id) {
    const r = this.data.reviews.find((x) => x.id === id);
    if (!r) throw new HttpError(404, 'Review not found.');
    this.data.reviews = this.data.reviews.filter((x) => x.id !== id);
    const list = this.reviewsByProduct.get(r.pid);
    if (list) this.reviewsByProduct.set(r.pid, list.filter((x) => x.id !== id));
    this.recomputeRating(r.pid);
    this.save(true);
  }

  /* ---------------------------------------------------------------- users */
  async register(inp) {
    const name = str(inp.name, 80), phone = normPhone(inp.phone), email = str(inp.email, 120).toLowerCase();
    const password = String(inp.password || '');
    if (name.length < 2) throw bad('Please enter your name.', 'name');
    if (!PHONE_RE.test(phone)) throw bad('Please enter a valid mobile number, e.g. 01712345678.', 'phone');
    if (email && !EMAIL_RE.test(email)) throw bad('Please enter a valid email address.', 'email');
    if (password.length < 6) throw bad('Password must be at least 6 characters.', 'password');
    if (this.usersByPhone.has(phone)) throw new HttpError(409, 'An account with this mobile number already exists. Please log in.');
    if (email && this.usersByEmail.has(email)) throw new HttpError(409, 'An account with this email already exists. Please log in.');
    const u = { id: rid('u'), name, phone, email, pass: await hashPassword(password), address: { line: '', area: '', city: '', zone: 'inside' }, created: Date.now() };
    this.data.users.push(u); this.users.set(u.id, u); this.usersByPhone.set(phone, u);
    if (email) this.usersByEmail.set(email, u);
    this.save();
    return u;
  }
  async login(login, password) {
    const l = str(login, 120).toLowerCase();
    const u = this.usersByPhone.get(normPhone(l)) || this.usersByEmail.get(l);
    const ok = await verifyPassword(password, u ? u.pass : 's1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    if (!u || !ok) throw new HttpError(401, 'Wrong mobile number / email or password.');
    return u;
  }
  updateProfile(id, inp) {
    const u = this.users.get(id);
    if (!u) throw new HttpError(401, 'Please log in again.');
    const name = str(inp.name ?? u.name, 80);
    if (name.length < 2) throw bad('Please enter your name.', 'name');
    const email = str(inp.email ?? u.email, 120).toLowerCase();
    if (email && !EMAIL_RE.test(email)) throw bad('Please enter a valid email address.', 'email');
    if (email && email !== u.email && this.usersByEmail.has(email)) throw new HttpError(409, 'That email is used by another account.');
    if (u.email) this.usersByEmail.delete(u.email);
    u.name = name; u.email = email;
    if (email) this.usersByEmail.set(email, u);
    const a = inp.address || {};
    u.address = { line: str(a.line ?? u.address?.line, 300), area: str(a.area ?? u.address?.area, 80), city: str(a.city ?? u.address?.city, 60), zone: a.zone === 'outside' ? 'outside' : 'inside' };
    this.save();
    return u;
  }
  userOrders(id) {
    const out = [];
    for (let i = this.data.orders.length - 1; i >= 0 && out.length < 100; i--) {
      const o = this.data.orders[i];
      if (o.userId === id) out.push(this.publicOrder(o));
    }
    return out;
  }

  /* ------------------------------------------------- messages & newsletter */
  addMessage(inp) {
    const type = inp.type === 'corporate' ? 'corporate' : 'support';
    const name = str(inp.name, 80), phone = normPhone(inp.phone), email = str(inp.email, 120).toLowerCase();
    const message = str(inp.message, 3000);
    if (name.length < 2) throw bad('Please enter your name.', 'name');
    if (!PHONE_RE.test(phone) && !EMAIL_RE.test(email)) throw bad('Please give us a mobile number or email so we can reply.', 'phone');
    if (message.length < 5 && type === 'support') throw bad('Please write your message.', 'message');
    const m = {
      id: rid('m'), type, name, phone: PHONE_RE.test(phone) ? phone : '', email: EMAIL_RE.test(email) ? email : '',
      subject: str(inp.subject, 120), message, created: Date.now(), read: false,
      meta: type === 'corporate' ? { company: str(inp.company, 120), quantity: str(inp.quantity, 20), budget: str(inp.budget, 40), date: str(inp.date, 20) } : {},
    };
    this.data.messages.push(m);
    this.save();
    return m;
  }
  subscribe(emailRaw) {
    const email = str(emailRaw, 120).toLowerCase();
    if (!EMAIL_RE.test(email)) throw bad('Please enter a valid email address.', 'email');
    if (!this.data.subscribers.some((s) => s.email === email)) { this.data.subscribers.push({ email, created: Date.now() }); this.save(); }
    const code = this.data.settings.newsletterCoupon;
    return code && this.checkCoupon(code).ok ? code : null;
  }

  /* ----------------------------------------------------------- dashboard */
  stats() {
    const now = Date.now(), orders = this.data.orders;
    const today = dhakaDate(now), month = today.slice(0, 7);
    const series = new Map();
    for (let i = 29; i >= 0; i--) series.set(dhakaDate(now - i * DAY), { revenue: 0, orders: 0 });
    let revenue = 0, monthRevenue = 0, todayRevenue = 0, validCount = 0;
    const byStatus = Object.fromEntries(ORDER_STATUSES.map(([k]) => [k, 0]));
    const units = new Map();
    for (const o of orders) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      if (o.status === 'cancelled') continue;
      validCount++;
      const day = dhakaDate(o.created), total = o.totals.total;
      revenue += total;
      if (day.startsWith(month)) monthRevenue += total;
      if (day === today) todayRevenue += total;
      const b = series.get(day); if (b) { b.revenue += total; b.orders++; }
      for (const l of o.items) {
        const key = l.kind === 'box' ? l.pid : l.pid;
        let u = units.get(key);
        if (!u) units.set(key, (u = { pid: l.pid, name: l.name, img: l.img, units: 0, revenue: 0 }));
        u.units += l.qty; u.revenue += l.price * l.qty;
      }
    }
    const stock = { in: 0, limited: 0, out: 0 };
    const low = [];
    for (const p of this.data.products) {
      stock[p.status] = (stock[p.status] || 0) + 1;
      if (p.status !== 'in') low.push(p);
    }
    low.sort((a, b) => (a.status === 'out' ? 0 : 1) - (b.status === 'out' ? 0 : 1) || (a.qty ?? 99) - (b.qty ?? 99));
    return {
      revenue, monthRevenue, todayRevenue, orders: orders.length, validOrders: validCount,
      aov: validCount ? Math.round(revenue / validCount) : 0, byStatus,
      products: this.data.products.length, stock,
      lowStock: low.slice(0, 8).map((p) => ({ id: p.id, name: p.name, img: p.images[0], status: p.status, qty: p.qty })),
      top: topK(units.values(), 5, (u) => u.units),
      series: [...series].map(([date, v]) => ({ date, ...v })),
      recent: orders.slice(-8).reverse().map((o) => ({ id: o.id, created: o.created, name: o.customer.name, total: o.totals.total, status: o.status, payment: o.payment.method })),
      unread: this.data.messages.filter((m) => !m.read).length,
      pendingReviews: this.data.reviews.filter((r) => !r.approved).length,
      customers: new Set(orders.map((o) => o.customer.phone)).size,
      subscribers: this.data.subscribers.length,
    };
  }
  customers() {
    const m = new Map();
    for (const o of this.data.orders) {
      const k = o.customer.phone;
      let c = m.get(k);
      if (!c) m.set(k, (c = { phone: k, name: o.customer.name, email: o.customer.email, orders: 0, spent: 0, first: o.created, last: o.created, registered: false, city: o.address.city }));
      c.orders++; c.name = o.customer.name; c.email = o.customer.email || c.email; c.city = o.address.city;
      if (o.status !== 'cancelled') c.spent += o.totals.total;
      c.last = Math.max(c.last, o.created);
    }
    for (const u of this.data.users) {
      let c = m.get(u.phone);
      if (!c) m.set(u.phone, (c = { phone: u.phone, name: u.name, email: u.email, orders: 0, spent: 0, first: u.created, last: u.created, city: u.address?.city || '' }));
      c.registered = true;
    }
    return [...m.values()].sort((a, b) => b.spent - a.spent || b.last - a.last);
  }

  /* ------------------------------------------------------------ settings */
  updateSettings(inp) {
    const s = this.data.settings;
    const text = (o, keys, max = 200) => Object.fromEntries(keys.map((k) => [k, str(o?.[k], max)]));
    if (inp.store) s.store = { ...s.store, ...text(inp.store, ['name', 'tagline', 'phone', 'whatsapp', 'email', 'address', 'hours', 'facebook', 'instagram', 'tiktok', 'messenger'], 300) };
    if (Array.isArray(inp.announcements)) s.announcements = inp.announcements.map((a) => str(a, 140)).filter(Boolean).slice(0, 6);
    if (inp.delivery) {
      const d = inp.delivery;
      s.delivery = {
        ...s.delivery,
        inside: num(d.inside, 0, 100_000, s.delivery.inside), outside: num(d.outside, 0, 100_000, s.delivery.outside),
        express: num(d.express, 0, 100_000, s.delivery.express), freeOver: num(d.freeOver, 0, 10_000_000, s.delivery.freeOver),
        expressHours: int(d.expressHours, 1, 72, s.delivery.expressHours), cutoffHour: int(d.cutoffHour, 0, 23, s.delivery.cutoffHour),
        expressAreas: str(d.expressAreas ?? s.delivery.expressAreas, 120),
      };
    }
    if (Array.isArray(inp.bundleTiers)) s.bundleTiers = inp.bundleTiers.map((t) => ({ min: int(t.min, 2, 100, 0), pct: num(t.pct, 0, 90, 0) })).filter((t) => t.min && t.pct).slice(0, 5);
    if (inp.giftWrapPrice !== undefined) s.giftWrapPrice = num(inp.giftWrapPrice, 0, 100_000, s.giftWrapPrice);
    if (inp.lowStockDefault !== undefined) s.lowStockDefault = int(inp.lowStockDefault, 0, 10_000, s.lowStockDefault);
    if (inp.reviewsAutoApprove !== undefined) s.reviewsAutoApprove = bool(inp.reviewsAutoApprove);
    if (inp.newsletterCoupon !== undefined) s.newsletterCoupon = str(inp.newsletterCoupon, 30).toUpperCase();
    if (inp.payments) {
      const p = inp.payments;
      s.payments = { ...s.payments, cod: pickBool(p.cod, s.payments.cod), bkash: pickBool(p.bkash, s.payments.bkash), nagad: pickBool(p.nagad, s.payments.nagad), bkashNumber: str(p.bkashNumber ?? s.payments.bkashNumber, 30), nagadNumber: str(p.nagadNumber ?? s.payments.nagadNumber, 30), note: str(p.note ?? s.payments.note, 300) };
      if (!s.payments.cod && !s.payments.bkash && !s.payments.nagad) s.payments.cod = true;
    }
    if (inp.hero) s.hero = { ...s.hero, ...text(inp.hero, ['eyebrow', 'title', 'subtitle', 'cta', 'ctaLink', 'cta2', 'cta2Link'], 240) };
    if (inp.stats) s.stats = { ...s.stats, ...text(inp.stats, ['customers', 'rating', 'delivered'], 20) };
    if (inp.builder) {
      const b = inp.builder;
      const id = (v, i, pre) => slugify(str(v, 30)) || `${pre}${i}`;
      if (Array.isArray(b.boxes)) s.builder.boxes = b.boxes.slice(0, 8).map((x, i) => ({ id: id(x.id || x.name, i, 'box'), name: str(x.name, 40) || `Box ${i + 1}`, price: num(x.price, 0, 100_000, 0), capacity: int(x.capacity, 1, 20, 4), desc: str(x.desc, 120), color: /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : '#F4C6D0' }));
      if (Array.isArray(b.wraps)) s.builder.wraps = b.wraps.slice(0, 10).map((x, i) => ({ id: id(x.id || x.name, i, 'wrap'), name: str(x.name, 40) || `Wrap ${i + 1}`, price: num(x.price, 0, 100_000, 0), color: /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : '#F4C6D0' }));
      if (Array.isArray(b.ribbons)) s.builder.ribbons = b.ribbons.slice(0, 10).map((x, i) => ({ id: id(x.id || x.name, i, 'ribbon'), name: str(x.name, 40) || `Ribbon ${i + 1}`, color: /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : '#C0392B' }));
    }
    this.save(true);
    return s;
  }
  /** Removes sample data: 'activity' = demo orders/reviews/messages, 'products' = demo products too. */
  clearDemo(what) {
    const d = this.data;
    d.orders = d.orders.filter((o) => !o.demo);
    d.reviews = d.reviews.filter((r) => !r.demo);
    d.messages = d.messages.filter((m) => !m.demo);
    for (const p of d.products) if (p.demo) p.sold = 0;
    if (what === 'products') {
      const gone = new Set(d.products.filter((p) => p.demo).map((p) => p.id));
      d.products = d.products.filter((p) => !gone.has(p.id));
      d.reviews = d.reviews.filter((r) => !gone.has(r.pid));
    }
    this.reindex();
    this.save(true);
    return { products: d.products.length, orders: d.orders.length };
  }
  async adminLogin(username, password) {
    const a = this.data.settings.admin;
    const ok = await verifyPassword(password, a.password);
    if (!ok || str(username, 60).toLowerCase() !== a.username.toLowerCase()) throw new HttpError(401, 'Wrong username or password.');
    return a;
  }
  async setAdminPassword(current, next, username) {
    const a = this.data.settings.admin;
    if (!(await verifyPassword(current, a.password))) throw new HttpError(401, 'Your current password is not correct.');
    if (String(next || '').length < 8) throw bad('The new password must be at least 8 characters.', 'next');
    a.password = await hashPassword(next);
    if (username && str(username, 60).length >= 3) a.username = str(username, 60);
    a.pv = (a.pv || 1) + 1; a.isDefault = false;
    this.save();
    return a;
  }
}
