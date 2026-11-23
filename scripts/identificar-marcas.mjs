import { Resolver } from 'node:dns/promises';
import { request } from 'node:https';
import { isIPv4 } from 'node:net';

const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const stopPages = /domain (?:is )?for sale|buy this domain|dom[ií]nio (?:est[aá] )?[àa] venda|domain parking|domain (?:has )?expired|parked (?:at|domain)|sedoparking|p[aá]gina (?:padr[aã]o|em constru[çc][ãa]o)|default (?:web )?site page|just a moment|403 forbidden|access denied|verifying your browser|site em constru[çc][ãa]o/i;
const maxBytes = 192 * 1024;

export function isPublicAddress(address) {
  if (!isIPv4(address)) return false;
  const [a,b,c] = address.split('.').map(Number);
  return a > 0 && a < 224 && a !== 10 && a !== 127 &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113);
}

function entityText(value) {
  const named = {amp:'&',quot:'"',apos:"'",nbsp:' ',lt:'<',gt:'>',aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',atilde:'ã',otilde:'õ',ccedil:'ç',ecirc:'ê',ocirc:'ô',acirc:'â'};
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (full, key) => {
    if (key[0] !== '#') {
      const letter = named[key.toLowerCase()];
      return letter && key[0] !== key[0].toLowerCase() ? letter.toUpperCase() : (letter || full);
    }
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).trim().replace(/\s+/g,' ');
}

const compact = value => value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');

// Require a source spelling of the domain's brand. Never guess where to split words.
export function brandFromHtml(domain, html, pageUrl) {
  const head = html.split(/<\/head\s*>|<body\b/i,1)[0].replace(/<!--[\s\S]*?(?:-->|$)/g,'');
  const clean = head.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,'');
  const title = entityText(clean.match(/<title\b[^>]*>([^<>]*)<\/title\s*>/i)?.[1] || '');
  if (stopPages.test(title) || stopPages.test(html.slice(0,maxBytes))) return null;
  const stem = compact(domain.split('.')[0]);
  if (!stem || /^(www|home|localhost)$/.test(stem)) return null;
  const candidates = [];
  for (const [,json] of head.matchAll(/<script\b[^>]*?\stype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let data;
    try { data = JSON.parse(json); } catch { continue; }
    const nodes = Array.isArray(data) ? data : (data?.['@graph'] || [data]);
    if (!Array.isArray(nodes)) continue;
    for (const node of nodes) {
      const types = [node?.['@type']].flat();
      if (!types.some(t => t === 'WebSite' || t === 'Organization') || typeof node.name !== 'string') continue;
      if (node.url) {
        try {
          const ref = new URL(node.url,pageUrl);
          if (!['https:', 'http:'].includes(ref.protocol) ||
              ![domain,'www.'+domain].includes(ref.hostname)) continue;
        } catch { continue; }
      }
      candidates.push([entityText(node.name), 'json-ld']);
    }
  }
  for (const [tag] of clean.matchAll(/<meta\s+(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const attrs = new Map();
    for (const [,key,dq,sq,bare] of tag.matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs.set(key.toLowerCase(),dq ?? sq ?? bare);
    }
    if ((attrs.get('property') || attrs.get('name'))?.toLowerCase() === 'og:site_name' && attrs.has('content')) {
      candidates.push([entityText(attrs.get('content')), 'og:site_name']);
    }
  }
  for (const [part] of title.matchAll(/[^|•–—]+/g)) {
    for (const piece of part.split(/\s+-\s+|\s+:\s+/)) candidates.push([piece.trim(),'title']);
  }
  for (const [name,signal] of candidates) {
    if (!name || name.length > 90 || /[<>@/\\=\p{Cf}\p{Cc}]/u.test(name) ||
        /\b(?:com\.br|\.com)\b/i.test(name) || !/\p{L}/u.test(name)) continue;
    if (compact(name) === stem) return {name,source:pageUrl+'#'+signal};
  }
  return null;
}

async function publicPage(url, signal) {
  // Resolve and pin the same public IPv4 address for the TLS connection.
  const resolver = new Resolver({timeout:1100,tries:1});
  const cancel = () => resolver.cancel();
  signal.throwIfAborted();
  signal.addEventListener('abort',cancel,{once:true});
  let addresses;
  try { addresses = await resolver.resolve4(url.hostname); }
  finally { signal.removeEventListener('abort',cancel); }
  signal.throwIfAborted();
  if (!addresses.length || !addresses.every(isPublicAddress)) throw Error('Destino indisponível');
  return new Promise((resolve,reject) => {
    const req = request(url,{
      agent:false, family:4, autoSelectFamily:false, signal,
      lookup: (_host,_opts,callback) => callback(null,addresses[0],4),
      headers: {Accept:'text/html, application/xhtml+xml', 'Accept-Encoding':'identity',
        'User-Agent':'ApitoCRM/1.0 (identificacao de marcas)'}
    },res => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        const location = res.headers.location;
        res.destroy();
        resolve({location});
        return;
      }
      if (res.statusCode !== 200 || !/^\s*(?:text\/html|application\/xhtml\+xml)\b/i.test(res.headers['content-type'] || '')) {
        res.destroy();
        resolve({});
        return;
      }
      const chunks = [];
      let size = 0;
      function finish() {
        const bytes = Buffer.concat(chunks,size);
        const charset = /(?:charset\s*=\s*["']?)([\w-]+)/i.exec(res.headers['content-type'] || '')?.[1] ||
          /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(bytes.subarray(0,4096).toString('latin1'))?.[1];
        try { resolve({html:new TextDecoder(charset || 'utf-8').decode(bytes)}); }
        catch { resolve({}); }
      }
      res.on('data',chunk => {
        const part = chunk.subarray(0,maxBytes-size);
        chunks.push(part);
        size += part.length;
        if (size >= maxBytes) { finish(); res.destroy(); }
      });
      res.once('end', finish);
      res.once('error',reject);
    });
    req.once('error',reject);
    req.end();
  });
}

export async function identifyBrand(domain) {
  const host = String(domain).trim().toLowerCase();
  if (host.length > 253 || !domainPattern.test(host)) return null;
  const signal = AbortSignal.timeout(4500);
  for (const initial of [host,'www.'+host]) {
    let url = new URL('https://'+initial+'/');
    try {
      for (let step=0; step<4; step++) {
        const {html,location} = await publicPage(url,signal);
        if (html) return brandFromHtml(host,html,url.origin+url.pathname);
        if (!location) break;
        url = new URL(location,url);
        if (url.username || url.password || url.protocol !== 'https:' || url.port ||
            ![host,'www.'+host].includes(url.hostname)) break;
      }
    } catch { if (signal.aborted) return null; }
  }
  return null;
}
