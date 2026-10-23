// Le impostazioni, tutte da variabili d'ambiente (vedi docs/AVVIO.md). Prezzi in centesimi di euro, quote in frazioni
// (0.10 = 10%). Le chiavi (Stripe, GitHub, posta, Telegram) non stanno mai nel codice né nel database.
// Le variabili della piattaforma si chiamano APP_* (APP_NOME, APP_URL…): il nome del marchio non è scritto da nessuna parte,
// si cambia con APP_NOME. Le vecchie OFFICINA_* valgono ancora.
import { ibanValido } from './bonifico.js';

export function leggiConfig(env = process.env) {
  const v = n => env[`APP_${n}`] ?? env[`OFFICINA_${n}`];
  const num = (n, def, val = env[n]) => { if (val === undefined || val === '') return def; const x = Number(val); if (!Number.isFinite(x)) throw new Error(`${n} non è un numero: ${val}`); return x; };
  const si = (val, def = false) => val === undefined || val === '' ? def : /^(1|si|sì|true|yes|on)$/i.test(val);
  const porta = num('APP_PORTA', 4600, v('PORTA'));
  const c = {
    nome: v('NOME') || 'Repobay',
    porta,
    host: v('HOST') || undefined,   // dietro un proxy (Caddy): 127.0.0.1, così nessuno arriva alla porta saltandolo
    cloudflare: si(v('CLOUDFLARE')),   // dietro Cloudflare Tunnel: l'indirizzo di chi visita viene da CF-Connecting-IP (vedi ipDi)
    dati: v('DATI') || 'dati',
    url: (v('URL') || `http://localhost:${porta}`).replace(/\/+$/, ''),   // l'indirizzo pubblico (link di ritorno di Stripe e GitHub, email)
    admin: (v('ADMIN') || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean),   // email o login GitHub che vedono il pannello
    segreto: v('SEGRETO') || '',   // cifra gettoni e dati fiscali nel database; se manca se ne crea uno nella cartella dei dati
    lingua: v('LINGUA') || 'it',   // la lingua predefinita delle pagine (it o en); ognuno poi sceglie la sua
    // il repository pubblico del codice (https://github.com/…): /versione ci collega il commit che gira
    repository: /^https:\/\/[\w.-]+\/[\w.\/-]+$/.test(v('REPOSITORY') || '') ? v('REPOSITORY').replace(/\/+$/, '') : '',
    pwned: si(v('PWNED')),
    agganciLocali: si(v('AGGANCI_LOCALI')),   // solo per le prove: webhook verso localhost
    prelancio: si(v('PRELANCIO')),   // prima di poter incassare: niente pagamenti, i business chiedono un preventivo all'installatore
    // i pagamenti sui progetti non rivendicati: spenti finché l'avvocato non decide dove vanno i soldi di chi non rivendica.
    // Spenti, quei progetti stanno in vetrina e prendono solo richieste di preventivo, anche a prelancio finito
    nonRivendicatiPagamenti: si(v('NON_RIVENDICATI_PAGAMENTI')),
    nonRivendicati: si(v('NON_RIVENDICATI')),   // i progetti messi in vetrina prima che il maintainer si iscriva (vedi docs)         // controlla le password nuove su Have I Been Pwned (k-anonimato: escono solo 5 caratteri dell'hash)
    stripe: {
      chiave: env.STRIPE_CHIAVE || '',          // sk_test_… o sk_live_… (o una chiave con restrizioni rk_…)
      // pk_test_… o pk_live_…: con questa la cassa incorpora il pagamento nella pagina (Embedded Checkout); senza, si va su Stripe e si torna
      pubblica: /^pk_(test|live)_[A-Za-z0-9]{10,}$/.test(env.STRIPE_PUBBLICA || '') ? env.STRIPE_PUBBLICA : '',
      firme: (env.STRIPE_FIRMA || '').split(',').map(s => s.trim()).filter(Boolean),   // whsec_… dei webhook, separati da virgola
      base: (env.STRIPE_BASE || 'https://api.stripe.com').replace(/\/+$/, ''),
      paese: env.STRIPE_PAESE || 'IT',          // il paese dei conti di builder e installatori
      // «per conto»: il venditore davanti al cliente è l'installatore (on_behalf_of), la piattaforma incassa per conto di
      // builder e installatore e tiene solo la sua parte. Serve che l'installatore abbia un conto Stripe completo.
      perConto: si(env.STRIPE_PER_CONTO),
    },
    github: {
      id: env.GITHUB_CLIENT_ID || '', segreto: env.GITHUB_CLIENT_SECRET || '',   // l'app OAuth (github.com/settings/developers)
      web: (env.GITHUB_WEB || 'https://github.com').replace(/\/+$/, ''),
      api: (env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, ''),
      ogniOre: num('GITHUB_ORE', 6),        // ogni quante ore si rileggono release, README, stelle e licenza dei prodotti
    },
    posta: {   // le email: POSTA_DRIVER = console | file | smtp | resend | postmark | brevo | sendgrid | mailgun
      driver: env.POSTA_DRIVER || 'console',
      // il mittente di base: noreply@ il dominio del sito; in locale (localhost, senza punto) un dominio .localhost valido
      da: env.POSTA_DA || `${v('NOME') || 'Repobay'} <noreply@${(h => (h.includes('.') ? h : 'repobay.localhost'))(new URL((v('URL') || 'http://localhost').replace(/\/+$/, '')).hostname)}>`,
      chiave: env.POSTA_CHIAVE || '', dominio: env.POSTA_DOMINIO || '', regione: env.POSTA_REGIONE || '',
      cartella: env.POSTA_CARTELLA || '',
      smtp: { host: env.SMTP_HOST || '', porta: num('SMTP_PORTA', 587), sicuro: si(env.SMTP_SICURO), utente: env.SMTP_UTENTE || '', parola: env.SMTP_PAROLA || '' },
    },
    telegram: { bot: env.TELEGRAM_BOT || '', nome: env.TELEGRAM_NOME || '' },   // il gettone del bot (@BotFather) e il suo nome utente
    valuta: 'eur',
    crypto: {   // i pagamenti in crypto, diretti dal wallet del business ai wallet di builder, installatore e piattaforma
      wallet: v('WALLET') || '',   // l'indirizzo EVM che riceve la parte della piattaforma (solo l'indirizzo: nessuna chiave qui)
      altri: { solana: env.WALLET_SOLANA || '', bitcoin: env.WALLET_BITCOIN || '', tron: env.WALLET_TRON || '' },   // le altre reti
      reti: (v('RETI') || 'base,ethereum,arbitrum,polygon').split(',').map(s => s.trim()).filter(Boolean),
      rpc: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('RPC_')).map(([k, x]) => [k.slice(4).toLowerCase().replace(/_/g, '-'), x])),
      // il contratto escrow su ogni rete EVM (ESCROW_BASE, ESCROW_BASE_SEPOLIA…): dove c'è, il pagamento resta nel contratto finché il
      // cliente non conferma l'installazione; dove manca, va dritto nei wallet come prima
      escrow: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('ESCROW_') && k !== 'ESCROW_ARBITRO').map(([k, x]) => [k.slice(7).toLowerCase().replace(/_/g, '-'), x.trim()]).filter(([, x]) => x)),
      prezzi: (env.PREZZI_URL || 'https://api.coingecko.com/api/v3').replace(/\/+$/, ''),
      mesi: num('CRYPTO_MESI', 12),          // in crypto l'assistenza si paga in anticipo per tanti mesi
      validita: num('CRYPTO_MINUTI', 30),    // per quanti minuti vale il prezzo di un ordine
      chiaveTron: env.TRONGRID_CHIAVE || '',   // TronGrid senza chiave risponde 429 dopo poche richieste
    },
    // il bonifico (server/bonifico.js): all'IBAN della piattaforma, con una causale per ordine, segnato ricevuto dal pannello.
    // Senza nessuno in mezzo, quindi si offre solo quando a installare è chi gestisce la piattaforma (i soldi sono suoi: la parte
    // di chi sviluppa, se c'è, la versa lui a mano). Vale anche nel prelancio. L'assistenza si paga in anticipo per BONIFICO_MESI
    bonifico: {
      iban: env.BONIFICO_IBAN ? env.BONIFICO_IBAN.replace(/[\s-]+/g, '').toUpperCase() : '',
      intestatario: (env.BONIFICO_INTESTATARIO || '').trim(),
      bic: (env.BONIFICO_BIC || '').replace(/\s+/g, '').toUpperCase(),
      mesi: num('BONIFICO_MESI', 12),
      giorni: num('BONIFICO_GIORNI', 10),   // per quanti giorni vale un ordine prima di scadere (si può segnare ricevuto anche dopo)
    },
    piattaformaBonifico: num('QUOTA_PIATTAFORMA_BONIFICO', 0.05),   // la parte della piattaforma su cui si calcola quella di chi sviluppa
    // la carta dal POS virtuale della banca (server/pos.js), nessuna piattaforma in mezzo: alias e chiave segreta li dà la banca
    // quando attiva il servizio sul conto aziendale. Stesso ordine e stesse regole del bonifico (incassa chi gestisce la piattaforma)
    pos: { gateway: env.POS_GATEWAY || 'nexi', alias: (env.POS_ALIAS || '').trim(), chiave: env.POS_CHIAVE || '', prova: si(env.POS_PROVA) },
    // la parte della piattaforma sulle vendite (installazioni, aggiornamenti, mance): 5% con carta, 1% in crypto (scelte
    // dell'utente, 14 ottobre 2026: «10% è troppo»). Con carta, prima si toglie il costo vero di Stripe (letto dal pagamento,
    // senza ricarico: CARTA_COSTO_STRIPE=0 lo lascia a carico della piattaforma, come prima); poi la divisione. Il sovrapprezzo
    // al cliente per la carta non si fa: con le carte dei consumatori è vietato (PSD2, art. 62)
    piattaforma: num('QUOTA_PIATTAFORMA', 0.05),
    piattaformaCrypto: num('QUOTA_PIATTAFORMA_CRYPTO', 0.01),
    costoStripe: env.CARTA_COSTO_STRIPE !== '0',
    // la stima del costo di Stripe per le pagine (prima di pagare): carte europee standard, 1,5% + 0,25 €. Dopo il pagamento conta
    // quello vero, letto dalla transazione
    stimaStripe: { percentuale: num('STRIPE_STIMA_PERCENTUALE', 0.015), fisso: num('STRIPE_STIMA_FISSO', 25) },
    // chi vende decide il prezzo dell'installazione (adozione.prezzo_avvio); chi sviluppa sceglie solo la sua percentuale su quello
    // che resta dopo la piattaforma (prodotto.percentuale, da 0 a PERCENTUALE_MASSIMA). Se non la sceglie vale il resto di
    // QUOTA_INSTALLATORE: 20% a chi vende, 80% a chi sviluppa (scelta dell'utente, 18 ottobre 2026: «i seller devono guadagnarsi
    // percentuali più alte»): le percentuali più alte chi vende se le guadagna vendendo, con i livelli qui sotto. Nessuno sconto per
    // i clienti arrivati dal link di chi vende. Installatore e builder possono accordarsi su un'altra divisione, fra loro due,
    // prodotto per prodotto (adozione.quota)
    quotaInstallatore: num('QUOTA_INSTALLATORE', 0.20),
    percentualeMax: num('PERCENTUALE_MASSIMA', 0.80),   // chi vende tiene sempre almeno il 20%
    // i livelli di chi vende, prodotto per prodotto: dalla 10ª vendita confermata di uno stesso prodotto la parte di chi sviluppa
    // scende di 13/16 (80% → 65%: chi vende passa al 35%), dalla 25ª a 5/8 (80% → 50%: chi vende al 50%). «vendite:fattore,…»
    // (il fattore anche come frazione: 13/16); vale anche sulle percentuali scelte da chi sviluppa, in proporzione
    livelli: String(env.LIVELLI_VENDITORE ?? '10:13/16,25:5/8').split(',').map(x => x.trim()).filter(Boolean).map(x => {
      const [da, f] = x.split(':'), [a, b = '1'] = String(f).split('/');
      return { da: Number(da), fattore: Number(a) / Number(b) };
    }).sort((a, b) => a.da - b.da),
    // l'assistenza: risponde per primo chi ha installato (è sul posto, conosce il cliente), con la piattaforma dietro, che vede
    // tutto, controlla il programma da fuori, manda il rapporto del mese e interviene se nessuno risponde. Il canone, tolto Stripe,
    // va a chi ha installato (QUOTA_INSTALLATORE_ASSISTENZA, 60%) e alla piattaforma (il resto); chi sviluppa prende
    // QUOTA_SVILUPPATORE_ASSISTENZA (0 per difetto: non può dare assistenza da un altro paese; il suo ricorrente sono gli
    // aggiornamenti garantiti). ASSISTENZA_PIATTAFORMA=0 è il modello vecchio: il canone si divide come l'installazione e la
    // piattaforma non vede le richieste
    assistenzaPiattaforma: env.ASSISTENZA_PIATTAFORMA !== '0',
    quotaInstallatoreAssistenza: num('QUOTA_INSTALLATORE_ASSISTENZA', 0.60),
    quotaSviluppatoreAssistenza: num('QUOTA_SVILUPPATORE_ASSISTENZA', 0),
    // perché il canone valga sempre la pena (senza mai bloccare il programma, art. 392 c.p.): il programma controllato da fuori ogni
    // MONITOR_MINUTI (MONITOR_LOCALI=1 permette gli indirizzi di casa, solo per le prove), il rapporto del mese, l'intervento a chiamata
    // a TARIFFA_ORA per chi non ha l'assistenza, e la riattivazione: chi chiude l'abbonamento (o lascia scadere l'anno in crypto da più
    // di RIATTIVAZIONE_GIORNI) e torna paga RIATTIVAZIONE_MESI mesi di canone
    monitorMinuti: num('MONITOR_MINUTI', 5),
    monitorLocali: si(env.MONITOR_LOCALI),
    tariffaOra: num('TARIFFA_ORA', 9000),
    riattivazioneMesi: num('RIATTIVAZIONE_MESI', 3),
    riattivazioneGiorni: num('RIATTIVAZIONE_GIORNI', 30),
    assistenzaMese: num('ASSISTENZA_MESE', 3750),   // il canone dell'assistenza, uno per tutti i prodotti (37,50 € al mese: 450 € l'anno), finché chi gestisce non lo cambia dal pannello
    manciaMax: num('MANCIA_MASSIMA', 50000),         // le mance di chi sviluppa a chi vende: da PREZZO_MINIMO a 500 €
    // gli aggiornamenti garantiti da chi sviluppa (la riga facoltativa a prezzo suo): il lavoro è suo, quindi tolta la piattaforma
    // va tutto a lui (QUOTA_INSTALLATORE_AGGIORNAMENTI: la parte di chi vende, 0 per difetto)
    quotaInstallatoreAggiornamenti: num('QUOTA_INSTALLATORE_AGGIORNAMENTI', 0),
    prezzoMin: num('PREZZO_MINIMO', 500),          // 5 €: sotto, le commissioni di Stripe si mangiano tutto
    trattenuta: num('TRATTENUTA_GIORNI', 14),      // giorni prima di versare (copre rimborsi e contestazioni)
    ogni: num('CONTROLLO_MINUTI', 10),             // ogni quanto si versano le quote maturate
    copie: num('COPIE_GIORNI', 14),                // quante copie giornaliere del database si tengono (0 = nessuna)
    // l'assistenza: si paga in anticipo (il mese o l'anno che comincia). Se un pagamento non va, Stripe riprova; dopo GRAZIA_GIORNI
    // l'assistenza si sospende (il programma no: è del cliente) e riparte appena il cliente paga
    grazia: num('GRAZIA_GIORNI', 7),
    scontoAnno: num('SCONTO_ANNO', 0.10),          // pagando un anno in anticipo (carta o crypto): 0.10 = 10% in meno
    rispostaOre: num('RISPOSTA_ORE', 24),          // entro quante ore chi installa risponde a una richiesta di assistenza (poi un sollecito)
    // il corso per installatori (server/corso.js): senza il test superato non si offrono programmi; gli impegnativi si sbloccano dopo
    // CORSO_ESPERIENZA installazioni confermate dai clienti (o da chi gestisce la piattaforma). CORSO_OBBLIGATORIO=0 lo spegne
    corso: { obbligatorio: env.CORSO_OBBLIGATORIO !== '0', domande: num('CORSO_DOMANDE', 20), soglia: num('CORSO_SOGLIA', 16),
      attesa: num('CORSO_ATTESA_MINUTI', 60), esperienza: num('CORSO_ESPERIENZA', 3) },
    // i controlli di sicurezza sulle release (server/sicurezza.js): OpenSSF Scorecard sempre; ClamAV e Trivy se installati sul server.
    // Con GitHub finto (le prove) anche Scorecard e gli archivi delle release vanno al server finto
    sicurezza: {
      scorecard: (env.SICUREZZA_SCORECARD || (env.GITHUB_API ? env.GITHUB_API : 'https://api.securityscorecards.dev')).replace(/\/+$/, ''),
      archivi: (env.SICUREZZA_ARCHIVI || (env.GITHUB_WEB ? env.GITHUB_WEB : 'https://codeload.github.com')).replace(/\/+$/, ''),
      clamscan: env.SICUREZZA_CLAMSCAN || '', trivy: env.SICUREZZA_TRIVY || '',
      maxMb: num('SICUREZZA_MAX_MB', 300),
    },
  };
  if (c.crypto.wallet && !/^0x[0-9a-fA-F]{40}$/.test(c.crypto.wallet)) throw new Error('APP_WALLET non è un indirizzo valido');
  for (const [n, a] of Object.entries(c.crypto.escrow)) if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`ESCROW_${n.toUpperCase().replace(/-/g, '_')} non è un indirizzo valido`);
  if (!['it', 'en'].includes(c.lingua)) throw new Error('APP_LINGUA deve essere it o en');
  if (c.piattaformaCrypto < 0 || c.piattaformaCrypto >= 1) throw new Error('QUOTA_PIATTAFORMA_CRYPTO non valida');
  if (c.piattaformaBonifico < 0 || c.piattaformaBonifico >= 1) throw new Error('QUOTA_PIATTAFORMA_BONIFICO non valida');
  if (c.bonifico.iban && !ibanValido(c.bonifico.iban)) throw new Error('BONIFICO_IBAN non è un IBAN valido: copialo dalla tua banca');
  if (c.bonifico.iban && c.bonifico.intestatario.length < 2) throw new Error('Con BONIFICO_IBAN serve BONIFICO_INTESTATARIO: il nome del titolare del conto, come lo vede chi paga');
  if (c.bonifico.bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(c.bonifico.bic)) throw new Error('BONIFICO_BIC non valido');
  if (c.pos.gateway !== 'nexi') throw new Error('POS_GATEWAY: per ora c\'è nexi (XPay, il POS virtuale della maggior parte delle banche italiane)');
  if (!!c.pos.alias !== !!c.pos.chiave) throw new Error('Il POS virtuale vuole sia POS_ALIAS sia POS_CHIAVE: li trovi nella mail di attivazione della banca');
  if (c.pos.alias && !c.url.startsWith('https://') && !c.pos.prova) throw new Error('Il POS virtuale vero vuole APP_URL in https: la banca manda l\'esito solo a indirizzi https');
  // almeno 3 mesi: l'avviso «scade fra 30 giorni» con un mese solo partirebbe il giorno stesso del pagamento
  if (!Number.isInteger(c.bonifico.mesi) || c.bonifico.mesi < 3 || c.bonifico.mesi > 24 || !(c.bonifico.giorni >= 1)) throw new Error('BONIFICO_MESI va da 3 a 24, BONIFICO_GIORNI da 1 in su');
  if (c.piattaforma < 0 || c.piattaforma >= 1) throw new Error('QUOTA_PIATTAFORMA non valida');
  if (!(c.quotaInstallatore >= 0 && c.quotaInstallatore <= 1)) throw new Error('QUOTA_INSTALLATORE va da 0 a 1');
  if (!(c.quotaInstallatoreAggiornamenti >= 0 && c.quotaInstallatoreAggiornamenti <= 1)) throw new Error('QUOTA_INSTALLATORE_AGGIORNAMENTI va da 0 a 1');
  if (!(c.percentualeMax > 0 && c.percentualeMax <= 1)) throw new Error('PERCENTUALE_MASSIMA va da 0.01 a 1');
  if (!(c.quotaSviluppatoreAssistenza >= 0 && c.quotaSviluppatoreAssistenza <= 1)) throw new Error('QUOTA_SVILUPPATORE_ASSISTENZA va da 0 a 1');
  if (!(c.quotaInstallatoreAssistenza >= 0 && c.quotaInstallatoreAssistenza + c.quotaSviluppatoreAssistenza <= 1)) throw new Error('QUOTA_INSTALLATORE_ASSISTENZA va da 0 a 1, e con QUOTA_SVILUPPATORE_ASSISTENZA non supera 1');
  if (!(c.monitorMinuti >= 1) || !(c.tariffaOra >= c.prezzoMin) || !(c.riattivazioneMesi >= 0) || !(c.riattivazioneGiorni >= 0)) throw new Error('MONITOR_MINUTI, TARIFFA_ORA, RIATTIVAZIONE_MESI o RIATTIVAZIONE_GIORNI non validi');
  if (!(c.stimaStripe.percentuale >= 0 && c.stimaStripe.percentuale < 0.2) || !(c.stimaStripe.fisso >= 0)) throw new Error('STRIPE_STIMA_PERCENTUALE o STRIPE_STIMA_FISSO non validi');
  if (c.livelli.some(l => !Number.isInteger(l.da) || l.da < 1 || !(l.fattore >= 0 && l.fattore <= 1))) throw new Error('LIVELLI_VENDITORE: scrivi «vendite:fattore», per esempio 10:13/16,25:5/8');
  if (!(c.assistenzaMese >= 0) || !(c.manciaMax >= c.prezzoMin)) throw new Error('ASSISTENZA_MESE o MANCIA_MASSIMA non validi');
  if (!(c.scontoAnno >= 0 && c.scontoAnno < 1)) throw new Error('SCONTO_ANNO va da 0 a 0.99');
  if (!(c.grazia >= 0) || !(c.rispostaOre > 0)) throw new Error('GRAZIA_GIORNI o RISPOSTA_ORE non validi');
  if (!Number.isInteger(c.corso.domande) || c.corso.domande < 16 || c.corso.domande > 38) throw new Error('CORSO_DOMANDE va da 16 a 38 (due per lezione, al massimo tutta la banca)');
  if (!Number.isInteger(c.corso.soglia) || c.corso.soglia < 1 || c.corso.soglia > c.corso.domande) throw new Error('CORSO_SOGLIA va da 1 al numero di domande');
  if (!(c.corso.attesa >= 0) || !Number.isInteger(c.corso.esperienza) || c.corso.esperienza < 0) throw new Error('CORSO_ATTESA_MINUTI o CORSO_ESPERIENZA non validi');
  return c;
}
