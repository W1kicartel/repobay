// L'accesso e l'iscrizione. Una pagina, più viste: entra (email e password, passkey, GitHub), iscriviti, link via email,
// password dimenticata, ?reimposta=T (nuova password), ?link=T (il bottone «Continua»: gli antivirus aprono i link ma non premono),
// il secondo passo della verifica in due passaggi, «controlla la tua email» dopo l'iscrizione.
import { $, $$, chiama, el, t, lingua, pronta, occupato, occhi } from './comune.js';
import { compilazioneAutomatica, usaPasskey } from './passkey.js';
await pronta;
for (const i of $$('.figura img')) { const guarda = () => i.closest('.figura').classList.toggle('manca', !i.naturalWidth); i.addEventListener('load', guarda); i.addEventListener('error', guarda); if (i.complete) guarda(); }   // l'immagine 3D che manca: resta la cornice

const q = new URLSearchParams(location.search);
// ?dopo=/percorso: solo percorsi interni (niente //altrosito, niente \)
const dopo = (() => { const d = q.get('dopo') || ''; return /^\/(?![/\\])[^\s\\]*$/.test(d) && !d.startsWith('/accedi') ? d : '/area'; })();
const vai = (dove = dopo) => location.assign(dove);
// GitHub riporta anche lui a ?dopo (i parametri che il link ha già, contratto e rivendica, restano)
if (dopo !== '/area') for (const a of $$('a[href^="/auth/github"]')) {
  const u = new URL(a.getAttribute('href'), location.origin); u.searchParams.set('dopo', dopo); a.setAttribute('href', `${u.pathname}${u.search}`);
}
let sessione = {};
try { sessione = await chiama('GET', '/api/sessione'); } catch { /* la pagina funziona lo stesso */ }
const nomeSito = sessione.nome || document.title.split('·').pop().trim();

// ---------------- le viste ----------------
const URL_VISTA = { entra: '', iscriviti: '?iscriviti=1', link: '?modo=link', dimenticata: '?modo=dimenticata' };
let vista = null;
function mostra(nome, { url = true, avviso = null } = {}) {
  for (const v of $$('.vista')) v.classList.toggle('nascosto', v.id !== `v-${nome}`);
  const prima = vista; vista = nome;
  const v = $(`#v-${nome}`);
  document.title = `${t(v.dataset.titolo)} · ${nomeSito}`;
  if (url && nome in URL_VISTA) {
    const u = new URLSearchParams(URL_VISTA[nome].slice(1)); if (dopo !== '/area') u.set('dopo', dopo);
    const x = u.toString(); history.replaceState(null, '', `/accedi${x ? `?${x}` : ''}`);
  }
  if (avviso) avvisoPagina(avviso.testo, avviso.tipo); else if (prima) avvisoPagina('');
  // l'email scritta in una vista passa alle altre
  const em = prima && $(`#v-${prima} input[type=email]`)?.value;
  if (em) for (const i of $$('input[type=email]', v)) if (!i.value) i.value = em;
  const primo = $$('input:not([type=hidden]):not([tabindex="-1"]):not([type=checkbox]), #b-continua, #b-area', v).find(x => x.offsetParent !== null && !x.value);
  (primo || $$('input:not([tabindex="-1"]):not([type=checkbox])', v).find(x => x.offsetParent !== null))?.focus({ preventScroll: true });
  if (prima) scrollTo({ top: 0 });
  if (nome === 'entra') avviaCondizionale();
}
function avvisoPagina(testo, tipo = 'errore', ...figli) {
  const a = $('#avviso-pagina');
  a.className = `avviso ${tipo}${testo ? '' : ' nascosto'}`;
  a.replaceChildren(...(testo ? [t(testo), ...figli] : []));
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-modo]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault(); mostra(a.dataset.modo);
});

// ---------------- i campi: errori in linea, password, maiuscole ----------------
let n = 0;
for (const box of $$('.errore-campo')) {   // ogni errore legato al suo campo (aria-describedby)
  box.id ||= `errore-${++n}`; box.setAttribute('aria-live', 'polite');
  const i = box.closest('label, .campo').querySelector('input');
  if (i) i.setAttribute('aria-describedby', [i.getAttribute('aria-describedby'), box.id].filter(Boolean).join(' '));
}
function erroreCampo(input, testo) {
  const id = (input.getAttribute('aria-describedby') || '').split(' ').find(x => x.startsWith('errore-'));
  const box = (id && document.getElementById(id)) || input.closest('.campo, label')?.querySelector('.errore-campo');
  if (testo) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  if (box) box.textContent = testo ? t(testo) : '';
  input.closest('.campo')?.querySelector('.forza-testo')?.classList.toggle('nascosto', !!testo);   // niente suggerimento doppio sotto l'errore
  return !testo;
}
occhi();
for (const i of $$('.parola input')) {
  const avv = i.closest('.campo').querySelector('.maiuscole');
  const guarda = e => { if (e.getModifierState) avv.classList.toggle('nascosto', !e.getModifierState('CapsLock')); };
  i.addEventListener('keydown', guarda); i.addEventListener('keyup', guarda);
  i.addEventListener('blur', () => avv.classList.add('nascosto'));
}

// le stesse regole del server (parolaDebole), per dirlo subito
const COMUNI = new Set(['password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'qwerty', 'qwertyuiop', 'qwerty123', 'qwerty1234',
  '123456', '1234567', '12345678', '123456789', '1234567890', '0123456789', '111111', '11111111', '000000', '00000000', 'abc123', 'abcdef', 'iloveyou', 'admin',
  'admin123', 'welcome', 'welcome1', 'letmein', 'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'trustno1', 'superman', 'batman',
  'asdfghjkl', 'zxcvbnm', '1q2w3e4r', '1q2w3e4r5t', 'qazwsxedc', 'juventus', 'napoli', 'milan', 'inter', 'roma', 'ciao', 'ciaociao', 'amore', 'tiamo',
  'cambiami', 'segreto', 'password!', 'changeme', 'whatever', 'starwars', 'pokemon', 'minecraft', 'internet', 'computer', 'abcdefghij', 'aaaaaaaaaa']);
function debole(p, { email = '', nome = '' } = {}) {
  if (p.length < 10) return 'La password deve avere almeno 10 caratteri';
  if (p.length > 200) return 'La password è troppo lunga (al massimo 200 caratteri)';
  const m = p.toLowerCase();
  if (new Set(m).size < 5) return 'La password è troppo ripetitiva: usa caratteri diversi';
  if (COMUNI.has(m) || COMUNI.has(m.replace(/[\d!.?_-]+$/, ''))) return 'Questa password è fra le più usate: scegline una tua';
  const locale = String(email).toLowerCase().split('@')[0];
  if (locale.length >= 4 && m.includes(locale)) return 'La password non deve contenere la tua email';
  for (const x of String(nome).toLowerCase().split(/\s+/)) if (x.length >= 4 && m.includes(x)) return 'La password non deve contenere il tuo nome';
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(m)) return 'La password è una sequenza: scegline una meno prevedibile';
  return null;
}
function livello(p, ctx) {   // 1 non passa le regole; 2 passa; 3 buona; 4 ottima
  if (!p) return 0;
  if (debole(p, ctx)) return 1;
  const classi = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter(r => r.test(p)).length, diversi = new Set(p).size;
  if (p.length >= 22 || (p.length >= 16 && classi >= 3 && diversi >= 10)) return 4;
  if (p.length >= 14 || (p.length >= 12 && classi >= 3)) return 3;
  return 2;
}
const PAROLE = ['Almeno 10 caratteri. Una frase che ricordi va benissimo.', '', 'Va bene. Più lunga è, più è sicura.', 'Buona.', 'Ottima.'];
const contesto = form => ({ email: form.elements.email?.value || '', nome: form.elements.nome?.value || '' });
function misura(form) {
  const i = form.elements.parola, p = i.value, l = livello(p, contesto(form));
  const barra = form.querySelector('.forza'); barra.dataset.livello = String(l);
  form.querySelector('.forza-testo').textContent = t(!p && form.id === 'f-iscriviti' ? 'Senza, entri con un link via email. Se la scegli: almeno 10 caratteri, una frase che ricordi va benissimo.'
    : l === 1 ? debole(p, contesto(form)) : PAROLE[l]);
}

// regole dei campi: restituiscono il messaggio d'errore o null
const REGOLE = {
  email: v => !v.trim() ? 'Scrivi la tua email' : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? 'Email non valida' : null,
  nome: v => v.trim().length < 2 ? 'Scrivi il tuo nome' : null,
  contratto: (v, i) => !i.checked ? 'Per iscriverti accetta le condizioni' : null,
  codice: v => !/^\d{6}$/.test(v) ? 'Il codice ha 6 cifre' : null,
  recupero: v => !/^[0-9a-z]{8}$/i.test(v.replace(/[\s-]/g, '')) ? 'Il codice di recupero ha 8 caratteri, come XXXX-XXXX' : null,
};
function regolaDi(form, i) {
  if (i.name === 'parola') return form.id === 'f-entra' ? (i.value ? null : 'Scrivi la password') : form.id === 'f-iscriviti' && !i.value ? null : debole(i.value, contesto(form));   // all'iscrizione è facoltativa
  if (i.name === 'parola2') return !i.value ? 'Ripeti la password' : i.value !== form.elements.parola.value ? 'Le due password non coincidono' : null;
  return REGOLE[i.name]?.(i.value, i) ?? null;
}
// controlla i campi visibili; il primo sbagliato prende il focus
function valida(form) {
  let primo = null;
  for (const i of $$('input', form)) {
    if (i.closest('.trappola') || i.closest('.nascosto') || !(i.name in REGOLE || /^parola2?$/.test(i.name))) continue;
    if (!erroreCampo(i, regolaDi(form, i)) && !primo) primo = i;
  }
  primo?.focus();
  return !primo;
}
for (const form of $$('form.modulo')) {
  form.addEventListener('input', e => {
    const i = e.target; if (!(i instanceof HTMLInputElement)) return;
    if (i.getAttribute('aria-invalid') === 'true') erroreCampo(i, regolaDi(form, i));   // l'errore sparisce appena è a posto
    if (i.name === 'parola' && form.querySelector('.forza')) misura(form);
    if (i.name === 'parola' && form.elements.parola2?.value && form.elements.parola2.getAttribute('aria-invalid') === 'true') erroreCampo(form.elements.parola2, regolaDi(form, form.elements.parola2));
    if (['email', 'nome'].includes(i.name) && form.querySelector('.forza') && form.elements.parola.value) misura(form);
    const m = form.querySelector('.messaggio'); if (m && m.textContent) { m.textContent = ''; m.replaceChildren(); }
  });
  form.addEventListener('change', e => { if (e.target.type === 'checkbox' && e.target.getAttribute('aria-invalid') === 'true') erroreCampo(e.target, regolaDi(form, e.target)); });
}
// i messaggi del server che riguardano un campo vanno sotto quel campo (in italiano o già tradotti)
const DEL_CAMPO = {
  'Email non valida': 'email', 'Questa email è già iscritta: accedi': 'email', 'Scrivi il tuo nome': 'nome', 'Per iscriverti devi accettare le condizioni': 'contratto',
  'Codice sbagliato': 'codice', 'Questa password compare in furti di dati pubblici: scegline un\'altra': 'parola',
  'La password deve avere almeno 10 caratteri': 'parola', 'La password è troppo lunga (al massimo 200 caratteri)': 'parola', 'La password è troppo ripetitiva: usa caratteri diversi': 'parola',
  'Questa password è fra le più usate: scegline una tua': 'parola', 'La password non deve contenere la tua email': 'parola', 'La password non deve contenere il tuo nome': 'parola',
  'La password è una sequenza: scegline una meno prevedibile': 'parola',
};
const campoDi = msg => { for (const [k, c] of Object.entries(DEL_CAMPO)) if (msg === k || msg === t(k)) return c; return null; };
// invia un modulo: valida, gira il bottone, mette l'errore del server sotto il campo giusto o in fondo
function quandoInvii(form, lavoro) {
  form.addEventListener('submit', e => {
    e.preventDefault(); fermaCondizionale();
    if (!valida(form)) return;
    const msg = form.querySelector('.messaggio');
    occupato(form.querySelector('button:not([type=button])'), async () => {
      try { await lavoro(Object.fromEntries(new FormData(form))); }
      catch (err) {
        const c = campoDi(err.message), i = c && form.elements[c];
        if (i && !i.closest('.nascosto')) { erroreCampo(i, err.message); i.focus(); return; }
        throw err;
      }
    }, msg);
  });
}
const ok = (stato, testo) => { const m = stato; m.className = 'messaggio bene'; m.textContent = t(testo); };

// ---------------- passkey: il bottone e i suggerimenti del campo email ----------------
let condizionale = null, opzioniInCorso = null;
function fermaCondizionale() { if (condizionale) { condizionale.abort(); condizionale = null; } }
const opzioniPasskey = () => (opzioniInCorso = chiama('POST', '/api/passkey/accesso/opzioni', {}));
async function entraConPasskey(risposta) { await chiama('POST', '/api/passkey/accesso', { risposta }); vai(); }
// una richiesta sola in attesa: tornando su «entra» si riusa quella (ogni richiesta di opzioni conta nel limite del server)
async function avviaCondizionale() {
  if (condizionale || vista !== 'entra') return;
  const ctl = new AbortController(); condizionale = ctl;
  const libera = () => { if (condizionale === ctl) condizionale = null; };
  let risposta;
  try {
    if (!(await compilazioneAutomatica()) || ctl.signal.aborted) return libera();
    const opzioni = await opzioniPasskey(); if (ctl.signal.aborted) return;
    risposta = await usaPasskey(opzioni, { condizionale: true, segnale: ctl.signal });
  } catch { return libera(); }   // annullata da noi (AbortError) o non disponibile: i suggerimenti sono un di più, niente da dire
  libera();
  try { await entraConPasskey(risposta); } catch (e) { $('#m-passkey').textContent = e.message; }   // la passkey scelta non va: lo diciamo
}
if (globalThis.PublicKeyCredential) {
  const b = $('#b-passkey'); b.classList.remove('nascosto');
  b.addEventListener('click', async () => {
    fermaCondizionale();
    await occupato(b, async () => {
      await opzioniInCorso?.catch(() => {});   // la richiesta dei suggerimenti non deve sovrascrivere la sfida di questa
      const opzioni = await opzioniPasskey();
      let risposta;
      try { risposta = await usaPasskey(opzioni); } catch (e) { if (e.codice === 'AbortError') return; throw e; }
      await entraConPasskey(risposta);
    }, $('#m-passkey'));
    if (vista === 'entra') avviaCondizionale();
  });
}

// ---------------- entra ----------------
quandoInvii($('#f-entra'), async x => {
  const r = await chiama('POST', '/api/accesso', { email: x.email.trim(), parola: x.parola });
  if (r.dueFattori) return mostra('codice', { url: false }); vai();
});

// ---------------- iscriviti (e GitHub con il consenso) ----------------
const fIscr = $('#f-iscriviti');
quandoInvii(fIscr, async x => {
  const email = x.email.trim();
  try {
    await chiama('POST', '/api/iscrizione', { nome: x.nome.trim(), email, parola: x.parola, zona: x.zona.trim(), contratto: fIscr.elements.contratto.checked, lingua, sito_web: x.sito_web });
  } catch (e) {
    if (e.stato === 409) {   // già iscritta: un bottone per entrare con quella email
      erroreCampo(fIscr.elements.email, e.message);
      const m = fIscr.querySelector('.messaggio'); m.className = 'messaggio';
      m.replaceChildren(el('button', { type: 'button', class: 'collegamento', onclick: () => { mostra('entra'); $('#f-entra').elements.email.value = email; $('#f-entra').elements.parola.focus(); } }, t('Entra con questa email')));
      return;
    }
    throw e;
  }
  $('#posta-testo').textContent = t('Ti abbiamo scritto a {email}: apri il link per confermare l\'indirizzo. Vale 48 ore.', { email });
  $('#b-area').href = dopo;
  mostra('posta', { url: false });
  history.replaceState(null, '', '/accedi');
});
$('#gh-iscriviti').addEventListener('click', e => {   // GitHub per chi si iscrive: prima il consenso alle condizioni
  const c = fIscr.elements.contratto;
  if (!c.checked) { e.preventDefault(); erroreCampo(c, 'Per continuare con GitHub accetta le condizioni'); c.focus(); c.closest('.campo').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
});
$('#b-rinvia').addEventListener('click', e => occupato(e.currentTarget, async () => {
  await chiama('POST', '/api/email/rinvia', {}); ok($('#m-rinvia'), 'Fatto: ti abbiamo riscritto. Guarda anche nello spam.');
}, $('#m-rinvia')));

// ---------------- link via email e password dimenticata: la stessa risposta, che l'email ci sia o no ----------------
for (const [id, percorso] of [['link', '/api/accesso/link'], ['dimenticata', '/api/parola/dimenticata']]) {
  const v = $(`#v-${id}`), f = $('form', v), esito = $('.esito', v);
  quandoInvii(f, async x => {
    await chiama('POST', percorso, { email: x.email.trim(), ...(id === 'link' && dopo !== '/area' ? { dopo } : {}) });   // il link via email riporta a ?dopo
    f.classList.add('nascosto'); esito.classList.remove('nascosto');
  });
  $('[data-rifai]', v).addEventListener('click', () => { esito.classList.add('nascosto'); f.classList.remove('nascosto'); f.elements.email.select(); f.elements.email.focus(); });
}

// ---------------- ?reimposta=T ----------------
const fReim = $('#f-reimposta');
quandoInvii(fReim, async x => {
  try { await chiama('POST', '/api/parola/reimposta', { t: q.get('reimposta'), parola: x.parola }); }
  catch (e) { if (e.stato === 400 && !campoDi(e.message)) { fReim.classList.add('nascosto'); $('#reimposta-scaduto').classList.remove('nascosto'); avvisoPagina(e.message); return; } throw e; }
  mostra('entra', { avviso: { testo: 'Password cambiata. Per sicurezza abbiamo chiuso le sessioni aperte: entra con la nuova.', tipo: 'ok' } });
});

// ---------------- ?link=T: il bottone che consuma il link ----------------
$('#b-continua').addEventListener('click', e => occupato(e.currentTarget, async () => {
  let r;
  try { r = await chiama('POST', '/api/accesso/link/usa', { t: q.get('link') }); }
  catch (err) { $('#b-continua').classList.add('nascosto'); $('#b-nuovo-link').classList.remove('nascosto'); history.replaceState(null, '', '/accedi'); throw err; }
  history.replaceState(null, '', '/accedi');
  if (r.dueFattori) return mostra('codice', { url: false }); vai();
}, $('#m-continua')));

// ---------------- il secondo passo: 6 cifre (incollabili, parte da solo) o un codice di recupero ----------------
const fCod = $('#f-codice'), otp = fCod.elements.codice, rec = fCod.elements.recupero;
let conRecupero = false;
otp.addEventListener('input', () => {
  const v = otp.value.replace(/\D/g, '').slice(0, 6); if (v !== otp.value) otp.value = v;
  if (v.length === 6 && !fCod.querySelector('button.carica')) fCod.requestSubmit();
});
$('#b-recupero').addEventListener('click', e => {
  conRecupero = !conRecupero;
  for (const x of $$('#v-codice .codice-app')) x.classList.toggle('nascosto', conRecupero);
  for (const x of $$('#v-codice .codice-recupero')) x.classList.toggle('nascosto', !conRecupero);
  e.currentTarget.textContent = t(conRecupero ? 'Usa il codice dell\'app' : 'Usa un codice di recupero');
  fCod.querySelector('.messaggio').textContent = '';
  (conRecupero ? rec : otp).focus();
});
quandoInvii(fCod, async () => {
  const campo = conRecupero ? rec : otp;
  let r;
  try { r = await chiama('POST', '/api/accesso/codice', { codice: conRecupero ? rec.value.trim() : otp.value }); }
  catch (e) {
    if (e.message === 'Codice sbagliato' || e.message === t('Codice sbagliato')) { campo.select(); erroreCampo(campo, e.message); return; }
    if (e.stato === 401 || e.stato === 429) { mostra('entra', { avviso: { testo: e.message, tipo: 'errore' } }); return; }   // tempo scaduto o troppi tentativi
    throw e;
  }
  if (r.codiciRimasti === undefined) return vai();
  $('#rimasti-testo').textContent = t(r.codiciRimasti === 1 ? 'Hai usato un codice di recupero: te ne resta 1. Generane di nuovi prima di restare senza.' : 'Hai usato un codice di recupero: te ne restano {n}. Quando puoi, generane di nuovi.', { n: r.codiciRimasti });
  $('#b-continua-dopo').href = dopo;
  mostra('rimasti', { url: false });
});

// ---------------- da dove si parte ----------------
const ERRORI = {
  github: ['L\'accesso con GitHub non è andato a buon fine: riprova.', 'errore'],
  contratto: q.get('rivendica') ? ['Un tuo progetto è già qui e ti aspetta. Per rivendicarlo accetta le condizioni e continua con GitHub: quello che ha già incassato diventa tuo.', 'attesa']
    : ['È la prima volta che entri con GitHub: accetta le condizioni e continua.', 'attesa'],
};
let iniziale = 'entra';
if (q.get('passo') === 'codice') iniziale = 'codice';   // di ritorno da GitHub, per chi ha la verifica in due passaggi
else if (q.get('link')) iniziale = 'usa-link';
else if (q.get('reimposta')) iniziale = 'reimposta';
else if (q.get('iscriviti') || q.get('errore') === 'contratto') iniziale = 'iscriviti';
else if (['link', 'dimenticata'].includes(q.get('modo'))) iniziale = q.get('modo');
// di ritorno dalla conferma dell'email senza essere dentro (/verifica → /accedi?email=…): gli stessi avvisi dell'area
const EMAIL = {
  verificata: ['Email confermata. Grazie.', 'ok'],
  scaduto: ['Il link di conferma è scaduto o è già stato usato. Se serve, chiedine un altro.', 'errore'],
  occupata: ['Questa email è già usata da un altro conto: non l\'abbiamo cambiata.', 'errore'],
};
const err = ERRORI[q.get('errore')] || EMAIL[q.get('email')];
mostra(iniziale, { url: !!err, avviso: err ? { testo: err[0], tipo: err[1] } : null });
if (sessione.dentro && ['entra', 'iscriviti'].includes(iniziale) && !err) {
  avvisoPagina('Sei già dentro con il tuo conto.', 'ok', ' ', el('a', { href: dopo }, t('Vai alla tua area')));
}
