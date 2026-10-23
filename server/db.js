// Il database: un file SQLite (node:sqlite), con migrazioni numerate (PRAGMA user_version).
//   utente        chi entra: builder (con GitHub), installatore (email o GitHub), o tutti e due. Dati fiscali (per la
//                 comunicazione DAC7 della piattaforma), segreto 2FA e webhook di Discord/Slack: cifrati con AES-256-GCM
//   sessione      gli accessi aperti (nel database solo l'hash del gettone); passaggio: il secondo passo della 2FA
//   gettone       i link a uso singolo mandati per email (verifica, nuova password, accesso senza password, cambio email)
//   passkey       le chiavi pubbliche delle passkey; sfida_passkey le sfide in corso
//   prodotto      un progetto GitHub messo in vendita dal suo builder; collaboratore: chi lo mantiene con lui e prende
//                 una parte della quota del builder; versione: le release lette da GitHub
//   adozione      un installatore che offre un prodotto, nella sua zona
//   cliente       un business che ha comprato, con le quote fissate al momento della vendita; recensione: il suo voto
//   quota         le parti di ogni pagamento (installatore, builder, collaboratori; la piattaforma tiene il resto)
//   evento        gli eventi di Stripe già visti; sfida, ordine, tx_usata: wallet e pagamenti in crypto
//   notifica      le notifiche nell'area; aggancio e consegna: i webhook in uscita verso i sistemi degli iscritti
//   chiave_api    le chiavi della REST API (solo l'hash); contatto: le richieste dei business agli installatori
//   richiesta     le richieste di assistenza di un business che ha comprato (dalla bolla o dalla pagina); messaggio: il filo
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const colonne = (db, t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name));
function aggiungi(db, t, defs) {   // ALTER TABLE … ADD COLUMN solo per le colonne che mancano
  const ci = colonne(db, t);
  for (const d of defs) { const n = d.split(' ')[0]; if (!ci.has(n)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${d}`); }
}

const MIGRAZIONI = [
  // 1: le tabelle di partenza
  db => db.exec(`
    CREATE TABLE IF NOT EXISTS utente (
      id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT UNIQUE, parola TEXT,
      github_id INTEGER UNIQUE, github_login TEXT, codice TEXT NOT NULL UNIQUE, zona TEXT,
      stripe TEXT, stripe_pronto INTEGER NOT NULL DEFAULT 0, stato TEXT NOT NULL DEFAULT 'attivo',
      fiscale TEXT, fiscale_aggiornato TEXT, wallet TEXT, wallet_dal TEXT,
      contratto TEXT NOT NULL, creato TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS sessione (
      token TEXT PRIMARY KEY, utente INTEGER NOT NULL REFERENCES utente(id) ON DELETE CASCADE, scade TEXT NOT NULL, github TEXT);
    CREATE TABLE IF NOT EXISTS prodotto (
      id INTEGER PRIMARY KEY, builder INTEGER NOT NULL REFERENCES utente(id), slug TEXT NOT NULL UNIQUE,
      repo TEXT NOT NULL, repo_id INTEGER NOT NULL UNIQUE, url TEXT NOT NULL, licenza TEXT NOT NULL, stelle INTEGER NOT NULL DEFAULT 0,
      nome TEXT NOT NULL, descrizione TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT 'altro', guida TEXT NOT NULL DEFAULT '',
      prezzo_avvio INTEGER NOT NULL DEFAULT 0, prezzo_mese INTEGER NOT NULL DEFAULT 0,
      quota_avvio REAL NOT NULL DEFAULT 0.30, quota_mese REAL NOT NULL DEFAULT 0.20,
      stato TEXT NOT NULL DEFAULT 'bozza', nota TEXT, creato TEXT NOT NULL DEFAULT (datetime('now')), aggiornato TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS adozione (
      installatore INTEGER NOT NULL REFERENCES utente(id) ON DELETE CASCADE, prodotto INTEGER NOT NULL REFERENCES prodotto(id) ON DELETE CASCADE,
      zona TEXT NOT NULL DEFAULT '', creato TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (installatore, prodotto));
    CREATE TABLE IF NOT EXISTS cliente (
      chiave TEXT PRIMARY KEY, prodotto INTEGER REFERENCES prodotto(id), installatore INTEGER REFERENCES utente(id),
      quota_avvio REAL, quota_mese REAL, email TEXT, nome TEXT, stato TEXT NOT NULL DEFAULT 'attivo', sessione TEXT, creato TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS quota (
      id INTEGER PRIMARY KEY, beneficiario INTEGER NOT NULL REFERENCES utente(id), ruolo TEXT NOT NULL, prodotto INTEGER REFERENCES prodotto(id),
      fattura TEXT NOT NULL, riga TEXT NOT NULL, tipo TEXT NOT NULL, base INTEGER NOT NULL, frazione REAL NOT NULL, importo INTEGER NOT NULL,
      pagamento TEXT, abbonamento TEXT, disponibile TEXT NOT NULL, stato TEXT NOT NULL DEFAULT 'in_attesa', trasferimento TEXT,
      stornato INTEGER NOT NULL DEFAULT 0, errore TEXT, creato TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (fattura, riga, ruolo));
    CREATE TABLE IF NOT EXISTS evento (id TEXT PRIMARY KEY, tipo TEXT, visto TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS sfida (utente INTEGER PRIMARY KEY REFERENCES utente(id) ON DELETE CASCADE, indirizzo TEXT NOT NULL, messaggio TEXT NOT NULL, scade TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ordine (
      id INTEGER PRIMARY KEY, codice TEXT NOT NULL UNIQUE, prodotto INTEGER NOT NULL REFERENCES prodotto(id), installatore INTEGER NOT NULL REFERENCES utente(id),
      rete TEXT NOT NULL, simbolo TEXT NOT NULL, prezzo REAL NOT NULL, mesi INTEGER NOT NULL, euro INTEGER NOT NULL, parti TEXT NOT NULL,
      stato TEXT NOT NULL DEFAULT 'aperto', pagatore TEXT, tx TEXT, scade TEXT NOT NULL, creato TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS tx_usata (rete TEXT NOT NULL, hash TEXT NOT NULL, ordine INTEGER REFERENCES ordine(id), PRIMARY KEY (rete, hash));
  `),
  // 2: conti completi (email verificata, 2FA, passkey, sessioni con dispositivo), integrazioni, team, recensioni, ricerca
  db => {
    aggiungi(db, 'utente', ['email_verificata TEXT', "lingua TEXT NOT NULL DEFAULT 'it'", 'bio TEXT', 'sito TEXT', 'calendario TEXT', 'avatar TEXT',
      'handle TEXT', 'totp TEXT', 'totp_nuovo TEXT', 'totp_ultimo INTEGER NOT NULL DEFAULT -1', 'recupero TEXT', 'preferenze TEXT',
      'telegram TEXT', 'discord TEXT', 'slack TEXT', 'cancellato TEXT', 'wallet_sol TEXT', 'wallet_btc TEXT', 'wallet_tron TEXT', 'segnaposto INTEGER NOT NULL DEFAULT 0', 'telegram_h TEXT']);
    aggiungi(db, 'sessione', ["creata TEXT NOT NULL DEFAULT ''", 'vista TEXT', 'agente TEXT', 'ip TEXT', "metodo TEXT NOT NULL DEFAULT 'parola'"]);
    aggiungi(db, 'prodotto', ['versione TEXT', 'versione_url TEXT', 'readme TEXT', 'readme_html TEXT', 'sincronizzato TEXT', 'ramo TEXT', 'sito TEXT', 'demo TEXT']);
    aggiungi(db, 'cliente', ['cliente_stripe TEXT', 'conto TEXT', 'invito TEXT']);
    aggiungi(db, 'ordine', ['email TEXT', 'riferimento TEXT', 'nome TEXT']);
    aggiungi(db, 'sfida', ["tipo TEXT NOT NULL DEFAULT 'evm'"]);
    // la quota: un beneficiario per riga e ruolo (con i collaboratori lo stesso ruolo può avere più beneficiari)
    if (/UNIQUE \(fattura, riga, ruolo\)/.test(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'quota'").get()?.sql || '')) {
      db.exec(`
        CREATE TABLE quota_n (
          id INTEGER PRIMARY KEY, beneficiario INTEGER NOT NULL REFERENCES utente(id), ruolo TEXT NOT NULL, prodotto INTEGER REFERENCES prodotto(id),
          fattura TEXT NOT NULL, riga TEXT NOT NULL, tipo TEXT NOT NULL, base INTEGER NOT NULL, frazione REAL NOT NULL, importo INTEGER NOT NULL,
          pagamento TEXT, abbonamento TEXT, disponibile TEXT NOT NULL, stato TEXT NOT NULL DEFAULT 'in_attesa', trasferimento TEXT,
          stornato INTEGER NOT NULL DEFAULT 0, errore TEXT, creato TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (fattura, riga, ruolo, beneficiario));
        INSERT INTO quota_n SELECT id, beneficiario, ruolo, prodotto, fattura, riga, tipo, base, frazione, importo, pagamento, abbonamento, disponibile, stato, trasferimento, stornato, errore, creato FROM quota;
        DROP TABLE quota; ALTER TABLE quota_n RENAME TO quota;`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS passaggio (token TEXT PRIMARY KEY, utente INTEGER NOT NULL REFERENCES utente(id) ON DELETE CASCADE, scade TEXT NOT NULL, tentativi INTEGER NOT NULL DEFAULT 0, metodo TEXT NOT NULL DEFAULT 'parola', github TEXT);
      CREATE TABLE IF NOT EXISTS gettone (
        token TEXT PRIMARY KEY, tipo TEXT NOT NULL, utente INTEGER REFERENCES utente(id) ON DELETE CASCADE, dato TEXT, scade TEXT NOT NULL, creato TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS passkey (
        id TEXT PRIMARY KEY, utente INTEGER NOT NULL REFERENCES utente(id) ON DELETE CASCADE, chiave TEXT NOT NULL, algoritmo INTEGER NOT NULL,
        contatore INTEGER NOT NULL DEFAULT 0, trasporti TEXT, nome TEXT NOT NULL DEFAULT 'Passkey', uv INTEGER NOT NULL DEFAULT 0,
        backup_idonea INTEGER NOT NULL DEFAULT 0, backup_attiva INTEGER NOT NULL DEFAULT 0, aaguid TEXT,
        creata TEXT NOT NULL DEFAULT (datetime('now')), usata TEXT);
      CREATE TABLE IF NOT EXISTS sfida_passkey (id TEXT PRIMARY KEY, sfida TEXT NOT NULL, utente INTEGER, tipo TEXT NOT NULL, scade TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS collaboratore (
        prodotto INTEGER NOT NULL REFERENCES prodotto(id) ON DELETE CASCADE, github_login TEXT NOT NULL COLLATE NOCASE, utente INTEGER REFERENCES utente(id),
        quota REAL NOT NULL, stato TEXT NOT NULL DEFAULT 'invitato', creato TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (prodotto, github_login));
      CREATE TABLE IF NOT EXISTS versione (
        prodotto INTEGER NOT NULL REFERENCES prodotto(id) ON DELETE CASCADE, tag TEXT NOT NULL, nome TEXT, url TEXT, note TEXT, pubblicata TEXT,
        vista TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (prodotto, tag));
      CREATE TABLE IF NOT EXISTS recensione (
        cliente TEXT PRIMARY KEY REFERENCES cliente(chiave), prodotto INTEGER NOT NULL REFERENCES prodotto(id), installatore INTEGER REFERENCES utente(id),
        voto INTEGER NOT NULL CHECK (voto BETWEEN 1 AND 5), testo TEXT NOT NULL DEFAULT '', autore TEXT NOT NULL DEFAULT '', risposta TEXT,
        nascosta INTEGER NOT NULL DEFAULT 0, creata TEXT NOT NULL DEFAULT (datetime('now')), aggiornata TEXT);
      CREATE TABLE IF NOT EXISTS contatto (
        id INTEGER PRIMARY KEY, installatore INTEGER NOT NULL REFERENCES utente(id) ON DELETE CASCADE, prodotto INTEGER REFERENCES prodotto(id),
        nome TEXT NOT NULL, email TEXT NOT NULL, telefono TEXT, messaggio TEXT NOT NULL, creato TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS sessione_cliente (token TEXT PRIMARY KEY, email TEXT NOT NULL, scade TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notifica (
        id INTEGER PRIMARY KEY, utente INTEGER NOT NULL REFERENCES utente(id) ON DELETE CASCADE, tipo TEXT NOT NULL, testo TEXT NOT NULL, link TEXT,
        letta INTEGER NOT NULL DEFAULT 0, creata TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS aggancio (
        id INTEGER PRIMARY KEY, utente INTEGER NOT NULL REFERENCES utente(id) ON DELETE CASCADE, url TEXT NOT NULL, segreto TEXT NOT NULL,
        eventi TEXT NOT NULL, attivo INTEGER NOT NULL DEFAULT 1, falliti INTEGER NOT NULL DEFAULT 0, creato TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS consegna (
        id INTEGER PRIMARY KEY, aggancio INTEGER NOT NULL REFERENCES aggancio(id) ON DELETE CASCADE, evento TEXT NOT NULL, corpo TEXT NOT NULL,
        tentativi INTEGER NOT NULL DEFAULT 0, prossimo TEXT NOT NULL, stato TEXT NOT NULL DEFAULT 'in_coda', risposta TEXT, creata TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS chiave_api (
        id INTEGER PRIMARY KEY, utente INTEGER NOT NULL REFERENCES utente(id) ON DELETE CASCADE, nome TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, inizio TEXT NOT NULL,
        creata TEXT NOT NULL DEFAULT (datetime('now')), usata TEXT, revocata TEXT);
      CREATE TABLE IF NOT EXISTS cache_github (url TEXT PRIMARY KEY, etag TEXT, corpo TEXT, letto TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS impostazione (chiave TEXT PRIMARY KEY, valore TEXT);
      CREATE INDEX IF NOT EXISTS i_quota_ben ON quota(beneficiario, stato);
      CREATE INDEX IF NOT EXISTS i_quota_disp ON quota(stato, disponibile);
      CREATE INDEX IF NOT EXISTS i_quota_pag ON quota(pagamento);
      CREATE INDEX IF NOT EXISTS i_quota_fat ON quota(fattura);
      CREATE INDEX IF NOT EXISTS i_adozione_prod ON adozione(prodotto);
      CREATE INDEX IF NOT EXISTS i_cliente_prod ON cliente(prodotto, installatore);
      CREATE INDEX IF NOT EXISTS i_cliente_email ON cliente(email);
      CREATE INDEX IF NOT EXISTS i_sessione_ut ON sessione(utente);
      CREATE INDEX IF NOT EXISTS i_prodotto_builder ON prodotto(builder);
      CREATE INDEX IF NOT EXISTS i_prodotto_stato ON prodotto(stato);
      CREATE INDEX IF NOT EXISTS i_ordine_stato ON ordine(stato, scade);
      CREATE INDEX IF NOT EXISTS i_notifica_ut ON notifica(utente, letta);
      CREATE INDEX IF NOT EXISTS i_consegna ON consegna(stato, prossimo);
      CREATE INDEX IF NOT EXISTS i_gettone_ut ON gettone(utente, tipo);
      CREATE INDEX IF NOT EXISTS i_recensione_prod ON recensione(prodotto);
      CREATE INDEX IF NOT EXISTS i_recensione_inst ON recensione(installatore);
      CREATE INDEX IF NOT EXISTS i_passkey_ut ON passkey(utente);
      CREATE INDEX IF NOT EXISTS i_collaboratore_ut ON collaboratore(utente);
      CREATE INDEX IF NOT EXISTS i_contatto_inst ON contatto(installatore);
      -- la ricerca nel catalogo: indice full-text tenuto allineato dai trigger
      CREATE VIRTUAL TABLE IF NOT EXISTS prodotto_fts USING fts5(nome, descrizione, repo, categoria, content='prodotto', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS prodotto_fts_i AFTER INSERT ON prodotto BEGIN
        INSERT INTO prodotto_fts(rowid, nome, descrizione, repo, categoria) VALUES (new.id, new.nome, new.descrizione, new.repo, new.categoria); END;
      CREATE TRIGGER IF NOT EXISTS prodotto_fts_d AFTER DELETE ON prodotto BEGIN
        INSERT INTO prodotto_fts(prodotto_fts, rowid, nome, descrizione, repo, categoria) VALUES ('delete', old.id, old.nome, old.descrizione, old.repo, old.categoria); END;
      CREATE TRIGGER IF NOT EXISTS prodotto_fts_u AFTER UPDATE OF nome, descrizione, repo, categoria ON prodotto BEGIN
        INSERT INTO prodotto_fts(prodotto_fts, rowid, nome, descrizione, repo, categoria) VALUES ('delete', old.id, old.nome, old.descrizione, old.repo, old.categoria);
        INSERT INTO prodotto_fts(rowid, nome, descrizione, repo, categoria) VALUES (new.id, new.nome, new.descrizione, new.repo, new.categoria); END;
      INSERT INTO prodotto_fts(prodotto_fts) VALUES ('rebuild');
      UPDATE sessione SET creata = datetime('now') WHERE creata = '';
    `);
  },
  db => {   // 3: la garanzia per chi compra: la conferma dell'installazione, le contestazioni, il legame quota → acquisto
    db.exec(`
      ALTER TABLE cliente ADD COLUMN confermato TEXT;
      ALTER TABLE quota ADD COLUMN cliente TEXT;
      UPDATE quota SET cliente = abbonamento WHERE abbonamento IS NOT NULL;
      UPDATE quota SET cliente = fattura WHERE cliente IS NULL AND fattura LIKE 'cr_%';
      CREATE TABLE IF NOT EXISTS contestazione (
        id INTEGER PRIMARY KEY, cliente TEXT NOT NULL REFERENCES cliente(chiave), email TEXT, testo TEXT NOT NULL,
        stato TEXT NOT NULL DEFAULT 'aperta', esito TEXT, importo INTEGER NOT NULL DEFAULT 0, nota TEXT,
        creata TEXT NOT NULL DEFAULT (datetime('now')), chiusa TEXT);
      CREATE INDEX IF NOT EXISTS i_contestazione_stato ON contestazione(stato);
      CREATE INDEX IF NOT EXISTS i_quota_cliente ON quota(cliente);
    `);
  },
  db => {   // 4: l'escrow sulle reti EVM: l'ordine ricorda il contratto e il suo stato lì (custodia); le quote nascono «in_escrow»
    aggiungi(db, 'ordine', ['escrow TEXT', 'custodia TEXT', 'sblocco TEXT', 'congelato TEXT', 'blocco INTEGER', 'esito TEXT', 'controllato TEXT', 'avvisato TEXT']);
    db.exec('CREATE INDEX IF NOT EXISTS i_ordine_custodia ON ordine(custodia, controllato) WHERE escrow IS NOT NULL');
  },
  db => {   // 5: la divisione fissa fra chi sviluppa (80%) e chi installa (20%); i due possono accordarsi diversamente, 1:1, prodotto per
    // prodotto: adozione.quota è la parte concordata (NULL = quella della piattaforma), la proposta aspetta la risposta dell'altro.
    // L'ordine in crypto ricorda la parte valida quando è nato. Le quote dei prodotti non le sceglie più il builder.
    aggiungi(db, 'adozione', ['quota REAL', 'accordo TEXT', 'proposta REAL', 'proposta_da TEXT', 'proposta_nota TEXT', 'proposta_il TEXT']);
    aggiungi(db, 'ordine', ['quota REAL']);
    db.exec('UPDATE prodotto SET quota_avvio = 0.20, quota_mese = 0.20');
  },
  db => {   // 6: la guida d'installazione a passi (interattiva sulla pagina del prodotto) e le idee di applicazione, in JSON
    aggiungi(db, 'prodotto', ['installazione TEXT', 'idee TEXT']);
  },
  db => {   // 7: l'assistenza e i pagamenti che non arrivano.
    // cliente.pagamento: regolare | in_arrivo (addebito SEPA partito, soldi non ancora arrivati) | in_ritardo (un addebito non è andato,
    // Stripe riprova) | insoluto (finiti i tentativi); insoluto_dal fa partire i giorni di grazia. assistenza_fino: dove l'assistenza è
    // pagata in anticipo (crypto) fin quando vale. assistenza: il codice segreto dell'installazione, per la bolla e la pagina di
    // assistenza (chi lo ha può solo chiedere aiuto, non vede pagamenti né dati). disdetta: l'abbonamento finisce a quella data.
    // richiesta e messaggio: le richieste di assistenza, con le risposte di chi installa (e di chi sviluppa, se coinvolto).
    // ordine.rinnovo: l'ordine in crypto che rinnova l'assistenza di quel cliente (senza installazione).
    aggiungi(db, 'cliente', ["pagamento TEXT NOT NULL DEFAULT 'regolare'", 'insoluto_dal TEXT', 'assistenza_fino TEXT', 'assistenza TEXT', 'periodo TEXT', 'disdetta TEXT', 'avvisi TEXT']);
    aggiungi(db, 'ordine', ['rinnovo TEXT']);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS i_cliente_assistenza ON cliente(assistenza) WHERE assistenza IS NOT NULL;
      CREATE INDEX IF NOT EXISTS i_cliente_pagamento ON cliente(pagamento) WHERE pagamento != 'regolare';
      CREATE TABLE IF NOT EXISTS richiesta (
        id INTEGER PRIMARY KEY, cliente TEXT NOT NULL REFERENCES cliente(chiave), prodotto INTEGER REFERENCES prodotto(id), installatore INTEGER REFERENCES utente(id),
        titolo TEXT NOT NULL, urgente INTEGER NOT NULL DEFAULT 0, stato TEXT NOT NULL DEFAULT 'aperta', builder INTEGER REFERENCES utente(id), email TEXT,
        canale TEXT NOT NULL DEFAULT 'pagina', creata TEXT NOT NULL DEFAULT (datetime('now')), aggiornata TEXT NOT NULL DEFAULT (datetime('now')),
        attesa_dal TEXT, prima_risposta TEXT, sollecito TEXT, segnalata TEXT, chiusa TEXT);
      CREATE TABLE IF NOT EXISTS messaggio (
        id INTEGER PRIMARY KEY, richiesta INTEGER NOT NULL REFERENCES richiesta(id) ON DELETE CASCADE, chi TEXT NOT NULL, utente INTEGER REFERENCES utente(id),
        nome TEXT NOT NULL DEFAULT '', testo TEXT NOT NULL, creato TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE INDEX IF NOT EXISTS i_richiesta_cliente ON richiesta(cliente, aggiornata);
      CREATE INDEX IF NOT EXISTS i_richiesta_inst ON richiesta(installatore, stato);
      CREATE INDEX IF NOT EXISTS i_richiesta_builder ON richiesta(builder, stato) WHERE builder IS NOT NULL;
      CREATE INDEX IF NOT EXISTS i_messaggio_richiesta ON messaggio(richiesta, id);
    `);
    // chi ha già pagato in crypto: l'assistenza vale per i mesi pagati, dal giorno del pagamento (solo se il prodotto ha un canone)
    db.exec(`UPDATE cliente SET assistenza_fino = (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', cliente.creato, '+' || o.mesi || ' months') FROM ordine o
      JOIN prodotto p ON p.id = o.prodotto WHERE o.codice = substr(cliente.chiave, 4) AND p.prezzo_mese > 0) WHERE chiave LIKE 'cr_%' AND assistenza_fino IS NULL`);
  },
  db => {   // 8: la licenza controllata a mano da chi gestisce la piattaforma, quando GitHub non la riconosce (NOASSERTION) o non è
    // open source: licenza_tipo «aperta» (uso libero, anche commerciale) o «interna» (source-available, come n8n o Elastic: si usa
    // gratis per la propria attività, sul proprio server; qui si vendono solo installazione e assistenza). licenza_verificata: la
    // sincronizzazione con GitHub non la tocca più. base_nome/base_url: la piattaforma su cui il progetto si appoggia («costruito su n8n»).
    aggiungi(db, 'prodotto', ["licenza_tipo TEXT NOT NULL DEFAULT 'aperta'", 'licenza_nome TEXT', 'licenza_nota TEXT', 'licenza_fonte TEXT', 'licenza_verificata TEXT', 'base_nome TEXT', 'base_url TEXT']);
  },
  db => {   // 9: i controlli di sicurezza (server/sicurezza.js): uno per versione e uno a settimana; la release si annuncia a chi installa
    // solo dopo il controllo (versione.avvisata), e non si annuncia se è grave. Le versioni già viste contano come annunciate.
    aggiungi(db, 'versione', ['controllo TEXT', 'avvisata TEXT']);
    db.exec(`
      UPDATE versione SET avvisata = vista WHERE avvisata IS NULL;
      CREATE TABLE IF NOT EXISTS controllo (
        id INTEGER PRIMARY KEY, prodotto INTEGER NOT NULL REFERENCES prodotto(id) ON DELETE CASCADE, versione TEXT, esito TEXT NOT NULL,
        punteggio REAL, dettagli TEXT NOT NULL DEFAULT '[]', creato TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE INDEX IF NOT EXISTS i_controllo_prodotto ON controllo(prodotto, id);
      CREATE INDEX IF NOT EXISTS i_versione_avvisata ON versione(avvisata) WHERE avvisata IS NULL;
    `);
  },
  db => {   // 10: il programma partner dell'azienda che sviluppa un prodotto: chi lo vuole offrire ne rispetta le condizioni (con il link
    // per aderire); con programma_obbligatorio, finché non lo conferma (adozione.programma_accettato) non compare fra chi lo installa e
    // non vende. ref_url/ref_testo: il link referral di Repobay verso i piani a pagamento o il cloud dell'azienda.
    aggiungi(db, 'prodotto', ['programma_nome TEXT', 'programma_url TEXT', 'programma_termini TEXT', 'programma_obbligatorio INTEGER NOT NULL DEFAULT 0', 'ref_url TEXT', 'ref_testo TEXT']);
    aggiungi(db, 'adozione', ['programma_accettato TEXT']);
  },
  db => {   // 11: il corso per installatori (server/corso.js). utente.corso: quando ha superato il test (con corso_punti), senza non offre
    // programmi; utente.esperto: chi gestisce la piattaforma gli ha sbloccato i programmi impegnativi. prova: i test, con le domande
    // estratte e l'ordine delle opzioni mostrato (le risposte giuste restano nel file del corso)
    aggiungi(db, 'utente', ['corso TEXT', 'corso_punti INTEGER', 'esperto TEXT']);
    db.exec(`
      CREATE TABLE IF NOT EXISTS prova (
        id INTEGER PRIMARY KEY, utente INTEGER NOT NULL REFERENCES utente(id) ON DELETE CASCADE, domande TEXT NOT NULL,
        iniziata TEXT NOT NULL, scade TEXT NOT NULL, consegnata TEXT, giuste INTEGER, superata INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS i_prova_utente ON prova(utente, id);
    `);
  },
  db => {   // 12: gli aggiornamenti garantiti da chi sviluppa, una riga mensile facoltativa a prezzo suo (prodotto.prezzo_aggiornamenti,
    // con aggiornamenti_testo: cosa promette). Si divide al contrario dell'assistenza: l'80% a chi sviluppa. cliente.aggiornamenti:
    // il prezzo al mese scelto alla vendita (NULL = senza); ordine.aggiornamenti: quanto vale la riga nell'ordine in crypto
    aggiungi(db, 'prodotto', ['prezzo_aggiornamenti INTEGER NOT NULL DEFAULT 0', 'aggiornamenti_testo TEXT']);
    aggiungi(db, 'cliente', ['aggiornamenti INTEGER']);
    aggiungi(db, 'ordine', ['aggiornamenti INTEGER']);
  },
  db => {   // 13: chi vende decide il prezzo dell'installazione (adozione.prezzo_avvio; quelli che offrivano già partono dal prezzo di
    // riferimento del prodotto), chi sviluppa sceglie la sua percentuale (prodotto.percentuale, NULL = quella della piattaforma).
    // ordine.avvio: il prezzo dell'installazione fissato nell'ordine in crypto. mancia: chi sviluppa ringrazia chi vende i suoi
    // prodotti (con la carta; la quota di chi la riceve nasce quando Stripe conferma il pagamento)
    aggiungi(db, 'prodotto', ['percentuale REAL']);
    aggiungi(db, 'adozione', ['prezzo_avvio INTEGER']);
    aggiungi(db, 'ordine', ['avvio INTEGER']);
    db.exec(`
      UPDATE adozione SET prezzo_avvio = (SELECT p.prezzo_avvio FROM prodotto p WHERE p.id = adozione.prodotto) WHERE prezzo_avvio IS NULL;
      UPDATE ordine SET avvio = CASE WHEN rinnovo IS NOT NULL THEN 0 ELSE (SELECT p.prezzo_avvio FROM prodotto p WHERE p.id = ordine.prodotto) END WHERE avvio IS NULL;
      CREATE TABLE IF NOT EXISTS mancia (
        id INTEGER PRIMARY KEY, da INTEGER NOT NULL REFERENCES utente(id), a INTEGER NOT NULL REFERENCES utente(id), prodotto INTEGER REFERENCES prodotto(id),
        importo INTEGER NOT NULL, nota TEXT, sessione TEXT UNIQUE, stato TEXT NOT NULL DEFAULT 'aperta', creata TEXT NOT NULL DEFAULT (datetime('now')), pagata TEXT);
      CREATE INDEX IF NOT EXISTS i_mancia_a ON mancia(a, stato);
      CREATE INDEX IF NOT EXISTS i_mancia_da ON mancia(da, stato);
      CREATE INDEX IF NOT EXISTS i_cliente_vendite ON cliente(prodotto, installatore);
    `);
  },
  db => {   // 14: perché il canone valga sempre la pena. cliente.sito: l'indirizzo del programma installato, controllato da fuori
    // (sito_stato su|giu, sito_dal: da quando, sito_controllato, sito_errori: fallimenti di fila, cert_scade: il certificato HTTPS);
    // controllo_sito: i controlli (per la disponibilità del mese); cliente.rapporto: l'ultimo mese del rapporto mandato; riattivato:
    // la chiave dell'abbonamento che l'ha sostituito. richiesta.a_chiamata: un intervento chiesto senza assistenza attiva, a tariffa
    // oraria (preventivo_ore, preventivo_sessione: il pagamento su Stripe, pagata)
    aggiungi(db, 'cliente', ['sito TEXT', 'sito_stato TEXT', 'sito_dal TEXT', 'sito_controllato TEXT', 'sito_errori INTEGER NOT NULL DEFAULT 0', 'cert_scade TEXT',
      'rapporto TEXT', 'riattivato TEXT']);
    aggiungi(db, 'richiesta', ['a_chiamata INTEGER NOT NULL DEFAULT 0', 'preventivo_ore REAL', 'preventivo_sessione TEXT', 'pagata TEXT']);
    db.exec(`
      CREATE TABLE IF NOT EXISTS controllo_sito (
        id INTEGER PRIMARY KEY, cliente TEXT NOT NULL REFERENCES cliente(chiave) ON DELETE CASCADE, quando TEXT NOT NULL, ok INTEGER NOT NULL,
        codice INTEGER, ms INTEGER, errore TEXT);
      CREATE INDEX IF NOT EXISTS i_controllo_sito ON controllo_sito(cliente, quando);
      CREATE INDEX IF NOT EXISTS i_cliente_sito ON cliente(sito_controllato) WHERE sito IS NOT NULL;
    `);
  },
  db => {   // 15: le attività per cui un prodotto è consigliato (prodotto.attivita, JSON di tag dal vocabolario in server/attivita.js):
    // alimentano la scheda («Consigliato per»), il confronto fra due prodotti e lo smistamento del «Richiedi l'installazione».
    // I prodotti già in catalogo partono dal valore predefinito della loro categoria; builder e chi gestisce li affinano dal modulo
    aggiungi(db, 'prodotto', ['attivita TEXT']);
    const PER_CATEGORIA = {
      gestionale: ['negozio', 'bar', 'ristorante', 'ferramenta', 'artigiano', 'studio professionale'],
      cassa: ['bar', 'ristorante', 'pizzeria', 'negozio', 'alimentari'],
      prenotazioni: ['parrucchiere', 'barbiere', 'estetista', 'studio medico', 'palestra', 'hotel'],
      sito: ['negozio', 'artigiano', 'studio professionale', 'associazione', 'hotel', 'b&b'],
      ecommerce: ['negozio', 'negozio online', 'artigiano', 'alimentari'],
      magazzino: ['ferramenta', 'negozio', 'alimentari', 'artigiano'],
      contabilità: ['artigiano', 'studio professionale', 'negozio', 'associazione'],
      crm: ['studio professionale', 'agenzia', 'artigiano'],
      comunicazione: ['negozio', 'studio professionale', 'associazione', 'agenzia', 'hotel'],
      sanità: ['studio medico', 'farmacia'],
      ristorazione: ['bar', 'ristorante', 'pizzeria'],
      scuola: ['scuola', 'associazione'],
    };
    const agg = db.prepare('UPDATE prodotto SET attivita = ? WHERE id = ? AND (attivita IS NULL OR attivita = \'\')');
    for (const p of db.prepare('SELECT id, categoria FROM prodotto').all())
      if (PER_CATEGORIA[p.categoria]) agg.run(JSON.stringify(PER_CATEGORIA[p.categoria]), p.id);
  },
  db => {   // 16: i pagamenti diretti sul conto della piattaforma, con bonifico (server/bonifico.js) o con carta dal POS virtuale della
    // banca (server/pos.js); le rotte in rotte/bonifico.js. codice: il segreto della pagina d'attesa del cliente; causale: quella da
    // scrivere nel bonifico (RB-XXXXXX), l'unica cosa che si vede sull'estratto conto (con la carta sta dentro il codice della
    // transazione, transazione: l'ultimo tentativo). Importi in centesimi: euro il totale, avvio l'installazione, aggiornamenti la riga
    // facoltativa, extra la riattivazione nei rinnovi; il resto è il canone dei mesi in anticipo. Le quote di chi sviluppa restano
    // «manuale»: le versa a mano chi ha incassato
    db.exec(`CREATE TABLE bonifico (id INTEGER PRIMARY KEY, codice TEXT NOT NULL UNIQUE, causale TEXT NOT NULL UNIQUE,
      metodo TEXT NOT NULL DEFAULT 'bonifico', transazione TEXT,
      prodotto INTEGER NOT NULL REFERENCES prodotto(id), installatore INTEGER NOT NULL REFERENCES utente(id),
      euro INTEGER NOT NULL, avvio INTEGER NOT NULL DEFAULT 0, aggiornamenti INTEGER NOT NULL DEFAULT 0, extra INTEGER NOT NULL DEFAULT 0,
      mesi INTEGER NOT NULL, quota REAL NOT NULL, rinnovo TEXT, email TEXT NOT NULL, nome TEXT, lingua TEXT,
      stato TEXT NOT NULL DEFAULT 'aperto', creato TEXT NOT NULL DEFAULT (datetime('now')), scade TEXT NOT NULL, pagato TEXT, nota TEXT);
      CREATE INDEX bonifico_stato ON bonifico(stato);`);
  },
  db => {   // 17: l'acquisto dalla cassa (/compra) e la sua installazione (/installa/<codice>, server/rotte/acquisto.js). codice: il segreto
    // della pagina d'installazione e dello script; dove: «mio» (sul server del cliente, con un comando), «installatore» (fa tutto chi
    // installa, anche il server), «insieme» (decidono a voce). stato: aperto → pagato / in_arrivo (SEPA) / respinto, o prenotato nel
    // prelancio. installazione: da_fare → in_corso → online, o errore; passi: quello che lo script ha raccontato ([{passo, testo, il}]);
    // indirizzo: dove risponde il programma. personalizza: le voci che chi installa sistema con il cliente ({voce: stato}).
    // appuntamento: le preferenze del cliente per la chiamata o la visita. prodotto.ricetta: come si installa da solo (il compose e i
    // valori predefiniti), se chi sviluppa non usa il docker-compose del repository; bonifico.acquisto: l'acquisto pagato con il bonifico
    db.exec(`CREATE TABLE acquisto (id INTEGER PRIMARY KEY, codice TEXT NOT NULL UNIQUE,
      prodotto INTEGER NOT NULL REFERENCES prodotto(id), installatore INTEGER NOT NULL REFERENCES utente(id),
      attivita TEXT, nome TEXT, email TEXT NOT NULL, telefono TEXT, dominio TEXT, dove TEXT NOT NULL DEFAULT 'mio',
      periodo TEXT NOT NULL DEFAULT 'mese', aggiornamenti INTEGER NOT NULL DEFAULT 0, lingua TEXT,
      metodo TEXT, sessione TEXT, cliente TEXT, stato TEXT NOT NULL DEFAULT 'aperto',
      installazione TEXT NOT NULL DEFAULT 'da_fare', passi TEXT NOT NULL DEFAULT '[]', indirizzo TEXT, ip TEXT,
      personalizza TEXT NOT NULL DEFAULT '{}', appuntamento TEXT, confermato TEXT,
      creato TEXT NOT NULL DEFAULT (datetime('now')), aggiornato TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE INDEX acquisto_installatore ON acquisto(installatore, stato);
      CREATE INDEX acquisto_cliente ON acquisto(cliente);`);
    // l'agente di supporto che lo script installa sul server del cliente (server/installa.js): agente è l'hash del suo gettone.
    // perizia: le richieste di chi installa (o della squadra) per controllare il server da lontano, che il titolare accetta o rifiuta.
    // tipo: «diagnosi» (un rapporto in sola lettura) o «accesso» (una chiave SSH a tempo); stato: chiesta → accettata → in_corso →
    // fatta, oppure rifiutata, revocata, scaduta. rapporto: quello che l'agente ha raccolto (password nascoste)
    aggiungi(db, 'acquisto', ['agente TEXT', 'agente_visto TEXT']);
    db.exec(`CREATE TABLE perizia (id INTEGER PRIMARY KEY, acquisto INTEGER NOT NULL REFERENCES acquisto(id), chi INTEGER REFERENCES utente(id),
      tipo TEXT NOT NULL, motivo TEXT NOT NULL, chiave TEXT, ore INTEGER NOT NULL DEFAULT 2, stato TEXT NOT NULL DEFAULT 'chiesta',
      chiesta TEXT NOT NULL DEFAULT (datetime('now')), decisa TEXT, scade TEXT, rapporto TEXT, ip TEXT, finita TEXT);
      CREATE INDEX perizia_acquisto ON perizia(acquisto, stato);`);
    aggiungi(db, 'prodotto', ['ricetta TEXT']);
    aggiungi(db, 'bonifico', ['acquisto TEXT']);
  },
  db => {   // 18: gli owner di un repository oltre a chi l'ha rivendicato: chi ha il permesso admin o maintain su GitHub (lo dimostra
    // entrando con il suo GitHub, nessuno lo può aggiungere o togliere al posto suo). Si dividono la parte di chi sviluppa in proporzione
    // ai commit (prodotto.contributi: {github_id: commit}, riletti da GitHub con la sincronizzazione), dai pagamenti dopo il loro
    // ingresso. stato: attivo, uscito (ha lasciato, o GitHub non gli dà più il permesso)
    db.exec(`CREATE TABLE cotitolare (prodotto INTEGER NOT NULL REFERENCES prodotto(id) ON DELETE CASCADE, utente INTEGER NOT NULL REFERENCES utente(id),
      github_id INTEGER NOT NULL, permesso TEXT NOT NULL, stato TEXT NOT NULL DEFAULT 'attivo', entrato TEXT NOT NULL DEFAULT (datetime('now')),
      verificato TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (prodotto, utente));
      CREATE INDEX i_cotitolare_ut ON cotitolare(utente);`);
    aggiungi(db, 'prodotto', ['contributi TEXT', 'contributi_letti TEXT']);
  },
  db => {   // 19: perché una quota è ferma (stato «contestata»): una contestazione su Stripe, una segnalazione dal sito, o tutte e due;
    // riparte solo quando non ce n'è più nessuna. acquisto.agente_prec: il gettone dell'agente di prima, che vale finché lo script nuovo
    // non si fa sentire (scaricare lo script, anche solo per guardarlo, non stacca l'agente già installato)
    aggiungi(db, 'quota', ['ferma_stripe INTEGER NOT NULL DEFAULT 0', 'ferma_segnalazione INTEGER NOT NULL DEFAULT 0']);
    db.exec("UPDATE quota SET ferma_segnalazione = 1 WHERE stato = 'contestata'");
    aggiungi(db, 'acquisto', ['agente_prec TEXT']);
  },
];

export function apriDb(cartella) {
  if (cartella !== ':memory:') mkdirSync(cartella, { recursive: true });
  const db = new DatabaseSync(cartella === ':memory:' ? ':memory:' : join(cartella, 'officina.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  let v = db.prepare('PRAGMA user_version').get().user_version;
  for (; v < MIGRAZIONI.length; v++) {
    db.exec('PRAGMA foreign_keys = OFF; BEGIN');   // le chiavi esterne si spengono fuori dalla transazione (la ricostruzione di quota)
    try { MIGRAZIONI[v](db); db.exec(`PRAGMA user_version = ${v + 1}; COMMIT`); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

// una transazione: tutto o niente
export function insieme(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
