// Regenerates all demo illustrations in public/img (run: npm run art)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeArt } from '../server/seed.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const n = writeArt(PUBLIC, true);
console.log(`Wrote ${n} illustrations to public/img`);
