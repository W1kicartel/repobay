// Il README di GitHub sulla pagina del prodotto: un sottoinsieme di Markdown/GFM tradotto in HTML sicuro, da inserire con
// innerHTML sotto CSP. L'HTML grezzo del README non passa mai (diventa testo); i link solo http, https, mailto o #ancora, le
// immagini solo https; i percorsi relativi puntano al repository su GitHub. Gli unici attributi scritti sono quelli fissi qui
// sotto (mai style né on*). Niente regex con ripetizioni annidate: blocchi riga per riga, testo in linea con una sola passata
// e la pila dei delimitatori di CommonMark (con i limiti «openers_bottom»), così anche un README patologico resta lineare.

const MASSIMO = 300_000, PROFONDITA = 12, MAXURL = 2048, MAXTITOLO = 1000, COLONNE = 64, CELLE = 20_000;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PUNT_ASCII = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
const ESTERNO = ' target="_blank" rel="nofollow ugc noopener noreferrer"';

// ── entità e scappatoie (nel testo e nelle destinazioni dei link) ──
const NOMI = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—',
  ndash: '–', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', euro: '€', pound: '£', yen: '¥', cent: '¢', middot: '·',
  times: '×', divide: '÷', deg: '°', plusmn: '±', para: '¶', sect: '§', bull: '•', rarr: '→', larr: '←', uarr: '↑', darr: '↓', harr: '↔',
  check: '✓', star: '☆', hearts: '♥', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', zwj: '\u200d', zwnj: '\u200c' };
const cifra = (c, esa) => (c >= 48 && c <= 57) || (esa && ((c >= 65 && c <= 70) || (c >= 97 && c <= 102)));
function entita(s, i) {   // s[i] è «&» → [carattere, indice dopo il «;»] o null
  let j = i + 1;
  if (s[j] === '#') {
    j++; const esa = s[j] === 'x' || s[j] === 'X'; if (esa) j++;
    const k = j; while (j - k < (esa ? 6 : 7) && cifra(s.charCodeAt(j), esa)) j++;
    if (j === k || s[j] !== ';') return null;
    let cp = parseInt(s.slice(k, j), esa ? 16 : 10);
    if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) cp = 0xfffd;
    return [String.fromCodePoint(cp), j + 1];
  }
  const k = j; while (j - k < 32 && /[A-Za-z0-9]/.test(s[j] || '')) j++;
  if (j === k || s[j] !== ';' || !Object.hasOwn(NOMI, s.slice(k, j))) return null;
  return [NOMI[s.slice(k, j)], j + 1];
}
function decodifica(s) {
  if (!s.includes('\\') && !s.includes('&')) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && PUNT_ASCII.has(s[i + 1])) out += s[++i];
    else if (c === '&') { const e = entita(s, i); if (e) { out += e[0]; i = e[1] - 1; } else out += c; }
    else out += c;
  }
  return out;
}
const norma = l => l.trim().replace(/\s+/g, ' ').toLowerCase();   // le etichette dei link di riferimento

// ── indirizzi: solo quelli ammessi, i relativi portati sul repository ──
function relativo(rel, base) {
  let coda = '';
  const h = rel.search(/[?#]/); if (h >= 0) { coda = rel.slice(h); rel = rel.slice(0, h); }
  const parti = [];
  for (const p of rel.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') { parti.pop(); continue; }
    let d = p; try { d = decodeURIComponent(p); } catch {}
    parti.push(encodeURIComponent(d));
  }
  try { coda = encodeURI(coda); } catch { coda = ''; }
  return base + parti.join('/') + coda;
}
const frammento = f => { let d = f; try { d = decodeURIComponent(f); } catch {} return encodeURIComponent(d); };
const SCHEMA = /^([A-Za-z][A-Za-z0-9+.-]{0,31}):/;
function urlLink(href, ctx) {   // → { href, esterno } o null (allora si mostra solo il testo)
  href = href.trim();
  if (!href || /[\x00-\x1f\x7f]/.test(href)) return null;
  if (href[0] === '#') return { href: '#readme-' + frammento(href.slice(1)), esterno: false };
  const s = SCHEMA.exec(href);
  if (s) {
    const p = s[1].toLowerCase(); if (p !== 'http' && p !== 'https' && p !== 'mailto') return null;
    let u; try { u = new URL(href); } catch { return null; }
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return null;
    return { href: u.href, esterno: u.protocol !== 'mailto:' };
  }
  if (!ctx.repo || href.startsWith('//') || href.includes('\\')) return null;
  return { href: relativo(href, `https://github.com/${ctx.repo}/blob/${ctx.ramo}/`), esterno: true };
}
function urlImmagine(src, ctx) {   // solo https; le relative dal contenuto grezzo del repository
  src = src.trim();
  if (!src || /[\x00-\x1f\x7f]/.test(src) || src[0] === '#') return null;
  const s = SCHEMA.exec(src);
  if (s) {
    if (s[1].toLowerCase() !== 'https') return null;
    let u; try { u = new URL(src); } catch { return null; }
    if (u.protocol !== 'https:') return null;
    if (ctx.host && u.host === ctx.host) return null;   // mai la piattaforma stessa: sarebbero richieste coi biscotti di chi guarda
    // https://github.com/o/r/blob/ramo/x.png è una pagina: la stessa immagine grezza sta su raw.githubusercontent.com
    if (u.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/blob\//.test(u.pathname)) return 'https://raw.githubusercontent.com' + u.pathname.replace('/blob/', '/');
    return u.href;
  }
  if (!ctx.repo || src.startsWith('//') || src.includes('\\')) return null;
  return relativo(src, `https://raw.githubusercontent.com/${ctx.repo}/${ctx.ramo}/`);
}

// la destinazione di un link da s[i]: «<…>» o senza spazi con parentesi bilanciate, poi un titolo facoltativo.
// → { href, titolo, fine } o null. Lunghezze limitate: ogni tentativo costa al massimo MAXURL + MAXTITOLO caratteri.
function destinazione(s, i) {
  const n = s.length;
  const spazi = () => { let a = 0; while (i < n && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) { if (s[i] === '\n' && ++a > 1) return false; i++; } return true; };
  if (!spazi()) return null;
  let href; const da = i;
  if (s[i] === '<') {
    let j = i + 1;
    while (j < n && s[j] !== '>' && s[j] !== '<' && s[j] !== '\n' && j - da < MAXURL) j += s[j] === '\\' ? 2 : 1;
    if (s[j] !== '>') return null;
    href = s.slice(i + 1, j); i = j + 1;
  } else {
    let j = i, prof = 0;
    for (; j < n && j - da < MAXURL; j++) {
      const c = s[j];
      if (c === '\\' && PUNT_ASCII.has(s[j + 1])) { j++; continue; }
      if (c === '(') { if (++prof > 32) return null; } else if (c === ')') { if (!prof) break; prof--; } else if (c <= ' ' || c === '\x7f') break;
    }
    if (prof || j - da >= MAXURL) return null;
    href = s.slice(i, j); i = j;
  }
  const prima = i; if (!spazi()) return null;
  let titolo = null;
  const ch = s[i], chiude = ch === '"' ? '"' : ch === "'" ? "'" : ch === '(' ? ')' : null;
  if (chiude && i > prima) {
    let j = i + 1;
    while (j < n && s[j] !== chiude && j - i < MAXTITOLO) { if (s[j] === '\\') j++; else if (chiude === ')' && s[j] === '(') return null; j++; }
    if (s[j] !== chiude) return null;
    titolo = decodifica(s.slice(i + 1, j)); i = j + 1; spazi();
  }
  return { href: decodifica(href), titolo, fine: i };
}

// ── testo in linea ──
const SPECIALI = new Uint8Array(128); for (const c of '\\`*_~![]<&\nhw') SPECIALI[c.charCodeAt(0)] = 1;
const SPAZIO = /\s/, PUNT = /[\p{P}\p{S}]/u;
const genere = ch => ch === undefined || SPAZIO.test(ch) ? 0 : PUNT.test(ch) ? 1 : 2;   // 0 spazio, 1 punteggiatura, 2 altro
const prima_auto = ch => ch === undefined || ch === '*' || ch === '_' || ch === '~' || ch === '(' || SPAZIO.test(ch);

// → il primo nodo di una lista doppia: testo | codice | br | el (em, strong, del) | link | img | auto
function enLinea(src, ctx) {
  const testa = { t: 'testa', next: null }; let coda = testa, buf = '', delim = null, quante = 0;
  const metti = x => { x.prev = coda; x.next = null; coda.next = x; coda = x; return x; };
  const svuota = () => { if (buf) { metti({ t: 'testo', v: buf }); buf = ''; } };
  const togliNodo = x => { x.prev.next = x.next; if (x.next) x.next.prev = x.prev; else coda = x.prev; };
  const togliDelim = d => { if (d.prev) d.prev.next = d.next; if (d.next) d.next.prev = d.prev; if (d === delim) delim = d.prev; };
  const parentesi = [];
  // le sequenze di backtick, per trovare la chiusura di un codice in tempo costante (un puntatore per lunghezza, solo in avanti)
  const sequenze = new Map(), puntatori = new Map();
  if (src.includes('`')) for (let i = 0; i < src.length;) {
    if (src[i] !== '`') { i++; continue; }
    let j = i; while (src[j] === '`') j++;
    const k = j - i; if (!sequenze.has(k)) sequenze.set(k, []); sequenze.get(k).push(i); i = j;
  }
  const chiusuraCodice = (da, k) => {
    const l = sequenze.get(k) || []; let p = puntatori.get(k) || 0;
    while (p < l.length && l[p] < da) p++;
    puntatori.set(k, p); return p < l.length ? l[p] : -1;
  };

  // l'enfasi alla CommonMark: abbina i delimitatori sopra «fondo», dal basso verso l'alto
  function emfasi(fondo) {
    const minimi = new Map();
    let ch = delim; if (ch === fondo) ch = null; else while (ch && ch.prev && ch.prev !== fondo) ch = ch.prev;
    while (ch) {
      if (!ch.chiude) { ch = ch.next; continue; }
      const chiave = ch.car + (ch.apre ? 1 : 0) + (ch.orig % 3), limite = minimi.has(chiave) ? minimi.get(chiave) : fondo;
      let ap = ch.prev, trovato = false;
      while (ap && ap !== fondo && ap !== limite) {
        if (ap.car === ch.car && ap.apre && (ch.car === '~' ? ap.n === ch.n
          : !((ap.chiude || ch.apre) && (ap.orig + ch.orig) % 3 === 0 && !(ap.orig % 3 === 0 && ch.orig % 3 === 0)))) { trovato = true; break; }
        ap = ap.prev;
      }
      if (!trovato) {
        minimi.set(chiave, ch.prev);
        const dopo = ch.next; if (!ch.apre) togliDelim(ch); ch = dopo; continue;
      }
      const usa = ch.car === '~' ? ch.n : ch.n >= 2 && ap.n >= 2 ? 2 : 1;
      const el = { t: 'el', tag: ch.car === '~' ? 'del' : usa === 2 ? 'strong' : 'em', primo: null };
      ap.n -= usa; ch.n -= usa; ap.nodo.v = ap.nodo.v.slice(0, ap.n); ch.nodo.v = ch.nodo.v.slice(0, ch.n);
      const primo = ap.nodo.next;
      if (primo !== ch.nodo) { el.primo = primo; primo.prev = null; ch.nodo.prev.next = null; }
      el.prev = ap.nodo; ap.nodo.next = el; el.next = ch.nodo; ch.nodo.prev = el;
      ap.next = ch; ch.prev = ap;   // i delimitatori in mezzo restano testo
      if (!ap.n) { togliNodo(ap.nodo); togliDelim(ap); }
      if (!ch.n) { togliNodo(ch.nodo); const dopo = ch.next; togliDelim(ch); ch = dopo; }
    }
    while (delim && delim !== fondo) togliDelim(delim);
  }

  const n = src.length; let i = 0;
  while (i < n) {
    const cc = src.charCodeAt(i);
    if (cc >= 128 || !SPECIALI[cc]) { let j = i + 1; while (j < n) { const x = src.charCodeAt(j); if (x < 128 && SPECIALI[x]) break; j++; } buf += src.slice(i, j); i = j; continue; }
    const c = src[i];
    if (c === '\\') {
      if (src[i + 1] === '\n') { svuota(); metti({ t: 'br' }); i += 2; }
      else if (PUNT_ASCII.has(src[i + 1])) { buf += src[i + 1]; i += 2; }
      else { buf += c; i++; }
    } else if (c === '`') {
      let j = i; while (src[j] === '`') j++;
      const k = j - i, q = chiusuraCodice(j, k);
      if (q < 0) { buf += src.slice(i, j); i = j; continue; }
      let v = src.slice(j, q).replace(/\n/g, ' ');
      if (v.length > 1 && v[0] === ' ' && v.at(-1) === ' ' && v.trim()) v = v.slice(1, -1);
      svuota(); metti({ t: 'codice', v }); i = q + k;
    } else if (c === '*' || c === '_' || c === '~') {
      let j = i; while (src[j] === c) j++;
      const k = j - i;
      if (c === '~' && k > 2) { buf += src.slice(i, j); i = j; continue; }
      const pr = genere(src[i - 1]), dp = genere(src[j]);
      const sx = dp !== 0 && (dp !== 1 || pr !== 2), dx = pr !== 0 && (pr !== 1 || dp !== 2);
      const apre = c === '_' ? sx && (!dx || pr === 1) : sx, chiude = c === '_' ? dx && (!sx || dp === 1) : dx;
      svuota(); const nodo = metti({ t: 'testo', v: src.slice(i, j) });
      if (apre || chiude) { const d = { nodo, car: c, n: k, orig: k, apre, chiude, prev: delim, next: null }; if (delim) delim.next = d; delim = d; }
      i = j;
    } else if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const img = c === '!'; svuota(); quante++;
      parentesi.push({ nodo: metti({ t: 'testo', v: img ? '![' : '[' }), img, attivo: true, sotto: delim, inizio: i + (img ? 2 : 1), quante });
      i += img ? 2 : 1;
    } else if (c === ']') {
      quante++;
      const ap = parentesi.pop();
      if (!ap || !ap.attivo) { buf += ']'; i++; continue; }
      let ris = null; const j = i + 1;
      if (src[j] === '(') { const d = destinazione(src, j + 1); if (d && src[d.fine] === ')') ris = { href: d.href, titolo: d.titolo, fine: d.fine + 1 }; }
      if (!ris && ctx.refs.size) {
        // [testo][etichetta], [testo][] o [testo]: l'etichetta non può contenere parentesi quadre né superare 999 caratteri
        const proprio = ap.quante + 1 === quante && i - ap.inizio <= 999 ? src.slice(ap.inizio, i) : null;
        let etichetta = proprio, fine = j;
        if (src[j] === '[') {
          let k = j + 1; while (k < n && src[k] !== ']' && src[k] !== '[' && k - j <= 1000) k += src[k] === '\\' ? 2 : 1;
          if (src[k] === ']') { const e = src.slice(j + 1, k); etichetta = e.trim() ? e : proprio; fine = k + 1; } else etichetta = null;
        }
        const r = etichetta != null && ctx.refs.get(norma(etichetta));
        if (r) ris = { href: r.href, titolo: r.titolo, fine };
      }
      if (!ris) { buf += ']'; i++; continue; }
      svuota(); emfasi(ap.sotto);
      const el = ap.img ? { t: 'img', src: urlImmagine(ris.href, ctx), titolo: ris.titolo } : { t: 'link', ...(urlLink(ris.href, ctx) || { href: null }), titolo: ris.titolo };
      el.primo = ap.nodo.next; if (el.primo) el.primo.prev = null;
      el.prev = ap.nodo.prev; ap.nodo.prev.next = el; el.next = null; coda = el;
      if (!ap.img) for (const p of parentesi) if (!p.img) p.attivo = false;   // niente link dentro i link
      i = ris.fine;
    } else if (c === '<') {
      // autolink <https://…>, <mailto:…> o <nome@dominio>; tutto il resto è testo (anche l'HTML)
      let j = i + 1; while (j < n && j - i <= MAXURL && src[j] > ' ' && src[j] !== '<' && src[j] !== '>') j++;
      const v = src[j] === '>' ? src.slice(i + 1, j) : '';
      const href = !v ? null : SCHEMA.test(v) ? urlLink(v, ctx)?.href : /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(v) ? urlLink('mailto:' + v, ctx)?.href : null;
      if (!href) { buf += '<'; i++; continue; }
      svuota(); metti({ t: 'auto', href, v }); i = j + 1;
    } else if (c === '&') {
      const e = entita(src, i); if (e) { buf += e[0]; i = e[1]; } else { buf += '&'; i++; }
    } else if (c === '\n') {
      // gli spazi finali si contano su src (piatta): leggere buf, una stringa composta, la appiattirebbe a ogni riga
      let k = i; while (k > 0 && src[k - 1] === ' ') k--;
      const tolti = Math.min(i - k, buf.length); buf = buf.slice(0, buf.length - tolti);
      if (i - k >= 2) { svuota(); metti({ t: 'br' }); } else { buf += '\n'; svuota(); }
      i++;
    } else if ((c === 'h' || c === 'w') && prima_auto(src[i - 1]) && (src.startsWith('https://', i) || src.startsWith('http://', i) || src.startsWith('www.', i))) {
      // autolink GFM esteso: fino al primo spazio o «<», senza la punteggiatura finale e le «)» in più
      let j = i; while (j < n && src[j] > ' ' && src[j] !== '<') j++;
      let v = src.slice(i, j), aperte = 0, chiuse = 0;
      for (const x of v) { if (x === '(') aperte++; else if (x === ')') chiuse++; }
      for (;;) {
        const u = v.at(-1);
        if ('?!.,:*_~\'"'.includes(u)) v = v.slice(0, -1);
        else if (u === ')' && chiuse > aperte) { v = v.slice(0, -1); chiuse--; }
        else break;
      }
      const r = v.length > (c === 'w' ? 4 : 8) && urlLink(c === 'w' ? 'http://' + v : v, ctx);
      if (!r || !r.esterno) { buf += c; i++; continue; }
      svuota(); metti({ t: 'auto', href: r.href, v }); i += v.length;
    } else { buf += c; i++; }
  }
  svuota(); emfasi(null);
  return testa.next;
}

// il testo semplice dei nodi (per alt e id dei titoli), senza ricorsione
function testoDi(primo) {
  let s = '', x = primo; const pila = [];
  while (x || pila.length) {
    if (!x) { x = pila.pop(); continue; }
    if (x.t === 'testo' || x.t === 'codice' || x.t === 'auto') s += x.v;
    else if (x.t === 'br') s += ' ';
    else if (x.primo) { pila.push(x.next); x = x.primo; continue; }
    x = x.next;
  }
  return s;
}
// l'HTML dei nodi, senza ricorsione (l'enfasi annidata può essere profonda)
function rendi(primo) {
  let out = '', x = primo, dentro = 0; const pila = [];
  while (x || pila.length) {
    if (!x) { const p = pila.pop(); out += p.chiudi; dentro -= p.link; x = p.dopo; continue; }
    switch (x.t) {
      case 'testo': out += esc(x.v); break;
      case 'codice': out += `<code>${esc(x.v)}</code>`; break;
      case 'br': out += '<br>\n'; break;
      case 'auto': out += dentro ? esc(x.v) : `<a href="${esc(x.href)}"${x.href.startsWith('mailto:') ? '' : ESTERNO}>${esc(x.v)}</a>`; break;
      case 'img': out += x.src ? `<img src="${esc(x.src)}" alt="${esc(testoDi(x.primo))}"${x.titolo ? ` title="${esc(x.titolo)}"` : ''} loading="lazy">` : esc(testoDi(x.primo)); break;
      case 'el': out += `<${x.tag}>`; pila.push({ chiudi: `</${x.tag}>`, dopo: x.next, link: 0 }); x = x.primo; continue;
      case 'link': {
        const a = x.href && !dentro;
        if (a) out += `<a href="${esc(x.href)}"${x.titolo ? ` title="${esc(x.titolo)}"` : ''}${x.esterno ? ESTERNO : ''}>`;
        pila.push({ chiudi: a ? '</a>' : '', dopo: x.next, link: a ? 1 : 0 }); dentro += a ? 1 : 0; x = x.primo; continue;
      }
    }
    x = x.next;
  }
  return out;
}
const linea = (s, ctx) => rendi(enLinea(s, ctx));

// ── blocchi, riga per riga ──
const rientro = l => { let i = 0; while (l.charCodeAt(i) === 32) i++; return i; };
const vuota = l => !l.trim();
function espandi(l) {   // le tabulazioni a inizio riga diventano spazi (tabulazione ogni 4 colonne)
  if (!l.includes('\t')) return l;
  let out = '', i = 0;
  for (; i < l.length; i++) { if (l[i] === '\t') out += ' '.repeat(4 - (out.length % 4)); else if (l[i] === ' ') out += ' '; else break; }
  return out + l.slice(i);
}
function recinto(l) {
  const ind = rientro(l); if (ind > 3) return null;
  const c = l[ind]; if (c !== '`' && c !== '~') return null;
  let j = ind; while (l[j] === c) j++;
  if (j - ind < 3) return null;
  const info = l.slice(j).trim(); if (c === '`' && info.includes('`')) return null;
  return { car: c, n: j - ind, ind, info };
}
const chiudeRecinto = (l, r) => { const ind = rientro(l); if (ind > 3) return false; let j = ind; while (l[j] === r.car) j++; return j - ind >= r.n && vuota(l.slice(j)); };
function titoloAtx(l) {
  const ind = rientro(l); if (ind > 3) return null;
  let j = ind; while (l[j] === '#' && j - ind < 7) j++;
  const liv = j - ind; if (liv < 1 || liv > 6 || (j < l.length && l[j] !== ' ' && l[j] !== '\t')) return null;
  let t = l.slice(j).trim(), k = t.length; while (k > 0 && t[k - 1] === '#') k--;
  if (k === 0) t = ''; else if (k < t.length && (t[k - 1] === ' ' || t[k - 1] === '\t')) t = t.slice(0, k).trim();
  return { liv, testo: t };
}
function riga_hr(l) {
  const ind = rientro(l); if (ind > 3) return false;
  const c = l[ind]; if (c !== '*' && c !== '-' && c !== '_') return false;
  let n = 0; for (let i = ind; i < l.length; i++) { if (l[i] === c) n++; else if (l[i] !== ' ' && l[i] !== '\t') return false; }
  return n >= 3;
}
function setext(l) {
  const ind = rientro(l); if (ind > 3) return 0;
  const c = l[ind]; if (c !== '=' && c !== '-') return 0;
  let i = ind; while (l[i] === c) i++;
  return vuota(l.slice(i)) ? (c === '=' ? 1 : 2) : 0;
}
function citazione(l) { const ind = rientro(l); if (ind > 3 || l[ind] !== '>') return null; const r = l.slice(ind + 1); return r[0] === ' ' || r[0] === '\t' ? r.slice(1) : r; }
function marcatore(l) {
  const ind = rientro(l); if (ind > 3) return null;
  let j = ind, ord = false, num = 1, car = l[j];
  if (car === '-' || car === '+' || car === '*') j++;
  else {
    while (j - ind < 9 && l[j] >= '0' && l[j] <= '9') j++;
    if (j === ind || (l[j] !== '.' && l[j] !== ')')) return null;
    ord = true; num = Number(l.slice(ind, j)); car = l[j]; j++;
  }
  if (j < l.length && l[j] !== ' ' && l[j] !== '\t') return null;
  let k = j; while (k < l.length && (l[k] === ' ' || l[k] === '\t') && k - j < 5) k++;
  const vuoto = vuota(l.slice(j)), off = vuoto || k - j >= 5 ? j + 1 : k;
  return { ord, num, car, off, vuoto, contenuto: vuoto ? '' : l.slice(off) };
}
function interrompe(l) {   // le righe che chiudono un paragrafo
  if (recinto(l) || titoloAtx(l) || riga_hr(l) || citazione(l) !== null) return true;
  const m = marcatore(l); return !!m && !m.vuoto && (!m.ord || m.num === 1);
}
function celle(l) {   // una riga di tabella, divisa sulle «|» non precedute da «\»
  let s = l.trim(); if (s[0] === '|') s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out = []; let da = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += s.slice(da, i) + '|'; da = i + 2; i++; }
    else if (s[i] === '|') { out.push((cur + s.slice(da, i)).trim()); cur = ''; da = i + 1; if (out.length > COLONNE) return out; }
  }
  out.push((cur + s.slice(da)).trim()); return out;
}
function inizioTabella(righe, i) {   // la riga i è l'intestazione e la i+1 il separatore? → allineamenti o null
  const sep = righe[i + 1];
  if (sep === undefined || !righe[i].includes('|') || !sep.includes('|') || !sep.includes('-') || rientro(sep) > 3) return null;
  const al = [];
  for (const c of celle(sep)) {
    let a = 0, b = c.length; if (c[0] === ':') a++; if (c.at(-1) === ':' && b > a) b--;
    if (b <= a) return null; for (let k = a; k < b; k++) if (c[k] !== '-') return null;
    al.push(c[0] === ':' && c.at(-1) === ':' ? 'center' : c.at(-1) === ':' ? 'right' : c[0] === ':' ? 'left' : '');
  }
  return al.length <= COLONNE && celle(righe[i]).length === al.length ? al : null;
}
function definizione(s, refs) {   // [etichetta]: destinazione "titolo" — su una riga sola
  let i = 1;
  while (i < s.length && i < 1000 && s[i] !== ']') { if (s[i] === '[') return false; i += s[i] === '\\' ? 2 : 1; }
  if (s[i] !== ']' || s[i + 1] !== ':') return false;
  const e = norma(s.slice(1, i)); if (!e) return false;
  const d = destinazione(s, i + 2); if (!d || d.fine < s.length) return false;
  if (!refs.has(e)) refs.set(e, { href: d.href, titolo: d.titolo });
  return true;
}

function blocchi(righe, prof, refs) {
  const out = []; out.sciolta = false;
  let i = 0, vuotaPrima = false; const n = righe.length;
  const metti = b => { if (vuotaPrima && out.length) out.sciolta = true; vuotaPrima = false; out.push(b); };
  while (i < n) {
    const l = righe[i];
    if (vuota(l)) { vuotaPrima = true; i++; continue; }
    const ind = rientro(l);
    if (ind >= 4) {   // codice rientrato
      const r = []; let vuote = 0;
      while (i < n && (vuota(righe[i]) || rientro(righe[i]) >= 4)) { r.push(righe[i].slice(Math.min(4, rientro(righe[i])))); i++; }
      while (r.length && vuota(r.at(-1))) { r.pop(); vuote++; }
      metti({ t: 'codice', lang: '', testo: r.join('\n') }); if (vuote) vuotaPrima = true; continue;
    }
    const f = recinto(l);
    if (f) {
      const r = []; i++;
      while (i < n && !chiudeRecinto(righe[i], f)) { r.push(righe[i].slice(Math.min(rientro(righe[i]), f.ind))); i++; }
      i++;
      const lang = f.info.split(/\s/, 1)[0].toLowerCase();
      metti({ t: 'codice', lang: /^[a-z0-9_+#.-]{1,30}$/.test(lang) ? lang : '', testo: r.join('\n') }); continue;
    }
    if (l.startsWith('<!--', ind)) {   // i commenti HTML non si vedono nemmeno su GitHub: si saltano
      while (i < n && !righe[i].includes('-->')) i++;
      i++; continue;
    }
    const h = titoloAtx(l); if (h) { metti({ t: 'titolo', liv: h.liv, testo: h.testo }); i++; continue; }
    if (riga_hr(l)) { metti({ t: 'hr' }); i++; continue; }
    if (prof < PROFONDITA && citazione(l) !== null) {
      const r = [];
      while (i < n) {
        const x = righe[i], q = citazione(x);
        if (q !== null) { r.push(q); i++; continue; }
        if (!vuota(x) && r.length && !vuota(r.at(-1)) && !interrompe(x)) { r.push(x); i++; continue; }   // continuazione pigra
        break;
      }
      metti({ t: 'citazione', figli: blocchi(r, prof + 1, refs) }); continue;
    }
    if (prof < PROFONDITA && marcatore(l)) { const [b, j] = lista(righe, i, prof, refs); metti(b); i = j; continue; }
    const al = inizioTabella(righe, i);
    if (al) {
      const testa = celle(l); const corpo = []; let j = i + 2;
      while (j < n && !vuota(righe[j]) && !interrompe(righe[j]) && (corpo.length + 1) * al.length <= CELLE) {
        const c = celle(righe[j]).slice(0, al.length); while (c.length < al.length) c.push('');
        corpo.push(c); j++;
      }
      metti({ t: 'tabella', al, testa, corpo }); i = j; continue;
    }
    if (l[ind] === '[' && definizione(l.trim(), refs)) { i++; continue; }
    // paragrafo, o titolo setext se la riga dopo è fatta di = o -
    const p = [l.slice(ind)]; let liv = 0; i++;
    while (i < n) {
      const x = righe[i];
      if (vuota(x)) break;
      if ((liv = setext(x))) { i++; break; }
      if (interrompe(x) || inizioTabella(righe, i)) break;
      p.push(x.slice(rientro(x))); i++;
    }
    metti(liv ? { t: 'titolo', liv, testo: p.join('\n').trim() } : { t: 'p', testo: p.join('\n').trimEnd() });
  }
  return out;
}
function lista(righe, i, prof, refs) {
  const m0 = marcatore(righe[i]), n = righe.length, voci = []; let sciolta = false;
  const stessa = l => { const m = marcatore(l); return m && m.ord === m0.ord && m.car === m0.car && !riga_hr(l) ? m : null; };
  while (i < n) {
    const m = stessa(righe[i]); if (!m) break;
    const corpo = [m.contenuto]; i++;
    while (i < n) {
      const x = righe[i];
      if (vuota(x)) { corpo.push(''); i++; continue; }
      if (rientro(x) >= m.off) { corpo.push(x.slice(m.off)); i++; continue; }
      if (corpo.at(-1) !== '' && !interrompe(x) && !marcatore(x)) { corpo.push(x.slice(rientro(x))); i++; continue; }   // continuazione pigra
      break;
    }
    let vuote = 0; while (corpo.length > 1 && corpo.at(-1) === '') { corpo.pop(); vuote++; }
    let task = null; const c0 = corpo[0];
    if (c0[0] === '[' && ' xX'.includes(c0[1]) && c0[2] === ']' && (c0.length === 3 || c0[3] === ' ' || c0[3] === '\t')) { task = c0[1] !== ' '; corpo[0] = c0.slice(4); }
    const figli = blocchi(corpo, prof + 1, refs);
    if (figli.sciolta) sciolta = true;
    voci.push({ figli, task });
    if (vuote) { if (i < n && stessa(righe[i])) sciolta = true; else { i -= vuote; break; } }   // le righe vuote finali le rivede chi chiama
  }
  return [{ t: 'lista', ord: m0.ord, inizio: m0.num, sciolta, voci }, i];
}

// GitHub: minuscolo, via tutto tranne lettere, segni, numeri, «_», «-» e spazi; spazi → «-»; doppioni con -1, -2…
function slug(testo, ctx) {
  const s = testo.toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-').slice(0, 200);
  let id = s;
  if (ctx.usati.has(id)) { let k = ctx.conti.get(s) || 1; do id = `${s}-${k++}`; while (ctx.usati.has(id)); ctx.conti.set(s, k); }
  ctx.usati.add(id); return 'readme-' + id;
}

function html(bl, ctx, stretta = false) {
  const out = [];
  for (const b of bl) {
    if (b.t === 'p') out.push(stretta ? linea(b.testo, ctx) : `<p>${linea(b.testo, ctx)}</p>`);
    else if (b.t === 'titolo') { const nodi = enLinea(b.testo, ctx); out.push(`<h${b.liv} id="${esc(slug(testoDi(nodi), ctx))}">${rendi(nodi)}</h${b.liv}>`); }
    else if (b.t === 'codice') out.push(`<pre><code${b.lang ? ` class="lang-${b.lang}"` : ''}>${esc(b.testo)}${b.testo ? '\n' : ''}</code></pre>`);
    else if (b.t === 'hr') out.push('<hr>');
    else if (b.t === 'citazione') out.push(`<blockquote>\n${html(b.figli, ctx)}\n</blockquote>`);
    else if (b.t === 'lista') {
      const tag = b.ord ? 'ol' : 'ul', compiti = b.voci.some(v => v.task !== null);
      out.push(`<${tag}${b.ord && b.inizio !== 1 ? ` start="${b.inizio}"` : ''}${compiti ? ' class="contains-task-list"' : ''}>`);
      for (const v of b.voci) {
        let dentro = html(v.figli, ctx, !b.sciolta);
        if (v.task !== null) {
          const box = `<input type="checkbox" disabled${v.task ? ' checked' : ''}> `;
          dentro = dentro.startsWith('<p>') ? '<p>' + box + dentro.slice(3) : box + dentro;
        }
        out.push(`<li${v.task !== null ? ' class="task-list-item"' : ''}>${dentro}</li>`);
      }
      out.push(`</${tag}>`);
    } else if (b.t === 'tabella') {
      const cella = (tag, c, k) => `<${tag}${b.al[k] ? ` align="${b.al[k]}"` : ''}>${linea(c, ctx)}</${tag}>`;
      out.push(`<table>\n<thead>\n<tr>${b.testa.map((c, k) => cella('th', c, k)).join('')}</tr>\n</thead>` +
        (b.corpo.length ? `\n<tbody>\n${b.corpo.map(r => `<tr>${r.map((c, k) => cella('td', c, k)).join('')}</tr>`).join('\n')}\n</tbody>` : '') + '\n</table>');
    }
  }
  return out.join('\n');
}

// md: il testo del README; repo 'owner/nome' per i percorsi relativi (senza, i link relativi restano solo testo)
export function markdownSicuro(md, { repo, ramo = 'HEAD', host = null } = {}) {
  let s = String(md ?? ''); if (s.length > MASSIMO) s = s.slice(0, MASSIMO);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const okRepo = typeof repo === 'string' && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo) && !repo.split('/').some(p => p === '.' || p === '..');
  const r = String(ramo || 'HEAD');
  const okRamo = /^[A-Za-z0-9._\/-]{1,200}$/.test(r) && !r.split('/').some(p => !p || p === '.' || p === '..');
  const ctx = { host, refs: new Map(), repo: okRepo ? repo : null, ramo: okRamo ? r.split('/').map(encodeURIComponent).join('/') : 'HEAD', usati: new Set(), conti: new Map() };
  const righe = s.replace(/\r\n?/g, '\n').replace(/\0/g, '\ufffd').split('\n').map(espandi);
  return html(blocchi(righe, 0, ctx.refs), ctx);
}
