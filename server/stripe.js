// Stripe senza librerie: le chiamate REST (corpo application/x-www-form-urlencoded, chiavi annidate a parentesi quadre) e la
// verifica della firma dei webhook (https://docs.stripe.com/webhooks#verify-manually).
import { createHmac, timingSafeEqual } from 'node:crypto';

// {a: {b: 1}, c: [x, y]} → a[b]=1&c[0]=x&c[1]=y
export function modulo(obj, prefisso = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const chiave = prefisso ? `${prefisso}[${k}]` : k;
    if (typeof v === 'object') modulo(v, chiave, out);
    else out.append(chiave, String(v));
  }
  return out;
}

export function clienteStripe({ chiave, base }) {
  async function chiama(metodo, percorso, corpo, { idempotenza } = {}) {
    if (!chiave) throw Object.assign(new Error('Stripe non è configurato: manca STRIPE_CHIAVE'), { stato: 503 });
    const h = { authorization: `Bearer ${chiave}` };
    if (corpo) h['content-type'] = 'application/x-www-form-urlencoded';
    if (idempotenza) h['idempotency-key'] = idempotenza;
    const r = await fetch(`${base}${percorso}`, { method: metodo, headers: h, body: corpo ? modulo(corpo).toString() : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j?.error?.message || `Stripe ha risposto ${r.status}`), { stato: 502, stripe: j?.error });
    return j;
  }
  return {
    post: (p, corpo, o) => chiama('POST', p, corpo, o),
    get: p => chiama('GET', p),
  };
}

// La firma: «Stripe-Signature: t=…,v1=…» con HMAC-SHA256 di «t.corpo» sul segreto whsec_; tolleranza di 5 minuti
export function verificaFirma(corpo, intestazione, segreto, adesso = Date.now(), tolleranza = 300) {
  if (!segreto || !intestazione) return false;
  const parti = Object.groupBy(intestazione.split(',').map(s => s.trim().split('=')), ([k]) => k);
  const t = Number(parti.t?.[0]?.[1]); const firme = (parti.v1 || []).map(([, v]) => v);
  if (!t || !firme.length || Math.abs(adesso / 1000 - t) > tolleranza) return false;
  const attesa = Buffer.from(createHmac('sha256', segreto).update(`${t}.${corpo}`).digest('hex'));
  return firme.some(f => { const b = Buffer.from(f); return b.length === attesa.length && timingSafeEqual(b, attesa); });
}

export function firma(corpo, segreto, t = Math.floor(Date.now() / 1000)) {   // per le prove
  return `t=${t},v1=${createHmac('sha256', segreto).update(`${t}.${corpo}`).digest('hex')}`;
}
