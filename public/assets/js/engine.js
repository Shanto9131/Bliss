/*!
 * BLISS catalog engine. One ES module shared by the browser AND the Node server,
 * so search results, filters and order totals are identical on both sides.
 *
 * Data structures & algorithms (why the shop feels instant):
 *  - Map hash indexes (id / slug / category)        O(1) lookups
 *  - Bitsets on Uint32Array for facet filters        32 products per CPU instruction
 *  - Pre-sorted index arrays, built lazily           no sorting at query time
 *  - Binary search (lower/upper bound) on price      O(log n) price-range slicing
 *  - Inverted index + Trie                           instant prefix search & autocomplete
 *  - BK-tree + Damerau-Levenshtein distance         typo tolerance ("did you mean…")
 *  - LRU cache                                       repeated queries answered in O(1)
 *  - Binary min-heap                                 top-K (best sellers) in O(n log k)
 */

/* ---------------------------------------------------------------- LRU cache */
export class LRU {
  constructor(max = 100) { this.max = max; this.map = new Map(); }
  get(k) {
    const m = this.map;
    if (!m.has(k)) return undefined;
    const v = m.get(k); m.delete(k); m.set(k, v); // move to most-recent
    return v;
  }
  set(k, v) {
    const m = this.map;
    if (m.has(k)) m.delete(k);
    m.set(k, v);
    if (m.size > this.max) m.delete(m.keys().next().value); // evict least-recent
    return v;
  }
  has(k) { return this.map.has(k); }
  delete(k) { return this.map.delete(k); }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

/* ------------------------------------------------------------------ Bitset */
export class Bitset {
  constructor(n, words) { this.n = n; this.w = words || new Uint32Array((n + 31) >>> 5); }
  static full(n) {
    const b = new Bitset(n); b.w.fill(0xFFFFFFFF);
    const r = n & 31; if (r) b.w[b.w.length - 1] = ((1 << r) >>> 0) - 1;
    return b;
  }
  set(i) { this.w[i >>> 5] |= (1 << (i & 31)); return this; }
  has(i) { return (this.w[i >>> 5] & (1 << (i & 31))) !== 0; }
  clone() { return new Bitset(this.n, this.w.slice()); }
  and(o) { return this.clone().andInPlace(o); }
  andInPlace(o) { const a = this.w, b = o.w; for (let i = 0; i < a.length; i++) a[i] &= b[i]; return this; }
  orInPlace(o) { const a = this.w, b = o.w; for (let i = 0; i < a.length; i++) a[i] |= b[i]; return this; }
  count() { // SWAR popcount
    let c = 0;
    for (let x of this.w) {
      x -= (x >>> 1) & 0x55555555;
      x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
      c += Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
    }
    return c;
  }
}

/* ---------------------------------------------------------- binary search */
export function lowerBound(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
export function upperBound(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; }

/* ------------------------------------------------------------- top-K heap */
export function topK(items, k, score) {
  const h = [];
  const swap = (i, j) => { const t = h[i]; h[i] = h[j]; h[j] = t; };
  const up = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; swap(p, i); i = p; } };
  const down = (i) => {
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) return; swap(m, i); i = m;
    }
  };
  for (const it of items) {
    const s = score(it);
    if (h.length < k) { h.push([s, it]); up(h.length - 1); }
    else if (k > 0 && s > h[0][0]) { h[0] = [s, it]; down(0); }
  }
  return h.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

/* -------------------------------------------------------------- text utils */
// "gift"/"present" carry no meaning in a gift shop ("gift for wife" == "wife").
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'of', 'with', 'to', 'in', 'on', 'by', 'my', 'is', 'gift', 'present', 'pc', 'pcs']);
export function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}
function stem(t) {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && /(ch|sh|x|ss)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}
export function tokenize(s) {
  return normalize(s).split(/[^a-z0-9ঀ-৿]+/).map(stem).filter((t) => (t.length > 1 || /\d/.test(t)) && !STOP.has(t));
}
export function slugify(s) {
  return normalize(s).replace(/[^a-z0-9ঀ-৿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const money = (n) => '৳' + Math.round(Number(n) || 0).toLocaleString('en-IN');

/* ------------------------------------------------------------------- Trie */
export class Trie {
  constructor() { this.root = { c: new Map(), w: null }; }
  insert(word) {
    let n = this.root;
    for (const ch of word) { let nx = n.c.get(ch); if (!nx) { nx = { c: new Map(), w: null }; n.c.set(ch, nx); } n = nx; }
    n.w = word;
  }
  /** Breadth-first walk below the prefix node, so shorter completions come first. */
  complete(prefix, limit = 30) {
    let n = this.root;
    for (const ch of prefix) { n = n.c.get(ch); if (!n) return []; }
    const out = [], queue = [n];
    for (let i = 0; i < queue.length && out.length < limit; i++) {
      const cur = queue[i];
      if (cur.w) out.push(cur.w);
      for (const nx of cur.c.values()) queue.push(nx);
    }
    return out;
  }
}

/* ------------------------------------------ edit distance + BK-tree */
/**
 * Damerau–Levenshtein (optimal string alignment): insert, delete, substitute AND swap
 * neighbours each cost 1, so "rign" -> "ring" is one typo. Two rolling rows + one extra
 * for transpositions = O(min) memory; exits early once every cell in a row exceeds `max`.
 */
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let pp = new Array(lb + 1).fill(0), prev = new Array(lb + 1), cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i; let rowMin = i; const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === cb ? 0 : 1));
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb && pp[j - 2] + 1 < v) v = pp[j - 2] + 1;
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = pp; pp = prev; prev = cur; cur = t;
  }
  return prev[lb];
}

export class BKTree {
  constructor() { this.root = null; }
  add(word) {
    if (!this.root) { this.root = { w: word, k: new Map() }; return; }
    let n = this.root;
    for (;;) {
      const d = editDistance(word, n.w);
      if (d === 0) return;
      const nx = n.k.get(d);
      if (!nx) { n.k.set(d, { w: word, k: new Map() }); return; }
      n = nx;
    }
  }
  /** All words within `max` edits; triangle inequality prunes most of the tree. */
  search(word, max) {
    const out = [];
    if (!this.root) return out;
    const stack = [this.root];
    while (stack.length) {
      const n = stack.pop();
      const d = editDistance(word, n.w);
      if (d <= max) out.push([n.w, d]);
      for (const [k, child] of n.k) if (k >= d - max && k <= d + max) stack.push(child);
    }
    return out.sort((x, y) => x[1] - y[1] || x[0].length - y[0].length);
  }
}

/* ----------------------------------------------------------- CatalogIndex */
const SYNONYMS = {
  her: 'her women woman girl girlfriend wife mother mom sister female ladies',
  him: 'him men man boy boyfriend husband father dad brother male gents',
  unisex: 'unisex everyone couple',
  kids: 'kids child children baby',
};
const FACET_GROUPS = ['cat', 'tag', 'g', 's'];

export class CatalogIndex {
  /** @param products visible products, @param categories category list */
  constructor(products, categories = []) {
    const P = this.products = products;
    const n = this.n = P.length;
    this.byId = new Map(); this.bySlug = new Map(); this.pos = new Map();
    this.cats = new Map(categories.map((c) => [c.id, c]));
    this.catBySlug = new Map(categories.map((c) => [c.slug, c]));
    this.facets = { cat: new Map(), tag: new Map(), g: new Map(), s: new Map(), sale: new Map() };
    this.all = Bitset.full(n);
    this.postings = new Map(); // token -> Map(productIdx -> weight)
    this.trie = new Trie(); this.bk = new BKTree();
    this._orders = Object.create(null);
    this.cache = new LRU(80);

    P.forEach((p, i) => {
      this.byId.set(p.id, p); this.bySlug.set(p.slug, p); this.pos.set(p.id, i);
      this._facet('cat', p.cat, i);
      for (const t of p.tags || []) this._facet('tag', t, i);
      this._facet('g', p.gender || 'unisex', i);
      this._facet('s', p.stock || 'in', i);
      if (p.compare > p.price) this._facet('sale', '1', i);
      const cat = this.cats.get(p.cat);
      this._index(p.name, i, 3);
      if (cat) this._index(cat.name, i, 2);
      this._index((p.tags || []).join(' '), i, 1.5);
      this._index(SYNONYMS[p.gender] || '', i, 1);
      if (p.gender === 'unisex') this._index(SYNONYMS.her + ' ' + SYNONYMS.him, i, 0.6); // suits anyone
      if (p.keywords) this._index(p.keywords, i, 1);
    });
    for (const tok of this.postings.keys()) { this.trie.insert(tok); this.bk.add(tok); }
  }

  _facet(group, value, i) {
    const m = this.facets[group];
    let b = m.get(value); if (!b) { b = new Bitset(this.n); m.set(value, b); }
    b.set(i);
  }
  _index(text, i, weight) {
    for (const tok of tokenize(text)) {
      let post = this.postings.get(tok);
      if (!post) { post = new Map(); this.postings.set(tok, post); }
      if ((post.get(i) || 0) < weight) post.set(i, weight);
    }
  }

  /** Lazily build & memoise each sort order as an array of product indexes. */
  order(name) {
    if (this._orders[name]) return this._orders[name];
    const P = this.products;
    const idx = Array.from({ length: this.n }, (_, i) => i);
    const avail = (i) => (P[i].stock === 'out' ? 1 : 0);
    const cmp = {
      featured: (a, b) => avail(a) - avail(b) || (P[b].featured ? 1 : 0) - (P[a].featured ? 1 : 0) || P[b].sold - P[a].sold,
      popular: (a, b) => avail(a) - avail(b) || P[b].sold - P[a].sold,
      newest: (a, b) => P[b].created - P[a].created,
      oldest: (a, b) => P[a].created - P[b].created,
      'price-asc': (a, b) => P[a].price - P[b].price || a - b,
      'price-desc': (a, b) => P[b].price - P[a].price || a - b,
      'name-asc': (a, b) => P[a].name.localeCompare(P[b].name),
      'name-desc': (a, b) => P[b].name.localeCompare(P[a].name),
      rating: (a, b) => avail(a) - avail(b) || P[b].rating - P[a].rating || P[b].reviews - P[a].reviews,
      discount: (a, b) => off(P[b]) - off(P[a]),
    }[name] || null;
    if (!cmp) return this.order('featured');
    return (this._orders[name] = idx.sort(cmp));
  }

  _union(group, values) {
    const out = new Bitset(this.n);
    for (const v of values) { const b = this.facets[group].get(v); if (b) out.orInPlace(b); }
    return out;
  }

  _priceRange(min, max) {
    const ord = this.order('price-asc');
    const prices = this._prices || (this._prices = ord.map((i) => this.products[i].price));
    const lo = min == null ? 0 : lowerBound(prices, min);
    const hi = max == null ? prices.length : upperBound(prices, max);
    const b = new Bitset(this.n);
    for (let k = lo; k < hi; k++) b.set(ord[k]);
    return b;
  }

  /** Full-text search: exact + prefix (trie) + fuzzy (BK-tree), AND across words. */
  search(text) {
    const toks = tokenize(text);
    if (!toks.length) return { set: this.all, scores: null, suggestion: null };
    const scores = new Map(); let set = null; const corrected = []; let changed = false;
    toks.forEach((tok) => {
      const tokScores = new Map();
      const add = (word, factor) => {
        const post = this.postings.get(word); if (!post) return;
        for (const [i, w] of post) { const s = w * factor; if ((tokScores.get(i) || 0) < s) tokScores.set(i, s); }
      };
      add(tok, 1);
      for (const w of this.trie.complete(tok, 40)) if (w !== tok) add(w, w.length - tok.length <= 2 ? 0.85 : 0.7);
      let used = tok;
      if (!tokScores.size && tok.length >= 3) {
        const near = this.bk.search(tok, tok.length >= 7 ? 2 : 1);
        if (near.length) { near.slice(0, 4).forEach(([w, d]) => add(w, d === 1 ? 0.6 : 0.45)); used = near[0][0]; changed = true; }
      }
      corrected.push(used);
      const tokSet = new Bitset(this.n);
      for (const [i, s] of tokScores) { tokSet.set(i); scores.set(i, (scores.get(i) || 0) + s); }
      set = set ? set.andInPlace(tokSet) : tokSet;
    });
    if (set.count() === 0 && scores.size) { set = new Bitset(this.n); for (const i of scores.keys()) set.set(i); }
    return { set, scores, suggestion: changed ? corrected.join(' ') : null };
  }

  /**
   * query({ q, cat, tag, g, s, sale, min, max, sort, page, size })
   * Returns ordered items, facet counts (each facet counted against the other filters) and price bounds.
   */
  query(q = {}) {
    const key = JSON.stringify(q);
    const hit = this.cache.get(key); if (hit) return hit;
    const P = this.products;
    let scores = null, base = this.all, suggestion = null;
    if (q.q && String(q.q).trim()) { const r = this.search(q.q); scores = r.scores; base = r.set; suggestion = r.suggestion; }

    const groupBits = {};
    for (const g of FACET_GROUPS) { const vals = toArr(q[g]); if (vals.length) groupBits[g] = this._union(g, vals); }
    if (q.sale) groupBits.sale = this._union('sale', ['1']);
    const min = toNum(q.min), max = toNum(q.max);
    const priceBits = min != null || max != null ? this._priceRange(min, max) : null;

    const combine = (skip) => {
      const b = base.clone();
      for (const g in groupBits) if (g !== skip) b.andInPlace(groupBits[g]);
      if (priceBits && skip !== 'price') b.andInPlace(priceBits);
      return b;
    };
    const final = combine(null);

    const facets = {};
    for (const g of FACET_GROUPS) {
      const ctx = combine(g), m = {};
      for (const [v, bits] of this.facets[g]) m[v] = ctx.and(bits).count();
      facets[g] = m;
    }
    // Price bounds of everything matching except the price filter itself (for the slider).
    const noPrice = combine('price'); let pMin = Infinity, pMax = 0;
    for (let i = 0; i < this.n; i++) if (noPrice.has(i)) { const pr = P[i].price; if (pr < pMin) pMin = pr; if (pr > pMax) pMax = pr; }

    const sort = q.sort || (scores ? 'relevance' : 'featured');
    let ids = [];
    if (sort === 'relevance' && scores) {
      for (const i of scores.keys()) if (final.has(i)) ids.push(i);
      ids.sort((a, b) => scores.get(b) - scores.get(a) || (P[a].stock === 'out') - (P[b].stock === 'out') || P[b].sold - P[a].sold);
    } else {
      for (const i of this.order(sort)) if (final.has(i)) ids.push(i);
    }
    // `all` (admin only; the public API never forwards it) returns every match on one page.
    const size = q.all ? Math.max(1, this.n) : Math.max(1, Math.min(200, q.size | 0 || 24));
    const pages = Math.max(1, Math.ceil(ids.length / size));
    const page = Math.min(pages, Math.max(1, q.page | 0 || 1));
    const res = {
      total: ids.length, page, pages, size,
      items: ids.slice((page - 1) * size, page * size).map((i) => P[i]),
      facets, suggestion,
      priceMin: pMin === Infinity ? 0 : pMin, priceMax: pMax,
    };
    return this.cache.set(key, res);
  }

  /** Autocomplete for the search box: top products, matching categories, word completions. */
  suggest(text, limit = 6) {
    const nt = normalize(text).trim();
    if (!nt) return { products: [], cats: [], words: [], total: 0, suggestion: null };
    const res = this.query({ q: text, size: limit, sort: 'relevance' });
    const cats = [...this.cats.values()].filter((c) => normalize(c.name).includes(nt)).slice(0, 3);
    const toks = tokenize(text), last = toks[toks.length - 1] || '';
    const words = last ? this.trie.complete(last, 5).filter((w) => w !== last) : [];
    return { products: res.items, cats, words, total: res.total, suggestion: res.suggestion };
  }

  /** Products similar to p: same category first, then shared tags, then popularity. */
  related(p, k = 8) {
    const tags = new Set(p.tags || []);
    return topK(this.products.filter((x) => x.id !== p.id), k, (x) =>
      (x.cat === p.cat ? 10 : 0) + (x.tags || []).reduce((s, t) => s + (tags.has(t) ? 2 : 0), 0) +
      (x.gender === p.gender ? 1 : 0) + Math.min(3, (x.sold || 0) / 100) - (x.stock === 'out' ? 8 : 0));
  }
}

function off(p) { return p.compare > p.price ? (p.compare - p.price) / p.compare : 0; }
function toArr(v) { return v == null || v === '' ? [] : Array.isArray(v) ? v.filter(Boolean) : String(v).split(',').filter(Boolean); }
function toNum(v) { if (v == null || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; }

/* ------------------------------------------------------------ cart totals */
/**
 * Same function runs in the browser (cart preview) and on the server (authoritative order total).
 * lines: [{ price, qty }]   opts: { settings, coupon, zone: 'inside'|'outside', express, giftWrap }
 */
export function computeTotals(lines, opts) {
  const s = opts.settings || {};
  const d = s.delivery || { inside: 70, outside: 130, express: 180, freeOver: 0 };
  let subtotal = 0, count = 0;
  for (const l of lines) { subtotal += l.price * l.qty; count += l.qty; }

  let bundlePct = 0, nextTier = null;
  const tiers = (s.bundleTiers || []).filter((t) => t.min > 0 && t.pct > 0).sort((a, b) => a.min - b.min);
  for (const t of tiers) { if (count >= t.min) bundlePct = t.pct; else if (!nextTier) nextTier = t; }
  const bundleOff = Math.round((subtotal * bundlePct) / 100);

  let couponOff = 0, couponNote = '';
  const c = opts.coupon;
  if (c) {
    if (subtotal < (c.minSubtotal || 0)) couponNote = `Add ${money(c.minSubtotal - subtotal)} more to use ${c.code}`;
    else {
      couponOff = c.type === 'percent' ? Math.round((subtotal * c.value) / 100) : Math.min(c.value, subtotal);
      if (c.maxDiscount) couponOff = Math.min(couponOff, c.maxDiscount);
    }
  }
  // Offers don't stack: the customer automatically gets whichever saves more.
  let discount = 0, discountLabel = '', discountType = null;
  if (couponOff > 0 && couponOff >= bundleOff) { discount = couponOff; discountLabel = `Coupon ${c.code}`; discountType = 'coupon'; }
  else if (bundleOff > 0) { discount = bundleOff; discountLabel = `Mix & Match ${bundlePct}% off`; discountType = 'bundle'; }
  if (c && couponOff > 0 && discountType === 'bundle') couponNote = `Mix & Match saves you more than ${c.code}, so we applied that instead`;

  const afterDiscount = subtotal - discount;
  let delivery = 0, freeDelivery = false;
  if (opts.noDelivery) delivery = 0;
  else if (count > 0) {
    if (opts.express) delivery = d.express;
    else {
      delivery = opts.zone === 'outside' ? d.outside : d.inside;
      if (d.freeOver && afterDiscount >= d.freeOver) { delivery = 0; freeDelivery = true; }
    }
  }
  const wrap = opts.giftWrap && count ? s.giftWrapPrice || 0 : 0;
  return {
    subtotal, count, bundlePct, bundleOff, nextTier, couponOff, couponNote,
    discount, discountLabel, discountType, delivery, freeDelivery, wrap,
    total: Math.max(0, afterDiscount + delivery + wrap),
    freeOver: d.freeOver || 0, toFree: d.freeOver ? Math.max(0, d.freeOver - afterDiscount) : 0,
  };
}

export const ORDER_STATUSES = [
  ['pending', 'Order placed'],
  ['confirmed', 'Confirmed'],
  ['processing', 'Packing your gift'],
  ['shipped', 'Out for delivery'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
  ['returned', 'Returned'],
];
/** Orders in these states are not sales: their stock is back on the shelf. */
export const INACTIVE_STATUSES = new Set(['cancelled', 'returned']);

/**
 * Settings a funnel (landing page) order is priced with. Shared by browser and server so the
 * total the shopper sees is exactly the total the server charges.
 */
export function funnelSettings(settings, f) {
  const d = settings.delivery || {};
  const num = (v, dflt) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? dflt : Number(v));
  return {
    ...settings,
    bundleTiers: [],
    delivery: {
      ...d,
      inside: f.freeDelivery ? 0 : num(f.deliveryInside, d.inside),
      outside: f.freeDelivery ? 0 : num(f.deliveryOutside, d.outside),
      freeOver: f.freeDelivery ? 0 : d.freeOver,
    },
  };
}

/** Where a visit came from, from the landing URL + referrer (browser only, but pure). */
export function detectSource(search, referrer) {
  const q = new URLSearchParams(search || '');
  const utm = (q.get('utm_source') || '').toLowerCase().trim();
  const campaign = (q.get('utm_campaign') || '').slice(0, 60);
  const map = (s) => (/^(fb|facebook|meta|ig|instagram|messenger)/.test(s) ? (/^(ig|instagram)/.test(s) ? 'instagram' : 'facebook') : /google|gads|adwords/.test(s) ? 'google' : /tiktok/.test(s) ? 'tiktok' : /youtube|yt/.test(s) ? 'youtube' : /whatsapp|wa$/.test(s) ? 'whatsapp' : /mail|newsletter/.test(s) ? 'email' : /sms/.test(s) ? 'sms' : s.replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'other');
  if (utm) return { channel: map(utm), campaign };
  if (q.has('fbclid')) return { channel: 'facebook', campaign };
  if (q.has('gclid') || q.has('gbraid') || q.has('wbraid')) return { channel: 'google', campaign };
  if (q.has('ttclid')) return { channel: 'tiktok', campaign };
  let host = '';
  try { host = referrer ? new URL(referrer).hostname.replace(/^www\./, '') : ''; } catch { host = ''; }
  if (!host) return { channel: 'direct', campaign };
  if (/(^|\.)facebook\.com$|(^|\.)fb\.com$|messenger\.com$/.test(host)) return { channel: 'facebook', campaign };
  if (/instagram\.com$/.test(host)) return { channel: 'instagram', campaign };
  if (/(^|\.)google\./.test(host)) return { channel: 'google', campaign };
  if (/tiktok\.com$/.test(host)) return { channel: 'tiktok', campaign };
  if (/youtube\.com$|youtu\.be$/.test(host)) return { channel: 'youtube', campaign };
  if (/whatsapp\.com$/.test(host)) return { channel: 'whatsapp', campaign };
  if (/bing\.com$|duckduckgo\.com$|yahoo\./.test(host)) return { channel: 'search', campaign };
  return { channel: 'referral', campaign };
}
export const CHANNELS = { direct: 'Direct', facebook: 'Facebook', instagram: 'Instagram', google: 'Google', tiktok: 'TikTok', youtube: 'YouTube', whatsapp: 'WhatsApp', email: 'Email', sms: 'SMS', search: 'Other search', referral: 'Other websites', phone: 'Phone call', 'walk-in': 'Walk-in', other: 'Other' };
export const STOCK_LABEL = { in: 'In stock', limited: 'Limited stock', out: 'Out of stock' };
