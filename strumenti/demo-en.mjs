// La demo in inglese (DEMO_LINGUA=en): i contenuti scritti dagli utenti finti (prodotti, README, guida, idee, recensioni,
// richieste di assistenza, note, nomi delle attività) tradotti, per le presentazioni a chi non legge l'italiano. L'interfaccia si
// traduce da sola con il dizionario; qui solo i dati. Si applica dopo aver riempito il database: sostituzioni esatte, le più lunghe
// prima, sulle colonne di testo che le pagine mostrano.
import { markdownSicuro } from '../server/markdown.js';

// gli indirizzi dei prodotti e dei repository, in inglese
const SLUG = [['pannello-di-controllo', 'control-panel'], ['agenda-saloni', 'salon-agenda'], ['fattura-libera', 'free-invoice'], ['scaffale', 'shelf'], ['sami-codes/tavoli', 'sami-codes/tables']];

const TESTI = [
  // prodotti
  ['Il gestionale per i negozi di quartiere: cassa, magazzino, clienti e fatture elettroniche in un posto solo.', 'The management app for neighbourhood shops: till, stock, customers and e-invoices in one place.'],
  ['Prenotazioni online per parrucchieri, barbieri ed estetiste, con promemoria su WhatsApp.', 'Online bookings for hairdressers, barbers and beauticians, with WhatsApp reminders.'],
  ['Comande e conto per bar e ristoranti, dal telefono del cameriere alla stampante in cucina.', 'Orders and bills for bars and restaurants, from the waiter’s phone to the kitchen printer.'],
  ['Inventario e ordini per piccoli magazzini, con le etichette da stampare.', 'Inventory and purchase orders for small warehouses, with printable labels.'],
  ['Fatture elettroniche per forfettari e piccole imprese, invio diretto allo SDI.', 'E-invoicing for freelancers and small businesses, sent straight to the Italian tax system.'],
  ['Si installa con Docker in dieci minuti: docker compose up -d, poi si apre il browser e si segue la procedura guidata. Backup automatico ogni notte.', 'Installs with Docker in ten minutes: docker compose up -d, then open the browser and follow the setup wizard. Automatic backup every night.'],
  ['Una versione ogni mese, le correzioni di sicurezza entro 7 giorni e una risposta all\'assistenza sui problemi del codice entro 3 giorni lavorativi.', 'A release every month, security fixes within 7 days and an answer on code issues within 3 working days.'],
  ['Pannello di Controllo', 'Control Panel'], ['Agenda Saloni', 'Salon Agenda'], ['Fattura Libera', 'Free Invoice'], ['Scaffale', 'Shelf'], ['Tavoli', 'Tables'],
  // persone e zone
  ['Sviluppo software per piccoli negozi. Open source da dieci anni.', 'I build software for small shops. Open source for ten years.'],
  ['Installo gestionali e casse nei negozi di Bergamo: sopralluogo, installazione e formazione al personale, in giornata.', 'I install management and till systems in shops around Bergamo: site visit, installation and staff training, same day.'],
  ['Sistemista freelance: server, backup, configurazioni.', 'Freelance sysadmin: servers, backups, configuration.'],
  ['Tutta Italia, da remoto', 'All of Italy, remotely'], ['Bergamo e provincia', 'Bergamo area'], ['Milano', 'Milan'], ['Torino', 'Turin'],
  // le attività che comprano
  ['Cartoleria Russo', 'Russo Stationery'], ['Bar Centrale', 'Central Bar'], ['Caffè Mole', 'Mole Café'], ['Panificio Gatti', 'Gatti Bakery'], ['Barberia 1987', 'Barbershop 1987'],
  ['Panetteria Lingotto', 'Lingotto Bakery'], ['Gelateria Valli', 'Valli Ice Cream'], ['Ferramenta Colombo', 'Colombo Hardware'], ['Ferramenta Pesenti', 'Pesenti Hardware'],
  ['Cartolibreria Rota', 'Rota Books & Stationery'], ['Erboristeria Locatelli', 'Locatelli Herbalist'], ['Ottica Belotti', 'Belotti Opticians'], ['Libreria Arnoldi', 'Arnoldi Bookshop'],
  ['Merceria Gotti', 'Gotti Haberdashery'], ['Enoteca Carrara', 'Carrara Wine Shop'], ['Calzature Bonomi', 'Bonomi Shoes'], ['Profumeria Mazzoleni', 'Mazzoleni Perfumery'], ['Fioreria Testa', 'Testa Florist'],
  // recensioni, note, proposte, contatti
  ['Leo ci ha installato tutto in un pomeriggio e ci ha spiegato la cassa con pazienza. Consigliatissimo.', 'Leo installed everything in one afternoon and patiently showed us the till. Highly recommended.'],
  ['Le comande arrivano subito in cucina. Bene!', 'Orders reach the kitchen instantly. Great!'],
  ['Le clienti prenotano da sole, il telefono finalmente tace.', 'Clients book by themselves, and the phone has finally gone quiet.'],
  ['Prezzo onesto e lavoro pulito: in due ore la cassa era pronta.', 'Fair price and tidy work: the till was ready in two hours.'],
  ['Tutto a posto, la formazione poteva durare un po\' di più.', 'All good, though the training could have been a little longer.'],
  ['Sami è stato velocissimo, il magazzino ora torna.', 'Sami was really quick, and our stock figures finally add up.'],
  ['Grazie a voi, a presto!', 'Thank you, see you soon!'],
  ['Grazie: le tue recensioni sul Control Panel sono le migliori del catalogo.', 'Thanks: your reviews on Control Panel are the best in the catalog.'],
  ['Faccio anche la formazione al personale, due ore in negozio.', 'I also train the staff, two hours in the shop.'],
  ['Ti preparo io la configurazione delle stampanti in cucina.', 'I’ll prepare the kitchen printer setup for you.'],
  ['Ci servirebbe la cassa con il magazzino, abbiamo due postazioni. Quando potete passare?', 'We need the till with stock management, on two workstations. When can you come by?'],
  // le richieste di assistenza
  ['Lo scontrino di cortesia non si stampa', 'The courtesy receipt won’t print'],
  ['Da stamattina la stampante termica non stampa lo scontrino di cortesia. La cassa invece funziona.', 'Since this morning the thermal printer won’t print the courtesy receipt. The till itself works fine.'],
  ['Aggiungere un utente per la commessa', 'Add a user for the new shop assistant'],
  ['Buongiorno, ci serve un accesso per Giulia, la nuova commessa, solo per la cassa.', 'Hello, we need a login for Giulia, our new shop assistant, for the till only.'],
  ['Fatto: Giulia entra con la sua email e vede solo la cassa. Le abbiamo mandato l\'invito.', 'Done: Giulia signs in with her email and only sees the till. We’ve sent her the invitation.'],
  ['La bilancia non passa il peso alla cassa', 'The scale doesn’t send the weight to the till'],
  ['Da quando abbiamo spostato il banco, la bilancia non manda più il peso al Control Panel.', 'Since we moved the counter, the scale no longer sends the weight to Control Panel.'],
  ['Il Control Panel è in ascolto, ma la bilancia non risponde in rete. Chiediamo a Leo, che l\'ha collegata, di passare a controllare il cavo.', 'Control Panel is listening, but the scale doesn’t answer on the network. We’re asking Leo, who connected it, to come and check the cable.'],
  ['Passo domattina alle 9 con un cavo nuovo.', 'I’ll come by tomorrow at 9 with a new cable.'],
  ['Il totale di fine giornata non torna', 'The end-of-day total doesn’t add up'],
  ['Il riepilogo di ieri sera segna 12 € in meno della cassa.', 'Last night’s summary shows €12 less than the till.'],
  ['Era uno scontrino annullato contato due volte: corretto, e la 2.2.1 lo sistema per sempre.', 'A cancelled receipt was counted twice: fixed, and version 2.2.1 solves it for good.'],
  ['Cambiare l\'aliquota di un prodotto', 'Change the VAT rate of a product'],
  ['Le agende vanno al 22%, non al 10%.', 'Diaries should be at 22% VAT, not 10%.'],
  ['Fatto: da oggi le agende escono al 22%.', 'Done: from today diaries go out at 22%.'],
  ['Dopo l\'aggiornamento di macOS la stampante non stampa', 'The printer stopped printing after the macOS update'],
  ['Da quando il Mac si è aggiornato la stampante delle etichette non stampa più i gusti.', 'Since the Mac updated, the label printer no longer prints the flavours.'],
  ['https://cassa.cartoleriarusso.it', 'https://till.russostationery.it'],
];

const README = `# {{PRODOTTO}}

The management app for **neighbourhood shops**: till, stock, customers and e-invoices in one place.

## What it does

- Fast till with a barcode scanner
- Stock with minimum levels and supplier orders
- Customers, loyalty cards and promotions
- E-invoices sent to the Italian tax system (SDI)

## Installation

\`\`\`bash
docker compose up -d
\`\`\`

Then open \`http://localhost:3000\` and follow the setup wizard.

It also works offline: data syncs when the connection comes back.
`;

const INSTALLAZIONE = { tempo: '30 minutes', difficolta: 'facile',
  requisiti: ['A mini PC or a Linux server with Docker', 'At least 2 GB of RAM', 'The receipt printer on the network, if the shop uses the till'],
  passi: [
    { titolo: 'Download the project', testo: 'On the server, in a dedicated folder, download the stable version of Control Panel.', comando: 'git clone https://github.com/marta-dev/control-panel.git\ncd control-panel', verifica: 'The folder contains the docker-compose.yml file.' },
    { titolo: 'Choose the address', testo: 'In the .env file, set the domain the shop will open the app from and the administrator’s email.', comando: 'cp .env.example .env\necho "DOMAIN={{DOMINIO}}" >> .env\necho "ADMIN_EMAIL={{EMAIL}}" >> .env' },
    { titolo: 'Generate the secret key', testo: 'Control Panel encrypts customer data: generate a key and keep it in the shop’s password manager.', comando: 'echo "SECRET=$(openssl rand -hex 24)" >> .env' },
    { titolo: 'Start it', testo: 'The app starts with its database and restarts by itself if the server reboots.', comando: 'docker compose up -d', verifica: 'Open http://{{IP}}:3000: the setup wizard appears.' },
    { titolo: 'Set up the shop', testo: 'In the setup wizard enter the business details, the VAT rates and the first items, then connect the printer.' },
    { titolo: 'Show the staff the basics', testo: 'Half an hour with the owner and whoever works the till: a sale, a return, closing the day. The fiscal receipt stays with the certified cash register.' },
  ], fonte: 'https://github.com/marta-dev/control-panel' };

const IDEE = [
  { attivita: 'Stationery shop with one counter', problema: 'Stock is checked by eye, and notebooks run out in September.', come: 'Every sale updates the stock, and Control Panel warns when an item drops below its threshold.', risultato: 'Reordering happens before the shelf is empty.',
    anteprima: { tipo: 'notifica', titolo: 'Control Panel', righe: ['A4 lined notebooks: 6 left', 'Reorder threshold: 20'], nota: '08:42' } },
  { attivita: 'Hardware store with two employees', problema: 'Regular customers ask for their purchase history and nobody remembers it.', come: 'The customer card shows what they bought and when, on the phone too.', risultato: 'Whoever is at the counter finds last year’s screw in a second.',
    anteprima: { tipo: 'schermo', titolo: 'Customer · Galli Builders', righe: ['12 Mar · 8 mm wall plugs × 100', '3 Jun · Clear silicone × 6'] } },
  { attivita: 'Herbalist in the town centre', problema: 'Closing the till every evening takes half an hour with a calculator.', come: 'At the end of the day Control Panel puts sales, card payments and cash on one page.', risultato: 'Closing takes a few minutes and matches the cash register.',
    anteprima: { tipo: 'numero', titolo: 'Today’s closing', righe: ['€1,284.50', '38 sales · 21 by card'], nota: '19:30' } },
];

// le colonne mostrate dalle pagine, tabella per tabella
const COLONNE = { utente: ['nome', 'bio', 'zona', 'github_login'], prodotto: ['slug', 'repo', 'url', 'versione_url', 'nome', 'descrizione', 'guida', 'aggiornamenti_testo'], versione: ['url'],
  adozione: ['zona', 'proposta_nota'], cliente: ['nome', 'sito'], recensione: ['testo', 'autore', 'risposta'], richiesta: ['titolo'], messaggio: ['testo'], mancia: ['nota'],
  contatto: ['nome', 'messaggio'], notifica: ['testo', 'link'] };

export function demoInInglese(db, cfg) {
  const coppie = [...SLUG, ...TESTI].sort((a, b) => b[0].length - a[0].length);
  db.exec('BEGIN');
  // due passate: alcune frasi contengono il nome di un prodotto, che la prima passata ha già tradotto
  for (let giro = 0; giro < 2; giro++) for (const [tab, cols] of Object.entries(COLONNE)) for (const col of cols)
    for (const [it, en] of coppie) db.prepare(`UPDATE ${tab} SET ${col} = replace(${col}, ?, ?) WHERE instr(${col}, ?) > 0`).run(it, en, it);
  // il preventivo dell'intervento a chiamata, scritto con la tariffa delle impostazioni
  const ora = (cfg.tariffaOra / 100).toFixed(2), tot = (1.5 * cfg.tariffaOra / 100).toFixed(2);
  db.prepare("UPDATE messaggio SET testo = ? WHERE testo LIKE 'Preventivo:%'").run(`Quote: 1.5 hours at €${ora} an hour, €${tot}. Pay it from this page with the button above, then we get to work.`);
  for (const p of db.prepare('SELECT id, nome, repo FROM prodotto').all())
    db.prepare('UPDATE prodotto SET readme = ?, readme_html = ? WHERE id = ?').run(README, markdownSicuro(README.replaceAll('{{PRODOTTO}}', p.nome), { repo: p.repo, ramo: 'main' }), p.id);
  db.prepare("UPDATE prodotto SET installazione = ?, idee = ? WHERE slug = 'control-panel'").run(JSON.stringify(INSTALLAZIONE), JSON.stringify(IDEE));
  db.exec('COMMIT');
}
