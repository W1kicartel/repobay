// I dati fiscali di chi riceve pagamenti e la comunicazione annuale DAC7 della piattaforma (direttiva UE 2021/514, in Italia
// D.Lgs. 32/2023): la piattaforma comunica all'Agenzia delle Entrate, per chi ha ricevuto pagamenti, nome, indirizzo, codice
// fiscale o partita IVA, gli importi ricevuti e le commissioni trattenute, trimestre per trimestre. Nient'altro.
// I dati stanno cifrati nel database; li vedono solo l'iscritto e chi gestisce la piattaforma quando prepara la comunicazione.

const CF = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPR-T][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;
export function partitaIvaValida(p) {
  if (!/^\d{11}$/.test(p)) return false;
  let s = 0;
  for (let i = 0; i < 11; i++) { let c = Number(p[i]); if (i % 2) { c *= 2; if (c > 9) c -= 9; } s += c; }
  return s % 10 === 0;
}
// il carattere di controllo del codice fiscale (l'ultima lettera), dai primi quindici: posizioni dispari e pari hanno tabelle diverse
const DISPARI = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
const valore = (c, pari) => { const n = /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65; return pari ? n : DISPARI[n]; };
export const controlloCf = s => String.fromCharCode(65 + [...s.slice(0, 15)].reduce((t, c, i) => t + valore(c, i % 2 === 1), 0) % 26);
export const codiceFiscaleValido = c => (CF.test(c) && controlloCf(c) === c[15]) || partitaIvaValida(c);   // le società hanno come codice fiscale la partita IVA

// → {dati puliti} o lancia con il motivo
export function controllaFiscale(d) {
  const t = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  const tipo = d.tipo === 'impresa' ? 'impresa' : 'persona';
  const paese = t(d.paese, 2).toUpperCase() || 'IT';
  const f = { tipo, nome: t(d.nome, 120), codice: t(d.codice, 20).toUpperCase().replace(/\s/g, ''), partita_iva: t(d.partita_iva, 20).replace(/\s/g, '').toUpperCase(),
    via: t(d.via, 120), cap: t(d.cap, 10), citta: t(d.citta, 60), provincia: t(d.provincia, 2).toUpperCase(), paese };
  const no = m => { throw Object.assign(new Error(m), { stato: 400 }); };
  if (f.nome.length < 2) no(tipo === 'impresa' ? 'Scrivi la ragione sociale' : 'Scrivi nome e cognome come sui documenti');
  if (!/^[A-Z]{2}$/.test(paese)) no('Paese non valido (due lettere, es. IT)');
  if (paese === 'IT') {
    if (!codiceFiscaleValido(f.codice)) no('Codice fiscale non valido');
    if (f.partita_iva && !partitaIvaValida(f.partita_iva.replace(/^IT/, ''))) no('Partita IVA non valida');
    if (tipo === 'impresa' && !f.partita_iva) no('Per un\'impresa serve la partita IVA');
    if (!/^\d{5}$/.test(f.cap)) no('CAP non valido');
    if (!/^[A-Z]{2}$/.test(f.provincia)) no('Provincia: due lettere, es. BG');
  } else if (!/^[A-Z0-9-]{4,20}$/.test(f.codice)) no('Codice fiscale estero non valido');
  if (f.via.length < 3 || f.citta.length < 2) no('Scrivi l\'indirizzo completo');
  return f;
}

const trimestre = s => { const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z'); return `${d.getUTCFullYear()}-T${Math.floor(d.getUTCMonth() / 3) + 1}`; };

// quanto comunica la piattaforma per un iscritto in un anno: importi ricevuti (al netto degli storni), commissioni trattenute sulle
// stesse vendite, numero di operazioni; per trimestre, contando le quote versate. Le commissioni di una riga (quello che resta dopo le
// parti di tutti: la piattaforma e, con carta, il costo di Stripe) si dividono fra chi ha ricevuto qualcosa da quella riga, in proporzione
// alla sua parte; un'operazione è un pagamento (una fattura), anche se porta più righe. Le quote stornate del tutto non contano.
// frazionePiattaforma resta per chi la passa ancora: non serve più
export function riepilogoDac7(db, utente, anno, frazionePiattaforma) {
  const righe = db.prepare(`SELECT q.fattura, q.base, q.importo, q.importo - q.stornato AS netto, q.creato,
      (SELECT COALESCE(SUM(x.importo), 0) FROM quota x WHERE x.fattura = q.fattura AND x.riga = q.riga) AS parti
    FROM quota q WHERE q.beneficiario = ? AND q.stato = 'versata' AND q.importo - q.stornato > 0 AND strftime('%Y', q.creato) = ?`).all(utente, String(anno));
  const t = {}, viste = {};
  for (const r of righe) {
    const k = trimestre(r.creato); t[k] ??= { trimestre: k, operazioni: 0, ricevuto: 0, commissioni: 0 }; viste[k] ??= new Set();
    if (!viste[k].has(r.fattura)) { viste[k].add(r.fattura); t[k].operazioni++; }
    t[k].ricevuto += r.netto;
    if (r.parti > 0) t[k].commissioni += Math.round(Math.max(0, r.base - r.parti) * r.netto / r.parti);
  }
  const trimestri = Object.values(t).sort((a, b) => a.trimestre.localeCompare(b.trimestre));
  return { anno: Number(anno), trimestri, totale: trimestri.reduce((s, x) => s + x.ricevuto, 0), operazioni: trimestri.reduce((s, x) => s + x.operazioni, 0) };
}
