// La mia area: menu laterale e sezioni che cambiano con l'hash (#panoramica, #prodotti, …; il tasto indietro funziona),
// gli avvisi che arrivano dai link (?email=…, ?stripe=…, ?rivendicato=1) e il promemoria dell'email da confermare.
import { $, $$, el, t, chiama, occupato, pronta } from './comune.js';
import { S, prendiIo, scheletro } from './area-base.js';
import { panoramica } from './area-panoramica.js';
import { prodotti, installo } from './area-prodotti.js';
import { vendite, richieste } from './area-clienti.js';
import { assistenza } from './area-assistenza.js';
import { installazioni } from './area-installazioni.js';
import { soldi } from './area-soldi.js';
import { integrazioni, sviluppatori } from './area-integrazioni.js';
import { notifiche, sicurezza, profilo, dati } from './area-conto.js';
await pronta;

const SEZIONI = { panoramica, prodotti, installo, vendite, installazioni, richieste, assistenza, soldi, integrazioni, sviluppatori, notifiche, sicurezza, profilo, dati };
const TITOLI = { panoramica: 'Panoramica', prodotti: 'I miei prodotti', installo: 'Installo', vendite: 'Vendite', installazioni: 'Installazioni', richieste: 'Richieste e recensioni', assistenza: 'Assistenza', soldi: 'Soldi',
  integrazioni: 'Integrazioni', sviluppatori: 'Sviluppatori', notifiche: 'Notifiche', sicurezza: 'Sicurezza', profilo: 'Profilo', dati: 'I tuoi dati' };
// i link delle notifiche e delle email usano anche questi nomi
// il numero di ogni sezione (come nel menu) e il gruppo: in cima alla sezione e nel codice di tavola in un angolo (RB-A06)
const ORDINE = Object.keys(SEZIONI), GRUPPO = { prodotti: 'Lavoro', installo: 'Lavoro', vendite: 'Lavoro', installazioni: 'Lavoro', richieste: 'Lavoro', assistenza: 'Lavoro', soldi: 'Soldi', integrazioni: 'Soldi',
  sviluppatori: 'Soldi', notifiche: 'Conto', sicurezza: 'Conto', profilo: 'Conto', dati: 'Conto' };
const ALIAS = { clienti: 'richieste', guadagni: 'soldi', fisco: 'soldi/fiscale', wallet: 'soldi/wallet', progetti: 'prodotti', account: 'profilo', '2fa': 'sicurezza/2fa' };
const sezione = $('#sezione'), nomeSito = document.title.split('·').pop().trim();

// la sezione dell'hash; null se l'hash non è una sezione (#contenuto del link «Vai al contenuto»): lì la pagina resta com'è
function dove() {
  let h; try { h = decodeURIComponent(location.hash.slice(1)) || 'panoramica'; } catch { return null; }
  h = ALIAS[h] || h;
  const [s, sotto] = h.split('/');
  return SEZIONI[s] ? { s, sotto } : null;
}

let giro = 0;
async function mostra({ primo = false } = {}) {
  const { s, sotto } = dove() || { s: 'panoramica' }, mio = ++giro;
  $$('#menu-area a').forEach(a => (a.dataset.s === s ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const nav = $('#menu-area'), voce = nav.querySelector('[aria-current]');   // sul telefono il menu scorre: la voce scelta resta in vista
  if (voce && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: voce.offsetLeft - nav.offsetLeft - (nav.clientWidth - voce.offsetWidth) / 2, behavior: primo ? 'auto' : 'smooth' });
  document.title = `${t(TITOLI[s])} · ${document.title.split('·').pop().trim() || nomeSito}`;
  if (!S.io || Date.now() - S.preso > 30e3) {
    if (!primo) sezione.replaceChildren(scheletro(4, true));
    try { await prendiIo(); }
    catch (e) { if (e.stato === 401) { location.href = `/accedi?dopo=${encodeURIComponent('/area' + location.hash)}`; return; } sezione.replaceChildren(el('div', { class: 'avviso errore' }, e.message)); return; }
  }
  if (mio !== giro) return;
  promemoria();
  const corpo = el('div', { class: `sezione-area sezione-${s}` });
  sezione.replaceChildren(corpo);
  const n = String(ORDINE.indexOf(s) + 1).padStart(2, '0');
  sezione.dataset.codice = `RB-A${n}`;
  try { await SEZIONI[s](corpo, S.io, sotto); }
  catch (e) { console.error(e); corpo.replaceChildren(el('div', { class: 'avviso errore' }, e.message || t('Qualcosa non ha funzionato: riprova'))); }
  if (mio !== giro) return;
  corpo.querySelector('.testa-sezione > div')?.prepend(el('div', { class: 'numero-sezione', dati: { n } }, t(GRUPPO[s] || 'Panoramica')));
  // la sotto-parte richiesta (#soldi/fiscale): si scorre fin lì
  const qui = sotto && sezione.querySelector(`[data-blocco="${sotto}"]`);
  if (qui) setTimeout(() => qui.scrollIntoView({ block: 'start' }), 60);
  else if (!primo) scrollTo({ top: 0 });
  contatori();
}

// il promemoria dell'email da confermare
function promemoria() {
  const box = $('#avvisi-area'), io = S.io;
  box.querySelector('.da-confermare')?.remove();
  if (io.email && !io.emailVerificata) {
    const m = el('span', { class: 'piccolo' });
    const b = el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: () => occupato(b, async () => {
      await chiama('POST', '/api/email/rinvia', {}); m.textContent = t('Mandata: controlla anche lo spam.'); b.remove();
    }, m) }, t('Rimanda l\'email'));
    box.prepend(el('div', { class: 'avviso attesa da-confermare' }, el('div', { class: 'cresce' }, el('strong', {}, t('Conferma la tua email.')), ' ',
      t('Ti abbiamo scritto a {email}: apri il link per confermarla.', { email: io.email }), ' ', m), b));
  }
}
// gli avvisi dei link (conferma dell'email, ritorno da Stripe, progetti rivendicati)
function avvisiDaLink() {
  const q = new URLSearchParams(location.search), box = $('#avvisi-area');
  const MSG = {
    'email=verificata': ['ok', 'Email confermata. Grazie.'],
    'email=scaduto': ['errore', 'Il link di conferma è scaduto o è già stato usato. Se serve, chiedine un altro.'],
    'email=occupata': ['errore', 'Questa email è già usata da un altro conto: non l\'abbiamo cambiata.'],
    'stripe=fatto': ['ok', 'Fatto. Stripe sta controllando i tuoi dati: di solito bastano pochi minuti.'],
    'stripe=rinnova': ['attesa', 'Il link di Stripe è scaduto: premi di nuovo «Completa qui».'],
    'rivendicato=1': ['ok', 'Progetti rivendicati: le quote in attesa ora sono tue. Collega il conto per riceverle.'],
  };
  let c = false;
  for (const [k, v] of q) {
    const m = MSG[`${k}=${v}`]; if (!m) continue; c = true;
    const x = el('div', { class: `avviso ${m[0]}`, role: 'status' }, el('span', { class: 'cresce' }, t(m[1])),
      el('button', { type: 'button', class: 'chiudi', 'aria-label': t('Chiudi'), onclick: () => x.remove() }, '×'));
    box.append(x);
  }
  if (c) history.replaceState(null, '', location.pathname + location.hash);
}
// i numerini nel menu: notifiche non lette, inviti da accettare
function contatori() {
  const io = S.io; if (!io) return;
  // e le proposte di un'altra divisione che aspettano la tua risposta
  const daRispondere = (l, lato) => l.filter(a => a.proposta && a.proposta.da === lato).length;
  const n = { notifiche: io.nonLette, assistenza: io.assistenzaAperte, installo: io.collaborazioni.filter(x => x.stato === 'invitato').length + daRispondere(io.adozioni, 'builder'),
    prodotti: io.prodotti.reduce((s, p) => s + daRispondere(p.accordi || [], 'installatore'), 0) };
  for (const a of $$('#menu-area a')) {
    a.querySelector('.conta')?.remove();
    if (n[a.dataset.s]) a.append(el('span', { class: 'conta', title: t('{n} da vedere', { n: n[a.dataset.s] }) }, String(n[a.dataset.s])));
  }
}
document.addEventListener('area:io', contatori);

addEventListener('hashchange', () => { if (dove()) mostra(); });
avvisiDaLink();
await mostra({ primo: true });
