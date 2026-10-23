// La guida d'installazione a passi e le idee di applicazione di un prodotto: arrivano dalla vetrina curata (e, più avanti, da chi
// sviluppa) e finiscono così come sono sulla pagina pubblica. Qui si controlla la forma e si taglia quello che non serve: lunghezze
// limitate, solo i tipi e i segnaposto previsti ({{DOMINIO}}, {{IP}}, {{EMAIL}}). → l'oggetto pulito, o null se non va.
// la pagina li mostra sempre come testo (mai come HTML): qui si tolgono solo i caratteri di controllo, tenendo gli a capo dei comandi
const t = (x, max) => (typeof x === 'string' ? x.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const tSegnaposto = (x, max) => t(x, max).replace(/\{\{(?!(DOMINIO|IP|EMAIL)\}\})[^}]*\}\}/g, '');
const DIFFICOLTA = ['facile', 'media', 'impegnativa'], ANTEPRIME = ['notifica', 'schermo', 'messaggio', 'numero'];

export function pulisciInstallazione(g) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.passi)) return null;
  const passi = g.passi.slice(0, 12).map(s => ({
    titolo: t(s?.titolo, 120), testo: tSegnaposto(s?.testo, 600),
    ...(s?.comando ? { comando: tSegnaposto(s.comando, 2000) } : {}), ...(s?.verifica ? { verifica: tSegnaposto(s.verifica, 400) } : {}),
  })).filter(s => s.titolo && s.testo);
  if (passi.length < 2) return null;
  const fonte = typeof g.fonte === 'string' && /^https:\/\/[^\s<>"]+$/.test(g.fonte) ? g.fonte.slice(0, 300) : null;
  return { tempo: t(g.tempo, 40) || null, difficolta: DIFFICOLTA.includes(g.difficolta) ? g.difficolta : null,
    requisiti: (Array.isArray(g.requisiti) ? g.requisiti : []).slice(0, 6).map(x => t(x, 200)).filter(Boolean), passi, fonte };
}

export function pulisciIdee(l) {
  if (!Array.isArray(l)) return null;
  const idee = l.slice(0, 6).map(x => {
    const a = x?.anteprima;
    return { attivita: t(x?.attivita, 100), problema: t(x?.problema, 300), come: t(x?.come, 400), risultato: t(x?.risultato, 300),
      ...(a && ANTEPRIME.includes(a.tipo) && Array.isArray(a.righe) && a.righe.length
        ? { anteprima: { tipo: a.tipo, titolo: t(a.titolo, 60), righe: a.righe.slice(0, 3).map(r => t(r, 140)).filter(Boolean), ...(a.nota ? { nota: t(a.nota, 30) } : {}) } } : {}) };
  }).filter(x => x.attivita && x.come);
  return idee.length ? idee : null;
}

export const leggiJson = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
