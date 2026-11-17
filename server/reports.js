// Business reports for the dashboard. Everything is computed from real orders, so the numbers
// always match the order list. Definitions (shown in the dashboard too):
//  - Sale: an order that is not cancelled or returned and not refunded.
//  - Sales: the order totals customers pay (products − discounts + delivery + gift wrap).
//  - Gross profit: sales − product cost − courier cost − packaging − cash-on-delivery fee.
//  - Return loss: courier + packaging spent on orders that came back.
import { INACTIVE_STATUSES } from '../public/assets/js/engine.js';
import { dhakaDate } from './db.js';

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
export const isSale = (o) => !INACTIVE_STATUSES.has(o.status) && o.payment.status !== 'refunded';
const round = (n) => Math.round(n);

/** Date range from ?from=&to= (Dhaka dates, inclusive) plus the same-length period before it. */
export function range(q = {}) {
  const today = dhakaDate(Date.now());
  let from = ISO.test(q.from || '') ? q.from : addDays(today, -29);
  let to = ISO.test(q.to || '') ? q.to : today;
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) > 730) from = addDays(to, -730);
  const days = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
  return { from, to, days, prevFrom, prevTo, today };
}
const dates = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

/** Unit cost of a line (snapshot taken when ordered; falls back to today's cost). */
function lineCost(store, l) {
  if (l.cost != null) return l.cost;
  if (l.kind === 'box') {
    let c = 0;
    for (const x of l.box.items) { const p = store.products.get(x.pid); if (p?.cost == null) return null; c += p.cost; }
    return c;
  }
  const p = store.products.get(l.pid);
  return p?.cost != null ? p.cost * (l.pack || 1) : null;
}
/** What one order really earned. */
export function economics(store, o) {
  const s = store.settings.costs;
  let cogs = 0, known = true;
  for (const l of o.items) { const c = lineCost(store, l); if (c == null) known = false; else cogs += c * l.qty; }
  const ship = o.delivery.method === 'pickup' ? 0 : o.courier?.cost ?? (o.address.zone === 'outside' ? s.courierOutside : s.courierInside);
  const pack = s.packaging || 0;
  const codFee = o.payment.method === 'cod' ? round((o.totals.total * (s.codPct || 0)) / 100) : 0;
  return { cogs, ship, pack, codFee, profit: o.totals.total - cogs - ship - pack - codFee, known };
}
/** Every product unit in an order: [pid, units, revenue, cost|null]. */
function units(store, o) {
  const out = [];
  for (const l of o.items) {
    if (l.kind === 'box') {
      for (const c of l.box.items) { const p = store.products.get(c.pid); out.push([c.pid, l.qty, c.price * l.qty, p?.cost != null ? p.cost * l.qty : null]); }
    } else {
      const c = lineCost(store, l);
      out.push([l.pid, l.qty * (l.pack || 1), l.price * l.qty, c != null ? c * l.qty : null]);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- overview */
export function overview(store, q) {
  const R = range(q), orders = store.data.orders;
  const blank = () => ({ sales: 0, orders: 0, units: 0, profit: 0, knownSales: 0, placed: 0, cancelled: 0, returned: 0, delivered: 0, returnLoss: 0, phones: new Set(), newCustomers: 0 });
  const cur = blank(), prev = blank();
  const first = new Map();
  for (const o of orders) if (isSale(o)) { const f = first.get(o.customer.phone); if (f == null || o.created < f) first.set(o.customer.phone, o.created); }
  const series = new Map(dates(R.from, R.to).map((d) => [d, { date: d, sales: 0, orders: 0, profit: 0, visits: 0 }]));
  const byCat = new Map(), byPay = {}, byCity = new Map(), bySource = new Map(), top = new Map();
  for (const o of orders) {
    const day = dhakaDate(o.created);
    const b = day >= R.from && day <= R.to ? cur : day >= R.prevFrom && day <= R.prevTo ? prev : null;
    if (!b) continue;
    b.placed++;
    if (o.status === 'cancelled') b.cancelled++;
    if (o.status === 'returned') { b.returned++; const e = economics(store, o); b.returnLoss += e.ship + e.pack; }
    if (!isSale(o)) continue;
    const e = economics(store, o), total = o.totals.total;
    b.sales += total; b.orders++; b.units += o.totals.count || 0; b.profit += e.profit; if (e.known) b.knownSales += total;
    if (o.status === 'delivered') b.delivered++;
    b.phones.add(o.customer.phone);
    if (b !== cur) continue;
    const s = series.get(day); s.sales += total; s.orders++; s.profit += e.profit;
    const pay = (byPay[o.payment.method] ||= { orders: 0, sales: 0 }); pay.orders++; pay.sales += total;
    const city = (o.address.city || '—').trim(); const c = byCity.get(city) || { city, orders: 0, sales: 0 }; c.orders++; c.sales += total; byCity.set(city, c);
    const ch = o.source?.channel || 'direct'; const sc = bySource.get(ch) || { channel: ch, orders: 0, sales: 0 }; sc.orders++; sc.sales += total; bySource.set(ch, sc);
    for (const [pid, n, rev, cost] of units(store, o)) {
      const p = store.products.get(pid);
      const cat = p?.cat || 'other';
      const k = byCat.get(cat) || { cat, name: store.categories.get(cat)?.name || 'Other', sales: 0, units: 0 }; k.sales += rev; k.units += n; byCat.set(cat, k);
      const t = top.get(pid) || { pid, name: p?.name || 'Deleted product', img: p?.images[0] || '', units: 0, sales: 0, profit: 0, known: true };
      t.units += n; t.sales += rev; if (cost == null) t.known = false; else t.profit += rev - cost; top.set(pid, t);
    }
  }
  for (const [phone, ts] of first) {
    const d = dhakaDate(ts);
    if (d >= R.from && d <= R.to) cur.newCustomers++; else if (d >= R.prevFrom && d <= R.prevTo) prev.newCustomers++;
  }
  // Traffic from the analytics counters.
  const traffic = (from, to) => {
    const t = { visits: 0, productViews: 0, carts: 0, checkouts: 0, online: 0 };
    for (const d of dates(from, to)) { const a = store.data.analytics.days[d]; if (!a) continue; t.visits += a.v; t.productViews += a.pv; t.carts += a.atc; t.checkouts += a.ck; t.online += a.ord; }
    return t;
  };
  for (const [d, s] of series) s.visits = store.data.analytics.days[d]?.v || 0;
  const tc = traffic(R.from, R.to), tp = traffic(R.prevFrom, R.prevTo);
  const kpi = (b, t) => ({
    sales: b.sales, orders: b.orders, units: b.units, aov: b.orders ? round(b.sales / b.orders) : 0,
    profit: round(b.profit - b.returnLoss), margin: b.sales ? (b.profit - b.returnLoss) / b.sales : 0, costCoverage: b.sales ? b.knownSales / b.sales : 1,
    customers: b.phones.size, newCustomers: b.newCustomers, returningCustomers: Math.max(0, b.phones.size - b.newCustomers),
    placed: b.placed, cancelled: b.cancelled, returned: b.returned, returnLoss: b.returnLoss,
    cancelRate: b.placed ? b.cancelled / b.placed : 0, returnRate: b.delivered + b.returned ? b.returned / (b.delivered + b.returned) : 0,
    visits: t.visits, conversion: t.visits ? Math.min(1, t.online / t.visits) : null,
  });

  // Things that need doing now (not tied to the date range).
  const today = R.today, act = { pending: 0, toPack: 0, onRoad: 0, codOnRoad: 0, deliveredUnpaid: 0, deliveredUnpaidAmount: 0, unverified: 0, overdue: 0 };
  for (const o of orders) {
    if (o.status === 'pending') act.pending++;
    if (o.status === 'confirmed' || o.status === 'processing') act.toPack++;
    if (o.status === 'shipped') { act.onRoad++; if (o.payment.method === 'cod' && o.payment.status !== 'paid') act.codOnRoad += o.totals.total; }
    if (o.status === 'delivered' && o.payment.status === 'unpaid') { act.deliveredUnpaid++; act.deliveredUnpaidAmount += o.totals.total; }
    if (o.payment.method !== 'cod' && o.payment.status === 'unpaid' && !INACTIVE_STATUSES.has(o.status)) act.unverified++;
    if (o.delivery.date && o.delivery.date < today && !['delivered', 'cancelled', 'returned'].includes(o.status)) act.overdue++;
  }
  const c = store.counts();
  const inv = inventorySummary(store);
  return {
    range: R, kpi: kpi(cur, tc), prev: kpi(prev, tp),
    series: [...series.values()],
    funnel: { visits: tc.visits, productViews: tc.productViews, carts: tc.carts, checkouts: tc.checkouts, orders: tc.online },
    byCategory: [...byCat.values()].sort((a, b) => b.sales - a.sales).slice(0, 8),
    byPayment: byPay, byCity: [...byCity.values()].sort((a, b) => b.sales - a.sales).slice(0, 6),
    bySource: [...bySource.values()].sort((a, b) => b.sales - a.sales),
    top: [...top.values()].sort((a, b) => b.units - a.units || b.sales - a.sales).slice(0, 6),
    actions: { ...act, ...c, low: inv.limited, out: inv.out, reorder: inv.reorder },
    stock: inv,
    recent: orders.slice(-8).reverse().map((o) => ({ id: o.id, created: o.created, name: o.customer.name, total: o.totals.total, status: o.status, payment: o.payment.method, channel: o.source?.channel || 'direct' })),
  };
}

/* --------------------------------------------------------------- inventory */
function velocity(store) {
  const now = Date.now(), s30 = new Map(), s90 = new Map(), last = new Map();
  const orders = store.data.orders;
  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i];
    if (now - o.created > 90 * DAY) break;
    if (!isSale(o)) continue;
    for (const [pid, n] of units(store, o)) {
      s90.set(pid, (s90.get(pid) || 0) + n);
      if (now - o.created <= 30 * DAY) s30.set(pid, (s30.get(pid) || 0) + n);
      if (!last.has(pid)) last.set(pid, o.created);
    }
  }
  return { s30, s90, last };
}
export function inventory(store) {
  const now = Date.now(), { s30, s90, last } = velocity(store);
  const rows = store.data.products.map((p) => {
    const sold30 = s30.get(p.id) || 0, perDay = sold30 / 30, price = store.live(p).price;
    const tracked = p.qty != null;
    const cover = tracked && perDay > 0 ? p.qty / perDay : null;
    const low = p.lowStock ?? store.settings.lowStockDefault ?? 5;
    const reorder = tracked && perDay > 0 ? Math.max(0, Math.ceil(perDay * 30 - p.qty)) : tracked && p.qty <= low && sold30 === 0 && (s90.get(p.id) || 0) > 0 ? Math.max(0, low * 2 - p.qty) : 0;
    const lastSale = last.get(p.id) || null;
    return {
      id: p.id, name: p.name, img: p.images[0] || '', sku: p.sku || '', cat: p.cat, active: p.active, status: p.status,
      qty: p.qty, cost: p.cost ?? null, price, supplier: p.supplier || '',
      valueCost: tracked && p.cost != null ? p.qty * p.cost : null, valueRetail: tracked ? p.qty * price : null,
      sold30, sold90: s90.get(p.id) || 0, perDay: Math.round(perDay * 100) / 100, cover: cover == null ? null : Math.round(cover),
      reorder, lastSale, dead: tracked && p.qty > 0 && !lastSale && now - p.created > 30 * DAY,
      margin: p.cost != null && price > 0 ? (price - p.cost) / price : null,
    };
  });
  return { rows, summary: summarize(rows) };
}
function summarize(rows) {
  const s = { products: rows.length, tracked: 0, units: 0, valueCost: 0, valueRetail: 0, missingCost: 0, in: 0, limited: 0, out: 0, dead: 0, reorder: 0, deadValue: 0 };
  for (const r of rows) {
    s[r.status]++;
    if (r.qty == null) continue;
    s.tracked++; s.units += r.qty; s.valueRetail += r.valueRetail || 0;
    if (r.cost == null) s.missingCost++; else s.valueCost += r.valueCost;
    if (r.dead) { s.dead++; s.deadValue += r.valueCost ?? r.valueRetail ?? 0; }
    if (r.reorder > 0) s.reorder++;
  }
  return s;
}
export function inventorySummary(store) {
  const { rows, summary } = inventory(store);
  const low = rows.filter((r) => r.status !== 'in').sort((a, b) => (a.status === 'out' ? 0 : 1) - (b.status === 'out' ? 0 : 1) || (a.cover ?? 1e9) - (b.cover ?? 1e9) || (a.qty ?? 1e9) - (b.qty ?? 1e9));
  const soon = rows.filter((r) => r.status === 'in' && r.cover != null && r.cover <= 10);
  return { ...summary, attention: [...low, ...soon].slice(0, 8).map((r) => ({ id: r.id, name: r.name, img: r.img, status: r.status, qty: r.qty, cover: r.cover, reorder: r.reorder })) };
}

/* --------------------------------------------------------------- customers */
function customerMap(store) {
  const m = new Map(), now = Date.now();
  for (const o of store.data.orders) {
    const k = o.customer.phone;
    let c = m.get(k);
    if (!c) m.set(k, (c = { phone: k, name: o.customer.name, email: o.customer.email, city: o.address.city, orders: 0, sales: 0, spent: 0, delivered: 0, returned: 0, cancelled: 0, first: o.created, last: o.created, registered: false, channel: o.source?.channel || 'direct' }));
    c.orders++; c.name = o.customer.name; c.email = o.customer.email || c.email; c.city = o.address.city || c.city;
    if (o.status === 'delivered') c.delivered++;
    if (o.status === 'returned') c.returned++;
    if (o.status === 'cancelled') c.cancelled++;
    if (isSale(o)) { c.sales++; c.spent += o.totals.total; }
    c.first = Math.min(c.first, o.created); c.last = Math.max(c.last, o.created);
  }
  for (const u of store.data.users) {
    let c = m.get(u.phone);
    if (!c) m.set(u.phone, (c = { phone: u.phone, name: u.name, email: u.email, city: u.address?.city || '', orders: 0, sales: 0, spent: 0, delivered: 0, returned: 0, cancelled: 0, first: u.created, last: u.created, channel: '' }));
    c.registered = true;
  }
  const vip = store.settings.vipSpend || 10000;
  for (const c of m.values()) {
    const n = store.data.customerNotes[c.phone] || {};
    c.tags = n.tags || []; c.blocked = !!n.blocked; c.note = n.note || '';
    const finished = c.delivered + c.returned + c.cancelled;
    c.success = finished ? c.delivered / finished : null;
    c.aov = c.sales ? round(c.spent / c.sales) : 0;
    c.segment = c.blocked ? 'blocked'
      : finished >= 2 && c.success < 0.5 ? 'risk'
        : c.spent >= vip || c.sales >= 5 ? 'vip'
          : c.sales >= 1 && now - c.last > 90 * DAY ? 'lapsed'
            : c.sales >= 2 ? 'repeat' : c.orders ? 'new' : 'lead';
  }
  return m;
}
export function customers(store) {
  return [...customerMap(store).values()].sort((a, b) => b.spent - a.spent || b.last - a.last);
}
export function customer(store, phone) {
  const c = customerMap(store).get(phone);
  if (!c) return null;
  const orders = store.data.orders.filter((o) => o.customer.phone === phone).reverse();
  const addresses = [...new Map(orders.map((o) => [`${o.address.line}|${o.address.city}`, o.address])).values()].slice(0, 5);
  const leads = store.data.leads.filter((l) => l.phone === phone).map((l) => ({ ...l, funnelName: l.funnel ? store.funnels.get(l.funnel)?.name || 'Funnel' : 'Popup' }));
  return {
    ...c, addresses, leads,
    orderList: orders.map((o) => ({ id: o.id, created: o.created, total: o.totals.total, status: o.status, payment: o.payment.method, paid: o.payment.status, items: o.items.reduce((s, l) => s + l.qty, 0), channel: o.source?.channel || 'direct' })),
  };
}
/** Past behaviour of a phone number (shown on each order as a fraud check). */
export function history(store, phone, exceptId) {
  const h = { orders: 0, delivered: 0, returned: 0, cancelled: 0, spent: 0 };
  for (const o of store.data.orders) {
    if (o.customer.phone !== phone || o.id === exceptId) continue;
    h.orders++;
    if (o.status === 'delivered') h.delivered++;
    if (o.status === 'returned') h.returned++;
    if (o.status === 'cancelled') h.cancelled++;
    if (isSale(o)) h.spent += o.totals.total;
  }
  const finished = h.delivered + h.returned + h.cancelled;
  return { ...h, success: finished ? h.delivered / finished : null, blocked: store.isBlocked(phone), note: store.data.customerNotes[phone]?.note || '' };
}

/* ----------------------------------------------------------- profit & loss */
export function profitLoss(store, q) {
  const R = range(q);
  const pl = { orders: 0, sales: 0, productSales: 0, discounts: 0, deliveryCharged: 0, wrapCharged: 0, cogs: 0, shipping: 0, packaging: 0, codFees: 0, returnLoss: 0, returned: 0, knownSales: 0 };
  const products = new Map(), days = new Map(dates(R.from, R.to).map((d) => [d, { date: d, orders: 0, sales: 0, profit: 0, expenses: 0 }]));
  for (const o of store.data.orders) {
    const day = dhakaDate(o.created);
    if (day < R.from || day > R.to) continue;
    const e = economics(store, o);
    if (o.status === 'returned') { pl.returned++; pl.returnLoss += e.ship + e.pack; days.get(day).profit -= e.ship + e.pack; continue; }
    if (!isSale(o)) continue;
    pl.orders++; pl.sales += o.totals.total; pl.productSales += o.totals.subtotal; pl.discounts += o.totals.discount;
    pl.deliveryCharged += o.totals.delivery; pl.wrapCharged += o.totals.wrap || 0;
    pl.cogs += e.cogs; pl.shipping += e.ship; pl.packaging += e.pack; pl.codFees += e.codFee;
    if (e.known) pl.knownSales += o.totals.total;
    const d = days.get(day); d.orders++; d.sales += o.totals.total; d.profit += e.profit;
    for (const [pid, n, rev, cost] of units(store, o)) {
      const p = store.products.get(pid);
      const r = products.get(pid) || { pid, name: p?.name || 'Deleted product', sku: p?.sku || '', units: 0, sales: 0, cogs: 0, known: true };
      r.units += n; r.sales += rev; if (cost == null) r.known = false; else r.cogs += cost;
      products.set(pid, r);
    }
  }
  const expenses = {}; let expenseTotal = 0;
  for (const x of store.data.expenses) {
    if (x.date < R.from || x.date > R.to) continue;
    expenses[x.category] = (expenses[x.category] || 0) + x.amount; expenseTotal += x.amount;
    const d = days.get(x.date); if (d) d.expenses += x.amount;
  }
  const gross = pl.sales - pl.cogs - pl.shipping - pl.packaging - pl.codFees;
  return {
    range: R, ...pl, grossProfit: gross, expenses, expenseTotal, netProfit: gross - pl.returnLoss - expenseTotal,
    costCoverage: pl.sales ? pl.knownSales / pl.sales : 1,
    products: [...products.values()].map((r) => ({ ...r, profit: r.known ? r.sales - r.cogs : null, margin: r.known && r.sales ? (r.sales - r.cogs) / r.sales : null })).sort((a, b) => b.sales - a.sales),
    days: [...days.values()],
    expenseList: store.data.expenses.filter((x) => x.date >= R.from && x.date <= R.to).sort((a, b) => (a.date < b.date ? 1 : -1)),
  };
}

/* --------------------------------------------------------------- analytics */
function sumDays(store, from, to) {
  const t = { v: 0, pv: 0, atc: 0, ck: 0, ord: 0, rev: 0, lead: 0, bump: 0, bumpRev: 0, up: 0, upRev: 0, src: {}, dev: {}, so: {}, sr: {}, f: {}, p: {} };
  const add = (into, from) => { for (const k in from) into[k] = (into[k] || 0) + from[k]; };
  const series = [];
  for (const d of dates(from, to)) {
    const a = store.data.analytics.days[d];
    series.push({ date: d, visits: a?.v || 0, orders: a?.ord || 0, revenue: a?.rev || 0 });
    if (!a) continue;
    for (const k of ['v', 'pv', 'atc', 'ck', 'ord', 'rev', 'lead', 'bump', 'bumpRev', 'up', 'upRev']) t[k] += a[k] || 0;
    add(t.src, a.src); add(t.dev, a.dev); add(t.so, a.so); add(t.sr, a.sr); add(t.p, a.p || {});
    for (const [fid, f] of Object.entries(a.f || {})) add((t.f[fid] ||= {}), f);
  }
  return { t, series };
}
export function funnelStats(store, from, to) {
  const { t } = sumDays(store, from, to);
  const out = {};
  for (const f of store.data.funnels) {
    const s = t.f[f.id] || {};
    const leads = f.type === 'lead' ? s.lead || 0 : 0;
    const goal = f.type === 'lead' ? leads : s.ord || 0;
    out[f.id] = { visits: s.v || 0, checkouts: s.ck || 0, orders: s.ord || 0, leads, revenue: s.rev || 0, bumps: s.bump || 0, upsells: s.up || 0, conversion: s.v ? Math.min(1, goal / s.v) : null };
  }
  return out;
}
export function analytics(store, q) {
  const R = range(q);
  const { t, series } = sumDays(store, R.from, R.to);
  const prev = sumDays(store, R.prevFrom, R.prevTo).t;
  const sold = new Map();
  for (const o of store.data.orders) {
    const day = dhakaDate(o.created);
    if (day < R.from || day > R.to || !isSale(o) || o.manual) continue;
    for (const [pid, n] of units(store, o)) sold.set(pid, (sold.get(pid) || 0) + n);
  }
  const channels = new Set([...Object.keys(t.src), ...Object.keys(t.so)]);
  const fs = funnelStats(store, R.from, R.to);
  return {
    range: R,
    totals: { visits: t.v, productViews: t.pv, carts: t.atc, checkouts: t.ck, orders: t.ord, revenue: t.rev, leads: t.lead, bumps: t.bump, bumpRevenue: t.bumpRev, upsells: t.up, upsellRevenue: t.upRev },
    prev: { visits: prev.v, orders: prev.ord, revenue: prev.rev },
    series,
    sources: [...channels].map((ch) => ({ channel: ch, visits: t.src[ch] || 0, orders: t.so[ch] || 0, revenue: t.sr[ch] || 0, conversion: t.src[ch] ? Math.min(1, (t.so[ch] || 0) / t.src[ch]) : null })).sort((a, b) => b.visits - a.visits || b.orders - a.orders),
    devices: t.dev,
    products: Object.entries(t.p).map(([pid, views]) => { const p = store.products.get(pid); return { pid, name: p?.name || 'Deleted product', img: p?.images[0] || '', views, sold: sold.get(pid) || 0 }; })
      .sort((a, b) => b.views - a.views).slice(0, 15),
    funnels: store.data.funnels.map((f) => ({ id: f.id, name: f.name, type: f.type, slug: f.slug, active: f.active, ...fs[f.id] })),
  };
}
