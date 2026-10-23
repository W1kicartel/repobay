// Il wallet del browser (EIP-1193: MetaMask, Rabby, Coinbase Wallet, il browser interno dei wallet sul telefono):
// collegarsi, cambiare rete, firmare un messaggio, mandare i pagamenti (in una sola conferma con EIP-5792, se il wallet la
// supporta; altrimenti uno alla volta).
const eth = () => window.ethereum;
export const ceWallet = () => !!eth();
const hex = s => '0x' + [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function account() {
  if (!eth()) throw new Error('Nessun wallet nel browser: installa MetaMask, Rabby o Coinbase Wallet, oppure apri questa pagina dal browser del tuo wallet sul telefono.');
  const [a] = await eth().request({ method: 'eth_requestAccounts' }); return a;
}
export const firma = (messaggio, indirizzo) => eth().request({ method: 'personal_sign', params: [hex(messaggio), indirizzo] });

export async function rete(r) {
  try { await eth().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: r.chainId }] }); }
  catch (e) {
    if (e.code !== 4902) throw e;   // la rete non è nel wallet: si aggiunge
    const simbolo = r.id === 'polygon' ? 'POL' : 'ETH';
    await eth().request({ method: 'wallet_addEthereumChain', params: [{ chainId: r.chainId, chainName: r.nome, rpcUrls: [r.rpc], blockExplorerUrls: [r.esploratore], nativeCurrency: { name: simbolo, symbol: simbolo, decimals: 18 } }] });
  }
}

const aspetta = ms => new Promise(r => setTimeout(r, ms));

// le autorizzazioni (approve) prima di un deposito: se ne resta una vecchia che basta, si salta; se ne resta una che non basta, prima
// la si azzera, perché USDT su Ethereum rifiuta di cambiare un'autorizzazione che non è zero
const APPROVE = '0x095ea7b3', ALLOWANCE = '0xdd62ed3e', parola = a => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
async function autorizzazioni(da, chiamate) {
  const fuori = [];
  for (const c of chiamate) {
    if (!c.data?.startsWith(APPROVE) || c.data.length !== 138) { fuori.push(c); continue; }
    const spender = '0x' + c.data.slice(34, 74), importo = BigInt('0x' + c.data.slice(74));
    let ora = 0n;
    try { ora = BigInt(await eth().request({ method: 'eth_call', params: [{ to: c.to, data: ALLOWANCE + parola(da) + parola(spender) }, 'latest'] })); } catch { }
    if (ora >= importo) continue;
    if (ora > 0n) fuori.push({ ...c, data: APPROVE + parola(spender) + parola('0') });
    fuori.push(c);
  }
  return fuori;
}
// una transazione mandata uno alla volta: si aspetta che la rete la registri (il deposito dopo l'approve, altrimenti il wallet
// lo stima prima che l'autorizzazione esista e lo dà per fallito)
async function registrata(hash) {
  for (let i = 0; i < 100; i++) {
    const r = await eth().request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null);
    if (r) { if (r.status !== '0x1') throw new Error('L\'autorizzazione è fallita: riprova'); return; }
    await aspetta(3000);
  }
  throw new Error('La rete non ha ancora registrato l\'autorizzazione: riprova fra poco');
}

// → gli hash delle transazioni. Per i token prova la conferma unica (EIP-5792); per la moneta della rete, un invio per destinatario
export async function paga(da, chainId, chiamate, nativo, avviso = () => {}) {
  if (!nativo) chiamate = await autorizzazioni(da, chiamate);
  if (!nativo) {
    try {
      const r = await eth().request({ method: 'wallet_sendCalls', params: [{ version: '2.0.0', chainId, from: da, atomicRequired: true, calls: chiamate }] });
      const id = typeof r === 'string' ? r : r.id;
      avviso('Pagamento inviato: aspetto la conferma della rete…');
      for (let i = 0; i < 120; i++) {
        const s = await eth().request({ method: 'wallet_getCallsStatus', params: [id] });
        if ((s.status === 200 || s.status === 'CONFIRMED') && s.receipts?.length) return s.receipts.map(x => x.transactionHash);
        if (s.status >= 400) throw new Error('Il pagamento non è andato a buon fine');
        await aspetta(3000);
      }
      throw new Error('Il wallet non ha confermato in tempo');
    } catch (e) {
      if (![4200, -32601, -32602, 5700].includes(e.code)) throw e;   // il wallet non supporta la conferma unica: si va uno alla volta
    }
  }
  const hash = [];
  for (const [i, c] of chiamate.entries()) {
    avviso(`Conferma ${i + 1} di ${chiamate.length} nel wallet…`);
    hash.push(await eth().request({ method: 'eth_sendTransaction', params: [{ from: da, to: c.to, value: c.value, data: c.data }] }));
    if (c.data?.startsWith(APPROVE) && i < chiamate.length - 1) { avviso('Aspetto che la rete registri l\'autorizzazione…'); await registrata(hash.at(-1)); }
  }
  return hash;
}

// unità del token → testo leggibile (es. 518000000 con 6 decimali → «518,00»)
export function formatta(unita, decimali, cifre = 6) {
  const u = BigInt(unita), d = 10n ** BigInt(decimali), intero = u / d, resto = (u % d).toString().padStart(decimali, '0').slice(0, cifre).replace(/0+$/, '');
  return `${intero.toLocaleString('it-IT')}${resto ? ',' + resto : ''}`;
}
