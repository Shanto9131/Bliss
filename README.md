# BLISS: Gift Shop Website + Admin Dashboard

A complete, fast online gift shop for Bangladesh with its own admin dashboard.
No database server and no `npm install` needed. It runs with Node.js alone.

---

## 1. Start the shop (2 minutes)

1. Install **Node.js 18 or newer** from https://nodejs.org (choose "LTS").
2. Open a terminal in this folder and run:

   ```bash
   npm start
   ```

3. Open the shop: **http://localhost:3000**
4. Open the dashboard: **http://localhost:3000/admin**

   | Username | Password |
   |---|---|
   | `admin` | `bliss1234` |

   **Change this password right away:** Dashboard › Settings › Admin account.

The first start creates a demo shop: 54 sample products, 12 categories, sample
orders and reviews. You can remove them in **Settings › Demo data** when you are ready
to launch.

---

## 2. Managing products & stock (Dashboard › Products)

| What you want | How |
|---|---|
| Add a product | **Add product** button → fill name, category, price → add photos → **Create product** |
| Delete a product | 🗑 icon on the row (or tick several rows → **Delete**) |
| Show **In stock / Limited stock / Out of stock** | Click **In**, **Limited** or **Out** on the product's row. The shop updates instantly. |
| Hide a product without deleting | Turn off the **Visible** switch |
| Change many products at once | Tick the rows → use the black bar (In stock / Limited / Out / Show / Hide / Delete) |

**Quantity (optional):** if you type a quantity, the status updates automatically:
`0` → *Out of stock*, `5 or fewer` → *Limited stock* (shoppers see "Only 3 left"),
more → *In stock*. Every order reduces the quantity; a cancelled order puts it back.
Leave the quantity empty if you prefer to set the status by hand.

**Photos:** drag & drop phone photos straight into the product form. They are
resized and converted to WEBP *in your browser* before upload, so a 5 MB photo becomes
about 150 KB and the shop stays fast.

**Options** (ring size, letter, colour): add them in the product form. Customers must
pick one before adding to the bag.

---

## 3. Everything the shop does

**For shoppers**
- Home page: hero, Bliss Express countdown, shop by occasion, **Gift Finder**
  ("for her, for a birthday, under ৳1,500"), new arrivals, categories, best sellers,
  ready-to-gift boxes, real customer reviews, Mix & Match offer, corporate gifting
- Shop / category / occasion pages with filters (availability, price, category,
  occasion, recipient, on sale), 8 sort orders and active-filter chips
- **Instant search** with autocomplete and typo correction ("rign" → ring, "nekclace" → necklace)
- Product pages: photo gallery with zoom, options, stock status ("Only 2 left"),
  delivery estimate, reviews and star ratings, "complete the gift", recently viewed,
  sticky add-to-bag button on mobile
- Quick view, wishlist, bag drawer with free-delivery and Mix & Match progress bars
- **Gift Box Builder**: pick a box → fill it → wrap & ribbon → handwritten note, with a live preview
- Checkout: guest or account, send to someone else, delivery date & time,
  Bliss Express, gift wrap, card message, hide prices, coupons,
  **Cash on Delivery / bKash / Nagad** (with Transaction ID)
- Order confirmation, **order tracking** (order ID + phone), customer accounts with order history
- Corporate & bulk quote form, Help centre (FAQ + contact form), About, policies
- Mobile-first design with a bottom tab bar; SEO tags, Google product data and a sitemap

**For you (dashboard)**
- Overview: revenue this month, orders, average order value, a 30-day revenue chart,
  stock health, recent orders, best sellers
- Products (above), categories, customers
- Orders: filter by status, search, one-click workflow
  (Confirm → Packing → Out for delivery → Delivered), mark paid, notes customers see
  when tracking, private notes, **printable invoice & packing slip**, CSV export
- Reviews (approve before they show), coupons, messages (contact, corporate, restock
  requests), newsletter subscribers (CSV export)
- Gift Box Builder settings (boxes, wraps, ribbons)
- Settings: store details, social links, announcement bar, delivery charges & express,
  Mix & Match tiers, gift-wrap price, payment numbers, homepage text, password, demo data

---

## 4. Why it is fast

- **The whole catalogue is embedded in the first page** (about 9 KB compressed for 54 products),
  so browsing, filtering and search need **zero extra network requests**.
- A shared search engine (`public/assets/js/engine.js`) runs in the browser and on the server:
  - **Hash maps** for instant product lookup by ID / URL
  - **Bitsets** for filters: each filter combination is a few CPU instructions
  - **Pre-sorted indexes + binary search** for price ranges and sorting
  - **Inverted index + Trie** for instant search and autocomplete
  - **BK-tree + Damerau–Levenshtein distance** for typo correction
  - **LRU cache** for repeated queries; **min-heap** for top-K best sellers
  - A typical filtered search takes about **0.01 ms**
- The server keeps every file in memory, **pre-compressed with Brotli/Gzip**, with
  long-term browser caching (content-hashed URLs) and `304 Not Modified` responses.
- Product data lives in memory with hash-map indexes; saves are atomic and batched.
- No frameworks: the shop's JavaScript is about 40 KB compressed in total.
- Measured on an ordinary Windows PC: one server process answers **~10,000 page requests per second**
  (median 4 ms with 50 requests at once).

---

## 5. Going live (deployment)

You need a server that runs Node.js and keeps files between restarts (a VPS is the most
reliable choice, e.g. DigitalOcean, Vultr, or a Bangladeshi VPS host).

```bash
# on the server, inside this folder
NODE_ENV=production PORT=3000 node server.js
```

Recommended: run it with **PM2** so it restarts automatically, and put **Nginx**
(with a free Let's Encrypt HTTPS certificate) in front of it:

```bash
npm install -g pm2
NODE_ENV=production TRUST_PROXY=1 PUBLIC_URL=https://yourshop.com pm2 start server.js --name bliss
pm2 save && pm2 startup
```

Minimal Nginx site:

```nginx
server {
  server_name yourshop.com;
  client_max_body_size 10m;
  location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host;
               proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; }
}
```

cPanel hosting with "Setup Node.js App" also works: set the startup file to `server.js`.

### Settings via environment variables (all optional)

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default `3000`) |
| `NODE_ENV=production` | Turns off file watching and enables HSTS |
| `ADMIN_PASSWORD` | Admin password used when the shop is created for the first time |
| `SESSION_SECRET` | Secret for login cookies (auto-generated in `data/secret.key` if not set) |
| `PUBLIC_URL` | Your real address, e.g. `https://yourshop.com` (used in SEO/share tags) |
| `TRUST_PROXY=1` | Set when running behind Nginx/Cloudflare, for correct IPs and HTTPS detection |
| `DATA_DIR`, `UPLOADS_DIR` | Store the database / photos somewhere else |

---

## 6. Your data & backups

- `data/db.json`: products, orders, customers, settings (a `db.json.bak` copy is made at every start)
- `uploads/`: product photos you uploaded

**Back up both folders regularly** (for example, a daily copy to Google Drive).
To start over with fresh demo data: stop the server and run `npm run reset`
(this **replaces** `db.json`, so back it up first).

---

## 7. Notes & next steps

- **bKash / Nagad** work in "Send Money + Transaction ID" mode: you check the TrxID and click
  *Mark paid* in the order. Automatic payment gateways (bKash Payment Gateway, SSLCommerz)
  need a merchant account; they can be added later.
- The demo photos are illustrations. Replace them with your real product photos.
- Edit About/FAQ/policy wording in `public/assets/js/store.js` (search for `POLICIES` and `FAQ`).
- Security built in: hashed passwords (scrypt), signed HttpOnly cookies, rate-limited logins and
  forms, server-side price & stock checks on every order, a strict Content-Security-Policy,
  and upload type checking.

## Project structure

```
server.js              Web server (no dependencies)
server/                Database, API, auth, page rendering, static files, demo data & art
public/index.html      Shop page shell        public/admin/index.html   Dashboard shell
public/assets/js/      engine.js (search & totals) · store.js (shop) · admin.js (dashboard)
public/assets/css/     store.css · admin.css
public/img/            Demo illustrations     uploads/   Your photos     data/   Database
```
