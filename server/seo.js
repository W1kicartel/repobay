// Le pagine per i motori di ricerca, composte sul server (chi cerca su Google le trova già scritte, senza aspettare il JavaScript):
//   /zone                          le province dove c'è almeno un installatore
//   /zona/<provincia>              i programmi con chi li installa in quella provincia
//   /zona/<provincia>/<categoria>  per esempio «Gestionali open source a Bergamo»
//   /p/<prodotto>/<provincia>      per esempio «Odoo a Bergamo: chi lo installa»
//   /alternative, /alternative/<nome>   «Alternative open source a Fatture in Cloud» e simili (server/alternative.json)
//   /sitemap.xml, /robots.txt
// Una pagina locale esiste solo se in quella provincia lavora davvero un installatore abilitato (corso, esperienza, programma partner):
// niente pagine vuote. Chi lavora «da remoto» compare nelle pagine che esistono già, ma non ne apre di nuove.
import { readFileSync } from 'node:fs';
import { PROVINCE, REGIONI, zoneDi, provinciaDaSlug } from './province.js';
import { manca, difficoltaDi } from './corso.js';
import { leggiJson } from './contenuti.js';

export const ALTERNATIVE = JSON.parse(readFileSync(new URL('./alternative.json', import.meta.url), 'utf8'));
// le categorie nelle pagine: lo slug nell'indirizzo e il titolo al plurale
export const CATEGORIE_SEO = { gestionale: ['gestionali', 'Gestionali'], cassa: ['cassa', 'Programmi di cassa'], prenotazioni: ['prenotazioni', 'Agende e prenotazioni'],
  sito: ['siti-web', 'Siti web'], ecommerce: ['e-commerce', 'E-commerce'], magazzino: ['magazzino', 'Programmi per il magazzino'], 'contabilità': ['contabilita', 'Contabilità e fatture'],
  crm: ['crm', 'CRM'], comunicazione: ['comunicazione', 'Programmi per comunicare'], 'sanità': ['sanita', 'Programmi per la sanità'], ristorazione: ['ristorazione', 'Programmi per la ristorazione'],
  scuola: ['scuola', 'Programmi per scuola e formazione'], altro: ['altri-programmi', 'Altri programmi per l\'ufficio'] };
const categoriaDaSlug = s => Object.keys(CATEGORIE_SEO).find(k => CATEGORIE_SEO[k][0] === s) || null;
const DIFFICOLTA = { facile: 'facile', media: 'media', impegnativa: 'impegnativa' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const euro = cent => `${(cent / 100).toLocaleString('it-IT', { minimumFractionDigits: cent % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;
const ld = x => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`;
const piu = (n, uno, tanti) => `${n} ${n === 1 ? uno : tanti}`;
// i prezzi: l'installazione la decide chi vende («da … €» se fra i venditori sono diversi), l'assistenza mensile è della piattaforma.
// inst: i venditori di cui parla la pagina (quelli di una provincia), altrimenti tutti quelli del prodotto
const fascia = (p, inst) => { const l = (inst || p.venditori || []).map(i => i.prezzo).filter(v => v > 0); return l.length ? { min: Math.min(...l), max: Math.max(...l), n: l.length } : null; };
const prezzi = (p, inst = null) => { const f = fascia(p, inst);
  return [f ? `installazione ${f.min < f.max ? 'da ' : ''}${euro(f.min)}` : null, p.prezzo_mese > 0 ? `assistenza ${euro(p.prezzo_mese)} al mese` : null].filter(Boolean).join(', '); };
const offerta = (p, inst, url) => { const f = fascia(p, inst), dove = url ? { url } : {};
  if (!f) return {};
  return f.min === f.max ? { offers: { '@type': 'Offer', price: (f.min / 100).toFixed(2), priceCurrency: 'EUR', ...dove } }
    : { offers: { '@type': 'AggregateOffer', lowPrice: (f.min / 100).toFixed(2), highPrice: (f.max / 100).toFixed(2), offerCount: f.n, priceCurrency: 'EUR', ...dove } }; };

export function creaSeo(c) {
  const { db, cfg } = c;
  const assoluto = percorso => `${cfg.url}${percorso}`;
  const voto = id => db.prepare('SELECT ROUND(AVG(voto), 1) media, COUNT(*) n FROM recensione WHERE installatore = ? AND nascosta = 0').get(id);
  const confermate = id => db.prepare('SELECT COUNT(*) n FROM cliente WHERE installatore = ? AND confermato IS NOT NULL').get(id).n;

  // chi installa cosa, e dove: le stesse adozioni che compaiono sulla pagina del prodotto
  function copertura() {
    const righe = db.prepare(`SELECT a.zona, a.programma_accettato, a.installatore, u.nome AS inome, u.codice AS icodice, u.corso, u.esperto, COALESCE(a.prezzo_avvio, p.prezzo_avvio) AS iprezzo,
        p.id, p.slug, p.nome, p.descrizione, p.categoria, p.prezzo_avvio, p.prezzo_mese, p.installazione, p.idee, p.builder, p.programma_obbligatorio, p.licenza, p.aggiornato
      FROM adozione a JOIN utente u ON u.id = a.installatore JOIN prodotto p ON p.id = a.prodotto JOIN utente b ON b.id = p.builder
      WHERE p.stato = 'pubblicato' AND u.stato = 'attivo' AND b.stato IN ('attivo', 'non_rivendicato') ORDER BY a.creato`).all();
    const prodotti = new Map(), locali = new Map(), remoti = new Map();   // locali: sigla → id prodotto → installatori
    for (const r of righe) {
      if (r.programma_obbligatorio && !r.programma_accettato) continue;
      if (manca(db, cfg, { id: r.installatore, corso: r.corso, esperto: r.esperto }, r)) continue;
      if (!prodotti.has(r.id)) prodotti.set(r.id, { ...r, venditori: [] });
      const inst = { id: r.installatore, nome: r.inome, codice: r.icodice, zona: r.zona, prezzo: r.iprezzo }, z = zoneDi(r.zona);
      prodotti.get(r.id).venditori.push(inst);
      for (const s of z.province) {
        if (!locali.has(s)) locali.set(s, new Map());
        const m = locali.get(s); if (!m.has(r.id)) m.set(r.id, []); m.get(r.id).push(inst);
      }
      if (z.remoto) { if (!remoti.has(r.id)) remoti.set(r.id, []); remoti.get(r.id).push(inst); }
    }
    return { prodotti, locali, remoti };
  }
  const provinceDi = (cop, pid) => PROVINCE.filter(pr => cop.locali.get(pr.sigla)?.has(pid));

  // ---------------- i pezzi delle pagine ----------------
  function layout({ titolo, descrizione, percorso, briciole, corpo, dati = [] }) {
    const canonico = assoluto(percorso);
    const lista = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: briciole.map(([nome, url], i) => ({ '@type': 'ListItem', position: i + 1, name: nome, item: assoluto(url) })) };
    return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titolo)} · ${esc(cfg.nome)}</title>
<meta name="description" content="${esc(descrizione)}"><link rel="canonical" href="${esc(canonico)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(cfg.nome)}"><meta property="og:title" content="${esc(titolo)}"><meta property="og:description" content="${esc(descrizione)}">
<meta property="og:url" content="${esc(canonico)}"><meta property="og:image" content="${esc(cfg.url)}/img/og.png"><meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#0D0B11">
<link rel="stylesheet" href="/stile.css"><link rel="stylesheet" href="/stile-pubblico.css"><link rel="stylesheet" href="/stile-zone.css"><link rel="icon" href="/icona.svg" type="image/svg+xml">
${ld(lista)}${dati.map(ld).join('')}
</head>
<body>
<a class="salta" href="#contenuto">Vai al contenuto</a>
<header class="barra"></header>
<main id="contenuto" class="contenitore zone" data-no-t>
<nav class="z-briciole" aria-label="Sei qui">${briciole.map(([nome, url], i) => i < briciole.length - 1 ? `<a href="${esc(url)}">${esc(nome)}</a>` : `<span aria-current="page">${esc(nome)}</span>`).join('<span aria-hidden="true">/</span>')}</nav>
${corpo}
</main>
<footer class="piede"></footer>
<script type="module" src="/testata.js"></script>
</body>
</html>`;
  }
  function schedaInstallatore(i, slug) {
    const v = voto(i.id), n = confermate(i.id);
    return `<li class="z-inst"><div class="z-inst-dati"><a class="z-inst-nome" href="/u/${esc(i.codice)}">${esc(i.nome)}</a><span class="z-zona">${esc(i.zona || '')}</span>
      <span class="z-fiducia">${v.n ? `${String(v.media).replace('.', ',')} su 5 · ${piu(v.n, 'recensione', 'recensioni')}` : 'Ancora senza recensioni'}${n ? ` · ${piu(n, 'installazione confermata', 'installazioni confermate')}` : ''}</span></div>
      ${slug ? `<span class="z-inst-prezzo">installazione <b>${euro(i.prezzo)}</b></span><a class="bottone piccolo" href="/p/${esc(slug)}?ref=${esc(i.codice)}">Scegli ${esc(i.nome.split(' ')[0])}</a>` : ''}</li>`;
  }
  // inst: chi lo vende nella provincia della pagina (i prezzi e il conto sono i loro)
  function schedaProdotto(p, inst, prov) {
    const url = prov ? `/p/${p.slug}/${prov.slug}` : `/p/${p.slug}`, quanti = inst?.length || 0;
    return `<li class="z-prod"><a class="z-prod-nome" href="${esc(url)}">${esc(p.nome)}</a><p>${esc(p.descrizione)}</p>
      <p class="z-meta">${esc(prezzi(p, inst))}${quanti ? ` · ${piu(quanti, 'installatore', 'installatori')}${prov ? ` a ${esc(prov.nome)}` : ''}` : ''}</p></li>`;
  }
  const COME = `<section class="z-blocco"><h2>Come funziona</h2><ol class="z-passi">
    <li><b>Scegli chi lo installa.</b> Vedi le recensioni e le installazioni confermate dagli altri clienti.</li>
    <li><b>Paghi sulla piattaforma.</b> Con carta il pagamento resta trattenuto 14 giorni: confermi l'installazione o segnali un problema.</li>
    <li><b>Il programma è tuo.</b> Gira sul tuo server o in ufficio, i dati restano tuoi, e l'assistenza mensile${cfg.assistenzaPiattaforma ? `, di chi installa con ${esc(cfg.nome)} dietro,` : ''} si disdice quando vuoi.</li></ol></section>`;

  // ---------------- le pagine ----------------
  function zone() {
    const cop = copertura();
    const regioni = REGIONI.map(r => ({ r, province: PROVINCE.filter(p => p.regione === r && cop.locali.has(p.sigla)) })).filter(x => x.province.length);
    const corpo = `<header class="z-testa"><h1>Installatori di software open source per provincia</h1>
      <p class="z-sotto">Le province dove un installatore iscritto a ${esc(cfg.nome)} lavora di persona: scegli la tua e trovi i programmi che installa e segue ogni mese.</p></header>
      ${regioni.length ? regioni.map(({ r, province }) => `<section class="z-blocco"><h2>${esc(r)}</h2><ul class="z-province">${province.map(p => {
        const m = cop.locali.get(p.sigla), inst = new Set([...m.values()].flat().map(i => i.id)).size;
        return `<li><a href="/zona/${p.slug}">${esc(p.nome)}</a><span>${piu(m.size, 'programma', 'programmi')} · ${piu(inst, 'installatore', 'installatori')}</span></li>`;
      }).join('')}</ul></section>`).join('') : '<p class="z-vuoto">Gli installatori si stanno iscrivendo: le prime province arrivano a breve.</p>'}
      <p class="z-nota"><a href="/installatori">Installi programmi nella tua zona? Iscriviti a ${esc(cfg.nome)}</a></p>`;
    return layout({ titolo: 'Installatori di software open source per provincia', descrizione: `Le province italiane dove trovi un installatore di software open source per la tua attività, con installazione e assistenza mensile.`,
      percorso: '/zone', briciole: [[cfg.nome, '/'], ['Zone', '/zone']], corpo });
  }

  function provincia(slugProv) {
    const prov = provinciaDaSlug(slugProv), cop = copertura(), m = prov && cop.locali.get(prov.sigla);
    if (!m) return null;
    const perCat = new Map();
    for (const [pid, inst] of m) { const p = cop.prodotti.get(pid); if (!perCat.has(p.categoria)) perCat.set(p.categoria, []); perCat.get(p.categoria).push([p, inst]); }
    const installatori = [...new Map([...m.values()].flat().map(i => [i.id, i])).values()];
    const corpo = `<header class="z-testa"><h1>Software open source a ${esc(prov.nome)}, installato e seguito ogni mese</h1>
      <p class="z-sotto">A ${esc(prov.nome)} ${installatori.length === 1 ? 'lavora un installatore iscritto' : `lavorano ${installatori.length} installatori iscritti`} a ${esc(cfg.nome)}, con ${piu(m.size, 'programma', 'programmi')} del catalogo: gestionali, agende, siti e altro, installati sul tuo server o in ufficio.</p></header>
      ${[...perCat].map(([cat, lista]) => `<section class="z-blocco"><h2><a href="/zona/${prov.slug}/${CATEGORIE_SEO[cat]?.[0] || 'altri-programmi'}">${esc(CATEGORIE_SEO[cat]?.[1] || cat)}</a></h2>
        <ul class="z-prodotti">${lista.map(([p, inst]) => schedaProdotto(p, inst, prov)).join('')}</ul></section>`).join('')}
      <section class="z-blocco"><h2>Chi installa a ${esc(prov.nome)}</h2><ul class="z-installatori">${installatori.map(i => schedaInstallatore(i)).join('')}</ul></section>
      ${COME}${vicine(prov, cop)}`;
    return layout({ titolo: `Software open source a ${prov.nome}`, descrizione: `${piu(m.size, 'programma open source', 'programmi open source')} per la tua attività con un installatore a ${prov.nome}: installazione, assistenza mensile e dati sul tuo server.`,
      percorso: `/zona/${prov.slug}`, briciole: [[cfg.nome, '/'], ['Zone', '/zone'], [prov.nome, `/zona/${prov.slug}`]], corpo,
      dati: [{ '@context': 'https://schema.org', '@type': 'ItemList', name: `Software open source a ${prov.nome}`, itemListElement: [...m.keys()].map((pid, i) => ({ '@type': 'ListItem', position: i + 1, url: assoluto(`/p/${cop.prodotti.get(pid).slug}/${prov.slug}`) })) }] });
  }
  // le province della stessa regione con un installatore: i collegamenti fra le pagine locali
  function vicine(prov, cop) {
    const l = PROVINCE.filter(p => p.regione === prov.regione && p.sigla !== prov.sigla && cop.locali.has(p.sigla));
    return l.length ? `<section class="z-blocco"><h2>Vicino a ${esc(prov.nome)}</h2><ul class="z-collegamenti">${l.map(p => `<li><a href="/zona/${p.slug}">${esc(p.nome)}</a></li>`).join('')}</ul></section>` : '';
  }

  function categoria(slugProv, slugCat) {
    const prov = provinciaDaSlug(slugProv), cat = categoriaDaSlug(slugCat), cop = copertura(), m = prov && cat && cop.locali.get(prov.sigla);
    const lista = m ? [...m].map(([pid, inst]) => [cop.prodotti.get(pid), inst]).filter(([p]) => p.categoria === cat) : [];
    if (!lista.length) return null;
    const titolo = `${CATEGORIE_SEO[cat][1]} open source a ${prov.nome}`;
    const altrove = PROVINCE.filter(p => p.sigla !== prov.sigla && [...(cop.locali.get(p.sigla)?.keys() || [])].some(pid => cop.prodotti.get(pid).categoria === cat));
    const corpo = `<header class="z-testa"><h1>${esc(titolo)}</h1>
      <p class="z-sotto">${piu(lista.length, 'programma installato', 'programmi installati')} di persona a ${esc(prov.nome)}, sul tuo server o in ufficio, con l'assistenza ogni mese.</p></header>
      <section class="z-blocco"><ul class="z-prodotti">${lista.map(([p, inst]) => schedaProdotto(p, inst, prov)).join('')}</ul></section>
      ${COME}
      ${altrove.length ? `<section class="z-blocco"><h2>${esc(CATEGORIE_SEO[cat][1])} in altre province</h2><ul class="z-collegamenti">${altrove.map(p => `<li><a href="/zona/${p.slug}/${slugCat}">${esc(p.nome)}</a></li>`).join('')}</ul></section>` : ''}
      <p class="z-nota"><a href="/zona/${prov.slug}">Tutti i programmi a ${esc(prov.nome)}</a></p>`;
    return layout({ titolo, descrizione: `${titolo}: chi li installa, quanto costano installazione e assistenza, e come funziona il pagamento con la garanzia di 14 giorni.`,
      percorso: `/zona/${prov.slug}/${slugCat}`, briciole: [[cfg.nome, '/'], ['Zone', '/zone'], [prov.nome, `/zona/${prov.slug}`], [CATEGORIE_SEO[cat][1], `/zona/${prov.slug}/${slugCat}`]], corpo });
  }

  function prodotto(slug, slugProv) {
    const prov = provinciaDaSlug(slugProv), cop = copertura(), p = [...cop.prodotti.values()].find(x => x.slug === slug);
    const locali = p && prov && cop.locali.get(prov.sigla)?.get(p.id);
    if (!locali?.length) return null;
    const remoti = (cop.remoti.get(p.id) || []).filter(i => !locali.some(l => l.id === i.id));
    const g = leggiJson(p.installazione), idee = (leggiJson(p.idee) || []).slice(0, 3), difficolta = difficoltaDi(p);
    const altre = provinceDi(cop, p.id).filter(x => x.sigla !== prov.sigla);
    const altriQui = [...cop.locali.get(prov.sigla)].filter(([pid]) => pid !== p.id).slice(0, 8).map(([pid, inst]) => schedaProdotto(cop.prodotti.get(pid), inst, prov));
    const titolo = `${p.nome} a ${prov.nome}: chi lo installa`;
    const corpo = `<header class="z-testa"><h1>${esc(p.nome)} a ${esc(prov.nome)}</h1>
      <p class="z-sotto">${esc(p.descrizione)}</p>
      <p class="z-fatti">${[prezzi(p, locali) && `<span>${esc(prezzi(p, locali))}</span>`, g?.tempo && `<span>si installa in ${esc(g.tempo)}</span>`, difficolta && `<span>installazione ${esc(DIFFICOLTA[difficolta])}</span>`, p.licenza && `<span>licenza ${esc(p.licenza)}</span>`].filter(Boolean).join('')}</p></header>
      <section class="z-blocco"><h2>Chi lo installa a ${esc(prov.nome)}</h2><ul class="z-installatori">${locali.map(i => schedaInstallatore(i, p.slug)).join('')}</ul></section>
      ${remoti.length ? `<section class="z-blocco"><h2>Anche da remoto</h2><ul class="z-installatori">${remoti.map(i => schedaInstallatore(i, p.slug)).join('')}</ul></section>` : ''}
      ${idee.length ? `<section class="z-blocco"><h2>A cosa serve, in pratica</h2><ul class="z-idee">${idee.map(x => `<li><b>${esc(x.attivita)}</b>: ${esc(x.problema)} ${esc(x.risultato || '')}</li>`).join('')}</ul></section>` : ''}
      ${COME}
      <p class="z-nota"><a href="/p/${esc(p.slug)}">Tutto su ${esc(p.nome)}: la guida d'installazione, la licenza, i controlli di sicurezza</a></p>
      ${altre.length ? `<section class="z-blocco"><h2>${esc(p.nome)} in altre province</h2><ul class="z-collegamenti">${altre.map(x => `<li><a href="/p/${esc(p.slug)}/${x.slug}">${esc(x.nome)}</a></li>`).join('')}</ul></section>` : ''}
      ${altriQui.length ? `<section class="z-blocco"><h2>Altri programmi a ${esc(prov.nome)}</h2><ul class="z-prodotti">${altriQui.join('')}</ul></section>` : ''}`;
    const servizio = { '@context': 'https://schema.org', '@type': 'Service', name: `Installazione e assistenza di ${p.nome}`, serviceType: 'Installazione di software', areaServed: { '@type': 'AdministrativeArea', name: prov.nome },
      provider: locali.map(i => ({ '@type': 'Person', name: i.nome, url: assoluto(`/u/${i.codice}`) })),
      ...offerta(p, locali, assoluto(`/p/${p.slug}`)) };
    return layout({ titolo, descrizione: `${p.nome} a ${prov.nome}: ${piu(locali.length, 'installatore', 'installatori')} della tua zona, ${prezzi(p, locali) || 'prezzi sulla pagina'}. Il programma e i dati restano tuoi.`,
      percorso: `/p/${p.slug}/${prov.slug}`, briciole: [[cfg.nome, '/'], ['Zone', '/zone'], [prov.nome, `/zona/${prov.slug}`], [p.nome, `/p/${p.slug}/${prov.slug}`]], corpo, dati: [servizio] });
  }

  // i prodotti pubblicati del catalogo che sostituiscono un programma a canone (in ordine, quelli che ci sono)
  function sostituti(a) {
    return a.repo.map(r => db.prepare(`SELECT p.* FROM prodotto p JOIN utente b ON b.id = p.builder WHERE lower(p.repo) = lower(?) AND p.stato = 'pubblicato' AND b.stato IN ('attivo', 'non_rivendicato')`).get(r)).filter(Boolean);
  }
  function alternative() {
    const l = ALTERNATIVE.map(a => [a, sostituti(a)]).filter(([, s]) => s.length);
    const corpo = `<header class="z-testa"><h1>Alternative open source ai programmi a canone</h1>
      <p class="z-sotto">Per i programmi che le attività pagano ogni mese c'è quasi sempre un'alternativa open source: resta tua, gira sul tuo server o in ufficio, e un installatore della tua zona la mette in funzione e la segue.</p></header>
      <section class="z-blocco"><ul class="z-alternative">${l.map(([a, s]) => `<li><a href="/alternative/${esc(a.slug)}">Alternative a ${esc(a.nome)}</a><span>${esc(s.map(p => p.nome).join(', '))}</span></li>`).join('')}</ul></section>
      <p class="z-nota">I marchi citati appartengono ai loro proprietari; ${esc(cfg.nome)} non è collegata a loro.</p>`;
    return layout({ titolo: 'Alternative open source ai programmi a canone', descrizione: 'Le alternative open source ai programmi in abbonamento più usati dalle attività italiane, con chi le installa nella tua zona.',
      percorso: '/alternative', briciole: [[cfg.nome, '/'], ['Alternative', '/alternative']], corpo });
  }
  function alternativa(slug) {
    const a = ALTERNATIVE.find(x => x.slug === slug); if (!a) return null;
    const cop = copertura(), s = sostituti(a).map(p => ({ ...p, venditori: cop.prodotti.get(p.id)?.venditori || [] }));   // i prezzi di chi li vende
    if (!s.length) return null;
    const schede = s.map(p => {
      const prov = provinceDi(cop, p.id), n = new Set([...cop.locali.values()].flatMap(m => (m.get(p.id) || []).map(i => i.id)).concat((cop.remoti.get(p.id) || []).map(i => i.id))).size;
      return `<li class="z-alt"><h3><a href="/p/${esc(p.slug)}">${esc(p.nome)}</a></h3><p>${esc(p.descrizione)}</p>
        <p class="z-meta">${esc(prezzi(p))}${n ? ` · ${piu(n, 'installatore', 'installatori')}` : ' · ancora nessun installatore'}</p>
        ${prov.length ? `<p class="z-meta">Lo installano di persona a: ${prov.slice(0, 12).map(x => `<a href="/p/${esc(p.slug)}/${x.slug}">${esc(x.nome)}</a>`).join(', ')}</p>` : ''}</li>`;
    }).join('');
    const titolo = `Alternative open source a ${a.nome}`;
    const corpo = `<header class="z-testa"><h1>${esc(titolo)}</h1>
      <p class="z-sotto">${esc(a.nome)} è ${esc(a.cosa)} ${esc(a.perche)}</p></header>
      <section class="z-blocco"><h2>${s.length === 1 ? 'L\'alternativa nel catalogo' : `Le ${s.length} alternative nel catalogo`}</h2><ul class="z-prodotti z-alternative-lista">${schede}</ul></section>
      ${a.attenzione ? `<aside class="z-attenzione"><b>Prima di scegliere.</b> ${esc(a.attenzione)}</aside>` : ''}
      <section class="z-blocco"><h2>Cosa cambia</h2><ul class="z-idee">
        <li><b>Paghi il lavoro, non la licenza.</b> ${cfg.assistenzaPiattaforma ? `L'installazione una volta, al prezzo di chi la fa; l'assistenza ogni mese, a chi installa, con ${esc(cfg.nome)} dietro` : 'L\'installazione una volta e l\'assistenza ogni mese, a chi installa'}; nessun costo per ogni utente in più.</li>
        <li><b>I dati restano tuoi.</b> Il programma gira sul tuo server o in ufficio, e se un giorno cambi installatore il programma resta dov'è.</li>
        <li><b>Il passaggio si prepara.</b> Chiedi all'installatore quali dati può portare dal programma che usi oggi e quanto tempo serve.</li></ul></section>
      ${COME}
      <p class="z-nota">${esc(a.nome)} è un marchio dei suoi proprietari; ${esc(cfg.nome)} non è collegata a loro. <a href="/alternative">Le altre alternative</a></p>`;
    return layout({ titolo, descrizione: `${titolo}: ${s.map(p => p.nome).join(', ')}. Installati sul tuo server da un professionista della tua zona, con assistenza mensile.`,
      percorso: `/alternative/${a.slug}`, briciole: [[cfg.nome, '/'], ['Alternative', '/alternative'], [a.nome, `/alternative/${a.slug}`]], corpo,
      dati: [{ '@context': 'https://schema.org', '@type': 'ItemList', name: titolo, itemListElement: s.map((p, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'SoftwareApplication', name: p.nome,
        applicationCategory: 'BusinessApplication', operatingSystem: 'Linux', url: assoluto(`/p/${p.slug}`), ...offerta(p) } })) }] });
  }

  // ---------------- sitemap e robots ----------------
  function indirizzi() {
    const cop = copertura(), oggi = new Date().toISOString().slice(0, 10), l = [];
    for (const u of ['/', '/esplora', '/installatori', '/builder', '/corso', '/garanzia', '/zone', '/alternative']) l.push([u, oggi]);
    for (const p of db.prepare(`SELECT p.slug, p.aggiornato FROM prodotto p JOIN utente b ON b.id = p.builder WHERE p.stato = 'pubblicato' AND b.stato IN ('attivo', 'non_rivendicato')`).all())
      l.push([`/p/${p.slug}`, String(p.aggiornato || oggi).slice(0, 10)]);
    for (const pr of PROVINCE) {
      const m = cop.locali.get(pr.sigla); if (!m) continue;
      l.push([`/zona/${pr.slug}`, oggi]);
      for (const cat of new Set([...m.keys()].map(pid => cop.prodotti.get(pid).categoria))) l.push([`/zona/${pr.slug}/${CATEGORIE_SEO[cat]?.[0] || 'altri-programmi'}`, oggi]);
      for (const pid of m.keys()) l.push([`/p/${cop.prodotti.get(pid).slug}/${pr.slug}`, oggi]);
    }
    for (const a of ALTERNATIVE) if (sostituti(a).length) l.push([`/alternative/${a.slug}`, oggi]);
    return l;
  }
  const sitemap = () => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indirizzi().map(([u, d]) => `<url><loc>${esc(assoluto(u))}</loc><lastmod>${d}</lastmod></url>`).join('\n')}\n</urlset>\n`;
  const robots = () => `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /area\nDisallow: /admin\nDisallow: /cliente\nDisallow: /assistenza/\nDisallow: /accedi\n\nSitemap: ${cfg.url}/sitemap.xml\n`;

  // le province dove un prodotto ha un installatore di persona (per i collegamenti dalla sua pagina)
  const zoneProdotto = pid => provinceDi(copertura(), pid).map(p => ({ slug: p.slug, nome: p.nome }));

  // la pagina per questo indirizzo, o null se non è una di queste (o se non avrebbe contenuto: allora è un 404)
  function pagina(percorso) {
    let m;
    if (percorso === '/zone') return { html: zone() };
    if (percorso === '/alternative') return { html: alternative() };
    if (percorso === '/sitemap.xml') return { html: sitemap(), tipo: '.xml' };
    if (percorso === '/robots.txt') return { html: robots(), tipo: '.txt' };
    if ((m = percorso.match(/^\/zona\/([a-z0-9-]{2,40})$/))) return { html: provincia(m[1]) };
    if ((m = percorso.match(/^\/zona\/([a-z0-9-]{2,40})\/([a-z0-9-]{2,40})$/))) return { html: categoria(m[1], m[2]) };
    if ((m = percorso.match(/^\/p\/([a-z0-9-]{1,60})\/([a-z0-9-]{2,40})$/))) return { html: prodotto(m[1], m[2]) };
    if ((m = percorso.match(/^\/alternative\/([a-z0-9-]{1,60})$/))) return { html: alternativa(m[1]) };
    return null;
  }
  return { pagina, zoneProdotto, copertura };
}
