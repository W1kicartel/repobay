// La lingua delle pagine. L'italiano è scritto nelle pagine; per l'inglese il dizionario /lingue/en.json (frasi italiane come
// chiavi, segnaposto {nome} per le parti variabili). Si traducono da soli i testi e gli attributi (placeholder, title,
// aria-label, alt) anche di quello che gli script aggiungono dopo: chi scrive le pagine scrive in italiano e basta.
export const lingua = document.documentElement.lang === 'en' ? 'en' : 'it';
const ATTR = ['placeholder', 'title', 'aria-label', 'alt'];
let diz = {}, modelli = [];

export function t(frase, valori = {}) {   // t('{n} installatori', { n: 3 })
  let s = String(frase);
  if (lingua === 'en') {
    if (diz[s] !== undefined) s = diz[s];
    else for (const m of modelli) { const x = s.match(m.re); if (x) { s = m.nomi.reduce((r, n, i) => r.replaceAll(`{${n}}`, () => x[i + 1]), m.v); break; } }
  }
  return s.replace(/\{(\w+)\}/g, (q, n) => (Object.hasOwn(valori, n) ? valori[n] : q));
}
const tradotta = s => { const k = s.trim(); if (!k || !/[a-zà-ù]/i.test(k)) return null; const v = t(k); return v !== k ? s.replace(k, v) : null; };
function traduciNodo(n) {
  if (n.nodeType === 3) { if (n.parentElement?.closest('script, style, code, pre, .readme, [data-no-t]')) return; const v = tradotta(n.nodeValue); if (v !== null) n.nodeValue = v; return; }
  if (n.nodeType !== 1 || n.closest?.('[data-no-t], .readme')) return;
  for (const a of ATTR) if (n.hasAttribute?.(a)) { const v = tradotta(n.getAttribute(a)); if (v !== null) n.setAttribute(a, v); }
  if (n.tagName === 'TITLE') { const v = tradotta(n.textContent); if (v !== null) n.textContent = v; }
  for (const c of n.childNodes) traduciNodo(c);
}
export const pronta = (async () => {
  if (lingua !== 'en') return;
  try { diz = await fetch('/lingue/en.json').then(r => r.json()); } catch { diz = {}; }
  modelli = Object.entries(diz).filter(([k]) => /\{\w+\}/.test(k)).map(([k, v]) => {
    const nomi = []; const re = new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(\w+)\\?\}/g, (_, n) => { nomi.push(n); return '(.+?)'; }) + '$');
    return { re, nomi, v };
  });
  if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  traduciNodo(document.head); traduciNodo(document.body);
  new MutationObserver(l => { for (const m of l) { if (m.type === 'characterData') traduciNodo(m.target); else for (const n of m.addedNodes) traduciNodo(n); } })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
})().finally(() => document.documentElement.classList.remove('traduci'));
