// I blocchi di codice delle pagine per sviluppatori e builder: il bottone «Copia» su ogni <pre>, e l'indirizzo vero della
// piattaforma al posto di quello d'esempio (gli <span class="base"> dentro il codice).
import { $$, el, t, copia, pronta } from './comune.js';
await pronta;

for (const b of $$('.base')) b.textContent = location.origin;
for (const pre of $$('pre')) {
  let blocco = pre.closest('.blocco-codice');
  if (!blocco) {
    // le richieste e le risposte d'esempio portano la loro etichetta
    const x = pre.textContent.trim(), etichetta = /^curl\b/.test(x) ? 'Richiesta' : /^(\{|\[\s*\{)/.test(x) ? 'Risposta JSON' : null;
    blocco = el('div', { class: 'blocco-codice' }, etichetta ? el('div', { class: 'titolo-codice' }, el('span', {}, t(etichetta))) : null); pre.replaceWith(blocco); blocco.append(pre);
  }
  const bottone = el('button', { type: 'button', class: 'copia-codice', 'aria-label': t('Copia il codice') }, t('Copia'));
  bottone.addEventListener('click', () => copia(pre.innerText.replace(/\n$/, ''), bottone));
  const titolo = blocco.querySelector('.titolo-codice');
  if (titolo) { bottone.classList.add('in-titolo'); titolo.append(bottone); } else blocco.append(bottone);
}
