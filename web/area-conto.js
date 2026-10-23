// Il conto: notifiche (elenco e preferenze per gruppo e canale), sicurezza (password, email, verifica in due passaggi,
// passkey, sessioni, GitHub), profilo pubblico con l'anteprima, e i tuoi dati (esportazione, cancellazione del conto).
import { el, t, chiama, occupato, conferma, avviso, copia, dataOra, data, svg, avatar, occhi, OCCHIO, dati as datiForm } from './comune.js';
import { creaPasskey } from './passkey.js';
import { S, blocco, aggiorna, carta, testa, titoletto, vuoto, bottone, link, messaggio, bene, campo, pubblico, scarica } from './area-base.js';

// ======================= Notifiche =======================
const GRUPPI = { vendite: ['Vendite e pagamenti', 'nuove vendite, pagamenti in crypto, abbonamenti chiusi, rimborsi'], soldi: ['Versamenti', 'quando una tua quota arriva sul conto'],
  prodotti: ['Prodotti e collaborazioni', 'revisioni, nuovi installatori, inviti a collaborare'], release: ['Nuove versioni', 'le release dei prodotti che installi'],
  clienti: ['Richieste e recensioni', 'i business che ti scrivono, le recensioni nuove'] };

export function notifiche(radice) {
  radice.append(testa('Notifiche', 'Tutto quello che succede sui tuoi prodotti e sui tuoi soldi, e dove vuoi saperlo.'), blocco('elenco', elenco), blocco('preferenze', preferenze));
}
async function elenco() {
  const n = await chiama('GET', '/api/notifiche'), m = messaggio();
  const segna = n.nonLette ? bottone('Segna tutte come lette', 'secondario piccolo', e => occupato(e.currentTarget, async () => {
    await chiama('POST', '/api/notifiche/lette', {}); avviso('Tutte lette.'); await aggiorna('elenco');
    document.querySelector('header.barra .contatore')?.classList.add('nascosto');
  }, m)) : null;
  return carta({}, titoletto(n.nonLette ? t('{n} da leggere', { n: n.nonLette }) : 'Tutte lette', segna), m,
    n.notifiche.length ? el('div', { class: 'lista-righe' }, ...n.notifiche.map(x => el('a', { href: x.link || '#notifiche', class: `riga-notifica${x.letta ? '' : ' nuova'}` },
      el('span', {}, x.testo), el('small', { class: 'tenue' }, dataOra(x.creata)))))
      : vuoto('Nessuna notifica, per ora', 'Qui vedrai vendite, versamenti, richieste e nuove versioni dei prodotti.'));
}
function preferenze(io) {
  const p = io.preferenze, chat = io.telegram || io.discord || io.slack;
  const salva = async (canale, gruppo, valore, input) => {
    input.disabled = true;
    try { const r = await chiama('POST', '/api/io/preferenze', { [canale]: { [gruppo]: valore } }); S.io.preferenze = r; avviso('Preferenze salvate.'); }
    catch (e) { input.checked = !valore; avviso(e.message, { errore: true }); }
    finally { input.disabled = false; }
  };
  const interruttore = (canale, g) => {
    const i = el('input', { type: 'checkbox', class: 'interruttore', checked: p[canale][g] ? true : null, 'aria-label': t('{gruppo} via {canale}', { gruppo: t(GRUPPI[g][0]), canale: t(canale === 'email' ? 'email' : 'chat') }) });
    i.addEventListener('change', () => salva(canale, g, i.checked, i)); return i;
  };
  return carta({}, titoletto('Dove ricevi le notifiche'),
    el('p', { class: 'tenue' }, t('Nell\'area le vedi sempre. Qui scegli cosa ti arriva anche per email e in chat.'), ' ',
      chat ? '' : el('span', {}, t('La chat è Telegram, Discord o Slack:'), ' ', el('a', { href: '#integrazioni' }, t('collegane una')), '.')),
    el('div', { class: 'tabella' }, el('table', { class: 'preferenze' }, el('thead', {}, el('tr', {}, el('th', {}, t('Notifica')), el('th', { class: 'centro' }, t('Email')), el('th', { class: 'centro' }, t('Chat')))),
      el('tbody', {}, ...Object.keys(GRUPPI).filter(g => p.email[g] !== undefined).map(g => el('tr', {},
        el('td', {}, el('strong', {}, t(GRUPPI[g][0])), el('div', { class: 'tenue piccolo' }, t(GRUPPI[g][1]))),
        el('td', { class: 'centro' }, interruttore('email', g)), el('td', { class: 'centro' }, interruttore('chat', g))))))),
    el('p', { class: 'aiuto' }, t('Le email sulla sicurezza del conto (nuovi accessi, password, verifica in due passaggi) arrivano sempre.')));
}

// ======================= Sicurezza =======================
const parola = (name, autocomplete, extra = {}) => {
  const s = el('span', { class: 'parola' }, el('input', { type: 'password', name, autocomplete, required: true, ...extra }),
    el('button', { type: 'button', class: 'occhio', 'aria-label': t('Mostra la password'), 'aria-pressed': 'false' }, svg(OCCHIO.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))));
  return s;
};
export function sicurezza(radice) {
  radice.append(testa('Sicurezza', 'Come entri nel tuo conto, e da dove sei entrato.'),
    blocco('2fa', dueFattori), blocco('passkey', passkey), blocco('password', password), blocco('email', email), blocco('sessioni', sessioni), blocco('github', github));
}
function password(io) {
  const m = messaggio();
  if (!io.email) return carta({}, titoletto('Password'), el('p', { class: 'tenue' }, t('Sei entrato con GitHub. Per usare anche una password aggiungi prima un\'email, qui sotto.')));
  const f = el('form', { class: 'modulo', novalidate: true },
    io.haParola ? el('input', { type: 'text', name: 'username', autocomplete: 'username', value: io.email, class: 'nascosto', 'aria-hidden': 'true', tabindex: '-1' }) : null,
    io.haParola ? campo('Password attuale', parola('attuale', 'current-password')) : null,
    campo(io.haParola ? 'Nuova password' : 'Password', parola('nuova', 'new-password', { minlength: '10' }), 'Almeno 10 caratteri. Meglio una frase che ricordi facilmente.'),
    el('div', { class: 'azioni' }, el('button', { type: 'submit', class: 'bottone secondario' }, t(io.haParola ? 'Cambia la password' : 'Crea la password'))), m);
  f.addEventListener('submit', e => {
    e.preventDefault();
    occupato(f.querySelector('button[type=submit]'), async () => {
      await chiama('POST', '/api/parola', { attuale: f.elements.attuale?.value, nuova: f.elements.nuova.value });
      f.reset(); avviso(io.haParola ? 'Password cambiata. Le altre sessioni sono state chiuse.' : 'Password creata: ora puoi entrare anche con email e password.');
      await aggiorna(['password', 'sessioni']);
    }, m);
  });
  occhi(f);
  return carta({}, titoletto('Password'), io.haParola ? null : el('p', { class: 'tenue' }, t('Sei entrato con GitHub: crea una password per entrare anche con la tua email.')), f);
}
function email(io) {
  const m = messaggio();
  const f = el('form', { class: 'modulo', novalidate: true },
    campo(io.email ? 'Nuova email' : 'La tua email', el('input', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'nome@esempio.it' })),
    io.haParola ? campo('Password attuale', parola('parola', 'current-password')) : null,
    el('div', { class: 'azioni' }, el('button', { type: 'submit', class: 'bottone secondario' }, t(io.email ? 'Cambia l\'email' : 'Aggiungi l\'email'))), m);
  f.addEventListener('submit', e => {
    e.preventDefault();
    occupato(f.querySelector('button[type=submit]'), async () => {
      const r = await chiama('POST', '/api/email', { email: f.elements.email.value, parola: f.elements.parola?.value });
      f.reset(); m.className = 'messaggio bene'; m.textContent = t('Ti abbiamo scritto a {email}: apri il link per confermarla. Fino ad allora resta quella di prima.', { email: r.conferma });
    }, m);
  });
  occhi(f);
  return carta({}, titoletto('Email', io.email ? (io.emailVerificata ? el('span', { class: 'pillola ok' }, t('confermata')) : el('span', { class: 'pillola in_attesa' }, t('da confermare'))) : null),
    io.email ? el('p', {}, el('span', { class: 'mono', 'data-no-t': '' }, io.email)) : el('p', { class: 'tenue' }, t('Non hai ancora un\'email: serve per ricevere vendite e versamenti, e per recuperare il conto.')),
    f);
}
function codiciRecupero(codici, fine) {
  const testo = codici.join('\n');
  const bc = el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: () => copia(testo, bc) }, t('Copia'));
  return el('div', { class: 'codici-box bolla' }, el('span', { class: 'bollino' }, t('una volta sola')),
    el('div', { class: 'avviso attesa' }, el('span', {}, t('Questi sono i tuoi 10 codici di recupero. Ognuno vale una volta sola, se perdi il telefono. Salvali adesso in un posto sicuro: non li mostreremo più.'))),
    el('ol', { class: 'codici', 'data-no-t': '' }, ...codici.map(c => el('li', {}, el('code', {}, c)))),
    el('div', { class: 'azioni' }, bc,
      el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: () => scarica(`codici-recupero-${S.io.codice}.txt`, `${t('Codici di recupero')} · ${location.host}\n${new Date().toLocaleString()}\n\n${testo}\n`) }, t('Scarica .txt')),
      fine ? el('button', { type: 'button', class: 'bottone piccolo', onclick: fine }, t('Li ho salvati')) : null));
}
function dueFattori(io) {
  const m = messaggio(), s = io.sicurezza;
  const box = el('div', {});
  if (s.dueFattori) {
    const chiedi = async (titolo, testo, si, pericolo) => conferma(titolo, testo, { si, pericolo, campo: { etichetta: 'Codice dell\'app (o un codice di recupero)', tipo: 'text', autocomplete: 'one-time-code' } });
    return carta({ class: 'dueFattori' }, titoletto('Verifica in due passaggi', el('span', { class: 'pillola ok' }, t('attiva'))),
      el('p', { class: 'tenue' }, t('A ogni accesso, dopo la password, ti chiediamo il codice dell\'app di autenticazione.'), ' ',
        t('Ti restano {n} codici di recupero.', { n: s.codiciRimasti })),
      s.codiciRimasti <= 3 ? el('div', { class: 'avviso attesa' }, t('Ti restano pochi codici di recupero: generane di nuovi.')) : null,
      el('div', { class: 'azioni' },
        bottone('Nuovi codici di recupero', 'secondario piccolo', async e => {
          const b = e.currentTarget, c = await chiedi('Nuovi codici di recupero', 'Quelli vecchi smetteranno di funzionare.', 'Genera', false);
          if (c) occupato(b, async () => { const r = await chiama('POST', '/api/2fa/codici', { codice: c }); box.replaceChildren(codiciRecupero(r.codici, () => aggiorna('2fa'))); }, m);
        }),
        bottone('Disattiva', 'pericolo piccolo', async e => {
          const b = e.currentTarget, c = await chiedi('Disattivare la verifica in due passaggi?', 'Il conto sarà protetto solo dalla password.', 'Disattiva', true);
          if (c) occupato(b, async () => { await chiama('POST', '/api/2fa/spegni', { codice: c }); avviso('Verifica in due passaggi disattivata.'); await aggiorna('2fa'); }, m);
        })), m, box);
  }
  const inizia = bottone('Attiva', '', () => occupato(inizia, async () => {
    const r = await chiama('POST', '/api/2fa/inizia', {});
    const codice = el('input', { type: 'text', name: 'codice', class: 'codice-otp', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]*', placeholder: '000000', required: true });
    const mm = messaggio();
    const f = el('form', { class: 'modulo', novalidate: true }, campo('Il codice di 6 cifre che vedi nell\'app', codice),
      el('div', { class: 'azioni' }, el('button', { type: 'submit', class: 'bottone' }, t('Conferma e attiva')), el('button', { type: 'button', class: 'bottone fantasma', onclick: () => aggiorna('2fa', { rileggi: false }) }, t('Annulla'))), mm);
    f.addEventListener('submit', e => {
      e.preventDefault();
      occupato(f.querySelector('button[type=submit]'), async () => {
        const x = await chiama('POST', '/api/2fa/conferma', { codice: codice.value.replace(/\s/g, '') });
        avviso('Verifica in due passaggi attiva.');
        box.replaceChildren(codiciRecupero(x.codici, () => aggiorna(['2fa', 'sessioni'])));
        inizia.remove();
      }, mm);
    });
    box.replaceChildren(el('div', { class: 'attiva-2fa' },
      el('div', {}, el('div', { class: 'qr' }, svg(r.qr)), el('a', { class: 'piccolo', href: r.uri }, t('Sul telefono? Apri nell\'app'))),
      el('div', { class: 'modulo' }, el('ol', { class: 'passi-2fa' },
        el('li', {}, t('Apri l\'app di autenticazione (Google Authenticator, 1Password, Authy, Aegis…).')),
        el('li', {}, t('Inquadra il codice QR, oppure scrivi a mano questo segreto:')),
      ), el('div', { class: 'copia bolla-segreto' }, el('code', { class: 'segreto', 'data-no-t': '' }, r.segreto), el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: e => copia(r.segreto.replace(/\s/g, ''), e.currentTarget) }, t('Copia'))),
      f)));
    inizia.classList.add('nascosto'); codice.focus();
  }, m));
  return carta({ class: 'dueFattori' }, titoletto('Verifica in due passaggi', el('span', { class: 'pillola' }, t('spenta'))),
    el('p', { class: 'tenue' }, t('Oltre alla password, un codice che cambia ogni 30 secondi sul tuo telefono. A chi ruba la password, da sola, non basta per entrare.')),
    el('div', { class: 'azioni' }, inizia), m, box);
}
function passkey(io) {
  const m = messaggio(), l = io.sicurezza.passkey;
  const aggiungi = bottone('Aggiungi una passkey', 'secondario piccolo', async () => {
    const nome = await conferma('Aggiungi una passkey', 'Dai un nome a questa passkey, per riconoscerla (per esempio il dispositivo).', { si: 'Continua', campo: { etichetta: 'Nome', segnaposto: 'es. MacBook di casa' } });
    if (nome === false) return;
    occupato(aggiungi, async () => {
      const opzioni = await chiama('POST', '/api/passkey/opzioni', {});
      const risposta = await creaPasskey(opzioni);
      await chiama('POST', '/api/passkey/registra', { risposta, nome: nome || 'Passkey' });
      avviso('Passkey aggiunta: la prossima volta entri con l\'impronta o il volto.'); await aggiorna('passkey');
    }, m);
  });
  return carta({}, titoletto('Passkey', aggiungi),
    el('p', { class: 'tenue' }, t('Entri con l\'impronta, il volto o il PIN del dispositivo, senza password. Una passkey vale già come verifica in due passaggi.')), m,
    l.length ? el('div', { class: 'lista-righe' }, ...l.map(p => {
      const mm = messaggio();
      return el('div', {}, el('div', { class: 'cresce' }, el('strong', { 'data-no-t': '' }, p.nome), p.backup_attiva ? el('span', { class: 'chip' }, t('sincronizzata')) : null,
        el('div', { class: 'tenue piccolo' }, t('aggiunta il {d}', { d: data(p.creata) }), ' · ', p.usata ? t('usata l\'ultima volta il {d}', { d: dataOra(p.usata) }) : t('mai usata')), mm),
        el('div', { class: 'azioni' },
          bottone('Rinomina', 'fantasma piccolo', async e => {
            const b = e.currentTarget, nome = await conferma('Rinomina la passkey', null, { si: 'Salva', campo: { etichetta: 'Nome', segnaposto: p.nome } });
            if (nome) occupato(b, async () => { await chiama('POST', '/api/passkey/rinomina', { id: p.id, nome }); avviso('Passkey rinominata.'); await aggiorna('passkey'); }, mm);
          }),
          bottone('Elimina', 'pericolo piccolo', async e => {
            const b = e.currentTarget;
            if (await conferma(t('Eliminare «{nome}»?', { nome: p.nome }), 'Da quel dispositivo non potrai più entrare con la passkey. Ricordati di toglierla anche dal gestore delle password.', { si: 'Elimina', pericolo: true }))
              occupato(b, async () => { await chiama('POST', '/api/passkey/elimina', { id: p.id }); avviso('Passkey eliminata.'); await aggiorna('passkey'); }, mm);
          })));
    })) : vuoto('Nessuna passkey', 'Aggiungine una per entrare più in fretta e in modo più sicuro.'));
}
const METODI = { parola: 'password', link: 'link via email', github: 'GitHub', passkey: 'passkey' };
function sessioni(io) {
  const m = messaggio(), l = io.sicurezza.sessioni, altre = l.filter(s => !s.attuale).length;
  return carta({}, titoletto('Dove sei entrato', altre ? bottone('Chiudi tutte le altre', 'pericolo piccolo', async e => {
    const b = e.currentTarget;
    if (await conferma('Chiudere tutte le altre sessioni?', 'Su ogni altro dispositivo dovrai rientrare. Questa resta aperta.', { si: 'Chiudi', pericolo: true }))
      occupato(b, async () => { const r = await chiama('POST', '/api/sessioni/chiudi', { altre: true }); avviso(t('Chiuse: {n}.', { n: r.chiuse })); await aggiorna('sessioni'); }, m);
  }) : null), m,
  el('div', { class: 'lista-righe' }, ...l.map(s => {
    const mm = messaggio();
    const metodo = String(s.metodo || '').split('+').map(x => t(METODI[x] || (x === '2fa' ? 'codice' : x))).join(' + ');
    return el('div', { class: s.attuale ? 'sessione attuale' : 'sessione' },
      el('div', { class: 'cresce' }, el('strong', {}, s.agente || t('Dispositivo sconosciuto')), ' ', s.attuale ? el('span', { class: 'pillola ok' }, t('questa')) : null,
        el('div', { class: 'tenue piccolo' }, `${s.ip || '—'} · ${metodo} · `, t('ultimo uso {d}', { d: dataOra(s.vista) })), mm),
      s.attuale ? null : bottone('Chiudi', 'fantasma piccolo', e => occupato(e.currentTarget, async () => { await chiama('POST', '/api/sessioni/chiudi', { id: s.id }); avviso('Sessione chiusa.'); await aggiorna('sessioni'); }, mm)));
  })));
}
function github(io) {
  const m = messaggio();
  return carta({}, titoletto('GitHub', io.github ? el('span', { class: 'pillola ok' }, t('collegato')) : null),
    io.github ? el('p', {}, t('Collegato come'), ' ', el('a', { class: 'mono', href: `https://github.com/${io.github}`, target: '_blank', rel: 'noopener' }, `@${io.github}`), '. ',
      t('Serve per mettere in vendita i tuoi progetti e per gli inviti a collaborare.'))
      : el('p', { class: 'tenue' }, t('Collegalo per mettere in vendita i tuoi progetti open source o per mantenerne uno con chi l\'ha scritto. Non chiediamo permessi sui repository.')),
    el('div', { class: 'azioni' }, io.github ? bottone('Scollega GitHub', 'fantasma piccolo', async e => {
      const b = e.currentTarget;
      if (await conferma('Scollegare GitHub?', 'Non potrai più entrare con GitHub né mettere in vendita nuovi progetti. Per entrare userai email e password.', { si: 'Scollega', pericolo: true }))
        occupato(b, async () => { await chiama('POST', '/api/github/scollega', {}); avviso('GitHub scollegato.'); await aggiorna('github'); }, m);
    }) : link('Collega GitHub', '/auth/github', 'bottone secondario piccolo')), m);
}

// ======================= Profilo =======================
export function profilo(radice, io) {
  const m = messaggio();
  const f = el('form', { class: 'modulo', novalidate: true },
    el('div', { class: 'campi' }, campo('Nome', el('input', { type: 'text', name: 'nome', value: io.nome, maxlength: '80', autocomplete: 'name', required: true })),
      campo('Zona', el('input', { type: 'text', name: 'zona', value: io.zona || '', maxlength: '60', placeholder: 'es. Bergamo e provincia' }), 'Dove lavori: la usano i business per trovarti.')),
    campo('Chi sei', el('textarea', { name: 'bio', maxlength: '600', rows: '4', placeholder: 'Cosa sai fare, per chi lavori, da quanto tempo.' }, io.bio || '')),
    el('div', { class: 'campi' }, campo('Sito', el('input', { type: 'url', name: 'sito', value: io.sito || '', placeholder: 'https://…' })),
      campo('Link al calendario', el('input', { type: 'url', name: 'calendario', value: io.calendario || '', placeholder: 'https://cal.com/…' }), 'Cal.com, Calendly o simili.')),
    campo('Lingua', (() => { const s = el('select', { name: 'lingua' }, el('option', { value: 'it' }, 'Italiano'), el('option', { value: 'en' }, 'English')); s.value = io.lingua || 'it'; return s; })(),
      'Per le pagine e per le email che ti mandiamo.'),
    el('div', { class: 'azioni' }, el('button', { type: 'submit', class: 'bottone' }, t('Salva il profilo')), el('a', { class: 'bottone fantasma', href: `/u/${io.codice}`, target: '_blank', rel: 'noopener' }, t('Apri il profilo pubblico'))), m);
  const anteprima = el('div', {});
  const disegna = () => {
    const x = datiForm(f);
    anteprima.replaceChildren(carta({ class: 'anteprima-profilo' }, el('div', { class: 'etichetta' }, t('Come ti vedono i business')),
      el('div', { class: 'saluto' }, avatar({ nome: x.nome, avatar: io.avatar }, 'grande'), el('div', {}, el('h3', {}, pubblico(x.nome || '—')), el('div', { class: 'tenue piccolo' }, pubblico(x.zona || '')))),
      x.bio ? el('p', { 'data-no-t': '' }, x.bio) : el('p', { class: 'tenue piccolo' }, t('Scrivi due righe su di te: chi le legge si fida di più.')),
      el('div', { class: 'azioni' }, x.sito ? el('a', { class: 'bottone secondario piccolo', href: x.sito, target: '_blank', rel: 'noopener' }, t('Sito')) : null,
        x.calendario ? el('a', { class: 'bottone piccolo', href: x.calendario, target: '_blank', rel: 'noopener' }, t('Prenota una chiamata')) : null),
      el('p', { class: 'piccolo tenue mono', 'data-no-t': '' }, `${location.host}/u/${io.codice}`)));
  };
  f.addEventListener('input', disegna); disegna();
  f.addEventListener('submit', e => {
    e.preventDefault();
    occupato(f.querySelector('button[type=submit]'), async () => {
      const x = datiForm(f); await chiama('POST', '/api/io', x);
      if (x.lingua !== S.io.lingua) { location.reload(); return; }
      S.io = { ...S.io, ...x }; bene(m, 'Profilo salvato.');
    }, m);
  });
  radice.append(testa('Profilo', 'Quello che vedono i business e gli altri iscritti sulla tua pagina pubblica.'), el('div', { class: 'due' }, carta({}, f), anteprima));
}

// ======================= I tuoi dati =======================
export function dati(radice, io) {
  const m = messaggio(), mc = messaggio();
  const esporta = bottone('Scarica i miei dati', 'secondario', () => occupato(esporta, async () => {
    const r = await fetch('/api/io/esporta', { credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).errore || t('Qualcosa non ha funzionato: riprova'));
    const nome = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'dati.json';
    scarica(nome, await r.text(), 'application/json'); bene(m, 'Fatto: il file è nei tuoi download.');
  }, m));
  const cancella = bottone('Cancella il mio conto', 'pericolo', async () => {
    const v = await conferma('Cancellare il conto?', 'Non si può annullare. I tuoi prodotti escono dal catalogo, le sessioni si chiudono, i collegamenti si tolgono.',
      { si: 'Cancella per sempre', pericolo: true, campo: io.haParola ? { etichetta: 'La tua password', tipo: 'password', autocomplete: 'current-password' } : { etichetta: t('Scrivi il tuo codice: {codice}', { codice: io.codice }) } });
    if (v === false) return;
    occupato(cancella, async () => { await chiama('POST', '/api/io/cancella', io.haParola ? { parola: v } : { conferma: v }); location.href = '/'; }, mc);
  });
  radice.append(testa('I tuoi dati', 'Sono tuoi: puoi averne una copia o cancellarli quando vuoi.'),
    carta({}, titoletto('Una copia di tutto'), el('p', { class: 'tenue' }, t('Un file JSON con profilo, prodotti, adozioni, quote, richieste ricevute, notifiche, sessioni, webhook e chiavi (solo il nome e l\'inizio, mai il segreto).')),
      el('div', { class: 'azioni' }, esporta), m),
    carta({ class: 'zona-pericolo' }, titoletto('Cancella il conto'),
      el('p', {}, t('Cancelliamo nome, email, password, profilo, GitHub, wallet, sessioni, passkey, webhook, chiavi, notifiche e richieste ricevute.')),
      el('p', { class: 'tenue' }, t('Per legge restano solo le registrazioni dei pagamenti già fatti, senza il tuo nome, e, se hai ricevuto versamenti, i dati fiscali cifrati per il tempo che chiede la legge.')),
      el('ul', { class: 'tenue piccolo' }, el('li', {}, t('Prima devi ricevere le quote ancora in attesa.')), el('li', {}, t('E i clienti con un abbonamento attivo devono passare a un altro installatore o chiudere.'))),
      el('div', { class: 'azioni' }, cancella), mc));
}
