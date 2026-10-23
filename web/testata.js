// La testata e il piede comuni: il marchio, il menu (a tendina sul telefono), la lingua, la campanella delle notifiche e il menu
// di chi è entrato. Il nome della piattaforma arriva dal server (/api/sessione).
import { chiama, el, t, lingua, pronta, avatar, dataOra, $ } from './comune.js';
import './movimento.js';
await pronta;
const qui = location.pathname;
const SVG = s => { const d = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s}</svg>`, 'image/svg+xml').documentElement; return document.importNode(d, true); };
const CAMPANA = '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', MENU = '<path d="M4 6h16M4 12h16M4 18h16"/>';
let s = { dentro: false, nome: document.title.split('·').pop().trim() || '' };
try { s = await chiama('GET', '/api/sessione'); } catch { }
document.title = document.title.replace(/·\s*[^·]*$/, `· ${s.nome}`);

// il segno del marchio: la R di Repobay (web/marchio/); con un altro APP_NOME resta l'iniziale
const segno = (s, scuro) => s.nome === 'Repobay' ? el('img', { class: 'segno-marchio', src: scuro ? '/marchio/simbolo-chiaro.svg' : '/marchio/simbolo.svg', alt: '', width: 30, height: 30 })
  : el('span', { class: 'segno', 'aria-hidden': 'true' }, s.nome[0] || '');
const h = $('header.barra');
if (h) {
  const voci = [['/esplora', 'Prodotti'], ['/builder', 'Per chi sviluppa'], ['/installatori', 'Per chi installa'], ['/sviluppatori', 'API']];
  const nav = el('nav', { class: 'menu', id: 'menu', 'aria-label': t('Menu principale') }, ...voci.map(([href, x]) => el('a', { href, class: qui === href ? 'qui' : '' }, t(x))));
  const lingue = el('div', { class: 'lingue', role: 'group', 'aria-label': t('Lingua') }, ...['it', 'en'].map(l => el('button', { type: 'button', 'aria-pressed': String(lingua === l),
    onclick: async () => { if (l === lingua) return; await chiama('POST', '/api/lingua', { lingua: l }).catch(() => {}); location.reload(); } }, l.toUpperCase())));
  const destra = el('div', { class: 'destra' }, lingue);
  const ham = el('button', { class: 'icona-bottone hamburger', 'aria-label': t('Apri il menu'), 'aria-expanded': 'false', 'aria-controls': 'menu',
    onclick: () => { const a = nav.classList.toggle('aperto'); ham.setAttribute('aria-expanded', String(a)); } }, SVG(MENU));
  if (s.dentro) {
    // la campanella: le ultime notifiche, segnate come lette quando si apre
    const contatore = el('span', { class: `contatore${s.nonLette ? '' : ' nascosto'}` }, String(s.nonLette || ''));
    const lista = el('div', { class: 'tendina nascosto', role: 'menu' });
    const campana = el('button', { class: 'icona-bottone', 'aria-label': t('Notifiche'), 'aria-haspopup': 'true', onclick: async e => {
      e.stopPropagation(); menuU.classList.add('nascosto');
      if (!lista.classList.toggle('nascosto')) {
        lista.replaceChildren(el('div', { class: 'scheletro' })); const n = await chiama('GET', '/api/notifiche').catch(() => ({ notifiche: [] }));
        lista.replaceChildren(...(n.notifiche.length ? n.notifiche.slice(0, 12).map(x => el('a', { href: x.link || '/area', class: `notifica${x.letta ? '' : ' nuova'}` }, el('span', {}, x.testo, el('br'), el('small', {}, dataOra(x.creata)))))
          : [el('p', { class: 'tenue piccolo', style: null }, t('Nessuna notifica, per ora.'))]), el('a', { href: '/area#notifiche', class: 'piccolo tenue' }, t('Tutte le notifiche e le preferenze')));
        if (s.nonLette) { chiama('POST', '/api/notifiche/lette', {}).catch(() => {}); contatore.classList.add('nascosto'); s.nonLette = 0; }
      } } }, SVG(CAMPANA), contatore);
    const menuU = el('div', { class: 'tendina nascosto', role: 'menu' }, el('a', { href: '/area' }, t('La mia area')), s.admin ? el('a', { href: '/admin' }, t('Pannello')) : null,
      el('a', { href: '/area#sicurezza' }, t('Sicurezza')), el('button', { class: 'voce', onclick: async () => { await chiama('POST', '/api/uscita', {}).catch(() => {}); location.href = '/'; } }, t('Esci')));
    const io = el('button', { class: 'icona-bottone', 'aria-label': t('Il tuo conto'), 'aria-haspopup': 'true', onclick: e => { e.stopPropagation(); lista.classList.add('nascosto'); menuU.classList.toggle('nascosto'); } }, avatar(s.utente));
    io.querySelector('.avatar').classList.add('piccolo');
    destra.append(el('div', { class: 'ancorata' }, campana, lista), el('div', { class: 'ancorata' }, io, menuU));
    document.addEventListener('click', e => { if (!e.target.closest('.ancorata')) { lista.classList.add('nascosto'); menuU.classList.add('nascosto'); } });
  } else destra.append(el('a', { href: '/accedi', class: 'bottone fantasma piccolo' }, t('Accedi')), el('a', { href: '/accedi?iscriviti=1', class: 'bottone piccolo magnetico' }, t('Inizia')));
  destra.append(ham);
  h.replaceChildren(el('div', { class: 'contenitore dentro' }, el('a', { class: 'marchio', href: '/', 'aria-label': s.nome }, segno(s, true), el('span', { class: 'marchio-nome' }, s.nome)), nav, destra));
  addEventListener('scroll', () => h.classList.toggle('scorsa', scrollY > 8), { passive: true });
}
const f = $('footer.piede');
if (f) {
  const col = (titolo, voci) => el('div', {}, el('h4', {}, t(titolo)), ...voci.map(([href, x]) => el('a', { href }, t(x))));
  f.replaceChildren(el('div', { class: 'contenitore colonne' },
    el('div', {}, el('a', { class: 'marchio', href: '/' }, segno(s, true), s.nome),
      el('p', { class: 'tenue piccolo' }, t('Il software open source installato nelle attività vere. Chi lo scrive e chi lo installa si dividono ogni pagamento.'))),
    col('Prodotto', [['/esplora', 'Catalogo'], ['/builder', 'Per chi sviluppa'], ['/installatori', 'Per chi installa'], ['/zone', 'Installatori per provincia'], ['/mappa', 'Mappa delle installazioni'], ['/alternative', 'Alternative open source'], ['/cliente', 'Area clienti']]),
    col('Sviluppatori', [['/sviluppatori', 'API e webhook'], ['/api/v1/openapi.json', 'OpenAPI']]),
    col('Legale', [['/garanzia', 'Garanzia'], ['/contratto', 'Condizioni'], ['/privacy', 'Privacy']])));
}
