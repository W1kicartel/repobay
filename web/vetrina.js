// Le schede dei prodotti del catalogo, usate dalla home e dal catalogo: nome, repository, descrizione, stelle su GitHub, voto
// medio, installatori, prezzi, e il segno «non rivendicato» per i progetti messi in vetrina prima del loro maintainer.
import { el, t, euro, lingua } from './comune.js';

const icona = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  for (const x of d) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', x); s.append(p); } return s; };
export const ICONE = {
  stella: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'],
  persone: ['M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20', 'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3', 'M15.5 4.2a3.5 3.5 0 0 1 0 6.6'],
  luogo: ['M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z', 'M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  voto: ['M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z', 'M12 7.5l1.3 2.7 3 .4-2.2 2.1.5 3L12 14.3l-2.6 1.4.5-3-2.2-2.1 3-.4z'],
  calendario: ['M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  github: ['M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21'],
  cerca: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-3.5-3.5'],
  carta: ['M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 10h18', 'M7 15h3'],
  wallet: ['M4 7a2 2 0 0 1 2-2h11v4', 'M4 7v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z', 'M16 14h.01'],
};
export const svgIcona = nome => icona(ICONE[nome] || []);

export const NOMI_CATEGORIE = { gestionale: 'Gestionale', cassa: 'Cassa', prenotazioni: 'Prenotazioni', sito: 'Siti web', ecommerce: 'E-commerce', magazzino: 'Magazzino',
  contabilità: 'Contabilità', crm: 'CRM', comunicazione: 'Comunicazione', sanità: 'Sanità', ristorazione: 'Ristorazione', scuola: 'Scuola', altro: 'Altro' };
export const nomeCategoria = c => t(NOMI_CATEGORIE[c] || c);
const numero = n => Number(n || 0).toLocaleString(lingua === 'en' ? 'en-IE' : 'it-IT');
const voto = v => Number(v).toLocaleString(lingua === 'en' ? 'en-IE' : 'it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export { numero, voto as formatoVoto };
// gli euro senza i centesimi quando sono tondi: 390 €, 24,50 €
export const tondo = c => euro(c).replace(/[.,]00(?=\D|$)/, '');

export function scheda(p, { ref } = {}) {
  const segni = [
    el('span', { title: t('Stelle su GitHub') }, svgIcona('stella'), el('b', {}, numero(p.stelle))),
    p.voto ? el('span', { title: t('Voto medio dei clienti') }, svgIcona('voto'), el('b', {}, t('{v} su 5', { v: voto(p.voto) })), el('span', { class: 'tenue' }, `(${p.recensioni || 0})`)) : null,
    el('span', {}, svgIcona('persone'), el('b', {}, String(p.installatori || 0)), ' ', t(p.installatori === 1 ? 'installatore' : 'installatori')),
  ];
  // il prezzo d'ingresso: l'installazione la prezza chi vende, qui il più basso fra loro («da … €»); poi l'assistenza mensile.
  // Senza nessuno che lo venda ancora, lo dice
  const da = p.da_avvio !== undefined ? p.da_avvio : p.prezzo_avvio || null;
  const prezzo = da ? el('span', { class: 'cifra' }, el('span', { class: 'tenue' }, t('da')), el('b', {}, tondo(da)), el('span', { class: 'tenue' }, t('installazione')))
    : el('span', { class: 'tenue' }, t('Il prezzo lo fa chi lo vende'));
  const mese = p.prezzo_mese ? el('span', { class: 'mese' }, t('+ {prezzo} al mese', { prezzo: tondo(p.prezzo_mese) })) : null;
  return el('a', { class: 'carta scheda cliccabile', 'data-cat': p.categoria || 'altro', href: `/p/${encodeURIComponent(p.slug)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}` },
    el('div', { class: 'testa' }, el('span', { class: 'adesivo-cat' }, nomeCategoria(p.categoria)), el('span', { class: `monogramma tinta-${[...String(p.nome || '?')].reduce((h, c) => h + c.charCodeAt(0), 0) % 3}`, 'aria-hidden': 'true', 'data-no-t': '' }, String(p.nome || '?').trim()[0]?.toUpperCase() || '?')),
    el('h3', {}, p.nome),
    el('div', { class: 'repo', 'data-no-t': '' }, p.repo || ''),
    p.rivendicato === false ? el('span', { class: 'pillola non-rivendicato', title: t('Il maintainer non è ancora iscritto: può rivendicarlo entrando con GitHub') }, t('Non rivendicato')) : null,
    el('p', {}, p.descrizione || ''),
    el('div', { class: 'segni' }, ...segni),
    el('div', { class: 'piede' }, prezzo, mese));
}
// le immagini 3D: finché non arrivano resta la cornice tratteggiata; se mancano, l'immagine rotta non si vede. Si ascolta sempre:
// al primo caricamento «complete» può valere true prima che la richiesta parta (e con srcset l'immagine può cambiare dopo)
export function figure(radice = document) {
  for (const img of radice.querySelectorAll('.cornice img')) {
    const fatto = () => { const c = img.closest('.cornice'); c.classList.toggle('piena', !!img.naturalWidth); c.classList.toggle('senza', !img.naturalWidth); };
    img.addEventListener('load', fatto); img.addEventListener('error', fatto);
    if (img.complete) fatto();
  }
}
export const schedaFinta = () => el('div', { class: 'carta scheda finta', 'aria-hidden': 'true' }, el('div', { class: 'scheletro' }), el('div', { class: 'scheletro' }), el('div', { class: 'scheletro' }), el('div', { class: 'scheletro' }));
export const schedeFinte = n => Array.from({ length: n }, schedaFinta);
