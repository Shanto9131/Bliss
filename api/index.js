// Vercel serverless entry: every page and API request is routed here (see vercel.json).
// Static files in /public are served by Vercel's CDN directly.
import { createApp } from '../server/app.js';

let appPromise = null;
export default async function handler(req, res) {
  appPromise ||= createApp();
  const app = await appPromise;
  await app.handler(req, res);
}
