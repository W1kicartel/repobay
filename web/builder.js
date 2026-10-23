// La pagina per chi sviluppa: i blocchi di codice con «Copia» e l'ingresso con GitHub, che parte solo dopo aver accettato le
// condizioni (chi è già dentro va dritto alla sua area).
import { $, $$, t, chiama, pronta } from './comune.js';
import './muro.js';
import './codice.js';
import { figure, tondo } from './vetrina.js';
await pronta;
figure();
for (const b of $$('[data-cent]')) b.textContent = tondo(Number(b.dataset.cent));   // gli importi d'esempio nel formato della lingua

const accetto = $('#accetto'), entra = $('#entra-github'), nota = $('#nota-accetto');
const s = await chiama('GET', '/api/sessione').catch(() => ({ dentro: false }));
if (s.dentro) {
  accetto.closest('label').classList.add('nascosto'); $('.consenso .leggi')?.classList.add('nascosto'); nota.classList.add('nascosto');
  entra.href = '/area#prodotti'; entra.textContent = t('Vai ai tuoi prodotti'); entra.removeAttribute('aria-disabled');
  for (const a of document.querySelectorAll('a[href="#inizia"]')) { a.href = '/area#prodotti'; a.textContent = t('Vai ai tuoi prodotti'); }
} else {
  const aggiorna = () => { entra.setAttribute('aria-disabled', String(!accetto.checked)); nota.textContent = accetto.checked ? t('Ti portiamo su GitHub e torni qui.') : t('Spunta la casella per continuare.'); nota.classList.remove('errore-campo'); };
  accetto.addEventListener('change', aggiorna);
  entra.addEventListener('click', e => {
    if (accetto.checked) return;
    e.preventDefault(); nota.textContent = t('Per iscriverti accetta prima le condizioni e conferma di aver letto l\'informativa privacy.'); nota.classList.add('errore-campo'); accetto.focus();
  });
  aggiorna();
}
