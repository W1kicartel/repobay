// La mappa delle installazioni: l'Italia disegnata nel sito (/img/italia.svg, un punto per provincia) e i conteggi di /api/mappa.
// Un pallino per provincia con il numero di aziende, l'elenco accanto (lo stesso, da leggere), il totale. Con zero aziende la
// mappa resta vuota e lo dice: nessun numero inventato. Mentre la pagina è aperta (e si vede) i conteggi si richiedono da soli
// ogni quaranta secondi: una vendita chiusa compare senza ricaricare, e il suo pallino fa un piccolo salto.
import { chiama, el, t, lingua, pronta, $, conta, svg } from './comune.js';
await pronta;

const NS = 'http://www.w3.org/2000/svg', OGNI = 40e3;
const s = (tag, attr = {}, ...figli) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attr)) e.setAttribute(k, v); e.append(...figli); return e; };
const numero = n => Number(n).toLocaleString(lingua === 'en' ? 'en-IE' : 'it-IT');
// il raggio cresce con la radice: l'area del pallino è proporzionale alle aziende
const raggio = n => Math.min(30, 5 + 4 * Math.sqrt(n));

const tavola = $('#tavola');
let mappa = null, prima = null, chiesto = 0;   // prima: le aziende per provincia dell'ultimo disegno (per far saltare i pallini nuovi)

function disegna(d) {
  mappa.setAttribute('aria-label', d.zone.length ? t('Mappa dell\'Italia: {a} in {p}', { a: conta(d.aziende, 'azienda', 'aziende'), p: conta(d.zone.length, 'provincia', 'province') })
    : t('Mappa dell\'Italia, ancora senza installazioni'));

  // i pallini: dal più grande al più piccolo, così quelli piccoli vicini restano visibili sopra
  mappa.querySelector('.pallini')?.remove();
  for (const p of mappa.querySelectorAll('.province circle.acceso')) p.classList.remove('acceso');
  const strato = s('g', { class: 'pallini' }), perSigla = new Map();
  for (const z of [...d.zone].sort((a, b) => b.aziende - a.aziende)) {
    const p = mappa.querySelector(`.province circle[data-sigla="${z.sigla}"]`); if (!p) continue;
    p.classList.add('acceso');
    const r = raggio(z.aziende), cifre = String(z.aziende).length, nuovo = prima && z.aziende > (prima.get(z.sigla) || 0);
    const g = s('g', { class: `pallino${nuovo ? ' nuovo' : ''}`, 'data-sigla': z.sigla },
      s('title', {}, `${z.nome} · ${conta(z.aziende, 'azienda', 'aziende')}`),
      s('circle', { cx: p.getAttribute('cx'), cy: p.getAttribute('cy'), r: r.toFixed(1) }),
      s('text', { x: p.getAttribute('cx'), y: p.getAttribute('cy'), 'font-size': (r * (cifre > 2 ? 0.75 : cifre > 1 ? 0.95 : 1.15)).toFixed(1) }, numero(z.aziende)));
    strato.append(g); perSigla.set(z.sigla, g);
  }
  mappa.append(strato);
  prima = new Map(d.zone.map(z => [z.sigla, z.aziende]));

  // il totale (si riscrive solo se cambia: è una regione aria-live, non va riletto a ogni giro) e l'elenco
  const scrivi = (sel, testo) => { if ($(sel).textContent !== testo) $(sel).textContent = testo; };
  scrivi('#totale', numero(d.aziende));
  scrivi('#unita', t(d.aziende === 1 ? 'azienda' : 'aziende'));
  scrivi('#dettaglio', d.installazioni > d.aziende ? t('{n} programmi installati', { n: numero(d.installazioni) }) : '');
  const elenco = $('#elenco');
  elenco.replaceChildren(...d.zone.map(z => {
    const li = el('li', { dati: { sigla: z.sigla } }, el('span', { class: 'mappa-provincia', 'data-no-t': '' }, z.nome, el('small', {}, z.regione)), el('strong', {}, numero(z.aziende)));
    // passando sull'elenco si accende il pallino, e viceversa
    const g = perSigla.get(z.sigla), accendi = v => { li.classList.toggle('acceso', v); g?.classList.toggle('acceso', v); };
    li.addEventListener('pointerenter', () => accendi(true)); li.addEventListener('pointerleave', () => accendi(false));
    g?.addEventListener('pointerenter', () => accendi(true)); g?.addEventListener('pointerleave', () => accendi(false));
    return li;
  }));
  $('#senza').textContent = !d.senzaZona ? '' : d.senzaZona === 1 ? t('1 azienda del totale non ha una provincia: chi l\'ha installata lavora in tutta una regione o da remoto.')
    : t('{n} aziende del totale non hanno una provincia: chi le ha installate lavora in tutta una regione o da remoto.', { n: numero(d.senzaZona) });
  $('#senza').classList.toggle('nascosto', !d.senzaZona);
  $('#vuota').classList.toggle('nascosto', d.aziende > 0); tavola.classList.toggle('vuota', d.aziende === 0);
  if (d.giorni) $('#regola').textContent = t('Un\'azienda conta quando la vendita è chiusa: chi ha comprato ha confermato l\'installazione, il programma ha risposto online alla fine dell\'installazione, oppure sono passati {n} giorni dal pagamento senza contestazioni, come per i soldi di chi installa.', { n: d.giorni });
  $('#ora').textContent = t('Dati delle {ora}', { ora: new Date(d.aggiornato).toLocaleTimeString(lingua === 'en' ? 'en-GB' : 'it-IT', { hour: '2-digit', minute: '2-digit' }) });
}

// i conteggi di adesso; se la rete manca per un giro, resta il disegno di prima
async function aggiorna() {
  if (document.hidden) return;
  chiesto = Date.now();
  try { disegna(await chiama('GET', '/api/mappa')); } catch { }
}

try {
  const [disegno, d] = await Promise.all([fetch('/img/italia.svg').then(r => { if (!r.ok) throw new Error(); return r.text(); }), chiama('GET', '/api/mappa')]);
  mappa = svg(disegno);
  mappa.removeAttribute('width'); mappa.removeAttribute('height');
  mappa.querySelector('title')?.remove();
  $('#disegno').append(mappa);
  chiesto = Date.now(); disegna(d);
  setInterval(aggiorna, OGNI);
  // tornando sulla scheda dopo un po', i numeri si aggiornano subito
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - chiesto > OGNI) aggiorna(); });
} catch {
  $('#disegno').replaceChildren(el('p', { class: 'mappa-errore' }, t('Non riesco a caricare la mappa: riprova fra poco.')));
} finally {
  tavola.setAttribute('aria-busy', 'false');
}
