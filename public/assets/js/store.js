// BLISS storefront: a tiny, framework-free SPA. All catalogue data arrives inside the HTML,
// so browsing, filtering and search run locally (no network) through the engine's indexes.
import { CatalogIndex, LRU, computeTotals, money, escapeHtml as esc, ORDER_STATUSES, tokenize } from './engine.js';

/* ================================================================ helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ic = (n, c = '') => `<svg class="i${c ? ' ' + c : ''}" aria-hidden="true"><use href="#i-${n}"></use></svg>`;
const DAY = 864e5;
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const ss = {
  get(k, d) { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const off = (p) => (p.compare > p.price ? Math.round((1 - p.price / p.compare) * 100) : 0);
const fmtDate = (ts, o = { day: 'numeric', month: 'short', year: 'numeric' }) => new Intl.DateTimeFormat('en-GB', { ...o, timeZone: 'Asia/Dhaka' }).format(new Date(ts));
const fmtTime = (ts) => new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' }).format(new Date(ts));
const PHONE_RE = /^(?:\+?88)?01[3-9]\d{8}$/;
const cleanPhone = (v) => String(v || '').replace(/[\s\-()]/g, '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const stars = (r) => { let s = ''; for (let i = 1; i <= 5; i++) s += ic(r >= i - 0.25 ? 'star-fill' : 'star', r >= i - 0.25 ? 'on' : ''); return `<span class="stars" role="img" aria-label="Rated ${r} out of 5">${s}</span>`; };

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch { throw Object.assign(new Error('You seem to be offline. Please check your connection and try again.'), { status: 0 }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status, data });
  return data;
}

function dhakaNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: (+p.hour % 24) * 60 + +p.minute };
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function expressInfo() {
  const d = C.settings.delivery, left = d.cutoffHour * 60 - dhakaNow().mins;
  return left > 0
    ? { today: true, short: `${Math.floor(left / 60)}h ${left % 60}m`, text: `Order within ${Math.floor(left / 60)}h ${left % 60}m for delivery today` }
    : { today: false, short: 'tomorrow', text: 'Order now for delivery tomorrow' };
}

/* ================================================================== state */
let C, IDX;
function setCatalog(c) {
  C = c;
  C.catById = new Map(c.categories.map((x) => [x.id, x]));
  C.catBySlug = new Map(c.categories.map((x) => [x.slug, x]));
  IDX = new CatalogIndex(c.products, c.categories);
}
setCatalog(JSON.parse($('#boot').textContent));

const S = {
  cart: ls.get('bliss.cart', []),
  wish: new Set(ls.get('bliss.wish', [])),
  recent: ls.get('bliss.recent', []),
  coupon: ls.get('bliss.coupon', null),
  user: null, orders: [], meLoaded: false,
};
const detailCache = new LRU(40);
const main = $('#main');

const OCCASIONS = [
  ['birthday', 'Birthday', 'cake'], ['anniversary', 'Anniversary', 'rings'], ['wedding', 'Wedding', 'diamond'],
  ['eid', 'Eid', 'moon'], ['valentines', "Valentine's", 'heart'], ['mothers-day', "Mother's Day", 'flower'],
  ['graduation', 'Graduation', 'cap'], ['new-baby', 'New Baby', 'baby'], ['just-because', 'Just Because', 'sparkle'], ['corporate', 'Corporate', 'briefcase'],
];
const OCC = new Map(OCCASIONS.map(([k, l, i]) => [k, { label: l, icon: i }]));
const GENDER = { her: 'For her', him: 'For him', kids: 'For kids', unisex: 'For anyone' };
const tagLabel = (t) => OCC.get(t)?.label || t.replace(/-/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());

/* ============================================================ cart model */
const lineKey = (pid, options) => pid + '|' + Object.keys(options || {}).sort().map((k) => `${k}=${options[k]}`).join('&');
function saveCart() { ls.set('bliss.cart', S.cart); updateBadges(); }
function inCartQty(pid) {
  let n = 0;
  for (const l of S.cart) { if (l.kind === 'box') n += l.items.filter((x) => x === pid).length * l.qty; else if (l.pid === pid) n += l.qty; }
  return n;
}
function maxQty(p) { return p.left != null ? p.left : 20; }
function addToCart(p, qty = 1, options = {}, { silent = false } = {}) {
  if (!p || p.stock === 'out') { toast('Sorry, this item is out of stock.', 'error'); return false; }
  const room = maxQty(p) - inCartQty(p.id);
  if (room <= 0) { toast(p.left != null ? `Only ${p.left} available and they're already in your bag.` : 'You have the maximum quantity in your bag.', 'error'); return false; }
  if (qty > room) { qty = room; toast(`Only ${maxQty(p)} available, so we added ${qty}.`, 'error'); }
  const key = lineKey(p.id, options);
  const line = S.cart.find((l) => l.key === key);
  if (line) line.qty += qty; else S.cart.push({ key, pid: p.id, qty, options });
  saveCart(); bumpBag();
  if (layer.type === 'drawer') renderCartDrawer();
  if (!silent) toast(`Added to bag: ${p.name}`, 'ok', { label: 'View bag', act: 'open-cart' });
  return true;
}
function changeQty(key, d) {
  const l = S.cart.find((x) => x.key === key); if (!l) return;
  if (d > 0 && l.kind !== 'box') { const p = IDX.byId.get(l.pid); if (p && inCartQty(p.id) >= maxQty(p)) { toast(p.left != null ? `Only ${p.left} left in stock.` : 'Maximum quantity reached.', 'error'); return; } }
  l.qty = Math.max(1, Math.min(20, l.qty + d));
  saveCart(); refreshCartViews();
}
function removeLine(key) { S.cart = S.cart.filter((x) => x.key !== key); saveCart(); refreshCartViews(); }
function resolveBox(l) {
  const B = C.settings.builder;
  const box = B.boxes.find((x) => x.id === l.boxId), wrap = B.wraps.find((x) => x.id === l.wrapId) || B.wraps[0], ribbon = B.ribbons.find((x) => x.id === l.ribbonId) || B.ribbons[0];
  const items = l.items.map((id) => IDX.byId.get(id));
  const missing = !box || items.some((p) => !p || !p.boxable);
  return {
    ...l, box, wrap, ribbon, itemsP: items, missing, out: items.some((p) => p && p.stock === 'out'),
    name: `Custom ${box ? box.name : 'Gift Box'}`, img: '/img/box.svg',
    price: (box?.price || 0) + (wrap?.price || 0) + items.reduce((s, p) => s + (p?.price || 0), 0),
  };
}
function resolveCart() {
  return S.cart.map((l) => {
    if (l.kind === 'box') return resolveBox(l);
    const p = IDX.byId.get(l.pid);
    if (!p) return { ...l, missing: true, name: 'This item is no longer available', img: '/img/placeholder.svg', price: 0 };
    return { ...l, p, name: p.name, img: p.img, price: p.price, slug: p.slug, out: p.stock === 'out', over: p.left != null && inCartQty(p.id) > p.left };
  });
}
const okLines = (lines) => lines.filter((l) => !l.missing && !l.out);
const cartCount = () => S.cart.reduce((s, l) => s + l.qty, 0);
function totalsFor(lines, o = {}) {
  return computeTotals(okLines(lines), { settings: C.settings, coupon: S.coupon, zone: o.zone || 'inside', express: !!o.express, giftWrap: !!o.giftWrap });
}
function toggleWish(id) {
  const on = !S.wish.has(id);
  if (on) S.wish.add(id); else S.wish.delete(id);
  ls.set('bliss.wish', [...S.wish]);
  for (const b of $$(`[data-act="wish"][data-id="${id}"]`)) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
  updateBadges();
  toast(on ? 'Saved to your wishlist' : 'Removed from wishlist', 'ok', on ? { label: 'View', act: 'go', href: '/wishlist' } : null);
  if (current?.name === 'wishlist') render(scrollY);
}
function pushRecent(id) { S.recent = [id, ...S.recent.filter((x) => x !== id)].slice(0, 12); ls.set('bliss.recent', S.recent); }

/* ================================================================ layers */
const layer = { el: null, type: null, onClose: null, lastFocus: null };
function openLayer(type, html, { label = '', onClose, cls = '' } = {}) {
  closeLayer(true);
  layer.lastFocus = document.activeElement;
  const root = $('#layers');
  root.innerHTML = `<div class="layer layer-${type} ${cls}" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="layer-backdrop" data-act="close-layer"></div><div class="layer-panel" tabindex="-1">${html}</div></div>`;
  layer.el = root.firstElementChild; layer.type = type; layer.onClose = onClose;
  document.documentElement.classList.add('locked');
  requestAnimationFrame(() => {
    layer.el?.classList.add('open');
    const f = layer.el?.querySelector('[autofocus]') || layer.el?.querySelector('.layer-panel');
    f?.focus({ preventScroll: true });
  });
  return layer.el;
}
function closeLayer(instant = false) {
  if (!layer.el) return;
  const el = layer.el, cb = layer.onClose;
  layer.el = null; layer.type = null; layer.onClose = null;
  document.documentElement.classList.remove('locked');
  if (instant) el.remove(); else { el.classList.remove('open'); setTimeout(() => el.remove(), 280); }
  cb?.();
  if (!instant) layer.lastFocus?.focus?.({ preventScroll: true });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && layer.el) { closeLayer(); return; }
  if (e.key === 'Escape' && document.body.classList.contains('filters-open')) { document.body.classList.remove('filters-open'); return; }
  if (e.key === '/' && !layer.el && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); openSearch(); return; }
  if (e.key === 'Tab' && layer.el) { // keep focus inside the open dialog
    const f = $$('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])', layer.el).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

function toast(msg, type = 'ok', action = null) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${ic(type === 'error' ? 'info' : 'check')}<span>${esc(msg)}</span>${action ? `<button type="button" data-act="${action.act}"${action.href ? ` data-href="${esc(action.href)}"` : ''}>${esc(action.label)}</button>` : ''}`;
  const root = $('#toasts');
  while (root.children.length > 2) root.firstElementChild.remove();
  root.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 5000 : 3200);
}
function bumpBag() { for (const b of $$('[data-badge="cart"]')) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); } }
function updateBadges() {
  const n = cartCount(), w = S.wish.size;
  for (const b of $$('[data-badge="cart"]')) { b.textContent = n; b.hidden = !n; }
  for (const b of $$('[data-badge="wish"]')) { b.textContent = w; b.hidden = !w; }
  const acc = $('#hdr-account-label'); if (acc) acc.textContent = S.user ? S.user.name.split(' ')[0] : 'Account';
}

/* ======================================================= product card UI */
function badgeHtml(p) {
  let b = '';
  if (p.stock === 'out') b += '<b class="badge b-out">Sold out</b>';
  else {
    const o = off(p); if (o >= 5) b += `<b class="badge b-sale">−${o}%</b>`;
    if (Date.now() - p.created < 21 * DAY) b += '<b class="badge b-new">New</b>';
  }
  return b ? `<span class="badges">${b}</span>` : '';
}
function stockHtml(p, long = false) {
  if (p.stock === 'out') return `<span class="stock s-out"><i></i>Out of stock</span>`;
  if (p.stock === 'limited') return `<span class="stock s-limited"><i></i>${p.left != null ? `Only ${p.left} left${long ? ', order soon' : ''}` : 'Limited stock'}</span>`;
  return `<span class="stock s-in"><i></i>In stock${long ? ', ready to ship' : ''}</span>`;
}
function priceHtml(p, cls = '') {
  return `<span class="price ${cls}"><strong>${money(p.price)}</strong>${p.compare > p.price ? `<s>${money(p.compare)}</s>` : ''}</span>`;
}
function cardHtml(p, { eager = false } = {}) {
  const cat = C.catById.get(p.cat), wished = S.wish.has(p.id), out = p.stock === 'out';
  const label = out ? 'Sold out' : p.options.length ? 'Choose options' : 'Add to bag';
  return `<article class="pcard${out ? ' is-out' : ''}">
    <a class="pcard-media" href="/product/${p.slug}" ${p.img2 ? `data-alt="${esc(p.img2)}"` : ''} aria-label="${esc(p.name)}">
      <img src="${esc(p.img)}" alt="${esc(p.name)}" width="800" height="1000" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
      ${badgeHtml(p)}
    </a>
    <button type="button" class="pcard-wish${wished ? ' on' : ''}" data-act="wish" data-id="${p.id}" aria-pressed="${wished}" aria-label="Save ${esc(p.name)} to wishlist">${ic('heart')}</button>
    <button type="button" class="pcard-qv" data-act="qv" data-id="${p.id}" aria-label="Quick view ${esc(p.name)}">${ic('eye')}</button>
    <div class="pcard-body">
      ${cat ? `<a class="pcard-cat" href="/category/${cat.slug}">${esc(cat.name)}</a>` : ''}
      <h3 class="pcard-title"><a href="/product/${p.slug}">${esc(p.name)}</a></h3>
      ${p.reviews ? `<div class="pcard-rating">${ic('star-fill', 'on')}<b>${p.rating.toFixed(1)}</b><span>(${p.reviews})</span></div>` : ''}
      <div class="pcard-foot">${priceHtml(p)}${stockHtml(p)}</div>
    </div>
    <button type="button" class="pcard-add" data-act="add" data-id="${p.id}" ${out ? 'disabled' : ''}>${out ? '' : ic(p.options.length ? 'sliders' : 'bag')}<span>${label}</span></button>
  </article>`;
}
const gridHtml = (items, opts) => `<div class="pgrid">${items.map((p, i) => cardHtml(p, { eager: opts?.eager && i < 4 })).join('')}</div>`;
const railHtml = (items) => `<div class="rail-wrap"><button type="button" class="rail-btn prev" data-act="rail" data-dir="-1" aria-label="Scroll left">${ic('chev-left')}</button><div class="rail">${items.map((p) => cardHtml(p)).join('')}</div><button type="button" class="rail-btn next" data-act="rail" data-dir="1" aria-label="Scroll right">${ic('chev-right')}</button></div>`;
const secHead = (title, sub, link, linkText = 'View all') => `<div class="sec-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${link ? `<a class="link-arrow" href="${link}">${linkText} ${ic('arrow-right')}</a>` : ''}</div>`;

// Swap in the second photo only when someone actually hovers (saves bandwidth on phones).
document.addEventListener('pointerover', (e) => {
  const a = e.target.closest?.('.pcard-media[data-alt]');
  if (!a || a.dataset.loaded || e.pointerType === 'touch') return;
  a.dataset.loaded = '1';
  const img = new Image(); img.className = 'alt'; img.alt = ''; img.decoding = 'async'; img.src = a.dataset.alt;
  a.firstElementChild.after(img);
}, { passive: true });
// Prefetch product details on hover / touch so the product page opens fully loaded.
const prefetchDetail = (slug) => { if (!detailCache.has(slug)) detailCache.set(slug, api(`/api/products/${encodeURIComponent(slug)}`).catch(() => { detailCache.delete(slug); return null; })); };
document.addEventListener('pointerover', (e) => { const a = e.target.closest?.('a[href^="/product/"]'); if (a) prefetchDetail(decodeURIComponent(a.getAttribute('href').split('/')[2])); }, { passive: true });
document.addEventListener('touchstart', (e) => { const a = e.target.closest?.('a[href^="/product/"]'); if (a) prefetchDetail(decodeURIComponent(a.getAttribute('href').split('/')[2])); }, { passive: true });

/* ================================================================= router */
let current = null;
const ROUTES = [
  [/^\/$/, () => viewHome()],
  [/^\/shop$/, () => viewShop({})],
  [/^\/search$/, () => viewShop({ search: true })],
  [/^\/offers$/, () => viewShop({ offers: true })],
  [/^\/category\/([^/]+)$/, (m) => viewShop({ catSlug: m[1] })],
  [/^\/occasion\/([^/]+)$/, (m) => viewShop({ tag: m[1] })],
  [/^\/product\/([^/]+)$/, (m) => viewProduct(m[1])],
  [/^\/cart$/, () => viewCart()],
  [/^\/checkout$/, () => viewCheckout()],
  [/^\/order\/([A-Za-z0-9]+)$/, (m) => viewOrder(m[1].toUpperCase())],
  [/^\/track$/, () => viewTrack()],
  [/^\/wishlist$/, () => viewWishlist()],
  [/^\/account$/, () => viewAccount()],
  [/^\/gift-box-builder$/, () => viewBuilder()],
  [/^\/corporate$/, () => viewCorporate()],
  [/^\/help$/, () => viewHelp()],
  [/^\/about$/, () => viewAbout()],
  [/^\/policies\/([a-z]+)$/, (m) => viewPolicy(m[1])],
];
function render(y = 0) {
  let path; try { path = decodeURIComponent(location.pathname); } catch { path = location.pathname; }
  path = path.replace(/\/+$/, '') || '/';
  let view = null;
  for (const [re, fn] of ROUTES) { const m = path.match(re); if (m) { view = fn(m); break; } }
  if (!view) view = viewNotFound();
  try { current?.unmount?.(); } catch { /* ignore */ }
  current = view;
  document.body.classList.remove('filters-open');
  // Fresh root per view: listeners a view attaches die with it (no leaks between pages).
  const root = document.createElement('div');
  root.className = 'view enter';
  root.innerHTML = view.html;
  main.replaceChildren(root);
  view.root = root;
  const brand = C.settings.store.name;
  document.title = view.title ? `${view.title} | ${brand}` : `${brand} | ${C.settings.store.tagline}`;
  view.mount?.(root);
  for (const a of $$('[data-nav]')) a.classList.toggle('active', a.dataset.nav === (view.nav || view.name));
  window.scrollTo(0, y);
}
function navigate(url, { replace = false } = {}) {
  const u = new URL(url, location.href);
  if (u.origin !== location.origin) { location.href = url; return; }
  if (!replace) history.replaceState({ ...(history.state || {}), y: scrollY }, '');
  history[replace ? 'replaceState' : 'pushState']({ y: 0 }, '', u.pathname + u.search + u.hash);
  closeLayer(true);
  render(0);
}
history.scrollRestoration = 'manual';
addEventListener('popstate', (e) => { closeLayer(true); render(e.state?.y || 0); });

document.addEventListener('click', (e) => {
  if (e.target === document.body && document.body.classList.contains('filters-open')) { document.body.classList.remove('filters-open'); return; }
  const a = e.target.closest('a[href]');
  if (a && !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !a.target && !a.hasAttribute('download') && a.origin === location.origin && !/^\/(admin|api|uploads)(\/|$)/.test(a.pathname)) {
    if (a.hash && a.pathname === location.pathname && a.search === location.search) return;
    e.preventDefault(); navigate(a.href); return;
  }
  const t = e.target.closest('[data-act]');
  if (t && ACTIONS[t.dataset.act]) { e.preventDefault(); ACTIONS[t.dataset.act](t, e); }
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (f && FORMS[f.dataset.form]) { e.preventDefault(); FORMS[f.dataset.form](f); }
});

const ACTIONS = {
  add: (t) => { const p = IDX.byId.get(t.dataset.id); if (!p) return; if (p.options.length) quickView(p.id); else addToCart(p); },
  wish: (t) => toggleWish(t.dataset.id),
  qv: (t) => quickView(t.dataset.id),
  'open-cart': () => openCart(),
  'open-search': () => openSearch(),
  'open-menu': () => openMenu(),
  'close-layer': () => closeLayer(),
  'line-inc': (t) => changeQty(t.dataset.key, 1),
  'line-dec': (t) => changeQty(t.dataset.key, -1),
  'line-rm': (t) => { removeLine(t.dataset.key); toast('Removed from bag'); },
  go: (t) => navigate(t.dataset.href),
  copy: (t) => { navigator.clipboard?.writeText(t.dataset.text).then(() => toast('Copied!'), () => toast(t.dataset.text)); },
  logout: async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); S.user = null; S.orders = []; updateBadges(); toast('You are logged out'); navigate('/'); },
  rail: (t) => { const r = t.parentElement.querySelector('.rail'); r.scrollBy({ left: Number(t.dataset.dir) * r.clientWidth * 0.85, behavior: 'smooth' }); },
  'open-filters': () => document.body.classList.add('filters-open'),
  'close-filters': () => document.body.classList.remove('filters-open'),
  share: (t) => {
    const url = location.href;
    if (navigator.share) navigator.share({ title: document.title, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => toast('Link copied to clipboard'));
    void t;
  },
};
const FORMS = {};

/* ================================================================== shell */
function hydrateShell() {
  const st = C.settings.store;
  // Announcement bar rotation
  const msgs = C.settings.announcements.length ? C.settings.announcements : [''];
  const bar = $('#announce-text');
  if (bar && msgs.length) {
    let i = 0; bar.textContent = msgs[0];
    if (msgs.length > 1) setInterval(() => { if (document.hidden) return; bar.classList.add('fade'); setTimeout(() => { i = (i + 1) % msgs.length; bar.textContent = msgs[i]; bar.classList.remove('fade'); }, 300); }, 4500);
  }
  // Mega menu
  const mega = $('#mega-cats');
  if (mega) mega.innerHTML = C.categories.map((c) => `<a href="/category/${c.slug}" class="mega-item"><img src="${esc(c.image)}" alt="" width="56" height="56" loading="lazy"><span><b>${esc(c.name)}</b><small>${esc(c.blurb)}</small></span></a>`).join('');
  const occ = $('#mega-occ');
  if (occ) occ.innerHTML = OCCASIONS.map(([k, l, i]) => `<a href="/occasion/${k}">${ic(i)}${l}</a>`).join('');
  // Footer
  const social = [['facebook', st.facebook], ['instagram', st.instagram], ['tiktok', st.tiktok], ['whatsapp', st.whatsapp ? `https://wa.me/${st.whatsapp}` : '']].filter(([, u]) => u);
  $('#ftr').innerHTML = `
  <div class="ftr-news"><div class="container ftr-news-in">
    <div><h2>Get a welcome discount on your first gift</h2><p>Gift ideas, new arrivals and members-only offers. No spam, ever.</p></div>
    <form class="news-form" data-form="newsletter"><label class="sr" for="ftr-email">Email address</label><input id="ftr-email" name="email" type="email" required placeholder="you@email.com" autocomplete="email"><button class="btn btn-primary" type="submit">Subscribe</button></form>
  </div></div>
  <div class="container ftr-grid">
    <div class="ftr-brand">
      <a href="/" class="logo logo-ftr" aria-label="${esc(st.name)} home">${logoMark()}<span>${esc(st.name)}</span></a>
      <p>${esc(st.tagline)}. Handpicked gifts, wrapped with love in Dhaka and delivered across Bangladesh.</p>
      <div class="social">${social.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener" aria-label="${n}">${ic(n)}</a>`).join('')}</div>
    </div>
    <div><h3>Shop</h3><ul>${C.categories.slice(0, 7).map((c) => `<li><a href="/category/${c.slug}">${esc(c.name)}</a></li>`).join('')}<li><a href="/offers">Offers</a></li></ul></div>
    <div><h3>Gifting</h3><ul><li><a href="/gift-box-builder">Build a gift box</a></li><li><a href="/category/gift-boxes">Ready-to-gift boxes</a></li><li><a href="/corporate">Corporate & bulk</a></li><li><a href="/occasion/birthday">Birthday gifts</a></li><li><a href="/occasion/anniversary">Anniversary gifts</a></li><li><a href="/wishlist">Wishlist</a></li></ul></div>
    <div><h3>Help</h3><ul><li><a href="/track">Track your order</a></li><li><a href="/policies/shipping">Shipping & delivery</a></li><li><a href="/policies/returns">Returns & exchanges</a></li><li><a href="/help">FAQ & support</a></li><li><a href="/about">Our story</a></li><li><a href="/account">My account</a></li></ul></div>
    <div class="ftr-contact"><h3>Talk to us</h3>
      <a href="tel:${esc(st.phone.replace(/[^+\d]/g, ''))}">${ic('phone')}${esc(st.phone)}</a>
      ${st.whatsapp ? `<a href="https://wa.me/${esc(st.whatsapp)}" target="_blank" rel="noopener">${ic('whatsapp')}WhatsApp us</a>` : ''}
      <a href="mailto:${esc(st.email)}">${ic('mail')}${esc(st.email)}</a>
      <p>${ic('pin')}${esc(st.address)}</p><p>${ic('clock')}${esc(st.hours)}</p>
    </div>
  </div>
  <div class="container ftr-bottom">
    <span>© ${new Date().getFullYear()} ${esc(st.name)}. All rights reserved.</span>
    <div class="pay-badges" aria-label="Payment methods">${C.settings.payments.cod ? '<span class="pay pay-cod">Cash on Delivery</span>' : ''}${C.settings.payments.bkash ? '<span class="pay pay-bkash">bKash</span>' : ''}${C.settings.payments.nagad ? '<span class="pay pay-nagad">Nagad</span>' : ''}</div>
    <span class="ftr-links"><a href="/policies/privacy">Privacy</a><a href="/policies/terms">Terms</a></span>
  </div>`;
  updateBadges();
  const hdr = $('#hdr');
  let ticking = false;
  addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { hdr.classList.toggle('scrolled', scrollY > 8); ticking = false; }); }, { passive: true });
}
const logoMark = () => `<svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 21C15 13 6 12 7.5 18.5 8.7 23.4 16 22.6 20 21Zm0 0c5-8 14-9 12.5-2.5C31.3 23.4 24 22.6 20 21Z" fill="currentColor"/><path d="M19 22 14 32l3.2-.6L18.8 34 21 22.6M21 22l5 10-3.2-.6L21.2 34 19 22.6" fill="currentColor" opacity=".7"/><circle cx="20" cy="21.3" r="3" fill="var(--gold)"/></svg>`;

/* ================================================================== home */
function viewHome() {
  const s = C.settings, h = s.hero, st = s.stats, ex = expressInfo();
  const title = esc(h.title).replace(/\*(.+?)\*/g, '<em>$1</em>');
  const newTabs = [['', 'All'], ...C.categories.filter((c) => IDX.facets.cat.has(c.id)).slice(0, 5).map((c) => [c.id, c.name])];
  const newest = (cat) => IDX.query({ cat: cat ? [cat] : [], sort: 'newest', size: 10 }).items;
  const best = IDX.query({ sort: 'popular', s: ['in', 'limited'], size: 8 }).items;
  const ready = IDX.query({ tag: ['ready-to-gift'], sort: 'featured', size: 10 }).items;
  const tiers = s.bundleTiers;
  const reviews = (C.reviews || []).map((r) => ({ ...r, p: IDX.byId.get(r.pid) })).filter((r) => r.p).slice(0, 3);
  const catCount = (id) => IDX.facets.cat.get(id)?.count() || 0;
  const html = `
  <section class="hero container">
    <div class="hero-main">
      <div class="hero-copy">
        <span class="eyebrow">${ic('sparkle')}${esc(h.eyebrow)}</span>
        <h1>${title}</h1>
        <p>${esc(h.subtitle)}</p>
        <div class="hero-ctas"><a class="btn btn-primary btn-lg" href="${esc(h.ctaLink)}">${esc(h.cta)} ${ic('arrow-right')}</a><a class="btn btn-ghost btn-lg" href="${esc(h.cta2Link)}">${esc(h.cta2)}</a></div>
        <div class="hero-proof"><span class="stars-mini">${ic('star-fill', 'on').repeat(5)}</span><span><b>${esc(st.rating)}/5</b> from ${esc(st.customers)} happy gifters</span></div>
      </div>
      <img class="hero-art" src="/img/hero.svg" alt="A gift box, a teddy bear and a rose bouquet" width="1000" height="800" fetchpriority="high">
    </div>
    <a class="hero-tile tile-express" href="/shop?sort=popular">
      <span class="tile-ic">${ic('bolt')}</span>
      <span class="tile-kicker">Bliss Express</span>
      <strong>Gifts delivered in ${esc(s.delivery.expressHours)} hours</strong>
      <small>${esc(s.delivery.expressAreas)}</small>
      <span class="countdown">${ic('clock')}${ex.today ? `Order within <b>${ex.short}</b> for today` : 'Order now for <b>tomorrow</b>'}</span>
    </a>
    <a class="hero-tile tile-occ tile-bday" href="/occasion/birthday"><img src="/img/c/gift-boxes.svg" alt="" width="800" height="800" loading="lazy"><span><small>Make their day</small><strong>Birthday gifts</strong></span>${ic('arrow-right', 'tile-arrow')}</a>
    <a class="hero-tile tile-occ tile-anniv" href="/occasion/anniversary"><img src="/img/c/flowers.svg" alt="" width="800" height="800" loading="lazy"><span><small>Love, wrapped</small><strong>Anniversary & romance</strong></span>${ic('arrow-right', 'tile-arrow')}</a>
  </section>

  <section class="trust container" aria-label="Why shop with us">
    <div>${ic('shield')}<span><b>Authentic & checked</b><small>Every gift quality-checked</small></span></div>
    <div>${ic('heart')}<span><b>${esc(st.customers)} happy gifters</b><small>Rated ${esc(st.rating)} out of 5</small></span></div>
    <div>${ic('gift')}<span><b>Ready to gift</b><small>Free card, wrap available</small></span></div>
    <div>${ic('truck')}<span><b>Cash on delivery</b><small>All 64 districts</small></span></div>
  </section>

  <section class="container sec">
    ${secHead('Shop by occasion', 'Whatever you are celebrating, we have it wrapped.')}
    <div class="occ-row">${OCCASIONS.map(([k, l, i]) => `<a class="occ" href="/occasion/${k}"><span class="occ-ic">${ic(i)}</span><span>${l}</span></a>`).join('')}</div>
  </section>

  <section class="container sec">
    <div class="finder" id="finder">
      <div class="finder-copy"><span class="eyebrow">${ic('wand')}Gift finder</span><h2>Not sure what to get?</h2><p>Tell us a little and we will narrow it down instantly.</p></div>
      <form class="finder-form" data-form="finder">
        <p class="finder-sentence">I'm shopping for
          <label class="pill-select"><span class="sr">Recipient</span><select name="g"><option value="">someone special</option><option value="her">her</option><option value="him">him</option><option value="kids">a little one</option></select></label>
          for
          <label class="pill-select"><span class="sr">Occasion</span><select name="tag"><option value="">any occasion</option>${OCCASIONS.map(([k, l]) => `<option value="${k}">${l.toLowerCase()}</option>`).join('')}</select></label>
          under
          <label class="pill-select"><span class="sr">Budget</span><select name="max"><option value="">any budget</option>${[500, 1000, 1500, 2000, 3000, 5000].map((v) => `<option value="${v}">${money(v)}</option>`).join('')}</select></label>
        </p>
        <button class="btn btn-dark btn-lg" type="submit"><span id="finder-count">Show gifts</span> ${ic('arrow-right')}</button>
      </form>
    </div>
  </section>

  <section class="container sec">
    ${secHead('New arrivals', 'Fresh finds, just landed.', '/shop?sort=newest')}
    <div class="tabs" role="tablist">${newTabs.map(([id, name], i) => `<button type="button" role="tab" class="tab${i ? '' : ' active'}" aria-selected="${!i}" data-tab="${id}">${esc(name)}</button>`).join('')}</div>
    <div id="new-rail">${railHtml(newest(''))}</div>
  </section>

  <section class="container sec">
    <div class="builder-band">
      <div class="bb-copy">
        <span class="eyebrow light">${ic('gift')}Gift Box Builder</span>
        <h2>Build a box that's <em>all them.</em></h2>
        <p>Pick a box, fill it with their favourite things, choose the wrap and ribbon, and add a handwritten note. We'll do the rest.</p>
        <ol class="bb-steps"><li><b>1</b>Choose a box</li><li><b>2</b>Fill it up</li><li><b>3</b>Wrap & ribbon</li><li><b>4</b>Add a note</li></ol>
        <a class="btn btn-light btn-lg" href="/gift-box-builder">Start building ${ic('arrow-right')}</a>
      </div>
      <div class="bb-art" aria-hidden="true">${boxSvg({ wrap: '#F2A7B5', ribbon: '#E3B65C', count: 4, to: 'Mum' })}</div>
    </div>
  </section>

  <section class="container sec">
    ${secHead('Shop by category', 'Little luxuries for every kind of love.', '/shop', 'Shop all')}
    <div class="cat-grid">${C.categories.filter((c) => c.showHome !== false).map((c, i) => `<a class="cat-tile${i < 2 ? ' big' : ''}" href="/category/${c.slug}" style="--tile:${esc(c.color)}"><img src="${esc(c.image)}" alt="" width="800" height="800" loading="lazy"><span><b>${esc(c.name)}</b><small>${catCount(c.id)} gifts</small></span></a>`).join('')}</div>
  </section>

  ${tiers.length ? `<section class="container sec"><div class="offer-band">
    <div><span class="eyebrow">${ic('tag')}Mix & Match</span><h2>The more you gift, the more you save</h2><p>Discount applies automatically in your bag. Mix any products you like.</p></div>
    <div class="tiers">${tiers.map((t) => `<div class="tier"><b>${t.pct}%</b><span>off ${t.min}${t === tiers[tiers.length - 1] ? '+' : ''} items</span></div>`).join('')}</div>
    <a class="btn btn-primary" href="/shop">Start mixing ${ic('arrow-right')}</a>
  </div></section>` : ''}

  <section class="container sec">${secHead('Best sellers', 'The gifts everyone is talking about.', '/shop?sort=popular')}${gridHtml(best)}</section>

  ${ready.length ? `<section class="container sec">${secHead('Ready-to-gift boxes', 'Curated, wrapped and ready to make someone smile.', '/category/gift-boxes')}${railHtml(ready)}</section>` : ''}

  ${reviews.length ? `<section class="container sec"><div class="loved">
    ${secHead(`Loved by ${esc(st.customers)} gifters`, `Rated ${esc(st.rating)} out of 5 by our customers`)}
    <div class="quotes">${reviews.map((r) => `<figure class="quote">${stars(r.rating)}<blockquote>${esc(r.text)}</blockquote><figcaption><b>${esc(r.name)}</b> bought <a href="/product/${r.p.slug}">${esc(r.p.name)}</a></figcaption></figure>`).join('')}</div>
  </div></section>` : ''}

  <section class="container sec">
    <div class="corp-band">
      <div><span class="eyebrow">${ic('briefcase')}Corporate & bulk</span><h2>Gifting for your team or clients?</h2><p>Custom-branded boxes, bulk pricing from 10 gifts, and delivery to every desk.</p></div>
      <div class="corp-actions"><a class="btn btn-dark" href="/corporate">Get a quote ${ic('arrow-right')}</a><a class="btn btn-ghost" href="/help">Talk to us</a></div>
    </div>
  </section>`;
  return {
    name: 'home', html,
    mount(root) {
      $$('.tab', root).forEach((t) => t.addEventListener('click', () => {
        $$('.tab', root).forEach((x) => { x.classList.toggle('active', x === t); x.setAttribute('aria-selected', x === t); });
        $('#new-rail', root).innerHTML = railHtml(newest(t.dataset.tab));
      }));
      const ff = $('.finder-form', root), cnt = $('#finder-count', root);
      const upd = () => { const q = finderQuery(ff); const n = IDX.query({ ...q, size: 1 }).total; cnt.textContent = n ? `Show ${plural(n, 'gift')}` : 'No exact matches, show all'; };
      ff.addEventListener('change', upd); upd();
    },
  };
}
function finderQuery(f) {
  const g = f.elements.g.value, tag = f.elements.tag.value, max = f.elements.max.value;
  return { g: g ? [g, 'unisex'] : [], tag: tag ? [tag] : [], max: max || undefined };
}
FORMS.finder = (f) => {
  const q = finderQuery(f), u = new URLSearchParams();
  if (q.g.length) u.set('g', q.g.join(','));
  if (q.tag.length) u.set('tag', q.tag[0]);
  if (q.max) u.set('max', q.max);
  navigate('/shop?' + u.toString());
};

/* =================================================================== shop */
function readFilters(base) {
  const q = new URLSearchParams(location.search);
  const list = (k) => (q.get(k) || '').split(',').filter(Boolean);
  const f = { q: (q.get('q') || '').slice(0, 80), cat: list('cat'), tag: list('tag'), g: list('g'), s: list('s'), min: q.get('min') || '', max: q.get('max') || '', sale: q.get('sale') === '1', sort: q.get('sort') || '', page: Math.max(1, Math.min(20, +q.get('page') || 1)) };
  if (base.catSlug) { const c = C.catBySlug.get(base.catSlug); if (c && !f.cat.includes(c.id)) f.cat.unshift(c.id); }
  if (base.tag && !f.tag.includes(base.tag)) f.tag.unshift(base.tag);
  if (base.offers) f.sale = true;
  return f;
}
const engineQuery = (f, size) => ({ q: f.q, cat: f.cat, tag: f.tag, g: f.g, s: f.s, min: f.min, max: f.max, sale: f.sale, sort: f.sort || (f.q ? 'relevance' : 'featured'), page: 1, size });
function filtersUrl(f, base) {
  const u = new URLSearchParams();
  const baseCat = base.catSlug && C.catBySlug.get(base.catSlug);
  const onCatPath = baseCat && f.cat.length === 1 && f.cat[0] === baseCat.id;
  const onTagPath = base.tag && f.tag.length === 1 && f.tag[0] === base.tag;
  if (f.q) u.set('q', f.q);
  if (f.cat.length && !onCatPath) u.set('cat', f.cat.join(','));
  if (f.tag.length && !onTagPath) u.set('tag', f.tag.join(','));
  for (const k of ['g', 's']) if (f[k].length) u.set(k, f[k].join(','));
  if (f.min) u.set('min', f.min);
  if (f.max) u.set('max', f.max);
  if (f.sale && !base.offers) u.set('sale', '1');
  if (f.sort) u.set('sort', f.sort);
  if (f.page > 1) u.set('page', f.page);
  const path = onCatPath ? `/category/${base.catSlug}` : onTagPath && !f.cat.length ? `/occasion/${base.tag}` : base.offers ? '/offers' : base.search ? '/search' : '/shop';
  const qs = u.toString();
  return path + (qs ? '?' + qs : '');
}
const SORTS = [['featured', 'Featured'], ['popular', 'Best selling'], ['newest', 'Newest'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['rating', 'Top rated'], ['discount', 'Biggest discount'], ['name-asc', 'Name: A–Z']];

function viewShop(base) {
  let f = readFilters(base);
  const PAGE = 24;
  const baseCat = base.catSlug ? C.catBySlug.get(base.catSlug) : null;
  if (base.catSlug && !baseCat) return viewNotFound('We could not find that category.');
  const allPrices = IDX.query({ size: 1 });
  const title = baseCat ? baseCat.name : base.tag ? `${tagLabel(base.tag)} gifts` : base.offers ? 'Offers & deals' : f.q ? `Results for “${f.q}”` : 'All gifts';
  const sub = baseCat ? baseCat.blurb : base.tag ? `Thoughtful ${tagLabel(base.tag).toLowerCase()} gift ideas, wrapped with love.` : base.offers ? 'Our best prices on gifts they will love.' : f.q ? '' : 'Every gift in the shop, in one place.';
  const facetList = (group, items) => items.map(([v, label]) => `<label class="fopt"><input type="checkbox" data-group="${group}" value="${esc(v)}" ${f[group].includes(v) ? 'checked' : ''}><span class="box"></span><span class="fl">${esc(label)}</span><span class="fc" data-count="${group}:${esc(v)}"></span></label>`).join('');
  const tagsAll = [...IDX.facets.tag.keys()].filter((t) => t !== 'ready-to-gift').sort((a, b) => (OCC.has(b) - OCC.has(a)) || a.localeCompare(b));
  const html = `
  <div class="container shop">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${ic('chev-right')}${baseCat || base.tag || f.q ? `<a href="/shop">Shop</a>${ic('chev-right')}<span>${esc(title)}</span>` : `<span>${esc(title)}</span>`}</nav>
    <header class="shop-head"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</header>
    <div class="chip-row">
      <a class="chip${!baseCat && !base.tag && !base.offers ? ' active' : ''}" href="/shop">All gifts</a>
      ${C.categories.map((c) => `<a class="chip${baseCat?.id === c.id ? ' active' : ''}" href="/category/${c.slug}"><img src="${esc(c.image)}" alt="" width="24" height="24" loading="lazy">${esc(c.name)}</a>`).join('')}
    </div>
    <div class="shop-layout">
      <aside class="filters" id="filters" aria-label="Filters">
        <div class="filters-head"><h2>Filters</h2><button type="button" class="ibtn" data-act="close-filters" aria-label="Close filters">${ic('close')}</button></div>
        <div class="filters-body">
          <details class="fgroup" open><summary>Availability</summary>${facetList('s', [['in', 'In stock'], ['limited', 'Limited stock'], ['out', 'Out of stock']])}</details>
          <details class="fgroup" open><summary>Price</summary>
            <div class="price-range"><label><span>Min ৳</span><input type="number" inputmode="numeric" min="0" id="fmin" value="${esc(f.min)}" placeholder="${allPrices.priceMin}"></label><span class="dash">–</span><label><span>Max ৳</span><input type="number" inputmode="numeric" min="0" id="fmax" value="${esc(f.max)}" placeholder="${allPrices.priceMax}"></label></div>
            <div class="price-quick">${[[0, 500], [500, 1000], [1000, 2000], [2000, '']].map(([a, b]) => `<button type="button" class="chip chip-sm" data-pmin="${a || ''}" data-pmax="${b}">${b ? (a ? `${money(a)}–${money(b)}` : `Under ${money(b)}`) : `${money(a)}+`}</button>`).join('')}</div>
            <label class="toggle"><input type="checkbox" id="fsale" ${f.sale ? 'checked' : ''}><span class="track"></span><span>On sale only</span></label>
          </details>
          <details class="fgroup" open><summary>Category</summary>${facetList('cat', C.categories.map((c) => [c.id, c.name]))}</details>
          <details class="fgroup" open><summary>Occasion</summary>${facetList('tag', tagsAll.map((t) => [t, tagLabel(t)]))}</details>
          <details class="fgroup" open><summary>Who is it for?</summary>${facetList('g', Object.entries(GENDER))}</details>
        </div>
        <div class="filters-foot"><button type="button" class="btn btn-ghost" id="fclear">Clear all</button><button type="button" class="btn btn-primary" data-act="close-filters" id="fshow">Show results</button></div>
      </aside>
      <section class="results" aria-live="polite">
        <div class="toolbar">
          <button type="button" class="btn btn-soft btn-sm filters-btn" data-act="open-filters">${ic('sliders')}Filters<b id="fcount"></b></button>
          <span class="rcount" id="rcount"></span>
          <label class="sort"><span>Sort by</span><select id="fsort">${(f.q ? [['relevance', 'Best match'], ...SORTS] : SORTS).map(([v, l]) => `<option value="${v}" ${(f.sort || (f.q ? 'relevance' : 'featured')) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <div class="active-chips" id="achips"></div>
        <div id="rgrid"></div>
      </section>
    </div>
  </div>`;
  return {
    name: 'shop', nav: baseCat ? 'cat-' + baseCat.slug : 'shop', title,
    html,
    mount(root) {
      const grid = $('#rgrid', root), countEl = $('#rcount', root), chips = $('#achips', root);
      const apply = (push = true) => {
        const res = IDX.query(engineQuery(f, PAGE * f.page));
        countEl.textContent = plural(res.total, 'gift');
        $('#fshow', root).textContent = `Show ${plural(res.total, 'result')}`;
        for (const el of $$('[data-count]', root)) {
          const [g, v] = el.dataset.count.split(/:(.*)/);
          const n = res.facets[g]?.[v] ?? 0; el.textContent = n;
          el.closest('.fopt').classList.toggle('zero', !n && !f[g].includes(v));
        }
        const active = [
          ...f.cat.map((v) => ['cat', v, C.catById.get(v)?.name || v]), ...f.tag.map((v) => ['tag', v, tagLabel(v)]),
          ...f.g.map((v) => ['g', v, GENDER[v] || v]), ...f.s.map((v) => ['s', v, { in: 'In stock', limited: 'Limited stock', out: 'Out of stock' }[v]]),
          ...(f.min || f.max ? [['price', '', `${f.min ? money(f.min) : money(0)} – ${f.max ? money(f.max) : 'any'}`]] : []),
          ...(f.sale && !base.offers ? [['sale', '', 'On sale']] : []),
        ];
        $('#fcount', root).textContent = active.length ? active.length : '';
        chips.innerHTML = active.length ? active.map(([g, v, l]) => `<button type="button" class="chip chip-x" data-rm="${g}" data-v="${esc(v)}">${esc(l)}${ic('close')}</button>`).join('') + '<button type="button" class="link" id="fclear2">Clear all</button>' : '';
        if (!res.total) {
          grid.innerHTML = `<div class="empty">${ic('search', 'empty-ic')}<h2>No gifts match${f.q ? ` “${esc(f.q)}”` : ' these filters'}</h2><p>${res.suggestion ? `Did you mean <a href="/search?q=${encodeURIComponent(res.suggestion)}">${esc(res.suggestion)}</a>? ` : ''}Try removing a filter or browse our best sellers.</p><button type="button" class="btn btn-primary" id="fclear3">Clear filters</button></div>` + `<div class="sec">${secHead('You might love', '')}${gridHtml(IDX.query({ sort: 'popular', s: ['in', 'limited'], size: 4 }).items)}</div>`;
        } else {
          grid.innerHTML = (res.suggestion ? `<p class="did-you-mean">${ic('wand')} Showing results for <b>${esc(res.suggestion)}</b></p>` : '') + gridHtml(res.items, { eager: true }) +
            (res.total > res.items.length ? `<div class="load-more"><p>Showing ${res.items.length} of ${res.total}</p><div class="lm-bar"><i style="width:${Math.round((res.items.length / res.total) * 100)}%"></i></div><button type="button" class="btn btn-ghost" id="fmore">Load more gifts</button></div>` : '');
        }
        if (push) history.replaceState({ y: scrollY }, '', filtersUrl(f, base));
      };
      const reset = () => {
        const keepCat = baseCat ? [baseCat.id] : [], keepTag = base.tag ? [base.tag] : [];
        f = { ...f, cat: keepCat, tag: keepTag, g: [], s: [], min: '', max: '', sale: !!base.offers, page: 1 };
        $$('input[data-group]', root).forEach((i) => { i.checked = f[i.dataset.group].includes(i.value); });
        $('#fmin', root).value = ''; $('#fmax', root).value = ''; $('#fsale', root).checked = f.sale;
        apply();
      };
      root.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.group) {
          const g = t.dataset.group;
          f[g] = t.checked ? [...f[g], t.value] : f[g].filter((x) => x !== t.value);
          f.page = 1;
          if (g === 'cat' && baseCat) { navigate(filtersUrl(f, {})); return; }
          apply();
        } else if (t.id === 'fsort') { f.sort = t.value; f.page = 1; apply(); }
        else if (t.id === 'fsale') { f.sale = t.checked; f.page = 1; apply(); }
      });
      const priceInput = debounce(() => { f.min = $('#fmin', root).value; f.max = $('#fmax', root).value; f.page = 1; apply(); }, 250);
      $('#fmin', root).addEventListener('input', priceInput);
      $('#fmax', root).addEventListener('input', priceInput);
      root.addEventListener('click', (e) => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.id === 'fmore') { f.page++; apply(); }
        else if (t.id === 'fclear' || t.id === 'fclear2' || t.id === 'fclear3') reset();
        else if (t.dataset.pmin !== undefined) { f.min = t.dataset.pmin; f.max = t.dataset.pmax; $('#fmin', root).value = f.min; $('#fmax', root).value = f.max; f.page = 1; apply(); }
        else if (t.dataset.rm) {
          const g = t.dataset.rm, v = t.dataset.v;
          if (g === 'price') { f.min = f.max = ''; $('#fmin', root).value = ''; $('#fmax', root).value = ''; }
          else if (g === 'sale') { f.sale = false; $('#fsale', root).checked = false; }
          else {
            if (g === 'cat' && baseCat && v === baseCat.id) { f.cat = f.cat.filter((x) => x !== v); navigate(filtersUrl(f, {})); return; }
            f[g] = f[g].filter((x) => x !== v);
            const box = $(`input[data-group="${g}"][value="${CSS.escape(v)}"]`, root); if (box) box.checked = false;
          }
          f.page = 1; apply();
        }
      });
      apply(false);
    },
  };
}

/* ================================================================ product */
function galleryHtml(p, images) {
  return `<div class="gallery" id="gallery">
    <div class="g-track" id="gtrack">${images.map((src, i) => `<div class="g-slide"><img src="${esc(src)}" alt="${esc(p.name)}${i ? ` (photo ${i + 1})` : ''}" width="800" height="1000" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async"></div>`).join('')}</div>
    ${images.length > 1 ? `<div class="g-thumbs">${images.map((src, i) => `<button type="button" class="g-thumb${i ? '' : ' active'}" data-i="${i}" aria-label="Show photo ${i + 1}"><img src="${esc(src)}" alt="" width="160" height="200" loading="lazy"></button>`).join('')}</div><div class="g-dots">${images.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
    ${badgeHtml(p)}
  </div>`;
}
function optionsHtml(p, sel) {
  return p.options.map((o) => `<div class="optgroup" data-opt="${esc(o.name)}"><div class="optlabel">${esc(o.name)}: <b data-optval>${esc(sel[o.name] || 'Choose')}</b></div><div class="opts">${o.values.map((v) => `<button type="button" class="opt${sel[o.name] === v ? ' on' : ''}" data-name="${esc(o.name)}" data-value="${esc(v)}" aria-pressed="${sel[o.name] === v}">${esc(v)}</button>`).join('')}</div></div>`).join('');
}
function bindBuyBox(root, p, sel, { onAdded } = {}) {
  let qty = 1;
  const qv = $('[data-qty]', root);
  root.addEventListener('click', (e) => {
    const o = e.target.closest('.opt');
    if (o) {
      sel[o.dataset.name] = o.dataset.value;
      const g = o.closest('.optgroup');
      $$('.opt', g).forEach((x) => { x.classList.toggle('on', x === o); x.setAttribute('aria-pressed', x === o); });
      $('[data-optval]', g).textContent = o.dataset.value; g.classList.remove('missing');
      return;
    }
    const q = e.target.closest('[data-step]');
    if (q) { qty = Math.max(1, Math.min(maxQty(p), qty + Number(q.dataset.step))); qv.value = qty; return; }
    const b = e.target.closest('[data-buy]');
    if (b) {
      const missing = p.options.filter((x) => !sel[x.name]);
      if (missing.length) {
        for (const m of missing) { const g = $(`.optgroup[data-opt="${CSS.escape(m.name)}"]`, root); g?.classList.remove('missing'); void g?.offsetWidth; g?.classList.add('missing'); }
        toast(`Please choose a ${missing[0].name.toLowerCase()}`, 'error'); return;
      }
      const ok = addToCart(p, qty, { ...sel }, { silent: b.dataset.buy === 'now' });
      if (ok && b.dataset.buy === 'now') navigate('/checkout');
      else if (ok) onAdded?.();
    }
  });
  qv?.addEventListener('change', () => { qty = Math.max(1, Math.min(maxQty(p), Math.floor(Number(qv.value)) || 1)); qv.value = qty; });
}
function buyBoxHtml(p, sel) {
  const out = p.stock === 'out';
  return `${p.options.length ? `<div class="opts-wrap">${optionsHtml(p, sel)}</div>` : ''}
  ${out ? `<div class="notify"><p>${ic('bell')} This gift is sold out right now. Leave your number and we'll tell you when it's back.</p><form class="notify-form" data-form="restock" data-name="${esc(p.name)}"><input name="phone" type="tel" inputmode="tel" placeholder="01XXXXXXXXX" required aria-label="Mobile number"><button class="btn btn-dark" type="submit">Notify me</button></form></div>`
    : `<div class="buy-row"><div class="stepper" role="group" aria-label="Quantity"><button type="button" data-step="-1" aria-label="Decrease quantity">${ic('minus')}</button><input data-qty type="number" value="1" min="1" max="${maxQty(p)}" inputmode="numeric" aria-label="Quantity"><button type="button" data-step="1" aria-label="Increase quantity">${ic('plus')}</button></div>
    <button type="button" class="btn btn-primary btn-lg grow" data-buy="add" id="atc">${ic('bag')}Add to bag</button></div>
    <button type="button" class="btn btn-dark btn-lg btn-block" data-buy="now">Buy it now</button>`}`;
}
function bundleHint() {
  const tiers = [...C.settings.bundleTiers].sort((a, b) => a.min - b.min);
  if (!tiers.length) return '';
  const n = cartCount(), t = tiers.find((x) => x.min > n);
  if (!t) return `<p class="bundle-hint on">${ic('check')}Your bag already gets the top Mix & Match saving: <b>${tiers.at(-1).pct}% off</b></p>`;
  return `<p class="bundle-hint">${ic('tag')}${n + 1 >= t.min ? `Add this and save <b>${t.pct}%</b> on your whole bag` : `Buy ${t.min} items, save <b>${t.pct}%</b>`} with Mix & Match</p>`;
}

function viewProduct(slug) {
  const p = IDX.bySlug.get(slug);
  if (!p) return viewNotFound('This gift is no longer available, but there are plenty more to love.');
  pushRecent(p.id);
  const cat = C.catById.get(p.cat), sel = {};
  for (const o of p.options) if (o.values.length === 1) sel[o.name] = o.values[0];
  const d0 = detailCache.get(slug);
  const ready = d0 && !(d0 instanceof Promise) ? d0 : null;
  const images = ready?.images || [p.img, p.img2].filter(Boolean);
  const ex = expressInfo(), dl = C.settings.delivery;
  const saving = p.compare > p.price ? p.compare - p.price : 0;
  const related = IDX.related(p, 10);
  const recent = S.recent.filter((id) => id !== p.id).map((id) => IDX.byId.get(id)).filter(Boolean).slice(0, 10);
  const html = `
  <div class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${ic('chev-right')}${cat ? `<a href="/category/${cat.slug}">${esc(cat.name)}</a>${ic('chev-right')}` : ''}<span>${esc(p.name)}</span></nav>
    <div class="pdp">
      <div class="pdp-media">${galleryHtml(p, images)}</div>
      <div class="pdp-info" id="buybox">
        ${cat ? `<a class="eyebrow-link" href="/category/${cat.slug}">${esc(cat.name)}</a>` : ''}
        <h1>${esc(p.name)}</h1>
        <div class="pdp-meta">${p.reviews ? `<a href="#reviews" class="rating-link">${stars(p.rating)}<b>${p.rating.toFixed(1)}</b><span>${plural(p.reviews, 'review')}</span></a>` : '<span class="muted">No reviews yet</span>'}<span class="dot"></span><button type="button" class="link-btn" data-act="share">${ic('share')}Share</button></div>
        <div class="pdp-price">${priceHtml(p, 'lg')}${saving ? `<span class="save">You save ${money(saving)} (${off(p)}%)</span>` : ''}</div>
        <div class="pdp-stock">${stockHtml(p, true)}${p.stock === 'limited' && p.left != null ? `<div class="stockbar"><i style="width:${Math.max(8, Math.min(100, p.left * 10))}%"></i></div>` : ''}</div>
        ${buyBoxHtml(p, sel)}
        <button type="button" class="btn btn-ghost btn-block wish-btn${S.wish.has(p.id) ? ' on' : ''}" data-act="wish" data-id="${p.id}" aria-pressed="${S.wish.has(p.id)}">${ic('heart')}<span>Save to wishlist</span></button>
        ${p.stock !== 'out' ? bundleHint() : ''}
        <div class="delivery-box">
          <div>${ic('bolt')}<p><b>Bliss Express</b> · ${ex.today ? `Order within <b>${ex.short}</b> and get it today` : 'Order now and get it tomorrow'} <span class="muted">(${esc(dl.expressAreas)}, ${money(dl.express)})</span></p></div>
          <div>${ic('truck')}<p><b>Standard delivery</b> · 1–2 days in Dhaka (${money(dl.inside)}), 2–4 days elsewhere (${money(dl.outside)})${dl.freeOver ? `. <b>Free</b> over ${money(dl.freeOver)}` : ''}</p></div>
          <div>${ic('gift')}<p><b>Make it a gift</b> · Free handwritten card. Gift wrap ${money(C.settings.giftWrapPrice)} at checkout.</p></div>
        </div>
        <div class="pdp-acc" id="pdp-acc">${detailAccordions(p, ready)}</div>
      </div>
    </div>
    <section class="sec reviews" id="reviews">${reviewsHtml(p, ready)}</section>
    ${related.length ? `<section class="sec">${secHead('Complete the gift', 'Pairs beautifully with this.')}${railHtml(related)}</section>` : ''}
    ${recent.length ? `<section class="sec">${secHead('Recently viewed', '')}${railHtml(recent)}</section>` : ''}
  </div>
  ${p.stock !== 'out' ? `<div class="sticky-atc" id="sticky-atc" aria-hidden="true"><img src="${esc(p.img)}" alt="" width="48" height="60"><div><b>${esc(p.name)}</b>${priceHtml(p)}</div><button type="button" class="btn btn-primary" data-sticky>${p.options.length ? 'Choose' : 'Add to bag'}</button></div>` : ''}`;
  return {
    name: 'product', nav: cat ? 'cat-' + cat.slug : 'shop', title: p.name, html,
    mount(root) {
      const box = $('#buybox', root);
      bindBuyBox(box, p, sel);
      bindGallery(root);
      bindReviewForm(root, p);
      const sticky = $('#sticky-atc', root), atc = $('#atc', root);
      if (sticky && atc && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver(([en]) => { const show = !en.isIntersecting && en.boundingClientRect.top < 0; sticky.classList.toggle('show', show); sticky.setAttribute('aria-hidden', !show); });
        io.observe(atc);
        this.unmount = () => io.disconnect();
        $('[data-sticky]', sticky).addEventListener('click', () => { if (p.options.length && p.options.some((o) => !sel[o.name])) { atc.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Please choose your options first', 'error'); } else atc.click(); });
      }
      if (!ready) {
        prefetchDetail(slug);
        Promise.resolve(detailCache.get(slug)).then((d) => {
          if (!d || current?.title !== p.name || !root.isConnected) return;
          detailCache.set(slug, d);
          $('#pdp-acc', root).innerHTML = detailAccordions(p, d);
          $('#reviews', root).innerHTML = reviewsHtml(p, d);
          bindReviewForm(root, p);
          if (d.images.length > images.length) { const g = $('#gallery', root); g.outerHTML = galleryHtml(p, d.images); bindGallery(root); }
        });
      }
    },
  };
}
function bindGallery(root) {
  const track = $('#gtrack', root); if (!track) return;
  const thumbs = $$('.g-thumb', root), dots = $$('.g-dots i', root);
  const setActive = (i) => { thumbs.forEach((t, k) => t.classList.toggle('active', k === i)); dots.forEach((d, k) => d.classList.toggle('on', k === i)); };
  thumbs.forEach((t) => t.addEventListener('click', () => { const i = +t.dataset.i; track.scrollTo({ left: track.clientWidth * i, behavior: 'smooth' }); setActive(i); }));
  track.addEventListener('scroll', debounce(() => setActive(Math.round(track.scrollLeft / track.clientWidth)), 60), { passive: true });
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    track.addEventListener('pointermove', (e) => {
      const img = e.target.closest('.g-slide')?.querySelector('img'); if (!img) return;
      const r = img.getBoundingClientRect();
      img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
      img.classList.add('zoom');
    });
    track.addEventListener('pointerleave', () => $$('img.zoom', track).forEach((i) => i.classList.remove('zoom')));
  }
}
function detailAccordions(p, d) {
  const desc = d ? esc(d.desc).split(/\n{2,}/).map((x) => `<p>${x.replace(/\n/g, '<br>')}</p>`).join('') : '<div class="skeleton-lines"><i></i><i></i><i></i></div>';
  const hl = d?.highlights?.length ? `<ul class="ticks">${d.highlights.map((x) => `<li>${ic('check')}${esc(x)}</li>`).join('')}</ul>` : '';
  const dl = C.settings.delivery;
  return `<details open><summary>Description</summary><div class="acc-body">${desc}${hl}</div></details>
  <details><summary>Delivery & returns</summary><div class="acc-body"><p>Inside Dhaka: 1–2 days (${money(dl.inside)}). Outside Dhaka: 2–4 days (${money(dl.outside)}). Bliss Express (${esc(dl.expressAreas)}): within ${esc(dl.expressHours)} hours for ${money(dl.express)} when you order before ${dl.cutoffHour > 12 ? dl.cutoffHour - 12 + 'pm' : dl.cutoffHour + 'am'}.</p><p>Not quite right? Exchange unused items within 7 days. <a href="/policies/returns">Read our returns policy</a>.</p></div></details>
  <details><summary>Gift wrapping & cards</summary><div class="acc-body"><p>Every order can include a free handwritten message card. Add premium gift wrap for ${money(C.settings.giftWrapPrice)} at checkout, and choose to hide prices if you're sending it straight to them.</p></div></details>`;
}
function reviewsHtml(p, d) {
  const hist = d?.histogram || [0, 0, 0, 0, 0], total = d ? d.reviewList.length : p.reviews;
  const list = d?.reviewList || [];
  return `${secHead('Customer reviews', '')}
  <div class="rv-grid">
    <div class="rv-summary">
      <div class="rv-score"><b>${p.reviews ? p.rating.toFixed(1) : '–'}</b>${stars(p.rating)}<span>${p.reviews ? `Based on ${plural(p.reviews, 'review')}` : 'Be the first to review'}</span></div>
      <div class="rv-bars">${hist.map((n, i) => `<div><span>${5 - i}★</span><i><b style="width:${total ? Math.round((n / total) * 100) : 0}%"></b></i><span>${n}</span></div>`).join('')}</div>
      <details class="rv-write"><summary class="btn btn-ghost btn-block">Write a review</summary>
        <form class="rv-form" id="rv-form" novalidate>
          <div class="star-input" role="radiogroup" aria-label="Your rating">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="rating" id="rv${n}" value="${n}"><label for="rv${n}" title="${n} stars">${ic('star-fill')}</label>`).join('')}</div>
          <div class="field"><label for="rv-name">Your name</label><input id="rv-name" name="name" maxlength="60" required autocomplete="name"></div>
          <div class="field"><label for="rv-text">Your review</label><textarea id="rv-text" name="text" rows="3" maxlength="1500" required placeholder="What did you love about it?"></textarea></div>
          <button class="btn btn-primary btn-block" type="submit">Submit review</button>
        </form>
      </details>
    </div>
    <div class="rv-list">${d ? (list.length ? list.map((r) => `<article class="rv"><header>${stars(r.rating)}<b>${esc(r.name)}</b><time>${fmtDate(r.created)}</time></header><p>${esc(r.text)}</p><span class="verified">${ic('check')}Verified purchase</span></article>`).join('') : `<div class="empty small">${ic('star', 'empty-ic')}<p>No reviews yet. Be the first to tell others what you think!</p></div>`) : '<div class="skeleton-lines"><i></i><i></i><i></i><i></i></div>'}</div>
  </div>`;
}
function bindReviewForm(root, p) {
  const f = $('#rv-form', root); if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    if (!data.rating) { toast('Please choose a star rating', 'error'); return; }
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await api(`/api/products/${p.id}/reviews`, { method: 'POST', body: { name: data.name, text: data.text, rating: Number(data.rating) } });
      f.closest('.rv-write').outerHTML = `<div class="notice ok">${ic('check')}<p>${r.approved ? 'Thank you! Your review is live.' : 'Thank you! Your review will appear once our team has checked it.'}</p></div>`;
      if (r.approved) detailCache.delete(p.slug);
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Submit review'; }
  });
}
FORMS.restock = async (f) => {
  const phone = cleanPhone(f.elements.phone.value);
  if (!PHONE_RE.test(phone)) { toast('Please enter a valid mobile number', 'error'); return; }
  try {
    await api('/api/contact', { method: 'POST', body: { type: 'support', name: 'Restock request', phone, subject: `Restock request: ${f.dataset.name}`, message: `Please notify me when "${f.dataset.name}" is back in stock.` } });
    f.outerHTML = `<p class="notice ok">${ic('check')}Done! We'll text you as soon as it's back.</p>`;
  } catch (err) { toast(err.message, 'error'); }
};

function quickView(id) {
  const p = IDX.byId.get(id); if (!p) return;
  const sel = {}; for (const o of p.options) if (o.values.length === 1) sel[o.name] = o.values[0];
  const cat = C.catById.get(p.cat);
  const el = openLayer('modal', `
    <button type="button" class="ibtn modal-x" data-act="close-layer" aria-label="Close">${ic('close')}</button>
    <div class="qv">
      <div class="qv-media"><img src="${esc(p.img)}" alt="${esc(p.name)}" width="800" height="1000">${badgeHtml(p)}</div>
      <div class="qv-info">
        ${cat ? `<span class="eyebrow-link">${esc(cat.name)}</span>` : ''}
        <h2>${esc(p.name)}</h2>
        ${p.reviews ? `<div class="pdp-meta">${stars(p.rating)}<b>${p.rating.toFixed(1)}</b><span>${plural(p.reviews, 'review')}</span></div>` : ''}
        <div class="pdp-price">${priceHtml(p, 'lg')}</div>
        <div class="pdp-stock">${stockHtml(p, true)}</div>
        ${buyBoxHtml(p, sel)}
        <a class="link-arrow" href="/product/${p.slug}">View full details ${ic('arrow-right')}</a>
      </div>
    </div>`, { label: p.name, cls: 'qv-layer' });
  bindBuyBox($('.qv-info', el), p, sel, { onAdded: () => closeLayer() });
}

/* ================================================================== cart */
function progressHtml(t) {
  let h = '';
  if (t.freeOver && t.count) {
    const pctFree = Math.min(100, Math.round(((t.freeOver - t.toFree) / t.freeOver) * 100));
    h += `<div class="progress-card">${t.toFree > 0 ? `<p>${ic('truck')}You're <b>${money(t.toFree)}</b> away from <b>free delivery</b></p>` : `<p>${ic('check')}You've unlocked <b>free standard delivery!</b></p>`}<div class="bar"><i style="width:${pctFree}%"></i></div></div>`;
  }
  if (t.nextTier && t.count) h += `<p class="bundle-hint">${ic('tag')}Add <b>${t.nextTier.min - t.count}</b> more item${t.nextTier.min - t.count > 1 ? 's' : ''} to save <b>${t.nextTier.pct}%</b> with Mix & Match</p>`;
  else if (t.bundlePct) h += `<p class="bundle-hint on">${ic('check')}Mix & Match unlocked: <b>${t.bundlePct}% off</b></p>`;
  return h;
}
function linesHtml(lines, { compact = false } = {}) {
  return lines.map((l) => {
    const opts = l.kind === 'box'
      ? `<small>${esc(l.wrap?.name || '')} wrap · ${esc(l.ribbon?.name || '')} ribbon · ${plural(l.items.length, 'item')}</small><small class="box-items">${l.itemsP.map((p) => esc(p?.name || 'Unavailable')).join(', ')}</small>`
      : Object.entries(l.options || {}).map(([k, v]) => `<small>${esc(k)}: ${esc(v)}</small>`).join('');
    const warn = l.missing ? '<em class="warn">No longer available, please remove</em>' : l.out ? '<em class="warn">Sold out, please remove</em>' : l.over ? `<em class="warn">Only ${l.p.left} left</em>` : '';
    const link = l.slug ? `/product/${l.slug}` : l.kind === 'box' ? '/gift-box-builder' : '';
    return `<li class="line${l.missing || l.out ? ' bad' : ''}">
      <a class="line-img" ${link ? `href="${link}"` : ''}><img src="${esc(l.img)}" alt="" width="80" height="100" loading="lazy"></a>
      <div class="line-info"><a class="line-name" ${link ? `href="${link}"` : ''}>${esc(l.name)}</a>${opts}${warn}
        <div class="line-row">
          <div class="stepper sm" role="group" aria-label="Quantity"><button type="button" data-act="line-dec" data-key="${esc(l.key)}" aria-label="Decrease">${ic('minus')}</button><span>${l.qty}</span><button type="button" data-act="line-inc" data-key="${esc(l.key)}" aria-label="Increase">${ic('plus')}</button></div>
          <b class="line-price">${money(l.price * l.qty)}</b>
        </div>
      </div>
      <button type="button" class="ibtn line-rm" data-act="line-rm" data-key="${esc(l.key)}" aria-label="Remove ${esc(l.name)}">${ic(compact ? 'close' : 'trash')}</button>
    </li>`;
  }).join('');
}
function openCart() { openLayer('drawer', '<div id="cart-drawer" class="drawer-in"></div>', { label: 'Your bag' }); renderCartDrawer(); }
function renderCartDrawer() {
  const box = $('#cart-drawer'); if (!box) return;
  const lines = resolveCart(), t = totalsFor(lines);
  box.innerHTML = `<header class="drawer-head"><h2>Your bag <span>(${cartCount()})</span></h2><button type="button" class="ibtn" data-act="close-layer" aria-label="Close bag">${ic('close')}</button></header>
  ${lines.length ? `<div class="drawer-body">${progressHtml(t)}<ul class="lines">${linesHtml(lines, { compact: true })}</ul></div>
  <footer class="drawer-foot">
    <div class="sum-row"><span>Subtotal</span><b>${money(t.subtotal)}</b></div>
    ${t.discount ? `<div class="sum-row disc"><span>${esc(t.discountLabel)}</span><b>−${money(t.discount)}</b></div>` : ''}
    <p class="muted small">Delivery & gift options calculated at checkout.</p>
    <a class="btn btn-primary btn-lg btn-block" href="/checkout">Checkout · ${money(t.subtotal - t.discount)}</a>
    <a class="btn btn-ghost btn-block" href="/cart">View bag</a>
  </footer>` : `<div class="drawer-empty">${ic('bag', 'empty-ic')}<h3>Your bag is empty</h3><p>Let's find something they'll love.</p><a class="btn btn-primary" href="/shop">Start shopping</a><a class="btn btn-ghost" href="/gift-box-builder">Build a gift box</a></div>`}`;
}
function refreshCartViews() {
  if (layer.type === 'drawer') renderCartDrawer();
  if (current?.name === 'cart' || current?.name === 'checkout') current.refresh?.();
}

function viewCart() {
  const draw = () => {
    const lines = resolveCart(), t = totalsFor(lines);
    if (!lines.length) return `<div class="container narrow"><div class="empty big">${ic('bag', 'empty-ic')}<h1>Your bag is empty</h1><p>Browse our best sellers or build a custom gift box.</p><div class="row-gap"><a class="btn btn-primary btn-lg" href="/shop">Shop gifts</a><a class="btn btn-ghost btn-lg" href="/gift-box-builder">Build a gift box</a></div></div></div>`;
    const bad = lines.some((l) => l.missing || l.out);
    const recs = IDX.query({ sort: 'popular', s: ['in', 'limited'], size: 12 }).items.filter((p) => !S.cart.some((l) => l.pid === p.id)).slice(0, 8);
    return `<div class="container">
      <header class="page-head"><h1>Your bag</h1><p>${plural(cartCount(), 'item')}</p></header>
      <div class="cart-layout">
        <section>${progressHtml(t)}<ul class="lines big">${linesHtml(lines)}</ul><a class="link-arrow back" href="/shop">${ic('arrow-left')} Continue shopping</a></section>
        <aside class="summary">
          <h2>Order summary</h2>
          <div class="sum-row"><span>Subtotal</span><b>${money(t.subtotal)}</b></div>
          ${t.discount ? `<div class="sum-row disc"><span>${esc(t.discountLabel)}</span><b>−${money(t.discount)}</b></div>` : ''}
          <div class="sum-row"><span>Delivery</span><span class="muted">${t.freeDelivery ? 'Free' : `from ${money(C.settings.delivery.inside)}`}</span></div>
          ${couponHtml(t)}
          <div class="sum-row total"><span>Estimated total</span><b>${money(t.subtotal - t.discount + (t.freeDelivery ? 0 : C.settings.delivery.inside))}</b></div>
          ${bad ? `<p class="notice warn">${ic('info')}Please remove unavailable items to continue.</p>` : ''}
          <a class="btn btn-primary btn-lg btn-block${bad ? ' disabled' : ''}" href="/checkout" ${bad ? 'aria-disabled="true" tabindex="-1"' : ''}>Checkout ${ic('arrow-right')}</a>
          <div class="secure">${ic('lock')}Secure checkout · Cash on delivery available</div>
        </aside>
      </div>
      ${recs.length ? `<section class="sec">${secHead('Add a little extra', 'Customers often add these.')}${railHtml(recs)}</section>` : ''}
    </div>`;
  };
  return {
    name: 'cart', title: 'Your bag', html: draw(),
    refresh() { this.root.innerHTML = draw(); bindCoupon(this.root, () => this.refresh()); },
    mount(root) { bindCoupon(root, () => this.refresh()); },
  };
}
function couponHtml(t) {
  return S.coupon
    ? `<div class="coupon-applied">${ic('tag')}<span><b>${esc(S.coupon.code)}</b>${t.couponNote ? `<small>${esc(t.couponNote)}</small>` : t.couponOff ? `<small>You save ${money(t.couponOff)}</small>` : ''}</span><button type="button" class="link" id="coupon-rm">Remove</button></div>`
    : `<form class="coupon-form" id="coupon-form"><label class="sr" for="coupon-in">Coupon code</label><input id="coupon-in" name="code" placeholder="Coupon code" autocomplete="off" maxlength="30"><button class="btn btn-soft" type="submit">Apply</button></form>`;
}
function bindCoupon(root, after) {
  $('#coupon-form', root)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = e.target.elements.code.value.trim(); if (!code) return;
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const r = await api('/api/coupons/validate', { method: 'POST', body: { code } });
      if (!r.ok) { toast(r.message, 'error'); btn.disabled = false; return; }
      S.coupon = r.coupon; ls.set('bliss.coupon', S.coupon); toast(`Coupon ${r.coupon.code} applied`); after();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  });
  $('#coupon-rm', root)?.addEventListener('click', () => { S.coupon = null; ls.set('bliss.coupon', null); after(); });
}

/* =============================================================== checkout */
const CITIES = ['Dhaka', 'Narayanganj', 'Gazipur', 'Chattogram', 'Sylhet', 'Khulna', 'Rajshahi', 'Barishal', 'Rangpur', 'Mymensingh', 'Cumilla', 'Bogura', "Cox's Bazar", 'Jashore', 'Narsingdi', 'Savar', 'Tangail', 'Feni', 'Noakhali', 'Dinajpur'];
const INSIDE = new Set(['dhaka', 'narayanganj']);
const zoneOf = (city) => (INSIDE.has(String(city || '').trim().toLowerCase()) ? 'inside' : 'outside');

function viewCheckout() {
  if (!S.cart.length) return { name: 'checkout', title: 'Checkout', html: `<div class="container narrow"><div class="empty big">${ic('bag', 'empty-ic')}<h1>Your bag is empty</h1><p>Add a gift or two before checking out.</p><a class="btn btn-primary btn-lg" href="/shop">Shop gifts</a></div></div>` };
  const saved = ss.get('bliss.checkout', {});
  const u = S.user;
  const v = {
    name: saved.name ?? u?.name ?? '', phone: saved.phone ?? u?.phone ?? '', email: saved.email ?? u?.email ?? '',
    line: saved.line ?? u?.address?.line ?? '', area: saved.area ?? u?.address?.area ?? '', city: saved.city ?? (u?.address?.city || 'Dhaka'),
    gift: !!saved.gift, rname: saved.rname || '', rphone: saved.rphone || '', method: saved.method || 'standard', date: saved.date || '', slot: saved.slot || '',
    wrap: !!saved.wrap, message: saved.message || '', hidePrice: !!saved.hidePrice, pay: saved.pay || 'cod', trx: '', note: saved.note || '',
  };
  const P = C.settings.payments, dl = C.settings.delivery, today = dhakaNow().date;
  const cityKnown = CITIES.includes(v.city);
  const html = `
  <div class="container checkout">
    <header class="page-head"><a class="link-arrow back" href="/cart">${ic('arrow-left')} Back to bag</a><h1>Checkout</h1>${S.user ? `<p>Signed in as <b>${esc(S.user.name)}</b></p>` : `<p>Have an account? <a href="/account?next=/checkout">Log in</a> for faster checkout. Guest checkout is fine too.</p>`}</header>
    <div class="co-layout">
      <form class="co-main" id="co-form" novalidate>
        <section class="co-sec"><h2><span>1</span>Your details</h2>
          <div class="grid-2">
            <div class="field"><label for="co-name">Full name *</label><input id="co-name" name="name" autocomplete="name" required maxlength="80" value="${esc(v.name)}"></div>
            <div class="field"><label for="co-phone">Mobile number *</label><input id="co-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX" required value="${esc(v.phone)}"></div>
          </div>
          <div class="field"><label for="co-email">Email <span class="muted">(optional, for your receipt)</span></label><input id="co-email" name="email" type="email" autocomplete="email" value="${esc(v.email)}"></div>
        </section>

        <section class="co-sec"><h2><span>2</span>Delivery address</h2>
          <label class="toggle"><input type="checkbox" name="gift" ${v.gift ? 'checked' : ''}><span class="track"></span><span>${ic('gift')} Send directly to someone else (gift delivery)</span></label>
          <div class="grid-2 recipient" ${v.gift ? '' : 'hidden'}>
            <div class="field"><label for="co-rname">Recipient's name *</label><input id="co-rname" name="rname" maxlength="80" value="${esc(v.rname)}"></div>
            <div class="field"><label for="co-rphone">Recipient's mobile *</label><input id="co-rphone" name="rphone" type="tel" inputmode="tel" placeholder="01XXXXXXXXX" value="${esc(v.rphone)}"></div>
          </div>
          <div class="field"><label for="co-line">Full address *</label><textarea id="co-line" name="line" rows="2" required maxlength="300" placeholder="House, road, block, landmark" autocomplete="street-address">${esc(v.line)}</textarea></div>
          <div class="grid-2">
            <div class="field"><label for="co-city">City / district *</label><select id="co-city" name="cityPick">${CITIES.map((c) => `<option ${c === v.city ? 'selected' : ''}>${c}</option>`).join('')}<option value="__other" ${cityKnown ? '' : 'selected'}>Other district</option></select>
              <input name="cityOther" class="mt" placeholder="District name" value="${cityKnown ? '' : esc(v.city)}" ${cityKnown ? 'hidden' : ''} aria-label="District name"></div>
            <div class="field"><label for="co-area">Area / thana</label><input id="co-area" name="area" maxlength="80" placeholder="e.g. Dhanmondi" value="${esc(v.area)}"></div>
          </div>
        </section>

        <section class="co-sec"><h2><span>3</span>Delivery</h2>
          <div class="radio-cards">
            <label class="rcard"><input type="radio" name="method" value="standard" ${v.method !== 'express' ? 'checked' : ''}><span class="rc-body">${ic('truck')}<b>Standard delivery</b><small id="std-note">1–2 days in Dhaka · 2–4 days elsewhere</small></span><span class="rc-price" id="std-price"></span></label>
            <label class="rcard" id="express-card"><input type="radio" name="method" value="express" ${v.method === 'express' ? 'checked' : ''}><span class="rc-body">${ic('bolt')}<b>Bliss Express</b><small>Within ${esc(dl.expressHours)} hours · ${esc(dl.expressAreas)} only</small></span><span class="rc-price">${money(dl.express)}</span></label>
          </div>
          <p class="notice info express-note" hidden>${ic('clock')}<span id="express-msg"></span></p>
          <div class="grid-2 schedule">
            <div class="field"><label for="co-date">Preferred delivery date</label><input id="co-date" name="date" type="date" min="${addDays(today, 1)}" max="${addDays(today, 60)}" value="${esc(v.date)}"><small class="hint">Leave empty for the earliest delivery.</small></div>
            <div class="field"><label for="co-slot">Time of day</label><select id="co-slot" name="slot"><option value="">Any time</option><option value="morning" ${v.slot === 'morning' ? 'selected' : ''}>Morning (10am – 1pm)</option><option value="afternoon" ${v.slot === 'afternoon' ? 'selected' : ''}>Afternoon (1pm – 5pm)</option><option value="evening" ${v.slot === 'evening' ? 'selected' : ''}>Evening (5pm – 9pm)</option></select></div>
          </div>
        </section>

        <section class="co-sec"><h2><span>4</span>Gift options</h2>
          <label class="toggle"><input type="checkbox" name="wrap" ${v.wrap ? 'checked' : ''}><span class="track"></span><span>Premium gift wrap <b>+${money(C.settings.giftWrapPrice)}</b></span></label>
          <div class="field"><label for="co-msg">Message for the card <span class="muted">(free, handwritten)</span></label><textarea id="co-msg" name="message" rows="3" maxlength="300" placeholder="Happy birthday! Wishing you all the love in the world…">${esc(v.message)}</textarea><small class="hint"><span id="msg-count">${v.message.length}</span>/300</small></div>
          <label class="check"><input type="checkbox" name="hidePrice" ${v.hidePrice ? 'checked' : ''}><span class="box"></span>Hide prices on the invoice (great for surprises)</label>
        </section>

        <section class="co-sec"><h2><span>5</span>Payment</h2>
          <div class="radio-cards pay-cards">
            ${P.cod ? `<label class="rcard"><input type="radio" name="pay" value="cod" ${v.pay === 'cod' ? 'checked' : ''}><span class="rc-body">${ic('cash')}<b>Cash on delivery</b><small>Pay when your gift arrives</small></span></label>` : ''}
            ${P.bkash ? `<label class="rcard"><input type="radio" name="pay" value="bkash" ${v.pay === 'bkash' ? 'checked' : ''}><span class="rc-body"><span class="pay-logo bkash">bKash</span><b>bKash</b><small>Send money, then add the TrxID</small></span></label>` : ''}
            ${P.nagad ? `<label class="rcard"><input type="radio" name="pay" value="nagad" ${v.pay === 'nagad' ? 'checked' : ''}><span class="rc-body"><span class="pay-logo nagad">Nagad</span><b>Nagad</b><small>Send money, then add the TrxID</small></span></label>` : ''}
          </div>
          <div class="pay-mobile" hidden>
            <ol class="pay-steps"><li>Open your <b class="pm-name"></b> app and choose <b>Send Money</b>.</li><li>Send <b class="pm-amount"></b> to <b class="pm-number"></b> <button type="button" class="link" id="copy-num">Copy</button></li><li>Enter the Transaction ID (TrxID) below.</li></ol>
            <p class="muted small">${esc(P.note)}</p>
            <div class="field"><label for="co-trx">Transaction ID *</label><input id="co-trx" name="trx" autocomplete="off" placeholder="e.g. 9K7D2X1ABC" maxlength="30"></div>
          </div>
          <div class="field"><label for="co-note">Order note <span class="muted">(optional)</span></label><input id="co-note" name="note" maxlength="500" placeholder="Anything we should know?" value="${esc(v.note)}"></div>
        </section>
      </form>
      <aside class="summary co-summary" id="co-summary"></aside>
    </div>
  </div>`;
  return {
    name: 'checkout', title: 'Checkout', html,
    refresh() { this.recalc?.(); },
    mount(root) {
      const f = $('#co-form', root), sum = $('#co-summary', root);
      const val = () => {
        const fd = Object.fromEntries(new FormData(f));
        const city = fd.cityPick === '__other' ? (fd.cityOther || '').trim() : fd.cityPick;
        return { ...fd, city, gift: !!fd.gift, wrap: !!fd.wrap, hidePrice: !!fd.hidePrice };
      };
      let t;
      const recalc = () => {
        const x = val(), zone = zoneOf(x.city), lines = resolveCart();
        if (!lines.length) { navigate('/cart', { replace: true }); return; }
        const expressOk = zone === 'inside';
        const exCard = $('#express-card', root), exInput = exCard.querySelector('input');
        exCard.classList.toggle('disabled', !expressOk); exInput.disabled = !expressOk;
        if (!expressOk && exInput.checked) { f.querySelector('input[name=method][value=standard]').checked = true; }
        const express = expressOk && f.querySelector('input[name=method]:checked')?.value === 'express';
        const ex = expressInfo();
        const note = $('.express-note', root); note.hidden = !express; $('#express-msg', root).textContent = express ? (ex.today ? `${ex.text}. Your gift will arrive within ${dl.expressHours} hours of confirmation.` : `It's past today's ${dl.cutoffHour > 12 ? dl.cutoffHour - 12 + 'pm' : dl.cutoffHour + 'am'} cutoff, so we'll deliver first thing tomorrow.`) : '';
        $('.schedule', root).hidden = express;
        t = totalsFor(lines, { zone, express, giftWrap: x.wrap });
        const std = zone === 'outside' ? dl.outside : dl.inside;
        $('#std-price', root).textContent = t.freeDelivery && !express ? 'Free' : money(std);
        $('.recipient', root).hidden = !x.gift;
        f.elements.cityOther.hidden = f.elements.cityPick.value !== '__other';
        const pm = x.pay;
        const mob = $('.pay-mobile', root); mob.hidden = pm === 'cod';
        if (pm !== 'cod') { $('.pm-name', root).textContent = pm === 'bkash' ? 'bKash' : 'Nagad'; $('.pm-amount', root).textContent = money(t.total); $('.pm-number', root).textContent = pm === 'bkash' ? P.bkashNumber : P.nagadNumber; }
        $('#msg-count', root).textContent = (x.message || '').length;
        const bad = lines.some((l) => l.missing || l.out);
        sum.innerHTML = `<h2>Order summary</h2>
          <ul class="mini-lines">${lines.map((l) => `<li class="${l.missing || l.out ? 'bad' : ''}"><span class="mi-img"><img src="${esc(l.img)}" alt="" width="56" height="70"><b>${l.qty}</b></span><span class="mi-name">${esc(l.name)}${l.kind === 'box' ? `<small>${plural(l.items.length, 'item')} inside</small>` : Object.entries(l.options || {}).map(([k, o]) => `<small>${esc(k)}: ${esc(o)}</small>`).join('')}${l.missing || l.out ? '<em class="warn">Unavailable, remove it in your bag</em>' : ''}</span><b>${money(l.price * l.qty)}</b></li>`).join('')}</ul>
          ${couponHtml(t)}
          <div class="sum-row"><span>Subtotal (${plural(t.count, 'item')})</span><b>${money(t.subtotal)}</b></div>
          ${t.discount ? `<div class="sum-row disc"><span>${esc(t.discountLabel)}</span><b>−${money(t.discount)}</b></div>` : ''}
          <div class="sum-row"><span>Delivery · ${express ? 'Express' : zone === 'inside' ? 'Inside Dhaka' : 'Outside Dhaka'}</span><b>${t.delivery ? money(t.delivery) : 'Free'}</b></div>
          ${t.wrap ? `<div class="sum-row"><span>Gift wrap</span><b>${money(t.wrap)}</b></div>` : ''}
          <div class="sum-row total"><span>Total</span><b>${money(t.total)}</b></div>
          ${!express && t.toFree > 0 && t.freeOver ? `<p class="muted small">Add ${money(t.toFree)} more for free standard delivery.</p>` : ''}
          <div class="form-error" id="co-error" role="alert" hidden></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit" form="co-form" id="co-submit" ${bad ? 'disabled' : ''}>${ic('lock')}Place order · ${money(t.total)}</button>
          <p class="muted small center">By placing your order you agree to our <a href="/policies/terms">terms</a> and <a href="/policies/returns">returns policy</a>.</p>`;
        bindCoupon(sum, recalc);
        const keep = { ...x }; delete keep.trx; ss.set('bliss.checkout', keep);
      };
      this.recalc = recalc;
      f.addEventListener('input', (e) => { e.target.closest('.field')?.classList.remove('invalid'); if (!['message', 'note', 'line', 'name', 'email', 'area', 'trx', 'rname', 'rphone', 'phone', 'cityOther'].includes(e.target.name)) recalc(); else { const x = val(); const keep = { ...x }; delete keep.trx; ss.set('bliss.checkout', keep); $('#msg-count', root).textContent = (x.message || '').length; } });
      f.addEventListener('change', recalc);
      $('#copy-num', root).addEventListener('click', () => ACTIONS.copy({ dataset: { text: $('.pm-number', root).textContent } }));
      f.addEventListener('submit', (e) => { e.preventDefault(); submitOrder(f, val(), t, root); });
      recalc();
    },
  };
}
function markInvalid(f, name, msg) {
  const el = f.elements[name]; if (!el) return;
  const field = el.closest('.field') || el.closest('label');
  if (field) { field.classList.add('invalid'); let m = field.querySelector('.err'); if (!m) { m = document.createElement('small'); m.className = 'err'; field.append(m); } m.textContent = msg; }
}
async function submitOrder(f, x, t, root) {
  $$('.field.invalid', f).forEach((el) => el.classList.remove('invalid'));
  const errs = [];
  if ((x.name || '').trim().length < 2) errs.push(['name', 'Please enter your full name']);
  if (!PHONE_RE.test(cleanPhone(x.phone))) errs.push(['phone', 'Enter a valid mobile number, e.g. 01712345678']);
  if (x.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x.email)) errs.push(['email', 'Please check your email address']);
  if (x.gift && (x.rname || '').trim().length < 2) errs.push(['rname', "Please enter the recipient's name"]);
  if (x.gift && !PHONE_RE.test(cleanPhone(x.rphone))) errs.push(['rphone', "Enter the recipient's mobile number"]);
  if ((x.line || '').trim().length < 5) errs.push(['line', 'Please enter the full delivery address']);
  if ((x.city || '').trim().length < 2) errs.push([x.cityPick === '__other' ? 'cityOther' : 'cityPick', 'Please enter the district']);
  if (x.pay !== 'cod' && !/^[A-Za-z0-9]{6,30}$/.test((x.trx || '').replace(/\s/g, ''))) errs.push(['trx', 'Please enter the Transaction ID from your payment']);
  if (errs.length) {
    errs.forEach(([n, m]) => markInvalid(f, n, m));
    const first = f.elements[errs[0][0]]; first?.focus(); first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(errs[0][1], 'error'); return;
  }
  const btn = $('#co-submit', root), errBox = $('#co-error', root);
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Placing your order…'; errBox.hidden = true;
  const payload = {
    items: S.cart.map((l) => (l.kind === 'box' ? { kind: 'box', boxId: l.boxId, wrapId: l.wrapId, ribbonId: l.ribbonId, items: l.items, to: l.to, from: l.from, note: l.note, qty: l.qty } : { pid: l.pid, qty: l.qty, options: l.options })),
    customer: { name: x.name, phone: cleanPhone(x.phone), email: x.email },
    recipient: x.gift ? { name: x.rname, phone: cleanPhone(x.rphone) } : null,
    address: { line: x.line, area: x.area, city: x.city, zone: zoneOf(x.city) },
    delivery: { method: x.method === 'express' && zoneOf(x.city) === 'inside' ? 'express' : 'standard', date: x.date || null, slot: x.slot || null },
    gift: { wrap: x.wrap, message: x.message, hidePrice: x.hidePrice },
    payment: { method: x.pay, trxId: (x.trx || '').replace(/\s/g, '') },
    coupon: S.coupon?.code || '', note: x.note, expectedTotal: t.total,
  };
  try {
    const { order } = await api('/api/orders', { method: 'POST', body: payload });
    const mine = ls.get('bliss.orders', []);
    ls.set('bliss.orders', [order, ...mine.filter((o) => o.id !== order.id)].slice(0, 20));
    S.cart = []; saveCart(); S.coupon = null; ls.set('bliss.coupon', null);
    const keep = ss.get('bliss.checkout', {}); ss.set('bliss.checkout', { name: keep.name, phone: keep.phone, email: keep.email, line: keep.line, area: keep.area, city: keep.city });
    if (S.user) S.orders = [order, ...S.orders];
    navigate(`/order/${order.id}`, { replace: true });
    refreshCatalog(true);
  } catch (err) {
    btn.disabled = false; btn.innerHTML = `${ic('lock')}Place order · ${money(t.total)}`;
    errBox.hidden = false; errBox.textContent = err.message;
    if (err.data?.field) markInvalid(f, { trx: 'trx', line: 'line', rname: 'rname', rphone: 'rphone', name: 'name', phone: 'phone', email: 'email', city: 'cityPick' }[err.data.field] || err.data.field, err.message);
    if (err.data?.field === 'coupon') { S.coupon = null; ls.set('bliss.coupon', null); }
    if (err.status === 409) { await refreshCatalog(true); current?.refresh?.(); }
    toast(err.message, 'error');
  }
}

/* ======================================================== order & tracking */
function timelineHtml(o) {
  const flow = ORDER_STATUSES.filter(([k]) => k !== 'cancelled');
  if (o.status === 'cancelled') return `<div class="notice warn">${ic('info')}<p>This order was cancelled${o.timeline.at(-1)?.note ? `: ${esc(o.timeline.at(-1).note)}` : '.'} Need help? <a href="/help">Contact us</a>.</p></div>`;
  const idx = flow.findIndex(([k]) => k === o.status);
  const at = (k) => o.timeline.filter((x) => x.status === k).at(-1);
  return `<ol class="timeline">${flow.map(([k, label], i) => { const ev = at(k); return `<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}"><span class="tl-dot">${i <= idx ? ic('check') : ''}</span><div><b>${label}</b>${ev ? `<small>${fmtDate(ev.at)} · ${fmtTime(ev.at)}</small>${ev.note ? `<small class="tl-note">${esc(ev.note)}</small>` : ''}` : ''}</div></li>`; }).join('')}</ol>`;
}
function orderCardHtml(o, { full = true } = {}) {
  const pmName = { cod: 'Cash on delivery', bkash: 'bKash', nagad: 'Nagad' }[o.payment.method];
  return `<div class="order-card">
    <div class="oc-head"><div><span class="muted">Order</span><b class="oc-id">${esc(o.id)}</b><button type="button" class="ibtn sm" data-act="copy" data-text="${esc(o.id)}" aria-label="Copy order ID">${ic('copy')}</button></div><div><span class="muted">Placed</span><b>${fmtDate(o.created)}</b></div><div><span class="muted">Total</span><b>${money(o.totals.total)}</b></div><span class="status-pill st-${o.status}">${esc(ORDER_STATUSES.find(([k]) => k === o.status)?.[1] || o.status)}</span></div>
    ${timelineHtml(o)}
    ${full ? `<div class="oc-grid">
      <div><h3>Items</h3><ul class="mini-lines">${o.items.map((l) => `<li><span class="mi-img"><img src="${esc(l.img || '/img/box.svg')}" alt="" width="56" height="70"><b>${l.qty}</b></span><span class="mi-name">${esc(l.name)}${Object.entries(l.options || {}).map(([k, v]) => `<small>${esc(k)}: ${esc(v)}</small>`).join('')}${l.box ? `<small>${esc(l.box.items.map((x) => x.name).join(', '))}</small>` : ''}</span><b>${money(l.price * l.qty)}</b></li>`).join('')}</ul>
        <div class="sum-row"><span>Subtotal</span><b>${money(o.totals.subtotal)}</b></div>${o.totals.discount ? `<div class="sum-row disc"><span>${esc(o.totals.discountLabel)}</span><b>−${money(o.totals.discount)}</b></div>` : ''}<div class="sum-row"><span>Delivery</span><b>${o.totals.delivery ? money(o.totals.delivery) : 'Free'}</b></div>${o.totals.wrap ? `<div class="sum-row"><span>Gift wrap</span><b>${money(o.totals.wrap)}</b></div>` : ''}<div class="sum-row total"><span>Total</span><b>${money(o.totals.total)}</b></div></div>
      <div><h3>Delivery</h3><p class="oc-addr"><b>${esc(o.recipient?.name || o.customer.name)}</b><br>${esc(o.recipient?.phone || o.customer.phone)}<br>${esc(o.address.line)}${o.address.area ? `, ${esc(o.address.area)}` : ''}, ${esc(o.address.city)}</p>
        <p>${o.delivery.method === 'express' ? `${ic('bolt')} Bliss Express` : `${ic('truck')} Standard delivery`}${o.delivery.date ? ` · ${fmtDate(o.delivery.date + 'T06:00:00Z')}` : ''}${o.delivery.slot ? ` · ${esc(o.delivery.slot)}` : ''}</p>
        <h3>Payment</h3><p>${esc(pmName)}${o.payment.trxId ? ` · TrxID ${esc(o.payment.trxId)}` : ''} · <span class="status-pill sm ${o.payment.status === 'paid' ? 'st-delivered' : 'st-pending'}">${o.payment.status === 'paid' ? 'Paid' : o.payment.method === 'cod' ? 'Pay on delivery' : 'Verifying payment'}</span></p>
        ${o.gift?.message ? `<h3>Card message</h3><p class="card-msg">“${esc(o.gift.message)}”</p>` : ''}</div>
    </div>` : ''}
  </div>`;
}
function viewOrder(id) {
  const o = ls.get('bliss.orders', []).find((x) => x.id === id);
  if (!o) return viewTrack(id);
  const st = C.settings.store;
  return {
    name: 'order', title: 'Order confirmed',
    html: `<div class="container narrow order-done">
      <div class="confetti" aria-hidden="true">${Array.from({ length: 24 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
      <div class="done-head"><span class="done-ic">${ic('check')}</span><h1>Thank you, ${esc(o.customer.name.split(' ')[0])}!</h1><p>Your order is in. We'll call <b>${esc(o.customer.phone)}</b> to confirm it shortly${o.payment.method !== 'cod' ? ' and verify your payment' : ''}.</p></div>
      <div id="order-live">${orderCardHtml(o)}</div>
      <div class="row-gap center"><a class="btn btn-primary btn-lg" href="/track?id=${esc(o.id)}&phone=${esc(o.customer.phone)}">${ic('truck')}Track this order</a><a class="btn btn-ghost btn-lg" href="/shop">Continue shopping</a>${st.whatsapp ? `<a class="btn btn-ghost btn-lg" target="_blank" rel="noopener" href="https://wa.me/${esc(st.whatsapp)}?text=${encodeURIComponent(`Hi! I just placed order ${o.id}.`)}">${ic('whatsapp')}WhatsApp us</a>` : ''}</div>
    </div>`,
    mount(root) {
      api(`/api/orders/track?id=${encodeURIComponent(o.id)}&phone=${encodeURIComponent(o.customer.phone)}`).then(({ order }) => {
        const live = $('#order-live', root); if (live) live.innerHTML = orderCardHtml(order);
      }).catch(() => {});
    },
  };
}
function viewTrack(prefillId = '') {
  const q = new URLSearchParams(location.search);
  const id = prefillId || q.get('id') || '', phone = q.get('phone') || '';
  return {
    name: 'track', title: 'Track your order',
    html: `<div class="container narrow">
      <header class="page-head center"><span class="eyebrow">${ic('truck')}Order tracking</span><h1>Where's my gift?</h1><p>Enter your order ID and the mobile number used at checkout.</p></header>
      <form class="track-form card-pad" data-form="track">
        <div class="field"><label for="tr-id">Order ID</label><input id="tr-id" name="id" placeholder="e.g. BL7K2M9Q" required value="${esc(id)}" autocapitalize="characters"></div>
        <div class="field"><label for="tr-phone">Mobile number</label><input id="tr-phone" name="phone" type="tel" inputmode="tel" placeholder="01XXXXXXXXX" required value="${esc(phone)}"></div>
        <button class="btn btn-primary btn-lg" type="submit">Track order</button>
      </form>
      <div id="track-result" aria-live="polite"></div>
      ${ls.get('bliss.orders', []).length ? `<section class="sec"><h2 class="h3">Orders from this device</h2><div class="recent-orders">${ls.get('bliss.orders', []).slice(0, 5).map((o) => `<a class="ro" href="/track?id=${esc(o.id)}&phone=${esc(o.customer.phone)}"><b>${esc(o.id)}</b><span>${fmtDate(o.created)}</span><span>${money(o.totals.total)}</span>${ic('chev-right')}</a>`).join('')}</div></section>` : ''}
    </div>`,
    mount(root) { if (id && phone) FORMS.track($('.track-form', root)); },
  };
}
FORMS.track = async (f) => {
  const id = f.elements.id.value.trim(), phone = cleanPhone(f.elements.phone.value);
  const out = $('#track-result');
  if (!id || !PHONE_RE.test(phone)) { toast('Please enter your order ID and a valid mobile number', 'error'); return; }
  out.innerHTML = '<div class="loading"><span class="spinner"></span>Finding your order…</div>';
  try {
    const { order } = await api(`/api/orders/track?id=${encodeURIComponent(id)}&phone=${encodeURIComponent(phone)}`);
    out.innerHTML = orderCardHtml(order);
    history.replaceState(history.state, '', `/track?id=${encodeURIComponent(order.id)}&phone=${encodeURIComponent(phone)}`);
  } catch (err) { out.innerHTML = `<div class="notice warn">${ic('info')}<p>${esc(err.message)}</p></div>`; }
};

/* ============================================================== wishlist */
function viewWishlist() {
  const items = [...S.wish].map((id) => IDX.byId.get(id)).filter(Boolean);
  return {
    name: 'wishlist', title: 'Your wishlist',
    html: `<div class="container"><header class="page-head"><h1>Your wishlist</h1><p>${items.length ? `${plural(items.length, 'gift')} saved on this device` : ''}</p></header>
    ${items.length ? `<div class="row-gap"><button type="button" class="btn btn-soft" id="wish-all">${ic('bag')}Add all available to bag</button></div>${gridHtml(items)}`
      : `<div class="empty big">${ic('heart', 'empty-ic')}<h2>No saved gifts yet</h2><p>Tap the heart on anything you love to save it here.</p><a class="btn btn-primary btn-lg" href="/shop">Explore gifts</a></div>`}</div>`,
    mount(root) {
      $('#wish-all', root)?.addEventListener('click', () => {
        let n = 0;
        for (const p of items) if (p.stock !== 'out' && !p.options.length && inCartQty(p.id) === 0) { if (addToCart(p, 1, {}, { silent: true })) n++; }
        toast(n ? `Added ${plural(n, 'gift')} to your bag` : 'Nothing new to add (items with options need choosing)', n ? 'ok' : 'error', n ? { label: 'View bag', act: 'open-cart' } : null);
      });
    },
  };
}

/* =============================================================== account */
async function loadMe() {
  try { const r = await api('/api/me'); S.user = r.user; S.orders = r.orders || []; } catch { S.user = null; }
  S.meLoaded = true; updateBadges();
  if (current?.name === 'account' || current?.name === 'checkout') { if (current.name === 'account' || !ss.get('bliss.checkout', null)) render(scrollY); }
}
function viewAccount() {
  if (!S.meLoaded) return { name: 'account', title: 'Your account', html: '<div class="container narrow"><div class="loading"><span class="spinner"></span>Loading your account…</div></div>' };
  if (!S.user) {
    return {
      name: 'account', title: 'Log in',
      html: `<div class="container narrow auth">
        <header class="page-head center"><h1>Welcome to ${esc(C.settings.store.name)}</h1><p>Log in to see your orders and check out faster.</p></header>
        <div class="seg" role="tablist"><button type="button" class="seg-btn active" data-tab="login" role="tab">Log in</button><button type="button" class="seg-btn" data-tab="register" role="tab">Create account</button></div>
        <form class="card-pad auth-form" data-form="login" id="f-login">
          <div class="field"><label for="li-login">Mobile number or email</label><input id="li-login" name="login" required autocomplete="username"></div>
          <div class="field"><label for="li-pass">Password</label><input id="li-pass" name="password" type="password" required autocomplete="current-password"></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit">Log in</button>
          <p class="muted small center">Forgot your password? <a href="/help">Contact us</a> and we'll help you reset it.</p>
        </form>
        <form class="card-pad auth-form" data-form="register" id="f-register" hidden>
          <div class="field"><label for="re-name">Full name</label><input id="re-name" name="name" required autocomplete="name"></div>
          <div class="field"><label for="re-phone">Mobile number</label><input id="re-phone" name="phone" type="tel" inputmode="tel" placeholder="01XXXXXXXXX" required autocomplete="tel"></div>
          <div class="field"><label for="re-email">Email <span class="muted">(optional)</span></label><input id="re-email" name="email" type="email" autocomplete="email"></div>
          <div class="field"><label for="re-pass">Password</label><input id="re-pass" name="password" type="password" minlength="6" required autocomplete="new-password"><small class="hint">At least 6 characters.</small></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit">Create account</button>
        </form>
        <p class="center muted">Just want to check an order? <a href="/track">Track it here</a>, no account needed.</p>
      </div>`,
      mount(root) {
        $$('.seg-btn', root).forEach((b) => b.addEventListener('click', () => {
          $$('.seg-btn', root).forEach((x) => x.classList.toggle('active', x === b));
          $('#f-login', root).hidden = b.dataset.tab !== 'login'; $('#f-register', root).hidden = b.dataset.tab !== 'register';
        }));
      },
    };
  }
  const u = S.user, a = u.address || {};
  return {
    name: 'account', title: 'Your account',
    html: `<div class="container account">
      <header class="page-head"><h1>Hi, ${esc(u.name.split(' ')[0])}</h1><p>${esc(u.phone)}${u.email ? ` · ${esc(u.email)}` : ''}</p></header>
      <div class="seg" role="tablist"><button type="button" class="seg-btn active" data-tab="orders">My orders (${S.orders.length})</button><button type="button" class="seg-btn" data-tab="profile">Profile & address</button></div>
      <section data-panel="orders">${S.orders.length ? S.orders.map((o) => `<details class="acc-order"><summary><b>${esc(o.id)}</b><span>${fmtDate(o.created)}</span><span>${plural(o.items.reduce((s, l) => s + l.qty, 0), 'item')}</span><b>${money(o.totals.total)}</b><span class="status-pill st-${o.status}">${esc(ORDER_STATUSES.find(([k]) => k === o.status)?.[1] || o.status)}</span></summary>${orderCardHtml(o)}</details>`).join('') : `<div class="empty">${ic('box', 'empty-ic')}<h2>No orders yet</h2><p>When you place an order while logged in, it shows up here.</p><a class="btn btn-primary" href="/shop">Start shopping</a></div>`}</section>
      <section data-panel="profile" hidden>
        <form class="card-pad" data-form="profile">
          <div class="grid-2"><div class="field"><label for="pf-name">Full name</label><input id="pf-name" name="name" value="${esc(u.name)}" required></div><div class="field"><label for="pf-email">Email</label><input id="pf-email" name="email" type="email" value="${esc(u.email || '')}"></div></div>
          <div class="field"><label for="pf-line">Default address</label><textarea id="pf-line" name="line" rows="2">${esc(a.line || '')}</textarea></div>
          <div class="grid-2"><div class="field"><label for="pf-area">Area / thana</label><input id="pf-area" name="area" value="${esc(a.area || '')}"></div><div class="field"><label for="pf-city">City / district</label><input id="pf-city" name="city" value="${esc(a.city || '')}" list="city-list"><datalist id="city-list">${CITIES.map((c) => `<option value="${c}">`).join('')}</datalist></div></div>
          <div class="row-gap"><button class="btn btn-primary" type="submit">Save changes</button><button type="button" class="btn btn-ghost" data-act="logout">${ic('logout')}Log out</button></div>
        </form>
      </section>
    </div>`,
    mount(root) {
      $$('.seg-btn', root).forEach((b) => b.addEventListener('click', () => {
        $$('.seg-btn', root).forEach((x) => x.classList.toggle('active', x === b));
        $$('[data-panel]', root).forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
      }));
    },
  };
}
const afterLogin = (r, msg) => {
  S.user = r.user; S.orders = r.orders || []; updateBadges(); toast(msg);
  const next = new URLSearchParams(location.search).get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) navigate(next); else render(0);
};
FORMS.login = async (f) => {
  const b = f.querySelector('button[type=submit]'); b.disabled = true;
  try { afterLogin(await api('/api/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(f)) }), 'Welcome back!'); }
  catch (err) { toast(err.message, 'error'); b.disabled = false; }
};
FORMS.register = async (f) => {
  const d = Object.fromEntries(new FormData(f));
  if (!PHONE_RE.test(cleanPhone(d.phone))) { markInvalid(f, 'phone', 'Enter a valid mobile number, e.g. 01712345678'); return; }
  const b = f.querySelector('button[type=submit]'); b.disabled = true;
  try { afterLogin(await api('/api/auth/register', { method: 'POST', body: { ...d, phone: cleanPhone(d.phone) } }), 'Your account is ready!'); }
  catch (err) { toast(err.message, 'error'); if (err.data?.field) markInvalid(f, err.data.field, err.message); b.disabled = false; }
};
FORMS.profile = async (f) => {
  const d = Object.fromEntries(new FormData(f));
  try {
    const r = await api('/api/me', { method: 'PUT', body: { name: d.name, email: d.email, address: { line: d.line, area: d.area, city: d.city, zone: zoneOf(d.city) } } });
    S.user = r.user; updateBadges(); toast('Saved!');
  } catch (err) { toast(err.message, 'error'); }
};

/* ======================================================== gift box builder */
function boxSvg({ wrap = '#F2A7B5', ribbon = '#E3B65C', count = 0, to = '' } = {}) {
  const dark = (hex, k = 0.18) => { const n = parseInt(hex.slice(1), 16); const f = (x) => Math.max(0, Math.round(x * (1 - k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
  return `<svg viewBox="0 0 400 400" class="box-svg" role="img" aria-label="Gift box preview">
    <ellipse cx="200" cy="356" rx="150" ry="16" fill="#000" opacity=".08"/>
    <rect x="80" y="180" width="240" height="170" rx="14" fill="${wrap}"/><rect x="80" y="180" width="240" height="170" rx="14" fill="url(#bshade)"/>
    <rect x="182" y="180" width="36" height="170" fill="${ribbon}"/>
    <rect x="64" y="132" width="272" height="64" rx="12" fill="${wrap}"/><rect x="64" y="132" width="272" height="22" rx="11" fill="#fff" opacity=".22"/><rect x="80" y="194" width="240" height="10" fill="${dark(wrap)}" opacity=".5"/>
    <rect x="178" y="132" width="44" height="64" fill="${ribbon}"/>
    <path d="M200 132C176 94 120 88 128 122C134 146 176 140 200 132ZM200 132C224 94 280 88 272 122C266 146 224 140 200 132Z" fill="${ribbon}"/>
    <path d="M200 132C184 112 150 110 152 124C154 136 180 136 200 132ZM200 132C216 112 250 110 248 124C246 136 220 136 200 132Z" fill="${dark(ribbon, 0.25)}" opacity=".45"/>
    <rect x="186" y="120" width="28" height="24" rx="8" fill="${dark(ribbon, 0.2)}"/>
    <g transform="rotate(10 300 230)"><rect x="262" y="206" width="92" height="46" rx="8" fill="#FFFDF8" stroke="${dark(wrap, 0.1)}" stroke-width="2"/><circle cx="272" cy="229" r="4" fill="${dark(wrap, 0.25)}"/><text x="313" y="234" text-anchor="middle" font-size="12.5" font-family="Fraunces, Georgia, serif" fill="#2a1f28">${to ? 'To ' + esc(to.slice(0, 9)) : 'With love'}</text></g>
    ${count ? `<g><circle cx="94" cy="150" r="24" fill="#23161F"/><text x="94" y="156" text-anchor="middle" font-size="17" font-weight="700" font-family="Plus Jakarta Sans, sans-serif" fill="#fff">${count}</text></g>` : ''}
    <defs><linearGradient id="bshade" x1="0" x2="1"><stop offset=".55" stop-opacity="0"/><stop offset="1" stop-opacity=".16"/></linearGradient></defs>
  </svg>`;
}
function viewBuilder() {
  const B = C.settings.builder;
  if (!B.boxes.length) return viewNotFound('The gift box builder is taking a little break. Please check back soon!');
  const st = ss.get('bliss.builder', null) || { step: 1, boxId: (B.boxes[1] || B.boxes[0]).id, items: [], wrapId: B.wraps[0]?.id, ribbonId: B.ribbons[0]?.id, to: '', from: '', note: '', cat: '' };
  if (!B.boxes.some((b) => b.id === st.boxId)) st.boxId = B.boxes[0].id;
  const pool = C.products.filter((p) => p.boxable && !p.options.length);
  const save = () => ss.set('bliss.builder', st);
  const box = () => B.boxes.find((b) => b.id === st.boxId) || B.boxes[0];
  const wrap = () => B.wraps.find((w) => w.id === st.wrapId) || B.wraps[0] || { name: 'Standard', price: 0, color: '#F2A7B5' };
  const ribbon = () => B.ribbons.find((r) => r.id === st.ribbonId) || B.ribbons[0] || { name: 'Gold', color: '#E3B65C' };
  const price = () => box().price + (wrap().price || 0) + st.items.reduce((s, id) => s + (IDX.byId.get(id)?.price || 0), 0);
  const count = (id) => st.items.filter((x) => x === id).length;
  const cats = [...new Set(pool.map((p) => p.cat))].map((id) => C.catById.get(id)).filter(Boolean);
  const steps = ['Choose a box', 'Fill it up', 'Wrap & ribbon', 'Add a note', 'Review'];
  const stepBody = (i) => {
    if (i === 1) return `<div class="bx-boxes">${B.boxes.map((b) => `<button type="button" class="bx-box${b.id === st.boxId ? ' on' : ''}" data-box="${esc(b.id)}" aria-pressed="${b.id === st.boxId}"><span class="bx-swatch" style="--c:${esc(b.color)}">${ic('gift')}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small><span class="bx-meta">Holds up to ${b.capacity} · <b>${money(b.price)}</b></span></button>`).join('')}</div>`;
    if (i === 2) {
      const list = pool.filter((p) => !st.cat || p.cat === st.cat);
      return `<div class="bx-meter"><div><b>${st.items.length}</b> / ${box().capacity} items</div><div class="bar"><i style="width:${(st.items.length / box().capacity) * 100}%"></i></div></div>
      <div class="chip-row small"><button type="button" class="chip${st.cat ? '' : ' active'}" data-bcat="">All</button>${cats.map((c) => `<button type="button" class="chip${st.cat === c.id ? ' active' : ''}" data-bcat="${c.id}">${esc(c.name)}</button>`).join('')}</div>
      <div class="bx-items">${list.map((p) => { const n = count(p.id), out = p.stock === 'out'; return `<div class="bx-item${n ? ' on' : ''}${out ? ' out' : ''}"><img src="${esc(p.img)}" alt="" width="160" height="200" loading="lazy"><div><b>${esc(p.name)}</b><span>${money(p.price)}${out ? ' · Sold out' : p.stock === 'limited' ? ' · Limited' : ''}</span></div>${out ? '' : `<div class="stepper sm"><button type="button" data-rm="${p.id}" aria-label="Remove one" ${n ? '' : 'disabled'}>${ic('minus')}</button><span>${n}</span><button type="button" data-add="${p.id}" aria-label="Add one">${ic('plus')}</button></div>`}</div>`; }).join('')}</div>`;
    }
    if (i === 3) return `<h3 class="h4">Wrapping paper</h3><div class="swatches">${B.wraps.map((w) => `<button type="button" class="swatch${w.id === st.wrapId ? ' on' : ''}" data-wrap="${esc(w.id)}" aria-pressed="${w.id === st.wrapId}"><span style="background:${esc(w.color)}"></span><b>${esc(w.name)}</b><small>${w.price ? '+' + money(w.price) : 'Free'}</small></button>`).join('')}</div>
      <h3 class="h4">Ribbon</h3><div class="ribbons">${B.ribbons.map((r) => `<button type="button" class="ribbon${r.id === st.ribbonId ? ' on' : ''}" data-ribbon="${esc(r.id)}" aria-pressed="${r.id === st.ribbonId}" title="${esc(r.name)}"><span style="background:${esc(r.color)}"></span>${esc(r.name)}</button>`).join('')}</div>`;
    if (i === 4) return `<div class="grid-2"><div class="field"><label for="bx-to">To</label><input id="bx-to" data-f="to" maxlength="60" value="${esc(st.to)}" placeholder="Their name"></div><div class="field"><label for="bx-from">From</label><input id="bx-from" data-f="from" maxlength="60" value="${esc(st.from)}" placeholder="Your name"></div></div>
      <div class="field"><label for="bx-note">Your message (handwritten on a card)</label><textarea id="bx-note" data-f="note" rows="4" maxlength="300" placeholder="Write something from the heart…">${esc(st.note)}</textarea></div>`;
    return `<ul class="bx-review">
      <li><span>${esc(box().name)}</span><b>${money(box().price)}</b></li>
      ${[...new Set(st.items)].map((id) => { const p = IDX.byId.get(id); return p ? `<li><span>${count(id)} × ${esc(p.name)}</span><b>${money(p.price * count(id))}</b></li>` : ''; }).join('')}
      <li><span>${esc(wrap().name)} wrap · ${esc(ribbon().name)} ribbon</span><b>${wrap().price ? money(wrap().price) : 'Free'}</b></li>
      <li><span>Handwritten card${st.to ? ` to ${esc(st.to)}` : ''}</span><b>Free</b></li>
      <li class="total"><span>Box total</span><b>${money(price())}</b></li></ul>
      ${st.items.length ? '' : `<p class="notice warn">${ic('info')}Your box is empty. Go back to step 2 to add some gifts.</p>`}
      <button type="button" class="btn btn-primary btn-lg btn-block" id="bx-add" ${st.items.length ? '' : 'disabled'}>${ic('bag')}Add box to bag · ${money(price())}</button>`;
  };
  const draw = () => `
    <div class="container builder">
      <header class="page-head"><span class="eyebrow">${ic('gift')}Gift Box Builder</span><h1>Build a box that's all them</h1><p>Mix jewellery, treats and keepsakes in a box wrapped your way.</p></header>
      <div class="bx-layout">
        <div class="bx-steps">${steps.map((name, k) => { const i = k + 1; return `<section class="bx-step${st.step === i ? ' open' : ''}${st.step > i ? ' done' : ''}"><button type="button" class="bx-head" data-step="${i}" aria-expanded="${st.step === i}"><span class="bx-num">${st.step > i ? ic('check') : i}</span><b>${name}</b><small>${i === 1 ? esc(box().name) : i === 2 ? plural(st.items.length, 'item') : i === 3 ? `${esc(wrap().name)}, ${esc(ribbon().name)}` : i === 4 ? (st.note ? 'Message added' : 'Optional') : ''}</small>${ic('chev-down', 'bx-chev')}</button>${st.step === i ? `<div class="bx-body">${stepBody(i)}${i < 5 ? `<div class="bx-nav">${i > 1 ? `<button type="button" class="btn btn-ghost" data-step="${i - 1}">Back</button>` : '<span></span>'}<button type="button" class="btn btn-dark" data-step="${i + 1}">Continue ${ic('arrow-right')}</button></div>` : ''}</div>` : ''}</section>`; }).join('')}</div>
        <aside class="bx-preview"><div class="bx-stage">${boxSvg({ wrap: wrap().color, ribbon: ribbon().color, count: st.items.length, to: st.to })}</div><div class="bx-total"><span>${esc(box().name)} · ${plural(st.items.length, 'item')}</span><b>${money(price())}</b></div><p class="muted small">Every box is hand-packed in Dhaka with tissue, filler and your card.</p></aside>
      </div>
    </div>`;
  return {
    name: 'builder', title: 'Build your own gift box', html: draw(),
    mount(root) {
      const redraw = (keepScroll = true) => { const y = scrollY; root.innerHTML = draw(); save(); if (keepScroll) window.scrollTo(0, y); };
      root.addEventListener('click', (e) => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.dataset.step) { st.step = Math.max(1, Math.min(5, +t.dataset.step)); redraw(); root.querySelector('.bx-step.open')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        if (t.dataset.box) { st.boxId = t.dataset.box; if (st.items.length > box().capacity) { st.items = st.items.slice(0, box().capacity); toast(`The ${box().name} holds ${box().capacity} items, so we removed the extras.`, 'error'); } redraw(); return; }
        if (t.dataset.bcat !== undefined) { st.cat = t.dataset.bcat; redraw(); return; }
        if (t.dataset.add) {
          const p = IDX.byId.get(t.dataset.add);
          if (st.items.length >= box().capacity) { toast(`Your ${box().name} is full. Choose a bigger box for more.`, 'error'); return; }
          if (p.left != null && count(p.id) + inCartQty(p.id) >= p.left) { toast(`Only ${p.left} of these left.`, 'error'); return; }
          st.items.push(p.id); redraw(); return;
        }
        if (t.dataset.rm) { const i = st.items.lastIndexOf(t.dataset.rm); if (i >= 0) st.items.splice(i, 1); redraw(); return; }
        if (t.dataset.wrap) { st.wrapId = t.dataset.wrap; redraw(); return; }
        if (t.dataset.ribbon) { st.ribbonId = t.dataset.ribbon; redraw(); return; }
        if (t.id === 'bx-add') {
          const line = { key: 'box|' + Date.now().toString(36), kind: 'box', boxId: st.boxId, wrapId: st.wrapId, ribbonId: st.ribbonId, items: [...st.items], to: st.to, from: st.from, note: st.note, qty: 1 };
          S.cart.push(line); saveCart(); bumpBag();
          ss.del('bliss.builder');
          toast('Your custom gift box is in the bag!', 'ok', { label: 'Checkout', act: 'go', href: '/checkout' });
          openCart();
          setTimeout(() => render(0), 300);
        }
      });
      root.addEventListener('input', (e) => {
        const k = e.target.dataset.f; if (!k) return;
        st[k] = e.target.value; save();
        if (k === 'to') { const stage = $('.bx-stage', root); if (stage) stage.innerHTML = boxSvg({ wrap: wrap().color, ribbon: ribbon().color, count: st.items.length, to: st.to }); }
      });
    },
  };
}

/* ================================================== content & info pages */
FORMS.contact = async (f) => {
  const d = Object.fromEntries(new FormData(f));
  if (d.phone && !PHONE_RE.test(cleanPhone(d.phone)) && !d.email) { markInvalid(f, 'phone', 'Enter a valid mobile number or an email'); return; }
  const b = f.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Sending…';
  try {
    await api('/api/contact', { method: 'POST', body: { ...d, phone: cleanPhone(d.phone) } });
    f.innerHTML = `<div class="notice ok big">${ic('check')}<div><b>Thank you, ${esc(d.name.split(' ')[0])}!</b><p>${d.type === 'corporate' ? 'Our corporate gifting team will send you a proposal within one working day.' : 'We have your message and will reply within a few hours (10am to 10pm).'}</p></div></div>`;
  } catch (err) { toast(err.message, 'error'); if (err.data?.field) markInvalid(f, err.data.field, err.message); b.disabled = false; b.textContent = 'Send message'; }
};
FORMS.newsletter = async (f) => {
  const email = f.elements.email.value.trim();
  const b = f.querySelector('button'); b.disabled = true;
  try {
    const r = await api('/api/subscribe', { method: 'POST', body: { email } });
    f.outerHTML = `<div class="news-done">${ic('check')}<span>You're in! ${r.coupon ? `Use code <button type="button" class="code" data-act="copy" data-text="${esc(r.coupon)}">${esc(r.coupon)}</button> for your first order.` : 'Watch your inbox for gift ideas.'}</span></div>`;
  } catch (err) { toast(err.message, 'error'); b.disabled = false; }
};
const contactFormHtml = (type = 'support') => `<form class="card-pad contact-form" data-form="contact" novalidate><input type="hidden" name="type" value="${type}">
  ${type === 'corporate' ? `<div class="grid-2"><div class="field"><label for="cf-company">Company</label><input id="cf-company" name="company" maxlength="120" required></div><div class="field"><label for="cf-name">Your name *</label><input id="cf-name" name="name" required maxlength="80" autocomplete="name"></div></div>` : `<div class="field"><label for="cf-name">Your name *</label><input id="cf-name" name="name" required maxlength="80" autocomplete="name"></div>`}
  <div class="grid-2"><div class="field"><label for="cf-phone">Mobile number *</label><input id="cf-phone" name="phone" type="tel" inputmode="tel" placeholder="01XXXXXXXXX" autocomplete="tel"></div><div class="field"><label for="cf-email">Email</label><input id="cf-email" name="email" type="email" autocomplete="email"></div></div>
  ${type === 'corporate' ? `<div class="grid-3"><div class="field"><label for="cf-qty">How many gifts?</label><input id="cf-qty" name="quantity" type="number" min="10" placeholder="e.g. 50"></div><div class="field"><label for="cf-budget">Budget per gift</label><select id="cf-budget" name="budget"><option>Under ৳1,000</option><option selected>৳1,000 – ৳2,000</option><option>৳2,000 – ৳3,500</option><option>৳3,500+</option></select></div><div class="field"><label for="cf-date">Needed by</label><input id="cf-date" name="date" type="date"></div></div>` : `<div class="field"><label for="cf-subject">Subject</label><select id="cf-subject" name="subject"><option>Question about an order</option><option>Product question</option><option>Delivery</option><option>Returns & exchanges</option><option>Something else</option></select></div>`}
  <div class="field"><label for="cf-msg">${type === 'corporate' ? 'Tell us about your gifting plans' : 'Message *'}</label><textarea id="cf-msg" name="message" rows="4" maxlength="3000" ${type === 'corporate' ? 'placeholder="Occasion, branding needs, delivery locations…"' : 'required'}></textarea></div>
  <button class="btn btn-primary btn-lg" type="submit">${type === 'corporate' ? 'Request a quote' : 'Send message'}</button></form>`;

function viewCorporate() {
  return {
    name: 'corporate', title: 'Corporate & bulk gifting',
    html: `<div class="container">
      <section class="corp-hero"><div><span class="eyebrow">${ic('briefcase')}Corporate & bulk gifting</span><h1>Gifts that make your <em>brand</em> unforgettable</h1><p>From Eid hampers for 500 employees to welcome kits for new joiners, we curate, brand, pack and deliver, so you don't have to.</p><a class="btn btn-primary btn-lg" href="#quote">Get a free quote ${ic('arrow-right')}</a></div><img src="/img/c/gift-boxes.svg" alt="" width="800" height="800"></section>
      <section class="sec feature-grid">
        <div>${ic('sparkle')}<h3>Custom branding</h3><p>Your logo on boxes, ribbons, cards and even the products.</p></div>
        <div>${ic('tag')}<h3>Bulk pricing</h3><p>Tiered discounts from 10 gifts, with clear quotes and no surprises.</p></div>
        <div>${ic('truck')}<h3>Delivered anywhere</h3><p>To one office or 64 districts, with doorstep delivery to each recipient.</p></div>
        <div>${ic('user')}<h3>Dedicated manager</h3><p>One person who handles everything from samples to final delivery.</p></div>
      </section>
      <section class="sec">${secHead('Simple, transparent pricing', '')}
        <div class="tier-cards"><div class="tcard"><span>10 – 49 gifts</span><b>5% off</b><p>Branded gift card included</p></div><div class="tcard hl"><span>50 – 199 gifts</span><b>10% off</b><p>Free logo ribbon + card</p></div><div class="tcard"><span>200+ gifts</span><b>15% off</b><p>Fully custom boxes & priority delivery</p></div></div>
      </section>
      <section class="sec quote-sec" id="quote"><div><h2>Request a quote</h2><p>Tell us what you have in mind. We reply within one working day with ideas and pricing.</p><ul class="ticks"><li>${ic('check')}Free samples for orders over 100 gifts</li><li>${ic('check')}Invoice & VAT challan available</li><li>${ic('check')}Payment by bank transfer, bKash or cheque</li></ul></div>${contactFormHtml('corporate')}</section>
    </div>`,
  };
}
const FAQ = () => {
  const d = C.settings.delivery;
  return [
    ['Orders & delivery', [
      ['How long does delivery take?', `Inside Dhaka: 1–2 days. Outside Dhaka: 2–4 days through our courier partners. With Bliss Express, gifts arrive within ${d.expressHours} hours in ${d.expressAreas} when you order before ${d.cutoffHour > 12 ? d.cutoffHour - 12 + 'pm' : d.cutoffHour + 'am'}.`],
      ['How much is delivery?', `${money(d.inside)} inside Dhaka, ${money(d.outside)} outside Dhaka and ${money(d.express)} for Bliss Express.${d.freeOver ? ` Standard delivery is free on orders over ${money(d.freeOver)}.` : ''}`],
      ['Can I send a gift directly to someone?', 'Yes! At checkout, turn on “Send directly to someone else”, add their name and number, and tick “Hide prices” so the surprise stays special.'],
      ['Can I choose the delivery date?', 'Yes. Pick a preferred date and time of day at checkout, perfect for birthdays and anniversaries.'],
      ['How do I track my order?', 'Use the Track order page with your order ID and mobile number. We also call you before delivery.'],
    ]],
    ['Payments', [
      ['Which payment methods do you accept?', 'Cash on delivery, bKash and Nagad. For bKash or Nagad, send the amount to our number and enter the Transaction ID at checkout.'],
      ['Is cash on delivery available everywhere?', 'Yes, in all 64 districts.'],
    ]],
    ['Gift options', [
      ['Do you include a card?', 'Every order can include a free handwritten message card. Just write your message at checkout.'],
      ['Do you gift wrap?', `Yes. Premium gift wrap is ${money(C.settings.giftWrapPrice)} per order. Our ready-to-gift boxes already come beautifully packed.`],
      ['What is Mix & Match?', `Buy more, save more: ${C.settings.bundleTiers.map((t) => `${t.min}${t === C.settings.bundleTiers.at(-1) ? '+' : ''} items save ${t.pct}%`).join(', ')}. It applies automatically in your bag (it does not combine with coupons; you get whichever saves more).`],
    ]],
    ['Returns & care', [
      ['What is your return policy?', 'Unused items in original packaging can be exchanged within 7 days. If anything arrives damaged, tell us within 24 hours and we will replace it free. Chocolates, treats and personalised items cannot be returned.'],
      ['Can I change or cancel my order?', 'Yes, as long as it has not been shipped. Call or WhatsApp us with your order ID.'],
    ]],
  ];
};
function viewHelp() {
  const st = C.settings.store;
  return {
    name: 'help', title: 'Help & support',
    html: `<div class="container">
      <header class="page-head center"><span class="eyebrow">${ic('help')}Help centre</span><h1>How can we help?</h1><p>Answers to common questions, or reach us directly. We usually reply within a few hours.</p></header>
      <div class="contact-cards">
        <a class="ccard" href="tel:${esc(st.phone.replace(/[^+\d]/g, ''))}">${ic('phone')}<b>Call us</b><span>${esc(st.phone)}</span></a>
        ${st.whatsapp ? `<a class="ccard" href="https://wa.me/${esc(st.whatsapp)}" target="_blank" rel="noopener">${ic('whatsapp')}<b>WhatsApp</b><span>Chat with us</span></a>` : ''}
        <a class="ccard" href="mailto:${esc(st.email)}">${ic('mail')}<b>Email</b><span>${esc(st.email)}</span></a>
        <a class="ccard" href="/track">${ic('truck')}<b>Track order</b><span>Live status</span></a>
      </div>
      <div class="help-layout">
        <div class="faq">${FAQ().map(([group, qs]) => `<h2 class="h3">${group}</h2>${qs.map(([q, a]) => `<details class="faq-item"><summary>${esc(q)}${ic('plus')}</summary><p>${esc(a)}</p></details>`).join('')}`).join('')}</div>
        <aside><h2 class="h3">Send us a message</h2>${contactFormHtml('support')}<p class="muted small">${ic('clock')} ${esc(st.hours)}</p></aside>
      </div>
    </div>`,
  };
}
function viewAbout() {
  const st = C.settings.stats;
  return {
    name: 'about', title: 'Our story',
    html: `<div class="container narrow-wide about">
      <header class="page-head center"><span class="eyebrow">${ic('heart')}Our story</span><h1>We believe every gift should feel like a <em>hug</em></h1></header>
      <div class="about-hero"><img src="/img/hero.svg" alt="" width="1000" height="800"></div>
      <div class="prose">
        <p>${esc(C.settings.store.name)} began with a simple frustration: finding a gift that felt personal, looked beautiful and actually arrived on time was far too hard in Bangladesh.</p>
        <p>So we built the gift shop we always wanted. Every piece is handpicked, quality-checked and packed by our small team in Dhaka with tissue, ribbon and a handwritten card. Whether it's a last-minute birthday surprise delivered within hours, a custom box built around someone's favourite things, or 500 Eid hampers for a whole company, we treat every order like it's going to someone we love.</p>
      </div>
      <div class="stat-row"><div><b>${esc(st.customers)}</b><span>happy gifters</span></div><div><b>${esc(st.delivered)}</b><span>gifts delivered</span></div><div><b>${esc(st.rating)}★</b><span>average rating</span></div><div><b>64</b><span>districts served</span></div></div>
      <div class="feature-grid">
        <div>${ic('gift')}<h3>Thoughtfully curated</h3><p>We say no to far more products than we say yes to.</p></div>
        <div>${ic('heart')}<h3>Packed with love</h3><p>Every box is wrapped by hand, never by a machine.</p></div>
        <div>${ic('bolt')}<h3>On time, every time</h3><p>Express delivery for the moments that can't wait.</p></div>
      </div>
      <div class="center row-gap"><a class="btn btn-primary btn-lg" href="/shop">Shop our gifts</a><a class="btn btn-ghost btn-lg" href="/gift-box-builder">Build a gift box</a></div>
    </div>`,
  };
}
const POLICIES = {
  shipping: ['Shipping & delivery', () => { const d = C.settings.delivery; return `<p>We deliver to all 64 districts of Bangladesh.</p><h3>Delivery charges</h3><ul><li>Inside Dhaka: ${money(d.inside)} (1–2 days)</li><li>Outside Dhaka: ${money(d.outside)} (2–4 days)</li><li>Bliss Express (${esc(d.expressAreas)}): ${money(d.express)}, within ${esc(d.expressHours)} hours for orders confirmed before ${d.cutoffHour > 12 ? d.cutoffHour - 12 + 'pm' : d.cutoffHour + 'am'}</li>${d.freeOver ? `<li>Free standard delivery on orders over ${money(d.freeOver)}</li>` : ''}</ul><h3>Scheduling</h3><p>You can choose a preferred date and time of day at checkout. We do our best to meet it and will call you if anything changes.</p><h3>Failed deliveries</h3><p>If the recipient can't be reached after two attempts, we'll contact you to rearrange. A second delivery charge may apply.</p>`; }],
  returns: ['Returns & exchanges', () => '<p>We want you to love every gift.</p><h3>Exchanges</h3><p>Unused items in their original packaging can be exchanged within 7 days of delivery. Contact us with your order ID to arrange a pickup.</p><h3>Damaged or wrong items</h3><p>If something arrives damaged or isn\'t what you ordered, tell us within 24 hours with a photo and we\'ll replace it free of charge.</p><h3>Non-returnable items</h3><p>For hygiene and freshness, chocolates, treats, flowers, earrings and personalised or engraved items can\'t be returned unless they arrive damaged.</p><h3>Refunds</h3><p>Approved refunds are sent to your bKash or Nagad account within 5–7 working days.</p>'],
  privacy: ['Privacy policy', () => '<p>We only collect what we need to deliver your gifts: your name, mobile number, email (optional) and delivery address.</p><h3>How we use it</h3><ul><li>To process, deliver and support your orders</li><li>To send offers, only if you subscribe (you can unsubscribe anytime)</li></ul><h3>What we never do</h3><p>We never sell or rent your personal information. We share delivery details only with our courier partners, and only for delivering your order.</p><h3>Cookies</h3><p>We use essential cookies to keep you logged in, and your browser stores your bag and wishlist on your device. We do not use advertising trackers.</p>'],
  terms: ['Terms of service', () => '<p>By placing an order you agree to these terms.</p><h3>Orders</h3><p>All orders are confirmed by phone. We may cancel an order if an item becomes unavailable or the delivery details can\'t be verified, and will refund any payment made.</p><h3>Prices</h3><p>Prices are in Bangladeshi Taka (৳) and include VAT where applicable. Delivery charges are shown at checkout.</p><h3>Product images</h3><p>We photograph our products carefully, but colours may vary slightly between screens.</p><h3>Contact</h3><p>Questions? <a href="/help">Get in touch</a>.</p>'],
};
function viewPolicy(slug) {
  const p = POLICIES[slug]; if (!p) return viewNotFound();
  return {
    name: 'policy', title: p[0],
    html: `<div class="container policy">
      <nav class="policy-nav">${Object.entries(POLICIES).map(([k, [t]]) => `<a href="/policies/${k}" class="${k === slug ? 'active' : ''}">${t}</a>`).join('')}</nav>
      <article class="prose"><h1>${p[0]}</h1>${p[1]()}<p class="muted small">Last updated ${fmtDate(Date.now(), { month: 'long', year: 'numeric' })}</p></article>
    </div>`,
  };
}
function viewNotFound(msg = 'The page you are looking for has moved or never existed.') {
  return {
    name: '404', title: 'Page not found',
    html: `<div class="container narrow"><div class="empty big">${ic('gift', 'empty-ic')}<h1>Oops, this gift got lost</h1><p>${esc(msg)}</p><div class="row-gap"><a class="btn btn-primary btn-lg" href="/shop">Browse gifts</a><button type="button" class="btn btn-ghost btn-lg" data-act="open-search">${ic('search')}Search</button></div></div>
    <section class="sec">${secHead('Popular right now', '')}${gridHtml(IDX.query({ sort: 'popular', s: ['in', 'limited'], size: 4 }).items)}</section></div>`,
  };
}

/* ================================================================ search */
function highlight(name, q) {
  const toks = tokenize(q).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const safe = esc(name);
  return toks.length ? safe.replace(new RegExp(`\\b(${toks.join('|')})`, 'gi'), '<mark>$1</mark>') : safe;
}
function openSearch(initial = '') {
  const recent = ls.get('bliss.searches', []);
  const popular = ['Gift box', 'Rings', 'Watch for him', 'Chocolates', 'Forever rose', 'Eid'];
  const el = openLayer('search', `
    <div class="search-top"><div class="container"><form class="search-form" data-form="search" role="search">${ic('search')}<input id="sq" name="q" type="search" placeholder="Search rings, gift boxes, watches…" autocomplete="off" autofocus value="${esc(initial)}" aria-label="Search gifts" aria-controls="sres" enterkeyhint="search"><button type="button" class="ibtn" data-act="close-layer" aria-label="Close search">${ic('close')}</button></form></div></div>
    <div class="search-body"><div class="container" id="sres"></div></div>`, { label: 'Search' });
  const input = $('#sq', el), body = $('#sres', el);
  let active = -1;
  const draw = () => {
    const q = input.value.trim(); active = -1;
    if (!q) {
      body.innerHTML = `${recent.length ? `<div class="s-group"><h3>Recent searches</h3><div class="chips">${recent.map((r) => `<a class="chip" href="/search?q=${encodeURIComponent(r)}">${ic('clock')}${esc(r)}</a>`).join('')}</div></div>` : ''}
        <div class="s-group"><h3>Popular searches</h3><div class="chips">${popular.map((r) => `<a class="chip" href="/search?q=${encodeURIComponent(r)}">${ic('trend')}${esc(r)}</a>`).join('')}</div></div>
        <div class="s-group"><h3>Shop by category</h3><div class="s-cats">${C.categories.map((c) => `<a href="/category/${c.slug}"><img src="${esc(c.image)}" alt="" width="64" height="64" loading="lazy"><span>${esc(c.name)}</span></a>`).join('')}</div></div>`;
      return;
    }
    const r = IDX.suggest(q, 6);
    const toks = tokenize(q), lastRaw = q.split(/\s+/).slice(0, -1).join(' ');
    body.innerHTML = `${r.suggestion ? `<p class="did-you-mean">${ic('wand')} Showing results for <b>${esc(r.suggestion)}</b></p>` : ''}
      ${r.words.length && toks.length ? `<div class="chips s-words">${r.words.map((w) => `<a class="chip" data-sr href="/search?q=${encodeURIComponent((lastRaw ? lastRaw + ' ' : '') + w)}">${ic('search')}${esc((lastRaw ? lastRaw + ' ' : '') + w)}</a>`).join('')}</div>` : ''}
      ${r.cats.length ? `<div class="s-group"><h3>Categories</h3><div class="chips">${r.cats.map((c) => `<a class="chip" data-sr href="/category/${c.slug}"><img src="${esc(c.image)}" alt="" width="24" height="24">${esc(c.name)}</a>`).join('')}</div></div>` : ''}
      ${r.products.length ? `<div class="s-group"><h3>Gifts</h3><ul class="s-products">${r.products.map((p) => `<li><a data-sr href="/product/${p.slug}"><img src="${esc(p.img)}" alt="" width="64" height="80"><span><b>${highlight(p.name, r.suggestion || q)}</b><small>${esc(C.catById.get(p.cat)?.name || '')}</small></span>${priceHtml(p)}${p.stock !== 'in' ? stockHtml(p) : ''}</a></li>`).join('')}</ul><a class="btn btn-soft btn-block" data-sr href="/search?q=${encodeURIComponent(q)}">See all ${plural(r.total, 'result')} for “${esc(q)}”</a></div>`
      : `<div class="empty small">${ic('search', 'empty-ic')}<p>No gifts match “${esc(q)}”. Try another word, or browse a category.</p></div>`}`;
  };
  input.addEventListener('input', draw); // engine answers in microseconds, no debounce needed
  input.addEventListener('keydown', (e) => {
    const items = $$('[data-sr]', body);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((x, i) => x.classList.toggle('kb', i === active)); items[active].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active >= 0 && items[active]) { e.preventDefault(); items[active].click(); }
  });
  draw();
}
FORMS.search = (f) => {
  const q = f.elements.q.value.trim(); if (!q) return;
  ls.set('bliss.searches', [q, ...ls.get('bliss.searches', []).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6));
  navigate('/search?q=' + encodeURIComponent(q));
};

/* ============================================================ mobile menu */
function openMenu() {
  const st = C.settings.store;
  openLayer('drawer left', `<div class="drawer-in menu">
    <header class="drawer-head"><a href="/" class="logo">${logoMark()}<span>${esc(st.name)}</span></a><button type="button" class="ibtn" data-act="close-layer" aria-label="Close menu">${ic('close')}</button></header>
    <div class="drawer-body">
      <nav class="menu-main"><a href="/shop">${ic('grid')}Shop all gifts</a><a href="/gift-box-builder">${ic('gift')}Build a gift box</a><a href="/category/gift-boxes">${ic('box')}Ready-to-gift boxes</a><a href="/offers">${ic('tag')}Offers</a><a href="/corporate">${ic('briefcase')}Corporate & bulk</a></nav>
      <h3 class="menu-h">Categories</h3>
      <nav class="menu-cats">${C.categories.map((c) => `<a href="/category/${c.slug}"><img src="${esc(c.image)}" alt="" width="40" height="40" loading="lazy">${esc(c.name)}</a>`).join('')}</nav>
      <h3 class="menu-h">Occasions</h3>
      <div class="chips">${OCCASIONS.map(([k, l, i]) => `<a class="chip" href="/occasion/${k}">${ic(i)}${l}</a>`).join('')}</div>
      <nav class="menu-main sub"><a href="/account">${ic('user')}${S.user ? 'My account' : 'Log in / Sign up'}</a><a href="/track">${ic('truck')}Track order</a><a href="/help">${ic('help')}Help & FAQ</a></nav>
    </div></div>`, { label: 'Menu' });
}

/* =================================================== catalogue freshness */
let lastRefresh = Date.now();
async function refreshCatalog(force = false) {
  if (!force && Date.now() - lastRefresh < 5 * 60_000) return;
  lastRefresh = Date.now();
  try {
    const res = await fetch('/api/catalog', { credentials: 'same-origin' });
    if (!res.ok) return;
    const c = await res.json();
    if (c.v === C.v) return;
    setCatalog(c); detailCache.clear();
    if (['home', 'shop', 'wishlist'].includes(current?.name) && !layer.el) render(scrollY);
    else if (layer.type === 'drawer') renderCartDrawer();
  } catch { /* offline: keep what we have */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCatalog(); });
// Keep bag & wishlist in sync across open tabs.
addEventListener('storage', (e) => {
  if (e.key === 'bliss.cart') { S.cart = ls.get('bliss.cart', []); updateBadges(); refreshCartViews(); }
  else if (e.key === 'bliss.wish') { S.wish = new Set(ls.get('bliss.wish', [])); updateBadges(); }
});

/* =================================================================== go */
hydrateShell();
render(history.state?.y || 0);
loadMe();
