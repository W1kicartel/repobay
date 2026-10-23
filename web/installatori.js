// La pagina per chi installa: gli importi d'esempio nel formato della lingua scelta, l'indirizzo vero nel link d'esempio.
import { $$, pronta } from './comune.js';
import './muro.js';
import './codice.js';
import { figure, tondo } from './vetrina.js';
await pronta;
figure();
for (const b of $$('[data-cent]')) b.textContent = tondo(Number(b.dataset.cent));
