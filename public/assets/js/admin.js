// BLISS admin dashboard: products & stock, orders, customers, marketing and store settings.
import { CatalogIndex, money, escapeHtml as esc, ORDER_STATUSES, slugify, CHANNELS, computeTotals, SHEET_FIELDS, sheetKey } from './engine.js';

/* ================================================================ helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ic = (n, c = '') => `<svg class="i${c ? ' ' + c : ''}" aria-hidden="true"><use href="#i-${n}"></use></svg>`;
const app = $('#app');
const A = { me: null, products: [], categories: [], lowDefault: 5, settings: null, dirty: false, lastHash: location.hash, counts: {} };
const STATUS = Object.fromEntries(ORDER_STATUSES);
const STOCK = { in: ['In stock', 'check-circle', 'In'], limited: ['Limited stock', 'alert', 'Limited'], out: ['Out of stock', 'x-circle', 'Out'] };
const STATUS_COLOR = { in: '#0ca30c', limited: '#fab219', out: '#d03b3b' }; // fixed status palette (always paired with icon + label)
const OCCASIONS = [['birthday', 'Birthday'], ['anniversary', 'Anniversary'], ['wedding', 'Wedding'], ['eid', 'Eid'], ['valentines', "Valentine's"], ['mothers-day', "Mother's Day"], ['graduation', 'Graduation'], ['new-baby', 'New baby'], ['just-because', 'Just because'], ['corporate', 'Corporate'], ['ready-to-gift', 'Ready to gift']];
const PAYMENT = { cod: 'Cash on delivery', bkash: 'bKash', nagad: 'Nagad' };
const NEXT = { pending: ['confirmed', 'Confirm order'], confirmed: ['processing', 'Start packing'], processing: ['shipped', 'Hand to courier'], shipped: ['delivered', 'Mark delivered'], cancelled: ['pending', 'Restore order'], returned: ['pending', 'Restore order'] };
const COURIERS = ['Pathao', 'Steadfast', 'RedX', 'Paperfly', 'eCourier', 'Sundarban', 'SA Paribahan', 'Own rider', 'Other'];
const chName = (c) => CHANNELS[c] || (c ? c[0].toUpperCase() + c.slice(1) : 'Direct');
const pctFmt = (n, d = 0) => (n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(d)}%`);
const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');
/** "+12% vs previous period" badge. `good` = 'up' when a rise is good news. */
function delta(cur, prev, good = 'up') {
  if (!prev && !cur) return '<span class="delta flat">no change</span>';
  if (!prev) return '<span class="delta flat">new</span>';
  const d = (cur - prev) / Math.abs(prev);
  if (Math.abs(d) < 0.005) return '<span class="delta flat">no change</span>';
  const up = d > 0, ok = (up && good === 'up') || (!up && good === 'down');
  return `<span class="delta ${ok ? 'good' : 'bad'}" title="Previous period: ${typeof prev === 'number' && prev > 100 ? money(prev) : prev}">${ic(up ? 'arrow-up' : 'arrow-down')}${Math.abs(d * 100).toFixed(Math.abs(d) < 0.1 ? 1 : 0)}%</span>`;
}
/* Date ranges (Dhaka calendar). */
const dhakaISO = (ts = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
const isoAdd = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['90d', '90 days'], ['year', 'This year']];
function rangeDates(key, custom = {}) {
  const t = dhakaISO();
  if (key === 'today') return { from: t, to: t };
  if (key === '7d') return { from: isoAdd(t, -6), to: t };
  if (key === '90d') return { from: isoAdd(t, -89), to: t };
  if (key === 'month') return { from: t.slice(0, 8) + '01', to: t };
  if (key === 'lastmonth') { const end = isoAdd(t.slice(0, 8) + '01', -1); return { from: end.slice(0, 8) + '01', to: end }; }
  if (key === 'year') return { from: t.slice(0, 5) + '01-01', to: t };
  if (key === 'custom' && custom.from && custom.to) return { from: custom.from, to: custom.to };
  return { from: isoAdd(t, -29), to: t };
}
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
A.range = store.get('bliss.admin.range', { key: '30d' });
/** Range picker; calls onChange({from,to}) and remembers the choice. */
function rangePicker(host, onChange) {
  const draw = () => {
    const r = rangeDates(A.range.key, A.range);
    host.innerHTML = `<div class="range"><div class="seg-sm range-seg" role="group" aria-label="Date range">${RANGES.map(([k, l]) => `<button type="button" data-r="${k}" class="${A.range.key === k ? 'on' : ''}">${l}</button>`).join('')}<button type="button" data-r="custom" class="${A.range.key === 'custom' ? 'on' : ''}">${ic('calendar')}Custom</button></div>
      <div class="range-custom" ${A.range.key === 'custom' ? '' : 'hidden'}><input type="date" id="rg-from" value="${r.from}" max="${dhakaISO()}" aria-label="From"><span>to</span><input type="date" id="rg-to" value="${r.to}" max="${dhakaISO()}" aria-label="To"></div></div>`;
  };
  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    A.range = { ...A.range, key: b.dataset.r };
    if (b.dataset.r === 'custom' && !A.range.from) Object.assign(A.range, rangeDates('30d'));
    store.set('bliss.admin.range', A.range); draw(); onChange(rangeDates(A.range.key, A.range));
  });
  host.addEventListener('change', (e) => {
    if (!['rg-from', 'rg-to'].includes(e.target.id)) return;
    const from = $('#rg-from', host).value, to = $('#rg-to', host).value;
    if (!from || !to) return;
    A.range = { key: 'custom', from, to }; store.set('bliss.admin.range', A.range); onChange(rangeDates('custom', A.range));
  });
  draw();
  return rangeDates(A.range.key, A.range);
}
const rangeLabel = (r) => (r.from === r.to ? fmtDate(r.from + 'T06:00:00Z') : `${fmtDate(r.from + 'T06:00:00Z')} – ${fmtDate(r.to + 'T06:00:00Z')}`);
/** Horizontal bar list: rows of [label, value, sub] — value drives the bar length. */
function barList(rows, fmt = money, { empty = 'No data for this period yet.' } = {}) {
  if (!rows.length) return `<p class="muted small">${empty}</p>`;
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `<ul class="bars">${rows.map(([label, v, sub]) => `<li><div class="bar-top"><span>${label}</span><b>${fmt(v)}</b></div><div class="bar-track"><i style="width:${Math.max(2, (v / max) * 100)}%"></i></div>${sub ? `<small>${sub}</small>` : ''}</li>`).join('')}</ul>`;
}
const phoneLinks = (p) => `<span class="inline"><a href="tel:${esc(p)}">${esc(p)}</a><a class="wa" href="https://wa.me/88${esc(p)}" target="_blank" rel="noopener" title="WhatsApp ${esc(p)}">${ic('whatsapp')}</a></span>`;
const SEGMENTS = { vip: ['VIP', 'seg-vip'], repeat: ['Repeat', 'seg-repeat'], new: ['New', 'seg-new'], lapsed: ['Lapsed', 'seg-lapsed'], risk: ['Risky', 'seg-risk'], blocked: ['Blocked', 'seg-blocked'], lead: ['No orders yet', 'seg-lead'] };
const segPill = (s) => `<span class="pill ${SEGMENTS[s]?.[1] || ''}">${SEGMENTS[s]?.[0] || esc(s)}</span>`;
const fmtDate = (ts) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }).format(new Date(ts));
const fmtDT = (ts) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' }).format(new Date(ts));
const ago = (ts) => { const s = (Date.now() - ts) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 604800) return `${Math.floor(s / 86400)}d ago`; return fmtDate(ts); };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const statusPill = (s) => `<span class="pill st-${s}">${esc(STATUS[s] || s)}</span>`;
const stockPill = (s) => `<span class="pill sk-${s}">${ic(STOCK[s][1])}${STOCK[s][0]}</span>`;
// The BLISS logo (public/img/brand): black on light backgrounds, white on the dark sidebar.
const logoImg = (light = false) => `<img class="logo-img" src="/img/brand/bliss-logo${light ? '-white' : ''}.svg" alt="BLISS" width="112" height="40">`;

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try { res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('Network error: check your connection and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.endsWith('/login') && !path.endsWith('/password')) { A.me = null; renderLogin('Your session expired. Please log in again.'); throw new Error('Please log in again.'); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status, data });
  return data;
}
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`; el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${ic(type === 'error' ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
  $('#toasts').append(el); requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 5000 : 2600);
}
function openLayer(html, { wide = false, side = false } = {}) {
  const root = $('#layer');
  root.innerHTML = `<div class="layer ${side ? 'layer-side' : 'layer-modal'}${wide ? ' wide' : ''}" role="dialog" aria-modal="true"><div class="layer-bg" data-close></div><div class="layer-panel">${html}</div></div>`;
  const el = root.firstElementChild;
  requestAnimationFrame(() => { el.classList.add('open'); ($('[autofocus]', el) || $('input,select,textarea,button', $('.layer-panel', el)))?.focus(); });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeLayer(); });
  return el;
}
function closeLayer() { const el = $('#layer').firstElementChild; if (!el) return; el.classList.remove('open'); setTimeout(() => el.remove(), 220); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#layer').firstElementChild) closeLayer(); });
function ask(message, { ok = 'Delete', danger = true, detail = '' } = {}) {
  return new Promise((resolve) => {
    const el = openLayer(`<div class="modal-body confirm"><span class="confirm-ic ${danger ? 'danger' : ''}">${ic(danger ? 'alert' : 'info')}</span><h2>${esc(message)}</h2>${detail ? `<p>${esc(detail)}</p>` : ''}<div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="ask-ok">${esc(ok)}</button></div></div>`);
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); closeLayer(); };
    $('#ask-ok', el).addEventListener('click', () => finish(true));
    el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) finish(false); });
    $('#ask-ok', el).focus();
  });
}
const setBusy = (btn, busy, label) => { if (!btn) return; btn.disabled = busy; if (busy) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<span class="spin sm"></span>${label || 'Saving…'}`; } else if (btn.dataset.label) btn.innerHTML = btn.dataset.label; };
function formObj(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

/* ================================================================== auth */
function renderLogin(msg = '') {
  app.innerHTML = `<div class="login">
    <form class="login-card" id="login-form">
      <div class="login-brand">${logoImg()}<span>Dashboard</span></div>
      <h1>Welcome back</h1><p class="muted">Log in to manage your products, stock and orders.</p>
      ${msg ? `<div class="banner warn">${ic('info')}<span>${esc(msg)}</span></div>` : ''}
      <label class="field"><span>Username</span><input name="username" autocomplete="username" required autofocus></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
      <label class="check"><input type="checkbox" name="remember"><span class="box"></span>Keep me logged in for 30 days</label>
      <button class="btn btn-primary btn-block btn-lg" type="submit">${ic('lock')}Log in</button>
      <a class="muted small center-link" href="/">← Back to the shop</a>
    </form></div>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); setBusy(btn, true, 'Logging in…');
    try { await api('/api/admin/login', { method: 'POST', body: formObj(e.target) }); await boot(); }
    catch (err) { setBusy(btn, false); toast(err.message, 'error'); }
  });
}
async function boot() {
  try { A.me = await api('/api/admin/me'); } catch { renderLogin(); return; }
  renderShell();
  refreshCounts();
  route();
}

/* ================================================================= shell */
const NAV = [
  ['overview', '#/', 'dashboard', 'Overview'], ['orders', '#/orders', 'orders', 'Orders', 'pending'], ['abandoned', '#/abandoned', 'cart', 'Abandoned carts', 'abandoned'],
  ['products', '#/products', 'box', 'Products', 'attention'], ['inventory', '#/inventory', 'layers', 'Inventory'], ['categories', '#/categories', 'grid', 'Categories'], ['customers', '#/customers', 'users', 'Customers'],
  'Grow sales', ['funnels', '#/funnels', 'funnel', 'Funnels'], ['analytics', '#/analytics', 'chart', 'Traffic & funnel'], ['boosters', '#/boosters', 'bolt', 'Sales boosters'],
  ['coupons', '#/coupons', 'ticket', 'Coupons'], ['reviews', '#/reviews', 'star', 'Reviews', 'reviews'], ['messages', '#/messages', 'inbox', 'Messages', 'unread'], ['subscribers', '#/subscribers', 'mail', 'Subscribers & leads'],
  'Money', ['reports', '#/reports', 'wallet', 'Profit & expenses'],
  'Store', ['builder', '#/builder', 'gift', 'Gift Box Builder'], ['settings', '#/settings', 'cog', 'Settings'],
];
function renderShell() {
  app.innerHTML = `<div class="shell">
    <aside class="side" id="side">
      <div class="side-top"><a href="#/" class="brand" aria-label="${esc(A.me.store || 'BLISS')} dashboard home">${logoImg(true)}<small>Admin</small></a><button type="button" class="ibtn side-x" data-act="close-side" aria-label="Close menu">${ic('close')}</button></div>
      <nav class="side-nav">${NAV.map((n) => (typeof n === 'string' ? `<div class="side-h">${n}</div>` : `<a href="${n[1]}" data-nav="${n[0]}">${ic(n[2])}<span>${n[3]}</span>${n[4] ? `<b class="count" data-count="${n[4]}" hidden></b>` : ''}</a>`)).join('')}</nav>
      <div class="side-foot"><a href="/" target="_blank" rel="noopener" class="side-link">${ic('external')}View store</a><button type="button" class="side-link" data-act="logout">${ic('logout')}Log out</button></div>
    </aside>
    <div class="side-scrim" data-act="close-side"></div>
    <div class="main">
      <header class="topbar">
        <button type="button" class="ibtn menu-btn" data-act="open-side" aria-label="Open menu">${ic('menu')}</button>
        <form class="top-search" id="gsearch-form" role="search">${ic('search')}<input id="gsearch" placeholder="Search products, or type an order ID…" aria-label="Search"></form>
        <a class="btn btn-primary btn-sm top-add" href="#/products/new">${ic('plus')}<span>Add product</span></a>
        <div class="top-user"><span class="avatar">${esc((A.me.username || 'A')[0].toUpperCase())}</span><span class="top-name">${esc(A.me.username)}</span></div>
      </header>
      ${A.me.isDefault ? `<div class="banner warn top-banner">${ic('alert')}<span>You're still using the default password. <a href="#/settings?tab=account">Change it now</a> before you go live.</span></div>` : ''}
      <main id="view" class="view" tabindex="-1"></main>
    </div>
  </div>`;
  $('#gsearch-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#gsearch').value.trim(); if (!q) return;
    if (/^BL[A-Z0-9]{4,10}$/i.test(q)) location.hash = `#/orders/${q.toUpperCase()}`;
    else location.hash = `#/products?q=${encodeURIComponent(q)}`;
    $('#gsearch').value = '';
  });
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  if (act === 'open-side') document.body.classList.add('side-open');
  else if (act === 'close-side') document.body.classList.remove('side-open');
  else if (act === 'logout') { await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); A.me = null; renderLogin('You have been logged out.'); }
  else if (act === 'reload') route();
});
async function refreshCounts() {
  try {
    const s = await api('/api/admin/counts');
    A.counts = s;
    for (const b of $$('[data-count]')) { const n = A.counts[b.dataset.count] || 0; b.textContent = n; b.hidden = !n; }
    return s;
  } catch { return null; }
}

/* ================================================================= router */
const ROUTES = [
  [/^\/$/, (m, p, el) => viewOverview(el), 'overview'],
  [/^\/orders$/, (m, p, el) => viewOrders(el, p), 'orders'],
  [/^\/orders\/new$/, (m, p, el) => viewNewOrder(el, p), 'orders'],
  [/^\/orders\/([A-Za-z0-9]+)$/, (m, p, el) => viewOrder(el, m[1].toUpperCase()), 'orders'],
  [/^\/abandoned$/, (m, p, el) => viewAbandoned(el, p), 'abandoned'],
  [/^\/products$/, (m, p, el) => viewProducts(el, p), 'products'],
  [/^\/products\/new$/, (m, p, el) => viewProductForm(el, null), 'products'],
  [/^\/products\/import$/, (m, p, el) => viewProductImport(el), 'products'],
  [/^\/products\/([\w-]+)$/, (m, p, el) => viewProductForm(el, m[1]), 'products'],
  [/^\/inventory$/, (m, p, el) => viewInventory(el, p), 'inventory'],
  [/^\/categories$/, (m, p, el) => viewCategories(el), 'categories'],
  [/^\/customers$/, (m, p, el) => viewCustomers(el, p), 'customers'],
  [/^\/customers\/(\d{11})$/, (m, p, el) => viewCustomer(el, m[1]), 'customers'],
  [/^\/funnels$/, (m, p, el) => viewFunnels(el), 'funnels'],
  [/^\/funnels\/new$/, (m, p, el) => viewFunnelForm(el, null, p), 'funnels'],
  [/^\/funnels\/([\w-]+)$/, (m, p, el) => viewFunnelForm(el, m[1], p), 'funnels'],
  [/^\/analytics$/, (m, p, el) => viewAnalytics(el), 'analytics'],
  [/^\/boosters$/, (m, p, el) => viewBoosters(el, p), 'boosters'],
  [/^\/reports$/, (m, p, el) => viewReports(el, p), 'reports'],
  [/^\/reviews$/, (m, p, el) => viewReviews(el, p), 'reviews'],
  [/^\/coupons$/, (m, p, el) => viewCoupons(el), 'coupons'],
  [/^\/messages$/, (m, p, el) => viewMessages(el), 'messages'],
  [/^\/subscribers$/, (m, p, el) => viewSubscribers(el, p), 'subscribers'],
  [/^\/builder$/, (m, p, el) => viewBuilder(el), 'builder'],
  [/^\/settings$/, (m, p, el) => viewSettings(el, p), 'settings'],
];
async function route() {
  if (!A.me) return;
  if (A.dirty && location.hash !== A.lastHash) {
    if (!confirm('You have unsaved changes. Leave this page without saving?')) { history.replaceState(null, '', A.lastHash || '#/'); return; }
  }
  A.dirty = false; A.lastHash = location.hash;
  document.body.classList.remove('side-open');
  closeLayer();
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  const params = new URLSearchParams(qs || '');
  const view = $('#view'); if (!view) return;
  const el = document.createElement('div'); el.className = 'page';
  view.replaceChildren(el);
  el.innerHTML = '<div class="loading"><span class="spin"></span></div>';
  let found = false;
  for (const [re, fn, nav] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    found = true;
    for (const a of $$('[data-nav]')) a.classList.toggle('active', a.dataset.nav === nav);
    try { await fn(m, params, el); } catch (err) { if (A.me) el.innerHTML = `<div class="empty">${ic('alert', 'empty-ic')}<h2>Couldn't load this page</h2><p>${esc(err.message)}</p><button type="button" class="btn btn-ghost" data-act="reload">Retry</button></div>`; }
    break;
  }
  if (!found) el.innerHTML = `<div class="empty">${ic('info', 'empty-ic')}<h2>Page not found</h2><a class="btn btn-ghost" href="#/">Go to overview</a></div>`;
  view.scrollTop = 0; window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
addEventListener('beforeunload', (e) => { if (A.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* =============================================================== overview */
function niceStep(raw) { if (raw <= 0) return 1; const p = 10 ** Math.floor(Math.log10(raw)); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const METRICS = {
  sales: { label: 'Sales', fmt: money, axis: (v, c) => '৳' + (c ? (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : v) : Math.round(v).toLocaleString('en-IN')) },
  profit: { label: 'Gross profit', fmt: money, axis: (v, c) => (v < 0 ? '−' : '') + '৳' + (c ? (Math.abs(v) >= 1000 ? `${+(Math.abs(v) / 1000).toFixed(1)}K` : Math.abs(v)) : Math.round(Math.abs(v)).toLocaleString('en-IN')) },
  orders: { label: 'Orders', fmt: (v) => plural(v, 'order'), axis: (v) => num(v) },
  visits: { label: 'Visitors', fmt: (v) => plural(v, 'visitor'), axis: (v) => num(v) },
};
/** Single-series area chart, drawn at the host's real pixel width (crisp text), redrawn on resize. */
function mountLineChart(host, series, metric = 'sales') {
  const draw = () => {
    if (!host.isConnected) { ro.disconnect(); return; }
    const c = lineChart(series, metric, Math.max(300, Math.round(host.clientWidth)));
    host.innerHTML = c.html; c.mount(host);
  };
  const ro = new ResizeObserver(debounce(draw, 100));
  draw(); ro.observe(host);
}
function lineChart(series, metric, W = 720) {
  const M = METRICS[metric], key = metric;
  const H = 250, L = 64, R = 18, T = 22, B = 30;
  const vals = series.map((d) => d[key] || 0);
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const step = niceStep((max - min) / 4), top = Math.ceil(max / step) * step || step, bot = Math.floor(min / step) * step;
  const compact = Math.max(top, -bot) >= 10000;
  const n = series.length, x = (i) => (n === 1 ? (L + W - R) / 2 : L + (i / (n - 1)) * (W - L - R)), y = (v) => T + (1 - (v - bot) / (top - bot)) * (H - T - B);
  const pts = series.map((d, i) => `${x(i).toFixed(1)} ${y(d[key] || 0).toFixed(1)}`);
  const line = 'M' + pts.join('L'), area = `${line}L${x(n - 1).toFixed(1)} ${y(0)}L${x(0).toFixed(1)} ${y(0)}Z`;
  let grid = '';
  for (let v = bot; v <= top + 1e-9; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${Math.abs(v) < 1e-9 ? 'base' : 'gl'}"/><text x="${L - 10}" y="${(y(v) + 4).toFixed(1)}" class="yt">${M.axis(v, compact)}</text>`;
  const short = (iso) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
  const ticks = [...new Set([0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1])];
  const xl = ticks.map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="xt" text-anchor="${n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${short(series[i].date)}</text>`).join('');
  const peak = vals.reduce((b, v, i) => (v > vals[b] ? i : b), 0);
  const peakLabel = vals[peak] > 0 ? `<circle cx="${x(peak).toFixed(1)}" cy="${y(vals[peak]).toFixed(1)}" r="4.5" class="dot"/><text x="${Math.min(W - R - 4, Math.max(L + 4, x(peak))).toFixed(1)}" y="${(y(vals[peak]) - 12).toFixed(1)}" text-anchor="middle" class="peak">${esc(M.fmt(vals[peak]))}</text>` : '';
  const html = `<div class="chart" tabindex="0" role="img" aria-label="Daily ${M.label.toLowerCase()} for the selected period. Use left and right arrow keys to read each day.">
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="chart-svg">
      ${grid}${xl}
      <path d="${area}" class="area"/><path d="${line}" class="line"/>${peakLabel}
      <line class="xh" y1="${T}" y2="${H - B}" x1="0" x2="0" hidden/><circle class="dot hov" r="5" hidden/>
      <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - B - T}"/>
    </svg>
    <div class="tip" hidden></div>
  </div>`;
  const mount = (root) => {
    const box = $('.chart', root), svg = $('svg', box), tip = $('.tip', box), xh = $('.xh', svg), dot = $('.hov', svg);
    let cur = -1;
    const show = (i) => {
      cur = Math.max(0, Math.min(n - 1, i)); const d = series[cur];
      xh.setAttribute('x1', x(cur)); xh.setAttribute('x2', x(cur)); xh.hidden = false;
      dot.setAttribute('cx', x(cur)); dot.setAttribute('cy', y(d[key] || 0)); dot.hidden = false;
      tip.replaceChildren();
      const v = document.createElement('b'); v.textContent = M.fmt(d[key] || 0);
      const meta = document.createElement('span'); meta.textContent = `${new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d.date + 'T00:00:00Z'))}${key !== 'orders' && d.orders != null ? ` · ${plural(d.orders, 'order')}` : ''}`;
      tip.append(document.createElement('i'), v, meta); tip.hidden = false;
      const r = box.getBoundingClientRect(), px = (x(cur) / W) * r.width;
      tip.style.left = `${Math.min(r.width - tip.offsetWidth - 4, Math.max(4, px - tip.offsetWidth / 2))}px`;
      tip.style.top = `${Math.max(0, (y(d[key] || 0) / H) * r.height - tip.offsetHeight - 14)}px`;
    };
    const hide = () => { xh.hidden = true; dot.hidden = true; tip.hidden = true; cur = -1; };
    svg.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); const sx = ((e.clientX - r.left) / r.width) * W; show(Math.round(((sx - L) / (W - L - R)) * (n - 1))); });
    svg.addEventListener('pointerleave', hide);
    box.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(cur < 0 ? n - 1 : cur + (e.key === 'ArrowRight' ? 1 : -1)); } else if (e.key === 'Escape') hide(); });
    box.addEventListener('blur', hide);
  };
  return { html, mount };
}
function seriesTable(series) {
  return `<div class="tbl-wrap chart-table"><table class="tbl"><thead><tr><th>Date</th><th class="num">Orders</th><th class="num">Sales</th><th class="num">Gross profit</th><th class="num">Visitors</th></tr></thead><tbody>${series.slice().reverse().map((d) => `<tr><td>${fmtDate(d.date + 'T06:00:00Z')}</td><td class="num">${d.orders}</td><td class="num">${money(d.sales)}</td><td class="num">${money(d.profit)}</td><td class="num">${num(d.visits)}</td></tr>`).join('')}</tbody></table></div>`;
}
function stockSplit(st) {
  const total = st.in + st.limited + st.out;
  const parts = ['in', 'limited', 'out'].map((k) => [k, st[k] || 0]);
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  return `<div class="segbar" role="img" aria-label="Stock: ${st.in} in stock, ${st.limited} limited, ${st.out} out of stock">${parts.filter(([, n]) => n).map(([k, n]) => `<span style="flex:${n};background:${STATUS_COLOR[k]}" title="${STOCK[k][0]}: ${n} (${pct(n)}%)"></span>`).join('')}</div>
  <ul class="split-list">${parts.map(([k, n]) => `<li><a href="#/products?s=${k}"><i class="sw" style="background:${STATUS_COLOR[k]}"></i>${ic(STOCK[k][1], 'sk-ic sk-' + k)}<span>${STOCK[k][0]}</span><b>${n}</b><small>${pct(n)}%</small>${ic('chev-right', 'go')}</a></li>`).join('')}</ul>`;
}
/** Visitors → product views → bag → checkout → orders, with the drop-off between steps. */
function funnelBars(f) {
  const steps = [['Visitors', f.visits], ['Viewed a product', f.productViews], ['Added to bag', f.carts], ['Started checkout', f.checkouts], ['Ordered', f.orders]];
  if (!f.visits) return `<p class="muted small">Visitor tracking starts automatically now. Numbers appear here as people visit your shop (orders are counted even without tracking).</p>`;
  return `<ol class="funnel-bars">${steps.map(([l, n], i) => { const prev = i ? steps[i - 1][1] : n; return `<li><div class="fb-top"><span>${l}</span><b>${num(n)}</b>${i ? `<small>${pctFmt(prev ? Math.min(1, n / prev) : 0)} of previous step</small>` : ''}</div><div class="bar-track"><i style="width:${Math.max(1.5, (n / f.visits) * 100)}%"></i></div></li>`; }).join('')}</ol>
  <p class="muted small">Overall conversion: <b>${pctFmt(Math.min(1, f.orders / f.visits), 1)}</b> of visitors ordered. Biggest drop: <b>${(() => { let worst = 1, at = 1; for (let i = 1; i < steps.length; i++) { const r = steps[i - 1][1] ? steps[i][1] / steps[i - 1][1] : 1; if (r < worst) { worst = r; at = i; } } return `${steps[at - 1][0].toLowerCase()} → ${steps[at][0].toLowerCase()}`; })()}</b>.</p>`;
}
async function viewOverview(el) {
  const hr = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Dhaka' }).format(new Date()));
  const greet = hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening';
  el.innerHTML = `<div class="page-head"><div><h1>Good ${greet}, ${esc(A.me.username)}</h1><p>Here's how ${esc(A.me.store)} is doing. Every number comes from your real orders.</p></div><div class="head-actions"><a class="btn btn-ghost" href="#/orders/new">${ic('plus')}New order</a><a class="btn btn-primary" href="#/products/new">${ic('plus')}Add product</a></div></div>
  <div id="ov-range" class="range-host"></div><div id="ov-body"><div class="loading"><span class="spin"></span></div></div>`;
  let metric = store.get('bliss.admin.metric', 'sales');
  const load = async (r) => {
    const body = $('#ov-body', el); body.classList.add('refetch');
    const s = await api(`/api/admin/overview?from=${r.from}&to=${r.to}`);
    refreshCounts();
    body.classList.remove('refetch');
    const k = s.kpi, p = s.prev, a = s.actions;
    const action = (href, n, label, tone = 'warn', icon = 'alert') => (n ? `<a class="act act-${tone}" href="${href}">${ic(icon)}<span><b>${typeof n === 'number' ? num(n) : n}</b> ${label}</span>${ic('chev-right', 'go')}</a>` : '');
    const acts = [
      action('#/orders?status=pending', a.pending, a.pending === 1 ? 'new order to confirm' : 'new orders to confirm', 'brand', 'orders'),
      action('#/orders?pay=unpaid&status=pending', a.unverified, 'bKash/Nagad payments to verify', 'warn', 'cash'),
      action('#/orders?status=processing', a.toPack, 'orders to pack & send', 'brand', 'box'),
      action('#/orders?status=shipped', a.onRoad ? `${a.onRoad}` : 0, `out for delivery${a.codOnRoad ? ` (${money(a.codOnRoad)} cash to collect)` : ''}`, 'info', 'truck'),
      action('#/orders?status=delivered&pay=unpaid', a.deliveredUnpaid, `delivered but not marked paid (${money(a.deliveredUnpaidAmount)} to settle with courier)`, 'warn', 'wallet'),
      action('#/orders', a.overdue, 'orders past their delivery date', 'bad', 'calendar'),
      action('#/abandoned', a.abandoned, 'abandoned checkouts to call', 'brand', 'cart'),
      action('#/inventory?f=reorder', a.reorder, 'products to reorder soon', 'warn', 'layers'),
      action('#/products?s=out', a.out, 'products out of stock', 'bad', 'x-circle'),
      action('#/reviews?tab=pending', a.reviews, 'reviews to approve', 'info', 'star'),
      action('#/messages', a.unread, 'unread messages', 'info', 'inbox'),
    ].filter(Boolean);
    const cov = k.costCoverage < 0.98 ? `<span class="kpi-sub warn-t">${ic('info')}Cost price missing on some products (${pctFmt(1 - k.costCoverage)} of sales). <a href="#/inventory?f=nocost">Add costs</a></span>` : '';
    body.innerHTML = `
    <section class="kpis kpis-6">
      <div class="kpi kpi-hero"><span class="kpi-label">Sales · ${esc(rangeLabel(s.range))}</span><b class="hero-num">${money(k.sales)}</b><span class="kpi-sub">${delta(k.sales, p.sales)} vs previous ${s.range.days} day${s.range.days > 1 ? 's' : ''} · ${plural(k.orders, 'order')}</span></div>
      <div class="kpi"><span class="kpi-label">Gross profit</span><b>${money(k.profit)}</b><span class="kpi-sub">${delta(k.profit, p.profit)} · ${pctFmt(k.margin)} margin</span>${cov}</div>
      <div class="kpi"><span class="kpi-label">Average order</span><b>${money(k.aov)}</b><span class="kpi-sub">${delta(k.aov, p.aov)} · ${num(k.units)} items sold</span></div>
      <div class="kpi"><span class="kpi-label">Customers</span><b>${num(k.customers)}</b><span class="kpi-sub">${num(k.newCustomers)} new · ${num(k.returningCustomers)} returning</span></div>
      <div class="kpi"><span class="kpi-label">Conversion rate</span><b>${k.conversion == null ? '—' : pctFmt(k.conversion, 1)}</b><span class="kpi-sub">${k.visits ? `${num(k.visits)} visitors` : 'Counting visitors from today'}</span></div>
      <a class="kpi" href="#/orders?status=returned"><span class="kpi-label">Cancelled · returned</span><b>${num(k.cancelled)} · ${num(k.returned)}</b><span class="kpi-sub">${pctFmt(k.returnRate)} return rate${k.returnLoss ? ` · ${money(k.returnLoss)} lost on returns` : ''}</span></a>
    </section>
    ${acts.length ? `<section class="card"><div class="card-head"><div><h2>To do now</h2><p>Things waiting for you right now (not limited to the date range).</p></div></div><div class="acts">${acts.join('')}</div></section>` : `<section class="card all-good">${ic('check-circle')}<span><b>All caught up.</b> No orders, payments or stock need you right now.</span></section>`}
    <section class="grid-main">
      <div class="col">
        <div class="card">
          <div class="card-head"><div><h2>${METRICS[metric].label} by day</h2><p>Cancelled, returned and refunded orders are excluded.</p></div>
            <div class="seg-sm" role="tablist" id="metric">${Object.entries(METRICS).map(([key, m]) => `<button type="button" data-m="${key}" class="${key === metric ? 'on' : ''}" role="tab" aria-selected="${key === metric}">${m.label}</button>`).join('')}<button type="button" data-m="table" role="tab">${ic('table')}</button></div></div>
          <div id="rev"></div>
        </div>
        <div class="card"><div class="card-head"><div><h2>Shop funnel</h2><p>Where visitors drop off before ordering (online orders only).</p></div><a class="link" href="#/analytics">Traffic details</a></div>${funnelBars(s.funnel)}</div>
        <div class="card">
          <div class="card-head"><h2>Best sellers this period</h2><a class="link" href="#/reports">Profit by product</a></div>
          ${s.top.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Product</th><th class="num">Units</th><th class="num">Sales</th><th class="num">Profit</th></tr></thead><tbody>${s.top.map((t) => `<tr><td><div class="p-cell sm"><img src="${esc(t.img || '/img/box.svg')}" alt="" width="32" height="40" loading="lazy"><a href="#/products/${t.pid}" class="p-name">${esc(t.name)}</a></div></td><td class="num">${t.units}</td><td class="num">${money(t.sales)}</td><td class="num">${t.known ? money(t.profit) : '<span class="muted" title="Add a cost price to see profit">—</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No sales in this period yet.</p>'}
        </div>
        <div class="card">
          <div class="card-head"><h2>Recent orders</h2><a class="link" href="#/orders">View all</a></div>
          ${s.recent.length ? `<div class="tbl-wrap"><table class="tbl tbl-click"><thead><tr><th>Order</th><th>Customer</th><th>From</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>${s.recent.map((o) => `<tr data-href="#/orders/${o.id}"><td><a href="#/orders/${o.id}" class="mono">${o.id}</a><small class="block muted">${ago(o.created)}</small></td><td>${esc(o.name)}<small class="block muted">${PAYMENT[o.payment]}</small></td><td><span class="pill pill-src">${esc(chName(o.channel))}</span></td><td class="num">${money(o.total)}</td><td>${statusPill(o.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No orders yet. Share your shop link to get your first one!</p>'}
        </div>
      </div>
      <div class="col">
        <div class="card"><div class="card-head"><h2>Where sales come from</h2></div>${barList(s.bySource.map((x) => [esc(chName(x.channel)), x.sales, plural(x.orders, 'order')]))}</div>
        <div class="card"><div class="card-head"><h2>Sales by category</h2><span class="muted small">before discounts</span></div>${barList(s.byCategory.map((x) => [esc(x.name), x.sales, `${num(x.units)} units`]))}</div>
        <div class="card"><div class="card-head"><h2>Payments & cities</h2></div>
          ${barList(Object.entries(s.byPayment).map(([m, x]) => [PAYMENT[m] || m, x.sales, plural(x.orders, 'order')]))}
          <h3 class="mini-h">Top cities</h3>${barList(s.byCity.map((x) => [esc(x.city), x.sales, plural(x.orders, 'order')]))}</div>
        <div class="card">
          <div class="card-head"><div><h2>Stock health</h2><p>${plural(s.stock.products, 'product')} · ${num(s.stock.units)} units on hand</p></div><a class="link" href="#/inventory">Inventory</a></div>
          <div class="mini-kpis"><div><span>Stock value (cost)</span><b>${money(s.stock.valueCost)}</b></div><div><span>At selling price</span><b>${money(s.stock.valueRetail)}</b></div></div>
          ${stockSplit(s.stock)}
          <h3 class="mini-h">Needs attention</h3>
          ${s.stock.attention.length ? `<ul class="low-list">${s.stock.attention.map((p) => `<li><img src="${esc(p.img || '/img/placeholder.svg')}" alt="" width="40" height="50" loading="lazy"><a href="#/products/${p.id}">${esc(p.name)}</a>${stockPill(p.status)}${p.qty != null ? `<small>${p.qty} left${p.cover != null ? ` · ~${p.cover}d` : ''}</small>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Everything is in stock.</p>'}
        </div>
      </div>
    </section>`;
    const draw = () => { const host = $('#rev', body); const fresh = host.cloneNode(false); host.replaceWith(fresh); if (metric === 'table') fresh.innerHTML = seriesTable(s.series); else mountLineChart(fresh, s.series, metric); };
    draw();
    $('#metric', body).addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      metric = b.dataset.m; if (metric !== 'table') store.set('bliss.admin.metric', metric);
      $$('#metric button', body).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
      const h = $('.card-head h2', $('#rev', body).closest('.card')); if (metric !== 'table') h.textContent = `${METRICS[metric].label} by day`;
      draw();
    });
  };
  const r = rangePicker($('#ov-range', el), load);
  el.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a')) location.hash = tr.dataset.href; });
  await load(r);
}

/* =============================================================== products */
async function loadProducts(force = false) {
  if (A.products.length && !force) return;
  const d = await api('/api/admin/products');
  A.products = d.products; A.categories = d.categories; A.lowDefault = d.lowStockDefault;
}
const catName = (id) => A.categories.find((c) => c.id === id)?.name || '—';
function prepForIndex(p) { p.stock = p.status; p.reviews = p.reviewCount || 0; p.rating = p.rating || 0; p.sold = p.sold || 0; return p; }

async function viewProducts(el, params) {
  await loadProducts(true);
  const st = { q: params.get('q') || '', cat: params.get('cat') || '', s: params.get('s') || '', sort: params.get('sort') || 'newest', page: 1, sel: new Set() };
  let idx;
  const reindex = () => { idx = new CatalogIndex(A.products.map(prepForIndex), A.categories); };
  reindex();
  const counts = () => {
    const c = { all: A.products.length, in: 0, limited: 0, out: 0, hidden: 0 };
    for (const p of A.products) { c[p.status]++; if (!p.active) c.hidden++; }
    return c;
  };
  const SORTS = [['newest', 'Newest first'], ['name-asc', 'Name A–Z'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['popular', 'Best selling'], ['stock-asc', 'Lowest stock first']];
  el.innerHTML = `
  <div class="page-head"><div><h1>Products</h1><p>Add, edit and remove products, and control what shoppers see as <b>In stock</b>, <b>Limited</b> or <b>Out of stock</b>.</p></div><div class="head-actions"><a class="btn btn-ghost" href="#/products/import">${ic('upload')}Import</a><a class="btn btn-ghost" href="/api/admin/products.csv" download>${ic('download')}Export</a><a class="btn btn-primary" href="#/products/new">${ic('plus')}Add product</a></div></div>
  <div class="card card-flush">
    <div class="filter-tabs" id="ptabs"></div>
    <div class="toolbar">
      <label class="search-in">${ic('search')}<input id="pq" placeholder="Search by name, category or keyword…" value="${esc(st.q)}"></label>
      <select id="pcat" aria-label="Category"><option value="">All categories</option>${A.categories.map((c) => `<option value="${c.id}" ${c.id === st.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select id="psort" aria-label="Sort">${SORTS.map(([v, l]) => `<option value="${v}" ${v === st.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="bulkbar" id="bulk" hidden><b id="bulk-n"></b><span class="muted">selected</span>
      <div class="bulk-actions"><button type="button" class="btn btn-sm btn-ghost" data-bulk="status" data-v="in">${ic('check-circle')}In stock</button><button type="button" class="btn btn-sm btn-ghost" data-bulk="status" data-v="limited">${ic('alert')}Limited</button><button type="button" class="btn btn-sm btn-ghost" data-bulk="status" data-v="out">${ic('x-circle')}Out of stock</button><button type="button" class="btn btn-sm btn-ghost" data-bulk="active" data-v="1">Show</button><button type="button" class="btn btn-sm btn-ghost" data-bulk="active" data-v="0">Hide</button><button type="button" class="btn btn-sm btn-danger-ghost" data-bulk="delete">${ic('trash')}Delete</button></div>
      <button type="button" class="link" id="bulk-clear">Clear</button></div>
    <div id="plist"></div>
  </div>`;
  const PER = 50;
  const list = () => {
    let items = idx.query({ q: st.q, cat: st.cat ? [st.cat] : [], s: st.s && st.s !== 'hidden' ? st.s.split(',') : [], sort: st.sort === 'stock-asc' ? 'newest' : st.sort, all: true }).items;
    if (st.s === 'hidden') items = items.filter((p) => !p.active);
    if (st.sort === 'stock-asc') items = items.slice().sort((a, b) => (a.status === 'out' ? -1 : 0) - (b.status === 'out' ? -1 : 0) || (a.qty ?? 1e9) - (b.qty ?? 1e9));
    return items;
  };
  const rowHtml = (p) => `<tr data-id="${p.id}" class="${p.active ? '' : 'is-hidden'}">
    <td class="sel"><label class="check"><input type="checkbox" class="rowsel" ${st.sel.has(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.name)}"><span class="box"></span></label></td>
    <td class="p-cell"><img src="${esc(p.images[0] || '/img/placeholder.svg')}" alt="" width="44" height="55" loading="lazy"><div><a href="#/products/${p.id}" class="p-name">${esc(p.name)}</a><small>${p.sku ? esc(p.sku) + ' · ' : ''}${esc(catName(p.cat))}${p.options.length ? ` · ${p.options.map((o) => esc(o.name)).join(', ')}` : ''}${p.featured ? ' · ★ Featured' : ''}${!p.active ? ' · <b class="hidden-tag">Hidden</b>' : ''}</small></div></td>
    <td class="num price-c"><label class="price-box${p.price > 0 ? '' : ' empty'}" title="Type a new price and press Enter"><span>৳</span><input type="number" class="price-in" min="0" step="1" inputmode="decimal" value="${p.price > 0 ? p.price : ''}" placeholder="0" aria-label="Price of ${esc(p.name)}"></label>${p.compare ? `<s>${money(p.compare)}</s>` : ''}</td>
    <td class="qty-c"><input type="number" class="qty-in" min="0" step="1" value="${p.qty ?? ''}" placeholder="—" aria-label="Quantity of ${esc(p.name)}" title="Leave empty to not track quantity">${p.qty != null && p.autoStock ? '<small class="auto" title="Status updates automatically from quantity">auto</small>' : ''}</td>
    <td class="st-c"><div class="stock-seg" role="group" aria-label="Stock status of ${esc(p.name)}">${['in', 'limited', 'out'].map((k) => `<button type="button" class="ss ss-${k}${p.status === k ? ' on' : ''}" data-st="${k}" aria-pressed="${p.status === k}" title="${STOCK[k][0]}">${ic(STOCK[k][1])}<span>${STOCK[k][2]}</span></button>`).join('')}</div></td>
    <td class="num sold-c">${p.sold || 0}</td>
    <td class="vis-c"><label class="switch" title="${p.active ? 'Visible in shop' : 'Hidden from shop'}"><input type="checkbox" class="act-in" ${p.active ? 'checked' : ''} aria-label="Show ${esc(p.name)} in shop"><span></span></label></td>
    <td class="row-actions"><a class="ibtn" href="#/products/${p.id}" title="Edit">${ic('edit')}</a><a class="ibtn" href="/product/${esc(p.slug)}" target="_blank" rel="noopener" title="View in shop">${ic('eye')}</a><button type="button" class="ibtn" data-dup title="Duplicate">${ic('copy')}</button><button type="button" class="ibtn danger" data-del title="Delete">${ic('trash')}</button></td>
  </tr>`;
  const draw = () => {
    const c = counts();
    $('#ptabs', el).innerHTML = [['', 'All', c.all], ['in', 'In stock', c.in], ['limited', 'Limited', c.limited], ['out', 'Out of stock', c.out], ['hidden', 'Hidden', c.hidden]].map(([v, l, n]) => `<button type="button" class="ftab${st.s === v ? ' on' : ''}" data-s="${v}">${v ? ic(v === 'hidden' ? 'eye' : STOCK[v][1], 'sk-' + v) : ''}${l}<b>${n}</b></button>`).join('');
    const items = list(), shown = items.slice(0, PER * st.page);
    $('#plist', el).innerHTML = items.length ? `<div class="tbl-wrap"><table class="tbl tbl-products"><thead><tr><th class="sel"><label class="check"><input type="checkbox" id="selall" aria-label="Select all"><span class="box"></span></label></th><th>Product</th><th class="num">Price</th><th>Quantity</th><th>Stock status</th><th class="num">Sold</th><th>Visible</th><th></th></tr></thead><tbody>${shown.map(rowHtml).join('')}</tbody></table></div>${items.length > shown.length ? `<div class="more"><button type="button" class="btn btn-ghost" id="pmore">Show more (${items.length - shown.length} left)</button></div>` : ''}<p class="tbl-foot muted small">${plural(items.length, 'product')} · Quantity is optional: when set, the status updates automatically as orders come in (0 = Out of stock, ${A.lowDefault} or fewer = Limited).</p>`
      : `<div class="empty">${ic('box', 'empty-ic')}<h2>No products found</h2><p>${st.q || st.cat || st.s ? 'Try a different search or filter.' : 'Add your first product to start selling.'}</p><a class="btn btn-primary" href="#/products/new">${ic('plus')}Add product</a></div>`;
    updateBulk();
  };
  const updateBulk = () => { $('#bulk', el).hidden = !st.sel.size; $('#bulk-n', el).textContent = st.sel.size; const all = $('#selall', el); if (all) { const vis = $$('.rowsel', el); all.checked = vis.length > 0 && vis.every((x) => x.checked); } };
  const replaceRow = (p) => { const i = A.products.findIndex((x) => x.id === p.id); if (i >= 0) A.products[i] = p; prepForIndex(p); const tr = $(`tr[data-id="${p.id}"]`, el); if (tr) tr.outerHTML = rowHtml(p); reindex(); const c = counts(); $$('.ftab b', el).forEach((b, k) => { b.textContent = [c.all, c.in, c.limited, c.out, c.hidden][k]; }); };
  const syncUrl = () => { const u = new URLSearchParams(); if (st.q) u.set('q', st.q); if (st.cat) u.set('cat', st.cat); if (st.s) u.set('s', st.s); if (st.sort !== 'newest') u.set('sort', st.sort); const h = '#/products' + (u.toString() ? '?' + u : ''); history.replaceState(null, '', h); A.lastHash = h; };
  $('#pq', el).addEventListener('input', debounce((e) => { st.q = e.target.value; st.page = 1; syncUrl(); draw(); }, 120));
  $('#pcat', el).addEventListener('change', (e) => { st.cat = e.target.value; st.page = 1; syncUrl(); draw(); });
  $('#psort', el).addEventListener('change', (e) => { st.sort = e.target.value; syncUrl(); draw(); });
  el.addEventListener('click', async (e) => {
    const tab = e.target.closest('.ftab'); if (tab) { st.s = tab.dataset.s; st.page = 1; syncUrl(); draw(); return; }
    if (e.target.closest('#pmore')) { st.page++; draw(); return; }
    if (e.target.closest('#bulk-clear')) { st.sel.clear(); draw(); return; }
    const tr = e.target.closest('tr[data-id]'); const id = tr?.dataset.id;
    const ss = e.target.closest('.ss');
    if (ss && id) {
      const p = A.products.find((x) => x.id === id); if (p.status === ss.dataset.st) return;
      $$('.ss', tr).forEach((b) => b.classList.toggle('on', b === ss));
      try { const r = await api(`/api/admin/products/${id}/stock`, { method: 'PATCH', body: { status: ss.dataset.st } }); replaceRow(r.product); toast(`${p.name}: ${STOCK[ss.dataset.st][0]}`); refreshCounts(); }
      catch (err) { toast(err.message, 'error'); replaceRow(p); }
      return;
    }
    if (e.target.closest('[data-dup]') && id) {
      try { const r = await api(`/api/admin/products/${id}/duplicate`, { method: 'POST' }); A.products.push(r.product); toast('Duplicated as a hidden draft. Edit it, then make it visible.'); location.hash = `#/products/${r.product.id}`; }
      catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (e.target.closest('[data-del]') && id) {
      const p = A.products.find((x) => x.id === id);
      if (!(await ask(`Delete “${p.name}”?`, { detail: 'This removes the product and its reviews. Past orders keep their details. This cannot be undone.' }))) return;
      try { await api(`/api/admin/products/${id}`, { method: 'DELETE' }); A.products = A.products.filter((x) => x.id !== id); st.sel.delete(id); reindex(); draw(); toast('Product deleted'); refreshCounts(); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) {
      const ids = [...st.sel]; if (!ids.length) return;
      const action = bulk.dataset.bulk, value = bulk.dataset.v;
      if (action === 'delete' && !(await ask(`Delete ${plural(ids.length, 'product')}?`, { detail: 'This cannot be undone.' }))) return;
      try { await api('/api/admin/products/bulk', { method: 'POST', body: { ids, action, value: action === 'active' ? value === '1' : value } }); toast(`Updated ${plural(ids.length, 'product')}`); st.sel.clear(); await loadProducts(true); reindex(); draw(); refreshCounts(); }
      catch (err) { toast(err.message, 'error'); }
    }
  });
  el.addEventListener('change', async (e) => {
    const t = e.target; const tr = t.closest('tr[data-id]'); const id = tr?.dataset.id;
    if (t.id === 'selall') { $$('.rowsel', el).forEach((x) => { x.checked = t.checked; const rid = x.closest('tr').dataset.id; if (t.checked) st.sel.add(rid); else st.sel.delete(rid); }); updateBulk(); return; }
    if (t.classList.contains('rowsel')) { if (t.checked) st.sel.add(id); else st.sel.delete(id); updateBulk(); return; }
    if (t.classList.contains('qty-in')) {
      const p = A.products.find((x) => x.id === id);
      const qty = t.value === '' ? null : Math.max(0, Math.floor(Number(t.value)));
      try { const r = await api(`/api/admin/products/${id}/stock`, { method: 'PATCH', body: { qty } }); replaceRow(r.product); toast(qty == null ? `${p.name}: quantity not tracked` : `${p.name}: ${qty} in stock → ${STOCK[r.product.status][0]}`); refreshCounts(); }
      catch (err) { toast(err.message, 'error'); replaceRow(p); }
      return;
    }
    if (t.classList.contains('price-in')) {
      const p = A.products.find((x) => x.id === id);
      const price = Number(t.value);
      if (t.value === '' || !Number.isFinite(price) || price < 0) { toast('Type the price in taka, e.g. 350', 'error'); replaceRow(p); return; }
      if (price === p.price) return;
      try {
        const r = await api(`/api/admin/products/${id}`, { method: 'PUT', body: { price } });
        const saleEnded = p.compare && !r.product.compare;
        replaceRow(r.product);
        toast(`${p.name}: price ${money(r.product.price)}${saleEnded ? ' (higher than the old price, so the sale was removed)' : ''}${r.product.active ? '' : '. Turn on Visible to show it in the shop.'}`);
      } catch (err) { toast(err.message, 'error'); replaceRow(p); }
      return;
    }
    if (t.classList.contains('act-in')) {
      const p = A.products.find((x) => x.id === id);
      try { const r = await api(`/api/admin/products/${id}`, { method: 'PUT', body: { active: t.checked } }); replaceRow(r.product); toast(t.checked ? `${p.name} is now visible in the shop` : `${p.name} is hidden from the shop`); }
      catch (err) { toast(err.message, 'error'); t.checked = !t.checked; }
    }
  });
  draw();
}

/* ------------------------------------------------------- product editor */
/* --------------------------------------------- photo auto-fit (in browser) */
// Every frame in the shop has a fixed shape: product photos 4:5, category tiles square.
// Photos of any size or shape are fitted to that shape before upload, so nothing is stretched,
// layouts stay even, and the product itself is never cut off.
const PHOTO_PRESETS = { product: { w: 1200, h: 1500 }, category: { w: 800, h: 800 } };
const photoPrefs = () => A.settings?.photos || { fit: 'auto', bg: 'auto' };
function drawCover(ctx, src, W, H, zoom = 1) {
  const s = Math.max(W / src.width, H / src.height) * zoom, w = src.width * s, h = src.height * s;
  ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
}
/** Colour of the photo's border if it is plain (studio shot), '#ffffff' for transparent PNGs, else null. */
function plainEdge(src) {
  const N = 48, c = document.createElement('canvas'); c.width = N; c.height = N;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data, px = [];
  for (let i = 0; i < N; i++) for (const [cx, cy] of [[i, 0], [i, N - 1], [0, i], [N - 1, i]]) { const k = (cy * N + cx) * 4; px.push([d[k], d[k + 1], d[k + 2], d[k + 3]]); }
  const mean = [0, 1, 2, 3].map((j) => px.reduce((s, p) => s + p[j], 0) / px.length);
  if (mean[3] < 200) return '#ffffff';
  const sd = Math.sqrt(px.reduce((s, p) => s + (p[0] - mean[0]) ** 2 + (p[1] - mean[1]) ** 2 + (p[2] - mean[2]) ** 2, 0) / px.length / 3);
  return sd < 16 ? `rgb(${mean.slice(0, 3).map(Math.round).join(',')})` : null;
}
function blurFill(ctx, src, W, H) {
  if ('filter' in ctx) { ctx.filter = `blur(${Math.round(Math.max(W, H) / 28)}px)`; drawCover(ctx, src, W, H, 1.15); ctx.filter = 'none'; }
  else { // no canvas filters (older Safari): shrink then enlarge in steps = soft blur
    let cur = src;
    for (const size of [24, 96]) { const c = document.createElement('canvas'); c.width = size; c.height = Math.max(1, Math.round((size * H) / W)); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; drawCover(x, cur, c.width, c.height); cur = c; }
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cur, 0, 0, W, H);
  }
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, 0, W, H);
}
/** Returns a WEBP/JPEG blob fitted to the preset's shape (or the original file if it can't be read). */
async function prepareImage(file, preset = 'product') {
  if (!/^image\//.test(file.type || 'image/')) throw new Error(`“${file.name}” is not an image.`);
  if (file.type === 'image/gif') return file; // keep animations
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { throw new Error(`Couldn't read “${file.name || 'this photo'}”. Please use a JPG, PNG or WEBP photo (iPhone: Settings › Camera › Formats › Most Compatible).`); }
  const { fit, bg } = photoPrefs(), P = PHOTO_PRESETS[preset] || PHOTO_PRESETS.product;
  const ratio = P.w / P.h, ir = bmp.width / bmp.height;
  let W, H, mode = fit;
  if (fit === 'off') { const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)); W = Math.round(bmp.width * s); H = Math.round(bmp.height * s); }
  else {
    if (fit === 'auto') mode = Math.abs(ir / ratio - 1) <= 0.12 ? 'crop' : 'pad';
    // Never blow a small photo up beyond its real detail.
    const k = Math.min(1, Math.max(mode === 'crop' ? Math.min(bmp.width / P.w, bmp.height / P.h) : Math.max(bmp.width / P.w, bmp.height / P.h), 0.45));
    W = Math.round(P.w * k); H = Math.round(P.h * k);
  }
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  if (fit === 'off') ctx.drawImage(bmp, 0, 0, W, H);
  else if (mode === 'crop') drawCover(ctx, bmp, W, H);
  else {
    const edge = bg === 'white' ? '#ffffff' : bg === 'blur' ? null : plainEdge(bmp);
    if (edge) { ctx.fillStyle = edge; ctx.fillRect(0, 0, W, H); } else blurFill(ctx, bmp, W, H);
    const s = Math.min(W / bmp.width, H / bmp.height), w = bmp.width * s, h = bmp.height * s;
    ctx.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
  }
  bmp.close?.();
  const webp = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.86));
  if (webp && webp.type === 'image/webp') return webp;
  ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); // JPEG has no transparency
  return await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86)) || file;
}
async function uploadImage(file, preset = 'product') {
  await getSettings().catch(() => null);
  const blob = await prepareImage(file, preset);
  const res = await fetch('/api/admin/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type || 'image/jpeg', 'X-Bliss-Upload': '1' }, body: blob });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'Upload failed');
  return d.url;
}
function imageManager(root, images, onChange) {
  const box = $('.img-grid', root), input = $('.img-file', root), drop = $('.img-drop', root);
  const draw = () => {
    box.innerHTML = images.map((src, i) => `<div class="img-tile" data-i="${i}"><img src="${esc(src)}" alt="" loading="lazy">${i === 0 ? '<span class="img-main">Main photo</span>' : ''}<div class="img-tools">${i > 0 ? `<button type="button" class="ibtn sm" data-img="left" title="Move left">${ic('chev-left')}</button><button type="button" class="ibtn sm" data-img="main" title="Make main photo">${ic('star')}</button>` : ''}${i < images.length - 1 ? `<button type="button" class="ibtn sm" data-img="right" title="Move right">${ic('chev-right')}</button>` : ''}<button type="button" class="ibtn sm danger" data-img="rm" title="Remove">${ic('trash')}</button></div></div>`).join('') + (images.length < 10 ? `<button type="button" class="img-add" data-img="add">${ic('plus')}<span>Add photo</span></button>` : '');
  };
  const add = async (files) => {
    const list = [...files].slice(0, 10 - images.length);
    if (!list.length) return;
    drop.classList.add('busy'); drop.querySelector('.img-status').textContent = `Fitting & uploading ${plural(list.length, 'photo')}…`;
    for (const f of list) {
      try { images.push(await uploadImage(f)); draw(); onChange(); }
      catch (err) { toast(err.message, 'error'); }
    }
    drop.classList.remove('busy'); drop.querySelector('.img-status').textContent = '';
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-img]'); if (!b) return;
    const act = b.dataset.img;
    if (act === 'add') { input.click(); return; }
    if (act === 'url') {
      const u = prompt('Paste an image link (https://…)');
      if (u && /^https:\/\/\S+$/i.test(u.trim())) { images.push(u.trim()); draw(); onChange(); } else if (u) toast('Please paste a full https:// image link', 'error');
      return;
    }
    const i = +b.closest('.img-tile').dataset.i;
    if (act === 'rm') images.splice(i, 1);
    else if (act === 'left') [images[i - 1], images[i]] = [images[i], images[i - 1]];
    else if (act === 'right') [images[i + 1], images[i]] = [images[i], images[i + 1]];
    else if (act === 'main') images.unshift(...images.splice(i, 1));
    draw(); onChange();
  });
  input.addEventListener('change', () => { add(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => add(e.dataTransfer.files));
  draw();
}

async function viewProductForm(el, id) {
  await loadProducts();
  if (!A.categories.length) { el.innerHTML = `<div class="empty">${ic('grid', 'empty-ic')}<h2>Create a category first</h2><p>Every product belongs to a category.</p><a class="btn btn-primary" href="#/categories">Add a category</a></div>`; return; }
  const ex = id ? A.products.find((x) => x.id === id) : null;
  if (id && !ex) { el.innerHTML = `<div class="empty">${ic('box', 'empty-ic')}<h2>Product not found</h2><a class="btn btn-ghost" href="#/products">Back to products</a></div>`; return; }
  const v = ex ? structuredClone(ex) : { name: '', slug: '', cat: A.categories[0].id, price: '', compare: '', desc: '', highlights: [], images: [], status: 'in', qty: null, lowStock: null, autoStock: true, tags: [], gender: 'unisex', options: [], featured: false, boxable: false, active: true, keywords: '', cost: null, sku: '', supplier: '', saleEnds: null };
  const knownTags = new Set(OCCASIONS.map(([k]) => k));
  const custom = v.tags.filter((t) => !knownTags.has(t));
  el.innerHTML = `
  <div class="page-head"><div><a class="back" href="#/products">${ic('arrow-left')}Products</a><h1>${ex ? esc(ex.name) : 'Add a product'}</h1>${ex ? `<p>Created ${fmtDate(ex.created)} · ${ex.sold || 0} sold · ${ex.reviewCount || 0} reviews</p>` : '<p>Fill in the details below. Only the name, category and price are required.</p>'}</div>
    <div class="head-actions">${ex ? `<a class="btn btn-ghost" href="/product/${esc(ex.slug)}" target="_blank" rel="noopener">${ic('eye')}View in shop</a>` : ''}</div></div>
  <form id="pform" class="pform" novalidate>
    <div class="pform-main">
      <section class="card"><h2 class="card-title">Basic details</h2>
        <label class="field"><span>Product name *</span><input name="name" required maxlength="120" value="${esc(v.name)}" placeholder="e.g. Rose Gold Heart Pendant"></label>
        <label class="field"><span>Description</span><textarea name="desc" rows="5" maxlength="6000" placeholder="What makes this gift special? Materials, size, what's in the box…">${esc(v.desc)}</textarea></label>
        <label class="field"><span>Highlights <em>(one per line, shown as ticks)</em></span><textarea name="highlights" rows="3" placeholder="Anti-tarnish gold plating&#10;Comes in a velvet box">${esc(v.highlights.join('\n'))}</textarea></label>
      </section>
      <section class="card"><div class="card-head"><h2 class="card-title">Photos</h2><button type="button" class="link" data-img="url">Add by link</button></div>
        <div class="img-drop"><div class="img-grid"></div><input type="file" class="img-file" accept="image/*" multiple hidden><p class="muted small">${ic('upload')} Drag & drop photos here or click <b>Add photo</b>. Any size or shape works: each photo is automatically fitted to the shop's 4:5 frame (without cutting off your product) and compressed in your browser, so your shop stays fast and every photo lines up. The first photo is the main one. <a class="link" href="#/settings?tab=store">Photo settings</a> <span class="img-status"></span></p></div>
      </section>
      <section class="card"><div class="card-head"><h2 class="card-title">Options <em>(size, colour, letter…)</em></h2><button type="button" class="btn btn-sm btn-ghost" id="opt-add">${ic('plus')}Add option</button></div>
        <div id="opts"></div><p class="muted small">Shoppers must pick one value from each option before adding to bag. Example: name <b>Size</b>, values <b>6, 7, 8, 9</b>.</p>
      </section>
      <section class="card"><h2 class="card-title">Search & URL</h2>
        <label class="field"><span>Extra search keywords</span><input name="keywords" maxlength="300" value="${esc(v.keywords)}" placeholder="e.g. locket, gold, mum, bengali: মা"></label>
        <label class="field"><span>URL handle</span><div class="prefix-in"><span>/product/</span><input name="slug" maxlength="80" value="${esc(v.slug)}" placeholder="auto-generated-from-name"></div></label>
      </section>
    </div>
    <div class="pform-side">
      <section class="card"><h2 class="card-title">Visibility</h2>
        <label class="switch-row"><span><b>Show in shop</b><small>Turn off to save as a hidden draft</small></span><label class="switch"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}><span></span></label></label>
        <label class="switch-row"><span><b>Featured</b><small>Shown first in “Featured” sorting</small></span><label class="switch"><input type="checkbox" name="featured" ${v.featured ? 'checked' : ''}><span></span></label></label>
      </section>
      <section class="card"><h2 class="card-title">Price</h2>
        <div class="grid-2"><label class="field"><span>Price (৳) *</span><input name="price" type="number" min="0" step="1" required value="${esc(v.price)}" inputmode="numeric"></label><label class="field"><span>Compare-at (৳)</span><input name="compare" type="number" min="0" step="1" value="${v.compare || ''}" placeholder="Original price" inputmode="numeric"></label></div>
        <p class="muted small" id="disc-note"></p>
        <label class="field" id="sale-ends-f"><span>Sale ends <em>(optional countdown)</em></span><input name="saleEnds" type="datetime-local" value="${esc((v.saleEnds || '').slice(0, 16))}"></label>
        <p class="muted small" id="sale-note">When the time is up, the price goes back to the compare-at price automatically and the countdown disappears.</p>
        <label class="field"><span>Cost price (৳) <em>(what you pay; only you see this)</em></span><input name="cost" type="number" min="0" step="0.01" value="${v.cost ?? ''}" placeholder="e.g. 450" inputmode="decimal"></label>
        <p class="muted small" id="margin-note"></p>
      </section>
      <section class="card stock-card"><h2 class="card-title">Stock</h2>
        <div class="field"><span class="flabel">Stock status shown to shoppers</span><div class="stock-seg big" role="radiogroup">${['in', 'limited', 'out'].map((k) => `<label class="ss ss-${k}"><input type="radio" name="status" value="${k}" ${v.status === k ? 'checked' : ''}>${ic(STOCK[k][1])}<span>${STOCK[k][0]}</span></label>`).join('')}</div></div>
        <label class="field"><span>Quantity available <em>(optional)</em></span><input name="qty" type="number" min="0" step="1" value="${v.qty ?? ''}" placeholder="Leave empty to not track" inputmode="numeric"></label>
        <div class="qty-opts" ${v.qty == null ? 'hidden' : ''}>
          <label class="switch-row"><span><b>Update status automatically</b><small>0 → Out of stock · low → Limited · otherwise In stock</small></span><label class="switch"><input type="checkbox" name="autoStock" ${v.autoStock !== false ? 'checked' : ''}><span></span></label></label>
          <label class="field"><span>“Limited” when quantity is at or below</span><input name="lowStock" type="number" min="0" step="1" value="${v.lowStock ?? ''}" placeholder="${A.lowDefault} (store default)" inputmode="numeric"></label>
        </div>
        <div class="stock-preview" id="stock-preview"></div>
        <div class="grid-2 mt"><label class="field"><span>SKU / code</span><input name="sku" maxlength="40" value="${esc(v.sku || '')}" placeholder="e.g. RNG-014"></label><label class="field"><span>Supplier</span><input name="supplier" maxlength="80" value="${esc(v.supplier || '')}" placeholder="Who you buy from"></label></div>
        ${ex ? `<a class="link small" href="#/inventory?q=${encodeURIComponent(ex.name)}">${ic('history')} Stock history & receive stock</a>` : ''}
      </section>
      <section class="card"><h2 class="card-title">Organise</h2>
        <label class="field"><span>Category *</span><select name="cat">${A.categories.map((c) => `<option value="${c.id}" ${c.id === v.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Who is it for?</span><select name="gender">${[['her', 'Her'], ['him', 'Him'], ['unisex', 'Anyone'], ['kids', 'Kids']].map(([k, l]) => `<option value="${k}" ${v.gender === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="field"><span class="flabel">Occasions & collections</span><div class="tag-chips">${OCCASIONS.map(([k, l]) => `<label class="tchip"><input type="checkbox" name="tag" value="${k}" ${v.tags.includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
          <input name="customTags" class="mt" value="${esc(custom.join(', '))}" placeholder="Other tags, comma separated"></div>
        <label class="switch-row"><span><b>Allow in Gift Box Builder</b><small id="boxable-note">Small items without options work best</small></span><label class="switch"><input type="checkbox" name="boxable" ${v.boxable ? 'checked' : ''}><span></span></label></label>
      </section>
      ${ex ? `<section class="card danger-card"><h2 class="card-title">Danger zone</h2><button type="button" class="btn btn-danger-ghost btn-block" id="pdel">${ic('trash')}Delete this product</button></section>` : ''}
    </div>
    <div class="savebar"><span class="muted" id="save-state">${ex ? 'All changes saved' : 'New product'}</span><a class="btn btn-ghost" href="#/products">Cancel</a><button class="btn btn-primary" type="submit" id="psave">${ic('check')}${ex ? 'Save changes' : 'Create product'}</button></div>
  </form>`;
  const f = $('#pform', el);
  const markDirty = () => { A.dirty = true; $('#save-state', el).textContent = 'Unsaved changes'; $('#save-state', el).classList.add('dirty'); };
  imageManager($('.img-drop', el).closest('.card'), v.images, markDirty);
  // Options repeater
  const drawOpts = () => {
    $('#opts', el).innerHTML = v.options.map((o, i) => `<div class="opt-row" data-i="${i}"><label class="field"><span>Option name</span><input data-o="name" value="${esc(o.name)}" placeholder="Size" maxlength="30"></label><label class="field grow"><span>Values (comma separated)</span><input data-o="values" value="${esc(o.values.join(', '))}" placeholder="6, 7, 8, 9"></label><button type="button" class="ibtn danger" data-orm title="Remove option">${ic('trash')}</button></div>`).join('') || '';
    const has = v.options.some((o) => o.name && o.values.length);
    const bx = f.elements.boxable; bx.disabled = has; if (has) bx.checked = false;
    $('#boxable-note', el).textContent = has ? 'Not available for products with options' : 'Small items without options work best';
  };
  $('#opt-add', el).addEventListener('click', () => { if (v.options.length >= 3) { toast('Up to 3 options per product', 'error'); return; } v.options.push({ name: '', values: [] }); drawOpts(); markDirty(); $(`.opt-row:last-child input`, el)?.focus(); });
  $('#opts', el).addEventListener('input', (e) => { const row = e.target.closest('.opt-row'); const o = v.options[+row.dataset.i]; if (e.target.dataset.o === 'name') o.name = e.target.value; else o.values = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); markDirty(); const has = v.options.some((x) => x.name && x.values.length); f.elements.boxable.disabled = has; if (has) f.elements.boxable.checked = false; });
  $('#opts', el).addEventListener('click', (e) => { if (e.target.closest('[data-orm]')) { v.options.splice(+e.target.closest('.opt-row').dataset.i, 1); drawOpts(); markDirty(); } });
  drawOpts();
  const preview = () => {
    const x = formObj(f);
    const qty = x.qty === '' ? null : Math.max(0, Math.floor(+x.qty));
    $('.qty-opts', el).hidden = qty == null;
    const low = x.lowStock === '' ? A.lowDefault : +x.lowStock;
    const auto = qty != null && f.elements.autoStock.checked;
    let status = x.status;
    if (auto) status = qty <= 0 ? 'out' : qty <= low ? 'limited' : 'in';
    else if (qty === 0) status = 'out';
    $$('input[name=status]', f).forEach((r) => { r.disabled = auto; r.closest('.ss').classList.toggle('locked', auto); });
    $$('.stock-card .ss', el).forEach((l) => l.classList.toggle('on', l.querySelector('input').value === status));
    const shopper = status === 'out' ? '“Out of stock”, and Add to bag is disabled' : status === 'limited' ? (qty != null ? `“Only ${qty} left”` : '“Limited stock”') : '“In stock”';
    $('#stock-preview', el).innerHTML = `${ic('eye')}<span>Shoppers will see ${shopper}.${auto ? ' Status is set automatically from quantity.' : ''}</span>`;
    const p = +x.price, c = +x.compare;
    $('#disc-note', el).textContent = c > p && p > 0 ? `Shown as ${Math.round((1 - p / c) * 100)}% off (saves ৳${(c - p).toLocaleString('en-IN')}).` : 'Add a compare-at price to show a discount badge.';
    $('#sale-ends-f', el).hidden = $('#sale-note', el).hidden = !(c > p && p > 0);
    const cost = x.cost === '' ? null : +x.cost;
    $('#margin-note', el).innerHTML = cost != null && p > 0 ? `Profit per item: <b>${money(p - cost)}</b> (${Math.round(((p - cost) / p) * 100)}% margin) before delivery and packaging.` : 'Add a cost price to see real profit in your reports.';
  };
  f.addEventListener('input', () => { markDirty(); preview(); });
  f.addEventListener('change', preview);
  f.elements.name.addEventListener('input', () => { if (!ex) f.elements.slug.placeholder = slugify(f.elements.name.value) || 'auto-generated-from-name'; });
  preview();
  $('#pdel', el)?.addEventListener('click', async () => {
    if (!(await ask(`Delete “${ex.name}”?`, { detail: 'This removes the product and its reviews. This cannot be undone.' }))) return;
    try { await api(`/api/admin/products/${ex.id}`, { method: 'DELETE' }); A.products = A.products.filter((x) => x.id !== ex.id); A.dirty = false; toast('Product deleted'); location.hash = '#/products'; refreshCounts(); }
    catch (err) { toast(err.message, 'error'); }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const x = formObj(f);
    $$('.field.invalid', f).forEach((n) => n.classList.remove('invalid'));
    const bad = (name, msg) => { const n = f.elements[name]; n.closest('.field')?.classList.add('invalid'); n.focus(); toast(msg, 'error'); };
    if (x.name.trim().length < 2) return bad('name', 'Please enter a product name');
    if (x.price === '' || +x.price < 0) return bad('price', 'Please enter a price');
    const tags = [...$$('input[name=tag]:checked', f).map((t) => t.value), ...x.customTags.split(',').map((t) => slugify(t.trim())).filter((t) => t && t !== 'item')];
    const body = {
      name: x.name, desc: x.desc, highlights: x.highlights, images: v.images, keywords: x.keywords, slug: x.slug,
      active: x.active, featured: x.featured, price: +x.price, compare: x.compare === '' ? 0 : +x.compare,
      status: f.querySelector('input[name=status]:checked')?.value || v.status,
      qty: x.qty === '' ? null : +x.qty, autoStock: f.elements.autoStock.checked, lowStock: x.lowStock === '' ? null : +x.lowStock,
      cost: x.cost === '' ? null : +x.cost, sku: x.sku, supplier: x.supplier, saleEnds: x.saleEnds || '',
      cat: x.cat, gender: x.gender, tags, boxable: f.elements.boxable.checked && !f.elements.boxable.disabled,
      options: v.options.filter((o) => o.name.trim() && o.values.length),
    };
    const btn = $('#psave', el); setBusy(btn, true);
    try {
      const r = ex ? await api(`/api/admin/products/${ex.id}`, { method: 'PUT', body }) : await api('/api/admin/products', { method: 'POST', body });
      A.dirty = false;
      const i = A.products.findIndex((p) => p.id === r.product.id);
      if (i >= 0) A.products[i] = r.product; else A.products.unshift(r.product);
      toast(ex ? 'Saved! Your shop is updated.' : 'Product created and live in your shop!');
      refreshCounts();
      if (!ex) location.hash = `#/products/${r.product.id}`; else route();
    } catch (err) { setBusy(btn, false); if (err.data?.field && f.elements[err.data.field]) bad(err.data.field, err.message); else toast(err.message, 'error'); }
  });
}

/* ------------------------------------------------- spreadsheet import */
// Reads Excel (.xlsx) and CSV files in the browser (no libraries), guesses which column is which,
// shows the server's preview (nothing is saved), and imports only the rows you approve.
// Photos: a cell naming a photo file, or a photo named after the product / SKU, is matched to
// the photos you add; they are fitted and uploaded when you approve.
const MULTI_FIELDS = new Set(['images', 'tags', 'highlights']);
const FIELD_BY_KEY = new Map();
for (const [f, ...names] of SHEET_FIELDS) for (const n of names) if (!FIELD_BY_KEY.has(sheetKey(n))) FIELD_BY_KEY.set(sheetKey(n), f);
const FIELD_HINTS = [[/(compare|regular|old|original|before).*price|price.*(compare|regular|old|before)/, 'compare'], [/cost|buying|purchase/, 'cost'], [/price|mrp|rate|taka/, 'price'], [/image|photo|picture|img/, 'images'], [/quantity|qty|stock/, 'qty'], [/descr|detail/, 'desc'], [/categ|catag/, 'category'], [/name|title/, 'name'], [/occasion|tag/, 'tags']];
function guessField(header) {
  const k = sheetKey(header);
  if (!k) return '';
  return FIELD_BY_KEY.get(k) || FIELD_BY_KEY.get(k.replace(/\d+$/, '')) || FIELD_HINTS.find(([re]) => re.test(k))?.[1] || '';
}
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
/** Excel saves CSV as UTF-8 or as the Windows code page; try UTF-8 first. */
function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
/** Minimal ZIP reader (an .xlsx file is a ZIP of XML files). */
function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  let end = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('This file is damaged or not a real Excel file.');
  const files = new Map();
  for (let n = 0, p = dv.getUint32(end + 16, true), total = dv.getUint16(end + 10, true); n < total && dv.getUint32(p, true) === 0x02014b50; n++) {
    const nameLen = dv.getUint16(p + 28, true);
    files.set(dec.decode(u8.subarray(p + 46, p + 46 + nameLen)), { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), at: dv.getUint32(p + 42, true) });
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return async (name) => {
    const f = files.get(name.replace(/^\//, ''));
    if (!f) return null;
    const start = f.at + 30 + dv.getUint16(f.at + 26, true) + dv.getUint16(f.at + 28, true), data = u8.subarray(start, start + f.size);
    if (f.method === 0) return dec.decode(data);
    if (f.method !== 8) throw new Error('This Excel file uses a format we cannot read. Please save it as CSV.');
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
}
async function readXlsx(buf) {
  const read = unzip(buf), xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const tag = (node, name) => [...node.getElementsByTagName(name)];
  const shared = [];
  const ss = await read('xl/sharedStrings.xml');
  if (ss) for (const si of tag(xml(ss), 'si')) shared.push(tag(si, 't').filter((t) => t.parentNode.nodeName !== 'rPh').map((t) => t.textContent).join(''));
  // The first sheet of the workbook (its file name is listed in the workbook's relationships).
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await read('xl/workbook.xml'), rels = await read('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const rid = tag(xml(wb), 'sheet')[0]?.getAttribute('r:id');
    const target = tag(xml(rels), 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  const sheet = await read(sheetPath);
  if (!sheet) throw new Error('Could not find a sheet in this Excel file.');
  const col = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  return tag(xml(sheet), 'row').map((row) => {
    const cells = [];
    tag(row, 'c').forEach((c, i) => {
      const t = c.getAttribute('t'), v = tag(c, 'v')[0]?.textContent ?? '';
      let val = t === 's' ? shared[+v] ?? '' : t === 'inlineStr' ? tag(c, 't').map((x) => x.textContent).join('') : t === 'b' ? (v === '1' ? 'yes' : 'no') : v;
      if ((!t || t === 'n') && val !== '' && Number.isFinite(+val)) val = String(Math.round(+val * 1e6) / 1e6); // 199.99999999 -> 200
      const r = c.getAttribute('r');
      cells[r ? col(r) : i] = val;
    });
    return { line: Number(row.getAttribute('r')) || 0, cells: Array.from(cells, (x) => x ?? '') };
  });
}
async function readSheet(file) {
  const buf = await file.arrayBuffer(), b = new Uint8Array(buf.slice(0, 4));
  if (b[0] === 0x50 && b[1] === 0x4b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open Excel files. Please update it, or save the sheet as CSV.');
    return readXlsx(buf);
  }
  if (b[0] === 0xd0 && b[1] === 0xcf) throw new Error('This is an old Excel file (.xls). In Excel choose File › Save As › Excel Workbook (.xlsx) or CSV, then upload that.');
  if (/\.(numbers|ods|pdf|docx?)$/i.test(file.name)) throw new Error('Please upload an Excel (.xlsx) or CSV file.');
  return parseCsv(decodeText(buf)).map((cells, i) => ({ line: i + 1, cells }));
}
const csvLine = (cells) => cells.map((v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',');
function downloadTemplate() {
  const rows = [
    ['SKU', 'Name', 'Category', 'Price', 'Compare at price', 'Cost', 'Quantity', 'Visible', 'For', 'Occasions', 'Highlights', 'Description', 'Images'],
    ['AT-100', 'Example Attar 6ml', 'Attar', '350', '', '200', '20', 'yes', 'unisex', 'eid, birthday', 'Long-lasting | Alcohol-free', 'A soft floral attar.', 'example-attar.jpg'],
    ['BQ-100', 'Example Sunflower Bouquet', 'Bouquets', '450', '500', '', '', 'no', 'her', 'birthday, just-because', 'Hand-wrapped', 'Three sunflowers in kraft paper.', 'https://example.com/sunflower.jpg'],
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(csvLine).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = 'bliss-products-template.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function viewProductImport(el) {
  const st = { file: null, head: [], data: [], map: [], photos: [], thumbs: [], photoKey: new Map(), existing: 'update', rows: [], preview: null, sel: new Set(), tab: 'all', loading: false, seq: 0 };
  const FIELD_OPTS = SHEET_FIELDS.map(([f, h]) => [f, h]);
  const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|avif|heic)$/i.test(f.name);
  const fileName = (s) => String(s).split(/[\\/]/).pop().toLowerCase();
  const stem = (s) => fileName(s).replace(/\.[a-z0-9]{2,5}$/, '');
  const findPhoto = (token) => st.photoKey.get(fileName(token)) ?? st.photoKey.get(stem(token)) ?? st.photoKey.get('k:' + sheetKey(stem(token)));
  const thumb = (src) => (/^local:\d+$/.test(src || '') ? st.thumbs[+src.slice(6)] : src) || '/img/placeholder.svg';

  el.innerHTML = `
  <div class="page-head"><div><a class="back" href="#/products">${ic('arrow-left')}Products</a><h1>Import products</h1><p>Add or update many products at once from an Excel (.xlsx) or CSV sheet. You see a preview first, and <b>nothing changes in your shop until you approve it</b>.</p></div>
    <div class="head-actions"><button type="button" class="btn btn-ghost" id="imp-tpl">${ic('download')}Download template</button><a class="btn btn-ghost" href="/api/admin/products.csv" download>${ic('table')}Export current products</a></div></div>
  <section class="card"><h2 class="card-title">1. Choose your files</h2>
    <div class="imp-files">
      <div class="imp-drop" id="drop-sheet" tabindex="0" role="button"><input type="file" id="in-sheet" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden><div id="sheet-info"></div></div>
      <div class="imp-drop" id="drop-photos" tabindex="0" role="button"><input type="file" id="in-photos" accept="image/*" multiple hidden><div id="photo-info"></div></div>
    </div>
    <div class="imp-opt"><span class="flabel">If a product already exists (same ID, SKU or name):</span><div class="seg-sm" id="imp-existing"><button type="button" data-v="update" class="on">Update it</button><button type="button" data-v="skip">Skip it</button></div></div>
    <details class="imp-help"><summary>${ic('info')}How to fill in the sheet</summary><ul>
      <li><b>Required for new products:</b> Name, Category and Price. A new category name is created for you.</li>
      <li><b>Updating:</b> rows are matched to your products by ID, SKU or name. Only the columns you fill in change; empty cells keep the current value. Tip: <b>Export current products</b>, edit the sheet, and import it back.</li>
      <li><b>Visible:</b> yes / no. <b>Stock status:</b> In stock, Limited or Out of stock (or fill in Quantity and it is set for you). <b>For:</b> her, him, unisex or kids.</li>
      <li><b>Several values in one cell</b> (Images, Highlights): separate them with <b>|</b>. Occasions: separate with commas, e.g. <i>birthday, anniversary, eid</i>. Options: <i>Size: 6 | 7 | 8; Colour: Gold | Silver</i>.</li>
      <li><b>Photos:</b> put the photo's file name (e.g. <i>aroosha.jpg</i>) or a https:// link in the Images column and add the photo files above. Or simply name each photo after the product or SKU (e.g. <i>Aroosha.jpg</i>, <i>AT-001.jpg</i>).</li>
    </ul></details>
  </section>
  <div id="imp-map"></div>
  <div id="imp-preview"></div>`;

  const drawFiles = () => {
    $('#sheet-info', el).innerHTML = st.file
      ? `${ic('table', 'imp-ic')}<div><b>${esc(st.file.name)}</b><small>${plural(st.data.length, 'row')} · ${plural(st.head.length, 'column')}</small><button type="button" class="link" data-pick="sheet">Choose another file</button></div>`
      : `${ic('table', 'imp-ic')}<div><b>Spreadsheet</b><small>Drop your .xlsx or .csv file here, or <span class="link">choose a file</span></small></div>`;
    const used = st.preview ? new Set(st.rows.flatMap((r) => [...String(r.images || '').matchAll(/local:(\d+)/g)].map((m) => +m[1]))) : null;
    $('#photo-info', el).innerHTML = st.photos.length
      ? `${ic('image', 'imp-ic')}<div><b>${plural(st.photos.length, 'photo')}</b><small>${used ? `${used.size} matched to rows${used.size < st.photos.length ? ` · ${st.photos.length - used.size} not used` : ''}` : 'Choose a spreadsheet to match them'}</small><span class="imp-thumbs">${st.thumbs.slice(0, 12).map((u, i) => `<img src="${u}" alt="" class="${used && !used.has(i) ? 'unused' : ''}" title="${esc(st.photos[i].name)}">`).join('')}${st.photos.length > 12 ? `<em>+${st.photos.length - 12}</em>` : ''}</span><span><button type="button" class="link" data-pick="photos">Add more</button> · <button type="button" class="link" id="photos-clear">Remove all</button></span></div>`
      : `${ic('image', 'imp-ic')}<div><b>Photos <em>(optional)</em></b><small>Drop product photos here, or <span class="link">choose photos</span>. They are matched by file name.</small></div>`;
  };

  const drawMap = () => {
    if (!st.file) { $('#imp-map', el).innerHTML = ''; return; }
    const hasKey = st.map.some((f) => f === 'name' || f === 'sku' || f === 'id');
    const sample = (ci) => st.data.map((r) => String(r.cells[ci] ?? '').trim()).find(Boolean) || '';
    const used = st.map.filter(Boolean).map((f) => FIELD_OPTS.find(([k]) => k === f)?.[1]);
    $('#imp-map', el).innerHTML = `<section class="card"><details class="imp-cols"${hasKey ? '' : ' open'}><summary><h2 class="card-title">2. Check the columns</h2><span class="muted small">${hasKey ? `Reading: ${esc([...new Set(used)].join(', '))}${st.map.some((f) => !f) ? ` · ${plural(st.map.filter((f) => !f).length, 'column')} ignored` : ''}` : ''} <span class="link">Change</span></span></summary>
      ${hasKey ? '' : `<p class="imp-warn">${ic('alert')}Choose which column has the <b>product name</b> (or SKU).</p>`}
      <div class="tbl-wrap"><table class="tbl imp-maptbl"><thead><tr><th>Column in your file</th><th>Example</th><th>Use as</th></tr></thead><tbody>
      ${st.head.map((h, ci) => `<tr><td><b>${esc(h || `Column ${ci + 1}`)}</b></td><td class="muted">${esc(sample(ci).slice(0, 60))}</td><td><select data-col="${ci}" aria-label="Use column ${esc(h)} as"><option value="">Don't import</option>${FIELD_OPTS.map(([f, l]) => `<option value="${f}" ${st.map[ci] === f ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div></details></section>`;
  };

  const ACT = { create: ['New', 'act-new', 'plus'], update: ['Update', 'act-upd', 'edit'], same: ['No change', 'act-same', 'check'], skip: ['Skipped', 'act-same', 'minus'], error: ['Problem', 'act-err', 'alert'] };
  const MONEY_FIELDS = new Set(['Price', 'Compare-at price', 'Cost']);
  const showVal = (field, v) => (MONEY_FIELDS.has(field) && v !== '—' && Number.isFinite(+v) ? money(v) : v);
  const selectable = (x) => x.action === 'create' || x.action === 'update';
  const rowHtml = (x) => {
    const [label, cls, icon] = ACT[x.action];
    const msgs = [
      ...x.errors.map((m) => `<li class="err">${ic('x-circle')}${esc(m)}</li>`),
      ...x.warnings.map((m) => `<li class="warn">${ic('alert')}${esc(m)}</li>`),
      ...x.changes.map((c) => `<li>${esc(c.field)}: <s>${esc(showVal(c.field, c.from))}</s> → <b>${esc(showVal(c.field, c.to))}</b></li>`),
    ];
    return `<tr data-line="${x.line}" class="imp-row ${cls}">
      <td class="sel">${selectable(x) ? `<label class="check"><input type="checkbox" class="imp-sel" ${st.sel.has(x.line) ? 'checked' : ''} aria-label="Import ${esc(x.name)}"><span class="box"></span></label>` : ''}</td>
      <td class="p-cell"><img src="${esc(thumb(x.image))}" alt="" width="44" height="55" loading="lazy"><div><b class="p-name">${esc(x.name)}</b><small>Row ${x.line}${x.category ? ` · ${esc(x.category)}` : ''}${x.newCategory ? ' <span class="pill pill-newcat">new category</span>' : ''}</small></div></td>
      <td class="num price-c">${x.price != null ? `<b>${money(x.price)}</b>${x.compare ? `<s>${money(x.compare)}</s>` : ''}` : '—'}</td>
      <td class="imp-stock">${x.status ? stockPill(x.status) : ''}${x.qty != null ? `<small class="muted"> ${x.qty} pcs</small>` : ''}</td>
      <td class="imp-vis">${x.active == null ? '' : x.active ? 'Visible' : '<span class="muted">Hidden</span>'}</td>
      <td class="imp-what"><span class="pill ${cls}">${ic(icon)}${label}</span>${msgs.length ? `<ul class="imp-msgs">${msgs.join('')}</ul>` : ''}</td>
    </tr>`;
  };

  const drawPreview = () => {
    const box = $('#imp-preview', el);
    if (!st.file) { box.innerHTML = ''; return; }
    if (st.loading && !st.preview) { box.innerHTML = '<section class="card"><div class="loading"><span class="spin"></span></div></section>'; return; }
    const p = st.preview;
    if (!p) { box.innerHTML = ''; return; }
    const s = p.summary;
    if (!s.total) { box.innerHTML = `<section class="card"><div class="empty">${ic('table', 'empty-ic')}<h2>No products found in this file</h2><p>Check that the first row has column names (Name, Category, Price…) and the products are listed below it.</p></div></section>`; return; }
    const tabs = [['all', 'All rows', s.total], ['create', 'New', s.create], ['update', 'Updates', s.update], ['error', 'Problems', s.error]].filter(([k, , n]) => k === 'all' || n);
    if (!tabs.some(([k]) => k === st.tab)) st.tab = 'all';
    const list = p.rows.filter((x) => st.tab === 'all' || x.action === st.tab);
    const pickable = p.rows.filter(selectable), n = pickable.filter((x) => st.sel.has(x.line)).length;
    box.innerHTML = `<section class="card card-flush imp-review${st.loading ? ' is-loading' : ''}">
      <div class="imp-sum"><h2 class="card-title">3. Review & approve</h2><div class="imp-chips">
        ${s.create ? `<span class="pill act-new">${ic('plus')}${plural(s.create, 'new product')}</span>` : ''}
        ${s.update ? `<span class="pill act-upd">${ic('edit')}${plural(s.update, 'update')}</span>` : ''}
        ${s.same ? `<span class="pill act-same">${ic('check')}${s.same} unchanged</span>` : ''}
        ${s.skip ? `<span class="pill act-same">${ic('minus')}${s.skip} skipped (already exist)</span>` : ''}
        ${s.error ? `<span class="pill act-err">${ic('alert')}${plural(s.error, 'row')} with problems (not imported)</span>` : ''}
        ${p.newCategories.length ? `<span class="pill pill-newcat">${ic('grid')}New ${p.newCategories.length > 1 ? 'categories' : 'category'}: ${esc(p.newCategories.join(', '))}</span>` : ''}
      </div></div>
      <div class="filter-tabs">${tabs.map(([k, l, c]) => `<button type="button" class="ftab${st.tab === k ? ' on' : ''}" data-tab="${k}">${l}<b>${c}</b></button>`).join('')}</div>
      <div class="tbl-wrap"><table class="tbl tbl-products imp-tbl"><thead><tr><th class="sel">${pickable.length ? `<label class="check"><input type="checkbox" id="imp-all" ${n === pickable.length ? 'checked' : ''} aria-label="Select all"><span class="box"></span></label>` : ''}</th><th>Product</th><th class="num">Price</th><th>Stock</th><th>Shop</th><th>What will happen</th></tr></thead>
      <tbody>${list.map(rowHtml).join('') || `<tr><td colspan="6" class="muted">Nothing here.</td></tr>`}</tbody></table></div>
    </section>
    <div class="savebar"><span id="imp-status">${pickable.length ? `<b>${n}</b> of ${plural(pickable.length, 'product')} selected` : 'Nothing to import: fix the problems in your sheet and choose it again.'}</span><a class="btn btn-ghost" href="#/products">Cancel</a><button type="button" class="btn btn-primary" id="imp-go" ${n ? '' : 'disabled'}>${ic('check')}Import ${plural(n, 'product')}</button></div>`;
  };
  const draw = () => { drawFiles(); drawMap(); drawPreview(); };

  const buildRows = () => {
    const rows = [];
    for (const r of st.data) {
      const o = { line: r.line };
      st.map.forEach((f, ci) => {
        const v = String(r.cells[ci] ?? '').trim();
        if (f && v) o[f] = o[f] && MULTI_FIELDS.has(f) ? `${o[f]}\n${v}` : o[f] || v;
      });
      if (Object.keys(o).length < 2) continue;
      if (st.photos.length) {
        if (o.images) o.images = o.images.split(/\s*[|\n,]\s*/).filter(Boolean).map((t) => { if (/^(https?:\/\/|\/)/i.test(t)) return t; const i = findPhoto(t); return i != null ? `local:${i}` : t; }).join('\n');
        else { const i = [o.sku, o.name].filter(Boolean).map((v) => st.photoKey.get('k:' + sheetKey(v))).find((x) => x != null); if (i != null) o.images = `local:${i}`; }
      }
      rows.push(o);
    }
    return rows;
  };
  const runPreview = async () => {
    if (!st.file) return;
    st.rows = buildRows();
    if (!st.map.some((f) => f === 'name' || f === 'sku' || f === 'id')) { st.preview = null; draw(); return; }
    const my = ++st.seq; st.loading = true; drawPreview();
    try {
      const r = await api('/api/admin/products/import', { method: 'POST', body: { rows: st.rows, existing: st.existing, commit: false } });
      if (my !== st.seq) return;
      st.preview = r; st.sel = new Set(r.rows.filter(selectable).map((x) => x.line));
    } catch (err) { if (my === st.seq) { st.preview = null; toast(err.message, 'error'); } }
    finally { if (my === st.seq) { st.loading = false; draw(); } }
  };

  const setSheet = async (file) => {
    try {
      const all = (await readSheet(file)).filter((r) => r.cells.some((c) => String(c).trim()));
      if (!all.length) throw new Error('This file is empty.');
      // The header is the row (among the first 10) whose cells look most like column names.
      let hi = 0, best = -1;
      all.slice(0, 10).forEach((r, i) => { const n = new Set(r.cells.map(guessField).filter(Boolean)).size; if (n > best) { best = n; hi = i; } });
      st.file = file; st.head = all[hi].cells.map((c) => String(c).trim()); st.data = all.slice(hi + 1);
      const taken = new Set();
      st.map = st.head.map((h) => { const f = guessField(h); if (!f || (taken.has(f) && !MULTI_FIELDS.has(f))) return ''; taken.add(f); return f; });
      st.preview = null; st.tab = 'all';
      draw(); runPreview();
    } catch (err) { toast(err.message || 'Could not read this file.', 'error'); }
  };
  const addPhotos = (files) => {
    const list = [...files].filter(isImage);
    if (!list.length) return;
    for (const f of list) {
      const i = st.photos.length;
      st.photos.push(f); st.thumbs.push(URL.createObjectURL(f));
      for (const k of [fileName(f.name), stem(f.name), 'k:' + sheetKey(stem(f.name))]) if (!st.photoKey.has(k)) st.photoKey.set(k, i);
    }
    drawFiles(); runPreview();
  };
  const takeFiles = (files) => {
    const list = [...files], sheet = list.find((f) => !isImage(f));
    addPhotos(list.filter(isImage));
    if (sheet) setSheet(sheet);
  };

  const commit = async (btn) => {
    const chosen = st.rows.filter((r) => st.sel.has(r.line));
    if (!chosen.length) return;
    setBusy(btn, true, 'Importing…');
    const status = $('#imp-status', el);
    try {
      const need = [...new Set(chosen.flatMap((r) => [...String(r.images || '').matchAll(/local:(\d+)/g)].map((m) => +m[1])))];
      const urls = new Map();
      for (const [k, i] of need.entries()) { status.textContent = `Fitting & uploading photo ${k + 1} of ${need.length}…`; urls.set(i, await uploadImage(st.photos[i])); }
      status.textContent = 'Saving products…';
      const rows = chosen.map((r) => (r.images ? { ...r, images: r.images.replace(/local:(\d+)/g, (_, i) => urls.get(+i)) } : r));
      const res = await api('/api/admin/products/import', { method: 'POST', body: { rows, existing: st.existing, commit: true } });
      A.products = [];
      refreshCounts();
      const d = res.done;
      el.innerHTML = `<div class="page-head"><div><a class="back" href="#/products">${ic('arrow-left')}Products</a><h1>Import finished</h1></div></div>
        <section class="card"><div class="empty">${ic('check-circle', 'empty-ic')}<h2>${[d.created && plural(d.created, 'product') + ' added', d.updated && plural(d.updated, 'product') + ' updated'].filter(Boolean).join(' · ') || 'Nothing was changed'}</h2>
        ${res.newCategories.length ? `<p>New ${res.newCategories.length > 1 ? 'categories' : 'category'} created: <b>${esc(res.newCategories.join(', '))}</b>. Add a photo for ${res.newCategories.length > 1 ? 'them' : 'it'} in <a class="link" href="#/categories">Categories</a>.</p>` : ''}
        ${res.failed.length ? `<ul class="imp-msgs">${res.failed.map((f) => `<li class="err">${ic('x-circle')}Row ${f.line} (${esc(f.name)}): ${esc(f.error)}</li>`).join('')}</ul>` : ''}
        <div class="head-actions"><a class="btn btn-primary" href="#/products">View products</a><a class="btn btn-ghost" href="#/products/import" id="imp-again">Import another file</a></div></div></section>`;
      $('#imp-again', el).addEventListener('click', (e) => { e.preventDefault(); route(); });
      st.thumbs.forEach((u) => URL.revokeObjectURL(u));
      toast('Import finished');
    } catch (err) { toast(err.message, 'error'); setBusy(btn, false); drawPreview(); }
  };

  // Events
  const pick = (which) => $(which === 'sheet' ? '#in-sheet' : '#in-photos', el).click();
  for (const [id, which] of [['#drop-sheet', 'sheet'], ['#drop-photos', 'photos']]) {
    const zone = $(id, el);
    zone.addEventListener('click', (e) => { if (e.target.closest('#photos-clear, input')) return; const b = e.target.closest('[data-pick]'); pick(b ? b.dataset.pick : which); });
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(which); } });
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
    zone.addEventListener('drop', (e) => takeFiles(e.dataTransfer.files));
  }
  $('#in-sheet', el).addEventListener('change', (e) => { if (e.target.files[0]) takeFiles(e.target.files); e.target.value = ''; });
  $('#in-photos', el).addEventListener('change', (e) => { addPhotos(e.target.files); e.target.value = ''; });
  $('#imp-tpl', el).addEventListener('click', downloadTemplate);
  el.addEventListener('click', (e) => {
    if (e.target.closest('#photos-clear')) { st.thumbs.forEach((u) => URL.revokeObjectURL(u)); st.photos = []; st.thumbs = []; st.photoKey.clear(); drawFiles(); runPreview(); return; }
    const seg = e.target.closest('#imp-existing button');
    if (seg) { st.existing = seg.dataset.v; $$('#imp-existing button', el).forEach((b) => b.classList.toggle('on', b === seg)); runPreview(); return; }
    const tab = e.target.closest('.imp-review .ftab');
    if (tab) { st.tab = tab.dataset.tab; drawPreview(); return; }
    const go = e.target.closest('#imp-go');
    if (go) commit(go);
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('select[data-col]')) {
      const ci = +t.dataset.col, f = t.value;
      if (f && !MULTI_FIELDS.has(f)) st.map = st.map.map((x, k) => (x === f && k !== ci ? '' : x));
      st.map[ci] = f;
      drawMap(); $('.imp-cols', el).open = true; runPreview();
      return;
    }
    if (t.id === 'imp-all') { for (const x of st.preview.rows.filter(selectable)) { if (t.checked) st.sel.add(x.line); else st.sel.delete(x.line); } $$('.imp-sel', el).forEach((c) => { c.checked = t.checked; }); updateSel(); return; }
    if (t.classList.contains('imp-sel')) { const line = +t.closest('tr').dataset.line; if (t.checked) st.sel.add(line); else st.sel.delete(line); updateSel(); }
  });
  const updateSel = () => {
    const pickable = st.preview.rows.filter(selectable), n = pickable.filter((x) => st.sel.has(x.line)).length;
    $('#imp-status', el).innerHTML = `<b>${n}</b> of ${plural(pickable.length, 'product')} selected`;
    const go = $('#imp-go', el); go.disabled = !n; go.innerHTML = `${ic('check')}Import ${plural(n, 'product')}`;
    const all = $('#imp-all', el); if (all) all.checked = n === pickable.length;
  };
  draw();
}

/* ================================================================= orders */
async function viewOrders(el, params) {
  const st = { status: params.get('status') || '', q: params.get('q') || '', page: Number(params.get('page')) || 1, pay: params.get('pay') || '', channel: params.get('channel') || '', from: params.get('from') || '', to: params.get('to') || '', sel: new Set() };
  el.innerHTML = `<div class="page-head"><div><h1>Orders</h1><p>Confirm, pack and deliver. Red flags show customers who returned or cancelled before.</p></div><div class="head-actions"><a class="btn btn-ghost" id="ocsv" href="/api/admin/orders.csv" download>${ic('download')}Export CSV</a><a class="btn btn-primary" href="#/orders/new">${ic('plus')}New order</a></div></div>
  <div class="card card-flush"><div class="filter-tabs" id="otabs"></div>
    <div class="toolbar"><label class="search-in">${ic('search')}<input id="oq" placeholder="Search order ID, name, phone or tracking number…" value="${esc(st.q)}"></label>
      <select id="opay" aria-label="Payment"><option value="">Any payment</option><option value="unpaid" ${st.pay === 'unpaid' ? 'selected' : ''}>Not paid yet</option><option value="paid" ${st.pay === 'paid' ? 'selected' : ''}>Paid</option></select>
      <select id="och" aria-label="Source"><option value="">All sources</option>${Object.entries(CHANNELS).map(([k, l]) => `<option value="${k}" ${st.channel === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="date-pair">${ic('calendar')}<input type="date" id="ofrom" value="${esc(st.from)}" aria-label="From date"><span>–</span><input type="date" id="oto" value="${esc(st.to)}" aria-label="To date"></span></div>
    <div class="bulkbar" id="obulk" hidden><b id="obulk-n"></b><span class="muted">selected</span>
      <div class="bulk-actions"><button type="button" class="btn btn-sm btn-ghost" data-ob="confirmed">Confirm</button><button type="button" class="btn btn-sm btn-ghost" data-ob="processing">Packing</button><button type="button" class="btn btn-sm btn-ghost" data-ob="shipped">${ic('truck')}Shipped</button><button type="button" class="btn btn-sm btn-ghost" data-ob="delivered">Delivered</button><button type="button" class="btn btn-sm btn-ghost" data-ob-pay="paid">${ic('cash')}Mark paid</button><button type="button" class="btn btn-sm btn-ghost" data-ob-print>${ic('print')}Packing slips</button></div>
      <button type="button" class="link" id="obulk-clear">Clear</button></div>
    <div id="olist"><div class="loading"><span class="spin"></span></div></div></div>`;
  let rows = [];
  const qs = () => { const u = new URLSearchParams(); for (const k of ['status', 'q', 'pay', 'channel', 'from', 'to']) if (st[k]) u.set(k, st[k]); if (st.page > 1) u.set('page', st.page); return u; };
  const updateBulk = () => { $('#obulk', el).hidden = !st.sel.size; $('#obulk-n', el).textContent = st.sel.size; const all = $('#oselall', el); if (all) all.checked = rows.length > 0 && rows.every((o) => st.sel.has(o.id)); };
  const load = async () => {
    const u = qs();
    const h = '#/orders' + (u.toString() ? '?' + u : ''); history.replaceState(null, '', h); A.lastHash = h;
    const csvQ = new URLSearchParams(u); csvQ.delete('page'); $('#ocsv', el).href = '/api/admin/orders.csv' + (csvQ.toString() ? '?' + csvQ : '');
    const list = $('#olist', el); list.classList.add('refetch');
    const d = await api('/api/admin/orders?' + u.toString());
    list.classList.remove('refetch');
    rows = d.orders;
    $('#otabs', el).innerHTML = [['', 'All', d.counts.all], ...ORDER_STATUSES.map(([k, l]) => [k, l, d.counts[k]])].map(([k, l, n]) => `<button type="button" class="ftab${st.status === k ? ' on' : ''}" data-s="${k}">${k ? `<i class="st-dot st-${k}"></i>` : ''}${esc(k === 'pending' ? 'New' : l)}<b>${n}</b></button>`).join('');
    list.innerHTML = d.orders.length ? `<div class="tbl-wrap"><table class="tbl tbl-click tbl-orders"><thead><tr><th class="sel"><label class="check"><input type="checkbox" id="oselall" aria-label="Select all on this page"><span class="box"></span></label></th><th>Order</th><th>Customer</th><th>Delivery</th><th class="num">Total</th><th>Payment</th><th>Source</th><th>Status</th></tr></thead><tbody>${d.orders.map((o) => `<tr data-href="#/orders/${o.id}" data-id="${o.id}">
      <td class="sel"><label class="check"><input type="checkbox" class="osel" ${st.sel.has(o.id) ? 'checked' : ''} aria-label="Select ${o.id}"><span class="box"></span></label></td>
      <td><a class="mono" href="#/orders/${o.id}">${o.id}</a><small class="block muted">${fmtDT(o.created)}</small></td>
      <td>${esc(o.name)}${o.risk ? ` <span class="pill pill-risk" title="This customer cancelled or returned before">${ic('alert')}Risky</span>` : o.repeat ? ' <span class="pill pill-reg" title="Has received orders before">Repeat</span>' : ''}<small class="block muted">${esc(o.phone)}</small></td>
      <td>${o.method === 'express' ? `<span class="pill pill-express">${ic('bolt')}Express</span>` : o.method === 'pickup' ? 'Pickup' : esc(o.city)}${o.tracking ? `<small class="block muted mono">${esc(o.tracking)}</small>` : o.date ? `<small class="block muted">${fmtDate(o.date + 'T06:00:00Z')}</small>` : ''}</td>
      <td class="num"><b>${money(o.total)}</b><small class="block muted">${plural(o.items, 'item')}</small></td>
      <td>${PAYMENT[o.payment]}<small class="block ${o.paid === 'paid' ? 'ok-t' : 'muted'}">${o.paid === 'paid' ? 'Paid' : o.paid === 'refunded' ? 'Refunded' : o.payment === 'cod' ? 'Collect on delivery' : 'Verify TrxID'}</small></td>
      <td><span class="pill pill-src">${esc(chName(o.channel))}</span>${o.funnel ? `<small class="block muted" title="Landing page">${ic('funnel')}${esc(o.funnel)}</small>` : o.manual ? '<small class="block muted">Entered by you</small>' : ''}</td>
      <td>${statusPill(o.status)}</td></tr>`).join('')}</tbody></table></div>
      ${d.pages > 1 ? `<div class="pager"><button type="button" class="btn btn-sm btn-ghost" data-page="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>${ic('chev-left')}Newer</button><span class="muted">Page ${d.page} of ${d.pages} · ${plural(d.total, 'order')}</span><button type="button" class="btn btn-sm btn-ghost" data-page="${d.page + 1}" ${d.page >= d.pages ? 'disabled' : ''}>Older${ic('chev-right')}</button></div>` : ''}`
      : `<div class="empty">${ic('orders', 'empty-ic')}<h2>No orders here</h2><p>${st.q || st.pay || st.channel || st.from ? 'Nothing matches these filters.' : st.status ? `No ${(STATUS[st.status] || '').toLowerCase()} orders right now.` : 'Orders will appear here as soon as customers check out.'}</p><a class="btn btn-ghost" href="#/orders/new">${ic('plus')}Enter a phone or Facebook order</a></div>`;
    updateBulk();
  };
  $('#oq', el).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 250));
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'opay') { st.pay = t.value; st.page = 1; load(); }
    else if (t.id === 'och') { st.channel = t.value; st.page = 1; load(); }
    else if (t.id === 'ofrom' || t.id === 'oto') { st.from = $('#ofrom', el).value; st.to = $('#oto', el).value; st.page = 1; load(); }
    else if (t.id === 'oselall') { for (const o of rows) { if (t.checked) st.sel.add(o.id); else st.sel.delete(o.id); } $$('.osel', el).forEach((x) => { x.checked = t.checked; }); updateBulk(); }
    else if (t.classList.contains('osel')) { const id = t.closest('tr').dataset.id; if (t.checked) st.sel.add(id); else st.sel.delete(id); updateBulk(); }
  });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('.sel')) return;
    const tab = e.target.closest('.ftab'); if (tab) { st.status = tab.dataset.s; st.page = 1; load(); return; }
    const pg = e.target.closest('[data-page]'); if (pg) { st.page = +pg.dataset.page; load(); return; }
    if (e.target.closest('#obulk-clear')) { st.sel.clear(); $$('.osel', el).forEach((x) => { x.checked = false; }); updateBulk(); return; }
    const ob = e.target.closest('[data-ob],[data-ob-pay]');
    if (ob) {
      const ids = [...st.sel];
      const body = ob.dataset.ob ? { ids, status: ob.dataset.ob } : { ids, paymentStatus: ob.dataset.obPay };
      try { const r = await api('/api/admin/orders/bulk', { method: 'POST', body }); toast(`Updated ${plural(r.count, 'order')}`); st.sel.clear(); refreshCounts(); load(); } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (e.target.closest('[data-ob-print]')) {
      try { const list = await Promise.all([...st.sel].map((id) => api(`/api/admin/orders/${id}`).then((r) => r.order))); printOrders(list, true); } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
  });
  await load();
}
async function getSettings() { if (!A.settings) { const r = await api('/api/admin/settings'); A.settings = r.settings; A.settingsExtra = { products: r.products, coupons: r.coupons }; } return A.settings; }
async function viewOrder(el, id) {
  const { order: o, history: h, economics: e, funnel } = await api(`/api/admin/orders/${id}`);
  const next = NEXT[o.status];
  const finished = h.delivered + h.returned + h.cancelled;
  const risky = h.blocked || (finished >= 2 && h.success < 0.5);
  el.innerHTML = `
  <div class="page-head"><div><a class="back" href="#/orders">${ic('arrow-left')}Orders</a><h1 class="order-h">${o.id} ${statusPill(o.status)}</h1><p>Placed ${fmtDT(o.created)} · ${plural(o.totals.count || o.items.reduce((s, l) => s + l.qty, 0), 'item')} · ${money(o.totals.total)} · from <b>${esc(chName(o.source?.channel))}</b>${funnel ? ` (landing page: ${esc(funnel)})` : ''}${o.source?.campaign ? ` · campaign “${esc(o.source.campaign)}”` : ''}</p></div>
    <div class="head-actions"><button type="button" class="btn btn-ghost" data-print="invoice">${ic('print')}Invoice</button><button type="button" class="btn btn-ghost" data-print="slip">${ic('print')}Packing slip</button></div></div>
  ${risky ? `<div class="banner bad">${ic(h.blocked ? 'ban' : 'alert')}<span>${h.blocked ? '<b>This number is blocked.</b> ' : ''}This customer has <b>${h.returned} returned</b> and <b>${h.cancelled} cancelled</b> out of ${h.orders} earlier orders. Call to confirm before sending, or ask for the delivery charge in advance.${h.note ? ` Note: “${esc(h.note)}”` : ''}</span></div>` : ''}
  <div class="status-bar card">
    <div class="flow">${ORDER_STATUSES.filter(([k]) => k !== 'cancelled' && k !== 'returned').map(([k, l], i, arr) => { const idx = arr.findIndex(([x]) => x === o.status); return `<span class="flow-step${idx < 0 ? '' : i < idx ? ' done' : i === idx ? ' cur' : ''}"><i>${i < idx || (i === idx && o.status === 'delivered') ? ic('check') : i + 1}</i>${esc(l)}</span>`; }).join('')}</div>
    <div class="flow-actions">${next ? `<button type="button" class="btn btn-primary" data-status="${next[0]}">${esc(next[1])}</button>` : ''}${o.status === 'shipped' ? '<button type="button" class="btn btn-danger-ghost" data-status="returned">Returned / refused</button>' : ''}${['pending', 'confirmed', 'processing'].includes(o.status) ? '<button type="button" class="btn btn-danger-ghost" data-status="cancelled">Cancel order</button>' : ''}
      <select id="ostatus" aria-label="Set status">${ORDER_STATUSES.map(([k, l]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
  </div>
  <div class="order-grid">
    <div>
      <section class="card"><h2 class="card-title">Items</h2>
        <ul class="o-items">${o.items.map((l) => `<li><img src="${esc(l.img || '/img/box.svg')}" alt="" width="56" height="70"><div><b>${l.slug ? `<a href="/product/${esc(l.slug)}" target="_blank" rel="noopener">${esc(l.name)}</a>` : esc(l.name)}</b>${l.offer === 'bump' ? '<small class="ok-t">Checkout add-on</small>' : l.offer === 'upsell' ? '<small class="ok-t">After-order offer</small>' : ''}${l.pack > 1 ? `<small>Pack of ${l.pack}: send ${l.pack * l.qty} units</small>` : ''}${Object.entries(l.options || {}).map(([k, v]) => `<small>${esc(k)}: <b>${esc(v)}</b></small>`).join('')}${l.box ? `<small>${esc(l.box.wrap)} wrap · ${esc(l.box.ribbon)} ribbon</small><ul class="box-contents">${l.box.items.map((c) => `<li>${esc(c.name)} <span class="muted">${money(c.price)}</span></li>`).join('')}</ul>${l.box.to || l.box.note ? `<small class="note">Card${l.box.to ? ` to ${esc(l.box.to)}` : ''}${l.box.from ? ` from ${esc(l.box.from)}` : ''}: “${esc(l.box.note)}”</small>` : ''}` : ''}</div><span class="muted">${l.qty} × ${money(l.price)}</span><b>${money(l.qty * l.price)}</b></li>`).join('')}</ul>
        <div class="totals"><div><span>Subtotal</span><b>${money(o.totals.subtotal)}</b></div>${o.totals.discount ? `<div class="ok-t"><span>${esc(o.totals.discountLabel)}</span><b>−${money(o.totals.discount)}</b></div>` : ''}<div><span>Delivery (${o.delivery.method})</span><b>${o.totals.delivery ? money(o.totals.delivery) : 'Free'}</b></div>${o.totals.wrap ? `<div><span>Gift wrap</span><b>${money(o.totals.wrap)}</b></div>` : ''}<div class="grand"><span>Total</span><b>${money(o.totals.total)}</b></div></div>
      </section>
      <section class="card"><h2 class="card-title">Profit on this order</h2>
        <div class="totals econ"><div><span>Customer pays</span><b>${money(o.totals.total)}</b></div><div><span>Product cost</span><b>${e.known ? '−' + money(e.cogs) : '<span class="muted">cost missing</span>'}</b></div><div><span>Courier${o.courier?.cost != null ? '' : ' (estimate)'}</span><b>−${money(e.ship)}</b></div><div><span>Packaging</span><b>−${money(e.pack)}</b></div>${e.codFee ? `<div><span>COD fee</span><b>−${money(e.codFee)}</b></div>` : ''}<div class="grand"><span>${o.status === 'returned' ? 'Loss (returned)' : 'Gross profit'}</span><b class="${o.status === 'returned' || e.profit < 0 ? 'bad-t' : 'ok-t'}">${o.status === 'returned' ? '−' + money(e.ship + e.pack) : money(e.profit)}</b></div></div>
        <p class="muted small mt">Default costs are set in <a class="link" href="#/settings?tab=costs">Settings › Costs</a>. Enter the real courier charge below for an exact figure.</p>
      </section>
      <section class="card"><h2 class="card-title">Timeline</h2>
        <ol class="o-timeline">${o.timeline.slice().reverse().map((t) => `<li><i class="st-dot st-${t.status}"></i><div><b>${esc(STATUS[t.status] || t.status)}</b><small>${fmtDT(t.at)}</small>${t.note ? `<p>${esc(t.note)}</p>` : ''}</div></li>`).join('')}</ol>
        <form id="note-form" class="inline-form"><input name="note" placeholder="Add a note the customer can see when tracking (e.g. Rider will call before 5pm)" maxlength="300"><button class="btn btn-ghost" type="submit">Add note</button></form>
      </section>
    </div>
    <div>
      <section class="card"><h2 class="card-title">Customer</h2><p class="kv"><b>${esc(o.customer.name)}</b>${phoneLinks(o.customer.phone)}${o.customer.email ? `<a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a>` : ''}</p>
        <div class="hist ${risky ? 'bad' : finished ? 'ok' : ''}">${h.orders ? `<b>${h.orders} earlier order${h.orders > 1 ? 's' : ''}</b><span>${h.delivered} delivered · ${h.returned} returned · ${h.cancelled} cancelled${h.success != null ? ` · <b>${pctFmt(h.success)}</b> success` : ''}</span><span>Spent ${money(h.spent)} before</span>` : '<b>First order from this number</b><span>No history yet. Call to confirm if the order is large.</span>'}</div>
        <a class="link small" href="#/customers/${esc(o.customer.phone)}">Customer profile & notes</a></section>
      <section class="card"><h2 class="card-title">Delivery</h2>
        ${o.recipient ? `<p class="kv"><span class="pill pill-gift">${ic('gift')}Gift delivery to</span><b>${esc(o.recipient.name)}</b>${phoneLinks(o.recipient.phone)}</p>` : ''}
        <p class="kv">${esc(o.address.line)}${o.address.area ? `<br>${esc(o.address.area)}` : ''}<br>${esc(o.address.city)} · ${o.address.zone === 'inside' ? 'Inside Dhaka' : 'Outside Dhaka'}</p>
        <p class="kv"><span class="inline">${o.delivery.method === 'express' ? `<span class="pill pill-express">${ic('bolt')}Bliss Express</span>` : o.delivery.method === 'pickup' ? 'Pickup from shop' : `${ic('truck')} Standard delivery`}${o.delivery.date ? `<span>· ${fmtDate(o.delivery.date + 'T06:00:00Z')}</span>` : ''}${o.delivery.slot ? `<span>· ${esc(o.delivery.slot)}</span>` : ''}</span></p>
        <form id="courier-form" class="courier"><h3 class="mini-h">Courier</h3><div class="grid-2"><label class="field"><span>Company</span><select name="name"><option value="">Choose…</option>${COURIERS.map((c) => `<option ${o.courier?.name === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label class="field"><span>Charge you pay (৳)</span><input name="cost" type="number" min="0" value="${o.courier?.cost ?? ''}" placeholder="${e.ship}"></label></div><label class="field"><span>Tracking / consignment ID</span><input name="tracking" maxlength="60" value="${esc(o.courier?.tracking || '')}" placeholder="Customer sees this when tracking"></label><button class="btn btn-ghost btn-sm" type="submit">Save courier</button></form>
      </section>
      <section class="card"><h2 class="card-title">Payment</h2><p class="kv"><b>${PAYMENT[o.payment.method]}</b>${o.payment.trxId ? `<span>TrxID: <b class="mono">${esc(o.payment.trxId)}</b></span>` : ''}${o.coupon ? `<span>Coupon: <b>${esc(o.coupon)}</b></span>` : ''}</p>
        <label class="switch-row"><span><b>${o.payment.status === 'paid' ? 'Paid' : o.payment.status === 'refunded' ? 'Refunded' : 'Not paid yet'}</b><small>${o.payment.method === 'cod' ? 'Mark paid when the courier settles the cash' : 'Mark paid after you verify the TrxID'}</small></span><label class="switch"><input type="checkbox" id="paid" ${o.payment.status === 'paid' ? 'checked' : ''}><span></span></label></label>
        ${o.payment.status === 'paid' ? '<button type="button" class="link small" id="refund">Mark as refunded</button>' : ''}</section>
      ${o.gift?.wrap || o.gift?.message || o.gift?.hidePrice ? `<section class="card"><h2 class="card-title">Gift options</h2>${o.gift.wrap ? `<p class="kv">${ic('gift')} Premium gift wrap</p>` : ''}${o.gift.hidePrice ? '<p class="kv">Hide prices on invoice (use the packing slip)</p>' : ''}${o.gift.message ? `<blockquote class="card-msg">“${esc(o.gift.message)}”</blockquote>` : ''}</section>` : ''}
      ${o.note ? `<section class="card"><h2 class="card-title">Customer note</h2><p>${esc(o.note)}</p></section>` : ''}
      <section class="card"><h2 class="card-title">Private note</h2><textarea id="anote" rows="3" placeholder="Only you can see this" maxlength="1000">${esc(o.adminNote || '')}</textarea><button type="button" class="btn btn-ghost btn-sm mt" id="anote-save">Save note</button></section>
      <button type="button" class="btn btn-danger-ghost btn-block" id="odel">${ic('trash')}Delete order</button>
    </div>
  </div>`;
  const patch = async (body, msg) => { try { await api(`/api/admin/orders/${o.id}`, { method: 'PATCH', body }); toast(msg); refreshCounts(); route(); } catch (err) { toast(err.message, 'error'); } };
  el.addEventListener('click', async (ev) => {
    const s = ev.target.closest('[data-status]');
    if (s) {
      if (s.dataset.status === 'cancelled' && !(await ask('Cancel this order?', { ok: 'Cancel order', detail: 'Stock for its items goes back to your inventory.' }))) return;
      if (s.dataset.status === 'returned' && !(await ask('Mark this order as returned?', { ok: 'Mark returned', detail: 'Use this when the customer refused the parcel or sent it back. Items go back into stock and the courier cost is counted as a loss.' }))) return;
      patch({ status: s.dataset.status }, `Order marked “${STATUS[s.dataset.status]}”`); return;
    }
    const pr = ev.target.closest('[data-print]'); if (pr) printOrders([o], pr.dataset.print === 'slip');
    if (ev.target.closest('#refund') && await ask('Mark this order as refunded?', { ok: 'Mark refunded', detail: 'Refunded orders are removed from your sales numbers.' })) patch({ paymentStatus: 'refunded' }, 'Marked as refunded');
  });
  $('#ostatus', el).addEventListener('change', (ev) => patch({ status: ev.target.value }, `Order marked “${STATUS[ev.target.value]}”`));
  $('#paid', el).addEventListener('change', (ev) => patch({ paymentStatus: ev.target.checked ? 'paid' : 'unpaid' }, ev.target.checked ? 'Marked as paid' : 'Marked as unpaid'));
  $('#note-form', el).addEventListener('submit', (ev) => { ev.preventDefault(); const n = ev.target.elements.note.value.trim(); if (n) patch({ note: n }, 'Note added'); });
  $('#courier-form', el).addEventListener('submit', (ev) => { ev.preventDefault(); const x = formObj(ev.target); patch({ courier: { name: x.name, tracking: x.tracking.trim(), cost: x.cost === '' ? null : +x.cost } }, 'Courier details saved'); });
  $('#anote-save', el).addEventListener('click', async () => { try { await api(`/api/admin/orders/${o.id}`, { method: 'PATCH', body: { adminNote: $('#anote', el).value } }); toast('Private note saved'); } catch (err) { toast(err.message, 'error'); } });
  $('#odel', el).addEventListener('click', async () => {
    if (!(await ask(`Delete order ${o.id}?`, { detail: 'Use this for test or spam orders. Unfulfilled items return to stock. This cannot be undone.' }))) return;
    try { await api(`/api/admin/orders/${o.id}`, { method: 'DELETE' }); toast('Order deleted'); refreshCounts(); location.hash = '#/orders'; } catch (err) { toast(err.message, 'error'); }
  });
}
/** Prints one or many invoices / packing slips (one per page). */
async function printOrders(orders, slip) {
  const s = await getSettings().catch(() => null), st = s?.store || { name: 'BLISS' };
  const w = window.open('', '_blank', 'width=860,height=1000');
  if (!w) { toast('Please allow pop-ups to print', 'error'); return; }
  const page = (o) => {
    const rows = o.items.map((l) => `<tr><td>${esc(l.name)}${l.pack > 1 ? `<div class="m">Pack of ${l.pack}</div>` : ''}${Object.entries(l.options || {}).map(([k, v]) => `<div class="m">${esc(k)}: ${esc(v)}</div>`).join('')}${l.box ? `<div class="m">${esc(l.box.items.map((c) => c.name).join(', '))}</div>` : ''}</td><td class="r">${l.qty}</td>${slip ? '' : `<td class="r">${money(l.price)}</td><td class="r">${money(l.price * l.qty)}</td>`}</tr>`).join('');
    return `<section class="pg"><div class="top"><div><h1>${esc(st.name)}</h1><div class="muted">${esc(st.address || '')}<br>${esc(st.phone || '')} · ${esc(st.email || '')}</div></div><div style="text-align:right"><b style="font-size:18px">${slip ? 'Packing slip' : 'Invoice'}</b><div>Order <b>${o.id}</b></div><div class="muted">${fmtDate(o.created)}</div></div></div>
    <div class="grid"><div><h3>Deliver to</h3><b>${esc(o.recipient?.name || o.customer.name)}</b><br>${esc(o.recipient?.phone || o.customer.phone)}<br>${esc(o.address.line)}${o.address.area ? ', ' + esc(o.address.area) : ''}<br>${esc(o.address.city)}</div>
    <div><h3>${o.recipient ? 'Sent by' : 'Customer'}</h3><b>${esc(o.customer.name)}</b><br>${esc(o.customer.phone)}${o.customer.email ? '<br>' + esc(o.customer.email) : ''}<br><span class="muted">${o.delivery.method === 'express' ? 'Bliss Express' : o.delivery.method === 'pickup' ? 'Pickup' : 'Standard delivery'}${o.delivery.date ? ' · ' + fmtDate(o.delivery.date + 'T06:00:00Z') : ''}${o.courier?.name ? ` · ${esc(o.courier.name)} ${esc(o.courier.tracking || '')}` : ''}</span><br><b>${o.payment.status === 'paid' ? 'PAID' : o.payment.method === 'cod' ? 'COLLECT ' + money(o.totals.total) : PAYMENT[o.payment.method]}</b></div></div>
    <table><thead><tr><th>Item</th><th class="r">Qty</th>${slip ? '' : '<th class="r">Price</th><th class="r">Total</th>'}</tr></thead><tbody>${rows}</tbody></table>
    ${slip ? '' : `<div class="tot"><div><span>Subtotal</span><span>${money(o.totals.subtotal)}</span></div>${o.totals.discount ? `<div><span>${esc(o.totals.discountLabel)}</span><span>−${money(o.totals.discount)}</span></div>` : ''}<div><span>Delivery</span><span>${o.totals.delivery ? money(o.totals.delivery) : 'Free'}</span></div>${o.totals.wrap ? `<div><span>Gift wrap</span><span>${money(o.totals.wrap)}</span></div>` : ''}<div class="g"><span>Total</span><span>${money(o.totals.total)}</span></div></div>`}
    ${o.gift?.message ? `<div class="msg">“${esc(o.gift.message)}”</div>` : ''}
    <div class="foot">Thank you for choosing ${esc(st.name)} ♥</div></section>`;
  };
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${slip ? 'Packing slips' : 'Invoices'}</title><style>
    body{font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#23161F;margin:40px}h1{font:600 28px Georgia,serif;margin:0;letter-spacing:.12em}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #8E2C5C;padding-bottom:16px;margin-bottom:22px}.muted{color:#7B6A75}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}h3{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#7B6A75;margin:0 0 6px}table{width:100%;border-collapse:collapse}th,td{padding:10px 8px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#7B6A75}.r{text-align:right}.m{font-size:12px;color:#7B6A75}.tot{margin-left:auto;width:280px;margin-top:14px}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .g{border-top:2px solid #23161F;margin-top:6px;padding-top:8px;font-weight:700;font-size:16px}.msg{margin-top:26px;padding:16px;border:1px dashed #8E2C5C;border-radius:10px;font:italic 16px Georgia,serif}.foot{margin-top:40px;text-align:center;color:#7B6A75;font-size:12px}.pg+.pg{page-break-before:always;margin-top:60px}@media print{body{margin:16mm}.pg+.pg{margin-top:0}}
  </style></head><body>${orders.map(page).join('')}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 350);
}

/* --------------------------------------------- manual order (phone / FB) */
async function viewNewOrder(el, params) {
  const s = await getSettings();
  await loadProducts(true);
  const prods = A.products.filter((p) => p.status !== 'out');
  const st = { lines: [], phone: params.get('phone') || '' };
  const CITY_IN = new Set(['dhaka', 'narayanganj']);
  el.innerHTML = `<div class="page-head"><div><a class="back" href="#/orders">${ic('arrow-left')}Orders</a><h1>New order</h1><p>For orders that come by phone, Facebook, Instagram, WhatsApp or in person. Stock and reports update just like an online order.</p></div></div>
  <form id="nform" class="pform" novalidate>
    <div class="pform-main">
      <section class="card"><h2 class="card-title">Products</h2>
        <label class="search-in">${ic('search')}<input id="np-q" placeholder="Type to find a product…" autocomplete="off"></label>
        <ul class="np-results" id="np-res"></ul>
        <ul class="np-lines" id="np-lines"></ul>
      </section>
      <section class="card"><h2 class="card-title">Customer</h2>
        <div class="grid-2"><label class="field"><span>Mobile number *</span><input name="phone" inputmode="tel" required value="${esc(st.phone)}" placeholder="01XXXXXXXXX"></label><label class="field"><span>Full name *</span><input name="name" required maxlength="80"></label></div>
        <div id="np-hist"></div>
        <label class="field"><span>Address *</span><textarea name="line" rows="2" maxlength="300" placeholder="House, road, area, landmark"></textarea></label>
        <div class="grid-2"><label class="field"><span>City / district *</span><input name="city" value="Dhaka" maxlength="60" list="np-cities"><datalist id="np-cities">${['Dhaka', 'Narayanganj', 'Gazipur', 'Chattogram', 'Sylhet', 'Khulna', 'Rajshahi', 'Barishal', 'Rangpur', 'Mymensingh', 'Cumilla'].map((c) => `<option value="${c}">`).join('')}</datalist></label><label class="field"><span>Area / thana</span><input name="area" maxlength="80"></label></div>
        <label class="field"><span>Note from the customer</span><input name="note" maxlength="500"></label>
      </section>
    </div>
    <div class="pform-side">
      <section class="card"><h2 class="card-title">Order details</h2>
        <label class="field"><span>Came from</span><select name="channel">${[['phone', 'Phone call'], ['facebook', 'Facebook / Messenger'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp'], ['walk-in', 'Walk-in'], ['other', 'Other']].map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field"><span>Delivery</span><select name="method"><option value="standard">Standard delivery</option><option value="express">Express (${esc(s.delivery.expressAreas)})</option><option value="pickup">Pickup from shop (no delivery fee)</option></select></label>
        <label class="field"><span>Payment</span><select name="pay"><option value="cod">Cash on delivery</option><option value="bkash">bKash</option><option value="nagad">Nagad</option></select></label>
        <label class="field"><span>Transaction ID <em>(bKash/Nagad)</em></span><input name="trx" maxlength="30"></label>
        <label class="switch-row"><span><b>Already paid</b><small>Payment received in advance</small></span><label class="switch"><input type="checkbox" name="paid"><span></span></label></label>
        <label class="switch-row"><span><b>Confirmed</b><small>Skip the “new order” step</small></span><label class="switch"><input type="checkbox" name="confirmed" checked><span></span></label></label>
        <div class="grid-2"><label class="field"><span>Extra discount (৳)</span><input name="extra" type="number" min="0" placeholder="0"></label><label class="field"><span>Coupon</span><input name="coupon" maxlength="30" style="text-transform:uppercase"></label></div>
        <label class="switch-row"><span><b>Gift wrap</b><small>+${money(s.giftWrapPrice)}</small></span><label class="switch"><input type="checkbox" name="wrap"><span></span></label></label>
        <div class="np-sum" id="np-sum"></div>
      </section>
    </div>
    <div class="savebar"><span class="muted" id="np-state">Add at least one product</span><a class="btn btn-ghost" href="#/orders">Cancel</a><button class="btn btn-primary" type="submit" id="np-save">${ic('check')}Create order</button></div>
  </form>`;
  const f = $('#nform', el);
  const zone = () => (CITY_IN.has(f.elements.city.value.trim().toLowerCase()) ? 'inside' : 'outside');
  const live = (p) => (p.saleEnds && p.compare > p.price && Date.now() > Date.parse(p.saleEnds) ? p.compare : p.price);
  const totals = () => {
    const x = formObj(f);
    const lines = st.lines.map((l) => ({ price: live(l.p), qty: l.qty }));
    const t = computeTotals(lines, { settings: s, zone: zone(), express: x.method === 'express', giftWrap: x.wrap, noDelivery: x.method === 'pickup' });
    const extra = Math.min(t.subtotal - t.discount, Math.max(0, +x.extra || 0));
    return { ...t, extra, total: Math.max(0, t.total - extra) };
  };
  const draw = () => {
    $('#np-lines', el).innerHTML = st.lines.length ? st.lines.map((l, i) => `<li data-i="${i}"><img src="${esc(l.p.images[0] || '/img/placeholder.svg')}" alt="" width="40" height="50"><div><b>${esc(l.p.name)}</b><small>${money(live(l.p))} each${l.p.qty != null ? ` · ${l.p.qty} in stock` : ''}</small>${l.p.options.map((o) => `<label class="np-opt">${esc(o.name)} <select data-opt="${esc(o.name)}"><option value="">Choose</option>${o.values.map((v) => `<option ${l.options[o.name] === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`).join('')}</div><input type="number" min="1" max="500" value="${l.qty}" class="qty-in" data-qty aria-label="Quantity"><b class="num">${money(live(l.p) * l.qty)}</b><button type="button" class="ibtn danger" data-rm title="Remove">${ic('trash')}</button></li>`).join('') : '<li class="muted small">No products yet. Search above to add one.</li>';
    const t = totals();
    $('#np-sum', el).innerHTML = `<div class="totals"><div><span>Subtotal</span><b>${money(t.subtotal)}</b></div>${t.discount ? `<div class="ok-t"><span>${esc(t.discountLabel)}</span><b>−${money(t.discount)}</b></div>` : ''}${t.extra ? `<div class="ok-t"><span>Special discount</span><b>−${money(t.extra)}</b></div>` : ''}<div><span>Delivery (${zone() === 'inside' ? 'inside Dhaka' : 'outside Dhaka'})</span><b>${t.delivery ? money(t.delivery) : 'Free'}</b></div>${t.wrap ? `<div><span>Gift wrap</span><b>${money(t.wrap)}</b></div>` : ''}<div class="grand"><span>Total</span><b>${money(t.total)}</b></div></div><p class="muted small">Coupons are checked when you create the order.</p>`;
    $('#np-state', el).textContent = st.lines.length ? `${plural(st.lines.reduce((a, l) => a + l.qty, 0), 'item')} · ${money(t.total)}` : 'Add at least one product';
  };
  const search = () => {
    const q = $('#np-q', el).value.trim().toLowerCase();
    const res = q ? prods.filter((p) => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)).slice(0, 8) : [];
    $('#np-res', el).innerHTML = res.map((p) => `<li><button type="button" data-add="${p.id}"><img src="${esc(p.images[0] || '/img/placeholder.svg')}" alt="" width="32" height="40"><span>${esc(p.name)}<small>${p.sku ? esc(p.sku) + ' · ' : ''}${money(live(p))}${p.qty != null ? ` · ${p.qty} left` : ''}</small></span>${ic('plus')}</button></li>`).join('');
  };
  $('#np-q', el).addEventListener('input', search);
  el.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { const p = prods.find((x) => x.id === add.dataset.add); const ex = st.lines.find((l) => l.p.id === p.id && !p.options.length); if (ex) ex.qty++; else st.lines.push({ p, qty: 1, options: {} }); $('#np-q', el).value = ''; search(); draw(); A.dirty = true; return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { st.lines.splice(+rm.closest('li').dataset.i, 1); draw(); }
  });
  el.addEventListener('change', async (e) => {
    const li = e.target.closest('#np-lines li[data-i]');
    if (li && e.target.dataset.qty !== undefined) { st.lines[+li.dataset.i].qty = Math.max(1, Math.floor(+e.target.value) || 1); draw(); return; }
    if (li && e.target.dataset.opt) { st.lines[+li.dataset.i].options[e.target.dataset.opt] = e.target.value; return; }
    if (e.target.name === 'phone') {
      const ph = e.target.value.replace(/[\s\-()]/g, '').replace(/^\+?88/, '');
      if (!/^01[3-9]\d{8}$/.test(ph)) { $('#np-hist', el).innerHTML = ''; return; }
      try {
        const { customer: c } = await api(`/api/admin/customers/${ph}`);
        if (!f.elements.name.value) f.elements.name.value = c.name;
        const a = c.addresses[0];
        if (a && !f.elements.line.value) { f.elements.line.value = a.line; f.elements.city.value = a.city; f.elements.area.value = a.area || ''; draw(); }
        const fin = c.delivered + c.returned + c.cancelled, risky = c.blocked || (fin >= 2 && c.success < 0.5);
        $('#np-hist', el).innerHTML = `<div class="hist ${risky ? 'bad' : 'ok'}"><b>${esc(c.name)} · ${segPill(c.segment)}</b><span>${c.orders} orders · ${c.delivered} delivered · ${c.returned} returned · ${c.cancelled} cancelled · spent ${money(c.spent)}</span>${c.note ? `<span>Note: ${esc(c.note)}</span>` : ''}</div>`;
      } catch { $('#np-hist', el).innerHTML = '<div class="hist"><b>New customer</b><span>No orders from this number yet.</span></div>'; }
    }
  });
  f.addEventListener('input', debounce(draw, 150));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const x = formObj(f);
    if (!st.lines.length) { toast('Add at least one product', 'error'); $('#np-q', el).focus(); return; }
    const miss = st.lines.find((l) => l.p.options.some((o) => !l.options[o.name]));
    if (miss) { toast(`Choose the options for “${miss.p.name}”`, 'error'); return; }
    const body = {
      items: st.lines.map((l) => ({ pid: l.p.id, qty: l.qty, options: l.options })),
      customer: { name: x.name, phone: x.phone, email: '' }, address: { line: x.line, area: x.area, city: x.city, zone: zone() },
      delivery: { method: x.method === 'express' ? 'express' : 'standard' }, pickup: x.method === 'pickup', gift: { wrap: x.wrap },
      payment: { method: x.pay, trxId: x.trx }, paymentStatus: x.paid ? 'paid' : 'unpaid', status: x.confirmed ? 'confirmed' : 'pending',
      source: { channel: x.channel }, extraDiscount: +x.extra || 0, coupon: x.coupon, note: x.note,
    };
    const btn = $('#np-save', el); setBusy(btn, true, 'Creating…');
    try { const r = await api('/api/admin/orders', { method: 'POST', body }); A.dirty = false; toast(`Order ${r.order.id} created`); refreshCounts(); location.hash = `#/orders/${r.order.id}`; }
    catch (err) { setBusy(btn, false); const fld = { name: 'name', phone: 'phone', line: 'line', city: 'city' }[err.data?.field]; if (fld) { f.elements[fld].closest('.field')?.classList.add('invalid'); f.elements[fld].focus(); } toast(err.message, 'error'); }
  });
  draw();
  if (st.phone) f.elements.phone.dispatchEvent(new Event('change', { bubbles: true }));
}

/* ============================================================= categories */
async function viewCategories(el) {
  const { categories } = await api('/api/admin/categories');
  A.categories = categories;
  el.innerHTML = `<div class="page-head"><div><h1>Categories</h1><p>Group your products. Categories appear in the menu, on the homepage and as shop filters.</p></div><div class="head-actions"><button type="button" class="btn btn-primary" id="cat-add">${ic('plus')}Add category</button></div></div>
  <div class="cat-grid">${categories.map((c) => `<div class="cat-card" data-id="${c.id}"><img src="${esc(c.image || '/img/placeholder.svg')}" alt="" style="background:${esc(c.color)}" loading="lazy"><div><b>${esc(c.name)}</b><small>${esc(c.blurb || '')}</small><span class="muted small">${plural(c.count, 'product')} · /category/${esc(c.slug)}${c.showHome === false ? ' · hidden on homepage' : ''}</span></div><div class="cat-actions"><a class="ibtn" href="#/products?cat=${c.id}" title="View products">${ic('box')}</a><button type="button" class="ibtn" data-edit title="Edit">${ic('edit')}</button><button type="button" class="ibtn danger" data-del title="Delete">${ic('trash')}</button></div></div>`).join('') || `<div class="empty">${ic('grid', 'empty-ic')}<h2>No categories yet</h2></div>`}</div>`;
  const form = (c = {}) => {
    const m = openLayer(`<form class="modal-body" id="cat-form"><h2>${c.id ? 'Edit category' : 'New category'}</h2>
      <label class="field"><span>Name *</span><input name="name" required maxlength="60" value="${esc(c.name || '')}" autofocus></label>
      <label class="field"><span>Short description</span><input name="blurb" maxlength="200" value="${esc(c.blurb || '')}" placeholder="e.g. Little circles of love"></label>
      <div class="field"><span class="flabel">Image</span><div class="cat-img-row"><img id="cat-img" src="${esc(c.image || '/img/placeholder.svg')}" alt="" style="background:${esc(c.color || '#FADDE5')}"><div><button type="button" class="btn btn-sm btn-ghost" id="cat-up">${ic('upload')}Upload image</button><input type="file" accept="image/*" id="cat-file" hidden><p class="muted small">Any photo works: it is fitted to a square automatically.</p></div></div><input type="hidden" name="image" value="${esc(c.image || '')}"></div>
      <div class="grid-2"><label class="field"><span>Tile colour</span><input name="color" type="color" value="${esc(c.color || '#FADDE5')}"></label><label class="field"><span>Order</span><input name="sort" type="number" min="0" value="${c.sort ?? categories.length + 1}"></label></div>
      <label class="field"><span>URL handle</span><div class="prefix-in"><span>/category/</span><input name="slug" maxlength="60" value="${esc(c.slug || '')}" placeholder="auto"></div></label>
      <label class="switch-row"><span><b>Show on homepage</b><small>In the “Shop by category” grid</small></span><label class="switch"><input type="checkbox" name="showHome" ${c.showHome !== false ? 'checked' : ''}><span></span></label></label>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">${c.id ? 'Save' : 'Create category'}</button></div></form>`);
    $('#cat-up', m).addEventListener('click', () => $('#cat-file', m).click());
    $('#cat-file', m).addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { const url = await uploadImage(file, 'category'); $('#cat-img', m).src = url; m.querySelector('input[name=image]').value = url; } catch (err) { toast(err.message, 'error'); } });
    $('#cat-form', m).addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = e.target.querySelector('button[type=submit]'); setBusy(btn, true);
      try { await api(c.id ? `/api/admin/categories/${c.id}` : '/api/admin/categories', { method: c.id ? 'PUT' : 'POST', body: formObj(e.target) }); closeLayer(); toast(c.id ? 'Category saved' : 'Category created'); route(); }
      catch (err) { setBusy(btn, false); toast(err.message, 'error'); }
    });
  };
  $('#cat-add', el).addEventListener('click', () => form());
  el.addEventListener('click', async (e) => {
    const card = e.target.closest('.cat-card'); if (!card) return;
    const c = categories.find((x) => x.id === card.dataset.id);
    if (e.target.closest('[data-edit]')) form(c);
    if (e.target.closest('[data-del]')) {
      if (!(await ask(`Delete the “${c.name}” category?`, { detail: c.count ? `It still has ${plural(c.count, 'product')}. Move them to another category first.` : 'This cannot be undone.' }))) return;
      try { await api(`/api/admin/categories/${c.id}`, { method: 'DELETE' }); toast('Category deleted'); route(); } catch (err) { toast(err.message, 'error'); }
    }
  });
}

/* ============================================================== customers */
async function viewCustomers(el, params) {
  const { customers, vipSpend } = await api('/api/admin/customers');
  const st = { q: params.get('q') || '', seg: params.get('seg') || '', sort: 'spent' };
  const counts = { '': customers.length };
  for (const c of customers) counts[c.segment] = (counts[c.segment] || 0) + 1;
  const total = customers.reduce((a, c) => a + c.spent, 0), buyers = customers.filter((c) => c.sales).length, repeat = customers.filter((c) => c.sales >= 2).length;
  el.innerHTML = `<div class="page-head"><div><h1>Customers</h1><p>${plural(customers.length, 'customer')}, grouped by mobile number. VIP = spent ${money(vipSpend)}+ or 5+ orders (change in Settings › Costs).</p></div><div class="head-actions"><a class="btn btn-ghost" href="/api/admin/customers.csv" download>${ic('download')}Export CSV</a></div></div>
  <section class="kpis kpis-4">
    <div class="kpi"><span class="kpi-label">Customers who bought</span><b>${num(buyers)}</b><span class="kpi-sub">${num(customers.length - buyers)} without a successful order</span></div>
    <div class="kpi"><span class="kpi-label">Repeat customers</span><b>${pctFmt(buyers ? repeat / buyers : 0)}</b><span class="kpi-sub">${num(repeat)} ordered 2+ times</span></div>
    <div class="kpi"><span class="kpi-label">Average lifetime value</span><b>${money(buyers ? total / buyers : 0)}</b><span class="kpi-sub">${money(total)} from all customers</span></div>
    <a class="kpi" href="#/customers?seg=risk"><span class="kpi-label">Risky numbers</span><b>${num((counts.risk || 0) + (counts.blocked || 0))}</b><span class="kpi-sub">${counts.blocked || 0} blocked · returns or cancels often</span></a>
  </section>
  <div class="card card-flush"><div class="filter-tabs" id="ctabs"></div>
    <div class="toolbar"><label class="search-in">${ic('search')}<input id="cq" placeholder="Search name, phone, email, city or tag…" value="${esc(st.q)}"></label>
      <select id="csort" aria-label="Sort"><option value="spent">Most spent</option><option value="recent">Most recent order</option><option value="orders">Most orders</option><option value="success">Lowest success rate</option></select></div>
    <div id="clist"></div></div>`;
  const draw = () => {
    $('#ctabs', el).innerHTML = [['', 'All'], ['vip', 'VIP'], ['repeat', 'Repeat'], ['new', 'New'], ['lapsed', 'Lapsed (90+ days)'], ['risk', 'Risky'], ['blocked', 'Blocked'], ['lead', 'No orders']].map(([k, l]) => `<button type="button" class="ftab${st.seg === k ? ' on' : ''}" data-seg="${k}">${l}<b>${counts[k] || 0}</b></button>`).join('');
    const t = st.q.toLowerCase();
    let list = customers.filter((c) => (!st.seg || c.segment === st.seg) && (!t || [c.name, c.phone, c.email, c.city, ...c.tags].some((x) => (x || '').toLowerCase().includes(t))));
    if (st.sort === 'recent') list = list.slice().sort((a, b) => b.last - a.last);
    else if (st.sort === 'orders') list = list.slice().sort((a, b) => b.orders - a.orders);
    else if (st.sort === 'success') list = list.filter((c) => c.success != null).sort((a, b) => a.success - b.success);
    $('#clist', el).innerHTML = list.length ? `<div class="tbl-wrap"><table class="tbl tbl-click tbl-cust"><thead><tr><th>Customer</th><th>Contact</th><th>City</th><th class="num">Orders</th><th>Success</th><th class="num">Spent</th><th>Last order</th></tr></thead><tbody>${list.slice(0, 400).map((c) => `<tr data-href="#/customers/${esc(c.phone)}"><td><b>${esc(c.name)}</b> ${segPill(c.segment)}${c.registered ? ' <span class="pill pill-reg">Account</span>' : ''}${c.tags.length ? `<small class="block muted">${c.tags.map((x) => '#' + esc(x)).join(' ')}</small>` : ''}</td><td>${esc(c.phone)}${c.email ? `<small class="block muted">${esc(c.email)}</small>` : ''}</td><td>${esc(c.city || '—')}</td><td class="num">${c.orders}</td><td>${c.success == null ? '<span class="muted">—</span>' : `<span class="${c.success < 0.5 ? 'bad-t' : c.success < 0.8 ? 'warn-t' : 'ok-t'}"><b>${pctFmt(c.success)}</b></span><small class="block muted">${c.delivered} of ${c.delivered + c.returned + c.cancelled}</small>`}</td><td class="num"><b>${money(c.spent)}</b>${c.aov ? `<small class="block muted">avg ${money(c.aov)}</small>` : ''}</td><td>${c.orders ? ago(c.last) : '—'}</td></tr>`).join('')}</tbody></table></div>${list.length > 400 ? `<p class="tbl-foot muted small">Showing 400 of ${list.length}. Search to narrow down, or export the CSV.</p>` : ''}` : `<div class="empty">${ic('users', 'empty-ic')}<h2>No customers ${t || st.seg ? 'match' : 'yet'}</h2></div>`;
  };
  $('#cq', el).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); draw(); }, 120));
  $('#csort', el).addEventListener('change', (e) => { st.sort = e.target.value; draw(); });
  el.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-seg]'); if (tab) { st.seg = tab.dataset.seg; draw(); return; }
    const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href;
  });
  draw();
}
async function viewCustomer(el, phone) {
  const { customer: c } = await api(`/api/admin/customers/${phone}`);
  const fin = c.delivered + c.returned + c.cancelled;
  el.innerHTML = `<div class="page-head"><div><a class="back" href="#/customers">${ic('arrow-left')}Customers</a><h1 class="order-h">${esc(c.name)} ${segPill(c.segment)}</h1><p>${phoneLinks(c.phone)}${c.email ? ` · ${esc(c.email)}` : ''}${c.city ? ` · ${esc(c.city)}` : ''} · customer since ${fmtDate(c.first)}${c.channel ? ` · first came from ${esc(chName(c.channel))}` : ''}</p></div>
    <div class="head-actions"><a class="btn btn-ghost" href="https://wa.me/88${esc(c.phone)}" target="_blank" rel="noopener">${ic('whatsapp')}WhatsApp</a><a class="btn btn-primary" href="#/orders/new?phone=${esc(c.phone)}">${ic('plus')}New order</a></div></div>
  <section class="kpis kpis-4">
    <div class="kpi"><span class="kpi-label">Total spent</span><b>${money(c.spent)}</b><span class="kpi-sub">${plural(c.sales, 'successful order')}</span></div>
    <div class="kpi"><span class="kpi-label">Average order</span><b>${money(c.aov)}</b><span class="kpi-sub">last order ${c.orders ? ago(c.last) : '—'}</span></div>
    <div class="kpi"><span class="kpi-label">Delivery success</span><b class="${c.success != null && c.success < 0.5 ? 'bad-t' : ''}">${pctFmt(c.success)}</b><span class="kpi-sub">${c.delivered} delivered of ${fin} finished</span></div>
    <div class="kpi"><span class="kpi-label">Returned · cancelled</span><b>${c.returned} · ${c.cancelled}</b><span class="kpi-sub">${c.orders} orders in total</span></div>
  </section>
  <div class="order-grid">
    <div>
      <section class="card card-flush"><div class="card-head pad"><h2>Orders</h2></div>${c.orderList.length ? `<div class="tbl-wrap"><table class="tbl tbl-click"><thead><tr><th>Order</th><th class="num">Items</th><th class="num">Total</th><th>Payment</th><th>Source</th><th>Status</th></tr></thead><tbody>${c.orderList.map((o) => `<tr data-href="#/orders/${o.id}"><td><a class="mono" href="#/orders/${o.id}">${o.id}</a><small class="block muted">${fmtDT(o.created)}</small></td><td class="num">${o.items}</td><td class="num">${money(o.total)}</td><td>${PAYMENT[o.payment]}<small class="block muted">${o.paid}</small></td><td>${esc(chName(o.channel))}</td><td>${statusPill(o.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted pad">No orders yet.</p>'}</section>
      ${c.leads.length ? `<section class="card"><h2 class="card-title">Signed up through</h2><ul class="plain-list">${c.leads.map((l) => `<li>${ic('funnel')}<span>${esc(l.funnelName)}</span><small class="muted">${fmtDate(l.created)}</small></li>`).join('')}</ul></section>` : ''}
    </div>
    <div>
      <form class="card" id="cnote"><h2 class="card-title">Notes & tags</h2>
        <label class="field"><span>Private note</span><textarea name="note" rows="4" maxlength="2000" placeholder="e.g. Prefers evening delivery. Always orders for his wife's birthday in March.">${esc(c.note)}</textarea></label>
        <label class="field"><span>Tags <em>(comma separated)</em></span><input name="tags" value="${esc(c.tags.join(', '))}" placeholder="wholesale, corporate, influencer"></label>
        <label class="switch-row"><span><b>Block this number</b><small>Blocked numbers cannot order online (you can still create orders for them).</small></span><label class="switch"><input type="checkbox" name="blocked" ${c.blocked ? 'checked' : ''}><span></span></label></label>
        <button class="btn btn-primary btn-sm mt" type="submit">Save</button>
      </form>
      ${c.addresses.length ? `<section class="card"><h2 class="card-title">Addresses used</h2>${c.addresses.map((a) => `<p class="kv">${esc(a.line)}${a.area ? `, ${esc(a.area)}` : ''}<br><span class="muted">${esc(a.city)}</span></p>`).join('')}</section>` : ''}
    </div>
  </div>`;
  $('#cnote', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const x = formObj(e.target);
    try { await api(`/api/admin/customers/${c.phone}`, { method: 'PUT', body: { note: x.note, tags: x.tags.split(',').map((t) => t.trim()).filter(Boolean), blocked: x.blocked } }); toast(x.blocked ? 'Saved. This number is blocked.' : 'Saved'); route(); } catch (err) { toast(err.message, 'error'); }
  });
  el.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a')) location.hash = tr.dataset.href; });
}

/* ================================================================ reviews */
async function viewReviews(el, params) {
  let { reviews } = await api('/api/admin/reviews');
  let tab = params.get('tab') || (reviews.some((r) => !r.approved) ? 'pending' : 'all');
  const draw = () => {
    const list = reviews.filter((r) => tab === 'all' || (tab === 'pending' ? !r.approved : r.approved));
    el.innerHTML = `<div class="page-head"><div><h1>Reviews</h1><p>New reviews wait here for your approval before they appear on product pages (you can change this in Settings).</p></div></div>
    <div class="card card-flush"><div class="filter-tabs">${[['pending', 'Waiting for approval', reviews.filter((r) => !r.approved).length], ['approved', 'Published', reviews.filter((r) => r.approved).length], ['all', 'All', reviews.length]].map(([k, l, n]) => `<button type="button" class="ftab${tab === k ? ' on' : ''}" data-tab="${k}">${l}<b>${n}</b></button>`).join('')}</div>
    <div class="rv-list">${list.length ? list.map((r) => `<article class="rv" data-id="${r.id}"><div class="rv-prod">${r.product ? `<img src="${esc(r.product.img)}" alt="" width="40" height="50"><a href="/product/${esc(r.product.slug)}" target="_blank" rel="noopener">${esc(r.product.name)}</a>` : '<span class="muted">Deleted product</span>'}</div>
      <div class="rv-body"><div class="rv-top"><span class="stars">${[1, 2, 3, 4, 5].map((i) => ic(i <= r.rating ? 'star-fill' : 'star', i <= r.rating ? 'on' : '')).join('')}</span><b>${esc(r.name)}</b><span class="muted small">${ago(r.created)}</span>${r.approved ? '<span class="pill st-delivered">Published</span>' : '<span class="pill st-pending">Waiting</span>'}</div><p>${esc(r.text)}</p></div>
      <div class="rv-actions">${r.approved ? `<button type="button" class="btn btn-sm btn-ghost" data-mod="0">Unpublish</button>` : `<button type="button" class="btn btn-sm btn-primary" data-mod="1">${ic('check')}Approve</button>`}<button type="button" class="ibtn danger" data-del title="Delete">${ic('trash')}</button></div></article>`).join('') : `<div class="empty">${ic('star', 'empty-ic')}<h2>${tab === 'pending' ? 'All caught up!' : 'No reviews yet'}</h2><p>${tab === 'pending' ? 'No reviews are waiting for approval.' : 'Reviews from customers will appear here.'}</p></div>`}</div></div>`;
  };
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; draw(); return; }
    const card = e.target.closest('.rv'); if (!card) return;
    const id = card.dataset.id;
    const mod = e.target.closest('[data-mod]');
    if (mod) { try { const r = await api(`/api/admin/reviews/${id}`, { method: 'PATCH', body: { approved: mod.dataset.mod === '1' } }); reviews = reviews.map((x) => (x.id === id ? { ...x, approved: r.review.approved } : x)); toast(r.review.approved ? 'Review published' : 'Review unpublished'); draw(); refreshCounts(); } catch (err) { toast(err.message, 'error'); } }
    if (e.target.closest('[data-del]')) { if (!(await ask('Delete this review?'))) return; try { await api(`/api/admin/reviews/${id}`, { method: 'DELETE' }); reviews = reviews.filter((x) => x.id !== id); toast('Review deleted'); draw(); refreshCounts(); } catch (err) { toast(err.message, 'error'); } }
  });
  draw();
}

/* ================================================================ coupons */
async function viewCoupons(el) {
  const { coupons } = await api('/api/admin/coupons');
  el.innerHTML = `<div class="page-head"><div><h1>Coupons</h1><p>Discount codes customers enter at checkout. Coupons don't stack with Mix & Match: the shopper automatically gets whichever saves more.</p></div><div class="head-actions"><button type="button" class="btn btn-primary" id="cp-add">${ic('plus')}New coupon</button></div></div>
  <div class="card card-flush">${coupons.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Discount</th><th>Minimum order</th><th>Expires</th><th class="num">Used</th><th>Active</th><th></th></tr></thead><tbody>${coupons.map((c) => `<tr data-code="${esc(c.code)}"><td><b class="mono code">${esc(c.code)}</b></td><td>${c.type === 'percent' ? `${c.value}% off${c.maxDiscount ? ` <small class="muted">(max ${money(c.maxDiscount)})</small>` : ''}` : `${money(c.value)} off`}</td><td>${c.minSubtotal ? money(c.minSubtotal) : '—'}</td><td>${c.expires ? fmtDate(c.expires + 'T06:00:00Z') : 'Never'}</td><td class="num">${c.used || 0}${c.maxUses ? ` / ${c.maxUses}` : ''}</td><td><label class="switch"><input type="checkbox" class="cp-act" ${c.active ? 'checked' : ''} aria-label="Active"><span></span></label></td><td class="row-actions"><button type="button" class="ibtn" data-edit title="Edit">${ic('edit')}</button><button type="button" class="ibtn danger" data-del title="Delete">${ic('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${ic('ticket', 'empty-ic')}<h2>No coupons yet</h2><p>Create a code like EID10 for a festival sale.</p></div>`}</div>`;
  const form = (c = {}) => {
    const m = openLayer(`<form class="modal-body" id="cp-form"><h2>${c.code ? 'Edit coupon' : 'New coupon'}</h2>
      <label class="field"><span>Code *</span><input name="code" required maxlength="30" value="${esc(c.code || '')}" placeholder="e.g. EID10" style="text-transform:uppercase" autofocus></label>
      <div class="grid-2"><label class="field"><span>Type</span><select name="type"><option value="percent" ${c.type !== 'fixed' ? 'selected' : ''}>Percentage off</option><option value="fixed" ${c.type === 'fixed' ? 'selected' : ''}>Fixed amount off (৳)</option></select></label><label class="field"><span>Value *</span><input name="value" type="number" min="1" required value="${c.value ?? ''}"></label></div>
      <div class="grid-2"><label class="field"><span>Minimum order (৳)</span><input name="minSubtotal" type="number" min="0" value="${c.minSubtotal || ''}" placeholder="None"></label><label class="field"><span>Max discount (৳)</span><input name="maxDiscount" type="number" min="0" value="${c.maxDiscount || ''}" placeholder="No cap"></label></div>
      <div class="grid-2"><label class="field"><span>Expires on</span><input name="expires" type="date" value="${esc(c.expires || '')}"></label><label class="field"><span>Usage limit</span><input name="maxUses" type="number" min="1" value="${c.maxUses || ''}" placeholder="Unlimited"></label></div>
      <label class="switch-row"><span><b>Active</b></span><label class="switch"><input type="checkbox" name="active" ${c.active !== false ? 'checked' : ''}><span></span></label></label>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">${c.code ? 'Save' : 'Create coupon'}</button></div></form>`);
    $('#cp-form', m).addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = e.target.querySelector('button[type=submit]'); setBusy(btn, true);
      try { await api(c.code ? `/api/admin/coupons/${encodeURIComponent(c.code)}` : '/api/admin/coupons', { method: c.code ? 'PUT' : 'POST', body: formObj(e.target) }); closeLayer(); toast('Coupon saved'); route(); }
      catch (err) { setBusy(btn, false); toast(err.message, 'error'); }
    });
  };
  $('#cp-add', el).addEventListener('click', () => form());
  el.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-code]'); if (!tr) return;
    const c = coupons.find((x) => x.code === tr.dataset.code);
    if (e.target.closest('[data-edit]')) form(c);
    if (e.target.closest('[data-del]')) { if (!(await ask(`Delete coupon ${c.code}?`))) return; try { await api(`/api/admin/coupons/${encodeURIComponent(c.code)}`, { method: 'DELETE' }); toast('Coupon deleted'); route(); } catch (err) { toast(err.message, 'error'); } }
  });
  el.addEventListener('change', async (e) => {
    if (!e.target.classList.contains('cp-act')) return;
    const c = coupons.find((x) => x.code === e.target.closest('tr').dataset.code);
    try { await api(`/api/admin/coupons/${encodeURIComponent(c.code)}`, { method: 'PUT', body: { ...c, active: e.target.checked } }); toast(e.target.checked ? `${c.code} is active` : `${c.code} is paused`); } catch (err) { toast(err.message, 'error'); e.target.checked = !e.target.checked; }
  });
}

/* ========================================================= messages, subs */
async function viewMessages(el) {
  let { messages } = await api('/api/admin/messages');
  const draw = () => {
    el.innerHTML = `<div class="page-head"><div><h1>Messages</h1><p>Contact form, corporate quote requests and restock alerts from your shop.</p></div></div>
    <div class="msg-list">${messages.length ? messages.map((m) => { const kind = m.type === 'corporate' ? ['Corporate quote', 'pill-corp'] : /^restock/i.test(m.subject) ? ['Restock request', 'pill-restock'] : ['Support', 'pill-support']; return `<article class="card msg${m.read ? '' : ' unread'}" data-id="${m.id}">
      <header><span class="pill ${kind[1]}">${kind[0]}</span><b>${esc(m.name)}</b><span class="muted small">${ago(m.created)}</span>${m.read ? '' : '<span class="new-dot" title="Unread"></span>'}</header>
      ${m.subject ? `<h3>${esc(m.subject)}</h3>` : ''}${m.message ? `<p>${esc(m.message)}</p>` : ''}
      ${m.type === 'corporate' ? `<div class="meta">${m.meta.company ? `<span>Company: <b>${esc(m.meta.company)}</b></span>` : ''}${m.meta.quantity ? `<span>Quantity: <b>${esc(m.meta.quantity)}</b></span>` : ''}${m.meta.budget ? `<span>Budget: <b>${esc(m.meta.budget)}</b></span>` : ''}${m.meta.date ? `<span>Needed by: <b>${esc(m.meta.date)}</b></span>` : ''}</div>` : ''}
      <footer>${m.phone ? `<a class="btn btn-sm btn-ghost" href="tel:${esc(m.phone)}">${ic('phone')}${esc(m.phone)}</a><a class="btn btn-sm btn-ghost" href="https://wa.me/88${esc(m.phone)}" target="_blank" rel="noopener">${ic('whatsapp')}WhatsApp</a>` : ''}${m.email ? `<a class="btn btn-sm btn-ghost" href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: ' + (m.subject || 'Your message to BLISS'))}">${ic('mail')}Email</a>` : ''}<span class="grow"></span><button type="button" class="btn btn-sm btn-ghost" data-read="${m.read ? 0 : 1}">${m.read ? 'Mark unread' : `${ic('check')}Mark read`}</button><button type="button" class="ibtn danger" data-del title="Delete">${ic('trash')}</button></footer></article>`; }).join('') : `<div class="card"><div class="empty">${ic('inbox', 'empty-ic')}<h2>No messages yet</h2><p>Messages from your contact and corporate forms show up here.</p></div></div>`}</div>`;
  };
  el.addEventListener('click', async (e) => {
    const card = e.target.closest('.msg'); if (!card) return;
    const id = card.dataset.id;
    const rd = e.target.closest('[data-read]');
    if (rd) { try { await api(`/api/admin/messages/${id}`, { method: 'PATCH', body: { read: rd.dataset.read === '1' } }); messages = messages.map((m) => (m.id === id ? { ...m, read: rd.dataset.read === '1' } : m)); draw(); refreshCounts(); } catch (err) { toast(err.message, 'error'); } }
    if (e.target.closest('[data-del]')) { if (!(await ask('Delete this message?'))) return; try { await api(`/api/admin/messages/${id}`, { method: 'DELETE' }); messages = messages.filter((m) => m.id !== id); draw(); refreshCounts(); toast('Message deleted'); } catch (err) { toast(err.message, 'error'); } }
  });
  draw();
}
async function viewSubscribers(el, params) {
  let { subscribers, leads } = await api('/api/admin/subscribers');
  let tab = params?.get('tab') || (leads.length && !subscribers.length ? 'leads' : 'subs');
  const draw = () => {
    el.innerHTML = `<div class="page-head"><div><h1>Subscribers & leads</h1><p>Emails from the newsletter box, plus phone numbers and emails collected by your offer pop-up and lead funnels. Use them for SMS, WhatsApp broadcasts or Facebook custom audiences.</p></div><div class="head-actions"><a class="btn btn-ghost" href="${tab === 'leads' ? '/api/admin/leads.csv' : '/api/admin/subscribers.csv'}" download>${ic('download')}Export CSV</a></div></div>
    <div class="card card-flush"><div class="filter-tabs"><button type="button" class="ftab${tab === 'subs' ? ' on' : ''}" data-tab="subs">Newsletter emails<b>${subscribers.length}</b></button><button type="button" class="ftab${tab === 'leads' ? ' on' : ''}" data-tab="leads">Leads (phone & email)<b>${leads.length}</b></button></div>
    ${tab === 'subs' ? (subscribers.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Email</th><th>Joined</th><th></th></tr></thead><tbody>${subscribers.map((s) => `<tr data-email="${esc(s.email)}"><td>${esc(s.email)}</td><td>${fmtDate(s.created)}</td><td class="row-actions"><button type="button" class="ibtn danger" data-del title="Remove">${ic('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${ic('mail', 'empty-ic')}<h2>No subscribers yet</h2><p>Visitors who join from the footer get your welcome coupon automatically.</p></div>`)
      : (leads.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>From</th><th>Date</th><th></th></tr></thead><tbody>${leads.map((l) => `<tr data-lead="${l.id}"><td>${esc(l.name || '—')}</td><td>${l.phone ? phoneLinks(l.phone) : '—'}</td><td>${esc(l.email || '—')}</td><td>${l.funnel ? ic('funnel') : ''} ${esc(l.funnelName)}</td><td>${fmtDate(l.created)}</td><td class="row-actions"><button type="button" class="ibtn danger" data-ldel title="Remove">${ic('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${ic('users', 'empty-ic')}<h2>No leads yet</h2><p>Create a <a class="link" href="#/funnels/new?type=lead">lead capture funnel</a> or switch on the <a class="link" href="#/boosters">offer pop-up</a> to start collecting numbers.</p></div>`)}</div>`;
  };
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; draw(); return; }
    const lr = e.target.closest('tr[data-lead]');
    if (lr && e.target.closest('[data-ldel]')) { if (!(await ask('Remove this lead?'))) return; try { await api(`/api/admin/leads/${lr.dataset.lead}`, { method: 'DELETE' }); leads = leads.filter((l) => l.id !== lr.dataset.lead); draw(); toast('Lead removed'); } catch (err) { toast(err.message, 'error'); } return; }
    const tr = e.target.closest('tr[data-email]'); if (!tr || !e.target.closest('[data-del]')) return;
    const email = tr.dataset.email;
    if (!(await ask(`Remove ${email}?`))) return;
    try { await api(`/api/admin/subscribers/${encodeURIComponent(email)}`, { method: 'DELETE' }); subscribers = subscribers.filter((s) => s.email !== email); draw(); toast('Subscriber removed'); } catch (err) { toast(err.message, 'error'); }
  });
  draw();
}

/* ============================================================== inventory */
const REASONS = { order: 'Sold (order)', cancel: 'Order cancelled', return: 'Returned by customer', restore: 'Order restored', received: 'Stock received', count: 'Stock count / edit', damaged: 'Damaged', lost: 'Lost / missing', gift: 'Gift / sample', other: 'Other' };
async function viewInventory(el, params) {
  let d = await api('/api/admin/inventory');
  const st = { f: params.get('f') || '', q: params.get('q') || '' };
  el.innerHTML = `<div class="page-head"><div><h1>Inventory</h1><p>What's on your shelf, what it's worth, how fast it sells and what to reorder. Every stock change is recorded.</p></div><div class="head-actions"><a class="btn btn-ghost" href="/api/admin/inventory.csv" download>${ic('download')}Export CSV</a></div></div>
  <section class="kpis kpis-4" id="inv-kpis"></section>
  <div class="card card-flush"><div class="filter-tabs" id="inv-tabs"></div>
    <div class="toolbar"><label class="search-in">${ic('search')}<input id="inv-q" placeholder="Search by name, SKU or supplier…" value="${esc(st.q)}"></label></div>
    <div id="inv-list"></div></div>
  <section class="card"><div class="card-head"><div><h2>Recent stock movements</h2><p>Orders, returns, deliveries from suppliers and manual counts.</p></div></div><div id="inv-log"><div class="loading"><span class="spin"></span></div></div></section>`;
  const FILTERS = [['', 'All'], ['reorder', 'Reorder soon', (r) => r.reorder > 0], ['limited', 'Low stock', (r) => r.status === 'limited'], ['out', 'Out of stock', (r) => r.status === 'out'], ['dead', 'Not selling', (r) => r.dead], ['untracked', 'Quantity not tracked', (r) => r.qty == null], ['nocost', 'Missing cost price', (r) => r.cost == null]];
  const logRow = (x) => `<tr><td>${fmtDT(x.at)}</td><td><a href="#/products/${x.pid}">${esc(x.name)}</a></td><td>${esc(REASONS[x.reason] || x.reason)}${x.ref ? ` <a class="mono small" href="#/orders/${esc(x.ref)}">${esc(x.ref)}</a>` : ''}${x.note ? `<small class="block muted">${esc(x.note)}</small>` : ''}</td><td class="num ${x.delta > 0 ? 'ok-t' : 'bad-t'}"><b>${x.delta > 0 ? '+' : ''}${x.delta}</b></td><td class="num">${x.after}</td></tr>`;
  const loadLog = async () => { const { log } = await api('/api/admin/stock-log'); $('#inv-log', el).innerHTML = log.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Product</th><th>What happened</th><th class="num">Change</th><th class="num">Left</th></tr></thead><tbody>${log.slice(0, 25).map(logRow).join('')}</tbody></table></div>` : '<p class="muted">Stock changes will be listed here.</p>'; };
  const draw = () => {
    const s = d.summary;
    $('#inv-kpis', el).innerHTML = `<div class="kpi"><span class="kpi-label">Units on hand</span><b>${num(s.units)}</b><span class="kpi-sub">${s.tracked} of ${s.products} products tracked</span></div>
      <div class="kpi"><span class="kpi-label">Stock value at cost</span><b>${money(s.valueCost)}</b><span class="kpi-sub">${s.missingCost ? `<span class="warn-t">${s.missingCost} without a cost price</span>` : 'All costs entered'}</span></div>
      <div class="kpi"><span class="kpi-label">Value at selling price</span><b>${money(s.valueRetail)}</b><span class="kpi-sub">≈ ${money(s.valueRetail - s.valueCost)} profit when sold</span></div>
      <a class="kpi" href="#/inventory?f=dead"><span class="kpi-label">Needs action</span><b>${s.reorder} · ${s.out} · ${s.dead}</b><span class="kpi-sub">reorder · out of stock · not selling${s.deadValue ? ` (${money(s.deadValue)} tied up)` : ''}</span></a>`;
    $('#inv-tabs', el).innerHTML = FILTERS.map(([k, l, fn]) => `<button type="button" class="ftab${st.f === k ? ' on' : ''}" data-f="${k}">${l}<b>${fn ? d.rows.filter(fn).length : d.rows.length}</b></button>`).join('');
    const fn = FILTERS.find(([k]) => k === st.f)?.[2], t = st.q.toLowerCase();
    let rows = d.rows.filter((r) => (!fn || fn(r)) && (!t || [r.name, r.sku, r.supplier].some((x) => (x || '').toLowerCase().includes(t))));
    rows = rows.sort((a, b) => (b.reorder > 0) - (a.reorder > 0) || (a.cover ?? 1e9) - (b.cover ?? 1e9) || b.sold30 - a.sold30);
    $('#inv-list', el).innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl tbl-inv"><thead><tr><th>Product</th><th class="num">On hand</th><th class="num">Cost</th><th class="num">Stock value</th><th class="num">Sold (30d)</th><th class="num">Days left</th><th class="num">Reorder</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr data-id="${r.id}">
      <td><div class="p-cell sm"><img src="${esc(r.img || '/img/placeholder.svg')}" alt="" width="32" height="40" loading="lazy"><div><a class="p-name" href="#/products/${r.id}">${esc(r.name)}</a><small>${r.sku ? esc(r.sku) : 'No SKU'}${r.supplier ? ` · ${esc(r.supplier)}` : ''}${!r.active ? ' · <b class="hidden-tag">Hidden</b>' : ''}</small></div></div></td>
      <td class="num">${r.qty == null ? '<span class="muted" title="Quantity not tracked">—</span>' : `<b class="${r.status === 'out' ? 'bad-t' : r.status === 'limited' ? 'warn-t' : ''}">${num(r.qty)}</b>`}</td>
      <td class="num">${r.cost == null ? '<a class="link small" href="#/products/' + r.id + '">add</a>' : money(r.cost)}${r.margin != null ? `<small class="block muted">${pctFmt(r.margin)} margin</small>` : ''}</td>
      <td class="num">${r.valueCost != null ? money(r.valueCost) : r.valueRetail != null ? `<span class="muted">${money(r.valueRetail)} retail</span>` : '—'}</td>
      <td class="num">${r.sold30}${r.dead ? '<small class="block warn-t">not selling</small>' : r.lastSale ? `<small class="block muted">last ${ago(r.lastSale)}</small>` : ''}</td>
      <td class="num">${r.cover == null ? '<span class="muted">—</span>' : `<b class="${r.cover <= 7 ? 'bad-t' : r.cover <= 14 ? 'warn-t' : ''}">${r.cover}</b>`}</td>
      <td class="num">${r.reorder ? `<b class="brand-t">${num(r.reorder)}</b>` : '<span class="muted">—</span>'}</td>
      <td class="row-actions"><button type="button" class="btn btn-sm btn-ghost" data-inv="receive">${ic('plus')}Receive</button><button type="button" class="ibtn" data-inv="adjust" title="Count / write off">${ic('edit')}</button><button type="button" class="ibtn" data-inv="log" title="History">${ic('history')}</button></td></tr>`).join('')}</tbody></table></div>
      <p class="tbl-foot muted small">Days left = on hand ÷ average daily sales (last 30 days). Reorder = enough for the next 30 days. Not selling = stock but no sale in 90 days.</p>`
      : `<div class="empty">${ic('layers', 'empty-ic')}<h2>Nothing here</h2><p>${st.f ? 'No products match this filter. Nice!' : 'Add products to start tracking inventory.'}</p></div>`;
  };
  const modal = (r, kind) => {
    const m = openLayer(kind === 'receive'
      ? `<form class="modal-body" id="inv-form"><h2>Receive stock</h2><p class="muted">${esc(r.name)} · ${r.qty == null ? 'quantity not tracked yet' : `${r.qty} on hand now`}</p>
        <div class="grid-2"><label class="field"><span>Units received *</span><input name="qty" type="number" min="1" required autofocus></label><label class="field"><span>Cost per unit (৳)</span><input name="cost" type="number" min="0" step="0.01" placeholder="${r.cost ?? 'optional'}"></label></div>
        <label class="field"><span>Note</span><input name="note" maxlength="200" placeholder="e.g. Invoice #221 from Chawkbazar supplier"></label>
        <p class="muted small">If you enter a cost, we update the product's average cost (weighted by quantity) so profit stays accurate.</p>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Add to stock</button></div></form>`
      : `<form class="modal-body" id="inv-form"><h2>Count or write off</h2><p class="muted">${esc(r.name)} · ${r.qty == null ? 'quantity not tracked yet' : `${r.qty} on hand now`}</p>
        <div class="grid-2"><label class="field"><span>Quantity on the shelf now *</span><input name="count" type="number" min="0" required autofocus value="${r.qty ?? ''}"></label><label class="field"><span>Reason</span><select name="reason">${['count', 'damaged', 'lost', 'gift', 'return', 'other'].map((k) => `<option value="${k}">${REASONS[k]}</option>`).join('')}</select></label></div>
        <label class="field"><span>Note</span><input name="note" maxlength="200"></label>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save count</button></div></form>`);
    $('#inv-form', m).addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = e.submitter; setBusy(btn, true);
      try { d = await api(`/api/admin/inventory/${r.id}/${kind}`, { method: 'POST', body: formObj(e.target) }); closeLayer(); toast(kind === 'receive' ? 'Stock added' : 'Stock count saved'); draw(); loadLog(); refreshCounts(); A.products = []; }
      catch (err) { setBusy(btn, false); toast(err.message, 'error'); }
    });
  };
  el.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-f]'); if (tab) { st.f = tab.dataset.f; history.replaceState(null, '', `#/inventory${st.f ? '?f=' + st.f : ''}`); A.lastHash = location.hash; draw(); return; }
    const b = e.target.closest('[data-inv]'); if (!b) return;
    const r = d.rows.find((x) => x.id === b.closest('tr').dataset.id);
    if (b.dataset.inv === 'log') {
      const { log } = await api(`/api/admin/stock-log?pid=${r.id}`);
      openLayer(`<div class="modal-body"><h2>Stock history</h2><p class="muted">${esc(r.name)} · ${r.qty ?? '—'} on hand</p>${log.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>What happened</th><th class="num">Change</th><th class="num">Left</th></tr></thead><tbody>${log.map((x) => logRow(x).replace(/<td><a href="#\/products[^<]+<\/a><\/td>/, '')).join('')}</tbody></table></div>` : '<p class="muted">No stock changes recorded yet.</p>'}<div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Close</button></div></div>`, { wide: true });
      return;
    }
    modal(r, b.dataset.inv);
  });
  $('#inv-q', el).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); draw(); }, 120));
  draw(); loadLog();
}

/* ====================================================== abandoned carts */
async function viewAbandoned(el, params) {
  const [d, s] = await Promise.all([api('/api/admin/abandoned'), getSettings()]);
  let tab = params.get('tab') || 'open';
  let coupon = store.get('bliss.admin.recoverCoupon', d.coupon || '');
  const coupons = A.settingsExtra?.coupons || [];
  const st = d.stats, followed = st.contacted + st.recovered;
  el.innerHTML = `<div class="page-head"><div><h1>Abandoned carts</h1><p>People who typed their phone number at checkout but didn't order. A quick call or WhatsApp message often brings them back.</p></div></div>
  ${s.boosters.capture ? '' : `<div class="banner warn">${ic('info')}<span>Capturing abandoned checkouts is switched off. <a href="#/boosters">Turn it on in Sales boosters</a>.</span></div>`}
  <section class="kpis kpis-4">
    <div class="kpi"><span class="kpi-label">Waiting for follow-up</span><b>${num(st.open)}</b><span class="kpi-sub">call them within a day</span></div>
    <div class="kpi"><span class="kpi-label">Contacted</span><b>${num(st.contacted)}</b><span class="kpi-sub">no order yet</span></div>
    <div class="kpi"><span class="kpi-label">Recovered</span><b>${num(st.recovered)}</b><span class="kpi-sub">${money(st.recoveredValue)} in orders · ${pctFmt(followed ? st.recovered / followed : null)} of follow-ups</span></div>
    <div class="kpi"><span class="kpi-label">Came back on their own</span><b>${num(st.converted)}</b><span class="kpi-sub">ordered within the hour</span></div>
  </section>
  <div class="card card-flush"><div class="filter-tabs" id="ab-tabs"></div>
    <div class="toolbar"><label class="inline-label">Coupon in the WhatsApp message <select id="ab-coupon"><option value="">No coupon</option>${coupons.map((c) => `<option ${c === coupon ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label></div>
    <div id="ab-list"></div></div>`;
  const items = d.items;
  const draw = () => {
    const groups = { open: ['open'], contacted: ['contacted'], recovered: ['recovered', 'converted'], dismissed: ['dismissed'], all: null };
    $('#ab-tabs', el).innerHTML = [['open', 'To contact'], ['contacted', 'Contacted'], ['recovered', 'Ordered'], ['dismissed', 'Dismissed'], ['all', 'All']].map(([k, l]) => `<button type="button" class="ftab${tab === k ? ' on' : ''}" data-tab="${k}">${l}<b>${groups[k] ? items.filter((x) => groups[k].includes(x.status)).length : items.length}</b></button>`).join('');
    const list = items.filter((x) => !groups[tab] || groups[tab].includes(x.status));
    $('#ab-list', el).innerHTML = list.length ? `<ul class="ab-list">${list.map((x) => {
      const link = `${location.origin}/cart?restore=${x.token}`;
      const what = x.lines.map((l) => `${l.qty > 1 ? l.qty + '× ' : ''}${l.name}`).join(', ');
      const msg = `Hi ${(x.name || '').split(' ')[0] || 'there'}! This is ${s.store.name}. You left ${what} in your bag. We saved it for you here: ${link}${coupon ? `\nUse code ${coupon} for a little discount.` : ''}\nNeed help? Just reply to this message.`;
      return `<li class="ab" data-id="${x.id}"><div class="ab-who"><b>${esc(x.name || 'No name')}</b>${phoneLinks(x.phone)}<small class="muted">${ago(x.updated)}${x.city ? ` · ${esc(x.city)}` : ''}${x.funnelName ? ` · ${ic('funnel')}${esc(x.funnelName)}` : x.channel ? ` · ${esc(chName(x.channel))}` : ''}</small></div>
        <div class="ab-what"><span>${esc(what)}</span><b>${money(x.total)}</b></div>
        <div class="ab-act">${x.status === 'recovered' || x.status === 'converted' ? `<span class="pill st-delivered">${x.status === 'recovered' ? 'Recovered' : 'Ordered'}</span>${x.orderId ? `<a class="mono small" href="#/orders/${esc(x.orderId)}">${esc(x.orderId)}</a>` : ''}`
          : `<a class="btn btn-sm btn-primary" data-ab="wa" href="https://wa.me/88${esc(x.phone)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${ic('whatsapp')}WhatsApp</a><a class="btn btn-sm btn-ghost" data-ab="call" href="tel:${esc(x.phone)}">${ic('phone')}Call</a><button type="button" class="ibtn" data-ab="copy" data-link="${esc(link)}" title="Copy cart link">${ic('link')}</button>${x.status === 'dismissed' ? '<button type="button" class="ibtn" data-ab="open" title="Reopen">' + ic('history') + '</button>' : '<button type="button" class="ibtn danger" data-ab="dismiss" title="Dismiss">' + ic('close') + '</button>'}`}</div></li>`;
    }).join('')}</ul>` : `<div class="empty">${ic('cart', 'empty-ic')}<h2>${tab === 'open' ? 'Nobody to follow up right now' : 'Nothing here'}</h2><p>When someone enters their number at checkout and leaves, they appear here with a one-click WhatsApp message that restores their bag.</p></div>`;
  };
  const setStatus = async (id, status) => { try { await api(`/api/admin/abandoned/${id}`, { method: 'PATCH', body: { status } }); const x = items.find((i) => i.id === id); x.status = status; draw(); refreshCounts(); } catch (err) { toast(err.message, 'error'); } };
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; draw(); return; }
    const b = e.target.closest('[data-ab]'); if (!b) return;
    const id = b.closest('.ab').dataset.id, act = b.dataset.ab;
    if (act === 'wa' || act === 'call') { const x = items.find((i) => i.id === id); if (x.status === 'open') setTimeout(() => setStatus(id, 'contacted'), 300); }
    else if (act === 'copy') { navigator.clipboard?.writeText(b.dataset.link).then(() => toast('Cart link copied'), () => toast(b.dataset.link)); }
    else if (act === 'dismiss') setStatus(id, 'dismissed');
    else if (act === 'open') setStatus(id, 'open');
  });
  $('#ab-coupon', el).addEventListener('change', (e) => { coupon = e.target.value; store.set('bliss.admin.recoverCoupon', coupon); draw(); });
  draw();
}

/* ================================================================ funnels */
const FUNNEL_TYPES = {
  product: ['Product landing page', 'cart', 'One product, a persuasive page and a quick cash-on-delivery order form. Built for Facebook, Instagram and TikTok ads. Add an order bump and a one-click upsell to raise the order value.'],
  lead: ['Lead capture / giveaway', 'users', 'Collect phone numbers (and emails) for a giveaway, pre-launch or festival list. Visitors get a coupon right away; you get a list to message later.'],
  collection: ['Campaign sale page', 'tag', 'A timed sale page with a handful of products and a coupon that applies automatically. Perfect for Eid, Valentine\'s Day or a flash sale.'],
};
async function viewFunnels(el) {
  const d = await api('/api/admin/funnels');
  const typeCard = (k) => `<a class="ftype" href="#/funnels/new?type=${k}"><span class="ftype-ic">${ic(FUNNEL_TYPES[k][1])}</span><b>${FUNNEL_TYPES[k][0]}</b><small>${FUNNEL_TYPES[k][2]}</small><span class="link">Create ${ic('chev-right')}</span></a>`;
  el.innerHTML = `<div class="page-head"><div><h1>Funnels</h1><p>A funnel is a focused page with one goal: ad → page → order. No menus and no distractions, so more visitors buy. Each funnel has its own link to use in your ads.</p></div></div>
  <section class="card how">
    <h2 class="card-title">How a funnel works</h2>
    <ol class="how-steps">
      <li><span class="how-ic">${ic('users')}</span><b>1. Your ad</b><small>People see your Facebook, Instagram or TikTok ad and tap it.</small></li>
      <li><span class="how-ic">${ic('funnel')}</span><b>2. Landing page</b><small>They open your funnel link (<code>/f/…</code>): one page about one offer. No menu and nothing to distract them.</small></li>
      <li><span class="how-ic">${ic('cart')}</span><b>3. Quick order</b><small>Name, phone and address on the same page, cash on delivery. A tick-box add-on makes the order bigger.</small></li>
      <li><span class="how-ic">${ic('check-circle')}</span><b>4. Order + extra offer</b><small>After ordering they can add one more item with one tap. The order appears in Orders; results appear here.</small></li>
    </ol>
    <p class="how-note">${ic('info')}<span>The small cards that pop up on your shop (“Someone in Dhaka bought…”) or the discount pop-up are <b>not funnels</b>. They are <a class="link" href="#/boosters">Sales boosters</a> and work on every page of your shop; switch each one on or off there. A funnel only exists at its own link, and you send people to it from your ads.</span></p>
  </section>
  <section class="ftypes">${Object.keys(FUNNEL_TYPES).map(typeCard).join('')}</section>
  <h2 class="sec-h">Your funnels <span class="muted small">· results from the last 30 days</span></h2>
  <div class="funnel-list">${d.funnels.length ? d.funnels.map((f) => { const s = f.stats || {}; const link = `${location.origin}/f/${f.slug}`; return `<article class="card fcard" data-id="${f.id}">
    <div class="fcard-top"><span class="pill pill-type">${ic(FUNNEL_TYPES[f.type][1])}${FUNNEL_TYPES[f.type][0]}</span><label class="switch" title="${f.active ? 'Live' : 'Paused'}"><input type="checkbox" class="f-act" ${f.active ? 'checked' : ''} aria-label="Funnel live"><span></span></label></div>
    <h3><a href="#/funnels/${f.id}">${esc(f.name)}</a></h3>
    <div class="flink"><code>${esc(link)}</code><button type="button" class="ibtn sm" data-copy="${esc(link)}" title="Copy link">${ic('copy')}</button><a class="ibtn sm" href="/f/${esc(f.slug)}" target="_blank" rel="noopener" title="Open page">${ic('external')}</a></div>
    <div class="fstats"><div><b>${num(s.visits)}</b><span>visitors</span></div><div><b>${num(f.type === 'lead' ? s.leads : s.orders)}</b><span>${f.type === 'lead' ? 'leads' : 'orders'}</span></div><div><b>${pctFmt(s.conversion, 1)}</b><span>conversion</span></div>${f.type === 'lead' ? '' : `<div><b>${money(s.revenue)}</b><span>sales</span></div>`}</div>
    ${f.type === 'product' && (s.bumps || s.upsells) ? `<p class="muted small">${s.bumps} took the order bump · ${s.upsells} took the upsell</p>` : ''}
    <div class="fcard-act"><a class="btn btn-sm btn-ghost" href="#/funnels/${f.id}">${ic('edit')}Edit</a><button type="button" class="btn btn-sm btn-ghost" data-dup>${ic('copy')}Duplicate</button>${f.type === 'lead' ? `<a class="btn btn-sm btn-ghost" href="/api/admin/leads.csv?funnel=${f.id}" download>${ic('download')}Leads</a>` : ''}<button type="button" class="ibtn danger" data-del title="Delete">${ic('trash')}</button></div>
  </article>`; }).join('') : `<div class="card empty">${ic('funnel', 'empty-ic')}<h2>No funnels yet</h2><p>Pick a type above to create your first one in a couple of minutes.</p></div>`}</div>
  <section class="card tips"><h2 class="card-title">${ic('info')} Getting the most from funnels</h2><ul class="ticks-list">
    <li>Use the funnel link in your ad, and add <code>?utm_source=facebook&amp;utm_campaign=eid-offer</code> so <a class="link" href="#/analytics">Traffic & funnel</a> shows results per campaign.</li>
    <li>Add your Facebook Pixel in <a class="link" href="#/boosters">Sales boosters</a> so Facebook can find more buyers like yours (it tracks views, add to cart, checkout and purchases).</li>
    <li>Test one change at a time: duplicate a funnel, change the headline or price package, and run both for a few days.</li></ul></section>`;
  el.addEventListener('click', async (e) => {
    const cp = e.target.closest('[data-copy]'); if (cp) { navigator.clipboard?.writeText(cp.dataset.copy).then(() => toast('Link copied'), () => toast(cp.dataset.copy)); return; }
    const card = e.target.closest('.fcard'); if (!card) return;
    const f = d.funnels.find((x) => x.id === card.dataset.id);
    if (e.target.closest('[data-dup]')) { try { const r = await api(`/api/admin/funnels/${f.id}/duplicate`, { method: 'POST' }); toast('Duplicated as a paused copy'); location.hash = `#/funnels/${r.funnel.id}`; } catch (err) { toast(err.message, 'error'); } }
    if (e.target.closest('[data-del]')) { if (!(await ask(`Delete “${f.name}”?`, { detail: 'The page link stops working. Orders and leads it brought in are kept.' }))) return; try { await api(`/api/admin/funnels/${f.id}`, { method: 'DELETE' }); toast('Funnel deleted'); route(); } catch (err) { toast(err.message, 'error'); } }
  });
  el.addEventListener('change', async (e) => {
    if (!e.target.classList.contains('f-act')) return;
    const f = d.funnels.find((x) => x.id === e.target.closest('.fcard').dataset.id);
    try { await api(`/api/admin/funnels/${f.id}`, { method: 'PUT', body: { ...f, active: e.target.checked } }); f.active = e.target.checked; toast(e.target.checked ? 'Funnel is live' : 'Funnel paused'); } catch (err) { toast(err.message, 'error'); e.target.checked = !e.target.checked; }
  });
}
function funnelTemplate(type, prods) {
  const p = prods.find((x) => x.active && x.status !== 'out' && x.options <= 1) || prods[0] || { id: '', price: 0 };
  const base = { type, name: '', slug: '', active: true, headline: '', subheadline: '', image: '', video: '', cta: '', body: '', benefits: [], faq: [], guarantee: '', pid: '', compare: 0, packages: [], deadline: { mode: 'none', at: '', minutes: 30 }, freeDelivery: false, deliveryInside: null, deliveryOutside: null, showReviews: true, bump: { enabled: false, pid: '', price: 0, text: '' }, upsell: { enabled: false, pid: '', price: 0, headline: '', text: '', minutes: 30 }, coupon: '', askEmail: false, success: '', ctaLink: '/shop', pids: [] };
  if (type === 'product') return { ...base, pid: p.id, cta: 'Order now, pay on delivery', headline: 'The perfect gift, delivered to their door', subheadline: 'Beautifully packed, with a free handwritten card. Pay cash when it arrives.', benefits: ['Cash on delivery: check it, then pay', 'Free handwritten message card', 'Delivered in 1–2 days in Dhaka, 2–4 days across Bangladesh'], faq: [{ q: 'How do I pay?', a: 'Cash on delivery. Pay the rider when your parcel arrives.' }, { q: 'Can I return it?', a: 'Unused items can be exchanged within 7 days.' }], guarantee: 'Damaged on arrival? We replace it free.', packages: [{ label: '1 piece', qty: 1, price: p.price }, { label: '2 pieces (save 10%)', qty: 2, price: Math.round(p.price * 1.8) }], deadline: { mode: 'evergreen', at: '', minutes: 30 } };
  if (type === 'lead') return { ...base, cta: 'Count me in', headline: 'Win a gift hamper this Eid', subheadline: 'Enter your number for a chance to win. Everyone gets a discount code right away.', benefits: ['One winner every week', 'Instant discount code for everyone', 'We never spam'], success: 'You are in! Here is your discount code:', askEmail: false };
  return { ...base, cta: 'Shop the sale', headline: 'Flash sale: up to 30% off', subheadline: 'Hand-picked gifts at our best prices, for a short time only.', deadline: { mode: 'fixed', at: '', minutes: 30 }, pids: prods.filter((x) => x.active).slice(0, 8).map((x) => x.id) };
}
async function viewFunnelForm(el, id, params) {
  const [d] = await Promise.all([api('/api/admin/funnels'), getSettings()]);
  const prods = d.products, coupons = A.settingsExtra?.coupons || [];
  const ex = id ? d.funnels.find((x) => x.id === id) : null;
  if (id && !ex) { el.innerHTML = `<div class="empty">${ic('funnel', 'empty-ic')}<h2>Funnel not found</h2><a class="btn btn-ghost" href="#/funnels">Back to funnels</a></div>`; return; }
  const v = ex ? structuredClone(ex) : funnelTemplate(FUNNEL_TYPES[params.get('type')] ? params.get('type') : 'product', prods);
  const type = v.type, s = ex?.stats;
  const opt = (sel, filter = () => true) => prods.filter(filter).map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} · ${money(p.price)}${p.status === 'out' ? ' (out of stock)' : ''}${!p.active ? ' (hidden)' : ''}</option>`).join('');
  const sw = (name, label, sub, on) => `<label class="switch-row"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><label class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span></span></label></label>`;
  const defs = { packages: [['label', 'Label shown to buyers'], ['qty', 'Units', 'number', 'min="1" max="100"'], ['price', 'Price (৳)', 'number', 'min="0"']], faq: [['q', 'Question'], ['a', 'Answer']] };
  el.innerHTML = `<div class="page-head"><div><a class="back" href="#/funnels">${ic('arrow-left')}Funnels</a><h1>${ex ? esc(ex.name) : `New ${FUNNEL_TYPES[type][0].toLowerCase()}`}</h1><p>${FUNNEL_TYPES[type][2]}</p></div>
    <div class="head-actions">${ex ? `<a class="btn btn-ghost" href="/f/${esc(ex.slug)}" target="_blank" rel="noopener">${ic('eye')}View page</a>` : ''}</div></div>
  ${s ? `<section class="kpis kpis-4"><div class="kpi"><span class="kpi-label">Visitors (30 days)</span><b>${num(s.visits)}</b></div><div class="kpi"><span class="kpi-label">${type === 'lead' ? 'Leads' : 'Orders'}</span><b>${num(type === 'lead' ? s.leads : s.orders)}</b><span class="kpi-sub">${pctFmt(s.conversion, 1)} conversion</span></div><div class="kpi"><span class="kpi-label">${type === 'lead' ? 'Started' : 'Sales'}</span><b>${type === 'lead' ? num(s.visits) : money(s.revenue)}</b></div><div class="kpi"><span class="kpi-label">Bump · upsell taken</span><b>${s.bumps} · ${s.upsells}</b></div></section>` : ''}
  <form id="fform" class="pform" novalidate>
    <div class="pform-main">
      <section class="card"><h2 class="card-title">Page content</h2>
        <label class="field"><span>Headline * <em>(wrap words in *stars* to highlight them)</em></span><input name="headline" maxlength="160" required value="${esc(v.headline)}"></label>
        <label class="field"><span>Sub-headline</span><textarea name="subheadline" rows="2" maxlength="400">${esc(v.subheadline)}</textarea></label>
        <div class="field"><span class="flabel">Main image</span><div class="cat-img-row"><img id="f-img" src="${esc(v.image || (type === 'product' ? prods.find((p) => p.id === v.pid)?.img : '') || '/img/placeholder.svg')}" alt=""><div><button type="button" class="btn btn-sm btn-ghost" id="f-up">${ic('upload')}Upload image</button><input type="file" accept="image/*" id="f-file" hidden><p class="muted small">${type === 'product' ? 'Leave empty to use the product photos.' : 'A bright, simple photo works best.'}</p></div></div><input type="hidden" name="image" value="${esc(v.image)}"></div>
        <label class="field"><span>YouTube video link <em>(optional; shown under the headline)</em></span><input name="video" maxlength="200" value="${v.video ? 'https://youtu.be/' + esc(v.video) : ''}" placeholder="https://youtu.be/…"></label>
        <label class="field"><span>Story / description <em>(blank line = new paragraph)</em></span><textarea name="body" rows="5" maxlength="6000">${esc(v.body)}</textarea></label>
        <label class="field"><span>Benefits <em>(one per line, shown with ticks)</em></span><textarea name="benefits" rows="4">${esc(v.benefits.join('\n'))}</textarea></label>
        <div class="field"><span class="flabel">Questions & answers</span>${repeaterHtml('faq', v.faq, defs.faq)}</div>
        <div class="grid-2"><label class="field"><span>Guarantee line</span><input name="guarantee" maxlength="240" value="${esc(v.guarantee)}" placeholder="e.g. Damaged on arrival? Free replacement."></label><label class="field"><span>Button text</span><input name="cta" maxlength="60" value="${esc(v.cta)}"></label></div>
      </section>
      ${type === 'product' ? `<section class="card"><h2 class="card-title">The offer</h2>
        <label class="field"><span>Product *</span><select name="pid">${opt(v.pid, (p) => p.options <= 1)}</select></label>
        <div class="field"><span class="flabel">Price packages <em>(leave empty to sell single items at the normal price)</em></span>${repeaterHtml('packages', v.packages, defs.packages)}<p class="muted small">Example: “1 piece” 1 × ৳990, “2 pieces (save ৳200)” 2 × ৳1,780. Bigger packages raise your average order.</p></div>
        <label class="field"><span>“Regular price” to show crossed out (৳)</span><input name="compare" type="number" min="0" value="${v.compare || ''}" placeholder="optional"></label>
        <div class="grid-3"><label class="field"><span>Countdown</span><select name="deadline.mode"><option value="none" ${v.deadline.mode === 'none' ? 'selected' : ''}>No countdown</option><option value="evergreen" ${v.deadline.mode === 'evergreen' ? 'selected' : ''}>Personal timer per visitor</option><option value="fixed" ${v.deadline.mode === 'fixed' ? 'selected' : ''}>Ends on a date</option></select></label><label class="field"><span>Timer minutes</span><input name="deadline.minutes" type="number" min="5" value="${v.deadline.minutes}"></label><label class="field"><span>End date & time</span><input name="deadline.at" type="datetime-local" value="${esc((v.deadline.at || '').slice(0, 16))}"></label></div>
        <p class="muted small">Personal timer: each visitor sees the offer expire after the minutes you set (honest urgency; the price itself is fixed). A dated countdown hides the order form once the date passes.</p>
        ${sw('freeDelivery', 'Free delivery', 'For this page only', v.freeDelivery)}
        <div class="grid-2"><label class="field"><span>Delivery inside Dhaka (৳)</span><input name="deliveryInside" type="number" min="0" value="${v.deliveryInside ?? ''}" placeholder="shop default"></label><label class="field"><span>Delivery outside Dhaka (৳)</span><input name="deliveryOutside" type="number" min="0" value="${v.deliveryOutside ?? ''}" placeholder="shop default"></label></div>
        ${sw('showReviews', 'Show product reviews', 'Approved reviews of this product', v.showReviews)}
      </section>
      <section class="card"><h2 class="card-title">Order bump <em>(a tick-box add-on in the order form)</em></h2>
        ${sw('bump.enabled', 'Offer an add-on', 'Usually a small, cheap item. 10–30% of buyers tick it.', v.bump.enabled)}
        <div class="grid-2"><label class="field"><span>Product</span><select name="bump.pid"><option value="">Choose…</option>${opt(v.bump.pid, (p) => !p.options)}</select></label><label class="field"><span>Special price (৳)</span><input name="bump.price" type="number" min="0" value="${v.bump.price || ''}"></label></div>
        <label class="field"><span>Text next to the tick-box</span><input name="bump.text" maxlength="200" value="${esc(v.bump.text)}" placeholder="Yes! Add a box of chocolates"></label>
      </section>
      <section class="card"><h2 class="card-title">One-click upsell <em>(shown right after the order)</em></h2>
        ${sw('upsell.enabled', 'Offer something extra after ordering', 'Added to the same cash-on-delivery order with one tap. No new delivery charge.', v.upsell.enabled)}
        <div class="grid-3"><label class="field"><span>Product</span><select name="upsell.pid"><option value="">Choose…</option>${opt(v.upsell.pid, (p) => !p.options)}</select></label><label class="field"><span>Special price (৳)</span><input name="upsell.price" type="number" min="0" value="${v.upsell.price || ''}"></label><label class="field"><span>Offer valid (minutes)</span><input name="upsell.minutes" type="number" min="5" max="1440" value="${v.upsell.minutes || 30}"></label></div>
        <div class="grid-2"><label class="field"><span>Headline</span><input name="upsell.headline" maxlength="120" value="${esc(v.upsell.headline)}" placeholder="Wait! Make it extra special"></label><label class="field"><span>Text</span><input name="upsell.text" maxlength="200" value="${esc(v.upsell.text)}"></label></div>
      </section>` : ''}
      ${type === 'lead' ? `<section class="card"><h2 class="card-title">Form & reward</h2>
        ${sw('askEmail', 'Also ask for email', 'Phone number is always asked', v.askEmail)}
        <div class="grid-2"><label class="field"><span>Coupon to reveal</span><select name="coupon"><option value="">No coupon</option>${coupons.map((c) => `<option ${c === v.coupon ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label class="field"><span>Button link after sign-up</span><input name="ctaLink" value="${esc(v.ctaLink)}" placeholder="/shop"></label></div>
        <label class="field"><span>Thank-you message</span><input name="success" maxlength="300" value="${esc(v.success)}"></label>
      </section>` : ''}
      ${type === 'collection' ? `<section class="card"><h2 class="card-title">Products & coupon</h2>
        <div class="grid-3"><label class="field"><span>Coupon applied automatically</span><select name="coupon"><option value="">No coupon</option>${coupons.map((c) => `<option ${c === v.coupon ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label class="field"><span>Countdown</span><select name="deadline.mode"><option value="none" ${v.deadline.mode === 'none' ? 'selected' : ''}>No countdown</option><option value="fixed" ${v.deadline.mode === 'fixed' ? 'selected' : ''}>Ends on a date</option></select></label><label class="field"><span>Sale ends</span><input name="deadline.at" type="datetime-local" value="${esc((v.deadline.at || '').slice(0, 16))}"></label></div>
        <label class="search-in">${ic('search')}<input id="f-pq" placeholder="Filter products…"></label>
        <div class="pick-grid" id="f-picks">${prods.map((p) => `<label class="pick${v.pids.includes(p.id) ? ' on' : ''}" data-n="${esc(p.name.toLowerCase())}"><input type="checkbox" name="pick" value="${p.id}" ${v.pids.includes(p.id) ? 'checked' : ''}><img src="${esc(p.img || '/img/placeholder.svg')}" alt="" width="36" height="45" loading="lazy"><span>${esc(p.name)}<small>${money(p.price)}</small></span></label>`).join('')}</div>
      </section>` : ''}
    </div>
    <div class="pform-side">
      <section class="card"><h2 class="card-title">Settings</h2>
        <label class="field"><span>Funnel name * <em>(only you see this)</em></span><input name="name" maxlength="80" required value="${esc(v.name)}" placeholder="e.g. Eid hamper – Facebook ad"></label>
        <label class="field"><span>Page link</span><div class="prefix-in"><span>/f/</span><input name="slug" maxlength="60" value="${esc(v.slug)}" placeholder="auto from name"></div></label>
        ${sw('active', 'Live', 'Turn off to pause the page', v.active)}
      </section>
      <section class="card tips"><h2 class="card-title">${ic('info')} Tips that sell</h2><ul class="ticks-list small">
        <li>Headline: the result they get, not the product name.</li><li>Real photos and a short video beat long text.</li><li>Put the order form above the fold on mobile; most ad traffic is on phones.</li><li>Cash on delivery + “check before you pay” removes fear.</li><li>Keep the bump cheap (under 30% of the main price).</li></ul></section>
    </div>
    <div class="savebar"><span class="muted" id="f-state">${ex ? 'All changes saved' : 'New funnel'}</span><a class="btn btn-ghost" href="#/funnels">Cancel</a><button class="btn btn-primary" type="submit" id="f-save">${ic('check')}${ex ? 'Save funnel' : 'Create funnel'}</button></div>
  </form>`;
  const f = $('#fform', el);
  bindRepeaters(el, defs);
  f.addEventListener('input', () => { A.dirty = true; $('#f-state', el).textContent = 'Unsaved changes'; });
  $('#f-up', el).addEventListener('click', () => $('#f-file', el).click());
  $('#f-file', el).addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { const u = await uploadImage(file); $('#f-img', el).src = u; f.elements.image.value = u; A.dirty = true; } catch (err) { toast(err.message, 'error'); } });
  $('#f-pq', el)?.addEventListener('input', (e) => { const t = e.target.value.trim().toLowerCase(); $$('.pick', el).forEach((x) => { x.hidden = t && !x.dataset.n.includes(t); }); });
  el.addEventListener('change', (e) => { if (e.target.name === 'pick') e.target.closest('.pick').classList.toggle('on', e.target.checked); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const x = nested(f);
    const body = { ...x, type, benefits: x.benefits, faq: readRep(el, 'faq'), packages: type === 'product' ? readRep(el, 'packages') : [], pids: $$('input[name=pick]:checked', f).map((i) => i.value) };
    delete body.pick;
    for (const k of ['compare', 'deliveryInside', 'deliveryOutside']) if (body[k] === '') body[k] = k === 'compare' ? 0 : null;
    const btn = $('#f-save', el); setBusy(btn, true);
    try {
      const r = ex ? await api(`/api/admin/funnels/${ex.id}`, { method: 'PUT', body }) : await api('/api/admin/funnels', { method: 'POST', body });
      A.dirty = false; toast(ex ? 'Funnel saved' : 'Funnel created. Copy its link into your ad!');
      if (!ex) location.hash = `#/funnels/${r.funnel.id}`; else route();
    } catch (err) { setBusy(btn, false); if (err.data?.field && f.elements[err.data.field]) { f.elements[err.data.field].closest('.field')?.classList.add('invalid'); f.elements[err.data.field].focus(); } toast(err.message, 'error'); }
  });
}
/** Form → nested object: name="a.b" becomes {a:{b}}; checkboxes become booleans. */
function nested(form) {
  const body = {};
  for (const inp of form.elements) {
    if (!inp.name || inp.closest('.rep') || inp.disabled || (inp.type === 'radio' && !inp.checked)) continue;
    const v = inp.type === 'checkbox' ? inp.checked : inp.value;
    const path = inp.name.split('.');
    let o = body; for (let i = 0; i < path.length - 1; i++) o = o[path[i]] ||= {};
    o[path.at(-1)] = v;
  }
  return body;
}

/* ============================================================== analytics */
async function viewAnalytics(el) {
  const s = await getSettings();
  el.innerHTML = `<div class="page-head"><div><h1>Traffic & funnel</h1><p>Where your visitors come from, where they drop off, and which pages and products turn visits into orders.</p></div></div>
  <div id="an-range" class="range-host"></div><div id="an-body"><div class="loading"><span class="spin"></span></div></div>`;
  const load = async (r) => {
    const body = $('#an-body', el); body.classList.add('refetch');
    const d = await api(`/api/admin/analytics?from=${r.from}&to=${r.to}`);
    body.classList.remove('refetch');
    const t = d.totals, px = s.tracking;
    const dev = Object.entries(d.devices), devTotal = dev.reduce((a, [, n]) => a + n, 0);
    body.innerHTML = `
    <section class="kpis kpis-6">
      <div class="kpi"><span class="kpi-label">Visitors</span><b>${num(t.visits)}</b><span class="kpi-sub">${delta(t.visits, d.prev.visits)} vs previous period</span></div>
      <div class="kpi"><span class="kpi-label">Online orders</span><b>${num(t.orders)}</b><span class="kpi-sub">${delta(t.orders, d.prev.orders)}</span></div>
      <div class="kpi"><span class="kpi-label">Conversion rate</span><b>${t.visits ? pctFmt(Math.min(1, t.orders / t.visits), 1) : '—'}</b><span class="kpi-sub">visitors who ordered</span></div>
      <div class="kpi"><span class="kpi-label">Online sales</span><b>${money(t.revenue)}</b><span class="kpi-sub">${delta(t.revenue, d.prev.revenue)}</span></div>
      <div class="kpi"><span class="kpi-label">Leads collected</span><b>${num(t.leads)}</b><span class="kpi-sub">popup + lead funnels</span></div>
      <div class="kpi"><span class="kpi-label">Extra from bumps & upsells</span><b>${money(t.bumpRevenue + t.upsellRevenue)}</b><span class="kpi-sub">${t.bumps} bumps · ${t.upsells} upsells</span></div>
    </section>
    <section class="grid-main">
      <div class="col">
        <div class="card"><div class="card-head"><div><h2>Visitors by day</h2><p>Each visitor counts once per day. Bots are ignored.</p></div></div><div id="an-chart"></div></div>
        <div class="card"><div class="card-head"><h2>Shop funnel</h2></div>${funnelBars({ visits: t.visits, productViews: t.productViews, carts: t.carts, checkouts: t.checkouts, orders: t.orders })}</div>
        <div class="card card-flush"><div class="card-head pad"><div><h2>Traffic sources</h2><p>From ad links (utm_source), Facebook/Google click IDs and the referring website.</p></div></div>${d.sources.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Source</th><th class="num">Visitors</th><th class="num">Orders</th><th class="num">Sales</th><th class="num">Conversion</th></tr></thead><tbody>${d.sources.map((x) => `<tr><td><b>${esc(chName(x.channel))}</b></td><td class="num">${num(x.visits)}</td><td class="num">${num(x.orders)}</td><td class="num">${money(x.revenue)}</td><td class="num">${pctFmt(x.conversion, 1)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted pad">No visits recorded in this period yet.</p>'}</div>
        <div class="card card-flush"><div class="card-head pad"><div><h2>Funnels (landing pages)</h2><p>Visitors, results and extra sales per funnel.</p></div><a class="link" href="#/funnels">Manage</a></div>${d.funnels.length ? `<div class="tbl-wrap"><table class="tbl tbl-click"><thead><tr><th>Funnel</th><th class="num">Visitors</th><th class="num">Orders / leads</th><th class="num">Conversion</th><th class="num">Sales</th><th class="num">Bump · upsell</th></tr></thead><tbody>${d.funnels.map((x) => `<tr data-href="#/funnels/${x.id}"><td><b>${esc(x.name)}</b><small class="block muted">${FUNNEL_TYPES[x.type][0]}${x.active ? '' : ' · paused'}</small></td><td class="num">${num(x.visits)}</td><td class="num">${num(x.type === 'lead' ? x.leads : x.orders)}</td><td class="num">${pctFmt(x.conversion, 1)}</td><td class="num">${x.type === 'lead' ? '—' : money(x.revenue)}</td><td class="num">${x.type === 'product' ? `${x.bumps} · ${x.upsells}` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted pad">No funnels yet.</p>'}</div>
      </div>
      <div class="col">
        <div class="card"><h2 class="card-title">Ad tracking</h2>
          <ul class="px-list"><li class="${px.fbPixel ? 'on' : ''}">${ic(px.fbPixel ? 'check-circle' : 'x-circle')}<span>Facebook Pixel${px.fbPixel ? ` <small class="muted">${esc(px.fbPixel)}</small>` : ''}</span></li><li class="${px.ga4 ? 'on' : ''}">${ic(px.ga4 ? 'check-circle' : 'x-circle')}<span>Google Analytics 4${px.ga4 ? ` <small class="muted">${esc(px.ga4)}</small>` : ''}</span></li><li class="${px.tiktok ? 'on' : ''}">${ic(px.tiktok ? 'check-circle' : 'x-circle')}<span>TikTok Pixel</span></li></ul>
          <a class="btn btn-ghost btn-sm" href="#/boosters?s=tracking">Set up pixels</a></div>
        <div class="card"><h2 class="card-title">Devices</h2>${barList(dev.map(([k, n]) => [k === 'mobile' ? 'Mobile' : 'Computer', n, pctFmt(devTotal ? n / devTotal : 0)]), num)}</div>
        <div class="card"><div class="card-head"><div><h2>Product interest</h2><p>Many views but few sales? Check the price, photos or description.</p></div></div>${d.products.length ? `<ul class="pi-list">${d.products.map((x) => { const rate = x.views ? x.sold / x.views : 0; const flag = x.views >= 20 && rate < 0.02; return `<li><img src="${esc(x.img || '/img/placeholder.svg')}" alt="" width="32" height="40"><a href="#/products/${x.pid}">${esc(x.name)}</a><span><b>${num(x.views)}</b> views · <b>${num(x.sold)}</b> sold${flag ? ` <span class="pill pill-risk" title="High interest, low sales">${ic('alert')}check</span>` : ''}</span></li>`; }).join('')}</ul>` : '<p class="muted small">Product views appear as visitors browse.</p>'}</div>
      </div>
    </section>`;
    mountLineChart($('#an-chart', body), d.series, 'visits');
  };
  const r = rangePicker($('#an-range', el), load);
  el.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; });
  await load(r);
}

/* ========================================================= sales boosters */
async function viewBoosters(el, params) {
  A.settings = null;
  const s = await getSettings();
  const b = s.boosters, prods = A.settingsExtra.products, coupons = A.settingsExtra.coupons;
  const sw = (name, label, sub, on) => `<label class="switch-row"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><label class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span></span></label></label>`;
  const popt = (sel) => `<option value="">Choose a product…</option>${prods.filter((p) => !p.options).map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} · ${money(p.price)}${p.status === 'out' ? ' (out of stock)' : ''}</option>`).join('')}`;
  const copt = (sel) => `<option value="">No coupon</option>${coupons.map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
  el.innerHTML = `<div class="page-head"><div><h1>Sales boosters</h1><p>Proven ways to turn more visitors into buyers and raise the value of each order. Switch each one on or off; changes go live when you save.</p></div></div>
  <form id="bstform">
    <section class="grid-2">
      <div class="card"><h2 class="card-title">Trust & urgency</h2>
        ${sw('boosters.proof', 'Recent purchase pop-ups', 'Small note in the corner: “Someone in Dhaka bought … 2 hours ago”. Uses your real orders from the last 7 days only.', b.proof)}
        ${sw('boosters.proofNames', 'Show buyer first names', 'Off = “Someone in Dhaka”. On = “Nusrat in Dhaka”.', b.proofNames)}
        ${sw('boosters.soldCount', '“Sold in the last 7 days” on products', 'Shown when 3 or more were sold (real order data).', b.soldCount)}
        ${sw('boosters.fbt', '“Frequently bought together”', 'On product pages, from products customers really bought together, with one-tap “add both”.', b.fbt)}
        ${sw('boosters.chat', 'Floating WhatsApp / Messenger button', 'Uses the WhatsApp number and Messenger link in Settings › Store details.', b.chat)}
      </div>
      <div class="card"><h2 class="card-title">Recover lost sales</h2>
        ${sw('boosters.capture', 'Save abandoned checkouts', 'When a shopper enters their phone number at checkout and leaves, they appear in Abandoned carts with a WhatsApp message that restores their bag.', b.capture)}
        <h3 class="mini-h">Offer pop-up</h3>
        ${sw('boosters.popup.enabled', 'Show an offer pop-up', 'Once every 3 days per visitor, never on checkout.', b.popup.enabled)}
        <div class="grid-2"><label class="field"><span>Show after (seconds)</span><input name="boosters.popup.delay" type="number" min="0" max="600" value="${b.popup.delay}"></label><label class="field"><span>Ask for</span><select name="boosters.popup.ask"><option value="email" ${b.popup.ask === 'email' ? 'selected' : ''}>Email</option><option value="phone" ${b.popup.ask === 'phone' ? 'selected' : ''}>Mobile number</option></select></label></div>
        ${sw('boosters.popup.exit', 'Also when leaving (computers)', 'Shows when the mouse moves to close the tab.', b.popup.exit)}
        <label class="field"><span>Title</span><input name="boosters.popup.title" maxlength="100" value="${esc(b.popup.title)}"></label>
        <label class="field"><span>Text</span><input name="boosters.popup.text" maxlength="240" value="${esc(b.popup.text)}"></label>
        <label class="field"><span>Coupon to give</span><select name="boosters.popup.coupon">${copt(b.popup.coupon)}</select></label>
      </div>
    </section>
    <section class="grid-2">
      <div class="card"><h2 class="card-title">Raise order value</h2>
        <h3 class="mini-h">Checkout add-on (order bump)</h3>
        ${sw('boosters.bump.enabled', 'Offer a tick-box add-on at checkout', 'A small extra at a special price, right above the Place order button.', b.bump.enabled)}
        <div class="grid-2"><label class="field"><span>Product</span><select name="boosters.bump.pid">${popt(b.bump.pid)}</select></label><label class="field"><span>Special price (৳)</span><input name="boosters.bump.price" type="number" min="0" value="${b.bump.price || ''}"></label></div>
        <label class="field"><span>Text</span><input name="boosters.bump.title" maxlength="120" value="${esc(b.bump.title)}"></label>
        <h3 class="mini-h">After-order offer (one-click upsell)</h3>
        ${sw('boosters.upsell.enabled', 'Offer one more item after ordering', 'On the thank-you page. Added to the same cash-on-delivery order with one tap.', b.upsell.enabled)}
        <div class="grid-3"><label class="field"><span>Product</span><select name="boosters.upsell.pid">${popt(b.upsell.pid)}</select></label><label class="field"><span>Price (৳)</span><input name="boosters.upsell.price" type="number" min="0" value="${b.upsell.price || ''}"></label><label class="field"><span>Valid (min)</span><input name="boosters.upsell.minutes" type="number" min="5" max="1440" value="${b.upsell.minutes}"></label></div>
        <label class="field"><span>Headline</span><input name="boosters.upsell.title" maxlength="120" value="${esc(b.upsell.title)}"></label>
        <p class="muted small">Mix & Match, free delivery and gift wrap settings are in <a class="link" href="#/settings?tab=offers">Settings › Offers</a>.</p>
      </div>
      <div class="card"><h2 class="card-title">Sale campaign bar</h2>
        ${sw('boosters.campaign.enabled', 'Show a campaign bar with countdown', 'A bar at the top of every page, e.g. “Eid Sale: 15% off with EID15”. It disappears automatically when the time is up.', b.campaign.enabled)}
        <label class="field"><span>Message</span><input name="boosters.campaign.text" maxlength="120" value="${esc(b.campaign.text)}" placeholder="Eid Sale: 15% off everything"></label>
        <div class="grid-2"><label class="field"><span>Ends</span><input name="boosters.campaign.ends" type="datetime-local" value="${esc((b.campaign.ends || '').slice(0, 16))}"></label><label class="field"><span>Coupon (one-tap apply)</span><select name="boosters.campaign.coupon">${copt(b.campaign.coupon)}</select></label></div>
        <label class="field"><span>Button link</span><input name="boosters.campaign.link" value="${esc(b.campaign.link)}" placeholder="/offers"></label>
        <p class="muted small">Make sure the coupon's own expiry date matches the end of the campaign (Coupons page).</p>
      </div>
    </section>
    <section class="card" id="tracking"><h2 class="card-title">Ad tracking pixels</h2><p class="muted small">Tell Facebook, Google and TikTok who visits and buys, so your ads reach more people like your customers. Events sent: page view, product view, add to cart, checkout started, purchase (with order value) and lead.</p>
      <div class="grid-3"><label class="field"><span>Facebook (Meta) Pixel ID</span><input name="tracking.fbPixel" value="${esc(s.tracking.fbPixel)}" placeholder="e.g. 1234567890123456" inputmode="numeric"></label><label class="field"><span>Google Analytics 4 ID</span><input name="tracking.ga4" value="${esc(s.tracking.ga4)}" placeholder="G-XXXXXXXXXX"></label><label class="field"><span>TikTok Pixel ID</span><input name="tracking.tiktok" value="${esc(s.tracking.tiktok)}" placeholder="e.g. C4ABCDEFGHIJ"></label></div>
      <p class="muted small">Find your Pixel ID in Meta Events Manager › Data sources. Leave a box empty to switch that pixel off.</p></section>
    <div class="savebar"><span class="muted">Changes go live as soon as you save.</span><button class="btn btn-primary" type="submit">${ic('check')}Save boosters</button></div>
  </form>`;
  const f = $('#bstform', el);
  f.addEventListener('input', () => { A.dirty = true; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = nested(f);
    const btn = e.submitter; setBusy(btn, true);
    try { A.settings = (await api('/api/admin/settings', { method: 'PUT', body })).settings; A.dirty = false; toast('Sales boosters saved. Your shop is updated.'); setBusy(btn, false); }
    catch (err) { setBusy(btn, false); toast(err.message, 'error'); }
  });
  if (params?.get('s') === 'tracking') $('#tracking', el).scrollIntoView();
}

/* ================================================== profit & expenses */
const EXPENSE_LABEL = { ads: 'Ads (Facebook, Google…)', packaging: 'Packaging & boxes', courier: 'Courier (extra)', salaries: 'Salaries', rent: 'Rent', utilities: 'Bills & internet', stock: 'Other purchases', software: 'Apps & website', other: 'Other' };
async function viewReports(el) {
  el.innerHTML = `<div class="page-head"><div><h1>Profit & expenses</h1><p>What you really earned: sales minus product cost, courier, packaging, COD fees, returns and your business expenses.</p></div></div>
  <div id="pl-range" class="range-host"></div><div id="pl-body"><div class="loading"><span class="spin"></span></div></div>`;
  let r0;
  const load = async (r) => {
    r0 = r;
    const body = $('#pl-body', el); body.classList.add('refetch');
    const d = await api(`/api/admin/reports/pl?from=${r.from}&to=${r.to}`);
    body.classList.remove('refetch');
    const row = (label, v, cls = '', sub = '') => `<div class="pl-row ${cls}"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><b>${v < 0 ? '−' + money(-v) : money(v)}</b></div>`;
    const margin = (v) => (d.sales ? pctFmt(v / d.sales) : '—');
    body.innerHTML = `
    ${d.costCoverage < 0.98 ? `<div class="banner warn">${ic('info')}<span>${pctFmt(1 - d.costCoverage)} of sales are from products without a cost price, so profit looks higher than it is. <a href="#/inventory?f=nocost">Add cost prices</a>.</span></div>` : ''}
    <section class="kpis kpis-4">
      <div class="kpi kpi-hero"><span class="kpi-label">Net profit · ${esc(rangeLabel(d.range))}</span><b class="hero-num">${d.netProfit < 0 ? '−' : ''}${money(Math.abs(d.netProfit))}</b><span class="kpi-sub">${margin(d.netProfit)} of sales after every cost</span></div>
      <div class="kpi"><span class="kpi-label">Sales</span><b>${money(d.sales)}</b><span class="kpi-sub">${plural(d.orders, 'order')}</span></div>
      <div class="kpi"><span class="kpi-label">Gross profit</span><b>${money(d.grossProfit)}</b><span class="kpi-sub">${margin(d.grossProfit)} margin</span></div>
      <div class="kpi"><span class="kpi-label">Expenses</span><b>${money(d.expenseTotal)}</b><span class="kpi-sub">${d.returned ? `+ ${money(d.returnLoss)} lost on ${plural(d.returned, 'return')}` : 'no returns'}</span></div>
    </section>
    <section class="grid-main">
      <div class="col">
        <div class="card"><div class="card-head"><h2>Profit & loss statement</h2><span class="muted small">${esc(rangeLabel(d.range))}</span></div>
          <div class="pl">
            ${row('Sales', d.sales, 'strong', `${plural(d.orders, 'order')} · includes ${money(d.deliveryCharged)} delivery and ${money(d.wrapCharged)} gift wrap charged · after ${money(d.discounts)} discounts`)}
            ${row('Product cost', -d.cogs, '', 'what you paid for the items sold')}
            ${row('Courier charges', -d.shipping, '', 'real charge where entered on the order, otherwise your default')}
            ${row('Packaging', -d.packaging)}
            ${row('Cash-on-delivery fees', -d.codFees)}
            ${row('Gross profit', d.grossProfit, 'total')}
            ${row('Losses on returned orders', -d.returnLoss, '', `${plural(d.returned, 'order')}: courier & packaging spent, items back in stock`)}
            ${Object.entries(d.expenses).map(([k, v]) => row(EXPENSE_LABEL[k] || k, -v)).join('') || row('Business expenses', 0, '', 'add them below')}
            ${row('Net profit', d.netProfit, 'total grand')}
          </div>
          <p class="muted small mt">Default courier, packaging and COD costs: <a class="link" href="#/settings?tab=costs">Settings › Costs</a>.</p></div>
        <div class="card card-flush"><div class="card-head pad"><div><h2>Profit by product</h2><p>Item revenue before order discounts, minus product cost.</p></div><a class="btn btn-sm btn-ghost" href="/api/admin/reports/products.csv?from=${r.from}&to=${r.to}" download>${ic('download')}CSV</a></div>
          ${d.products.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Product</th><th class="num">Units</th><th class="num">Sales</th><th class="num">Cost</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead><tbody>${d.products.slice(0, 50).map((x) => `<tr><td><a class="p-name" href="#/products/${x.pid}">${esc(x.name)}</a>${x.sku ? `<small class="block muted">${esc(x.sku)}</small>` : ''}</td><td class="num">${x.units}</td><td class="num">${money(x.sales)}</td><td class="num">${x.known ? money(x.cogs) : '<a class="link small" href="#/products/' + x.pid + '">add cost</a>'}</td><td class="num">${x.profit == null ? '—' : `<b class="${x.profit < 0 ? 'bad-t' : ''}">${money(x.profit)}</b>`}</td><td class="num">${x.margin == null ? '—' : `<span class="${x.margin < 0.2 ? 'warn-t' : ''}">${pctFmt(x.margin)}</span>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted pad">No sales in this period.</p>'}</div>
      </div>
      <div class="col">
        <form class="card" id="exp-form"><h2 class="card-title">Add an expense</h2>
          <div class="grid-2"><label class="field"><span>Amount (৳) *</span><input name="amount" type="number" min="1" step="0.01" required></label><label class="field"><span>Date</span><input name="date" type="date" value="${dhakaISO()}" max="${dhakaISO()}"></label></div>
          <label class="field"><span>Category</span><select name="category">${d.categories.map((k) => `<option value="${k}">${EXPENSE_LABEL[k] || k}</option>`).join('')}</select></label>
          <label class="field"><span>Note</span><input name="note" maxlength="200" placeholder="e.g. Facebook ads for Eid campaign"></label>
          <button class="btn btn-primary btn-sm" type="submit">${ic('plus')}Add expense</button></form>
        <div class="card"><div class="card-head"><h2>Expenses this period</h2><b>${money(d.expenseTotal)}</b></div>
          ${d.expenseList.length ? `<ul class="exp-list">${d.expenseList.map((x) => `<li data-id="${x.id}"><div><b>${money(x.amount)}</b><small>${esc(EXPENSE_LABEL[x.category] || x.category)} · ${fmtDate(x.date + 'T06:00:00Z')}${x.note ? ` · ${esc(x.note)}` : ''}</small></div><button type="button" class="ibtn danger" data-xdel title="Delete">${ic('trash')}</button></li>`).join('')}</ul>` : '<p class="muted small">No expenses recorded for this period. Add ad spend, packaging, rent and salaries to see your true profit.</p>'}</div>
        <div class="card"><h2 class="card-title">Daily breakdown</h2><div class="tbl-wrap chart-table"><table class="tbl"><thead><tr><th>Date</th><th class="num">Orders</th><th class="num">Sales</th><th class="num">Profit</th></tr></thead><tbody>${d.days.slice().reverse().filter((x) => x.orders || x.expenses || x.profit).map((x) => `<tr><td>${fmtDate(x.date + 'T06:00:00Z')}</td><td class="num">${x.orders}</td><td class="num">${money(x.sales)}</td><td class="num ${x.profit < 0 ? 'bad-t' : ''}">${money(x.profit)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No activity.</td></tr>'}</tbody></table></div></div>
      </div>
    </section>`;
  };
  el.addEventListener('submit', async (e) => {
    if (e.target.id !== 'exp-form') return;
    e.preventDefault(); const btn = e.submitter; setBusy(btn, true);
    try { await api('/api/admin/expenses', { method: 'POST', body: formObj(e.target) }); toast('Expense added'); load(r0); } catch (err) { setBusy(btn, false); toast(err.message, 'error'); }
  });
  el.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-xdel]'); if (!x) return;
    if (!(await ask('Delete this expense?'))) return;
    try { await api(`/api/admin/expenses/${x.closest('li').dataset.id}`, { method: 'DELETE' }); toast('Expense deleted'); load(r0); } catch (err) { toast(err.message, 'error'); }
  });
  const r = rangePicker($('#pl-range', el), load);
  await load(r);
}

/* ========================================================= repeater helper */
function repeaterHtml(key, rows, cols) {
  return `<div class="rep" data-rep="${key}">${rows.map((r) => repRow(cols, r)).join('')}</div><button type="button" class="btn btn-sm btn-ghost" data-rep-add="${key}">${ic('plus')}Add</button>`;
}
function repRow(cols, r = {}) {
  return `<div class="rep-row">${cols.map(([k, label, type = 'text', extra = '']) => `<label class="field ${type === 'color' ? 'f-color' : ''}"><span>${label}</span><input data-k="${k}" type="${type}" value="${esc(r[k] ?? (type === 'color' ? '#F2A7B5' : ''))}" ${extra}></label>`).join('')}<button type="button" class="ibtn danger" data-rep-rm title="Remove">${ic('trash')}</button></div>`;
}
function bindRepeaters(root, defs) {
  root.addEventListener('click', (e) => {
    const add = e.target.closest('[data-rep-add]');
    if (add) { const key = add.dataset.repAdd; $(`[data-rep="${key}"]`, root).insertAdjacentHTML('beforeend', repRow(defs[key])); A.dirty = true; return; }
    const rm = e.target.closest('[data-rep-rm]'); if (rm) { rm.closest('.rep-row').remove(); A.dirty = true; }
  });
}
const readRep = (root, key) => $$(`[data-rep="${key}"] .rep-row`, root).map((row) => Object.fromEntries($$('[data-k]', row).map((i) => [i.dataset.k, i.type === 'number' ? (i.value === '' ? 0 : Number(i.value)) : i.value.trim()])));

/* ===================================================== gift box builder */
async function viewBuilder(el) {
  A.settings = null;
  const s = await getSettings();
  await loadProducts(true);
  const boxable = A.products.filter((p) => p.boxable && p.active);
  const defs = {
    boxes: [['name', 'Box name'], ['price', 'Price (৳)', 'number', 'min="0"'], ['capacity', 'Holds items', 'number', 'min="1" max="20"'], ['desc', 'Short description'], ['color', 'Colour', 'color']],
    wraps: [['name', 'Wrap name'], ['price', 'Extra price (৳)', 'number', 'min="0"'], ['color', 'Colour', 'color']],
    ribbons: [['name', 'Ribbon name'], ['color', 'Colour', 'color']],
  };
  el.innerHTML = `<div class="page-head"><div><h1>Gift Box Builder</h1><p>Shoppers pick a box, fill it with products, choose a wrap and ribbon, and add a card. Box price + items + wrap = total.</p></div><div class="head-actions"><a class="btn btn-ghost" href="/gift-box-builder" target="_blank" rel="noopener">${ic('eye')}Open builder</a></div></div>
  <form id="bform">
    <section class="card"><div class="card-head"><div><h2 class="card-title">Box sizes</h2><p class="muted small">Each box has a base price and a maximum number of items.</p></div></div>${repeaterHtml('boxes', s.builder.boxes, defs.boxes)}</section>
    <section class="card"><div class="card-head"><div><h2 class="card-title">Wrapping papers</h2><p class="muted small">Set an extra price of 0 for free options.</p></div></div>${repeaterHtml('wraps', s.builder.wraps, defs.wraps)}</section>
    <section class="card"><div class="card-head"><div><h2 class="card-title">Ribbons</h2></div></div>${repeaterHtml('ribbons', s.builder.ribbons, defs.ribbons)}</section>
    <section class="card"><h2 class="card-title">Products available in the builder</h2><p>${plural(boxable.length, 'product')} can go in a gift box. To add more, edit a product and turn on <b>Allow in Gift Box Builder</b> (products with size/colour options can't be added).</p>
      <div class="chip-list">${boxable.slice(0, 40).map((p) => `<a class="chip" href="#/products/${p.id}"><img src="${esc(p.images[0] || '/img/placeholder.svg')}" alt="" width="22" height="22">${esc(p.name)}</a>`).join('')}</div></section>
    <div class="savebar"><span class="muted">Changes apply to the shop instantly after saving.</span><button class="btn btn-primary" type="submit">${ic('check')}Save builder settings</button></div>
  </form>`;
  bindRepeaters(el, defs);
  $('#bform', el).addEventListener('input', () => { A.dirty = true; });
  $('#bform', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const builder = { boxes: readRep(el, 'boxes'), wraps: readRep(el, 'wraps'), ribbons: readRep(el, 'ribbons') };
    if (!builder.boxes.length) { toast('Add at least one box size', 'error'); return; }
    const btn = e.submitter; setBusy(btn, true);
    try { A.settings = (await api('/api/admin/settings', { method: 'PUT', body: { builder } })).settings; A.dirty = false; toast('Gift Box Builder updated'); setBusy(btn, false); }
    catch (err) { setBusy(btn, false); toast(err.message, 'error'); }
  });
}

/** Re-fits photos already uploaded to /uploads/ that don't match their frame (4:5 products, square categories). */
async function fitExistingPhotos(btn, status) {
  if (photoPrefs().fit === 'off') { toast('Photo fitting is set to “Keep the original shape”. Change it and save first.', 'error'); return; }
  setBusy(btn, true, 'Fitting…');
  const ratioOf = (url) => new Promise((res) => { const img = new Image(); img.onload = () => res(img.naturalWidth / img.naturalHeight); img.onerror = () => res(null); img.src = url; });
  const refit = async (url, preset) => {
    const want = PHOTO_PRESETS[preset].w / PHOTO_PRESETS[preset].h, r = await ratioOf(url);
    if (r == null || Math.abs(r / want - 1) < 0.01) return null;
    const blob = await (await fetch(url, { credentials: 'same-origin' })).blob();
    return uploadImage(blob, preset);
  };
  const n = { fixed: 0, ok: 0, links: 0, failed: 0 };
  try {
    await getSettings();
    await loadProducts(true);
    const { categories } = await api('/api/admin/categories');
    const total = A.products.reduce((s, p) => s + p.images.length, 0) + categories.length;
    let seen = 0;
    const tick = () => { status.textContent = `Checked ${seen} of ${total} photos · ${n.fixed} fitted`; };
    for (const p of A.products) {
      const imgs = [...p.images]; let changed = false;
      for (let i = 0; i < imgs.length; i++) {
        seen++; tick();
        if (/^https:/.test(imgs[i])) { n.links++; continue; }
        if (!imgs[i].startsWith('/uploads/')) { n.ok++; continue; }
        try { const u = await refit(imgs[i], 'product'); if (u) { imgs[i] = u; changed = true; n.fixed++; } else n.ok++; } catch { n.failed++; }
      }
      if (changed) await api(`/api/admin/products/${p.id}`, { method: 'PUT', body: { images: imgs } });
    }
    for (const c of categories) {
      seen++; tick();
      if (!c.image?.startsWith('/uploads/')) { n.ok++; continue; }
      try { const u = await refit(c.image, 'category'); if (u) { await api(`/api/admin/categories/${c.id}`, { method: 'PUT', body: { image: u } }); n.fixed++; } else n.ok++; } catch { n.failed++; }
    }
    A.products = [];
    status.textContent = `Done: ${plural(n.fixed, 'photo')} fitted, ${n.ok} already fine${n.links ? `, ${n.links} added by link (re-upload those to fit them)` : ''}${n.failed ? `, ${n.failed} could not be read` : ''}.`;
    toast(n.fixed ? `Fitted ${plural(n.fixed, 'photo')}. Your shop is updated.` : 'All your photos already fit.');
  } catch (err) { toast(err.message, 'error'); status.textContent = ''; }
  setBusy(btn, false);
}

/* =============================================================== settings */
async function viewSettings(el, params) {
  A.settings = null;
  const s = await getSettings();
  const tab = params.get('tab') || 'store';
  const TABS = [['store', 'Store details'], ['delivery', 'Delivery'], ['offers', 'Offers & payments'], ['homepage', 'Homepage'], ['costs', 'Costs & profit'], ['account', 'Admin account'], ['data', 'Demo data']];
  const t = (name, label, val, extra = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(val ?? '')}" ${extra}></label>`;
  const n = (name, label, val, extra = '') => `<label class="field"><span>${label}</span><input name="${name}" type="number" value="${esc(val ?? '')}" ${extra}></label>`;
  const sw = (name, label, sub, on) => `<label class="switch-row"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><label class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span></span></label></label>`;
  const panes = {
    store: `<section class="card"><h2 class="card-title">Store details</h2><div class="grid-2">${t('store.name', 'Store name', s.store.name, 'maxlength="40"')}${t('store.tagline', 'Tagline', s.store.tagline)}${t('store.phone', 'Phone (shown to customers)', s.store.phone)}${t('store.whatsapp', 'WhatsApp number', s.store.whatsapp, 'placeholder="8801XXXXXXXXX"')}${t('store.email', 'Email', s.store.email, 'type="email"')}${t('store.hours', 'Opening hours', s.store.hours)}</div>${t('store.address', 'Address', s.store.address)}</section>
      <section class="card"><h2 class="card-title">Social links</h2><p class="muted small">Leave empty to hide an icon.</p><div class="grid-2">${t('store.facebook', 'Facebook page URL', s.store.facebook)}${t('store.instagram', 'Instagram URL', s.store.instagram)}${t('store.tiktok', 'TikTok URL', s.store.tiktok)}${t('store.messenger', 'Messenger link', s.store.messenger)}</div></section>
      <section class="card"><h2 class="card-title">Announcement bar</h2><label class="field"><span>Messages (one per line, they rotate at the top of every page)</span><textarea name="announcements" rows="4">${esc(s.announcements.join('\n'))}</textarea></label></section>
      <section class="card" id="photos"><h2 class="card-title">Photos</h2><p class="muted small">Upload photos of any size or shape (phone photos, screenshots, wide or tall). Before upload, each one is fitted to the shop's frames: <b>4:5 for products</b>, <b>square for categories</b>. Nothing is stretched, every grid lines up, and big photos are made light so the shop stays fast.</p>
        <div class="grid-2"><label class="field"><span>How to fit photos</span><select name="photos.fit">${[['auto', 'Automatic (recommended): trim a little if the shape is close, otherwise add background so nothing is cut off'], ['pad', 'Always keep the whole photo (add background)'], ['crop', 'Always fill the frame (crop the edges)'], ['off', 'Keep the original shape (only make smaller)']].map(([k, l]) => `<option value="${k}" ${s.photos?.fit === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Background for empty space</span><select name="photos.bg">${[['auto', "Matching: the photo's own background colour, or a soft blur"], ['white', 'Plain white'], ['blur', 'Soft blurred copy of the photo']].map(([k, l]) => `<option value="${k}" ${s.photos?.bg === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <div class="fit-row"><button type="button" class="btn btn-ghost btn-sm" id="fit-existing">${ic('image')}Fit photos I already uploaded</button><span class="muted small" id="fit-status">Re-fits uploaded product and category photos that don't match their frame yet (save your settings first).</span></div></section>
      <section class="card"><h2 class="card-title">Stock & reviews</h2>${n('lowStockDefault', 'Show “Limited stock” when quantity is at or below', s.lowStockDefault, 'min="0"')}${sw('reviewsAutoApprove', 'Publish reviews without approval', 'Off = new reviews wait in Reviews for you to approve', s.reviewsAutoApprove)}</section>`,
    delivery: `<section class="card"><h2 class="card-title">Delivery charges</h2><div class="grid-3">${n('delivery.inside', 'Inside Dhaka (৳)', s.delivery.inside, 'min="0"')}${n('delivery.outside', 'Outside Dhaka (৳)', s.delivery.outside, 'min="0"')}${n('delivery.freeOver', 'Free delivery over (৳, 0 = never)', s.delivery.freeOver, 'min="0"')}</div><p class="muted small">Customers choosing Dhaka or Narayanganj as their city pay the inside-Dhaka rate.</p></section>
      <section class="card"><h2 class="card-title">Bliss Express</h2><div class="grid-3">${n('delivery.express', 'Express fee (৳)', s.delivery.express, 'min="0"')}${n('delivery.expressHours', 'Delivered within (hours)', s.delivery.expressHours, 'min="1" max="72"')}${n('delivery.cutoffHour', 'Same-day cutoff (hour, 24h)', s.delivery.cutoffHour, 'min="0" max="23"')}</div>${t('delivery.expressAreas', 'Areas covered (shown to customers)', s.delivery.expressAreas)}</section>`,
    offers: `<section class="card"><h2 class="card-title">Mix & Match discount</h2><p class="muted small">Automatic discount by number of items in the bag.</p>${repeaterHtml('bundleTiers', s.bundleTiers, [['min', 'Items in bag', 'number', 'min="2"'], ['pct', '% off', 'number', 'min="1" max="90"']])}</section>
      <section class="card"><h2 class="card-title">Gift options & newsletter</h2><div class="grid-2">${n('giftWrapPrice', 'Gift wrap price (৳)', s.giftWrapPrice, 'min="0"')}${t('newsletterCoupon', 'Coupon given to new subscribers', s.newsletterCoupon, 'placeholder="e.g. WELCOME5" style="text-transform:uppercase"')}</div><p class="muted small">Create the coupon first in <a href="#/coupons">Coupons</a>.</p></section>
      <section class="card"><h2 class="card-title">Payment methods</h2>${sw('payments.cod', 'Cash on delivery', '', s.payments.cod)}${sw('payments.bkash', 'bKash (Send Money + TrxID)', '', s.payments.bkash)}${sw('payments.nagad', 'Nagad (Send Money + TrxID)', '', s.payments.nagad)}<div class="grid-2">${t('payments.bkashNumber', 'bKash number', s.payments.bkashNumber)}${t('payments.nagadNumber', 'Nagad number', s.payments.nagadNumber)}</div><label class="field"><span>Payment instructions</span><textarea name="payments.note" rows="2">${esc(s.payments.note)}</textarea></label></section>`,
    homepage: `<section class="card"><h2 class="card-title">Hero banner</h2>${t('hero.eyebrow', 'Small text above the title', s.hero.eyebrow)}${t('hero.title', 'Title (wrap words in *stars* to make them italic)', s.hero.title)}<label class="field"><span>Subtitle</span><textarea name="hero.subtitle" rows="2">${esc(s.hero.subtitle)}</textarea></label><div class="grid-2">${t('hero.cta', 'Main button text', s.hero.cta)}${t('hero.ctaLink', 'Main button link', s.hero.ctaLink)}${t('hero.cta2', 'Second button text', s.hero.cta2)}${t('hero.cta2Link', 'Second button link', s.hero.cta2Link)}</div></section>
      <section class="card"><h2 class="card-title">Trust numbers</h2><div class="grid-3">${t('stats.customers', 'Happy customers', s.stats.customers)}${t('stats.rating', 'Average rating', s.stats.rating)}${t('stats.delivered', 'Gifts delivered', s.stats.delivered)}</div><p class="muted small">Shown on the homepage and About page. Keep them honest!</p></section>`,
    account: `<section class="card narrow-card"><h2 class="card-title">Change username or password</h2>${s.admin.isDefault ? `<div class="banner warn">${ic('alert')}<span>You're using the default password. Please change it now.</span></div>` : ''}
      <form id="pw-form"><label class="field"><span>Username</span><input name="username" value="${esc(s.admin.username)}" autocomplete="username" minlength="3"></label><label class="field"><span>Current password</span><input name="current" type="password" required autocomplete="current-password"></label><label class="field"><span>New password (at least 8 characters)</span><input name="next" type="password" required minlength="8" autocomplete="new-password"></label><label class="field"><span>Confirm new password</span><input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label><button class="btn btn-primary" type="submit">${ic('lock')}Update login</button></form></section>`,
    costs: `<section class="card"><h2 class="card-title">Your costs per order</h2><p class="muted small">Used to work out real profit on every order. If you enter the actual courier charge on an order, that is used instead.</p><div class="grid-2">${n('costs.courierInside', 'Courier charge inside Dhaka (৳)', s.costs.courierInside, 'min="0"')}${n('costs.courierOutside', 'Courier charge outside Dhaka (৳)', s.costs.courierOutside, 'min="0"')}${n('costs.packaging', 'Packaging per order (৳)', s.costs.packaging, 'min="0"')}${n('costs.codPct', 'Cash-on-delivery fee (% of amount collected)', s.costs.codPct, 'min="0" max="20" step="0.1"')}</div><p class="muted small">Typical in Bangladesh: ৳60 inside Dhaka, ৳110–130 outside, 1% COD charge. Check your courier's rate card.</p></section>
      <section class="card"><h2 class="card-title">Customer groups</h2>${n('vipSpend', 'A customer is VIP after spending (৳)', s.vipSpend, 'min="0"')}<p class="muted small">Customers with 5 or more orders count as VIP too.</p></section>`,
    data: `<section class="card narrow-card"><h2 class="card-title">Demo data</h2><p>Your shop came with sample products, orders, reviews and messages so you could see how everything works. Remove them before you launch.</p>
      <div class="danger-row"><div><b>Remove demo orders, reviews & messages</b><small>Keeps all products and categories.</small></div><button type="button" class="btn btn-danger-ghost" data-clear="activity">Remove</button></div>
      <div class="danger-row"><div><b>Remove demo products too</b><small>Deletes every sample product. Your own products and the categories stay.</small></div><button type="button" class="btn btn-danger-ghost" data-clear="products">Remove all demo data</button></div></section>`,
  };
  el.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>Everything about how your shop looks and works.</p></div></div>
  <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/settings?tab=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
  ${['account', 'data'].includes(tab) ? panes[tab] : `<form id="sform">${panes[tab]}<div class="savebar"><span class="muted">Changes go live as soon as you save.</span><button class="btn btn-primary" type="submit">${ic('check')}Save settings</button></div></form>`}`;
  const sf = $('#sform', el);
  if (sf) {
    if (tab === 'offers') bindRepeaters(el, { bundleTiers: [['min', 'Items in bag', 'number', 'min="2"'], ['pct', '% off', 'number', 'min="1" max="90"']] });
    sf.addEventListener('input', () => { A.dirty = true; });
    sf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      for (const inp of sf.elements) {
        if (!inp.name || inp.closest('.rep')) continue;
        const v = inp.type === 'checkbox' ? inp.checked : inp.value;
        const path = inp.name.split('.');
        let o = body; for (let i = 0; i < path.length - 1; i++) o = o[path[i]] ||= {};
        o[path.at(-1)] = v;
      }
      if (body.announcements !== undefined) body.announcements = body.announcements.split('\n').map((x) => x.trim()).filter(Boolean);
      if (tab === 'offers') body.bundleTiers = readRep(el, 'bundleTiers');
      const btn = e.submitter; setBusy(btn, true);
      try { A.settings = (await api('/api/admin/settings', { method: 'PUT', body })).settings; A.dirty = false; toast('Settings saved. Your shop is updated.'); setBusy(btn, false); if (body.store?.name) { A.me.store = body.store.name; $('.brand span').textContent = body.store.name; } }
      catch (err) { setBusy(btn, false); toast(err.message, 'error'); }
    });
  }
  $('#pw-form', el)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const x = formObj(e.target);
    if (x.next !== x.confirm) { toast('The new passwords do not match', 'error'); return; }
    const btn = e.submitter; setBusy(btn, true);
    try { const r = await api('/api/admin/password', { method: 'POST', body: { current: x.current, next: x.next, username: x.username } }); A.me.username = r.username; A.me.isDefault = false; toast('Login updated. Use your new password next time.'); renderShell(); refreshCounts(); route(); }
    catch (err) { setBusy(btn, false); toast(err.message, 'error'); }
  });
  $('#fit-existing', el)?.addEventListener('click', (e) => fitExistingPhotos(e.currentTarget, $('#fit-status', el)));
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-clear]'); if (!b) return;
    const all = b.dataset.clear === 'products';
    if (!(await ask(all ? 'Remove all demo data, including sample products?' : 'Remove demo orders, reviews and messages?', { ok: 'Remove', detail: 'Your own products, orders and settings are not touched. This cannot be undone.' }))) return;
    try { const r = await api('/api/admin/demo/clear', { method: 'POST', body: { what: b.dataset.clear } }); A.products = []; toast(`Done. ${plural(r.products, 'product')} and ${plural(r.orders, 'order')} remain.`); refreshCounts(); }
    catch (err) { toast(err.message, 'error'); }
  });
}

boot();
