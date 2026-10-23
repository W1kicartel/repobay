// Le rotte dei pagamenti in crypto, su tutte le reti (EVM, Solana, Bitcoin, Tron). Il business paga dal suo wallet
// direttamente builder (e collaboratori), installatore e piattaforma; il server controlla sulla blockchain e registra la vendita.
// In crypto si paga l'installazione più un anno di assistenza in anticipo (i pagamenti crypto non si rinnovano da soli: alla scadenza
// il cliente rinnova l'anno con un ordine senza installazione, «rinnovo», dalla sua pagina di assistenza o dalla sua area).
import { randomBytes, randomInt } from 'node:crypto';
import { moneta, unita, dividiUnita, chiamate, verifica, checksum, etichettaOrdine } from '../web3.js';
import { idEscrow, chiaveOrdine, scadenzaDeposito, chiamateEscrow, datiAzione, verificaDeposito, depositiDi, arbitroDi, tempiDi, totaleDi } from '../escrow.js';
import { aggiornaCustodia } from '../custodia.js';
import { transazioneSolana, verificaSolana, nuovoRiferimento, linkSolanaPay, eIndirizzoSolana } from '../solana.js';
import { verificaBitcoin, uriBitcoin } from '../bitcoin.js';
import { verificaTron, clienteTron } from '../tron.js';
import { TIPI, retiAccese, walletDi, verificaPossesso } from '../reti.js';
import { dividi, spartisci, collaboratoriDi, quotaDi, conAggiornamenti, quotaVendita, livelloDi, conLivello, prezzoAvvioDi, avvisaLivello, quotaSviluppatoreAssistenza, quotaInstallatoreAssistenza, collegaAcquisto } from '../soldi.js';
import { qrSvg } from '../../web/qr.js';
import { filtroAbilitati } from '../corso.js';
import { errore, emailValida, ipDi } from '../http.js';
import { troppiTentativi } from '../conti.js';
import { canone, togliAvvisi, CODICE } from '../assistenza.js';

// la data fra tanti mesi (in UTC)
const piuMesi = (t, mesi) => { const d = new Date(t); d.setUTCMonth(d.getUTCMonth() + mesi); return d.toISOString(); };

export function rotteCrypto(c) {
  const { cfg, db, h, notifiche } = c;
  const aperti = () => { if (c.prelancio()) throw errore(503, 'I pagamenti non sono ancora aperti: chiedi un preventivo all\'installatore'); };
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };

  // le parti di un ordine: chi riceve, quanto (in unità della moneta) e quanto vale in euro (per le quote e la DAC7)
  // ag: quanto vale la riga degli aggiornamenti garantiti nell'ordine (0 = senza): tolta la piattaforma, a chi sviluppa (e agli altri owner)
  // extra: la riattivazione nei rinnovi di chi ha lasciato scadere l'assistenza da più di RIATTIVAZIONE_GIORNI (si divide come il canone)
  function parti(p, inst, r, m, pe, mesi, q = quotaVendita(db, cfg, p.id, inst.id), ag = 0, extra = 0) {
    const builder = db.prepare('SELECT * FROM utente WHERE id = ?').get(p.builder), qp = cfg.piattaformaCrypto;
    const bw = walletDi(builder, r.tipo); if (!bw) throw errore(400, `Questo prodotto non si può pagare su ${r.nome}`);
    const iw = walletDi(inst, r.tipo); if (!iw) throw errore(400, `${inst.nome} non ha un wallet ${TIPI[r.tipo].nome}: scegli un'altra rete o paga con carta`);
    const coll = collaboratoriDi(db, p.id).map(x => ({ ...x, u: db.prepare('SELECT * FROM utente WHERE id = ?').get(x.utente) }));
    if (coll.some(x => !walletDi(x.u, r.tipo))) throw errore(400, `Chi mantiene il progetto non ha ancora un wallet ${TIPI[r.tipo].nome}: scegli un'altra rete o paga con carta`);
    // p.prezzo_avvio: il prezzo di chi vende (0 in un rinnovo); q: la parte di chi vende, con la percentuale di chi sviluppa (o il loro
    // accordo) e il livello di chi vende; il canone dell'anno in anticipo con lo sconto
    const cm = canone(p.prezzo_mese, mesi, cfg.scontoAnno) + extra, qg = cfg.quotaInstallatoreAggiornamenti;
    // il canone dell'assistenza con la piattaforma dietro: 60% a chi ha installato, a chi sviluppa la sua parte (se c'è), il resto a lei
    const qi = cfg.assistenzaPiattaforma ? quotaInstallatoreAssistenza(db, cfg, p.id) : 0, qs = quotaSviluppatoreAssistenza(db, cfg, p.id), resto = qi + qs;
    const [qm, qpm] = cfg.assistenzaPiattaforma ? [resto > 0 ? qi / resto : 0, 1 - resto] : [q, qp];
    const ua = unita(p.prezzo_avvio, pe, m.decimali), um = unita(cm, pe, m.decimali), ug = unita(ag, pe, m.decimali);
    const da = dividiUnita(ua, q, qp), dm = dividiUnita(um, qm, qpm), dg = dividiUnita(ug, qg, qp);
    const ea = dividi(p.prezzo_avvio, q, qp), em = dividi(cm, qm, qpm), eg = dividi(ag, qg, qp);
    const su = spartisci(da.builder + dm.builder + dg.builder, coll), sa = spartisci(ea.builder, coll), sm = spartisci(em.builder, coll), sg = spartisci(eg.builder, coll);
    const norm = a => (r.tipo === 'evm' ? checksum(a) : a);
    const piattaforma = da.piattaforma + dm.piattaforma + dg.piattaforma;
    const pt = [
      { ruolo: 'builder', utente: builder.id, indirizzo: norm(bw), unita: String(su.builder), euro: sa.builder + sm.builder + sg.builder, avvio: sa.builder, mese: sm.builder, agg: sg.builder },
      ...coll.map((x, i) => ({ ruolo: x.ruolo, utente: x.utente, indirizzo: norm(walletDi(x.u, r.tipo)), unita: String(su.collaboratori[i].importo),
        euro: sa.collaboratori[i].importo + sm.collaboratori[i].importo + sg.collaboratori[i].importo, avvio: sa.collaboratori[i].importo, mese: sm.collaboratori[i].importo, agg: sg.collaboratori[i].importo })),
      { ruolo: 'installatore', utente: inst.id, indirizzo: norm(iw), unita: String(da.installatore + dm.installatore + dg.installatore), euro: ea.installatore + em.installatore + eg.installatore,
        avvio: ea.installatore, mese: em.installatore, agg: eg.installatore },
      { ruolo: 'piattaforma', indirizzo: norm(r.piattaforma), unita: String(piattaforma), euro: ea.piattaforma + em.piattaforma + eg.piattaforma },
    ].filter(x => BigInt(x.unita) > 0n);
    // l'affitto minimo dei conti nuovi su Solana, la soglia di «polvere» su Bitcoin: sotto, la transazione fallirebbe
    const minimo = r.tipo === 'solana' && !m.indirizzo ? 890_880n : r.tipo === 'bitcoin' ? 546n : 0n;
    // la parte della piattaforma (l'1%) negli ordini piccoli può stare sotto il minimo: invece di bloccare il pagamento, la piattaforma
    // ci rinuncia e va al builder (o a chi installa, se al builder non va niente)
    const pp = pt.find(x => x.ruolo === 'piattaforma'), pb = pt.find(x => x.ruolo === 'builder') || pt.find(x => x.ruolo === 'installatore');
    if (pp && pb && BigInt(pp.unita) < minimo) {
      pb.unita = String(BigInt(pb.unita) + BigInt(pp.unita)); pb.euro += pp.euro; pb.avvio += ea.piattaforma; pb.mese += em.piattaforma; pb.agg += eg.piattaforma;
      pt.splice(pt.indexOf(pp), 1);
    }
    // il minimo si controlla prima dei satoshi in più per Bitcoin: così l'esito non dipende da quanti ne escono a caso
    if (pt.some(x => BigInt(x.unita) < minimo)) throw errore(400, `Una delle parti è troppo piccola per ${r.nome}: scegli un'altra moneta o paga con carta`);
    if (r.tipo === 'bitcoin') {
      // Bitcoin non ha dove scrivere l'ordine: ogni parte riceve un importo unico fra gli ordini aperti (pochi satoshi in più,
      // meno di un euro) e la verifica lo vuole esatto. Così un pagamento non può valere per l'ordine di un altro.
      const occupati = new Set(db.prepare("SELECT parti FROM ordine WHERE rete = ? AND stato = 'aperto'").all(r.id)
        .flatMap(o => JSON.parse(o.parti).map(x => `${x.indirizzo}:${x.unita}`)));
      for (const x of pt) {
        let u, prove = 0;
        do { u = BigInt(x.unita) + BigInt(randomInt(1, 1000)); if (++prove > 5000) throw errore(503, 'Troppi ordini Bitcoin aperti in questo momento: riprova fra un po\' o scegli un\'altra rete'); } while (occupati.has(`${x.indirizzo}:${u}`));
        x.unita = String(u); occupati.add(`${x.indirizzo}:${u}`);
      }
    }
    return pt;
  }
  // trattenuta e finestra dell'arbitro (in secondi) come le ha scritte chi ha pubblicato il contratto: lette una volta per rete e tenute;
  // se la rete non risponde, i valori attesi (14 e 60 giorni), segnati come stima
  const memoTempi = new Map();
  async function tempiEscrow(r) {
    if (!memoTempi.has(r.id)) {
      try { memoTempi.set(r.id, await tempiDi(c.rpc, r, r.escrow)); }
      catch (e) { console.error(`escrow ${r.id}:`, e.message); return { trattenuta: cfg.trattenuta * 86400, finestra: 60 * 86400, stimato: true }; }
    }
    return memoTempi.get(r.id);
  }
  // l'ordine in escrow come lo vedono il cliente, chi riceve e il pannello: lo stato, le parti e i dati delle azioni possibili adesso
  async function vistaEscrow(o) {
    const r = retiAccese(cfg).find(x => x.id === o.rete); if (!r) throw errore(400, 'Questa rete non è più attiva');
    const m = moneta(r, o.simbolo), pt = JSON.parse(o.parti), id = idEscrow(o.codice), chiave = o.pagatore ? chiaveOrdine(o) : null, t = await tempiEscrow(r);
    const arbitro = await arbitroDi(c.rpc, r, o.escrow).catch(() => cfg.crypto.wallet);
    const p = db.prepare('SELECT nome, slug FROM prodotto WHERE id = ?').get(o.prodotto);
    const sbloccabile = o.custodia === 'trattenuto' && !!o.sblocco && Date.now() >= new Date(o.sblocco).getTime();
    const riprendibile = o.custodia === 'contestato' && !!o.congelato && Date.now() >= new Date(o.congelato).getTime() + t.finestra * 1000;
    let tx = null; try { tx = JSON.parse(o.tx || 'null')?.[0] || null; } catch { }
    return { codice: o.codice, prodotto: p?.nome || null, slug: p?.slug || null,
      rete: { id: r.id, nome: r.nome, chainId: '0x' + r.chainId.toString(16), rpc: r.rpc, esploratore: r.esploratore, prova: !!r.prova },
      escrow: o.escrow, id, chiave, stato: o.stato, custodia: o.custodia, sblocco: o.sblocco, congelato: o.congelato, trattenuta: t.trattenuta, finestra: t.finestra, pagatore: o.pagatore, arbitro, tx,
      moneta: { simbolo: m.simbolo, decimali: m.decimali, indirizzo: m.indirizzo, nativo: !m.indirizzo },
      parti: pt.map(({ ruolo, indirizzo, unita, euro }) => ({ ruolo, indirizzo, unita, euro })), totale: String(totaleDi(pt)), euro: o.euro, esito: o.esito ? JSON.parse(o.esito) : null,
      azioni: o.stato !== 'pagato' || !chiave ? {} : {
        ...(o.custodia === 'trattenuto' ? { conferma: datiAzione('conferma', chiave, pt), contesta: datiAzione('contesta', chiave, pt), ...(sbloccabile ? { rilascia: datiAzione('rilascia', chiave, pt) } : {}) } : {}),
        ...(riprendibile ? { rimborsa: datiAzione('rimborsa', chiave, pt) } : {}) } };
  }
  // la conferma: il controllo sulla blockchain e la vendita registrata. La usano la rotta (le transazioni le manda il browser) e il giro
  // che cerca i depositi in escrow. → {attesa} | {ok, pagatore, escrow?, sblocco?}; gli errori come eccezioni
  async function registra(o, tx) {
    const r = retiAccese(cfg).find(x => x.id === o.rete); if (!r) throw errore(400, 'Questa rete non è più attiva');
    // ore dopo la scadenza per le conferme (Bitcoin è lento). In escrow no: il contratto rifiuta i depositi tardivi e l'ora del blocco si
    // controlla qui sotto, quindi un deposito puntuale si registra anche se il browser lo segnala (o il giro lo trova) più tardi
    const margine = r.tipo === 'bitcoin' ? 6 : 1;
    if (!o.escrow && new Date(o.scade).getTime() + margine * 3600e3 < Date.now()) throw errore(400, 'L\'ordine è scaduto: creane uno nuovo');
    const norm = x => (r.tipo === 'solana' ? String(x) : String(x).toLowerCase().replace(r.tipo === 'evm' ? /^$/ : /^0x/, ''));
    const hash = [...new Set((Array.isArray(tx) ? tx : []).map(norm).filter(Boolean))].slice(0, 8);
    if (!hash.length && r.tipo !== 'solana' && r.tipo !== 'bitcoin') throw errore(400, 'Mancano le transazioni');
    const usata = x => { const u = db.prepare('SELECT ordine FROM tx_usata WHERE rete = ? AND hash = ?').get(o.rete, x); return !!u && u.ordine !== o.id; };
    if (hash.some(usata)) throw errore(409, 'Questa transazione è già stata usata');
    const m = moneta(r, o.simbolo), pt = JSON.parse(o.parti), dopo = new Date(o.creato.replace(' ', 'T') + 'Z').getTime();
    // il pagamento deve arrivare finché vale il prezzo (per Bitcoin conta il blocco, che può arrivare più tardi)
    const entro = new Date(o.scade).getTime() + (r.tipo === 'bitcoin' ? 3 * 3600e3 : 120e3), etichetta = etichettaOrdine(o.codice);
    let esito;
    try {
    if (r.tipo === 'evm') esito = o.escrow ? await verificaDeposito({ rpc: c.rpc, rete: r, escrow: o.escrow, id: idEscrow(o.codice), m, parti: pt, hash, dopo, entro })
      : await verifica({ rpc: c.rpc, rete: r, m, parti: pt, hash, dopo, etichetta, entro });
    else if (r.tipo === 'solana') { esito = await verificaSolana({ rpc: c.rpc, rete: r, m, parti: pt, firma: hash[0], riferimento: o.riferimento, dopo }); if (esito.firma) esito.tx = [esito.firma]; }
    else if (r.tipo === 'bitcoin') esito = await verificaBitcoin({ rete: r, parti: pt, tx: hash, dopo, usata, esatto: true, entro, ...(c.chiediBitcoin ? { chiedi: c.chiediBitcoin } : {}) });
    else esito = await verificaTron({ rete: r, m, parti: pt, tx: hash, dopo, memo: etichetta, entro, chiedi: c.chiediTron || clienteTron(r.api, cfg.crypto.chiaveTron) });
    } catch (e) { throw errore(502, `Non riesco a leggere la rete ${r.nome} adesso: riprovo fra poco`); }   // un nodo che non risponde non è un errore del pagamento
    if (esito.attesa) return { attesa: esito.attesa };
    if (esito.errore) throw errore(400, esito.errore);
    const usate = (esito.tx?.length ? esito.tx : hash).map(norm);
    if (usate.some(usata)) throw errore(409, 'Questa transazione è già stata usata');
    const p = db.prepare('SELECT * FROM prodotto WHERE id = ?').get(o.prodotto), ora = new Date().toISOString(), fattura = `cr_${o.codice}`;
    const pagatore = esito.pagatore || null, chi = pagatore ? `Wallet ${pagatore.slice(0, 6)}…${pagatore.slice(-4)}` : `Pagamento ${r.nome}`;
    // in escrow le quote aspettano nel contratto («in_escrow», disponibili dallo sblocco); nei pagamenti diretti sono già versate
    const inEscrow = !!o.escrow, sblocco = inEscrow ? new Date(esito.sblocco * 1000).toISOString() : null;
    db.exec('BEGIN');
    try {
      const gia = db.prepare('SELECT stato, pagatore FROM ordine WHERE id = ?').get(o.id);   // registrato nel frattempo (un'altra scheda, il giro)
      if (gia.stato === 'pagato') { db.exec('ROLLBACK'); return { ok: true, pagatore: gia.pagatore }; }
      for (const x of usate) db.prepare('INSERT OR IGNORE INTO tx_usata (rete, hash, ordine) VALUES (?, ?, ?)').run(o.rete, x, o.id);
      db.prepare("UPDATE ordine SET stato = 'pagato', pagatore = ?, tx = ?, custodia = ?, sblocco = ?, blocco = ?, controllato = CASE WHEN ? THEN datetime('now') ELSE controllato END WHERE id = ?")
        .run(pagatore, JSON.stringify(usate), inEscrow ? 'trattenuto' : null, sblocco, inEscrow ? esito.blocco : null, inEscrow ? 1 : 0, o.id);
      // l'assistenza pagata in anticipo vale per i mesi dell'ordine: da oggi, o (in un rinnovo) dalla fine del periodo già pagato.
      // Le basi fissate quando è nato l'ordine: l'installazione (non nei rinnovi), gli aggiornamenti (se scelti), il resto è l'assistenza
      const cliente = o.rinnovo || fattura;
      const baseAgg = o.aggiornamenti || 0, baseAvvio = o.rinnovo ? 0 : o.avvio ?? p.prezzo_avvio, baseMese = o.euro - baseAvvio - baseAgg;
      if (o.rinnovo) {
        const cl = db.prepare('SELECT assistenza_fino FROM cliente WHERE chiave = ?').get(o.rinnovo);
        const da = Math.max(Date.now(), Date.parse(cl?.assistenza_fino || '') || 0);
        db.prepare("UPDATE cliente SET assistenza_fino = ?, stato = 'attivo' WHERE chiave = ?").run(piuMesi(da, o.mesi), o.rinnovo);
        togliAvvisi(db, o.rinnovo, ['scade30', 'scade7', 'scaduta']);
      } else db.prepare(`INSERT OR IGNORE INTO cliente (chiave, prodotto, installatore, quota_avvio, quota_mese, nome, email, sessione, assistenza_fino, aggiornamenti) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(fattura, o.prodotto, o.installatore, o.quota ?? quotaDi(db, cfg, o.prodotto, o.installatore), o.quota ?? quotaDi(db, cfg, o.prodotto, o.installatore), chi, o.email, o.codice,
          baseMese > 0 || baseAgg > 0 ? piuMesi(Date.now(), o.mesi) : null, o.aggiornamenti > 0 ? p.prezzo_aggiornamenti : null);
      const ins = db.prepare(`INSERT OR IGNORE INTO quota (beneficiario, ruolo, prodotto, fattura, riga, tipo, base, frazione, importo, pagamento, disponibile, stato, trasferimento, cliente)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const statoQuota = inEscrow ? 'in_escrow' : 'versata', disponibile = sblocco || ora, trasferimento = inEscrow ? null : usate[0];
      for (const x of pt.filter(x => x.utente)) {   // le quote in euro al prezzo dell'ordine
        if (x.avvio > 0) ins.run(x.utente, x.ruolo, p.id, fattura, 'avvio', 'avvio', baseAvvio, x.avvio / baseAvvio, x.avvio, usate[0], disponibile, statoQuota, trasferimento, cliente);
        if (x.mese > 0) ins.run(x.utente, x.ruolo, p.id, fattura, 'mese', 'mese', baseMese, x.mese / baseMese, x.mese, usate[0], disponibile, statoQuota, trasferimento, cliente);
        if (x.agg > 0) ins.run(x.utente, x.ruolo, p.id, fattura, 'aggiornamenti', 'aggiornamenti', baseAgg, x.agg / baseAgg, x.agg, usate[0], disponibile, statoQuota, trasferimento, cliente);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    // (l'avviso del livello nuovo parte quando il cliente conferma l'installazione: solo allora la vendita conta)
    // l'ordine nato dalla cassa (/compra): la pagina d'installazione si accende e il cliente riceve il link
    const aq = !o.rinnovo && db.prepare('SELECT codice FROM acquisto WHERE sessione = ?').get(`cr:${o.codice}`);
    if (aq) collegaAcquisto(db, cfg, notifiche.email, aq.codice, fattura).catch(() => {});
    for (const x of pt.filter(x => x.utente)) notifiche.notifica(x.utente, inEscrow ? 'escrow.depositato' : 'crypto.pagato',
      { prodotto: p.nome, slug: p.slug, importo: x.euro, simbolo: o.simbolo, ruolo: x.ruolo, cliente: chi, rete: r.nome, ...(sblocco ? { sblocco: new Date(sblocco).toLocaleDateString('it-IT') } : {}) });
    return { ok: true, pagatore, ...(inEscrow ? { escrow: true, sblocco } : {}) };
  }

  // i depositi in escrow che il browser non ha segnalato (pagina chiusa, connessione persa): cercati per id negli eventi del contratto,
  // dal blocco in cui è nato l'ordine fino a quando il contratto li accettava (scadenzaDeposito). ordine.blocco fa da segno: avanza a
  // ogni giro, torna NULL quando non c'è più niente da cercare. Un deposito d'altri con lo stesso id non corrisponde e si salta.
  const PASSO = 2000;   // blocchi per richiesta, dentro i limiti dei nodi pubblici
  c.cercaDepositi = async (quanti = 20) => {
    const l = db.prepare("SELECT * FROM ordine WHERE escrow IS NOT NULL AND stato IN ('aperto', 'scaduto') AND blocco IS NOT NULL AND creato > datetime('now', '-3 days') ORDER BY id LIMIT ?").all(quanti);
    let n = 0;
    for (const o of l) {
      const r = retiAccese(cfg).find(x => x.id === o.rete); if (r?.tipo !== 'evm') continue;
      try {
        const ultimo = Number(BigInt(await c.rpc(r.rpc, 'eth_blockNumber'))), a = Math.min(ultimo, o.blocco + PASSO - 1);
        if (a < o.blocco) continue;
        let trovato = false;
        for (const log of await depositiDi(c.rpc, r, o.escrow, idEscrow(o.codice), o.blocco, a) || []) {
          const x = await registra(o, [log.transactionHash]).catch(e => ({ errore: e.message }));
          if (x.ok || x.attesa) { trovato = true; if (x.ok) n++; break; }   // con «attesa» si riprova al giro dopo dallo stesso blocco
        }
        if (trovato) continue;
        const b = await c.rpc(r.rpc, 'eth_getBlockByNumber', ['0x' + a.toString(16), false]);
        const finito = Number(BigInt(b.timestamp)) > scadenzaDeposito(o.scade);
        db.prepare("UPDATE ordine SET blocco = ? WHERE id = ? AND stato != 'pagato'").run(finito ? null : a + 1, o.id);
      } catch (e) { console.error(`deposito ${o.codice}:`, e.message); }
    }
    return n;
  };

  const ordineAperto = codice => {
    const o = db.prepare('SELECT * FROM ordine WHERE codice = ?').get(String(codice || ''));
    if (!o) throw errore(404, 'Ordine non trovato');
    if (o.stato !== 'aperto') throw errore(400, 'L\'ordine è già pagato');
    if (new Date(o.scade) < new Date()) throw errore(400, 'Il prezzo dell\'ordine è scaduto: creane uno nuovo');
    return o;
  };
  async function txSolana(o, account) {
    if (!eIndirizzoSolana(account)) throw errore(400, 'Indirizzo Solana non valido');
    const r = retiAccese(cfg).find(x => x.id === o.rete); if (r?.tipo !== 'solana') throw errore(400, 'Non è un ordine su Solana');
    const blocco = (await c.rpc(r.rpc, 'getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
    const pr = db.prepare('SELECT nome FROM prodotto WHERE id = ?').get(o.prodotto);
    try { return { transazione: transazioneSolana({ pagatore: account, blocco, m: moneta(r, o.simbolo), parti: JSON.parse(o.parti), riferimento: o.riferimento, memo: `${cfg.nome} ${o.codice}` }), cluster: r.cluster, prodotto: pr?.nome }; }
    catch (e) { throw errore(400, e.message); }
  }

  return {
    // ---------------- i wallet degli iscritti: provati con una firma (EVM, Solana, Tron) o scritti a mano (Bitcoin) ----------------
    'POST /api/wallet/sfida': async (req, res, { io }) => {
      c.serve(io); const { indirizzo, tipo = 'evm' } = await h.json(req); const t = TIPI[tipo];
      if (!t || !t.firma) throw errore(400, 'Rete non valida'); if (!t.valido(indirizzo)) throw errore(400, 'Indirizzo non valido');
      const a = t.normale(indirizzo), nonce = randomBytes(9).toString('base64url');
      const messaggio = `${new URL(cfg.url).host} chiede di collegare questo wallet a ${cfg.nome}.\n\nIndirizzo: ${a}\nAccount: ${io.codice}\nNonce: ${nonce}\nData: ${new Date().toISOString()}\n\nFirmare non costa nulla e non sposta fondi.`;
      db.prepare('INSERT INTO sfida (utente, indirizzo, messaggio, scade, tipo) VALUES (?, ?, ?, ?, ?) ON CONFLICT(utente) DO UPDATE SET indirizzo = excluded.indirizzo, messaggio = excluded.messaggio, scade = excluded.scade, tipo = excluded.tipo')
        .run(io.id, a, messaggio, new Date(Date.now() + 10 * 60e3).toISOString(), tipo);
      h.rispondi(res, 200, { messaggio });
    },
    'POST /api/wallet/verifica': async (req, res, { io }) => {
      c.serve(io); const { firma } = await h.json(req);
      const s = db.prepare('SELECT * FROM sfida WHERE utente = ? AND scade > ?').get(io.id, new Date().toISOString());
      if (!s) throw errore(400, 'La richiesta di firma è scaduta: riprova');
      if (!verificaPossesso(s.tipo || 'evm', s.messaggio, String(firma || ''), s.indirizzo)) throw errore(400, 'La firma non corrisponde a questo wallet');
      db.prepare('DELETE FROM sfida WHERE utente = ?').run(io.id);
      db.prepare(`UPDATE utente SET ${TIPI[s.tipo || 'evm'].colonna} = ?, wallet_dal = datetime('now') WHERE id = ?`).run(s.indirizzo, io.id);
      h.rispondi(res, 200, { wallet: s.indirizzo, tipo: s.tipo || 'evm' });
    },
    'POST /api/wallet/bitcoin': async (req, res, { io }) => {   // la somma di controllo dell'indirizzo protegge dagli errori di battitura
      c.serve(io); const { indirizzo } = await h.json(req); const a = String(indirizzo || '').trim();
      if (!TIPI.bitcoin.valido(a)) throw errore(400, 'Indirizzo Bitcoin non valido: copialo dal tuo wallet');
      db.prepare('UPDATE utente SET wallet_btc = ? WHERE id = ?').run(TIPI.bitcoin.normale(a), io.id);
      h.rispondi(res, 200, { wallet: TIPI.bitcoin.normale(a), tipo: 'bitcoin' });
    },
    'POST /api/wallet/scollega': async (req, res, { io }) => {
      c.serve(io); const { tipo = 'evm' } = await h.json(req); if (!TIPI[tipo]) throw errore(400, 'Rete non valida');
      db.prepare(`UPDATE utente SET ${TIPI[tipo].colonna} = NULL WHERE id = ?`).run(io.id); h.rispondi(res, 200, { ok: true });
    },

    // ---------------- l'ordine: le parti in unità della moneta, al prezzo di adesso, valido CRYPTO_MINUTI ----------------
    'POST /api/crypto/ordine': async (req, res) => {
      aperti(); if (troppiTentativi(`or:${ipDi(req)}`, Date.now(), 20, 10 * 60e3)) throw errore(429, 'Troppe richieste: riprova fra qualche minuto');
      const corpo = await h.json(req), { prodotto, installatore, rete: idr, simbolo, rinnovo, aggiornamenti } = corpo; let { email } = corpo;
      const r = retiAccese(cfg).find(x => x.id === idr), m = moneta(r, simbolo); if (!m) throw errore(400, 'Rete o moneta non disponibile');
      if (email && !emailValida(String(email).trim())) throw errore(400, 'Email non valida');
      let p, i, cl = null;
      if (rinnovo) {   // il rinnovo dell'assistenza: con il codice dell'installazione, stesso installatore, niente installazione da pagare
        cl = CODICE.test(String(rinnovo)) && db.prepare("SELECT * FROM cliente WHERE assistenza = ?").get(String(rinnovo));
        if (!cl) throw errore(404, 'Installazione non trovata: apri il rinnovo dalla tua pagina di assistenza');
        p = db.prepare(`SELECT p.* FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.id = ? AND u.stato IN ('attivo', 'non_rivendicato')`).get(cl.prodotto);
        i = db.prepare("SELECT * FROM utente WHERE id = ? AND stato = 'attivo'").get(cl.installatore);
        if (!p || !(p.prezzo_mese > 0 || (cl.aggiornamenti > 0 && p.prezzo_aggiornamenti > 0))) throw errore(400, 'Questo prodotto non ha un canone di assistenza da rinnovare');
        if (!i) throw errore(400, 'Chi ti ha installato il programma non è più attivo: scrivici e ti aiutiamo a trovare un altro installatore');
        email = email || cl.email;
      } else {
        p = db.prepare(`SELECT p.* FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.slug = ? AND p.stato = 'pubblicato' AND u.stato = 'attivo'`).get(String(prodotto || ''));
        if (!p) throw errore(404, 'Prodotto non trovato');
        const ab = filtroAbilitati(cfg, p);
        i = db.prepare(`SELECT u.* FROM adozione a JOIN utente u ON u.id = a.installatore WHERE a.prodotto = ? AND u.codice = ? AND u.stato = 'attivo'
          AND (? = 0 OR a.programma_accettato IS NOT NULL)${ab.sql}`).get(p.id, String(installatore || ''), p.programma_obbligatorio ? 1 : 0, ...ab.par);
        if (!i) throw errore(400, 'Scegli chi viene a installarlo');
      }
      // la parte di chi vende fissata nell'ordine (percentuale o accordo; in un rinnovo quella della vendita), e quella con il suo livello
      // di adesso per le parti; l'installazione al prezzo di chi vende
      const mesi = cfg.crypto.mesi, quota = cl ? (cl.quota_mese ?? quotaDi(db, cfg, p.id, i.id)) : quotaDi(db, cfg, p.id, i.id);
      const conIlLivello = conLivello(quota, livelloDi(db, cfg, p.id, i.id, cl?.chiave).fattore);
      const da = { ...p, prezzo_avvio: cl ? 0 : prezzoAvvioDi(db, p.id, i.id) };
      // gli aggiornamenti garantiti: scelti adesso, o (in un rinnovo) se il cliente li aveva, finché chi sviluppa li offre
      const conAgg = cl ? cl.aggiornamenti > 0 && p.prezzo_aggiornamenti > 0 : aggiornamenti === true && conAggiornamenti(p);
      if (!cl && aggiornamenti === true && !conAgg) throw errore(400, 'Questo prodotto non ha gli aggiornamenti garantiti da chi sviluppa');
      const ag = conAgg ? canone(p.prezzo_aggiornamenti, mesi, cfg.scontoAnno) : 0;
      const extra = cl?.assistenza_fino && p.prezzo_mese > 0 && Date.parse(cl.assistenza_fino) < Date.now() - cfg.riattivazioneGiorni * 864e5
        ? Math.round(cfg.riattivazioneMesi * p.prezzo_mese) : 0;
      const pe = await c.prezzo(m.prezzo), pt = parti(da, i, r, m, pe, mesi, conIlLivello, ag, extra);
      const codice = randomBytes(9).toString('base64url'), scade = new Date(Date.now() + cfg.crypto.validita * 60e3).toISOString();
      const riferimento = r.tipo === 'solana' ? nuovoRiferimento() : null, euro = da.prezzo_avvio + canone(p.prezzo_mese, mesi, cfg.scontoAnno) + ag + extra;
      const escrow = r.tipo === 'evm' && r.escrow ? r.escrow : null;   // sulle reti col contratto il pagamento resta in custodia finché il cliente non conferma
      // il blocco di adesso: da qui il giro periodico cerca il deposito, se il browser non fa in tempo a segnalarlo
      const inizio = escrow ? await c.rpc(r.rpc, 'eth_blockNumber').then(x => Number(BigInt(x))).catch(() => null) : null;
      db.prepare('INSERT INTO ordine (codice, prodotto, installatore, rete, simbolo, prezzo, mesi, euro, parti, scade, email, riferimento, escrow, blocco, quota, rinnovo, aggiornamenti, avvio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(codice, p.id, i.id, r.id, m.simbolo, pe, mesi, euro, JSON.stringify(pt), scade, email ? String(email).trim().toLowerCase() : null, riferimento, escrow, inizio, quota, cl ? cl.chiave : null, ag || null, da.prezzo_avvio);
      // dalla cassa: l'acquisto ricorda l'ordine (l'ultimo tentativo), e quando è pagato la pagina d'installazione si accende
      if (!cl && /^[A-Za-z0-9_-]{24}$/.test(String(corpo.acquisto || ''))) db.prepare("UPDATE acquisto SET sessione = ?, metodo = 'crypto', aggiornato = datetime('now') WHERE codice = ? AND prodotto = ? AND installatore = ? AND stato IN ('aperto', 'respinto')")
        .run(`cr:${codice}`, String(corpo.acquisto), p.id, i.id);
      const vista = pt.map(({ ruolo, indirizzo, unita, euro }) => {
        const x = { ruolo, indirizzo, unita, euro };
        if (r.tipo === 'bitcoin') { x.uri = uriBitcoin(indirizzo, BigInt(unita), { etichetta: cfg.nome, messaggio: `${p.nome}: ${ruolo}` }); x.qr = qrSvg(x.uri, { etichetta: `Paga ${ruolo}` }); }
        if (r.tipo === 'tron') x.qr = qrSvg(indirizzo, { etichetta: `Indirizzo ${ruolo}` });
        return x;
      });
      let solanaPay = null;
      if (r.tipo === 'solana' && cfg.url.startsWith('https://')) { const link = linkSolanaPay(`${cfg.url}/api/solana/pay?ordine=${codice}`); solanaPay = { link, qr: qrSvg(link, { etichetta: 'Paga con il telefono' }) }; }
      h.rispondi(res, 201, { codice, scade, mesi, euro, prezzo: pe, ...(cl ? { rinnovo: true } : {}), ...(extra ? { riattivazione: extra } : {}),
        rete: { id: r.id, nome: r.nome, tipo: r.tipo, esploratore: r.esploratore, prova: !!r.prova, ...(r.conferme ? { conferme: r.conferme } : {}), ...(r.chainId ? { chainId: '0x' + r.chainId.toString(16), rpc: r.rpc } : {}), ...(r.cluster ? { cluster: r.cluster } : {}) },
        moneta: { simbolo: m.simbolo, decimali: m.decimali, indirizzo: m.indirizzo, nativo: !m.indirizzo }, parti: vista,
        ...(r.tipo === 'evm' ? { chiamate: escrow ? chiamateEscrow(escrow, idEscrow(codice), m, pt, scadenzaDeposito(scade)) : chiamate(m, pt, etichettaOrdine(codice)) } : {}),
        ...(escrow ? { escrow: { indirizzo: escrow, id: idEscrow(codice), scadenza: scadenzaDeposito(scade), totale: String(totaleDi(pt)), ...(await tempiEscrow(r)) } } : {}),
        ...(r.tipo === 'tron' ? { memo: etichettaOrdine(codice) } : {}), ...(solanaPay ? { solanaPay } : {}) });
    },
    // Solana: la transazione da firmare, costruita per il wallet del business (browser) o per Solana Pay (telefono)
    'POST /api/solana/tx': async (req, res) => {
      const { codice, account } = await h.json(req); if (troppiTentativi(`st:${ipDi(req)}`, Date.now(), 30, 60e3)) throw errore(429, 'Troppe richieste: riprova fra qualche secondo');
      const o = ordineAperto(codice);
      h.rispondi(res, 200, await txSolana(o, String(account || '')));
    },
    'OPTIONS /api/solana/pay': async (req, res) => { res.writeHead(204, CORS); res.end(); },
    'GET /api/solana/pay': async (req, res) => h.rispondi(res, 200, { label: cfg.nome, icon: `${cfg.url}/icona.svg` }, CORS),
    'POST /api/solana/pay': async (req, res, { url }) => {   // la specifica «transaction request» (docs.solanapay.com/spec)
      const { account } = await h.json(req); const o = ordineAperto(url.searchParams.get('ordine'));
      const t = await txSolana(o, String(account || ''));
      h.rispondi(res, 200, { transaction: t.transazione, message: `${cfg.nome}: ${t.prodotto || 'ordine'}` }, CORS);
    },

    // ---------------- la conferma: il controllo sulla blockchain e la vendita registrata ----------------
    'POST /api/crypto/conferma': async (req, res) => {
      const { codice, tx } = await h.json(req);
      if (troppiTentativi(`cf:${ipDi(req)}`, Date.now(), 40, 60e3)) throw errore(429, 'Troppe richieste: riprova fra qualche secondo');
      const o = db.prepare('SELECT * FROM ordine WHERE codice = ?').get(String(codice || '')); if (!o) throw errore(404, 'Ordine non trovato');
      if (o.stato === 'pagato') return h.rispondi(res, 200, { ok: true, pagatore: o.pagatore });
      const x = await registra(o, tx);
      if (x.attesa) return h.rispondi(res, 202, { attesa: x.attesa });
      h.rispondi(res, 200, x);
    },

    // ---------------- l'escrow: lo stato sul contratto e i dati delle azioni (le firma il wallet di chi agisce, il server non ha chiavi) ----------------
    'GET /api/crypto/escrow': async (req, res, { url }) => {
      if (troppiTentativi(`es:${ipDi(req)}`, Date.now(), 60, 60e3)) throw errore(429, 'Troppe richieste: riprova fra qualche secondo');
      const o = db.prepare('SELECT * FROM ordine WHERE codice = ?').get(String(url.searchParams.get('codice') || ''));
      if (!o?.escrow) throw errore(404, 'Ordine non trovato');
      h.rispondi(res, 200, await vistaEscrow(o));
    },
    'POST /api/crypto/escrow/stato': async (req, res) => {   // rilegge il contratto adesso (dopo una transazione appena mandata) e aggiorna il database
      const { codice, tx } = await h.json(req);
      if (troppiTentativi(`ez:${ipDi(req)}`, Date.now(), 40, 60e3)) throw errore(429, 'Troppe richieste: riprova fra qualche secondo');
      const o = db.prepare('SELECT * FROM ordine WHERE codice = ?').get(String(codice || ''));
      if (!o?.escrow) throw errore(404, 'Ordine non trovato');
      if (o.stato !== 'pagato') throw errore(400, 'Il deposito non è ancora confermato');
      let esito;
      try { esito = await aggiornaCustodia(c, o, { tx: typeof tx === 'string' ? tx : null }); }
      catch (e) { if (e.stato && e.stato < 500) throw e; throw errore(502, 'Non riesco a leggere la rete adesso: riprovo fra poco'); }
      h.rispondi(res, 200, esito);
    },
  };
}
