// Procedural flat illustrations for demo products (each SVG is ~2–4 KB, sharp on any screen).
// Replace them anytime by uploading real photos from the admin dashboard.

export const PALETTES = {
  rose:   { bg: ['#FDE6EB', '#F8CCD6'], main: '#E8738A', deep: '#B84A62', accent: '#F9C3CE', metal: '#E3B65C', metalDeep: '#B98A33' },
  blush:  { bg: ['#FFF0F1', '#FAD9DE'], main: '#F2A7B5', deep: '#C76E80', accent: '#FFFFFF', metal: '#E3B65C', metalDeep: '#B98A33' },
  lilac:  { bg: ['#F0EAFB', '#DDD0F4'], main: '#9B7FD1', deep: '#6C52A3', accent: '#D7CAF4', metal: '#E3B65C', metalDeep: '#B98A33' },
  peach:  { bg: ['#FFEEE2', '#FFD7BF'], main: '#F08A5D', deep: '#C2603A', accent: '#FFD2B9', metal: '#E3B65C', metalDeep: '#B98A33' },
  sage:   { bg: ['#E8F2EA', '#D0E4D5'], main: '#6FA383', deep: '#4A7A5D', accent: '#BFDCC7', metal: '#E3B65C', metalDeep: '#B98A33' },
  sky:    { bg: ['#E7F0FA', '#CDDDF1'], main: '#5B8DC9', deep: '#3D6699', accent: '#B9D1EE', metal: '#D9DEE6', metalDeep: '#9AA4B4' },
  butter: { bg: ['#FFF6DD', '#FBE7B1'], main: '#E9BC4C', deep: '#B88B1E', accent: '#FBE3A0', metal: '#E3B65C', metalDeep: '#B98A33' },
  berry:  { bg: ['#F8E1EB', '#ECC3D6'], main: '#8E2C5C', deep: '#5E1A3C', accent: '#E6A6C4', metal: '#E3B65C', metalDeep: '#B98A33' },
  mint:   { bg: ['#E4F5F2', '#C8E9E3'], main: '#3FA394', deep: '#2A7368', accent: '#A6DDD3', metal: '#D9DEE6', metalDeep: '#9AA4B4' },
  cocoa:  { bg: ['#F6EAE1', '#E8D2C2'], main: '#8A5638', deep: '#5A3423', accent: '#D7B08F', metal: '#E3B65C', metalDeep: '#B98A33' },
  night:  { bg: ['#E9E7F3', '#D1CDE6'], main: '#2E2A4F', deep: '#1B1833', accent: '#8D86C2', metal: '#E3B65C', metalDeep: '#B98A33' },
  gold:   { bg: ['#FCF2DF', '#F3DEB5'], main: '#D2A24C', deep: '#94701F', accent: '#F6E2B0', metal: '#E3B65C', metalDeep: '#A87C26' },
  coral:  { bg: ['#FFE7E2', '#FFCDC3'], main: '#EE6A5B', deep: '#BF4638', accent: '#FFC1B7', metal: '#E3B65C', metalDeep: '#B98A33' },
  pearl:  { bg: ['#EADBCB', '#D3BBA2'], main: '#FFFDF8', deep: '#A68866', accent: '#F4E9D9', metal: '#D9A94E', metalDeep: '#A87C26' },
  red:    { bg: ['#FFE9EC', '#FBCBD2'], main: '#D8344B', deep: '#9E1F33', accent: '#F7B9C1', metal: '#E3B65C', metalDeep: '#B98A33' },
};

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function prng(seed) { let a = hash(String(seed)); return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r1 = (n) => Math.round(n * 10) / 10;
const sparkle = (x, y, r, fill, op = 1) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${fill}" opacity="${op}"/>`;
const heartPath = (cx, cy, s) => { // heart centred on cx,cy with width ~2s
  const p = (x, y) => `${r1(cx + x * s)} ${r1(cy + y * s)}`;
  return `M${p(0, 0.95)}C${p(-0.7, 0.45)} ${p(-1, 0.1)} ${p(-1, -0.25)}C${p(-1, -0.6)} ${p(-0.72, -0.82)} ${p(-0.45, -0.82)}C${p(-0.22, -0.82)} ${p(-0.06, -0.66)} ${p(0, -0.5)}C${p(0.06, -0.66)} ${p(0.22, -0.82)} ${p(0.45, -0.82)}C${p(0.72, -0.82)} ${p(1, -0.6)} ${p(1, -0.25)}C${p(1, 0.1)} ${p(0.7, 0.45)} ${p(0, 0.95)}Z`;
};

function decor(p, seed, count = 11, w = 800, h = 1000, cy0 = 540, rad = 300) {
  const rnd = prng(seed + ':decor'); let out = ''; const colors = ['#FFFFFF', p.accent, p.metal, p.main];
  for (let i = 0, tries = 0; i < count && tries < 300; tries++) {
    const x = 40 + rnd() * (w - 80), y = 50 + rnd() * (h - 120);
    if (Math.hypot(x - w / 2, (y - cy0) * 0.85) < rad) continue;
    const c = colors[Math.floor(rnd() * colors.length)], k = rnd();
    if (k < 0.38) out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(5 + rnd() * 7)}" fill="${c}" opacity=".85"/>`;
    else if (k < 0.72) out += sparkle(r1(x), r1(y), r1(12 + rnd() * 12), c === p.main ? '#FFFFFF' : c, 0.9);
    else out += `<rect x="${r1(x)}" y="${r1(y)}" width="7" height="20" rx="3.5" fill="${c}" opacity=".8" transform="rotate(${Math.round(rnd() * 180)} ${r1(x)} ${r1(y)})"/>`;
    i++;
  }
  return out;
}

const DEFS = `<linearGradient id="sh" x1="0" x2="1"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient><linearGradient id="fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE9A8"/><stop offset=".6" stop-color="#FFB43F"/><stop offset="1" stop-color="#F0752E"/></linearGradient><linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".55"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>`;

export function frame(p, body, seed, { square = false, zoom = false, shadow = true, extraDefs = '' } = {}) {
  const vb = square ? '0 100 800 800' : zoom ? '150 250 500 625' : '0 0 800 1000';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/></linearGradient><radialGradient id="lt" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>${DEFS}${extraDefs}</defs><rect y="0" width="800" height="1000" fill="url(#bg)"/><circle cx="400" cy="520" r="360" fill="url(#lt)"/>${decor(p, seed)}<g transform="matrix(1.2 0 0 1.2 -80 -108)">${shadow ? `<ellipse cx="400" cy="838" rx="245" ry="30" fill="${p.deep}" opacity=".14"/>` : ''}${body}</g></svg>`;
}

/* ------------------------------------------------------------- art bodies */
function bow(cx, cy, c, deep, s = 1) {
  const t = (x, y) => `${r1(cx + x * s)} ${r1(cy + y * s)}`;
  return `<path d="M${t(0, 0)}C${t(-40, -62)} ${t(-128, -70)} ${t(-114, -14)}C${t(-104, 22)} ${t(-40, 12)} ${t(0, 0)}Z" fill="${c}"/><path d="M${t(0, 0)}C${t(40, -62)} ${t(128, -70)} ${t(114, -14)}C${t(104, 22)} ${t(40, 12)} ${t(0, 0)}Z" fill="${c}"/><path d="M${t(0, 0)}C${t(-30, -36)} ${t(-84, -40)} ${t(-82, -16)}C${t(-80, 4)} ${t(-36, 6)} ${t(0, 0)}Z" fill="${deep}" opacity=".28"/><path d="M${t(0, 0)}C${t(30, -36)} ${t(84, -40)} ${t(82, -16)}C${t(80, 4)} ${t(36, 6)} ${t(0, 0)}Z" fill="${deep}" opacity=".28"/><path d="M${t(-8, 4)}L${t(-56, 76)}L${t(-30, 72)}L${t(-16, 96)}L${t(10, 8)}Z" fill="${c}"/><path d="M${t(8, 4)}L${t(56, 76)}L${t(30, 72)}L${t(16, 96)}L${t(-10, 8)}Z" fill="${c}"/><rect x="${r1(cx - 22 * s)}" y="${r1(cy - 18 * s)}" width="${r1(44 * s)}" height="${r1(36 * s)}" rx="${r1(13 * s)}" fill="${deep}"/>`;
}

const ART = {
  giftbox(p, v) {
    const rib = v === 'accent' ? p.accent : p.metal, ribD = v === 'accent' ? p.deep : p.metalDeep;
    const tag = `<g transform="rotate(14 560 560)"><rect x="530" y="540" width="70" height="96" rx="12" fill="#FFFDF8"/><circle cx="565" cy="560" r="7" fill="${p.bg[1]}"/><path d="${heartPath(565, 600, 17)}" fill="${p.main}"/></g><path d="M430 470C480 480 520 520 548 548" stroke="${ribD}" stroke-width="3" fill="none"/>`;
    return `<rect x="222" y="505" width="356" height="310" rx="18" fill="${p.main}"/><rect x="222" y="505" width="356" height="310" rx="18" fill="url(#sh)"/><rect x="372" y="515" width="56" height="300" fill="${rib}"/><rect x="372" y="515" width="56" height="300" fill="url(#sh)" opacity=".5"/><rect x="198" y="425" width="404" height="96" rx="18" fill="${p.main}"/><rect x="198" y="425" width="404" height="34" rx="17" fill="#fff" opacity=".2"/><rect x="222" y="507" width="356" height="16" fill="${p.deep}" opacity=".22"/><rect x="366" y="425" width="68" height="96" fill="${rib}"/>${bow(400, 425, rib, ribD)}${tag}`;
  },
  hatbox(p) {
    return `<path d="M232 540L232 790A168 46 0 0 0 568 790L568 540Z" fill="${p.main}"/><path d="M232 540L232 790A168 46 0 0 0 568 790L568 540Z" fill="url(#sh)"/><path d="M378 560L378 835L422 835L422 560Z" fill="${p.metal}"/><path d="M214 470L214 538A186 52 0 0 0 586 538L586 470Z" fill="${p.main}"/><path d="M214 470L214 538A186 52 0 0 0 586 538L586 470Z" fill="${p.deep}" opacity=".18"/><ellipse cx="400" cy="470" rx="186" ry="52" fill="${p.main}"/><ellipse cx="400" cy="470" rx="186" ry="52" fill="#fff" opacity=".22"/><path d="M374 520L374 590L426 590L426 520Z" fill="${p.metal}"/>${bow(400, 462, p.metal, p.metalDeep, 0.9)}<circle cx="300" cy="680" r="10" fill="#fff" opacity=".5"/><circle cx="500" cy="700" r="7" fill="#fff" opacity=".5"/><circle cx="470" cy="640" r="5" fill="#fff" opacity=".5"/>`;
  },
  ring(p, v) {
    const gem = v === 'pearl'
      ? `<circle cx="400" cy="420" r="62" fill="${p.main}"/><circle cx="400" cy="420" r="62" fill="url(#gl)"/><circle cx="380" cy="398" r="16" fill="#fff" opacity=".8"/>`
      : `<path d="M318 420L358 368L442 368L482 420Z" fill="${p.main}"/><path d="M318 420L482 420L400 508Z" fill="${p.deep}"/><path d="M368 378L432 378L448 412L352 412Z" fill="#fff" opacity=".3"/><path d="M380 420L400 508L420 420Z" fill="#fff" opacity=".2"/><path d="M318 420L358 368L372 420Z" fill="#fff" opacity=".18"/>`;
    return `<path d="M236 612A164 150 0 0 1 564 612" stroke="${p.metalDeep}" stroke-width="30" fill="none"/><path d="M236 612A164 150 0 0 0 564 612" stroke="${p.metal}" stroke-width="30" fill="none"/><path d="M262 690A164 150 0 0 0 400 762" stroke="#fff" stroke-width="7" fill="none" opacity=".45" stroke-linecap="round"/><path d="M362 478L378 446L422 446L438 478Z" fill="${p.metalDeep}"/>${gem}${sparkle(512, 352, 24, '#fff')}${sparkle(292, 380, 13, '#fff', 0.8)}`;
  },
  earrings(p, v) {
    const one = (cx, rot) => {
      const drop = v === 'stud'
        ? `<path d="M${cx} 400L${cx + 22} 448L${cx + 72} 452L${cx + 34} 486L${cx + 46} 536L${cx} 510L${cx - 46} 536L${cx - 34} 486L${cx - 72} 452L${cx - 22} 448Z" fill="${p.main}" stroke="${p.metal}" stroke-width="6" stroke-linejoin="round"/><circle cx="${cx - 12}" cy="462" r="9" fill="#fff" opacity=".6"/>`
        : v === 'hoop'
          ? `<circle cx="${cx}" cy="530" r="92" fill="none" stroke="${p.metal}" stroke-width="18"/><path d="M${cx - 80} 490A92 92 0 0 1 ${cx - 10} 440" stroke="#fff" stroke-width="5" fill="none" opacity=".55" stroke-linecap="round"/><circle cx="${cx}" cy="622" r="16" fill="${p.main}"/>`
          : v === 'jhumka'
            ? `<line x1="${cx}" y1="378" x2="${cx}" y2="420" stroke="${p.metal}" stroke-width="5"/><circle cx="${cx}" cy="434" r="18" fill="${p.main}" stroke="${p.metal}" stroke-width="5"/><path d="M${cx - 70} 560C${cx - 66} 490 ${cx - 36} 456 ${cx} 456C${cx + 36} 456 ${cx + 66} 490 ${cx + 70} 560Z" fill="${p.metal}"/><path d="M${cx - 70} 560L${cx + 70} 560" stroke="${p.metalDeep}" stroke-width="8"/>${[-56, -28, 0, 28, 56].map((d) => `<line x1="${cx + d}" y1="566" x2="${cx + d}" y2="606" stroke="${p.metal}" stroke-width="4"/><circle cx="${cx + d}" cy="614" r="9" fill="${p.main}"/>`).join('')}<circle cx="${cx}" cy="510" r="14" fill="${p.main}"/>`
            : `<line x1="${cx}" y1="378" x2="${cx}" y2="420" stroke="${p.metal}" stroke-width="5"/><circle cx="${cx}" cy="434" r="16" fill="${p.accent}" stroke="${p.metal}" stroke-width="5"/><path d="M${cx} 458C${cx - 62} 548 ${cx - 56} 644 ${cx} 644C${cx + 56} 644 ${cx + 62} 548 ${cx} 458Z" fill="${p.main}" stroke="${p.metal}" stroke-width="6"/><ellipse cx="${cx - 18}" cy="578" rx="10" ry="27" fill="#fff" opacity=".5" transform="rotate(-14 ${cx - 18} 578)"/>`;
      return `<g transform="rotate(${rot} ${cx} 360)"><path d="M${cx + 30} 352C${cx + 40} 296 ${cx - 24} 286 ${cx - 12} 344" stroke="${p.metal}" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="${cx}" cy="364" r="13" fill="${p.metal}"/>${drop}</g>`;
    };
    return one(300, 4) + one(500, -4) + sparkle(400, 330, 18, '#fff');
  },
  necklace(p, v) {
    const chain = `<path d="M220 250C228 560 330 640 400 650C470 640 572 560 580 250" stroke="${p.metalDeep}" stroke-width="4" fill="none"/><path d="M220 250C228 560 330 640 400 650C470 640 572 560 580 250" stroke="${p.metal}" stroke-width="11" fill="none" stroke-dasharray="1 15" stroke-linecap="round"/>`;
    let pend;
    if (v === 'initial') pend = `<circle cx="400" cy="740" r="66" fill="${p.metal}"/><circle cx="400" cy="740" r="52" fill="none" stroke="${p.metalDeep}" stroke-width="3"/><text x="400" y="768" text-anchor="middle" font-family="Georgia,serif" font-size="78" font-weight="700" fill="${p.metalDeep}">B</text>`;
    else if (v === 'eye') pend = `<circle cx="400" cy="735" r="62" fill="${p.main}" stroke="${p.metal}" stroke-width="7"/><circle cx="400" cy="735" r="40" fill="#fff"/><circle cx="400" cy="735" r="26" fill="${p.accent}"/><circle cx="400" cy="735" r="12" fill="${p.deep}"/><circle cx="392" cy="727" r="5" fill="#fff"/>`;
    else if (v === 'set') {
      let stones = '';
      for (let k = 0; k <= 8; k++) {
        const t = Math.PI * (0.12 + (0.76 * k) / 8), x = r1(400 - 178 * Math.cos(t)), y = r1(330 + 270 * Math.sin(t));
        stones += `<path d="M${x} ${y + 20}C${x - 16} ${y + 46} ${x - 14} ${y + 70} ${x} ${y + 70}C${x + 14} ${y + 70} ${x + 16} ${y + 46} ${x} ${y + 20}Z" fill="${p.accent}" stroke="${p.metal}" stroke-width="4"/><circle cx="${x}" cy="${y}" r="21" fill="${k % 2 ? p.main : '#C9384F'}" stroke="${p.metal}" stroke-width="6"/>`;
      }
      return `<path d="M222 330C230 560 330 600 400 600C470 600 570 560 578 330" stroke="${p.metal}" stroke-width="30" fill="none" stroke-linecap="round"/>${stones}<circle cx="400" cy="660" r="40" fill="#C9384F" stroke="${p.metal}" stroke-width="9"/><path d="M400 704C376 744 380 790 400 790C420 790 424 744 400 704Z" fill="${p.accent}" stroke="${p.metal}" stroke-width="5"/>${sparkle(520, 280, 22, '#fff')}`;
    } else pend = `<path d="${heartPath(400, 742, 72)}" fill="${p.main}" stroke="${p.metal}" stroke-width="8"/><ellipse cx="372" cy="718" rx="12" ry="20" fill="#fff" opacity=".5" transform="rotate(-30 372 718)"/>`;
    return `${chain}<circle cx="400" cy="662" r="11" stroke="${p.metal}" stroke-width="5" fill="none"/>${pend}${sparkle(505, 690, 18, '#fff')}`;
  },
  bracelet(p, v) {
    const cols = v === 'leather' ? [p.main, p.deep, p.metal] : [p.main, p.metal, p.accent];
    const rx = 190, ry = 70; let back = '', front = '';
    [0, 1, 2].forEach((k) => {
      const cy = 500 + k * 64, c = cols[k];
      back += `<path d="M${400 - rx} ${cy}A${rx} ${ry} 0 0 1 ${400 + rx} ${cy}" stroke="${c}" stroke-width="28" fill="none"/><path d="M${400 - rx} ${cy}A${rx} ${ry} 0 0 1 ${400 + rx} ${cy}" stroke="#000" stroke-opacity=".16" stroke-width="28" fill="none"/>`;
      front = `<path d="M${400 - rx} ${cy}A${rx} ${ry} 0 0 0 ${400 + rx} ${cy}" stroke="${c}" stroke-width="28" fill="none"/><path d="M${400 - rx + 30} ${cy + 30}A${rx} ${ry} 0 0 0 ${400 + rx - 30} ${cy + 30}" stroke="#fff" stroke-width="5" stroke-dasharray="0 24" stroke-linecap="round" fill="none" opacity=".85"/>` + front;
    });
    const charm = v === 'charm' ? `<path d="${heartPath(400, 760, 30)}" fill="${p.main}" stroke="${p.metal}" stroke-width="5"/><line x1="400" y1="702" x2="400" y2="738" stroke="${p.metal}" stroke-width="4"/>` : '';
    return back + front + charm + sparkle(560, 420, 20, '#fff');
  },
  watch(p, v) {
    const strap = v === 'mesh' ? p.metal : p.main, dial = v === 'dark' ? p.deep : '#FFFDF8', tick = v === 'dark' ? p.metal : p.deep;
    let ticks = '';
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6, big = i % 3 === 0, r0 = big ? 100 : 108;
      ticks += `<line x1="${r1(400 + r0 * Math.sin(a))}" y1="${r1(520 - r0 * Math.cos(a))}" x2="${r1(400 + 118 * Math.sin(a))}" y2="${r1(520 - 118 * Math.cos(a))}" stroke="${tick}" stroke-width="${big ? 7 : 4}" stroke-linecap="round"/>`;
    }
    const hand = (deg, len, w, c) => { const a = (deg * Math.PI) / 180; return `<line x1="400" y1="520" x2="${r1(400 + len * Math.sin(a))}" y2="${r1(520 - len * Math.cos(a))}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`; };
    const mesh = v === 'mesh' ? `<path d="M352 210H448M352 236H448M352 262H448M352 288H448M352 314H448M352 340H448M352 366H448M352 680H448M352 706H448M352 732H448M352 758H448M352 784H448M352 810H448" stroke="${p.metalDeep}" stroke-width="2" opacity=".5"/>` : `<circle cx="400" cy="720" r="7" fill="#000" opacity=".22"/><circle cx="400" cy="760" r="7" fill="#000" opacity=".22"/><circle cx="400" cy="800" r="7" fill="#000" opacity=".22"/>`;
    return `<rect x="338" y="196" width="124" height="230" rx="30" fill="${strap}"/><rect x="338" y="612" width="124" height="232" rx="30" fill="${strap}"/><rect x="338" y="196" width="124" height="648" rx="30" fill="url(#sh)" opacity=".6"/>${mesh}<rect x="545" y="503" width="24" height="34" rx="7" fill="${p.metalDeep}"/><circle cx="400" cy="520" r="152" fill="${p.metal}"/><circle cx="400" cy="520" r="152" fill="url(#sh)"/><circle cx="400" cy="520" r="128" fill="${dial}"/>${ticks}${hand(-60, 62, 10, tick)}${hand(58, 92, 7, tick)}${hand(200, 104, 3, p.main === dial ? p.metal : '#D94A5E')}<circle cx="400" cy="520" r="11" fill="${p.metal}"/><path d="M300 450A128 128 0 0 1 430 394" stroke="#fff" stroke-width="12" fill="none" opacity=".35" stroke-linecap="round"/>`;
  },
  frame(p, v) {
    if (v === 'polaroid') {
      const card = (x, y, rot, c, k) => `<g transform="rotate(${rot} ${x + 110} ${y + 130})"><rect x="${x}" y="${y}" width="220" height="262" rx="6" fill="#FFFDF8"/><rect x="${x}" y="${y}" width="220" height="262" rx="6" fill="url(#sh)" opacity=".5"/><rect x="${x + 18}" y="${y + 18}" width="184" height="184" rx="3" fill="${c}"/><circle cx="${x + 150}" cy="${y + 64}" r="20" fill="#fff" opacity=".8"/><path d="M${x + 18} ${y + 202}L${x + 18} ${y + 160}C${x + 60} ${y + 110} ${x + 100} ${y + 130} ${x + 120} ${y + 160}C${x + 150} ${y + 130} ${x + 180} ${y + 125} ${x + 202} ${y + 150}L${x + 202} ${y + 202}Z" fill="${p.deep}" opacity=".45"/>${k ? `<path d="${heartPath(x + 60, y + 70, 18)}" fill="#fff" opacity=".9"/>` : ''}</g>`;
      return card(170, 400, -12, p.accent, 0) + card(410, 410, 10, p.main, 1) + card(290, 360, -1, p.bg[1], 1) + `<rect x="368" y="340" width="70" height="26" rx="4" fill="${p.metal}" opacity=".75" transform="rotate(-6 400 352)"/>`;
    }
    const inner = v === 'collage'
      ? [0, 1, 2, 3].map((i) => { const x = 287 + (i % 2) * 117, y = 352 + Math.floor(i / 2) * 152; return `<rect x="${x}" y="${y}" width="109" height="144" rx="4" fill="${i % 3 ? p.accent : p.bg[1]}"/><path d="${heartPath(x + 54, y + 72, 22)}" fill="${i % 2 ? p.main : '#fff'}" opacity=".9"/>`; }).join('')
      : `<rect x="287" y="352" width="226" height="296" rx="4" fill="${p.accent}"/><circle cx="455" cy="420" r="28" fill="#fff" opacity=".85"/><path d="M287 648L287 590C340 520 388 540 418 580C450 540 482 530 513 556L513 648Z" fill="${p.deep}" opacity=".5"/><path d="M287 648L287 616C330 590 370 600 400 624C440 600 480 596 513 612L513 648Z" fill="${p.deep}" opacity=".35"/><path d="${heartPath(340, 430, 24)}" fill="#fff" opacity=".9"/>`;
    return `<rect x="236" y="300" width="350" height="450" rx="16" fill="${p.deep}" opacity=".18"/><rect x="225" y="288" width="350" height="450" rx="16" fill="${p.main}"/><rect x="225" y="288" width="350" height="450" rx="16" fill="url(#sh)"/><rect x="245" y="308" width="310" height="410" rx="8" fill="${p.deep}" opacity=".22"/><rect x="257" y="322" width="286" height="356" rx="5" fill="#FFFDF9"/>${inner}<path d="M257 322L330 322L257 420Z" fill="url(#gl)"/>`;
  },
  keychain(p, v) {
    const ring = `<circle cx="400" cy="300" r="70" fill="none" stroke="${p.metal}" stroke-width="14"/><path d="M340 270A70 70 0 0 1 400 230" stroke="#fff" stroke-width="5" fill="none" opacity=".5" stroke-linecap="round"/><ellipse cx="400" cy="392" rx="13" ry="24" fill="none" stroke="${p.metal}" stroke-width="7"/><ellipse cx="400" cy="432" rx="22" ry="11" fill="none" stroke="${p.metal}" stroke-width="7"/><ellipse cx="400" cy="472" rx="13" ry="24" fill="none" stroke="${p.metal}" stroke-width="7"/>`;
    let charm;
    if (v === 'moon') charm = `<circle cx="400" cy="610" r="108" fill="${p.metal}" mask="url(#cm)"/><circle cx="374" cy="640" r="9" fill="${p.metalDeep}" opacity=".35"/>${sparkle(470, 640, 22, '#fff')}`;
    else if (v === 'ball') charm = `<circle cx="400" cy="600" r="96" fill="#fff" stroke="${p.deep}" stroke-width="6"/><path d="M400 560L438 588L424 632L376 632L362 588Z" fill="${p.deep}"/><path d="M400 560L400 506M438 588L490 572M424 632L452 680M376 632L348 680M362 588L310 572" stroke="${p.deep}" stroke-width="6"/>`;
    else if (v === 'couple') charm = `<g transform="rotate(-12 350 600)"><path d="${heartPath(350, 610, 74)}" fill="${p.main}"/></g><g transform="rotate(12 455 615)"><path d="${heartPath(455, 625, 74)}" fill="${p.accent}" stroke="#fff" stroke-width="6"/></g>`;
    else charm = `<rect x="330" y="500" width="140" height="200" rx="34" fill="${p.main}"/><rect x="330" y="500" width="140" height="200" rx="34" fill="url(#sh)"/><circle cx="400" cy="532" r="13" fill="${p.bg[0]}" stroke="${p.metal}" stroke-width="5"/><rect x="360" y="590" width="80" height="12" rx="6" fill="#fff" opacity=".7"/><rect x="372" y="616" width="56" height="10" rx="5" fill="#fff" opacity=".5"/>`;
    return ring + charm;
  },
  wallet(p, v) {
    if (v === 'cardholder') return `<rect x="232" y="430" width="280" height="190" rx="20" fill="${p.main}" transform="rotate(-8 372 525)"/><rect x="250" y="446" width="244" height="158" rx="14" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="3" stroke-dasharray="9 7" transform="rotate(-8 372 525)"/><rect x="300" y="400" width="200" height="120" rx="10" fill="${p.accent}" transform="rotate(-8 400 460)"/><rect x="232" y="470" width="280" height="190" rx="20" fill="${p.main}" transform="rotate(-8 372 565)"/><rect x="232" y="470" width="280" height="190" rx="20" fill="url(#sh)" transform="rotate(-8 372 565)"/><g transform="rotate(-62 520 620)"><rect x="380" y="600" width="300" height="34" rx="17" fill="${p.deep}"/><rect x="380" y="600" width="80" height="34" rx="12" fill="${p.metal}"/><rect x="420" y="594" width="120" height="8" rx="4" fill="${p.metal}"/></g>`;
    return `<rect x="262" y="380" width="230" height="150" rx="12" fill="${p.accent}" transform="rotate(-8 377 455)"/><rect x="282" y="402" width="70" height="18" rx="9" fill="#fff" opacity=".6" transform="rotate(-8 377 455)"/><rect x="210" y="440" width="380" height="290" rx="28" fill="${p.main}"/><rect x="210" y="440" width="380" height="290" rx="28" fill="url(#sh)"/><rect x="226" y="456" width="348" height="258" rx="18" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="3" stroke-dasharray="10 8"/><rect x="490" y="540" width="100" height="90" rx="18" fill="${p.deep}"/><circle cx="530" cy="585" r="12" fill="${p.metal}"/><rect x="250" y="660" width="90" height="10" rx="5" fill="${p.metal}" opacity=".7"/>`;
  },
  chocolate(p, v) {
    const cocoa = ['#5A3423', '#7B4A2F', '#A0673F', '#EAD3B9', '#6B3C28', p.main];
    const truffle = (x, y, i) => `<rect x="${x - 50}" y="${y - 50}" width="100" height="100" rx="20" fill="#000" opacity=".22"/><circle cx="${x}" cy="${y}" r="40" fill="${cocoa[i % cocoa.length]}"/><path d="M${x - 24} ${y - 6}C${x - 12} ${y - 22} ${x} ${y + 6} ${x + 12} ${y - 10}C${x + 18} ${y - 18} ${x + 24} ${y - 8} ${x + 26} ${y - 2}" stroke="${i % 3 === 0 ? '#EAD3B9' : '#3B2216'}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/><circle cx="${x - 14}" cy="${y - 16}" r="7" fill="#fff" opacity=".35"/>`;
    if (v === 'macaron') {
      const cols = [p.main, '#B8A3E6', '#9FD9CF', '#FBDD8F'];
      return [0, 1, 2, 3].map((k) => { const y = 740 - k * 92, c = cols[k]; return `<ellipse cx="400" cy="${y + 14}" rx="122" ry="38" fill="${c}"/><ellipse cx="400" cy="${y + 14}" rx="122" ry="38" fill="#000" opacity=".12"/><ellipse cx="400" cy="${y - 4}" rx="128" ry="22" fill="${c}" stroke="#fff" stroke-opacity=".4" stroke-width="5" stroke-dasharray="3 6"/><ellipse cx="400" cy="${y - 12}" rx="112" ry="16" fill="#FFF8EE"/><ellipse cx="400" cy="${y - 34}" rx="122" ry="42" fill="${c}"/><ellipse cx="360" cy="${y - 50}" rx="40" ry="10" fill="#fff" opacity=".4"/>`; }).join('');
    }
    if (v === 'dates') {
      let items = '';
      const rnd = prng('dates');
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, rr = i % 2 ? 150 : 90, x = r1(400 + rr * Math.cos(a)), y = r1(640 + rr * 0.42 * Math.sin(a)); items += i % 3 === 0 ? `<circle cx="${x}" cy="${y}" r="20" fill="#E6C79A"/><circle cx="${x - 6}" cy="${y - 6}" r="5" fill="#fff" opacity=".5"/>` : `<ellipse cx="${x}" cy="${y}" rx="${r1(34 + rnd() * 6)}" ry="18" fill="#6B3420" transform="rotate(${Math.round(a * 57)} ${x} ${y})"/><ellipse cx="${x - 8}" cy="${y - 6}" rx="12" ry="4" fill="#fff" opacity=".25"/>`; }
      return `<ellipse cx="400" cy="660" rx="250" ry="120" fill="${p.metal}"/><ellipse cx="400" cy="648" rx="230" ry="104" fill="${p.accent}"/><ellipse cx="400" cy="648" rx="230" ry="104" fill="url(#sh)" opacity=".5"/>${items}<circle cx="400" cy="640" r="34" fill="#6B3420"/>${sparkle(560, 470, 24, '#fff')}`;
    }
    if (v === 'heart') {
      return `<path d="${heartPath(400, 560, 250)}" fill="${p.main}"/><path d="${heartPath(400, 560, 250)}" fill="url(#sh)"/><path d="${heartPath(400, 565, 215)}" fill="${p.deep}"/>${[[300, 470], [400, 520], [500, 470], [340, 600], [460, 600], [400, 690]].map(([x, y], i) => truffle(x, y, i)).join('')}`;
    }
    return `<g transform="rotate(-7 400 380)"><rect x="232" y="290" width="336" height="150" rx="24" fill="${p.main}"/><rect x="380" y="290" width="40" height="150" fill="${p.metal}"/></g><rect x="200" y="430" width="400" height="330" rx="28" fill="${p.main}"/><rect x="200" y="430" width="400" height="330" rx="28" fill="url(#sh)"/><rect x="224" y="454" width="352" height="282" rx="18" fill="${p.deep}"/>${[[290, 530], [400, 530], [510, 530], [290, 650], [400, 650], [510, 650]].map(([x, y], i) => truffle(x, y, i)).join('')}`;
  },
  candle(p, v) {
    const jar = (x, w, h, s) => {
      const y = 760 - h, cx = x + w / 2;
      return `<circle cx="${cx}" cy="${y - 70 * s}" r="${110 * s}" fill="#FFE7A3" opacity=".45"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${38 * s}" fill="${p.main}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${38 * s}" fill="url(#sh)"/><ellipse cx="${cx}" cy="${y + 20 * s}" rx="${w / 2 - 14 * s}" ry="${22 * s}" fill="${p.accent}"/><rect x="${x + w * 0.15}" y="${y + h * 0.36}" width="${w * 0.7}" height="${h * 0.36}" rx="${12 * s}" fill="#FFFDF8" opacity=".92"/><rect x="${cx - w * 0.22}" y="${y + h * 0.45}" width="${w * 0.44}" height="${9 * s}" rx="${4 * s}" fill="${p.deep}" opacity=".6"/><rect x="${cx - w * 0.15}" y="${y + h * 0.53}" width="${w * 0.3}" height="${7 * s}" rx="${3 * s}" fill="${p.deep}" opacity=".35"/><path d="${heartPath(cx, y + h * 0.63, 10 * s)}" fill="${p.main}"/><line x1="${cx}" y1="${y + 20 * s}" x2="${cx}" y2="${y - 18 * s}" stroke="#3B2A20" stroke-width="${5 * s}"/><path d="M${cx} ${y - 108 * s}C${cx + 30 * s} ${y - 70 * s} ${cx + 32 * s} ${y - 30 * s} ${cx} ${y - 14 * s}C${cx - 32 * s} ${y - 30 * s} ${cx - 30 * s} ${y - 70 * s} ${cx} ${y - 108 * s}Z" fill="url(#fl)"/><path d="M${cx} ${y - 66 * s}C${cx + 12 * s} ${y - 48 * s} ${cx + 12 * s} ${y - 30 * s} ${cx} ${y - 22 * s}C${cx - 12 * s} ${y - 30 * s} ${cx - 12 * s} ${y - 48 * s} ${cx} ${y - 66 * s}Z" fill="#FFF6D5"/>`;
    };
    return v === 'duo' ? jar(190, 200, 250, 0.82) + jar(410, 200, 300, 0.9) : jar(280, 240, 300, 1);
  },
  rose(p, v) {
    const bloom = (cx, cy, r, c, d) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/><circle cx="${cx}" cy="${cy}" r="${r1(r * 0.74)}" fill="none" stroke="${d}" stroke-opacity=".4" stroke-width="${r1(r * 0.11)}" stroke-dasharray="${r1(r * 3.3)} 999" transform="rotate(25 ${cx} ${cy})"/><circle cx="${cx}" cy="${cy}" r="${r1(r * 0.48)}" fill="none" stroke="${d}" stroke-opacity=".45" stroke-width="${r1(r * 0.1)}" stroke-dasharray="${r1(r * 2.1)} 999" transform="rotate(160 ${cx} ${cy})"/><circle cx="${cx}" cy="${cy}" r="${r1(r * 0.22)}" fill="${d}" opacity=".35"/><circle cx="${r1(cx - r * 0.4)}" cy="${r1(cy - r * 0.45)}" r="${r1(r * 0.16)}" fill="#fff" opacity=".35"/>`;
    const tulip = (cx, cy, c, d) => `<path d="M${cx - 42} ${cy - 28}C${cx - 48} ${cy + 40} ${cx + 48} ${cy + 40} ${cx + 42} ${cy - 28}L${cx + 22} ${cy - 8}L${cx} ${cy - 44}L${cx - 22} ${cy - 8}Z" fill="${c}"/><path d="M${cx} ${cy - 44}L${cx - 22} ${cy - 8}L${cx} ${cy + 26}L${cx + 22} ${cy - 8}Z" fill="${d}" opacity=".25"/>`;
    const leaf = (x, y, rot, c) => `<ellipse cx="${x}" cy="${y}" rx="24" ry="62" fill="${c}" transform="rotate(${rot} ${x} ${y})"/>`;
    if (v === 'dome') {
      return `<rect x="268" y="786" width="264" height="56" rx="12" fill="#8A5638"/><rect x="268" y="786" width="264" height="18" rx="9" fill="#fff" opacity=".2"/><path d="M400 760C398 680 404 620 400 560" stroke="#4A7A5D" stroke-width="9" fill="none"/>${leaf(368, 660, -50, '#6FA383')}${leaf(434, 700, 50, '#5E9470')}${bloom(400, 520, 78, p.main, p.deep)}<path d="M296 790L296 440A104 104 0 0 1 504 440L504 790Z" fill="#fff" opacity=".18" stroke="#fff" stroke-opacity=".75" stroke-width="5"/><path d="M322 760L322 450A80 80 0 0 1 370 370" stroke="#fff" stroke-width="10" fill="none" opacity=".45" stroke-linecap="round"/>${sparkle(540, 360, 22, '#fff')}`;
    }
    const wrapC = v === 'kraft' ? '#E3C9A6' : p.accent;
    const blooms = v === 'tulip'
      ? [[330, 440], [400, 395], [470, 440], [365, 500], [435, 500]].map(([x, y]) => `<path d="M${x} ${y + 30}L400 640" stroke="#4A7A5D" stroke-width="6"/>` + tulip(x, y, p.main, p.deep)).join('')
      : [[318, 470, 58], [482, 470, 58], [400, 410, 66], [355, 530, 52], [445, 530, 52]].map(([x, y, r]) => bloom(x, y, r, p.main, p.deep)).join('');
    return `<path d="M236 480L564 480L462 860L338 860Z" fill="${wrapC}"/><path d="M236 480L564 480L462 860L338 860Z" fill="url(#sh)"/>${leaf(258, 470, -40, '#6FA383')}${leaf(542, 470, 40, '#5E9470')}${leaf(300, 400, -18, '#7FB08A')}${leaf(500, 400, 18, '#6FA383')}${blooms}<path d="M262 560L538 560L462 860L338 860Z" fill="${wrapC}"/><path d="M262 560L400 600L538 560" stroke="#fff" stroke-opacity=".5" stroke-width="4" fill="none"/><path d="M262 560L538 560L462 860L338 860Z" fill="url(#sh)"/>${bow(400, 720, p.deep, '#000', 0.62)}`;
  },
  teddy(p) {
    return `<circle cx="306" cy="300" r="54" fill="${p.main}"/><circle cx="494" cy="300" r="54" fill="${p.main}"/><circle cx="306" cy="300" r="28" fill="${p.accent}"/><circle cx="494" cy="300" r="28" fill="${p.accent}"/><ellipse cx="400" cy="645" rx="150" ry="168" fill="${p.main}"/><ellipse cx="400" cy="645" rx="150" ry="168" fill="url(#sh)"/><ellipse cx="400" cy="672" rx="92" ry="106" fill="${p.accent}"/><ellipse cx="272" cy="600" rx="48" ry="88" fill="${p.main}" transform="rotate(28 272 600)"/><ellipse cx="528" cy="600" rx="48" ry="88" fill="${p.main}" transform="rotate(-28 528 600)"/><ellipse cx="312" cy="790" rx="64" ry="48" fill="${p.main}"/><ellipse cx="488" cy="790" rx="64" ry="48" fill="${p.main}"/><ellipse cx="312" cy="796" rx="36" ry="26" fill="${p.accent}"/><ellipse cx="488" cy="796" rx="36" ry="26" fill="${p.accent}"/><path d="${heartPath(400, 640, 58)}" fill="#E8556E"/><ellipse cx="380" cy="618" rx="10" ry="16" fill="#fff" opacity=".45" transform="rotate(-30 380 618)"/><circle cx="400" cy="400" r="126" fill="${p.main}"/><circle cx="400" cy="400" r="126" fill="url(#sh)" opacity=".6"/><ellipse cx="400" cy="440" rx="60" ry="46" fill="${p.accent}"/><ellipse cx="400" cy="418" rx="19" ry="13" fill="${p.deep}"/><path d="M400 431L400 448M400 448C390 460 378 458 373 451M400 448C410 460 422 458 427 451" stroke="${p.deep}" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="354" cy="378" r="12" fill="${p.deep}"/><circle cx="446" cy="378" r="12" fill="${p.deep}"/><circle cx="358" cy="374" r="4" fill="#fff"/><circle cx="450" cy="374" r="4" fill="#fff"/><circle cx="325" cy="430" r="15" fill="#F29BAA" opacity=".55"/><circle cx="475" cy="430" r="15" fill="#F29BAA" opacity=".55"/><path d="M400 522L344 496L344 552Z" fill="#8E2C5C"/><path d="M400 522L456 496L456 552Z" fill="#8E2C5C"/><circle cx="400" cy="522" r="13" fill="#5E1A3C"/>`;
  },
  mug(p) {
    return `<path d="M340 410C320 380 360 360 340 330M400 400C380 370 420 350 400 320M460 410C440 380 480 360 460 330" stroke="#fff" stroke-width="10" fill="none" opacity=".75" stroke-linecap="round"/><path d="M522 500C612 500 616 660 522 660" stroke="${p.main}" stroke-width="36" fill="none"/><path d="M522 500C612 500 616 660 522 660" stroke="#000" stroke-opacity=".12" stroke-width="36" fill="none"/><rect x="258" y="442" width="272" height="324" rx="34" fill="${p.main}"/><rect x="258" y="442" width="272" height="324" rx="34" fill="url(#sh)"/><ellipse cx="394" cy="446" rx="136" ry="26" fill="${p.deep}"/><ellipse cx="394" cy="451" rx="118" ry="19" fill="#6B4430"/><path d="${heartPath(394, 606, 62)}" fill="${p.accent}"/><path d="${heartPath(394, 606, 62)}" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="6 8" opacity=".7"/><rect x="282" y="480" width="16" height="230" rx="8" fill="#fff" opacity=".25"/>`;
  },
  perfume(p) {
    return `<rect x="344" y="300" width="112" height="112" rx="18" fill="${p.metalDeep}"/><rect x="344" y="300" width="112" height="40" rx="18" fill="#fff" opacity=".2"/><rect x="372" y="404" width="56" height="48" fill="${p.metal}"/><rect x="278" y="440" width="244" height="334" rx="46" fill="${p.main}" opacity=".95"/><rect x="296" y="528" width="208" height="228" rx="34" fill="${p.deep}" opacity=".55"/><rect x="278" y="440" width="244" height="334" rx="46" fill="url(#sh)"/><rect x="300" y="470" width="22" height="270" rx="11" fill="#fff" opacity=".35"/><rect x="330" y="582" width="140" height="92" rx="10" fill="${p.metal}"/><rect x="340" y="592" width="120" height="72" rx="6" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2"/><rect x="368" y="616" width="64" height="8" rx="4" fill="#fff" opacity=".85"/><rect x="380" y="634" width="40" height="6" rx="3" fill="#fff" opacity=".6"/>${sparkle(560, 380, 22, '#fff')}`;
  },
  sunglasses(p) {
    const lens = (dx, flip) => { const x = (v) => r1(400 + (flip ? -1 : 1) * v); return `<path d="M${x(20)} 480C${x(20)} 430 ${x(200)} 430 ${x(200)} 480C${x(200)} 560 ${x(160)} 620 ${x(115)} 620C${x(70)} 620 ${x(20)} 560 ${x(20)} 480Z" fill="${p.main}" stroke="${p.metal}" stroke-width="9"/><path d="M${x(40)} 474C${x(60)} 452 ${x(110)} 450 ${x(140)} 456L${x(60)} 580C${x(44)} 556 ${x(38)} 520 ${x(40)} 474Z" fill="#fff" opacity=".22"/>`; };
    return `<path d="M210 470L150 380M590 470L650 380" stroke="${p.deep}" stroke-width="12" stroke-linecap="round"/>${lens(0, true)}${lens(0, false)}<path d="M380 466C390 450 410 450 420 466" stroke="${p.metal}" stroke-width="9" fill="none"/><path d="M372 444L428 444" stroke="${p.metal}" stroke-width="7" stroke-linecap="round"/>${sparkle(560, 380, 24, '#fff')}`;
  },
  plant(p) {
    let leaves = '';
    const leaf = (rot, len, c) => `<path d="M0 0C-24 -${len * 0.25} -20 -${len * 0.75} 0 -${len}C20 -${len * 0.75} 24 -${len * 0.25} 0 0Z" fill="${c}" transform="translate(400 590) rotate(${rot})"/>`;
    for (let a = -84; a <= 84; a += 21) leaves += leaf(a, 170, '#5E9470');
    for (let a = -63; a <= 63; a += 21) leaves += leaf(a, 135, '#7FB08A');
    for (let a = -36; a <= 36; a += 18) leaves += leaf(a, 96, '#A6CDA9');
    return `${leaves}<path d="M300 600L500 600L474 806L326 806Z" fill="${p.main}"/><path d="M300 600L500 600L474 806L326 806Z" fill="url(#sh)"/><rect x="284" y="578" width="232" height="44" rx="12" fill="${p.main}"/><rect x="284" y="578" width="232" height="16" rx="8" fill="#fff" opacity=".25"/><path d="${heartPath(400, 700, 28)}" fill="#fff" opacity=".8"/>`;
  },
};

/** SVG for one product/category. kind = art key, v = variant. */
export function renderArt(kind, paletteName, seed, { variant = '', square = false, zoom = false } = {}) {
  const p = PALETTES[paletteName] || PALETTES.rose;
  const body = (ART[kind] || ART.giftbox)(p, variant);
  const extra = kind === 'keychain' && variant === 'moon' ? `<mask id="cm"><rect width="800" height="1000" fill="#fff"/><circle cx="446" cy="582" r="92" fill="#000"/></mask>` : '';
  return frame(p, body, seed, { square, zoom, extraDefs: extra });
}

/** Wide hero composition: gift box + teddy + bouquet. */
export function renderHero() {
  const p = PALETTES.blush;
  const g = (fn, pal, v, x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">${ART[fn](PALETTES[pal], v)}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"><defs><radialGradient id="lt" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>${DEFS}</defs><circle cx="500" cy="420" r="380" fill="url(#lt)"/>${decor(p, 'hero', 12, 1000, 800, 430, 360)}<ellipse cx="500" cy="720" rx="420" ry="34" fill="#B84A62" opacity=".1"/>${g('teddy', 'peach', '', 40, 170, 0.62)}${g('rose', 'rose', '', 560, 150, 0.66)}${g('giftbox', 'berry', '', 230, 110, 0.75)}</svg>`;
}

export function renderPlaceholder() {
  return frame(PALETTES.pearl, `<g opacity=".55">${ART.giftbox(PALETTES.pearl, 'accent')}</g>`, 'placeholder');
}
