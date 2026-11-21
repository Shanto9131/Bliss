// Renders the HTML shells. The full catalogue is embedded as JSON in the page, so the
// storefront paints with ZERO extra API round-trips. Pages are cached per catalogue version.
import fs from 'node:fs';
import { escapeHtml, LRU } from '../public/assets/js/engine.js';
import { makeEntry, sendEntry } from './static.js';

// Literal URLs so serverless bundlers (Vercel nft) include the templates automatically.
const VIEWS = { store: new URL('./views/store.html', import.meta.url), admin: new URL('./views/admin.html', import.meta.url) };

const STATIC_ROUTES = new Set(['/', '/shop', '/search', '/cart', '/checkout', '/track', '/wishlist', '/account', '/gift-box-builder', '/corporate', '/help', '/about', '/offers']);
const POLICY = { shipping: 'Shipping & Delivery', returns: 'Returns & Exchanges', privacy: 'Privacy Policy', terms: 'Terms of Service' };

export class Renderer {
  constructor({ store, files, watch = false }) {
    this.store = store; this.files = files;
    this.cache = new LRU(400);
    this._cat = { v: -1 }; this._boot = { v: -1 };
    this.tpl = new Map(); this.trev = 0;
    if (watch) { try { fs.watch(new URL('./views/', import.meta.url), () => { this.tpl.clear(); this.trev++; }); } catch { /* restart to pick up template edits */ } }
  }
  rev() { return `${this.files.rev}.${this.trev}`; }

  /** /api/catalog response, compressed once per catalogue version. */
  catalogEntry() {
    if (this._cat.v !== this.store.version) {
      const json = JSON.stringify(this.store.catalog());
      this._cat = { v: this.store.version, entry: makeEntry(Buffer.from(json), 'application/json; charset=utf-8', 6), json };
    }
    return this._cat.entry;
  }
  bootTag() {
    if (this._boot.v !== this.store.version) {
      this.catalogEntry();
      this._boot = { v: this.store.version, html: `<script id="boot" type="application/json">${this._cat.json.replace(/</g, '\\u003c')}</script>` };
    }
    return this._boot.html;
  }
  template(name) {
    const s = this.store.settings;
    let raw = this.tpl.get(name);
    if (raw == null) { raw = fs.readFileSync(VIEWS[name], 'utf8'); this.tpl.set(name, raw); }
    return raw
      .replace(/\{\{asset:([^}]+)\}\}/g, (_, p) => this.files.url(p.trim()))
      .replace(/\{\{store:(\w+)\}\}/g, (_, k) => escapeHtml(s.store[k] ?? ''))
      .replace('{{announce}}', escapeHtml(s.announcements[0] || ''));
  }

  resolve(pathname) {
    const s = this.store, st = s.settings.store, brand = st.name || 'BLISS';
    const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    const base = { status: 200, title: `${brand} | ${st.tagline || 'Gifts & Moments'}`, desc: s.settings.hero.subtitle };
    if (STATIC_ROUTES.has(clean)) {
      const names = { '/shop': 'Shop all gifts', '/gift-box-builder': 'Build your own gift box', '/corporate': 'Corporate & bulk gifting', '/track': 'Track your order', '/help': 'Help & support', '/about': 'Our story', '/wishlist': 'Your wishlist', '/cart': 'Your bag', '/checkout': 'Checkout', '/account': 'Your account', '/search': 'Search', '/offers': 'Offers & deals' };
      return clean === '/' ? base : { ...base, title: `${names[clean]} | ${brand}` };
    }
    let m;
    if ((m = clean.match(/^\/product\/([^/]+)$/))) {
      const p = s.slugs.get(m[1]);
      if (p && p.active) return { status: 200, title: `${p.name} | ${brand}`, desc: (p.desc || '').slice(0, 160), image: p.images[0], product: p };
    } else if ((m = clean.match(/^\/category\/([^/]+)$/))) {
      const c = s.data.categories.find((x) => x.slug === m[1]);
      if (c) return { status: 200, title: `${c.name} | ${brand}`, desc: `${c.blurb}. Shop ${c.name.toLowerCase()} at ${brand}, wrapped and delivered across Bangladesh.`, image: c.image };
    } else if ((m = clean.match(/^\/occasion\/([a-z0-9-]+)$/))) {
      const t = m[1].replace(/-/g, ' ');
      return { status: 200, title: `${t.replace(/\b\w/g, (x) => x.toUpperCase())} gifts | ${brand}`, desc: `Thoughtful ${t} gift ideas, beautifully wrapped by ${brand}.` };
    } else if ((m = clean.match(/^\/policies\/([a-z]+)$/)) && POLICY[m[1]]) {
      return { status: 200, title: `${POLICY[m[1]]} | ${brand}`, desc: base.desc };
    } else if ((m = clean.match(/^\/f\/([a-z0-9ঀ-৿-]+)$/))) {
      const f = s.publicFunnel(m[1]);
      if (f) return { status: 200, title: `${f.headline.replace(/\*/g, '')} | ${brand}`, desc: (f.subheadline || f.body || '').slice(0, 160), image: f.image || f.product?.img, funnel: f, noindex: true };
    } else if (/^\/order\/[A-Z0-9]{4,12}$/i.test(clean)) {
      return { status: 200, title: `Order confirmed | ${brand}`, desc: base.desc, noindex: true };
    }
    return { status: 404, title: `Page not found | ${brand}`, desc: base.desc, noindex: true };
  }

  head(r, origin, pathname) {
    const s = this.store, brand = s.settings.store.name || 'BLISS';
    const abs = (u) => (u && u.startsWith('/') ? origin + u : u);
    let h = `<title>${escapeHtml(r.title)}</title><meta name="description" content="${escapeHtml(r.desc)}"><link rel="canonical" href="${escapeHtml(origin + pathname)}">`;
    h += `<meta property="og:site_name" content="${escapeHtml(brand)}"><meta property="og:title" content="${escapeHtml(r.title)}"><meta property="og:description" content="${escapeHtml(r.desc)}"><meta property="og:url" content="${escapeHtml(origin + pathname)}"><meta property="og:type" content="${r.product ? 'product' : 'website'}"><meta name="twitter:card" content="summary_large_image">`;
    if (r.image) h += `<meta property="og:image" content="${escapeHtml(abs(r.image))}">`;
    if (r.noindex) h += '<meta name="robots" content="noindex">';
    if (r.product) {
      const p = r.product;
      const ld = {
        '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.desc, sku: p.id,
        image: p.images.map(abs), brand: { '@type': 'Brand', name: brand },
        offers: { '@type': 'Offer', priceCurrency: 'BDT', price: s.live(p).price, url: origin + pathname, availability: `https://schema.org/${p.status === 'out' ? 'OutOfStock' : p.status === 'limited' ? 'LimitedAvailability' : 'InStock'}` },
      };
      if (p.reviewCount) ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.reviewCount };
      h += `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
    }
    if (r.funnel) h += `<script id="funnel" type="application/json">${JSON.stringify(r.funnel).replace(/</g, '\\u003c')}</script>`;
    return h;
  }

  page(req, res, pathname, origin) {
    const key = `s|${origin}|${pathname}`;
    let c = this.cache.get(key);
    if (!c || c.v !== this.store.version || c.rev !== this.rev()) {
      const r = this.resolve(pathname);
      const html = this.template('store').replace('<!--HEAD-->', this.head(r, origin, pathname)).replace('<!--BOOT-->', this.bootTag());
      c = this.cache.set(key, { v: this.store.version, rev: this.rev(), status: r.status, entry: makeEntry(Buffer.from(html), 'text/html; charset=utf-8', 5) });
    }
    if (c.status !== 200) { res.statusCode = c.status; }
    if (c.status === 404) {
      const e = c.entry; res.writeHead(404, { 'Content-Type': e.type, 'Cache-Control': 'no-cache' }); res.end(e.raw); return;
    }
    sendEntry(req, res, c.entry, 'no-cache');
  }

  admin(req, res) {
    let c = this.cache.get('admin');
    if (!c || c.rev !== this.rev() || c.v !== this.store.version) c = this.cache.set('admin', { rev: this.rev(), v: this.store.version, entry: makeEntry(Buffer.from(this.template('admin')), 'text/html; charset=utf-8', 5) });
    res.setHeader('X-Robots-Tag', 'noindex');
    sendEntry(req, res, c.entry, 'no-cache');
  }

  sitemap(req, res, origin) {
    const key = `sm|${origin}`;
    let c = this.cache.get(key);
    if (!c || c.v !== this.store.version) {
      const urls = ['/', '/shop', '/gift-box-builder', '/corporate', '/help', '/about',
        ...this.store.data.categories.filter((x) => this.store.data.products.some((p) => p.active && p.cat === x.id)).map((x) => `/category/${x.slug}`),
        ...this.store.data.products.filter((p) => p.active).map((p) => `/product/${p.slug}`)];
      const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${escapeHtml(origin + u)}</loc></url>`).join('')}</urlset>`;
      c = this.cache.set(key, { v: this.store.version, entry: makeEntry(Buffer.from(xml), 'application/xml; charset=utf-8', 5) });
    }
    sendEntry(req, res, c.entry, 'public, max-age=3600');
  }
}
