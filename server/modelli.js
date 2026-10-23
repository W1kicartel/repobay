// I testi delle email, in italiano o in inglese: per ogni tipo l'oggetto, il testo semplice (sempre completo) e l'html.
// L'html è volutamente semplice: una tabella da 600 px con gli stili in linea (nelle email non c'è CSP né foglio di stile),
// bianco e nero, font di sistema, un bottone nero per l'azione principale e il link ripetuto in chiaro sotto.
// Ogni valore che arriva da fuori passa da esc() nell'html e da riga() negli oggetti: niente tag né a capo dove non devono stare.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const riga = (s, max = 120) => String(s ?? '').replace(/[\x00-\x1f\x7f\s]+/g, ' ').trim().slice(0, max);   // una riga sola, corta
export const LINGUE = ['it', 'en'];
const LOCALE = { it: 'it-IT', en: 'en-IE' };   // en-IE: euro con il simbolo davanti e la virgola delle migliaia (€1,290.00)
const EURO = Object.fromEntries(LINGUE.map(l => [l, new Intl.NumberFormat(LOCALE[l], { style: 'currency', currency: 'EUR' })]));
const QUANDO = Object.fromEntries(LINGUE.map(l => [l, new Intl.DateTimeFormat(LOCALE[l], { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome', timeZoneName: 'short' })]));
export const euro = (centesimi, lingua = 'it') => {
  const n = Number(centesimi); if (!Number.isFinite(n)) throw new Error('importo non valido');
  return (EURO[lingua] || EURO.it).format(n / 100);
};
const GIORNO = Object.fromEntries(LINGUE.map(l => [l, new Intl.DateTimeFormat(LOCALE[l], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' })]));
const giorno = (q, l) => { const d = new Date(q ?? Date.now()); return Number.isNaN(d.getTime()) ? riga(q) : GIORNO[l].format(d); };
const data = (q, l) => { const d = q instanceof Date ? q : new Date(q ?? Date.now()); return Number.isNaN(d.getTime()) ? riga(q) : QUANDO[l].format(d); };
// il mese del rapporto ('AAAA-MM' → «settembre 2026»), le percentuali con la virgola giusta
const MESE = Object.fromEntries(LINGUE.map(l => [l, new Intl.DateTimeFormat(LOCALE[l], { month: 'long', year: 'numeric', timeZone: 'UTC' })]));
const mese = (m, l) => { const d = new Date(`${riga(m, 7)}-01T00:00:00Z`); return Number.isNaN(d.getTime()) ? riga(m) : MESE[l].format(d); };
const pc = (x, l) => `${new Intl.NumberFormat(LOCALE[l], { maximumFractionDigits: 2 }).format(Number(x) || 0)}%`;
// le righe del rapporto del mese, nelle due lingue
function righeRapporto(d, l) {
  const it = l === 'it', v = d.versioni || [], ok = v.filter(x => x.controllo === 'ok').length, guardare = v.filter(x => x.controllo && x.controllo !== 'ok').length;
  const dsp = d.disponibilita, r = d.richieste || {};
  return [
    [it ? 'Disponibilità' : 'Uptime', dsp ? `${pc(dsp.percentuale, l)} (${dsp.controlli} ${it ? 'controlli' : 'checks'}, ${dsp.cadute ? `${dsp.cadute} ${it ? (dsp.cadute === 1 ? 'interruzione' : 'interruzioni') : (dsp.cadute === 1 ? 'outage' : 'outages')}` : (it ? 'nessuna interruzione' : 'no outages')})`
      : d.sito ? (it ? 'controlli appena iniziati' : 'checks just started') : (it ? 'non controllato: scrivici l\'indirizzo del programma' : 'not monitored: send us the program\'s address')],
    [it ? 'Versioni nuove' : 'New versions', v.length ? (it ? `${v.length} ${v.length === 1 ? 'uscita' : 'uscite'}, ${ok} ${ok === 1 ? 'controllata' : 'controllate'} senza problemi${guardare ? `, ${guardare} da guardare` : ''}`
      : `${v.length} released, ${ok} checked with no problems${guardare ? `, ${guardare} to look at` : ''}`) : (it ? 'nessuna questo mese' : 'none this month')],
    [it ? 'Richieste' : 'Requests', r.aperte ? `${r.aperte} ${it ? 'aperte' : 'opened'}, ${r.risolte} ${it ? 'risolte' : 'solved'}${r.ore != null ? (it ? `, prima risposta in ${String(r.ore).replace('.', ',')} ore in media` : `, first answer in ${r.ore} hours on average`) : ''}`
      : (it ? 'nessuna: tutto tranquillo' : 'none: all quiet')],
    ...(d.cert_scade ? [[it ? 'Certificato HTTPS' : 'HTTPS certificate', `${it ? 'valido fino al' : 'valid until'} ${giorno(d.cert_scade, l)}`]] : []),
  ];
}
// i link nei bottoni: solo http e https, mai javascript: o simili
function link(l) {
  let u; try { u = new URL(String(l)); } catch { throw new Error(`link non valido: ${riga(l, 40)}`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('link non valido: solo http e https');
  return u.href;
}

// le parti comuni, per lingua
const COMUNE = {
  it: { ciao: n => n ? `Ciao ${n}` : 'Ciao', bottone: 'Se il bottone non funziona, copia questo indirizzo nel browser:',
    piede: n => `Ricevi questa email perché sei iscritto a ${n}. Notifiche:`, ruoli: { builder: 'builder', installatore: 'installatore' } },
  en: { ciao: n => n ? `Hi ${n}` : 'Hi', bottone: 'If the button doesn\'t work, copy this address into your browser:',
    piede: n => `You're receiving this email because you have an account on ${n}. Notifications:`, ruoli: { builder: 'builder', installatore: 'installer' } },
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const P = 'margin:0 0 16px;font-size:16px;line-height:1.5;color:#000000';

// m = { oggetto, titolo, paragrafi: [testo], righe: [[etichetta, valore]], citazione, azione: { etichetta, link }, dopo: [testo], piede }
function componi(m, { nome, url, saluto, lingua }) {
  const C = COMUNE[lingua];
  const az = m.azione && { etichetta: m.azione.etichetta, href: link(m.azione.link) };
  const notifiche = m.piede ? link(`${url}/area#notifiche`) : '';
  const testo = [
    `${saluto},`, '',
    ...m.paragrafi.flatMap(p => [p, '']),
    ...(m.righe?.length ? [...m.righe.map(([k, v]) => `${k}: ${v}`), ''] : []),
    ...(m.citazione != null ? [...String(m.citazione).split(/\r\n|\r|\n/).map(r => `> ${r}`), ''] : []),
    ...(az ? [`${az.etichetta}: ${az.href}`, ''] : []),
    ...(m.dopo || []).flatMap(p => [p, '']),
    `— ${nome}`,
    ...(m.piede ? ['', '--', `${C.piede(nome)} ${url}/area#notifiche`] : []),
  ].join('\n');

  const par = s => `<p style="${P}">${esc(s)}</p>`;
  const html = `<!doctype html>
<html lang="${lingua}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(m.oggetto)}</title></head>
<body style="margin:0;padding:0;background-color:#ffffff;color:#000000">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:${FONT};color:#000000">
<tr><td style="padding:0 0 24px;font-size:15px;font-weight:700;letter-spacing:0.02em;color:#000000">${esc(nome)}</td></tr>
<tr><td style="border-top:2px solid #000000;padding:24px 0 8px">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;color:#000000">${esc(m.titolo)}</h1>
${par(`${saluto},`)}
${m.paragrafi.map(par).join('\n')}
${m.righe?.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 16px;border-collapse:collapse">
${m.righe.map(([k, v]) => `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #000000;font-size:14px;color:#000000;white-space:nowrap">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #000000;font-size:16px;font-weight:600;color:#000000">${esc(v)}</td></tr>`).join('\n')}
</table>` : ''}
${m.citazione != null ? `<blockquote style="margin:0 0 16px;padding:4px 0 4px 16px;border-left:3px solid #000000;font-size:16px;line-height:1.5;color:#000000">${esc(m.citazione).replace(/\r\n|\r|\n/g, '<br>')}</blockquote>` : ''}
${az ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px"><tr><td style="background-color:#000000;border-radius:6px"><a href="${esc(az.href)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px">${esc(az.etichetta)}</a></td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#000000">${esc(C.bottone)}<br><a href="${esc(az.href)}" style="color:#000000;text-decoration:underline;word-break:break-all">${esc(az.href)}</a></p>` : ''}
${(m.dopo || []).map(par).join('\n')}
<p style="${P}">— ${esc(nome)}</p>
</td></tr>
${m.piede ? `<tr><td style="border-top:1px solid #000000;padding:16px 0 0;font-size:12px;line-height:1.5;color:#000000">${esc(C.piede(nome))} <a href="${esc(notifiche)}" style="color:#000000;text-decoration:underline">${esc(url)}/area#notifiche</a></td></tr>` : ''}
</table>
</td></tr></table>
</body></html>
`.replace(/\n{2,}/g, '\n');
  return { oggetto: riga(m.oggetto, 200), testo, html };
}

// i tipi, per lingua: (dati, nome della piattaforma, url, ruolo tradotto) → contenuto.
// «piede: false» solo per verifica, reimposta e accesso, che non sono notifiche.
const sic = (d, u) => d.link || `${u}/area#sicurezza`, area = (d, u) => d.link || `${u}/area`;
// quanto vale il link d'accesso: 15 minuti per entrare nel conto, 30 per l'area del cliente (chi chiama passa d.minuti)
const minuti = d => (Number(d.minuti) > 0 ? Math.round(Number(d.minuti)) : 15);
// chi viene coinvolto in una richiesta di assistenza: chi sviluppa (se non si dice) o chi ha installato (d.ruolo o d.chi)
const coinvoltoInstallatore = d => d.ruolo === 'installatore' || d.chi === 'installatore';
const IT = {
  verifica: (d, n) => ({ piede: false, oggetto: `Conferma la tua email su ${n}`, titolo: 'Conferma la tua email',
    paragrafi: [`Grazie per esserti iscritto a ${n}. Manca un passo: conferma che questo indirizzo è tuo.`],
    azione: { etichetta: 'Conferma email', link: d.link },
    dopo: ['Se non ti sei iscritto tu, ignora questa email: senza conferma non succede nulla.'] }),
  reimposta: (d, n) => ({ piede: false, oggetto: `Reimposta la password di ${n}`, titolo: 'Scegli una nuova password',
    paragrafi: ['Abbiamo ricevuto una richiesta per cambiare la password del tuo conto.'],
    azione: { etichetta: 'Scegli una nuova password', link: d.link },
    dopo: ['Il link vale 1 ora e si può usare una volta sola.', 'Se non l\'hai chiesto tu, ignora questa email: la password resta quella di prima.'] }),
  accesso: (d, n) => ({ piede: false, oggetto: `Il tuo link per accedere a ${n}`, titolo: 'Entra senza password',
    paragrafi: ['Ecco il link per entrare nel tuo conto, senza password.'],
    azione: { etichetta: `Accedi a ${n}`, link: d.link },
    dopo: [`Il link vale ${minuti(d)} minuti e si può usare una volta sola.`, 'Se non l\'hai chiesto tu, ignora questa email: nessuno entra senza questo link.'] }),
  email_cambiata: (d, n, u) => ({ oggetto: `L'email del tuo conto ${n} è cambiata`, titolo: 'La tua email è cambiata',
    paragrafi: [`L'indirizzo email del tuo conto ora è ${riga(d.nuova, 200)}.`, 'Ti scriviamo qui, al vecchio indirizzo, per sicurezza: da ora i messaggi arriveranno a quello nuovo.'],
    azione: { etichetta: 'Controlla il tuo conto', link: sic(d, u) },
    dopo: ['Se non sei stato tu, cambia subito la password e scrivici.'] }),
  accesso_nuovo: (d, n, u, l) => ({ oggetto: `Nuovo accesso al tuo conto ${n}`, titolo: 'Nuovo accesso al tuo conto',
    paragrafi: ['Qualcuno è appena entrato nel tuo conto.'],
    righe: [['Quando', data(d.quando, l)], ['Dispositivo', riga(d.dispositivo, 200) || 'sconosciuto']],
    azione: { etichetta: 'Cambia la password', link: sic(d, u) },
    dopo: ['Se eri tu, non devi fare nulla.', 'Se non eri tu, cambia subito la password: chi è entrato verrà scollegato.'] }),
  due_fattori: (d, n, u) => d.attivo
    ? { oggetto: `Verifica in due passaggi attivata su ${n}`, titolo: 'Verifica in due passaggi attivata',
      paragrafi: ['Hai attivato la verifica in due passaggi. Da ora, per entrare, oltre alla password ti chiederemo un codice.'],
      azione: { etichetta: 'Vai alla sicurezza', link: sic(d, u) }, dopo: ['Se non sei stato tu, cambia subito la password.'] }
    : { oggetto: `Verifica in due passaggi disattivata su ${n}`, titolo: 'Verifica in due passaggi disattivata',
      paragrafi: ['Hai disattivato la verifica in due passaggi. Ora per entrare basta la password.'],
      azione: { etichetta: 'Vai alla sicurezza', link: sic(d, u) }, dopo: ['Se non sei stato tu, cambia subito la password e riattivala.'] },
  vendita: (d, n, u, l, ruolo) => ({ oggetto: d.rinnovo ? `Rinnovo: ${riga(d.prodotto)}` : `Nuova vendita: ${riga(d.prodotto)}`, titolo: d.rinnovo ? 'Un cliente ha rinnovato' : 'Hai una nuova vendita',
    paragrafi: [d.rinnovo ? `${riga(d.cliente) || 'Un cliente'} ha rinnovato ${riga(d.prodotto)}: ${euro(d.importo, l)} per te.` : `Un'attività ha appena scelto ${riga(d.prodotto)}.`],
    righe: [['Prodotto', riga(d.prodotto)], ['Cliente', riga(d.cliente) || '—'], ['Il tuo ruolo', ruolo], ['Importo', euro(d.importo, l)]],
    azione: { etichetta: 'Vedi le vendite', link: area(d, u) },
    dopo: [d.metodo === 'crypto' ? 'È già sul tuo wallet.' : d.metodo === 'bonifico' ? 'La tua quota te la versa a mano chi gestisce la piattaforma.'
      : `La tua quota viene versata sul conto Stripe ${Number(d.giorni) || 14} giorni dopo il pagamento.`] }),
  quota_versata: (d, n, u, l) => ({ oggetto: `Ti abbiamo versato ${euro(d.importo, l)}`, titolo: 'Quota versata',
    paragrafi: [`Abbiamo versato ${euro(d.importo, l)} sul tuo conto di pagamento collegato a ${n}.`, 'Di solito arrivano in banca in pochi giorni lavorativi.'],
    azione: { etichetta: 'Vedi i versamenti', link: area(d, u) } }),
  prodotto_esito: (d, n, u) => d.esito === 'pubblicato'
    ? { oggetto: `${riga(d.prodotto)} è pubblicato su ${n}`, titolo: 'Il tuo prodotto è pubblicato',
      paragrafi: [`Buone notizie: ${riga(d.prodotto)} è stato approvato ed è nel catalogo.`, 'Da ora gli installatori possono sceglierlo e portarlo nelle attività.'],
      ...(d.nota ? { citazione: String(d.nota).slice(0, 5000) } : {}), azione: { etichetta: 'Vai alla tua area', link: area(d, u) } }
    : { oggetto: `${riga(d.prodotto)} non è stato pubblicato`, titolo: 'Il tuo prodotto non è stato pubblicato',
      paragrafi: [`Abbiamo controllato ${riga(d.prodotto)} e per ora non possiamo pubblicarlo.`, ...(d.nota ? ['Il motivo:'] : [])],
      ...(d.nota ? { citazione: String(d.nota).slice(0, 5000) } : {}), azione: { etichetta: 'Correggi e invia di nuovo', link: area(d, u) },
      dopo: ['Quando hai sistemato, puoi inviarlo di nuovo dalla tua area.'] },
  release: d => ({ oggetto: `${riga(d.prodotto)} ${riga(d.versione, 40)}: nuova versione da installare`, titolo: `${riga(d.prodotto)} ${riga(d.versione, 40)}`,
    paragrafi: [`È uscita la versione ${riga(d.versione, 40)} di ${riga(d.prodotto)}.`, 'Leggi le novità e aggiornala dai tuoi clienti quando puoi.'],
    azione: { etichetta: 'Leggi le novità', link: d.link } }),
  nuovo_installatore: (d, n, u) => ({ oggetto: `Nuovo installatore per ${riga(d.prodotto)}`, titolo: 'Un nuovo installatore',
    paragrafi: [`${riga(d.installatore)} ha scelto di installare ${riga(d.prodotto)}${riga(d.zona) ? ` nella zona di ${riga(d.zona)}` : ''}.`, 'Ogni installazione che vende porta a te la tua parte.'],
    azione: { etichetta: 'Vedi gli installatori', link: area(d, u) } }),
  recensione: d => ({ oggetto: `Com'è andata con ${riga(d.prodotto)}?`, titolo: `Com'è andata con ${riga(d.prodotto)}?`,
    paragrafi: [`Da qualche tempo usi ${riga(d.prodotto)}. Ci dici come va?`, 'Bastano due minuti, e la tua recensione aiuta altre attività a scegliere.'],
    azione: { etichetta: 'Lascia una recensione', link: d.link } }),
  contatto: d => ({ oggetto: `Nuovo messaggio da ${riga(d.da, 80)}${riga(d.prodotto) ? ` per ${riga(d.prodotto)}` : ''}`, titolo: 'Hai un nuovo messaggio',
    paragrafi: [`${riga(d.da, 80)} (${riga(d.email, 200)}) ti ha scritto${riga(d.prodotto) ? ` per ${riga(d.prodotto)}` : ''}:`],
    citazione: String(d.messaggio ?? '').slice(0, 5000),
    dopo: [`Per rispondere, rispondi a questa email: la risposta arriva direttamente a ${riga(d.email, 200)}.`] }),
  contestazione: (d, n, u) => ({ oggetto: `Segnalazione su ${riga(d.prodotto)}`, titolo: 'Un cliente segnala un problema',
    paragrafi: [`${riga(d.cliente || 'Un cliente', 80)} dice che con ${riga(d.prodotto)} qualcosa non va:`],
    citazione: String(d.testo ?? '').slice(0, 5000),
    dopo: ['Le quote di questo acquisto restano ferme finché la segnalazione non è chiusa. Contatta subito il cliente e risolvi: se serve un rimborso, lo decide la piattaforma.'],
    azione: { etichetta: 'Vai alle tue vendite', link: area(d, u) } }),
  // l'assistenza, per chi installa e chi sviluppa (tipo: nuova, messaggio, coinvolto, sollecito, segnalata)
  assistenza: (d, n, u) => {
    const cl = riga(d.cliente || 'Un cliente', 80), p = riga(d.prodotto), t = riga(d.titolo, 120);
    const x = {
      nuova: [`${d.urgente ? 'Urgente: ' : ''}${cl} chiede assistenza su ${p}`, 'Nuova richiesta di assistenza', `${cl} ha scritto su ${p}:`],
      messaggio: [`${cl} ha scritto di nuovo: ${t}`, 'Nuovo messaggio dal cliente', `${cl} ha aggiunto un messaggio alla richiesta su ${p}:`],
      coinvolto: coinvoltoInstallatore(d) ? [`${riga(d.da, 80)} ti chiede aiuto su ${p}`, 'Serve il tuo aiuto', `${riga(d.da, 80)} segue la richiesta di ${cl} e ha bisogno di chi ha installato ${p}.`]
        : [`${riga(d.da, 80)} ti chiede aiuto su ${p}`, 'Chi installa ha bisogno di te', `${riga(d.da, 80)} segue ${cl} e ha bisogno di chi sviluppa ${p}.`],
      sollecito: [`${cl} aspetta una risposta da ${Number(d.ore) || 24} ore`, 'Una richiesta aspetta', `${cl} aspetta da più di ${Number(d.ore) || 24} ore una risposta su ${p}.`],
      segnalata: [`${cl} ha segnalato una richiesta senza risposta`, 'Richiesta segnalata alla piattaforma', `${cl} ha detto alla piattaforma che aspetta ancora una risposta su ${p}.`],
    }[d.tipo] || [`Assistenza su ${p}`, 'Assistenza', `${cl}, ${p}:`];
    return { oggetto: x[0], titolo: x[1], paragrafi: [x[2]], righe: [['Richiesta', t]], ...(d.testo || d.nota ? { citazione: String(d.testo || d.nota).slice(0, 5000) } : {}),
      dopo: ['Rispondi dalla tua area: il cliente riceve la risposta per email.'], azione: { etichetta: 'Rispondi', link: `${u}/area#assistenza` } };
  },
  // i pagamenti di un cliente, per chi installa e chi sviluppa (tipo: fallito, respinto, sospesa)
  pagamento_cliente: (d, n, u, l) => {
    const cl = riga(d.cliente || 'Un cliente', 80), p = riga(d.prodotto);
    const x = {
      fallito: [`Il pagamento di ${cl} per ${p} non è andato`, `Stripe riprova da solo nei prossimi giorni. L'assistenza resta attiva fino al ${giorno(d.sospesa, l)}: se il pagamento non arriva, si sospende e non sei tenuto a intervenire finché ${cl} non paga.`],
      respinto: [`Il primo addebito di ${cl} per ${p} è stato respinto`, `L'installazione non è pagata: non andare a installare finché il pagamento non arriva. Il programma non va mai bloccato a un cliente, nemmeno se non paga: si ferma solo il servizio.`],
      sospesa: [`Assistenza sospesa: ${cl} non ha pagato ${p}`, `Finché ${cl} non paga non sei tenuto a intervenire. Non bloccare né toccare il programma installato: è del cliente, e bloccarlo per farsi pagare è reato (art. 392 c.p.). Appena paga, l'assistenza riparte da sola.`],
    }[d.tipo] || [`Pagamenti di ${cl}`, ''];
    return { oggetto: x[0], titolo: 'Pagamenti dei clienti', paragrafi: [x[0] + '.', x[1]].filter(Boolean), azione: { etichetta: 'I tuoi clienti', link: `${u}/area#vendite` } };
  },
  // ai clienti (business): pagamento non riuscito, assistenza sospesa o in scadenza, risposta di chi installa
  pagamento_fallito: (d, n, u, l) => ({ piede: false, oggetto: `Il pagamento per ${riga(d.prodotto)} non è andato a buon fine`, titolo: 'Aggiorna il pagamento',
    paragrafi: [`Non siamo riusciti ad addebitare ${euro(d.importo || 0, l)} per l'assistenza di ${riga(d.prodotto)}. Stripe riproverà da solo nei prossimi giorni.`,
      `Per non interrompere l'assistenza, aggiorna la carta o il conto entro il ${giorno(d.sospesa, l)}: dopo, l'assistenza si sospende finché il pagamento non arriva. Il programma continua a funzionare e i dati restano tuoi.`],
    azione: { etichetta: 'Aggiorna il pagamento', link: d.link } }),
  assistenza_sospesa: d => ({ piede: false, oggetto: `Assistenza sospesa per ${riga(d.prodotto)}`, titolo: 'Assistenza sospesa',
    paragrafi: [`Il pagamento dell'assistenza di ${riga(d.prodotto)} non è arrivato, quindi l'assistenza è sospesa: non interveniamo finché il pagamento non arriva.`,
      'Il programma continua a funzionare e i tuoi dati restano tuoi. Appena paghi, l\'assistenza riparte da sola, senza costi in più.'],
    azione: { etichetta: 'Aggiorna il pagamento', link: d.link } }),
  assistenza_scade: (d, n, u, l) => ({ piede: false, oggetto: d.scaduta ? `L'assistenza di ${riga(d.prodotto)} è scaduta` : `L'assistenza di ${riga(d.prodotto)} scade il ${giorno(d.fino, l)}`,
    titolo: d.scaduta ? 'Assistenza scaduta' : 'Rinnova l\'assistenza',
    paragrafi: [d.scaduta ? `L'anno di assistenza pagato per ${riga(d.prodotto)} è finito: le richieste nuove aspettano il rinnovo. Il programma continua a funzionare.`
      : `L'anno di assistenza pagato per ${riga(d.prodotto)} finisce il ${giorno(d.fino, l)}.`, 'Rinnovi dalla pagina di assistenza, con lo stesso installatore, senza pagare di nuovo l\'installazione.',
      ...(d.riattivazione ? [`Se rinnovi più di ${riga(String(d.giorni), 4)} giorni dopo la scadenza, il rinnovo comprende una volta la riattivazione: ${euro(d.riattivazione, l)}.`] : [])],
    azione: { etichetta: 'Rinnova l\'assistenza', link: d.link } }),
  assistenza_risposta: d => ({ piede: false, oggetto: `${riga(d.da, 80)} ti ha risposto: ${riga(d.titolo, 100)}`, titolo: d.risolta ? 'Richiesta risolta' : 'Hai una risposta',
    paragrafi: [`${riga(d.da, 80)} ha risposto alla tua richiesta su ${riga(d.prodotto)}:`], citazione: String(d.testo ?? '').slice(0, 5000),
    dopo: [d.risolta ? 'La richiesta è segnata come risolta: se il problema torna, scrivi di nuovo dalla pagina di assistenza.' : 'Per rispondere, apri la richiesta dalla pagina di assistenza.'],
    azione: { etichetta: 'Apri la richiesta', link: d.link } }),
  // i controlli di sicurezza: una release ferma (a chi sviluppa e a chi gestisce la piattaforma)
  sicurezza: (d, n, u) => ({ oggetto: `Release ferma: ${riga(d.prodotto)} ${riga(d.versione, 40)}`, titolo: 'Una release non è stata annunciata',
    paragrafi: [`I controlli di sicurezza su ${riga(d.prodotto)} ${riga(d.versione, 40)} hanno trovato un problema grave, quindi chi installa non è stato avvisato di aggiornare.`],
    citazione: String(d.motivo ?? '').slice(0, 2000),
    dopo: ['Controlla la release: se è un falso allarme, chi gestisce la piattaforma la sblocca; se è un problema vero, pubblica una release corretta.'],
    azione: { etichetta: 'Apri la tua area', link: d.link || `${u}/area#prodotti` } }),
  // per chi gestisce la piattaforma: una richiesta senza risposta
  assistenza_ferma: d => ({ oggetto: `Assistenza ferma: ${riga(d.cliente || 'cliente', 80)} (${riga(d.prodotto)})`, titolo: 'Una richiesta di assistenza è ferma',
    paragrafi: [`La richiesta «${riga(d.titolo, 120)}» di ${riga(d.cliente || 'un cliente', 80)} su ${riga(d.prodotto)}: ${riga(d.perche, 200)}.`, 'Contatta chi installa o rispondi tu dal pannello.'],
    azione: { etichetta: 'Apri il pannello', link: d.link } }),
  rapporto_mese: (d, n, u, l) => ({ piede: false, oggetto: `${riga(d.prodotto)}: il tuo mese di ${mese(d.mese, l)}`, titolo: `Il mese di ${riga(d.prodotto)}`,
    paragrafi: [`Ecco cosa abbiamo fatto per ${riga(d.prodotto)} a ${mese(d.mese, l)}.`], righe: righeRapporto(d, l),
    dopo: ['Il programma è tuo e funziona anche da solo: l\'assistenza serve a tenerlo controllato, sicuro e aggiornato, e a risponderti quando serve.'],
    azione: { etichetta: 'La tua pagina di assistenza', link: d.link } }),
  sito_giu: (d, n, u, l) => ({ piede: false, oggetto: `${riga(d.prodotto)} non risponde: ce ne stiamo occupando`, titolo: 'Il programma non risponde',
    paragrafi: [`Il nostro controllo automatico non riesce a raggiungere ${riga(d.sito, 200)} da ${data(d.dal, l)}.`,
      'La nostra assistenza è già avvisata e ti scrive appena sa di più. Se sai cosa è successo (lavori, corrente, internet), diccelo dalla pagina di assistenza.'],
    azione: { etichetta: 'La tua pagina di assistenza', link: d.link } }),
  intervento: (d, n, u, l) => ({ piede: false, oggetto: `Preventivo per l'intervento su ${riga(d.prodotto)}`, titolo: 'Il preventivo dell\'intervento',
    paragrafi: [`Per la tua richiesta «${riga(d.titolo, 120)}» servono circa ${riga(String(d.ore).replace('.', ','), 8)} ore di lavoro, a ${euro(d.tariffa || 0, l)} l'ora: ${euro(d.totale || 0, l)}.`,
      `Senza l'assistenza attiva gli interventi si pagano a parte. Con l'assistenza (${euro(d.canone || 0, l)} al mese) sono compresi.`],
    azione: { etichetta: 'Vedi e paga il preventivo', link: d.link } }),
  // al business che paga con bonifico: i dati per pagarlo, poi la conferma con il link alla sua pagina di assistenza
  bonifico_ordine: (d, n, u, l) => ({ piede: false, oggetto: `Il bonifico per ${riga(d.prodotto)}: ${euro(d.importo || 0, l)}`, titolo: 'I dati per il bonifico',
    paragrafi: [`Per ${riga(d.prodotto)} fai un bonifico di ${euro(d.importo || 0, l)} con questi dati. Scrivi la causale esattamente così: è quella che ci fa riconoscere il tuo pagamento.`,
      'Se la tua banca lo permette, scegli il bonifico istantaneo: arriva in pochi secondi e costa come uno normale. Hai solo una carta con IBAN (Postepay Evolution, Hype, Revolut, N26…)? Il bonifico si fa dalla sua app.'],
    righe: [['Intestatario', riga(d.intestatario, 70)], ['IBAN', riga(d.iban, 50)], ...(d.bic ? [['BIC', riga(d.bic, 11)]] : []), ['Importo', euro(d.importo || 0, l)], ['Causale', riga(d.causale, 20)]],
    dopo: [`Appena il bonifico arriva ti scriviamo, e chi installa ti contatta per l'appuntamento. L'ordine vale fino al ${giorno(d.scade, l)}.`],
    azione: { etichetta: 'Vedi l\'ordine', link: d.link } }),
  bonifico_ricevuto: (d, n, u, l) => ({ piede: false, oggetto: `Bonifico ricevuto: ${riga(d.prodotto)}`, titolo: 'Il tuo bonifico è arrivato',
    paragrafi: [d.rinnovo ? `Abbiamo ricevuto ${euro(d.importo || 0, l)} per il rinnovo dell'assistenza di ${riga(d.prodotto)}. Grazie!`
      : `Abbiamo ricevuto ${euro(d.importo || 0, l)} per ${riga(d.prodotto)}. ${riga(d.installatore, 80) || 'Chi installa'} ti contatta per l'appuntamento.`,
      'Salva il link qui sotto: è la tua pagina di assistenza, da lì ci scrivi quando ti serve aiuto.'],
    righe: [['Causale', riga(d.causale, 20)]],
    azione: { etichetta: 'La tua pagina di assistenza', link: d.link } }),
  contestazione_esito: (d, n) => ({ oggetto: `La tua segnalazione su ${riga(d.prodotto)}`, titolo: 'La tua segnalazione è chiusa',
    paragrafi: [d.esito === 'rimborso' ? `Ti rimborsiamo ${euro(d.importo || 0)}: li vedrai sulla carta entro 5-10 giorni.`
      : d.esito === 'annullata' ? 'La segnalazione risulta ritirata.'
        : `Abbiamo verificato con l'installatore: l'installazione di ${riga(d.prodotto)} risulta regolare. Se non sei d'accordo, rispondi a questa email.`,
      ...(d.nota ? [`Nota di ${n}: ${riga(d.nota, 1000)}`] : [])],
    azione: { etichetta: 'La tua area', link: d.link } }),
  // dopo la cassa: la pagina d'installazione (un comando, o l'appuntamento con chi installa)
  acquisto_pronto: d => ({ piede: false, oggetto: d.inArrivo ? `${riga(d.prodotto)}: il pagamento è partito` : `${riga(d.prodotto)} è tuo: installalo`, titolo: d.inArrivo ? 'Il pagamento è partito' : 'Pronto da installare',
    paragrafi: [d.inArrivo ? `L'addebito per ${riga(d.prodotto)} arriva in pochi giorni lavorativi. Intanto la tua pagina è già pronta: appena arriva, il comando per installarlo si accende da solo.`
      : `Grazie! ${riga(d.prodotto)} è pagato. Dalla tua pagina lo installi con un comando sul tuo server, già configurato con impostazioni di partenza, oppure scegli quando ${riga(d.installatore, 80) || 'chi installa'} lo fa con te.`,
      `Poi ${riga(d.installatore, 80) || 'chi installa'} lo personalizza insieme a te: dominio, marchio, utenti, dati.`,
      `Con carta le quote di chi installa e di chi sviluppa restano alla piattaforma per ${Number(d.giorni) || 14} giorni dal pagamento: se qualcosa non va, segnalalo dalla tua area clienti.`],
    azione: { etichetta: 'Apri la tua pagina d\'installazione', link: d.link },
    dopo: ['Salva questo link: è la chiave della tua installazione, non inoltrarlo.'] }),
  // al business, con i pagamenti chiusi (prelancio, o un progetto non ancora rivendicato): la prenotazione registrata; e quando
  // i pagamenti aprono, il link per pagarla (link: la pagina d'installazione, poi la cassa con l'acquisto già pronto)
  prenotazione: d => ({ piede: false, oggetto: `Prenotazione registrata: ${riga(d.prodotto)}`, titolo: 'La tua prenotazione è registrata',
    paragrafi: [`Abbiamo registrato la tua prenotazione di ${riga(d.prodotto)}. ${riga(d.installatore, 80) || 'Chi installa'} l'ha già ricevuta e ti contatta per conoscerti e capire cosa ti serve.`,
      'Oggi non paghi niente: quando i pagamenti aprono ti mandiamo un\'altra email con il link per pagare. Intanto segui la tua prenotazione da qui.'],
    azione: { etichetta: 'Segui la tua prenotazione', link: d.link },
    dopo: ['Salva questo link: è la pagina della tua prenotazione, non inoltrarlo.'] }),
  pagamenti_aperti: d => ({ piede: false, oggetto: `Ora puoi pagare ${riga(d.prodotto)}`, titolo: 'I pagamenti sono aperti',
    paragrafi: [`Buone notizie: ora puoi pagare e completare la tua prenotazione di ${riga(d.prodotto)} con ${riga(d.installatore, 80) || 'chi installa'}.`,
      'Dal link trovi già quello che avevi scelto: scegli come pagare, e da lì si passa all\'installazione.'],
    azione: { etichetta: 'Paga e completa la prenotazione', link: d.link } }),
  // al titolare: chi installa chiede di guardare il server (diagnosi) o di entrarci per un po' (accesso). Decide lui
  perizia_richiesta: (d, n, u, l) => ({ piede: false, oggetto: d.tipo === 'accesso' ? `${riga(d.chi, 60)} chiede di entrare nel server di ${riga(d.prodotto)}` : `${riga(d.chi, 60)} chiede una diagnosi di ${riga(d.prodotto)}`,
    titolo: d.tipo === 'accesso' ? 'Una richiesta di accesso' : 'Una richiesta di diagnosi',
    paragrafi: [d.tipo === 'accesso' ? `${riga(d.chi, 60)} chiede di entrare nel server dove gira ${riga(d.prodotto)} per ${Number(d.ore) || 2} ore, per sistemarlo. Se accetti, l'accesso si chiude da solo alla scadenza e puoi chiuderlo prima con un clic.`
      : `${riga(d.chi, 60)} chiede di leggere lo stato del server dove gira ${riga(d.prodotto)}: spazio, memoria, contenitori, ultimi errori. Le password restano nascoste e nessuno entra.`,
      'Il motivo che ti scrive:'],
    citazione: String(d.motivo ?? '').slice(0, 400),
    dopo: ['Senza il tuo sì non succede niente. Se non lo aspettavi, rifiuta e scrivici.'],
    azione: { etichetta: 'Rispondi alla richiesta', link: d.link } }),
};
const EN = {
  verifica: (d, n) => ({ piede: false, oggetto: `Confirm your email for ${n}`, titolo: 'Confirm your email',
    paragrafi: [`Thanks for signing up to ${n}. One last step: confirm that this address is yours.`],
    azione: { etichetta: 'Confirm email', link: d.link },
    dopo: ['If you didn\'t sign up, just ignore this email: nothing happens without confirmation.'] }),
  reimposta: (d, n) => ({ piede: false, oggetto: `Reset your ${n} password`, titolo: 'Choose a new password',
    paragrafi: ['We received a request to change the password for your account.'],
    azione: { etichetta: 'Choose a new password', link: d.link },
    dopo: ['The link is valid for 1 hour and can be used only once.', 'If you didn\'t ask for this, just ignore this email: your password stays the same.'] }),
  accesso: (d, n) => ({ piede: false, oggetto: `Your sign-in link for ${n}`, titolo: 'Sign in without a password',
    paragrafi: ['Here is your link to sign in to your account, no password needed.'],
    azione: { etichetta: `Sign in to ${n}`, link: d.link },
    dopo: [`The link is valid for ${minuti(d)} minutes and can be used only once.`, 'If you didn\'t ask for this, just ignore this email: nobody can get in without this link.'] }),
  email_cambiata: (d, n, u) => ({ oggetto: `The email on your ${n} account has changed`, titolo: 'Your email has changed',
    paragrafi: [`The email address on your account is now ${riga(d.nuova, 200)}.`, 'We\'re writing to your old address for safety: from now on, messages will go to the new one.'],
    azione: { etichetta: 'Check your account', link: sic(d, u) },
    dopo: ['If this wasn\'t you, change your password right away and get in touch.'] }),
  accesso_nuovo: (d, n, u, l) => ({ oggetto: `New sign-in to your ${n} account`, titolo: 'New sign-in to your account',
    paragrafi: ['Someone just signed in to your account.'],
    righe: [['When', data(d.quando, l)], ['Device', riga(d.dispositivo, 200) || 'unknown']],
    azione: { etichetta: 'Change your password', link: sic(d, u) },
    dopo: ['If it was you, there\'s nothing to do.', 'If it wasn\'t, change your password right away: whoever signed in will be logged out.'] }),
  due_fattori: (d, n, u) => d.attivo
    ? { oggetto: `Two-step verification turned on for ${n}`, titolo: 'Two-step verification is on',
      paragrafi: ['You turned on two-step verification. From now on, besides your password, we\'ll ask for a code when you sign in.'],
      azione: { etichetta: 'Go to security settings', link: sic(d, u) }, dopo: ['If this wasn\'t you, change your password right away.'] }
    : { oggetto: `Two-step verification turned off for ${n}`, titolo: 'Two-step verification is off',
      paragrafi: ['You turned off two-step verification. Your password is now enough to sign in.'],
      azione: { etichetta: 'Go to security settings', link: sic(d, u) }, dopo: ['If this wasn\'t you, change your password right away and turn it back on.'] },
  vendita: (d, n, u, l, ruolo) => ({ oggetto: d.rinnovo ? `Renewal: ${riga(d.prodotto)}` : `New sale: ${riga(d.prodotto)}`, titolo: d.rinnovo ? 'A customer renewed' : 'You have a new sale',
    paragrafi: [d.rinnovo ? `${riga(d.cliente) || 'A customer'} renewed ${riga(d.prodotto)}: ${euro(d.importo, l)} for you.` : `A business has just chosen ${riga(d.prodotto)}.`],
    righe: [['Product', riga(d.prodotto)], ['Customer', riga(d.cliente) || '—'], ['Your role', ruolo], ['Amount', euro(d.importo, l)]],
    azione: { etichetta: 'See your sales', link: area(d, u) },
    dopo: [d.metodo === 'crypto' ? 'It\'s already in your wallet.' : d.metodo === 'bonifico' ? 'Your share is paid to you by hand by the platform operator.'
      : `Your share is paid to your Stripe account ${Number(d.giorni) || 14} days after the payment.`] }),
  quota_versata: (d, n, u, l) => ({ oggetto: `We've paid you ${euro(d.importo, l)}`, titolo: 'Payout sent',
    paragrafi: [`We've sent ${euro(d.importo, l)} to the payment account linked to ${n}.`, 'It usually reaches your bank within a few business days.'],
    azione: { etichetta: 'See your payouts', link: area(d, u) } }),
  prodotto_esito: (d, n, u) => d.esito === 'pubblicato'
    ? { oggetto: `${riga(d.prodotto)} is live on ${n}`, titolo: 'Your product is live',
      paragrafi: [`Good news: ${riga(d.prodotto)} has been approved and is in the catalog.`, 'Installers can now pick it and bring it to businesses.'],
      ...(d.nota ? { citazione: String(d.nota).slice(0, 5000) } : {}), azione: { etichetta: 'Go to your dashboard', link: area(d, u) } }
    : { oggetto: `${riga(d.prodotto)} was not published`, titolo: 'Your product was not published',
      paragrafi: [`We reviewed ${riga(d.prodotto)} and can't publish it for now.`, ...(d.nota ? ['The reason:'] : [])],
      ...(d.nota ? { citazione: String(d.nota).slice(0, 5000) } : {}), azione: { etichetta: 'Fix it and resubmit', link: area(d, u) },
      dopo: ['Once it\'s fixed, you can submit it again from your dashboard.'] },
  release: d => ({ oggetto: `${riga(d.prodotto)} ${riga(d.versione, 40)}: new version to install`, titolo: `${riga(d.prodotto)} ${riga(d.versione, 40)}`,
    paragrafi: [`Version ${riga(d.versione, 40)} of ${riga(d.prodotto)} is out.`, 'Read what\'s new and update it for your customers when you can.'],
    azione: { etichetta: 'Read what\'s new', link: d.link } }),
  nuovo_installatore: (d, n, u) => ({ oggetto: `New installer for ${riga(d.prodotto)}`, titolo: 'A new installer',
    paragrafi: [`${riga(d.installatore)} has chosen to install ${riga(d.prodotto)}${riga(d.zona) ? ` in the ${riga(d.zona)} area` : ''}.`, 'Every installation they sell brings you your share.'],
    azione: { etichetta: 'See your installers', link: area(d, u) } }),
  contestazione: (d, n, u) => ({ oggetto: `Complaint about ${riga(d.prodotto)}`, titolo: 'A customer reports a problem',
    paragrafi: [`${riga(d.cliente || 'A customer', 80)} says something is wrong with ${riga(d.prodotto)}:`],
    citazione: String(d.testo ?? '').slice(0, 5000),
    dopo: ['The shares of this purchase stay on hold until the complaint is closed. Contact the customer now and sort it out: if a refund is due, the platform decides it.'],
    azione: { etichetta: 'Go to your sales', link: area(d, u) } }),
  assistenza: (d, n, u) => {
    const cl = riga(d.cliente || 'A customer', 80), p = riga(d.prodotto), t = riga(d.titolo, 120);
    const x = {
      nuova: [`${d.urgente ? 'Urgent: ' : ''}${cl} needs support with ${p}`, 'New support request', `${cl} wrote about ${p}:`],
      messaggio: [`${cl} wrote again: ${t}`, 'New message from the customer', `${cl} added a message to the request about ${p}:`],
      coinvolto: coinvoltoInstallatore(d) ? [`${riga(d.da, 80)} asks for your help with ${p}`, 'Your help is needed', `${riga(d.da, 80)} is following ${cl}'s request and needs whoever installed ${p}.`]
        : [`${riga(d.da, 80)} asks for your help with ${p}`, 'An installer needs you', `${riga(d.da, 80)} looks after ${cl} and needs whoever develops ${p}.`],
      sollecito: [`${cl} has been waiting ${Number(d.ore) || 24} hours for an answer`, 'A request is waiting', `${cl} has been waiting more than ${Number(d.ore) || 24} hours for an answer about ${p}.`],
      segnalata: [`${cl} reported a request with no answer`, 'Request reported to the platform', `${cl} told the platform they are still waiting for an answer about ${p}.`],
    }[d.tipo] || [`Support for ${p}`, 'Support', `${cl}, ${p}:`];
    return { oggetto: x[0], titolo: x[1], paragrafi: [x[2]], righe: [['Request', t]], ...(d.testo || d.nota ? { citazione: String(d.testo || d.nota).slice(0, 5000) } : {}),
      dopo: ['Answer from your area: the customer gets your answer by email.'], azione: { etichetta: 'Answer', link: `${u}/area#assistenza` } };
  },
  pagamento_cliente: (d, n, u, l) => {
    const cl = riga(d.cliente || 'A customer', 80), p = riga(d.prodotto);
    const x = {
      fallito: [`${cl}'s payment for ${p} didn't go through`, `Stripe retries on its own over the next few days. Support stays active until ${giorno(d.sospesa, l)}: if the payment doesn't arrive, it is suspended and you don't have to step in until ${cl} pays.`],
      respinto: [`${cl}'s first debit for ${p} was rejected`, 'The installation isn\'t paid: don\'t go and install until the payment arrives. Never block the software for a customer, even if they don\'t pay: only the service stops.'],
      sospesa: [`Support suspended: ${cl} hasn't paid for ${p}`, `You don't have to step in until ${cl} pays. Don't block or touch the installed software: it belongs to the customer, and blocking it to get paid is a crime in Italy (art. 392 of the penal code). As soon as they pay, support restarts on its own.`],
    }[d.tipo] || [`${cl}'s payments`, ''];
    return { oggetto: x[0], titolo: 'Customer payments', paragrafi: [x[0] + '.', x[1]].filter(Boolean), azione: { etichetta: 'Your customers', link: `${u}/area#vendite` } };
  },
  pagamento_fallito: (d, n, u, l) => ({ piede: false, oggetto: `Your payment for ${riga(d.prodotto)} didn't go through`, titolo: 'Update your payment',
    paragrafi: [`We couldn't charge ${euro(d.importo || 0, l)} for ${riga(d.prodotto)} support. Stripe will retry on its own over the next few days.`,
      `To keep your support running, update your card or account by ${giorno(d.sospesa, l)}: after that, support is suspended until the payment arrives. The software keeps working and your data stays yours.`],
    azione: { etichetta: 'Update your payment', link: d.link } }),
  assistenza_sospesa: d => ({ piede: false, oggetto: `Support suspended for ${riga(d.prodotto)}`, titolo: 'Support suspended',
    paragrafi: [`The payment for ${riga(d.prodotto)} support hasn't arrived, so support is suspended: we won't step in until the payment arrives.`,
      'The software keeps working and your data stays yours. As soon as you pay, support restarts on its own, at no extra cost.'],
    azione: { etichetta: 'Update your payment', link: d.link } }),
  assistenza_scade: (d, n, u, l) => ({ piede: false, oggetto: d.scaduta ? `Support for ${riga(d.prodotto)} has expired` : `Support for ${riga(d.prodotto)} expires on ${giorno(d.fino, l)}`,
    titolo: d.scaduta ? 'Support expired' : 'Renew your support',
    paragrafi: [d.scaduta ? `The year of support you paid for ${riga(d.prodotto)} has ended: new requests wait for the renewal. The software keeps working.`
      : `The year of support you paid for ${riga(d.prodotto)} ends on ${giorno(d.fino, l)}.`, 'Renew from your support page, with the same installer, without paying for the installation again.',
      ...(d.riattivazione ? [`If you renew more than ${riga(String(d.giorni), 4)} days after it ends, the renewal includes a one-off reactivation fee: ${euro(d.riattivazione, l)}.`] : [])],
    azione: { etichetta: 'Renew support', link: d.link } }),
  assistenza_risposta: d => ({ piede: false, oggetto: `${riga(d.da, 80)} answered you: ${riga(d.titolo, 100)}`, titolo: d.risolta ? 'Request solved' : 'You have an answer',
    paragrafi: [`${riga(d.da, 80)} answered your request about ${riga(d.prodotto)}:`], citazione: String(d.testo ?? '').slice(0, 5000),
    dopo: [d.risolta ? 'The request is marked as solved: if the problem comes back, write again from your support page.' : 'To reply, open the request from your support page.'],
    azione: { etichetta: 'Open the request', link: d.link } }),
  sicurezza: (d, n, u) => ({ oggetto: `Release held: ${riga(d.prodotto)} ${riga(d.versione, 40)}`, titolo: 'A release was not announced',
    paragrafi: [`The security checks on ${riga(d.prodotto)} ${riga(d.versione, 40)} found a serious problem, so installers were not told to update.`],
    citazione: String(d.motivo ?? '').slice(0, 2000),
    dopo: ['Check the release: if it is a false alarm, the platform team unblocks it; if the problem is real, publish a fixed release.'],
    azione: { etichetta: 'Open your area', link: d.link || `${u}/area#prodotti` } }),
  assistenza_ferma: d => ({ oggetto: `Support stuck: ${riga(d.cliente || 'customer', 80)} (${riga(d.prodotto)})`, titolo: 'A support request is stuck',
    paragrafi: [`The request "${riga(d.titolo, 120)}" from ${riga(d.cliente || 'a customer', 80)} about ${riga(d.prodotto)}: ${riga(d.perche, 200)}.`, 'Contact the installer or answer yourself from the panel.'],
    azione: { etichetta: 'Open the panel', link: d.link } }),
  rapporto_mese: (d, n, u, l) => ({ piede: false, oggetto: `${riga(d.prodotto)}: your ${mese(d.mese, l)}`, titolo: `${riga(d.prodotto)} this month`,
    paragrafi: [`Here is what we did for ${riga(d.prodotto)} in ${mese(d.mese, l)}.`], righe: righeRapporto(d, l),
    dopo: ['The program is yours and works on its own: support keeps it monitored, safe and up to date, and answers you when you need it.'],
    azione: { etichetta: 'Your support page', link: d.link } }),
  sito_giu: (d, n, u, l) => ({ piede: false, oggetto: `${riga(d.prodotto)} is not responding: we're on it`, titolo: 'The program is not responding',
    paragrafi: [`Our automatic check can't reach ${riga(d.sito, 200)} since ${data(d.dal, l)}.`,
      'Our support team already knows and will write to you as soon as they know more. If you know what happened (works, power, internet), tell us from the support page.'],
    azione: { etichetta: 'Your support page', link: d.link } }),
  intervento: (d, n, u, l) => ({ piede: false, oggetto: `Quote for the work on ${riga(d.prodotto)}`, titolo: 'Your quote',
    paragrafi: [`Your request "${riga(d.titolo, 120)}" needs about ${riga(d.ore, 8)} hours of work, at ${euro(d.tariffa || 0, l)} an hour: ${euro(d.totale || 0, l)}.`,
      `Without active support, work is paid separately. With support (${euro(d.canone || 0, l)} a month) it's included.`],
    azione: { etichetta: 'See and pay the quote', link: d.link } }),
  bonifico_ordine: (d, n, u, l) => ({ piede: false, oggetto: `Bank transfer for ${riga(d.prodotto)}: ${euro(d.importo || 0, l)}`, titolo: 'Bank transfer details',
    paragrafi: [`For ${riga(d.prodotto)}, send a bank transfer of ${euro(d.importo || 0, l)} with these details. Write the reference exactly as shown: it is how we recognise your payment.`,
      'If your bank offers it, choose an instant transfer: it arrives in seconds and costs the same as a standard one. Only have a card with an IBAN (Revolut, N26 and similar)? Send the transfer from its app.'],
    righe: [['Account holder', riga(d.intestatario, 70)], ['IBAN', riga(d.iban, 50)], ...(d.bic ? [['BIC', riga(d.bic, 11)]] : []), ['Amount', euro(d.importo || 0, l)], ['Reference', riga(d.causale, 20)]],
    dopo: [`As soon as the transfer arrives we email you, and your installer gets in touch to book a visit. The order is valid until ${giorno(d.scade, l)}.`],
    azione: { etichetta: 'See the order', link: d.link } }),
  bonifico_ricevuto: (d, n, u, l) => ({ piede: false, oggetto: `Transfer received: ${riga(d.prodotto)}`, titolo: 'Your transfer has arrived',
    paragrafi: [d.rinnovo ? `We received ${euro(d.importo || 0, l)} to renew the support for ${riga(d.prodotto)}. Thank you!`
      : `We received ${euro(d.importo || 0, l)} for ${riga(d.prodotto)}. ${riga(d.installatore, 80) || 'Your installer'} will get in touch to book a visit.`,
      'Save the link below: it is your support page, where you can write to us whenever you need help.'],
    righe: [['Reference', riga(d.causale, 20)]],
    azione: { etichetta: 'Your support page', link: d.link } }),
  contestazione_esito: (d, n) => ({ oggetto: `Your complaint about ${riga(d.prodotto)}`, titolo: 'Your complaint is closed',
    paragrafi: [d.esito === 'rimborso' ? `We are refunding ${euro(d.importo || 0, 'en')}: it reaches your card within 5-10 days.`
      : d.esito === 'annullata' ? 'The complaint is recorded as withdrawn.'
        : `We checked with the installer: the installation of ${riga(d.prodotto)} looks regular. If you disagree, reply to this email.`,
      ...(d.nota ? [`Note from ${n}: ${riga(d.nota, 1000)}`] : [])],
    azione: { etichetta: 'Your area', link: d.link } }),
  recensione: d => ({ oggetto: `How is it going with ${riga(d.prodotto)}?`, titolo: `How is it going with ${riga(d.prodotto)}?`,
    paragrafi: [`You've been using ${riga(d.prodotto)} for a while. How is it going?`, 'It only takes two minutes, and your review helps other businesses choose.'],
    azione: { etichetta: 'Leave a review', link: d.link } }),
  contatto: d => ({ oggetto: `New message from ${riga(d.da, 80)}${riga(d.prodotto) ? ` about ${riga(d.prodotto)}` : ''}`, titolo: 'You have a new message',
    paragrafi: [`${riga(d.da, 80)} (${riga(d.email, 200)}) wrote to you${riga(d.prodotto) ? ` about ${riga(d.prodotto)}` : ''}:`],
    citazione: String(d.messaggio ?? '').slice(0, 5000),
    dopo: [`To answer, just reply to this email: your reply goes straight to ${riga(d.email, 200)}.`] }),
  acquisto_pronto: d => ({ piede: false, oggetto: d.inArrivo ? `${riga(d.prodotto)}: your payment is on its way` : `${riga(d.prodotto)} is yours: install it`, titolo: d.inArrivo ? 'Your payment is on its way' : 'Ready to install',
    paragrafi: [d.inArrivo ? `The debit for ${riga(d.prodotto)} arrives in a few business days. Your page is already ready: when it lands, the install command switches on by itself.`
      : `Thank you! ${riga(d.prodotto)} is paid. From your page you install it with one command on your server, already set up with starter settings, or you pick when ${riga(d.installatore, 80) || 'your installer'} does it with you.`,
      `Then ${riga(d.installatore, 80) || 'your installer'} customizes it with you: domain, brand, users, data.`,
      `With a card, the installer's and the developer's shares stay with the platform for ${Number(d.giorni) || 14} days from the payment: if something's wrong, report it from your customer area.`],
    azione: { etichetta: 'Open your install page', link: d.link },
    dopo: ['Keep this link: it is the key to your installation, don\'t forward it.'] }),
  prenotazione: d => ({ piede: false, oggetto: `Booking registered: ${riga(d.prodotto)}`, titolo: 'Your booking is registered',
    paragrafi: [`We've registered your booking for ${riga(d.prodotto)}. ${riga(d.installatore, 80) || 'Your installer'} has already received it and will get in touch to get to know you and understand what you need.`,
      'You pay nothing today: when payments open we\'ll send you another email with the link to pay. Meanwhile, follow your booking from here.'],
    azione: { etichetta: 'Follow your booking', link: d.link },
    dopo: ['Keep this link: it is your booking page, don\'t forward it.'] }),
  pagamenti_aperti: d => ({ piede: false, oggetto: `You can now pay for ${riga(d.prodotto)}`, titolo: 'Payments are open',
    paragrafi: [`Good news: you can now pay and complete your booking for ${riga(d.prodotto)} with ${riga(d.installatore, 80) || 'your installer'}.`,
      'The link already has what you chose: pick how to pay, and from there you move on to the installation.'],
    azione: { etichetta: 'Pay and complete your booking', link: d.link } }),
  perizia_richiesta: d => ({ piede: false, oggetto: d.tipo === 'accesso' ? `${riga(d.chi, 60)} asks to access the ${riga(d.prodotto)} server` : `${riga(d.chi, 60)} asks for a diagnosis of ${riga(d.prodotto)}`,
    titolo: d.tipo === 'accesso' ? 'An access request' : 'A diagnosis request',
    paragrafi: [d.tipo === 'accesso' ? `${riga(d.chi, 60)} asks to log into the server running ${riga(d.prodotto)} for ${Number(d.ore) || 2} hours, to fix it. If you accept, access closes by itself when it expires, and you can close it earlier with one click.`
      : `${riga(d.chi, 60)} asks to read the state of the server running ${riga(d.prodotto)}: disk, memory, containers, recent errors. Passwords stay hidden and nobody logs in.`,
      'The reason they give:'],
    citazione: String(d.motivo ?? '').slice(0, 400),
    dopo: ['Nothing happens without your yes. If you weren\'t expecting it, decline and write to us.'],
    azione: { etichetta: 'Answer the request', link: d.link } }),
};
const TIPI = { it: IT, en: EN };
export const TIPI_EMAIL = Object.keys(IT);

// → { oggetto, testo, html } (per «contatto» anche rispondiA: l'email del business, da passare a invia())
export function modelloEmail(tipo, dati = {}, { nome = 'Repobay', url, lingua = 'it' } = {}) {
  if (!Object.hasOwn(IT, tipo)) throw new Error(`modello email sconosciuto: ${tipo}`);
  const l = LINGUE.includes(lingua) ? lingua : 'it';   // lingue non note → italiano
  const n = riga(nome, 60) || 'Repobay', u = String(url || '').replace(/\/+$/, '');
  const ruolo = COMUNE[l].ruoli[dati.ruolo] || riga(dati.ruolo, 40);
  const m = { piede: true, ...TIPI[l][tipo](dati, n, u, l, ruolo) };
  if (!u && m.piede) throw new Error('modelloEmail: manca url');   // i link relativi li ferma comunque link()
  const out = componi(m, { nome: n, url: u, lingua: l, saluto: COMUNE[l].ciao(riga(dati.nome, 80)) });
  return tipo === 'contatto' ? { ...out, rispondiA: riga(dati.email, 200) } : out;
}
