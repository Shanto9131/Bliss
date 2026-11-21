// In-memory database with hash-map indexes, persisted to data/db.json with atomic,
// coalesced writes (many changes within 150 ms become one disk write).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { slugify, computeTotals, ORDER_STATUSES, INACTIVE_STATUSES, funnelSettings, SHEET_FIELDS, sheetKey } from '../public/assets/js/engine.js';
import { HttpError } from './http.js';
import { hashPassword, verifyPassword } from './auth.js';
import { defaultSettings, demoCost, demoFunnels } from './seed.js';
import { STARTER_CATEGORIES, STARTER_PRODUCTS } from './catalog.js';

const STATUS_KEYS = new Set(ORDER_STATUSES.map((s) => s[0]));
const PHONE_RE = /^01[3-9]\d{8}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const DAY = 86_400_000;
const dhakaFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dhakaDate = (ts) => dhakaFmt.format(new Date(ts));
export const MANUAL_CHANNELS = ['phone', 'facebook', 'instagram', 'whatsapp', 'walk-in', 'other'];
export const EXPENSE_CATEGORIES = ['ads', 'packaging', 'courier', 'salaries', 'rent', 'utilities', 'stock', 'software', 'other'];
const STOCK_REASONS = new Set(['count', 'damaged', 'lost', 'gift', 'return', 'other']);
// Spreadsheet import: words people type, mapped to stored values (keys as sheetKey() makes them).
const SHEET_STOCK = { in: 'In stock', limited: 'Limited stock', out: 'Out of stock' };
const STOCK_WORDS = { in: 'in', instock: 'in', available: 'in', yes: 'in', limited: 'limited', limitedstock: 'limited', low: 'limited', lowstock: 'limited', out: 'out', outofstock: 'out', soldout: 'out', no: 'out', unavailable: 'out' };
const GENDER_WORDS = { her: 'her', forher: 'her', women: 'her', woman: 'her', female: 'her', girl: 'her', girls: 'her', him: 'him', forhim: 'him', men: 'him', man: 'him', male: 'him', boy: 'him', boys: 'him', unisex: 'unisex', everyone: 'unisex', all: 'unisex', anyone: 'unisex', kids: 'kids', kid: 'kids', children: 'kids', child: 'kids', baby: 'kids' };
const YES = /^(yes|y|true|1|on|visible|show|shown|active|published)$/i, NO = /^(no|n|false|0|off|hidden|hide|inactive|draft)$/i;
const emptyToNull = (v) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? null : v);
const sameVal = (a, b) => JSON.stringify(emptyToNull(a)) === JSON.stringify(emptyToNull(b));
const DIFF_FIELDS = [['name', 'Name'], ['cat', 'Category'], ['price', 'Price'], ['compare', 'Compare-at price'], ['cost', 'Cost'], ['qty', 'Quantity'], ['status', 'Stock status'], ['active', 'Visible'], ['featured', 'Featured'], ['gender', 'For'], ['tags', 'Occasions'], ['options', 'Options'], ['highlights', 'Highlights'], ['desc', 'Description'], ['images', 'Photos'], ['keywords', 'Keywords'], ['supplier', 'Supplier'], ['sku', 'SKU'], ['slug', 'URL handle']];

const rid = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const int = (v, min, max, dflt) => { const n = Math.floor(Number(v)); return v !== '' && v != null && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
const num = (v, min, max, dflt) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : dflt; };
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
const pickBool = (v, ex, dflt) => (v !== undefined ? bool(v) : ex !== undefined ? ex : dflt);
const arr = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []);
const bad = (msg, field) => new HttpError(400, msg, field ? { field } : undefined);
const url = (v) => { const s = str(v, 600); return /^(\/uploads\/|\/img\/|https:\/\/)/.test(s) ? s : ''; };
const link = (v) => { const s = str(v, 300); return /^(\/(?!\/)|https:\/\/)/.test(s) ? s : ''; };
/** "2026-11-20T23:59" (Dhaka local, from a datetime-local input) -> "2026-11-20T23:59:00+06:00". */
const dhakaDateTime = (v) => {
  const s = str(v, 40);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m && Number.isFinite(Date.parse(`${m[1]}T${m[2]}:00+06:00`)) ? `${m[1]}T${m[2]}:00+06:00` : null;
};
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
    this.timer = null; this.lazyTimer = null; this.writing = false; this.dirty = false;
    this._seen = { day: '', set: new Set() };
    this._saleSig = '';
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
    for (const k of ['products', 'categories', 'orders', 'users', 'reviews', 'coupons', 'messages', 'subscribers', 'funnels', 'leads', 'abandoned', 'expenses', 'stockLog']) data[k] ||= [];
    data.customerNotes ||= {};
    data.analytics ||= { days: {} };
    data.analytics.days ||= {};
    data.meta ||= { schema: 1 };
    data.settings = deepMerge(defaultSettings(), data.settings || {});
    this.data = data;
    this.migrate();
    this.reindex();
    this._saleSig = this._endedSales();
    if (!this._sweep) { this._sweep = setInterval(() => this.sweepSales(), 60_000); this._sweep.unref?.(); }
  }

  /** One-time upgrades of older databases. */
  migrate() {
    const d = this.data;
    if ((d.meta.schema || 1) < 2) {
      // Demo products get an estimated purchase cost so the profit reports have something to show.
      d.products.forEach((p, i) => {
        if (p.demo && p.cost == null) p.cost = demoCost(p.price);
        if (p.demo && !p.sku) p.sku = 'BL-' + String(i + 1).padStart(3, '0');
      });
      for (const o of d.orders) if (o.demo) for (const l of o.items) if (l.cost == null && l.kind !== 'box') l.cost = d.products.find((p) => p.id === l.pid)?.cost ?? null;
      if (!d.funnels.length && d.products.some((p) => p.demo)) d.funnels = demoFunnels(d.products);
      d.meta.schema = 2;
      this.save();
    }
    if (d.meta.schema < 3) {
      // BLISS's own catalogue (server/catalog.js): Bouquets and Attar. Runs once per database.
      this.reindex();
      for (const c of STARTER_CATEGORIES) if (!d.categories.some((x) => x.slug === c.slug)) this.saveCategory(c);
      const res = this.importProducts(STARTER_PRODUCTS, { commit: true, existing: 'skip' });
      if (res.failed.length) console.warn('! Some starter products could not be added:', res.failed);
      d.meta.schema = 3;
      this.save(true);
    }
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
    this.funnels = new Map(d.funnels.map((f) => [f.id, f]));
    this.funnelSlugs = new Map(d.funnels.map((f) => [f.slug, f]));
    this.reviewsByProduct = new Map();
    for (const r of d.reviews) {
      let list = this.reviewsByProduct.get(r.pid);
      if (!list) this.reviewsByProduct.set(r.pid, (list = []));
      list.push(r);
    }
    for (const p of d.products) this.recomputeRating(p.id);
  }

  /* --------------------------------------------------------- persistence */
  /** Coalesces writes: the first change schedules one write 150 ms later (never postponed). */
  save(catalogChanged = false) {
    if (catalogChanged) this.version = Math.max(Date.now(), this.version + 1);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 150);
  }
  /** For high-frequency, low-value changes (visit counters): written within 5 s. */
  saveLazy() {
    if (!this.timer && !this.lazyTimer) this.lazyTimer = setTimeout(() => { this.lazyTimer = null; this.flush(); }, 5000);
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
    clearTimeout(this.timer); clearTimeout(this.lazyTimer); this.timer = null; this.lazyTimer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    try { fs.renameSync(tmp, this.file); } catch { fs.copyFileSync(tmp, this.file); fs.rmSync(tmp, { force: true }); }
  }

  /* ------------------------------------------------------ pricing & sales */
  /** Current selling price: when a timed sale ends, the price goes back to the compare-at price. */
  live(p, now = Date.now()) {
    const onSale = p.compare > p.price;
    if (onSale && p.saleEnds && now > Date.parse(p.saleEnds)) return { price: p.compare, compare: 0, ends: null };
    return { price: p.price, compare: onSale ? p.compare : 0, ends: onSale && p.saleEnds ? p.saleEnds : null };
  }
  _endedSales() { const now = Date.now(); return this.data.products.filter((p) => p.saleEnds && p.compare > p.price && now > Date.parse(p.saleEnds)).map((p) => p.id).join(','); }
  /** Runs every minute: when a timed sale ends, shoppers get fresh prices. */
  sweepSales() { const sig = this._endedSales(); if (sig !== this._saleSig) { this._saleSig = sig; this.version = Math.max(Date.now(), this.version + 1); } }

  /* ------------------------------------------------------ public shapes */
  get settings() { return this.data.settings; }
  publicBoosters() {
    const b = this.data.settings.boosters, ok = (cfg) => {
      const p = cfg?.enabled && this.products.get(cfg.pid);
      return p && p.active && p.status !== 'out' && !(p.options || []).length ? { pid: p.id, price: cfg.price, title: cfg.title } : null;
    };
    return {
      proof: !!b.proof, soldCount: !!b.soldCount, chat: !!b.chat, fbt: !!b.fbt, capture: !!b.capture,
      popup: b.popup.enabled ? { delay: b.popup.delay, exit: !!b.popup.exit, ask: b.popup.ask, title: b.popup.title, text: b.popup.text, hasCoupon: !!(b.popup.coupon && this.checkCoupon(b.popup.coupon).ok) } : null,
      bump: ok(b.bump), upsell: ok(b.upsell) ? { ...ok(b.upsell), minutes: b.upsell.minutes } : null,
      campaign: b.campaign.enabled && b.campaign.text && (!b.campaign.ends || Date.parse(b.campaign.ends) > Date.now()) ? { text: b.campaign.text, ends: b.campaign.ends, coupon: b.campaign.coupon, link: b.campaign.link } : null,
    };
  }
  publicSettings() {
    const s = this.data.settings;
    return {
      store: s.store, announcements: s.announcements, delivery: s.delivery, bundleTiers: s.bundleTiers,
      giftWrapPrice: s.giftWrapPrice, hero: s.hero, stats: s.stats, builder: s.builder,
      payments: { cod: s.payments.cod, bkash: s.payments.bkash, nagad: s.payments.nagad, bkashNumber: s.payments.bkashNumber, nagadNumber: s.payments.nagadNumber, note: s.payments.note },
      boosters: this.publicBoosters(), tracking: s.tracking,
    };
  }
  publicProduct(p, recent) {
    const lv = this.live(p);
    return {
      id: p.id, slug: p.slug, name: p.name, cat: p.cat, price: lv.price, compare: lv.compare, ends: lv.ends,
      img: p.images[0] || '/img/placeholder.svg', img2: p.images[1] || null,
      stock: p.status, left: p.status === 'limited' && p.qty != null ? p.qty : null,
      tags: p.tags, gender: p.gender, rating: p.rating || 0, reviews: p.reviewCount || 0, sold: p.sold || 0,
      created: p.created, featured: !!p.featured, boxable: !!p.boxable, options: p.options || [],
      keywords: p.keywords || '', recent: recent?.get(p.id) || 0,
    };
  }
  /** Real sales signals from orders: units sold in the last 7 days, recent purchases, bought-together pairs. */
  salesSignals() {
    const now = Date.now(), orders = this.data.orders, b = this.data.settings.boosters;
    const recent = new Map(), proof = [], pairs = new Map();
    for (let i = orders.length - 1; i >= 0; i--) {
      const o = orders[i];
      if (now - o.created > 120 * DAY) break;
      if (INACTIVE_STATUSES.has(o.status)) continue;
      const pids = new Set();
      for (const l of o.items) {
        if (l.kind === 'box') { for (const c of l.box.items) pids.add(c.pid); continue; }
        pids.add(l.pid);
        if (now - o.created <= 7 * DAY) recent.set(l.pid, (recent.get(l.pid) || 0) + l.qty * (l.pack || 1));
        if (b.proof && proof.length < 12 && now - o.created <= 7 * DAY && this.products.get(l.pid)?.active && !proof.some((x) => x.at === o.created)) {
          proof.push({ pid: l.pid, city: o.address.city, at: o.created, name: b.proofNames ? o.customer.name.split(' ')[0] : '' });
        }
      }
      const list = [...pids];
      for (const a of list) for (const c of list) if (a !== c) {
        let m = pairs.get(a); if (!m) pairs.set(a, (m = new Map()));
        m.set(c, (m.get(c) || 0) + 1);
      }
    }
    const fbt = {};
    for (const [a, m] of pairs) {
      const top = [...m].filter(([c, n]) => n >= 2 && this.products.get(c)?.active).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([c]) => c);
      if (top.length) fbt[a] = top;
    }
    return { recent, proof, fbt };
  }
  catalog() {
    const sig = this.salesSignals();
    return {
      v: this.version,
      settings: this.publicSettings(),
      // Categories without a visible product are left out, so shoppers never land on an empty page.
      categories: [...this.data.categories].filter((c) => this.data.products.some((p) => p.active && p.cat === c.id)).sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99)),
      products: this.data.products.filter((p) => p.active).map((p) => this.publicProduct(p, sig.recent)),
      // Real, approved 5-star reviews for the homepage "loved by" section.
      reviews: this.data.reviews.filter((r) => r.approved && r.rating === 5 && r.text.length > 40 && this.products.get(r.pid)?.active)
        .sort((a, b) => b.created - a.created).slice(0, 6).map((r) => ({ name: r.name, text: r.text, rating: r.rating, pid: r.pid })),
      proof: sig.proof, fbt: sig.fbt,
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
    const { adminNote, userId, source, manual, demo, ...rest } = o;
    return {
      ...rest,
      items: o.items.map(({ cost, ...l }) => l),
      courier: o.courier && (o.courier.name || o.courier.tracking) ? { name: o.courier.name, tracking: o.courier.tracking } : null,
    };
  }
  publicUser(u) { return { id: u.id, name: u.name, phone: u.phone, email: u.email, address: u.address }; }

  /* ---------------------------------------------------------- stock log */
  _log(p, delta, reason, ref = '', note = '') {
    if (!delta || p.qty == null) return;
    const log = this.data.stockLog;
    log.push({ id: rid('s'), at: Date.now(), pid: p.id, name: p.name, delta, after: p.qty, reason, ref, note: str(note, 200) });
    if (log.length > 5000) log.splice(0, log.length - 5000);
  }

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
  /** Import preview: `newCat` = the category does not exist yet; `preview` = allow "local:N" photo placeholders. */
  _normProduct(inp, ex = {}, { newCat = false, preview = false } = {}) {
    const name = str(inp.name ?? ex.name, 120);
    if (name.length < 2) throw bad('Please enter a product name.', 'name');
    const cat = str(inp.cat ?? ex.cat, 60);
    if (!newCat && !this.categories.has(cat)) throw bad('Please choose a category.', 'cat');
    const price = num(inp.price ?? ex.price, 0, 10_000_000, NaN);
    if (!Number.isFinite(price)) throw bad('Please enter a valid price.', 'price');
    let compare = num(inp.compare ?? ex.compare, 0, 10_000_000, 0);
    if (compare <= price) compare = 0;
    const slug = this._uniqueSlug(slugify(str(inp.slug, 80) || ex.slug || name), ex.id);
    const images = (Array.isArray(inp.images) ? inp.images : ex.images || [])
      .map((x) => str(x, 600)).filter((u) => /^(\/uploads\/|\/img\/|https:\/\/)/.test(u) || (preview && /^local:\d+$/.test(u))).slice(0, 10);
    const rawQty = inp.qty !== undefined ? inp.qty : ex.qty;
    const qty = rawQty === null || rawQty === '' || rawQty === undefined ? null : int(rawQty, 0, 1_000_000, null);
    const rawLow = inp.lowStock !== undefined ? inp.lowStock : ex.lowStock;
    const lowStock = rawLow === null || rawLow === '' || rawLow === undefined ? null : int(rawLow, 0, 100_000, null);
    const rawCost = inp.cost !== undefined ? inp.cost : ex.cost;
    const cost = rawCost === null || rawCost === '' || rawCost === undefined ? null : num(rawCost, 0, 10_000_000, null);
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
      cost, sku: str(inp.sku ?? ex.sku, 40), supplier: str(inp.supplier ?? ex.supplier, 80),
      saleEnds: inp.saleEnds !== undefined ? dhakaDateTime(inp.saleEnds) : ex.saleEnds ?? null,
      tags: [...new Set(arr(inp.tags ?? ex.tags).map((t) => slugify(t)).filter((t) => t && t !== 'item'))].slice(0, 20),
      gender: ['her', 'him', 'unisex', 'kids'].includes(inp.gender) ? inp.gender : ex.gender || 'unisex',
      options, featured: pickBool(inp.featured, ex.featured, false),
      boxable: pickBool(inp.boxable, ex.boxable, false), active: pickBool(inp.active, ex.active, true),
      keywords: str(inp.keywords ?? ex.keywords, 300), updated: Date.now(),
    };
    if (!compare) p.saleEnds = null;
    if (p.active && !(price > 0)) throw bad('Set a price above ৳0 before showing this product in the shop.', 'price');
    if (p.qty != null && (p.autoStock || p.qty === 0)) this._autoStatus(p);
    return p;
  }
  createProduct(inp) {
    const p = this._normProduct(inp);
    Object.assign(p, { id: rid('p'), created: Date.now(), sold: 0, rating: 0, reviewCount: 0 });
    this.data.products.push(p); this.products.set(p.id, p); this.slugs.set(p.slug, p);
    if (p.qty) this._log(p, p.qty, 'count', '', 'Opening stock');
    this.save(true);
    return p;
  }
  updateProduct(id, inp, note = 'Edited in product form') {
    const ex = this.products.get(id);
    if (!ex) throw new HttpError(404, 'Product not found.');
    const oldSlug = ex.slug, oldQty = ex.qty;
    const next = this._normProduct(inp, ex);
    Object.assign(ex, next);
    if (oldSlug !== ex.slug) { this.slugs.delete(oldSlug); this.slugs.set(ex.slug, ex); }
    if (ex.qty !== oldQty) this._log(ex, (ex.qty ?? 0) - (oldQty ?? 0), 'count', '', note);
    this.save(true);
    return ex;
  }
  duplicateProduct(id) {
    const ex = this.products.get(id);
    if (!ex) throw new HttpError(404, 'Product not found.');
    return this.createProduct({ ...structuredClone(ex), name: ex.name + ' (copy)', slug: '', sku: '', active: false });
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
      const old = p.qty;
      p.qty = qty === null || qty === '' ? null : int(qty, 0, 1_000_000, p.qty);
      if (p.qty != null) p.autoStock = true; // typing a quantity = "manage the status for me"
      this._autoStatus(p);
      if (p.qty !== old) this._log(p, (p.qty ?? 0) - (old ?? 0), 'count', '', 'Quantity typed in product list');
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
  /** Stock arrived from a supplier: adds to the quantity and updates the average cost. */
  receiveStock(id, inp) {
    const p = this.products.get(id);
    if (!p) throw new HttpError(404, 'Product not found.');
    const qty = int(inp.qty, 1, 1_000_000, 0);
    if (!qty) throw bad('Enter how many units arrived.', 'qty');
    const unitCost = num(inp.cost, 0, 10_000_000, null);
    const before = p.qty ?? 0;
    if (unitCost != null) p.cost = p.cost != null && before > 0 ? Math.round(((before * p.cost + qty * unitCost) / (before + qty)) * 100) / 100 : unitCost;
    if (p.qty == null) p.autoStock = true;
    p.qty = before + qty;
    this._autoStatus(p);
    this._log(p, qty, 'received', '', str(inp.note, 200) || (unitCost != null ? `@ ৳${unitCost} each` : ''));
    p.updated = Date.now();
    this.save(true);
    return p;
  }
  /** Stock count / write-off: sets the exact quantity on the shelf. */
  adjustStock(id, inp) {
    const p = this.products.get(id);
    if (!p) throw new HttpError(404, 'Product not found.');
    const count = int(inp.count, 0, 1_000_000, null);
    if (count == null) throw bad('Enter the quantity you counted.', 'count');
    const reason = STOCK_REASONS.has(inp.reason) ? inp.reason : 'count';
    const before = p.qty ?? 0;
    if (p.qty == null) p.autoStock = true;
    p.qty = count;
    this._autoStatus(p);
    this._log(p, count - before, reason, '', inp.note);
    p.updated = Date.now();
    this.save(true);
    return p;
  }
  bulkProducts(ids, action, value) {
    const list = ids.map((id) => this.products.get(id)).filter(Boolean);
    if (action === 'delete') { this.deleteProducts(list.map((p) => p.id)); return list.length; }
    if (action === 'active' && bool(value)) {
      const free = list.filter((p) => !(p.price > 0));
      if (free.length) throw bad(`Set a price first: ${free.slice(0, 3).map((p) => p.name).join(', ')}${free.length > 3 ? ` and ${free.length - 3} more` : ''} ${free.length > 1 ? 'have' : 'has'} no price yet.`);
    }
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

  /* ------------------------------------------------- spreadsheet import */
  /** One product as a spreadsheet row, in SHEET_FIELDS order (the import reads it back). */
  sheetRow(p) {
    return [
      p.id, p.sku, p.name, this.categories.get(p.cat)?.name || '', p.price, p.compare || '', p.cost ?? '', p.qty ?? '',
      SHEET_STOCK[p.status] || p.status, p.active ? 'yes' : 'no', p.featured ? 'yes' : 'no', p.gender, (p.tags || []).join(', '),
      (p.options || []).map((o) => `${o.name}: ${o.values.join(' | ')}`).join('; '), (p.highlights || []).join(' | '), p.desc,
      (p.images || []).join(' | '), p.keywords, p.supplier, p.slug,
    ];
  }
  /**
   * Adds or updates products from spreadsheet rows ({ field: text }, fields as in SHEET_FIELDS).
   * Matches an existing product by ID, then SKU, then name (ignoring case). An empty cell keeps the
   * current value. With commit = false nothing is saved: it returns what would happen, row by row.
   * `existing`: 'update' or 'skip' products that already exist.
   * Photo cells may hold "local:N" placeholders while previewing (files the dashboard uploads on approval).
   */
  importProducts(rows, { commit = false, existing = 'update' } = {}) {
    if (!Array.isArray(rows)) throw bad('No rows to import.');
    if (rows.length > 2000) throw bad('Please import at most 2,000 rows at a time.');
    const lc = (s) => String(s).trim().toLowerCase();
    const bySku = new Map(), byName = new Map(), cats = new Map();
    for (const p of this.data.products) { if (p.sku) bySku.set(lc(p.sku), p); byName.set(lc(p.name), p); }
    for (const c of this.data.categories) for (const k of [c.id, c.slug, c.name]) cats.set(lc(k), c);
    const newCats = new Map(); // lower-case name -> name as typed
    const seen = new Map();    // product key -> line number (catches the same product twice in one file)
    const out = [];

    rows.forEach((raw, i) => {
      const line = Number(raw?.line) || i + 2;
      const r = {}, inp = {}, errors = [], warnings = [];
      for (const [f] of SHEET_FIELDS) {
        const v = raw?.[f];
        let s = (Array.isArray(v) ? v.join('\n') : String(v ?? '')).trim();
        if (/^'[=+\-@]/.test(s)) s = s.slice(1); // undo the export's formula guard
        if (s) r[f] = s;
      }
      if (!Object.keys(r).length) return; // blank row
      const label = r.name || r.sku || `Row ${line}`;

      if (r.name) inp.name = r.name;
      for (const [f, what] of [['price', 'Price'], ['compare', 'Compare-at price'], ['cost', 'Cost']]) {
        if (r[f] == null) continue;
        const n = Number(r[f].replace(/৳|tk\.?|taka|bdt|,|\s/gi, ''));
        if (Number.isFinite(n) && n >= 0) inp[f] = n; else errors.push(`${what} “${r[f]}” is not a number.`);
      }
      if (r.qty != null) {
        if (/^(not tracked|untracked|-|—|n\/?a)$/i.test(r.qty)) inp.qty = null;
        else { const n = Number(r.qty.replace(/,|\s/g, '')); if (Number.isInteger(n) && n >= 0) inp.qty = n; else errors.push(`Quantity “${r.qty}” must be a whole number.`); }
      }
      if (r.status) { const s = STOCK_WORDS[sheetKey(r.status)]; if (s) inp.status = s; else warnings.push(`Stock status “${r.status}” was not understood (use In stock, Limited or Out of stock).`); }
      for (const [f, what] of [['active', 'Visible'], ['featured', 'Featured']]) {
        if (r[f] == null) continue;
        if (YES.test(r[f])) inp[f] = true; else if (NO.test(r[f])) inp[f] = false; else warnings.push(`${what} “${r[f]}” was not understood (use yes or no).`);
      }
      if (r.gender) { const g = GENDER_WORDS[sheetKey(r.gender)]; if (g) inp.gender = g; else warnings.push(`For “${r.gender}” was not understood (use her, him, unisex or kids).`); }
      if (r.tags) inp.tags = r.tags.split(/[,;|\n]/).map((t) => t.replace(/['’]/g, '').trim()).filter(Boolean);
      if (r.highlights) inp.highlights = r.highlights.split(/\s*[|\n]\s*/).filter(Boolean);
      if (r.options) {
        inp.options = r.options.split(/[;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
          const m = s.match(/^([^:]+):(.+)$/);
          if (!m) { warnings.push(`Option “${s}” needs the form Name: value | value.`); return null; }
          return { name: m[1].trim(), values: m[2].split(/[|,]/).map((v) => v.trim()).filter(Boolean) };
        }).filter(Boolean);
      }
      if (r.images) {
        const imgs = [];
        for (const t of r.images.split(/\s*[|\n,]\s*/).filter(Boolean)) {
          if (/^(\/uploads\/|\/img\/)\S+$|^https:\/\/\S+$/i.test(t) || (!commit && /^local:\d+$/.test(t))) imgs.push(t);
          else warnings.push(`Photo “${t}” was not found. Add the photo file, or use a full https:// link.`);
        }
        if (imgs.length) inp.images = imgs.slice(0, 10);
      }
      for (const f of ['desc', 'keywords', 'supplier', 'sku', 'slug']) if (r[f] != null) inp[f] = r[f];

      let cat = null, newCat = '';
      if (r.category) {
        cat = cats.get(lc(r.category));
        if (cat) inp.cat = cat.id;
        else { newCat = r.category.slice(0, 60); if (!newCats.has(lc(newCat))) newCats.set(lc(newCat), newCat); }
      }

      const ex = (r.id && this.products.get(r.id)) || (r.sku && bySku.get(lc(r.sku))) || (r.name && byName.get(lc(r.name))) || null;
      const row = { line, name: label, id: ex?.id || null, errors, warnings, changes: [] };
      const key = ex ? ex.id : 'new:' + lc(r.name || r.sku || line);
      if (seen.has(key)) errors.push(`This is the same product as row ${seen.get(key)}.`); else seen.set(key, line);

      if (ex && existing === 'skip') row.action = 'skip';
      else if (!ex) {
        if (!r.name) errors.push('Name is missing.');
        if (!r.category) errors.push('Category is missing.');
        if (inp.price == null && !errors.some((e) => e.startsWith('Price'))) errors.push('Price is missing.');
        row.action = 'create';
      } else row.action = 'update';

      let p = null;
      if (!errors.length && row.action !== 'skip') {
        try { p = this._normProduct(inp, ex || {}, { newCat: !!newCat, preview: !commit }); }
        catch (e) { if (e instanceof HttpError) errors.push(e.message); else throw e; }
      }
      if (p) {
        if (ex) {
          for (const [f, what] of DIFF_FIELDS) {
            if (sameVal(ex[f], p[f]) && !(f === 'cat' && newCat)) continue;
            const to = f === 'cat' && newCat ? newCat : f === 'images' && p.images.length ? `${p.images.length} new photo${p.images.length === 1 ? '' : 's'}` : this._sheetShow(f, p[f]);
            row.changes.push({ field: what, from: this._sheetShow(f, ex[f]), to });
          }
          if (!row.changes.length) row.action = 'same';
        }
        Object.assign(row, {
          name: p.name, category: newCat || this.categories.get(p.cat)?.name || '', newCategory: !!newCat,
          price: p.price, compare: p.compare, qty: p.qty, status: p.status, active: p.active, image: p.images[0] || '',
        });
      }
      if (errors.length) row.action = 'error';
      row._inp = inp; row._ex = ex; row._newCat = newCat;
      out.push(row);
    });

    const count = (a) => out.filter((x) => x.action === a).length;
    const summary = { create: count('create'), update: count('update'), same: count('same'), skip: count('skip'), error: count('error'), total: out.length };
    const usedCats = [...newCats.values()].filter((n) => out.some((x) => x._newCat === n && (x.action === 'create' || x.action === 'update')));
    const result = { summary, newCategories: usedCats, done: { created: 0, updated: 0 }, failed: [] };
    if (commit) {
      const catIds = new Map();
      for (const name of usedCats) {
        const first = out.find((x) => x._newCat === name && x.image)?.image;
        catIds.set(name, this.saveCategory({ name, image: first || '/img/placeholder.svg' }).id);
      }
      for (const x of out) {
        if (x.action !== 'create' && x.action !== 'update') continue;
        if (x._newCat) x._inp.cat = catIds.get(x._newCat);
        try {
          if (x.action === 'create') { x.id = this.createProduct(x._inp).id; result.done.created++; }
          else { this.updateProduct(x._ex.id, x._inp, 'Spreadsheet import'); result.done.updated++; }
        } catch (e) { if (!(e instanceof HttpError)) throw e; result.failed.push({ line: x.line, name: x.name, error: e.message }); }
      }
    }
    result.rows = out.map(({ _inp, _ex, _newCat, ...x }) => x);
    return result;
  }
  _sheetShow(f, v) {
    if (v == null || v === '') return '—';
    if (f === 'cat') return this.categories.get(v)?.name || v;
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (f === 'status') return SHEET_STOCK[v] || v;
    if (f === 'images') return `${v.length} photo${v.length === 1 ? '' : 's'}`;
    if (f === 'options') return v.map((o) => `${o.name}: ${o.values.join(', ')}`).join('; ') || '—';
    if (Array.isArray(v)) return v.join(', ') || '—';
    const s = String(v);
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
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
    const comps = []; let price = box.price + (wrap.price || 0); let cost = 0;
    for (const pid of ids) {
      const p = this.products.get(String(pid));
      if (!p || !p.active || !p.boxable || (p.options || []).length) throw new HttpError(409, 'An item in your gift box is no longer available.');
      if (p.status === 'out') throw new HttpError(409, `Sorry, "${p.name}" in your gift box just sold out.`);
      need.set(p.id, (need.get(p.id) || 0) + qty);
      const pr = this.live(p).price;
      comps.push({ pid: p.id, name: p.name, price: pr });
      price += pr;
      cost = cost == null || p.cost == null ? null : cost + p.cost;
    }
    return {
      kind: 'box', pid: 'box:' + box.id, name: `Custom ${box.name}`, slug: '', img: '/img/box.svg', price, cost, qty, options: {},
      box: { id: box.id, name: box.name, wrap: wrap.name, ribbon: ribbon.name, to: str(it.to, 60), from: str(it.from, 60), note: str(it.note, 300), items: comps },
    };
  }
  _options(p, raw) {
    const options = {};
    for (const o of p.options || []) {
      const v = raw?.[o.name];
      if (!o.values.includes(v)) throw bad(`Please choose a ${o.name.toLowerCase()} for "${p.name}".`);
      options[o.name] = v;
    }
    return options;
  }
  _offerProduct(cfg, pid, label) {
    const p = cfg?.enabled && cfg.pid === String(pid) ? this.products.get(cfg.pid) : null;
    if (!p || !p.active) throw new HttpError(409, `The ${label} offer is no longer available. Please remove it and try again.`);
    if (p.status === 'out') throw new HttpError(409, `Sorry, "${p.name}" just sold out.`);
    return p;
  }
  isBlocked(phone) { return !!this.data.customerNotes[phone]?.blocked; }
  placeOrder(inp, userId, { admin = false } = {}) {
    const s = this.data.settings;
    const items = Array.isArray(inp.items) ? inp.items.slice(0, 40) : [];
    if (!items.length) throw bad('Your bag is empty.');
    const c = inp.customer || {};
    const name = str(c.name, 80);
    if (name.length < 2) throw bad('Please enter your full name.', 'name');
    const phone = normPhone(c.phone);
    if (!PHONE_RE.test(phone)) throw bad('Please enter a valid mobile number, e.g. 01712345678.', 'phone');
    if (!admin && this.isBlocked(phone)) throw new HttpError(403, 'We could not place this order online. Please call us and we will help you.');
    const email = str(c.email, 120).toLowerCase();
    if (email && !EMAIL_RE.test(email)) throw bad('Please enter a valid email address.', 'email');
    const a = inp.address || {};
    const line = str(a.line, 300);
    if (line.length < (admin ? 2 : 5)) throw bad('Please enter the full delivery address.', 'line');
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
    const funnel = inp.funnel ? this.funnels.get(str(inp.funnel, 40)) : null;
    if (inp.funnel && (!funnel || !funnel.active)) throw new HttpError(409, 'This offer has ended. Please visit our shop for the latest prices.');
    const dlv = inp.delivery || {};
    const pickup = admin && bool(inp.pickup);
    const method = dlv.method === 'express' && !funnel ? 'express' : 'standard';
    if (method === 'express' && zone !== 'inside') throw bad(`Express delivery is available in ${s.delivery.expressAreas} only.`, 'method');
    const today = dhakaDate(Date.now());
    let date = /^\d{4}-\d{2}-\d{2}$/.test(dlv.date || '') ? dlv.date : null;
    if (date && (date < today || date > dhakaDate(Date.now() + 60 * DAY))) throw bad('Please choose a delivery date within the next 60 days.', 'date');
    if (method === 'express') date = today;
    const slot = ['morning', 'afternoon', 'evening'].includes(dlv.slot) ? dlv.slot : null;
    const gift = { wrap: bool(inp.gift?.wrap), message: str(inp.gift?.message, 300), hidePrice: bool(inp.gift?.hidePrice) };
    const pm = ['cod', 'bkash', 'nagad'].includes(inp.payment?.method) ? inp.payment.method : 'cod';
    if (!admin && !s.payments[pm]) throw bad('That payment method is not available right now.', 'payment');
    const trxId = str(inp.payment?.trxId, 30).toUpperCase().replace(/\s/g, '');
    if (!admin && pm !== 'cod' && !/^[A-Z0-9]{6,30}$/.test(trxId)) throw bad('Please enter the Transaction ID from your payment.', 'trx');

    // Resolve every line from the database (never trust prices sent by the browser).
    const need = new Map(); const lines = [];
    for (const it of items) {
      if (it.kind === 'box') { lines.push(this._resolveBox(it, need)); continue; }
      if (it.offer === 'bump') {
        const cfg = funnel ? funnel.bump : s.boosters.bump;
        const p = this._offerProduct(cfg, it.pid, 'add-on');
        if (lines.some((l) => l.offer === 'bump')) continue;
        need.set(p.id, (need.get(p.id) || 0) + 1);
        lines.push({ kind: 'product', pid: p.id, name: p.name, slug: p.slug, img: p.images[0] || '', price: cfg.price, cost: p.cost ?? null, qty: 1, options: this._options(p, it.options), offer: 'bump' });
        continue;
      }
      const p = this.products.get(String(it.pid));
      if (!p || !p.active) throw new HttpError(409, 'An item in your bag is no longer available. Please remove it and try again.');
      if (p.status === 'out') throw new HttpError(409, `Sorry, "${p.name}" just sold out. Please remove it from your bag.`);
      const options = this._options(p, it.options);
      if (funnel && it.pkg !== undefined) {
        if (funnel.type !== 'product' || funnel.pid !== p.id) throw new HttpError(409, 'This offer has changed. Please reload the page.');
        const pk = funnel.packages.length ? funnel.packages[int(it.pkg, 0, funnel.packages.length - 1, 0)] : { label: '', qty: 1, price: this.live(p).price };
        const qty = int(it.qty, 1, 10, 1);
        need.set(p.id, (need.get(p.id) || 0) + qty * pk.qty);
        lines.push({ kind: 'product', pid: p.id, name: pk.label ? `${p.name} (${pk.label})` : p.name, slug: p.slug, img: p.images[0] || '', price: pk.price, cost: p.cost != null ? p.cost * pk.qty : null, qty, pack: pk.qty, options, offer: 'funnel' });
        continue;
      }
      const qty = int(it.qty, 1, admin ? 500 : 20, 1);
      need.set(p.id, (need.get(p.id) || 0) + qty);
      lines.push({ kind: 'product', pid: p.id, name: p.name, slug: p.slug, img: p.images[0] || '', price: this.live(p).price, cost: p.cost ?? null, qty, options });
    }
    if (!lines.length) throw bad('Your bag is empty.');
    for (const [pid, q] of need) {
      const p = this.products.get(pid);
      if (p.qty != null && q > p.qty) throw new HttpError(409, p.qty > 0 ? `Only ${p.qty} left of "${p.name}". Please reduce the quantity.` : `Sorry, "${p.name}" just sold out.`);
    }
    let coupon = null;
    const code = funnel ? '' : str(inp.coupon, 30).toUpperCase();
    if (code) {
      const v = this.checkCoupon(code);
      if (!v.ok) throw new HttpError(409, v.message, { field: 'coupon' });
      coupon = v.coupon;
    }
    const priced = funnel ? funnelSettings(s, funnel) : s;
    const t = computeTotals(lines, { settings: priced, coupon, zone, express: method === 'express', giftWrap: gift.wrap, noDelivery: pickup });
    if (admin) {
      const extra = Math.min(t.subtotal - t.discount, num(inp.extraDiscount, 0, 10_000_000, 0));
      if (extra > 0) { t.discount += extra; t.total = Math.max(0, t.total - extra); t.discountLabel = t.discountLabel ? `${t.discountLabel} + special discount` : 'Special discount'; }
    } else if (inp.expectedTotal != null && !(Math.abs(Number(inp.expectedTotal) - t.total) <= 0.5)) {
      throw new HttpError(409, 'Some prices changed while you were shopping. Please check the updated total and place the order again.', { totals: t });
    }
    // Commit: reserve stock, count sales.
    const id = this._orderId();
    for (const [pid, q] of need) {
      const p = this.products.get(pid);
      p.sold = (p.sold || 0) + q;
      if (p.qty != null) { p.qty = Math.max(0, p.qty - q); this._autoStatus(p); this._log(p, -q, 'order', id); }
    }
    if (coupon && t.discountType === 'coupon') coupon.used = (coupon.used || 0) + 1;
    const now = Date.now();
    const src = inp.source || {};
    const channel = admin ? (MANUAL_CHANNELS.includes(src.channel) ? src.channel : 'phone') : str(src.channel, 20).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'direct';
    const status = admin && STATUS_KEYS.has(inp.status) && !INACTIVE_STATUSES.has(inp.status) ? inp.status : 'pending';
    const order = {
      id, created: now, updated: now, userId: userId || null,
      customer: { name, phone, email }, recipient, address: { line, area, city, zone },
      delivery: { method: pickup ? 'pickup' : method, date, slot }, gift, items: lines,
      totals: { count: t.count, subtotal: t.subtotal, discount: t.discount, discountLabel: t.discountLabel, delivery: t.delivery, wrap: t.wrap, total: t.total },
      coupon: t.discountType === 'coupon' ? coupon.code : null,
      payment: { method: pm, trxId: pm === 'cod' ? '' : trxId, status: admin && inp.paymentStatus === 'paid' ? 'paid' : 'unpaid' },
      source: { channel, campaign: admin ? '' : str(src.campaign, 60), funnel: funnel?.id || null },
      funnel: funnel?.id || null, courier: null, manual: admin || undefined,
      status, timeline: [{ status: 'pending', at: now, note: admin ? 'Order created by the shop' : '' }, ...(status !== 'pending' ? [{ status, at: now, note: '' }] : [])],
      note: str(inp.note, 500), adminNote: admin ? str(inp.adminNote, 1000) : '',
    };
    this.data.orders.push(order); this.orders.set(order.id, order);
    this._convertDrafts(phone, order.id);
    if (!admin) this._countOrder(order);
    this.save(true);
    return order;
  }
  /** The one-click "add this too" offer a shopper sees right after ordering (or null). */
  upsellOffer(o) {
    const cfg = o.funnel ? this.funnels.get(o.funnel)?.upsell : this.data.settings.boosters.upsell;
    if (!cfg?.enabled || o.upsold || o.status !== 'pending' || o.payment.method !== 'cod') return null;
    const minutes = cfg.minutes || 30, until = o.created + minutes * 60_000;
    if (Date.now() > until) return null;
    const p = this.products.get(cfg.pid);
    if (!p || !p.active || p.status === 'out' || (p.options || []).length || (p.qty != null && p.qty < 1)) return null;
    const lv = this.live(p);
    return { pid: p.id, name: p.name, img: p.images[0] || '/img/placeholder.svg', slug: p.slug, price: cfg.price, was: Math.max(lv.price, lv.compare || 0), title: cfg.title || cfg.headline || 'Add this to your order', text: cfg.text || '', until };
  }
  acceptUpsell(id, phoneRaw) {
    const o = this.orders.get(str(id, 20).toUpperCase());
    const phone = normPhone(phoneRaw);
    if (!o || phone !== o.customer.phone) throw new HttpError(404, 'Order not found.');
    const offer = this.upsellOffer(o);
    if (!offer) throw new HttpError(409, 'Sorry, this offer has expired.');
    const p = this.products.get(offer.pid);
    o.items.push({ kind: 'product', pid: p.id, name: p.name, slug: p.slug, img: p.images[0] || '', price: offer.price, cost: p.cost ?? null, qty: 1, options: {}, offer: 'upsell' });
    o.totals.subtotal += offer.price; o.totals.count += 1; o.totals.total += offer.price;
    o.upsold = true; o.updated = Date.now();
    o.timeline.push({ status: o.status, at: Date.now(), note: `Added ${p.name} (one-time offer)` });
    p.sold = (p.sold || 0) + 1;
    if (p.qty != null) { p.qty = Math.max(0, p.qty - 1); this._autoStatus(p); this._log(p, -1, 'order', o.id, 'Upsell'); }
    const day = this._day(dhakaDate(Date.now()));
    day.up = (day.up || 0) + 1; day.upRev = (day.upRev || 0) + offer.price; day.rev = (day.rev || 0) + offer.price;
    if (o.funnel) { const f = (day.f[o.funnel] ||= {}); f.up = (f.up || 0) + 1; f.rev = (f.rev || 0) + offer.price; }
    this.save(true);
    return o;
  }
  _restock(o, dir, reason) { // dir = +1 returns stock (cancel/return), -1 reserves again (restore)
    const adj = (pid, q) => {
      const p = this.products.get(pid); if (!p) return;
      p.sold = Math.max(0, (p.sold || 0) - dir * q);
      if (p.qty != null) { p.qty = Math.max(0, p.qty + dir * q); this._autoStatus(p); this._log(p, dir * q, reason, o.id); }
    };
    for (const l of o.items) {
      if (l.kind === 'box') for (const c of l.box.items) adj(c.pid, l.qty); else adj(l.pid, l.qty * (l.pack || 1));
    }
  }
  updateOrder(id, patch) {
    const o = this.orders.get(id);
    if (!o) throw new HttpError(404, 'Order not found.');
    let stock = false;
    const note = str(patch.note, 300);
    if (patch.status && STATUS_KEYS.has(patch.status) && patch.status !== o.status) {
      const was = INACTIVE_STATUSES.has(o.status), will = INACTIVE_STATUSES.has(patch.status);
      if (!was && will) { this._restock(o, +1, patch.status === 'returned' ? 'return' : 'cancel'); stock = true; }
      else if (was && !will) { this._restock(o, -1, 'restore'); stock = true; }
      o.status = patch.status;
      o.timeline.push({ status: o.status, at: Date.now(), note });
    } else if (note) o.timeline.push({ status: o.status, at: Date.now(), note });
    if (['paid', 'unpaid', 'refunded'].includes(patch.paymentStatus)) o.payment.status = patch.paymentStatus;
    if (patch.adminNote !== undefined) o.adminNote = str(patch.adminNote, 1000);
    if (patch.courier) {
      const cr = patch.courier;
      o.courier = { name: str(cr.name, 40), tracking: str(cr.tracking, 60), cost: num(cr.cost, 0, 100_000, null) };
    }
    o.updated = Date.now();
    this.save(stock);
    return o;
  }
  deleteOrder(id) {
    const o = this.orders.get(id);
    if (!o) throw new HttpError(404, 'Order not found.');
    if (!INACTIVE_STATUSES.has(o.status) && o.status !== 'delivered') this._restock(o, +1, 'cancel');
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
    this.save(true);
    return ex || c;
  }
  deleteCoupon(code) {
    if (!this.coupons.delete(code)) throw new HttpError(404, 'Coupon not found.');
    this.data.coupons = this.data.coupons.filter((c) => c.code !== code);
    this.save(true);
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
  setCustomer(phoneRaw, inp) {
    const phone = normPhone(phoneRaw);
    if (!PHONE_RE.test(phone)) throw bad('Invalid mobile number.');
    const ex = this.data.customerNotes[phone] || {};
    const next = {
      note: str(inp.note ?? ex.note, 2000),
      tags: [...new Set(arr(inp.tags ?? ex.tags).map((t) => str(t, 30)).filter(Boolean))].slice(0, 12),
      blocked: pickBool(inp.blocked, ex.blocked, false), updated: Date.now(),
    };
    if (!next.note && !next.tags.length && !next.blocked) delete this.data.customerNotes[phone];
    else this.data.customerNotes[phone] = next;
    this.save();
    return next;
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
  /** Popup / funnel lead: phone and/or email. Returns the coupon to reveal (if valid). */
  addLead(inp, { funnel = null, coupon = '' } = {}) {
    const name = str(inp.name, 80), phone = normPhone(inp.phone), email = str(inp.email, 120).toLowerCase();
    const okPhone = PHONE_RE.test(phone), okEmail = EMAIL_RE.test(email);
    if (!okPhone && !okEmail) throw bad(inp.email !== undefined && inp.phone === undefined ? 'Please enter a valid email address.' : 'Please enter a valid mobile number, e.g. 01712345678.', inp.phone !== undefined ? 'phone' : 'email');
    if (okEmail && !this.data.subscribers.some((s) => s.email === email)) this.data.subscribers.push({ email, created: Date.now() });
    const leads = this.data.leads;
    const dup = leads.find((l) => l.funnel === (funnel?.id || null) && ((okPhone && l.phone === phone) || (okEmail && l.email === email)));
    if (dup) { dup.name = name || dup.name; dup.updated = Date.now(); }
    else {
      leads.push({ id: rid('l'), funnel: funnel?.id || null, source: funnel ? 'funnel' : 'popup', name, phone: okPhone ? phone : '', email: okEmail ? email : '', created: Date.now() });
      if (leads.length > 20_000) leads.splice(0, leads.length - 20_000);
      const day = this._day(dhakaDate(Date.now()));
      day.lead = (day.lead || 0) + 1;
      if (funnel) { const f = (day.f[funnel.id] ||= {}); f.lead = (f.lead || 0) + 1; }
    }
    this.save();
    return coupon && this.checkCoupon(coupon).ok ? coupon : null;
  }

  /* ------------------------------------------------------------- funnels */
  _normFunnel(inp, ex = {}) {
    const type = ['product', 'lead', 'collection'].includes(inp.type ?? ex.type) ? inp.type ?? ex.type : 'product';
    const name = str(inp.name ?? ex.name, 80);
    if (name.length < 2) throw bad('Give the funnel a name (only you see it).', 'name');
    let slug = slugify(str(inp.slug, 60) || ex.slug || name);
    for (let n = 2; this.funnelSlugs.has(slug) && this.funnelSlugs.get(slug).id !== ex.id; n++) slug = `${slugify(str(inp.slug, 60) || name)}-${n}`;
    const headline = str(inp.headline ?? ex.headline, 160);
    if (headline.length < 3) throw bad('Write a headline for the page.', 'headline');
    const offer = (o, exo = {}) => ({
      enabled: pickBool(o?.enabled, exo.enabled, false), pid: str(o?.pid ?? exo.pid, 40), price: num(o?.price ?? exo.price, 0, 10_000_000, 0),
      text: str(o?.text ?? exo.text, 200), headline: str(o?.headline ?? exo.headline, 120), minutes: int(o?.minutes ?? exo.minutes, 5, 1440, 30),
    });
    const f = {
      ...ex, type, name, slug, headline,
      active: pickBool(inp.active, ex.active, true),
      subheadline: str(inp.subheadline ?? ex.subheadline, 400), image: url(inp.image ?? ex.image), cta: str(inp.cta ?? ex.cta, 60),
      video: (() => { const v = str(inp.video ?? ex.video, 200); const m = v.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/); return m ? m[1] : ''; })(),
      body: str(inp.body ?? ex.body, 6000),
      benefits: (Array.isArray(inp.benefits) ? inp.benefits : typeof inp.benefits === 'string' ? inp.benefits.split('\n') : ex.benefits || []).map((x) => str(x, 160)).filter(Boolean).slice(0, 12),
      faq: (Array.isArray(inp.faq) ? inp.faq : ex.faq || []).map((x) => ({ q: str(x.q, 160), a: str(x.a, 800) })).filter((x) => x.q && x.a).slice(0, 12),
      guarantee: str(inp.guarantee ?? ex.guarantee, 240),
      pid: str(inp.pid ?? ex.pid, 40), compare: num(inp.compare ?? ex.compare, 0, 10_000_000, 0),
      packages: (Array.isArray(inp.packages) ? inp.packages : ex.packages || []).map((x) => ({ label: str(x.label, 60), qty: int(x.qty, 1, 100, 1), price: num(x.price, 0, 10_000_000, NaN) })).filter((x) => Number.isFinite(x.price)).slice(0, 4),
      deadline: { mode: ['none', 'fixed', 'evergreen'].includes(inp.deadline?.mode) ? inp.deadline.mode : ex.deadline?.mode || 'none', at: inp.deadline ? dhakaDateTime(inp.deadline.at) || '' : ex.deadline?.at || '', minutes: int(inp.deadline?.minutes ?? ex.deadline?.minutes, 5, 10_080, 30) },
      freeDelivery: pickBool(inp.freeDelivery, ex.freeDelivery, false),
      deliveryInside: inp.deliveryInside !== undefined ? num(inp.deliveryInside, 0, 100_000, null) : ex.deliveryInside ?? null,
      deliveryOutside: inp.deliveryOutside !== undefined ? num(inp.deliveryOutside, 0, 100_000, null) : ex.deliveryOutside ?? null,
      showReviews: pickBool(inp.showReviews, ex.showReviews, true),
      bump: offer(inp.bump, ex.bump), upsell: offer(inp.upsell, ex.upsell),
      coupon: str(inp.coupon ?? ex.coupon, 30).toUpperCase(), askEmail: pickBool(inp.askEmail, ex.askEmail, false),
      success: str(inp.success ?? ex.success, 300), ctaLink: link(inp.ctaLink ?? ex.ctaLink),
      pids: [...new Set(arr(inp.pids ?? ex.pids).map((x) => str(x, 40)).filter((x) => this.products.has(x)))].slice(0, 40),
      updated: Date.now(),
    };
    if (f.type === 'product') {
      const p = this.products.get(f.pid);
      if (!p) throw bad('Choose the product this page sells.', 'pid');
      if ((p.options || []).length > 1) throw bad('Landing pages support products with at most one option (e.g. size).', 'pid');
    }
    if (f.type === 'collection' && !f.pids.length) throw bad('Pick at least one product for the campaign page.', 'pids');
    for (const k of ['bump', 'upsell']) {
      const o = f[k];
      if (!o.enabled) continue;
      const p = this.products.get(o.pid);
      if (!p) throw bad(`Choose a product for the ${k === 'bump' ? 'order bump' : 'upsell'}.`);
      if ((p.options || []).length) throw bad(`The ${k === 'bump' ? 'order bump' : 'upsell'} product cannot have options (size, colour…).`);
    }
    if (f.coupon && !this.coupons.has(f.coupon)) throw bad(`Coupon ${f.coupon} does not exist. Create it in Coupons first.`, 'coupon');
    return f;
  }
  saveFunnel(inp, id) {
    const ex = id ? this.funnels.get(id) : null;
    if (id && !ex) throw new HttpError(404, 'Funnel not found.');
    const f = this._normFunnel(inp, ex || {});
    if (ex) {
      if (ex.slug !== f.slug) this.funnelSlugs.delete(ex.slug);
      Object.assign(ex, f); this.funnelSlugs.set(ex.slug, ex);
    } else {
      Object.assign(f, { id: rid('f'), created: Date.now() });
      this.data.funnels.push(f); this.funnels.set(f.id, f); this.funnelSlugs.set(f.slug, f);
    }
    this.save(true);
    return ex || f;
  }
  duplicateFunnel(id) {
    const ex = this.funnels.get(id);
    if (!ex) throw new HttpError(404, 'Funnel not found.');
    const { id: _i, created, demo, ...rest } = structuredClone(ex);
    return this.saveFunnel({ ...rest, name: ex.name + ' (copy)', slug: ex.slug + '-copy', active: false });
  }
  deleteFunnel(id) {
    const f = this.funnels.get(id);
    if (!f) throw new HttpError(404, 'Funnel not found.');
    this.funnels.delete(id); this.funnelSlugs.delete(f.slug);
    this.data.funnels = this.data.funnels.filter((x) => x.id !== id);
    this.save(true);
  }
  /** What a shopper's browser needs to draw a funnel page. */
  publicFunnel(slug) {
    const f = this.funnelSlugs.get(slug);
    if (!f || !f.active) return null;
    const pub = (pid) => { const p = this.products.get(pid); return p && p.active ? this.publicProduct(p) : null; };
    const out = {
      id: f.id, slug: f.slug, type: f.type, headline: f.headline, subheadline: f.subheadline, image: f.image, video: f.video, cta: f.cta,
      body: f.body, benefits: f.benefits, faq: f.faq, guarantee: f.guarantee, deadline: f.deadline,
      freeDelivery: f.freeDelivery, deliveryInside: f.deliveryInside, deliveryOutside: f.deliveryOutside,
    };
    if (f.type === 'product') {
      const p = pub(f.pid);
      if (!p) return null;
      const d = this.productDetail(p.id);
      out.product = { ...p, images: d.images, desc: d.desc, highlights: d.highlights };
      out.compare = Math.max(f.compare || 0, p.compare || 0);
      out.packages = f.packages.length ? f.packages : [{ label: '', qty: 1, price: p.price }];
      out.reviews = f.showReviews ? d.reviewList.slice(0, 6) : [];
      const offer = (o) => { const x = o.enabled && pub(o.pid); return x && x.stock !== 'out' && !x.options.length ? { pid: x.id, name: x.name, img: x.img, price: o.price, was: x.price, text: o.text } : null; };
      out.bump = offer(f.bump);
    } else if (f.type === 'lead') {
      out.askEmail = f.askEmail; out.hasCoupon = !!(f.coupon && this.checkCoupon(f.coupon).ok); out.success = f.success; out.ctaLink = f.ctaLink;
    } else {
      out.products = f.pids.map(pub).filter(Boolean);
      out.coupon = f.coupon && this.checkCoupon(f.coupon).ok ? this.publicCoupon(this.coupons.get(f.coupon)) : null;
    }
    return out;
  }

  /* ------------------------------------------------- abandoned checkouts */
  saveDraft(inp) {
    if (!this.data.settings.boosters.capture) return null;
    const phone = normPhone(inp.phone);
    if (!PHONE_RE.test(phone) || this.isBlocked(phone)) return null;
    // A late save after the order went through is not an abandoned checkout.
    const orders = this.data.orders, recent = Date.now() - 2 * 3600_000;
    for (let i = orders.length - 1; i >= 0 && orders[i].created > recent; i--) if (orders[i].customer.phone === phone) return null;
    const items = (Array.isArray(inp.items) ? inp.items : []).slice(0, 30).map((it) => (it.kind === 'box'
      ? { kind: 'box', boxId: str(it.boxId, 30), wrapId: str(it.wrapId, 30), ribbonId: str(it.ribbonId, 30), items: arr(it.items).map((x) => str(x, 40)).slice(0, 20), qty: int(it.qty, 1, 10, 1), to: str(it.to, 60), from: str(it.from, 60), note: str(it.note, 300) }
      : { pid: str(it.pid, 40), qty: int(it.qty, 1, 20, 1), options: Object.fromEntries(Object.entries(it.options || {}).slice(0, 3).map(([k, v]) => [str(k, 30), str(v, 30)])), ...(it.pkg !== undefined ? { pkg: int(it.pkg, 0, 3, 0) } : {}), ...(it.offer === 'bump' ? { offer: 'bump' } : {}) }))
      .filter((it) => (it.kind === 'box' ? it.items.length : this.products.has(it.pid)));
    if (!items.length) return null;
    const sid = str(inp.sid, 40), now = Date.now();
    const list = this.data.abandoned;
    let d = list.find((x) => ['open', 'contacted'].includes(x.status) && (x.phone === phone || (sid && x.sid === sid)) && now - x.updated < 7 * DAY);
    if (!d) {
      d = { id: rid('a'), token: crypto.randomBytes(9).toString('base64url'), created: now, status: 'open' };
      list.push(d);
      if (list.length > 3000) list.splice(0, list.length - 3000);
    }
    Object.assign(d, {
      sid, phone, name: str(inp.name, 80), email: str(inp.email, 120).toLowerCase(), city: str(inp.city, 60), items,
      total: num(inp.total, 0, 10_000_000, 0), funnel: inp.funnel && this.funnels.has(inp.funnel) ? inp.funnel : null,
      channel: str(inp.channel, 20).replace(/[^a-z0-9_-]/g, ''), updated: now,
    });
    this.saveLazy();
    return d;
  }
  restoreDraft(token) {
    const d = this.data.abandoned.find((x) => x.token === str(token, 30));
    if (!d) return null;
    d.restored = true; this.save();
    return { items: d.items, name: d.name, phone: d.phone, email: d.email, city: d.city, funnel: d.funnel ? this.funnels.get(d.funnel)?.slug || null : null };
  }
  _convertDrafts(phone, orderId) {
    for (const d of this.data.abandoned) {
      if (d.phone === phone && ['open', 'contacted'].includes(d.status)) {
        const recovered = d.status === 'contacted' || !!d.restored || Date.now() - d.updated > 3600_000;
        Object.assign(d, { status: recovered ? 'recovered' : 'converted', orderId, convertedAt: Date.now() });
      }
    }
  }
  updateDraft(id, inp) {
    const d = this.data.abandoned.find((x) => x.id === id);
    if (!d) throw new HttpError(404, 'Not found.');
    if (['open', 'contacted', 'dismissed'].includes(inp.status)) { d.status = inp.status; if (inp.status === 'contacted') d.contactedAt = Date.now(); }
    if (inp.note !== undefined) d.note = str(inp.note, 500);
    this.save();
    return d;
  }

  /* ------------------------------------------------------------ expenses */
  saveExpense(inp, id) {
    const ex = id ? this.data.expenses.find((x) => x.id === id) : null;
    if (id && !ex) throw new HttpError(404, 'Expense not found.');
    const amount = num(inp.amount, 0, 100_000_000, NaN);
    if (!Number.isFinite(amount) || amount <= 0) throw bad('Enter the amount you spent.', 'amount');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(inp.date || '') ? inp.date : dhakaDate(Date.now());
    const e = { ...(ex || { id: rid('e'), created: Date.now() }), date, amount, category: EXPENSE_CATEGORIES.includes(inp.category) ? inp.category : 'other', note: str(inp.note, 200) };
    if (ex) Object.assign(ex, e); else this.data.expenses.push(e);
    this.save();
    return ex || e;
  }
  deleteExpense(id) {
    const n = this.data.expenses.length;
    this.data.expenses = this.data.expenses.filter((x) => x.id !== id);
    if (n === this.data.expenses.length) throw new HttpError(404, 'Expense not found.');
    this.save();
  }

  /* ----------------------------------------------------------- analytics */
  _day(date) {
    const days = this.data.analytics.days;
    let d = days[date];
    if (!d) {
      d = days[date] = { v: 0, pv: 0, atc: 0, ck: 0, ord: 0, rev: 0, src: {}, dev: {}, so: {}, sr: {}, f: {}, p: {} };
      const keys = Object.keys(days);
      if (keys.length > 400) for (const k of keys.sort().slice(0, keys.length - 400)) delete days[k];
    }
    return d;
  }
  /** A visitor reached a step of the funnel. Each session counts once per step per day. */
  track(ev) {
    const sid = str(ev.sid, 40);
    if (!/^[\w-]{8,40}$/.test(sid)) return;
    const step = ev.step, today = dhakaDate(Date.now());
    if (this._seen.day !== today || this._seen.set.size > 300_000) this._seen = { day: today, set: new Set() };
    const key = (k) => { const id = `${sid}|${step}|${k}`; if (this._seen.set.has(id)) return false; this._seen.set.add(id); return true; };
    const d = this._day(today);
    if (step === 'visit') {
      if (!key('')) return;
      const ch = str(ev.channel, 20).replace(/[^a-z0-9_-]/g, '') || 'direct';
      d.v++; d.src[ch] = (d.src[ch] || 0) + 1;
      const dev = ev.device === 'mobile' ? 'mobile' : 'desktop'; d.dev[dev] = (d.dev[dev] || 0) + 1;
    } else if (step === 'product') {
      const pid = str(ev.pid, 40); if (!this.products.has(pid)) return;
      if (key('')) d.pv++;
      if (key(pid)) d.p[pid] = (d.p[pid] || 0) + 1;
    } else if (step === 'cart') { if (key('')) d.atc++; }
    else if (step === 'checkout') { if (key('')) d.ck++; }
    else if (step === 'funnel' || step === 'funnel-checkout') {
      const fid = str(ev.fid, 40); if (!this.funnels.has(fid) || !key(fid)) return;
      const f = (d.f[fid] ||= {});
      if (step === 'funnel') f.v = (f.v || 0) + 1; else f.ck = (f.ck || 0) + 1;
    } else return;
    this.saveLazy();
  }
  _countOrder(o) {
    const d = this._day(dhakaDate(o.created)), ch = o.source?.channel || 'direct';
    d.ord++; d.rev += o.totals.total;
    d.so[ch] = (d.so[ch] || 0) + 1; d.sr[ch] = (d.sr[ch] || 0) + o.totals.total;
    const bump = o.items.find((l) => l.offer === 'bump');
    if (bump) { d.bump = (d.bump || 0) + 1; d.bumpRev = (d.bumpRev || 0) + bump.price; }
    if (o.funnel) {
      const f = (d.f[o.funnel] ||= {});
      f.ord = (f.ord || 0) + 1; f.rev = (f.rev || 0) + o.totals.total;
      if (bump) f.bump = (f.bump || 0) + 1;
    }
  }

  /* ----------------------------------------------------------- dashboard */
  /** Small numbers for the sidebar badges (fast: called on every page). */
  counts() {
    let pending = 0, attention = 0;
    for (const o of this.data.orders) if (o.status === 'pending') pending++;
    for (const p of this.data.products) if (p.status !== 'in') attention++;
    const dayAgo = Date.now() - 7 * DAY;
    return {
      pending, attention,
      reviews: this.data.reviews.filter((r) => !r.approved).length,
      unread: this.data.messages.filter((m) => !m.read).length,
      abandoned: this.data.abandoned.filter((a) => a.status === 'open' && a.updated > dayAgo).length,
    };
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
    if (inp.vipSpend !== undefined) s.vipSpend = num(inp.vipSpend, 0, 100_000_000, s.vipSpend);
    if (inp.photos) {
      s.photos = {
        fit: ['auto', 'pad', 'crop', 'off'].includes(inp.photos.fit) ? inp.photos.fit : s.photos.fit,
        bg: ['auto', 'white', 'blur'].includes(inp.photos.bg) ? inp.photos.bg : s.photos.bg,
      };
    }
    if (inp.payments) {
      const p = inp.payments;
      s.payments = { ...s.payments, cod: pickBool(p.cod, s.payments.cod), bkash: pickBool(p.bkash, s.payments.bkash), nagad: pickBool(p.nagad, s.payments.nagad), bkashNumber: str(p.bkashNumber ?? s.payments.bkashNumber, 30), nagadNumber: str(p.nagadNumber ?? s.payments.nagadNumber, 30), note: str(p.note ?? s.payments.note, 300) };
      if (!s.payments.cod && !s.payments.bkash && !s.payments.nagad) s.payments.cod = true;
    }
    if (inp.costs) {
      const c = inp.costs;
      s.costs = { courierInside: num(c.courierInside, 0, 100_000, s.costs.courierInside), courierOutside: num(c.courierOutside, 0, 100_000, s.costs.courierOutside), packaging: num(c.packaging, 0, 100_000, s.costs.packaging), codPct: num(c.codPct, 0, 20, s.costs.codPct) };
    }
    if (inp.tracking) {
      const t = inp.tracking;
      const fb = str(t.fbPixel, 30), ga = str(t.ga4, 30).toUpperCase(), tt = str(t.tiktok, 40).toUpperCase();
      if (fb && !/^\d{6,20}$/.test(fb)) throw bad('The Facebook Pixel ID is the long number from Events Manager (digits only).', 'tracking.fbPixel');
      if (ga && !/^G-[A-Z0-9]{4,16}$/.test(ga)) throw bad('The Google Analytics ID looks like G-XXXXXXXXXX.', 'tracking.ga4');
      if (tt && !/^[A-Z0-9]{10,30}$/.test(tt)) throw bad('The TikTok Pixel ID is letters and numbers only.', 'tracking.tiktok');
      s.tracking = { fbPixel: fb, ga4: ga, tiktok: tt };
    }
    if (inp.boosters) {
      const b = inp.boosters, ob = s.boosters;
      const offer = (o, ex) => ({ enabled: pickBool(o?.enabled, ex.enabled, false), pid: str(o?.pid ?? ex.pid, 40), price: num(o?.price ?? ex.price, 0, 10_000_000, ex.price), title: str(o?.title ?? ex.title, 120), ...(ex.minutes !== undefined ? { minutes: int(o?.minutes ?? ex.minutes, 5, 1440, 30) } : {}) });
      const next = {
        proof: pickBool(b.proof, ob.proof), proofNames: pickBool(b.proofNames, ob.proofNames), soldCount: pickBool(b.soldCount, ob.soldCount),
        chat: pickBool(b.chat, ob.chat), fbt: pickBool(b.fbt, ob.fbt), capture: pickBool(b.capture, ob.capture),
        popup: b.popup ? { enabled: pickBool(b.popup.enabled, ob.popup.enabled), delay: int(b.popup.delay, 0, 600, ob.popup.delay), exit: pickBool(b.popup.exit, ob.popup.exit), ask: b.popup.ask === 'phone' ? 'phone' : 'email', title: str(b.popup.title ?? ob.popup.title, 100), text: str(b.popup.text ?? ob.popup.text, 240), coupon: str(b.popup.coupon ?? ob.popup.coupon, 30).toUpperCase() } : ob.popup,
        bump: b.bump ? offer(b.bump, ob.bump) : ob.bump,
        upsell: b.upsell ? offer(b.upsell, ob.upsell) : ob.upsell,
        campaign: b.campaign ? { enabled: pickBool(b.campaign.enabled, ob.campaign.enabled), text: str(b.campaign.text ?? ob.campaign.text, 120), ends: b.campaign.ends !== undefined ? dhakaDateTime(b.campaign.ends) || '' : ob.campaign.ends, coupon: str(b.campaign.coupon ?? ob.campaign.coupon, 30).toUpperCase(), link: link(b.campaign.link ?? ob.campaign.link) || '/offers' } : ob.campaign,
      };
      for (const [k, label] of [['bump', 'checkout add-on'], ['upsell', 'after-order offer']]) {
        const o = next[k];
        if (!o.enabled) continue;
        const p = this.products.get(o.pid);
        if (!p) throw bad(`Choose a product for the ${label}.`);
        if ((p.options || []).length) throw bad(`The ${label} product cannot have options (size, colour…). Pick another product.`);
      }
      for (const [code, label] of [[next.popup.coupon, 'popup'], [next.campaign.coupon, 'campaign bar']]) if (code && !this.coupons.has(code)) throw bad(`Coupon ${code} (${label}) does not exist. Create it in Coupons first.`);
      s.boosters = next;
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
    d.stockLog = d.stockLog.filter((x) => !String(x.ref).startsWith('BL') || this.orders.has(x.ref) && !this.orders.get(x.ref).demo);
    for (const p of d.products) if (p.demo) p.sold = 0;
    if (what === 'products') {
      const gone = new Set(d.products.filter((p) => p.demo).map((p) => p.id));
      d.products = d.products.filter((p) => !gone.has(p.id));
      d.reviews = d.reviews.filter((r) => !gone.has(r.pid));
      d.funnels = d.funnels.filter((f) => !f.demo && !gone.has(f.pid));
      d.stockLog = d.stockLog.filter((x) => !gone.has(x.pid));
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
