// Vercel serverless entry: every page and API request is routed here (see vercel.json).
// The shared app restores the original URL from the rewrite and handles the request.
import { createApp } from '../server/app.js';

let appPromise = null;
export default async function handler(req, res) {
  appPromise ||= createApp();
  const app = await appPromise;
  await app.handler(req, res);
}
