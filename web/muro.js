// Il muro di attività: lo sfondo delle teste scure. Una parete di quadratini (come il muro dei contributi di GitHub, nel viola del
// marchio) che si accendono a onde lente, con qualche scintilla. Disegnato su canvas a 8 fotogrammi al secondo, solo quando si vede;
// fermo con «riduci movimento». Si mette con <canvas class="muro" data-muro aria-hidden="true"> dentro un contenitore position: relative.
// Per pesare poco: lo strato di fondo è disegnato una volta sola, ogni fotogramma ridisegna solo le celle accese, con tessere pronte.
const fermo = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PASSO = 18, CELLA = 13, RAGGIO = 3, FPS = 8;
const LIVELLI = ['rgba(141, 101, 255, .05)', 'rgba(141, 101, 255, .12)', 'rgba(141, 101, 255, .24)', 'rgba(141, 101, 255, .4)', 'rgba(176, 148, 255, .68)'];
const VERDE = 'rgba(74, 222, 128, .85)';

// rumore a valori su una griglia 64×64 (tiene poco e basta per onde morbide)
const N = 64, rete = new Float32Array(N * N);
let seme = 2463534242;
for (let i = 0; i < rete.length; i++) { seme ^= seme << 13; seme ^= seme >>> 17; seme ^= seme << 5; rete[i] = ((seme >>> 0) % 10000) / 10000; }
const liscia = t => t * t * (3 - 2 * t);
function rumore(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = liscia(x - x0), fy = liscia(y - y0);
  const v = (i, j) => rete[((j & (N - 1)) * N) + (i & (N - 1))];
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * fx, b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * fx;
  return a + (b - a) * fy;
}
// una tessera per livello, disegnata una volta
function tessera(colore, dpr) {
  const c = document.createElement('canvas'); c.width = c.height = Math.ceil(CELLA * dpr);
  const x = c.getContext('2d'); x.scale(dpr, dpr); x.fillStyle = colore; x.beginPath();
  if (x.roundRect) x.roundRect(0, 0, CELLA, CELLA, RAGGIO); else x.rect(0, 0, CELLA, CELLA);
  x.fill(); return c;
}

function muro(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const dpr = Math.min(devicePixelRatio || 1, 1.25);
  const tessere = LIVELLI.map(c => tessera(c, dpr)), verde = tessera(VERDE, dpr);
  let colonne = 0, righe = 0, fondo = null, scintille = [], timer = null, visibile = false, larg = 0, alt = 0, daCol = 0, daRiga = 0;
  const t0 = performance.now();
  function misura() {
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
    larg = r.width; alt = r.height;
    canvas.width = Math.round(larg * dpr); canvas.height = Math.round(alt * dpr);
    colonne = Math.ceil(larg / PASSO) + 1; righe = Math.ceil(alt / PASSO) + 1;
    // le celle sotto la parte trasparente della sfumatura (a sinistra sugli schermi larghi, in alto sui telefoni) non si calcolano
    daCol = larg > 1000 ? Math.floor(colonne * 0.3) : 0; daRiga = larg > 1000 ? 0 : Math.floor(righe * 0.25);
    // lo strato di fondo: tutte le celle spente, una volta sola
    fondo = document.createElement('canvas'); fondo.width = canvas.width; fondo.height = canvas.height;
    const f = fondo.getContext('2d');
    for (let j = 0; j < righe; j++) for (let i = 0; i < colonne; i++) f.drawImage(tessere[0], Math.round(i * PASSO * dpr), Math.round(j * PASSO * dpr));
    disegna();
  }
  function disegna() {
    const t = (performance.now() - t0) / 1000, ora = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fondo, 0, 0);
    scintille = scintille.filter(s => ora - s.da < 1800);
    for (let j = daRiga; j < righe; j++) for (let i = daCol; i < colonne; i++) {
      // due onde lente che scorrono in diagonale, sommate: la maggior parte delle celle resta spenta
      const v = rumore(i * 0.11 + t * 0.045, j * 0.11 + t * 0.03) * 0.65 + rumore(i * 0.05 - t * 0.02, j * 0.05 + t * 0.035) * 0.35;
      const l = v < 0.5 ? 0 : v < 0.59 ? 1 : v < 0.67 ? 2 : v < 0.75 ? 3 : 4;
      if (l) ctx.drawImage(tessere[l], Math.round(i * PASSO * dpr), Math.round(j * PASSO * dpr));
    }
    for (const s of scintille) {
      const k = (ora - s.da) / 1800;
      ctx.globalAlpha = Math.max(0, k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      ctx.drawImage(s.verde ? verde : tessere[4], Math.round(s.i * PASSO * dpr), Math.round(s.j * PASSO * dpr));
    }
    ctx.globalAlpha = 1;
  }
  function giro() {
    clearTimeout(timer); if (!visibile || fermo || !fondo) return;
    if (Math.random() < 0.4) scintille.push({ i: daCol + Math.floor(Math.random() * (colonne - daCol)), j: daRiga + Math.floor(Math.random() * (righe - daRiga)), da: performance.now(), verde: Math.random() < 0.3 });
    disegna(); timer = setTimeout(giro, 1000 / FPS);
  }
  new ResizeObserver(misura).observe(canvas);
  new IntersectionObserver(v => { visibile = v.some(x => x.isIntersecting); if (visibile) giro(); else clearTimeout(timer); }, { threshold: 0.05 }).observe(canvas);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else if (visibile) giro(); });
}
for (const c of document.querySelectorAll('canvas[data-muro]')) muro(c);
