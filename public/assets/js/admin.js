// BLISS admin dashboard: products & stock, orders, customers, marketing and store settings.
import { CatalogIndex, money, escapeHtml as esc, ORDER_STATUSES, slugify } from './engine.js';

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
const NEXT = { pending: ['confirmed', 'Confirm order'], confirmed: ['processing', 'Start packing'], processing: ['shipped', 'Hand to rider'], shipped: ['delivered', 'Mark delivered'], cancelled: ['pending', 'Restore order'] };
const fmtDate = (ts) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }).format(new Date(ts));
const fmtDT = (ts) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' }).format(new Date(ts));
const ago = (ts) => { const s = (Date.now() - ts) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 604800) return `${Math.floor(s / 86400)}d ago`; return fmtDate(ts); };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const statusPill = (s) => `<span class="pill st-${s}">${esc(STATUS[s] || s)}</span>`;
const stockPill = (s) => `<span class="pill sk-${s}">${ic(STOCK[s][1])}${STOCK[s][0]}</span>`;
const logoMark = `<svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 21C15 13 6 12 7.5 18.5 8.7 23.4 16 22.6 20 21Zm0 0c5-8 14-9 12.5-2.5C31.3 23.4 24 22.6 20 21Z" fill="currentColor"/><path d="M19 22 14 32l3.2-.6L18.8 34 21 22.6M21 22l5 10-3.2-.6L21.2 34 19 22.6" fill="currentColor" opacity=".7"/><circle cx="20" cy="21.3" r="3" fill="#E3B65C"/></svg>`;

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
      <div class="login-brand">${logoMark}<b>BLISS</b><span>Dashboard</span></div>
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
  ['overview', '#/', 'dashboard', 'Overview'], ['orders', '#/orders', 'orders', 'Orders', 'pending'], ['products', '#/products', 'box', 'Products', 'attention'],
  ['categories', '#/categories', 'grid', 'Categories'], ['customers', '#/customers', 'users', 'Customers'], 'Engage',
  ['reviews', '#/reviews', 'star', 'Reviews', 'reviews'], ['coupons', '#/coupons', 'ticket', 'Coupons'], ['messages', '#/messages', 'inbox', 'Messages', 'unread'],
  ['subscribers', '#/subscribers', 'mail', 'Subscribers'], 'Store', ['builder', '#/builder', 'gift', 'Gift Box Builder'], ['settings', '#/settings', 'cog', 'Settings'],
];
function renderShell() {
  app.innerHTML = `<div class="shell">
    <aside class="side" id="side">
      <div class="side-top"><a href="#/" class="brand">${logoMark}<span>${esc(A.me.store || 'BLISS')}</span><small>Admin</small></a><button type="button" class="ibtn side-x" data-act="close-side" aria-label="Close menu">${ic('close')}</button></div>
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
    const s = await api('/api/admin/stats');
    A.counts = { pending: s.byStatus.pending, attention: s.stock.limited + s.stock.out, reviews: s.pendingReviews, unread: s.unread };
    for (const b of $$('[data-count]')) { const n = A.counts[b.dataset.count] || 0; b.textContent = n; b.hidden = !n; }
    return s;
  } catch { return null; }
}

/* ================================================================= router */
const ROUTES = [
  [/^\/$/, (m, p, el) => viewOverview(el), 'overview'],
  [/^\/orders$/, (m, p, el) => viewOrders(el, p), 'orders'],
  [/^\/orders\/([A-Za-z0-9]+)$/, (m, p, el) => viewOrder(el, m[1].toUpperCase()), 'orders'],
  [/^\/products$/, (m, p, el) => viewProducts(el, p), 'products'],
  [/^\/products\/new$/, (m, p, el) => viewProductForm(el, null), 'products'],
  [/^\/products\/([\w-]+)$/, (m, p, el) => viewProductForm(el, m[1]), 'products'],
  [/^\/categories$/, (m, p, el) => viewCategories(el), 'categories'],
  [/^\/customers$/, (m, p, el) => viewCustomers(el, p), 'customers'],
  [/^\/reviews$/, (m, p, el) => viewReviews(el, p), 'reviews'],
  [/^\/coupons$/, (m, p, el) => viewCoupons(el), 'coupons'],
  [/^\/messages$/, (m, p, el) => viewMessages(el), 'messages'],
  [/^\/subscribers$/, (m, p, el) => viewSubscribers(el), 'subscribers'],
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
/** Single-series area chart, drawn at the host's real pixel width (crisp text), redrawn on resize. */
function mountRevenueChart(host, series) {
  const draw = () => {
    if (!host.isConnected) { ro.disconnect(); return; }
    const c = revenueChart(series, Math.max(300, Math.round(host.clientWidth)));
    host.innerHTML = c.html; c.mount(host);
  };
  const ro = new ResizeObserver(debounce(draw, 100));
  draw(); ro.observe(host);
}
function revenueChart(series, W = 720) {
  const H = 250, L = 64, R = 18, T = 22, B = 30;
  const max = Math.max(1, ...series.map((d) => d.revenue));
  const step = niceStep(max / 4), top = Math.ceil(max / step) * step || step;
  const compact = top >= 10000;
  const tick = (v) => '৳' + (compact ? (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : v) : Math.round(v).toLocaleString('en-IN'));
  const n = series.length, x = (i) => L + (i / (n - 1)) * (W - L - R), y = (v) => T + (1 - v / top) * (H - T - B);
  const pts = series.map((d, i) => `${x(i).toFixed(1)} ${y(d.revenue).toFixed(1)}`);
  const line = 'M' + pts.join('L'), area = `${line}L${x(n - 1).toFixed(1)} ${y(0)}L${x(0).toFixed(1)} ${y(0)}Z`;
  let grid = '';
  for (let v = 0; v <= top + 1e-9; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${v ? 'gl' : 'base'}"/><text x="${L - 10}" y="${(y(v) + 4).toFixed(1)}" class="yt">${tick(v)}</text>`;
  const short = (iso) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
  const xl = [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1].map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="xt" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${short(series[i].date)}</text>`).join('');
  const peak = series.reduce((b, d, i) => (d.revenue > series[b].revenue ? i : b), 0);
  const peakLabel = series[peak].revenue > 0 ? `<circle cx="${x(peak).toFixed(1)}" cy="${y(series[peak].revenue).toFixed(1)}" r="4.5" class="dot"/><text x="${Math.min(W - R - 4, Math.max(L + 4, x(peak))).toFixed(1)}" y="${(y(series[peak].revenue) - 12).toFixed(1)}" text-anchor="middle" class="peak">${money(series[peak].revenue)}</text>` : '';
  const html = `<div class="chart" tabindex="0" role="img" aria-label="Daily revenue for the last 30 days. Use left and right arrow keys to read each day.">
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="chart-svg">
      ${grid}${xl}
      <path d="${area}" class="area"/><path d="${line}" class="line"/>${peakLabel}
      <line class="xh" y1="${T}" y2="${y(0)}" x1="0" x2="0" hidden/><circle class="dot hov" r="5" hidden/>
      <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${y(0) - T}"/>
    </svg>
    <div class="tip" hidden></div>
  </div>`;
  const mount = (root) => {
    const box = $('.chart', root), svg = $('svg', box), tip = $('.tip', box), xh = $('.xh', svg), dot = $('.hov', svg);
    let cur = -1;
    const show = (i) => {
      cur = Math.max(0, Math.min(n - 1, i)); const d = series[cur];
      xh.setAttribute('x1', x(cur)); xh.setAttribute('x2', x(cur)); xh.hidden = false;
      dot.setAttribute('cx', x(cur)); dot.setAttribute('cy', y(d.revenue)); dot.hidden = false;
      tip.replaceChildren();
      const v = document.createElement('b'); v.textContent = money(d.revenue);
      const meta = document.createElement('span'); meta.textContent = `${new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d.date + 'T00:00:00Z'))} · ${plural(d.orders, 'order')}`;
      const key = document.createElement('i');
      tip.append(key, v, meta); tip.hidden = false;
      const r = box.getBoundingClientRect(), px = (x(cur) / W) * r.width;
      tip.style.left = `${Math.min(r.width - tip.offsetWidth - 4, Math.max(4, px - tip.offsetWidth / 2))}px`;
      tip.style.top = `${Math.max(0, (y(d.revenue) / H) * r.height - tip.offsetHeight - 14)}px`;
    };
    const hide = () => { xh.hidden = true; dot.hidden = true; tip.hidden = true; cur = -1; };
    svg.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); const sx = ((e.clientX - r.left) / r.width) * W; show(Math.round(((sx - L) / (W - L - R)) * (n - 1))); });
    svg.addEventListener('pointerleave', hide);
    box.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(cur < 0 ? n - 1 : cur + (e.key === 'ArrowRight' ? 1 : -1)); } else if (e.key === 'Escape') hide(); });
    box.addEventListener('blur', hide);
  };
  return { html, mount };
}
function revenueTable(series) {
  return `<div class="tbl-wrap chart-table"><table class="tbl"><thead><tr><th>Date</th><th class="num">Orders</th><th class="num">Revenue</th></tr></thead><tbody>${series.slice().reverse().map((d) => `<tr><td>${fmtDate(d.date + 'T06:00:00Z')}</td><td class="num">${d.orders}</td><td class="num">${money(d.revenue)}</td></tr>`).join('')}</tbody></table></div>`;
}
function stockSplit(st) {
  const total = st.in + st.limited + st.out;
  const parts = ['in', 'limited', 'out'].map((k) => [k, st[k] || 0]);
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  return `<div class="segbar" role="img" aria-label="Stock: ${st.in} in stock, ${st.limited} limited, ${st.out} out of stock">${parts.filter(([, n]) => n).map(([k, n]) => `<span style="flex:${n};background:${STATUS_COLOR[k]}" title="${STOCK[k][0]}: ${n} (${pct(n)}%)"></span>`).join('')}</div>
  <ul class="split-list">${parts.map(([k, n]) => `<li><a href="#/products?s=${k}"><i class="sw" style="background:${STATUS_COLOR[k]}"></i>${ic(STOCK[k][1], 'sk-ic sk-' + k)}<span>${STOCK[k][0]}</span><b>${n}</b><small>${pct(n)}%</small>${ic('chev-right', 'go')}</a></li>`).join('')}</ul>`;
}
async function viewOverview(el) {
  const s = await refreshCounts() || await api('/api/admin/stats');
  const sum30 = s.series.reduce((a, d) => a + d.revenue, 0), n30 = s.series.reduce((a, d) => a + d.orders, 0);
  const hr = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Dhaka' }).format(new Date()));
  const greet = hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening';
  el.innerHTML = `
  <div class="page-head"><div><h1>Good ${greet}, ${esc(A.me.username)}</h1><p>Here's how ${esc(A.me.store)} is doing.</p></div><div class="head-actions"><a class="btn btn-ghost" href="/" target="_blank" rel="noopener">${ic('external')}View store</a><a class="btn btn-primary" href="#/products/new">${ic('plus')}Add product</a></div></div>
  <section class="kpis">
    <div class="kpi kpi-hero"><span class="kpi-label">Revenue this month</span><b class="hero-num">${money(s.monthRevenue)}</b><span class="kpi-sub">${money(s.todayRevenue)} today · ${money(s.revenue)} all time</span></div>
    <a class="kpi" href="#/orders?status=pending"><span class="kpi-label">Orders</span><b>${s.orders.toLocaleString('en-IN')}</b><span class="kpi-sub">${s.byStatus.pending ? `<span class="dot-warn"></span>${s.byStatus.pending} waiting for confirmation` : 'All caught up'}</span></a>
    <div class="kpi"><span class="kpi-label">Average order value</span><b>${money(s.aov)}</b><span class="kpi-sub">${plural(s.customers, 'customer')} · ${plural(s.subscribers, 'subscriber')}</span></div>
    <a class="kpi" href="#/products?s=limited,out"><span class="kpi-label">Products</span><b>${s.products}</b><span class="kpi-sub">${s.stock.limited + s.stock.out ? `<span class="dot-warn"></span>${s.stock.limited + s.stock.out} need attention` : 'Stock looks healthy'}</span></a>
  </section>
  <section class="grid-main">
    <div class="col">
    <div class="card">
      <div class="card-head"><div><h2>Revenue, last 30 days</h2><p>${money(sum30)} from ${plural(n30, 'order')} (cancelled orders excluded)</p></div>
        <div class="seg-sm" role="tablist"><button type="button" class="on" data-v="chart" role="tab" aria-selected="true">${ic('chart')}Chart</button><button type="button" data-v="table" role="tab" aria-selected="false">${ic('table')}Table</button></div></div>
      <div id="rev"></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Recent orders</h2><a class="link" href="#/orders">View all</a></div>
      ${s.recent.length ? `<div class="tbl-wrap"><table class="tbl tbl-click"><thead><tr><th>Order</th><th>Customer</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>${s.recent.map((o) => `<tr data-href="#/orders/${o.id}"><td><a href="#/orders/${o.id}" class="mono">${o.id}</a><small class="block muted">${ago(o.created)}</small></td><td>${esc(o.name)}<small class="block muted">${PAYMENT[o.payment]}</small></td><td class="num">${money(o.total)}</td><td>${statusPill(o.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No orders yet. Share your shop link to get your first one!</p>'}
    </div>
    </div>
    <div class="col">
    <div class="card">
      <div class="card-head"><div><h2>Stock health</h2><p>${plural(s.products, 'product')} in your catalogue</p></div></div>
      ${stockSplit(s.stock)}
      <h3 class="mini-h">Needs attention</h3>
      ${s.lowStock.length ? `<ul class="low-list">${s.lowStock.map((p) => `<li><img src="${esc(p.img || '/img/placeholder.svg')}" alt="" width="40" height="50" loading="lazy"><a href="#/products/${p.id}">${esc(p.name)}</a>${stockPill(p.status)}${p.qty != null ? `<small>${p.qty} left</small>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Everything is in stock.</p>'}
    </div>
    <div class="card">
      <div class="card-head"><h2>Best sellers</h2><span class="muted small">by units sold</span></div>
      ${s.top.length ? `<ol class="top-list">${s.top.map((t, i) => `<li><span class="rank">${i + 1}</span><img src="${esc(t.img || '/img/box.svg')}" alt="" width="40" height="50" loading="lazy"><span class="tl-name">${esc(t.name)}<small>${money(t.revenue)} revenue</small></span><b>${t.units}</b></li>`).join('')}</ol>` : '<p class="muted">Best sellers appear after your first orders.</p>'}
      <div class="quick-row">
        <a class="quick" href="#/reviews?tab=pending">${ic('star')}<span><b>${s.pendingReviews}</b> reviews to approve</span></a>
        <a class="quick" href="#/messages">${ic('inbox')}<span><b>${s.unread}</b> unread messages</span></a>
      </div>
    </div>
    </div>
  </section>`;
  mountRevenueChart($('#rev', el), s.series);
  $$('.seg-sm button', el).forEach((b) => b.addEventListener('click', () => {
    $$('.seg-sm button', el).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    const host = $('#rev', el);
    if (b.dataset.v === 'table') { const fresh = host.cloneNode(false); host.replaceWith(fresh); fresh.innerHTML = revenueTable(s.series); }
    else { const fresh = host.cloneNode(false); host.replaceWith(fresh); mountRevenueChart(fresh, s.series); }
  }));
  el.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a')) location.hash = tr.dataset.href; });
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
  <div class="page-head"><div><h1>Products</h1><p>Add, edit and remove products, and control what shoppers see as <b>In stock</b>, <b>Limited</b> or <b>Out of stock</b>.</p></div><div class="head-actions"><a class="btn btn-primary" href="#/products/new">${ic('plus')}Add product</a></div></div>
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
    <td class="p-cell"><img src="${esc(p.images[0] || '/img/placeholder.svg')}" alt="" width="44" height="55" loading="lazy"><div><a href="#/products/${p.id}" class="p-name">${esc(p.name)}</a><small>${esc(catName(p.cat))}${p.options.length ? ` · ${p.options.map((o) => esc(o.name)).join(', ')}` : ''}${p.featured ? ' · ★ Featured' : ''}${!p.active ? ' · <b class="hidden-tag">Hidden</b>' : ''}</small></div></td>
    <td class="num price-c"><b>${money(p.price)}</b>${p.compare ? `<s>${money(p.compare)}</s>` : ''}</td>
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
    if (t.classList.contains('act-in')) {
      const p = A.products.find((x) => x.id === id);
      try { const r = await api(`/api/admin/products/${id}`, { method: 'PUT', body: { active: t.checked } }); replaceRow(r.product); toast(t.checked ? `${p.name} is now visible in the shop` : `${p.name} is hidden from the shop`); }
      catch (err) { toast(err.message, 'error'); t.checked = !t.checked; }
    }
  });
  draw();
}

/* ------------------------------------------------------- product editor */
async function compressImage(file, max = 1600, quality = 0.84) {
  if (!/^image\//.test(file.type)) throw new Error(`“${file.name}” is not an image.`);
  if (file.type === 'image/gif' || file.size < 120_000) return file;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); ctx.drawImage(bmp, 0, 0, w, h);
  const webp = await new Promise((r) => canvas.toBlob(r, 'image/webp', quality));
  if (webp && webp.type === 'image/webp') return webp.size < file.size ? webp : file;
  ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // JPEG has no transparency
  const jpg = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  return jpg && jpg.size < file.size ? jpg : file;
}
async function uploadImage(file) {
  const blob = await compressImage(file);
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
    drop.classList.add('busy'); drop.querySelector('.img-status').textContent = `Uploading ${plural(list.length, 'photo')}…`;
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
  const v = ex ? structuredClone(ex) : { name: '', slug: '', cat: A.categories[0].id, price: '', compare: '', desc: '', highlights: [], images: [], status: 'in', qty: null, lowStock: null, autoStock: true, tags: [], gender: 'unisex', options: [], featured: false, boxable: false, active: true, keywords: '' };
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
        <div class="img-drop"><div class="img-grid"></div><input type="file" class="img-file" accept="image/*" multiple hidden><p class="muted small">${ic('upload')} Drag & drop photos here or click <b>Add photo</b>. They're automatically resized and compressed to WEBP in your browser before upload, so your shop stays fast. The first photo is the main one. <span class="img-status"></span></p></div>
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
      </section>
      <section class="card stock-card"><h2 class="card-title">Stock</h2>
        <div class="field"><span class="flabel">Stock status shown to shoppers</span><div class="stock-seg big" role="radiogroup">${['in', 'limited', 'out'].map((k) => `<label class="ss ss-${k}"><input type="radio" name="status" value="${k}" ${v.status === k ? 'checked' : ''}>${ic(STOCK[k][1])}<span>${STOCK[k][0]}</span></label>`).join('')}</div></div>
        <label class="field"><span>Quantity available <em>(optional)</em></span><input name="qty" type="number" min="0" step="1" value="${v.qty ?? ''}" placeholder="Leave empty to not track" inputmode="numeric"></label>
        <div class="qty-opts" ${v.qty == null ? 'hidden' : ''}>
          <label class="switch-row"><span><b>Update status automatically</b><small>0 → Out of stock · low → Limited · otherwise In stock</small></span><label class="switch"><input type="checkbox" name="autoStock" ${v.autoStock !== false ? 'checked' : ''}><span></span></label></label>
          <label class="field"><span>“Limited” when quantity is at or below</span><input name="lowStock" type="number" min="0" step="1" value="${v.lowStock ?? ''}" placeholder="${A.lowDefault} (store default)" inputmode="numeric"></label>
        </div>
        <div class="stock-preview" id="stock-preview"></div>
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

/* ================================================================= orders */
async function viewOrders(el, params) {
  const st = { status: params.get('status') || '', q: params.get('q') || '', page: Number(params.get('page')) || 1 };
  el.innerHTML = `<div class="page-head"><div><h1>Orders</h1><p>Confirm, pack and deliver. Click an order to see everything about it.</p></div><div class="head-actions"><a class="btn btn-ghost" href="/api/admin/orders.csv" download>${ic('download')}Export CSV</a></div></div>
  <div class="card card-flush"><div class="filter-tabs" id="otabs"></div>
    <div class="toolbar"><label class="search-in">${ic('search')}<input id="oq" placeholder="Search order ID, name or phone…" value="${esc(st.q)}"></label></div>
    <div id="olist"><div class="loading"><span class="spin"></span></div></div></div>`;
  const load = async () => {
    const u = new URLSearchParams(); if (st.status) u.set('status', st.status); if (st.q) u.set('q', st.q); if (st.page > 1) u.set('page', st.page);
    const h = '#/orders' + (u.toString() ? '?' + u : ''); history.replaceState(null, '', h); A.lastHash = h;
    const list = $('#olist', el); list.classList.add('refetch');
    const d = await api('/api/admin/orders?' + u.toString());
    list.classList.remove('refetch');
    $('#otabs', el).innerHTML = [['', 'All', d.counts.all], ...ORDER_STATUSES.map(([k, l]) => [k, l, d.counts[k]])].map(([k, l, n]) => `<button type="button" class="ftab${st.status === k ? ' on' : ''}" data-s="${k}">${k ? `<i class="st-dot st-${k}"></i>` : ''}${esc(k === 'pending' ? 'New' : l)}<b>${n}</b></button>`).join('');
    list.innerHTML = d.orders.length ? `<div class="tbl-wrap"><table class="tbl tbl-click tbl-orders"><thead><tr><th>Order</th><th>Customer</th><th>Delivery</th><th class="num">Items</th><th class="num">Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>${d.orders.map((o) => `<tr data-href="#/orders/${o.id}">
      <td><a class="mono" href="#/orders/${o.id}">${o.id}</a><small class="block muted">${fmtDT(o.created)}</small></td>
      <td>${esc(o.name)}<small class="block muted">${esc(o.phone)}</small></td>
      <td>${o.method === 'express' ? `<span class="pill pill-express">${ic('bolt')}Express</span>` : esc(o.city)}${o.date ? `<small class="block muted">${fmtDate(o.date + 'T06:00:00Z')}</small>` : ''}</td>
      <td class="num">${o.items}</td><td class="num"><b>${money(o.total)}</b></td>
      <td>${PAYMENT[o.payment]}<small class="block ${o.paid === 'paid' ? 'ok-t' : 'muted'}">${o.paid === 'paid' ? 'Paid' : o.payment === 'cod' ? 'Collect on delivery' : 'Verify TrxID'}</small></td>
      <td>${statusPill(o.status)}</td></tr>`).join('')}</tbody></table></div>
      ${d.pages > 1 ? `<div class="pager"><button type="button" class="btn btn-sm btn-ghost" data-page="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>${ic('chev-left')}Newer</button><span class="muted">Page ${d.page} of ${d.pages}</span><button type="button" class="btn btn-sm btn-ghost" data-page="${d.page + 1}" ${d.page >= d.pages ? 'disabled' : ''}>Older${ic('chev-right')}</button></div>` : ''}`
      : `<div class="empty">${ic('orders', 'empty-ic')}<h2>No orders here</h2><p>${st.q ? 'Nothing matches that search.' : st.status ? `No ${(STATUS[st.status] || '').toLowerCase()} orders right now.` : 'Orders will appear here as soon as customers check out.'}</p></div>`;
  };
  $('#oq', el).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 250));
  el.addEventListener('click', (e) => {
    const tab = e.target.closest('.ftab'); if (tab) { st.status = tab.dataset.s; st.page = 1; load(); return; }
    const pg = e.target.closest('[data-page]'); if (pg) { st.page = +pg.dataset.page; load(); return; }
    const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
  });
  await load();
}
async function getSettings() { if (!A.settings) A.settings = (await api('/api/admin/settings')).settings; return A.settings; }
async function viewOrder(el, id) {
  const { order: o } = await api(`/api/admin/orders/${id}`);
  const next = NEXT[o.status];
  const phoneLink = (p) => `<span class="inline"><a href="tel:${esc(p)}">${esc(p)}</a><a class="wa" href="https://wa.me/88${esc(p)}" target="_blank" rel="noopener" title="WhatsApp ${esc(p)}">${ic('whatsapp')}</a></span>`;
  el.innerHTML = `
  <div class="page-head"><div><a class="back" href="#/orders">${ic('arrow-left')}Orders</a><h1 class="order-h">${o.id} ${statusPill(o.status)}</h1><p>Placed ${fmtDT(o.created)} · ${plural(o.totals.count || o.items.reduce((s, l) => s + l.qty, 0), 'item')} · ${money(o.totals.total)}</p></div>
    <div class="head-actions"><button type="button" class="btn btn-ghost" data-print="invoice">${ic('print')}Invoice</button><button type="button" class="btn btn-ghost" data-print="slip">${ic('print')}Packing slip</button></div></div>
  <div class="status-bar card">
    <div class="flow">${ORDER_STATUSES.filter(([k]) => k !== 'cancelled').map(([k, l], i, arr) => { const idx = arr.findIndex(([x]) => x === o.status); return `<span class="flow-step${o.status === 'cancelled' ? '' : i < idx ? ' done' : i === idx ? ' cur' : ''}"><i>${i < idx || (i === idx && o.status === 'delivered') ? ic('check') : i + 1}</i>${esc(l)}</span>`; }).join('')}</div>
    <div class="flow-actions">${next ? `<button type="button" class="btn btn-primary" data-status="${next[0]}">${esc(next[1])}</button>` : ''}${o.status !== 'cancelled' && o.status !== 'delivered' ? '<button type="button" class="btn btn-danger-ghost" data-status="cancelled">Cancel order</button>' : ''}
      <select id="ostatus" aria-label="Set status">${ORDER_STATUSES.map(([k, l]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
  </div>
  <div class="order-grid">
    <div>
      <section class="card"><h2 class="card-title">Items</h2>
        <ul class="o-items">${o.items.map((l) => `<li><img src="${esc(l.img || '/img/box.svg')}" alt="" width="56" height="70"><div><b>${l.slug ? `<a href="/product/${esc(l.slug)}" target="_blank" rel="noopener">${esc(l.name)}</a>` : esc(l.name)}</b>${Object.entries(l.options || {}).map(([k, v]) => `<small>${esc(k)}: <b>${esc(v)}</b></small>`).join('')}${l.box ? `<small>${esc(l.box.wrap)} wrap · ${esc(l.box.ribbon)} ribbon</small><ul class="box-contents">${l.box.items.map((c) => `<li>${esc(c.name)} <span class="muted">${money(c.price)}</span></li>`).join('')}</ul>${l.box.to || l.box.note ? `<small class="note">Card${l.box.to ? ` to ${esc(l.box.to)}` : ''}${l.box.from ? ` from ${esc(l.box.from)}` : ''}: “${esc(l.box.note)}”</small>` : ''}` : ''}</div><span class="muted">${l.qty} × ${money(l.price)}</span><b>${money(l.qty * l.price)}</b></li>`).join('')}</ul>
        <div class="totals"><div><span>Subtotal</span><b>${money(o.totals.subtotal)}</b></div>${o.totals.discount ? `<div class="ok-t"><span>${esc(o.totals.discountLabel)}</span><b>−${money(o.totals.discount)}</b></div>` : ''}<div><span>Delivery (${o.delivery.method})</span><b>${o.totals.delivery ? money(o.totals.delivery) : 'Free'}</b></div>${o.totals.wrap ? `<div><span>Gift wrap</span><b>${money(o.totals.wrap)}</b></div>` : ''}<div class="grand"><span>Total</span><b>${money(o.totals.total)}</b></div></div>
      </section>
      <section class="card"><h2 class="card-title">Timeline</h2>
        <ol class="o-timeline">${o.timeline.slice().reverse().map((t) => `<li><i class="st-dot st-${t.status}"></i><div><b>${esc(STATUS[t.status] || t.status)}</b><small>${fmtDT(t.at)}</small>${t.note ? `<p>${esc(t.note)}</p>` : ''}</div></li>`).join('')}</ol>
        <form id="note-form" class="inline-form"><input name="note" placeholder="Add a note the customer can see when tracking (e.g. Rider will call before 5pm)" maxlength="300"><button class="btn btn-ghost" type="submit">Add note</button></form>
      </section>
    </div>
    <div>
      <section class="card"><h2 class="card-title">Customer</h2><p class="kv"><b>${esc(o.customer.name)}</b>${phoneLink(o.customer.phone)}${o.customer.email ? `<a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a>` : ''}</p><a class="link small" href="#/orders?q=${esc(o.customer.phone)}">All orders from this customer</a></section>
      <section class="card"><h2 class="card-title">Delivery</h2>
        ${o.recipient ? `<p class="kv"><span class="pill pill-gift">${ic('gift')}Gift delivery to</span><b>${esc(o.recipient.name)}</b>${phoneLink(o.recipient.phone)}</p>` : ''}
        <p class="kv">${esc(o.address.line)}${o.address.area ? `<br>${esc(o.address.area)}` : ''}<br>${esc(o.address.city)} · ${o.address.zone === 'inside' ? 'Inside Dhaka' : 'Outside Dhaka'}</p>
        <p class="kv"><span class="inline">${o.delivery.method === 'express' ? `<span class="pill pill-express">${ic('bolt')}Bliss Express</span>` : `${ic('truck')} Standard delivery`}${o.delivery.date ? `<span>· ${fmtDate(o.delivery.date + 'T06:00:00Z')}</span>` : ''}${o.delivery.slot ? `<span>· ${esc(o.delivery.slot)}</span>` : ''}</span></p>
      </section>
      <section class="card"><h2 class="card-title">Payment</h2><p class="kv"><b>${PAYMENT[o.payment.method]}</b>${o.payment.trxId ? `<span>TrxID: <b class="mono">${esc(o.payment.trxId)}</b></span>` : ''}${o.coupon ? `<span>Coupon: <b>${esc(o.coupon)}</b></span>` : ''}</p>
        <label class="switch-row"><span><b>${o.payment.status === 'paid' ? 'Paid' : 'Not paid yet'}</b><small>${o.payment.method === 'cod' ? 'Mark paid when the rider collects cash' : 'Mark paid after you verify the TrxID'}</small></span><label class="switch"><input type="checkbox" id="paid" ${o.payment.status === 'paid' ? 'checked' : ''}><span></span></label></label></section>
      ${o.gift?.wrap || o.gift?.message || o.gift?.hidePrice ? `<section class="card"><h2 class="card-title">Gift options</h2>${o.gift.wrap ? `<p class="kv">${ic('gift')} Premium gift wrap</p>` : ''}${o.gift.hidePrice ? '<p class="kv">Hide prices on invoice (use the packing slip)</p>' : ''}${o.gift.message ? `<blockquote class="card-msg">“${esc(o.gift.message)}”</blockquote>` : ''}</section>` : ''}
      ${o.note ? `<section class="card"><h2 class="card-title">Customer note</h2><p>${esc(o.note)}</p></section>` : ''}
      <section class="card"><h2 class="card-title">Private note</h2><textarea id="anote" rows="3" placeholder="Only you can see this" maxlength="1000">${esc(o.adminNote || '')}</textarea><button type="button" class="btn btn-ghost btn-sm mt" id="anote-save">Save note</button></section>
      <button type="button" class="btn btn-danger-ghost btn-block" id="odel">${ic('trash')}Delete order</button>
    </div>
  </div>`;
  const patch = async (body, msg) => { try { await api(`/api/admin/orders/${o.id}`, { method: 'PATCH', body }); toast(msg); refreshCounts(); route(); } catch (err) { toast(err.message, 'error'); } };
  el.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-status]');
    if (s) {
      if (s.dataset.status === 'cancelled' && !(await ask('Cancel this order?', { ok: 'Cancel order', detail: 'Stock for its items goes back to your inventory.' }))) return;
      patch({ status: s.dataset.status }, `Order marked “${STATUS[s.dataset.status]}”`); return;
    }
    const pr = e.target.closest('[data-print]'); if (pr) printOrder(o, pr.dataset.print === 'slip');
  });
  $('#ostatus', el).addEventListener('change', (e) => patch({ status: e.target.value }, `Order marked “${STATUS[e.target.value]}”`));
  $('#paid', el).addEventListener('change', (e) => patch({ paymentStatus: e.target.checked ? 'paid' : 'unpaid' }, e.target.checked ? 'Marked as paid' : 'Marked as unpaid'));
  $('#note-form', el).addEventListener('submit', (e) => { e.preventDefault(); const n = e.target.elements.note.value.trim(); if (n) patch({ note: n }, 'Note added'); });
  $('#anote-save', el).addEventListener('click', async () => { try { await api(`/api/admin/orders/${o.id}`, { method: 'PATCH', body: { adminNote: $('#anote', el).value } }); toast('Private note saved'); } catch (err) { toast(err.message, 'error'); } });
  $('#odel', el).addEventListener('click', async () => {
    if (!(await ask(`Delete order ${o.id}?`, { detail: 'Use this for test or spam orders. Unfulfilled items return to stock. This cannot be undone.' }))) return;
    try { await api(`/api/admin/orders/${o.id}`, { method: 'DELETE' }); toast('Order deleted'); refreshCounts(); location.hash = '#/orders'; } catch (err) { toast(err.message, 'error'); }
  });
}
async function printOrder(o, slip) {
  const s = await getSettings().catch(() => null), st = s?.store || { name: 'BLISS' };
  const w = window.open('', '_blank', 'width=860,height=1000');
  if (!w) { toast('Please allow pop-ups to print', 'error'); return; }
  const rows = o.items.map((l) => `<tr><td>${esc(l.name)}${Object.entries(l.options || {}).map(([k, v]) => `<div class="m">${esc(k)}: ${esc(v)}</div>`).join('')}${l.box ? `<div class="m">${esc(l.box.items.map((c) => c.name).join(', '))}</div>` : ''}</td><td class="r">${l.qty}</td>${slip ? '' : `<td class="r">${money(l.price)}</td><td class="r">${money(l.price * l.qty)}</td>`}</tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${slip ? 'Packing slip' : 'Invoice'} ${o.id}</title><style>
    body{font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#23161F;margin:40px}h1{font:600 28px Georgia,serif;margin:0;letter-spacing:.12em}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #8E2C5C;padding-bottom:16px;margin-bottom:22px}.muted{color:#7B6A75}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}h3{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#7B6A75;margin:0 0 6px}table{width:100%;border-collapse:collapse}th,td{padding:10px 8px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#7B6A75}.r{text-align:right}.m{font-size:12px;color:#7B6A75}.tot{margin-left:auto;width:280px;margin-top:14px}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .g{border-top:2px solid #23161F;margin-top:6px;padding-top:8px;font-weight:700;font-size:16px}.msg{margin-top:26px;padding:16px;border:1px dashed #8E2C5C;border-radius:10px;font:italic 16px Georgia,serif}.foot{margin-top:40px;text-align:center;color:#7B6A75;font-size:12px}@media print{body{margin:16mm}}
  </style></head><body>
  <div class="top"><div><h1>${esc(st.name)}</h1><div class="muted">${esc(st.address || '')}<br>${esc(st.phone || '')} · ${esc(st.email || '')}</div></div><div style="text-align:right"><b style="font-size:18px">${slip ? 'Packing slip' : 'Invoice'}</b><div>Order <b>${o.id}</b></div><div class="muted">${fmtDate(o.created)}</div></div></div>
  <div class="grid"><div><h3>Deliver to</h3><b>${esc(o.recipient?.name || o.customer.name)}</b><br>${esc(o.recipient?.phone || o.customer.phone)}<br>${esc(o.address.line)}${o.address.area ? ', ' + esc(o.address.area) : ''}<br>${esc(o.address.city)}</div>
  <div><h3>${o.recipient ? 'Sent by' : 'Customer'}</h3><b>${esc(o.customer.name)}</b><br>${esc(o.customer.phone)}${o.customer.email ? '<br>' + esc(o.customer.email) : ''}<br><span class="muted">${o.delivery.method === 'express' ? 'Bliss Express' : 'Standard delivery'}${o.delivery.date ? ' · ' + fmtDate(o.delivery.date + 'T06:00:00Z') : ''}${slip ? '' : ' · ' + PAYMENT[o.payment.method] + (o.payment.status === 'paid' ? ' (paid)' : o.payment.method === 'cod' ? ' (collect ' + money(o.totals.total) + ')' : '')}</span></div></div>
  <table><thead><tr><th>Item</th><th class="r">Qty</th>${slip ? '' : '<th class="r">Price</th><th class="r">Total</th>'}</tr></thead><tbody>${rows}</tbody></table>
  ${slip ? '' : `<div class="tot"><div><span>Subtotal</span><span>${money(o.totals.subtotal)}</span></div>${o.totals.discount ? `<div><span>${esc(o.totals.discountLabel)}</span><span>−${money(o.totals.discount)}</span></div>` : ''}<div><span>Delivery</span><span>${o.totals.delivery ? money(o.totals.delivery) : 'Free'}</span></div>${o.totals.wrap ? `<div><span>Gift wrap</span><span>${money(o.totals.wrap)}</span></div>` : ''}<div class="g"><span>Total</span><span>${money(o.totals.total)}</span></div></div>`}
  ${o.gift?.message ? `<div class="msg">“${esc(o.gift.message)}”</div>` : ''}
  <div class="foot">Thank you for choosing ${esc(st.name)} ♥</div></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 350);
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
      <div class="field"><span class="flabel">Image</span><div class="cat-img-row"><img id="cat-img" src="${esc(c.image || '/img/placeholder.svg')}" alt="" style="background:${esc(c.color || '#FADDE5')}"><div><button type="button" class="btn btn-sm btn-ghost" id="cat-up">${ic('upload')}Upload image</button><input type="file" accept="image/*" id="cat-file" hidden><p class="muted small">Square images look best.</p></div></div><input type="hidden" name="image" value="${esc(c.image || '')}"></div>
      <div class="grid-2"><label class="field"><span>Tile colour</span><input name="color" type="color" value="${esc(c.color || '#FADDE5')}"></label><label class="field"><span>Order</span><input name="sort" type="number" min="0" value="${c.sort ?? categories.length + 1}"></label></div>
      <label class="field"><span>URL handle</span><div class="prefix-in"><span>/category/</span><input name="slug" maxlength="60" value="${esc(c.slug || '')}" placeholder="auto"></div></label>
      <label class="switch-row"><span><b>Show on homepage</b><small>In the “Shop by category” grid</small></span><label class="switch"><input type="checkbox" name="showHome" ${c.showHome !== false ? 'checked' : ''}><span></span></label></label>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">${c.id ? 'Save' : 'Create category'}</button></div></form>`);
    $('#cat-up', m).addEventListener('click', () => $('#cat-file', m).click());
    $('#cat-file', m).addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { const url = await uploadImage(file); $('#cat-img', m).src = url; m.querySelector('input[name=image]').value = url; } catch (err) { toast(err.message, 'error'); } });
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
  const { customers } = await api('/api/admin/customers');
  el.innerHTML = `<div class="page-head"><div><h1>Customers</h1><p>${plural(customers.length, 'customer')}, grouped by mobile number. Registered accounts are marked.</p></div></div>
  <div class="card card-flush"><div class="toolbar"><label class="search-in">${ic('search')}<input id="cq" placeholder="Search name, phone, email or city…" value="${esc(params.get('q') || '')}"></label></div><div id="clist"></div></div>`;
  const draw = (q = '') => {
    const t = q.toLowerCase();
    const list = t ? customers.filter((c) => [c.name, c.phone, c.email, c.city].some((x) => (x || '').toLowerCase().includes(t))) : customers;
    $('#clist', el).innerHTML = list.length ? `<div class="tbl-wrap"><table class="tbl tbl-click"><thead><tr><th>Customer</th><th>Contact</th><th>City</th><th class="num">Orders</th><th class="num">Total spent</th><th>Last order</th></tr></thead><tbody>${list.slice(0, 300).map((c) => `<tr data-href="#/orders?q=${esc(c.phone)}"><td><b>${esc(c.name)}</b>${c.registered ? ' <span class="pill pill-reg">Account</span>' : ''}</td><td>${esc(c.phone)}${c.email ? `<small class="block muted">${esc(c.email)}</small>` : ''}</td><td>${esc(c.city || '—')}</td><td class="num">${c.orders}</td><td class="num"><b>${money(c.spent)}</b></td><td>${c.orders ? ago(c.last) : '—'}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${ic('users', 'empty-ic')}<h2>No customers ${t ? 'match' : 'yet'}</h2></div>`;
  };
  $('#cq', el).addEventListener('input', debounce((e) => draw(e.target.value.trim()), 120));
  el.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; });
  draw(params.get('q') || '');
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
async function viewSubscribers(el) {
  let { subscribers } = await api('/api/admin/subscribers');
  const draw = () => {
    el.innerHTML = `<div class="page-head"><div><h1>Subscribers</h1><p>${plural(subscribers.length, 'person')} joined your newsletter from the shop footer.</p></div><div class="head-actions"><a class="btn btn-ghost" href="/api/admin/subscribers.csv" download>${ic('download')}Export CSV</a></div></div>
    <div class="card card-flush">${subscribers.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Email</th><th>Joined</th><th></th></tr></thead><tbody>${subscribers.map((s) => `<tr data-email="${esc(s.email)}"><td>${esc(s.email)}</td><td>${fmtDate(s.created)}</td><td class="row-actions"><button type="button" class="ibtn danger" data-del title="Remove">${ic('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${ic('mail', 'empty-ic')}<h2>No subscribers yet</h2><p>Visitors who join from the footer get your welcome coupon automatically.</p></div>`}</div>`;
  };
  el.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-email]'); if (!tr || !e.target.closest('[data-del]')) return;
    const email = tr.dataset.email;
    if (!(await ask(`Remove ${email}?`))) return;
    try { await api(`/api/admin/subscribers/${encodeURIComponent(email)}`, { method: 'DELETE' }); subscribers = subscribers.filter((s) => s.email !== email); draw(); toast('Subscriber removed'); } catch (err) { toast(err.message, 'error'); }
  });
  draw();
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

/* =============================================================== settings */
async function viewSettings(el, params) {
  A.settings = null;
  const s = await getSettings();
  const tab = params.get('tab') || 'store';
  const TABS = [['store', 'Store details'], ['delivery', 'Delivery'], ['offers', 'Offers & payments'], ['homepage', 'Homepage'], ['account', 'Admin account'], ['data', 'Demo data']];
  const t = (name, label, val, extra = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(val ?? '')}" ${extra}></label>`;
  const n = (name, label, val, extra = '') => `<label class="field"><span>${label}</span><input name="${name}" type="number" value="${esc(val ?? '')}" ${extra}></label>`;
  const sw = (name, label, sub, on) => `<label class="switch-row"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><label class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span></span></label></label>`;
  const panes = {
    store: `<section class="card"><h2 class="card-title">Store details</h2><div class="grid-2">${t('store.name', 'Store name', s.store.name, 'maxlength="40"')}${t('store.tagline', 'Tagline', s.store.tagline)}${t('store.phone', 'Phone (shown to customers)', s.store.phone)}${t('store.whatsapp', 'WhatsApp number', s.store.whatsapp, 'placeholder="8801XXXXXXXXX"')}${t('store.email', 'Email', s.store.email, 'type="email"')}${t('store.hours', 'Opening hours', s.store.hours)}</div>${t('store.address', 'Address', s.store.address)}</section>
      <section class="card"><h2 class="card-title">Social links</h2><p class="muted small">Leave empty to hide an icon.</p><div class="grid-2">${t('store.facebook', 'Facebook page URL', s.store.facebook)}${t('store.instagram', 'Instagram URL', s.store.instagram)}${t('store.tiktok', 'TikTok URL', s.store.tiktok)}${t('store.messenger', 'Messenger link', s.store.messenger)}</div></section>
      <section class="card"><h2 class="card-title">Announcement bar</h2><label class="field"><span>Messages (one per line, they rotate at the top of every page)</span><textarea name="announcements" rows="4">${esc(s.announcements.join('\n'))}</textarea></label></section>
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
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-clear]'); if (!b) return;
    const all = b.dataset.clear === 'products';
    if (!(await ask(all ? 'Remove all demo data, including sample products?' : 'Remove demo orders, reviews and messages?', { ok: 'Remove', detail: 'Your own products, orders and settings are not touched. This cannot be undone.' }))) return;
    try { const r = await api('/api/admin/demo/clear', { method: 'POST', body: { what: b.dataset.clear } }); A.products = []; toast(`Done. ${plural(r.products, 'product')} and ${plural(r.orders, 'order')} remain.`); refreshCounts(); }
    catch (err) { toast(err.message, 'error'); }
  });
}

boot();
