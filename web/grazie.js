// Dopo il pagamento: con carta (?s=…, la sessione di Stripe) o in crypto (?crypto=1, la ricevuta è la transazione stessa).
import { $$, pronta } from './comune.js';
await pronta;
for (const i of $$('.figura img')) { const guarda = () => i.closest('.figura').classList.toggle('manca', !i.naturalWidth); i.addEventListener('load', guarda); i.addEventListener('error', guarda); if (i.complete) guarda(); }   // l'immagine 3D che manca: resta la cornice
const q = new URLSearchParams(location.search), cripto = q.has('crypto'), escrow = q.has('escrow');
for (const x of $$('.carta-testo')) x.classList.toggle('nascosto', cripto);
for (const x of $$('.crypto-testo')) x.classList.toggle('nascosto', !cripto);
for (const x of $$('.diretto-testo')) x.classList.toggle('nascosto', !cripto || escrow);
for (const x of $$('.escrow-testo')) x.classList.toggle('nascosto', !escrow);
