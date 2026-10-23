// La sincronizzazione con GitHub: ogni APP GITHUB_ORE si rileggono i dati dei prodotti (stelle, licenza, archiviato), il README
// (mostrato in sicurezza sulla pagina del prodotto) e l'ultima release. Una release nuova arriva agli installatori: devono
// aggiornare i loro clienti. Un repository sparito, archiviato o con una licenza non più open source sospende il prodotto.
import { LICENZE } from './github.js';
import { markdownSicuro } from './markdown.js';

export function creaSincronizzazione({ db, github, notifiche, cfg, controlli = null }) {
  async function leggi(percorso, accept) {   // con la cache dell'ETag: le risposte 304 non consumano il limite
    const c = db.prepare('SELECT * FROM cache_github WHERE url = ?').get(percorso);
    const r = await github.grezzo(percorso, { etag: c?.etag, accept });
    if (r.stato === 304 && c) { db.prepare("UPDATE cache_github SET letto = datetime('now') WHERE url = ?").run(percorso); return { stato: 200, testo: c.corpo, nuovo: false, resta: r.resta }; }
    if (r.stato === 200) db.prepare("INSERT INTO cache_github (url, etag, corpo) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET etag = excluded.etag, corpo = excluded.corpo, letto = datetime('now')")
      .run(percorso, r.etag, r.testo);
    return { ...r, nuovo: r.stato === 200 };
  }
  // → true se il prodotto è stato sospeso adesso (così chi ha chiesto di rileggerlo lo sa, invece di leggere «sincronizzato»)
  function sospendi(p, nota) {
    if (p.stato !== 'pubblicato' && p.stato !== 'revisione') return false;
    db.prepare("UPDATE prodotto SET stato = 'sospeso', nota = ?, aggiornato = datetime('now') WHERE id = ?").run(nota, p.id);
    notifiche.notifica(p.builder, 'prodotto.sospeso', { prodotto: p.nome, slug: p.slug, nota });
    return true;
  }
  async function prodotto(p) {
    const r = await leggi(`/repos/${p.repo}`);
    if (r.stato === 404 || r.stato === 451) return sospendi(p, 'Il repository non esiste più o è diventato privato'), 'sospeso';
    if (r.stato !== 200) return `GitHub ${r.stato}`;
    const g = JSON.parse(r.testo), lic = g.license?.spdx_id;
    // all'indirizzo di prima ora c'è un altro repository (nome lasciato libero e ripreso da qualcun altro): non è più il progetto
    // venduto, e nemmeno README e release si leggono da lì
    if (p.repo_id && g.id !== p.repo_id) return sospendi(p, `All'indirizzo ${p.repo} ora c'è un altro repository: il progetto è stato spostato o cancellato`), 'sospeso';
    let sospeso = false;
    if (g.private) sospeso = sospendi(p, 'Il repository è diventato privato');
    else if (g.archived) sospeso = sospendi(p, 'Il repository è archiviato');
    // la licenza controllata a mano resta quella (GitHub non la riconosce, per questo è stata letta a mano)
    else if (!p.licenza_verificata && (!lic || !LICENZE.includes(lic))) sospeso = sospendi(p, `La licenza (${lic || 'nessuna'}) non è più fra quelle open source accettate`);
    db.prepare("UPDATE prodotto SET stelle = ?, licenza = COALESCE(?, licenza), ramo = ?, repo = ?, url = ?, sincronizzato = datetime('now') WHERE id = ?")
      .run(g.stargazers_count || 0, !p.licenza_verificata && LICENZE.includes(lic) ? lic : null, g.default_branch || 'HEAD', g.full_name || p.repo, g.html_url || p.url, p.id);
    if (db.prepare("SELECT 1 FROM cotitolare WHERE prodotto = ? AND stato = 'attivo'").get(p.id)) await contributi({ ...p, repo: g.full_name || p.repo });
    const md = await leggi(`/repos/${g.full_name || p.repo}/readme`, 'application/vnd.github.raw');
    if (md.stato === 200 && (md.nuovo || !p.readme_html)) {
      const testo = md.testo.slice(0, 300_000);
      db.prepare('UPDATE prodotto SET readme = ?, readme_html = ? WHERE id = ?').run(testo, markdownSicuro(testo, { repo: g.full_name || p.repo, ramo: g.default_branch || 'HEAD', host: new URL(cfg.url).host }), p.id);
    }
    const rel = await leggi(`/repos/${g.full_name || p.repo}/releases/latest`);
    if (rel.stato === 200 && rel.nuovo) {
      const v = JSON.parse(rel.testo); if (!v.tag_name || v.draft || v.prerelease) return sospeso ? 'sospeso' : 'ok';
      const nuova = db.prepare('INSERT OR IGNORE INTO versione (prodotto, tag, nome, url, note, pubblicata) VALUES (?, ?, ?, ?, ?, ?)')
        .run(p.id, v.tag_name, String(v.name || v.tag_name).slice(0, 120), v.html_url, String(v.body || '').slice(0, 20_000), v.published_at).changes;
      db.prepare('UPDATE prodotto SET versione = ?, versione_url = ? WHERE id = ?').run(v.tag_name, v.html_url, p.id);
      // la prima lettura non avvisa nessuno (era già lì); le release dopo sì, a chi installa il prodotto, ma solo dopo i controlli di
      // sicurezza: subito se c'è solo Scorecard (veloce), dal giro dei controlli se sul server ci sono antivirus e Trivy
      if (nuova && (!p.versione || p.stato !== 'pubblicato')) db.prepare("UPDATE versione SET avvisata = datetime('now') WHERE prodotto = ? AND tag = ?").run(p.id, v.tag_name);
      else if (nuova) {
        const ver = db.prepare('SELECT * FROM versione WHERE prodotto = ? AND tag = ?').get(p.id, v.tag_name);
        if (controlli && !controlli.scansioni()) controlli.avvisa(p, ver, await controlli.controlla(p, v.tag_name, { veloce: true }));
        else if (!controlli) {
          db.prepare("UPDATE versione SET avvisata = datetime('now') WHERE prodotto = ? AND tag = ?").run(p.id, v.tag_name);
          for (const a of db.prepare('SELECT installatore FROM adozione WHERE prodotto = ?').all(p.id))
            notifiche.notifica(a.installatore, 'release.nuova', { prodotto: p.nome, versione: v.tag_name, link: v.html_url, slug: p.slug });
        }
      }
    }
    return sospeso ? 'sospeso' : 'ok';
  }
  // i commit di chi ha scritto il progetto (i contributor di GitHub, sul ramo principale, fino a 500): servono a dividere la parte di
  // chi sviluppa fra gli owner (soldi.js, titolariDi). Si salvano per id GitHub, che non cambia. Se GitHub non risponde restano quelli di prima
  async function contributi(p) {
    const k = {};
    for (let pagina = 1; pagina <= 5; pagina++) {
      const r = await leggi(`/repos/${p.repo}/contributors?per_page=100&page=${pagina}`);
      if (r.stato !== 200) { if (pagina === 1) return null; break; }
      let l; try { l = JSON.parse(r.testo); } catch { return null; }
      if (!Array.isArray(l)) return null;
      for (const x of l) if (Number.isInteger(x?.id) && Number.isInteger(x?.contributions)) k[x.id] = (k[x.id] || 0) + x.contributions;
      if (l.length < 100) break;
    }
    db.prepare("UPDATE prodotto SET contributi = ?, contributi_letti = datetime('now') WHERE id = ?").run(JSON.stringify(k), p.id);
    return k;
  }
  // i prodotti da rileggere: mai letti o più vecchi di GITHUB_ORE; ci si ferma se il limite di GitHub sta finendo
  // forza: anche quelli letti da poco (il bottone «Rileggi da GitHub» di chi gestisce)
  async function tutti(max = 200, { forza = false } = {}) {
    const l = db.prepare(`SELECT * FROM prodotto WHERE stato IN ('pubblicato', 'revisione', 'bozza')
      AND (? OR sincronizzato IS NULL OR sincronizzato < datetime('now', ?)) ORDER BY sincronizzato IS NOT NULL, sincronizzato LIMIT ?`).all(forza ? 1 : 0, `-${cfg.github.ogniOre} hours`, max);
    let n = 0;
    for (const p of l) { try { await prodotto(p); n++; } catch (e) { console.error(`sincronizzazione ${p.repo}:`, e.message); } }
    return n;
  }
  return { prodotto, tutti, contributi };
}
