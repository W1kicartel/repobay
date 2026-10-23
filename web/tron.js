// Il wallet Tron del browser (TronLink, che inietta window.tronLink e window.tronWeb: niente librerie da scaricare):
// collegarsi e mandare i pagamenti, uno per destinatario (Tron non ha i pagamenti multipli in una transazione).
// API: TronLink «tron_requestAccounts» (200 accettato, 4000 già in coda, 4001 rifiutato) e TronWeb trx.sendTransaction,
// transactionBuilder.triggerSmartContract, trx.sign, trx.sendRawTransaction (https://tronweb.network/docu/docs/intro/).
const link = () => window.tronLink;
const tw = () => window.tronLink?.tronWeb || window.tronWeb;
export const ceTron = () => !!(link() || window.tronWeb);

export async function collegaTron() {
  if (!ceTron()) throw new Error('Nessun wallet Tron nel browser: installa TronLink, oppure apri questa pagina dal browser di TronLink sul telefono.');
  if (link()?.request) {
    const r = await link().request({ method: 'tron_requestAccounts' });
    if (r?.code === 4001) throw new Error('Hai rifiutato il collegamento in TronLink');
    if (r?.code === 4000) throw new Error('TronLink ha già una richiesta aperta: controlla la finestra del wallet');
  }
  const indirizzo = tw()?.defaultAddress?.base58;
  if (!indirizzo) throw new Error('Sblocca TronLink e riprova');
  return { indirizzo };
}

// la rete di TronLink deve essere quella dell'ordine (rete: 'tron' | 'tron-nile' o l'oggetto della rete, facoltativa)
function controllaRete(rete) {
  if (!rete) return;
  const prova = typeof rete === 'string' ? rete !== 'tron' : !!rete.prova, host = String(tw()?.fullNode?.host || '');
  if (!host) return;
  if (prova && !/nile/i.test(host)) throw new Error('In TronLink scegli la rete di prova Nile e riprova');
  if (!prova && /nile|shasta/i.test(host)) throw new Error('In TronLink scegli la rete principale (Mainnet) e riprova');
}

// → i txid, in sequenza: TRX con trx.sendTransaction; USDT con transfer(address,uint256) sul contratto, firmato e poi inviato.
// Un destinatario con più parti (il builder che installa da sé) riceve una volta sola, la somma.
export async function pagaTron({ m, parti, avviso = () => {}, rete, feeLimit = 100_000_000, memo = '' }) {
  const w = tw(), da = w?.defaultAddress?.base58;
  if (!da) throw new Error('Collega TronLink e riprova');
  controllaRete(rete);
  const per = new Map();
  for (const p of parti) per.set(p.indirizzo, (per.get(p.indirizzo) || 0n) + BigInt(p.unita));
  const lista = [...per].filter(([, u]) => u > 0n), txid = [];
  for (const [i, [a, u]] of lista.entries()) {
    avviso(`Conferma ${i + 1} di ${lista.length} in TronLink…`);
    let tx;
    if (!m.indirizzo) {
      if (u > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Importo troppo grande');
      tx = await w.transactionBuilder.sendTrx(a, Number(u), da);   // in sun (1 TRX = 1.000.000 sun)
    } else {
      const { result, transaction } = await w.transactionBuilder.triggerSmartContract(m.indirizzo, 'transfer(address,uint256)', { feeLimit, callValue: 0 },
        [{ type: 'address', value: a }, { type: 'uint256', value: u.toString() }], da) || {};
      if (!result?.result || !transaction) throw new Error('TronLink non è riuscito a preparare il trasferimento');
      tx = transaction;
    }
    // il memo con l'etichetta dell'ordine: lega il pagamento a questo ordine
    if (memo) tx = await w.transactionBuilder.addUpdateData(tx, memo, 'utf8');
    const r = await w.trx.sendRawTransaction(await w.trx.sign(tx));
    const id = r?.txid || r?.transaction?.txID;
    if (!r?.result || !id) throw new Error(`Il pagamento ${i + 1} non è partito${r?.code ? ` (${r.code})` : ''}`);
    txid.push(id);
  }
  return txid;
}

// la prova di possesso: TronLink firma il messaggio (signMessageV2, «\x19TRON Signed Message:\n») → la firma esadecimale
export async function firmaTron(testo) {
  await collegaTron();
  const tw = window.tronWeb;
  if (typeof tw?.trx?.signMessageV2 !== 'function') throw new Error('Aggiorna TronLink: serve la firma dei messaggi');
  return tw.trx.signMessageV2(testo);
}

