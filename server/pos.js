// Il pagamento con carta dal POS virtuale della banca: nessuna piattaforma in mezzo, il contratto è fra chi gestisce Repobay e la
// sua banca e i soldi arrivano sul suo conto aziendale. Qui Nexi XPay «pagamento semplice», il POS virtuale dietro la maggior parte
// delle banche italiane (specifiche tecniche XPay 20.4, giugno 2024): il cliente va sulla pagina di cassa con un modulo firmato
// (MAC SHA-1 con la chiave segreta), paga, e XPay manda l'esito firmato al server (urlpost) e al browser (url). Un'altra banca
// (Axerve, PagOnline…) si aggiunge qui con le stesse due funzioni: avvio ed esito.
import { createHash, timingSafeEqual } from 'node:crypto';

const sha1 = s => createHash('sha1').update(s, 'utf8').digest('hex');
export const CASSA = { prova: 'https://int-ecommerce.nexi.it/ecomm/ecomm/DispatcherServlet', vera: 'https://ecommerce.nexi.it/ecomm/ecomm/DispatcherServlet' };

// codTrans: alfanumerico, da 2 a 30 caratteri, uno nuovo per ogni tentativo (dopo un rifiuto si riprova con un altro).
// Dentro c'è la causale dell'ordine, così l'esito porta da solo all'ordine: RB-7K2Q9M → RB7K2Q9MT<tempo>
export const codTransDi = (causale, n = Date.now()) => causale.replace(/[^A-Z0-9]/g, '') + 'T' + n.toString(36).toUpperCase();
export const causaleDa = codTrans => { const m = /^RB([A-Z0-9]{6})T[A-Z0-9]{1,20}$/.exec(String(codTrans || '')); return m ? `RB-${m[1]}` : null; };

// il modulo da mandare alla pagina di cassa: { url, campi } (il browser lo invia con un POST)
export function avvioPos({ alias, chiave, prova }, { codTrans, importo, url, urlBack, urlPost, email, lingua, descrizione }) {
  if (!Number.isInteger(importo) || importo < 1 || importo > 99_999_999) throw new Error('Importo non valido per la carta');
  const campi = { alias, importo: String(importo), divisa: 'EUR', codTrans, url, url_back: urlBack, ...(urlPost ? { urlpost: urlPost } : {}),
    ...(email ? { mail: String(email).slice(0, 150) } : {}), languageId: lingua === 'en' ? 'ENG' : 'ITA',
    descrizione: String(descrizione || '').replace(/[#'"]/g, '').slice(0, 200) };
  campi.mac = sha1(`codTrans=${campi.codTrans}divisa=${campi.divisa}importo=${campi.importo}${chiave}`);
  return { url: prova ? CASSA.prova : CASSA.vera, campi };
}

// l'esito (dalla notifica server a server o dal ritorno del browser): vale solo se il MAC torna con la chiave segreta.
// esito: OK (pagato), KO (rifiutato), ANNULLO (il cliente ha lasciato la cassa), ERRORE (richiesta sbagliata)
export function esitoPos({ chiave }, x) {
  const v = k => String(x?.[k] ?? '');
  const atteso = sha1(`codTrans=${v('codTrans')}esito=${v('esito')}importo=${v('importo')}divisa=${v('divisa')}data=${v('data')}orario=${v('orario')}codAut=${v('codAut')}${chiave}`);
  const mac = v('mac').toLowerCase();
  const firmato = !!chiave && mac.length === atteso.length && timingSafeEqual(Buffer.from(mac), Buffer.from(atteso));
  return { firmato, esito: v('esito'), codTrans: v('codTrans'), importo: Number(v('importo')) || 0, divisa: v('divisa'), codAut: v('codAut'), brand: v('brand') };
}
