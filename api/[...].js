import { handler as crmHandler } from '../server.mjs';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  // Vercel exposes the splat capture through req.query.path.
  const captured = req.query?.path ?? url.searchParams.get('path');
  const path = Array.isArray(captured) ? captured.join('/') : captured;
  if (typeof path === 'string') {
    url.searchParams.delete('path');
    req.url = `/api/${path}${url.search}`;
  }
  return crmHandler(req, res);
}
