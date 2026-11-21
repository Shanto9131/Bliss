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
| Add or update many products from a sheet | **Import** → choose an Excel (.xlsx) or CSV file (+ photos, optional) → check the preview → **Import** |
| Download all products as a sheet | **Export** (opens in Excel; edit it and import it back to update prices, stock, etc.) |

**Import from a spreadsheet:** the first row holds the column names (Name, Category, Price, Quantity, Visible,
Description, Images… — common alternatives such as "Product name" or "Price (৳)" are recognised, and you can
change the matching on screen). Rows are matched to existing products by ID, SKU or name; empty cells keep the
current value, and a new category name creates the category. Photos: put the photo's file name or a https://
link in the Images column and add the photo files, or name each photo after the product or SKU
(`Aroosha.jpg`, `AT-001.jpg`). Nothing is saved until you approve the preview. **Download template** gives an example sheet.

A product needs a price above ৳0 before it can be shown in the shop, and categories without a visible product
are hidden from shoppers.

**BLISS's own products** (Bouquets and Attar) live in `server/catalog.js` with photos in `public/img/bouquets/`.
They are added once to every database on start, so they also appear on Vercel. The attars start **hidden** with no
price: add the price (and a photo), then switch on **Visible**.

**Quantity (optional):** if you type a quantity, the status updates automatically:
`0` → *Out of stock*, `5 or fewer` → *Limited stock* (shoppers see "Only 3 left"),
more → *In stock*. Every order reduces the quantity; a cancelled order puts it back.
Leave the quantity empty if you prefer to set the status by hand.

**Photos:** drag & drop phone photos of **any size or shape** straight into the product form.
In your browser, before upload, every photo is **auto-fitted** to the shop's frames (4:5 for
products, square for categories) and converted to WEBP, so a 5 MB photo becomes about 150 KB,
nothing is stretched and every grid lines up:
- shape close to the frame → the edges are trimmed slightly;
- very different shape (wide, tall, square) → the whole photo is kept and the empty space is filled
  with the photo's own background colour (seamless for studio shots), a soft blurred copy, or white
  (transparent PNGs get white);
- small photos are not blown up beyond their real detail.

Change the behaviour in **Settings › Store details › Photos**, where **Fit photos I already uploaded**
re-fits older uploads in one click. Photos added by link (https://…) can't be changed; the shop
still shows them whole on product pages.

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
- Overview with a **date range** (today, 7/30/90 days, this/last month, this year, custom) and
  the change vs the previous period: sales, **gross profit & margin**, average order, new vs
  returning customers, **conversion rate**, cancel/return rate; a **To do now** list (orders to
  confirm, bKash/Nagad payments to verify, parcels out for delivery and the cash to collect,
  overdue deliveries, abandoned carts, products to reorder); sales/profit/orders/visitors chart;
  shop funnel; sales by source, category, payment and city; best sellers with profit; stock value
- Products (above) with **cost price, SKU, supplier** and an optional **sale end time**
  (countdown; the price returns to normal automatically)
- **Inventory**: units on hand, stock value at cost and at selling price, sales speed,
  days of stock left, suggested reorder quantity, products that are not selling, **receive stock**
  (updates the average cost), **stock counts / write-offs**, and a full **stock history** for every
  product (orders, cancels, returns, deliveries). CSV export
- Orders: filter by status, payment, source and date, search by tracking number, **bulk update &
  bulk packing slips**, one-click workflow (Confirm → Packing → Out for delivery → Delivered, or
  **Returned** when a parcel comes back), **courier & tracking number** (shown to the customer),
  real profit per order, a **fraud check** from the customer's past orders (returned / cancelled),
  mark paid or refunded, printable invoice & packing slip, CSV export
- **New order** for phone, Facebook, Instagram, WhatsApp and walk-in orders (finds returning
  customers by phone, applies stock and reports like an online order)
- Customers: **segments** (VIP, repeat, new, lapsed, risky, blocked), delivery success rate,
  lifetime value, a profile with private notes and tags, and **blocking** of fake-order numbers. CSV export
- **Abandoned carts**: shoppers who typed their phone at checkout but did not order, with a
  one-click WhatsApp message that restores their bag (plus an optional coupon) and recovery stats
- **Funnels** (landing pages for ads, at `/f/your-link`), see section 3a
- **Traffic & funnel**: visitors, conversion, traffic sources (Facebook, Instagram, Google,
  TikTok… from ad links and referrers), devices, product views vs sales, results per funnel
- **Sales boosters**, see section 3b
- **Profit & expenses**: profit & loss statement (sales − product cost − courier − packaging −
  COD fees − return losses − expenses), profit by product (CSV), daily breakdown, expense log
- Reviews (approve before they show), coupons, messages (contact, corporate, restock
  requests), newsletter subscribers (CSV export)
- Gift Box Builder settings (boxes, wraps, ribbons)
- Settings: store details, social links, announcement bar, delivery charges & express,
  Mix & Match tiers, gift-wrap price, payment numbers, homepage text, password, demo data

### 3a. Funnels (Dashboard › Funnels)

A funnel is a focused page with one goal and no menus, made for ad traffic. Each one has its own
link (`/f/...`) to put in your Facebook, Instagram or TikTok ad.

| Type | What it does |
|---|---|
| **Product landing page** | One product, headline, photos/YouTube video, benefits, reviews, FAQ, guarantee and a quick cash-on-delivery order form on the same page. Optional **price packages** (e.g. 1 for ৳990, 2 for ৳1,780), a countdown (a personal timer per visitor, or a fixed end date), its own delivery charge, an **order bump** (tick-box add-on in the form) and a **one-click upsell** after the order (added to the same COD delivery). |
| **Lead capture / giveaway** | Collects phone numbers (and emails) and reveals a coupon. Leads appear in Subscribers & leads (CSV export). |
| **Campaign sale page** | A timed sale with hand-picked products and a coupon that is applied to the bag automatically. |

Every funnel shows its visitors, orders or leads, conversion rate, sales and how many took the bump
and upsell. Add `?utm_source=facebook&utm_campaign=your-campaign` to ad links to see results per campaign.
Two sample funnels are included with the demo data.

### 3b. Sales boosters (Dashboard › Sales boosters)

All switchable, all based on real data (nothing is faked):
- **Recent purchase notes** ("Someone in Dhaka bought … 2 hours ago", from real orders of the last 7 days)
- **"Sold in the last 7 days"** on product pages (shown at 3+), **sale countdowns**
- **Frequently bought together** from products customers actually bought together
- **Floating WhatsApp / Messenger** button (with the product name pre-filled)
- **Offer pop-up** (email or phone for a coupon, once every 3 days, also on exit on computers)
- **Checkout add-on** (order bump) and **after-order one-click upsell**
- **Sale campaign bar** with countdown and one-tap coupon
- **Abandoned checkout capture** (see Abandoned carts)
- **Ad pixels**: Facebook (Meta) Pixel, Google Analytics 4 and TikTok Pixel. Page view, product view,
  add to cart, checkout, purchase (with value, de-duplicated by order ID) and lead events are sent
  automatically. The security policy only allows a pixel's scripts once you add its ID.

**Accurate numbers:** sales exclude cancelled, returned and refunded orders. Profit uses the cost price
saved on each order line when it was ordered, the real courier charge where you entered it (otherwise the
defaults in Settings › Costs & profit), packaging and the COD fee. Visitor counting ignores bots and counts
each visitor once per step per day. Orders are counted on the server, so ad blockers cannot hide them.

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

### Vercel (quick public demo)

This repo is Vercel-ready (`vercel.json` + `api/index.js`): import it at https://vercel.com/new and
click **Deploy**. Static files are served by Vercel's CDN; pages and the API run as a serverless function.

**Important:** Vercel has no permanent disk. The whole shop works, but orders, uploaded photos and
dashboard changes are kept only temporarily and **reset when Vercel restarts the function** (after
some idle time or a new deploy). Use Vercel to show the shop; for real selling use a host with a
disk (a VPS, or Railway/Render with a volume), or connect a hosted database.

Set these in Vercel › Project › Settings › Environment Variables:

| Variable | Why |
|---|---|
| `SESSION_SECRET` | Any long random text, so dashboard logins work on every Vercel server |
| `ADMIN_PASSWORD` | Your dashboard password (on Vercel, change it here, not in the dashboard) |

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

- `data/db.json`: products, orders, customers, funnels, leads, expenses, stock history, visitor
  counts and settings (a `db.json.bak` copy is made at every start). Older databases are upgraded
  automatically on start.
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
server/                Database, API, reports (profit, inventory, analytics), auth, rendering, demo data
public/index.html      Shop page shell        public/admin/index.html   Dashboard shell
public/assets/js/      engine.js (search & totals) · store.js (shop) · admin.js (dashboard)
public/assets/css/     store.css · admin.css
public/img/            Demo illustrations     uploads/   Your photos     data/   Database
```
