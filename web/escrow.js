// L'escrow dal browser: le azioni sul contratto (conferma, rilascia, contesta, rimborsa, risolvi) le firma il wallet di chi agisce.
// Il server prepara i dati della chiamata e, dopo, rilegge il contratto; non ha chiavi. Usato dall'area clienti, dall'area di
// chi riceve (per incassare a trattenuta finita) e dal pannello (l'arbitro congela e decide).
import { chiama, t } from './comune.js';
import { account, rete as cambiaRete, ceWallet } from './wallet.js';

const aspetta = ms => new Promise(r => setTimeout(r, ms));
export const corto = a => (a && a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '');
export const infoEscrow = codice => chiama('GET', `/api/crypto/escrow?codice=${encodeURIComponent(codice)}`);
// gli stati sul contratto, con le parole per le persone
export const CUSTODIE = { trattenuto: 'in escrow', contestato: 'congelato', confermato: 'sbloccato dal cliente', rilasciato: 'sbloccato', risolto: 'deciso dall\'arbitro', rimborsato: 'rimborsato' };
export const classeCustodia = c => (c === 'contestato' ? 'annullata' : c === 'trattenuto' ? 'in_attesa' : c === 'rimborsato' ? 'annullata' : 'ok');
// una durata in secondi, in parole: 14 giorni, 36 ore, 10 minuti
export function durata(s) {
  const g = Math.round(s / 86400); if (g >= 2) return t('{n} giorni', { n: g });
  const h = Math.round(s / 3600); if (h >= 2) return t('{n} ore', { n: h });
  return t('{n} minuti', { n: Math.max(1, Math.round(s / 60)) });
}
export const messaggioWallet = e => (e?.code === 4001 || /reject|denied|annullat|cancel/i.test(e?.message || '') ? t('Hai annullato nel wallet') : e?.message || t('Il wallet ha rifiutato la transazione'));

// manda al contratto un'azione dal wallet collegato (che deve essere il pagatore o l'arbitro, se indicato), poi aspetta che il
// server la veda sulla rete. → lo stato nuovo {custodia, …, tx}; «lenta» se la rete non ha ancora confermato
export async function azioneEscrow(codice, azione, { dire = () => {}, soloDa = null, dati = null, info = null } = {}) {
  if (!ceWallet()) throw new Error(t('Serve un wallet nel browser (MetaMask, Rabby, Coinbase Wallet) o il browser del tuo wallet sul telefono.'));
  const i = info || await infoEscrow(codice);
  const data = dati || i.azioni?.[azione]; if (!data) throw new Error(t('Questa azione non è possibile adesso: ricarica la pagina'));
  let tx;
  try {
    dire('Collega il wallet…'); const da = await account();
    const atteso = soloDa === 'pagatore' ? i.pagatore : soloDa === 'arbitro' ? i.arbitro : null;
    if (atteso && da.toLowerCase() !== atteso.toLowerCase()) throw new Error(t('Nel wallet scegli l\'account {wallet}: è l\'unico che può farlo', { wallet: corto(atteso) }));
    dire('Controlla la rete nel wallet…'); await cambiaRete(i.rete);
    dire('Conferma nel wallet…');
    tx = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: da, to: i.escrow, data }] });
  } catch (e) { throw new Error(messaggioWallet(e)); }
  dire('Inviato: aspetto la conferma della rete…');
  for (let k = 0; k < 40; k++) {
    await aspetta(k < 6 ? 3000 : 8000);
    const s = await chiama('POST', '/api/crypto/escrow/stato', { codice, tx }).catch(() => null);
    if (s && s.custodia !== i.custodia) return { ...s, tx };
  }
  return { custodia: i.custodia, tx, lenta: true };
}
