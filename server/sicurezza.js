// I controlli di sicurezza sui progetti in catalogo, per tutelare i business che li installano. Un antivirus da solo serve a poco sul
// software da server: i rischi veri sono un maintainer compromesso che infila codice malevolo (il caso xz), componenti con
// vulnerabilità note, segreti lasciati nel codice. Per ogni release nuova, prima di dire a chi installa «aggiorna i tuoi clienti»:
//   OpenSSF Scorecard  il punteggio pubblico del progetto (manutenzione, vulnerabilità note, workflow pericolosi, release firmate…)
//   ClamAV             l'antivirus sul sorgente della release (se sul server c'è clamscan: SICUREZZA_CLAMSCAN)
//   Trivy              componenti con vulnerabilità alte o critiche e segreti nel codice (se c'è trivy: SICUREZZA_TRIVY)
// Esito: ok, attenzione (chi installa lo vede, la release esce con l'avviso), grave (un virus o un workflow pericoloso: la release non
// esce, lo sanno chi sviluppa e chi gestisce la piattaforma), non_disponibile (nessun controllo possibile: si dice com'è).
import { mkdtempSync, rmSync, createWriteStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

const lancia = (cmd, args, ms) => new Promise(ok => execFile(cmd, args, { timeout: ms, maxBuffer: 64 * 1024 * 1024 }, (e, out, err) => ok({ codice: e ? (typeof e.code === 'number' ? e.code : -1) : 0, out: String(out || ''), err: String(err || '') })));
const ORDINE = { ok: 0, non_disponibile: 0, attenzione: 1, grave: 2 };
const peggiore = l => l.reduce((a, b) => (ORDINE[b] > ORDINE[a] ? b : a), 'ok');

export function creaControlli({ db, cfg, chiedi = fetch, esegui = lancia, notifiche = null }) {
  const S = cfg.sicurezza;
  const scansioni = () => !!(S.clamscan || S.trivy);

  // 1. OpenSSF Scorecard: il punteggio da 0 a 10 e i controlli che contano per chi installa
  async function scorecard(repo) {
    let r;
    try { r = await chiedi(`${S.scorecard}/projects/github.com/${repo}`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } }); }
    catch { return { fonte: 'scorecard', esito: 'non_disponibile', testo: 'OpenSSF Scorecard non risponde adesso' }; }
    if (r.status === 404) return { fonte: 'scorecard', esito: 'non_disponibile', testo: 'Il progetto non è ancora nel censimento di OpenSSF Scorecard' };
    if (!r.ok) return { fonte: 'scorecard', esito: 'non_disponibile', testo: `OpenSSF Scorecard risponde ${r.status}` };
    const j = await r.json().catch(() => null), punteggio = Number(j?.score);
    if (!Number.isFinite(punteggio)) return { fonte: 'scorecard', esito: 'non_disponibile', testo: 'Risposta di OpenSSF Scorecard non leggibile' };
    const c = Object.fromEntries((j.checks || []).map(x => [x.name, x]));
    const note = [], v = c.Vulnerabilities, m = c.Maintained, w = c['Dangerous-Workflow'];
    let esito = punteggio < 4 ? 'attenzione' : 'ok';
    if (w && w.score === 0) { esito = 'grave'; note.push('un workflow di GitHub pericoloso: chi apre una pull request potrebbe eseguire codice con i permessi del progetto'); }
    if (v && v.score >= 0 && v.score < 10) { esito = peggiore([esito, 'attenzione']); note.push(String(v.reason || 'vulnerabilità note nei componenti').slice(0, 160)); }
    if (m && m.score === 0) { esito = peggiore([esito, 'attenzione']); note.push('nessuna attività negli ultimi 90 giorni'); }
    return { fonte: 'scorecard', esito, punteggio, testo: `Punteggio OpenSSF Scorecard ${punteggio.toFixed(1)}/10${note.length ? `: ${note.join('; ')}` : ''}`, data: j.date || null };
  }

  // 2. il sorgente della release, scaricato con un limite di dimensione, poi ClamAV e Trivy (quelli installati sul server)
  async function scarica(repo, tag, cartella) {
    const r = await chiedi(`${S.archivi}/${repo}/tar.gz/refs/tags/${encodeURIComponent(tag)}`, { signal: AbortSignal.timeout(300_000) });
    if (!r.ok || !r.body) throw new Error(`archivio della release non scaricabile (${r.status})`);
    const max = S.maxMb * 1024 * 1024; let n = 0;
    const limite = new Transform({ transform(x, _, cb) { n += x.length; cb(n > max ? new Error(`archivio oltre ${S.maxMb} MB: non controllato`) : null, x); } });
    const f = join(cartella, 'release.tar.gz');
    await pipeline(Readable.fromWeb(r.body), limite, createWriteStream(f));
    const dentro = join(cartella, 'sorgente');
    const t = await esegui('sh', ['-c', `mkdir -p "$1" && tar -xzf "$2" -C "$1" --no-same-owner`, 'tar', dentro, f], 120_000);
    if (t.codice !== 0) throw new Error(`archivio non estraibile: ${t.err.slice(0, 120)}`);
    return dentro;
  }
  async function scansiona(repo, tag) {
    const cartella = mkdtempSync(join(tmpdir(), 'repobay-controllo-')), esiti = [];
    try {
      let dentro;
      try { dentro = await scarica(repo, tag, cartella); }
      catch (e) { return [{ fonte: 'sorgente', esito: 'non_disponibile', testo: e.message }]; }
      if (S.clamscan) {
        const r = await esegui(S.clamscan, ['-r', '--infected', '--no-summary', dentro], 900_000);
        if (r.codice === 0) esiti.push({ fonte: 'clamav', esito: 'ok', testo: 'Antivirus ClamAV: nessun file infetto' });
        else if (r.codice === 1) {
          const trovati = r.out.split('\n').filter(l => / FOUND$/.test(l)).map(l => l.replace(dentro + '/', '').trim()).slice(0, 5);
          esiti.push({ fonte: 'clamav', esito: 'grave', testo: `Antivirus ClamAV: ${trovati.length ? trovati.join('; ') : 'file infetti'}` });
        } else esiti.push({ fonte: 'clamav', esito: 'non_disponibile', testo: `ClamAV non ha finito (${r.codice}): ${r.err.slice(0, 120)}` });
      }
      if (S.trivy) {
        const r = await esegui(S.trivy, ['fs', '--quiet', '--scanners', 'vuln,secret', '--severity', 'HIGH,CRITICAL', '--format', 'json', dentro], 900_000);
        let j = null; try { j = JSON.parse(r.out); } catch { }
        if (!j) esiti.push({ fonte: 'trivy', esito: 'non_disponibile', testo: `Trivy non ha finito (${r.codice}): ${r.err.slice(0, 120)}` });
        else {
          const ris = j.Results || [], v = ris.flatMap(x => x.Vulnerabilities || []), segreti = ris.flatMap(x => x.Secrets || []);
          const critiche = v.filter(x => x.Severity === 'CRITICAL').length, alte = v.filter(x => x.Severity === 'HIGH').length;
          const parti = [];
          if (critiche || alte) parti.push(`${critiche} vulnerabilità critiche e ${alte} alte nei componenti (${[...new Set(v.map(x => x.PkgName))].slice(0, 4).join(', ')})`);
          if (segreti.length) parti.push(`${segreti.length} possibili segreti nel codice (spesso dati di prova: da guardare)`);
          esiti.push({ fonte: 'trivy', esito: parti.length ? 'attenzione' : 'ok', testo: parti.length ? `Trivy: ${parti.join('; ')}` : 'Trivy: nessuna vulnerabilità alta o critica, nessun segreto' });
        }
      }
      return esiti;
    } finally { rmSync(cartella, { recursive: true, force: true }); }
  }

  // un controllo completo di una versione → registrato e restituito
  async function controlla(p, tag, { veloce = false } = {}) {
    const dettagli = [await scorecard(p.repo)];
    if (!veloce && scansioni() && tag) dettagli.push(...await scansiona(p.repo, tag));
    const valutati = dettagli.filter(d => d.esito !== 'non_disponibile');
    const esito = valutati.length ? peggiore(valutati.map(d => d.esito)) : 'non_disponibile';
    const punteggio = dettagli.find(d => d.fonte === 'scorecard')?.punteggio ?? null;
    db.prepare('INSERT INTO controllo (prodotto, versione, esito, punteggio, dettagli) VALUES (?, ?, ?, ?, ?)').run(p.id, tag || null, esito, punteggio, JSON.stringify(dettagli));
    if (tag) db.prepare('UPDATE versione SET controllo = ? WHERE prodotto = ? AND tag = ?').run(esito, p.id, tag);
    return { esito, punteggio, dettagli };
  }

  // una release controllata: a chi installa se va (con l'avviso se c'è da guardare), ferma se è grave
  function avvisa(p, v, c) {
    db.prepare("UPDATE versione SET avvisata = datetime('now') WHERE prodotto = ? AND tag = ?").run(p.id, v.tag);
    if (!notifiche) return;
    if (c.esito === 'grave') {
      const motivo = c.dettagli.filter(d => d.esito === 'grave').map(d => d.testo).join('; ');
      notifiche.notifica(p.builder, 'sicurezza.ferma', { prodotto: p.nome, versione: v.tag, motivo });
      for (const a of cfg.admin.filter(a => a.includes('@')))
        notifiche.email(a, 'sicurezza', { nome: a.split('@')[0], prodotto: p.nome, versione: v.tag, motivo, link: `${cfg.url}/admin#revisione` }).catch(() => {});
      return;
    }
    if (p.stato !== 'pubblicato') return;
    for (const a of db.prepare('SELECT installatore FROM adozione WHERE prodotto = ?').all(p.id))
      notifiche.notifica(a.installatore, 'release.nuova', { prodotto: p.nome, versione: v.tag, link: v.url, slug: p.slug, attenzione: c.esito === 'attenzione' });
  }

  // il giro (lavori.js): le release in attesa di controllo (con gli scanner sul server), poi i controlli vecchi di una settimana
  async function giro(max = 3) {
    let n = 0;
    const attesa = db.prepare(`SELECT v.*, p.id pid FROM versione v JOIN prodotto p ON p.id = v.prodotto WHERE v.avvisata IS NULL AND p.stato IN ('pubblicato', 'revisione') ORDER BY v.vista LIMIT ?`).all(max);
    for (const v of attesa) {
      const p = db.prepare('SELECT * FROM prodotto WHERE id = ?').get(v.pid);
      try { avvisa(p, v, await controlla(p, v.tag)); n++; } catch (e) { console.error(`controllo ${p.repo} ${v.tag}:`, e.message); }
    }
    const vecchi = db.prepare(`SELECT p.* FROM prodotto p WHERE p.stato = 'pubblicato' AND NOT EXISTS (SELECT 1 FROM controllo c WHERE c.prodotto = p.id AND c.creato > datetime('now', '-7 days'))
      ORDER BY (SELECT MAX(c.creato) FROM controllo c WHERE c.prodotto = p.id) IS NOT NULL, (SELECT MAX(c.creato) FROM controllo c WHERE c.prodotto = p.id) LIMIT ?`).all(max);
    for (const p of vecchi) { try { await controlla(p, p.versione, { veloce: !p.versione }); n++; } catch (e) { console.error(`controllo ${p.repo}:`, e.message); } }
    return n;
  }

  // l'ultimo controllo di un prodotto, per la pagina e il pannello
  function ultimo(pid) {
    const c = db.prepare('SELECT * FROM controllo WHERE prodotto = ? ORDER BY id DESC LIMIT 1').get(pid);
    if (!c) return null;
    let dettagli = []; try { dettagli = JSON.parse(c.dettagli); } catch { }
    return { esito: c.esito, punteggio: c.punteggio, versione: c.versione, quando: c.creato, dettagli: dettagli.map(d => ({ fonte: d.fonte, esito: d.esito, testo: d.testo })) };
  }

  return { controlla, avvisa, giro, ultimo, scansioni };
}
export const esisteProgramma = p => !!p && existsSync(p);
