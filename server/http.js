// Gli attrezzi HTTP condivisi dalle rotte: risposte JSON, redirect, corpo con limite, biscotti, controllo dell'origine,
// le pagine statiche (con il nome della piattaforma e la lingua scritti dentro) e le intestazioni di sicurezza.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { traduci } from './lingue.js';

export const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const TIPI = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml; charset=utf-8' };

export const errore = (stato, messaggio, extra = {}) => Object.assign(new Error(messaggio), { stato, ...extra });
export const emailValida = e => typeof e === 'string' && e.length <= 254 && /^[^\s@,;<>"?&=%#/\\]{1,64}@[^\s@,;<>"?&=%#/\\]{1,252}\.[^\s@,;<>"?&=%#/\\]{2,}$/.test(e);
export const testo = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
export const centesimi = v => Math.round(Number(v) * 100);
export const urlValido = (u, { https = false } = {}) => { try { const x = new URL(u); return (x.protocol === 'https:' || (!https && x.protocol === 'http:')) && !!x.hostname; } catch { return false; } };

export function biscotti(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(([k]) => k)
    .map(([k, ...v]) => { try { return [k, decodeURIComponent(v.join('='))]; } catch { return [k, '']; } }));
}
// l'indirizzo di chi visita. Dietro Caddy si legge X-Forwarded-For, che Caddy riscrive. Dietro Cloudflare Tunnel (APP_CLOUDFLARE=1) si
// legge CF-Connecting-IP, scritta da Cloudflare: lì X-Forwarded-For porta in testa quello che manda il visitatore, che lo può inventare
// e scansare i limiti sui tentativi. Attivarlo solo se il server è raggiungibile unicamente dal tunnel (APP_HOST=127.0.0.1).
let daCloudflare = false;
export const proxyCloudflare = si => { daCloudflare = !!si; };
export const ipDi = req => (daCloudflare && String(req.headers['cf-connecting-ip'] || '').trim())
  || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
// l'indirizzo accorciato (/24 o /48) e il tipo di dispositivo: per la lista delle sessioni, senza tenere dati in più del necessario
export function ipCorto(ip) {
  const v = String(ip).replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) return v.split('.').slice(0, 3).join('.') + '.0';
  return v.includes(':') ? v.split(':').slice(0, 3).join(':') + '::' : '';
}
export function dispositivo(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const s = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return s ? `${b} su ${s}` : b;
}
// la lingua: scelta esplicita (biscotto), poi quella del browser; inglese per chi non parla italiano
export function linguaDi(req, b, predefinita = 'it') {
  if (b.lingua === 'it' || b.lingua === 'en') return b.lingua;
  // Accept-Language in ordine di preferenza: la prima fra italiano e inglese; un'altra lingua vera → inglese; «*» o niente → la predefinita
  const l = String(req.headers['accept-language'] || '').toLowerCase().split(',').map(x => { const [t, q] = x.trim().split(';q='); return { t: t.trim(), q: q === undefined ? 1 : Number(q) }; })
    .filter(x => x.t && x.q > 0).sort((a, z) => z.q - a.q);
  for (const x of l) { if (x.t.startsWith('it')) return 'it'; if (x.t.startsWith('en')) return 'en'; }
  return l.some(x => /^[a-z]{2}/.test(x.t)) ? 'en' : predefinita;
}
const SICUREZZA = sicuro => ({
  'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(self)', 'cross-origin-opener-policy': 'same-origin',
  ...(sicuro ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
});
// le immagini https sono permesse (i README dei progetti usano badge e immagini da molti domini); script, stili e connessioni solo da qui
const CSP = "default-src 'self'; img-src 'self' data: https:; "
  + "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com";
// un SVG aperto da solo è un documento nella nostra origine: niente script né risorse esterne (i loghi hanno solo <style> e un font in data:)
const CSP_SVG = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:";

export function strumenti(cfg) {
  const sicuro = cfg.url.startsWith('https://');
  const memo = new Map();   // le pagine lette dal disco (in produzione non cambiano)
  const biscotto = (nome, valore, giorni, { http = true } = {}) =>
    `${nome}=${encodeURIComponent(valore)}; Path=/;${http ? ' HttpOnly;' : ''} SameSite=Lax; Max-Age=${Math.round(giorni * 86400)}${sicuro ? '; Secure' : ''}`;
  function rispondi(res, stato, dati, intestazioni = {}) {
    res.writeHead(stato, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SICUREZZA(sicuro), ...intestazioni });
    res.end(JSON.stringify(dati));
  }
  function vai(res, dove, intestazioni = {}) { res.writeHead(302, { location: dove, 'cache-control': 'no-store', ...intestazioni }); res.end(); }
  async function corpoGrezzo(req, max = 256 * 1024) {
    const pezzi = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > max) throw errore(413, 'Richiesta troppo grande'); pezzi.push(c); }
    return Buffer.concat(pezzi).toString('utf8');
  }
  async function json(req, max = 64 * 1024) {
    const t = await corpoGrezzo(req, max);
    let j; try { j = t ? JSON.parse(t) : {}; } catch { throw errore(400, 'JSON non valido'); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw errore(400, 'JSON non valido');
    return j;
  }
  function stessaOrigine(req) {   // le richieste che cambiano qualcosa devono venire da queste pagine (oltre al biscotto SameSite=Lax)
    const o = req.headers.origin;
    if (!o) return req.headers['sec-fetch-site'] ? ['same-origin', 'none'].includes(req.headers['sec-fetch-site']) : true;
    try { const h = new URL(o).host; return h === req.headers.host || h === new URL(cfg.url).host; } catch { return false; }
  }
  async function leggi(file) {
    const p = normalize(join(WEB, file)); if (!p.startsWith(WEB)) return null;
    if (memo.has(p)) return memo.get(p);
    try { const b = await readFile(p); if (process.env.NODE_ENV === 'production') memo.set(p, b); return b; } catch { return null; }
  }
  // il titolo e i meta di condivisione (og:*, description) si traducono sul server: chi condivide il link e i crawler non eseguono lingua.js
  const META = /(<meta (?:property|name)="(?:og:title|og:description|description|twitter:title|twitter:description)" content=")([^"]*)(")/g;
  const traduciMeta = (testo, lingua) => lingua === 'it' ? testo
    : testo.replace(/<title>([^<]*)<\/title>/, (m, t) => `<title>${traduci(t, lingua)}</title>`).replace(META, (m, pre, t, post) => pre + traduci(t, lingua) + post);
  // una pagina o un file statico. Nelle pagine HTML: {{NOME}} è il nome della piattaforma, {{LINGUA}} la lingua scelta
  async function pagina(res, file, { lingua = cfg.lingua, extra = {}, stato = 200 } = {}) {
    const b = await leggi(file); if (!b) return pagina(res, '404.html', { lingua, stato: 404 }).catch(() => rispondi(res, 404, { errore: 'non trovato' }));
    const tipo = extname(file).toLowerCase(), html = tipo === '.html';
    const corpo = html ? Buffer.from(traduciMeta(b.toString('utf8').replaceAll('{{NOME}}', cfg.nome).replaceAll('{{LINGUA}}', lingua).replaceAll('{{URL}}', cfg.url)
      .replace('<html lang="it">', `<html lang="${lingua}"${lingua !== 'it' ? ' class="traduci"' : ''}>`), lingua)) : b;
    // immagini e font restano un giorno nella cache del browser; pagine, script e stili si ricontrollano a ogni visita (così dopo un
    // aggiornamento nessuno resta con il vecchio JS accanto all'HTML nuovo) e, se non sono cambiati, la risposta è un 304 vuoto
    const fisso = ['.webp', '.png', '.jpg', '.woff2', '.ico'].includes(tipo);
    const etag = fisso ? null : `"${createHash('sha1').update(corpo).digest('base64url').slice(0, 22)}"`;
    const intestazioni = { 'content-type': TIPI[tipo] || 'application/octet-stream', 'cache-control': fisso ? 'public, max-age=86400' : extra['set-cookie'] ? 'private, no-cache' : 'no-cache',
      ...(etag ? { etag } : {}), ...(html ? { 'content-security-policy': CSP, vary: 'Accept-Language, Cookie' } : {}),
      ...(tipo === '.svg' ? { 'content-security-policy': CSP_SVG } : {}), ...SICUREZZA(sicuro), ...extra };
    // If-None-Match può elencare più validatori, anche deboli (W/"…", come li riscrive un proxy che comprime): basta che uno coincida
    const inm = String(res.req?.headers['if-none-match'] || '').split(',').map(s => s.trim().replace(/^W\//, ''));
    if (etag && stato === 200 && inm.includes(etag)) { res.writeHead(304, intestazioni); return res.end(); }
    res.writeHead(stato, intestazioni);
    res.end(corpo);
  }
  // una pagina composta sul server (le pagine locali, le alternative, la sitemap): le stesse intestazioni delle pagine dai file
  function html(res, testo, { stato = 200, tipo = '.html', extra = {} } = {}) {
    const corpo = Buffer.from(testo), etag = `"${createHash('sha1').update(corpo).digest('base64url').slice(0, 22)}"`;
    const intestazioni = { 'content-type': TIPI[tipo] || 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300', etag,
      ...(tipo === '.html' ? { 'content-security-policy': CSP } : {}), ...SICUREZZA(sicuro), ...extra };
    const inm = String(res.req?.headers['if-none-match'] || '').split(',').map(s => s.trim().replace(/^W\//, ''));
    if (stato === 200 && inm.includes(etag)) { res.writeHead(304, intestazioni); return res.end(); }
    res.writeHead(stato, intestazioni); res.end(corpo);
  }
  return { biscotto, rispondi, vai, corpoGrezzo, json, stessaOrigine, pagina, html, sicuro, traduci };
}
