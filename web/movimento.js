// Il movimento al passaggio del mouse: la luce che segue il cursore sulle carte (.luce), il bottone principale che si fa attirare
// (.magnetico), le entrate a scaglioni (.appare). Niente di tutto questo per chi chiede meno movimento.
const meno = matchMedia('(prefers-reduced-motion: reduce)').matches, tocco = matchMedia('(hover: none)').matches;
if (!meno && !tocco) {
  addEventListener('pointermove', e => {
    const c = e.target.closest?.('.luce'); if (c) { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', `${e.clientX - r.left}px`); c.style.setProperty('--my', `${e.clientY - r.top}px`); }
    const m = e.target.closest?.('.magnetico'); if (m) { const r = m.getBoundingClientRect(); m.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * .18}px, ${(e.clientY - r.top - r.height / 2) * .28}px)`; }
  }, { passive: true });
  addEventListener('pointerout', e => { const m = e.target.closest?.('.magnetico'); if (m && !m.contains(e.relatedTarget)) m.style.transform = ''; }, { passive: true });
}
const vedi = new IntersectionObserver(l => { for (const x of l) if (x.isIntersecting) { x.target.classList.add('visibile'); vedi.unobserve(x.target); } }, { rootMargin: '0px 0px -8% 0px' });
const osserva = () => document.querySelectorAll('.appare:not(.visibile)').forEach((x, i) => { if (!x.style.getPropertyValue('--i')) x.style.setProperty('--i', String(i % 8)); vedi.observe(x); });
if (meno) document.querySelectorAll('.appare').forEach(x => x.classList.add('visibile')); else { osserva(); new MutationObserver(osserva).observe(document.body, { childList: true, subtree: true }); }
