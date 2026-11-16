// Demo catalogue + default settings. Everything here can be edited or removed from the dashboard.
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth.js';
import { renderArt, renderHero, renderPlaceholder, PALETTES, prng } from './art.js';
import { slugify, computeTotals } from '../public/assets/js/engine.js';

export const DEFAULT_ADMIN = { username: 'admin', password: 'bliss1234' };

export function defaultSettings() {
  return {
    store: {
      name: 'BLISS', tagline: 'Gifts & Moments', phone: '+880 1700-000000', whatsapp: '8801700000000',
      email: 'hello@bliss.com.bd', address: 'Road 27, Dhanmondi, Dhaka 1209, Bangladesh', hours: 'Open daily · 10am – 10pm',
      facebook: 'https://facebook.com/', instagram: 'https://instagram.com/', tiktok: '', messenger: '',
    },
    announcements: [
      'FREE delivery on orders over ৳2,999',
      'Bliss Express: gifts delivered within 6 hours in Dhaka & Narayanganj',
      'Mix & Match: buy 2 save 5% · 3 save 10% · 4+ save 15%',
    ],
    delivery: { inside: 70, outside: 130, express: 180, freeOver: 2999, expressHours: 6, cutoffHour: 18, expressAreas: 'Dhaka & Narayanganj' },
    bundleTiers: [{ min: 2, pct: 5 }, { min: 3, pct: 10 }, { min: 4, pct: 15 }],
    giftWrapPrice: 60,
    lowStockDefault: 5,
    reviewsAutoApprove: false,
    newsletterCoupon: 'WELCOME5',
    payments: {
      cod: true, bkash: true, nagad: true, bkashNumber: '01700-000000', nagadNumber: '01700-000000',
      note: 'Send Money to our number, then type the Transaction ID (TrxID) below. We confirm every payment by phone.',
    },
    hero: {
      eyebrow: 'Handpicked gifts, wrapped with love',
      title: 'Gifts that feel like a *warm hug*.',
      subtitle: 'Jewellery, keepsakes and curated gift boxes — beautifully wrapped and delivered across Bangladesh, even within 6 hours in Dhaka.',
      cta: 'Build a gift box', ctaLink: '/gift-box-builder', cta2: 'Shop ready-to-gift', cta2Link: '/category/gift-boxes',
    },
    stats: { customers: '35K+', rating: '4.9', delivered: '120K+' },
    builder: {
      boxes: [
        { id: 'petite', name: 'Petite Box', price: 190, capacity: 3, desc: 'Sweet & simple. Fits 2–3 small treasures.', color: '#F4C6D0' },
        { id: 'classic', name: 'Classic Box', price: 290, capacity: 5, desc: 'Our most-loved size for a complete gift.', color: '#8E2C5C' },
        { id: 'grand', name: 'Grand Hamper', price: 450, capacity: 8, desc: 'Go big, with room for everything they love.', color: '#D2A24C' },
      ],
      wraps: [
        { id: 'blush-satin', name: 'Blush Satin', price: 0, color: '#F2A7B5' },
        { id: 'midnight-velvet', name: 'Midnight Velvet', price: 80, color: '#2E2A4F' },
        { id: 'kraft-twine', name: 'Kraft & Twine', price: 0, color: '#C9A27A' },
        { id: 'sage-linen', name: 'Sage Linen', price: 50, color: '#8FB59A' },
        { id: 'gold-foil', name: 'Gold Foil', price: 120, color: '#D9B25B' },
      ],
      ribbons: [
        { id: 'ivory', name: 'Ivory', color: '#FFF8EE' }, { id: 'gold', name: 'Gold', color: '#E3B65C' },
        { id: 'ruby', name: 'Ruby', color: '#C8283F' }, { id: 'blush', name: 'Blush', color: '#F6B8C6' },
        { id: 'black', name: 'Black', color: '#1F1A24' },
      ],
    },
    admin: { username: DEFAULT_ADMIN.username, password: '', pv: 1, isDefault: true },
  };
}

export const CATEGORIES = [
  { id: 'gift-boxes', name: 'Gift Boxes', blurb: 'Curated & ready to gift', art: 'giftbox', palette: 'berry' },
  { id: 'rings', name: 'Rings', blurb: 'Little circles of love', art: 'ring', palette: 'lilac' },
  { id: 'earrings', name: 'Earrings', blurb: 'Studs, hoops & jhumkas', art: 'earrings', palette: 'peach', variant: 'jhumka' },
  { id: 'necklaces', name: 'Necklaces & Sets', blurb: 'Pendants to bridal sets', art: 'necklace', palette: 'rose' },
  { id: 'bracelets', name: 'Bracelets & Churi', blurb: 'Stack them, gift them', art: 'bracelet', palette: 'butter' },
  { id: 'watches', name: 'Watches', blurb: 'Time well given', art: 'watch', palette: 'sky' },
  { id: 'frames', name: 'Photo Frames', blurb: 'Frame the memories', art: 'frame', palette: 'peach', variant: 'polaroid' },
  { id: 'keychains', name: 'Keychains & Charms', blurb: 'Small but mighty', art: 'keychain', palette: 'mint', variant: 'couple' },
  { id: 'for-him', name: 'For Him', blurb: 'Wallets, scents & more', art: 'wallet', palette: 'cocoa' },
  { id: 'treats', name: 'Chocolates & Treats', blurb: 'Sweet surprises', art: 'chocolate', palette: 'cocoa' },
  { id: 'home', name: 'Candles & Keepsakes', blurb: 'Cosy, lasting gifts', art: 'candle', palette: 'butter' },
  { id: 'flowers', name: 'Forever Flowers', blurb: 'Blooms that never fade', art: 'rose', palette: 'rose' },
];

const HIGHLIGHTS = {
  'gift-boxes': ['Hand-packed in a keepsake box with satin ribbon', 'Free handwritten message card', 'Ready to gift: no wrapping needed'],
  rings: ['Anti-tarnish 18K gold plating', 'Hypoallergenic and nickel-free', 'Arrives in a velvet ring box'],
  earrings: ['Lightweight for all-day comfort', 'Hypoallergenic posts and hooks', 'Comes in a Bliss jewellery pouch'],
  necklaces: ['Adjustable 16–18" chain', 'Anti-tarnish plating', 'Gift-ready velvet box'],
  bracelets: ['Comfortable, skin-friendly finish', 'Mix and stack with other pieces', 'Gift pouch included'],
  watches: ['Japanese quartz movement', 'Splash resistant', '6-month warranty'],
  frames: ['Easel back for desk or wall', 'Shatter-safe front', 'Gift wrap available'],
  keychains: ['Sturdy steel split ring', 'Scratch-resistant finish', 'Perfect add-on for any gift box'],
  'for-him': ['Premium materials built to last', 'Gift box included', 'Easy 7-day exchange'],
  treats: ['Freshly sourced; best-before date on pack', 'Contains nuts and dairy', 'Store in a cool, dry place'],
  home: ['Thoughtfully made in small batches', 'Gift-ready packaging', 'A cosy keepsake they will use daily'],
  flowers: ['Lasts a year or more with no water', 'Wrapped with ribbon and a card', 'Hand-arranged in Dhaka'],
};

const S = ['6', '7', '8', '9'];
// [name, category, price, compare, art, palette, variant, tags, gender, qty | 'out', extras]
const RAW = [
  ['Blush Bloom Gift Box', 'gift-boxes', 1690, 2200, 'giftbox', 'rose', '', 'birthday anniversary mothers-day ready-to-gift', 'her', 14, { featured: 1, desc: 'A soft-pink keepsake box filled with a gold heart pendant, a vanilla soy candle, Belgian truffles and a handwritten card. Everything she loves, beautifully wrapped.' }],
  ['Midnight Romance Box', 'gift-boxes', 1890, 2400, 'giftbox', 'night', '', 'anniversary valentines ready-to-gift', 'her', 3, { desc: 'A navy velvet box with a crystal heart necklace, rose chocolates and a forever rose, made for the moments that matter most.' }],
  ['Golden Hour Hamper', 'gift-boxes', 2490, 3200, 'giftbox', 'gold', 'accent', 'eid wedding corporate ready-to-gift', 'unisex', 20, { featured: 1, desc: 'Our most generous hamper: premium dates and nuts, artisan chocolates, a scented candle and a brass keepsake, finished with a gold satin bow.' }],
  ['Little Joys Box', 'gift-boxes', 990, 1290, 'hatbox', 'peach', '', 'birthday just-because ready-to-gift', 'her', 25, { desc: 'A round hatbox of small happy things: star studs, a mini candle and macarons. Proof that the best surprises come in little packages.' }],
  ["Gentleman's Edit Box", 'gift-boxes', 2190, 2800, 'giftbox', 'cocoa', '', 'birthday anniversary ready-to-gift', 'him', 9, { desc: 'A leather wallet, a crescent keychain and a bottle of Oud Noir in a matte cocoa box. Thoughtful, polished and very him.' }],
  ['Lavender Dreams Box', 'gift-boxes', 1490, 1990, 'hatbox', 'lilac', '', 'birthday mothers-day ready-to-gift', 'her', 'out', { desc: 'Calming lavender tones: a moonstone ring, a lavender candle and a silk scrunchie in a lilac hatbox.' }],
  ['Eid Mubarak Treat Box', 'gift-boxes', 1290, 1600, 'giftbox', 'sage', '', 'eid corporate ready-to-gift', 'unisex', 30, { desc: 'Share the Eid joy with Medjool dates, roasted nuts and chocolate truffles in a sage-green box with a gold ribbon.' }],
  ['New Baby Welcome Box', 'gift-boxes', 1790, 2100, 'hatbox', 'sky', '', 'new-baby ready-to-gift', 'kids', 4, { desc: 'Welcome the little one with a soft teddy, a keepsake photo frame and a handwritten note for the new parents.' }],
  ['Celeste Solitaire Ring', 'rings', 590, 850, 'ring', 'rose', '', 'anniversary valentines', 'her', 12, { featured: 1, options: [{ name: 'Size', values: S }], desc: 'A single rose-cut crystal held in a delicate gold band. Simple, timeless and made to be worn every day.' }],
  ['Petal Halo Ring', 'rings', 520, 790, 'ring', 'lilac', '', 'birthday just-because', 'her', 2, { boxable: 1, desc: 'An adjustable band with a lilac crystal framed by tiny petals. One size fits most.' }],
  ['Emerald Whisper Ring', 'rings', 650, 900, 'ring', 'sage', '', 'wedding anniversary', 'her', 'out', { options: [{ name: 'Size', values: S }], desc: 'A green emerald-cut stone on a slim gold band: elegant enough for weddings, easy enough for weekends.' }],
  ['Twin Hearts Couple Rings', 'rings', 990, 1400, 'ring', 'berry', '', 'anniversary valentines', 'unisex', 10, { options: [{ name: 'Her size', values: ['5', '6', '7'] }, { name: 'His size', values: ['8', '9', '10'] }], desc: 'A matching pair for the two of you: his and hers bands that come together to form a heart.' }],
  ['Moonstone Dream Ring', 'rings', 480, 690, 'ring', 'sky', 'pearl', 'just-because birthday', 'her', 18, { boxable: 1, desc: 'A glowing moonstone cabochon on an adjustable band. Said to bring calm and sweet dreams.' }],
  ['Pearl Drop Earrings', 'earrings', 450, 650, 'earrings', 'pearl', '', 'birthday wedding mothers-day', 'her', 22, { boxable: 1, desc: 'Lustrous pearl drops on gold hooks, the classic finishing touch for every outfit.' }],
  ['Rose Gold Hoops', 'earrings', 390, 550, 'earrings', 'peach', 'hoop', 'just-because birthday', 'her', 30, { boxable: 1, desc: 'Lightweight everyday hoops in a warm rose-gold finish with a tiny crystal accent.' }],
  ['Crystal Tassel Jhumka', 'earrings', 690, 950, 'earrings', 'gold', 'jhumka', 'eid wedding', 'her', 4, { boxable: 1, desc: 'Traditional jhumka bells with crystal tassels that catch the light with every turn.' }],
  ['Tiny Star Studs', 'earrings', 290, 390, 'earrings', 'lilac', 'stud', 'kids just-because birthday', 'her', 40, { boxable: 1, desc: 'Dainty star studs for little stars and grown-up ones too. Hypoallergenic and feather-light.' }],
  ['Forever Heart Pendant', 'necklaces', 790, 1100, 'necklace', 'rose', '', 'anniversary valentines birthday', 'her', 15, { featured: 1, boxable: 1, desc: 'A glossy enamel heart on a fine gold chain. Say "I love you" without saying a word.' }],
  ['Initial Charm Necklace', 'necklaces', 690, 900, 'necklace', 'gold', 'initial', 'birthday just-because', 'her', 50, { options: [{ name: 'Letter', values: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') }], desc: 'Her initial on a polished gold coin. Personal, meaningful and perfect for layering.' }],
  ['Bridal Kundan Set', 'necklaces', 2890, 3900, 'necklace', 'gold', 'set', 'wedding eid', 'her', 3, { desc: 'A statement kundan necklace with ruby-red stones and matching drops, made for the big day.' }],
  ['Evil Eye Chain', 'necklaces', 490, 650, 'necklace', 'sky', 'eye', 'just-because graduation', 'unisex', 24, { boxable: 1, desc: 'A blue evil-eye charm on a sleek chain to keep good vibes close.' }],
  ['Velvet Rose Churi Set', 'bracelets', 450, 690, 'bracelet', 'rose', '', 'eid wedding', 'her', 20, { options: [{ name: 'Size', values: ['2.4', '2.6', '2.8'] }], desc: 'A stack of velvet and gold churis in rose tones. Wear them together or mix with your favourites.' }],
  ['Charm Story Bracelet', 'bracelets', 590, 790, 'bracelet', 'lilac', 'charm', 'birthday just-because', 'her', 12, { boxable: 1, desc: 'A layered bracelet with a tiny heart charm. Add it to her story.' }],
  ['Golden Kada Pair', 'bracelets', 890, 1200, 'bracelet', 'gold', '', 'wedding eid', 'her', 'out', { options: [{ name: 'Size', values: ['2.4', '2.6', '2.8'] }], desc: 'Classic gold-finish kadas with fine engraving, sold as a pair.' }],
  ['Leather Wrap Bracelet', 'bracelets', 490, 690, 'bracelet', 'cocoa', 'leather', 'just-because birthday', 'him', 16, { boxable: 1, desc: 'Braided genuine leather with a magnetic steel clasp. Rugged, simple and very his style.' }],
  ['Aurora Rose Gold Watch', 'watches', 1890, 2500, 'watch', 'rose', '', 'birthday anniversary', 'her', 8, { featured: 1, desc: 'A rose-gold case with a pearl-white dial and blush leather strap. Elegant from desk to dinner.' }],
  ['Classic Navy Chrono', 'watches', 2290, 2990, 'watch', 'night', 'dark', 'birthday graduation anniversary', 'him', 2, { desc: 'A navy dial, gold accents and a leather strap. A watch he will wear for years.' }],
  ['Minimal Mesh Watch', 'watches', 1590, 2100, 'watch', 'sky', 'mesh', 'graduation just-because', 'unisex', 11, { desc: 'An ultra-slim case on a silver mesh strap. Clean, modern and goes with everything.' }],
  ['Petite Pearl Watch', 'watches', 1390, 1800, 'watch', 'butter', '', 'mothers-day birthday', 'her', 7, { desc: 'A petite gold watch with a pearl-white dial and a butter-yellow strap.' }],
  ['Our Story Wooden Frame', 'frames', 690, 900, 'frame', 'cocoa', '', 'anniversary wedding', 'unisex', 25, { boxable: 1, desc: 'A warm walnut-tone frame for your favourite photo together. Holds a 4×6" print.' }],
  ['Heart Collage Frame', 'frames', 990, 1290, 'frame', 'rose', 'collage', 'valentines anniversary birthday', 'her', 14, { desc: 'Four little windows for four big memories, framed in blush pink.' }],
  ['Engraved Glass Frame', 'frames', 1290, 1600, 'frame', 'sky', '', 'wedding graduation anniversary', 'unisex', 5, { options: [{ name: 'Size', values: ['4×6"', '5×7"'] }], desc: 'A crystal-clear glass frame we engrave with names and a date. Add the engraving text in your gift message at checkout.' }],
  ['Mini Polaroid Frame Set', 'frames', 590, 790, 'frame', 'peach', 'polaroid', 'birthday just-because', 'unisex', 30, { boxable: 1, desc: 'Three mini instant-photo frames with washi tape, perfect for a wall of memories.' }],
  ['Crescent Moon Keychain', 'keychains', 250, 350, 'keychain', 'gold', 'moon', 'eid just-because', 'unisex', 60, { boxable: 1, desc: 'A polished crescent moon for their keys. A sweet little Eid gift.' }],
  ['Couple Hearts Keyrings', 'keychains', 350, 490, 'keychain', 'berry', 'couple', 'valentines anniversary', 'unisex', 35, { boxable: 1, desc: 'Two hearts, two keyrings: one for you, one for them.' }],
  ['Football Fan Keychain', 'keychains', 290, 400, 'keychain', 'sky', 'ball', 'just-because birthday', 'him', 'out', { boxable: 1, desc: 'For the football lover: a mini ball charm on a sturdy steel ring.' }],
  ['Personalised Name Tag', 'keychains', 390, 520, 'keychain', 'mint', '', 'birthday just-because corporate', 'unisex', 40, { boxable: 1, desc: 'A smooth enamel tag we engrave with any name (up to 10 letters). Add the name in your gift message.' }],
  ['Heritage Leather Wallet', 'for-him', 890, 1200, 'wallet', 'cocoa', '', 'birthday eid anniversary', 'him', 18, { featured: 1, boxable: 1, desc: 'A full-grain leather bifold with six card slots and contrast stitching. Ages beautifully.' }],
  ['Oud Noir Perfume 50ml', 'for-him', 1490, 1900, 'perfume', 'night', '', 'eid anniversary birthday', 'him', 3, { desc: 'Smoky oud, amber and a hint of rose. A long-lasting signature scent.' }],
  ['Aviator Sunglasses', 'for-him', 790, 1100, 'sunglasses', 'night', '', 'graduation just-because', 'him', 13, { desc: 'Classic aviators with UV400 lenses and a lightweight gold-tone frame. Case included.' }],
  ['Card Holder & Pen Set', 'for-him', 990, 1290, 'wallet', 'night', 'cardholder', 'corporate graduation', 'him', 22, { desc: 'A slim card holder and a weighted metal pen in a gift box. A smart pick for colleagues and clients.' }],
  ['Belgian Truffle Box (9 pcs)', 'treats', 790, 950, 'chocolate', 'cocoa', '', 'birthday valentines just-because', 'unisex', 26, { boxable: 1, desc: 'Nine handmade truffles: salted caramel, hazelnut praline, dark ganache and more.' }],
  ['Rose Heart Chocolates', 'treats', 590, 750, 'chocolate', 'rose', 'heart', 'valentines anniversary', 'her', 4, { boxable: 1, desc: 'A heart-shaped box of milk and dark chocolates. Sweet in every sense.' }],
  ['Dates & Nuts Platter', 'treats', 1190, 1450, 'chocolate', 'gold', 'dates', 'eid corporate', 'unisex', 15, { desc: 'Premium Medjool dates with almonds, cashews and pistachios on a reusable golden platter.' }],
  ['Macaron Rainbow (6 pcs)', 'treats', 490, 600, 'chocolate', 'blush', 'macaron', 'birthday kids just-because', 'unisex', 'out', { boxable: 1, desc: 'Six French macarons in rainbow colours: rose, lavender, pistachio, lemon and more.' }],
  ['Vanilla Bliss Soy Candle', 'home', 550, 700, 'candle', 'butter', '', 'just-because mothers-day birthday', 'her', 30, { boxable: 1, desc: 'Our signature scent: warm vanilla, tonka and a touch of sandalwood, hand-poured in small batches.' }],
  ['Rose Garden Candle Duo', 'home', 890, 1100, 'candle', 'rose', 'duo', 'anniversary mothers-day', 'her', 12, { boxable: 1, desc: 'Two rose-scented candles in blush jars: one for the bedroom, one for the living room.' }],
  ['Mini Succulent Pot', 'home', 390, 500, 'plant', 'peach', '', 'just-because graduation corporate', 'unisex', 20, { boxable: 1, desc: 'A lifelike succulent in a terracotta-tone pot. Zero watering, all the green.' }],
  ['Hug Me Teddy Bear', 'home', 790, 990, 'teddy', 'cocoa', '', 'valentines birthday kids new-baby', 'unisex', 17, { featured: 1, boxable: 1, desc: 'A super-soft 30 cm teddy holding a red heart. Comes with a tag you can write on.' }],
  ['Love Notes Mug', 'home', 450, 590, 'mug', 'coral', '', 'birthday just-because valentines', 'unisex', 28, { boxable: 1, desc: 'A glossy ceramic mug with a hand-drawn heart, for the first coffee of every day.' }],
  ['Forever Rose in Glass Dome', 'flowers', 1490, 1990, 'rose', 'red', 'dome', 'anniversary valentines mothers-day', 'her', 3, { featured: 1, desc: 'A preserved rose under a glass dome that stays beautiful for years: no water, no wilting.' }],
  ['Blush Peony Bouquet', 'flowers', 1290, 1600, 'rose', 'blush', 'kraft', 'birthday mothers-day', 'her', 9, { desc: 'Lush silk peonies wrapped in kraft paper with a satin bow. Looks fresh forever.' }],
  ['Sunshine Tulip Bunch', 'flowers', 990, 1290, 'rose', 'butter', 'tulip', 'graduation just-because birthday', 'her', 14, { desc: 'A bright bunch of everlasting tulips to make any day sunnier.' }],
  ['Red Rose Classic (12 stems)', 'flowers', 1690, 2100, 'rose', 'red', '', 'valentines anniversary', 'her', 10, { desc: 'Twelve velvet-touch red roses, wrapped and tied with love. The classic, for good reason.' }],
];

export const PRODUCTS = RAW.map(([name, cat, price, compare, art, palette, variant, tags, gender, stock, x]) => ({
  name, slug: slugify(name), cat, price, compare, art, palette, variant, tags: tags.split(' '), gender, stock, ...x,
}));

/** Writes demo illustrations into public/img (skips files that already exist unless force). */
export function writeArt(publicDir, force = false) {
  const dirP = path.join(publicDir, 'img', 'p'), dirC = path.join(publicDir, 'img', 'c');
  fs.mkdirSync(dirP, { recursive: true }); fs.mkdirSync(dirC, { recursive: true });
  let n = 0;
  const write = (file, make) => { if (force || !fs.existsSync(file)) { fs.writeFileSync(file, make()); n++; } };
  for (const d of PRODUCTS) {
    write(path.join(dirP, `${d.slug}.svg`), () => renderArt(d.art, d.palette, d.slug, { variant: d.variant }));
    write(path.join(dirP, `${d.slug}-detail.svg`), () => renderArt(d.art, d.palette, d.slug + ':d', { variant: d.variant, zoom: true }));
  }
  for (const c of CATEGORIES) write(path.join(dirC, `${c.id}.svg`), () => renderArt(c.art, c.palette, c.id, { variant: c.variant, square: true }));
  write(path.join(publicDir, 'img', 'hero.svg'), renderHero);
  write(path.join(publicDir, 'img', 'box.svg'), () => renderArt('giftbox', 'berry', 'custom-box'));
  write(path.join(publicDir, 'img', 'placeholder.svg'), renderPlaceholder);
  return n;
}

const NAMES = ['Nusrat Jahan', 'Tanvir Ahmed', 'Farhana Akter', 'Rafiul Islam', 'Sadia Rahman', 'Arif Hossain', 'Mehjabin Chowdhury', 'Shuvo Das', 'Tasnim Ferdous', 'Imran Kabir', 'Lamia Haque', 'Fahim Shahriar', 'Anika Tabassum', 'Rakibul Hasan', 'Sumaiya Islam', 'Zarif Mahmud', 'Nabila Karim', 'Ayesha Siddiqua', 'Mahir Faisal', 'Ritu Saha'];
const AREAS = [['House 14, Road 7', 'Dhanmondi', 'Dhaka', 'inside'], ['Flat 5B, Lake View', 'Gulshan 1', 'Dhaka', 'inside'], ['House 3, Sector 11', 'Uttara', 'Dhaka', 'inside'], ['Road 2, Block C', 'Bashundhara R/A', 'Dhaka', 'inside'], ['24 Chashara', 'Narayanganj Sadar', 'Narayanganj', 'inside'], ['GEC Circle', 'Khulshi', 'Chattogram', 'outside'], ['Zindabazar', 'Sylhet Sadar', 'Sylhet', 'outside'], ['Shaheb Bazar', 'Boalia', 'Rajshahi', 'outside']];
const REVIEWS = [
  [5, 'Absolutely loved it! The packaging was so pretty and it arrived on time.'],
  [5, 'My wife was so happy. Quality is much better than I expected for the price.'],
  [5, 'Beautiful and exactly like the pictures. Will order again for sure!'],
  [4, 'Very nice gift. Delivery took a day longer than I hoped, but worth it.'],
  [5, 'The handwritten card was such a sweet touch. Highly recommended.'],
  [4, 'Good quality and lovely wrapping. Slightly smaller than I imagined.'],
  [5, 'Ordered for my sister’s birthday and she adored it. Thank you Bliss!'],
  [5, 'Express delivery came in under 4 hours. Saved my anniversary!'],
  [3, 'Product is nice, but the box had a small dent. Customer service was helpful.'],
  [5, 'Elegant, classy and well packed. Five stars.'],
  [4, 'Really pretty. Colour is a bit lighter in person but still gorgeous.'],
  [5, 'Third time ordering. Consistent quality every time.'],
];

export async function seedData() {
  const rnd = prng('bliss-demo-v1');
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const now = Date.now(), DAY = 86_400_000;
  const settings = defaultSettings();
  settings.admin.password = await hashPassword(process.env.ADMIN_PASSWORD || DEFAULT_ADMIN.password);
  settings.admin.isDefault = !process.env.ADMIN_PASSWORD;

  const categories = CATEGORIES.map((c, i) => ({
    id: c.id, slug: c.id, name: c.name, blurb: c.blurb, art: c.art, image: `/img/c/${c.id}.svg`,
    color: PALETTES[c.palette].bg[1], sort: i + 1, showHome: true,
  }));

  const products = PRODUCTS.map((d, i) => {
    const qty = d.stock === 'out' ? 0 : d.stock;
    return {
      id: `p_${String(i + 1).padStart(3, '0')}${Math.floor(rnd() * 1e6).toString(36)}`,
      slug: d.slug, name: d.name, cat: d.cat, price: d.price, compare: d.compare,
      desc: d.desc, highlights: HIGHLIGHTS[d.cat] || [],
      images: [`/img/p/${d.slug}.svg`, `/img/p/${d.slug}-detail.svg`],
      status: qty === 0 ? 'out' : qty <= 5 ? 'limited' : 'in', qty, lowStock: null, autoStock: true,
      tags: d.tags, gender: d.gender, options: d.options || [],
      featured: !!d.featured, boxable: !!d.boxable && !(d.options || []).length, active: true, keywords: '',
      sold: Math.floor(20 + rnd() * 380 + (d.featured ? 300 : 0)),
      created: now - Math.floor(rnd() * 110 + (i % 9 === 0 ? 0 : 6)) * DAY, updated: now,
      rating: 0, reviewCount: 0, demo: true,
    };
  });

  const reviews = [];
  for (const p of products) {
    const n = Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const [rating, text] = pick(REVIEWS);
      reviews.push({ id: `r_${p.id.slice(2)}${k}`, pid: p.id, name: pick(NAMES).split(' ')[0] + ' ' + pick(NAMES).split(' ')[1][0] + '.', rating, text, created: now - Math.floor(rnd() * 60) * DAY, approved: true, demo: true });
    }
  }
  reviews.push({ id: 'r_pending1', pid: products[0].id, name: 'Mithila R.', rating: 5, text: 'Got this for my best friend and she cried happy tears. The box is gorgeous!', created: now - 3600_000, approved: false, demo: true });

  const orders = [];
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const inStock = products.filter((p) => p.status !== 'out');
  for (let i = 0; i < 38; i++) {
    const daysAgo = Math.floor(Math.pow(rnd(), 1.4) * 29);
    const created = now - daysAgo * DAY - Math.floor(rnd() * 10) * 3600_000;
    const lines = [];
    const nItems = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < nItems; k++) {
      const p = pick(inStock);
      if (lines.some((l) => l.pid === p.id)) continue;
      const options = Object.fromEntries((p.options || []).map((o) => [o.name, pick(o.values)]));
      lines.push({ kind: 'product', pid: p.id, name: p.name, slug: p.slug, img: p.images[0], price: p.price, qty: rnd() < 0.85 ? 1 : 2, options });
    }
    const [line, area, city, zone] = pick(AREAS);
    const express = zone === 'inside' && rnd() < 0.25;
    const wrap = rnd() < 0.4;
    const t = computeTotals(lines, { settings, zone, express, giftWrap: wrap });
    const status = daysAgo > 6 ? (rnd() < 0.08 ? 'cancelled' : 'delivered') : daysAgo > 3 ? pick(['shipped', 'delivered', 'delivered']) : daysAgo > 1 ? pick(['confirmed', 'processing', 'shipped']) : pick(['pending', 'pending', 'confirmed']);
    const flow = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
    const timeline = status === 'cancelled'
      ? [{ status: 'pending', at: created, note: '' }, { status: 'cancelled', at: created + 7200_000, note: 'Customer requested cancellation' }]
      : flow.slice(0, flow.indexOf(status) + 1).map((s, j) => ({ status: s, at: created + j * 9 * 3600_000, note: '' }));
    const name = pick(NAMES);
    const pm = rnd() < 0.7 ? 'cod' : rnd() < 0.7 ? 'bkash' : 'nagad';
    let id = 'BL'; for (let j = 0; j < 6; j++) id += A[Math.floor(rnd() * A.length)];
    orders.push({
      id, created, updated: created, userId: null,
      customer: { name, phone: '01' + pick(['7', '8', '9', '5', '3']) + String(Math.floor(10_000_000 + rnd() * 89_999_999)), email: '' },
      recipient: rnd() < 0.3 ? { name: pick(NAMES), phone: '017' + String(Math.floor(10_000_000 + rnd() * 89_999_999)) } : null,
      address: { line, area, city, zone }, delivery: { method: express ? 'express' : 'standard', date: null, slot: null },
      gift: { wrap, message: wrap ? 'Happy birthday! With love ❤' : '', hidePrice: wrap },
      items: lines, totals: { count: t.count, subtotal: t.subtotal, discount: t.discount, discountLabel: t.discountLabel, delivery: t.delivery, wrap: t.wrap, total: t.total },
      coupon: null, payment: { method: pm, trxId: pm === 'cod' ? '' : 'TX' + Math.floor(rnd() * 1e9).toString(36).toUpperCase(), status: status === 'delivered' || pm !== 'cod' ? 'paid' : 'unpaid' },
      status, timeline, note: '', adminNote: '', demo: true,
    });
  }
  orders.sort((a, b) => a.created - b.created);

  return {
    settings, categories, products, orders, users: [], reviews,
    coupons: [
      { code: 'WELCOME5', type: 'percent', value: 5, minSubtotal: 0, maxDiscount: 300, expires: null, maxUses: null, used: 0, active: true, created: now },
      { code: 'BLISS10', type: 'percent', value: 10, minSubtotal: 1500, maxDiscount: 400, expires: null, maxUses: null, used: 0, active: true, created: now },
      { code: 'GIFT200', type: 'fixed', value: 200, minSubtotal: 2000, maxDiscount: 0, expires: null, maxUses: 500, used: 0, active: true, created: now },
    ],
    messages: [
      { id: 'm_demo1', type: 'corporate', name: 'Shafiq Rahman', phone: '01711000000', email: 'hr@example.com', subject: 'Corporate Eid gifts', message: 'We need around 120 Eid gift boxes for our employees, delivered to our Gulshan office. Can you share options and pricing?', created: now - 2 * DAY, read: false, meta: { company: 'Example Textiles Ltd.', quantity: '120', budget: '৳1,500 per box', date: '' }, demo: true },
      { id: 'm_demo2', type: 'support', name: 'Ritu Saha', phone: '01819000000', email: '', subject: 'Engraving question', message: 'Can you engrave two names and a date on the glass frame? How long does it take?', created: now - 5 * 3600_000, read: false, meta: {}, demo: true },
    ],
    subscribers: [],
  };
}
