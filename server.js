#!/usr/bin/env node
// BLISS gift shop server. Zero dependencies: just run `node server.js` (or `npm start`).
import http from 'node:http';
import { createApp } from './server/app.js';
import { DEFAULT_ADMIN } from './server/seed.js';

const PORT = Number(process.env.PORT) || 3000;
const started = performance.now();
const app = await createApp({ reset: process.argv.includes('--reset') });

const server = http.createServer(app.handler);
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 60_000;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use. Close the other program or run with another port, e.g.  PORT=4000 node server.js\n`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, () => {
  const { store, files } = app, a = store.settings.admin;
  console.log(`\n  ✿ ${store.settings.store.name} is running (started in ${(performance.now() - started).toFixed(0)} ms)\n`);
  console.log(`    Shop:       http://localhost:${PORT}`);
  console.log(`    Dashboard:  http://localhost:${PORT}/admin`);
  if (a.isDefault) console.log(`    Login:      ${a.username} / ${DEFAULT_ADMIN.password}   ← change this in Dashboard › Settings`);
  console.log(`    Catalogue:  ${store.data.products.length} products · ${store.data.orders.length} orders · ${files.files.size} static files cached in memory\n`);
});

const shutdown = () => { try { app.store.flushSync(); } catch (e) { console.error(e); } process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
