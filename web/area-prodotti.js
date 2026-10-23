// I miei prodotti (chi sviluppa) e Installo (chi vende): modifica dei prodotti con la percentuale di chi sviluppa e l'anteprima
// della divisione, revisione, ritiro, sincronizzazione con GitHub, badge, collaboratori, chi lo vende (prezzo, livello, mance),
// nuovi progetti dai repository; i prodotti adottati con il proprio prezzo, il livello, il link personale, la zona e «Lascia»;
// gli inviti a mantenere un progetto. Il prezzo dell'installazione lo decide chi vende; chi sviluppa sceglie la sua percentuale
// (80% se non la sceglie: chi vende parte dal 20%) e con ciascuno può accordarsi su un'altra divisione (le proposte si vedono da tutti e due i lati).
import { el, t, chiama, occupato, conferma, avviso, copia, euro, percento, conta, data } from './comune.js';
import { S, blocco, aggiorna, carta, testa, titoletto, vuoto, bottone, link, messaggio, campo, stato, barraQuote, pubblico, scheletro } from './area-base.js';

const NOMI_CATEGORIE = { gestionale: 'gestionale', cassa: 'cassa', prenotazioni: 'prenotazioni', sito: 'sito', ecommerce: 'e-commerce', magazzino: 'magazzino', 'contabilità': 'contabilità',
  crm: 'CRM', comunicazione: 'comunicazione', 'sanità': 'sanità', ristorazione: 'ristorazione', scuola: 'scuola', altro: 'altro' };
// i prezzi di chi vende (la fascia fra chi lo offre) e l'assistenza mensile della piattaforma
const pc = x => `${String(Math.round(x * 1000) / 10).replace('.', ',')}%`;
function prezzi(p) {
  const l = (p.accordi || []).map(a => a.prezzo_avvio).filter(v => v > 0), min = Math.min(...l), max = Math.max(...l);
  const avvio = !l.length ? t('l\'installazione la prezza chi lo vende') : min === max ? t('{x} l\'installazione', { x: euro(min) }) : t('da {a} a {b} l\'installazione, secondo chi lo vende', { a: euro(min), b: euro(max) });
  return [avvio, p.prezzo_mese ? ((S.io.quotaSviluppatoreAssistenza || 0) > 0 ? t('{x} al mese di assistenza: il {q} a te', { x: euro(p.prezzo_mese), q: pc(S.io.quotaSviluppatoreAssistenza) }) : t('{x} al mese di assistenza: 60% a chi installa, 40% alla piattaforma', { x: euro(p.prezzo_mese) })) : null].filter(Boolean).join(' + ');
}

// ======================= I miei prodotti =======================
export function prodotti(radice, io) {
  const nuovo = el('div', { class: 'blocco' });
  radice.append(
    testa('I miei prodotti', 'I progetti open source che hai messo in vendita: la tua percentuale, la revisione, chi li vende e chi li mantiene con te.',
      io.prodotti.length ? bottone('Aggiungi un progetto', '', () => { nuovo.replaceChildren(aggiungi()); nuovo.scrollIntoView({ block: 'nearest' }); }) : null),
    nuovo,
    blocco('inviti', inviti),
    blocco('prodotti', lista),
    blocco('owner', owner),
  );
  if (!io.prodotti.length) nuovo.replaceChildren(aggiungi());
}

function lista(io) {
  if (!io.prodotti.length) return null;   // il riquadro «Aggiungi un progetto» fa da stato vuoto
  return el('div', { class: 'elenco' }, ...io.prodotti.map(schedaProdotto));
}

function schedaProdotto(p) {
  const m = messaggio();
  const azioni = el('div', { class: 'azioni' },
    bottone('Modifica', 'secondario piccolo', () => modifica(p)),
    ['bozza', 'respinto', 'ritirato'].includes(p.stato) ? bottone('Manda in revisione', 'piccolo', e => occupato(e.currentTarget, async () => {
      await chiama('POST', '/api/prodotti/revisione', { id: p.id }); avviso('Mandato in revisione: ti scriviamo appena è approvato.'); await aggiorna('prodotti');
    }, m)) : null,
    ['pubblicato', 'revisione', 'sospeso'].includes(p.stato) ? bottone('Ritira', 'fantasma piccolo', async e => {
      const b = e.currentTarget;
      if (await conferma(t('Ritirare {nome} dal catalogo?', { nome: p.nome }), 'Non comparirà più nel catalogo e nessuno potrà comprarlo. I clienti che ci sono restano serviti.', { si: 'Ritira', pericolo: true }))
        occupato(b, async () => { await chiama('POST', '/api/prodotti/ritira', { id: p.id }); avviso('Prodotto ritirato.'); await aggiorna('prodotti'); }, m);
    }) : null,
    bottone('Sincronizza con GitHub', 'fantasma piccolo', e => occupato(e.currentTarget, async () => {
      const { esito, nota } = await chiama('POST', '/api/prodotti/sincronizza', { id: p.id });
      if (esito === 'ok') avviso('Sincronizzato: README, stelle e versioni sono aggiornati.');
      else if (esito === 'sparito') avviso('Su GitHub il repository non c\'è più o è privato: il prodotto è sospeso.', { errore: true });
      else if (esito === 'sospeso' || esito === 'cambiato') avviso(nota ? t('Il prodotto è sospeso: {nota}', { nota }) : 'Il repository su GitHub non è più quello di prima: il prodotto è sospeso.', { errore: true, durata: 9000 });
      else avviso(t('GitHub non ha risposto ({e}): riprova fra qualche minuto.', { e: String(esito || '').replace(/^GitHub\s*/, '') }), { errore: true });
      await aggiorna('prodotti');
    }, m)),
    p.stato === 'pubblicato' ? link('Vedi la pagina', `/p/${p.slug}`, 'bottone fantasma piccolo') : link('Anteprima', `/p/${p.slug}`, 'bottone fantasma piccolo'));
  const collab = p.collaboratori || [], acc = p.accordi || [], io = S.io;
  const daRispondere = acc.filter(a => a.proposta && a.proposta.da === 'installatore').length, concordati = acc.filter(a => a.concordata).length;
  return carta({ class: 'prodotto', 'data-chiave': `p${p.id}` },
    el('div', { class: 'titoletto' }, el('div', {}, el('h3', {}, pubblico(p.nome)), el('a', { class: 'mono piccolo tenue', href: p.url, target: '_blank', rel: 'noopener' }, p.repo)), stato(p.stato)),
    p.nota && ['respinto', 'sospeso', 'bozza'].includes(p.stato) ? el('div', { class: `avviso ${p.stato === 'sospeso' ? 'errore' : 'attesa'}` },
      el('span', {}, el('strong', {}, t(p.stato === 'sospeso' ? 'Perché è sospeso:' : 'Nota della revisione:')), ' ', pubblico(p.nota),
        p.stato === 'sospeso' ? `${/[.!?]$/.test(p.nota) ? '' : '.'} ${t('Sistema il repository, poi premi «Sincronizza con GitHub» e scrivici per riattivarlo.')}` : '')) : null,
    el('dl', { class: 'dati fitti' },
      el('dt', {}, t('Prezzo')), el('dd', {}, prezzi(p)),
      el('dt', {}, t('La tua parte')), el('dd', {}, t('{b} di ogni installazione, tolti il costo di Stripe (con carta) e la parte della piattaforma', { b: pc(p.percentuale) }), p.percentuale_scelta ? '' : ` (${t('quella standard')})`,
        concordati ? ` · ${conta(concordati, 'accordo diverso', 'accordi diversi')}` : ''),
      el('dt', {}, t('Diffusione')), el('dd', {}, `${conta(p.installatori, 'installatore', 'installatori')} · ${conta(p.clienti, 'cliente attivo', 'clienti attivi')}`),
      el('dt', {}, t('Versione')), el('dd', {}, p.versione || t('nessuna release'))),
    azioni, m,
    el('details', { class: 'piega' }, el('summary', {}, t('Badge per il README')),
      el('p', { class: 'tenue piccolo' }, t('Incollalo nel README del progetto: porta chi lo legge alla pagina del prodotto.')),
      el('div', { class: 'copia' }, el('code', { 'data-no-t': '' }, p.badge), el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: e => copia(p.badge, e.currentTarget) }, t('Copia')))),
    el('details', { class: 'piega', ...(daRispondere || new URLSearchParams(location.search).get('mancia') ? { open: true } : {}) }, el('summary', {}, t('Chi lo vende ({n})', { n: acc.length }), daRispondere ? [' ', el('span', { class: 'pillola attesa' }, conta(daRispondere, 'proposta', 'proposte'))] : null),
      accordi(p)),
    el('details', { class: 'piega' }, el('summary', {}, t('Collaboratori ({n})', { n: collab.length })), collaboratori(p)));
}

// chi vende il prodotto: il suo prezzo, il suo livello (le vendite), le mance che gli hai mandato, la divisione (la tua percentuale
// o il vostro accordo) con le proposte arrivate e quelle mandate
function accordi(p) {
  const l = p.accordi || [];
  if (!l.length) return el('p', { class: 'tenue piccolo' }, t('Nessuno lo vende ancora. Quando qualcuno lo adotta, qui vedi il suo prezzo, le sue vendite e la vostra divisione.'));
  return el('div', { class: 'lista-righe accordi' }, ...l.map(a => el('div', {},
    el('div', { class: 'cresce' }, el('div', { class: 'riga-venditore' }, el('strong', {}, pubblico(a.nome)), a.zona ? el('span', { class: 'tenue piccolo' }, ' · ', pubblico(a.zona)) : null,
        a.prezzo_avvio ? el('span', { class: 'prezzo-venditore' }, euro(a.prezzo_avvio)) : null,
        a.livello?.livello ? el('span', { class: `pp-top livello-${a.livello.livello}` }, t(a.livello.livello > 1 ? 'Top seller oro' : 'Top seller')) : null),
      el('p', { class: 'tenue piccolo' }, conta(a.livello?.vendite || 0, 'vendita', 'vendite'), a.mance ? ` · ${t('mance mandate: {x}', { x: euro(a.mance) })}` : ''),
      divisione(a, { prodotto: p.id, installatore: a.codice, lato: 'builder', altro: a.nome, blocco: 'prodotti' }),
      mancia(p, a)))));
}

// la mancia a chi vende il tuo prodotto: con la carta (Stripe), da 5 a 500 €, con una riga facoltativa; la piattaforma tiene la sua parte
function mancia(p, a) {
  const io = S.io;
  if (!io.carta || io.prelancio) return null;
  const m = messaggio();
  const importo = el('input', { type: 'number', name: 'importo', min: String(io.prezzoMin / 100), max: String((io.manciaMax || 50000) / 100), step: '1', value: '20', inputmode: 'decimal', required: true });
  const nota = el('input', { type: 'text', name: 'nota', maxlength: '200', placeholder: t('es. grazie per le installazioni a Bergamo') });
  const f = el('form', { class: 'riga-modulo', novalidate: true }, campo('Mancia (€)', importo), campo('Una riga per chi vende (facoltativa)', nota), el('button', { type: 'submit', class: 'bottone secondario' }, t('Paga con carta')));
  f.addEventListener('submit', e => {
    e.preventDefault();
    occupato(f.querySelector('button'), async () => {
      const r = await chiama('POST', '/api/mance', { prodotto: p.id, installatore: a.codice, importo: importo.value, nota: nota.value });
      location.href = r.url; await new Promise(() => {});   // il bottone resta in attesa finché la pagina di Stripe non si apre
    }, m);
  });
  return el('details', { class: 'piega mancia' }, el('summary', {}, t('Manda una mancia a {nome}', { nome: a.nome })),
    el('p', { class: 'aiuto' }, t('Un grazie per come vende il tuo prodotto: arriva sul suo conto dopo i {n} giorni di garanzia, tolti il costo di Stripe e la parte della piattaforma ({p}).', { n: io.trattenuta, p: percento(io.piattaforma) })), f, m);
}

// una divisione fra chi installa e chi sviluppa, vista da uno dei due (lato: 'builder' o 'installatore'): quella di adesso, poi la proposta
// in sospeso (da accettare o rifiutare, o da ritirare se è tua) oppure il modulo per proporne un'altra. Vale per le vendite dopo il sì.
function divisione(a, { prodotto, installatore = null, lato, altro, blocco }) {
  const m = messaggio(), corpo = { prodotto, ...(installatore ? { installatore } : {}) };
  const coppia = q => t('{i} a chi vende, {b} a chi sviluppa', { i: pc(q), b: pc(1 - q) });
  const manda = (via, dati, testo) => e => occupato(e.currentTarget, async () => { await chiama('POST', via, { ...corpo, ...dati }); avviso(testo); await aggiorna(blocco); }, m);
  // con il livello di chi vende (Top seller) la parte di chi sviluppa scende: si vede la divisione di adesso, con il livello
  const nodo = el('div', { class: 'accordo' }, el('div', {}, el('span', {}, coppia(a.quotaLivello ?? a.quota)), ' ', el('span', { class: 'pillola' }, t(a.concordata ? 'concordata' : 'standard')),
    a.livello?.livello ? [' ', el('span', { class: 'tenue piccolo' }, t('(con il livello: senza sarebbe {c})', { c: coppia(a.quota) }))] : null));
  if (a.proposta && a.proposta.da !== lato) {
    nodo.append(el('div', { class: 'avviso attesa' }, el('span', {}, t('{chi} propone {coppia}.', { chi: altro, coppia: coppia(a.proposta.quota) }),
      a.proposta.nota ? [' ', el('em', {}, pubblico(`«${a.proposta.nota}»`))] : null, ' ', t('Vale per le vendite da quando accetti.'))),
    el('div', { class: 'azioni' }, bottone('Accetta', 'piccolo', manda('/api/accordi/rispondi', { accetta: true }, 'Accordo fatto: vale dalla prossima vendita.')),
      bottone('Rifiuta', 'secondario piccolo', manda('/api/accordi/rispondi', { accetta: false }, 'Proposta rifiutata.'))));
  } else if (a.proposta) {
    nodo.append(el('p', { class: 'tenue piccolo' }, t('Hai proposto {coppia}: aspetti la risposta di {chi}.', { coppia: coppia(a.proposta.quota), chi: altro })),
      el('div', { class: 'azioni' }, bottone('Ritira la proposta', 'fantasma piccolo', manda('/api/accordi/ritira', {}, 'Proposta ritirata.'))));
  } else {
    const q = el('input', { type: 'number', name: 'quota', min: '0', max: '100', step: '1', value: String(Math.round(a.quota * 100)), inputmode: 'numeric', required: true });
    const nota = el('input', { type: 'text', name: 'nota', maxlength: '300', placeholder: t('es. faccio io anche la formazione al personale') });
    const f = el('form', { class: 'riga-modulo', novalidate: true }, campo('A chi vende (%)', q), campo('Una riga per l\'altro (facoltativa)', nota), el('button', { type: 'submit', class: 'bottone secondario' }, t('Proponi')));
    f.addEventListener('submit', e => { e.preventDefault(); manda('/api/accordi/proponi', { quota: Number(q.value), nota: nota.value }, 'Proposta mandata: la vedrà nella sua area.')({ currentTarget: f.querySelector('button') }); });
    nodo.append(el('details', { class: 'piega' }, el('summary', {}, t('Proponi un\'altra divisione')),
      el('p', { class: 'aiuto' }, t('Vi accordate voi due, per questo prodotto. Vale per le vendite da quando l\'altro accetta; quelle già fatte restano com\'erano.')), f));
  }
  nodo.append(m);
  return nodo;
}

// la finestra di modifica: il modulo resta com'è anche se dietro la lista si ridisegna
function modifica(p) {
  const io = S.io;
  // l'esempio dell'anteprima: il prezzo più basso fra chi lo vende, o 390 €
  const prezziVenditori = (p.accordi || []).map(a => a.prezzo_avvio).filter(v => v > 0), esempio = prezziVenditori.length ? Math.min(...prezziVenditori) : 39000;
  const sel = el('select', { name: 'categoria' }, ...io.categorie.map(c => el('option', { value: c }, t(NOMI_CATEGORIE[c] || c))));
  sel.value = p.categoria;
  const num = (name, v, attr = {}) => el('input', { type: 'number', name, value: String(v), min: '0', inputmode: 'decimal', ...attr });
  const f = el('form', { class: 'modulo', novalidate: true },
    el('div', { class: 'campi' }, campo('Nome', el('input', { type: 'text', name: 'nome', value: p.nome, maxlength: '80', required: true })), campo('Categoria', sel)),
    campo('Descrizione', el('textarea', { name: 'descrizione', maxlength: '1200' }, p.descrizione || ''), 'A chi serve e cosa fa, in parole semplici. Almeno 40 caratteri.'),
    campo('Guida per chi installa', el('textarea', { name: 'guida', maxlength: '4000' }, p.guida || ''), 'Requisiti, passi, link alla documentazione. Almeno qualche riga.'),
    // i prezzi non sono tuoi: l'installazione la prezza chi la vende, il canone dell'assistenza la piattaforma. Tu scegli la tua percentuale
    el('div', { class: 'campi' },
      campo('La tua percentuale (%)', num('percentuale', p.percentuale_scelta ? Math.round(p.percentuale * 100) : '', { step: '1', max: String(Math.round((io.percentualeMax || .8) * 100)), placeholder: String(Math.round((1 - io.quotaInstallatore) * 100)) }),
        t('Da 0 a {max}% di ogni installazione, tolti il costo di Stripe (con carta) e la parte della piattaforma. Lasciala vuota per quella standard ({std}).', { max: Math.round((io.percentualeMax || .8) * 100), std: pc(1 - io.quotaInstallatore) }))),
    el('div', { class: 'anteprime' }, el('div', {}, el('div', { class: 'etichetta' }, t('Su un\'installazione da {x}', { x: euro(esempio) })), barraQuote())),
    el('p', { class: 'aiuto anteprima-livelli' }),
    el('p', { class: 'aiuto' }, (io.quotaSviluppatoreAssistenza ?? 0) > 0
      ? t('Il prezzo lo decide chi vende: più è bassa la tua percentuale, più conviene venderlo. Con chi vende potete accordarvi su un\'altra divisione dalla scheda del prodotto. L\'assistenza di ogni mese la dà chi ha installato, con la piattaforma dietro, e del canone il {q} va a te.', { q: pc(io.quotaSviluppatoreAssistenza) })
      : t('Il prezzo lo decide chi vende: più è bassa la tua percentuale, più conviene venderlo. Con chi vende potete accordarvi su un\'altra divisione dalla scheda del prodotto. L\'assistenza di ogni mese la dà chi ha installato, con la piattaforma dietro: del canone a te non va niente; il tuo ricorrente sono gli aggiornamenti garantiti.')),
    // gli aggiornamenti garantiti: una riga facoltativa per il cliente, a prezzo tuo, con quello che prometti; qui la parte è tua
    el('fieldset', { class: 'riquadro-aggiornamenti' }, el('legend', {}, t('Aggiornamenti garantiti (facoltativi)')),
      el('p', { class: 'aiuto' }, io.quotaInstallatoreAggiornamenti ? t('Il cliente li aggiunge se vuole, ogni mese insieme all\'assistenza. Tolti il costo di Stripe (con carta) e la parte della piattaforma, {b} a te e {i} a chi installa.', { b: percento(1 - io.quotaInstallatoreAggiornamenti), i: percento(io.quotaInstallatoreAggiornamenti) })
        : t('Il cliente li aggiunge se vuole, ogni mese insieme all\'assistenza. Il prezzo è tuo e, tolti il costo di Stripe (con carta) e la parte della piattaforma, sono tutti tuoi.')),
      campo('Aggiornamenti al mese (€)', num('prezzo_aggiornamenti', (p.prezzo_aggiornamenti || 0) / 100, { step: '1' }), t('0 se non li offri; altrimenti almeno {x}', { x: euro(io.prezzoMin) })),
      campo('Cosa prometti', el('textarea', { name: 'aggiornamenti_testo', maxlength: '300', placeholder: t('Per esempio: una versione ogni mese, le correzioni di sicurezza entro 7 giorni, risposta a chi installa sui problemi del codice entro 3 giorni lavorativi.') }, p.aggiornamenti_testo || ''),
        'Il cliente lo legge prima di sceglierli. Almeno una riga.')),
    el('div', { class: 'campi' },
      campo('Sito del progetto', el('input', { type: 'url', name: 'sito', value: p.sito || '', placeholder: 'https://…' })),
      campo('Demo da provare', el('input', { type: 'url', name: 'demo', value: p.demo || '', placeholder: 'https://…' }))),
    // «costruito su»: la piattaforma che il progetto richiede (workflow per n8n, plugin per un CMS…): chi installa la mette anche lei
    el('div', { class: 'campi' },
      campo('Funziona con (facoltativo)', el('input', { name: 'base_nome', value: p.base_nome || '', maxlength: '60', placeholder: 'n8n' }), 'La piattaforma che il progetto richiede, se ce n\'è una'),
      campo('Link della piattaforma', el('input', { type: 'url', name: 'base_url', value: p.base_url || '', placeholder: 'https://…' }))),
    p.stato === 'pubblicato' ? el('p', { class: 'aiuto' }, t('Se cambi nome, descrizione o aggiornamenti, il prodotto torna in revisione. Percentuale, guida e link no.')) : null);
  const [ba] = f.querySelectorAll('.quote-anteprima'), livelli = f.querySelector('.anteprima-livelli');
  const anteprima = () => {
    const v = f.elements.percentuale.value === '' ? 1 - io.quotaInstallatore : Math.min(Number(f.elements.percentuale.value) || 0, 100) / 100;
    ba.aggiorna(esempio, 1 - v, io.piattaforma, io.stimaStripe ? Math.round(esempio * io.stimaStripe.percentuale) + io.stimaStripe.fisso : 0);
    // i livelli di chi vende: dopo tante vendite dello stesso prodotto la tua parte su quelle vendite scende
    livelli.textContent = (io.livelli || []).length ? t('Chi vende molto sale di livello: {l}.', { l: io.livelli.map(l => t('dopo {n} vendite confermate dai clienti la tua parte sulle sue vendite è il {q}', { n: l.da, q: pc(v * l.fattore) })).join(', ') }) : '';
  };
  f.addEventListener('input', anteprima); anteprima();
  const m = messaggio(), salva = el('button', { type: 'submit', class: 'bottone' }, t('Salva'));
  const d = el('dialog', { class: 'finestra larga', 'aria-labelledby': 'titolo-modifica' },
    el('div', { class: 'titoletto' }, el('h3', { id: 'titolo-modifica' }, t('Modifica {nome}', { nome: p.nome })),
      el('button', { type: 'button', class: 'chiudi', 'aria-label': t('Chiudi'), onclick: () => d.close() }, '×')),
    f, m, el('div', { class: 'azioni fine' }, el('button', { type: 'button', class: 'bottone secondario', onclick: () => d.close() }, t('Annulla')), salva));
  salva.setAttribute('form', ''); salva.addEventListener('click', e => { e.preventDefault(); f.requestSubmit(); });
  f.addEventListener('submit', e => {
    e.preventDefault();
    occupato(salva, async () => {
      const r = await chiama('POST', '/api/prodotti/modifica', { ...Object.fromEntries(new FormData(f)), id: p.id });
      avviso(r.stato === 'revisione' && p.stato === 'pubblicato' ? 'Salvato: le modifiche tornano in revisione.' : 'Salvato.');
      d.close(); await aggiorna('prodotti');
    }, m);
  });
  d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal(); f.elements.nome.focus();
}

function collaboratori(p) {
  const io = S.io, m = messaggio();
  const lista = (p.collaboratori || []).length ? el('div', { class: 'lista-righe' }, ...p.collaboratori.map(c => el('div', {},
    el('div', {}, el('strong', { class: 'mono' }, `@${c.login}`), ' ', stato(c.stato), el('div', { class: 'tenue piccolo' },
      t('{q} della tua parte', { q: percento(c.quota) }), c.iscritto ? '' : ` · ${t('non ancora iscritto: lo vedrà quando entra con GitHub')}`)),
    el('button', { type: 'button', class: 'bottone pericolo piccolo', onclick: async e => {
      const b = e.currentTarget;
      if (await conferma(t('Togliere @{login} dal progetto?', { login: c.login }), 'Non riceverà più la sua parte dei prossimi pagamenti. Le quote già maturate restano sue.', { si: 'Togli', pericolo: true }))
        occupato(b, async () => { await chiama('POST', '/api/prodotti/collaboratori/rimuovi', { id: p.id, login: c.login }); avviso('Collaboratore tolto.'); await aggiorna('prodotti'); }, m);
    } }, t('Rimuovi')))))
    : el('p', { class: 'tenue piccolo' }, t('Nessuno, per ora. Chi mantiene il progetto con te può ricevere una parte della tua quota.'));
  const f = el('form', { class: 'riga-modulo', novalidate: true },
    campo('Login GitHub', el('input', { type: 'text', name: 'login', placeholder: 'es. sami-codes', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', required: true })),
    campo('Parte della tua quota (%)', el('input', { type: 'number', name: 'quota', min: '1', max: '90', step: '1', value: '20', required: true })),
    el('button', { type: 'submit', class: 'bottone secondario' }, t('Invita')));
  f.addEventListener('submit', e => {
    e.preventDefault();
    occupato(f.querySelector('button'), async () => {
      const r = await chiama('POST', '/api/prodotti/collaboratori', { id: p.id, login: f.elements.login.value, quota: Number(f.elements.quota.value) });
      f.reset(); avviso(r.iscritto ? 'Invito mandato: lo trova nella sua area.' : 'Invito salvato: lo vedrà quando entra con GitHub.'); await aggiorna('prodotti');
    }, m);
  });
  return el('div', { class: 'collaboratori' }, lista, f, el('p', { class: 'aiuto' }, t('Le parti dei collaboratori, insieme, vanno da 1% a 90% della tua.')), m);
}

// «Aggiungi un progetto»: i repository di GitHub, con il motivo per cui alcuni non si possono vendere
function aggiungi() {
  const io = S.io;
  if (!io.githubAttivo) return carta({ class: 'aggiungi' },
    titoletto(io.prodotti.length ? 'Aggiungi un progetto' : 'Metti in vendita il tuo primo progetto'),
    el('p', {}, t(io.github ? 'Rientra con GitHub per vedere i tuoi repository: serve a verificare che il progetto sia tuo.' : 'Collega GitHub per mettere in vendita un tuo progetto: serve a verificare che sia tuo. Non chiediamo nessun permesso sui repository.')),
    el('div', { class: 'azioni' }, link(io.github ? 'Rientra con GitHub' : 'Collega GitHub', '/auth/github', 'bottone')));
  const box = el('div', {}, scheletro(3));
  const c = carta({ class: 'aggiungi' }, titoletto(io.prodotti.length ? 'Aggiungi un progetto' : 'Metti in vendita il tuo primo progetto',
    io.prodotti.length ? el('button', { type: 'button', class: 'chiudi', 'aria-label': t('Chiudi'), onclick: () => c.remove() }, '×') : null), el('p', { class: 'tenue' }, t('I tuoi repository pubblici, con una licenza open source, di cui sei amministratore.')), box);
  (async () => {
    try {
      const l = await chiama('GET', '/api/github/repository');
      if (!l.length) { box.replaceChildren(vuoto('Nessun repository', 'Non abbiamo trovato repository pubblici di cui sei amministratore.', link('Apri GitHub', 'https://github.com/new', 'bottone secondario'))); return; }
      l.sort((a, b) => (!!a.motivo - !!b.motivo) || b.stelle - a.stelle);
      box.replaceChildren(el('div', { class: 'lista-righe' }, ...l.map(r => {
        const m = messaggio();
        return el('div', { class: r.motivo ? 'spento' : '' },
          el('div', { class: 'cresce' }, el('strong', { class: 'mono' }, r.nome), el('div', { class: 'tenue piccolo' }, r.motivo ? t(r.motivo) : `★ ${r.stelle} · ${r.licenza}${r.descrizione ? ' · ' : ''}`, r.motivo ? '' : pubblico(r.descrizione)), m),
          r.motivo ? el('span', { class: 'pillola' }, t('non vendibile')) : el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: e => occupato(e.currentTarget, async () => {
            const p = await chiama('POST', '/api/prodotti', { repo: r.nome });
            avviso('Aggiunto come bozza: completa percentuale e guida, poi mandalo in revisione.'); c.remove(); await aggiorna('prodotti');
            const nuovo = S.io.prodotti.find(x => x.id === p.id); if (nuovo) modifica(nuovo);
          }, m) }, t('Metti in vendita')));
      })));
    } catch (e) { box.replaceChildren(el('div', { class: 'avviso errore' }, e.message), el('div', { class: 'azioni' }, link('Rientra con GitHub', '/auth/github', 'bottone secondario'))); }
  })();
  return c;
}

// i repository di cui sei owner insieme a chi li ha rivendicati (admin o maintain su GitHub): la tua parte di quella di chi
// sviluppa, in base ai commit; per uscire, dalla pagina del progetto
function owner(io) {
  const l = io.owner || [];
  if (!l.length) return null;
  return carta({ class: 'owner' }, titoletto('Progetti di cui sei owner'),
    el('div', { class: 'lista-righe' }, ...l.map(o => el('div', {},
      el('div', { class: 'cresce' }, el('a', { href: `/p/${o.slug}` }, pubblico(o.nome)),
        el('div', { class: 'tenue piccolo' }, t('{q} della parte di chi sviluppa, in base ai commit', { q: percento(o.quota) }))),
      link('Vedi la pagina', `/p/${o.slug}`, 'bottone fantasma piccolo')))));
}

// ======================= Inviti a collaborare =======================
function inviti(io) {
  const l = io.collaborazioni.filter(c => c.stato === 'invitato');
  if (!l.length) return null;
  return carta({ class: 'inviti' }, titoletto('Inviti a collaborare'),
    el('div', { class: 'lista-righe' }, ...l.map(c => {
      const m = messaggio();
      const rispondi = accetta => e => occupato(e.currentTarget, async () => {
        await chiama('POST', '/api/collaborazioni/rispondi', { prodotto: c.prodotto, accetta }); avviso(accetta ? 'Invito accettato: da ora ricevi la tua parte.' : 'Invito rifiutato.');
        await aggiorna(['inviti', 'collaborazioni']);
      }, m);
      return el('div', {}, el('div', { class: 'cresce' }, el('strong', {}, pubblico(c.nome)), el('div', { class: 'tenue piccolo' },
        t('{da} ti invita a mantenere il progetto: {q} della sua parte su ogni pagamento.', { da: c.builder, q: percento(c.quota) })), m),
        el('div', { class: 'azioni' }, el('button', { type: 'button', class: 'bottone piccolo', onclick: rispondi(true) }, t('Accetta')),
          el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: rispondi(false) }, t('Rifiuta'))));
    })));
}
function collaborazioni(io) {
  const l = io.collaborazioni.filter(c => c.stato === 'attivo');
  if (!l.length) return null;
  return carta({}, titoletto('Progetti che mantieni'),
    el('div', { class: 'lista-righe' }, ...l.map(c => {
      const m = messaggio();
      return el('div', {}, el('div', { class: 'cresce' }, el('a', { href: `/p/${c.slug}` }, pubblico(c.nome)), el('div', { class: 'tenue piccolo' }, t('con {da} · {q} della sua parte', { da: c.builder, q: percento(c.quota) })), m),
        el('button', { type: 'button', class: 'bottone fantasma piccolo', onclick: async e => {
          const b = e.currentTarget;
          if (await conferma(t('Lasciare {nome}?', { nome: c.nome }), 'Non riceverai più la tua parte dei prossimi pagamenti. Le quote già maturate restano tue.', { si: 'Lascia', pericolo: true }))
            occupato(b, async () => { await chiama('POST', '/api/collaborazioni/rispondi', { prodotto: c.prodotto, accetta: false }); avviso('Hai lasciato il progetto.'); await aggiorna('collaborazioni'); }, m);
        } }, t('Lascia')));
    })));
}

// ======================= Installo =======================
export function installo(radice, io) {
  radice.append(...[   // il corso e le mance possono mancare: niente «null» nella pagina
    testa('Installo', 'I prodotti che vendi ai business della tua zona, al prezzo che decidi tu, con il tuo link personale: chi compra da lì è un tuo cliente.',
      link('Trova altri prodotti', '/esplora', 'bottone secondario')),
    corso(io),
    mance(io),
    blocco('inviti', inviti),
    blocco('collaborazioni', collaborazioni),
    blocco('adozioni', adozioni),
  ].filter(Boolean));
}

// il corso per installatori: senza il test non si offrono programmi; gli impegnativi dopo le installazioni confermate
function corso(io) {
  const c = io.corso;
  if (!c?.obbligatorio) return null;
  if (!c.corso) return el('div', { class: 'avviso attesa corso-avviso' }, el('div', {},
    el('p', {}, el('strong', {}, t('Manca il corso per installatori.')), ' ', t('Senza il test non puoi offrire programmi, e quelli che offri già non compaiono ai clienti.')),
    link('Fai il corso', '/corso', 'bottone piccolo')));
  return el('div', { class: 'avviso ok corso-avviso' }, el('div', {},
    el('p', {}, el('strong', {}, t('Corso superato')), ' ', t('il {data}, con {n} risposte giuste.', { data: data(c.corso), n: c.punti })),
    el('p', { class: 'piccolo' }, c.impegnativi ? t('Puoi offrire tutti i programmi del catalogo, anche quelli impegnativi.')
      : t('Programmi impegnativi: si sbloccano dopo {servono} installazioni confermate dai clienti. Ne hai {fatte}.', { servono: c.servono, fatte: c.confermate }))));
}

// le mance ricevute da chi sviluppa i prodotti che vendi (le ultime)
function mance(io) {
  if (!io.mance?.length) return null;
  return carta({ class: 'mance-ricevute' }, el('h3', {}, t('Mance ricevute')),
    el('div', { class: 'lista-righe' }, ...io.mance.slice(0, 5).map(x => el('div', {}, el('div', { class: 'cresce' },
      el('strong', {}, euro(x.importo)), ' ', el('span', {}, t('da {chi}', { chi: x.da })), x.prodotto ? el('span', { class: 'tenue' }, ' · ', pubblico(x.prodotto)) : null,
      x.nota ? el('p', { class: 'tenue piccolo' }, pubblico(`«${x.nota}»`)) : null), el('span', { class: 'tenue piccolo' }, data(x.pagata))))));
}

function adozioni(io) {
  if (!io.adozioni.length) return vuoto('Non installi ancora niente', 'Scegli dal catalogo i prodotti che sai installare: avrai un link tuo da dare ai business, e ogni vendita da lì è tua.',
    link('Apri il catalogo', '/esplora', 'bottone'));
  return el('div', { class: 'elenco' }, ...io.adozioni.map(a => {
    const m = messaggio();
    const zona = el('input', { type: 'text', name: 'zona', value: a.zona || '', maxlength: '60', placeholder: 'es. Bergamo e provincia' });
    // il prezzo dell'installazione è tuo: lo cambi quando vuoi, vale per le vendite da adesso
    const prezzo = el('input', { type: 'number', name: 'prezzo_avvio', value: a.prezzo_avvio ? String(a.prezzo_avvio / 100) : '', min: String(io.prezzoMin / 100), max: '50000', step: '1', inputmode: 'decimal', required: true });
    const fz = el('form', { class: 'riga-modulo', novalidate: true }, campo('Il tuo prezzo (€)', prezzo), campo('Dove lo installi', zona), el('button', { type: 'submit', class: 'bottone secondario' }, t('Salva')));
    fz.addEventListener('submit', e => { e.preventDefault(); occupato(fz.querySelector('button'), async () => {
      await chiama('POST', '/api/adozioni', { prodotto: a.id, zona: zona.value, prezzo_avvio: prezzo.value }); avviso('Salvato: il prezzo vale per le vendite da adesso.'); await aggiorna('adozioni');
    }, m); });
    // il livello: le vendite di questo prodotto; dopo le soglie la parte di chi sviluppa scende e la tua sale
    const l = a.livello, livello = a.mio || !l ? null : el('p', { class: 'livello-venditore piccolo' },
      l.livello ? [el('span', { class: `pp-top livello-${l.livello}` }, t(l.livello > 1 ? 'Top seller oro' : 'Top seller')), ' ',
        t('{n} vendite confermate: a chi lo sviluppa va il {d} invece del {b}.', { n: l.vendite, d: pc(1 - a.quotaLivello), b: pc(1 - a.quota) }),
        l.prossimo ? ` ${t('Fra {m} vendite confermate sali ancora.', { m: l.prossimo.mancano })}` : '']
        : l.prossimo ? t('{n} vendite confermate. Alla {soglia}ª sei Top seller: a chi lo sviluppa va meno, a te di più.', { n: l.vendite, soglia: l.prossimo.da }) : null);
    const lascia = el('button', { type: 'button', class: 'bottone fantasma piccolo', onclick: async e => {
      const b = e.currentTarget;
      if (await conferma(t('Smettere di offrire {nome}?', { nome: a.nome }), 'Il tuo link smette di funzionare e non comparirai più tra chi lo installa. I clienti che hai già restano tuoi.', { si: 'Lascia', pericolo: true }))
        occupato(b, async () => { await chiama('POST', '/api/adozioni/lascia', { prodotto: a.id }); avviso('Non lo offri più.'); await aggiorna('adozioni'); }, m);
    } }, t('Lascia'));
    return carta({ class: 'adozione', 'data-chiave': `a${a.id}` },
      el('div', { class: 'titoletto' }, el('div', {}, el('h3', {}, el('a', { href: `/p/${a.slug}` }, pubblico(a.nome))), el('span', { class: 'tenue piccolo' }, conta(a.clienti, 'cliente attivo', 'clienti attivi'))),
        el('div', { class: 'azioni' }, a.stato === 'pubblicato' ? null : stato(a.stato), lascia)),
      el('p', { class: 'tenue piccolo' }, t('Il tuo prezzo: {x} l\'installazione', { x: euro(a.prezzo_avvio) }),
        a.prezzo_mese ? ` · ${t('l\'assistenza di ogni mese ({x}) la dai tu: il 60% del canone è tuo', { x: euro(a.prezzo_mese) })}` : ''),
      livello,
      a.manca ? el('div', { class: 'avviso attesa' }, el('p', {}, a.manca === 'corso' ? t('Non compari fra chi lo installa finché non superi il test del corso per installatori.')
        : t('È un programma impegnativo: non compari fra chi lo installa finché non hai le installazioni confermate che servono.'))) : null,
      // il programma partner dell'azienda: se è obbligatorio e non l'hai confermato, non compari fra chi lo installa
      a.programma ? el('div', { class: `avviso ${a.programma.obbligatorio && !a.programma_accettato ? 'attesa' : ''}` }, el('div', {},
        el('p', {}, el('strong', {}, t('Programma partner: ')), el('span', { 'data-no-t': '' }, a.programma.nome), ' ', el('a', { href: a.programma.url, target: '_blank', rel: 'noopener' }, t('Aderisci dal loro modulo'))),
        el('p', { class: 'piccolo', 'data-no-t': '' }, a.programma.termini),
        a.programma.obbligatorio && !a.programma_accettato ? [el('p', { class: 'piccolo' }, t('Non compari fra chi lo installa finché non confermi di rispettare le condizioni del programma partner.')),
          el('button', { type: 'button', class: 'bottone piccolo', onclick: e => occupato(e.currentTarget, async () => {
            await chiama('POST', '/api/adozioni/programma', { prodotto: a.id }); avviso('Confermato: ora compari fra chi lo installa'); await aggiorna('adozioni');
          }, m) }, t('Rispetto le condizioni: confermo'))] : null)) : null,
      a.mio ? el('p', { class: 'tenue piccolo' }, t('È un tuo prodotto: tieni anche la parte di chi vende; la parte di chi sviluppa si divide come sempre con gli altri owner e i collaboratori, se ci sono.'))
        : el('div', { class: 'campo' }, el('span', {}, t('La tua parte')), divisione(a, { prodotto: a.id, lato: 'installatore', altro: a.builder || t('chi sviluppa il progetto'), blocco: 'adozioni' })),
      el('div', { class: 'campo' }, el('span', {}, t('Il tuo link personale')),
        el('div', { class: 'copia' }, el('code', { 'data-no-t': '' }, a.link), el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: e => copia(a.link, e.currentTarget) }, t('Copia')))),
      a.stato === 'pubblicato' ? fz : el('p', { class: 'aiuto' }, t('Zona: {z}. Potrai cambiarla quando il prodotto torna pubblicato.', { z: a.zona || '—' })),
      el('details', { class: 'piega' }, el('summary', {}, t('Guida d\'installazione')), el('p', { class: 'guida', 'data-no-t': '' }, a.guida || '—'),
        el('a', { href: a.url, target: '_blank', rel: 'noopener', class: 'piccolo' }, t('Il progetto su GitHub'))),
      m);
  }));
}
