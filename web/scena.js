// La scena del prodotto nell'eroe della home: quattro quadri in sequenza (il repository pubblicato, l'installatrice che lo propone,
// il terminale che installa, il negozio che lavora con il pagamento diviso). Avanza da sola finché la si vede; un clic sui punti
// la porta al quadro scelto e la ferma per un po'. Con «riduci movimento» mostra solo l'ultimo quadro.
const scena = document.getElementById('scena'), punti = document.querySelector('.sc-punti');
if (scena && punti) {
  const DURATE = { 1: 3000, 2: 3400, 3: 4600, 4: 5200 };
  const fermo = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let passo = 1, timer = null, visibile = false, pausaFino = 0;
  const mostra = n => {
    passo = n; scena.dataset.passo = String(n);
    for (const b of punti.querySelectorAll('button')) { b.setAttribute('aria-pressed', String(Number(b.dataset.scena) === n)); b.style.setProperty('--t', `${DURATE[n]}ms`); }
    punti.classList.remove('gira'); void punti.offsetWidth; if (!fermo) punti.classList.add('gira');
  };
  const prossimo = () => { clearTimeout(timer); if (!visibile || fermo) return; timer = setTimeout(() => { if (Date.now() < pausaFino) return prossimo(); mostra(passo % 4 + 1); prossimo(); }, DURATE[passo]); };
  for (const b of punti.querySelectorAll('button')) b.addEventListener('click', () => { pausaFino = Date.now() + 12000; mostra(Number(b.dataset.scena)); prossimo(); });
  if (fermo) { mostra(4); punti.classList.remove('gira'); }
  else new IntersectionObserver(v => { visibile = v.some(x => x.isIntersecting); if (visibile) { mostra(passo); prossimo(); } else clearTimeout(timer); }, { threshold: 0.3 }).observe(scena);
}
