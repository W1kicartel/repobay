// GitHub: l'accesso con OAuth (nessun permesso chiesto: bastano i dati pubblici) e le poche letture che servono
// (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
// Un builder può mettere in vendita solo un repository pubblico, con una licenza open source, di cui è amministratore.

// le licenze che permettono di installare e far pagare il servizio (identificativi SPDX)
export const LICENZE = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'MPL-2.0', 'EUPL-1.2',
  'GPL-2.0', 'GPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'AGPL-3.0'];

export function clienteGithub({ id, segreto, web, api }) {
  const pronto = () => { if (!id || !segreto) throw Object.assign(new Error('GitHub non è configurato: mancano GITHUB_CLIENT_ID e GITHUB_CLIENT_SECRET'), { stato: 503 }); };
  async function leggi(percorso, gettone) {
    const r = await fetch(`${api}${percorso}`, { headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'officina', ...(gettone ? { authorization: `Bearer ${gettone}` } : {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(r.status === 404 ? 'Repository non trovato' : (j.message || `GitHub ha risposto ${r.status}`)), { stato: r.status === 404 ? 404 : 502 });
    return j;
  }
  return {
    indirizzoAccesso(ritorno, stato) {
      pronto();
      const q = new URLSearchParams({ client_id: id, redirect_uri: ritorno, state: stato, allow_signup: 'true' });
      return `${web}/login/oauth/authorize?${q}`;
    },
    async scambia(codice, ritorno) {
      pronto();
      const r = await fetch(`${web}/login/oauth/access_token`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: id, client_secret: segreto, code: codice, redirect_uri: ritorno }) });
      const j = await r.json().catch(() => ({}));
      if (!j.access_token) throw Object.assign(new Error('GitHub non ha confermato l\'accesso'), { stato: 401 });
      return j.access_token;
    },
    io: gettone => leggi('/user', gettone),
    // i repository pubblici di cui l'utente è amministratore (suoi o delle sue organizzazioni), senza fork né archiviati
    async repository(gettone) {
      const l = await leggi('/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member', gettone);
      return l.filter(r => !r.private && !r.fork && !r.archived && r.permissions?.admin);
    },
    repo: (nome, gettone) => leggi(`/repos/${nome}`, gettone),
    // le letture pubbliche (README, release, dati del repository) per la sincronizzazione: con l'ETag (le risposte 304 non
    // consumano il limite di GitHub) e, se c'è l'app OAuth, con le sue credenziali (5000 richieste l'ora invece di 60)
    async grezzo(percorso, { etag, accept = 'application/vnd.github+json' } = {}) {
      const h = { accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'officina', ...(etag ? { 'if-none-match': etag } : {}) };
      if (id && segreto) h.authorization = 'Basic ' + Buffer.from(`${id}:${segreto}`).toString('base64');
      const r = await fetch(`${api}${percorso}`, { headers: h, signal: AbortSignal.timeout(15_000) });
      return { stato: r.status, etag: r.headers.get('etag'), testo: r.status === 200 ? await r.text() : null, resta: Number(r.headers.get('x-ratelimit-remaining') ?? 1) };
    },
  };
}

// i controlli su un repository prima di metterlo in vendita: → null se va bene, altrimenti il motivo
export function motivoRifiuto(r, { licenzaVerificata = false } = {}) {
  if (r.private) return 'Il repository è privato: si possono vendere solo progetti pubblici';
  if (r.fork) return 'È un fork: metti in vendita il progetto originale';
  if (r.archived) return 'Il repository è archiviato';
  if (!r.permissions?.admin) return 'Devi essere amministratore del repository';
  if (licenzaVerificata) return null;   // la licenza l'ha letta a mano chi gestisce la piattaforma
  const l = r.license?.spdx_id;
  if (!l || l === 'NOASSERTION') return 'Il repository non ha una licenza riconosciuta: aggiungi un file LICENSE';
  if (!LICENZE.includes(l)) return `La licenza ${l} non è fra quelle open source accettate`;
  return null;
}

// la licenza controllata a mano (vetrina curata, pannello): tipo «aperta» o «interna», il nome, cosa vuol dire in parole semplici, la
// fonte (il file LICENSE). → l'oggetto pulito, o null se non va
export const TIPI_LICENZA = ['aperta', 'interna'];
export function pulisciLicenza(x) {
  if (!x || typeof x !== 'object' || !TIPI_LICENZA.includes(x.tipo)) return null;
  const t = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
  const nome = t(x.nome, 80), spdx = t(x.spdx, 60) || nome, nota = t(x.nota, 700), fonte = t(x.fonte, 300);
  if (nome.length < 3 || nota.length < 20 || !/^https:\/\/[^\s<>"]+$/.test(fonte)) return null;
  return { tipo: x.tipo, nome, spdx, nota, fonte };
}

// il programma partner dell'azienda (vetrina curata, pannello): nome, link per aderire, le condizioni in breve, se confermarle è obbligatorio
export function pulisciProgramma(x) {
  if (!x || typeof x !== 'object') return null;
  const t = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
  const nome = t(x.nome, 80), url = t(x.url, 300), termini = t(x.termini, 600);
  if (nome.length < 3 || termini.length < 20 || !/^https:\/\/[^\s<>"]+$/.test(url)) return null;
  return { nome, url, termini, obbligatorio: x.obbligatorio !== false };
}
// il link referral di Repobay verso il cloud o i piani a pagamento dell'azienda, con la frase che lo presenta
export function pulisciRef(x) {
  if (!x || typeof x !== 'object') return null;
  const url = typeof x.url === 'string' ? x.url.trim().slice(0, 500) : '', testo = typeof x.testo === 'string' ? x.testo.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) : '';
  if (!/^https:\/\/[^\s<>"]+$/.test(url) || testo.length < 3) return null;
  return { url, testo };
}
