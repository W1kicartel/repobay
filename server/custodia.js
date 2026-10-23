// La custodia degli ordini in escrow: legge lo stato dell'ordine sul contratto e lo porta nel database. Le quote in euro nascono
// «in_escrow» col deposito e diventano «versata» quando il contratto paga (conferma del cliente o trattenuta finita), «annullata»
// se i soldi tornano al cliente, un po' e un po' se l'arbitro divide. Le segnalazioni sul sito si chiudono da sole con l'esito del
// contratto, e chi riceve viene avvisato quando può incassare. Il server non firma nulla: le transazioni le mandano i wallet.
import { statoEscrow, esitoDaLog, esitoDaRete, chiaveOrdine, azioneDellOrdine, CHIUSI } from './escrow.js';
import { retiAccese } from './reti.js';
import { euro } from './modelli.js';

const perMilione = (a, b) => (b > 0n ? Number(a * 1_000_000n / b) / 1e6 : 0);

// → { custodia, cambiata, sblocco, contestatoIl, rimborsato } ; `tx` è una transazione appena mandata dal browser (la decisione
// dell'arbitro ci legge i pagamenti). Arriva da fuori: vale solo se la sua ricevuta ha un evento del contratto per questo ordine
export async function aggiornaCustodia({ db, cfg, rpc, notifiche }, o, { tx = null } = {}) {
  const r = retiAccese(cfg).find(x => x.id === o.rete);
  if (!r || r.tipo !== 'evm' || !o.escrow || !o.pagatore) throw Object.assign(new Error('Questo ordine non è in escrow'), { stato: 400 });
  const id = chiaveOrdine(o), s = await statoEscrow(rpc, r, o.escrow, id);
  const vista = { custodia: s.custodia || o.custodia, sblocco: s.sblocco ? new Date(s.sblocco * 1000).toISOString() : o.sblocco, contestatoIl: s.contestatoIl ? new Date(s.contestatoIl * 1000).toISOString() : null, rimborsato: String(s.rimborsato) };
  if (!s.custodia || s.custodia === o.custodia) {
    db.prepare("UPDATE ordine SET controllato = datetime('now') WHERE id = ?").run(o.id);
    avvisaSbloccabile({ db, notifiche }, o, s);
    return { ...vista, cambiata: false };
  }
  const parti = JSON.parse(o.parti), fattura = `cr_${o.codice}`;
  const p = db.prepare('SELECT id, nome, slug, builder FROM prodotto WHERE id = ?').get(o.prodotto) || { nome: '' };
  const cl = db.prepare('SELECT * FROM cliente WHERE chiave = ?').get(fattura);
  const aperta = db.prepare("SELECT id, nota FROM contestazione WHERE cliente = ? AND stato = 'aperta'").get(fattura) || null;
  const ricevuta = typeof tx === 'string' && /^0x[0-9a-fA-F]{64}$/.test(tx) ? await rpc(r.rpc, 'eth_getTransactionReceipt', [tx]).catch(() => null) : null;
  if (!azioneDellOrdine(ricevuta, o.escrow, id)) tx = null;   // un hash qualsiasi non finisce fra i trasferimenti
  let pagamenti = null, rimborso = s.rimborsato;
  if (s.custodia === 'risolto') {   // quanto a chi lo dice l'evento: dalla transazione dell'arbitro, altrimenti dai log della rete, altrimenti in proporzione
    let esito = null;
    if (tx) esito = esitoDaLog(ricevuta.logs, o.escrow, id);
    if (!esito) esito = await esitoDaRete(rpc, r, o.escrow, id, o.blocco || 0).catch(() => null);
    if (esito && esito.pagamenti.length === parti.length) { pagamenti = esito.pagamenti; rimborso = esito.rimborso; }
    else { const resto = s.totale - s.rimborsato; pagamenti = parti.map(x => BigInt(x.unita) * resto / s.totale); }
  }
  const euroRimborso = s.custodia === 'rimborsato' ? o.euro : s.custodia === 'risolto' ? Math.round(o.euro * perMilione(rimborso, s.totale)) : 0;
  const incassi = new Map();   // utente → euro arrivati davvero sul wallet (per gli avvisi)
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE ordine SET custodia = ?, esito = ?, congelato = COALESCE(?, congelato), controllato = datetime('now') WHERE id = ?")
      .run(s.custodia, pagamenti ? JSON.stringify(pagamenti.map(String)) : o.esito, s.contestatoIl ? new Date(s.contestatoIl * 1000).toISOString() : null, o.id);
    if (s.custodia === 'confermato' || s.custodia === 'rilasciato') {
      db.prepare("UPDATE quota SET stato = 'versata', trasferimento = ? WHERE fattura = ? AND stato = 'in_escrow'").run(tx || 'escrow', fattura);
      if (s.custodia === 'confermato' && cl && !cl.confermato) db.prepare("UPDATE cliente SET confermato = datetime('now') WHERE chiave = ?").run(fattura);
      for (const x of parti.filter(x => x.utente)) incassi.set(x.utente, (incassi.get(x.utente) || 0) + x.euro);
    } else if (s.custodia === 'rimborsato') {
      db.prepare("UPDATE quota SET stato = 'annullata', stornato = importo WHERE fattura = ? AND stato = 'in_escrow'").run(fattura);
    } else if (s.custodia === 'risolto') {
      parti.forEach((x, i) => {
        if (!x.utente) return;
        const frazione = perMilione(pagamenti[i] ?? 0n, BigInt(x.unita));
        for (const q of db.prepare("SELECT id, importo FROM quota WHERE fattura = ? AND beneficiario = ? AND ruolo = ? AND stato = 'in_escrow'").all(fattura, x.utente, x.ruolo)) {
          const tenuto = Math.min(q.importo, Math.round(q.importo * frazione));
          db.prepare("UPDATE quota SET stato = ?, stornato = ?, trasferimento = ? WHERE id = ?").run(tenuto > 0 ? 'versata' : 'annullata', q.importo - tenuto, tx || 'escrow', q.id);
          incassi.set(x.utente, (incassi.get(x.utente) || 0) + tenuto);
        }
      });
    } else if (s.custodia === 'contestato' && cl && !aperta) {
      // congelato dal wallet, senza passare dal sito: la segnalazione si apre lo stesso, così chi gestisce la piattaforma la vede nel pannello
      db.prepare('INSERT INTO contestazione (cliente, email, testo) VALUES (?, ?, ?)').run(fattura, cl.email, 'Pagamento congelato dal cliente sul contratto escrow, dal suo wallet.');
    }
    // la segnalazione sul sito si chiude con l'esito del contratto
    if (CHIUSI.includes(s.custodia)) {
      const esito = euroRimborso > 0 ? 'rimborso' : 'regolare';
      db.prepare("UPDATE contestazione SET stato = 'chiusa', esito = ?, importo = ?, nota = COALESCE(nota, ?), chiusa = datetime('now') WHERE cliente = ? AND stato = 'aperta'")
        .run(esito, euroRimborso, s.custodia === 'rimborsato' ? 'Rimborso completo dal contratto escrow: la piattaforma non ha deciso in tempo.' : 'Deciso sul contratto escrow.', fattura);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  // gli avvisi: a chi riceve, al cliente
  const destinatari = new Set(parti.filter(x => x.utente).map(x => x.utente));
  if (s.custodia === 'contestato' && !aperta) for (const u of destinatari) notifiche.notifica(u, 'contestazione.aperta', { prodotto: p.nome, slug: p.slug, cliente: cl?.nome, testo: 'Il cliente ha congelato il pagamento nel contratto escrow: decide la piattaforma.' });
  if (s.custodia === 'confermato' || s.custodia === 'rilasciato') for (const [u, importo] of incassi) notifiche.notifica(u, 'escrow.sbloccato', { prodotto: p.nome, slug: p.slug, importo, simbolo: o.simbolo, conferma: s.custodia === 'confermato' });
  if (s.custodia === 'risolto' || s.custodia === 'rimborsato') {
    for (const u of destinatari) notifiche.notifica(u, 'contestazione.chiusa', { prodotto: p.nome, slug: p.slug, esito: euroRimborso > 0 ? 'rimborso' : 'regolare', importo: euroRimborso, incassato: incassi.get(u) || 0 });
    const email = cl?.email || o.email;
    const nota = aperta?.nota || (s.custodia === 'rimborsato' ? 'La piattaforma non ha deciso in tempo: il contratto ha restituito tutto al wallet che ha pagato.' : euroRimborso ? `${euro(euroRimborso)} tornano sul wallet che ha pagato, direttamente dal contratto.` : null);
    if (email) notifiche.email(email, 'contestazione_esito', { prodotto: p.nome, esito: euroRimborso > 0 ? 'rimborso' : 'regolare', importo: euroRimborso, nota, link: `${cfg.url}/cliente` }).catch(() => {});
  }
  return { ...vista, cambiata: true };
}

// trattenuta finita e nessuno ha ancora incassato: una volta sola, «da oggi puoi incassare»
function avvisaSbloccabile({ db, notifiche }, o, s) {
  if (s.custodia !== 'trattenuto' || o.avvisato || !s.sblocco || Date.now() < s.sblocco * 1000) return;
  db.prepare("UPDATE ordine SET avvisato = datetime('now') WHERE id = ?").run(o.id);
  const p = db.prepare('SELECT nome, slug FROM prodotto WHERE id = ?').get(o.prodotto) || { nome: '' };
  const per = new Map();
  for (const x of JSON.parse(o.parti).filter(x => x.utente)) per.set(x.utente, (per.get(x.utente) || 0) + x.euro);
  for (const [u, importo] of per) notifiche.notifica(u, 'escrow.sbloccabile', { prodotto: p.nome, slug: p.slug, importo, simbolo: o.simbolo, codice: o.codice });
}

// il giro periodico (lavori.js): gli ordini ancora aperti sul contratto, i più vecchi controlli prima
export async function controllaCustodie(c, quanti = 40) {
  const l = c.db.prepare("SELECT * FROM ordine WHERE escrow IS NOT NULL AND stato = 'pagato' AND pagatore IS NOT NULL AND custodia IN ('trattenuto', 'contestato') ORDER BY controllato LIMIT ?").all(quanti);
  let n = 0;
  for (const o of l) {
    try { if ((await aggiornaCustodia(c, o)).cambiata) n++; }
    catch (e) { console.error(`escrow ${o.codice}:`, e.message); }
  }
  return n;
}
