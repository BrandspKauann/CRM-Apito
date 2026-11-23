import {randomBytes, createCipheriv, createDecipheriv} from 'node:crypto';
import {query} from './db.mjs';
import {advanceSync, syncStatus} from './kommo-sync.mjs';

const key = Buffer.from(process.env.CRM_ENCRYPTION_KEY || '', 'hex');
if (key.length !== 32 || !/^[a-f0-9]{64}$/i.test(process.env.CRM_ENCRYPTION_KEY || '')) {
  throw new Error('CRM_ENCRYPTION_KEY deve conter 32 bytes em hexadecimal');
}

function seal(value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
function unseal(value) {
  const bytes = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
function send(res, status, value) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(value));
}
function publicConfig(config) {
  return {connected: !!config, baseUrl: config?.baseUrl || '', lastChecked: config?.lastChecked || null};
}
function mapRow(row) {
  return row && {baseUrl: row.base_url, token: row.token_encrypted, lastChecked: row.last_checked?.toISOString() || null};
}
async function getConfig(provider) {
  const result = await query('SELECT base_url, token_encrypted, last_checked FROM integration_configs WHERE provider = $1', [provider]);
  return mapRow(result.rows[0]);
}
function validUrl(provider, raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' || !url.hostname.includes('.') || url.hostname === 'localhost' || /^\d+(\.\d+){3}$/.test(url.hostname)) {
    throw Error('Informe a URL HTTPS do sistema');
  }
  if (provider === 'kommo' && !url.hostname.endsWith('.kommo.com')) throw Error('Informe o endereço da sua conta Kommo');
  return url.origin;
}
async function request(provider, config, path) {
  const response = await fetch(config.baseUrl + path, {
    headers: {Authorization: provider === 'kommo' ? 'Bearer ' + unseal(config.token) : unseal(config.token), Accept: 'application/json'},
    redirect: 'error', signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'Token recusado pelo serviço' : 'Serviço respondeu HTTP ' + response.status);
  return response.status === 204 ? {} : response.json();
}
export async function handleIntegration(req, res) {
  if (req.url === '/api/integrations/kommo/sync') {
    try {
      if (!['GET','POST'].includes(req.method)) { send(res,405,{error:'Método inválido'}); return true; }
      const config = await getConfig('kommo');
      if (!config) { send(res,409,{error:'Configure primeiro a integração da Kommo.'}); return true; }
      const origin = validUrl('kommo',config.baseUrl);
      if (req.method === 'GET') { send(res,200,await syncStatus(origin)); return true; }
      if (!req.headers['content-type']?.startsWith('application/json') ||
          (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) {
        send(res,403,{error:'Origem ou formato inválido'}); return true;
      }
      let text = '';
      for await (const chunk of req) {
        text += chunk.toString();
        if (text.length>512) { send(res,413,{error:'Corpo muito grande'}); return true; }
      }
      let options;
      try { options = JSON.parse(text || '{}'); }
      catch { send(res,400,{error:'JSON inválido'}); return true; }
      const read = async (path,host,account) => {
        let target = origin;
        if (host === 'drive') {
          const raw = account?.drive_url;
          let drive;
          try { drive = new URL(raw); } catch {}
          // Only forward the account credential to an authenticated Kommo-owned drive.
          if (!drive || drive.protocol!=='https:' || !drive.hostname.endsWith('.kommo.com') ||
            drive.port || drive.username || drive.password || !path.startsWith('/v1.0/')) {
            throw Object.assign(Error('Drive indisponível'),{remote:true,status:403});
          }
          target = drive.origin;
        } else if (!path.startsWith('/api/v4/')) throw Error('Rota inválida');
        try {
          const response = await fetch(target+path,{headers:{Authorization:'Bearer '+unseal(config.token),
            Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(9500)});
          if (!response.ok) {
            const after = response.headers.get('retry-after');
            const wait = after && (/^\d+$/.test(after) ? Number(after)*1000 : Date.parse(after)-Date.now());
            await response.body?.cancel();
            throw Object.assign(Error('Erro da Kommo'),{status:response.status,retryAfterMs:Math.max(0,wait || 0)});
          }
          return response.status===204 ? null : await response.json();
        } catch (e) { e.remote=true; throw e; }
      };
      send(res,200,await advanceSync(origin,read,options?.retry===true));
    } catch (e) {
      send(res,503,{error:e.remote ? 'Não foi possível consultar a conta na Kommo.' : 'Não foi possível atualizar a importação no banco.'});
    }
    return true;
  }
  const route = /^\/api\/integrations(?:\/(kommo|meeventos)(?:\/(test|preview))?)?$/.exec(req.url);
  if (!route) return false;
  const [, provider, action] = route;
  if (req.method === 'GET' && !provider) {
    const result = await query('SELECT provider, base_url, token_encrypted, last_checked FROM integration_configs');
    const configs = Object.fromEntries(result.rows.map(row => [row.provider, mapRow(row)]));
    send(res, 200, {kommo: publicConfig(configs.kommo), meeventos: publicConfig(configs.meeventos)});
    return true;
  }
  if (!provider) { send(res, 405, {error: 'Método inválido'}); return true; }
  if (req.method === 'GET' && action === 'preview') {
    try {
      const config = await getConfig(provider);
      if (!config) throw Error('Configure a integração primeiro');
      const paths = provider === 'kommo' ? ['/api/v4/contacts?limit=20', '/api/v4/leads?limit=20'] : ['/api/v1/clients?page=1&limit=20', '/api/v1/events?page=1&limit=20'];
      const results = await Promise.all(paths.map(path => request(provider, config, path)));
      const lists = provider === 'kommo' ? {
        contacts: (results[0]._embedded?.contacts || []).map(row => ({id:row.id, name:row.name})),
        leads: (results[1]._embedded?.leads || []).map(row => ({id:row.id, name:row.name, price:row.price})),
      } : {
        clients: (results[0].data || []).map(row => ({id:row.id, name:row.nome || row.razaosocial || 'Cliente'})),
        events: (results[1].data || []).map(row => ({id:row.id, name:row.nomeevento || 'Evento'})),
      };
      send(res, 200, lists);
    } catch (error) { send(res, 502, {error:error.code ? 'Não foi possível consultar as integrações.' : error.message}); }
    return true;
  }
  if (req.method === 'POST' && (action === 'test' || !action)) {
    if (!req.headers['content-type']?.startsWith('application/json') || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) {
      send(res, 403, {error:'Origem inválida'}); return true;
    }
    try {
      let size = 0; const parts = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16000) throw Error('Dados muito longos');
        parts.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      const previous = await getConfig(provider);
      const baseUrl = validUrl(provider, String(body.baseUrl || previous?.baseUrl || '').replace(/\/+$/, '') + '/');
      const token = String(body.token || '').trim();
      if (!token && (!previous?.token || baseUrl !== previous.baseUrl)) throw Error('Informe o token para este endereço');
      const config = {baseUrl, token: token ? seal(token) : previous.token};
      await request(provider, config, provider === 'kommo' ? '/api/v4/account' : '/api/v1/events');
      if (!action) {
        await query(`INSERT INTO integration_configs(provider, base_url, token_encrypted, last_checked)
                     VALUES($1, $2, $3, NOW())
                     ON CONFLICT (provider) DO UPDATE SET base_url = EXCLUDED.base_url,
                       token_encrypted = EXCLUDED.token_encrypted, last_checked = EXCLUDED.last_checked`,
          [provider, baseUrl, config.token]);
      }
      send(res, 200, {ok:true, ...publicConfig(!action ? {...config,lastChecked:new Date().toISOString()} : previous), baseUrl});
    } catch (error) {
      send(res, error.code ? 503 : 400, {error:error.code ? 'Serviço temporariamente indisponível.' : error.message || 'Não foi possível conectar'});
    }
    return true;
  }
  send(res, 405, {error:'Método inválido'});
  return true;
}
