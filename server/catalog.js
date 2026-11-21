// BLISS's own products (not demo data). They are added once to every shop database by the
// schema-3 upgrade in db.js, so they also appear on hosts that start from a fresh database (Vercel).
// After that they are ordinary products: edit, hide or delete them in the dashboard.

export const STARTER_CATEGORIES = [
  { name: 'Bouquets', slug: 'bouquets', blurb: 'Hand-wrapped rose bouquets for every moment', art: 'rose', image: '/img/bouquets/category-bouquets.jpg', color: '#FADDE5', sort: 0 },
  { name: 'Attar', slug: 'attar', blurb: 'Alcohol-free perfume oils', art: 'perfume', image: '/img/c/attar.svg', color: '#FCF2DF', sort: 0 },
];

const bouquet = (sku, name, price, file, desc, highlights, tags, extra = {}) => ({
  sku, name, category: 'Bouquets', price, images: [`/img/bouquets/${file}.jpg`], desc, highlights,
  tags, gender: 'her', status: 'in', active: true, boxable: false, ...extra,
});
const WRAP = 'Hand-wrapped and finished with a satin bow';
const NOTE = 'Free handwritten card message at checkout';

export const STARTER_PRODUCTS = [
  bouquet('BQ-001', 'Crimson Rose Bouquet', 200, 'crimson-rose-bouquet',
    'A single red rose framed by baby’s breath and silver mesh, wrapped in black paper with gold edges and tied with a red satin bow.',
    [WRAP, 'Black & gold wrapping', NOTE], ['birthday', 'anniversary', 'valentines', 'just-because']),
  bouquet('BQ-002', 'Silver Rose Bouquet', 230, 'silver-rose-bouquet',
    'A silver-grey rose in black and white striped wrapping with a black satin bow. Elegant and a little unexpected.',
    [WRAP, 'Black & white wrapping', NOTE], ['birthday', 'anniversary', 'just-because']),
  bouquet('BQ-003', 'Silver Rose Anniversary Bouquet', 200, 'silver-rose-anniversary-bouquet',
    'A silver-grey rose with baby’s breath in black and white wrapping, a black satin bow and a message card on top (shown: “1st Anniversary”).',
    [WRAP, 'Message card included: write your text in the order note', NOTE], ['anniversary', 'birthday', 'valentines']),
  bouquet('BQ-004', 'Red Pearl Rose Bouquet', 230, 'red-pearl-rose-bouquet',
    'A red rose in red mesh, wrapped in soft white with a pearl string trim and a red satin bow.',
    [WRAP, 'Pearl string trim', NOTE], ['birthday', 'anniversary', 'valentines', 'just-because']),
  bouquet('BQ-005', 'Blue Pearl Rose Bouquet', 230, 'blue-pearl-rose-bouquet',
    'A royal blue rose in white wrapping with pearl details and a blue satin bow.',
    [WRAP, 'Pearl details', NOTE], ['birthday', 'anniversary', 'just-because']),
  bouquet('BQ-006', 'Lavender Pearl Rose Bouquet', 230, 'lavender-pearl-rose-bouquet',
    'A lavender rose with pearl details in lilac and white wrapping, tied with a lavender satin bow.',
    [WRAP, 'Pearl details', NOTE], ['birthday', 'anniversary', 'just-because']),
  bouquet('BQ-007', 'Black Pearl Rose Bouquet', 250, 'black-pearl-rose-bouquet',
    'A black rose with silver sparkle and a pearl string, in black and white wrapping with a black satin bow. Bold and dramatic.',
    [WRAP, 'Pearl string trim', NOTE], ['birthday', 'anniversary', 'just-because']),
  bouquet('BQ-008', 'Four Red Roses Birthday Bouquet', 500, 'four-red-roses-birthday-bouquet',
    'Four red roses surrounded by baby’s breath, with a satin name ribbon across the middle (shown: “Happy Birthday Tasnim”), black and gold wrapping, a “With Love” tag and a red satin bow.',
    ['Personalised name ribbon: write the text in the order note', 'Black & gold wrapping', NOTE], ['birthday', 'anniversary', 'valentines'], { featured: true }),
  bouquet('BQ-009', 'Pink Roses Butterfly Bouquet', 600, 'pink-roses-butterfly-bouquet',
    'Four pink roses with baby’s breath, a satin name ribbon (shown: “Happy Birthday Fina”), a golden butterfly, white and gold wrapping and a pink satin bow.',
    ['Personalised name ribbon: write the text in the order note', 'Golden butterfly accent', NOTE], ['birthday', 'anniversary', 'valentines'], { featured: true }),
];

// Attar: price and photos are added later, so they start hidden (a product needs a price to be shown).
const ATTAR_DESC = [
  'Attar – A Touch of Timeless Elegance',
  'Attar is a luxurious, alcohol-free fragrance crafted from rich natural aromas and traditional perfume oils. With its captivating scent, long-lasting freshness, and elegant fragrance notes, attar adds a touch of sophistication to every moment. Perfect for daily wear, special occasions, and gifting, it leaves a beautiful impression wherever you go. ✨',
].join('\n\n');
[
  'Aroosha', 'Golden Dust', 'Pink Chiffon', 'Cool Water', 'Soft', 'Joopy', 'Arabiyan Oud', 'Rasha',
  'Mukhallat Madina', 'Mukhallat al Oud', 'Amir Al Oud', 'Paris Hilton', 'Blue the Chanel', 'Dunhil Desire',
  'Ehasas Al Arabyan', 'Vampire Blood', 'Marshmallow', 'Candy Cloud',
].forEach((name, i) => STARTER_PRODUCTS.push({
  sku: 'AT-' + String(i + 1).padStart(3, '0'), name, category: 'Attar', price: 0, images: ['/img/p/attar.svg'],
  desc: ATTAR_DESC, highlights: [], tags: [], gender: 'unisex', status: 'in', active: false, keywords: 'attar perfume oil itr',
}));
