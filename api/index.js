import { handler as crmHandler } from '../server.mjs';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.searchParams.get('__crm_path');
  if (path !== null) {
    url.searchParams.delete('__crm_path');
    req.url = `/api/${path}${url.search}`;
  }
  return crmHandler(req, res);
}
