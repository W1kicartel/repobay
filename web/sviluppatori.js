// La documentazione: i blocchi di codice con «Copia» e l'indirizzo vero, il link Solana Pay d'esempio calcolato su questo
// indirizzo, e l'indice laterale che segue la sezione che si sta leggendo.
import { $, $$, pronta } from './comune.js';
import './codice.js';
await pronta;

for (const c of $$('#solana pre code')) if (c.textContent.startsWith('solana:')) c.textContent = `solana:${encodeURIComponent(`${location.origin}/api/solana/pay?ordine=`)}<codice>`;

const voci = new Map($$('#indice a').map(a => [a.getAttribute('href').slice(1), a]));
const sezioni = [...voci.keys()].map(id => document.getElementById(id)).filter(Boolean);
const segna = id => { for (const [k, a] of voci) if (k === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); };
const visibili = new Set();
const oss = new IntersectionObserver(l => {
  for (const x of l) if (x.isIntersecting) visibili.add(x.target.id); else visibili.delete(x.target.id);
  const prima = sezioni.find(s => visibili.has(s.id)); if (prima) segna(prima.id);
}, { rootMargin: '-80px 0px -60% 0px' });
for (const s of sezioni) oss.observe(s);
if (location.hash && voci.has(location.hash.slice(1))) segna(location.hash.slice(1)); else if (sezioni[0]) segna(sezioni[0].id);
$('#indice')?.addEventListener('click', e => { const a = e.target.closest('a'); if (a) segna(a.getAttribute('href').slice(1)); });
